/**
 * The missed-fire policy and the engine's arming behaviour.
 *
 * Everything is driven from an explicit `now`, so the catch-up window is proven
 * rather than timed: a fire due inside the window fires, one outside it is
 * pruned (one-shot) or logged (recurring), and a catch-up can never run twice.
 */

import { describe, expect, test } from "bun:test";
import { GRACE_WINDOW_MS, createEngine, planBoot, type Engine } from "./scheduler.ts";
import type { Job } from "./store.ts";
import type { RoutineConfig } from "./config.ts";

const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const TZ = "UTC";

function job(over: Partial<Job> = {}): Job {
  return {
    id: "87dd5a5e",
    task: "do the thing",
    expression: "0 8 * * *",
    type: "cron",
    created: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

function onceIn(ms: number, over: Partial<Job> = {}): Job {
  return job({ id: "once0001", type: "once", expression: new Date(NOW + ms).toISOString(), ...over });
}

describe("planBoot: the grace window", () => {
  test("a one-shot due inside the window fires on boot", () => {
    const plan = planBoot([onceIn(-10 * 60_000)], NOW, TZ);
    expect(plan.fireNow.map((j) => j.id)).toEqual(["once0001"]);
    expect(plan.prune).toEqual([]);
  });

  test("a one-shot outside the window is pruned and says why", () => {
    const plan = planBoot([onceIn(-3 * 3_600_000)], NOW, TZ);
    expect(plan.fireNow).toEqual([]);
    expect(plan.prune).toHaveLength(1);
    expect(plan.prune[0].reason).toContain("grace window");
  });

  test("a one-shot still ahead is armed, not fired", () => {
    const plan = planBoot([onceIn(5 * 60_000)], NOW, TZ);
    expect(plan.fireNow).toEqual([]);
    expect(plan.prune).toEqual([]);
    expect(plan.arm.map((j) => j.id)).toEqual(["once0001"]);
  });

  test("a one-shot with an unparseable deadline is reported, not dropped", () => {
    const plan = planBoot([job({ id: "bad00001", type: "once", expression: "tomorrow-ish" })], NOW, TZ);
    expect(plan.invalid.map((j) => j.job.id)).toEqual(["bad00001"]);
    expect(plan.prune).toEqual([]);
  });

  test("a recurring routine due inside the window is caught up", () => {
    const plan = planBoot([job({ expression: "* * * * *" })], NOW, TZ);
    expect(plan.fireNow.map((j) => j.id)).toEqual(["87dd5a5e"]);
    expect(plan.arm.map((j) => j.id)).toEqual(["87dd5a5e"]); // and still scheduled normally
  });

  test("a recurring routine with nothing due in the window is logged, not replayed", () => {
    const plan = planBoot([job()], NOW, TZ); // 08:00 daily, now 12:00
    expect(plan.fireNow).toEqual([]);
    expect(plan.missed).toHaveLength(1);
    expect(plan.arm.map((j) => j.id)).toEqual(["87dd5a5e"]);
  });

  test("a routine created inside the window is not reported as skipped", () => {
    const plan = planBoot([job({ created: new Date(NOW - 5 * 60_000).toISOString() })], NOW, TZ);
    expect(plan.missed).toEqual([]);
    expect(plan.arm).toHaveLength(1);
  });

  test("an unparseable cron expression is surfaced and nothing is armed", () => {
    const plan = planBoot([job({ expression: "99 99 * * *" })], NOW, TZ);
    expect(plan.invalid).toHaveLength(1);
    expect(plan.arm).toEqual([]);
    expect(plan.fireNow).toEqual([]);
  });

  test("the window boundary is inclusive", () => {
    const exact = planBoot([onceIn(-GRACE_WINDOW_MS)], NOW, TZ);
    expect(exact.fireNow).toHaveLength(1);
    const past = planBoot([onceIn(-GRACE_WINDOW_MS - 1_000)], NOW, TZ);
    expect(past.fireNow).toEqual([]);
    expect(past.prune).toHaveLength(1);
  });
});

interface Harness {
  engine: Engine;
  notifications: { id: string; catchUp: boolean }[];
  removed: string[];
  logs: string[];
  /** Replace the stored jobs, as another writer (or the user) would. */
  arm(jobs: Job[]): void;
  setConfig(config: Partial<RoutineConfig>): void;
  failReads: boolean;
}

function harness(jobs: Job[], config: Partial<RoutineConfig> = {}): Harness {
  const notifications: { id: string; catchUp: boolean }[] = [];
  const removed: string[] = [];
  const logs: string[] = [];
  const live: RoutineConfig = { timezone: TZ, paused: false, ...config };

  const state: Harness = {
    engine: undefined as never,
    notifications,
    removed,
    logs,
    failReads: false,
    arm(next: Job[]) {
      jobs = next;
    },
    setConfig(next: Partial<RoutineConfig>) {
      Object.assign(live, next);
    },
  };

  state.engine = createEngine({
    readJobs: () => {
      if (state.failReads) throw new Error("store is truncated");
      return jobs;
    },
    readConfig: () => live,
    removeJob: (id) => {
      removed.push(id);
      jobs = jobs.filter((entry) => entry.id !== id);
    },
    notify: (fired, meta) => notifications.push({ id: fired.id, catchUp: meta.catchUp }),
    log: (line) => logs.push(line),
    now: () => NOW,
  });
  return state;
}

describe("engine", () => {
  test("a catch-up fires once, then only reconciles", () => {
    const h = harness([job({ expression: "* * * * *" })]);
    h.engine.sync();
    expect(h.notifications).toEqual([{ id: "87dd5a5e", catchUp: true }]);
    expect(h.engine.armedIds()).toEqual(["87dd5a5e"]);

    h.engine.sync();
    expect(h.notifications).toHaveLength(1); // never fires the same catch-up twice
    h.engine.stop();
  });

  test("a spent one-shot is fired, removed, and left unarmed", () => {
    const h = harness([onceIn(-10 * 60_000)]);
    h.engine.sync();
    expect(h.notifications).toEqual([{ id: "once0001", catchUp: true }]);
    expect(h.removed).toEqual(["once0001"]);
    expect(h.engine.armedIds()).toEqual([]);
    h.engine.stop();
  });

  test("a pruned one-shot is logged and removed without firing", () => {
    const h = harness([onceIn(-3 * 3_600_000)]);
    h.engine.sync();
    expect(h.notifications).toEqual([]);
    expect(h.removed).toEqual(["once0001"]);
    expect(h.logs.join("\n")).toContain("pruning one-shot once0001");
    h.engine.stop();
  });

  test("a routine removed from the store is disarmed", () => {
    const h = harness([job()]);
    h.engine.sync();
    expect(h.engine.armedIds()).toEqual(["87dd5a5e"]);
    h.arm([]);
    h.engine.sync();
    expect(h.engine.armedIds()).toEqual([]);
    h.engine.stop();
  });

  test("paused keeps the jobs but schedules nothing, and resuming does not replay", () => {
    const h = harness([job({ expression: "* * * * *" })], { paused: true });
    h.engine.sync();
    expect(h.engine.armedIds()).toEqual([]);
    expect(h.notifications).toEqual([]);
    expect(h.logs.join("\n")).toContain("paused");

    h.setConfig({ paused: false });
    h.engine.sync();
    expect(h.notifications).toEqual([]); // the paused window is not replayed
    expect(h.engine.armedIds()).toEqual(["87dd5a5e"]);
    h.engine.stop();
  });

  test("an unreadable store leaves the scheduler idle instead of throwing", () => {
    const h = harness([job()]);
    h.failReads = true;
    expect(() => h.engine.sync()).not.toThrow();
    expect(h.engine.armedIds()).toEqual([]);
    expect(h.logs.join("\n")).toContain("scheduler idle");
    h.engine.stop();
  });
});
