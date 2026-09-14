---
name: create-agent-extensions
description: Expert guidance for building omp/Pi extensions — the in-process TypeScript modules that bind harness events, register tools and commands, and bridge MCP pushes into a session. Use when creating, writing, building, or reviewing an extension module, when declaring omp.extensions in a plugin's package.json, when a plugin must react to tool calls, session lifecycle, or MCP notifications, or when deciding between an extension, a skill, a hook, and an MCP server.
compatibility: Designed for omp (oh-my-pi), which is the only host that loads extension modules. TypeScript or JavaScript, Bun runtime, and a plugin package.json. Not a Claude Code surface.
metadata:
  author: Ricardo Arturo Cabral Mejía
  purpose: extension-authoring
  version: "1.0"
---

<objective>
This skill provides expert guidance for creating, writing, and reviewing omp/Pi extensions — TS/JS modules that the harness imports into its own process to observe events, intercept tool calls, register tools/commands, and bridge MCP pushes into a session.

It teaches the module contract, the event and registration surfaces, the delivery semantics that decide whether a push wakes a session, the hazards that come from running unsandboxed in-process, the testing bar, and the packaging rules. It is omp-first on purpose: an extension is the Pi/omp way to package harness behaviour, and it deliberately does not promise Claude Code parity.
</objective>

<quick_start>
See `<intake>` below to route to the right work: a new extension module, a specific topic (events, registration, delivery, hazards, testing, packaging), a channel bridge, or an audit.

The shortest correct path to a working extension:

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function myExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.notify(`extension active in ${ctx.cwd}`, "info");
  });

  pi.on("tool_call", (event) => {
    if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf /")) {
      return { block: true, reason: "refused: rm -rf /" };
    }
  });
}
```

Declare it in the plugin's `package.json`:

```json
{ "omp": { "extensions": ["./extensions/my-extension.ts"] } }
```

Then restart the session — `/reload-plugins` does not rebuild extension modules.
</quick_start>

<essential_principles>

<when_an_extension_is_the_right_tool>
An extension is a module the harness imports into its own process. Pick it only when the behaviour needs to run *inside* the session.

| You need | Surface |
|---|---|
| Knowledge or a procedure the model should follow | Skill |
| A capability the model calls as a tool, in any host | MCP server (works in Claude Code and omp) |
| To observe or block what happens in the session, in-process | **Extension** |
| A legacy Claude Code event hook (`PreToolUse`, `Stop`, …) | Claude Code hook — omp does not run these; port to an extension when the plugin must work on omp |
| A prompt the user types | Claude-format command (both hosts) — unless it needs session control (`newSession`, `branch`, `reload`), which only an extension command context exposes |

Choose the extension when the answer to "must this run between the harness and the model?" is yes: blocking a tool call, rewriting a tool result, filtering provider context, reacting to session lifecycle, bridging an MCP push into a turn, or contributing a tool or slash command that needs session control.

**Costs, stated plainly:**

- **omp-only.** Claude Code ignores `omp.extensions`. A plugin can ship skills, commands, agents and `.mcp.json` for Claude Code *and* extension modules for omp, but the module half is inert in Claude Code.
- **Unsandboxed, in-process.** One process, one `EventBus`, one runtime. A throw from a raw timer or a detached promise is a process-level `uncaughtException` and the global postmortem handler treats it as fatal — the whole session dies, not just the extension. Use the managed timers (`ctx.setInterval` / `ctx.setTimeout` / `ctx.clearTimer`).
- **No hot reload.** `/reload-plugins` refreshes skills, slash commands and MCP servers; newly installed or changed extension modules need a session restart.
- **No inbound HTTP.** The harness has no server/port/socket surface for extensions. Any listener is the plugin's own process (an MCP child, or `Bun.serve` in-process) with self-managed lifetime and real port-collision risk.
</when_an_extension_is_the_right_tool>

<module_contract>
1. **A module with a default export factory.** The loader accepts the module itself if it is a function, otherwise `module.default`; it must be a function taking the API object.

   ```ts
   import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

   export default function myExtension(pi: ExtensionAPI): void | Promise<void> {
     // register only — do not act here
   }
   ```

2. **Import the harness type-only.** `import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"` is erased at transpile time, so the module depends on nothing but node/bun and the `pi` object it is handed. That is what makes the module drivable by a local stub in tests — keep the discipline deliberately.

3. **Register during load; act from handlers.** Registration (`pi.on`, `pi.registerTool`, `pi.registerCommand`, …, `pi.registerFileWriteFallback`) is valid while the factory runs. Runtime actions (`pi.sendMessage`, `pi.setActiveTools`, …) throw `ExtensionRuntimeNotInitializedError` during load — do them from events, commands or tools.

4. **Declared, then discovered.** A plugin declares its modules under `package.json` → `"omp": { "extensions": [...] }` (canonical) or `"pi": { "extensions": [...] }` (legacy, still accepted). Discovery roots, in load order: `<cwd>/.omp/extensions`, the active agent directory's `extensions/`, discovered JS/TS hook factories, enabled installed plugins' declared entries, then explicit paths (CLI `-e/--extension`, then the `extensions:` setting). De-duplication is by absolute path, first wins. Details in `references/extension-model.md`.

5. **One plugin may ship both surfaces.** A plugin directory can hold Claude-format content (skills, commands, agents, `.mcp.json`) *and* extension modules. There is no either/or.
</module_contract>

<the_five_questions>
Answer these before writing code. A "no" to question 2 usually means an MCP server, not an extension.

1. **What triggers it?** An event (`tool_call`, `session_start`, `mcp_notification`, …), a registered command, a tool the model calls, a shortcut, a timer, or an MCP push. If it is a timer, it must be a managed one.
2. **Does it need to act in-process?** Blocking, rewriting, context filtering, session control and TUI rendering do. Reading or writing an external system usually does not — an MCP server reaches that from any host.
3. **What must it observe or block?** Name the exact event and the exact return contract (`{ block, reason }`, `{ content }`, `{ messages }`, …). A `tool_call` handler is fail-closed: a throw or a timeout blocks the call.
4. **Does it need to survive having no session?** Factories re-run in subagent and headless sessions in the same process, so process-scoped state (a bound port, a singleton listener) must be singleton-aware. `ctx.hasUI` is `false` when there is no UI — every `ctx.ui` method degrades to a no-op.
5. **Who else loads it?** Subagent sessions inherit the parent's extension set and re-bind it; `flock`-style parallel members run their own profiles and may load it again in a separate process. Anything process-scoped, or anything that must fire exactly once, has to account for that.
</the_five_questions>

</essential_principles>

<intake>
What would you like to do?

1. Create a new extension module
2. Learn a topic (model, events, registration, delivery, hazards, testing, packaging)
3. Build a channel bridge (MCP push → session wake)
4. Audit an existing extension

If the caller's intent is already clear, skip the menu and route directly.
</intake>

<routing>
| Response | Read |
|---|---|
| 1, "create", "new", "build", "extension" | `references/extension-model.md`, then `references/registration-surface.md` and `references/event-surface.md` for the surfaces in play |
| 2, "events", "tool_call", "tool_result", "context" | `references/event-surface.md` |
| 2, "register", "tool", "command", "shortcut", "provider" | `references/registration-surface.md` |
| 2, "wake", "deliver", "sendMessage", "sendUserMessage", "idle" | `references/delivery-and-wake.md` |
| 2, "hazard", "crash", "timer", "settings", "port", "sandbox" | `references/hazards.md` |
| 2, "test", "stub", "bun test" | `references/testing.md` |
| 2, "package", "publish", "marketplace", "version" | `references/packaging.md` |
| 3, "bridge", "channel", "mcp_notification" | `references/patterns/channel-bridge.md` + `references/patterns/channel-bridge.ts` |
| 4, "audit", "review", "check" | Use the `audit-extension` skill instead |

Always read `references/extension-model.md` first — the module contract and discovery rules apply to every extension. Read `references/hazards.md` before shipping anything with a timer, a listener, or process-scoped state.

**Before you finish, answer the five questions in `<essential_principles>` and confirm the testing bar in `references/testing.md` is met.**
</routing>

<reference_index>
| File | Contents |
|---|---|
| `references/extension-model.md` | Module contract, declaration keys, discovery roots and order, load lifetime, first-party vs separate omp-only marketplace |
| `references/event-surface.md` | Every bindable event, its payload, its return contract, and the ordering/conflict rules |
| `references/registration-surface.md` | `registerTool` / `registerCommand` / `registerShortcut` / `registerFlag` / `registerProvider` / renderers / `appendEntry`, and what a command context can do |
| `references/delivery-and-wake.md` | `sendMessage` vs `sendUserMessage`, `deliverAs` semantics, and the rule for waking an idle session |
| `references/patterns/channel-bridge.md` | Why the channel bridge exists, the guards it preserves, and how to adapt it |
| `references/patterns/channel-bridge.ts` | The reusable bridge module: MCP channel notification → `<channel …>` wake, delivered as a `channel:incoming` card message |
| `references/hazards.md` | Failure modes with their mitigations: unmanaged timers, no HTTP ingress, settings access, session multiplication, name collisions |
| `references/testing.md` | The two-tier test pattern, the assertion shape for a blocker, and what cannot be tested in-process |
| `references/packaging.md` | `omp.extensions` declaration, dual-surface installs, marketplace choice, version and docs rules |
</reference_index>

<success_criteria>
A well-built extension meets these standards:

- **Right surface:** the behaviour genuinely needs in-process execution; otherwise it is an MCP server or a skill
- **Contract:** default-export factory, harness imported type-only, registration during load, runtime actions from handlers
- **Declared:** `omp.extensions` in the plugin's `package.json`, entries resolving to real files
- **Safe:** managed timers only; no unguarded background throw; listener lifetime closed on `session_shutdown`; process-scoped state is singleton-aware
- **Waking correctly:** `sendUserMessage` (no options) or `sendMessage(msg, { triggerTurn: true })` for a wake; `deliverAs: "followUp"` never wakes an idle session; a channel plugin sends the typed card form so the sender metadata survives
- **Tested:** a `bun test` suite drives each handler through a stub `pi`; a `tool_call` blocker asserts both arms (blocked and passing)
- **Documented:** the manual-only surface (live turns, MCP delivery, timers, UI) is stated explicitly rather than implied
- **Packaged:** version bumped in both manifests, README/marketplace tables updated in the same commit, plugin cache never hand-edited
</success_criteria>
