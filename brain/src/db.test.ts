import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBrainPath, resolveProjectDir, openBrain } from "./db";
test("resolveBrainPath uses CLAUDE_PROJECT_DIR", () => {
  const prior = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = "/tmp/fake-workspace";
  expect(resolveBrainPath()).toBe("/tmp/fake-workspace/brain/knowledge.lattice");
  if (prior === undefined) delete process.env.CLAUDE_PROJECT_DIR;
  else process.env.CLAUDE_PROJECT_DIR = prior;
});

test("resolveProjectDir falls back to /workspace when env unset and cwd has no brain/", () => {
  const prior = process.env.CLAUDE_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
  const cwd = process.cwd();
  process.chdir(tmpdir());
  try {
    expect(resolveProjectDir()).toBe("/workspace");
  } finally {
    process.chdir(cwd);
    if (prior !== undefined) process.env.CLAUDE_PROJECT_DIR = prior;
  }
});


test("openBrain creates the db file and parent dir if missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brain-db-test-"));
  const dbPath = join(dir, "nested", "knowledge.lattice");
  const db = await openBrain(dbPath);
  expect(db.isOpen()).toBe(true);
  await db.close();
});

test("openBrain({ readOnly: true }) opens an existing db without creating it, and blocks writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brain-db-test-"));
  const dbPath = join(dir, "knowledge.lattice");

  // Seed it read-write first.
  const seed = await openBrain(dbPath);
  await seed.write(async (txn) => {
    await txn.createNode({ labels: ["Thing"], properties: { name: "A" } });
  });
  await seed.close();

  const db = await openBrain(dbPath, { readOnly: true });
  expect(db.isOpen()).toBe(true);

  const rows = (await db.query("MATCH (n:Thing) RETURN n.name")).rows;
  expect(rows).toEqual([{ "n.name": "A" }]);

  await expect(db.query('CREATE (n:Thing {name: "B"}) RETURN n.name')).rejects.toThrow();
  await expect(
    db.write(async (txn) => {
      await txn.createNode({ labels: ["Thing"], properties: { name: "C" } });
    })
  ).rejects.toThrow();

  await db.close();
});

test("openBrain({ readOnly: true }) does not create a missing db file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brain-db-test-"));
  const dbPath = join(dir, "does-not-exist.lattice");
  await expect(openBrain(dbPath, { readOnly: true })).rejects.toThrow();
});
