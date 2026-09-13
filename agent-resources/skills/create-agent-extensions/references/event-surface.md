# Event Surface

Every event an extension can bind, the payload it receives, the value it may return, and the ordering rules that decide what happens when several handlers disagree.

Handler signature: `pi.on(event, (event, ctx) => result | void | Promise<...>)`. `ctx` is an `ExtensionContext`, created lazily on the first matching handler.

<event_index>

## Session lifecycle

| Event | Payload | Return contract |
|---|---|---|
| `session_start` | fresh or resumed session | none |
| `session_before_switch` | switch in flight | `{ cancel?: boolean }` |
| `session_switch` | `reason` (`new` / `resume` / `fork`), target session file | none |
| `session_before_branch` | branch in flight | `{ cancel?: boolean; skipConversationRestore?: boolean }` |
| `session_branch` | branch complete | none |
| `session_before_compact` | compaction in flight | `{ cancel?: boolean; compaction?: CompactionResult }` |
| `session.compacting` | compaction running | `{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }` |
| `session_compact` | compaction done | none |
| `session_before_tree` | navigation in flight | `{ cancel?: boolean; summary?: { summary: string; details?: unknown } }` |
| `session_tree` | navigation done | none |
| `session_shutdown` | session disposing | none — 2 s budget, dispatched concurrently |

`session_before_switch`, `session_before_branch`, `session_before_compact` and `session_before_tree` are cancelable pre-events: returning `{ cancel: true }` stops the operation. Every `session_before_*` has a matching post event.

## Prompt, turn and context

| Event | Payload | Return contract |
|---|---|---|
| `input` | `{ text, images?, source }` (interactive mode) | `{ handled?: boolean; text?: string; images?: ImageContent[] }` |
| `before_agent_start` | `{ prompt, images?, systemPrompt }` | `{ message?: CustomMessagePayload; systemPrompt?: string[] }` |
| `before_provider_request` | provider request payload | replacement payload |
| `after_provider_response` | response metadata | none |
| `context` | `{ messages }` — a deep copy of what is about to be sent | `{ messages?: AgentMessage[] }` |
| `agent_start` / `agent_end` | `agent_end` carries `{ messages, willContinue? }` | none (notification) |
| `session_stop` | main-session stop | `{ continue?: boolean; additionalContext?: string; decision?: "block"; reason?: string }` |
| `turn_start` / `turn_end` | turn index / timestamp | none |
| `message_start` / `message_update` / `message_end` | message lifecycle; `message_end` gets a detached snapshot | none (notification) |

`input` runs before the built-in first-message auto-title check, so an extension that awaits `pi.setSessionName(...)` from `input` can name the session and suppress the generated title (`omp://extensions.md:176`).

`context` is the event for changing provider context. `message_end` is not: the message it receives is a detached snapshot, so in-place edits do not rewrite anything (`omp://extensions.md:303`).

`session_stop` is the main-session stop hook. It is awaited before the session settles, may continue with `{ continue: true, additionalContext }` or block with `{ decision: "block", reason }`, is capped at 8 consecutive continuations, never fires for subagent sessions, and waits until agent-owned background jobs are idle (`omp://extensions.md:301`).

## Tool lifecycle

| Event | Payload | Return contract |
|---|---|---|
| `tool_call` | `{ toolCallId, toolName, input }` | `{ block?: boolean; reason?: string; input?: Record<string, unknown> }` |
| `tool_result` | `{ toolCallId, toolName, input, content, details, isError }` | `{ content?, details?, isError? }` |
| `tool_execution_start` / `tool_execution_update` / `tool_execution_end` | call id, name, args/partial result/result | none (observability) |
| `tool_approval_requested` / `tool_approval_resolved` | approval metadata | none (observability; emitted by the wrapper only when a tool requires approval and a handler is registered) |

`tool_call` and `tool_result` intercept every tool once the registry is wrapped — built-ins and extension/custom tools alike — including tools registered by other extensions.

## Reliability signals

`auto_compaction_start` / `auto_compaction_end`, `auto_retry_start` / `auto_retry_end`, `retry_fallback_applied` / `retry_fallback_succeeded`, `ttsr_triggered`, `todo_reminder`, `goal_updated`, `credential_disabled`. All notification-only.

## MCP

| Event | Payload | Return contract |
|---|---|---|
| `mcp_notification` | `{ server, method, params }` | none |

Fired for every JSON-RPC notification from a connected MCP server, *after* the manager's own handling of the known list/update methods. Unknown and server-custom methods are delivered too. `server` is the raw name as declared in the MCP config — filter by it, not by the sanitized `mcp__<server>_<tool>` prefix. Multiple extensions may subscribe, and a handler that throws does not stop the others. Notifications arriving before any listener attaches are buffered (bounded FIFO, cap 100, drop-oldest) and drained into the first subscriber.

## User command interception

`user_bash` and `user_python` — fired when the user runs a `!`/`$`-prefixed command; returning `{ result }` overrides execution.

## Inert

`resources_discover` exists in the types and the runner implements `emitResourcesDiscover`, but no `AgentSession` callsite invokes it. An extension cannot actually contribute resources through it (`omp://extensions.md:347-350`).

</event_index>

<ordering_and_conflicts>

**Handlers run in extension order, then in registration order within an extension.** Each is awaited before the next.

**`tool_call` is fail-closed.** A handler that throws, rejects, or exceeds its timeout does not silently consent — the runner synthesizes `{ block: true, reason }` for it and the tool does not run (`packages/coding-agent/src/extensibility/extensions/runner.ts:1470-1509`). The first handler to return `{ block: true }` ends the walk and blocks the call. A non-blocking handler's result is overwritten by the next non-blocking result, so only the last `input` revision survives; handlers do not observe each other's revisions, each sees the original `event.input`.

**`tool_call` input revision is a real rewrite.** `input` replaces the raw execution input the tool runs with, not the normalized `event.input` view. For model-issued calls the event fires at arg-prep time, so the revision is revalidated against the tool schema and becomes what the loop schedules, displays, persists and executes — the user approves what actually runs. It is ignored when `block` is true (`packages/coding-agent/src/extensibility/shared-events.ts:315-331`).

**`tool_result` is middleware, merged field by field.** Handlers run in order and each sees the previous handler's modifications; `content`, `details` and `isError` are merged independently, and a handler that returns nothing leaves the value alone (`runner.ts:1412-1453`).

**`context` replaces, it does not append.** The event carries a deep copy of the messages about to be sent; returning `{ messages }` replaces them. Original session messages are never modified (`packages/coding-agent/src/extensibility/shared-events.ts:171-183`).

**Timeouts differ by event.** Generic handlers get 30 s (`EXTENSION_HANDLER_TIMEOUT_MS`), overridable per event type through settings (e.g. `extensionHandlers.toolCallTimeoutMs`). `session_shutdown` gets a dedicated 2 s budget so a hung handler cannot hold `/exit` hostage. A timeout on `tool_call` is a block; on any other event it is reported through the extension error channel and the walk continues.

**Command names cannot override built-ins.** A registered command colliding with a built-in is skipped with a diagnostic. Reserved shortcuts are ignored (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `ctrl+q`, `alt+m`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`).

</ordering_and_conflicts>

<examples>

<example name="block_a_tool_call_and_rewrite_one">
```ts
pi.on("tool_call", (event) => {
  // Block: fail-closed policy check on an exact command.
  if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf /")) {
    return { block: true, reason: "refused: rm -rf /" };
  }
  // Revise: force a non-interactive pager flag on every git invocation.
  if (event.toolName === "bash" && typeof event.input.command === "string") {
    return { input: { ...event.input, command: event.input.command.replace(/\bgit\b/, "git --no-pager") } };
  }
});
```
</example>

<example name="rewrite_a_tool_result">
```ts
pi.on("tool_result", (event) => {
  if (event.toolName !== "bash") return;
  const text = event.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  if (!text.includes("SECRET_")) return;
  return {
    content: [{ type: "text", text: text.replaceAll(/SECRET_[A-Z0-9]+/g, "[redacted]") }],
  };
});
```
</example>

<example name="drop_messages_from_provider_context">
```ts
pi.on("context", (event) => {
  const kept = event.messages.filter((message) => {
    // Anything the extension itself injected under this custom type goes out of context.
    return !(message.role === "custom" && message.customType === "com.example.my-plugin.notice");
  });
  return kept.length === event.messages.length ? undefined : { messages: kept };
});
```
</example>

<example name="add_a_system_prompt_line_each_turn">
```ts
pi.on("before_agent_start", (event) => ({
  systemPrompt: [...event.systemPrompt, "Never edit files outside the workspace."],
}));
```
</example>

<example name="observe_session_lifecycle">
```ts
pi.on("session_start", (_event, ctx) => ctx.ui.notify("extension attached", "info"));
pi.on("session_switch", (event) => {
  if (event.reason === "resume") process.stderr.write("resumed\n");
});
pi.on("session_shutdown", () => {
  // Close anything you opened; this handler has a 2 s budget.
});
```
</example>

</examples>
