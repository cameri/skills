/**
 * Scheduler leadership lease.
 *
 * Why this exists at all: a routine must fire when no session is running, so the
 * scheduler is an MCP child that each session spawns — which means several can
 * be alive at once (the primary plus every flock member profile), all pointing
 * at the same `jobs.json`. Two servers arming the same job fires it twice.
 *
 * What it replaces, and why the replacement is not "a lock file": `cronjobs`
 * used a fixed `/tmp` pid file and made the second instance `exit(1)`. An
 * orphaned child holding that file made every later session lose its cronjobs
 * tools silently — the tools are the *interface*, so losing them is worse than
 * a duplicate fire. This lease is different in three ways:
 *
 *   1. Every server serves its tools. Leadership only decides who schedules.
 *   2. It lives in the state dir, so it is per-plugin-state, not per-host-`/tmp`.
 *   3. It is a lease, not a claim: a holder heartbeats, and anything older than
 *      `LEASE_MS` — or a holder whose pid is gone or a zombie — is stealable.
 *      A crashed leader can therefore never wedge the scheduler.
 *
 * The clock is injected (`pid`, `now`, `startTimeOf`, `isAlive`) so tests can
 * simulate two servers, a dead holder and an expired heartbeat in one process.
 */

import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic, unlinkQuiet } from "./atomic.ts";

/** How long a lease stays valid without a heartbeat. */
export const LEASE_MS = 15_000;
/** How often the leader refreshes its lease. */
export const HEARTBEAT_MS = 5_000;
/** How often a follower retries for leadership. */
export const POLL_MS = 5_000;

export interface Lease {
  pid: number;
  /** Process start time from /proc, so a reused pid is not mistaken for the original. */
  startTime: string | null;
  heartbeatAt: number;
}

export interface LockClock {
  pid: number;
  now(): number;
  startTimeOf(pid: number): string | null;
  isAlive(pid: number, startTime: string | null): boolean;
}

function readProc(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/stat`, "utf-8");
  } catch {
    return null; // /proc unavailable (non-Linux), or the pid is gone
  }
}

/**
 * Real clock: aliveness from /proc, with the zombie case handled explicitly.
 * `kill(pid, 0)` succeeds for a zombie, and a container whose init never reaps
 * would otherwise keep a dead holder looking alive forever.
 */
export function systemClock(): LockClock {
  const startTimeOf = (pid: number): string | null => {
    const stat = readProc(pid);
    if (stat === null) return null;
    // Fields after the comm field, which may itself contain spaces and parens.
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  };

  return {
    pid: process.pid,
    now: () => Date.now(),
    startTimeOf,
    isAlive: (pid: number, startTime: string | null): boolean => {
      try {
        process.kill(pid, 0);
      } catch {
        return false;
      }
      const stat = readProc(pid);
      if (stat !== null && stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] === "Z") return false;
      const current = startTimeOf(pid);
      return current === null ? true : current === startTime;
    },
  };
}

export class SchedulerLock {
  constructor(
    readonly file: string,
    private readonly clock: LockClock,
  ) {}

  /**
   * The recorded lease, or null when it is missing or unparseable. A corrupt
   * lease reads as "free" on purpose: failing to parse must never be able to
   * stop the scheduler for good.
   */
  read(): Lease | null {
    if (!existsSync(this.file)) return null;
    try {
      const data = JSON.parse(readFileSync(this.file, "utf-8")) as Partial<Lease>;
      if (typeof data.pid !== "number") return null;
      return {
        pid: data.pid,
        startTime: typeof data.startTime === "string" ? data.startTime : null,
        heartbeatAt: typeof data.heartbeatAt === "number" ? data.heartbeatAt : 0,
      };
    } catch {
      return null;
    }
  }

  /** True when the current lease is ours — recomputed from disk, never cached. */
  isLeader(): boolean {
    const lease = this.read();
    return lease !== null && lease.pid === this.clock.pid && lease.startTime === this.clock.startTimeOf(this.clock.pid);
  }

  /**
   * Take the lease if it is free, stale or held by a dead process. Returns
   * whether this server is the leader afterwards. Never throws and never exits:
   * a follower is a fully functional server that simply does not schedule.
   */
  tryAcquire(): boolean {
    const lease = this.read();
    if (lease !== null && this.isHeldByAnotherLiveServer(lease)) return false;
    this.write();
    return true;
  }

  /** Refresh the lease. Returns false when leadership was lost and the caller must stand down. */
  heartbeat(): boolean {
    if (!this.isLeader()) return false;
    this.write();
    return true;
  }

  /** Give up leadership, but only if the lease is still ours. */
  release(): void {
    if (this.isLeader()) unlinkQuiet(this.file);
  }

  private isHeldByAnotherLiveServer(lease: Lease): boolean {
    if (lease.pid === this.clock.pid) return false; // ours, possibly a previous instance of this process
    if (!this.clock.isAlive(lease.pid, lease.startTime)) return false;
    return this.clock.now() - lease.heartbeatAt <= LEASE_MS;
  }

  private write(): void {
    const lease: Lease = {
      pid: this.clock.pid,
      startTime: this.clock.startTimeOf(this.clock.pid),
      heartbeatAt: this.clock.now(),
    };
    writeFileAtomic(this.file, `${JSON.stringify(lease)}\n`);
  }
}
