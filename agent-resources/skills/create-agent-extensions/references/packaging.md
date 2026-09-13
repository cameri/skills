# Packaging

How an extension module becomes part of an installable plugin, and the release rules that keep the installed copy and the source in step.

<declaration>

The module ships inside a plugin package and is declared in that package's `package.json`:

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "omp": { "extensions": ["./extensions/my-extension.ts"] }
}
```

- `omp.extensions` is the canonical key. `"pi": { "extensions": [...] }` is the legacy spelling and is still accepted; prefer `omp` for new work.
- Entries are resolved relative to the package directory and may name a file (`./extensions/foo.ts`) or a directory (`./extensions/` → `index.*`, or a one-level scan).
- The whole plugin directory is what gets installed — the extension module, its `.mcp.json`, its skills, its commands and its agents travel together.

**Dual-surface plugin.** A plugin may ship Claude-format content and extension modules at once, and that is usually the right shape when the behaviour belongs next to an existing MCP server or skill set:

```text
my-plugin/
├── .claude-plugin/plugin.json      # Claude Code + omp plugin manifest
├── .mcp.json                       # MCP stdio server (both hosts)
├── skills/…                        # Claude Code + omp
├── commands/…                      # Claude-format commands
├── agents/…                        # Claude Code subagents
└── extensions/omp-channel.ts       # omp-only: declared under package.json#omp.extensions
```

Claude Code ignores `omp.extensions`; omp loads it. The plugin stays one install for both hosts, and only the extension half is host-specific.

**omp-only package.** A general harness capability with no Claude Code counterpart — a context guardrail, a provider shim, a TUI renderer — belongs in a package with no Claude-format surface at all, so a Claude Code user never installs something whose payload is inert to them.

</declaration>

<marketplace_choice>

Two marketplaces are in play in this plugin family:

| Marketplace | Use for |
|---|---|
| `cameri-skills` (this one; catalog at `.claude-plugin/marketplace.json`) | Dual-surface plugins whose extension modules are part of a plugin that also ships skills, commands, agents or an MCP server |
| `pi-extensions` | omp-only plugins, whose entire payload is extension modules (or other omp-only surfaces) |

Put the module where its neighbours live. A channel bridge stays in the channel plugin it belongs to; a standalone harness capability gets its own entry in the omp-only marketplace.

Catalog location matters for a new marketplace: `.omp-plugin/marketplace.json` is the preferred path when omp is the only intended consumer, and `.claude-plugin/marketplace.json` is the Claude Code-compatible path — omp reads it as a fallback, so a dual-surface marketplace publishes there.

</marketplace_choice>

<release_rules>

**Bump the version in both manifests on any change.** Every plugin carries a version in its `package.json` and in `.claude-plugin/plugin.json`; both must be updated with the same value. Patch for fixes, minor for new features, major for breaking changes. The plugin cache is keyed by version — an install at an unchanged version is a no-op, so a fix that does not bump is a fix nobody receives.

**Move the docs in the same commit.** When a change adds, removes, renames or re-scopes a skill, command or surface, update the marketplace README's plugin table and that plugin's skill table, plus the marketplace catalog registration if the plugin is new. Slash-command names in those tables are the skill folder name, not a hand-picked alias.

**Never edit the plugin cache.** The installed copy under the plugin cache is a derived artifact: an edit there is overwritten by the next upgrade, never versioned, and silently diverges from the marketplace. Edit the plugin source in the marketplace repo, bump, commit, push, then redeploy through the plugin CLI. If a deployed version needs a fix, bump again rather than patching the cache.

**Commit and push immediately after a bump.** Uncommitted plugin work is unrecoverable if a rollback is needed.

</release_rules>

<install_and_refresh>

- Installs record in the plugins data root's `installed_plugins.json` plus the runtime lock file, with caches under the plugins cache directory. Plugins can be installed at **user** or **project** scope; an enabled project install shadows an enabled user install of the same plugin.
- Installation **validates every declared extension entry by importing it and initializing it against a throwaway surface**, and rolls the whole install back if one fails. A module that throws on load, or that calls a runtime action during load, fails the install rather than a later session.
- Marketplace installs load extension modules declared by `package.json#omp.extensions` the same way npm-installed and linked plugins do: the cached plugin is symlinked into the scope's `node_modules` tree.
- **Refresh requires a session restart.** `/reload-plugins` refreshes skills, slash commands and MCP servers; newly installed tools, hooks and **extension modules** are picked up at the next session start. Plan a release so this is said out loud — a user who only ran `/reload-plugins` will not see the new module working.
- For development, link the plugin directory rather than reinstalling it each time; the restart requirement still applies.

</install_and_refresh>

<checklist>

Before calling an extension packaged:

- [ ] `package.json` declares the module under `omp.extensions`, and the path resolves to a real file
- [ ] The module default-exports a factory (not a value, not a namespace)
- [ ] If the plugin also targets Claude Code, the Claude-format surfaces are untouched by the extension work
- [ ] The plugin lives in the marketplace its payload belongs to
- [ ] Version bumped identically in `package.json` and `.claude-plugin/plugin.json`
- [ ] README plugin/skill tables and the marketplace catalog updated in the same commit
- [ ] Committed and pushed before anyone installs
- [ ] The plugin cache was not touched
- [ ] The release notes say a session restart is required

</checklist>
