#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { dirname, join } from "node:path";
import { openBrain, resolveProjectDir } from "./src/db";
import { syncSource } from "./src/learn-from";
import { graphifyOutAdapter } from "./src/sources/graphify-out";
import { recall } from "./src/recall";
import { remember } from "./src/remember";
import { forget, type ForgetTarget } from "./src/forget";
import { jsonStringify } from "./src/json";
import { resolveGraphifyMetadata, upsertStudiedPath } from "./src/study-registry";
import { studyStatus } from "./src/study-status";

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

const server = new Server({ name: "brain", version: "0.4.1" }, { capabilities: { tools: {} } });

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

const transport = new StdioServerTransport();
await server.connect(transport);
