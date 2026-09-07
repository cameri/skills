---
name: export-session
description: Exports the current Claude Code conversation to a file by sending /export <path> followed by Enter to the pane it runs in (tmux or herdr). Fires when a connected channel (e.g. Telegram) sends a message like /export <path/to/file>, or /export with no path (defaults to the docs folder, named from a summary of the conversation).
user-invocable: false
allowed-tools:
  - Bash
  - mcp__plugin_telegram-ng_telegram__reply
---

<essential_principles>
Unlike [[restart-session]]'s `/clear` or [[resume-session]]'s `/resume`, `/export` doesn't reset or replace the running conversation — it just writes a copy to disk. Still send it the same way (via `tmux send-keys` or `herdr pane send-text` + `send-keys`, whichever this container uses, into this session's own pane), since it only exists as an interactive REPL command with no CLI equivalent. Only act on a request from a channel that already trusts the sender via its own access control.

`/export` resolves a relative path against the pane's current working directory and appends `.txt` if the path has no extension. When no path is given, default to `docs/<slug>` (relative, not an absolute path) where `<slug>` is a short kebab-case summary of the conversation so far — generate that summary yourself from the conversation content before calling the script; the script itself has no way to know what the conversation was about.
</essential_principles>

<objective>
Exports this Claude Code conversation to a file on remote request, for later reading or analysis.
</objective>

<quick_start>
Run the bundled script with the resolved path as a single argument — do not substitute a hand-written `tmux`/`herdr` command, since it validates the target pane and sends the path as literal keystrokes:

```bash
bash scripts/export-session.sh "<path/to/file>"
```
</quick_start>

<workflow>
1. Confirm the inbound channel message is `/export` (optionally followed by a path), or another clear, explicit request to export the conversation.
2. Resolve the path:
   - If the message included a path, use it as-is.
   - If no path was given, generate a short (3–6 word) kebab-case slug summarizing this conversation so far, and use `docs/<slug>` (no extension needed — `/export` appends `.txt`).
3. Run `scripts/export-session.sh "<resolved-path>"`. It auto-discovers the current pane (tmux or herdr), refuses to fire if the pane isn't running Claude Code or the omp harness hosting it, then types `/export <resolved-path>` and sends Enter.
4. Acknowledge on the originating channel once sent (e.g. "Exporting to docs/<slug>.txt.") — the actual "Conversation exported to: ..." confirmation appears in the pane's own transcript, not the channel, since `/export` only exists inside the interactive REPL.
</workflow>

<success_criteria>
Script exits 0 and prints `Sent /export <path> to pane <id>`. If it exits non-zero (no path given, not in tmux or herdr, or pane running something unexpected), report the error on the channel instead of retrying with a modified command.
</success_criteria>
