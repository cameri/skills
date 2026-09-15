---
name: report-finances
description: Renders the monthly household financial report — one self-contained, phone-readable HTML page per month built from a JSON snapshot, with a fund-flow Sankey, net worth against the same month last year, goal progress, liquidity, allocation, the tax picture, labeled findings and advice, and the data gaps named. Use when the user asks to produce, re-render, or publish the monthly report, asks why a month is missing, or asks what changed financially this month.
---

<objective>
Turns a month's data into a page two people can read on their phones: where the
money went, what the household is worth, whether each goal is on track, and what
should change. The page is **generated, never hand-written** — a deterministic
render from a stored snapshot, so any month can be re-rendered, diffed or
audited later, and a bad render is fixed without re-querying anything.

The analysis is not this skill's: `finance-manager:review-finances` owns the net
worth bucketing, the goal tables and the action-item carryover. This skill is the
presentation, cadence and archive layer above it.
</objective>

<quick_start>
For the monthly run, read `workflows/run-monthly-report.md` and follow it exactly.
For a re-render of an existing month, see "Re-rendering" below — no data
collection is needed, because the page is a pure function of its snapshot.
</quick_start>

<essential_principles>
**The snapshot is the artifact.** Each run writes
`reports/YYYY-MM/snapshot.json` *before* it writes any HTML, and the HTML is a
pure function of it. The schema is
`references/snapshot-schema.md` — treat it as the contract, not a suggestion.

**The renderer computes nothing.** `scripts/render.py` draws what the snapshot
says and states a gap where the snapshot says nothing. It never invents,
interpolates or rounds a number that is not in the snapshot. Every rule about
*how* a figure is derived lives in `references/derivations.md` and belongs to the
run, not the renderer.

**Every statement carries a label: `fact`, `projection` or `advice`.** The
label, not the tone, is what tells a reader which is which — and it is what lets
the computed half stay reproducible while the judgment half is argued with on
its merits. A statement without a label fails validation.

**A gap is named, never hidden and never silently repaired.** Stale accounts are
marked "not updated since `<date>`", not plotted as zero. Missing months are
visible gaps in the index. A run with holes publishes with a data-gap banner
rather than shipping partial numbers as real.

**Rich Life first** (inherited from `review-finances`): never propose cutting
discretionary fun-money categories to hit a goal. Optimize structural things —
tax drag, idle cash, subscriptions, debt cost.

**Phase discipline**: check `docs/finance/financial-profile.md` for the
household's phase. The default is accumulation, where decumulation concerns
(withdrawal sustainability, sequence-of-returns risk) must not be applied as
though retirement were near.
</essential_principles>

<routing>
| Intent | Action |
|---|---|
| Monthly run ("run the report", the scheduled 1st-of-month dispatch) | `workflows/run-monthly-report.md` |
| Re-render a past month, or fix a rendering bug | `scripts/render.py render --snapshot <month>/snapshot.json --reports-dir <reports>` |
| Check a snapshot before rendering it | `scripts/render.py validate --snapshot <path>` |
| "Why is there no report for June?" | Read the index and the month directory; report the gap, do not synthesise one |
</routing>

<reference_index>
- `references/snapshot-schema.md` — the JSON contract, and the validation rules the renderer enforces
- `references/derivations.md` — how each figure must be derived, and why the naive version was measured wrong
</reference_index>

<assets_index>
- `scripts/render.py` — the deterministic renderer (`validate` and `render` modes)
- `scripts/fixtures/snapshot-example.json` — a fully synthetic fixture, for testing the renderer without any real data
</assets_index>

<personal_configuration>
This skill ships with **no personal data** — no account IDs, no balances, no
institution names. Each user provides their own:

- `~/.claude/channels/finance-manager/config.json` — tracked accounts and wallets
- `docs/finance/financial-profile.md` (workspace-local) — household, phase, philosophy
- `docs/finance/rich-life-goals.md` (workspace-local) — goals and carried action items
- `docs/finance/reports/` (workspace-local) — the archive this skill writes into

Nothing in this plugin may assume a channel: it is portable across harnesses.
</personal_configuration>

<dependencies>
- `actual-budget:query-budget` — balances, transactions, category spend
- `finance-manager:query-mempool` — Bitcoin wallet balances from a descriptor/xpub
- `finance-manager:financial-planner` — the advice half of the guidance section
- `python3` (standard library only) — the renderer, with no third-party packages
- A current spot price for non-CAD holdings, looked up at report time and treated
  as an approximation, never as a reconciled figure
</dependencies>

<success_criteria>
- Every number on the page traces to Actual Budget, `config.json`, or a named
  `docs/finance/` file — nothing fabricated, nothing inferred from transfers
- Each month writes `snapshot.json` plus its `index.html`, and the root index is
  regenerated — no month is ever overwritten
- The page opens correctly offline, with no external reference of any kind
- Statements are labeled, stale figures are marked, and gaps are named
- At most three carried-forward actions, with owners
- The limits are stated once, not repeated as a disclaimer under every section
</success_criteria>
