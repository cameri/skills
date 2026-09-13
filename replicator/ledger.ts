export type GeneOrigin = 'inward' | 'outward-speculative' | 'adopted' | 'preexisting'
export type GeneState = 'active' | 'muted'
export type EventType = 'born' | 'muted' | 'unmuted' | 'removed-proposed' | 'removed'

export type GeneEvent = {
  at: string
  type: EventType
  reason: string
}

export type Gene = {
  origin: GeneOrigin
  born: string
  seasonal: boolean
  core: boolean
  muteThresholdWeeks: number
  state: GeneState
  events: GeneEvent[]
  invocations: Record<string, number>
}

export type HarnessModel = {
  harness: string
  model: string
}

export type Cycles = {
  lastRun: string | null
  lastOutwardScan: string | null
  lastPublish: string | null
  count: number
  reportOnlyPruning: boolean
}

export type Ledger = {
  genes: Record<string, Gene>
  harnessModels: HarnessModel[]
  cycles: Cycles
}

export const DEFAULT_MUTE_THRESHOLD_WEEKS = 8

export function emptyLedger(): Ledger {
  return {
    genes: {},
    harnessModels: [],
    cycles: { lastRun: null, lastOutwardScan: null, lastPublish: null, count: 0, reportOnlyPruning: true },
  }
}

export function registerGene(
  ledger: Ledger,
  key: string,
  origin: GeneOrigin,
  atISO: string,
  bornDate: string,
  opts: { core?: boolean } = {},
): Ledger {
  if (ledger.genes[key]) return ledger
  const gene: Gene = {
    origin,
    // `born` is the caller's own "today" date string, not a UTC slice of
    // atISO — atISO is only the born event's full-precision timestamp.
    // Deriving born from atISO independently let it drift a day away from
    // the date the caller used for a same-cycle invocation at UTC/local
    // boundaries (see M3 in the 2026-08-14 final-review-fix-brief).
    born: bornDate,
    seasonal: false,
    core: opts.core ?? false,
    muteThresholdWeeks: DEFAULT_MUTE_THRESHOLD_WEEKS,
    state: 'active',
    events: [{ at: atISO, type: 'born', reason: `origin=${origin}` }],
    invocations: {},
  }
  return { ...ledger, genes: { ...ledger.genes, [key]: gene } }
}

// A parsed invocation key is normally already plugin-qualified (`plugin:skill`).
// Both harnesses also record some activations by bare skill name: omp reads
// `skill://<name>`, and Claude Code's Skill tool takes `"skill":"<name>"`, with
// no plugin namespace either time. A bare name is therefore resolved against
// the ledger's qualified genes — otherwise every cycle registers a spurious
// unqualified gene alongside the real one.
//
// Resolution order:
//   1. an already-qualified raw key passes through;
//   2. a unique `:name` suffix match wins;
//   3. with `installedPlugins` supplied, the single candidate whose plugin is
//      actually installed here wins — this is what separates
//      `sandbox-manager:check-todos` from `taches-cc-resources:check-todos`,
//      where only the first plugin exists in this sandbox;
//   4. otherwise the bare name is kept and registered as-is, so a skill is
//      never silently attributed to the wrong plugin.
//
// Note that an existing bare gene does not short-circuit: a bare key created
// before its qualified twin was seeded (the whole `printing-press*` family,
// `simple-english`, `update-config`, `claude-api`, `docker-maintenance`,
// `artifact-design`) would otherwise absorb every later activation forever
// while the twin sat at zero. Rule 4 still lands on the bare key when there is
// genuinely no qualified candidate (personal non-plugin skills, e.g.
// `graphify`).
export function resolveGeneKey(ledger: Ledger, raw: string, installedPlugins: ReadonlySet<string> = new Set()): string {
  if (raw.includes(':')) return raw
  const matches = Object.keys(ledger.genes).filter((k) => k.endsWith(`:${raw}`))
  if (matches.length === 1) return matches[0]
  const installed = matches.filter((k) => installedPlugins.has(k.slice(0, k.indexOf(':'))))
  return installed.length === 1 ? installed[0] : raw
}

export function recordInvocation(ledger: Ledger, key: string, dateISO: string, count: number): Ledger {
  const gene = ledger.genes[key]
  if (!gene) throw new Error(`unknown gene: ${key}`)
  const invocations = { ...gene.invocations, [dateISO]: (gene.invocations[dateISO] ?? 0) + count }
  return { ...ledger, genes: { ...ledger.genes, [key]: { ...gene, invocations } } }
}

export function applyEvent(ledger: Ledger, key: string, atISO: string, type: EventType, reason: string): Ledger {
  const gene = ledger.genes[key]
  if (!gene) throw new Error(`unknown gene: ${key}`)
  const state: GeneState = type === 'muted' ? 'muted' : type === 'unmuted' ? 'active' : gene.state
  const events = [...gene.events, { at: atISO, type, reason }]
  return { ...ledger, genes: { ...ledger.genes, [key]: { ...gene, state, events } } }
}

export function markSeasonal(ledger: Ledger, key: string): Ledger {
  const gene = ledger.genes[key]
  if (!gene) throw new Error(`unknown gene: ${key}`)
  return { ...ledger, genes: { ...ledger.genes, [key]: { ...gene, seasonal: true } } }
}

export function setCore(ledger: Ledger, key: string): Ledger {
  const gene = ledger.genes[key]
  if (!gene) throw new Error(`unknown gene: ${key}`)
  return { ...ledger, genes: { ...ledger.genes, [key]: { ...gene, core: true } } }
}

export function recordCycleRun(ledger: Ledger, dateISO: string): Ledger {
  return { ...ledger, cycles: { ...ledger.cycles, lastRun: dateISO, count: ledger.cycles.count + 1 } }
}

export function recordOutwardScan(ledger: Ledger, dateISO: string): Ledger {
  return { ...ledger, cycles: { ...ledger.cycles, lastOutwardScan: dateISO } }
}

export function setReportOnlyPruning(ledger: Ledger, value: boolean): Ledger {
  return { ...ledger, cycles: { ...ledger.cycles, reportOnlyPruning: value } }
}

export function recordHarnessModel(ledger: Ledger, harness: string, model: string): Ledger {
  const exists = ledger.harnessModels.some(hm => hm.harness === harness && hm.model === model)
  if (exists) return ledger
  return { ...ledger, harnessModels: [...ledger.harnessModels, { harness, model }] }
}

export function recordPublish(ledger: Ledger, dateISO: string): Ledger {
  return { ...ledger, cycles: { ...ledger.cycles, lastPublish: dateISO } }
}
