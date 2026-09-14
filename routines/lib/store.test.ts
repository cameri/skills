/**
 * The store's two guarantees: a write is atomic, and corruption is surfaced
 * rather than swallowed. Both are regressions from `cronjobs` — a bare
 * `writeFileSync` (a crash truncated every job on the host) and a `loadJobs`
 * that returned `[]` on any parse error (so the next write destroyed the file).
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadJobs, migrateLegacyJobs, parseJobs, saveJobs, StoreCorruptError } from "./store.ts";
import { commitTemp, writeTemp } from "./atomic.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "routines-store-"));
}

const JOB = {
  id: "87dd5a5e",
  task: "Run the tool-failure-review skill",
  expression: "0 8 * * *",
  type: "cron" as const,
  created: "2026-09-14T13:27:08.341Z",
};

describe("atomic writes", () => {
  test("a crash between the temp write and the rename leaves the real file intact", () => {
    const dir = tempDir();
    const file = join(dir, "jobs.json");
    saveJobs(file, [JOB]);
    const before = readFileSync(file, "utf-8");

    // Exactly the window a crash would hit: temp written and fsynced, rename not reached.
    const temp = writeTemp(file, `${JSON.stringify({ version: 1, jobs: [] })}\n`);
    expect(readFileSync(file, "utf-8")).toBe(before);
    expect(loadJobs(file)).toHaveLength(1);
    expect(existsSync(temp)).toBe(true);

    commitTemp(temp, file); // the recovery path the crash skipped
    expect(loadJobs(file)).toHaveLength(0);
  });

  test("a committed write replaces the file and leaves no temp behind", () => {
    const dir = tempDir();
    const file = join(dir, "jobs.json");
    saveJobs(file, [JOB]);
    saveJobs(file, [{ ...JOB, id: "aaaaaaaa" }]);

    expect(loadJobs(file).map((job) => job.id)).toEqual(["aaaaaaaa"]);
    expect(readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});

describe("corruption is surfaced, never swallowed", () => {
  test("a truncated file throws instead of reading as an empty store", () => {
    const dir = tempDir();
    const file = join(dir, "jobs.json");
    writeFileSync(file, '{"version":1,"jobs":[{"id":"87dd');
    expect(() => loadJobs(file)).toThrow(StoreCorruptError);
  });

  test("a job record missing required fields throws", () => {
    const file = join(tempDir(), "jobs.json");
    expect(() => parseJobs(JSON.stringify({ version: 1, jobs: [{ id: "x" }] }), file)).toThrow(StoreCorruptError);
  });

  test("an unreadable store is left byte-identical for a human to inspect", () => {
    const dir = tempDir();
    const file = join(dir, "jobs.json");
    const broken = '{"version":1,"jobs":';
    writeFileSync(file, broken);
    expect(() => loadJobs(file)).toThrow();
    expect(readFileSync(file, "utf-8")).toBe(broken);
  });

  test("a missing file is an empty store — first boot is not an error", () => {
    expect(loadJobs(join(tempDir(), "jobs.json"))).toEqual([]);
  });

  test("a bare array (what cronjobs wrote) still reads", () => {
    const file = join(tempDir(), "jobs.json");
    expect(parseJobs(JSON.stringify([JOB]), file)).toHaveLength(1);
  });
});

describe("migration from the retired cronjobs store", () => {
  test("carries the job over with its id and leaves the legacy file untouched", () => {
    const dir = tempDir();
    const legacyFile = join(dir, "cronjobs", "jobs.json");
    const jobsFile = join(dir, "routines", "jobs.json");
    mkdirSync(join(dir, "cronjobs"), { recursive: true });
    mkdirSync(join(dir, "routines"), { recursive: true });
    const legacyBytes = `${JSON.stringify([JOB], null, 2)}\n`;
    writeFileSync(legacyFile, legacyBytes);

    const logged: string[] = [];
    const result = migrateLegacyJobs({ legacyFile, jobsFile, log: (line) => logged.push(line) });

    expect(result.migrated).toBe(1);
    expect(loadJobs(jobsFile).map((job) => job.id)).toEqual(["87dd5a5e"]);
    expect(readFileSync(legacyFile, "utf-8")).toBe(legacyBytes);
    expect(logged.join("\n")).toContain("migrated 1 job(s)");
  });

  test("runs once: an existing new store is authoritative", () => {
    const dir = tempDir();
    const legacyFile = join(dir, "legacy.json");
    const jobsFile = join(dir, "jobs.json");
    writeFileSync(legacyFile, JSON.stringify([JOB]));
    saveJobs(jobsFile, [{ ...JOB, id: "current001" }]);

    const result = migrateLegacyJobs({ legacyFile, jobsFile, log: () => {} });
    expect(result.alreadyInitialised).toBe(true);
    expect(loadJobs(jobsFile).map((job) => job.id)).toEqual(["current001"]);
  });

  test("an unreadable legacy store is reported, not partially imported", () => {
    const dir = tempDir();
    const legacyFile = join(dir, "legacy.json");
    const jobsFile = join(dir, "jobs.json");
    writeFileSync(legacyFile, "not json at all");
    const logged: string[] = [];

    const result = migrateLegacyJobs({ legacyFile, jobsFile, log: (line) => logged.push(line) });

    expect(result.migrated).toBe(0);
    expect(existsSync(jobsFile)).toBe(false);
    expect(readFileSync(legacyFile, "utf-8")).toBe("not json at all");
    expect(logged.join("\n")).toContain("skipping migration");
  });
});
