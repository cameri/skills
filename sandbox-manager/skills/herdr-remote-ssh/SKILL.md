---
name: herdr-remote-ssh
description: Sets up and verifies herdr remote access over SSH (`herdr --remote <target>` attaching to a herdr server that runs inside a container or on a remote host), or diagnoses an attach that lands in a fresh empty session instead of the real one. Covers the key-only sshd transport, the sshd `SetEnv` that makes remote herdr commands resolve the same server socket the booted server listens on, and the detached-daemon requirement (the server must be its own session leader) that herdr --remote checks before it will attach without a restart. Use when setting up herdr remote attach on a new machine or container, when `herdr --remote` offers to restart the remote server, when it lands in a brand-new session with no configs, or when remote `herdr session list` shows no/other sessions.
allowed-tools:
  - Bash
  - Read
---

<essential_principles>
Herdr is a background server (`herdr server`) plus terminal clients. The container or host that runs your agents runs one herdr server per named session (env `HERDR_SESSION` selects it; default session name is `default`). The herdr config root is `$XDG_CONFIG_HOME/herdr` (default `~/.config/herdr`), and each session's server listens on a socket under that root.

`herdr --remote <ssh-target>` from your local machine is a thin-client attach: your local herdr runs remote herdr commands over SSH (non-interactive), bridges the remote server socket to a local socket, and runs a local client against it. For that to attach to the *right* server instead of spawning a new one, three things must all be true on the target:

1. **SSH transport exists**: key-only sshd reachable at the target (an `~/.ssh/config` alias on the client), running as the same user that owns the herdr server socket.
2. **SSH env matches the server env**: herdr commands over SSH resolve the same config root and session the running server was started with. sshd does not inherit the server's environment, and shell rc files are not sourced for herdr's non-interactive SSH commands, so the match has to be injected with sshd_config `SetEnv`. Without it, remote `herdr session list` shows no sessions (wrong config root) or the wrong ones (wrong session), and attach misses the real server.
3. **The server is a detached daemon**: the running herdr server process must be its own session leader. `herdr --remote` reads the server's `detached_server_daemon` capability (on Linux: `getsid() == getpid()`) and refuses to attach to a server that lacks it, offering a restart instead. Restarting a server that hosts the whole sandbox can fail (remote stop exits 255), and the fallback then spawns a brand-new empty server and session: the "brand new omp installation with no configs" symptom.

All three were diagnosed from scratch in one session (2026-09-07) against the agent-sandbox container, each as a separate sequential root cause. This skill exists so that setup is a script run plus a check run, not a re-derivation.
</essential_principles>

<objective>
Make `herdr --remote <target>` from a local machine attach to the existing herdr session on the target (with its workspaces, panes, and agent configs) rather than prompting to restart the server or landing in a fresh empty session.
</objective>

<quick_start>
On the target machine (the one running the herdr server you want to attach to):

```bash
# 1. Configure sshd for herdr remote access (key-only, injects the server env).
#    Pass the same config root and session the herdr server runs under.
sudo -u node env HERDR_SSH_XDG_CONFIG_HOME=/home/node/.claude/xdg-config \
  HERDR_SSH_SESSION=omp \
  bash scripts/setup-herdr-sshd.sh

# 2. Verify every requirement; expect all OK.
bash scripts/check-herdr-remote.sh
```

On your local machine (the one you attach from):

```bash
ssh <target> 'echo XDG=$XDG_CONFIG_HOME SESSION=$HERDR_SESSION; herdr session list'
herdr --remote <target>
```

See `<workflow>` for what each step needs and how to read the outputs.
</quick_start>

<requirement_reference>
| # | Requirement | How to meet it | Failure symptom when missing |
|---|---|---|---|
| 1 | Key-only sshd reachable on the target, same user as the herdr socket | `scripts/setup-herdr-sshd.sh`; client `~/.ssh/config` alias | `Permission denied (publickey)`, or connection refused/timeout |
| 2 | SSH sessions carry the server's `XDG_CONFIG_HOME` and `HERDR_SESSION` | `SetEnv` in sshd_config (written by the setup script) | Remote `herdr session list` is empty, or shows the wrong sessions; attach misses the real server |
| 3 | The herdr server process is its own session leader | Launch it with `setsid herdr server &` (or let herdr's own daemon spawn do the `setsid`) | `herdr --remote` offers "restart the remote server now?"; answering yes can fail with `remote server stop failed: exit status: 255`, then you land in a brand-new empty session |
</requirement_reference>

<workflow>
1. **Locate the herdr server's config context.** On the target, find the running server and the env it was started with:
   ```bash
   ps -eo pid,sid,cmd | grep '[h]erdr server'
   # Compare SID and PID: equal means detached (requirement 3 met).
   ```
   If the server was started from a boot script with overrides (for example `XDG_CONFIG_HOME=/home/node/.claude/xdg-config` and `HERDR_SESSION=omp` exported), those exact values are what requirement 2 must inject.

2. **Run the setup script on the target.** It writes an idempotent key-only sshd config (host key generation, `PasswordAuthentication no`, `PidFile`, and `SetEnv` lines for the config context you pass), validates with `sshd -t`, and starts or HUP-reloads sshd only when the config changed. Run it as the user that owns the herdr socket (in a container that is usually the only user, so no `sudo` needed). See `scripts/setup-herdr-sshd.sh` for every env override.

3. **Run the check script on the target.** `scripts/check-herdr-remote.sh` verifies, in order: sshd process alive, port listening, key-only auth, `SetEnv` parity between sshd_config and the running server's actual environment, the server being its own session leader, and the target session reporting `running`. Exit 0 only when every check that ran came back `OK`. A `FAIL` prints the specific fix; do not proceed to attach until the checks are clean.

4. **Add the client alias (once, on the machine you attach from).** For example:
   ```
   Host agent-sandbox
     HostName 100.106.134.5
     Port 2222
     User node
     IdentityFile ~/.ssh/id_ed25519
   ```
   Verify plain SSH first (`ssh <target> 'echo ok'`), then confirm the env parity from the client side:
   ```bash
   ssh agent-sandbox 'echo XDG=$XDG_CONFIG_HOME SESSION=$HERDR_SESSION; herdr session list'
   ```
   Expect the injected values and the real session listed as `running`. If the session is missing, requirement 2 is not met; see the failure table.

5. **Attach.** `herdr --remote agent-sandbox`. A correct setup attaches directly: no restart prompt, and the TUI shows the existing session with its workspaces. If herdr still offers a restart, the reason text tells you which requirement failed (see `<troubleshooting>`); the detach reason means the server is still not a session leader and needs the launch change plus a server restart, not a "yes" to the prompt.

6. **Boot-time durability.** The setup script is idempotent, so a container boot script can call it every start. For a boot-launched herdr server, requirement 3 means the boot must launch it detached: `setsid herdr server &` (a plain `herdr server &` shares the boot session and fails the check). If herdr's own client auto-spawns the server when none is running, that spawn already detaches correctly, so dropping an explicit `herdr server &` line also works.
</workflow>

<troubleshooting>
| Symptom | Cause | Fix |
|---|---|---|
| Remote `herdr session list` shows no sessions at all | SSH env lacks the `XDG_CONFIG_HOME` the server runs under, so remote herdr looks in the default config root | Add `SetEnv XDG_CONFIG_HOME=...` to sshd_config (setup script does this); reload sshd |
| Session list shows `default`/other sessions but not the real one (`omp`) | `HERDR_SESSION` not injected, so remote herdr targets the wrong session | Add `SetEnv HERDR_SESSION=omp`; reload sshd (setup script does this) |
| `herdr --remote` prompts "restart the remote server now?" with "started by a herdr build that may not survive SSH connection loss" | Server process is not its own session leader (`detached_server_daemon` false) | Relaunch the server detached: `setsid herdr server &` (or let herdr's daemon spawn do it); check `ps -o pid,sid` |
| Answering yes gives `remote server stop failed: exit status: 255`, then a brand-new empty session with no configs | The restart's stop flow failed against the server that hosts your whole session, and herdr fell back to spawning a fresh server/session | Do not answer yes. Fix the detached-daemon requirement first, then attach cleanly |
| `Permission denied (publickey)` | Key not in the target's `authorized_keys`, or wrong user/port | Add the client's public key; check the alias's `User`/`Port`/`IdentityFile` |
| Restart prompt with "remote herdr binary was installed or replaced" / "running a different herdr version" | Legitimate: the remote binary changed or versions differ | Answering yes is correct here; herdr stops and restarts the server with the matching binary and restores the saved session shape |
| `herdr --remote` from a non-interactive context cannot approve a stop | Restart prompts need an interactive terminal | Run from a terminal; or fix the detach requirement so no restart is needed |
</troubleshooting>

<success_criteria>
The target-side check script prints `OK` for every check that ran. From the client, `ssh <target> 'herdr session list'` shows the real session as `running`. `herdr --remote <target>` attaches directly (no restart prompt) and shows the existing session's workspaces, panes, and configs, not a fresh install.
</success_criteria>
