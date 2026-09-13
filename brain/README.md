# brain

Workspace-wide knowledge graph backed by LatticeDB. Exposes `learn_from` and `recall` tools for ingesting structured knowledge and querying it via Cypher, `remember` a single fact directly, `forget` a node or edge (soft or permanent), and `study_status` reporting staleness and re-study cost for any learned path. `learn_from` defaults to reading graphify's `graphify-out/graph.json`, but takes any graph-json snapshot in the same `{nodes, links, hyperedges?}` shape via an optional `path` argument — graphify is the default producer, not a hard dependency.

## Design

There is a single, workspace-wide brain (not one per project), backed by an
embedded LatticeDB graph database at `brain/knowledge.lattice`. `learn_from`
reads a source's structured output — by default graphify's
`graphify-out/graph.json`, or any file in the same schema via an explicit
`path` argument — and incrementally syncs it in — creating, updating, and
deleting nodes and edges to match, scoped by a `_brain_source` tag so
different sources never clobber each other. All of this schema-parsing lives
behind the generic `SourceAdapter` interface (`src/sources/types.ts`); the
sync logic in `src/learn-from.ts` never sees graphify's shape directly, only
the adapter's normalized `{gid, labels, properties}` nodes and
`{sourceGid, targetGid, type, properties}` edges. `src/sources/graphify-out.ts`
is the one adapter implementing that interface today, for graphify's own
`{nodes, links, hyperedges}` format. `recall` runs a literal Cypher query
against the graph and returns the matching rows, acting as a raw query/write
escape hatch with no natural-language layer of its own.
`remember` writes a single fact directly (not via a bulk source sync),
optionally linked to existing nodes by gid or full-text search, tagged
`_brain_source: "remember"`. `forget` soft- (default) or permanently
deletes any node or edge regardless of source — soft forget relabels/
retypes rather than truly deleting, so `learn_from`'s next sync never
resurrects a tombstoned graphify-sourced node or edge.

`study_status` reports, for one path or every path ever synced via
`learn_from`, whether it's stale and roughly what re-studying would cost —
without ever triggering a re-study itself. It shells out to graphify's own
`detect_incremental()` (the same function `/graphify --update` uses) rather
than reimplementing staleness detection, and estimates token cost by
extrapolating from that path's `graphify-out/cost.json` history. A re-study
still goes through `/graphify --update` (or a fresh `/graphify` run) followed
by `learn_from` — brain never dispatches extraction itself.

## Concurrency

Every session that loads this plugin launches its own `server.ts` over stdio,
but LatticeDB takes one writer. The first process to start becomes the
**primary**: it opens the database, serves the tools over stdio, and listens on
a Unix socket at `brain/brain.sock` beside the graph, recording its PID in
`brain/brain.pid`. A session that starts later finds that PID alive and becomes
a **proxy** — it opens no database of its own and forwards the MCP byte stream
between its own stdin/stdout and the primary's socket. Both roles serve the
same tools from the same handlers.

Election is retried for a few seconds, so two sessions starting at once still
settle on a single primary. The socket and PID file need no manual cleanup: a
stale pair is removed by whichever process becomes the next primary. A proxy
exits with its primary — MCP sessions are negotiated per connection, so it
cannot re-attach to a replacement — and its client then sees the brain server
go away until the session restarts it.
