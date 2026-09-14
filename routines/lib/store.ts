/**
 * The job store: one JSON file, read whole and written whole, never queried.
 *
 * Location is `~/.claude/channels/routines/jobs.json` (overridable with
 * `ROUTINES_STATE_DIR` for tests and throwaway runs). That directory is a host
 * bind mount under `containers/agent-sandbox/.claude/`, so jobs survive a
 * container recreate, and it is shared by every omp profile on the host —
 * deliberately, so one job list is visible everywhere and backs up as a single
 * artifact.
 *
 * File format is a versioned envelope:
 *
 *   { "version": 1, "jobs": [ { id, task, expression, type, created, nextRun? } ] }
 *
 * A bare array — what `cronjobs` wrote — is still accepted on read, so a
 * hand-copied or migrated file keeps working.
 *
 * Corruption policy, which is the reason this module surfaces errors instead of
 * returning `[]` like its predecessor: a truncated or unparseable store must
 * reach a human, not silently become "no jobs" and then be overwritten by the
 * next write. `loadJobs` throws `StoreCorruptError`; the caller decides.
 */

import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic.ts";

export interface Job {
  id: string;
  task: string;
  expression: string; // cron string, or an ISO timestamp for `once`
  type: "cron" | "once";
  created: string;
  nextRun?: string;
}

export const STORE_VERSION = 1;

export interface JobsEnvelope {
  version: number;
  jobs: Job[];
}

/** Raised when the store exists but cannot be trusted. Never swallow this. */
export class StoreCorruptError extends Error {
  constructor(
    readonly path: string,
    readonly detail: string,
  ) {
    super(`routines: job store at ${path} is not readable (${detail}) — leaving it untouched`);
    this.name = "StoreCorruptError";
  }
}

function isJob(value: unknown): value is Job {
  if (typeof value !== "object" || value === null) return false;
  const j = value as Record<string, unknown>;
  return (
    typeof j.id === "string" &&
    typeof j.task === "string" &&
    typeof j.expression === "string" &&
    (j.type === "cron" || j.type === "once") &&
    typeof j.created === "string"
  );
}

/** Parse store contents; throws `StoreCorruptError` on anything untrustworthy. */
export function parseJobs(raw: string, path: string): Job[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new StoreCorruptError(path, `invalid JSON: ${(error as Error).message}`);
  }

  const list = Array.isArray(data) ? data : (data as JobsEnvelope | null)?.jobs;
  if (!Array.isArray(list)) {
    throw new StoreCorruptError(path, "no job array (expected {version, jobs: [...]} or a bare array)");
  }
  const bad = list.find((entry) => !isJob(entry));
  if (bad !== undefined) {
    throw new StoreCorruptError(path, `job record is missing required fields: ${JSON.stringify(bad).slice(0, 120)}`);
  }
  return list as Job[];
}

/**
 * Read the store. A missing file is an empty store (first boot); anything else
 * unreadable throws so the caller can surface it.
 */
export function loadJobs(path: string): Job[] {
  if (!existsSync(path)) return [];
  return parseJobs(readFileSync(path, "utf-8"), path);
}

/** Write the store atomically. */
export function saveJobs(path: string, jobs: Job[]): void {
  const envelope: JobsEnvelope = { version: STORE_VERSION, jobs };
  writeFileAtomic(path, `${JSON.stringify(envelope, null, 2)}\n`);
}

export interface MigrationResult {
  migrated: number;
  /** True when the new store already existed, so nothing was read from the old one. */
  alreadyInitialised: boolean;
  note?: string;
}

/**
 * One-time migration from the retired `cronjobs` store.
 *
 * Runs only when the new store does not exist yet — after that the new store is
 * authoritative and this is inert. The old file is read and never written: if
 * the migration is wrong, the source is still there to redo it from. Jobs keep
 * their ids (documents and the workspace CLAUDE.md reference them).
 */
export function migrateLegacyJobs(opts: {
  legacyFile: string;
  jobsFile: string;
  log: (line: string) => void;
}): MigrationResult {
  const { legacyFile, jobsFile, log } = opts;
  if (existsSync(jobsFile)) return { migrated: 0, alreadyInitialised: true };
  if (!existsSync(legacyFile)) return { migrated: 0, alreadyInitialised: false, note: "no legacy store to migrate" };

  let jobs: Job[];
  try {
    jobs = parseJobs(readFileSync(legacyFile, "utf-8"), legacyFile);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`routines: legacy store could not be read (${detail}) — skipping migration, nothing written`);
    return { migrated: 0, alreadyInitialised: false, note: detail };
  }

  if (jobs.length === 0) {
    log("routines: legacy store is empty — nothing to migrate");
    return { migrated: 0, alreadyInitialised: false, note: "legacy store empty" };
  }

  saveJobs(jobsFile, jobs);
  log(`routines: migrated ${jobs.length} job(s) from ${legacyFile} (legacy file left untouched)`);
  return { migrated: jobs.length, alreadyInitialised: false };
}
