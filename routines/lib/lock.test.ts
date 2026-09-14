/**
 * The lease, and specifically the failure the predecessor shipped: with a fixed
 * `/tmp` pid lock and `exit(1)` for the loser, an orphaned child meant every
 * later session started without its tools. Here the loser is a fully working
 * server that merely does not schedule, and any lease whose holder is gone (or
 * whose heartbeat went stale) is takeable.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEASE_MS, SchedulerLock, type LockClock } from "./lock.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "routines-lock-"));
}

/** One simulated server: its own pid, its own liveness, a shared wall clock. */
function server(dir: string, pid: number, alive: Set<number>, wall: { t: number }) {
  const lock = new SchedulerLock(join(dir, "scheduler.lock"), {
    pid,
    now: () => wall.t,
    startTimeOf: (p) => `st-${p}`,
    isAlive: (p) => alive.has(p),
  } satisfies LockClock);
  return {
    lock,
    die: () => alive.delete(pid),
    advance: (ms: number) => {
      wall.t += ms;
    },
  };
}

describe("two servers on one host", () => {
  test("the first leases, the second follows without exiting", () => {
    const dir = tempDir();
    const alive = new Set([100, 200]);
    const wall = { t: 1_000_000 };
    const first = server(dir, 100, alive, wall);
    const second = server(dir, 200, alive, wall);

    expect(first.lock.tryAcquire()).toBe(true);
    expect(first.lock.isLeader()).toBe(true);
    // The regression that matters: the second server is refused the lease as a
    // *scheduler*, but it is not told to die — it keeps serving its tools.
    expect(second.lock.tryAcquire()).toBe(false);
    expect(second.lock.isLeader()).toBe(false);
    expect(second.lock.read()?.pid).toBe(100);
  });

  test("a follower takes over when the holder dies", () => {
    const dir = tempDir();
    const alive = new Set([100, 200]);
    const wall = { t: 1_000_000 };
    const first = server(dir, 100, alive, wall);
    const second = server(dir, 200, alive, wall);

    first.lock.tryAcquire();
    expect(second.lock.tryAcquire()).toBe(false);

    first.die();
    expect(second.lock.tryAcquire()).toBe(true);
    expect(second.lock.isLeader()).toBe(true);
    // The dead holder no longer considers itself the leader.
    expect(first.lock.heartbeat()).toBe(false);
  });

  test("a wedged holder loses the lease once the heartbeat goes stale", () => {
    const dir = tempDir();
    const alive = new Set([100, 200]);
    const wall = { t: 1_000_000 };
    const first = server(dir, 100, alive, wall);
    const second = server(dir, 200, alive, wall);

    first.lock.tryAcquire();
    second.advance(LEASE_MS + 1); // process still alive, but nothing is heartbeating
    expect(second.lock.tryAcquire()).toBe(true);
  });

  test("a live heartbeat keeps the follower out", () => {
    const dir = tempDir();
    const alive = new Set([100, 200]);
    const wall = { t: 1_000_000 };
    const first = server(dir, 100, alive, wall);
    const second = server(dir, 200, alive, wall);

    first.lock.tryAcquire();
    second.advance(LEASE_MS - 1_000);
    expect(first.lock.heartbeat()).toBe(true);
    expect(second.lock.tryAcquire()).toBe(false);
    expect(second.lock.read()?.heartbeatAt).toBe(1_000_000 + LEASE_MS - 1_000);
  });
});

describe("lease hygiene", () => {
  test("a leader whose lease was taken over reports the loss", () => {
    const dir = tempDir();
    const alive = new Set([100, 200]);
    const wall = { t: 1_000_000 };
    const first = server(dir, 100, alive, wall);
    first.lock.tryAcquire();

    writeFileSync(join(dir, "scheduler.lock"), JSON.stringify({ pid: 200, startTime: "st-200", heartbeatAt: wall.t }));
    expect(first.lock.heartbeat()).toBe(false);
    expect(first.lock.isLeader()).toBe(false);
  });

  test("release removes only our own lease", () => {
    const dir = tempDir();
    const file = join(dir, "scheduler.lock");
    const alive = new Set([100, 200]);
    const wall = { t: 1_000_000 };
    const first = server(dir, 100, alive, wall);
    const second = server(dir, 200, alive, wall);

    first.lock.tryAcquire();
    second.lock.release();
    expect(existsSync(file)).toBe(true);

    first.lock.release();
    expect(existsSync(file)).toBe(false);
  });

  test("a corrupt lease reads as free rather than wedging the scheduler", () => {
    const dir = tempDir();
    const file = join(dir, "scheduler.lock");
    const alive = new Set([100]);
    const wall = { t: 1_000_000 };
    const first = server(dir, 100, alive, wall);

    writeFileSync(file, "{not json");
    expect(first.lock.read()).toBeNull();
    expect(first.lock.tryAcquire()).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf-8")).pid).toBe(100);
  });

  test("a pid that was reused by another process does not inherit the lease", () => {
    const dir = tempDir();
    const alive = new Set([100]);
    const wall = { t: 1_000_000 };
    // A lease recorded for pid 100 under a different process start time: same
    // pid, different process — kill(pid, 0) alone would call this alive.
    writeFileSync(join(dir, "scheduler.lock"), JSON.stringify({ pid: 100, startTime: "st-other", heartbeatAt: wall.t }));
    const current = server(dir, 100, alive, wall);
    expect(current.lock.isLeader()).toBe(false);
    expect(current.lock.tryAcquire()).toBe(true);
  });
});
