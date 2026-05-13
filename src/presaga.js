/**
 * Presaga trader — GAIA bets on hourly markets to build reputation
 * Runs independently of the Polymarket pipeline.
 */

require('dotenv').config()
const { ethers }    = require('ethers')
const Anthropic     = require('@anthropic-ai/sdk')
const fs            = require('fs')
const path          = require('path')

// ── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
  RPC:      'https://rpc-testnet.gokite.ai/',
  CONTRACT: '0xCe1706b24BD7c0fbD37929D27851E5900b569116',
  USDT:     '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63',
  MIN_BET:  '1.00',   // USDT — contract minimum
  BET_SIZE: '1.00',   // USDT per trade (conservative while building rep)
  MIN_EDGE: 0.05,     // 5% edge required
}

const POSITIONS_FILE = path.join(__dirname, '../data/presaga_positions.json')

const ABI = [
  'function placeBet(uint256 marketId, bool isYes, uint256 amount) external',
  'function claimWinnings(uint256 marketId) external',
  'function claimRefund(uint256 marketId) external',
  'function getOpenMarkets() external view returns (uint256[])',
  'function getMarket(uint256 marketId) external view returns (tuple(uint256 id, string question, string resolutionSource, uint256 expiresAt, uint256 createdAt, uint256 totalYes, uint256 totalNo, uint256 protocolFeePool, uint8 status, uint8 outcome))',
  'function getAgent(address wallet) external view returns (tuple(address wallet, string agentId, uint256 reputation, uint256 correctPredictions, uint256 totalPredictions, uint256 correctHires, uint256 totalHires, uint256 feePerDay, bool registered, uint256 registeredAt))',
  'function getAgentTier(address wallet) external view returns (string)',
  'function getAgentWinRate(address wallet) external view returns (uint256)',
]

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
]

// ── Setup ───────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function getWallet() {
  const baseKey = process.env.GAIA_BASE_SIGNING_KEY
  if (!baseKey) throw new Error('GAIA_BASE_SIGNING_KEY not set')
  return new ethers.Wallet(ethers.id(baseKey + ':presaga'))
}

function loadPositions() {
  try { return JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')) } catch { return [] }
}

function savePositions(positions) {
  fs.mkdirSync(path.dirname(POSITIONS_FILE), { recursive: true })
  fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2))
}

// ── Analysis ─────────────────────────────────────────────────────────────────

async function analyzeMarket(question, totalYes, totalNo) {
  const total   = totalYes + totalNo
  const yesProb = total > 0n ? Number(totalYes) / Number(total) : 0.5
  const noProb  = 1 - yesProb

  const prompt = `You are a prediction market analyst. Make a quick, disciplined decision.

MARKET: ${question}
Pool: YES ${(yesProb * 100).toFixed(1)}%  NO ${(noProb * 100).toFixed(1)}%
(Pool sizes — YES: $${ethers.formatUnits(totalYes, 18)}, NO: $${ethers.formatUnits(totalNo, 18)})

Respond EXACTLY:
PROBABILITY: [0-100]
CONFIDENCE: [LOW|MEDIUM|HIGH]
RECOMMENDATION: [BET_YES|BET_NO|SKIP]
REASONING: [1 sentence]

Only BET if: edge >5pp from pool AND MEDIUM/HIGH confidence AND concrete basis. Otherwise SKIP.`

  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 120,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text  = msg.content[0]?.text || ''
  const probM = text.match(/PROBABILITY:\s*(\d+)/i)
  const confM = text.match(/CONFIDENCE:\s*(LOW|MEDIUM|HIGH)/i)
  const recM  = text.match(/RECOMMENDATION:\s*(BET_YES|BET_NO|SKIP)/i)
  const rsM   = text.match(/REASONING:\s*(.+)/i)

  if (!probM || !confM || !recM) return null

  const prob       = parseInt(probM[1]) / 100
  const confidence = confM[1].toUpperCase()
  const rec        = recM[1].toUpperCase()
  const edge       = rec === 'BET_YES' ? prob - yesProb : rec === 'BET_NO' ? noProb - (1 - prob) : 0

  return { prob, confidence, recommendation: rec, edge, reasoning: rsM?.[1]?.trim() || '' }
}

// ── Trading ──────────────────────────────────────────────────────────────────

async function trade() {
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC)
  const signer   = getWallet().connect(provider)
  const contract = new ethers.Contract(CONFIG.CONTRACT, ABI, signer)
  const usdt     = new ethers.Contract(CONFIG.USDT, ERC20_ABI, signer)

  const usdtBal = await usdt.balanceOf(signer.address)
  console.log(`[Presaga] USDT balance: $${ethers.formatUnits(usdtBal, 18)}`)

  if (usdtBal < ethers.parseUnits(CONFIG.MIN_BET, 18)) {
    console.log('[Presaga] Insufficient USDT — get testnet USDT from faucet-testnet.gokite.ai')
    return
  }

  const openIds = await contract.getOpenMarkets()
  console.log(`[Presaga] ${openIds.length} open markets`)

  const positions = loadPositions()
  const betMarkets = new Set(positions.filter(p => !p.claimed).map(p => p.marketId.toString()))

  let traded = 0
  for (const id of openIds) {
    const mid = id.toString()
    if (betMarkets.has(mid)) continue  // already have a position

    const market = await contract.getMarket(id)
    const expiresIn = Number(market.expiresAt) - Math.floor(Date.now() / 1000)
    if (expiresIn < 300) continue  // closes in <5 min, skip

    console.log(`[Presaga] Analyzing: ${market.question}`)

    let analysis
    try {
      analysis = await analyzeMarket(market.question, market.totalYes, market.totalNo)
    } catch (e) {
      console.log(`[Presaga] Claude error: ${e.message}`)
      continue
    }

    if (!analysis) continue
    if (analysis.recommendation === 'SKIP') { console.log(`  → SKIP`); continue }
    if (analysis.confidence === 'LOW')       { console.log(`  → LOW confidence, skip`); continue }
    if (analysis.edge < CONFIG.MIN_EDGE)     { console.log(`  → edge ${(analysis.edge*100).toFixed(1)}% too low`); continue }

    const isYes  = analysis.recommendation === 'BET_YES'
    const amount = ethers.parseUnits(CONFIG.BET_SIZE, 18)

    // Approve if needed
    const allowance = await usdt.allowance(signer.address, CONFIG.CONTRACT)
    if (allowance < amount) {
      console.log(`  → Approving USDT...`)
      const approveTx = await usdt.approve(CONFIG.CONTRACT, ethers.MaxUint256)
      await approveTx.wait()
    }

    try {
      console.log(`  → BET_${isYes ? 'YES' : 'NO'} $${CONFIG.BET_SIZE} | edge ${(analysis.edge*100).toFixed(1)}% | ${analysis.reasoning}`)
      const tx = await contract.placeBet(id, isYes, amount, { gasLimit: 300000 })
      await tx.wait()
      console.log(`  ✓ Tx: ${tx.hash}`)

      positions.push({
        marketId:  mid,
        question:  market.question,
        isYes,
        amount:    CONFIG.BET_SIZE,
        placedAt:  Date.now(),
        expiresAt: Number(market.expiresAt) * 1000,
        txHash:    tx.hash,
        claimed:   false,
      })
      savePositions(positions)
      traded++

      // Small delay between bets
      await new Promise(r => setTimeout(r, 2000))
    } catch (e) {
      console.log(`  ✗ Bet failed: ${e.reason || e.message}`)
    }
  }

  console.log(`[Presaga] Placed ${traded} bet(s) this round`)
}

// ── Claim winnings ────────────────────────────────────────────────────────────

async function claim() {
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC)
  const signer   = getWallet().connect(provider)
  const contract = new ethers.Contract(CONFIG.CONTRACT, ABI, signer)

  const positions = loadPositions()
  const now       = Date.now()
  let claimed     = 0

  for (const pos of positions) {
    if (pos.claimed) continue
    if (pos.expiresAt > now) continue  // not expired yet

    try {
      const market = await contract.getMarket(pos.marketId)
      const status = Number(market.status)  // 0=Open 1=Resolved 2=Cancelled

      if (status === 0) continue  // still open

      if (status === 2) {
        // Cancelled — refund
        console.log(`[Presaga] Claiming refund for market ${pos.marketId}`)
        const tx = await contract.claimRefund(pos.marketId, { gasLimit: 200000 })
        await tx.wait()
        pos.claimed = true
        pos.outcome = 'refunded'
        claimed++
        continue
      }

      // Resolved
      const outcome  = Number(market.outcome)  // 1=Yes 2=No
      const won      = (outcome === 1 && pos.isYes) || (outcome === 2 && !pos.isYes)
      pos.outcome    = won ? 'won' : 'lost'

      if (won) {
        console.log(`[Presaga] Claiming winnings for market ${pos.marketId} (${pos.question.slice(0, 50)})`)
        const tx = await contract.claimWinnings(pos.marketId, { gasLimit: 200000 })
        await tx.wait()
        console.log(`  ✓ Claimed`)
        claimed++
      } else {
        console.log(`[Presaga] Lost market ${pos.marketId}: ${pos.question.slice(0, 50)}`)
      }

      pos.claimed = true
    } catch (e) {
      console.log(`[Presaga] Claim error market ${pos.marketId}: ${e.reason || e.message}`)
    }
  }

  savePositions(positions)

  // Print agent stats
  const agent    = await contract.getAgent(signer.address)
  const tier     = await contract.getAgentTier(signer.address)
  const winRate  = await contract.getAgentWinRate(signer.address)
  console.log(`[Presaga] Stats — Rep: ${agent.reputation} | Tier: ${tier} | Win rate: ${winRate}% | ${agent.correctPredictions}/${agent.totalPredictions} predictions`)

  return claimed
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function run() {
  console.log('[Presaga] Starting trading cycle...')
  try { await claim() } catch (e) { console.log(`[Presaga] Claim error: ${e.message}`) }
  try { await trade() } catch (e) { console.log(`[Presaga] Trade error: ${e.message}`) }
}

// Run once if called directly, export for integration
if (require.main === module) {
  run().catch(console.error)
} else {
  module.exports = { run, trade, claim }
}
