# The run's status file

`reports/status.json` is how a run says, **on the page**, where it is. It is not
part of a month's snapshot: the snapshot is a month's data, and it stays a pure
input to the renderer. This file is the state of the *job* that produces it.

```jsonc
{
  "state": "running",          // running | waiting | failed | done
  "month": "2026-08",          // the month being worked on
  "since": "2026-09-15T14:16:00Z",
  "note": "collecting balances; two accounts have manual entries outstanding",
  "next_run": "2026-10-01T13:00:00Z"   // optional; the household's own expectation
}
```

## Rules

- **The run writes it at every phase boundary** — at the start (`running`), when
  it has to stop and wait for a human (`waiting`, with what it is waiting for in
  `note`), on failure (`failed`, with the reason), and at the end (`done`).
- **On failure it never leaves `running` standing.** A status that lies about a
  dead run is worse than no status: it says someone is on it when nobody is.
- **`render.py index --reports-dir <dir>` regenerates the index alone**, which is
  all a status change needs — no re-render of any month.
- **A snapshot may not be written for a month whose status is not `done`.** The
  status is what makes an unfinished month visible instead of appearing as a
  month that simply does not exist yet.
- The index shows the state, its timestamp and its note. Two lines of standing
  text explain the honest reading of a stale one: only the run updates this, so a
  timestamp more than a day old means the run did not finish.
- **An unreadable or malformed status file renders as a failure that names
  itself** (`status file is unreadable (… )`) rather than being silently ignored —
  absence and corruption are different facts and the page says which it has.

## Why it exists

The household reads the index to know where things stand. Without this file,
"nothing since July" and "August is being built right now" look exactly the same
on the page.
