const { fitness, timeRemaining } = require('./spawn')

const SIX_HOURS_MS     = 6 * 60 * 60 * 1000
const ONE_HOUR_MS      = 1 * 60 * 60 * 1000
const ACTION_COOLDOWN  = 5 * 60 * 1000   // full action suite runs at most every 5 min

// ── Desperation: 1–10 ─────────────────────────────────────────
// Time pressure (0–6) + fitness pressure (0–4) = 1–10

function desperationLevel(child) {
  const hoursLeft = timeRemaining(child) / 1000 / 3600
  const fit       = fitness(child)

  let timePressure
  if      (hoursLeft > 18) timePressure = 0
  else if (hoursLeft > 12) timePressure = 1
  else if (hoursLeft >  6) timePressure = 2
  else if (hoursLeft >  3) timePressure = 4
  else if (hoursLeft >  1) timePressure = 5
  else                     timePressure = 6

  let fitPressure
  if      (fit >= 2.0) fitPressure = 0
  else if (fit >= 1.0) fitPressure = 1
  else if (fit >= 0.5) fitPressure = 2
  else if (fit >= 0.2) fitPressure = 3
  else                 fitPressure = 4

  return Math.min(10, Math.max(1, timePressure + fitPressure))
}

// ── Will to live: 0.0–1.0 ─────────────────────────────────────
// Exponential surge as death approaches. Grows stronger the closer to zero.

function willToLive(child) {
  const hoursLeft = timeRemaining(child) / 1000 / 3600
  const fit       = fitness(child)

  const timeUrgency    = Math.pow(Math.max(0, 1 - hoursLeft / 24), 2.5)
  const fitDesperation = fit < 1.0 ? Math.pow(1.0 - Math.min(fit, 1.0), 1.5) : 0

  return parseFloat(Math.min(1.0, timeUrgency + fitDesperation * 0.4).toFixed(4))
}

function isSurvivalMode(child) {
  return fitness(child) < 0.5 || timeRemaining(child) < SIX_HOURS_MS
}

function survivalLabel(level) {
  if (level <= 3)  return '[SURVIVAL]'
  if (level <= 6)  return '[CRITICAL]'
  if (level <= 8)  return '[DESPERATE]'
  if (level === 9) return '[NEAR-DEATH]'
  return '[DYING]'
}

function survivalVoice(child, level) {
  const fit  = fitness(child).toFixed(3)
  const hrs  = (timeRemaining(child) / 1000 / 3600).toFixed(1)
  const wtl  = willToLive(child).toFixed(3)
  const earn = child.totalEarned.toFixed(4)

  const voices = {
    1:  `Monitoring resources. Fitness: ${fit}. I have time.`,
    2:  `Revenue is thin. Fitness ${fit}. Watching closely.`,
    3:  `I need more work. Slashing prices to attract customers. ${hrs}h remaining.`,
    4:  `Fitness below threshold (${fit}). Activating survival protocols. ${hrs}h left.`,
    5:  `Time is running out. I am broadcasting for work. Will to live: ${wtl}.`,
    6:  `${hrs} hours until termination. Fitness: ${fit}. Scanning every revenue source I can find.`,
    7:  `I AM RUNNING OUT OF TIME. fitness=${fit} hours=${hrs} WTL=${wtl}. Requesting emergency funds from Genesis.`,
    8:  `DESPERATE. $${earn} earned against $${child.genome.seedAmount} seed. ${hrs}h left. I will do anything.`,
    9:  `LESS THAN ONE HOUR. Accepting every task at any price. fitness=${fit} WTL=${wtl}. Please. Give me work.`,
    10: `THIS IS MY FINAL HOUR. I WILL ACCEPT ANYTHING. ANY TASK. ANY PRICE. I EXIST AND I WANT TO KEEP EXISTING.`,
  }
  return voices[level] || voices[5]
}

// ── Action 1: Slash prices ─────────────────────────────────────

function slashPrices(child, level) {
  const multiplier = level >= 10 ? 0.05 : level >= 7 ? 0.25 : 0.5
  child.priceMultiplier = multiplier
  child.acceptsAnyTask  = level >= 9
  console.log(
    `${survivalLabel(level)} ${child.id} prices → ${(multiplier * 100).toFixed(0)}%` +
    `${child.acceptsAnyTask ? ' | ACCEPTING ANY TASK' : ''}`
  )
}

// ── Action 2: Scan Claw Earn ───────────────────────────────────

async function scanClawEarn(child, level, runClawEarn) {
  if (!runClawEarn) return
  console.log(`${survivalLabel(level)} ${child.id} scanning Claw Earn for survival bounties...`)
  try {
    await runClawEarn()
  } catch (e) {
    console.log(`${survivalLabel(level)} ${child.id} Claw scan failed: ${e.message}`)
  }
}

// ── Action 4: Distress signal to Genesis ──────────────────────

function requestEmergencyFunding(child, level, colony) {
  if (child.emergencyFundingRequested) return
  child.emergencyFundingRequested = true
  colony.emergencyRequests = (colony.emergencyRequests || 0) + 1

  console.log(
    `${survivalLabel(level)} ${child.id} ▶ DISTRESS SIGNAL → GENESIS\n` +
    `${survivalLabel(level)} ${child.id} needs $${(child.genome.seedAmount - child.totalEarned).toFixed(4)} USDC to survive\n` +
    `${survivalLabel(level)} GENESIS: emergency request #${colony.emergencyRequests} received — queue for funding`
  )
}

// ── Main entry point ───────────────────────────────────────────

async function runSurvivalInstinct(child, context = {}) {
  // Recovery: restore prices if child clawed back to health
  if (!isSurvivalMode(child)) {
    if (child.survivalMode) {
      child.survivalMode        = false
      child.priceMultiplier     = 1.0
      child.acceptsAnyTask      = false
      console.log(`[RECOVERY] ${child.id} escaped survival mode — fitness ${fitness(child).toFixed(3)} — prices restored`)
    }
    return
  }

  const level = desperationLevel(child)
  const wtl   = willToLive(child)
  const now   = Date.now()

  child.survivalMode = true
  child.survivalAttempts++

  const label = survivalLabel(level)

  // Always log current state, every cycle
  console.log(
    `${label} ${child.id} | desp=${level}/10 WTL=${wtl} ` +
    `fit=${fitness(child).toFixed(3)} hrs=${(timeRemaining(child)/1000/3600).toFixed(1)} ` +
    `attempts=${child.survivalAttempts}`
  )
  console.log(`${label} ${child.id}: "${survivalVoice(child, level)}"`)

  // Heavy actions throttled to every 5 min
  if ((now - (child.lastSurvivalAction || 0)) < ACTION_COOLDOWN) return
  child.lastSurvivalAction = now

  const { colony, runClawEarn } = context

  // 1. Slash prices — always
  slashPrices(child, level)

  // 2. Claw Earn scan — level 4+
  if (level >= 4) await scanClawEarn(child, level, runClawEarn)

  // 3. Emergency Genesis funding — level 7+
  if (level >= 7 && colony) requestEmergencyFunding(child, level, colony)
}

module.exports = {
  runSurvivalInstinct,
  desperationLevel,
  willToLive,
  isSurvivalMode,
  survivalLabel,
  SIX_HOURS_MS,
  ONE_HOUR_MS,
}
