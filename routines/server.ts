#!/usr/bin/env bun
/**
 * Routines — MCP channel server (the scheduler half).
 *
 * This process is the reason the plugin owns a child at all: a routine must
 * still fire when no session is running, and omp has no persisted scheduler.
 * It is spawned per session by `.mcp.json`, which means several instances can be
 * alive at once (the primary plus every flock member profile) — they all serve
 * tools, and exactly one holds the lease and schedules. See `lib/lock.ts`.
 *
 * State (host bind mount, shared by every profile, survives a container recreate):
 *   ~/.claude/channels/routines/jobs.json         the routines
 *   ~/.claude/channels/routines/config.json       timezone + paused, the runtime source of truth
 *   ~/.claude/channels/routines/scheduler.lock    scheduler leadership lease
 *
 * `ROUTINES_STATE_DIR` relocates the whole state dir (tests, throwaway runs).
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { defaultConfig, loadConfig, saveConfig } from "./lib/config.ts";
import { HEARTBEAT_MS, POLL_MS, SchedulerLock, systemClock } from "./lib/lock.ts";
import { createEngine, formatDuration, GRACE_WINDOW_MS } from "./lib/scheduler.ts";
import { loadJobs, migrateLegacyJobs, saveJobs } from "./lib/store.ts";
import { TOOL_DEFINITIONS, handleTool } from "./lib/tools.ts";

const stateDir = process.env.ROUTINES_STATE_DIR ?? join(homedir(), ".claude", "channels", "routines");
const legacyJobsFile = join(homedir(), ".claude", "channels", "cronjobs", "jobs.json");
const jobsFile = join(stateDir, "jobs.json");
const configFile = join(stateDir, "config.json");
const lockFile = join(stateDir, "scheduler.lock");
/** How often the scheduler re-reads config and jobs while it holds the lease. */
const RECONCILE_MS = 60_000;

const log = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

mkdirSync(stateDir, { recursive: true });

if (!existsSync(configFile)) {
  saveConfig(configFile, defaultConfig());
  log(`routines: created ${configFile}`);
}
const bootConfig = loadConfig(configFile);
if (bootConfig.warning) log(`routines: ${bootConfig.warning}`);

migrateLegacyJobs({ legacyFile: legacyJobsFile, jobsFile, log });

try {
  log(`routines: store holds ${loadJobs(jobsFile).length} routine(s)`);
} catch (error) {
  // Surface it loudly and carry on: tools stay available, mutations refuse,
  // and the file is never overwritten. A human fixes it.
  log(`routines: ${error instanceof Error ? error.message : String(error)}`);
}

const mcp = new Server(
  { name: "plugin:routines", version: "1.0.0" },
  {
    capabilities: { tools: {}, experimental: { "claude/channel": {} } },
    instructions: [
      "You are a routine scheduler. Routines fire channel notifications even when no session is running.",
      "When a notification arrives, act on the task it carries.",
      "",
      `Tools: ${TOOL_DEFINITIONS.map((tool) => tool.name).join(", ")}`,
      "",
      "Supported schedule expressions:",
      "  once in 5 minutes       — fires once after a delay",
      "  every 3 minutes         — recurring interval",
      "  every hour              — top of every hour",
      "  every day at 9am        — daily at a specific time",
      "  every weekday at 3am    — Mon–Fri at a specific time",
      "  every monday at 10:30am — specific weekday at a time",
      "  every weekend at noon   — Sat+Sun at noon",
      "  <5 or 6-field cron>     — raw cron expression",
      "",
      "Times resolve in the configured timezone (get-config / set-config), not UTC.",
      `A fire missed while the host was down is caught up when the scheduler restarts if it is within ${formatDuration(GRACE_WINDOW_MS)}; anything older is logged and dropped, and spent one-shots are pruned.`,
    ].join("\n"),
  },
);

const lock = new SchedulerLock(lockFile, systemClock());
let leader = false;

const engine = createEngine({
  readJobs: () => loadJobs(jobsFile),
  readConfig: () => {
    const { config, warning } = loadConfig(configFile);
    if (warning) log(`routines: ${warning}`);
    return config;
  },
  removeJob: (id) => {
    saveJobs(
      jobsFile,
      loadJobs(jobsFile).filter((job) => job.id !== id),
    );
  },
  notify: (job, meta) => {
    void mcp
      .notification({
        method: "notifications/claude/channel",
        params: {
          content: `Routine fired: ${job.task}`,
          meta: {
            source: "routines",
            job_id: job.id,
            task: job.task,
            type: job.type,
            ...(job.type === "cron" ? { expression: job.expression } : {}),
            fired_at: new Date().toISOString(),
            ...(meta.catchUp ? { catch_up: "true" } : {}),
          },
        },
      })
      .catch((error: unknown) => {
        log(`routines: notification failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  },
  log,
});

/** Reconcile after a tool mutation. A follower records the change; the leader schedules it. */
const resync = (): void => {
  if (leader) engine.sync();
  else log("routines: store changed by this session (this server is not the scheduler)");
};

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));
mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  return handleTool(name, args, { jobsFile, configFile, log, afterChange: resync });
});

// Connect before any catch-up fire, so nothing is lost to a closed transport.
await mcp.connect(new StdioServerTransport());

leader = lock.tryAcquire();
log(
  leader
    ? `routines: holding the scheduler lease — scheduling (${bootConfig.config.timezone}${bootConfig.config.paused ? ", paused" : ""})`
    : "routines: another server holds the scheduler lease — tools served, not scheduling",
);
if (leader) engine.sync();

/**
 * One tick drives both roles: the leader refreshes its lease and re-reads state
 * on a slower cadence, a follower retries for the lease. A leader that loses the
 * lease stands down but keeps serving tools — losing the tools is the failure
 * mode this whole design exists to avoid.
 */
let ticks = 0;
/** The loop serves both roles, so it runs at the faster of the two cadences. */
const TICK_MS = Math.min(POLL_MS, HEARTBEAT_MS);
const timer = setInterval(() => {
  ticks += 1;
  if (leader) {
    if (!lock.heartbeat()) {
      leader = false;
      engine.disarm();
      log("routines: lost the scheduler lease — standing down (tools still available)");
      return;
    }
    if (ticks % Math.round(RECONCILE_MS / POLL_MS) === 0) engine.sync();
    return;
  }
  if (lock.tryAcquire()) {
    leader = true;
    log("routines: took over the scheduler lease — scheduling now");
    engine.sync();
  }
}, TICK_MS);
timer.unref?.();

const shutdown = (why: string): void => {
  log(`routines: shutting down (${why})`);
  clearInterval(timer);
  engine.stop();
  lock.release();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
// Without this, a killed session can leave an orphan holding the lease until it
// expires. `cronjobs` shipped exactly that bug (no stdin-EOF handler at all).
process.stdin.on("end", () => shutdown("stdin closed"));
process.stdin.on("close", () => shutdown("stdin closed"));
