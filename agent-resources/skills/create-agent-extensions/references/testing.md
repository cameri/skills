# Testing an Extension

Two tiers. Tier 1 is required for every extension and costs nothing. Tier 2 buys stronger coverage at the price of a large devDependency, and is optional.

<the_bar>

Every extension ships a `bun test` suite that imports its module, drives each registered handler with synthetic events through a local stub `pi`, and asserts the observable outcome:

- the **returned value** for a decision — `{ block, reason }`, rewritten `content`, a `{ messages }` filter;
- the **recorded calls** for an action — the text handed to `sendUserMessage`, the file written, the timer armed;
- the **registered names** for tools and commands.

A `tool_call` blocker must assert **both arms**: the blocked call and an ordinary call that passes through.

The real-harness devDependency is not part of this bar. Most extensions do not need it, and the tier-2 install is ~48 MB.

</the_bar>

<tier_1_stub_pi>

Model the extension as the pure function it is: call its default export with a recording stub, then dispatch synthetic events into the handlers it registered. This works with no `node_modules` at all, because the harness import is type-only and is erased at transpile time.

```ts
// extensions/omp-channel.test.ts   (run with: bun test)
import { describe, expect, test } from "bun:test";
import ompChannelBridge from "./omp-channel.ts";

/** Minimal structural stand-in — no dependency on @oh-my-pi/pi-coding-agent. */
type Handler = (event: {
  method: string;
  server?: string;
  params?: { content?: string; meta?: Record<string, unknown> };
}) => void;

function harness(activeTools: string[] = []) {
  const handlers: Handler[] = [];
  const sent: string[] = [];
  ompChannelBridge({
    on: (_event: string, handler: Handler) => handlers.push(handler),
    getActiveTools: () => activeTools,
    sendUserMessage: (message: string) => sent.push(message),
    // anything else the module touches, as a recorder
  } as never);
  return { sent, dispatch: (event: Parameters<Handler>[0]) => handlers.forEach((h) => h(event)) };
}

describe("channel bridge", () => {
  test("wraps a matching notification into a wake", () => {
    const h = harness();
    h.dispatch({
      method: "notifications/claude/channel",
      server: "my-plugin",
      params: { content: "event", meta: { source: "my-plugin" } },
    });
    expect(h.sent).toEqual(['<channel source="my-plugin">\nevent\n</channel>']);
  });

  test("stays silent for a subagent session", () => {
    const h = harness(["read", "yield"]);
    h.dispatch({
      method: "notifications/claude/channel",
      server: "my-plugin",
      params: { content: "event" },
    });
    expect(h.sent).toHaveLength(0);
  });
});
```

Use it for pure decisions: does this event wake the session, does this value get escaped, does this command get blocked, which tool and command names got registered, what text is emitted.

<tier1_stub_shape>
The stub needs only the members the module actually touches. Record what matters — a `sendUserMessage` array, a `registerTool` map keyed by name, a `setActiveTools` list — and type the whole stub `as never` so the structural mismatch against `ExtensionAPI` never blocks the test.
</tier1_stub_shape>

Assertion shapes that hold up:

| What is under test | Assert |
|---|---|
| A decision | the handler's return value: `expect(result).toEqual({ block: true, reason: "…" })` |
| An action | the recorded call: `expect(sent).toEqual([…])`, or read back the file the handler wrote |
| A registration | the recorded map: `expect(tools.has("my_tool")).toBe(true)`, `expect(commands.has("start-fresh")).toBe(true)` |
| That a handler ran at all | a fixture handler appends a JSON line to a temp file; the test reads it back |
| Escaping / forging defences | exact string equality on the emitted text, with a hostile input |

</tier_1_stub_pi>

<tier_2_real_runtime>

A stub cannot tell you whether a `tool_call` handler actually blocks the tool, whether a `tool_result` merge wins or loses, or whether a handler hangs past its timeout. For that, import the real loader, runner and wrapper, and assert through the wrapper the agent loop actually calls.

```ts
// test/extension-block.test.ts   (run with: bun test; needs @oh-my-pi/pi-coding-agent)
import { describe, expect, test } from "bun:test";
import { loadExtensionFromFactory, ExtensionRuntime }
  from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import { ExtensionToolWrapper } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/wrapper";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

async function wrappedWith(factory: (pi: never) => void) {
  const runtime = new ExtensionRuntime();
  const extension = await loadExtensionFromFactory(
    factory as never, process.cwd(), new EventBus(), runtime, "fixture",
  );
  const runner = new ExtensionRunner(
    [extension], runtime, process.cwd(), SessionManager.inMemory(), {} as never,
  );
  const tool = {
    name: "bash", label: "Bash", description: "run a command",
    parameters: {} as never,
    execute: async () => ({ content: [{ type: "text" as const, text: "ran" }] }),
  };
  return new ExtensionToolWrapper(tool as never, runner);
}

describe("tool_call blocker", () => {
  const blocker = (pi: any) => pi.on("tool_call", (e: any) => {
    if (e.toolName !== "bash") return;
    if (String(e.input?.command ?? "").includes("rm -rf /")) return { block: true, reason: "refused: rm -rf /" };
  });

  test("blocks, and surfaces the reason to the model", async () => {
    const tool = await wrappedWith(blocker);
    await expect(tool.execute("call-1", { command: "sudo rm -rf /" } as never))
      .rejects.toThrow("refused: rm -rf /");
  });

  test("lets an ordinary command through", async () => {
    const tool = await wrappedWith(blocker);
    expect((await tool.execute("call-2", { command: "ls -la" } as never)).content)
      .toEqual([{ type: "text", text: "ran" }]);
  });
});
```

**The exact assertion shape for a `tool_call` blocker:** the wrapped call **rejects** with the handler's `reason` string, because the runner's fail-closed result becomes the tool error the model sees. The passing arm asserts the tool's own content is returned unchanged.

Setup notes:

- The devDependency is `@oh-my-pi/pi-coding-agent` — **~48 MB unpacked**, pulling `puppeteer-core`, a native addon, ten OpenTelemetry packages and optional large model packages.
- **Pin it to the version `omp --version` reports.** Test-time resolution is not runtime resolution: at load time omp rewrites an extension's bare specifiers and serves the package root through a bundled shim, while a plain `bun test` uses ordinary node resolution against the plugin's own `node_modules`. A test can therefore exercise a different copy of omp than the one that runs the extension; what happens when those diverge is untested.
- `ExtensionRunner` needs real collaborators: `SessionManager.inMemory()` for the session manager and a real `ModelRegistry` if the handler touches `ctx.models`.
- Settle handler timeouts with a spy on the logger plus an elapsed-time bound rather than a sleep.

</tier_2_real_runtime>

<cannot_be_tested_in_process>

State this explicitly in the extension's own docs rather than implying the unit suite covers it.

| Not testable in-process | Why |
|---|---|
| A live session's behaviour around an event | the harness is the thing under test; only a real `omp` run proves it |
| Real model turns | a mock model answers what the test scripts |
| MCP delivery and channel wake | the notification reaches extensions through a live per-session bridge; turning one into a turn is the receiving extension's own `sendUserMessage`, and the child, its transport and the resulting turn exist only in a running session |
| Timers firing on schedule | dispatch mechanics are testable, wall-clock firing is flaky; managed timers also survive `/new` and `/resume` and die with the process, which only a real session shows |
| Anything UI-shaped | with no UI context `ctx.hasUI` is `false` and every `ctx.ui` method is a no-op |
| Isolation and blast radius | that a raw timer throw kills the session follows from the docs but is not observable without running omp |
| Provider registration end-to-end, credential flows, session control (`newSession`, `branch`, `switchSession`) | these need a real `AgentSession` |
| Plugin installation, discovery and version-cache behaviour | belongs to `omp plugin` and a live session, not to the module |

**Manual verification stays manual:** load the extension in a real session and watch the event fire (debug logging is always on under the active state root's `logs/`), and for a channel bridge send a real event through the MCP child. Record that list in the plugin's docs so the gap is explicit.

</cannot_be_tested_in_process>

<conventions_in_this_marketplace>

- `bun test` is the runner; several plugins declare `"test": "bun test"` and keep suites next to the logic they exercise.
- Script-style tests use `*.test.sh` with stubbed executables on `PATH` and an `assert_eq` / `assert_contains` helper.
- Extensions currently ship with no tests at all. That is the gap this bar closes, not a precedent to follow.
- Squeeze the logic out of the handler where you can: an extension whose decision is a named exported function is testable without a stub at all. The stub is for the handler wiring; a pure helper is for the rule.

</conventions_in_this_marketplace>
