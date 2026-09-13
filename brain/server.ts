#!/usr/bin/env bun
// brain MCP server — one LatticeDB, many agents.
//
// Every agent session launches this file over stdio, but only one process may
// hold the database. So the first instance to start becomes the PRIMARY: it
// opens the DB and serves the tools over stdio *and* over a Unix socket
// (<project root>/brain/brain.sock), recording its PID in brain.pid next to it.
//
// Later instances find that PID alive and become PROXIES: they never open the
// DB, they just forward the MCP byte stream between their own stdin/stdout and
// the primary's socket. Handlers are identical in both roles — a proxy is a
// transport, not a second implementation of the tools.
//
// A fresh Server is built per socket connection: the SDK permits exactly one
// transport per Server instance ("Already connected to a transport"), so a
// shared instance would answer the first socket client and hang every other.
//
// Known limitation: MCP sessions are negotiated per connection, so a proxy
// cannot re-attach to a replacement primary — if the primary dies, the proxies
// exit(0) with it and their clients see the brain server go away.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { dirname, join } from "node:path";
import * as fs from "node:fs";
import * as net from "node:net";
import { openBrain, resolveProjectDir } from "./src/db";
import { syncSource } from "./src/learn-from";
import { graphifyOutAdapter } from "./src/sources/graphify-out";
import { recall } from "./src/recall";
import { remember } from "./src/remember";
import { forget, type ForgetTarget } from "./src/forget";
import { jsonStringify } from "./src/json";
import { resolveGraphifyMetadata, upsertStudiedPath } from "./src/study-registry";
import { studyStatus } from "./src/study-status";
import pkg from "./package.json";

const VERSION: string = pkg.version;
const ELECTION_ATTEMPTS = 5;
const ELECTION_DELAY_MS = 500;

function assertValidForgetTarget(target: unknown): asserts target is ForgetTarget {
  if (typeof target !== "object" || target === null) {
    throw new Error("forget requires a 'target' object");
  }
  const t = target as Record<string, unknown>;
  if (t.type === "node") {
    if (typeof t.gid !== "string") {
      throw new Error("forget target of type 'node' requires a string 'gid'");
    }
    return;
  }
  if (t.type === "edge") {
    if (typeof t.sourceGid !== "string" || typeof t.targetGid !== "string" || typeof t.edgeType !== "string") {
      throw new Error("forget target of type 'edge' requires string 'sourceGid', 'targetGid', and 'edgeType'");
    }
    return;
  }
  throw new Error("forget target's 'type' must be 'node' or 'edge'");
}

function socketPath(root: string): string {
  return join(root, "brain", "brain.sock");
}

function pidPath(root: string): string {
  return join(root, "brain", "brain.pid");
}

// The PID of a live primary, or undefined when the file is missing, malformed,
// stale, or belongs to a dead process.
function primaryPid(pp: string): number | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(pp, "utf-8").trim();
  } catch {
    return undefined;
  }
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM" ? pid : undefined;
  }
}

// Newline-delimited JSON framing, matching StdioServerTransport: one JSON-RPC
// message per line, no Content-Length headers.
class LineSocketTransport implements Transport {
  private _socket: net.Socket;
  private _buf = "";
  onmessage?: (message: unknown) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  constructor(socket: net.Socket) {
    this._socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this._buf += chunk.toString("utf-8");
      this._flush();
    });
    socket.on("error", (err) => this.onerror?.(err));
    socket.on("close", () => this.onclose?.());
  }

  async start(): Promise<void> {
    this._flush();
  }

  async send(message: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._socket.write(JSON.stringify(message) + "\n", (err) => (err ? reject(err) : resolve()));
    });
  }

  async close(): Promise<void> {
    this._socket.destroy();
  }

  private _flush(): void {
    const lines = this._buf.split("\n");
    this._buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this.onmessage?.(JSON.parse(trimmed));
      } catch {
        console.error("brain: dropping malformed socket message");
      }
    }
  }
}

function registerHandlers(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "learn_from",
        description:
          "Sync a graph-json snapshot (nodes/links/hyperedges — the format graphify writes) into the brain (create/update/delete, incremental). Defaults to graphify-out/graph.json under the project root. Also records the path in brain's own study registry for study_status.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the graph-json file to sync. Defaults to graphify-out/graph.json under CLAUDE_PROJECT_DIR." },
            duration_seconds: {
              type: "number",
              description: "Wall-clock seconds the calling agent's graphify run took, if known/timed. Recorded on the path's study registry entry; omit if not timed — no estimate is invented in its place.",
            },
          },
          additionalProperties: false,
        },
      },
      {
        name: "study_status",
        description:
          "Report staleness and an estimated re-study cost for one or every path previously synced via learn_from, without triggering a re-study. Shells out to graphify's own detect_incremental().",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "A specific corpus root (as previously synced via learn_from's path argument's directory). Omit to report on every registered path." },
          },
          additionalProperties: false,
        },
      },
      {
        name: "recall",
        description: "Run a literal Cypher query against the brain and return matching rows.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Literal Cypher query." },
            parameters: { type: "object", description: "Optional query parameters." },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        name: "remember",
        description: "Write a single fact into the brain, optionally linked to existing nodes by gid or search string.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "The fact itself. Always full-text indexed." },
            properties: { type: "object", description: "Optional structured key/values alongside the text." },
            links: {
              type: "array",
              items: { type: "string" },
              description: "Each entry is either a known node gid, or a search string resolved via full-text search (top hit, best-effort).",
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
      },
      {
        name: "forget",
        description: "Soft (default, recoverable) or permanent delete of a node or edge from the brain.",
        inputSchema: {
          type: "object",
          properties: {
            target: {
              oneOf: [
                {
                  type: "object",
                  properties: { type: { const: "node" }, gid: { type: "string" } },
                  required: ["type", "gid"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    type: { const: "edge" },
                    sourceGid: { type: "string" },
                    targetGid: { type: "string" },
                    edgeType: { type: "string" },
                  },
                  required: ["type", "sourceGid", "targetGid", "edgeType"],
                  additionalProperties: false,
                },
              ],
            },
            permanent: { type: "boolean", description: "Defaults to false (soft, recoverable). true is a real, permanent delete." },
          },
          required: ["target"],
          additionalProperties: false,
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "learn_from") {
      const { path, duration_seconds } = (request.params.arguments as { path?: unknown; duration_seconds?: unknown } | undefined) ?? {};
      if (path !== undefined && typeof path !== "string") {
        throw new Error("learn_from's 'path' parameter must be a string");
      }
      if (duration_seconds !== undefined && typeof duration_seconds !== "number") {
        throw new Error("learn_from's 'duration_seconds' parameter must be a number");
      }
      const db = await openBrain();
      try {
        const root = resolveProjectDir();
        const graphJsonPath = path ?? join(root, "graphify-out", "graph.json");
        const adapter = graphifyOutAdapter(graphJsonPath);
        const result = await syncSource(db, adapter);

        const metadata = await resolveGraphifyMetadata(graphJsonPath);
        // Registered whenever graphify's sidecars are present — a path with no
        // cost.json yet (first study, or an --update-only run) is still a
        // studied path, and study_status reports a null cost estimate for it.
        if (metadata) {
          await upsertStudiedPath(db, {
            corpusRoot: metadata.corpusRoot,
            graphifyOutPath: dirname(graphJsonPath),
            inputTokens: metadata.lastRun?.inputTokens ?? 0,
            outputTokens: metadata.lastRun?.outputTokens ?? 0,
            durationSeconds: duration_seconds,
          });
        }

        return { content: [{ type: "text", text: jsonStringify(result) }] };
      } finally {
        await db.close();
      }
    }
    if (request.params.name === "study_status") {
      const { path } = (request.params.arguments as { path?: unknown } | undefined) ?? {};
      if (path !== undefined && typeof path !== "string") {
        throw new Error("study_status's 'path' parameter must be a string");
      }
      const db = await openBrain(undefined, { readOnly: true });
      try {
        const result = await studyStatus(db, path);
        return { content: [{ type: "text", text: jsonStringify(result) }] };
      } finally {
        await db.close();
      }
    }
    if (request.params.name === "recall") {
      const { query, parameters } = request.params.arguments as { query: unknown; parameters?: Record<string, unknown> };
      if (typeof query !== "string") {
        throw new Error("recall requires a 'query' string parameter");
      }
      // Opened read-only: LatticeDB rejects any write — CREATE/DELETE/SET/MERGE/REMOVE
      // — at the database layer, not just at the transaction API. recall can never
      // mutate the brain, regardless of what Cypher a caller composes.
      const db = await openBrain(undefined, { readOnly: true });
      try {
        const result = await recall(db, query, parameters);
        return { content: [{ type: "text", text: jsonStringify(result) }] };
      } finally {
        await db.close();
      }
    }
    if (request.params.name === "remember") {
      const { text, properties, links } = request.params.arguments as {
        text: unknown;
        properties?: Record<string, unknown>;
        links?: unknown;
      };
      if (typeof text !== "string") {
        throw new Error("remember requires a 'text' string parameter");
      }
      const db = await openBrain();
      try {
        const result = await remember(db, text, properties ?? {}, (links as string[] | undefined) ?? []);
        return { content: [{ type: "text", text: jsonStringify(result) }] };
      } finally {
        await db.close();
      }
    }
    if (request.params.name === "forget") {
      const { target, permanent } = request.params.arguments as { target: unknown; permanent?: unknown };
      if (permanent !== undefined && typeof permanent !== "boolean") {
        throw new Error("forget's 'permanent' parameter must be a boolean");
      }
      assertValidForgetTarget(target);
      const db = await openBrain();
      try {
        const result = await forget(db, target, permanent ?? false);
        return { content: [{ type: "text", text: jsonStringify(result) }] };
      } finally {
        await db.close();
      }
    }
    throw new Error(`Unknown tool: ${request.params.name}`);
  });
}

// Primary: the process that owns the database, the PID file, and the socket.
async function startPrimary(root: string): Promise<void> {
  // Fail fast and loudly here rather than on every later tool call.
  const probe = await openBrain();
  await probe.close();

  const pp = pidPath(root);
  const sp = socketPath(root);
  fs.mkdirSync(dirname(pp), { recursive: true });
  // A socket file left behind by a dead primary makes listen() fail EADDRINUSE.
  try {
    fs.unlinkSync(sp);
  } catch {
    /* not there */
  }
  fs.writeFileSync(pp, String(process.pid));

  const stdioServer = new Server({ name: "brain", version: VERSION }, { capabilities: { tools: {} } });
  registerHandlers(stdioServer);
  await stdioServer.connect(new StdioServerTransport());

  const socketServer = net.createServer((conn) => {
    const server = new Server({ name: "brain-socket", version: VERSION }, { capabilities: { tools: {} } });
    registerHandlers(server);
    server.connect(new LineSocketTransport(conn)).catch((err) => {
      console.error("brain: socket client error:", err);
      conn.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    socketServer.once("error", reject);
    socketServer.listen(sp, () => {
      // Rewritten once the socket is definitely accepting, so a proxy that
      // reads the PID file can trust the socket exists.
      fs.writeFileSync(pp, String(process.pid));
      resolve();
    });
  });
}

// Proxy: no database, no handlers — stdin/stdout piped to the primary's socket.
async function startProxy(sp: string): Promise<void> {
  const socket = net.createConnection(sp);
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve();
    });
    socket.once("error", onError);
  });

  socket.on("error", (err) => console.error("brain: proxy socket error:", err));
  process.stdin.on("data", (chunk: Buffer) => socket.write(chunk));
  process.stdin.on("end", () => socket.end());
  socket.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  socket.on("close", () => process.exit(0));
}

async function main(): Promise<void> {
  const root = resolveProjectDir();
  const pp = pidPath(root);
  const sp = socketPath(root);

  // Election. Retried because two sessions can start at the same moment: the
  // loser must wait for the winner's PID file instead of opening the same
  // database twice.
  for (let attempt = 0; attempt < ELECTION_ATTEMPTS; attempt++) {
    if (primaryPid(pp) !== undefined) {
      try {
        await startProxy(sp);
        return;
      } catch (err) {
        console.error("brain: proxy connection failed, retrying:", err);
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, ELECTION_DELAY_MS));
  }

  // Nobody answered — become the primary, clearing a dead instance's leftovers.
  for (const stale of [pp, sp]) {
    try {
      fs.unlinkSync(stale);
    } catch {
      /* not there */
    }
  }
  await startPrimary(root);
}

main().catch((err) => {
  console.error("brain fatal:", err);
  process.exit(1);
});
