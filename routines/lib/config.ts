/**
 * Configuration — the runtime source of truth.
 *
 * `~/.claude/channels/routines/config.json` holds the two values that are not
 * the job list: `timezone` and `paused`. It is read by both halves of the
 * plugin, and both re-read it rather than caching, so a change lands without a
 * restart:
 *
 *   - the scheduler child (an MCP stdio process) reads it at boot and on every
 *     reconcile tick;
 *   - the extension mirrors `omp.settings` into it on `session_start`, and
 *     `get-config` / `set-config` in the child read and write it directly so
 *     Claude Code sessions (which have no settings panel for this) can too.
 *
 * `omp.settings` is the *display* layer only: omp renders it in /settings →
 * Plugins and `omp plugin config` writes it, but there is no supported runtime
 * accessor and the MCP child cannot reach the host package at all. If the two
 * disagree, this file wins — it is what the scheduler actually reads.
 */

import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic.ts";

export interface RoutineConfig {
  timezone: string;
  /** Suspend firing without losing jobs. Never a substitute for liveness. */
  paused: boolean;
}

/** The host's own timezone, the same fallback `cronjobs` used via the TZ env var. */
export function hostTimezone(env: NodeJS.ProcessEnv = process.env): string {
  return env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function defaultConfig(env: NodeJS.ProcessEnv = process.env): RoutineConfig {
  return { timezone: hostTimezone(env), paused: false };
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function coerce(raw: unknown, fallback: RoutineConfig): RoutineConfig {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const timezone = typeof data.timezone === "string" && isValidTimezone(data.timezone)
    ? data.timezone
    : fallback.timezone;
  const paused = typeof data.paused === "boolean" ? data.paused : fallback.paused;
  return { timezone, paused };
}

/**
 * Read the config, falling back to defaults for anything missing or invalid.
 * A file that cannot be parsed yields a warning rather than a throw: unlike the
 * job store, the safe recovery here is the default value, and the caller logs
 * the warning so the bad file is still visible.
 */
export function loadConfig(file: string, env: NodeJS.ProcessEnv = process.env): { config: RoutineConfig; warning?: string } {
  const fallback = defaultConfig(env);
  if (!existsSync(file)) return { config: fallback };
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (error) {
    return { config: fallback, warning: `config unreadable (${(error as Error).message}) — using defaults` };
  }
  try {
    return { config: coerce(JSON.parse(raw), fallback) };
  } catch (error) {
    return { config: fallback, warning: `config is not valid JSON (${(error as Error).message}) — using defaults` };
  }
}

export function saveConfig(file: string, config: RoutineConfig): void {
  writeFileAtomic(file, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Fold `omp.settings` values into a config, touching only the keys actually
 * present. Used by the extension's mirror, which must not invent a timezone a
 * user never chose — an absent setting means "leave the file alone".
 */
export function mergeSettings(
  config: RoutineConfig,
  settings: Record<string, unknown>,
): { config: RoutineConfig; changed: boolean } {
  const next: RoutineConfig = { ...config };
  if (typeof settings.timezone === "string" && isValidTimezone(settings.timezone)) {
    next.timezone = settings.timezone;
  }
  if (typeof settings.paused === "boolean") {
    next.paused = settings.paused;
  }
  const changed = next.timezone !== config.timezone || next.paused !== config.paused;
  return { config: next, changed };
}
