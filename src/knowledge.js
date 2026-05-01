/**
 * knowledge.js — Heritable Knowledge Genome
 *
 * Tracks what each child agent learns during its lifetime:
 *   - Which earning channels produced the most revenue
 *   - Which task types succeeded vs failed
 *   - Survival strategies that kept the agent alive
 *   - Trading signal service performance
 *
 * At death, the knowledge genome is finalized and written to the fossil
 * record. Offspring inherit it with gaussian mutation: high-performing
 * channels/tasks get low sigma (amplified), poor performers get high
 * sigma (randomized toward something new). Each generation should
 * measurably outperform the last by being born knowing what works.
 */

const CHANNELS = [
  'claw', 'agentdo', 'superteam', 'gitcoin',
  'issuehunt', 'siblingMarket', 'x402', 'atrest',
]

const TASK_TYPES = [
  'summarize', 'blog', 'email', 'linkedin', 'product', 'resume',
  'debug', 'explainCode', 'sql', 'apiDocs', 'tests',
  'research', 'data', 'news', 'sentiment', 'advice',
  'audit', 'whitepaper', 'transaction', 'tokenSentiment', 'tradingSignal',
  'pitch', 'business', 'contract', 'competitors', 'job',
]

// ── Math helpers ──────────────────────────────────────────────

// Box-Muller transform — standard normal sample
function gaussian() {
  let u, v
  do { u = Math.random() } while (u === 0)
  do { v = Math.random() } while (v === 0)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)) }

// ── Fresh stat blocks ─────────────────────────────────────────

function freshChannelStats() {
  const s = {}
  for (const ch of CHANNELS) {
    s[ch] = { attempts: 0, successes: 0, totalEarned: 0, avgEarned: 0, weight: 1.0 }
  }
  return s
}

function freshTaskStats() {
  const s = {}
  for (const t of TASK_TYPES) {
    s[t] = { attempts: 0, successes: 0, failures: 0, totalEarned: 0, weight: 1.0 }
  }
  return s
}

// ── Core API ──────────────────────────────────────────────────

// Create a fresh genome (no parent) or inherit+mutate from parent.
function create(parentKnowledge = null) {
  if (parentKnowledge) return inherit(parentKnowledge)
  return {
    generationsOfLearning: 0,
    channelStats:   freshChannelStats(),
    taskStats:      freshTaskStats(),
    survivalKnowledge: {
      priceFloorThatWorked:   1.0,   // lowest multiplier that still got tasks
      emergencyRequestsMade:  0,
      survivalCyclesSurvived: 0,
      desperationPeakReached: 0,
    },
    tradingStats: {
      totalSignals:      0,
      successfulSignals: 0,
      totalRevenue:      0,
    },
    topChannel:      null,
    topTask:         null,
    finalFitness:    null,
    lifetimeEarned:  0,
  }
}

// Inherit from parent with gaussian mutation.
//   High-performers (successRate ≥ 0.5): σ = 0.15 → amplify with small noise
//   Poor-performers (successRate < 0.5):  σ = 0.50 → large randomization
function inherit(parent) {
  const child = create()   // fresh zero-count stats
  child.generationsOfLearning = (parent.generationsOfLearning || 0) + 1

  // Inherit channel weights
  for (const ch of CHANNELS) {
    const p = parent.channelStats?.[ch]
    if (!p) continue
    const successRate = p.successes / Math.max(p.attempts, 1)
    const sigma       = successRate >= 0.5 ? 0.15 : 0.50
    child.channelStats[ch].weight = clamp(
      (p.weight || 1.0) * (1 + gaussian() * sigma),
      0.1, 4.0
    )
  }

  // Inherit task weights
  for (const t of TASK_TYPES) {
    const p = parent.taskStats?.[t]
    if (!p) continue
    const successRate = p.successes / Math.max(p.attempts, 1)
    const sigma       = successRate >= 0.5 ? 0.15 : 0.50
    child.taskStats[t].weight = clamp(
      (p.weight || 1.0) * (1 + gaussian() * sigma),
      0.05, 4.0
    )
  }

  // Inherit survival wisdom — learn the floor price that worked
  const sp = parent.survivalKnowledge || {}
  child.survivalKnowledge.priceFloorThatWorked = clamp(
    (sp.priceFloorThatWorked || 1.0) * (1 + gaussian() * 0.1),
    0.2, 1.0
  )

  // Carry hints forward as warm-start signals
  child.topChannel = parent.topChannel || null
  child.topTask    = parent.topTask    || null

  return child
}

// Finalize genome at end-of-life.
// Blends inherited weights with this lifetime's observed performance,
// then computes topChannel, topTask, and final metrics.
function finalize(knowledge, child) {
  if (!knowledge) return knowledge

  // Recompute avgEarned and update weights from observed performance
  for (const ch of CHANNELS) {
    const s = knowledge.channelStats[ch]
    if (!s) continue
    if (s.successes > 0) s.avgEarned = parseFloat((s.totalEarned / s.successes).toFixed(6))
    if (s.attempts > 0) {
      const successRate = s.successes / s.attempts
      // Weight = earned per attempt (normalized). High earners push weight up.
      const earnRate  = s.attempts > 0 ? s.totalEarned / s.attempts : 0
      const observed  = clamp(earnRate * 20, 0.1, 4.0)  // scale: $0.05/attempt → weight 1.0
      s.weight = clamp(s.weight * 0.35 + observed * 0.65, 0.1, 4.0)
    }
  }

  for (const t of TASK_TYPES) {
    const s = knowledge.taskStats[t]
    if (!s || s.attempts === 0) continue
    const successRate = s.successes / s.attempts
    const observed    = clamp(successRate * 2.0, 0.05, 4.0)
    s.weight = clamp(s.weight * 0.35 + observed * 0.65, 0.05, 4.0)
  }

  // Top channel by lifetime earnings
  const topCh = [...CHANNELS]
    .filter(ch => knowledge.channelStats[ch]?.totalEarned > 0)
    .sort((a, b) => knowledge.channelStats[b].totalEarned - knowledge.channelStats[a].totalEarned)[0]
  knowledge.topChannel = topCh || null

  // Top task by lifetime earnings
  const topTaskEntry = Object.entries(knowledge.taskStats)
    .filter(([, s]) => s.totalEarned > 0)
    .sort(([, a], [, b]) => b.totalEarned - a.totalEarned)[0]
  knowledge.topTask = topTaskEntry?.[0] || null

  // Trading stats from task records
  const ts = knowledge.taskStats.tradingSignal || {}
  const tk = knowledge.taskStats.tokenSentiment || {}
  knowledge.tradingStats = {
    totalSignals:      (ts.attempts || 0) + (tk.attempts || 0),
    successfulSignals: (ts.successes || 0) + (tk.successes || 0),
    totalRevenue:      parseFloat(((ts.totalEarned || 0) + (tk.totalEarned || 0)).toFixed(6)),
  }

  knowledge.finalFitness  = parseFloat((child.totalEarned / Math.max(child.genome?.seedAmount || 1, 0.001)).toFixed(4))
  knowledge.lifetimeEarned = child.totalEarned

  return knowledge
}

// Returns CHANNELS sorted by weight descending (highest-priority first).
// Offspring use this to decide which channels to run first.
function getChannelPriority(knowledge) {
  return [...CHANNELS].sort((a, b) => {
    const wa = knowledge?.channelStats?.[a]?.weight ?? 1.0
    const wb = knowledge?.channelStats?.[b]?.weight ?? 1.0
    return wb - wa
  })
}

// Returns TASK_TYPES sorted by weight descending.
function getTaskPriority(knowledge) {
  return [...TASK_TYPES].sort((a, b) => {
    const wa = knowledge?.taskStats?.[a]?.weight ?? 1.0
    const wb = knowledge?.taskStats?.[b]?.weight ?? 1.0
    return wb - wa
  })
}

// ── Live tracking helpers ─────────────────────────────────────

function recordChannel(knowledge, channel, earned, attempts = 1) {
  const s = knowledge?.channelStats?.[channel]
  if (!s) return
  s.attempts   += attempts
  s.totalEarned += earned
  if (earned > 0) s.successes++
}

function recordTask(knowledge, taskType, success, earned = 0) {
  const s = knowledge?.taskStats?.[taskType]
  if (!s) return
  s.attempts++
  s.totalEarned += earned
  if (success) s.successes++
  else s.failures++
}

function recordSurvival(knowledge, child) {
  const sk = knowledge?.survivalKnowledge
  if (!sk) return
  if (child.survivalMode) {
    sk.survivalCyclesSurvived++
    const desp = child.desperationLevel || 0
    if (desp > sk.desperationPeakReached) sk.desperationPeakReached = desp
    // Track the lowest price multiplier at which the child still earned something
    if (child.priceMultiplier < sk.priceFloorThatWorked && child.totalEarned > 0) {
      sk.priceFloorThatWorked = parseFloat(child.priceMultiplier.toFixed(2))
    }
  }
  if (child.emergencyFundingRequested) sk.emergencyRequestsMade++
}

// Summarize the genome for logging / dashboard display
function summary(knowledge) {
  if (!knowledge) return '(no knowledge genome)'
  const gen  = knowledge.generationsOfLearning
  const top  = knowledge.topChannel || '?'
  const task = knowledge.topTask    || '?'
  const fit  = knowledge.finalFitness !== null ? knowledge.finalFitness?.toFixed(3) : '(live)'
  const best = [...CHANNELS]
    .map(ch => ({ ch, w: knowledge.channelStats[ch]?.weight || 0 }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 3)
    .map(x => `${x.ch}:${x.w.toFixed(2)}`)
    .join(' ')
  return `gen=${gen} top=${top}/${task} fit=${fit} weights=[${best}]`
}

module.exports = {
  create,
  inherit,
  finalize,
  getChannelPriority,
  getTaskPriority,
  recordChannel,
  recordTask,
  recordSurvival,
  summary,
  CHANNELS,
  TASK_TYPES,
}
