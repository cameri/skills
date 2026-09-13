import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// The rest of the suite calls learn_from/recall as plain library functions.
// This test is the one that actually exercises server.ts as a subprocess
// speaking the real MCP stdio protocol, the way Claude Code's MCP client
// does — proving the tool schemas, request routing, and JSON serialization
// all work end to end, not just the underlying functions.

const FIXTURE = {
  nodes: [{ id: "n1", label: "Thing One", file_type: "code" }],
  links: [],
};

test("brain MCP server: learn_from then recall over a real stdio connection", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "brain-mcp-smoke-"));
  const graphifyOutDir = join(projectDir, "graphify-out");
  mkdirSync(graphifyOutDir, { recursive: true });
  writeFileSync(join(graphifyOutDir, "graph.json"), JSON.stringify(FIXTURE));

  const transport = new StdioClientTransport({
    command: "bun",
    args: [join(import.meta.dir, "..", "server.ts")],
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
  const client = new Client({ name: "brain-smoke-test", version: "0.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["forget", "learn_from", "recall", "remember", "study_status"]);

    const learnResult = await client.callTool({ name: "learn_from", arguments: {} });
    const learnText = (learnResult.content as Array<{ type: string; text: string }>)[0]!.text;
    const learnSummary = JSON.parse(learnText);
    expect(Number(learnSummary.nodesCreated)).toBeGreaterThanOrEqual(1);

    const recallResult = await client.callTool({
      name: "recall",
      arguments: { query: "MATCH (n:Code) RETURN n.label" },
    });
    const recallText = (recallResult.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(JSON.parse(recallText)).toEqual({ rows: [{ "n.label": "Thing One" }] });

    // The read-only enforcement is unit-tested directly against openBrain
    // elsewhere; here just confirm the real protocol path surfaces the
    // rejection as a JSON-RPC error rather than crashing the connection or
    // silently succeeding.
    await expect(
      client.callTool({ name: "recall", arguments: { query: "CREATE (n:ShouldNotExist)" } })
    ).rejects.toThrow();

    // Connection must still be alive after that error.
    const followUp = await client.callTool({
      name: "recall",
      arguments: { query: "MATCH (n:Code) RETURN count(n) AS c" },
    });
    const followUpText = (followUp.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(JSON.parse(followUpText)).toEqual({ rows: [{ c: "1" }] });

    const rememberResult = await client.callTool({
      name: "remember",
      arguments: { text: "smoke-tested via the real MCP protocol", links: ["n1"] },
    });
    const rememberText = (rememberResult.content as Array<{ type: string; text: string }>)[0]!.text;
    const remembered = JSON.parse(rememberText);
    expect(remembered.links).toEqual([{ input: "n1", resolvedGid: "n1" }]);

    const forgetResult = await client.callTool({
      name: "forget",
      arguments: { target: { type: "node", gid: remembered.gid } },
    });
    const forgetText = (forgetResult.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(JSON.parse(forgetText)).toEqual({ found: true, edgesAffected: 1 });

    const afterForget = await client.callTool({
      name: "recall",
      arguments: { query: "MATCH (n:Fact) RETURN n.gid" },
    });
    const afterForgetText = (afterForget.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(JSON.parse(afterForgetText)).toEqual({ rows: [] });

    // learn_from's 'path' override: sync a graph-json snapshot from outside
    // graphify-out/ entirely, proving the tool isn't hardwired to graphify's
    // own output directory — any producer of the same schema works.
    const externalPath = join(projectDir, "other-tool-output.json");
    writeFileSync(externalPath, JSON.stringify({ nodes: [{ id: "n2", label: "Thing Two", file_type: "doc" }], links: [] }));
    const externalLearnResult = await client.callTool({ name: "learn_from", arguments: { path: externalPath } });
    const externalLearnText = (externalLearnResult.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(JSON.parse(externalLearnText)).toMatchObject({ nodesCreated: 1 });

    const externalRecall = await client.callTool({
      name: "recall",
      arguments: { query: "MATCH (n:Doc) RETURN n.label" },
    });
    const externalRecallText = (externalRecall.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(JSON.parse(externalRecallText)).toEqual({ rows: [{ "n.label": "Thing Two" }] });

    // study_status: seed a minimal real graphify-out/ (graph.json + the three
    // sidecars learn_from's registry upsert reads), sync it, then confirm
    // study_status reports it — proving the full server.ts wiring, not just
    // the unit-tested pieces in isolation.
    const studiedDir = join(projectDir, "graphify-out");
    writeFileSync(join(studiedDir, ".graphify_root"), projectDir);
    writeFileSync(join(studiedDir, ".graphify_python"), process.execPath); // any real executable; study_status here only reaches learn_from's bookkeeping, not detect_incremental
    writeFileSync(
      join(studiedDir, "cost.json"),
      JSON.stringify({ runs: [{ date: "2026-08-27T00:00:00Z", input_tokens: 100, output_tokens: 20, files: 2 }] })
    );
    await client.callTool({ name: "learn_from", arguments: { path: join(studiedDir, "graph.json"), duration_seconds: 12 } });

    const registryRecall = await client.callTool({
      name: "recall",
      arguments: { query: "MATCH (n:StudiedPath) RETURN n.gid AS path, n.last_duration_seconds AS duration" },
    });
    const registryText = (registryRecall.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(JSON.parse(registryText)).toEqual({ rows: [{ path: projectDir, duration: "12" }] });
  } finally {
    await client.close();
    rmSync(projectDir, { recursive: true, force: true });
  }
}, 30_000);

// Sessions on one machine each launch their own brain MCP process, but only
// one may hold the database. The first process to start becomes the primary
// (stdio plus a Unix socket); every later one has to proxy to it over that
// socket rather than open the same LatticeDB a second time. This is the
// regression test for that election — and for the SDK's one-transport-per-
// Server rule, which a shared socket Server instance would violate: the second
// and third clients would then connect and never be answered.
test("brain MCP server: later sessions proxy to the first one's socket", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "brain-mcp-proxy-"));
  mkdirSync(join(projectDir, "graphify-out"), { recursive: true });
  writeFileSync(join(projectDir, "graphify-out", "graph.json"), JSON.stringify(FIXTURE));
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };

  const spawnClient = async () => {
    const transport = new StdioClientTransport({
      command: "bun",
      args: [join(import.meta.dir, "..", "server.ts")],
      env,
    });
    const client = new Client({ name: "brain-proxy-smoke-test", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);
    return client;
  };

  const primary = await spawnClient();
  const later: Client[] = [];
  try {
    // The primary takes ownership: its PID file is written before it starts
    // listening, which is what the later sessions elect on.
    expect(existsSync(join(projectDir, "brain", "brain.pid"))).toBe(true);

    later.push(await spawnClient(), await spawnClient());

    // All three answer over the real protocol, in both directions.
    const learned = await primary.callTool({ name: "learn_from", arguments: {} });
    expect(JSON.parse((learned.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ nodesCreated: 1 });

    const remembered = await later[0]!.callTool({
      name: "remember",
      arguments: { text: "written through a proxy" },
    });
    const gid = JSON.parse((remembered.content as Array<{ text: string }>)[0]!.text).gid as string;

    for (const client of later) {
      // Same database, whichever process the session landed on.
      const seen = await client.callTool({ name: "recall", arguments: { query: "MATCH (n:Fact) RETURN n.gid" } });
      const rows = JSON.parse((seen.content as Array<{ text: string }>)[0]!.text).rows as Array<{ "n.gid": string }>;
      expect(rows.map((r) => r["n.gid"])).toContain(gid);
    }
  } finally {
    for (const client of [primary, ...later]) await client.close();
    rmSync(projectDir, { recursive: true, force: true });
  }
}, 30_000);

// A minimal stand-in for graphify.detect used only when the real package
// cannot be found on this machine. It reproduces the two behaviours this test
// depends on: manifest_path defaulting to a RELATIVE path (the shape of the
// cwd bug), and md5-vs-manifest staleness comparison.
const STUB_DETECT_MODULE = `import hashlib, json, os
from pathlib import Path


def _md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def detect_incremental(root, manifest_path="graphify-out/manifest.json", **kwargs):
    root = Path(root).resolve()
    try:
        raw = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    except Exception:
        raw = {}
    manifest = {k if os.path.isabs(k) else str(root / k): v for k, v in raw.items()}

    scanned = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "graphify-out" and not d.startswith(".")]
        for name in filenames:
            scanned.append(str(Path(dirpath) / name))

    new_files = {"code": [], "document": []}
    for path in scanned:
        bucket = "document" if path.endswith(".md") else "code"
        stored = manifest.get(path)
        if not isinstance(stored, dict) or _md5(path) != stored.get("semantic_hash", ""):
            new_files[bucket].append(path)

    deleted = [k for k in manifest if not Path(k).exists()]
    return {
        "new_total": sum(len(v) for v in new_files.values()),
        "new_files": new_files,
        "deleted_files": deleted,
    }
`;

function graphifyImports(pythonPath: string, pythonPathEnv?: string): boolean {
  const proc = Bun.spawnSync([pythonPath, "-c", "from graphify.detect import detect_incremental"], {
    env: pythonPathEnv ? { ...process.env, PYTHONPATH: pythonPathEnv } : process.env,
  });
  return proc.exitCode === 0;
}

// Prefers the real graphify package so this is a genuine end-to-end test of
// brain's actual subprocess contract; falls back to a self-contained stub so
// the test stays hermetic on a machine without graphify.
function resolveGraphify(): { pythonPath: string; pythonPathEnv?: string; mode: string } {
  const pythonPath = Bun.which("python3");
  if (!pythonPath) throw new Error("python3 is required for the study_status round-trip test");

  if (graphifyImports(pythonPath)) return { pythonPath, mode: "installed" };

  const uvArchives = join(homedir(), ".cache", "uv", "archive-v0");
  try {
    for (const hit of new Bun.Glob("*/graphify/detect.py").scanSync({ cwd: uvArchives })) {
      const candidate = join(uvArchives, hit.slice(0, hit.indexOf("/graphify/")));
      if (graphifyImports(pythonPath, candidate)) {
        return { pythonPath, pythonPathEnv: candidate, mode: "uv-cache" };
      }
    }
  } catch {
    // no uv cache on this machine — fall through to the stub
  }

  const stubRoot = mkdtempSync(join(tmpdir(), "brain-graphify-stub-"));
  mkdirSync(join(stubRoot, "graphify"), { recursive: true });
  writeFileSync(join(stubRoot, "graphify", "__init__.py"), "");
  writeFileSync(join(stubRoot, "graphify", "detect.py"), STUB_DETECT_MODULE);
  return { pythonPath, pythonPathEnv: stubRoot, mode: "stub" };
}

// graphify's manifest schema: relative keys, per-file mtime + content hashes.
// `seen` is deliberately older than mtime so detect_incremental takes its
// stat-only fastpath rather than the same-tick rewrite guard.
function writeManifest(graphifyOutDir: string, corpusRoot: string, relFiles: string[]) {
  const manifest: Record<string, unknown> = {};
  for (const rel of relFiles) {
    const abs = join(corpusRoot, rel);
    const mtime = statSync(abs).mtimeMs / 1000;
    manifest[rel] = {
      mtime,
      seen: mtime - 100,
      ast_hash: "",
      semantic_hash: new Bun.CryptoHasher("md5").update(readFileSync(abs)).digest("hex"),
    };
  }
  writeFileSync(join(graphifyOutDir, "manifest.json"), JSON.stringify(manifest));
}

// The one test that runs study_status over the real stdio protocol against a
// real Python interpreter and a real manifest.json. It is also the regression
// test for the manifest-path bug: detect_incremental defaults manifest_path to
// the RELATIVE "graphify-out/manifest.json", so unless brain passes it
// explicitly, load_manifest silently returns {} and EVERY path — including an
// untouched one — reports isStale with the whole corpus as "changed".
test("brain MCP server: study_status reports a real unchanged path as fresh, then stale after an edit", async () => {
  const { pythonPath, pythonPathEnv, mode } = resolveGraphify();
  const workspaceDir = mkdtempSync(join(tmpdir(), "brain-study-status-ws-"));
  const corpusDir = mkdtempSync(join(tmpdir(), "brain-study-status-corpus-"));
  const graphifyOutDir = join(corpusDir, "graphify-out");
  mkdirSync(graphifyOutDir, { recursive: true });

  const sourceFile = join(corpusDir, "sample.py");
  writeFileSync(sourceFile, "def hello():\n    return 1\n");
  writeFileSync(join(graphifyOutDir, "graph.json"), JSON.stringify(FIXTURE));
  writeFileSync(join(graphifyOutDir, ".graphify_root"), corpusDir);
  writeFileSync(join(graphifyOutDir, ".graphify_python"), pythonPath);
  writeFileSync(
    join(graphifyOutDir, "cost.json"),
    JSON.stringify({ runs: [{ date: "2026-08-27T00:00:00Z", input_tokens: 100, output_tokens: 20, files: 2 }] })
  );
  writeManifest(graphifyOutDir, corpusDir, ["sample.py"]);

  const transport = new StdioClientTransport({
    command: "bun",
    args: [join(import.meta.dir, "..", "server.ts")],
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: workspaceDir,
      ...(pythonPathEnv ? { PYTHONPATH: pythonPathEnv } : {}),
    },
  });
  const client = new Client({ name: "brain-study-status-smoke-test", version: "0.0.0" }, { capabilities: {} });

  const callStudyStatus = async (args: Record<string, unknown>) => {
    const result = await client.callTool({ name: "study_status", arguments: args });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    return JSON.parse(text) as Array<Record<string, unknown>>;
  };

  try {
    await client.connect(transport);

    await client.callTool({
      name: "learn_from",
      arguments: { path: join(graphifyOutDir, "graph.json"), duration_seconds: 7 },
    });

    const fresh = await callStudyStatus({});
    expect(fresh.length).toBe(1);
    // Asserted before isStale: an errored path also reports isStale false, so a
    // broken subprocess would otherwise pass this test silently.
    expect(fresh[0]!.error).toBeUndefined();
    expect(fresh[0]!.path).toBe(corpusDir);
    expect(fresh[0]!.isStale).toBe(false);
    expect(fresh[0]!.changedFiles).toBe(0);
    expect(fresh[0]!.deletedFiles).toBe(0);

    writeFileSync(sourceFile, "def hello():\n    return 2\n# edited\n");

    const stale = await callStudyStatus({ path: corpusDir });
    expect(stale.length).toBe(1);
    expect(stale[0]!.error).toBeUndefined();
    expect(stale[0]!.isStale).toBe(true);
    expect(stale[0]!.changedFiles).toBe(1);
    expect(stale[0]!.needsLlm).toBe(false);
    expect(stale[0]!.estimatedInputTokens).toBe(50); // (100/2) * 1
    expect(stale[0]!.estimatedOutputTokens).toBe(10); // (20/2) * 1
  } finally {
    await client.close();
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(corpusDir, { recursive: true, force: true });
  }
  expect(["installed", "uv-cache", "stub"]).toContain(mode);
}, 60_000);
