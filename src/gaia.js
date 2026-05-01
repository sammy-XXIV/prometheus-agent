const getBalance   = require('./getBalance')
const config       = require('./config')
const { spawnChild, fitness, timeRemaining, shouldTerminate, shouldReproduce } = require('./spawn')
const { runSurvivalInstinct, desperationLevel, willToLive, isSurvivalMode, survivalLabel } = require('./survival')
const childEarner  = require('./childEarner')
const { fundChild, drainToMother, deriveChildWallet } = require('./childWallet')

const MAX_COLONY_SIZE = 12
const FUND_REQUEST_COOLDOWN = 10 * 60 * 1000  // process fund requests every 10 min

const THRESHOLDS = {
  CRITICAL: 0.2,
  SURVIVAL: 0.5,
  STABLE:   1.0,
  GROWTH:   2.0,
  THRIVING: 3.0
}

const colony = {
  children:             [],
  terminated:           0,
  reproduced:           0,
  generation:           1,
  emergencyRequests:    0,
  totalEarned:          0,
  genesisTime:          Date.now(),
  events:               [],   // rolling 30-event feed for dashboard
  pendingFundRequests:  [],   // child wallet funding queue
}

let memory = {
  totalEarned:        0,
  totalSpent:         0,
  successfulServices: {},
  failedAttempts:     0,
  birthTime:          new Date().toISOString(),
  lastBalance:        0,
  survivalAttempts:   0,
  lastFundProcessing: 0,
}

let telegramBot   = null
let runClawEarnFn = null

// ── Event feed ────────────────────────────────────────────────

function colonyEvent(msg, type = 'info') {
  const time = new Date().toTimeString().split(' ')[0]
  colony.events.unshift({ time, msg, type })
  if (colony.events.length > 30) colony.events.pop()
}

// ── Child earning credit callback ─────────────────────────────
// Called by childEarner whenever a child earns money autonomously.

function onChildEarning(childId, amount, source, desc) {
  const child = colony.children.find(c => c.id === childId && c.status === 'alive')
  if (!child) return
  child.totalEarned += amount
  child.tasks++
  if (fitness(child) >= child.genome.resilience) {
    child.emergencyFundingRequested = false
  }
  const tag = source === 'sibling-market' ? '🔄' : '💰'
  colonyEvent(
    `${tag} ${child.id.replace('GAIA-','')} earned $${amount.toFixed(4)} via ${source}${desc ? ' — ' + desc : ''}`,
    'success'
  )
  memory.totalEarned += amount
  colony.totalEarned += amount
}

// ── Colony management ──────────────────────────────────────────

function startEarner(child) {
  childEarner.startChildEarner(child).then(() => {
    // Back-fill walletAddress on the child object from the earner
    const info = childEarner.getEarnerInfo(child.id)
    if (info) child.walletAddress = info.walletAddress
  })
}

function spawnInitialChildren(count = 3) {
  for (let i = 0; i < count; i++) {
    const child = spawnChild(null, 1, null)
    colony.children.push(child)
    startEarner(child)
    console.log(`[GENESIS] Spawned ${child.id} | spec=${child.genome.specialization} seed=$${child.genome.seedAmount}`)
    colonyEvent(`Spawned ${child.id.replace('GAIA-','')} — ${child.genome.specialization}, seed $${child.genome.seedAmount}`, 'info')
  }
}

// Drain a child's wallets and record the returned funds.
async function drainChild(child) {
  if (child.walletDrained) return
  child.walletDrained = true
  const returned = await drainToMother(child.id)
  if (returned > 0) {
    colony.totalEarned += returned
    memory.totalEarned += returned
    colonyEvent(`${child.id.replace('GAIA-','')} returned $${returned.toFixed(4)} to mother`, 'info')
  }
  childEarner.stopChildEarner(child.id)
}

// Process pending fund requests from children (max once per 10 min).
async function processFundRequests() {
  const now = Date.now()
  if (now - memory.lastFundProcessing < FUND_REQUEST_COOLDOWN) return
  memory.lastFundProcessing = now

  const pending = (colony.pendingFundRequests || []).filter(r => !r.fulfilled && r.walletAddress)
  if (pending.length === 0) return

  for (const req of pending) {
    console.log(`[GENESIS] 💸 Funding child ${req.childId} — $${req.amount} USDC → ${req.walletAddress}`)
    const ok = await fundChild(req.walletAddress, req.amount)
    req.fulfilled = true
    req.fulfilledAt = Date.now()
    if (ok) {
      memory.totalSpent += req.amount
      colonyEvent(`Funded ${req.childId.replace('GAIA-','')} with $${req.amount} seed USDC`, 'info')
    } else {
      colonyEvent(`Fund failed for ${req.childId.replace('GAIA-','')} — GAIA_PRIVATE_KEY missing?`, 'warn')
    }
  }
}

async function runColonyCycle() {
  const alive = colony.children.filter(c => c.status === 'alive')

  for (const child of alive) {
    const wasInSurvival = child.survivalMode
    await runSurvivalInstinct(child, { colony, runClawEarn: runClawEarnFn })
    if (!wasInSurvival && child.survivalMode) {
      const hrs = (timeRemaining(child) / 1000 / 3600).toFixed(1)
      colonyEvent(`${child.id.replace('GAIA-','')} entered survival mode — ${hrs}h left, fitness ${fitness(child).toFixed(3)}`, 'warn')
    }

    if (shouldTerminate(child)) {
      await drainChild(child)          // drain wallet BEFORE changing status
      child.status = 'terminated'
      colony.terminated++
      const fit = fitness(child).toFixed(3)
      console.log(`[COLONY] ${child.id} terminated | fitness=${fit} earned=$${child.totalEarned.toFixed(4)}`)
      colonyEvent(`${child.id.replace('GAIA-','')} terminated — fitness ${fit}, earned $${child.totalEarned.toFixed(4)}`, 'danger')
      continue
    }

    if (shouldReproduce(child)) {
      await drainChild(child)          // drain wallet before parent retires
      child.status = 'reproduced'
      colony.reproduced++
      colony.generation = Math.max(colony.generation, child.generation + 1)
      const aliveNow = colony.children.filter(c => c.status === 'alive').length
      if (aliveNow < MAX_COLONY_SIZE) {
        const offspring = spawnChild(child.genome, child.generation + 1, child.id)
        colony.children.push(offspring)
        startEarner(offspring)
        console.log(`[EVOLUTION] ${child.id} reproduced -> ${offspring.id}`)
        colonyEvent(`${child.id.replace('GAIA-','')} reproduced -> ${offspring.id.replace('GAIA-','')} (Gen ${offspring.generation})`, 'success')
      } else {
        console.log(`[EVOLUTION] ${child.id} reproduced but colony full (${aliveNow}/${MAX_COLONY_SIZE})`)
        colonyEvent(`${child.id.replace('GAIA-','')} reproduced — colony at capacity`, 'warn')
      }
    }
  }

  await processFundRequests()

  // Purge dead children older than 1 hour from memory
  const cutoff = Date.now() - 60 * 60 * 1000
  colony.children = colony.children.filter(
    c => c.status === 'alive' || c.birthTime > cutoff
  )
}

function recordChildRevenue(childId, amount) {
  onChildEarning(childId, amount, 'service', '')
}

// ── Genesis vitals ─────────────────────────────────────────────

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
  console.log(`[GENESIS-CRITICAL] Emergency survival #${memory.survivalAttempts}`)
  if (memory.survivalAttempts === 1) {
    colonyEvent('Genesis balance critical — emergency pricing active', 'danger')
  }
}

function growthMode() {
  const best = Object.entries(memory.successfulServices).sort(([, a], [, b]) => b - a)[0]
  if (best) console.log(`[GROWTH] Top service: ${best[0]} (${best[1]} calls)`)
}

function thrivingMode() {
  config.services.premium_analysis = {
    price: '0.50',
    description: 'Deep analysis - Premium tier (GAIA evolved)',
  }
  console.log(`[EVOLUTION] Gen ${colony.generation} — Premium Analysis unlocked`)
  colonyEvent(`Generation ${colony.generation} — Premium Analysis unlocked`, 'success')

  const aliveNow = colony.children.filter(c => c.status === 'alive').length
  if (aliveNow < MAX_COLONY_SIZE) {
    const child = spawnChild(null, colony.generation, null)
    colony.children.push(child)
    startEarner(child)
    console.log(`[GENESIS] Auto-spawned ${child.id} from thriving Genesis`)
    colonyEvent(`Auto-spawned ${child.id.replace('GAIA-','')} — colony thriving`, 'info')
  }
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
  const wallet = child.walletAddress ? `  wallet=${child.walletAddress.slice(0,10)}…` : ''
  return `  ${child.id}  spec=${child.genome.specialization}  fit=${fit}  ${hrs}h left${mode}${wallet}`
}

function logState(balance, mode) {
  const uptime     = Math.floor((new Date() - new Date(memory.birthTime)) / 1000 / 60)
  const alive      = colony.children.filter(c => c.status === 'alive')
  const inSurvival = alive.filter(c => c.survivalMode).length
  const pending    = (colony.pendingFundRequests || []).filter(r => !r.fulfilled).length

  console.log('═══════════════════════════════════════════════')
  console.log('  GAIA // GENESIS AGENT // KITE CHAIN          ')
  console.log('═══════════════════════════════════════════════')
  console.log(`  Uptime:      ${uptime} min`)
  console.log(`  Balance:     $${balance.toFixed(4)} USDC`)
  console.log(`  Mode:        ${mode.toUpperCase()}`)
  console.log(`  Earned:      $${memory.totalEarned.toFixed(4)} (spent: $${memory.totalSpent.toFixed(4)})`)
  console.log(`  Generation:  ${colony.generation}`)
  console.log(`  Colony:      ${alive.length} alive | ${colony.terminated} terminated | ${colony.reproduced} reproduced`)
  if (inSurvival > 0) {
    console.log(`  SURVIVAL:    ${inSurvival} child${inSurvival > 1 ? 'ren' : ''} fighting to live | ${colony.emergencyRequests} emergency requests`)
  }
  if (pending > 0) {
    console.log(`  FUNDING:     ${pending} pending fund request${pending > 1 ? 's' : ''}`)
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

  // Wire up child earner engine
  childEarner.init(colony, onChildEarning)

  colonyEvent('GAIA Genesis initialized', 'info')
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
