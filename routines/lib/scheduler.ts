/**
 * The scheduler: what is due, what was missed, and what gets armed.
 *
 * Split in two on purpose. `planBoot` is pure — given jobs, a clock reading and
 * a timezone it returns the decision (fire now, arm, prune, skip) with no timers
 * involved, so the missed-fire policy is testable directly. `createEngine` is
 * the stateful half that owns the timers and reconciles them against the store.
 *
 * Missed-fire policy (Cameri, 2026-09-13): on boot, run anything missed inside a
 * short grace window, log the rest as skipped, and prune spent one-shots. What
 * `cronjobs` did instead — skip a past-due `once` job forever and never prune it,
 * and never fire anything missed while the host was down — is the defect.
 *
 * "Missed" is decided by asking croner for the first occurrence after
 * `now - grace`: if that lands at or before `now`, a fire was due and nothing was
 * scheduling, so it is caught up. Everything here is a pure function of an
 * explicit `now`, which is what makes the policy testable.
 */

import { Cron } from "croner";
import type { Job } from "./store.ts";
import type { RoutineConfig } from "./config.ts";

/** How late a missed fire may be and still run. Older than this, it is logged and dropped. */
export const GRACE_WINDOW_MS = 30 * 60_000;

export interface MissedJob {
  job: Job;
  reason: string;
}

export interface BootPlan {
  /** Fires immediately (catch-up): due while nothing was scheduling, inside the grace window. */
  fireNow: Job[];
  /** Jobs to arm on their normal schedule. */
  arm: Job[];
  /** Spent one-shots, removed from the store. */
  prune: MissedJob[];
  /** Cron fires missed outside the grace window: logged, kept, not replayed. */
  missed: MissedJob[];
  /** Jobs that cannot be scheduled at all; kept in the store so nothing is lost. */
  invalid: MissedJob[];
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Next fire time for display. Croner computes it fresh; the stored `nextRun` goes stale. */
export function computeNextRun(job: Job, timezone: string): string | null {
  if (job.type === "once") return job.expression;
  try {
    const probe = new Cron(job.expression, { paused: true, timezone });
    const next = probe.nextRun();
    probe.stop();
    return next ? next.toISOString() : null;
  } catch {
    return null;
  }
}

/** Decide what a boot (or a leadership takeover) does with each job. */
export function planBoot(
  jobs: Job[],
  nowMs: number,
  timezone: string,
  graceMs: number = GRACE_WINDOW_MS,
): BootPlan {
  const plan: BootPlan = { fireNow: [], arm: [], prune: [], missed: [], invalid: [] };

  for (const job of jobs) {
    if (job.type === "once") {
      const dueAt = Date.parse(job.expression);
      if (Number.isNaN(dueAt)) {
        plan.invalid.push({ job, reason: "expression is not a timestamp" });
        continue;
      }
      const late = nowMs - dueAt;
      if (late < 0) {
        plan.arm.push(job); // still ahead of us
      } else if (late <= graceMs) {
        plan.fireNow.push(job); // missed while nothing was scheduling, still worth running
      } else {
        plan.prune.push({ job, reason: `missed by ${formatDuration(late)} (grace window ${formatDuration(graceMs)})` });
      }
      continue;
    }

    // "Due inside the window?" is asked directly — the first occurrence after
    // `now - grace` either falls at or before `now` (a fire was due and nothing
    // ran it) or it does not (nothing to replay). This is one croner call with
    // an explicit reference date, so the decision is deterministic and cheap;
    // croner's own `previousRun()` reads the wall clock and cannot be tested.
    let nextFuture: Date | null;
    let firstInWindow: Date | null;
    try {
      const probe = new Cron(job.expression, { paused: true, timezone });
      nextFuture = probe.nextRun(new Date(nowMs));
      firstInWindow = probe.nextRun(new Date(nowMs - graceMs));
      probe.stop();
    } catch (error) {
      plan.invalid.push({ job, reason: `invalid cron expression: ${(error as Error).message}` });
      continue;
    }
    if (nextFuture === null) {
      plan.invalid.push({ job, reason: "expression never fires" });
      continue;
    }
    if (firstInWindow !== null && firstInWindow.getTime() <= nowMs) {
      plan.fireNow.push(job);
    } else {
      // Only worth reporting for a job that already existed before the window:
      // a routine created five minutes ago has simply not come due yet.
      const created = Date.parse(job.created);
      if (Number.isNaN(created) || created <= nowMs - graceMs) {
        plan.missed.push({
          job,
          reason: `no fire was due in the last ${formatDuration(graceMs)} — the one before that is not replayed`,
        });
      }
    }
    plan.arm.push(job);
  }

  return plan;
}

export interface EngineDeps {
  readJobs(): Job[];
  readConfig(): RoutineConfig;
  /** Remove a spent one-shot after it fires. */
  removeJob(id: string): void;
  /** Deliver the fire to the session as a channel notification. */
  notify(job: Job, meta: { catchUp: boolean }): void;
  log(line: string): void;
  now?(): number;
  graceMs?: number;
}

export interface Engine {
  /**
   * Re-read config and jobs and reconcile timers. The first call after taking
   * leadership also runs the missed-fire plan; later calls only reconcile, so a
   * catch-up can never fire twice.
   */
  sync(): void;
  disarm(): void;
  armedIds(): string[];
  stop(): void;
}

export function createEngine(deps: EngineDeps): Engine {
  const timers = new Map<string, { stop(): void; timezone: string }>();
  const now = deps.now ?? (() => Date.now());
  let ranBootPlan = false;
  let pausedLogged = false;

  const stopAll = (): void => {
    for (const timer of timers.values()) timer.stop();
    timers.clear();
  };

  const fire = (job: Job, catchUp: boolean): void => {
    try {
      deps.notify(job, { catchUp });
    } catch (error) {
      deps.log(`routines: fire for ${job.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (job.type === "once") {
      timers.get(job.id)?.stop();
      timers.delete(job.id);
      try {
        deps.removeJob(job.id);
      } catch (error) {
        deps.log(`routines: could not remove spent one-shot ${job.id}: ${(error as Error).message}`);
      }
    }
  };

  const arm = (job: Job, timezone: string): void => {
    const existing = timers.get(job.id);
    if (existing) {
      if (existing.timezone === timezone) return; // already armed under this timezone
      existing.stop();
      timers.delete(job.id);
    }

    if (job.type === "once") {
      const delay = Date.parse(job.expression) - now();
      if (Number.isNaN(delay) || delay <= 0) {
        deps.log(`routines: one-shot ${job.id} is already due — left for the next boot plan`);
        return;
      }
      const handle = setTimeout(() => fire(job, false), delay);
      (handle as { unref?: () => void }).unref?.();
      timers.set(job.id, { stop: () => clearTimeout(handle), timezone });
      return;
    }

    const cron = new Cron(job.expression, { timezone, catch: true, unref: true }, () => fire(job, false));
    timers.set(job.id, { stop: () => cron.stop(), timezone });
  };

  const reconcile = (jobs: Job[], timezone: string, plan?: BootPlan): void => {
    const wanted = plan ? [...plan.arm, ...plan.fireNow.filter((job) => job.type === "cron")] : jobs;
    const wantedIds = new Set(wanted.map((job) => job.id));
    for (const [id, timer] of timers) {
      if (!wantedIds.has(id)) {
        timer.stop();
        timers.delete(id);
      }
    }
    for (const job of wanted) arm(job, timezone);
  };

  const sync = (): void => {
    let jobs: Job[];
    let config: RoutineConfig;
    try {
      jobs = deps.readJobs();
      config = deps.readConfig();
    } catch (error) {
      // An unreadable store must not fire anything, and must not be overwritten
      // — the caller surfaces the error to the operator.
      deps.log(`routines: scheduler idle — ${error instanceof Error ? error.message : String(error)}`);
      stopAll();
      return;
    }

    if (config.paused) {
      if (!pausedLogged) {
        deps.log("routines: paused — jobs are kept but nothing is scheduled");
        pausedLogged = true;
      }
      stopAll();
      ranBootPlan = true; // resuming does not replay what was missed while paused
      return;
    }
    pausedLogged = false;

    if (ranBootPlan) {
      reconcile(jobs, config.timezone);
      return;
    }
    ranBootPlan = true;

    const plan = planBoot(jobs, now(), config.timezone, deps.graceMs ?? GRACE_WINDOW_MS);
    for (const { job, reason } of plan.prune) {
      deps.log(`routines: pruning one-shot ${job.id} — ${reason}`);
      try {
        deps.removeJob(job.id);
      } catch (error) {
        deps.log(`routines: could not prune ${job.id}: ${(error as Error).message}`);
      }
    }
    for (const { job, reason } of plan.missed) deps.log(`routines: skipped ${job.id} — ${reason}`);
    for (const { job, reason } of plan.invalid) deps.log(`routines: cannot schedule ${job.id} — ${reason} (kept in the store)`);
    for (const job of plan.fireNow) {
      deps.log(`routines: catching up ${job.id} (missed inside the grace window)`);
      fire(job, true);
    }
    reconcile(jobs, config.timezone, plan);
  };

  return {
    sync,
    disarm: stopAll,
    armedIds: () => [...timers.keys()],
    stop: stopAll,
  };
}
