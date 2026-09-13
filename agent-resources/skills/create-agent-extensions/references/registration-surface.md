# Registration Surface

Everything an extension contributes at load time, and what a command handler's context can do at run time.

<register_tool>

```ts
const z = pi.zod;

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What the tool does, in the model's terms",
  parameters: z.object({ path: z.string() }),
  hidden: false,          // hide from the tool list
  defaultInactive: false, // register but start disabled (activate with setActiveTools)
  deferrable: false,      // may be deferred out of the initial tool set
  loadMode: "discoverable", // or "essential" to always load
  approval: "read",       // "read" | "write" | "exec"
  strict: false,
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
    onUpdate?.({ content: [{ type: "text", text: "Working..." }] });
    return { content: [{ type: "text", text: `read ${params.path}` }], details: {} };
  },
  onSession(event, ctx) {
    // reason: start | switch | branch | tree | shutdown
  },
  renderCall(args, options, theme) { /* optional TUI render */ },
  renderResult(result, options, theme, args) { /* optional TUI render */ },
});
```

`parameters` accepts omptype schemas; `pi.zod`, `pi.arktype` and the legacy `pi.typebox` shim all build them. `mcpServerName` / `mcpToolName` attach provenance to a tool that proxies an MCP tool, and `shellEnv` supplies environment for a tool that shells out.

**Delegating to the built-in you shadowed.** When your tool re-registers an existing built-in name (e.g. wrapping `write` with a policy check), the `ctx` passed to `execute` carries `ctx.invokeTool(params, options?)`. It runs the *native* built-in of the same name — delegation is same-tool only, so it cannot reach an arbitrary target or escalate past the approval already granted for this call — and returns its result including the native side effects and bookkeeping. `ctx.invokeTool` is `undefined` for a net-new tool that shadows nothing. Recursion is depth-guarded.

A tool can also start inactive and be switched on per session: `pi.setActiveTools(names)` (async) with `pi.getActiveTools()` / `pi.getAllTools()`.

</register_tool>

<register_command>

```ts
pi.registerCommand("my-command", {
  description: "Shown in the command list",
  getArgumentCompletions: (prefix) => [{ value: "alpha", label: "alpha" }].filter((i) => i.value.startsWith(prefix)),
  handler: async (args, ctx) => {
    await ctx.waitForIdle();
    ctx.ui.notify(`args=${args}`, "info");
  },
});
```

The handler receives an `ExtensionCommandContext` — an `ExtensionContext` plus session control. Those session-control methods are deliberately absent from plain event handlers: they are only safe in a user-initiated command (`packages/coding-agent/src/extensibility/extensions/types.ts:542-577`).

| Method | Effect |
|---|---|
| `waitForIdle()` | wait for the agent to finish streaming |
| `newSession({ parentSession?, setup? })` | fresh session, optionally seeded by a setup callback → `{ cancelled }` |
| `branch(entryId)` | fork from a history entry into a new session file → `{ cancelled }` |
| `navigateTree(targetId, { summarize? })` | jump to another point in the session tree → `{ cancelled }` |
| `switchSession(sessionPath)` | switch to an existing session file → `{ cancelled }` |
| `reload()` | re-read the current session file and re-emit `session_switch` — **terminal for the current handler frame** |
| `compact(instructionsOrOptions?)` | compact context |

Session naming and model selection are available on both contexts:

| Method | Effect |
|---|---|
| `pi.getSessionName()` / `await pi.setSessionName(name)` | read / persist the session name to the session file |
| `await pi.setModel(model)` | switch the session model (returns whether it took) |
| `pi.getThinkingLevel()` / `pi.setThinkingLevel(level)` | read / set reasoning effort |
| `pi.getServiceTiers()` / `pi.setServiceTier(family, tier \| undefined)` | read the per-family service-tier map / override one family (`undefined` clears it) |

Model selection through `ctx.models` is the read side: `list()` for authenticated models, `current()` for the live session model, `resolve(spec)` for a model string or role alias (`@slow`), and `family(model)` for a "same family?" comparison. Compare family tokens; do not persist them.

</register_command>

<register_shortcut_flag_provider>

```ts
pi.registerShortcut("ctrl+shift+g", {
  description: "Show the guardrail status",
  handler: (ctx) => ctx.ui.notify(`cwd=${ctx.cwd}`, "info"),
});

pi.registerFlag("guardrail-mode", { description: "Guardrail strictness", type: "string", default: "warn" });
const mode = pi.getFlag("guardrail-mode"); // read it from anywhere after load

pi.registerProvider("my-provider", {
  baseUrl: "https://api.example.com/v1",
  api: "openai-completions",
  usage: { id: "my-provider", async fetchUsage(params, { fetch }) { /* → UsageReport | null */ } },
});
pi.unregisterProvider("my-provider"); // removes only this runtime override
```

- Shortcut handlers take `(ctx)` and run against the plain `ExtensionContext`. Reserved shortcuts are ignored.
- A registered provider can also supply `fetchDynamicModels` for runtime model discovery; those fetches are hard-bounded to a 15 s timeout so a hung endpoint cannot stall discovery.
- A provider registration overrides a built-in provider of the same name for as long as the extension registration is active; `unregisterProvider` restores the built-in or configured resolver.

</register_shortcut_flag_provider>

<renderers_and_entries>

| Call | Purpose |
|---|---|
| `pi.registerMessageRenderer(customType, (message, options, theme) => Component \| undefined)` | TUI rendering for messages the extension injected under that `customType` |
| `pi.registerAssistantThinkingRenderer((context, theme) => Component \| undefined)` | display-only UI appended below each visible thinking block; must not mutate messages |
| `pi.registerComposerShape({ label, description, style })` | an extension-owned input-editor layout (built-in ids cannot be replaced) |
| `pi.registerFileWriteFallback(handler)` / `pi.registerFileDeleteFallback(handler)` | broker a write or delete the sandbox denied (`EPERM`/`EACCES`/`EROFS`); first `true` wins, a throwing handler is skipped |
| `pi.setLabel(text)` | display label for the extension's entries |
| `pi.appendEntry(customType, data)` | append a custom session entry for durable state — **not sent to the model** |
| `pi.exec(command, args, opts)` | run a subprocess from extension code → `ExecResult` |
| `pi.events` | the shared `EventBus` for extension-to-extension signals |

Write and delete fallbacks are registered during load and installed at runner init: a later registration never takes effect. Both registries are process-wide, so a handler may be consulted for a mutation issued by *any* session in the process — compare `req.sessionId` with `ctx.sessionManager.getSessionId()` before prompting (`omp://extensions.md:531-548`).

`registerTool`'s `renderCall` / `renderResult` are the tool-specific rendering path; `registerMessageRenderer` is for custom messages.

</renderers_and_entries>

<ui>

`ctx.ui` is the interactive surface: dialogs (`select`, `confirm`, `input`, `editor`), `custom`, `notify`, `setStatus`, `setWidget(key, content, { placement })`, `setWorkingMessage`, `setTitle`, editor access (`setEditorText`, `getEditorText`, `pasteToEditor`), autocomplete stacking, terminal input, themes, and `get/setToolsExpanded`.

Support is per-mode, and an extension must not assume the TUI:

- Interactive: all of the above except `setFooter` / `setHeader`, which are no-ops.
- RPC: dialogs round-trip; `custom`, `onTerminalInput`, `setFooter`/`setHeader`, `setEditorComponent`, `addAutocompleteProvider`, `setWorkingMessage`, theme switching and tool-expansion controls are inert.
- Print / headless / subagent with no UI context: `ctx.hasUI` is `false` and every method is a no-op.
- ACP: dialogs round-trip as elicitations; widgets, theming, terminal input and autocomplete are stubbed.

Guard terminal-only UI with `ctx.mode === "tui"` or `ctx.hasUI`.

</ui>

<example name="command_with_session_control_and_a_tool">

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function inspects(pi: ExtensionAPI): void {
  const z = pi.zod;

  pi.registerTool({
    name: "inspect_workspace",
    label: "Inspect Workspace",
    description: "Report the workspace root and the active session name",
    parameters: z.object({}),
    approval: "read",
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const name = pi.getSessionName() ?? "(unnamed)";
      return {
        content: [{ type: "text", text: `${ctx.cwd} — session ${name}` }],
        details: { cwd: ctx.cwd },
      };
    },
  });

  pi.registerCommand("start-fresh", {
    description: "Compact, then start a new named session",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      await pi.setSessionName("handoff");
      await ctx.newSession({});
    },
  });
}
```
</example>
