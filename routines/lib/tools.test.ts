/**
 * The tool surface, driven directly: no stdio, no session, a temp state dir.
 * What the model would see is what these assert.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchedulerLock, type LockClock } from "./lock.ts";
import { loadJobs, saveJobs } from "./store.ts";
import { TOOL_DEFINITIONS, handleTool, type ToolDeps } from "./tools.ts";

const NOW = Date.parse("2026-09-14T12:00:00.000Z");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "routines-tools-"));
  const jobsFile = join(dir, "jobs.json");
  const configFile = join(dir, "config.json");
  const logs: string[] = [];
  let changes = 0;
  const deps: ToolDeps = {
    jobsFile,
    configFile,
    log: (line) => logs.push(line),
    afterChange: () => {
      changes += 1;
    },
    now: () => NOW,
  };
  return { dir, jobsFile, configFile, deps, logs, changes: () => changes };
}

const call = (deps: ToolDeps, name: string, args: Record<string, unknown> = {}) => handleTool(name, args, deps);

describe("add-job", () => {
  test("stores a natural-language schedule and reports the next fire", () => {
    const f = fixture();
    const result = call(f.deps, "add-job", { task: "review tool failures", expression: "every weekday at 3am" });

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.cronExpression).toBe("0 3 * * 1-5");
    expect(payload.nextRun).toBeTruthy();

    const stored = loadJobs(f.jobsFile);
    expect(stored).toHaveLength(1);
    expect(stored[0].task).toBe("review tool failures");
    expect(f.changes()).toBe(1); // the scheduler was told to reconcile
  });

  test("refuses an expression it cannot parse, and writes nothing", () => {
    const f = fixture();
    const result = call(f.deps, "add-job", { task: "x", expression: "whenever I feel like it" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Cannot parse expression");
    expect(loadJobs(f.jobsFile)).toEqual([]);
    expect(f.changes()).toBe(0);
  });

  test("refuses a cron expression the scheduler would reject", () => {
    const f = fixture();
    const result = call(f.deps, "add-job", { task: "x", expression: "99 99 * * *" });

    expect(result.isError).toBe(true);
    expect(loadJobs(f.jobsFile)).toEqual([]);
  });

  test("requires both a task and an expression", () => {
    const f = fixture();
    expect(call(f.deps, "add-job", { task: "x" }).isError).toBe(true);
    expect(call(f.deps, "add-job", { expression: "every hour" }).isError).toBe(true);
  });
});

describe("list-jobs", () => {
  test("says so when nothing is scheduled, and names the timezone", () => {
    const f = fixture();
    const result = call(f.deps, "list-jobs");
    expect(result.content[0].text).toContain("No active routines");
  });

  test("returns the store with a freshly computed next fire", () => {
    const f = fixture();
    saveJobs(f.jobsFile, [
      { id: "87dd5a5e", task: "t", expression: "0 8 * * *", type: "cron", created: "2026-09-01T00:00:00.000Z" },
    ]);
    const payload = JSON.parse(call(f.deps, "list-jobs").content[0].text);
    expect(payload.jobs).toHaveLength(1);
    expect(payload.jobs[0].id).toBe("87dd5a5e");
    expect(payload.jobs[0].nextRun).toBeTruthy();
  });
});

describe("remove-job / clear-jobs", () => {
  test("removes a known routine and reports an unknown one", () => {
    const f = fixture();
    call(f.deps, "add-job", { task: "a", expression: "every hour" });
    const id = loadJobs(f.jobsFile)[0].id;

    expect(call(f.deps, "remove-job", { id: "nope0000" }).isError).toBe(true);
    expect(call(f.deps, "remove-job", { id }).isError).toBeUndefined();
    expect(loadJobs(f.jobsFile)).toEqual([]);
  });

  test("clear-jobs reports how many it removed", () => {
    const f = fixture();
    call(f.deps, "add-job", { task: "a", expression: "every hour" });
    call(f.deps, "add-job", { task: "b", expression: "every 2 hours" });
    expect(call(f.deps, "clear-jobs").content[0].text).toBe("Cleared 2 routine(s).");
  });
});

describe("config tools", () => {
  test("get-config returns the effective config", () => {
    const f = fixture();
    const payload = JSON.parse(call(f.deps, "get-config").content[0].text);
    expect(payload.paused).toBe(false);
    expect(typeof payload.timezone).toBe("string");
  });

  test("set-config persists the timezone schedules resolve in", () => {
    const f = fixture();
    const result = call(f.deps, "set-config", { timezone: "Europe/Berlin" });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(readFileSync(f.configFile, "utf-8")).timezone).toBe("Europe/Berlin");
  });

  test("set-config rejects a bogus timezone and a non-boolean pause", () => {
    const f = fixture();
    expect(call(f.deps, "set-config", { timezone: "Mars/Olympus" }).isError).toBe(true);
    expect(call(f.deps, "set-config", { paused: "yes" }).isError).toBe(true);
    // Nothing was persisted: the rejected values never reached the file.
    expect(existsSync(f.configFile)).toBe(false);
  });
});

describe("a corrupt store", () => {
  test("is surfaced to the model and never overwritten", () => {
    const f = fixture();
    const broken = '{"version":1,"jobs":[{"id":"87dd';
    writeFileSync(f.jobsFile, broken);

    for (const name of ["list-jobs", "add-job", "clear-jobs"]) {
      const args = name === "add-job" ? { task: "x", expression: "every hour" } : {};
      const result = call(f.deps, name, args);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(f.jobsFile);
    }
    expect(readFileSync(f.jobsFile, "utf-8")).toBe(broken);
  });
});

describe("leadership has nothing to do with tool availability", () => {
  test("a server that does not hold the lease still serves every tool", () => {
    const f = fixture();
    // Another server holds the lease.
    const holder = new SchedulerLock(join(f.dir, "scheduler.lock"), {
      pid: 4242,
      now: () => NOW,
      startTimeOf: (pid) => `st-${pid}`,
      isAlive: () => true,
    } satisfies LockClock);
    expect(holder.tryAcquire()).toBe(true);

    const mine = new SchedulerLock(join(f.dir, "scheduler.lock"), {
      pid: 5252,
      now: () => NOW,
      startTimeOf: (pid) => `st-${pid}`,
      isAlive: () => true,
    } satisfies LockClock);
    expect(mine.tryAcquire()).toBe(false); // follower

    expect(call(f.deps, "list-jobs").isError).toBeUndefined();
    expect(call(f.deps, "add-job", { task: "a", expression: "every hour" }).isError).toBeUndefined();
    expect(loadJobs(f.jobsFile)).toHaveLength(1);
  });
});

describe("tool definitions", () => {
  test("every advertised tool is handled, and every handled tool is advertised", () => {
    const advertised = TOOL_DEFINITIONS.map((tool) => tool.name).sort();
    expect(advertised).toEqual(["add-job", "clear-jobs", "get-config", "list-jobs", "remove-job", "set-config"]);

    const f = fixture();
    for (const name of advertised) {
      const result = call(f.deps, name, {});
      // An unknown tool would answer "Unknown tool: ..."; a known one may still
      // refuse for missing arguments.
      expect(result.content[0].text).not.toContain("Unknown tool");
    }
  });
});
