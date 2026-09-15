# Snapshot schema

`reports/YYYY-MM/snapshot.json` is the artifact. The HTML is a pure function of
it, so this schema is the contract between the run (which collects data) and the
renderer (which ships with `report-finances` and computes nothing).

Every field carrying money is a number in the household's base currency (CAD).
Every figure that came from anywhere other than a live query carries its own
`basis` and `as_of`.

```jsonc
{
  "month": "2026-08",                 // the month the report covers
  "generated_at": "2026-09-01T13:05:00Z",
  "generated_by": "finance flock member",
  "as_of": {                          // one entry per source read
    "actual": "2026-09-01T13:02:11Z",
    "mempool": "2026-09-01T13:04:02Z",
    "manual_entry": "2026-08-31"
  },
  "summary": "One short paragraph, plain language, no jargon.",

  "highlights": [                      // "what changed this month"
    { "text": "…", "label": "fact" }
  ],

  "net_worth": {
    "as_of": "2026-09-01T13:02:11Z",
    "total": 0.0,
    "buckets": [
      {
        "name": "Liquid Cash",         // Liquid Cash | Tax Shelters | Home Equity | Bitcoin | Debt
        "value": 0.0,
        "basis": "measured",           // measured | reconstructed | manual
        "as_of": "2026-09-01T13:02:11Z",
        "note": ""                     // why the basis is what it is, when it is not "measured"
      }
    ]
  },
  "net_worth_prior_year": {            // optional. Omit when the data cannot support it.
    "month": "2025-08",
    "total": 0.0,
    "basis": "reconstructed",
    "note": ""
  },

  "flow": {
    "income":  [ { "name": "…", "amount": 0.0 } ],   // on-budget, by source
    "expense": [ { "name": "…", "amount": 0.0 } ],   // on-budget, by category — consumption only
    "expense_basis": "consumption",                  // states that mortgage principal is excluded
    "debt_paydown": {                                // shown as its own line, never inside expense
      "mortgage_principal": 0.0,
      "other": 0.0,
      "note": "Principal is debt paydown, not consumption."
    },
    "internal_transfers": 0.0,                       // own-account movement, shown as its own band
    "savings": {
      "cash": 0.0,
      "cost_basis_assets": 0.0,
      "liabilities": 0.0
    },
    "off_budget_accounts": [
      {
        "name": "…",
        "delta": 0.0,                                // NET movement, never gross deposits
        "kind": "cash",                              // cash | cost_basis | liability
        "basis": "measured",                         // measured | manual
        "not_updated_since": null                    // an ISO date when the figure is stale
      }
    ],
    "transfer_pairs": { "matched": 0, "linked": 0, "window_days": 21 },
    "off_budget_expense": [                          // spending paid from off-budget accounts
      { "name": "City of Ottawa property tax", "amount": 0.0, "note": "" }
    ]
  },

  "goals": [
    {
      "name": "…",
      "target": 0.0,
      "current": 0.0,
      "target_date": "2028-01-01",
      "on_track": true,
      "note": ""
    }
  ],

  "liquidity": {
    "liquid_cash": 0.0,
    "monthly_consumption": 0.0,
    "runway_months": 0.0,
    "note": ""
  },

  "allocation": [ { "name": "…", "value": 0.0, "percent": 0.0 } ],

  "tax": {
    "room": [ { "name": "TFSA", "used": 0.0, "limit": 0.0 } ],
    "observations": [ { "text": "…", "label": "fact" } ]   // label: fact | projection | advice
  },

  "findings": [                       // the deterministic half of the guidance
    {
      "statement": "…",
      "label": "fact",                // fact | projection | advice
      "check": "idle cash",           // which check produced it
      "impact": "…"                   // what it would change, in money or risk
    }
  ],

  "narrative": {                      // the judgment half, from financial-planner
    "statements": [ { "text": "…", "label": "advice", "reasoning": "…" } ]
  },

  "actions": [                        // renderer shows at most 3, ordered as given
    { "action": "…", "owner": "…", "carried_since": "2026-07", "status": "open" }
  ],

  "data_notes": [                     // never hidden, never silently corrected
    { "note": "…", "reason": "…", "since": "2026-06-30" }
  ],

  "inputs_used": [                    // what the run read, so it can be reproduced
    { "source": "actual-budget:query-budget", "detail": "…", "manual": false }
  ]
}
```

## Rules the renderer enforces

- **A missing section renders as a stated gap**, never as a zero and never as an
  empty box. `net_worth_prior_year` absent means "last year's figure is not
  reconstructable", not "zero last year".
- **`label` is mandatory on every statement** in `highlights`, `findings`,
  `narrative.statements` and `tax.observations`. A statement with an unknown or
  missing label fails validation.
- **`basis` is mandatory on every figure that is not live-read.** A figure whose
  basis is `manual` or `reconstructed` is drawn differently on the page.
- **`actions` longer than 3 is a validation error**, not a truncation: the cap is
  the mechanism that keeps follow-through visible.
- **`not_updated_since` renders as "not updated since <date>"** in place of the
  figure; the figure itself is still shown, marked stale.
- The renderer **never invents a number**. If a field is absent, it says so.

## Validation

`scripts/render.py validate --snapshot <path>` checks the schema, the label
rules and the action cap, and exits non-zero with the offending JSON path. It
runs before rendering, so a malformed snapshot fails loudly instead of producing
a page with holes in it.
