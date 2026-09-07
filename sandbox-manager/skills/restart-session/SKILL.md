---
name: restart-session
description: Restarts the current Claude Code session by sending /clear (Claude Code) or /new (omp) followed by Enter to the pane it runs in (tmux or herdr). Fires when a connected channel (e.g. Telegram) sends a message that is exactly /clear or /new (the two are aliases — both reset the session, sending /new to omp panes and /clear to Claude Code panes), asking to restart, reset, or clear the current session.
user-invocable: false
allowed-tools:
  - Bash
  - mcp__plugin_telegram-ng_telegram__reply
---

<essential_principles>
This clears the conversation of whoever is currently talking to this session — irreversible for that context (auto-memory under `~/.claude/projects/*/memory/` persists independently and is unaffected). Only act on a `/clear` or `/new` message from a channel that already trusts the sender via its own access control (e.g. Telegram pairing/allowlist) — this skill does not re-authenticate the sender itself.

The queued reset command only takes effect once this turn ends and the pane reads from its stdin again (omp's `/new` or Claude Code's `/clear`, per the script). That means any tool call issued earlier in this same turn — including a channel reply — still completes normally before the reset happens.
</essential_principles>

<objective>
Restarts this Claude Code session on remote request. The running process shares its pane's stdin (tmux or herdr), so typing "/clear" (Claude Code panes) or "/new" (omp panes) and pressing Enter into that pane resets the interactive session exactly as if the user had typed it themselves at the terminal.
</objective>

<quick_start>
Run the bundled script exactly as written — do not substitute a hand-written `tmux`/`herdr` command, since it validates the target pane before sending keys:

```bash
bash scripts/restart-session.sh
```
</quick_start>

<workflow>
1. Confirm the inbound channel message is `/clear` or `/new` (case-sensitive, no extra text) — anything else is not this skill's trigger. The two are aliases; either runs the same reset.
2. Acknowledge on the originating channel (e.g. a short Telegram reply like "Restarting now.") — this still reaches the user, since the reset only fires after this turn ends.
3. Run `scripts/restart-session.sh`. It auto-discovers the current pane (tmux or herdr), refuses to fire if the pane isn't running Claude Code or omp, then sends `/clear` + Enter for Claude Code panes, or `/new` + Enter for omp panes — omp's TUI has no `/clear` or `/reset` (its slash-command set is /compact, /continue, /exit, /new, /resume, verified against the omp 18.x binary) and swallows unknown `/`-commands without error; `/new` is omp's in-place fresh-session (drops live messages/queued turns/pending tool calls, keeps session id, cwd, model, and on-disk transcript). herdr panes deliver via `herdr agent prompt` (bracketed-paste aware); tmux via `send-keys`.
4. End the turn without further tool calls — anything queued after this point is discarded by the reset anyway.
</workflow>

<success_criteria>
Script exits 0 and prints `Sent /clear to pane <id>` (or `Sent /new to pane <id>` for omp panes). If it exits non-zero (not in tmux or herdr, or pane running something unexpected), report the error on the channel instead of retrying with a modified command.
</success_criteria>
