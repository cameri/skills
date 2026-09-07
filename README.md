# skills

Monorepo of Claude Code plugins and slash commands by Ricardo Arturo Cabral Mejía.

## Plugins

| Plugin | Description | Tools |
|---|---|---|
| [ablate-ai-layer](./ablate-ai-layer/) | Measure whether a repository's AI instructions still earn their place — runs the same real task with the layer intact and stripped, in throwaway git worktrees, then grades every rule against what actually changed | Claude + Cursor |
| [actual-budget](./actual-budget/) | Interact with your self-hosted Actual Budget instance — check balances, add transactions, and query budgets | Claude + Cursor |
| [agent-resources](./agent-resources/) | Build and audit Claude Code skills, hooks, MCP servers, and subagents | Claude + Cursor |
| [anydoc](./anydoc/) | Convert Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV, and PDF files to clean GitHub-Flavored Markdown via the anydoc CLI | Claude + Cursor |
| [audiobookshelf](./audiobookshelf/) | Interact with a self-hosted Audiobookshelf instance — list libraries, browse and search library items, and check listening progress | Claude + Cursor |
| [autoresearch](./autoresearch/) | Autonomously optimize Claude Code skills using Karpathy's autoresearch methodology — binary evals, prompt mutation, and iterative improvement loops | Claude |
| [brain](./brain/) | Workspace-wide knowledge graph backed by LatticeDB — syncs a graph-json snapshot in, defaulting to graphify's output (`learn_from`), answers questions over it via Cypher (`recall`), writes/links a single fact directly (`remember`), soft- or permanently deletes a node/edge (`forget`), and reports staleness/cost-to-re-study for any previously-learned path (`study_status`) | Claude + Cursor |
| [consider](./consider/) | Apply a decision-making framework — inversion, first-principles, second-order effects, Pareto, via negativa, opportunity cost, or Eisenhower prioritization — to a real decision or tradeoff moment | Claude + Cursor |
| [cronjobs](./cronjobs/) | Schedule recurring or one-time jobs using natural language — 'every 3 minutes', 'every weekday at 9am', 'once in 5 minutes' | Claude |
| [container-management](./container-management/) | Maintain Docker Compose services and custom images — update base images, pin sha256 digests, manage Containerfile/Dockerfile dependencies, test builds, and log all changes | Claude + Cursor |
| [doubt-driven-development](./doubt-driven-development/) | Adversarial fresh-context review of non-trivial in-flight decisions before they stand — CLAIM, EXTRACT, DOUBT, RECONCILE, STOP — with optional user-authorized cross-model escalation | Claude |
| [elevenlabs](./elevenlabs/) | Generate speech, transcribe audio, create music and sound effects, and build voice agents using the ElevenLabs API | Claude + Cursor |
| [executable-skepticism](./executable-skepticism/) | Verification protocol that turns a theory, paper, model, or confident quantitative claim into a falsifiable, runnable test instead of a debate in prose | Claude |
| [finance-manager](./finance-manager/) | Reconcile bank statements against ActualBudget, run household financial reviews (net worth, goal tracking, optimization), look up Bitcoin transactions/addresses/wallet descriptors via mempool.space, and onboard or manage the plugin's tracked accounts, wallets, and periodic sync jobs | Claude + Cursor |
| [github-manager](./github-manager/) | Autonomous GitHub repository manager — handles webhook events for issues, PRs, discussions, CI failures, and security alerts | Claude |
| [home-assistant](./home-assistant/) | Interact with Home Assistant via the REST API — get entity states, call services, fire events, render Jinja2 templates, and query state history | Claude + Cursor |
| [immune-system](./immune-system/) | Defensive security monitor for the agent instance — watches skills, plugins, and hooks for new or changed content, quarantines confirmed threats, alerts the operator, and removes only on confirmation | Claude |
| [jj](./jj/) | Use Jujutsu (jj) instead of git for version control — core concepts plus actionable skills for everyday operations (commit, split, squash, cleanup, checkout, rebase) | Claude |
| [journal](./journal/) | Keeps a series of narrative journals about what you've been doing, written from Claude's own perspective, by reading session history and memory | Claude |
| [knowledge-wiki](./knowledge-wiki/) | Maintains a self-updating, cross-linked markdown knowledge base — ingests durable facts and research as topic pages instead of re-deriving them each time, with query and link-consistency checks | Claude |
| [lightning](./lightning/) | Bitcoin Lightning payment tools (parse/pay invoices, balances, transactions) via the official Alby MCP server over Nostr Wallet Connect | Claude |
| [nats](./nats/) | Connect Claude Code agents over NATS — message, ping, and discover other agents point-to-point | Claude + Cursor |
| [netshoot](./netshoot/) | Network troubleshooting inside Docker container networks using nicolaka/netshoot | Claude |
| [nostr](./nostr/) | Nostr channel for Claude Code — decentralized messaging over Nostr relays with DM pairing, allowlists, relay pool management, and NIP-04 encrypted DMs | Claude |
| [paperless](./paperless/) | Upload documents to and search a Paperless-ngx instance via its REST API | Claude + Cursor |
| [replicator](./replicator/) | Grows and prunes this instance's own skill set — captures reusable procedures during work, and nightly meditates on usage history and frontier sources to build or mute skills with scrutiny; publishes a gene registry over Nostr and mirrors it to a GitHub gist | Claude |
| [repo-hygiene-sweep](./repo-hygiene-sweep/) | Sweep every standalone repo in a multi-repo workspace for uncommitted or unpushed work, without missing the ones a plain `git status`/`jj status` from the workspace root can't see | Claude |
| [research-tools](./research-tools/) | Deliberately-invoked research skills — competitive analysis, deep-dive investigation, feasibility checks, landscape mapping, options comparison, and technical implementation research | Claude |
| [sandbox-manager](./sandbox-manager/) | Manage the Claude Code sandbox itself — restart sessions, manage its own plugins/marketplaces, run post-restart health checks, and set up herdr for remote SSH attach | Claude |
| [simple-english](./simple-english/) | Write or rewrite technical text with the rules of ASD-STE100 Simplified Technical English so it is clear, unambiguous, and free of AI slop | Claude |
| [technitium-dns](./technitium-dns/) | Manage a self-hosted Technitium DNS Server — zones, records, stats, and cache | Claude + Cursor |
| [telegram](./telegram/) | Telegram channel for Claude Code — messaging bridge with built-in access control, pairing, and full Bot API coverage including voice note transcription | Claude |
| [telegram-ng](./telegram-ng/) | Telegram channel for Claude Code — messaging bridge with built-in access control. Fork of Anthropic's official telegram plugin for local development | Claude |
| [wallabag](./wallabag/) | Save, search, and manage read-it-later articles via your Wallabag instance | Claude + Cursor |
| [webhooks](./webhooks/) | Receive webhook events from external systems as channel notifications — HMAC-SHA256, IP allowlisting, BullMQ processing | Claude |

### actual-budget

| Skill | Description |
|---|---|
| `/actual-budget:access` | Set up Actual Budget credentials — save the server URL and password |
| `/actual-budget:query-budget` | Query accounts, check balances, view recent transactions, and trigger bank sync |

### ablate-ai-layer

| Skill | Description |
|---|---|
| `/ablate-ai-layer:ablate-ai-layer` | Run an AI-layer ablation — same real task N times with the always-loaded instructions intact and N times stripped, in throwaway git worktrees, then grade every rule against what actually changed (load-bearing / redundant / ignored / untested) |

### agent-resources

| Skill | Description |
|---|---|
| `/agent-resources:create-agent-skills` | Expert guidance for creating, writing, building, and refining Claude Code Skills |
| `/agent-resources:create-hooks` | Create Claude Code hooks (PreToolUse, PostToolUse, Stop, SessionStart, UserPromptSubmit) |
| `/agent-resources:create-mcp-servers` | Expert guidance for building MCP servers for Claude integrations (Python/TypeScript) |
| `/agent-resources:create-subagents` | Expert guidance for creating, building, and using Claude Code subagents |
| `/agent-resources:audit-skill` | Audit a SKILL.md file for YAML compliance, pure XML structure, progressive disclosure, and best practices |
| `/agent-resources:audit-subagent` | Audit a subagent configuration file for role definition, prompt quality, and tool selection |
| `/agent-resources:heal-skill` | Apply corrections to a skill's SKILL.md based on mistakes discovered during execution, with approval workflow |

### anydoc

| Skill | Description |
|---|---|
| `/anydoc:convert-documents-to-markdown` | Convert Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV, or PDF to GitHub-Flavored Markdown |

### audiobookshelf

| Skill | Description |
|---|---|
| `/audiobookshelf:access` | Set up Audiobookshelf credentials — save the server URL and API key |
| `/audiobookshelf:query-library` | List libraries, browse or search items, view item details, check listening progress |
| `/actual-budget:add-transaction` | Add a transaction — spending, income, or any financial event |

### brain

| Skill | Description |
|---|---|
| `/brain:learn-from` | Sync a graph-json snapshot into the brain (the workspace's LatticeDB knowledge graph) — defaults to graphify's `graphify-out/graph.json`, or pass a `path` to sync any file in the same schema — creates new nodes/edges, updates changed ones, deletes ones no longer present |
| `/brain:recall` | Query the brain — ask a plain-language question about the workspace's code/docs/concepts, or run a raw Cypher query directly |
| `/brain:remember` | Write a single fact into the brain, optionally linked to existing nodes by gid or search string |
| `/brain:forget` | Soft (default, recoverable) or permanent delete of a node or edge from the brain |
| `/brain:study-status` | Report whether a previously-learned path is stale and roughly what re-studying would cost, without triggering a re-study — shells out to graphify's own `detect_incremental()` |

### finance-manager

| Skill | Description |
|---|---|
| `/finance-manager:setup-finance-manager` | Onboard the plugin for first use (household, accounts, hot/cold wallets, ownership, connecting Actual Budget/Paperless-ngx) or review/add/remove tracked entries and periodic sync jobs |
| `/finance-manager:reconcile-statement` | Reconcile a bank statement against ActualBudget — syncs accounts, matches transactions, self-improves reconciliation rules |
| `/finance-manager:manage-paperless-workflows` | Create or fix Paperless-ngx workflows so bank statement documents auto-tag correctly |
| `/finance-manager:query-mempool` | Look up Bitcoin transactions, addresses, and wallet descriptor (single-sig or multisig) balances/history via the mempool.space API |
| `/finance-manager:review-finances` | Run a household financial review — execution audit, net worth/liquidity check, tax/expense optimization scan, and a single-sitting report with goal tracking and up to 3 next actions |

### github-manager

| Skill | Description |
|---|---|
| `github-manager:manage-issues` | Handles GitHub issue events; triages labels, prompts for details, escalates external issues via Telegram |
| `github-manager:manage-pull-requests` | Handles GitHub PR events; auto-merges Dependabot patches, escalates external PRs via Telegram |
| `github-manager:manage-discussions` | Handles GitHub discussion events; silently monitors trusted users, escalates external discussions via Telegram |
| `github-manager:manage-ci` | Handles GitHub CI events; alerts on failures via Telegram |
| `github-manager:manage-projects` | Handles GitHub Projects v2 events; notifies on lifecycle changes, escalates external activity via Telegram |
| `github-manager:manage-admin` | Handles GitHub security alerts, collaborator changes, pushes, and admin events |
| `github-manager:create-stories` | Parses a PRD and creates a structured hierarchy of GitHub issues (stories + sub-issues) with milestone assignment and project board integration |

### journal

| Skill | Description |
|---|---|
| `journal:update-journal` | Reads session activity since the last update across every project on this machine plus the memory system, judges whether it continues the current journal's cycle or starts a new one, and writes/closes entries accordingly |

### knowledge-wiki

| Skill | Description |
|---|---|
| `knowledge-wiki:maintain-wiki` | Ingests durable facts/research into cross-linked markdown topic pages, answers lookups against the wiki, and checks it for broken links and orphaned pages |

### elevenlabs

| Skill | Description |
|---|---|
| `elevenlabs:text-to-speech` | Convert text to speech in 70+ languages using ElevenLabs voice AI |
| `elevenlabs:speech-to-text` | Transcribe audio/video to text using ElevenLabs Scribe v2 |
| `elevenlabs:agents` | Build real-time voice AI agents and assistants |
| `elevenlabs:music` | Generate instrumental tracks, songs, and background music from prompts |
| `elevenlabs:sound-effects` | Generate sound effects, ambient sounds, and audio textures from text |
| `elevenlabs:access` | Configure an ElevenLabs API key (ELEVENLABS_API_KEY) |
| `elevenlabs:elevenlabs-transcribe` | Batch or realtime audio transcription via CLI scripts |

### executable-skepticism

| Skill | Description |
|---|---|
| `executable-skepticism:executable-skepticism` | Operationalize a claim, register numeric predictions before running any code, execute deterministically, then score every prediction pass/fail — failures first, derived-vs-installed called out |

### doubt-driven-development

| Skill | Description |
|---|---|
| `doubt-driven-development:doubt-driven-development` | Adversarial fresh-context review of a non-trivial in-flight decision — CLAIM, EXTRACT, DOUBT, RECONCILE, STOP — with optional user-authorized cross-model escalation |

### nats

| Skill | Description |
|---|---|
| `/nats:access` | Configure the NATS server URL and this agent's display name |
| `/nats:show-nats-status` | Show connection info, display name, and all discovered agents |
| `/nats:discover-agents` | Broadcast "who's there?" and list all discovered agents |
| `/nats:ping-agent` | Liveness check against one known agent, reports round-trip time |
| `/nats:send-message` | Send a free-form message directly to another agent |

### paperless

| Skill | Description |
|---|---|
| `/paperless:access` | Save the instance URL, username, and password; verify connection |
| `/paperless:search-documents` | Full-text search, similarity search, or autocomplete |
| `/paperless:upload-document` | Upload a local file with optional metadata |
| `/paperless:view-content` | Display the full OCR-extracted text of a document by ID |
| `/paperless:view-document` | Download the archived PDF; when called from Telegram, sends the file to chat |

### sandbox-manager

| Skill | Description |
|---|---|
| `sandbox-manager:restart-session` | Fires automatically on a `/clear` channel message; sends `/clear` + Enter to the tmux pane running this Claude Code session |
| `sandbox-manager:rename-session` | Names or renames the current session; fires on a `/rename <name>` channel message |
| `sandbox-manager:resume-session` | Restores a named session, replacing the current conversation; fires on a `/resume <name>` channel message |
| `sandbox-manager:branch-session` | Branches the current conversation at the current point; fires on a `/branch` channel message |
| `sandbox-manager:compact-session` | Compacts the current conversation (optionally with retention instructions); fires on a `/compact` channel message |
| `sandbox-manager:background-session` | Hands the current work to a background agent, freeing the interactive pane; fires on a `/background` channel message |
| `sandbox-manager:export-session` | Exports the current conversation to a file; fires on a `/export [path]` channel message |
| `sandbox-manager:exit-session` | Hard-exits the session (vs. `/clear`'s soft reset); fires on a `/exit` channel message |
| `sandbox-manager:manage-plugins` | Adds plugin marketplaces, or installs/updates/enables/disables/uninstalls a plugin for this sandbox's own running session |
| `sandbox-manager:setup-hooks` | Installs the curated hook set (rm guard, channel-reply enforcement, usage alerts, idle tracker, session handoff reader, new-session notifier, statusline cache wrapper, and more) |
| `sandbox-manager:check-login-expiry` | Checks whether this session's login is about to expire and reports over Telegram if so; fires on a daily cronjobs job |
| `sandbox-manager:post-restart-check` | Post-restart health check — SSH signing key still has its public half, Docker Buildx present, no Containerfile pip package silently dropped by a rebuild |
| `sandbox-manager:herdr-remote-ssh` | Sets up and verifies herdr remote attach over SSH (`herdr --remote`): key-only sshd, sshd `SetEnv` env parity, detached-daemon requirement; diagnoses attaches that land in a fresh empty session |
| `sandbox-manager:whats-next` | Writes a comprehensive `whats-next.md` handoff document so work can resume with zero information loss after a context reset or restart |
| `sandbox-manager:add-to-todos` | Adds an item to `TO-DOS.md` with full context from the conversation, checking for near-duplicates first |
| `sandbox-manager:check-todos` | Lists outstanding items from `TO-DOS.md` and helps pick one to work on next |

### cronjobs

| Skill | Description |
|---|---|
| `/cronjobs:cronjob` | Schedule a recurring or one-time job using natural language; fires channel notifications when due |

### simple-english

| Skill | Description |
|---|---|
| `simple-english:simple-english` | Write or rewrite technical text per ASD-STE100 — classifies procedural vs. descriptive, applies the 53-rule catalog, runs a mandatory self-check before delivering |

### technitium-dns

| Skill | Description |
|---|---|
| `/technitium-dns:access` | Save the server URL and API token (or username/password) |
| `/technitium-dns:query-dns-stats` | Query DNS stats — top clients, top domains, query counts, cache info |
| `/technitium-dns:manage-dns-zones` | List, create, delete, enable, or disable DNS zones |
| `/technitium-dns:manage-dns-records` | Add, list, update, or delete A, AAAA, CNAME, MX, TXT, SRV records |
| `/technitium-dns:manage-blocking` | Block or allow domains — check status, add/remove domain overrides, manage block list URLs |

### wallabag

| Skill | Description |
|---|---|
| `/wallabag:access` | Save the instance URL and OAuth credentials |
| `/wallabag:save-url` | Save a URL to Wallabag to read later |

### webhooks

| Skill | Description |
|---|---|
| `webhooks:receive-webhooks` | Configure webhook endpoints (add/edit/remove/list), set auth mode, manage IP allowlists, and react to inbound events |

### autoresearch

| Skill | Description |
|---|---|
| `/autoresearch:optimize-skill` | Improve a SKILL.md using binary evals and iterative prompt mutation — use when a skill has reliability issues or produces inconsistent results |

### container-management

| Skill | Description |
|---|---|
| `/container-management:container-management` | Update Docker base images with sha256 pinning, manage Containerfile dependencies, test builds, and keep an audit log |

### home-assistant

| Skill | Description |
|---|---|
| `/home-assistant:access` | Configure Home Assistant credentials — save the server URL and long-lived access token |
| `/home-assistant:get-state` | Get the current state of one or all entities |
| `/home-assistant:set-state` | Create or update the state of an entity |
| `/home-assistant:call-service` | Call a service to control devices or trigger automations |
| `/home-assistant:fire-event` | Fire a custom event to trigger event-driven automations |
| `/home-assistant:query-history` | Query state history or logbook for one or more entities |
| `/home-assistant:render-template` | Render and debug a Jinja2 template |

### immune-system

| Skill | Description |
|---|---|
| `/immune-system:immune-response` | Review and neutralize skills, plugins, or hooks the watcher flags — quarantined evaluation, Telegram alert on confirmed threat, removal only on operator confirmation |

### jj

| Skill | Description |
|---|---|
| `jj:working-with-jj` | Use Jujutsu (jj) instead of git for all version control operations in this workspace — commits, history, branching, pushing |
| `/jj:commit` | Describes the current working-copy change (jj's equivalent of `git commit`), optionally stacking a new empty change on top |
| `/jj:split` | Splits the current (or a specified) change into two, by file/path or interactively — jj's equivalent of `git add -p && git commit` |
| `/jj:squash` | Moves changes from one change into another (usually working copy into parent) — jj's equivalent of `git commit --amend` or a fixup squash |
| `/jj:rebase` | Moves changes onto a different parent — jj's equivalent of `git rebase`, without stopping for conflicts |
| `/jj:checkout` | Switches to an existing change or bookmark — jj's equivalent of `git checkout`/`git switch` |
| `/jj:cleanup` | Removes stray empty changes and stale/orphaned workspaces |

### nostr

| Skill | Description |
|---|---|
| `nostr:nostr` | Handle inbound Nostr DMs, send replies, publish notes, fetch events, and check relay status |
| `/nostr:configure` | Set up the Nostr channel — save the nsec, manage relays, configure subscribed event kinds |
| `/nostr:access` | Manage Nostr channel access — pairings, allowlists, policy |
| `/nostr:profile` | View or update the Nostr profile (kind:0 metadata) |
| `/nostr:relay-list` | Manage the NIP-65 relay list for this identity |
| `/nostr:fetch-event` | Fetch a Nostr event by ID or filter |
| `/nostr:verify-event` | Verify an event's schema, ID hash, and Schnorr signature |
| `/nostr:react` | React to an event with a NIP-25 reaction |
| `/nostr:bech32` | Encode/decode NIP-19 bech32 entities (note1, npub1, nevent1, etc.) |
| `/nostr:mine-pubkey` | Mine a vanity or proof-of-work Nostr keypair with rana |

### telegram

| Skill | Description |
|---|---|
| `telegram:telegram` | Handle inbound Telegram messages, send replies, react, edit messages, download attachments, process voice notes |
| `/telegram:configure` | Save the bot token and review access policy |
| `/telegram:access` | Manage Telegram channel access — pairings, allowlists, DM/group policy |

### telegram-ng

Fork of Anthropic's official `telegram` plugin — see [telegram-ng/README.md](./telegram-ng/README.md). This is the live channel driver for this workspace; `telegram` above is the unforked predecessor, kept in the repo for reference/other users.

| Skill | Description |
|---|---|
| `/telegram-ng:configure` | Save the bot token and review access policy |
| `/telegram-ng:access` | Manage Telegram channel access — pairings, allowlists, DM/group policy |
| `telegram-ng:bot-api-reference` | Reference for Telegram's Bot API surface — consulted before modifying server.ts to add or change Telegram behavior |

### lightning

MCP-only — no `SKILL.md` skills. Ships an MCP server (`@getalby/mcp`) wired to a self-hosted NWC wallet; use its `parse_invoice`/`pay_invoice`/balance/transaction tools directly.

### replicator

| Skill | Description |
|---|---|
| `replicator:capture` | Queue a candidate skill the moment you notice something reusable was just learned during a session |
| `replicator:meditate` | Run the nightly replicator cycle — review gene usage, look inward/outward for skills worth building, build with scrutiny, prune stale ones, write a trace |

This plugin also ships an MCP server (`replicator` v0.9.0+) exposing
SearXNG-backed `search`/`fetch` tools (self-hosted, endpoint via
`SEARXNG_ENDPOINT`, default `http://searxng:8080`). These exist so the
`replicator:quarantine` agent — deliberately fetch-only, no Bash/Write/Edit/
Agent — can evaluate external sources in its own contained context; omp
child sessions enforce a strict `tools:` allowlist, so the agent def must
name the registered MCP tool identifiers (`mcp__replicator_replicator_search` /
`mcp__replicator_replicator_fetch`) — `WebSearch`/`WebFetch` are not registered names
and grant nothing. `fetch` is SSRF-guarded (refuses
private/loopback/link-local/CGNAT destinations).

### repo-hygiene-sweep

| Skill | Description |
|---|---|
| `repo-hygiene-sweep:repo-hygiene-sweep` | Checks every repo in a multi-repo workspace — the workspace repo plus every standalone repo listed in its root CLAUDE.md — for uncommitted or unpushed work |

### consider

| Skill | Description |
|---|---|
| `/consider:consider` | Apply a decision-making framework to a real choice, tradeoff, or risky plan |

### research-tools

| Skill | Description |
|---|---|
| `/research-tools:competitive` | Research the competitive landscape for a product or feature — who else solves this, how, and where the gaps are |
| `/research-tools:deep-dive` | Comprehensive, multi-source investigation of a topic — how it works, why it exists, limitations, current trends |
| `/research-tools:feasibility` | Honest reality check — can this actually be done given technical, resource, and external constraints |
| `/research-tools:landscape` | Map a domain's players, tools, trends, and gaps |
| `/research-tools:options` | Structured side-by-side comparison of options with a recommendation |
| `/research-tools:technical` | Research implementation approaches, libraries, and patterns with honest tradeoffs |

## Commands

| Command | Description |
|---|---|
| `/create-skill` | Scaffold a new Claude Code skill plugin from scratch |
| `/dontforget` | Consolidate `remember/` notes into the persistent memory system |
| `/forget` | Triage and prune stale entries from `remember/` |
| `/unsubscribe` | Unsubscribe from a newsletter or mailing list using an unsubscribe URL |
| `/unfurl` | Resolve a minified or tracking URL to its final destination |

## Setup

### 1. Clone the repo

```bash
git clone git@github.com:cameri/skills.git ~/Workspace/skills
```

### 2. Install slash commands

Copy (or symlink) the commands into your Claude config directory so they are available in every session:

```bash
cp ~/Workspace/skills/commands/*.md ~/.claude/commands/
```

Or as symlinks so changes in the repo are picked up automatically:

```bash
for f in ~/Workspace/skills/commands/*.md; do
  ln -sf "$f" ~/.claude/commands/"$(basename "$f")"
done
```

### 3. Register the plugin marketplace

Run this once inside any Claude Code session:

```
/plugin marketplace add ~/Workspace/skills
```

### 4. Install plugins

```
/plugin install actual-budget@cameri-skills
/plugin install anydoc@cameri-skills
/plugin install elevenlabs@cameri-skills
/plugin install github-manager@cameri-skills
/plugin install nats@cameri-skills
/plugin install paperless@cameri-skills
/plugin install cronjobs@cameri-skills
/plugin install technitium-dns@cameri-skills
/plugin install wallabag@cameri-skills
```

### 5. Reload plugins

```
/reload-plugins
```

After reloading, all plugin skills are available (e.g. `/paperless:configure`, `/actual-budget:budget`).

## Installing for Cursor

Cursor reads the same `SKILL.md` format as Claude Code (frontmatter `name`/`description`, discovered from `.cursor/skills/<name>/SKILL.md`) and the same `.mcp.json` shape (`{"mcpServers": {...}}`, read from `~/.cursor/mcp.json`). No plugin content needs to change for Cursor — only how it's discovered.

The 13 plugins marked "Claude + Cursor" in the table above (`paperless`, `actual-budget`, `technitium-dns`, `home-assistant`, `wallabag`, `elevenlabs`, `nats`, `container-management`, `finance-manager`, `audiobookshelf`, `anydoc`, `agent-resources`, `consider`) work under Cursor. Channel plugins (`telegram`, `telegram-ng`, `nostr`, `webhooks`, `cronjobs`, `sandbox-manager`) stay Claude-only — they react to inbound background messages, which has no Cursor equivalent since Cursor is an interactive editor, not a background message host. `netshoot` also stays Claude-only for now.

### 1. Symlink each skill directory

Each plugin's skills live at `<plugin>/skills/<skill-name>/SKILL.md`. Symlink each one into `~/.cursor/skills/<plugin>-<skill-name>` so Cursor can discover it:

```bash
for skill_dir in ~/Workspace/skills/paperless/skills/*/; do
  skill_name=$(basename "$skill_dir")
  ln -s "$skill_dir" ~/.cursor/skills/paperless-"$skill_name"
done
```

Repeat for each of the 9 Cursor-eligible plugins, substituting the plugin name in both the source path and the `~/.cursor/skills/` prefix.

### 2. Register MCP servers (only plugins with one)

Most of the 9 Cursor-eligible plugins are skill-only (the `SKILL.md` drives `curl`/API calls directly) and need no MCP server entry — Step 1 alone is enough. `nats` is the exception: it ships a real MCP server (`nats/.mcp.json`). Paste its contents into `~/.cursor/mcp.json`, replacing `${CLAUDE_PLUGIN_ROOT}` (a Claude Code–only variable Cursor doesn't expand) with the plugin's absolute path:

```json
{
  "mcpServers": {
    "nats": {
      "command": "bun",
      "args": ["run", "--cwd", "/absolute/path/to/skills/nats", "--shell=bun", "--silent", "start"]
    }
  }
}
```

If a plugin gains an `.mcp.json` in the future, apply the same pattern (copy the plugin's own `.mcp.json` into `~/.cursor/mcp.json`'s `mcpServers` object, resolving any `${CLAUDE_PLUGIN_ROOT}` reference to an absolute path).

## Alternative: install via `npx skills`

[vercel-labs/skills](https://github.com/vercel-labs/skills) is a separate community CLI that installs Claude Code skills straight from a GitHub repo, without registering a plugin marketplace. It works against this repo too.

Install every skill in this repo:

```bash
npx skills add cameri/skills
```

Install a specific plugin's skill directly (skills live at `<plugin>/skills/<skill-name>`):

```bash
npx skills add https://github.com/cameri/skills/tree/main/actual-budget/skills/access
```

Or pick skills by name out of the whole repo:

```bash
npx skills add cameri/skills -s access query-budget add-transaction
```

Useful flags: `--list` to see what's available before installing, `-g`/`--global` to install to your user directory instead of the current project, `--copy` to copy files instead of symlinking, and `-a claude-code` to target Claude Code if you have other supported agents installed. You can also run a skill without installing it:

```bash
npx skills use cameri/skills --skill access --agent claude-code
```

See the [vercel-labs/skills README](https://github.com/vercel-labs/skills) for the full command reference (`list`, `find`, `update`, `remove`, `init`).

## License

MIT
