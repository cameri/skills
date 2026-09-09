import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveProjectDir } from "../db";
import type { SourceAdapter, SourceNode, SourceEdge, SourceSnapshot } from "./types";

interface GraphifyNode {
  id: string;
  label?: string;
  file_type?: string;
  norm_label?: string;
  source_file?: string;
  [key: string]: unknown;
}

interface GraphifyLink {
  source: string;
  target: string;
  relation?: string;
  [key: string]: unknown;
}

interface GraphifyHyperedge {
  id: string;
  label?: string;
  nodes: string[];
  [key: string]: unknown;
}

interface GraphifyOutJson {
  nodes: GraphifyNode[];
  links: GraphifyLink[];
  hyperedges?: GraphifyHyperedge[];
}

export async function readGraphifyOut(
  graphJsonPath: string,
  sourceName: string = "graphify-out"
): Promise<SourceSnapshot> {
  let raw: string;
  try {
    raw = await readFile(graphJsonPath, "utf-8");
  } catch (err) {
    throw new Error(`Could not read graph.json at ${graphJsonPath}: ${(err as Error).message}`);
  }
  const data: GraphifyOutJson = JSON.parse(raw);

  const nodes: SourceNode[] = [];
  const edges: SourceEdge[] = [];

  for (const n of data.nodes) {
    // file_type only becomes a label here, at node-creation time — it is
    // never carried as a property, so syncSource's diff (which only
    // compares properties, not labels) won't catch or update the label if
    // a node's file_type changes in a later graphify-out run. Known,
    // accepted v1 limitation.
    const { id, file_type, ...rest } = n;
    const labels = [file_type ? capitalize(file_type) : undefined, "GraphifyNode"].filter(
      Boolean
    ) as string[];
    nodes.push({
      gid: id,
      labels,
      properties: { ...rest, _brain_source: sourceName },
      ftsText: [n.label, n.norm_label, n.source_file].filter(Boolean).join(" ") || undefined,
    });
  }

  for (const l of data.links) {
    const { source, target, relation, ...rest } = l;
    edges.push({
      sourceGid: source,
      targetGid: target,
      type: (relation ?? "related_to").toUpperCase(),
      properties: { ...rest, _brain_source: sourceName },
    });
  }

  for (const he of data.hyperedges ?? []) {
    const { id, nodes: memberGids, ...rest } = he;
    nodes.push({
      gid: id,
      labels: ["Hyperedge"],
      properties: { ...rest, _brain_source: sourceName },
    });
    for (const memberGid of memberGids) {
      edges.push({
        sourceGid: id,
        targetGid: memberGid,
        type: "HYPEREDGE_MEMBER",
        properties: { _brain_source: sourceName },
      });
    }
  }

  return { nodes, edges };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Scopes _brain_source by corpus, not just by adapter type: two different
// graph-json files (e.g. two projects' own graphify-out/graph.json, synced
// via learn_from's `path` override) must never share a tag, or syncSource's
// existing-node diff for one corpus would see and delete the other's nodes.
// The workspace's own default corpus (resolveProjectDir()/graphify-out) keeps
// the plain legacy "graphify-out" tag so already-synced data isn't orphaned.
function sourceNameFor(graphJsonPath: string): string {
  const dir = resolve(dirname(graphJsonPath));
  const defaultDir = resolve(join(resolveProjectDir(), "graphify-out"));
  return dir === defaultDir ? "graphify-out" : `graphify-out:${dir}`;
}

export const graphifyOutAdapter = (graphJsonPath: string): SourceAdapter => {
  const name = sourceNameFor(graphJsonPath);
  return { name, read: () => readGraphifyOut(graphJsonPath, name) };
};
