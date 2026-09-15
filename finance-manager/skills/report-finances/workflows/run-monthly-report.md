# Run the monthly report

One run per month, on the 1st, for the month just ended. Follow the steps in
order. **A run that cannot complete a step records the gap and continues** — it
never substitutes a zero, a guess, or last month's figure.

## 0. Say that you have started

Before anything else, write `docs/finance/reports/status.json` per
`references/status-file.md`:

```json
{ "state": "running", "month": "YYYY-MM", "since": "<now, ISO-8601 UTC>",
  "note": "collecting balances and spend" }
```

Then refresh the page that the household reads:

```sh
python3 scripts/render.py index --reports-dir docs/finance/reports
```

Update the same file at each phase boundary — `waiting` (with what you are
waiting for in `note`) if you have to stop for a human, `failed` (with the
reason) if you cannot finish, `done` at the end. **Never leave `running`
standing on a run that has stopped**: a status that says someone is on it when
nobody is, is worse than no status at all. Regenerate the index after each
change; that command alone is enough, and no month's page is re-rendered.

## 1. Refresh the data

- Trigger a bank sync through `actual-budget:query-budget`, then read back the
  month's accounts and transactions. Record the read timestamp for `as_of`.
- Read the account map from `~/.claude/channels/finance-manager/config.json`.
- Read `docs/finance/rich-life-goals.md` (goals and carried action items) and
  `docs/finance/financial-profile.md` (household, phase, philosophy).

## 2. Collect the manual inputs

Balances no API reaches — Questrade, EQ, ShakePay, Ledn, and a home valuation —
live in `docs/finance/manual-balances.json`, keyed by account with a `date` and
a `note`. Read the entries for this month.

**If an account has no entry for this month, do not block and do not zero it:**
carry the last entry forward with `not_updated_since` set to that entry's date,
so the page shows a dated staleness marker. If the file does not exist at all
yet, treat every manual account as not updated and say so in `data_notes` — the
first run is not blocked by a file nobody has filled in. A household asked to type numbers
into a report that fails without them stops producing the report.

## 3. Derive the figures

Apply `references/derivations.md` exactly — it is the part of this workflow that
has been measured against live data, and the naive version of each rule is a
known, recorded error:

- fund flow from **matched transfer pairs** (window ≥21 days) plus
  `transfer_id`-linked rows — never from categories, never from gross deposits;
- uncategorized own-account movement excluded explicitly, with the
  internal-transfers band shown;
- off-budget movement as **net per-account deltas**, split cash / cost-basis /
  liabilities;
- consumption expense with mortgage principal shown separately as debt paydown;
- the net-worth point for this month as **measured**, with any earlier point
  marked `reconstructed` and any unsupportable month left as a gap.

## 4. Write the snapshot, then validate it

Write `docs/finance/reports/YYYY-MM/snapshot.json` per
`references/snapshot-schema.md`, including:

- `inputs_used` — every query and manual entry consumed, so the run can be
  reproduced;
- `data_notes` — every gap with its reason;
- `findings` — the deterministic half of the guidance;
- `narrative.statements` — the judgment half, written by
  `finance-manager:financial-planner`, each with its reasoning and a label;
- `actions` — **at most three**, carried forward rather than dropped.

Then:

```sh
python3 scripts/render.py validate --snapshot docs/finance/reports/YYYY-MM/snapshot.json
```

Validation failure is a stop: fix the snapshot, never the page.

## 5. Render

```sh
python3 scripts/render.py render \
  --snapshot docs/finance/reports/YYYY-MM/snapshot.json \
  --reports-dir docs/finance/reports
```

This writes the month's `index.html` and regenerates the root index. Confirm the
page contains no `http://`, `https://` or `<script` — it must open offline, on a
phone, in ten years.

## 6. Reply

Reply with **one line and the link**: the month, the net-worth headline, and
anything the household must act on. Detail belongs on the page.

## Failure policy

- **Data gap** → publish the page with the gap named in `data_notes` and a
  banner. Never ship partial numbers as though they were complete.
- **Render failure** → report it to the workspace's Telegram contact. Never
  leave last month's page standing as though it were this month's.
- **No report for a month** → it stays a **visible gap** in the index, never a
  silent omission.
- **Model time is rented only for the narrative.** The analysis and the render
  are scripted; if a run needs more than the narrative from a model, something
  is being re-derived that should be in a snapshot.
