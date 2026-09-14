# Delivery and Wake

How an extension puts a message into a session, and the one rule that decides whether an idle session actually starts a turn.

<two_apis>

| API | What it is |
|---|---|
| `pi.sendMessage(message, { triggerTurn?, deliverAs? })` | injects a **custom message** (needs a `customType`); it renders as a custom entry and does *not* go through prompt flow |
| `pi.sendUserMessage(content, { deliverAs? })` | injects a **user prompt** through prompt flow — the same path a typed message takes |

```ts
pi.sendMessage(
  { customType: "com.example.my-plugin.notice", content: "Build finished.", display: true, details: { ok: true } },
  { triggerTurn: true },
);

pi.sendUserMessage("Build finished — please summarise the failures.");
```

`sendMessage` payloads are normalized before delivery: non-object payloads are coerced to string content under a default custom type, missing `customType` / `attribution` fields are defaulted, and invalid content collapses to an empty string. A custom message becomes part of the session once delivered — use `appendEntry` for state that must never reach the model.

</two_apis>

<deliver_as>

| `deliverAs` | While the session is streaming | While the session is idle |
|---|---|---|
| `"steer"` (default for `sendMessage`; default when `sendUserMessage` omits it mid-run) | interrupts the current run | no turn starts unless `triggerTurn: true` — a bare `sendUserMessage` does start one |
| `"followUp"` | queued to run after the current run | **queued only — an idle session is not woken** |
| `"nextTurn"` | stored, injected on the next user prompt; hidden from the pending-message UI | with `triggerTurn: true`, an idle prompt fires immediately |
| `"aside"` | injected at the next agent step boundary without interrupting the in-flight tool batch | starts a turn regardless of `triggerTurn` (plan mode folds it into context instead) |

`pi.sendUserMessage(content, { deliverAs })` always goes through prompt flow. Omitting `deliverAs` starts a normal prompt when idle, and queues the message as a steer while streaming.

</deliver_as>

<the_wake_rule>

**An MCP notification does not start a turn, and `deliverAs: "followUp"` does not wake an idle session.**

`mcp_notification` is an observation event. Nothing in the harness turns a received notification into a user turn — that is the receiving extension's job, and the mechanism is a **bare `pi.sendUserMessage(wrapped)`** with no options, or `pi.sendMessage(message, { triggerTurn: true })`.

Concretely, the channel bridges shipped in this marketplace end with one of these two calls:

```ts
pi.sendUserMessage(wrapped); // no options: prompts when idle, steers while streaming
pi.sendMessage(card, { triggerTurn: true }); // typed message that also starts a turn
```

Both wake an idle session. They differ in what arrives: the bare prompt lands as ordinary user text, the typed message keeps its sender metadata (`details`) and renders through the host's channel renderer as a card. **Prefer the typed form for a channel plugin** — see `patterns/channel-bridge.md`. The rule the bridges share: *omp only starts a turn for the no-options form, or for a `sendMessage` carrying `triggerTurn: true` — an explicit `deliverAs: "followUp"` merely queues the message and never wakes an idle session.*

Practical consequences:

- Wake paths must not use `followUp`. If the message can arrive while idle — an operator reply, a webhook, a cron fire, a peer dispatch — only the bare call (or `triggerTurn: true`) produces a turn.
- `sendUserMessage` from inside a `tool_call` / `tool_result` handler where the session is mid-run behaves as a steer: it interrupts the current run. That is intentional for an urgent inbound message, but it is not a way to queue work.
- A handler that throws does not prevent other `mcp_notification` subscribers from firing (`omp://extensions.md:325`).
- Content-bearing wakes are the established shape: the message text *is* the prompt. Sending an empty wake to "notify" produces a turn with nothing to act on.

`session_start`, `turn_end` and the rest of the lifecycle events are observations too; any of them can be a place to call `sendUserMessage`, but none of them synthesizes the message for you.

</the_wake_rule>

<example name="wake_from_an_mcp_push">

```ts
interface ChannelParams { content?: unknown }

pi.on("mcp_notification", (event) => {
  if (event.server !== "my-plugin") return;
  if (event.method !== "notifications/claude/channel") return;
  const params = event.params as ChannelParams | undefined;
  if (typeof params?.content !== "string") return;

  pi.sendUserMessage(params.content); // bare call — this is the wake
});
```

For the full version with the channel-marker shape, the subagent guard and the escaping defences, use `references/patterns/channel-bridge.ts`.

</example>

<example name="notify_without_waking">

```ts
// Record an event in the session without starting a turn.
pi.appendEntry("com.example.my-plugin.event", { at: Date.now(), kind: "sync" });

// Show it in the TUI only.
pi.sendMessage(
  { customType: "com.example.my-plugin.event", content: "Sync complete.", display: true },
  { deliverAs: "nextTurn" }, // stored and injected on the next user prompt
);
```

</example>
