/**
 * The tool surface, as a plain function over injected dependencies.
 *
 * `server.ts` owns the MCP transport and nothing else; every decision lives
 * here so tests can drive add/list/remove/config directly, with a temp state
 * dir and no stdio, and assert what the model would see.
 *
 * Tool names are the kebab-case style the rest of the marketplace uses; omp
 * exposes them as `mcp__routines_routines_<name with underscores>`.
 */

import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import { parseExpression } from "./parse.ts";
import { StoreCorruptError, loadJobs, saveJobs, type Job } from "./store.ts";
import { isValidTimezone, loadConfig, saveConfig } from "./config.ts";
import { computeNextRun } from "./scheduler.ts";

export interface ToolDeps {
  jobsFile: string;
  configFile: string;
  log(line: string): void;
  /** Called after any mutation so the scheduler reconciles immediately. */
  afterChange(): void;
  now?(): number;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "add-job",
    description:
      "Schedule a routine to run at a specific time or recurring interval. Fires a channel notification when due.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "What to do when the routine fires. Write it self-contained — it is delivered to a fresh agent with no memory of this conversation.",
        },
        expression: {
          type: "string",
          description:
            "Natural language schedule: 'every 3 minutes', 'every weekday at 3am', 'once in 5 minutes'; or a raw 5/6-field cron expression. Times resolve in the configured timezone.",
        },
      },
      required: ["task", "expression"],
    },
  },
  {
    name: "list-jobs",
    description: "List all routines with their next fire time.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "remove-job",
    description: "Remove a routine by its ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Routine ID to remove" } },
      required: ["id"],
    },
  },
  {
    name: "clear-jobs",
    description: "Remove every routine. Destructive — use remove-job for a single one.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get-config",
    description: "Read the scheduler configuration (timezone, paused).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set-config",
    description:
      "Update the scheduler configuration. Use it to change the timezone schedules resolve in, or to pause/resume firing.",
    inputSchema: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "IANA timezone name, e.g. America/Toronto" },
        paused: { type: "boolean", description: "true suspends all firing without losing routines" },
      },
    },
  },
];

function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

function failure(body: string): ToolResult {
  return { content: [{ type: "text", text: body }], isError: true };
}

export function handleTool(name: string, args: Record<string, unknown>, deps: ToolDeps): ToolResult {
  const now = deps.now ?? (() => Date.now());
  const str = (key: string): string => (typeof args[key] === "string" ? (args[key] as string) : "");

  try {
    switch (name) {
      case "add-job": {
        const task = str("task");
        const expression = str("expression");
        if (!task || !expression) {
          return failure("Both `task` and `expression` are required.");
        }
        const parsed = parseExpression(expression, now());
        if (!parsed) {
          return failure(
            `Cannot parse expression: "${expression}". Try "every 3 minutes", "every weekday at 3am", "once in 5 minutes", or a raw 5-field cron expression.`,
          );
        }

        const { config } = loadConfig(deps.configFile);
        const job: Job = {
          id: randomUUID().slice(0, 8),
          task,
          expression: parsed.value,
          type: parsed.type,
          created: new Date(now()).toISOString(),
        };

        if (parsed.type === "cron") {
          try {
            const probe = new Cron(parsed.value, { paused: true, timezone: config.timezone });
            const next = probe.nextRun();
            probe.stop();
            if (next) job.nextRun = next.toISOString();
          } catch (error) {
            return failure(`Invalid cron expression "${parsed.value}": ${(error as Error).message}`);
          }
        } else {
          job.nextRun = parsed.value;
        }

        const jobs = loadJobs(deps.jobsFile);
        jobs.push(job);
        saveJobs(deps.jobsFile, jobs);
        deps.afterChange();

        return text(
          JSON.stringify(
            {
              id: job.id,
              task: job.task,
              expression,
              cronExpression: job.expression,
              type: job.type,
              timezone: config.timezone,
              nextRun: job.nextRun,
            },
            null,
            2,
          ),
        );
      }

      case "list-jobs": {
        const { config } = loadConfig(deps.configFile);
        const jobs = loadJobs(deps.jobsFile).map((job) => ({
          ...job,
          nextRun: computeNextRun(job, config.timezone) ?? undefined,
        }));
        if (jobs.length === 0) {
          return text(`No active routines. Timezone: ${config.timezone}${config.paused ? " (paused)" : ""}.`);
        }
        return text(JSON.stringify({ timezone: config.timezone, paused: config.paused, jobs }, null, 2));
      }

      case "remove-job": {
        const id = str("id");
        if (!id) return failure("`id` is required.");
        const before = loadJobs(deps.jobsFile);
        const after = before.filter((job) => job.id !== id);
        if (before.length === after.length) {
          return failure(`Routine "${id}" not found.`);
        }
        saveJobs(deps.jobsFile, after);
        deps.afterChange();
        return text(`Routine ${id} removed.`);
      }

      case "clear-jobs": {
        const before = loadJobs(deps.jobsFile);
        saveJobs(deps.jobsFile, []);
        deps.afterChange();
        return text(`Cleared ${before.length} routine(s).`);
      }

      case "get-config": {
        const { config, warning } = loadConfig(deps.configFile);
        return text(JSON.stringify({ ...config, ...(warning ? { warning } : {}) }, null, 2));
      }

      case "set-config": {
        const { config, warning } = loadConfig(deps.configFile);
        const next = { ...config };
        if (args.timezone !== undefined) {
          const timezone = str("timezone");
          if (!isValidTimezone(timezone)) {
            return failure(`"${timezone}" is not a known IANA timezone.`);
          }
          next.timezone = timezone;
        }
        if (args.paused !== undefined) {
          if (typeof args.paused !== "boolean") return failure("`paused` must be a boolean.");
          next.paused = args.paused;
        }
        saveConfig(deps.configFile, next);
        deps.afterChange();
        deps.log(`routines: config updated — timezone=${next.timezone} paused=${next.paused}`);
        return text(JSON.stringify({ ...next, ...(warning ? { warning } : {}) }, null, 2));
      }

      default:
        return failure(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof StoreCorruptError) {
      return failure(
        `${error.message}. The file was left exactly as found — inspect it before scheduling anything; every routine on this host lives in that one file.`,
      );
    }
    return failure(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
