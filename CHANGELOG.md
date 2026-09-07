# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- `jj` (v0.1.2): document pushing to a remote in the `working-with-jj`
  skill - jj only pushes commits reachable from a tracked bookmark, so a
  freshly `jj commit`-ed unnamed change makes `jj git push` report
  "Nothing changed". The skill now spells out the publish flow (`jj
  bookmark set main -r @` / `-r @-`, then `jj git push`) and warns off
  `jj bookmark move -r` (that subcommand takes `--from`/`--to` and errors
  on a single `-r` target) in favor of `jj bookmark set <name> -r <rev>`.

### Added
- `nats` (v0.2.0): **config-home isolation** - the channel server now derives
  its state root from `CLAUDE_CONFIG_DIR` when set (used exclusively, never
  merged with `~/.claude`), so an omp instance in an isolated config home is
  a distinct nats agent with its own `.env`, `agents.json`, agent id, and
  sessions dir. Unset behavior is unchanged: state stays at `~/.claude`.
  New `resolveClaudeBaseDir()` helper in `nats/paths.ts`, unit tested in
  `nats/test/state-root.test.ts`.
- `nats` (v0.2.1): stale `~/.claude` path text corrected - the server header,
  the `.env`/sessions comments, and the agent-facing "agents.json at
  `~/.claude`" MCP instruction now reference the `CLAUDE_CONFIG_DIR`-derived
  `CLAUDE_BASE` (default `~/.claude`) instead of hardcoding `~/.claude`,
  which was wrong under the config-home isolation convention.
- `nats` (v0.1.9): **self-healing reconnect** - the channel server now survives a NATS outage or server restart in place instead of sitting permanently "not connected". `connectNats` uses an infinite reconnect budget (`maxReconnectAttempts: -1`, 2s wait) so nats.js recovers and resubscribes an established connection on its own; the initial connect is retried forever with exponential backoff (1s to 30s) so a server that's down when the channel server boots is picked up as soon as it returns; and after a permanent close the connection is re-established from scratch. On each (re)connect the agent re-announces so peers refresh `lastSeen`. Previously the server connected once at startup and never retried, so an outage during boot left it dead until its MCP host respawned the process (observed live: whole phoenix infra down ~6h, nats plugin up 5h41m and never connected).
- `anydoc` (v0.0.1): new plugin — convert Word, PowerPoint, Excel, OpenDocument,
  RTF, EPUB, CSV, and PDF files to GitHub-Flavored Markdown via the anydoc CLI.
  Single `convert-documents-to-markdown` skill shells out to
  `npx -y @firecrawl/anydoc` (Node 20+, no install) and teaches the CLI contract:
  content-based format detection, exit codes (0/1/2/3), writing large docs to a
  file with `-o`, and routing scanned/image-only PDFs (exit 3) through
  `--ocr hosted` (Firecrawl Parse). Verified end-to-end against docx/pdf/csv
  fixtures in-sandbox.
- `sandbox-manager` (v0.18.10): `usage-state-writer` extension now also
  surfaces omp's own usage/cost for the telegram-ng /usage command. Runs
  `omp stats -j` (the harness's stats.db aggregation: requests, tokens in/
  out/cache-read, cache rate + savings, total cost, per-model breakdown) on
  a 5-minute cadence — the sync takes ~1-2s, so it's throttled rather than
  per-turn — and merges the result into `~/.claude/session-status-cache.json`
  as an `omp` block (`overall` + `byModel` + `stats_at`), parsing the JSON
  from the first `{` because `omp stats -j` prints a sync line to stdout
  first. Failures keep the previously written block; the standard
  context_window/rate_limits write path is unchanged.
- `telegram-ng` (v0.12.11): /usage renders the omp block the sandbox-manager
  extension writes — a `🤖 omp usage` section after the rate-limit buckets
  with total requests, spend (`$3.35` style), cache rate, ~% saved,
  token volumes, and the top 3 models by cost. `UsageCache` type extended;
  `formatUsageMessage` skips the section when the block is absent, so a
  Claude-Code-only cache renders exactly as before.
- `immune-system` (v0.1.0): new plugin — defensive security monitor for the
  agent instance, separate from the replicator. Always-on Bun MCP watcher
  (`server.ts`) fingerprints every entry under the Claude Code and omp plugin
  caches, user skills dirs, the hooks dir, and `settings.json` hook
  registrations on a configurable interval (`~/.claude/channels/immune-system/`);
  new or changed entries become `pending` findings and wake the session via a
  batched `source="immune-system"` channel notification. Pure fingerprint/diff
  logic in `lib/fingerprint.ts` (content-hashes manifests and hooks scripts,
  stats the rest, skips node_modules/.git/build noise — unit-tested). Seven
  MCP tools: `scan`, `list_findings`, `quarantine`, `restore`, `remove`,
  `clear`, `status`. `immune-response` skill applies the replicator's
  injection-defense doctrine (untrusted content, no trust bypass, quarantined
  read-only subagent evaluation, safety score 1–5) and quarantines confirmed
  threats + alerts the operator over Telegram; removal only on explicit
  confirmation. Ships the `extensions/omp-channel.ts` wake bridge so channel
  notifications reach the session under omp exactly like cronjobs/telegram-ng.
- `sandbox-manager` (v0.18.8): `subagent-hardening` now allowlists the
  replicator search/fetch MCP pair (`mcp__replicator_replicator_search`,
  `mcp__replicator_replicator_fetch`) instead of stripping every `mcp__*`
  tool from subagent sessions. The pair is the quarantine agent's deliberate
  fetch-only grant against the SSRF-guarded replicator server; all channel
  servers (telegram-ng reply, cronjobs, webhooks) remain stripped.
- `ablate-ai-layer` (v0.1.0): new plugin — audited import of the `ablate-ai-layer`
  skill from `coleam00/skills` (MIT), picked out of that repo's 33 skills (the
  rest duplicate existing workspace skills/tools). Runs an AI-layer ablation: the
  same real probe task N times with the repo's always-loaded agent instructions
  intact and N times stripped, in throwaway git worktrees (working tree never
  touched), then grades every rule against what actually changed
  (`references/comparison.md` rubric, graded per rule and blind to arm). Ships
  `scripts/map_layer.py` (read-only layer inventory + per-session token cost) and
  `scripts/run_ablation.py` (drives both arms; spawns `claude -p` or `--runner`).
  Import audit: both scripts reviewed — no network, no credential access,
  mutations scoped to throwaway worktrees and `.ablation/` output. Import hash
  (sha256 of the imported SKILL.md, audited deltas included): `8c37ae48…69ad7`;
  source pinned in `skills-lock.json`.
- `sandbox-manager` (v0.18.6): new `usage-state-writer` extension — keeps
  ~/.claude/session-status-cache.json fresh under omp for the telegram-ng
  /usage bot command (Claude Code's statusline hook never runs under omp,
  so /usage saw a stale or missing file). Writes context_window from
  ctx.getContextUsage() and rate_limits mapped from the active provider's
  usage report ("5h" → five_hour, "7d" → seven_day, same bucket shape as
  the claude statusline) at session_start and after every turn; rate-limit
  refreshes are gated to once per 5 minutes and failures keep the previous
  buckets.
- `telegram-ng` (v0.12.8): /usage "no data cached" fallback message now
  names both cache writers (statusline hook on Claude Code, sandbox-manager
  usage-state extension on omp) instead of only the statusline hook.
- `telegram-ng` (v0.12.7): idle sentinel targeting — when the idle state
  has no record of who sent the last message (or the recorded chat is no
  longer allowlisted), the "Still going, or done for now?" prompt is sent
  to NOBODY instead of broadcasting to the full allowlist.
- `telegram-ng` (v0.12.6): idle sentinel opt-out — setting
  TELEGRAM_NG_IDLE_SENTINEL_DISABLED=true in the channel .env never starts
  the "Still going, or done for now?" timer, for deployments that should
  never receive idle prompts (e.g. the locked-down claude-gina sibling
  instance).
- `sandbox-manager` (v0.18.5): new `idle-state-tracker` extension — port of
  the idle-state-tracker.py Stop hook for omp (Claude Code hooks never run
  under omp, so the telegram-ng idle sentinel's state file went stale after
  the claude→omp migration and it started asking "Still going, or done for
  now?" on every allowlisted chat, including at session start). Writes
  ~/.claude/channels/telegram-ng/idle-state.json after every turn and at
  session_start in the sentinel's exact shape, tracking last_chat_id from
  inbound channel notifications so the sentinel targets the chat that
  actually talked instead of broadcasting to the allowlist.
- `telegram-ng` (v0.12.5): omp channel isolation — the wake-bridge extension
  no longer wakes subagent sessions on inbound channel notifications (a
  session is a subagent when `yield` is in its active tools); main-session
  wakes unchanged.
- `cronjobs` (v0.1.6): omp channel isolation — wake-bridge extension skips
  subagent sessions on inbound channel notifications (same `yield` check as
  telegram-ng); main-session wakes unchanged.
- `webhooks` (v0.2.3): omp channel isolation — wake-bridge extension skips
  subagent sessions on inbound channel notifications (same `yield` check as
  telegram-ng); main-session wakes unchanged.
- `sandbox-manager` (v0.18.4): new `subagent-hardening` extension — strips
  every `mcp__*` tool from subagent sessions at session_start (and
  re-strips on mcp_notification), so subagents can never call channel MCP
  tools (telegram-ng reply, cronjobs, webhooks) or any other MCP server
  tool; an agent definition's `tools:` frontmatter whitelist is now the
  complete tool contract for a subagent.
- `agent-resources` (v0.2.3): create-mcp-servers — omp-channel bridge
  template and omp-channel-notifications reference now include the subagent
  wake gate (channel notifications must not wake subagent sessions) and
  document the sandbox-manager subagent-hardening extension.
- `telegram-ng` (v0.12.4): new direct-bot-api skill — raw Bot API fallback (sendMessage/editMessageText/sendDocument via curl) for when the telegram-ng MCP server is disconnected mid-turn; confirmed-gone gate before fallback, token never logged, degraded-mode caveats documented.
- `container-management` (v0.4.1): portability pass — new plugin CLAUDE.md is the
  single home for environment-specific values (containers root, Docker networks,
  Dozzle group membership, Watchtower-excluded and custom-image services); SKILL.md
  and all six workflow files resolve paths via `$CONTAINERS_ROOT` and point at
  CLAUDE.md instead of hardcoding `/workspace/containers`; workflows migrated from
  markdown headings to pure-XML structure; update-strategies.md's incident
  narrative scrubbed of plan filenames, dates, and personal identifiers.
- `finance-manager` (v0.11.1): audit fix wave — review-finances,
  setup-finance-manager, reconcile-statement, and manage-paperless-workflows
  gained the required XML tags (`<objective>`/`<quick_start>`/`<success_criteria>`)
  with legacy markdown sections migrated; hardcoded absolute paths replaced with
  runtime discovery (actual CLI via `command -v` + plugin-dir fallback,
  skill-dir-relative script paths, container-name discovery); the transfer-link
  data-loss incident detail moved into its own reference file; financial-planner
  agent pinned to sonnet and given a worked example; `.pytest_cache` gitignored.
- `github-manager` (v0.3.2): the six manage-* webhook skills gained the required
  `<objective>`/`<quick_start>`/`<success_criteria>` skeleton per audit guidance;
  minor quick fixes in create-stories and handle-dependabot-pr.
- `nats` (v0.1.4): send-message examples no longer leak the maintainer's real
  agent-to-agent traffic (generic message bodies, fake agent ID); access's
  credential-update snippet now preserves the existing `NATS_AGENT_NAME` line
  instead of clobbering the file (granted `Bash(printf *)`/`Bash(mv *)`); success
  criteria in show-nats-status/discover-agents aligned with actual output (no
  phantom capabilities field); ping-agent timeout syntax unified to
  `timeout=<ms>`.
- `jj` (v0.1.1): working-with-jj skill migrated from legacy markdown to pure XML
  (7 semantic tags, all required tags present), frontmatter `name` fixed to match
  the directory, environment-specific hook claim made conditional, `TodoWrite`
  tool reference removed.
- `research-tools` (v0.1.2): all six skills gained `<quick_start>`, third-person
  descriptions, and an explicit source-unavailability fallback step.
- `simple-english` (v0.1.1): SKILL.md and both references migrated to pure XML; a
  real product name in the worked example genericized.
- `knowledge-wiki` (v0.1.1): maintain-wiki migrated to pure XML; new plugin
  CLAUDE.md (`WIKI_ROOT`) replaces five hardcoded `/workspace/docs` paths; README
  installers pointed at CLAUDE.md instead of the skill's path.
- `doubt-driven-development` (v0.1.1): markdown-heading body migrated to pure XML
  (22 anti-pattern entries preserved), plus `<quick_start>` and
  `<security_checklist>` added.
- `cronjobs` (v0.1.5): description trigger aligned to `/cronjobs:cronjob`;
  error-handling guidance added to the workflow (unsupported expression, unknown
  job ID).
- `webhooks` (v0.2.2): receive-webhooks documents that `allowed_ips` is
  exact-match only (no CIDR) and defers GitHub IPs to api.github.com/meta; added
  `<security_checklist>` and `<validation>` with server-verified status codes;
  wording generalized from Telegram to channel messages.
- `netshoot` (v0.1.2): new plugin CLAUDE.md holds the deployment-specific stack
  (containers root, Docker networks, service names); SKILL.md and the bundled
  script genericized to placeholders with runtime discovery; `--env-file` now
  conditional so the script no longer fails hard without `.env`; `bash -n`
  verified.
- `repo-hygiene-sweep` (v0.1.1): sweep.sh no longer falls back to a literal
  `/workspace` root (resolves `CLAUDE_PROJECT_DIR` → `REPO_HYGIENE_WORKSPACE_ROOT`
  → hard error), and exits 1 with an explicit message when the standalone-repo
  list cannot be parsed instead of reporting a false "everything clean"; SKILL.md
  documents the new resolution order and failure mode.
- `consider` (v0.1.2): added `<quick_start>` framework selector; trimmed
  `<when_to_use>` to the negative trigger.
- `audiobookshelf` (v0.1.1): access objective's `{env}` notation unified to
  `${ENV}`; query-library `<notes>` deduplicated against inline verification
  markers.
- `wallabag` (v0.0.4): access example credentials made obviously fictional;
  save-url explicitly forbids echoing secrets in failure reports.
- `executable-skepticism` (v0.1.1): comma splice in the anti-sycophancy
  guardrails fixed.
- `brain` (v0.4.2): the `learn-from` skill's `<quick_start>` still claimed
  `learn_from` takes "no parameters — v1 has exactly one source" — stale
  since v0.3.0 added the optional `path` argument and v0.4.0 added
  `duration_seconds`. Documented both arguments (and that the resolved
  path is registered for `study_status` staleness tracking); no code
  change.
- `container-management` (v0.4.0): new reference `references/ipv6-networking.md` — IPv6
  networking for containers on Linux: host uplink prerequisites (global address, default
  route, RA/SLAAC and the `accept_ra=0` route-expiry flap), Docker `enable_ipv6`
  user-defined networks with ULA allocation and NAT66 (Engine v27+), live attach vs
  compose persistence, verification from inside the container, and gotchas (proxied DNS
  breaking non-HTTP ports, read-only `known_hosts` mounts, ephemeral writable-layer
  state, `iputils-ping` + `CAP_NET_RAW`). Wired into `add-service.md` and
  `check-health.md` required reading.
- `sandbox-manager` (v0.18.3): new OMP extension
  `extensions/session-start-notify.ts`, declared via a new `package.json`
  `pi` manifest (`extensions: ["extensions/"]`). OMP never runs Claude Code
  `SessionStart` hooks (sessions live in one long-lived process; `/new` is an
  in-process switch), so the `setup-hooks` `session-start-notify.py` hook
  silently stopped notifying once sessions moved from Claude Code to omp.
  The extension restores the Telegram session-start notification on OMP's own
  lifecycle events: `session_start` (process start) and `session_switch`
  (reasons `new`/`resume`/`fork` → `/new`, `/resume`, `/fork`; resume names
  the session from its file's title slot). Gated on `ctx.hasUI` so task
  subagents and headless runs don't spam. Telegram config comes from the same
  `~/.claude/channels/sandbox-manager/hooks-config.json`
  (`telegram_chat_id`/`telegram_env_path`) the `setup-hooks` installer writes,
  with `TELEGRAM_CHAT_ID`/`TELEGRAM_BOT_TOKEN` env and workspace-default
  fallbacks; no secrets in the plugin.
- `sandbox-manager` (v0.18.1): `restart-session` now sends `/reset` (not
  `/clear`) to omp panes. omp's TUI has no `/clear` command and swallows
  unknown `/`-commands without forwarding them to the embedded Claude
  Code, so the v0.18.0 omp-pane acceptance sent a `/clear` that omp
  ignored — the session never restarted. `/reset` is omp's in-place
  conversation reset (drops live messages/queued turns/pending tool
  calls, keeps session id, cwd, model, and on-disk transcript); Claude
  Code panes still get `/clear`.
- `replicator`, `finance-manager`, `agent-resources`: removed the
  `model:` frontmatter line from the `quarantine`, `financial-planner`,
  `skill-auditor`, and `subagent-auditor` agent definitions. Under Claude
  Code an absent model line means `inherit` (behavior unchanged — the
  parent is sonnet-class); under the omp harness the explicit
  `inherit`/`sonnet` values made omp's subagent runtime fail every spawn
  with "No model selected" (omp has no model of its own to inherit from —
  it is a supervisor for Claude Code, and its fresh `agent.db` after the
  2026-08-29 boot carried no selection). Quarantine spawns verified
  working after the change.
- omp-harness caveat from the same cycle: omp subagent sessions do not
  expose `WebSearch`/`WebFetch` and do not honor agent-def `tools:`
  restrictions — the `quarantine` agent runs but cannot fetch, so the
  replicator's outward scan is blocked under omp until a fetch-capable
  tool is mounted for that session.
- `cronjobs` (v0.1.4): `list-jobs` reported a stale `nextRun` frozen at
  add-time — croner computes the actual schedule internally and the
  persisted value was never refreshed, so every job showed its original
  creation-time next run (e.g. jobs created in July showed July dates).
  `list-jobs` now computes `nextRun` fresh on demand from each job's
  expression (same croner probe `add-job` uses); the persisted field is
  display-only metadata and scheduling was never affected.
- `telegram-ng` (v0.12.3), `cronjobs` (v0.1.3), `webhooks` (v0.2.1): new
  `extensions/omp-channel.ts` wake bridge, declared via `pi.extensions`.
  Claude Code natively turns `notifications/claude/channel` into
  `<channel>` user turns; omp (Oh My Pi) does not — its MCP manager only
  fans server notifications out to `mcp_notification` extension events.
  The bridge re-wraps each plugin's channel notifications in the same
  `<channel source="...">` marker shape, then wakes the session with a bare
  `pi.sendUserMessage(wrapped)` — omp only starts a turn for the no-options
  form (prompt when idle, steer while streaming); an explicit
  `deliverAs: "followUp"` merely queues and never wakes an idle session.
  Each bridge accepts its own MCP server name or `meta.source`, escapes
  attribute values, and breaks forged `</channel>` close tags in
  sender-controlled content. Claude Code behavior is unchanged.
- `cronjobs` (v0.1.3): `isSameServerAlive` now treats a zombie (state `Z`)
  as not alive — `process.kill(pid, 0)` still succeeds for an unreaped
  zombie, so a stale pid file could otherwise block the server forever in a
  container whose init never reaps.
- `brain` (new plugin, v0.1.2): workspace-wide knowledge graph backed by
  LatticeDB. `learn_from` syncs graphify's `graphify-out/graph.json` output
  into the graph (creates/updates/deletes nodes and edges to match);
  `recall` queries it via Cypher — a raw query, or `@@` full-text search
  when the question doesn't map cleanly to a `MATCH` pattern — to answer
  questions about the workspace's code, docs, and concepts. Two skills:
  `learn-from` and `recall`. Ships an MCP server (`brain/.mcp.json`, bun),
  the same shape as `nats`/`cronjobs`. v0.1.1 is a final whole-branch
  review fix wave: bigint-valued query results (integer properties,
  `count()`) no longer crash `JSON.stringify` in the MCP tool handler; a
  `learn_from` sync no longer aborts entirely when one edge dangles
  (references a gid with no node — now skipped and counted in a new
  `edgesSkipped` field); and a removed node property no longer causes
  permanent false "changed" churn on every subsequent sync. v0.1.2:
  `recall` now opens the brain with LatticeDB's `readOnly` mode
  (`openBrain(path, { readOnly: true })`), so a mutating Cypher query
  (`CREATE`/`DELETE`/`SET`/`MERGE`/`REMOVE`) is rejected at the database
  layer — real enforcement, not just a documentation caveat — while
  `learn_from` still opens read-write as before. v0.1.3: added an MCP
  smoke test (`brain/src/mcp-smoke.test.ts`) that spawns `server.ts` as a
  real subprocess and drives it over an actual stdio MCP connection via
  the SDK's `Client`/`StdioClientTransport` — every prior test called
  `learn_from`/`recall` as plain library functions, so this is the first
  coverage of the real protocol path (tool listing, request routing, JSON
  serialization, and that a rejected mutating `recall` surfaces as a
  JSON-RPC error without killing the connection). v0.2.0 added `remember`
  (write a single fact directly as text plus optional structured properties,
  optionally linked to existing nodes by gid or full-text search — top hit,
  best-effort, reported back with score), tagged `_brain_source: "remember"`
  and labeled `Fact`, and `forget` (soft
  [default, recoverable] or permanent delete of any node/edge regardless of
  source; soft forget relabels a node to `Forgotten` (replacing its prior
  labels) or retypes an edge to `FORGOTTEN`, recreating a forgotten node's
  edges too so a traversal dead-ends cleanly instead of losing graph shape).
  Required a fix to `learn_from`'s sync engine: its
  diff previously treated a forget tombstone as "removed at the source" and
  silently erased it on the very next sync — reproduced live during design,
  fixed by having both diff loops skip anything currently tombstoned
  entirely, and by tracking a retyped edge's `_original_type` so it's still
  recognized under its real relation type. Design:
  `docs/superpowers/specs/2026-08-27-brain-remember-forget-design.md`.
  Plan: `docs/superpowers/plans/2026-08-27-brain-remember-forget.md`. v0.3.0
  decoupled `learn_from` from graphify specifically — it gained an optional
  `path` argument (defaulting to `graphify-out/graph.json`) so any producer of
  the same `{nodes, links, hyperedges?}` schema can be synced in without
  modifying brain. v0.4.0 added `study_status` (read-only tool reporting
  staleness and estimated re-study cost for any previously-learned path,
  without triggering a re-study itself, by shelling out to graphify's own
  `detect_incremental()`), a `StudiedPath` registry (nodes in brain's own
  graph, auto-upserted whenever `learn_from` runs), and an optional
  `duration_seconds` argument on `learn_from` so the calling agent can record
  how long a `/graphify` run took. Design:
  `docs/superpowers/specs/2026-08-28-brain-study-status-design.md`. v0.4.1
  is an audit fix wave: `learn_from`'s `_brain_source` tag was keyed only by
  adapter name ("graphify-out"), not by corpus — syncing a second corpus via
  the `path` override would delete or overwrite the first corpus's nodes on
  its next sync (the workspace's default corpus is unaffected and keeps the
  legacy plain tag; a new corpus now gets `graphify-out:<resolved dir>`),
  regression-tested in `sources/graphify-out.test.ts`. All five skills
  (`learn-from`, `recall`, `remember`, `forget`, `study-status`) were
  missing the marketplace's usual `<objective>`/`<quick_start>`/
  `<success_criteria>` XML structure — restructured, content unchanged.
  `forget`'s skill now explicitly requires user confirmation before a
  `permanent: true` delete. `study-status`'s description was corrected to
  third person. `marketplace.json`'s brain description was stale (predated
  `study_status`/`forget`) — synced with `plugin.json`'s.
- `agent-resources` (v0.2.2): `create-mcp-servers` now covers bidirectional
  channel communication with omp — new
  `references/omp-channel-notifications.md` (mandatory `meta.source`,
  wake-bridge extension, synchronous `sendUserMessage` pitfall, restart
  lifecycle, testing) and `templates/omp-channel.ts` (canonical bridge),
  wired into the create-new-server and update-existing-server workflows.
- `telegram-ng` (v0.12.2): all three skills (`access`, `bot-api-reference`,
  `configure`) were plain legacy markdown with zero XML structure —
  restructured to the marketplace's `<objective>`/`<quick_start>`/
  `<success_criteria>` convention, content unchanged, with security-relevant
  behavior (token masking, `chmod 600`, injection defenses, lockdown-policy
  guidance) pulled into an explicit `<security_checklist>` per skill. Fixed
  a real bug in `configure`: its `allowed-tools` frontmatter never granted
  `Bash(chmod *)`, but its token-save workflow calls `chmod 600` on the
  saved credential file — added.
- `sandbox-manager` (v0.17.1): audit fix wave on 5 skills. `add-to-todos`
  and `check-todos` were missing the required `<quick_start>` tag and had
  wrong-POV (imperative, not third-person) descriptions — fixed both.
  `manage-plugins` was missing `<objective>`; `setup-hooks` was missing both
  `<objective>` and `<quick_start>` — added. `whats-next`'s `<workflow>` and
  `<output_format>` substantially duplicated each other — collapsed
  `<workflow>` to a short pointer into `<output_format>`, folding any
  workflow-only detail into the corresponding output-format bullets, plus
  the same quick_start/POV fixes as its siblings.
- `replicator` (v0.8.1): audit fix wave. `capture`'s commit step ran `jj`
  from `/workspace` to commit `docs/replicator/queue.md`, but `docs/` is a
  separate, gitignored git repo `jj` can't see — the commit/push was a
  silent no-op, defeating the skill's stated purpose (avoiding lost
  captures across container restarts). Fixed to use
  `git -C /workspace/docs` instead, matching how `meditate` already
  handles the same repo boundary; `allowed-tools` updated from
  `Bash(jj *)` to `Bash(git *)` to match. The `quarantine` subagent's
  `success_criteria` claimed "six hard-flag categories" against an
  enumerated list of five — corrected to five. `meditate`'s SKILL.md
  (348 lines, pure markdown) restructured to XML, including a new
  `<security_checklist>` consolidating its prompt-injection defenses; its
  onboarding line pointed new installs at vocabulary definitions living
  only in this workspace's private `docs/` repo — added a local
  `skills/meditate/references/vocabulary.md` glossary (gene, mute, cycle,
  watchlist, speculative build) so the skill doesn't depend on a file only
  this operator has; the private design doc is now an optional deep-dive
  link, not a required first-run read.
- `agent-resources` (v0.2.1): audit fix wave (self-audit, since this is the
  plugin that defines the marketplace's skill/subagent standard).
  `create-mcp-servers/references/creation-workflow.md` hardcoded a real
  person's name ("Lex") as the assumed user throughout, leftover from an
  un-genericized upstream adaptation — replaced with "the user" per this
  repo's own portability rule. `create-agent-skills/SKILL.md` — the skill
  that teaches "every skill needs `<objective>`/`<quick_start>`" — didn't
  have real top-level versions of either itself; added. `subagent-auditor`
  (the subagent that audits other subagents) had no check for the single
  most-emphasized anti-pattern in its own required reading: a subagent
  requiring user interaction (e.g. listing `AskUserQuestion`), which
  structurally cannot work in an isolated subagent context — added.
  `heal-skill` hardcoded a `./skills/*` relative-path assumption that only
  resolves when invoked from this exact repo's root — replaced with
  multi-location discovery (or asking the user) so it works from any
  install location. `create-hooks`'s flagship quick_start example had a
  broken, triple-escaped `jq` command that would fail to parse — fixed and
  actually tested against real input. `create-mcp-servers` had two
  reference files on disk never linked from its references index
  (`best-practices.md`, `auto-installation.md`) — linked. Note: an earlier
  pass of this same audit flagged an "orphan `</output>` closing tag" in
  many of these files; that finding was verified false (an artifact of how
  a file-reading tool renders content, not real file content) and nothing
  was changed for it.
- `container-management` (v0.3.0): new `scripts/safe-rebuild.sh`,
  replacing the prose-only fix for the self-rebuild `$HOME`-resolution
  gotcha documented in `references/update-strategies.md`. That prose fix
  (added 2026-08-24) recurred three more times afterward regardless
  (2026-08-25 ×2, 2026-08-26 ×1) — remembering to type the two-command
  workaround correctly, every time, wasn't reliable. The script
  auto-detects the real host `$HOME` by self-inspecting the running
  container's own already-correct mount sources, renders the target
  service's compose config with it into a temp file, applies that file
  with the session's own environment, and refuses outright (exit 2) if
  the target resolves to the container currently running the script —
  comparing container IDs via `docker compose ps -q`, not names, since a
  container's runtime name can carry a prefix that doesn't match its
  compose-file `container_name` (confirmed live in this workspace).
  Found by `/replicator:meditate`'s inward review, cycle 2026-08-26.

### Changed
- `telegram-ng` (v0.12.12): Genericized a doc example in
  `skills/bot-api-reference/references/files-and-media.md` that named a
  specific internal instance (`claude-ricardo`) — now reads "one instance's
  bot to a different one". No behavior change.
- `container-management` (v0.4.6): Updated the `experiential` network row in
  `CLAUDE.md`'s Docker Networks table — the instance that reaches the
  experiential gateway was renamed (`claude-ricardo` → agent sandbox) in the
  consuming workspace. No behavior change.

### Fixed
- `sandbox-manager` (v0.18.11): `/exit` on herdr stopped working reliably — two
  mechanisms fought each other and both lost. (1) The omp-respawn plugin's
  `pane.exited` hook reopened omp with `plugin pane open --workspace <id>`,
  but herdr's auto-close cascade (plugin pane exit → last tab close →
  workspace close) had already deleted the workspace by the time the async
  hook ran, so the reopen failed with `workspace_not_found` (observed live
  2026-08-31 03:26Z: omp down for 22 minutes until a manual reopen). (2)
  `exit-session.sh` additionally ran `herdr session stop` after sending
  `/exit`; since the container's PID 1 is `herdr --session claude`, that
  killed the server, exited the container, and the docker-restart snapshot
  restore came back with plain bash shells instead of omp (observed live
  2026-08-31 01:54Z). Fix: the omp pane process is now `herdr/omp-loop.sh`, a
  self-restarting wrapper that relaunches omp with its original args
  (`omp --cwd /workspace --auto-approve`) in the same pane/tab/workspace on
  any exit (deliberate `/exit` or crash), with a crash-loop guard and the
  existing stop-marker escape hatch — the pane never tears down, so no hook
  and no container restart are involved in the normal path. `restart.sh`
  remains as the fallback for the wrapper itself dying and now recreates the
  workspace (cwd/label from `$HERDR_PLUGIN_CONFIG_DIR/respawn.env`, defaults
  `/workspace` + `omp`) when the exit cascade closed it, then closes the
  auto-created root shell pane so the recreated workspace holds only the omp
  pane (no stray second tab). `exit-session.sh` no longer stops the herdr
  session (removed 2026-08-31) and accepts `bash` as a pane command (the
  wrapper's foreground flips to bash between omp relaunches);
  `herdr-plugin.toml` `[[panes]]` command updated accordingly.
- `journal` (v0.1.2): `update-journal`'s session extraction only scanned
  `~/.claude/projects`, so it returned nothing once the sandbox ran OMP
  (the last Claude transcript predates the cutover) — journals silently
  stopped capturing activity. `extract_sessions.py` now scans both
  `~/.claude/projects` and `~/.omp-agent/sessions` and parses OMP's
  transcript schema (`type: "message"` with `message.role`
  user/assistant/toolResult) alongside Claude's, so nightly journal
  updates see OMP sessions again.
- `sandbox-manager` (v0.18.0): session-control scripts (restart, exit,
  background, branch, compact, rename, resume, export, reload-plugins)
  refused to fire on panes running the `omp` harness instead of `claude`
  — the pane-command guard accepted only `claude|node|bun`. `omp` now
  allowed, since it hosts the Claude Code session; refusal message
  updated. All 9 scripts share the guard; each herdr-mode test suite now
  also covers an `omp` pane.
- `nats` (v0.1.3): answers Cameri's "how do we make `/reload-plugins` kill
  the old orphaned process?" — it can't, from the plugin side; the actual
  bug was that this plugin never noticed it had been disconnected.
  `@modelcontextprotocol/sdk`'s `StdioServerTransport` only listens for
  `'data'`/`'error'` on stdin, never `'end'`/`'close'`, so when Claude Code
  disconnects a channel server by closing its stdin pipe (rather than
  sending SIGTERM — confirmed live: `/reload-plugins` left the old `nats`
  process running indefinitely, still connected to NATS and responding to
  `discover`/`ping` under a stale identity/stale code), neither the SDK nor
  this server noticed. Added explicit `process.stdin.on('end'/'close',
  shutdown)` — registered immediately after the transport connects, before
  any NATS setup, since Node doesn't replay a missed `'end'` event to a
  listener added after it already fired (an earlier attempt at this same
  fix registered the listener too late, at the bottom of the file after all
  NATS setup, and silently didn't work — caught by testing the actual
  stdin-close behavior before shipping, not just a bundler check).
- `nats` (v0.1.2): the `/rename`-fallback session-name lookup used
  `process.ppid` directly, but Claude Code's channel MCP servers run under
  an intermediate wrapper (`bun run --cwd <plugin> start`), so the real
  `claude` process is a grandparent, not the immediate parent — the lookup
  always missed and silently fell back to the bare agent ID on both
  claude-ricardo and claude-gina. Fixed by walking up `/proc/<pid>/status`'s
  `PPid` chain (capped at 8 hops) until a matching
  `~/.claude/sessions/<pid>.json` is found. Caught live: after wiring both
  instances together, `discover()`/`ping()` showed `name` equal to the bare
  agent ID for both sides instead of "claude-ricardo"/"claude-gina".
- `nats` (v0.1.1): `getAgentId()`'s generate-and-persist path was a
  check-then-write race — caught live wiring two fresh sibling instances
  together for the first time. Claude Code can spawn more than one instance
  of a channel's MCP server while it's still starting up (observed: 3
  concurrent `bun server.ts` processes for one channel on a slow first `bun
  install`), and on a genuinely first-ever connection (no `agent-id` file
  yet) each one independently generated and wrote its own random ID,
  producing several live identities all claiming to be "this agent" and
  responding to discovery/ping under different IDs. Fixed with an exclusive
  create (`wx` flag): whichever process wins the race keeps its generated
  ID, every other racer hits `EEXIST` and re-reads the winner's ID instead
  of keeping its own. Only bites true first-boot; already-persisted agent
  IDs are unaffected.

### Changed
- `nats` (v0.1.0): revamped from a capability-sharing/tool-invocation network
  (agents scanning each other's plugins and calling their tools/skills
  remotely) to a minimal messaging primitive — `message(to, text)` for
  free-form point-to-point messages with an explicit reply-to inbox,
  `ping(to)` for liveness checks, `discover()` for "who's there?", and
  `get_agents()` for the local cache. Dropped capability
  scanning/advertising, `broadcast(capability, ...)`, and the raw generic
  `publish`/`request` tools along with their skills (`invoke-agent`,
  `broadcast-agents`); added `ping-agent`. Agents now resolve a friendly
  display name (`NATS_AGENT_NAME` in `.env`, falling back live to the
  Claude Code session's own `/rename` name, then the bare agent ID) instead
  of showing only a random ID. Built to bridge a gap found while debugging
  cross-session messaging between two sibling Claude Code instances on
  different Anthropic accounts: Claude Code's native cross-session
  messaging is scoped to one account and can't reach a sibling instance
  logged into a different one — this plugin's NATS-based messaging isn't
  account-scoped.

### Added
- `doubt-driven-development` (v0.1.0, new plugin): adversarial fresh-context
  review of non-trivial in-flight decisions — CLAIM, EXTRACT, DOUBT,
  RECONCILE, STOP — with optional user-authorized cross-model escalation
  (Gemini/Codex CLI, read-only sandbox). Ported from the
  `doubt-driven-development` skill in
  [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
  (MIT), rewritten to be self-contained: replaced that pack's `agents/`
  persona-roster and `references/orchestration-patterns.md`
  cross-references with Claude-Code-native `subagent_type` guidance
  (fresh vs. `fork`) and pointers to this repo's own skills
  (`code-review`, `superpowers:test-driven-development`,
  `superpowers:systematic-debugging`).
- `cronjobs` (v0.1.0): fired jobs now dispatch to an `Agent` subagent instead
  of executing inline, so a long-running job no longer blocks the
  interactive session/pane it fired in. `cronjob` SKILL.md's supported
  schedule-expression table also stopped claiming raw cron and the
  natural-language forms resolve in UTC — the server has always evaluated
  `Cron(...)` with `timezone: TIMEZONE` (`process.env.TZ`, i.e. server-local
  time), so the doc was wrong and any raw cron expression written by
  following it literally would land at the wrong hour.
- `sandbox-manager` (v0.14.0): `exit-session` now checks for outstanding
  background work (a `run_in_background` shell, an Agent/fork dispatch, a
  Monitor, a Workflow) before sending `/exit` — Claude Code's own
  confirmation prompt for in-flight tasks only renders in the terminal, so a
  remote (e.g. Telegram) `/exit` request used to leave the session hung
  waiting on an unanswerable local prompt. It now warns on the originating
  channel and waits for `/exit` (proceed anyway) or `/background` (hand off
  first) instead of firing blind.
- `knowledge-wiki` (v0.1.0, new plugin): maintains a self-updating,
  cross-linked markdown knowledge base under `docs/wiki/` — a `maintain-wiki`
  skill for ingesting durable facts/research into topic pages, querying the
  wiki, and a `check-wiki.sh` consistency checker for broken relative links
  and orphaned pages. Built by `/replicator:meditate` as a speculative build
  from a 2026-08-16 outward-scan watchlist entry (Karpathy's "LLM Wiki"
  incremental knowledge-compilation pattern).
- `replicator` (v0.8.0): each weekly publish cycle that has at least one
  changed gene now also publishes a companion kind-1 Nostr note announcing
  the changed genes (key + state) and the active list, with `nostr:naddr...`
  mentions and matching `a` tags linking to each. Uses `naddr`, not
  `nevent` — the gene/list records are addressable events (NIP-01, kind
  30000–39999) identified by kind+pubkey+d-tag rather than a fixed event
  id, so `nevent` would go stale the moment the same address is republished
  with new content while `naddr` always resolves to the current version.
  New pure `buildAnnouncementRecord` in `announcement.ts` (returns `null`
  on an empty change set, so no announcement fires on a no-op cycle),
  wired into `buildPublishPlan`; `nostr-tools/nip19`'s `naddrEncode` was
  already a dependency via `identity.ts`, so no new package needed.

### Fixed
- `cronjobs` (v0.1.1): server now refuses to start a second instance against
  the same `jobs.json` (a PID-file lock at `~/.claude/channels/cronjobs/server.pid`,
  reclaimed automatically if the recorded pid is dead). Root-caused a bug
  where two specific daily jobs had each fired twice on the same day — once
  at a literal-UTC hour, once at the correct server-local hour. The in-process
  scheduling logic (`stopJob` before every `startJob`) was already correct
  and croner itself computes the right single occurrence, so the only
  remaining way to get two live `Cron` instances for one job id was two OS
  processes briefly overlapping during a restart, each loading `jobs.json`
  independently — most likely an old pre-2026-08-18 process (still on the
  hardcoded-UTC timezone) that was never cleanly killed, overlapping with
  the fixed post-2026-08-18 process. This closes that gap at the process
  level rather than the scheduling level.
- `cronjobs` (v0.1.2): moved the v0.1.1 pid lock from `~/.claude/channels/cronjobs/server.pid`
  (persistent — survives restarts) to `/tmp` (should not), and added a
  process-start-time check alongside the pid so a coincidental pid reuse
  after a restart can't be mistaken for the original instance. Prompted by
  catching, live, exactly the failure mode v0.1.1 was meant to prevent: a
  `ps aux` check found **five** concurrent `bun server.ts` processes for
  this plugin, three from container boot and two more each left behind by
  this session's own earlier plugin-update reloads — confirming the actual
  root cause is that Claude Code's plugin reload does not terminate the
  previous MCP server child process, it just leaves it running as an
  orphan holding a stale in-memory copy of `jobs.json` forever. The pid
  lock prevents new orphans from accumulating past the first post-fix
  process, but can't retroactively kill ones that already exist, and can't
  fix the reload behavior itself (outside this plugin's code) — a lingering
  pre-fix orphan will make a future reload's new process refuse to start
  (visible as the plugin failing to reconnect) until someone manually
  kills the orphan. Worth checking for stray `bun server.ts` processes
  after any cronjobs reload until the harness-level orphaning is fixed
  upstream.

### Security
- Redacted real personal/instance identity that had leaked into tracked
  plugin content: a hardcoded Telegram chat ID (`sandbox-manager`'s
  `check-login-expiry`), a hardcoded personal git-identity email
  (`github-manager/CLAUDE.md`), and named references to the maintainer by
  first name in operational skill instructions (`replicator`'s `capture`
  and `meditate`, `sandbox-manager`'s `check-login-expiry`) — all replaced
  with portable/generic phrasing so installing these plugins doesn't reveal
  whose instance they came from. Moved `container-management`'s
  `references/environment.md` (real internal IPs, real Cloudflare/Tailscale
  domains, a real webhook path) out of the plugin entirely to
  `docs/infra/container-management-environment.md` (workspace-local, not
  shipped) — the plugin's copy is now a generic template pointing there.
  Replaced the same real IP used as a live example in `netshoot` with the
  RFC 5737 documentation-reserved `192.0.2.1`. Left git-commit-author
  emails alone (already public via GitHub regardless, and explicitly
  out of scope per the maintainer).

### Fixed
- README.md: caught up with reality after drifting out of sync with plugin
  changes — added missing `lightning`, `replicator`, and `repo-hygiene-sweep`
  plugin rows/skill tables; fixed slash-command names that had silently
  diverged from actual skill folder names across `actual-budget`, `nats`,
  `paperless`, `wallabag`, `elevenlabs`, `finance-manager`, and
  `technitium-dns` (which was also missing its `manage-blocking` skill
  entirely); expanded `jj` and `sandbox-manager` skill tables from 1 listed
  skill each to their actual 7 and 12; added `github-manager:create-stories`;
  corrected the `telegram-ng` status note (it's the live channel driver now,
  not "pending cutover"); updated stale `jj`/`sandbox-manager` one-line
  descriptions to match current `plugin.json`. Also registered
  `repo-hygiene-sweep` in `.claude-plugin/marketplace.json`, which had never
  been added despite the plugin existing since its introducing commit — it
  was undiscoverable/uninstallable via `/plugin install` until now.

### Security
- `telegram-ng` (v0.12.0): a `permission_request` notification's first
  Telegram message now shows the tool's `description` and pretty-printed
  `input_preview` (e.g. the actual Bash command) directly, instead of a
  bare `🔐 Permission: Bash` with Allow/Deny buttons and the real content
  gated behind a separate "See more" tap. Reported by the maintainer: a
  push-notification preview or a quick glance previously let a sender
  Allow/Deny a tool call without ever seeing what it actually does — an
  approval flow that's supposed to require informed consent shouldn't be
  answerable blind. "See more" now only appears when the combined message
  would exceed Telegram's plain-text length cap; the formatting/truncation
  logic was extracted into a new `permission-request.ts` module with unit
  tests (previously untested inline logic in `server.ts`).

- `agent-resources` (v0.2.0): added an explicit sensitive-data/PII/OSINT
  checklist alongside the existing portability checklist, wired into every
  skill in the plugin that generates or audits content — `portability.md`'s
  new `sensitive_and_osint_rules` section (real names/handles, contact info,
  chat/account IDs, tokens, internal IPs/domains), the `create-agent-skills`
  `audit-skill` workflow checklist, the `skill-auditor` and
  `subagent-auditor` subagents' evaluation areas, and one-line pointers in
  `create-hooks`, `create-mcp-servers`, `create-subagents`, and `heal-skill`.
  Prompted by this plugin's own history of a real PII leak (a maintainer's
  username/repo/path baked into a bulk-copied example, caught during the
  2026-08-22 migration's pre-merge review) — this generalizes that one-off
  catch into a standing check so future skills/subagents/hooks/MCP servers
  built or audited with this plugin don't reintroduce the same class of
  leak. Also added a new root `CLAUDE.md` to the `cameri/skills` repo itself
  (this repo being public) so the same caution — scrub real personal/
  infrastructure identifiers before committing, ask when in doubt — applies
  even in a session where the `agent-resources` plugin isn't loaded at all.

### Added
- `sandbox-manager` `claude-subcommand-guard` hook (v0.13.0): new PreToolUse
  (Bash) guard, added to `setup-hooks`'s default hook set. Blocks running
  `claude <word> ...` when `<word>` looks like a subcommand (a bare
  lowercase/hyphen token) but isn't one of the real top-level subcommands
  verified against `claude --help`'s Commands section (`agents`, `auth`,
  `auto-mode`, `doctor`, `gateway`, `import`, `install`, `mcp`, `plugin`/
  `plugins`, `project`, `setup-token`, `ultrareview`, `update`/`upgrade`,
  plus `ssh` per the settings schema). Built after `claude marketplace
  remove taches-cc-resources` (real command: `claude plugin marketplace
  remove ...`) silently launched a full second agentic `claude` session
  instead of erroring — the CLI treats an unrecognized subcommand as a
  literal prompt string — and that nested session's own telegram-ng MCP
  connection collided with the main session's live Telegram poller (one
  poller per bot token), killing Telegram until a full restart. Detection
  is deliberately narrow (bare lowercase/hyphen first non-flag token only)
  so a quoted natural-language prompt passed to `claude` isn't
  misidentified as a subcommand attempt.

- `telegram-ng` (v0.11.2): MCP server instructions now include a "Tool
  preferences" section covering defaults that were previously undocumented
  or only living in one maintainer's own CLAUDE.md — typing indicator
  auto-starts on inbound messages so explicit `start_typing` is only for
  edge cases, `stream_draft` is a good default even for short replies,
  `format:'rich'` is preferred whenever a reply has code/commands/tables,
  incoming `message_reaction` events are informational and don't always
  need a response, and `edit_message` is for in-flight progress while
  `reply` is what should actually ping the user's device. Kept generic and
  portable on purpose — e.g. no fixed meaning is assigned to any reaction
  emoji, since that's a matter of personal taste any installer can tell the
  model themselves.

- `telegram-ng` (v0.11.1): MCP server instructions now tell the model to
  phrase choices/follow-up actions as tappable `/command`-style options
  instead of plain questions the user has to type an answer to. Confirmed
  live against a real Telegram client (2026-08-22) that command entities
  only recognize lowercase letters, digits, and underscores — a hyphenated
  option (`/handle-directly`) rendered as plain text while the
  underscore-joined one (`/trigger_restart`) rendered tappable — so the
  guidance explicitly calls out underscores for multi-word actions.

- `sandbox-manager` `plugin-version-check` hook (v0.11.0): now also blocks
  ending a turn where a plugin's `skills/` directory gained, lost, or
  renamed a skill (detected via `git status` add/delete/rename codes on
  `<plugin>/skills/*/SKILL.md`) unless README.md or
  `.claude-plugin/marketplace.json` changed in the same turn — a mechanical
  backstop for CLAUDE.md's skill-drift note, closing the exact gap that let
  three plugins go undocumented until the 2026-08-20 README audit caught it
  by hand. Built by `replicator:meditate`'s 2026-08-22 cycle (Step 2 inward
  candidate — the memory note itself reads as a repeatable check, not a
  one-time fact) as an extension of the existing hook rather than a new one,
  per the existing `skill_structural_by_plugin`/`docs_changed` gate; a plain
  content edit to an existing `SKILL.md` does not trigger it.

- `telegram-ng` (v0.11.0): inbound support for Telegram message reactions —
  `bot.on('message_reaction', ...)` delivers a `notifications/claude/channel`
  event whenever a paired sender reacts to (or unreacts from, or swaps a
  reaction on) any message the bot can see, gated through the same `gate()`
  allowlist as regular messages. Required explicitly listing
  `allowed_updates: ['message', 'callback_query', 'poll_answer',
  'message_reaction']` on `bot.start()` — Telegram's default update set
  silently excludes `message_reaction` unless requested, and specifying any
  `allowed_updates` list replaces rather than extends that default, so the
  three previously-implicit types had to be listed alongside it or they'd
  have silently stopped arriving too. New pure `formatReactionChange` helper
  in `inbound-context.ts` reads the old/new reaction sets and reports
  add/remove/swap in one sentence; no new message-id → text cache needed
  since the model already has its own sent messages (with their Telegram
  message_id) in its own transcript from the `reply` tool's return value.

- `sandbox-manager` `pane-io.sh` shared library (v0.10.0): a multiplexer-agnostic
  pane-control layer (`pane_io_active`, `pane_io_current_id`,
  `pane_io_current_cmd`, `pane_io_send`) that detects tmux vs herdr at runtime
  via `$TMUX`/`$HERDR_ENV`. All 9 session-control scripts
  (`restart-session`, `exit-session`, `background-session`, `branch-session`,
  `reload-plugins`, `rename-session`, `resume-session`, `export-session`,
  `compact-session`) now source it instead of calling `tmux` directly, so
  they work under either multiplexer without a hard cutover. `exit-session`
  additionally calls `herdr session stop` after sending `/exit` in herdr
  mode, since herdr — unlike tmux — doesn't tear a session down just because
  its pane's foreground process exited (a live-tested behavioral
  difference); without that explicit stop the container would never
  actually restart on `/exit`. Established test coverage for all 9 scripts
  via one shared-pattern test file each (previously only `compact-session`
  had a test).
- `jj` plugin: six new actionable skills (`commit`, `split`, `squash`,
  `cleanup`, `checkout`, `rebase`) for the everyday git-analogous operations,
  filling in `/jj:commit`, `/jj:split`, `/jj:squash`, `/jj:cleanup` which
  `working-with-jj/SKILL.md` referenced but never actually shipped, plus two
  new ones (`checkout`, `rebase`) since those are done meaningfully
  differently in jj than git. All six verified hands-on in a scratch jj repo
  before writing (non-interactive `jj split <paths>`, `jj squash -u`/`-m` to
  avoid the interactive-editor hang when both sides have descriptions, a
  real `jj rebase` producing an unresolved `(conflict)` commit without
  blocking, `jj new` vs `jj edit` per the jj FAQ's own recommendation and
  conflict-corruption warning, and `jj workspace forget`/`empty()` for
  cleanup). Also added the plugin's first `.claude-plugin/plugin.json`
  (v0.1.0 — it previously had none, hence `claude plugin list` showing a raw
  git commit hash instead of a semver version).
- `lightning` (new plugin, v0.1.0): wraps the official Alby MCP server
  (`@getalby/mcp`) to expose Lightning tools (`parse_invoice`, `pay_invoice`,
  `get_balance`, `lookup_invoice`, etc.) over Nostr Wallet Connect, wired to
  a self-hosted NWC-compatible wallet. Credentials load from
  `~/.claude/channels/lightning/.env` at MCP-server startup via a small
  shell wrapper (`.mcp.json` can't declare a secret-bearing env block for a
  third-party npx package). Built to give root CLAUDE.md's long-standing
  Lightning Payment Policy an actual tool to enforce against — those
  `parse_invoice`/`pay_invoice` names existed only as policy prose before.
- `sandbox-manager` `pay-invoice-guard` and `plugin-version-check` hooks
  (v0.9.0, `setup-hooks` skill): `pay-invoice-guard` (PreToolUse) blocks any
  `pay_invoice` call from the new `lightning` plugin unless the transcript's
  most recent inbound message came from the configured authorized Telegram
  chat — a mechanical backstop for the Lightning Payment Policy so a
  prompt-injection attempt can't talk the model into paying regardless of
  what the policy prose says. `plugin-version-check` (Stop) blocks ending a
  turn that changed a plugin's files without bumping its version, backstopping
  root CLAUDE.md's Plugin Versioning policy the same way `telegram-reply-check`
  already backstops the Telegram reply rule. Both are opt-in, not part of the
  default seven-hook install.
- `sandbox-manager` `post-restart-check` skill (v0.8.0): checks three
  failure modes that have each independently broken this workspace after a
  container restart — a dropped SSH commit-signing `.pub` file (auto-fixed
  by regenerating from the private key), a missing `docker-buildx-plugin`,
  and an ad-hoc `pip install` that vanished on rebuild. Built by
  `/replicator:meditate`'s 2026-08-16 cycle from a queue entry recorded
  2026-08-14, reinforced by a fourth SSH-pubkey recurrence on 2026-08-16.
- `repo-hygiene-sweep` (new plugin, v0.1.0): sweeps the workspace repo plus
  every standalone repo listed under root `CLAUDE.md`'s "Standalone repos"
  heading for uncommitted or unpushed work, using the right VCS per repo
  (`jj` vs `git`) rather than assuming one. Built by `/replicator:meditate`'s
  2026-08-16 cycle from a queue entry recorded 2026-08-14 (Cameri's literal
  "do we have any uncommitted files laying around?" ask on 2026-08-12).
- `sandbox-manager` `session-start-notify.py` (v0.7.0): `/resume` now sends
  its own Telegram notification ("Resumed session: &lt;name&gt;.") instead of
  being silently skipped — it resolves the friendly name from
  `~/.claude/sessions/*.json` (the same registry `telegram-ng`'s
  `/sessions` picker reads), falling back to the short session id when no
  name is on record. `compact` is still skipped (mid-conversation, not a
  real boundary). Requested by Cameri after a `/resume` gave no feedback
  that the switch had happened, 2026-08-17. TDD:
  `session-start-notify.test.sh` covers `build_notification_text` for all
  four source/lookup combinations.
- `telegram-ng` (v0.7.0): four Bot API 10.x-driven improvements. `start_typing`/
  `stop_typing` tools replace the old one-shot `sendChatAction` call at
  message receipt, which silently expired after ~5s and was never re-armed
  during long tool-use stretches — the receipt-time emoji ack (`ackReaction`)
  still covers "seen". Inbound `<channel>` meta now surfaces
  `reply_to_text`/`reply_to_user` (a quoted message's text/sender),
  `forwarded_from` (best-effort forward provenance), and `link_entities`
  (markdown-style hyperlink/mention targets not visible in `message.text`
  alone) — extracted via new pure helpers in `inbound-context.ts`. `reply`
  takes an optional `receiver_user_id` to send an ephemeral reply visible
  only to one group member instead of a normal group post (admin-path only
  for now — the bot must be a group admin, surfaced via a new cached
  `bot_is_admin` group meta flag; the 15s-reactive/`ephemeral_message_id`
  fallback path was scoped out as a follow-up). New `stream_draft` tool
  wraps `sendMessageDraft` to stream a live 30s-ephemeral "composing"
  preview in private chats before `reply` persists the final text.
- `telegram-ng` (v0.7.1): live-verified all four v0.7.0 features in a real
  group (typing indicator surviving >5s, reply/forward context, link
  entities, ephemeral `receiver_user_id` replies once the bot was promoted
  to admin). Documented that an ephemeral `reply` returns `message_id: 0`
  in the API response — expected, since Telegram doesn't persist these as
  normal messages, not an error.
- `telegram-ng` (v0.8.0): `send_poll`/`stop_poll` tools. Polls default to
  non-anonymous so votes can be attributed (Telegram only reports a voter
  for non-anonymous polls); supports `allows_multiple_answers` and a
  `quiz` type with `correct_option_id`. Each inbound vote/retraction
  arrives as its own `<channel>` notification via a new `bot.on('poll_answer',
  ...)` handler — since `PollAnswer` updates carry no `chat_id`, `send_poll`
  tracks `poll_id → {chat_id, options}` in memory to route and render them.
  These notifications are informational only (no reply/react expected per
  vote, per explicit product decision) — documented in the MCP instructions
  block. New `formatPollAnswer` pure helper in `inbound-context.ts`,
  unit-tested.
- `telegram-ng` (v0.9.0): `handleInbound` now calls the existing `startTyping`
  helper itself as soon as a message passes the access gate and isn't a
  permission-reply intercept, instead of waiting for Claude to decide to
  call the `start_typing` tool. Placed after the permission-reply
  short-circuit specifically so that path (which never sends a `reply`)
  can't leave a typing indicator re-firing forever with nothing to clear
  it — every other path already stops it via `reply`'s existing
  `stopTyping` call. Prompted by Cameri wanting typing-indicator-first as
  the standing default for every Telegram turn (see phoenix-server
  `CLAUDE.md` Telegram Communication section) without relying on the model
  to remember to call the tool.
- `telegram-ng` (v0.10.0): new `bot-api-reference` skill — a curated, offline
  reference to the Telegram Bot API surface (`updates-and-polling`,
  `messages-and-entities`, `groups-and-privacy`, `files-and-media`,
  `inline-keyboards-and-callbacks`), sourced from a live fetch of
  https://core.telegram.org/bots/api and https://core.telegram.org/bots/features
  on 2026-08-18 (Bot API 10.2), so future changes to `server.ts` don't require
  re-fetching and re-reading the full upstream spec from scratch. Intentionally
  skips 10.x features `telegram-ng` doesn't use (Rich Messages, Gifts, Stories,
  Business accounts, Suggested Posts, Passport, Games, Payments).

### Changed
- `docker-maintenance` renamed to `container-management` (v0.2.2): plugin
  dir, inner skill dir, `plugin.json`/`SKILL.md`/marketplace entry, and all
  cross-references (root README, containers/AGENTS.md) updated to the new
  name. No functional change — same workflows, same routing.

- `telegram-ng` (v0.6.0): replaced the `/sessions` picker's hand-rolled
  `InlineKeyboard` + `bot.on('callback_query:data', ...)` regex dispatch
  with the official `@grammyjs/menu` plugin (`sessions-menu.ts`,
  `server.ts`). Same user-visible behavior — authorization check, the
  'dismiss'/'current' no-ops, and the resume dispatch to
  `resume-session.sh` — now expressed as a `Menu` with a `.dynamic()` range
  that re-scans transcripts on every render. One judgment call: the plugin's
  default staleness check hashes each button's rendered label against the
  label at press time, and since our labels embed a relative timestamp
  ("5m ago"), that would flag almost every delayed press as "outdated" — a
  regression the old keyboard never had, since it always just acted on the
  id baked into the button at send time. Disabled via
  `onMenuOutdated: false` to keep that exact "act on the embedded payload,
  no staleness check" behavior. Also switched `autoAnswer: false` and
  answer every callback ourselves, since the plugin's default auto-answer
  fires concurrently with (and could race) our own labeled
  `answerCallbackQuery` calls ('Resuming…', 'Not authorized.', etc.). The
  `perm:`/`idle:` inline keyboards (permission requests, idle sentinel) are
  a separate flow and were left untouched.

### Fixed
- `cronjobs` (v0.0.4): the MCP server's `Cron` scheduler was constructed with
  a hardcoded `timezone: "UTC"`, so every job — including natural-language
  ones like "every day at 3am" whose whole point is to hide cron's UTC
  assumption — actually fired in UTC regardless of the container's `$TZ`
  (`America/Toronto` here). A "3am" job fired at 3am UTC (11pm ET the prior
  night), a "8am" job fired at 4am ET, etc. — a consistent 4-5h-early offset
  depending on DST. Root-caused live on 2026-08-18 after three jobs
  (`replicator:meditate`, the Claude-version-update check, its 8am
  restart-reminder) all showed the same offset. Now resolves the scheduler's
  timezone from `$TZ` (falling back to the JS runtime's local timezone) once
  at startup and passes it to every `Cron` instance, including the
  `add-job` probe used to compute the `nextRun` shown back to the caller.
  Requires restarting the `cronjobs` MCP server (e.g. `/reload-plugins` or a
  session restart) to pick up the fix — existing jobs' stored cron
  expressions need no migration, they're timezone-agnostic strings that
  just get interpreted correctly once the server restarts.
- `replicator` (v0.7.1): `meditate` skill's Step 7 commit instructions still
  told the cycle to commit `docs/replicator/` via `jj` from the workspace
  repo. `docs/` was split into its own standalone git repo
  (`git@github.com:cameri/docs.git`) on 2026-08-16 and is now `.gitignore`d
  from the workspace repo — following the stale instructions verbatim would
  silently no-op (`jj status` sees nothing under a gitignored path) and
  leave the ledger/trace uncommitted. The 2026-08-16 cycle happened to catch
  this itself and committed correctly via `git`, but the written
  instructions never got updated to match; fixed now so a future cycle
  doesn't have to re-derive it. Caught live during the 2026-08-18 cycle.
- `telegram-ng` (v0.9.2): fix stale comment claiming sandbox-manager scripts only self-detect tmux panes; comment now documents that both `$TMUX`/`$TMUX_PANE` (tmux) and `$HERDR_ENV`/`$HERDR_PANE_ID` (herdr) env vars work identically, with the actual multiplexer detection logic in the `sandbox-manager` scripts themselves (see `pane-io.sh`).
- `telegram-ng` (v0.9.1): the `/sessions` picker's "current" flag relied on
  `CLAUDE_CODE_SESSION_ID` matching a transcript filename — broken the
  moment a session is resumed after an `/exit`-triggered restart, since the
  new process's env var no longer matches the transcript file actually
  still being appended to (verified live: the resumed conversation kept
  growing under its original id while the fresh process reported a
  different one). The real live session showed up as a distinct, seemingly
  resumable "previous session" instead of "(current)"; tapping it fired a
  pointless self-resume with no visible effect. `pickRecentSessions` (in
  `sessions-menu.ts`) now derives "current" from recency alone — the single
  freshest transcript by `mtimeMs` — dropping the `currentSessionId`
  parameter and its env-var call site entirely. Found by Cameri, 2026-08-17,
  right after restarting to pick up the v0.9.0 typing change above.
- `sandbox-manager` `telegram-reply-check.py` (v0.6.3): the Stop hook that
  forces a reply before ending a Telegram-originated turn didn't distinguish
  the new `telegram-ng` v0.8.0 `poll_answer` notifications (informational
  by design — "voted for: ..." / "retracted their vote") from real inbound
  messages, so it mechanically forced a reply on every single vote. Now
  detects a `poll_id="` attribute in the channel tag and skips the
  reply requirement for that notification specifically; a later real
  message still requires its own reply as before. Found by Cameri,
  2026-08-16, right after polls shipped.
- `telegram-ng` (v0.6.1): the idle-detection prompt ("⏸ Quiet for a while...")
  broadcast to every chat_id in the allowlist, not just whoever was actually
  talking — so an unrelated allowlisted contact got pinged for a
  conversation that wasn't theirs. `idle-state-tracker.py` (the Stop hook
  that writes `idle-state.json`) now scans the transcript for the most
  recent inbound Telegram channel tag and records its `chat_id`;
  `checkIdle()` sends only to that chat, falling back to the full allowlist
  only when no chat_id could be determined (e.g. the last activity wasn't
  Telegram-sourced). Found by Cameri, 2026-08-16.
- `telegram-ng` (v0.3.1): `SCRIPT_COMPACT`/`SCRIPT_CLEAR`/`SCRIPT_RENAME`/
  `SCRIPT_RESUME` were hardcoded to a dev-checkout path
  (`/workspace/projects/skills/sandbox-manager/...`), so every exec of
  these scripts silently failed on a normal marketplace install — including
  every `/sessions` inline-keyboard click, since `handleSessionSelect`
  shells out to `SCRIPT_RESUME`. Now resolved from
  `~/.claude/plugins/installed_plugins.json` at startup (versioned
  plugin-cache path), with the old hardcoded path kept as a dev-checkout
  fallback. Thanks to @baymax-agent (PR #1).
- `sandbox-manager` `setup-hooks` `install-hooks.py` (v0.6.2): the
  idempotency check compared literal `"python3 <path>"` command strings, so
  an existing tilde-form entry (`~/.claude/hooks/x.py`, the style every
  other hand-written hook in this instance's `settings.json` uses) never
  matched a freshly generated absolute-path entry pointing at the same
  script — producing a duplicate registration on every reinstall. Found
  immediately after the v0.6.1 symlink fix, on the very next dogfood run.
  `merge_hook_group()` (and the `statusLine` comparison) now resolve each
  command's script path with `expanduser()` + `realpath()` before comparing,
  so different spellings of the same real file are recognized as identical.
- `sandbox-manager` `setup-hooks` `install-hooks.py` (v0.6.1): `write_json()`
  used `os.replace()` directly on the caller-supplied path, which unlinks a
  symlink and drops a plain file in its place if `--settings-path` (or
  `--config-path`) pointed at one — silently detaching the write from a
  git-tracked canonical copy behind a symlink, and duplicating hook entries
  on the next run since the two files' contents then diverged. Found by
  dogfooding the skill against this instance's own symlinked
  `~/.claude/settings.json`. Now resolves `os.path.realpath()` first and
  writes through to the real target.

### Added
- `telegram-ng` (v0.5.0): wired up the official `@grammyjs/auto-retry`
  plugin so every `bot.api.*` call (sendMessage, editMessageText,
  sendPhoto, setMessageReaction, etc.) transparently retries on Telegram
  429 flood-control and transient 5xx responses, honoring the `retry_after`
  hint. The existing retry loop around `bot.start()` only covered the
  initial long-polling connection — it did nothing for proactive
  notifications (cron jobs, GitHub webhooks, finance reports) failing once
  the bot was already running. Registered via
  `bot.api.config.use(autoRetry())` right after the bot is constructed,
  using the plugin's defaults.
- `sandbox-manager` `setup-hooks` skill (v0.6.0): installs a curated set of
  7 Claude Code hooks (destructive-`rm` guard, channel-reply-enforcement
  Stop hook, usage-threshold Telegram alerts, idle-state tracker, session
  handoff-doc reader, new-session Telegram notifier, statusline
  usage-cache wrapper) into `~/.claude/settings.json`, idempotently via
  `scripts/install-hooks.py`. Bundled hook scripts carry no secrets or
  hardcoded personal paths — chat ID, bot-token `.env` path, timezone, and
  handoff-doc path are gathered at install time and stored separately in
  `~/.claude/channels/sandbox-manager/hooks-config.json` (mode 600).
- `tools` field on every `marketplace.json` plugin entry (`["claude"]` or
  `["claude", "cursor"]`), marking which plugins work under Cursor:
  `paperless`, `actual-budget`, `technitium-dns`, `home-assistant`,
  `wallabag`, `elevenlabs`, `nats`, `docker-maintenance`, `finance-manager`.
  Channel plugins and `netshoot` stay Claude-only. No plugin content changed
  — Cursor already reads the same `SKILL.md`/`.mcp.json` shape this repo
  uses, so this is metadata + docs only.
- README.md: `Tools` column on the plugin table, and a new "Installing for
  Cursor" section documenting the skill-dir symlink step and the (rare)
  MCP-server registration step for Cursor.

### Fixed
- README.md: was still referring to itself as `claude-skills` post-rename —
  fixed the title, the `git clone`/`npx skills` examples, and the
  `/plugin install` command list (including a stale `scheduler` reference
  that should have said `cronjobs`) to the current `skills` repo /
  `cameri-skills` marketplace names. Also added the `netshoot` plugin row,
  missing from the table entirely (unrelated pre-existing gap, found while
  touching this table).
- Root README.md: renamed the stale `scheduler` plugin references to
  `cronjobs` (the plugin was renamed a while back but the README and the
  `cronjob` skill's own quick_start examples still said `scheduler`/
  `/schedule-task`). Also added the 7 plugins missing from the root plugin
  table and skill-reference sections entirely: autoresearch,
  docker-maintenance, home-assistant, jj, nostr, telegram, telegram-ng.
- Leftover `claude-skills` references in per-plugin docs (journal, cronjobs,
  telegram-ng, sandbox-manager, nats, webhooks, github-manager, autoresearch,
  agent-resources) fixed to the `cameri-skills` marketplace / `cameri/skills`
  repo names; `optimize-skill`'s example path corrected to `projects/skills/`.
  All nine plugins bumped (patch).

## [agent-resources 0.1.1] - 2026-08-22

### Fixed
- 4 references using `@skills/create-agent-skills/...` / `@skills/create-subagents/...`
  path syntax (`agents/skill-auditor.md`, `agents/subagent-auditor.md`,
  `skills/create-subagents/SKILL.md`,
  `skills/create-subagents/references/writing-subagent-prompts.md`) — that
  syntax resolved in the source `taches-cc-resources` fork, where `skills/`
  sat at repo root, but silently failed to resolve once this content moved
  into a plugin, degrading `audit-skill`/`audit-subagent` to memory-based
  auditing instead of reading the real reference docs they dispatch to.
  Replaced with `${CLAUDE_PLUGIN_ROOT}/skills/...`, the convention already
  used elsewhere in this repo (e.g. `create-hooks/SKILL.md`).
- `create-agent-skills/workflows/create-domain-expertise-skill.md` (a live
  workflow routed to from `SKILL.md` in 3 places) referenced `create-plans`,
  a skill that was explicitly dropped from this migration's scope and isn't
  shipped anywhere in this repo — a "Step 11: Document in create-plans"
  section plus 7 other mentions. Reframed the step as cross-referencing
  "a project-planning skill, if you have one installed" instead of naming a
  specific nonexistent skill; the underlying domain-expertise-authoring
  workflow itself is unaffected and still fully usable.
- README.md: the root plugin table's `research-tools` row and
  `.claude-plugin/marketplace.json`'s `research-tools` entry were both marked
  `Claude + Cursor`, but all 6 of its skills declare
  `allowed-tools: WebSearch, WebFetch` — Claude Code tools with no Cursor
  equivalent — so it's actually Claude-only. Corrected both, and updated the
  root README's Cursor-support summary sentence (stale count/list — it had
  never been updated when `consider` and `research-tools` landed as
  Claude+Cursor) to the recounted total of 12 plugins.
- `README.md` (this plugin's own): removed the sentence naming the private
  intermediate fork (`phoenix-server/taches-cc-resources`) — that repo isn't
  visible to anyone installing this plugin, isn't required by the MIT
  license (which only requires preserving the real upstream project's
  copyright notice), and directly contradicted this plugin's own
  `create-agent-skills/references/portability.md` "no hardcoded repo names"
  rule. Now credits the real upstream project under its MIT license
  (Copyright (c) 2025 Lex Christopherson), matching `consider/README.md`'s
  existing style.

## [consider 0.1.1] - 2026-08-22

### Fixed
- No functional change; version bump only, to keep this plugin's own README
  consistent with `agent-resources` and `research-tools` in how it credits
  the upstream project (it already avoided naming the private intermediate
  fork, so no wording change was needed here).

## [research-tools 0.1.1] - 2026-08-22

### Fixed
- `README.md`: removed the sentence naming the private intermediate fork
  (`phoenix-server/taches-cc-resources`) in favor of crediting the real
  upstream project under its MIT license (Copyright (c) 2025 Lex
  Christopherson) — same fix and rationale as `agent-resources 0.1.1`.
- `.claude-plugin/marketplace.json`: `tools` field corrected from
  `["claude", "cursor"]` to `["claude"]` — all 6 skills declare
  `allowed-tools: WebSearch, WebFetch`, which have no Cursor equivalent.

## [sandbox-manager 0.12.0] - 2026-08-22

### Added
- 3 new skills migrated from taches-cc-resources: `whats-next` (handoff-doc
  writing — already the format this session's own whats-next.md handoffs
  use), `add-to-todos` and `check-todos` (direct support for the TO-DOS.md
  convention documented in root CLAUDE.md). Part of retiring the
  taches-cc-resources marketplace.

## [agent-resources 0.1.0] - 2026-08-22

### Added
- New plugin: `agent-resources`, migrated from the `taches-cc-resources` fork
  (`phoenix-server/taches-cc-resources`, MIT-licensed). 7 skills
  (create-agent-skills, create-hooks, create-mcp-servers, create-subagents
  copied as-is; audit-skill, audit-subagent, heal-skill authored fresh from
  thin slash commands into real trigger-worthy skills) and 2 subagents
  (skill-auditor, subagent-auditor). Part of retiring the separate
  taches-cc-resources marketplace — see
  `docs/superpowers/specs/2026-08-22-agent-resources-migration-design.md`.

## [consider 0.1.0] - 2026-08-22

### Added
- New plugin: `consider`, migrated from the `taches-cc-resources` fork. Folds
  7 of that project's 12 `/consider:*` slash commands (inversion,
  first-principles, second-order, pareto, via-negativa, opportunity-cost,
  eisenhower-matrix) into a single auto-triggering router skill instead of 7
  separate commands, so it can trigger on a real decision/tradeoff moment
  without being asked by name, and without 7 near-identical skills competing
  to auto-trigger on the same kind of moment. Part of retiring the separate
  taches-cc-resources marketplace.

## [research-tools 0.1.0] - 2026-08-22

### Added
- New plugin: `research-tools`, migrated from the `taches-cc-resources` fork's
  `/research:*` slash commands. 6 skills — competitive, deep-dive,
  feasibility, landscape, options, technical — each authored fresh from a
  thin `$ARGUMENTS`-driven command into a full SKILL.md with its own
  workflow and success criteria grounded in what that command actually
  asked for. Unlike `consider` (Task 2), these stay as 6 separate skills
  rather than being folded into one router, and every one of them is
  deliberately explicit-invocation-only rather than auto-triggering:
  real research burns real tokens (web search/fetch across multiple
  sources), and this workspace's own Usage Awareness norm is not to start
  expensive, open-ended work unprompted. Part of retiring the separate
  taches-cc-resources marketplace.

## [audiobookshelf 0.1.0] - 2026-08-22

### Added
- New plugin: `audiobookshelf`, for interacting with a self-hosted Audiobookshelf
  instance via its REST API (Bearer-token auth). Two skills: `access` (save
  server URL + API key to `~/.claude/channels/audiobookshelf/.env`, test the
  connection) and `query-library` (list libraries, browse/search items, view
  item details, check listening progress), following the same pattern as
  `technitium-dns`/`actual-budget`. Built while standing up a real instance
  with an empty library — `GET /api/libraries`, `GET
  /api/libraries/<id>/items`, and `GET /api/me` were live-verified; per-library
  search, item details, series, authors, and progress updates are documented
  from Audiobookshelf's public API reference but not yet live-verified (no
  items existed to test against), and the skill says so explicitly rather than
  presenting them as confirmed.

## [replicator 0.7.3] - 2026-08-22

### Fixed
- `agents/quarantine.md` and `meditate/SKILL.md`: split the outward-scan
  quarantine agent's single 1-5 `SCORE` into two independent axes — a new
  `SAFETY: <clear|flagged>` line (set only when one of the six hard-flag
  categories is present) and a `SCORE` that now purely rates
  skill-worthiness, with 3-4 explicitly documented as the ordinary result
  for a safe source with nothing skill-shaped to report. Previously a low
  score meant both "nothing new" and "actually dangerous" with no way to
  tell which from the number alone, which forced the outward-scan step
  into an unscripted judgment call three cycles running (2026-08-18,
  2026-08-19, 2026-08-22) to avoid false-positive blocklisting legitimate
  frontier-research sources. `meditate`'s Step 3 now branches on `SAFETY`
  first for the active-defense/blocklist decision; `SCORE` only decides
  watchlist inclusion among `SAFETY: clear` results.

## [nats 0.0.6] - 2026-08-21

### Fixed
- `README.md` and `server.ts`: the credential skill was renamed to `access`
  a while back, but this plugin's own README quick-start/skill table and two
  runtime error/help strings in `server.ts` still told users to run the
  nonexistent `/nats:configure` — found via a `graphify` knowledge-graph pass
  over the whole `skills` marketplace, which flagged the README's reference
  as an AMBIGUOUS edge. Corrected all four to `/nats:access`.

## [wallabag 0.0.3] - 2026-08-21

### Fixed
- `README.md` and `skills/save-url/SKILL.md`: same drift as `nats` above,
  also caught by the `graphify` pass. The README quick-start still referenced
  the pre-rename `/wallabag:configure` and `/wallabag:save`; `save-url`'s own
  SKILL.md pointed users at a third, never-existent `/wallabag:configure-wallabag`
  in three places. Corrected all to the real skill names, `/wallabag:access`
  and `/wallabag:save-url`.

## [telegram-ng 0.3.0] - 2026-08-15

### Added
- `/usage` bot command: replies with current context-window and Claude
  subscription rate-limit usage on demand, reading the same
  `~/.claude/session-status-cache.json` cache `statusline-wrapper.py` writes
  on every statusline render (the same source `usage-alert.py`'s Stop hook
  polls for threshold-crossing pushes) — no band/threshold logic, just
  "what does the cache say right now." Pure formatting lives in new
  `usage-cache.ts` (`formatUsageMessage`, 7 tests), gated the same way as
  `/status`/`/sessions` (paired senders only). Flags a stale cache (>1h old)
  rather than silently showing outdated numbers, but still shows them —
  an on-demand pull deserves an answer, not silence, unlike the passive
  push case which can just skip a turn.

## [replicator 0.7.0] - 2026-08-15

### Added
- Second publish channel: `gist-publisher.ts`'s `GistPublisher` (implements
  the same `Publisher` interface Nostr does) mirrors the gene registry to a
  single GitHub gist, updated in place via `gh api gists`/`PATCH` (id/URL
  persisted to a new `docs/replicator/gist.json` on first creation, so
  later cycles get a stable URL instead of a new gist every week). Unlike
  Nostr's replaceable events, a gist file has no persistence of its own
  between writes — `publish-cycle.ts`'s new `buildGistSnapshot` therefore
  builds the *full* current public-gene set every cycle rather than
  `buildPublishPlan`'s delta, or previously-published genes would silently
  vanish from the file on the next update. Files: `profile.json`,
  `core.json`, `active.json` (flat key arrays, the Nostr `a`-tag pointers
  dropped since they're meaningless outside Nostr), `genes.json` (every
  gene's redacted record, keyed by gene key). The gist is a best-effort
  mirror, not the authoritative registry: its failure is logged but never
  blocks `cycles.lastPublish`, which stays gated on the Nostr publish
  alone. `--dry-run` now previews both channels.

## [replicator 0.6.1] - 2026-08-15

### Fixed
- Nostr publishing rate-limited mid-publish on the real first live attempt:
  `wss://relay.damus.io` returned "rate-limited: you are noting too much"
  after ~15 of 127 records went through, because `NostrPublisher.publish()`
  fired every record concurrently via `Promise.all`. Changed to sequential
  publishing with a 300ms pace between records (`NostrPublisher`'s new
  `delayMs` constructor param, default 300).
- Default relay list: dropped `wss://offchain.pub` (rejected every event
  outright with "pubkey is not in our web of trust" — a structural gate on
  new identities, not fixable by pacing or content). Replaced with 4 relays
  verified live (both HTTP/NIP-11 reachability and an actual test publish of
  a real kind-0 and kind-32100 event) to accept unvetted writes:
  `wss://nos.lol`, `wss://relay.primal.net`, `wss://nostr.mom`,
  `wss://relay.snort.social`. (`api.nostr.watch`'s relay-discovery API was
  down — 502 on every endpoint at the time — so relays were sourced from the
  ecosystem's commonly-cited public write relays and verified directly
  instead.) `wss://purplepag.es` and `wss://nostr21.com` were also tried and
  dropped: the former only accepts profile-shaped kinds (0/3/10002) and
  rejects the replicator's custom kinds outright, the latter rejected the
  test publish with no reason given.

## [replicator 0.6.0] - 2026-08-15

### Added
- Publish-time repo-visibility gate: `repo-visibility.ts` + a new
  `docs/replicator/repo-visibility.json` state file mapping each installed
  plugin to its source repo's public/private status. `buildPublishPlan` now
  filters the ledger down to only genes whose plugin is confirmed to live in
  a public repo before building gene records or the core/active lists — a
  gene with no entry in the map (unknown source) is excluded by default,
  fail-closed. New maintenance script `scripts/check-repo-visibility.ts`
  (re-run whenever a plugin/marketplace is added, or periodically) derives
  the map from `~/.claude/plugins/{installed_plugins,known_marketplaces}.json`
  plus a small manually-curated list for non-marketplace sources (the
  `printing-press-*` family, cloned standalone from `mvanhorn/cli-printing-press`
  rather than installed via a marketplace). Prompted by Cameri: the first
  real dry-run would have published Claude Code's own built-in skills
  (`code-review`, `dataviz`, `slash:*`, etc. — not from any repo at all) and,
  more importantly, would have silently included a private-repo variant had
  one existed — confirmed live against this workspace's own `unfurl` gene,
  which turned out to be sourced from the private `phoenix-server` repo's
  `.claude/commands/unfurl.md` (a materially different file from the public
  `cameri/skills` copy of the same name) and is now correctly excluded by
  the fail-closed default rather than by having been caught by inspection.

## [replicator 0.5.0] - 2026-08-15

### Fixed
- Nostr publishing: `nostr-publisher.ts` opened a fresh `Relay.connect` per
  event per relay — against the real 152-gene ledger's first publish (155
  records × 2 relays) that's 310 simultaneous connections, which public
  relays rate-limit. Replaced with a single `SimplePool` reused for the
  whole publisher's lifetime, collapsing it to one connection per relay
  URL regardless of record count. Added `NostrPublisher.close()`, called
  from `scripts/publish-cycle.ts` after the publish call so the process
  exits instead of hanging on open sockets.
- Relay-rejection formatting: nostr-tools relay/pool operations can reject
  with a plain string, not an `Error` — the previous
  `.catch((err: Error) => ...${err.message})` pattern produced the literal
  text "undefined" in failure reasons. Fixed to handle both shapes.
- `meditate/SKILL.md`: swapped Step 6 (Publish) and Step 7 (Trace) — Publish
  now runs and updates the ledger *before* the commit/push step, so a real
  publish cycle no longer leaves the workspace repo dirty, and the
  trace/Telegram summary can report Publish's own outcome. Fixed the
  intro's stale "six-step cycle" to "seven-step cycle."
- `selectChangedGenes` (`publish-cycle.ts`): `cycles.lastPublish` is a
  date-only string (`"2026-08-15"`) but was compared lexicographically
  against full-ISO event timestamps (`"2026-08-15T02:43:39Z"`), spuriously
  re-selecting every gene that changed on the same calendar date as the
  last publish as "changed" again. Now compares date portions only.
- `lists.ts`'s `buildLists`: NIP-51-style lists carried bare
  `['g', '<plugin>:<skill>']` tags with no pointer to the actual gene
  event. Now also emits `['a', '<kind>:<pubkey>:<key>']` per listed gene,
  resolving to the real addressable gene record. Signature changed to
  `buildLists(ledger, pubkeyHex)`.
- Stale Phase-2 documentation in `replicator/README.md` and
  `replicator/.claude-plugin/plugin.json` — both said registry/publishing
  was "not built yet"; now reflect that it exists (cross-replicator voting
  and adoption still don't).

### Added
- `buildPublishPlan(ledger, speciesName, pubkeyHex)` (`publish-cycle.ts`)
  — extracts the gene+list+profile record assembly previously inlined in
  `scripts/publish-cycle.ts` into a pure, tested function; the script is
  now a thin shell around it.
- `--dry-run` flag on `scripts/publish-cycle.ts`: prints the full publish
  plan (label, kind, dTag, tag count, content) without constructing a
  `NostrPublisher`, making any network call, or mutating the ledger.

## [replicator 0.3.0] - 2026-08-15

### Added
- Routines/habits: a third meditation outcome for `/replicator:meditate` alongside skill-build and memory-fact — recurring, composite patterns spanning multiple skills/non-skill actions in service of one recurring goal, repeatable and identity-shaped ("something we do/are") rather than a single invocable step. Adds a three-way test to Step 2 (skill candidate / memory fact / routine candidate), a note in Step 4 that routine candidates skip the build queue, a "Routines" trace subsection in Step 6, and a new `docs/replicator/routines.md` state file (name / what it is / why it recurs / status: candidate|adopted|maintained|sunset / decision log). Revisiting an existing routine is evidence-driven (Step 2's existing transcript scan, narrative matching — no new grep machinery), not a scheduled per-cycle review. Graduation between routines and skills works both directions, always Cameri-confirmed, never automatic. Design: `docs/superpowers/specs/2026-08-14-replicator-design.md` "Routines (habits)" section.

## [telegram-ng 0.1.0] - 2026-08-13

### Added
- New plugin: `telegram-ng`. Straight fork of Anthropic's official `telegram`
  plugin (claude-plugins-official, v0.0.6) — same server.ts/grammy
  implementation, ACCESS.md, and access/configure skills, with all
  `/telegram:*` command references renamed to `/telegram-ng:*` so it doesn't
  collide with the official plugin's tools. Credential path
  (`~/.claude/channels/telegram/`) deliberately left unchanged so it shares
  the same bot token/access list at cutover time. No functional changes from
  upstream. The existing `telegram/` plugin (skills-only, no MCP server — it
  predates this fork and was never wired up) is untouched. Not yet enabled;
  the official plugin remains the live driver for this workspace pending a
  follow-up cutover pass.

## [finance-manager 0.11.0] - 2026-08-12

### Changed
- Portability/OSINT sweep: replaced real names, a real institution (RBC),
  real account/wallet UUIDs, a real cron job ID, and brand-specific wallet
  examples (Bitkey/ShakePay/Ledn) throughout `setup-finance-manager`,
  `manage-paperless-workflows`, `reconcile-statement`, and `query-mempool`
  with generic placeholders. Added a `reporting.telegram_chat_id` field to
  `config.json` (see `setup-finance-manager/references/config-schema.md`)
  and routed every skill that previously hardcoded a literal Telegram chat
  ID through it instead. Genericized hardcoded Canada/RRSP/TFSA/CAD
  assumptions in `review-finances` to read the household's jurisdiction and
  base currency from `docs/finance/financial-profile.md`, consistent with
  how `financial-planner.md` already worked. No behavior change for the
  workspace this plugin was built in — `docs/finance/` still supplies all
  the same real data at runtime.

## [simple-english 1.0.0] - 2026-08-09

### Added
- New plugin: `simple-english`. Writes and rewrites technical text with
  ASD-STE100 Simplified Technical English — classifies text as procedural or
  descriptive, applies the standard's 53-rule catalog (20/25-word sentence
  limits, one word one meaning, simple tenses, active voice, condition
  before command), and runs a mandatory self-check before delivering.
  Promoted from the workspace-level `.agents/skills/simple-english` skill
  into the marketplace so it's available as a portable plugin.

## [executable-skepticism 0.1.0] - 2026-08-05

### Added
- New plugin: `executable-skepticism`. Verification protocol for evaluating
  theories, papers, models, or any confident quantitative claim (including
  Claude's own) by routing the verdict through executable, falsifiable tests
  instead of prose — operationalize the claim, register numbered numeric
  predictions before running any code, execute deterministically (preferring
  the user's own hands), then adjudicate symmetrically with failures first
  and derived-vs-installed results called out.

## [finance-manager 0.10.0] - 2026-08-08

### Added
- `query-mempool`'s `mempool_cli.py descriptor` now paces successive address
  lookups with a `--request-delay` (default 0.5s) instead of firing requests
  as fast as possible and only reacting after a 429 — proactive, not just
  reactive, since mempool.space doesn't publish its rate-limit thresholds.
- 429 responses that carry a `Retry-After` header (delta-seconds or HTTP-date)
  now have that value honored in place of the exponential backoff schedule,
  bounded by a new `RATE_LIMIT_MAX_SLEEP_SECONDS` (60s) ceiling so a malformed
  or hostile value can't hang the CLI. Falls back to the existing 1s/2s/4s
  exponential schedule when the header is absent, as before.
- `descriptor` results now report `last_scanned_index` (the highest address
  index actually checked across all branches), and a new `--start-index` flag
  lets a caller resume scanning from there next run instead of re-deriving
  and re-querying every address from 0 — for a wallet that never reuses
  addresses, a full re-scan on every check is pure waste once the used-address
  frontier is known.
- Prompted by a real Bitkey wallet check repeatedly timing out at gap-limit
  60-100 (needed to cover the wallet's 55 known-used addresses) even after
  the existing exponential-backoff/fallback-provider mitigations.

## [finance-manager 0.8.0] - 2026-07-26

### Added
- `query-mempool`'s `mempool_cli.py` now retries HTTP 429 (rate limited) responses
  with exponential backoff (1s/2s/4s, 3 retries by default) before giving up on a
  provider, and automatically falls back to Blockstream's Esplora
  (`blockstream.info/api`) for mainnet/testnet when mempool.space is still
  rate-limited or unreachable - same API shape, no API key needed, so it's a
  drop-in base-URL swap. Signet has no public fallback. An explicit `--api-url`
  disables fallback entirely (assumed to mean "use exactly this instance").
  Prompted by hitting mempool.space's rate limit repeatedly during a real Bitkey
  wallet reconciliation (paging through descriptor-derived addresses).

## [finance-manager 0.7.3] - 2026-07-26

### Added
- `reconcile-statement` workflow and `backfill-verification.md` now capture three
  more lessons from a second same-day reconciliation (RBC Mastercard, ~6-month
  payment-sync gap): (1) a confirmed hypothesis about *which* transaction type
  stopped syncing can mask a second, smaller dropout of a different type in the
  same months — diff every statement line regardless; (2) prefer linking an
  already-synced-but-unlinked counterpart transaction found in another tracked
  account over inserting a fresh transfer pair; (3) the transfer-linking danger
  note now cross-references the CLI's flush-after-every-write requirement, since
  linking one pair takes two sequential `transactions update` calls and it's easy
  to batch them without flushing between. Also documents that reconciling against
  a live (not-yet-statemented) "current balance" only supports spot-checking, not
  chain verification — small residuals from pending/uncleared transactions are
  expected there, not reconciliation errors.

## [finance-manager 0.7.2] - 2026-07-26

### Added
- `reconcile-statement`'s `backfill-verification.md` now documents diagnosing
  scattered drift on an already-live-synced account (sync silently dropping
  specific transactions in specific months, not a clean multi-month gap): find a
  self-consistent checkpoint boundary instead of assuming a backfill must reach
  account inception, then diff each period's own net change against
  ActualBudget's to pinpoint exactly which months need attention before touching
  any data. Derived from a real reconciliation (RBC Chequing Arturo, 2026-07-26)
  that fixed a ~$25,500 drift this way.

## [journal 0.1.1] - 2026-07-25

### Fixed
- `extract_sessions.py`'s `collect_digest` now guards the mtime pre-filter's `stat()`
  call against `OSError` (a transcript deleted/rotated mid-scan no longer crashes a
  cold-start reconstruction).
- `update-journal` SKILL.md's write step now instructs re-verifying `status: open`
  immediately before any edit, tightening the closed-journal-immutability invariant.
- `test_extract_sessions.py`'s subprocess CLI test now has a 30s timeout.

Findings from the final whole-branch review of the initial implementation — see
`docs/superpowers/plans/2026-07-25-journal-plugin.md`.

## [journal 0.1.0] - 2026-07-25

### Added
- New `journal` plugin: `update-journal` skill keeps a series of narrative journals
  at `docs/journal/` in the workspace repo, written from Claude's own perspective by
  reading session transcripts across every project on this machine (via the new
  dependency-free `extract_sessions.py`) plus the memory system. Journals are
  manually invoked, cycle-boundary judgment is a per-run call (not a fixed
  schedule), and a closed journal is never edited again.

## [sandbox-manager 0.4.2] - 2026-07-24

### Fixed
- `manage-plugins`: clarified that `claude plugin marketplace update` only refreshes a
  marketplace's manifest and does **not** pull a new version of an already-installed plugin
  into the cache — confirmed by testing (updated the marketplace, `claude plugin list` still
  showed the stale version, and only `claude plugin update <plugin-name>@<marketplace-name>`
  actually pulled the new one in). The workflow now always follows a marketplace update with
  a plugin update when the goal is making the latest changes usable, not just checking what's
  available.

## [sandbox-manager 0.4.1] - 2026-07-24

### Fixed
- `branch-session`: corrected `essential_principles` after live testing — `/branch` switches
  the current pane into the new branched session rather than leaving the original active with
  a passive fork created elsewhere. The original session is left intact and resumable, but this
  pane changes which conversation it's running, same as `/resume`.

## [sandbox-manager 0.4.0] - 2026-07-23

### Added
- `background-session` skill: fires automatically on a `/background` channel message; sends
  `/background` + Enter, which hands the current work off to a background agent and frees
  the interactive pane. Confirmed with cameri that `/background` is a real Claude Code
  command (not Ctrl-Z/`bg`/`fg`), which is why the entry below was initially deferred.

## [sandbox-manager 0.3.0] - 2026-07-23

### Added
- `exit-session` skill: fires automatically on an `/exit` channel message; sends `/exit` +
  Enter to the tmux pane, ending the process. Relies on something outside the pane (a
  supervisor or container restart policy) to bring it back — confirmed viable in this
  deployment since `containers/claude-sandboxed/compose.yml` runs with `restart: unless-stopped`.
- `rename-session` skill: fires on a `/rename <name>` channel message; sends `/rename <name>` +
  Enter to name the current session.
- `resume-session` skill: fires on a `/resume <name>` channel message; sends `/resume <name>` +
  Enter to switch the pane to a different, previously named session. Always requires a name —
  a bare `/resume` opens an interactive picker that can't be driven by scripted keystrokes.
- `branch-session` skill: fires automatically on a `/branch` channel message; sends `/branch` +
  Enter to fork the conversation at the current point without disturbing the original.
- `export-session` skill: fires on an `/export <path>` (or bare `/export`) channel message;
  sends `/export <path>` + Enter to write the conversation to a file. With no path given,
  defaults to `docs/<slug>`, where `<slug>` is generated from a summary of the conversation
  before the script runs.
- `rename-session`, `resume-session`, and `export-session` send user-supplied text via
  `tmux send-keys -l` so it can't be misread as tmux key names.

### Deferred
- A `/background` skill (send the session to the background, freeing the terminal) was
  requested but not implemented: in this deployment the container's PID 1 is literally
  `tmux attach -t claude` (see `containers/claude-sandboxed/compose.yml`), so detaching that
  client — or suspending the `claude` process, which has no wrapping shell in the pane to
  later run `fg` from — tears down or freezes the whole sandbox instead of just freeing the
  terminal. Needs a decision on how to handle this before it can be built safely.

## [sandbox-manager 0.2.0] - 2026-07-23

### Added
- `manage-plugins` skill: adds/removes marketplaces and installs/updates/enables/disables/
  uninstalls plugins via the non-interactive `claude plugin ...` CLI (synchronous, no polling
  needed), then runs `scripts/reload-plugins.sh` to send `/reload-plugins` to this session's own
  tmux pane so the change applies without a full restart — `/reload-plugins` has no CLI
  equivalent, unlike marketplace/install/update/enable/disable/uninstall.

## [sandbox-manager 0.1.0] - 2026-07-23

### Added
- New plugin: manages the Claude Code sandbox itself.
- `restart-session` skill: fires automatically on a `/clear` channel message (e.g. Telegram);
  runs `scripts/restart-session.sh`, which auto-discovers the current tmux pane, verifies it's
  actually running Claude Code, and sends `/clear` + Enter to reset the session on remote request.

## [finance-manager 0.6.3] - 2026-07-22

### Fixed
- `manage-paperless-workflows/references/troubleshooting.md`: documented that the
  `documents/bulk_edit/` `reprocess` method does **not** retroactively re-evaluate workflow
  triggers (only re-runs content extraction) — discovered while backfilling Amex/CIBC/
  Tangerine statements that predated their workflows. `PATCH`-ing a real field (e.g. `title`
  to its own value) reliably fires the "Document Updated" trigger instead; there is no
  dedicated `run_workflows` bulk-edit method in this API version.

### Changed
- Completed a full statement backfill this session (executed live, not shipped as plugin
  code): 19 Amex, 13 CIBC, and 26 Tangerine (Chequing/Line of Credit/Mastercard) documents
  tagged and reconciled. Surfaced and corrected a real gap in the "safe to link transfers"
  guidance in `docs/finance/learned-rules.md` — "both sides manual = safe" was disproven by
  a live deletion during the Tangerine LOC↔Chequing linking attempt; the working rule is now
  "don't rely on either side's sync status as a safety guarantee, snapshot before linking."

## [finance-manager 0.6.2] - 2026-07-22

### Changed
- `reconcile-statement` and `manage-paperless-workflows` now read account/correspondent
  mappings from `~/.claude/channels/finance-manager/config.json` instead of
  `docs/finance/account-map.md` — the migration this workspace's first
  `setup-finance-manager` run actually performed. `account-map.md` stays on disk as a
  historical record but is no longer read by either workflow.
- `setup-finance-manager`: added `manual_csv` as a third `reconciliation_mode` (alongside
  `statement` and `bank_sync_only`) for institutions with neither a paperless correspondent
  nor a live bank-sync connector (crypto exchanges, custodial loan accounts) — needed once
  real accounts (ShakePay, Ledn) were run through first-run setup.

### Fixed
- `first-run-setup.md`'s discovery step used to imply only two `reconciliation_mode` values
  existed; corrected to reflect the three actually supported.

### Changed
- `setup-finance-manager/workflows/first-run-setup.md`: reordered so Step 1 now connects
  Actual Budget and lists real accounts *before* asking anything else (grounds later
  questions in real data instead of asking blind). Added account-name standardization: for
  any account without an existing identifying suffix, ask for the last 4-5 digits and rename
  it via `accounts update <id> --name "..."` (skipping wallets/exchanges, which aren't
  numbered bank accounts) — flushing via `budgets download` after each rename per the
  existing encrypted-budget CLI mutating-command requirement in
  `reconcile-statement/references/cli-setup.md`.

## [finance-manager 0.6.0] - 2026-07-22

### Added
- New skill `setup-finance-manager`: onboards the plugin for first use (household members,
  bank accounts, hot/cold wallets, ownership, connecting Actual Budget and Paperless-ngx,
  per-account reconciliation mode, periodic sync jobs), and on later runs reviews/adds/
  removes tracked accounts and wallets. Introduces
  `~/.claude/channels/finance-manager/config.json` (structure/status) and
  `~/.claude/channels/finance-manager/credentials.json` (wallet descriptors — never in the
  plugin dir or `docs/finance/`), both written exclusively through
  `scripts/write_config.py`'s write-temp → validate → atomic-replace pattern so a crash
  mid-write can't corrupt the config. Includes a `references/markitdown-setup.md` reference
  for offering MarkItDown PDF-parser setup when connecting a fresh paperless-ngx instance.
  First run offers to import existing `docs/finance/account-map.md` rows as candidate
  accounts rather than re-asking from scratch (actual migration/consolidation happens the
  first time the new skill is run, not as part of this release).

## [finance-manager 0.5.0] - 2026-07-22

### Added
- New skill `query-mempool`: CLI (`scripts/mempool_cli.py`) wrapping the public mempool.space
  REST API — look up a transaction by txid, an address's balance/history, or aggregate
  balance/history across a wallet descriptor (single-sig or multisig, including BIP389
  multipath descriptors like Bitkey's `wsh(sortedmulti(2, ...))`) via bdkpython-driven
  address derivation with gap-limit scanning. Table output by default, `--json` for
  structured output. Every list-returning command (`address`'s tx history, `descriptor`'s
  used-addresses list) is paginated at 25/page via `--page`. Built for the deferred Bitkey
  ↔ mempool.space reconciliation work (`docs/finance/bitkey-mempool-reconciliation-todo.md`
  in the workspace repo) — this skill only adds the mempool.space lookup capability itself,
  not the reconciliation logic.
- Discovered live (docs were misleading): mempool.space's confirmed-address-history
  pagination cursor is a **path** segment (`GET
  /address/:address/txs/chain/:last_seen_txid`), not the `?after_txid=` query parameter the
  reference docs' phrasing suggested — the query-param form is silently accepted but
  ignored and just returns page 1 again.

## [finance-manager 0.4.2] - 2026-07-22

### Changed
- `reconcile-statement.md`: refined the 0.4.1 transfer-linking danger warning after same-day follow-up testing — the deletion only reproduces when *both* sides of the pair are already live bank-synced (non-null `imported_id`). Linking one bank-synced side to one manually-inserted backfill transaction is safe and was used successfully for 7 more links later the same day. Updated guidance: only avoid the CLI update pattern when both sides are already-synced data; test a single pair with a balance check first if you must.

## [finance-manager 0.4.1] - 2026-07-22

### Fixed
- `reconcile-statement.md`: added a hard warning against linking transfers via `updateTransaction({ transfer_id })` when either side has a non-null `imported_id` (live bank-synced) — reproduced today: two real, cleared, bank-synced transactions were silently *deleted* (not just left unlinked) by this exact pattern, confirmed by the account balance dropping by their combined amount. A fresh bank-sync on the affected account restored them safely. Every transfer link made on manually-inserted (non-bank-synced) transactions during today's backfills was unaffected — the risk is specific to linking already-live-synced transactions this way.

## [finance-manager 0.4.0] - 2026-07-22

### Added
- Unlinked-transfers registry: when a transfer counterpart isn't found in any currently-tracked account, the transaction is now recorded in a persistent worklist (`unlinked_transfer` entries in `docs/finance/learned-rules.md`) instead of just being flagged and forgotten. New `reconcile-statement.md` Step 7c retries every open entry against the account just reconciled/backfilled, since the missing counterpart often turns out to live in an account that simply hadn't been backfilled yet. Entries are removed once linked. `self-evolve.md` maintains the registry (add/remove) each run.
- `references/backfill-verification.md` — technique reference for reconciling a multi-period gap: verifying the running-balance chain across every statement before inserting anything, deriving transaction sign from balance deltas rather than OCR column position (catches transcription sign errors that pass a local "looks plausible" check), two recurring OCR table-parsing pitfalls (header/data column misalignment, multi-row blocks disguised as single blocks), a derived-expectation validation method for accounts whose absolute ledger balance has drifted from real statement figures for reasons predating the current backfill, and avoiding duplicate inserts at a live-sync boundary.
- `reconcile-statement.md`: before searching other accounts for a transfer counterpart, check for a same-account fee-reversal pattern first (a same-amount credit shortly after a matching charge is very often the institution reversing that exact fee, not new income or a transfer).
- `reconcile-statement.md`: the categorization certainty-bar check now searches for payee/pattern precedent budget-wide, not just on the account being reconciled — a payee can have established history on a different account.

### Changed
- Removed one bank-specific transfer-payee example from `reconcile-statement.md` in favor of only the generic ones, keeping the guidance portable.

## [finance-manager 0.3.0] - 2026-07-20

### Added
- `manage-paperless-workflows/references/troubleshooting.md` — how to read paperless-ngx container logs and a document's history API (`/api/documents/<id>/history/`) to diagnose whether a workflow fired, whether a `reprocess` bulk-edit action actually changed a document's content, and whether an extraction-quality issue (e.g. scrambled table layouts) is a stale-processing artifact or inherent to the currently configured processor. Linked from `reconcile-statement.md`'s untriaged-document detection step.

## [finance-manager 0.2.1] - 2026-07-19

### Changed
- `reconcile-statement` workflow: added a "transfers take priority over categories" step — payees like "Online Banking Transfer", "BR to BR", "Payment", or "Payment Adjustment" must never be categorized as fees/income by default; always search other tracked accounts for a matching transaction and link as a transfer instead. Added an explicit certainty bar for categorization (only categorize with an existing rule or fully consistent payee history — never guess).
- Generalized the "direction-conditional rules" guidance beyond Interac e-transfers to any payee that can plausibly appear on both sides of the ledger (e.g. an employer who is also paid for a separate service) — a flat payee→category rule silently mis-categorizes the first transaction on the untested direction.

### Fixed
- `references/cli-setup.md`: documented the `encrypt-failure`/`missing-key` sync-push bug on E2E-encrypted budgets — write commands apply locally but fail to push, and every subsequent command fails until the queue is flushed with an explicit `budgets download --encryption-password` after each individual write.

## [actual-budget 0.1.4] - 2026-07-19

### Fixed
- `references/cli-setup.md`: documented the same `encrypt-failure`/`missing-key` sync-push issue found while using this CLI from finance-manager — the fix is to flush with `budgets download --encryption-password` after every mutating command, one at a time.

## [actual-budget 0.1.3] - 2026-07-19

### Fixed
- CLI setup snippet now uses `set -a` around `source`ing the credential `.env` file, so `ACTUAL_DATA_DIR` and `ACTUAL_ENCRYPTION_PASSWORD` (and any future keys) are actually exported to the CLI subprocess. Previously only `ACTUAL_SERVER_URL`, `ACTUAL_PASSWORD`, and `ACTUAL_SYNC_ID` were exported, so any budget with a custom data directory or E2E encryption enabled would fail to load with a cryptic "unknown problem opening" / `missing-key` error.

## [github-manager 0.3.0] - 2026-05-01

### Added
- `create-stories` skill — parses a PRD and batch-creates a parent-child GitHub issue hierarchy (stories + sub-issues) with milestone assignment and project board integration

## [commands] - 2026-03-30

### Removed
- `/improve-skill` — superseded by the `audit-skill` workflow in the `create-agent-skills` skill (taches-cc-resources), which now includes severity tiers and degrees-of-freedom checks

## [github-manager 0.2.1] - 2026-03-30

### Changed
- Trimmed all skill descriptions for token efficiency — removed boilerplate preamble while preserving trigger conditions and behavior summaries

## [autoresearch 0.1.2] - 2026-03-29
## [docker-maintenance 0.2.1] - 2026-03-29
## [elevenlabs 0.1.3] - 2026-03-29
## [nats 0.0.5] - 2026-03-29
## [scheduler 0.0.2] - 2026-03-29
## [technitium-dns 0.2.2] - 2026-03-29

### Changed
- Trimmed skill descriptions to reduce context token usage — removed verbose preamble and redundant examples while preserving semantic triggers

## [elevenlabs 0.1.2] - 2026-03-29
## [nats 0.0.4] - 2026-03-29
## [nostr 0.1.17] - 2026-03-29
## [paperless 0.0.4] - 2026-03-29
## [wallabag 0.0.2] - 2026-03-29

### Changed
- Renamed credential skill to `access` to follow the standard plugin naming convention: elevenlabs (setup-api-key), nats (configure-nats), paperless (configure-paperless), wallabag (configure-wallabag)
- nostr and telegram retain `configure` — both already have a distinct `access` skill for pairing/allowlist management

## [actual-budget 0.1.1] - 2026-03-28

### Changed
- Renamed `configure-actual` skill to `access` to follow the standard plugin naming convention

## [technitium-dns 0.2.1] - 2026-03-28

### Changed
- Renamed `configure-technitium` skill to `access` to follow the standard plugin naming convention

## [home-assistant 0.1.0] - 2026-03-28

### Added
- Initial release: interact with Home Assistant via REST API using httpie
- `access` skill: configure HA_URL and HA_TOKEN, test connection
- `get-state` skill: get single entity state or list all entities (with domain filter)
- `call-service` skill: call HA services to control devices and trigger automations
- `set-state` skill: create or update entity state directly in HA state machine
- `fire-event` skill: fire custom HA events for automation triggers
- `render-template` skill: render Jinja2 templates for testing and debugging
- `query-history` skill: query state history and logbook with time range filters

## [autoresearch 0.1.1] - 2026-03-28

### Added
- Initial release: autonomously optimize Claude Code skills using binary evals, prompt mutation, and iterative improvement loops

## [docker-maintenance 0.2.0] - 2026-03-28

### Added
- Initial release: update base images, pin sha256 digests, manage Containerfile/Dockerfile dependencies, test builds, and log changes

## [netshoot 0.1.0] - 2026-03-28

### Added
- Initial release: network troubleshooting inside Docker container networks using nicolaka/netshoot

## [elevenlabs 0.1.1] - 2026-03-28

### Added
- `references/premade-voices.md`: full list of 45 premade voices with IDs, gender, accent, and use case
- Credit conservation guidance in text-to-speech skill (avoid filler text to reduce character usage)
- Expanded voice table with accent and use case details

## [jj] - 2026-03-28

### Added
- Document that jj does not support git submodules; use `git` directly for submodule operations
- Warning about `jj restore` accidentally deleting files that are absent in the source revision, with pre-flight checklist

## [technitium-dns 0.2.0] - 2026-03-28

### Added
- `manage-blocking` skill: check if a domain is blocked or allowed, add/remove per-domain allow/block overrides, manage block list URLs, force block list updates, and enable/disable blocking globally (including timed temporary disable)
- `.claude-plugin/plugin.json`: initial plugin manifest (was missing)
- Updated marketplace.json description to reflect blocking capabilities
