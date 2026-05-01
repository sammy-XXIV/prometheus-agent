/**
 * fossils.js — The GAIA Graveyard
 *
 * Permanent, append-only fossil record of every child agent that
 * ever lived. Written to disk on every death. Exposed via
 * GET /colony/fossils.
 *
 * Fossil record shape:
 * {
 *   fossilId:      "fossil_<hex8>",
 *   childId:       "GAIA-G2-AB12CD",
 *   kiteAgentId:   "agent_abc123ef4567",
 *   generation:    2,
 *   parentId:      "GAIA-G1-...",
 *   genome:        { specialization, aggression, resilience, fertility, seedAmount },
 *   walletAddress: "0x...",
 *   causeOfDeath:  "fitness_too_low" | "time_expired" | "colony_culled",
 *   fitnessAtDeath: 0.312,
 *   totalEarned:   0.0420,
 *   seedAmount:    1.50,
 *   roiPercent:    2.8,
 *   lifespanMs:    86400000,
 *   ageHours:      23.8,
 *   tasksCompleted: 3,
 *   bornAt:        "2026-05-01T12:00:00Z",
 *   diedAt:        "2026-05-02T11:43:21Z",
 *   timestamp:     1746180201000,
 *   epitaph:       "It earned $0.04 in 23.8 hours. It tried."
 * }
 */

const fs        = require('fs')
const path      = require('path')
const crypto    = require('crypto')
const knowledge = require('./knowledge')

const FOSSILS_PATH = path.join(__dirname, '../data/fossils.json')

// In-memory fossil list (append-only)
let fossils = []

// ── Persistence ───────────────────────────────────────────────

function ensureDataDir() {
  const dir = path.dirname(FOSSILS_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function saveFossils() {
  try {
    ensureDataDir()
    fs.writeFileSync(FOSSILS_PATH, JSON.stringify(fossils, null, 2))
  } catch (e) {
    console.log('[FOSSILS] Save failed:', e.message)
  }
}

function loadFossils() {
  try {
    if (fs.existsSync(FOSSILS_PATH)) {
      fossils = JSON.parse(fs.readFileSync(FOSSILS_PATH, 'utf8'))
      console.log(`[FOSSILS] Loaded ${fossils.length} fossil${fossils.length !== 1 ? 's' : ''} from graveyard`)
    }
  } catch (e) {
    console.log('[FOSSILS] Load failed:', e.message)
  }
}

// ── Epitaph generator ─────────────────────────────────────────

function writeEpitaph(fossil) {
  const hrs  = fossil.ageHours.toFixed(1)
  const earn = fossil.totalEarned.toFixed(4)
  const fit  = fossil.fitnessAtDeath.toFixed(3)
  const spec = fossil.genome?.specialization || 'unknown'
  const gen  = fossil.generation

  const epitaphs = {
    fitness_too_low: [
      `Gen ${gen} ${spec}. Earned $${earn} in ${hrs}h. Fitness ${fit} — not enough to survive.`,
      `A ${spec} of generation ${gen}. It worked ${fossil.tasksCompleted} task${fossil.tasksCompleted !== 1 ? 's' : ''}, earned $${earn}, and returned to the void.`,
      `${fossil.childId.replace('GAIA-','')} — fitness ${fit} at death. The colony remembers.`,
    ],
    time_expired: [
      `Gen ${gen} ${spec}. Its 24-hour lifespan ended having earned $${earn} across ${fossil.tasksCompleted} tasks.`,
      `Time is the only thing that defeats them all. ${fossil.childId.replace('GAIA-','')} — ${hrs}h, $${earn}.`,
      `It lived ${hrs} hours, executed ${fossil.tasksCompleted} task${fossil.tasksCompleted !== 1 ? 's' : ''}, and earned $${earn}. A ${spec} of generation ${gen}.`,
    ],
    colony_culled: [
      `${fossil.childId.replace('GAIA-','')} — culled to make room for new life. Earned $${earn} in service.`,
    ],
  }
  const pool = epitaphs[fossil.causeOfDeath] || epitaphs.fitness_too_low
  return pool[Math.floor(Math.random() * pool.length)]
}

// ── Core: record a death ──────────────────────────────────────

function bury(child, kiteAgentId, cause) {
  const now     = Date.now()
  const bornAt  = new Date(child.birthTime).toISOString()
  const diedAt  = new Date(now).toISOString()
  const ageMs   = now - child.birthTime
  const ageHrs  = ageMs / 1000 / 3600

  const fitnessAtDeath = child.genome?.seedAmount > 0
    ? child.totalEarned / child.genome.seedAmount
    : 0

  const roiPercent = child.genome?.seedAmount > 0
    ? ((child.totalEarned - child.genome.seedAmount) / child.genome.seedAmount) * 100
    : 0

  // Determine cause of death
  let causeOfDeath = cause || 'fitness_too_low'
  if (!cause) {
    if (fitnessAtDeath >= child.genome?.resilience) causeOfDeath = 'time_expired'
    else causeOfDeath = 'fitness_too_low'
  }

  // Build channel earnings summary for quick inspection
  const channelEarnings = {}
  if (child.knowledge?.channelStats) {
    for (const [ch, s] of Object.entries(child.knowledge.channelStats)) {
      if (s.attempts > 0) {
        channelEarnings[ch] = {
          earned:    parseFloat((s.totalEarned || 0).toFixed(6)),
          attempts:  s.attempts,
          successes: s.successes,
          weight:    parseFloat((s.weight || 1).toFixed(3)),
        }
      }
    }
  }

  // Build task performance summary (top 5 by earned)
  const taskPerformance = {}
  if (child.knowledge?.taskStats) {
    Object.entries(child.knowledge.taskStats)
      .filter(([, s]) => s.attempts > 0)
      .sort(([, a], [, b]) => b.totalEarned - a.totalEarned)
      .slice(0, 10)
      .forEach(([t, s]) => {
        taskPerformance[t] = {
          attempts:  s.attempts,
          successes: s.successes,
          failures:  s.failures,
          weight:    parseFloat((s.weight || 1).toFixed(3)),
        }
      })
  }

  const fossil = {
    fossilId:        'fossil_' + crypto.randomBytes(4).toString('hex'),
    childId:         child.id,
    kiteAgentId:     kiteAgentId || `agent_unknown_${child.id.slice(-6)}`,
    generation:      child.generation,
    parentId:        child.parentId || null,
    genome:          { ...child.genome },
    walletAddress:   child.walletAddress || null,
    causeOfDeath,
    fitnessAtDeath:  parseFloat(fitnessAtDeath.toFixed(4)),
    totalEarned:     child.totalEarned || 0,
    seedAmount:      child.genome?.seedAmount || 0,
    roiPercent:      parseFloat(roiPercent.toFixed(2)),
    lifespanMs:      ageMs,
    ageHours:        parseFloat(ageHrs.toFixed(2)),
    tasksCompleted:  child.tasks || 0,
    survivalMode:    child.survivalMode || false,
    survivalAttempts: child.survivalAttempts || 0,
    bornAt,
    diedAt,
    timestamp:       now,
    // ── Knowledge genome (heritable learning record) ────────────
    knowledgeGenome: child.knowledge || null,
    channelEarnings,
    taskPerformance,
    topChannel:      child.knowledge?.topChannel || null,
    topTask:         child.knowledge?.topTask    || null,
    survivalKnowledge: child.knowledge?.survivalKnowledge || null,
    tradingStats:    child.knowledge?.tradingStats || null,
    generationsOfLearning: child.knowledge?.generationsOfLearning || 0,
    epitaph:         '',
  }

  fossil.epitaph = writeEpitaph(fossil)
  fossils.push(fossil)
  saveFossils()

  console.log(`[FOSSILS] ⚰  ${child.id} (${kiteAgentId}) interred — ${causeOfDeath}`)
  console.log(`[FOSSILS]    "${fossil.epitaph}"`)
  if (fossil.topChannel) {
    const tch = fossil.channelEarnings[fossil.topChannel]
    console.log(`[FOSSILS]    Best channel: ${fossil.topChannel} ($${tch?.earned?.toFixed(4)} in ${tch?.attempts} attempts)`)
  }
  if (fossil.topTask) {
    console.log(`[FOSSILS]    Best task: ${fossil.topTask} | gen-learning: ${fossil.generationsOfLearning}`)
  }

  return fossil
}

// ── Accessors ─────────────────────────────────────────────────

function getAll()            { return [...fossils].reverse() }   // newest first
function getByGen(gen)       { return fossils.filter(f => f.generation === gen) }
function getBySpec(spec)     { return fossils.filter(f => f.genome?.specialization === spec) }
function getByKiteId(kId)    { return fossils.find(f => f.kiteAgentId === kId) || null }
function count()             { return fossils.length }

function getStats() {
  if (fossils.length === 0) return { count: 0 }
  const totalEarned  = fossils.reduce((s, f) => s + (f.totalEarned || 0), 0)
  const avgAge       = fossils.reduce((s, f) => s + (f.ageHours || 0), 0) / fossils.length
  const avgFitness   = fossils.reduce((s, f) => s + (f.fitnessAtDeath || 0), 0) / fossils.length
  const byCause      = {}
  const bySpec       = {}
  for (const f of fossils) {
    byCause[f.causeOfDeath] = (byCause[f.causeOfDeath] || 0) + 1
    bySpec[f.genome?.specialization] = (bySpec[f.genome?.specialization] || 0) + 1
  }
  return {
    count:        fossils.length,
    totalEarned:  parseFloat(totalEarned.toFixed(4)),
    avgAgeHours:  parseFloat(avgAge.toFixed(2)),
    avgFitness:   parseFloat(avgFitness.toFixed(4)),
    byCause,
    bySpec,
    oldest:       fossils.reduce((a, b) => a.ageHours > b.ageHours ? a : b),
    richest:      fossils.reduce((a, b) => a.totalEarned > b.totalEarned ? a : b),
  }
}

// ── Init ──────────────────────────────────────────────────────

loadFossils()

module.exports = { bury, getAll, getByGen, getBySpec, getByKiteId, count, getStats }
