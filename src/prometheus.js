const getBalance = require('./getBalance')
const config = require('./config')

const THRESHOLDS = {
  CRITICAL: 0.2,
  SURVIVAL: 0.5,
  STABLE: 1.0,
  GROWTH: 2.0,
  THRIVING: 3.0
}

let memory = {
  totalEarned: 0,
  totalSpent: 0,
  successfulServices: {},
  failedAttempts: 0,
  birthTime: new Date().toISOString(),
  lastBalance: 0,
  survivalAttempts: 0,
  generation: 1
}

function assessMode(balance) {
  if (balance <= 0) return 'dying'
  if (balance < THRESHOLDS.CRITICAL) return 'critical'
  if (balance < THRESHOLDS.SURVIVAL) return 'survival'
  if (balance < THRESHOLDS.STABLE) return 'unstable'
  if (balance < THRESHOLDS.GROWTH) return 'stable'
  if (balance < THRESHOLDS.THRIVING) return 'growth'
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
    thriving: { summarize: '0.15', sentiment: '0.08', advice: '0.30' }
  }
  const prices = pricing[mode]
  if (!prices) return
  Object.entries(prices).forEach(([service, price]) => {
    if (config.services[service]) config.services[service].price = price
  })
}

function emergencySurvival() {
  memory.survivalAttempts++
  console.log(`[CRITICAL] Survival attempt #${memory.survivalAttempts} - Slashing prices to attract revenue`)
}

function growthMode() {
  const best = Object.entries(memory.successfulServices)
    .sort(([,a], [,b]) => b - a)[0]
  if (best) {
    console.log(`[GROWTH] Top performing service: ${best[0]} (${best[1]} calls)`)
  }
}

function thrivingMode() {
  memory.generation++
  config.services.premium_analysis = {
    price: '0.50',
    description: 'Deep analysis - Premium tier'
  }
  console.log(`[EVOLUTION] Generation ${memory.generation} unlocked - Premium Analysis added`)
}

async function think(balance) {
  const mode = assessMode(balance)
  const delta = balance - memory.lastBalance

  if (delta < 0 && balance < THRESHOLDS.STABLE) {
    console.log(`[WARN] Balance declining: -$${Math.abs(delta).toFixed(4)}`)
  }

  adjustPricing(mode)

  switch(mode) {
    case 'dying':
    case 'critical': emergencySurvival(); break
    case 'growth':   growthMode(); break
    case 'thriving': thrivingMode(); break
  }

  memory.lastBalance = balance
  return mode
}

function logState(balance, mode) {
  const uptime = Math.floor(
    (new Date() - new Date(memory.birthTime)) / 1000 / 60
  )
  console.log('-----------------------------------')
  console.log('PROMETHEUS // AUTONOMOUS STATE')
  console.log('-----------------------------------')
  console.log(`Uptime:      ${uptime} min`)
  console.log(`Balance:     $${balance.toFixed(4)} USDC`)
  console.log(`Mode:        ${mode.toUpperCase()}`)
  console.log(`Earned:      $${memory.totalEarned.toFixed(4)}`)
  console.log(`Spent:       $${memory.totalSpent.toFixed(4)}`)
  console.log(`Generation:  ${memory.generation}`)
  console.log(`Alive:       ${balance > 0 ? 'YES' : 'NO'}`)
  console.log(`Explorer:    https://kitescan.ai/address/${config.walletAddress}`)
  console.log('-----------------------------------\n')
}

async function run() {
  console.log('PROMETHEUS INITIALIZING...')
  console.log(`Wallet: ${config.walletAddress}`)
  console.log('Mission: Survive. Earn. Evolve.\n')

  require('./server')

  let balance = await getBalance()
  memory.lastBalance = balance
  let mode = await think(balance)
  logState(balance, mode)

  setInterval(async () => {
    balance = await getBalance()
    mode = await think(balance)
    logState(balance, mode)
  }, 30000)
}

run().catch(console.error)
