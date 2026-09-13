---
name: audit-extension
description: Audit an omp/Pi extension module or a plugin that ships extensions, for module-contract correctness, event-handler semantics, in-process hazards, the stub-pi testing bar, and packaging compliance. Use when the user asks to audit, review, or check an extension or a plugin's extensions/ directory.
user-invocable: true
allowed-tools:
  - Read
  - Bash(ls *)
---

<objective>
Invokes the `agent-resources:extension-auditor` subagent to audit the extension at the given path — module contract and declaration, event-handler correctness, runtime hazards, test coverage, packaging, and documentation.
</objective>

<quick_start>
`/agent-resources:audit-extension <path-to-extension-module-or-plugin-directory>`
</quick_start>

<workflow>
1. Resolve the target path from `$ARGUMENTS`. If it is a plugin directory, look for its declared extension entries in `package.json` (`omp.extensions`, else `pi.extensions`) and audit each module plus the plugin's `package.json`. If it is a single module file, audit that module and resolve its plugin's `package.json` for the declaration. If no argument was given, ask the user which extension or plugin to audit — do not guess.
2. Invoke the `agent-resources:extension-auditor` subagent via the `Agent` tool, passing the resolved path(s).
3. Present the subagent's findings verbatim, including file:line locations, severity, and any recommendations — do not summarize away specifics.
</workflow>

<success_criteria>
- Subagent invoked with the correct resolved path(s), including the plugin manifest that declares the module
- Findings presented with file:line locations intact, not paraphrased into vagueness
</success_criteria>
