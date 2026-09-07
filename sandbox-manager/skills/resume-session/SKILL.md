---
name: resume-session
description: Restores a named Claude Code session by sending /resume <name> followed by Enter to the pane it runs in (tmux or herdr), replacing the currently running conversation. Fires when a connected channel (e.g. Telegram) sends a message like /resume <session-name>.
user-invocable: false
allowed-tools:
  - Bash
  - mcp__plugin_telegram-ng_telegram__reply
---

<essential_principles>
This swaps out the conversation currently running in the pane for a different, previously named session — irreversible for the context being replaced, same class of action as [[restart-session]]'s `/clear` (the outgoing conversation isn't deleted from disk, but this pane stops working on it). Only act on a request from a channel that already trusts the sender via its own access control.

A bare `/resume` with no name opens an interactive picker that expects arrow-key navigation — that can't be driven by a scripted keystroke send (`tmux send-keys` or `herdr pane send-text`/`send-keys`), so this skill always requires a name and refuses to fire without one. If the channel message doesn't include a target session name, ask for one instead of sending a bare `/resume`.

The queued `/resume <name>` only takes effect once this turn ends and Claude Code reads from the pane's stdin again — same timing as [[restart-session]]'s `/clear`. Any tool call issued earlier in this same turn, including a channel reply, still completes normally before the switch happens.
</essential_principles>

<objective>
Switches this Claude Code session over to a different, previously named or saved conversation on remote request.
</objective>

<quick_start>
Run the bundled script with the target session name as a single argument — do not substitute a hand-written `tmux`/`herdr` command, since it validates the target pane and sends the name as literal keystrokes:

```bash
bash scripts/resume-session.sh "<session-name>"
```
</quick_start>

<workflow>
1. Confirm the inbound channel message is `/resume <name>` and extract `<name>` — if no name is present, do not fire this skill; ask the channel which session to resume instead.
2. Acknowledge on the originating channel (e.g. "Resuming '<name>' now.") — this still reaches the user, since the switch only fires after this turn ends.
3. Run `scripts/resume-session.sh "<name>"`. It auto-discovers the current pane (tmux or herdr), refuses to fire if the pane isn't running Claude Code or the omp harness hosting it, then types `/resume <name>` and sends Enter.
4. End the turn without further tool calls — anything queued after this point is discarded once the switch happens anyway.
</workflow>

<success_criteria>
Script exits 0 and prints `Sent /resume <name> to pane <id>`. If it exits non-zero (no name given, not in tmux or herdr, or pane running something unexpected), report the error on the channel instead of retrying with a modified command.
</success_criteria>
