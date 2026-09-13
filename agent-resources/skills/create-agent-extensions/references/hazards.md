# Hazards

Each hazard below is a real failure observed in the harness or documented in its source. Read this before shipping an extension that owns a timer, a listener, process-scoped state, or a plugin setting.

<hazard_index>

| Hazard | Mitigation |
|---|---|
| A throw from background work tears down the whole session | Use `ctx.setInterval` / `ctx.setTimeout` / `ctx.clearTimer`; wrap any raw callback in your own `try/catch` |
| Nothing closes your listener or timer but you | Close it from `session_shutdown` (2 s budget); never assume the harness manages a resource you opened |
| No HTTP ingress surface exists | Run the listener in a plugin-owned process (an MCP stdio child, or `Bun.serve` in-process) and handle port collision |
| Plugin settings render in `/settings` but have no supported runtime accessor | Keep the plugin's own config file as the runtime source of truth; treat `omp.settings` as the UI entry point |
| Extensions multiply across sessions in one process | Make process-scoped resources singleton-aware; guard on `ctx.hasUI` or the `yield` tool |
| A command name that collides with a built-in is silently skipped | Pick a distinctive name; check the diagnostic output when a command does not appear |
| No sandbox and no project trust gate | Treat any file the session can read as readable by the extension, and any loaded extension as fully privileged |

</hazard_index>

<unmanaged_background_work>

Extensions run **in-process with no isolation**. A raw `setInterval`, `setTimeout` or detached-promise callback that throws runs on a fresh stack outside the handler-dispatch `try/catch`, surfaces as a process-level `uncaughtException`, and the global postmortem handler treats it as fatal — **the whole session is torn down**, not just the offending extension (`omp://extensions.md:222`, `packages/coding-agent/src/extensibility/extensions/managed-timers.ts:1-16`).

Use the managed helpers, which run the callback with the same isolation as handler dispatch (a throw or rejected promise is logged and reported through the extension error channel, and the session keeps running), return a handle, and are `unref`'d and cleared on `session_shutdown`:

```ts
pi.on("session_start", (_event, ctx) => {
  const timer = ctx.setInterval(() => {
    // A throw here is contained.
    ctx.ui.notify("tick", "info");
  }, 60_000);

  pi.on("session_shutdown", () => ctx.clearTimer(timer));
});
```

If you must use a raw timer, you own the isolation: wrap the callback body in `try/catch` and clear the timer on `session_shutdown` (`omp://extensions.md:241`).

**Lifetime, which is the decisive part:**

| Event | Managed timers |
|---|---|
| Session goes idle | survive (idle just means "not streaming") |
| `/new` | survive — `newSession()` preserves listeners and emits `session_switch` only |
| `/resume`, `/reload` | survive |
| `session_shutdown` (dispose, Ctrl-C, `/exit` teardown) | cleared by `clearAll()` |
| omp process exit / container restart | gone — timers are in-process and `unref`'d |

There is no scheduler, cron or persisted-timer facility anywhere in the API or the CLI. A recurring job that must survive a restart needs its own state and re-arm on `session_start`, or a plugin-owned process outside omp that bridges in through an MCP notification.

</unmanaged_background_work>

<no_http_ingress>

**omp provides no native facility for receiving inbound HTTP.** The complete `ExtensionAPI` surface has no server, socket, port or bind primitive, and no `Bun.serve` site exists under the extension subsystem (`omp://extensions.md:111-185`; `packages/coding-agent/src/extensibility/extensions/types.ts:1212-1540`). RPC mode and ACP mode are both stdio, not sockets.

Two routes exist, both owned by the plugin:

1. **Ship an MCP stdio server and let the session spawn it.** The plugin declares `.mcp.json`; omp spawns the server as a child of the top-level session and disconnects it on session dispose. The server process binds the port and pushes events to the session as MCP notifications, which reach extensions as `mcp_notification`. This is the established pattern for channel plugins.
2. **Run a listener in-process** from the extension (`Bun.serve`), and close it from your own `session_shutdown` handler.

Hazards on both routes:

- **Port collision is real.** MCP servers are owned per top-level session/process, so any second omp process — another profile, an RPC run, a headless run — gets its own server and its own bind. There is no port-allocation or cross-process coordination primitive anywhere in the extension API. A bounded rebind loop (a few attempts, one second apart, then fail loudly) is the pragmatic mitigation; shipping one blindly means the second session's listener silently dies.
- **Lifecycle is yours.** Nothing in omp's lifecycle closes an in-process listener. Close it in `session_shutdown`, which has a **2 s** budget — a listener that needs longer than that to drain will be cut off.
- **`/mcp reload` restarts the child.** It does `disconnectAll` then rediscovery, so the port must be released promptly. Whether it is reliably free at respawn time is untested; the bounded retry loop exists because it is not guaranteed.
- **A throwing server callback is process-fatal**, exactly like a raw timer (`omp://extensions.md:222`).

</no_http_ingress>

<plugin_settings_at_runtime>

A plugin can declare a settings schema at `package.json` → `omp.settings` (legacy `pi.settings`) with four scalar field types — `string`, `number`, `boolean`, `enum` — each carrying an optional `description`, `secret` and `env`, plus a `default` and bounds where the variant supports them. That schema renders as a generated form in `/settings` → Plugins, and is scriptable with `omp plugin config list|get|set|delete|validate`.

**But there is no supported runtime accessor for it.** `ExtensionAPI` and `ExtensionContext` expose no settings field; nothing passes plugin settings into the extension factory or its context; and `getPluginSettings(pluginName, cwd)` — the only reader — is called by the CLI and the settings UI, not by the extension runtime.

The consequences, which shape the design rather than just warn about it:

- The deep subpath import (`@oh-my-pi/pi-coding-agent/extensibility/plugins/loader`) resolves in both the repo-checkout run and the compiled binary, but it is **undocumented host internals**: an upstream reshuffle of the package `exports` or of the generated bundled-module registry breaks it with no compatibility guarantee. If you use it, `try/catch` and fall back to your own config file.
- **An MCP child process cannot use it at all.** A `.mcp.json` server is a plain Bun process spawned by omp and does not get the host shim; it can only read the settings store itself (`<pluginsDir>/omp-plugins.lock.json` → `settings.<packageName>`, plus the project's `.omp/plugin-overrides.json`) or a file the extension mirrors.
- **Nothing pushes a change at runtime.** The UI/CLI write path is a lock-file rewrite with no event, no file watcher and no cross-process invalidation. A reader that re-reads per use sees live values; a value cached at `session_start` goes stale until the next restart. The `env` field in the schema is display-only — declaring `"env": "MY_VAR"` prints a hint and resolves nothing.

**Preferred shape:** the plugin's own config file is the runtime source of truth. Add `omp.settings` only if a settings-panel UI is wanted, and then mirror the values out to that file on `session_start` and after any change the extension notices. One read path, one write path, nothing duplicated in the child.

</plugin_settings_at_runtime>

<session_multiplication>

One omp process can host several sessions, and they do not have disjoint extension sets:

- **Subagent and headless sessions re-run the extension factories in the same process.** A factory that writes a file on `session_start`, sends a notification, or arms a timer will do so once per session unless it guards itself.
- **File-write / file-delete fallback registries are process-wide.** A handler may be consulted for a mutation issued by *any* session in the process, not only the one whose extension registered it. Compare `req.sessionId` with `ctx.sessionManager.getSessionId()` before prompting — and remember `ctx.ui` belongs to the handler's session, not necessarily to the session being asked about.
- **Parallel agents may run their own profiles**, each with its own agent directory, plugin set and process. An extension that must fire exactly once across the machine (a notification, an exclusive port, a shared state file) cannot assume it is the only instance loaded.

Guards that work:

```ts
// Only the interactive main session acts.
pi.on("session_start", (_event, ctx) => {
  if (!ctx.hasUI) return;
  // …
});

// Only a main session (not a subagent) acts. omp adds `yield` to subagent tool sets.
if (!pi.getActiveTools().includes("yield")) {
  // …
}
```

Make process-scoped resources singleton-aware: a module-level guard, an exclusive lock file, or an idempotent bind. Prefer per-session state and design for the factory running more than once.

</session_multiplication>

<naming_and_trust>

- **Command names cannot override built-ins.** A `registerCommand` name that collides with a built-in is *skipped* with a diagnostic, not overridden — a plugin cannot repurpose an existing command. Reserved shortcuts are ignored outright (`ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `ctrl+q`, `alt+m`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`). Pick names distinctive enough that a collision is unlikely, and check the diagnostic when a command does not appear.
- **No isolation.** Extensions share one process, one `EventBus` and one runtime. There is no capability boundary between your extension and any other, and none between your extension and the host.
- **No project trust gate.** `ctx.isProjectTrusted()` always returns `true`. omp loads `<cwd>/.omp/extensions` and `<cwd>/.omp/config.yml` unconditionally, so an extension written against an upstream trust API degrades to a no-op. Do not rely on it as a security control.
- **`resources_discover` is inert.** The event type and the runner's emit path exist, but no session callsite invokes it — an extension cannot contribute resources through it.
- **Registration after load is lost.** Registrations made in the factory are installed at runner initialize; a first registration made later (from a handler) never takes effect. This bites file-write/file-delete fallbacks first.

</naming_and_trust>
