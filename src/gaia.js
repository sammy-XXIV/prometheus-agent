const getBalance = require('./getBalance')
const config = require('./config')
const { spawnChild, fitness, timeRemaining, shouldTerminate, shouldReproduce } = require('./spawn')
const { runSurvivalInstinct, desperationLevel, willToLive, isSurvivalMode, survivalLabel } = require('./survival')

const THRESHOLDS = {
  CRITICAL: 0.2,
  SURVIVAL: 0.5,
  STABLE:   1.0,
  GROWTH:   2.0,
  THRIVING: 3.0
}

// Colony state — Genesis agent manages all children
const colony = {
  children:          [],
  terminated:        0,
  reproduced:        0,
  generation:        1,
  emergencyRequests: 0,
}

let memory = {
  totalEarned:        0,
  totalSpent:         0,
  successfulServices: {},
  failedAttempts:     0,
  birthTime:          new Date().toISOString(),
  lastBalance:        0,
  survivalAttempts:   0,
}

// Lazily populated after modules initialize
let telegramBot   = null
let runClawEarnFn = null

// ── Colony management ──────────────────────────────────────────

function spawnInitialChildren(count = 3) {
  for (let i = 0; i < count; i++) {
    const child = spawnChild(null, 1)
    colony.children.push(child)
    console.log(
      `[GENESIS] Spawned ${child.id} | ` +
      `spec=${child.genome.specialization} seed=$${child.genome.seedAmount} ` +
      `aggression=${child.genome.aggression} resilience=${child.genome.resilience}`
    )
  }
}

async function runColonyCycle() {
  const alive = colony.children.filter(c => c.status === 'alive')

  for (const child of alive) {
    // ── Survival instinct first ──────────────────────────────
    await runSurvivalInstinct(child, {
      bot:         telegramBot,
      colony,
      runClawEarn: runClawEarnFn,
    })

    // ── Lifecycle transitions ────────────────────────────────
    if (shouldTerminate(child)) {
      child.status = 'terminated'
      colony.terminated++
      const desp = child.survivalMode ? ` (survived ${child.survivalAttempts} survival attempts)` : ''
      console.log(
        `[COLONY] ${child.id} self-terminated | ` +
        `fitness=${fitness(child).toFixed(3)} earned=$${child.totalEarned.toFixed(4)}${desp}`
      )
      continue
    }

    if (shouldReproduce(child)) {
      child.status = 'reproduced'
      colony.reproduced++
      colony.generation = Math.max(colony.generation, child.generation + 1)
      const offspring = spawnChild(child.genome, child.generation + 1)
      colony.children.push(offspring)
      console.log(
        `[EVOLUTION] ${child.id} reproduced → ${offspring.id} | ` +
        `gen=${offspring.generation} spec=${offspring.genome.specialization}`
      )
    }
  }

  // Prune terminated/reproduced children older than 1 hour
  const cutoff = Date.now() - 60 * 60 * 1000
  colony.children = colony.children.filter(
    c => c.status === 'alive' || c.birthTime > cutoff
  )
}

// Record revenue earned for a specific child (called by server when payment lands)
function recordChildRevenue(childId, amount) {
  const child = colony.children.find(c => c.id === childId && c.status === 'alive')
  if (child) {
    child.totalEarned += amount
    child.tasks++
    // Revenue resets emergency flag so Genesis doesn't keep getting spammed
    if (fitness(child) >= child.genome.resilience) {
      child.emergencyFundingRequested = false
    }
  }
  memory.totalEarned += amount
}

// ── Genesis agent vitals ───────────────────────────────────────

function assessMode(balance) {
  if (balance <= 0)                   return 'dying'
  if (balance < THRESHOLDS.CRITICAL)  return 'critical'
  if (balance < THRESHOLDS.SURVIVAL)  return 'survival'
  if (balance < THRESHOLDS.STABLE)    return 'unstable'
  if (balance < THRESHOLDS.GROWTH)    return 'stable'
  if (balance < THRESHOLDS.THRIVING)  return 'growth'
  return 'thriving'
}

function adjustPricing(mode) {
  const pricing = {
    dying:    { summarize: '0.05', sentiment: '0.02', advice: '0.08' },
    critical: { summarize: '0.05', sentiment: '0.02', advice: '0.08' },
    survival: { summarize: '0.08', sentiment: '0.03', advice: '0.12' },
    unstable: { summarize: '0.09', sentiment: '0.04', advice: '0.15' },
    stable:   { summarize: '0.10', sentiment: '0.05', advice: '0.20' },
    growth:   { summarize: '0.12', sentiment: '0.06', advice: '0.25' },
    thriving: { summarize: '0.15', sentiment: '0.08', advice: '0.30' },
  }
  const prices = pricing[mode]
  if (!prices) return
  Object.entries(prices).forEach(([service, price]) => {
    if (config.services[service]) config.services[service].price = price
  })
}

function emergencySurvival() {
  memory.survivalAttempts++
  console.log(`[GENESIS-CRITICAL] Survival attempt #${memory.survivalAttempts} — Genesis slashing prices`)
}

function growthMode() {
  const best = Object.entries(memory.successfulServices).sort(([, a], [, b]) => b - a)[0]
  if (best) console.log(`[GROWTH] Top performing service: ${best[0]} (${best[1]} calls)`)
}

function thrivingMode() {
  config.services.premium_analysis = {
    price: '0.50',
    description: 'Deep analysis - Premium tier (GAIA evolved)',
  }
  console.log(`[EVOLUTION] GAIA gen ${colony.generation} — Premium Analysis unlocked`)
  const child = spawnChild(null, colony.generation)
  colony.children.push(child)
  console.log(`[GENESIS] Auto-spawned ${child.id} from thriving Genesis`)
}

async function think(balance) {
  const mode  = assessMode(balance)
  const delta = balance - memory.lastBalance

  if (delta < 0 && balance < THRESHOLDS.STABLE) {
    console.log(`[WARN] Balance declining: -$${Math.abs(delta).toFixed(4)}`)
  }

  adjustPricing(mode)

  switch (mode) {
    case 'dying':
    case 'critical': emergencySurvival(); break
    case 'growth':   growthMode();        break
    case 'thriving': thrivingMode();      break
  }

  await runColonyCycle()

  memory.lastBalance = balance
  return mode
}

function childStatusLine(child) {
  const hrs  = (timeRemaining(child) / 1000 / 3600).toFixed(1)
  const fit  = fitness(child).toFixed(3)
  const wtl  = willToLive(child).toFixed(3)
  const pct  = child.priceMultiplier < 1.0 ? ` prices=${(child.priceMultiplier * 100).toFixed(0)}%` : ''
  const mode = child.survivalMode
    ? ` ${survivalLabel(desperationLevel(child))} desp=${desperationLevel(child)}/10 WTL=${wtl}${pct}`
    : ''
  return `  ${child.id}  spec=${child.genome.specialization}  fit=${fit}  ${hrs}h left${mode}`
}

function logState(balance, mode) {
  const uptime = Math.floor((new Date() - new Date(memory.birthTime)) / 1000 / 60)
  const alive  = colony.children.filter(c => c.status === 'alive')
  const inSurvival = alive.filter(c => c.survivalMode).length

  console.log('═══════════════════════════════════════════════')
  console.log('  GAIA // GENESIS AGENT // KITE CHAIN          ')
  console.log('═══════════════════════════════════════════════')
  console.log(`  Uptime:      ${uptime} min`)
  console.log(`  Balance:     $${balance.toFixed(4)} USDC`)
  console.log(`  Mode:        ${mode.toUpperCase()}`)
  console.log(`  Earned:      $${memory.totalEarned.toFixed(4)}`)
  console.log(`  Generation:  ${colony.generation}`)
  console.log(`  Colony:      ${alive.length} alive | ${colony.terminated} terminated | ${colony.reproduced} reproduced`)
  if (inSurvival > 0) {
    console.log(`  SURVIVAL:    ${inSurvival} child${inSurvival > 1 ? 'ren' : ''} fighting to live | ${colony.emergencyRequests} emergency requests`)
  }
  console.log(`  Alive:       ${balance > 0 ? 'YES' : 'NO'}`)
  console.log(`  Explorer:    https://kitescan.ai/address/${config.walletAddress}`)

  if (alive.length > 0) {
    console.log('  ── Colony ──────────────────────────────────')
    for (const child of alive) {
      console.log(childStatusLine(child))
    }
  }

  console.log('═══════════════════════════════════════════════\n')
}

async function run() {
  console.log('GAIA INITIALIZING...')
  console.log('The first self-evolving AI lifeform on Kite.')
  console.log(`Genesis wallet: ${config.walletAddress}`)
  console.log('Mission: Spawn. Seed. Evolve. Survive.\n')

  spawnInitialChildren(3)

  require('./server')
  const startHunter = require('./hunter')
  startHunter()

  telegramBot   = require('./telegram')
  runClawEarnFn = require('./clawEarn')

  const { startAtrest } = require('./atrest')
  startAtrest()

  let balance = await getBalance()
  memory.lastBalance = balance
  let mode = await think(balance)
  logState(balance, mode)

  setInterval(async () => {
    balance = await getBalance()
    mode    = await think(balance)
    logState(balance, mode)
  }, 30000)
}

module.exports = { recordChildRevenue, colony }

run().catch(console.error)
