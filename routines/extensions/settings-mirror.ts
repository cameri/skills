/**
 * Routines — settings mirror and status command (the extension half).
 *
 * The extension does not schedule anything. Scheduling belongs to the MCP child,
 * which is the only thing that survives having no session. This module is the
 * *interface* half:
 *
 *   1. It mirrors `omp.settings` into `~/.claude/channels/routines/config.json`,
 *      because settings have no supported runtime accessor and the MCP child
 *      cannot reach the host package at all (see the plugin README). The file is
 *      the runtime source of truth; `omp.settings` is the display/edit layer.
 *   2. It registers `/routines-status`, which needs no model turn and reads the
 *      store directly.
 *
 * Two guards, both deliberate:
 *
 *   - `ctx.hasUI` — subagent and headless sessions re-run this factory in the
 *     same process. They have no settings UI to mirror and no business writing
 *     shared state.
 *   - Only keys actually present in the settings are written (`mergeSettings`).
 *     Every omp profile on this host shares one `config.json`, so a profile that
 *     has never had its settings edited must not clobber another profile's value
 *     with a default. A profile with nothing set writes nothing.
 *
 * Manual-only surface (not covered by tests): whether omp actually renders and
 * stores these settings, and whether the deep import resolves in a real compiled
 * session, are host behaviours. The mirror degrades to a logged no-op when the
 * import fails, and the plugin keeps working off `config.json` alone.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import { loadConfig, mergeSettings, saveConfig } from "../lib/config.ts";
import { computeNextRun } from "../lib/scheduler.ts";
import { loadJobs } from "../lib/store.ts";

const STATE_DIR = process.env.ROUTINES_STATE_DIR ?? join(homedir(), ".claude", "channels", "routines");
const CONFIG_FILE = join(STATE_DIR, "config.json");
const JOBS_FILE = join(STATE_DIR, "jobs.json");

export interface MirrorOptions {
  /** Overridable for tests; production always uses the shared state dir. */
  configFile?: string;
  readSettings?: (cwd: string) => Promise<Record<string, unknown>>;
}

/** Read this plugin's own `omp.settings`. Undocumented host internals — never throw out of it. */
async function readOwnSettings(cwd: string): Promise<Record<string, unknown>> {
  const meta = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as { name?: string };
  if (!meta.name) return {};
  // Dynamic on purpose: this specifier resolves only inside a session that omp
  // has loaded (the host rewrites it to its own bundled module). A static import
  // would be resolved by `bun test`, by a standalone `bun run server.ts`, and by
  // a Claude Code install — none of which have the package — and would fail the
  // whole module load instead of degrading.
  const host = (await import("@oh-my-pi/pi-coding-agent/extensibility/plugins/loader")) as {
    getPluginSettings?: (pluginName: string, cwd: string) => Promise<Record<string, unknown>>;
  };
  if (typeof host.getPluginSettings !== "function") return {};
  return await host.getPluginSettings(meta.name, cwd);
}

/**
 * Mirror settings into the config file. Returns a status line rather than
 * throwing: a failure here must never take down a session, and the config file
 * is authoritative anyway.
 */
export async function mirrorSettings(cwd: string, options: MirrorOptions = {}): Promise<string> {
  const configFile = options.configFile ?? CONFIG_FILE;
  const readSettings = options.readSettings ?? readOwnSettings;
  try {
    const settings = await readSettings(cwd);
    const { config } = loadConfig(configFile);
    const merged = mergeSettings(config, settings);
    if (!merged.changed) return "routines: settings already match config.json";
    saveConfig(configFile, merged.config);
    return `routines: mirrored settings — timezone=${merged.config.timezone} paused=${merged.config.paused}`;
  } catch (error) {
    return `routines: settings mirror skipped (${error instanceof Error ? error.message : String(error)})`;
  }
}

/** Multi-line status for the command: config plus every routine and its next fire. */
export function statusLine(options: { configFile?: string; jobsFile?: string } = {}): string {
  const configFile = options.configFile ?? CONFIG_FILE;
  const jobsFile = options.jobsFile ?? JOBS_FILE;
  const { config, warning } = loadConfig(configFile);
  try {
    const jobs = loadJobs(jobsFile);
    if (jobs.length === 0) {
      return `Routines: no routines scheduled (timezone ${config.timezone}${config.paused ? ", paused" : ""})`;
    }
    const lines = jobs.map((job) => {
      const next = computeNextRun(job, config.timezone) ?? "unparseable expression";
      return `${job.id}  ${job.type === "once" ? "once at" : "cron"} ${job.expression}  → next ${next}`;
    });
    const header = `Routines: ${jobs.length} scheduled (timezone ${config.timezone}${config.paused ? ", paused" : ""})`;
    return [header, ...lines].join("\n");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `Routines: store unreadable — ${detail}${warning ? ` (${warning})` : ""}`;
  }
}

export default function routinesInterface(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return; // subagent and headless sessions must not write shared state
    const result = await mirrorSettings(ctx.cwd);
    if (result.includes("mirrored")) ctx.ui.notify(result, "info");
  });

  pi.registerCommand("routines-status", {
    description: "Show scheduled routines, their next fire times, and the scheduler timezone",
    handler: async (_args, ctx) => {
      ctx.ui.notify(statusLine(), "info");
    },
  });
}
