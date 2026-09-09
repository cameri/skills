import { Database } from "@hajewski/latticedb";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Workspace root resolution for brain's on-disk state. Precedence:
 * 1. CLAUDE_PROJECT_DIR (set by Claude Code / omp MCP launchers)
 * 2. cwd, when it already carries a brain/ dir (direct CLI/dev use)
 * 3. /workspace (this deployment's canonical workspace root — a fallback,
 *    not an override; explicit env always wins, so portability is intact)
 */
export function resolveProjectDir(): string {
  const env = process.env.CLAUDE_PROJECT_DIR?.trim();
  if (env) return env;
  const cwd = process.cwd();
  if (existsSync(join(cwd, "brain"))) return cwd;
  return "/workspace";
}

export function resolveBrainPath(): string {
  return join(resolveProjectDir(), "brain", "knowledge.lattice");
}

export interface OpenBrainOptions {
  readOnly?: boolean;
}

export async function openBrain(
  path: string = resolveBrainPath(),
  options: OpenBrainOptions = {}
): Promise<Database> {
  if (options.readOnly) {
    const db = new Database(path, { readOnly: true });
    await db.open();
    return db;
  }
  await mkdir(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  await db.open();
  return db;
}
