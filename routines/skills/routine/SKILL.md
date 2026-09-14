---
name: routine
description: Schedule recurring or one-time routines. TRIGGER when the user says "schedule X", "remind me every Y", "run X once in Y", "/routines:routine", or "what's scheduled". When a routine fires as a channel notification, execute the task it carries.
user-invocable: true
allowed-tools:
  - Agent
  - Task
  - mcp__plugin_routines_routines__add-job
  - mcp__plugin_routines_routines__list-jobs
  - mcp__plugin_routines_routines__remove-job
  - mcp__plugin_routines_routines__clear-jobs
  - mcp__plugin_routines_routines__get-config
  - mcp__plugin_routines_routines__set-config
  - mcp__routines_routines_add_job
  - mcp__routines_routines_list_jobs
  - mcp__routines_routines_remove_job
  - mcp__routines_routines_clear_jobs
  - mcp__routines_routines_get_config
  - mcp__routines_routines_set_config
---

<objective>
Create, list, and remove scheduled routines using natural language timing expressions. A routine fires a channel notification even when no session is running — when one arrives, execute the task it describes.
</objective>

<quick_start>
```
/routines:routine check email every 1 hour
/routines:routine send daily standup summary every weekday at 9am
/routines:routine remind me to drink water once in 30 minutes
/routines:routine              → list scheduled routines
/routines:routine remove <id>  → cancel a routine
/routines:routine timezone America/Toronto
```
</quick_start>

<argument_parsing>
Parse `$ARGUMENTS` to extract:
- **task**: what to do when the routine fires (everything before the schedule expression)
- **expression**: the schedule timing (the last phrase — "every N units", "once in N units", …)

If `$ARGUMENTS` is empty or contains "list": list scheduled routines.
If `$ARGUMENTS` contains "remove", "cancel", or "delete" with an ID: remove that routine.
If `$ARGUMENTS` is "clear all": clear every routine.
If `$ARGUMENTS` starts with "timezone": call `set-config` with the given IANA name.
</argument_parsing>

<workflow>
**Adding a routine:**

1. Extract task and expression from `$ARGUMENTS`. If either is ambiguous, ask.
2. Write the task **self-contained**: it will be handed to a fresh agent with no memory of this conversation.
3. Call `add-job` with the task and expression.
4. Confirm: "Scheduled **{task}** to run {expression} (ID `{id}`, next run {nextRun}, timezone {timezone})."

**Listing routines:**

Call `list-jobs`. Show a table: ID | Task | Expression | Type | Next Run. If empty, say "No routines scheduled."

**Removing a routine:**

Call `remove-job` with the ID, and confirm.

**Changing the timezone or pausing:**

`get-config` reports both; `set-config` sets them. Say which timezone you set, because raw cron expressions are otherwise ambiguous — `0 9 * * *` means 09:00 in the configured timezone, not UTC.

**Error handling:**

If `add-job` rejects the expression, report the error and offer the supported forms.
If `remove-job` reports an unknown ID, say so and show `list-jobs`.
If any tool reports that the store is unreadable, do not retry and do not clear anything: the file holds every routine on the host and a human has to look at it.

**When a channel notification fires:**

The notification carries the task, plus `job_id`, `type`, `expression`, `fired_at`, and `catch_up="true"` when the fire was caught up after downtime:

```
Routine fired: <task>
```

Hand the task to a **subagent** rather than running it inline — that keeps the interactive session (and whatever pane or channel exchange is live in it) free while the routine runs. Use `task` in omp or `Agent` in Claude Code, with the task text verbatim plus the `job_id` and `fired_at` for context; the subagent starts with no memory of this conversation, so the prompt must stand alone. Do not block on the dispatch; the subagent reports through its own completion. Do not reply to the notification unless the task says to.
</workflow>

<supported_expressions>
| Phrase | Meaning |
|---|---|
| `once in 5 minutes` | Fires once, 5 minutes from now |
| `in 2 hours` | Fires once, 2 hours from now |
| `every minute` / `every 3 minutes` | Recurring interval |
| `every hour` / `every 2 hours` | Top of the hour, or every N hours |
| `every day at 9am` | Daily at 09:00 configured-timezone |
| `every weekday at 3am` | Mon–Fri at 03:00 |
| `every weekend at noon` | Sat+Sun at 12:00 |
| `every monday at 10:30am` | Every Monday at 10:30 |
| `every friday` | Every Friday at midnight |
| `0 9 * * 1-5` | Raw 5-field cron; a 6th leading field adds seconds |

Every expression resolves in the configured timezone (`get-config`), never UTC. If the user names a different timezone, either convert to the configured one and say what you converted to, or set the timezone first with `set-config`.
</supported_expressions>

<success_criteria>
- Routine created and confirmed with its ID and next run time
- List shows every routine with its next fire
- A fired routine is dispatched to a subagent, verbatim and self-contained
- Removal confirmed by ID
- Timezone changes are reported back, since they change what every existing expression means
</success_criteria>
