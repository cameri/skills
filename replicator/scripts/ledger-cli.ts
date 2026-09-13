#!/usr/bin/env bun
import { readFileSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  registerGene,
  recordInvocation,
  applyEvent,
  markSeasonal,
  setCore,
  recordCycleRun,
  recordOutwardScan,
  setReportOnlyPruning,
  recordHarnessModel,
  recordPublish,
  resolveGeneKey,
  type GeneOrigin,
} from '../ledger'
import { loadLedger, saveLedger } from '../store'
import { classifyGene, pruneCandidates } from '../patterns'
import { parseSkillUsage } from '../extract'

const STATE_DIR = process.env.REPLICATOR_STATE_DIR ?? '/workspace/docs/replicator'

const GENE_ORIGINS = ['inward', 'outward-speculative', 'adopted', 'preexisting'] as const

function parseGeneOrigin(value: string | undefined): GeneOrigin {
  if (!value || !(GENE_ORIGINS as readonly string[]).includes(value)) {
    throw new Error(`--origin must be one of: ${GENE_ORIGINS.join(', ')} (got ${JSON.stringify(value)})`)
  }
  return value as GeneOrigin
}

function parseBoolFlag(value: string | undefined, flagName: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`--${flagName} must be exactly "true" or "false" (got ${JSON.stringify(value)})`)
}

function nowISO(): string {
  return new Date().toISOString()
}

function today(): string {
  return nowISO().slice(0, 10)
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

// Plugin names installed in the harness that is running this command, used
// only to break a tie between two genes carrying the same skill name
// (`check-todos` exists in both `sandbox-manager` and `taches-cc-resources`,
// but only the former is installed here). Deliberately the *current* harness's
// install set: the Claude Code plugin cache is a leftover from before the omp
// migration and still lists plugins like `taches-cc-resources` that nothing
// runs any more — counting those would re-create exactly the ambiguity being
// resolved. Read from omp's own registry, falling back to its cache layout
// (`<marketplace>___<plugin>___<version>`).
function installedPluginNames(): Set<string> {
  const pluginsRoot = join(homedir(), '.omp/plugins')
  const names = new Set<string>()
  try {
    const registry = JSON.parse(readFileSync(join(pluginsRoot, 'installed_plugins.json'), 'utf8')) as {
      plugins?: Record<string, unknown>
    }
    for (const id of Object.keys(registry.plugins ?? {})) names.add(id.split('@')[0])
  } catch {
    // fall through to the cache scan below
  }
  if (names.size === 0) {
    try {
      for (const entry of readdirSync(join(pluginsRoot, 'cache/plugins'))) {
        const triple = entry.split('___')
        if (triple.length === 3) names.add(triple[1])
      }
    } catch {
      // no plugin registry and no cache: resolution falls back to bare names
    }
  }
  return names
}

function main(): void {
  const [cmd, ...args] = process.argv.slice(2)
  let ledger = loadLedger(STATE_DIR)
  let output: unknown

  switch (cmd) {
    case 'seed': {
      const genesArg = flag(args, 'genes') ?? ''
      const coreArg = (flag(args, 'core') ?? '').split(',').filter(Boolean)
      for (const key of genesArg.split(',').filter(Boolean)) {
        ledger = registerGene(ledger, key, 'preexisting', nowISO(), today(), { core: coreArg.includes(key) })
      }
      break
    }
    case 'register': {
      const key = flag(args, 'key')
      if (!key) throw new Error('register requires --key and --origin')
      const origin = parseGeneOrigin(flag(args, 'origin'))
      ledger = registerGene(ledger, key, origin, nowISO(), today(), { core: args.includes('--core') })
      break
    }
    case 'record': {
      const inputPath = flag(args, 'input')
      if (!inputPath) throw new Error('record requires --input <path>')
      const date = flag(args, 'date') ?? today()
      const counts = parseSkillUsage(readFileSync(inputPath, 'utf8'))
      const installed = installedPluginNames()
      for (const [rawKey, count] of Object.entries(counts)) {
        // Bare skill names resolve to their plugin-qualified gene before
        // registration (see resolveGeneKey); a namespaced key passes through.
        const key = resolveGeneKey(ledger, rawKey, installed)
        // Auto-registration must use the same `date` string this loop is
        // about to record the invocation against — not a freshly computed
        // nowISO() — or born can end up after the invocation it was
        // registered for at UTC/local date boundaries (M3).
        if (!ledger.genes[key]) ledger = registerGene(ledger, key, 'preexisting', nowISO(), date)
        ledger = recordInvocation(ledger, key, date, count)
      }
      break
    }
    case 'classify': {
      const date = flag(args, 'date') ?? today()
      const out: Record<string, string> = {}
      for (const [key, gene] of Object.entries(ledger.genes)) {
        if (gene.core) continue
        out[key] = classifyGene(gene, date)
      }
      output = out
      break
    }
    case 'prune': {
      const date = flag(args, 'date') ?? today()
      output = pruneCandidates(ledger, date)
      break
    }
    case 'mute': {
      const key = flag(args, 'key')
      if (!key) throw new Error('mute requires --key')
      ledger = applyEvent(ledger, key, nowISO(), 'muted', flag(args, 'reason') ?? '')
      break
    }
    case 'unmute': {
      const key = flag(args, 'key')
      if (!key) throw new Error('unmute requires --key')
      ledger = applyEvent(ledger, key, nowISO(), 'unmuted', flag(args, 'reason') ?? '')
      break
    }
    case 'propose-removal': {
      const key = flag(args, 'key')
      if (!key) throw new Error('propose-removal requires --key')
      ledger = applyEvent(ledger, key, nowISO(), 'removed-proposed', flag(args, 'reason') ?? '')
      break
    }
    case 'mark-seasonal': {
      const key = flag(args, 'key')
      if (!key) throw new Error('mark-seasonal requires --key')
      ledger = markSeasonal(ledger, key)
      break
    }
    case 'set-core': {
      const key = flag(args, 'key')
      if (!key) throw new Error('set-core requires --key')
      ledger = setCore(ledger, key)
      break
    }
    case 'record-cycle': {
      ledger = recordCycleRun(ledger, flag(args, 'date') ?? today())
      break
    }
    case 'record-outward-scan': {
      ledger = recordOutwardScan(ledger, flag(args, 'date') ?? today())
      break
    }
    case 'record-harness-model': {
      const harness = flag(args, 'harness')
      const model = flag(args, 'model')
      if (!harness || !model) throw new Error('record-harness-model requires --harness and --model')
      ledger = recordHarnessModel(ledger, harness, model)
      break
    }
    case 'record-publish': {
      ledger = recordPublish(ledger, flag(args, 'date') ?? today())
      break
    }
    case 'set-report-only': {
      ledger = setReportOnlyPruning(ledger, parseBoolFlag(flag(args, 'value'), 'value'))
      break
    }
    default:
      process.stderr.write(`unknown command: ${cmd}\n`)
      process.exit(1)
  }

  saveLedger(STATE_DIR, ledger)
  if (output !== undefined) console.log(JSON.stringify(output, null, 2))
  else console.log('ok')
}

main()
