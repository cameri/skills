# Workflow: Author a New Blueprint

<required_reading>
**Read these files NOW before writing anything:**
1. `references/blueprint-principles.md`
2. `references/llm-agnostic-authoring.md`
3. `templates/BLUEPRINT.template.md`
4. `templates/module.template.md`
</required_reading>

<process>

## Step 1: Scope interview

Ask the user, in one round where possible:

- **Outcome**: what should exist after the implementer finishes? What does success
  look like, observably?
- **Host environment**: where does this run (which machine/OS/runtime class)? What
  does the implementer have there — shell, network, package manager?
- **Consumers**: what does the capability talk to (services, files, humans)? What
  are those interfaces, exactly?
- **Constraints**: performance, security, cost, style, forbidden approaches.
- **Configuration surface**: what will differ between deployments? Each answer
  becomes a parameter.
- **Verification**: how will the user check the result after handoff?

If the user's request already answers some of these, infer and confirm the
inferences in a single summary — do not re-ask what was stated.

## Step 2: Design the package

Decide which parts of the package layout the blueprint needs (all blueprints have
`BLUEPRINT.md` and `modules/`; the rest is optional):

```
<blueprints-root>/<blueprint-name>/
├── BLUEPRINT.md          # root living spec (always)
├── modules/<name>.md     # one per separable component with a contract
├── scripts/              # reference implementations the implementer may run/adapt
├── skeleton/             # starter files to copy as-is, then fill
└── templates/            # output structures the capability produces
```

- `modules/` — every concern that has its own contract (inputs, outputs, failure
  behavior) gets a module doc. Don't split what doesn't have a seam.
- `scripts/` — include only when a step is error-prone, non-obvious, or must be
  identical across implementations (setup, verification, data transforms).
- `skeleton/` — include only when there are files the implementer should copy
  verbatim and fill, rather than author from a description.
- `templates/` — include only when the capability itself produces structured
  output worth fixing in shape.

Keep root `<blueprints-root>` portable: default to `docs/blueprints/` under the
current workspace/repo root when it exists (or the user's stated convention),
otherwise `./blueprints/`. Always confirm the destination with the user before
writing.

## Step 3: Emit the blueprint

Copy `templates/BLUEPRINT.template.md` to `BLUEPRINT.md` and fill it section by
section from the interview. For each module, copy `templates/module.template.md`.
Follow `references/llm-agnostic-authoring.md` rules while writing:

- Every environment-specific value → named parameter in the Parameters table.
- Every assumption → stated in Applicable Context as either "discover locally"
  (with a discovery command/method) or "assume" (with the risk if wrong).
- Every implementation phase → ordered, idempotent, with its own verification.
- Every requirement → numbered, testable, mapped to at least one acceptance test.

Never reference this conversation, the authoring session, or any tool this
session used. The blueprint stands alone.

## Step 4: Self-audit (mandatory)

Run the portability lint over every file in the package before declaring done:

- [ ] No absolute paths (`/home/...`, `/Users/...`, `C:\...`) outside the
      Parameters table, where they would appear only as example defaults.
- [ ] No vendor tool names or agent-harness concepts (no "use the X tool", no
      skill frontmatter, no session/channel concepts).
- [ ] No unresolved references to "the interview", "as discussed", "above chat".
- [ ] Every acronym expanded on first use.
- [ ] Every parameter in the code has a row in the Parameters table.
- [ ] Every dependency in the Dependencies table has a discovery method and a
      failure behavior.
- [ ] Every implementation step re-runnable (delete the output, re-run, same
      result) — no steps that append unconditionally or assume prior state.
- [ ] Every requirement number appears in at least one acceptance test, and
      every acceptance test maps back to at least one requirement.
- [ ] All ten binding principles satisfied (walk the checklist in
      `references/blueprint-principles.md`).

Fix all failures before Step 5.

## Step 5: Write, commit, hand off

Write the package to the confirmed destination. If the destination is inside a
version-controlled repo, commit it (message: `blueprint: <name> v0.1.0`). Close
with a short handoff note for the user: where the package is, what to paste or
send to the receiving LLM (the whole directory, or BLUEPRINT.md plus referenced
files), and any prerequisites the receiving side must have before starting.

</process>

<success_criteria>
This workflow is complete when:

- [ ] The package exists at the confirmed destination with the layout agreed in Step 2
- [ ] BLUEPRINT.md follows the template section order with no stub sections
- [ ] The Step 4 audit passes on every file in the package
- [ ] The package is committed (if inside a repo)
- [ ] The user received a handoff note with destination and usage
</success_criteria>
