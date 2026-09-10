---
name: create-blueprint
description: Creates vendor-agnostic capability blueprints — self-contained specification packages (BLUEPRINT.md plus modules, scripts, skeleton, templates) that any LLM with a different architecture can implement for itself, with zero access to the authoring conversation. Also reverse-engineers blueprints from existing implementations and updates blueprints as living specs. Use when the user wants to blueprint a feature or capability, hand off work to another LLM or agent, capture how something is built so it can be rebuilt elsewhere, or update an existing blueprint.
---

<essential_principles>

**A blueprint is a contract, not a conversation.** The receiving LLM has none of
this session's context — no memory of the interview, no tools this session used,
no access to this machine unless the blueprint explicitly packages what it needs.
Every requirement, assumption, parameter, and verification must live inside the
blueprint package itself.

**The ten binding principles.** Each is an acceptance criterion the finished
blueprint must satisfy, not a style preference:

1. **Vendor-agnostic** — plain Markdown and portable shell only. No references to
   any specific agent's tools, skill formats, or harness features. The reader may
   be any LLM in any runtime.
2. **Portable** — no absolute paths, no machine-specific facts baked in. Anything
   environment-specific becomes a named parameter with a discovery method.
3. **Self-contained** — the package carries everything: the spec, module docs,
   reference scripts, starter files. The implementer needs nothing else.
4. **Predictable, intuitive, ergonomic** — the layout is always the same, sections
   appear in the same order, a reader can find any fact without hunting. Follow
   the template exactly.
5. **Idempotent and deterministic** — implementation steps are re-runnable without
   damage; verification steps produce the same result on every run; the spec never
   depends on "do it like last time".
6. **Parameterized and modular** — every environment-specific value is a parameter
   in one table; every separable concern is a module with an explicit contract.
7. **Dependencies called out** — every external dependency (runtime, library,
   service, credential, network path) is declared with its purpose, a discovery
   method, and a fallback or failure behavior.
8. **Applicable context stated** — what the implementer must know about the target
   environment, and explicitly what it must discover locally versus what it may
   assume.
9. **Configuration flexibility** — behavior differences between deployments are
   configuration, never code edits. The blueprint names every configurable knob,
   its type, default, and effect.
10. **Pluggable** — the capability defines clean seams: where it attaches to its
    host, what interfaces it exposes, and how to remove or replace it without
    collateral damage.

**Copy the template, never invent structure.** `templates/BLUEPRINT.template.md`
is the canonical section order. Fill every section; delete a section only when it
genuinely does not apply (never leave stubs like "TBD" or "N/A" prose).

**Write for a stranger.** Address the reader as "the implementer". Assume zero
shared vocabulary beyond universal engineering knowledge. See
`references/llm-agnostic-authoring.md` before writing any blueprint content.

</essential_principles>

<intake>
What would you like to do?

1. Author a new blueprint (interview-driven, from an idea or requirement)
2. Reverse-engineer a blueprint from an existing implementation (code, config, or running service)
3. Update an existing blueprint (living spec)
4. Something else

**Wait for response before proceeding.**
</intake>

<intent_routing>
| Response | Workflow |
|----------|----------|
| 1, "create", "author", "new blueprint", "blueprint X" | `workflows/author-blueprint.md` |
| 2, "reverse-engineer", "from this code/repo/service", "document how X works so it can be rebuilt" | `workflows/reverse-engineer-blueprint.md` |
| 3, "update", "change", "revise blueprint", "add requirement to blueprint" | `workflows/update-blueprint.md` |
| 4, other | Clarify intent, then select |

**After reading the workflow, follow it exactly.**
</intent_routing>

<reference_index>
All domain knowledge in `references/`:

**Principles:** blueprint-principles.md — the ten principles, each with what it
demands of the artifact and how to verify it in the finished blueprint.

**Authoring rules:** llm-agnostic-authoring.md — how to write content an
unknown-architecture LLM can execute: parameter tables, discovery methods,
universal verification, banned constructs.
</reference_index>

<workflows_index>
| Workflow | Purpose |
|----------|---------|
| author-blueprint.md | Interview the user, design the package, emit a new blueprint |
| reverse-engineer-blueprint.md | Study an existing implementation and distill it into a blueprint |
| update-blueprint.md | Apply changes to an existing blueprint as a living spec (version, changelog, supersede rules) |
</workflows_index>
