# Derivations

Why each figure on the page is computed the way it is. Every rule here exists
because the naive version was measured wrong against live data on 2026-09-15 —
the verification is in `docs/finance/fund-flow-feasibility-2026-09-15.md`.

**The renderer computes nothing.** It draws what the snapshot says. These rules
are what the *run* must apply when it builds the snapshot, and what a reviewer
checks the snapshot against.

## Fund flow

**Never read transfer rows as flow, and never read categories on trust.**

1. **Derive flow from matched transfer pairs** — amount and date matched with a
   window of **at least 21 days**, plus rows linked by `transfer_id`. A ±7-day
   window misses the 2026-05-29 Questrade pair (21-day lag).
2. **Exclude uncategorized own-account movement explicitly.** In 2026-08 the
   naive expense of 27,342.36 was 12,481.46 of real categorized spending plus
   14,860.90 of it. 75,586.41 of 2026 YTD is internal, dominated by a 66,500
   chequing→joint round trip. None of it is spending.
3. **Show an explicit internal-transfers band**, so that movement cannot vanish
   silently. It is a band, not an omission.
4. **Off-budget movement is net per-account deltas** — never gross deposits. The
   naive gross sum for 2026 YTD was 85,940.46 against a real ~15,776.29. Split
   the deltas into **cash** (EQ, Wise), **cost-basis assets** (Bitkey, ShakePay
   BTC) and **liabilities** (Ledn).
5. **Mark manual accounts "not updated since `<date>`"** rather than plotting
   zero. Four accounts stopped moving in mid-2026 — Questrade 2026-06-30,
   ShakePay 2026-07-25, Bitkey 2026-07-17, Wise 2026-07-09 — so 2026-08 shows
   only 1,906.83 of off-budget movement.
6. **Spending paid from off-budget accounts is its own line.** City of Ottawa
   property tax (3,817.38/yr) is paid from an off-budget EQ account: it never
   appears in on-budget expense, while its funding transfers look like savings.

## Net worth

- **Measured forward, reconstructed backwards only where the data supports it.**
  Actual Budget exposes no balance-history read, so a historical point comes
  from the transactions as far back as the backfill reaches.
- **A reconstructed point is drawn differently from a measured one.**
- **A month the data cannot support is a gap, not a guess.** The line breaks; it
  does not interpolate.
- The series is built by reading every `reports/*/snapshot.json`, which is why
  the snapshot is kept beside its page.

## Two distortions shown, not silently corrected

- **Mortgage principal is booked as expense.** About 1,819 of the 3,221.07
  monthly P&I is debt paydown, not consumption. The expense section reports
  **consumption**; principal appears as its own debt-paydown line; and the page
  says so — otherwise the expense total is overstated and any savings rate is
  understated.
- **Property tax paid off-budget** (see flow rule 6).

## Guidance

- **Every statement carries a label: `fact`, `projection` or `advice`.** The
  label, not the tone, tells a reader which is which. Missing label = validation
  failure.
- **Deterministic findings** — the renderer-visible half: over-budget
  categories, idle cash above a stated threshold, subscription drift, unclaimed
  registered room, debt cost. These are reproducible and diffable month to
  month.
- **Narrative** — the judgment half, from `finance-manager:financial-planner`,
  each statement with its reasoning.
- **At most three carried-forward actions**, with owners. Unresolved items are
  carried forward, never silently dropped. More than three is a validation
  error.
- **Rich Life first** (binding, inherited from `review-finances`): never propose
  cutting discretionary fun-money categories to hit a goal. Optimize structural
  things — tax drag, idle cash, subscriptions, debt cost.
- **Phase discipline**: the household is in accumulation. Decumulation concerns
  (withdrawal sustainability, sequence-of-returns risk) are not applied as
  though retirement were near.
- **Limits are stated once**, in the label key and the data-notes block — not
  repeated under every section as a disclaimer wall.

## Data notes

Every gap, with its reason: the backfill gaps (EQ, ShakePay, Visa-Gina, Bitkey
mempool), the stale home-value input, and the Ledn balance that survives a
closed loan (−3,472.12 in Actual though the loan closed 2026-07-26).

A gap is **named**, never hidden and never repaired silently. Repairing
`transfer_id` links is `reconcile-statement` work, not this report's.
