---
name: compact-session
description: Compacts the current Claude Code session's conversation by sending /compact (optionally with retention instructions) followed by Enter to the pane it runs in (tmux or herdr). Fires when a connected channel (e.g. Telegram) sends a message that is exactly /compact, or when routed here by an idle-detection flow after the user says they want to keep going rather than stop for now.
user-invocable: false
allowed-tools:
  - Bash
  - mcp__plugin_telegram-ng_telegram__reply
---

<essential_principles>
This summarizes and shrinks the conversation history in place — unlike [[restart-session]], it does not discard context, so it's the lighter-touch option for a session that should keep going. Only act on a `/compact` message (or an idle-detection callback answer) from a channel that already trusts the sender via its own access control (e.g. Telegram pairing/allowlist) — this skill does not re-authenticate the sender itself.

This skill is typically not invoked by a literal `/compact` slash-command message from a human. It is one of two actions an idle-detection feature routes to: after 45 minutes of pane inactivity, a Telegram bot asks the user "still going or done for now?" — an answer meaning "still going" routes here (compact and continue), while "done for now" routes to [[restart-session]] plus [[rename-session]] instead (clear and label). Treat a callback-style trigger from that flow the same as a direct `/compact` message.

Like `/clear` in [[restart-session]], the queued `/compact` only takes effect once this turn ends and Claude Code reads from the pane's stdin again — any tool call issued earlier in this same turn, including a channel reply, still completes normally first.
</essential_principles>

<objective>
Compacts this Claude Code session's conversation on remote request (or idle-detection routing), optionally steering what to retain. The running process shares its pane's stdin (tmux or herdr), so typing "/compact [instructions]" and pressing Enter into that pane triggers compaction exactly as if the user had typed it themselves at the terminal.
</objective>

<quick_start>
Run the bundled script exactly as written — do not substitute a hand-written `tmux`/`herdr` command, since it validates the target pane before sending keys. It takes zero or one argument: an optional retention-instructions string.

```bash
bash scripts/compact-session.sh
bash scripts/compact-session.sh "keep the API design decisions"
```
</quick_start>

<workflow>
1. Confirm the trigger is `/compact` (optionally followed by retention instructions), or an idle-detection callback answer meaning "still going" — anything else is not this skill's trigger.
2. Acknowledge on the originating channel (e.g. a short Telegram reply like "Compacting now.") — this still reaches the user, since compaction only fires after this turn ends.
3. Run `scripts/compact-session.sh` with no argument for a bare `/compact`, or with the retention-instructions text as a single argument. It auto-discovers the current pane (tmux or herdr), refuses to fire if the pane isn't running Claude Code or the omp harness hosting it, then sends `/compact` (with the instructions appended, if given) plus Enter.
4. End the turn without further tool calls — anything queued after this point runs after compaction completes anyway.
</workflow>

<success_criteria>
Script exits 0 and prints `Sent /compact ... to pane <id>`. If it exits non-zero (not in tmux or herdr, or pane running something unexpected), report the error on the channel instead of retrying with a modified command.
</success_criteria>
