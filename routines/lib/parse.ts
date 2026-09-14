/**
 * Natural-language schedule parsing.
 *
 * Ported from `cronjobs/server.ts` unchanged — the phrase set is the plugin's
 * user-facing contract and the migration carries live expressions ("0 8 * * *")
 * that must keep meaning the same thing.
 *
 * Interpretation: every "at TIME" schedule and every raw cron expression is in
 * the scheduler's configured timezone (config.json), never UTC. The parser only
 * produces the cron string; the timezone is applied by the caller when the job
 * is armed.
 */

export type Parsed = { type: "cron"; value: string } | { type: "once"; value: string };

function parseTime(s: string): { hour: number; minute: number } | null {
  s = s.trim();
  if (s === "noon") return { hour: 12, minute: 0 };
  if (s === "midnight") return { hour: 0, minute: 0 };
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = parseInt(m[1]);
  const minute = m[2] ? parseInt(m[2]) : 0;
  const period = m[3]?.toLowerCase();
  if (period === "am" && hour === 12) hour = 0;
  if (period === "pm" && hour !== 12) hour += 12;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

const DAY_NAMES: Record<string, string> = {
  sunday: "0", monday: "1", tuesday: "2", wednesday: "3",
  thursday: "4", friday: "5", saturday: "6",
  sun: "0", mon: "1", tue: "2", wed: "3", thu: "4", fri: "5", sat: "6",
};

/**
 * Parse a schedule expression into a cron string or an absolute ISO timestamp.
 * Returns null when nothing matches, so the caller can report the expression
 * back instead of storing a job that never fires.
 *
 * `now` is injectable so the "once in N minutes" family is deterministic in
 * tests; production callers omit it.
 */
export function parseExpression(expr: string, now: number = Date.now()): Parsed | null {
  const e = expr.trim().toLowerCase();

  let m: RegExpMatchArray | null;

  // ── One-time ───────────────────────────────────────────────────────────────

  // "once in N seconds/minutes/hours"
  m = e.match(/^once\s+in\s+(\d+)\s+(seconds?|minutes?|hours?)$/);
  if (m) {
    return { type: "once", value: new Date(now + delayMs(m[1], m[2])).toISOString() };
  }

  // "in N seconds/minutes/hours"
  m = e.match(/^in\s+(\d+)\s+(seconds?|minutes?|hours?)$/);
  if (m) {
    return { type: "once", value: new Date(now + delayMs(m[1], m[2])).toISOString() };
  }

  // ── Aliases ────────────────────────────────────────────────────────────────

  if (e === "every minute") return { type: "cron", value: "* * * * *" };
  if (e === "every hour") return { type: "cron", value: "0 * * * *" };
  if (e === "every day" || e === "daily") return { type: "cron", value: "0 0 * * *" };

  // ── Every N units ──────────────────────────────────────────────────────────

  // "every N seconds" (6-field cron with seconds)
  m = e.match(/^every\s+(\d+)\s+seconds?$/);
  if (m) {
    const n = parseInt(m[1]);
    return { type: "cron", value: n === 1 ? "* * * * * *" : `*/${n} * * * * *` };
  }

  // "every N minutes"
  m = e.match(/^every\s+(\d+)\s+minutes?$/);
  if (m) {
    const n = parseInt(m[1]);
    return { type: "cron", value: n === 1 ? "* * * * *" : `*/${n} * * * *` };
  }

  // "every N hours"
  m = e.match(/^every\s+(\d+)\s+hours?$/);
  if (m) {
    const n = parseInt(m[1]);
    return { type: "cron", value: n === 1 ? "0 * * * *" : `0 */${n} * * *` };
  }

  // ── Every day/weekday/weekend at TIME ──────────────────────────────────────

  m = e.match(/^every\s+day\s+at\s+(.+)$/);
  if (m) {
    const t = parseTime(m[1]);
    if (t) return { type: "cron", value: `${t.minute} ${t.hour} * * *` };
  }

  m = e.match(/^every\s+(weekday|weekdays)\s+at\s+(.+)$/);
  if (m) {
    const t = parseTime(m[2]);
    if (t) return { type: "cron", value: `${t.minute} ${t.hour} * * 1-5` };
  }

  m = e.match(/^every\s+(weekend|weekends)\s+at\s+(.+)$/);
  if (m) {
    const t = parseTime(m[2]);
    if (t) return { type: "cron", value: `${t.minute} ${t.hour} * * 0,6` };
  }

  m = e.match(/^every\s+(weekday|weekdays)$/);
  if (m) return { type: "cron", value: "0 0 * * 1-5" };

  m = e.match(/^every\s+(weekend|weekends)$/);
  if (m) return { type: "cron", value: "0 0 * * 0,6" };

  // ── Every named day [at TIME] ──────────────────────────────────────────────

  m = e.match(/^every\s+(\w+)\s+at\s+(.+)$/);
  if (m) {
    const dayNum = DAY_NAMES[m[1]];
    const t = parseTime(m[2]);
    if (dayNum !== undefined && t) {
      return { type: "cron", value: `${t.minute} ${t.hour} * * ${dayNum}` };
    }
  }

  m = e.match(/^every\s+(\w+)$/);
  if (m) {
    const dayNum = DAY_NAMES[m[1]];
    if (dayNum !== undefined) return { type: "cron", value: `0 0 * * ${dayNum}` };
  }

  // ── Raw cron expression (5 or 6 space-separated fields) ───────────────────

  if (/^[\d*/,\-\s]+$/.test(e)) {
    const fields = e.trim().split(/\s+/);
    if (fields.length === 5 || fields.length === 6) {
      return { type: "cron", value: e.trim() };
    }
  }

  return null;
}

function delayMs(count: string, unit: string): number {
  const n = parseInt(count);
  if (unit.startsWith("second")) return n * 1_000;
  if (unit.startsWith("minute")) return n * 60_000;
  return n * 3_600_000;
}
