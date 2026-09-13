# The Extension Model

How a module becomes an extension: what it must export, where the harness looks for it, when it runs, and how long it lives.

<module_contract>

An extension is a TypeScript or JavaScript module whose default export is a factory. The loader (`packages/coding-agent/src/extensibility/extensions/loader.ts`) selects the factory with `getExtensionFactory(module)` — the module itself when it is a function, otherwise `module.default` — and requires it to be a function matching:

```ts
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;
```

The factory may be synchronous or return a promise; loading awaits it before moving to the next path. A module whose export is not a function fails that path with a structured error, and loading continues with the rest.

Minimal, complete module:

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function guardrail(pi: ExtensionAPI): void {
  pi.on("tool_call", (event) => {
    if (event.toolName === "bash" && String(event.input.command ?? "").startsWith("curl ")) {
      return { block: true, reason: "network access is not enabled in this workspace" };
    }
  });
}
```

**Import the harness type-only.** Every extension shipped in this marketplace writes `import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"`. Type-only imports are erased at transpile time, so at runtime the module depends on nothing but node/bun and the `pi` object handed to its factory. That is what lets a test drive the module with a plain local stub and no install (`references/testing.md`). Preserve the discipline deliberately — the one variation that exists is a runtime namespace import plus a typed `ExtensionAPI` import in the same file, used only to read a wire constant with a literal fallback; treat that as the exception, not the pattern.

**Registration during load, action from handlers.** While the factory runs, the API is in registration mode: `pi.on(...)`, `pi.registerTool(...)`, `pi.registerCommand(...)`, `pi.registerShortcut(...)`, `pi.registerFlag(...)`, `pi.registerProvider(...)`, `pi.registerMessageRenderer(...)`, `pi.registerFileWriteFallback(...)`, `pi.registerFileDeleteFallback(...)`, `pi.setLabel(...)`. Calling a runtime action such as `pi.sendMessage()` during load throws `ExtensionRuntimeNotInitializedError` (`packages/coding-agent/src/extensibility/extensions/loader.ts`; `omp://extensions.md:62-65`). Perform runtime behaviour from events, commands or tools.

File-write and file-delete fallback handlers have a hard version of this rule: they are installed when `ExtensionRunner.initialize` runs, so a handler registered *after* load never takes effect (`omp://extensions.md:531-537`).

</module_contract>

<declaration>

A plugin declares its extension modules in its own `package.json`:

```json
{
  "name": "my-plugin",
  "omp": { "extensions": ["./extensions/my-extension.ts"] }
}
```

- `omp.extensions` is the canonical key. The legacy `"pi": { "extensions": [...] }` is still accepted (`omp://extension-loading.md:55, 296-304`; `omp://extensions.md:101-121`). Manifest resolution reads `package.json.omp` first, then `package.json.pi`, then a bare `{ version }`.
- Entries may name a file (`.ts`, `.js`, `.mjs`, `.cjs`) or a directory. A directory resolves `index.ts`, `index.js`, `index.mjs`, `index.cjs` in that order (`omp://extension-loading.md:57`). A directory entry resolving a `package.json` with its own extension list is resolved relative to that package directory, one level deep (`omp://extension-loading.md:171-189`).
- Declared entries are resolved relative to the plugin package directory and are included only when the file exists and is readable.

The declared path is what makes the module part of the plugin. A module dropped into `extensions/` but not declared is loaded only if some other discovery root happens to reach it.

</declaration>

<discovery>

Discovery builds one ordered list, then loads it. Order (`omp://extension-loading.md:198-220`):

1. **Native auto-discovery** — `<cwd>/.omp/extensions`, then the active agent directory's `extensions/` (default `~/.omp/agent/extensions`; under `omp --profile <name>` it is `~/.omp/profiles/<name>/agent/extensions`, and `PI_CODING_AGENT_DIR` can relocate it). Native legacy JSON lists (`<cwd>/.omp/settings.json#extensions`, the agent directory's `settings.json#extensions`) are part of this step. The project root is cwd-only — the walk does not climb ancestors.
2. **Discovered JS/TS hook factories** — any hook whose entry path is a `.ts`/`.js` file.
3. **Installed plugin entries** — from enabled installed plugins, via `getAllPluginExtensionPaths(cwd)`, covering `omp.extensions` / `pi.extensions` and enabled feature entries.
4. **Explicitly configured paths**, in order: CLI `--extension/-e` (and `--hook`), then the merged settings `extensions:` array.

De-duplication is by resolved absolute path, first wins — a module that is both auto-discovered and explicitly configured loads once, at the autodiscovered position.

Controls:

- `--no-extensions` (CLI) and `disableExtensionDiscovery` (SDK) skip ambient discovery but still honour explicit paths (`omp://extension-loading.md:95-116`).
- `disabledExtensions` filters by id. An extension module's id is `extension-module:<derivedName>`, where `derivedName` is the filename stem (`/x/foo.ts` → `foo`, `/x/bar/index.ts` → `bar`) (`omp://extension-loading.md:118-134`).

Do not rely on automatic scanning of a native root as your delivery mechanism: a marketplace plugin is delivered by its `package.json` declaration, so declaration is the only route that survives installation, caching and version bumps.

</discovery>

<load_and_lifetime>

- **One factory run per session.** The harness imports the module once and runs the factory against a per-session API object.
- **Survives in-process session changes.** `/new`, `/resume`, `/reload` and the equivalent command-context calls preserve listeners; they do not dispose the extension (`omp://extensions.md:186-241`; `packages/coding-agent/src/session/agent-session.ts`).
- **Ends at shutdown.** `session_shutdown` is emitted from session dispose; managed timers are cleared and the extension's registrations are removed.
- **Process exit ends everything.** Timers are in-process and `unref`'d; nothing survives a restart, and no scheduler exists to re-arm anything.
- **Factories also run in subagent and headless sessions** in the same process. Guard anything that must happen once, or must not happen in a subagent, with `ctx.hasUI` or the `yield` tool check (`references/hazards.md`).
- **No hot reload.** `/reload-plugins` refreshes skills, slash commands and MCP servers only. A new or changed extension module, like a new tool or hook, needs a session restart (`omp://marketplace.md:78`).

State that must outlive the process belongs in a file the extension owns or in a session entry: `pi.appendEntry(customType, data)` writes a custom entry, and `ctx.sessionManager.getBranch()` rebuilds it on `session_start` / `session_branch` / `session_tree` (`omp://extensions.md:600-623`). Use a package- or reverse-domain-qualified `customType` — the namespace is global.

</load_and_lifetime>

<first_party_or_separate_marketplace>

Two placements are legitimate; pick by what the module is coupled to.

**Inside an existing plugin** when the extension only makes sense next to that plugin's other content:

- A channel bridge is coupled to a specific MCP server declaration in the same plugin's `.mcp.json`; it belongs in that plugin.
- A tool or command that operates on that plugin's config file or state directory belongs in that plugin.

A plugin can carry both surfaces at once: `.claude-plugin/plugin.json` + `.mcp.json` + `skills/` for Claude Code, and `package.json#omp.extensions` + `extensions/` for omp. That keeps one install serving both hosts.

**In a separate omp-only marketplace** when the module is a general harness capability with no Claude Code counterpart — a context guardrail, a provider shim, a TUI renderer, a session-control command. Keeping it out of a dual-surface plugin means a Claude Code user does not install a plugin whose only payload is inert to them. A marketplace whose catalog is at `.omp-plugin/marketplace.json` is the preferred shape for an omp-only catalog; `.claude-plugin/marketplace.json` is the Claude Code-compatible path and is read as a fallback by omp (`omp://marketplace.md:16, 92-96`).

See `references/packaging.md` for the version and docs rules that apply either way.

</first_party_or_separate_marketplace>
