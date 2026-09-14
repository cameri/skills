# routines

Schedule routines in natural language — `every 3 minutes`, `every weekday at 9am`, `once in 5 minutes`. A routine fires a channel notification even when no session is running.

This is the successor to [`cronjobs`](../cronjobs/). It is a new plugin on purpose: the job store, the process model and the lock all change, so `cronjobs` stays installed until the cutover is approved — installing `routines` alongside it does not disturb it.

## Shape: two halves, one store

omp has no persisted scheduler. The only scheduling primitive an extension gets is an in-process timer, which dies with the session and therefore cannot run a nightly job. So `routines` keeps owning a process — an MCP stdio child running croner — and the extension half is only the interface.

| Half | Where it runs | Lifetime |
|---|---|---|
| **Extension interface** (`extensions/omp-channel.ts`, `extensions/settings-mirror.ts`) | Inside each omp session process | Per session — re-loaded by every session, including subagents and flock members |
| **Scheduler** (`server.ts`, an MCP stdio child) | One child per session that loads the plugin | One process per session; only the lease holder actually schedules |
| **Job store** (`~/.claude/channels/routines/jobs.json`) | Host bind mount | Shared by every profile and session on the host; survives container recreates |
| **Config** (`~/.claude/channels/routines/config.json`) | Host bind mount | Shared, same as the store |
| **Lease** (`~/.claude/channels/routines/scheduler.lock`) | Host bind mount | Shared — decides which of the live children schedules |

Because several sessions (the primary plus every flock member profile) can each spawn a child, the children coordinate through the lease: every child serves its tools, exactly one schedules. A child that cannot take the lease does **not** exit — losing the tools is worse than a duplicate fire, which is precisely what the predecessor got wrong.

## Tools

| Tool | Purpose |
|---|---|
| `add-job` | Schedule a routine from a natural-language expression or a raw cron string |
| `list-jobs` | Every routine with its next fire time, the timezone and the pause state |
| `remove-job` | Remove one routine by id |
| `clear-jobs` | Remove every routine |
| `get-config` | Read timezone and paused |
| `set-config` | Set timezone and/or paused |

omp exposes these as `mcp__routines_routines_<name>`; Claude Code as `mcp__plugin_routines_routines__<name>`.

## Schedule expressions

| Expression | Meaning |
|---|---|
| `once in 5 minutes` / `in 2 hours` | One-shot, resolved to an absolute time when scheduled |
| `every minute` / `every 3 minutes` / `every 2 hours` | Recurring interval |
| `every hour` | Top of every hour |
| `every day at 9am` / `daily` | Daily at a time |
| `every weekday at 3am` / `every weekend at noon` | Monday–Friday / Saturday+Sunday |
| `every monday at 10:30am` / `every friday` | A named weekday |
| `0 9 * * 1-5` | Raw 5-field cron; a 6th leading field is supported (seconds) |

**All times resolve in the configured timezone, never UTC.** `cronjobs`' README claimed UTC while the process resolved local time — the reverse of what a job author writing `0 3 * * *` would expect. Change it with `set-config {"timezone": "America/Toronto"}`.

## Configuration

`~/.claude/channels/routines/config.json` is the runtime source of truth:

```json
{ "timezone": "America/Toronto", "paused": false }
```

| `timezone` | IANA name. Applies to every expression and to raw cron. Invalid values are rejected, not stored. |
| `paused` | Suspends firing and keeps the jobs. Resuming does **not** replay what was missed while paused — pause is for "not now", not for "catch up later". |

Three ways to change it, in order of preference:

1. `set-config` — works in both hosts, no restart.
2. `omp plugin config set routines@cameri-skills timezone=Europe/Berlin` — writes the plugin settings store.
3. Edit the file — both halves re-read it (the scheduler on every reconcile tick, so no restart).

`omp.settings` (declared in `package.json`) renders in **/settings → Plugins** and is scriptable, but it is the **display layer**. omp has no supported runtime accessor for it and the MCP child cannot reach the host package at all, so the extension mirrors the values into `config.json` on session start. The mirror writes only the keys that are actually set — profiles share one config file, and a profile that has never had its settings edited must not overwrite another's value with a default. If the two disagree, `config.json` wins.

## Missed fires

On boot (or when taking over the lease), a fire that was due inside a **30-minute grace window** runs immediately with `catch_up="true"` in its notification. Anything older is logged and dropped, and a spent one-shot is pruned from the store.

`cronjobs` did neither: a fire missed while the host was down never happened at all, and a past-due `once` job was skipped forever while never being pruned — so the store accumulated dead one-shots that still showed up in `list-jobs`.

## State, backup and restore

| File | Contents |
|---|---|
| `jobs.json` | `{"version": 1, "jobs": [...]}` — every routine on the host |
| `config.json` | timezone + paused |
| `scheduler.lock` | the lease (`pid`, process start time, heartbeat) — ephemeral, never back up or restore it |

Host paths under `containers/agent-sandbox/.claude/channels/routines/`. Restoring `jobs.json` + `config.json` is enough; the schedules re-arm at the next boot, and `nextRun` is recomputed rather than trusted. A restore is **not** a working restore on its own: task text references things outside the file — flock members, skills, credential and state files — so those travel with it.

## Fixed, not ported

| `cronjobs` behaviour | Here |
|---|---|
| `writeFileSync` of the whole store — a crash mid-write truncated every job | Temp file in the same directory → `fsync` → `rename` → directory `fsync` (`lib/atomic.ts`) |
| `loadJobs()` returned `[]` on any parse error, so the next write destroyed the file | A truncated or malformed store raises `StoreCorruptError`; every tool surfaces it with the path and refuses to mutate, leaving the file for a human |
| A fixed `/tmp` pid lock: a second instance `exit(1)`, so an orphaned child left every later session without its tools | A state-dir lease with a heartbeat and stale/dead-holder recovery; a follower serves every tool and only loses scheduling (`lib/lock.ts`) |
| A past-due `once` job skipped forever, never pruned | Fired if inside the grace window, otherwise pruned and logged |
| No `stdin`-EOF handler, so a killed session could orphan the child | Shutdown on stdin end/close, SIGTERM and SIGINT; the lease is released on the way out |
| Timezone only from the `TZ` env var, changeable by a container recreate | `config.json`, live-re-read |

## Migration

On first boot, if `jobs.json` does not exist yet and the old `cronjobs` store does, its jobs are copied over **with their ids preserved** (documents and `CLAUDE.md` reference them) and the legacy file is left exactly as found. After that the new store is authoritative and the migration is inert.

## Testing

```sh
bun test        # 66 tests, no network, no host package needed
```

Covered: the store's atomic write (including the crash window between temp write and rename), corruption surfacing, migration; the lease (two servers, dead holder, stale heartbeat, pid reuse, corrupt lease); the grace window and engine arming (catch-up fires once, one-shots pruned, pause/resume); the full tool surface; the wake bridge (wrapping, subagent guard, attribute and close-tag escaping); the settings mirror and status command.

**Manual-only, not covered by the suite** — these are host behaviours, so verify them in a real session: that an MCP notification actually wakes a session and renders as an inbound-channel card; that `/settings` renders the two settings and `getPluginSettings` resolves in a compiled session (the mirror degrades to a logged no-op if the deep import fails, and the plugin works off `config.json` regardless); whether `/routines-status` renders in each UI mode; and real wall-clock firing of a long-running schedule.

## Install

```
/plugin install routines@cameri-skills
/reload-plugins
```

Then start the session with the channel flag:

```sh
claude --dangerously-load-development-channels plugin:routines@cameri-skills
```

A restart is required for the extension modules — `/reload-plugins` refreshes skills and MCP servers but not extension code.

## License

MIT
