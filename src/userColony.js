// Per-user colony management.
// Each user gets an isolated colony instance that runs independently.
// Child IDs are prefixed with a short user ID to avoid collisions in shared modules.
// Kite Passport registration runs under the main GAIA kpass account on Railway.

const { ethers } = require('ethers')
const { spawnChild, fitness, timeRemaining, shouldTerminate, shouldReproduce } = require('./spawn')
const registry = require('./registry')
const db = require('./db')

const MAX_COLONY_SIZE  = 8
const CYCLE_INTERVAL   = 60_000   // run lifecycle tick every 60s
const DEPOSIT_POLL_MS  = 30_000   // check for deposit every 30s
const MIN_DEPOSIT_MATIC = 0.5

// userId -> { colony, memory, intervals, signingKey, motherAddress }
const instances = new Map()

// ── Wallet helpers ────────────────────────────────────────────

function deriveUserSigningKey(userId) {
  const master = (process.env.GAIA_BASE_SIGNING_KEY || '').trim()
  if (!master) return null
  return ethers.id(master + ':user:' + userId)
}

async function getPolygonMaticBalance(address) {
  const rpcs = [
    process.env.POLYGON_RPC,
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon.meowrpc.com',
    'https://1rpc.io/matic',
  ].filter(Boolean)

  for (const rpc of rpcs) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc, { chainId: 137, name: 'polygon' }, { staticNetwork: true })
      const bal = await Promise.race([
        provider.getBalance(address),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000)),
      ])
      return parseFloat(ethers.formatEther(bal))
    } catch { /* try next */ }
  }
  return 0
}

// ── Colony factory ────────────────────────────────────────────

function makeColony() {
  return {
    children:    [],
    terminated:  0,
    reproduced:  0,
    generation:  1,
    totalEarned: 0,
    genesisTime: Date.now(),
    events:      [],
  }
}

function makeMemory() {
  return {
    totalEarned: 0,
    birthTime:   new Date().toISOString(),
    lastBalance: 0,
  }
}

function colonyEvent(colony, msg, type = 'info') {
  const time = new Date().toTimeString().split(' ')[0]
  colony.events.unshift({ time, msg, type })
  if (colony.events.length > 50) colony.events.pop()
}

// ── Kite registration ─────────────────────────────────────────

// Derives a Polygon/Base EOA wallet for a user colony child.
// Uses the user's signing key so funds are isolated per user.
function deriveChildWalletAddress(childId, signingKey) {
  if (!signingKey) {
    // Fallback: deterministic from childId only (no signing capability)
    return new ethers.Wallet(ethers.id('gaia:child:' + childId)).address
  }
  return new ethers.Wallet(ethers.id(signingKey + ':child:' + childId)).address
}

// Register a child with Kite Passport (non-blocking).
// Runs under the main GAIA kpass account on Railway.
function registerChild(child, colony) {
  registry.registerAgent(child).then(rec => {
    if (!rec) return
    child.kiteAgentId      = rec.kiteAgentId
    child.kiteSessionStatus = rec.sessionStatus
    colonyEvent(colony,
      `${child.id} → Kite ID ${rec.kiteAgentId} (session: ${rec.sessionStatus})`,
      'info'
    )
  }).catch(() => {})
}

// ── Lifecycle ─────────────────────────────────────────────────

function spawnInitial(colony, userId, signingKey) {
  const shortId = userId.split('-')[0]
  for (let i = 0; i < 3; i++) {
    const child      = spawnChild(null, 1, null)
    child.id         = `U${shortId}-${child.id}`
    child.walletAddress = deriveChildWalletAddress(child.id, signingKey)
    colony.children.push(child)
    colonyEvent(colony, `Spawned ${child.id} — ${child.genome.specialization}`, 'info')
    registerChild(child, colony)
  }
}

function runCycle(colony, signingKey) {
  const alive = colony.children.filter(c => c.status === 'alive')

  for (const child of alive) {
    if (shouldTerminate(child)) {
      child.status = 'terminated'
      colony.terminated++
      registry.markDeceased(child.id)
      colonyEvent(colony,
        `${child.id} terminated — fitness ${fitness(child).toFixed(3)}, earned $${child.totalEarned.toFixed(4)}`,
        'danger'
      )
      continue
    }

    if (shouldReproduce(child)) {
      child.status = 'reproduced'
      colony.reproduced++
      colony.generation = Math.max(colony.generation, child.generation + 1)

      const aliveNow = colony.children.filter(c => c.status === 'alive').length
      if (aliveNow < MAX_COLONY_SIZE) {
        const offspring      = spawnChild(child.genome, child.generation + 1, child.id, child.knowledge)
        const parentPrefix   = child.id.split('-GAIA-')[0]
        offspring.id         = `${parentPrefix}-GAIA-G${offspring.generation}-${offspring.id.split('-').pop()}`
        offspring.walletAddress = deriveChildWalletAddress(offspring.id, signingKey)
        colony.children.push(offspring)
        colonyEvent(colony,
          `${child.id} reproduced → ${offspring.id} (Gen ${offspring.generation})`,
          'success'
        )
        registerChild(offspring, colony)
      }
    }
  }

  // Purge dead children older than 1 hour
  const cutoff = Date.now() - 60 * 60 * 1000
  colony.children = colony.children.filter(c => c.status === 'alive' || c.birthTime > cutoff)
}

// ── Public API ────────────────────────────────────────────────

function launchColony(userId) {
  if (instances.has(userId)) return

  const signingKey    = deriveUserSigningKey(userId)
  const motherAddress = signingKey ? new ethers.Wallet(signingKey).address : null
  const colony        = makeColony()
  const memory        = makeMemory()

  spawnInitial(colony, userId, signingKey)
  colonyEvent(colony, 'Colony launched — registering agents with Kite Passport...', 'info')

  const cycleId = setInterval(() => runCycle(colony, signingKey), CYCLE_INTERVAL)

  instances.set(userId, { colony, memory, cycleId, signingKey, motherAddress })
  db.updateStatus(userId, 'running', { colonyLaunchedAt: new Date().toISOString() })

  console.log(`[USER-COLONY] Launched colony for user ${userId} | mother=${motherAddress}`)
}

function getColony(userId) {
  return instances.get(userId) || null
}

function getColonyState(userId) {
  const inst = instances.get(userId)
  if (!inst) return null
  const { colony } = inst

  return {
    genesisTime:  colony.genesisTime,
    generation:   colony.generation,
    totalEarned:  colony.totalEarned,
    alive:        colony.children.filter(c => c.status === 'alive').length,
    terminated:   colony.terminated,
    reproduced:   colony.reproduced,
    events:       colony.events,
    motherAddress: inst.motherAddress,
    children: colony.children.map(c => ({
      id:               c.id,
      generation:       c.generation,
      status:           c.status,
      birthTime:        c.birthTime,
      fitness:          parseFloat(fitness(c).toFixed(4)),
      hoursRemaining:   parseFloat((timeRemaining(c) / 1000 / 3600).toFixed(2)),
      totalEarned:      c.totalEarned,
      tasks:            c.tasks,
      genome:           c.genome,
      survivalMode:     c.survivalMode,
      walletAddress:    c.walletAddress || null,
      kiteAgentId:      c.kiteAgentId || null,
      kiteSessionStatus: c.kiteSessionStatus || 'pending',
    })),
  }
}

// Poll Polygon for deposit, then launch colony
async function watchForDeposit(userId, walletAddress) {
  if (instances.has(userId)) return  // already running

  console.log(`[USER-COLONY] Watching deposit for user ${userId} at ${walletAddress}`)

  const poll = setInterval(async () => {
    try {
      const bal = await getPolygonMaticBalance(walletAddress)
      if (bal >= MIN_DEPOSIT_MATIC) {
        clearInterval(poll)
        db.updateStatus(userId, 'funded', { fundedAt: new Date().toISOString(), depositedMatic: bal })
        launchColony(userId)
      }
    } catch (e) {
      console.error(`[USER-COLONY] Deposit poll error for ${userId}:`, e.message)
    }
  }, DEPOSIT_POLL_MS)
}

// On server restart, resume watching/running for all existing users
function resumeAll() {
  const fs   = require('fs')
  const path = require('path')
  const file = path.join(__dirname, '../data/users.json')
  let users  = {}
  try { users = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return }

  for (const user of Object.values(users)) {
    if (user.colonyStatus === 'running') {
      launchColony(user.id)
    } else if (user.colonyStatus === 'awaiting_deposit' || user.colonyStatus === 'funded') {
      if (user.walletAddress) watchForDeposit(user.id, user.walletAddress)
    }
  }
}

module.exports = { launchColony, getColony, getColonyState, watchForDeposit, resumeAll }
