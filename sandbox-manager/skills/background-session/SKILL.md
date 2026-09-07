---
name: background-session
description: Sends the current work to a background agent so the interactive pane is free for something else, by sending /background followed by Enter to the pane it runs in (tmux or herdr). Fires when a connected channel (e.g. Telegram) sends a message that is exactly /background, or explicitly asks to free up the terminal while current work keeps going.
user-invocable: false
allowed-tools:
  - Bash
  - mcp__plugin_telegram-ng_telegram__reply
---

<essential_principles>
`/background` hands the current in-progress work off to a background agent that keeps running it, freeing the interactive pane for something else — it does not suspend or detach anything at the process/terminal level (no Ctrl-Z, no `tmux detach-client`, no `fg`/`bg`). Only act on a request from a channel that already trusts the sender via its own access control.

The queued `/background` only takes effect once this turn ends and Claude Code reads from the pane's stdin again — same timing as [[restart-session]]'s `/clear`. Any tool call issued earlier in this same turn, including a channel reply, still completes normally before it happens.
</essential_principles>

<objective>
Frees this Claude Code session's interactive pane on remote request by continuing the current work as a background agent instead.
</objective>

<quick_start>
Run the bundled script exactly as written — do not substitute a hand-written `tmux`/`herdr` command, since it validates the target pane before sending keys:

```bash
bash scripts/background-session.sh
```
</quick_start>

<workflow>
1. Confirm the inbound channel message is `/background` (case-sensitive, no extra text), or another clear, explicit request to free up the terminal while current work continues — anything else is not this skill's trigger.
2. Acknowledge on the originating channel (e.g. "Backgrounding this now.") — this still reaches the user, since the switch only fires after this turn ends.
3. Run `scripts/background-session.sh`. It auto-discovers the current pane (tmux or herdr), refuses to fire if the pane isn't running Claude Code or the omp harness hosting it, then sends `/background` + Enter.
4. End the turn without further tool calls — anything queued after this point is discarded once the switch happens anyway.
</workflow>

<success_criteria>
Script exits 0 and prints `Sent /background to pane <id>`. If it exits non-zero (not in tmux or herdr, or pane running something unexpected), report the error on the channel instead of retrying with a modified command.
</success_criteria>
