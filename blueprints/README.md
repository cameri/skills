# blueprints

Creates **capability blueprints** — self-contained, vendor-agnostic
specification packages that any LLM, with any architecture, can implement for
itself. A blueprint carries everything the receiving LLM needs: the spec
(`BLUEPRINT.md`), per-component contracts (`modules/`), runnable reference
implementations (`scripts/`), starter files (`skeleton/`), and output shapes
(`templates/`). No access to the authoring conversation is required.

Blueprints are **living specs**: versioned, changelogged, with requirements
and parameters superseded (never deleted) so implementations built against
older revisions stay traceable.

## Skills

| Skill | Description |
|---|---|
| `blueprints:create-blueprint` | Author a new blueprint (interview-driven), reverse-engineer one from an existing implementation, or update an existing blueprint as a living spec |

## Blueprint package layout

```
<blueprints-root>/<blueprint-name>/
├── BLUEPRINT.md          # root living spec (always present)
├── modules/<name>.md     # one per separable component with a contract
├── scripts/              # portable reference implementations
├── skeleton/             # starter files to copy verbatim and fill
└── templates/            # output structures the capability produces
```

Default `<blueprints-root>` is `docs/blueprints/` under the workspace/repo
root where that convention exists; otherwise `./blueprints/`. Always
confirmable per invocation.

## The ten binding principles

Every blueprint is audited against: vendor-agnostic, portable, self-contained,
predictable/intuitive/ergonomic, idempotent and deterministic, parameterized
and modular, dependencies called out, applicable context stated,
configuration flexibility, and pluggable. See
`skills/create-blueprint/references/blueprint-principles.md`.

## Install

```bash
claude plugin marketplace update cameri-skills
claude plugin install blueprints@cameri-skills
```
