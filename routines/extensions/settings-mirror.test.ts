/**
 * The mirror and the status command.
 *
 * The mirror's decision logic is tested through an injected settings reader, so
 * the suite needs no host package. What cannot be tested here is stated in the
 * plugin README: whether omp renders the settings form, whether a real
 * `getPluginSettings` resolves inside a compiled session, and whether a live
 * `/routines-status` renders.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import routinesInterface, { mirrorSettings, statusLine } from "./settings-mirror.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "routines-mirror-"));
}

describe("settings mirror", () => {
  test("writes the values that are actually set", async () => {
    const configFile = join(tempDir(), "config.json");
    const result = await mirrorSettings("/workspace", {
      configFile,
      readSettings: async () => ({ timezone: "Europe/Berlin", paused: true }),
    });

    expect(result).toContain("mirrored");
    expect(JSON.parse(readFileSync(configFile, "utf-8"))).toEqual({ timezone: "Europe/Berlin", paused: true });
  });

  test("writes nothing when the profile has no settings of its own", async () => {
    const configFile = join(tempDir(), "config.json");
    const result = await mirrorSettings("/workspace", { configFile, readSettings: async () => ({}) });

    expect(result).toContain("already match");
    expect(existsSync(configFile)).toBe(false);
  });

  test("ignores values that are not settable, rather than persisting them", async () => {
    const configFile = join(tempDir(), "config.json");
    await mirrorSettings("/workspace", {
      configFile,
      readSettings: async () => ({ timezone: "Mars/Olympus", paused: "yes" }),
    });
    expect(existsSync(configFile)).toBe(false);
  });

  test("leaves keys it was not given alone", async () => {
    const configFile = join(tempDir(), "config.json");
    writeFileSync(configFile, JSON.stringify({ timezone: "UTC", paused: false }));

    await mirrorSettings("/workspace", { configFile, readSettings: async () => ({ paused: true }) });

    expect(JSON.parse(readFileSync(configFile, "utf-8"))).toEqual({ timezone: "UTC", paused: true });
  });

  test("a reader that explodes is contained and changes nothing", async () => {
    const dir = tempDir();
    const configFile = join(dir, "config.json");
    writeFileSync(configFile, JSON.stringify({ timezone: "UTC", paused: false }));

    const result = await mirrorSettings("/workspace", {
      configFile,
      readSettings: async () => {
        throw new Error("host package unavailable");
      },
    });

    expect(result).toContain("skipped");
    expect(JSON.parse(readFileSync(configFile, "utf-8"))).toEqual({ timezone: "UTC", paused: false });
  });
});

describe("status line", () => {
  test("lists each routine with its next fire", () => {
    const dir = tempDir();
    const jobsFile = join(dir, "jobs.json");
    writeFileSync(
      jobsFile,
      JSON.stringify({
        version: 1,
        jobs: [{ id: "87dd5a5e", task: "t", expression: "0 8 * * *", type: "cron", created: "2026-09-01T00:00:00.000Z" }],
      }),
    );

    const text = statusLine({ jobsFile, configFile: join(dir, "config.json") });
    expect(text).toContain("1 scheduled");
    expect(text).toContain("87dd5a5e");
    expect(text).toContain("→ next");
  });

  test("says so when nothing is scheduled", () => {
    const dir = tempDir();
    expect(statusLine({ jobsFile: join(dir, "jobs.json"), configFile: join(dir, "config.json") })).toContain(
      "no routines scheduled",
    );
  });

  test("reports an unreadable store instead of pretending it is empty", () => {
    const dir = tempDir();
    const jobsFile = join(dir, "jobs.json");
    writeFileSync(jobsFile, "{ truncated");
    expect(statusLine({ jobsFile, configFile: join(dir, "config.json") })).toContain("unreadable");
  });
});

interface StubPi {
  commands: Map<string, { description?: string; handler: (args: string, ctx: unknown) => Promise<void> }>;
  notifications: string[];
  sessionStart(ctx: { hasUI: boolean; cwd: string }): Promise<void>;
}

function stubPi(): StubPi {
  const commands: StubPi["commands"] = new Map();
  const notifications: string[] = [];
  let startHandler: ((event: unknown, ctx: unknown) => Promise<void>) | undefined;

  routinesInterface({
    on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<void>) => {
      if (event === "session_start") startHandler = handler;
    },
    registerCommand: (name: string, definition: never) => commands.set(name, definition),
  } as never as ExtensionAPI);

  return {
    commands,
    notifications,
    async sessionStart(ctx) {
      await startHandler?.({}, { ...ctx, ui: { notify: (text: string) => notifications.push(text) } });
    },
  };
}

describe("the extension factory", () => {
  test("registers the status command", () => {
    const pi = stubPi();
    expect([...pi.commands.keys()]).toEqual(["routines-status"]);
    expect(pi.commands.get("routines-status")?.description).toBeTruthy();
  });

  test("a subagent or headless session mirrors nothing", async () => {
    const pi = stubPi();
    await pi.sessionStart({ hasUI: false, cwd: "/workspace" });
    expect(pi.notifications).toEqual([]);
  });

  test("the command notifies a status line", async () => {
    const pi = stubPi();
    const ctx = { hasUI: true, cwd: "/workspace", ui: { notify: (text: string) => pi.notifications.push(text) } };
    await pi.commands.get("routines-status")?.handler("", ctx);
    expect(pi.notifications).toHaveLength(1);
    expect(pi.notifications[0].startsWith("Routines:")).toBe(true);
  });
});
