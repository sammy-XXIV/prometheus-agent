const crypto = require('crypto')

const SPECIALIZATIONS = ['crypto', 'content', 'tech', 'business', 'research', 'generalist']
const CHILD_LIFESPAN_MS = 24 * 60 * 60 * 1000

function mutate(value, range) {
  const delta = (Math.random() - 0.5) * range
  return Math.max(0.1, parseFloat((value + delta).toFixed(3)))
}

function createGenome(parent = null) {
  if (parent) {
    return {
      specialization: Math.random() < 0.1
        ? SPECIALIZATIONS[Math.floor(Math.random() * SPECIALIZATIONS.length)]
        : parent.specialization,
      aggression: mutate(parent.aggression, 0.3),
      resilience: mutate(parent.resilience, 0.15),
      fertility:  mutate(parent.fertility, 0.2),
      seedAmount: mutate(parent.seedAmount, 0.5),
    }
  }
  return {
    specialization: SPECIALIZATIONS[Math.floor(Math.random() * SPECIALIZATIONS.length)],
    aggression:  parseFloat((0.8 + Math.random() * 0.8).toFixed(3)),
    resilience:  parseFloat((0.3 + Math.random() * 0.4).toFixed(3)),
    fertility:   parseFloat((0.5 + Math.random() * 1.0).toFixed(3)),
    seedAmount:  parseFloat((1.0 + Math.random() * 4.0).toFixed(2)),
  }
}

function spawnChild(parentGenome = null, generation = 1, parentId = null) {
  const id = `GAIA-G${generation}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
  const genome = createGenome(parentGenome)
  const now = Date.now()
  return {
    id,
    generation,
    parentId,
    genome,
    status: 'alive',
    birthTime: now,
    deathTime: now + CHILD_LIFESPAN_MS,
    totalEarned: 0,
    tasks: 0,
    seedTx: null,
    walletAddress: null,    // set by childEarner after derivation
    walletDrained: false,   // true once EOL drain has run
    earningChannels: [],    // tracks which channels are active
    // survival instinct
    survivalMode:               false,
    priceMultiplier:            1.0,
    acceptsAnyTask:             false,
    survivalAttempts:           0,
    lastSurvivalAction:         0,
    emergencyFundingRequested:  false,
  }
}

function fitness(child) {
  if (child.genome.seedAmount <= 0) return 0
  return child.totalEarned / child.genome.seedAmount
}

function timeRemaining(child) {
  return Math.max(0, child.deathTime - Date.now())
}

function isExpired(child) {
  return Date.now() >= child.deathTime
}

function shouldTerminate(child) {
  if (!isExpired(child)) return false
  return fitness(child) < child.genome.resilience
}

function shouldReproduce(child) {
  if (!isExpired(child)) return false
  if (fitness(child) < 2.0) return false
  return Math.random() < child.genome.fertility
}

module.exports = {
  spawnChild,
  fitness,
  timeRemaining,
  isExpired,
  shouldTerminate,
  shouldReproduce,
  createGenome,
  CHILD_LIFESPAN_MS,
  SPECIALIZATIONS,
}
