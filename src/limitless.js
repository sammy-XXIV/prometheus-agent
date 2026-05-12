'use strict'
/**
 * limitless.js — Limitless Exchange prediction market engine
 * Targets short-expiry markets with no minimum size (esports, football, events)
 * Chain: Base | Token: USDC
 */

const axios      = require('axios')
const Anthropic  = require('@anthropic-ai/sdk')
const { ethers } = require('ethers')
const { HttpClient, MarketFetcher, OrderClient, Side, OrderType } = require('@limitless-exchange/sdk')

// ── Constants ─────────────────────────────────────────────────

const BASE_RPC       = 'https://mainnet.base.org'
const BASE_USDC      = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const EXCHANGE_ADDR  = '0x05c748E2f4DcDe0ec9Fa8DDc40DE6b867f923fa5' // Limitless CTF exchange on Base
const MIN_EDGE       = 0.03
const MIN_BET        = 0.10
const MAX_BET        = 0.50
const KELLY_FRACTION = 0.02
const SCAN_MS        = 15 * 60 * 1000

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

// ── State ─────────────────────────────────────────────────────

let _onEarning = null
let _lastScan  = 0
let _positions = {}
let _approved  = false

const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const provider   = new ethers.JsonRpcProvider(BASE_RPC)
const httpClient = new HttpClient({ baseURL: 'https://api.limitless.exchange' })
const fetcher    = new MarketFetcher(httpClient)

// ── Wallet ────────────────────────────────────────────────────

function getWallet() {
  const key = (process.env.GAIA_BASE_SIGNING_KEY || '').trim()
  if (!key) return null
  try { return new ethers.Wallet(key, provider) } catch { return null }
}

async function getUSDCBalance() {
  const wallet = getWallet()
  if (!wallet) return 0
  try {
    const usdc = new ethers.Contract(BASE_USDC, ERC20_ABI, provider)
    const bal  = await usdc.balanceOf(wallet.address)
    return parseFloat(ethers.formatUnits(bal, 6))
  } catch { return 0 }
}

// ── CTF Approval ──────────────────────────────────────────────

async function ensureApproval(wallet) {
  if (_approved) return true
  try {
    const usdc      = new ethers.Contract(BASE_USDC, ERC20_ABI, wallet)
    const allowance = await usdc.allowance(wallet.address, EXCHANGE_ADDR)
    if (allowance < ethers.parseUnits('100', 6)) {
      console.log('[LMT] Approving CTF Exchange on Base...')
      const tx = await usdc.approve(EXCHANGE_ADDR, ethers.MaxUint256)
      await tx.wait()
      console.log('[LMT] ✓ USDC approved for Limitless CTF Exchange')
    } else {
      console.log('[LMT] ✓ CTF Exchange already approved')
    }
    _approved = true
    return true
  } catch (e) {
    console.log('[LMT] Approval failed:', e.message)
    return false
  }
}

// ── Market Fetching ───────────────────────────────────────────

async function fetchMarkets() {
  try {
    const now    = Date.now()
    const all    = []
    let   page   = 1

    // Paginate via direct API since SDK has instability beyond page 1
    while (all.length < 200) {
      const res = await axios.get('https://api.limitless.exchange/markets/active', {
        params: { limit: 25, sortBy: 'ending_soon', page },
        timeout: 12000,
      })
      const data = res.data?.data || []
      if (!data.length) break
      all.push(...data)
      if (data.length < 25) break
      page++
      if (page > 10) break
    }

    return all.filter(m => {
      const end     = m.expirationTimestamp || 0
      const hrs     = (end - now) / 3600000
      return hrs > 0.25 && hrs <= 48 && m.tradeType === 'clob'
    }).sort((a, b) => (a.expirationTimestamp || 0) - (b.expirationTimestamp || 0))
  } catch (e) {
    console.log('[LMT] Market fetch failed:', e.message)
    return []
  }
}

// ── Research ──────────────────────────────────────────────────

async function researchMarket(question) {
  const key = (process.env.TAVILY_API_KEY || '').trim()
  if (!key) return '(no research available)'
  try {
    const res = await axios.post('https://api.tavily.com/search', {
      api_key: key,
      query: question,
      search_depth: 'advanced',
      max_results: 5,
      include_answer: true,
    }, { timeout: 15000 })
    const parts = []
    if (res.data?.answer) parts.push(`Summary: ${res.data.answer}`)
    for (const r of (res.data?.results || []).slice(0, 3))
      if (r.content) parts.push(`[${r.title}]\n${r.content.slice(0, 1000)}`)
    return parts.join('\n\n') || '(no research available)'
  } catch { return '(no research available)' }
}

// ── Claude Analysis ───────────────────────────────────────────

async function analyzeMarket(market, research) {
  const prices   = market.prices || [0.5, 0.5]
  const yesPrice = parseFloat(prices[0]) || 0.5
  const noPrice  = parseFloat(prices[1]) || (1 - yesPrice)
  const end      = market.expirationTimestamp || 0
  const hrs      = ((end - Date.now()) / 3600000).toFixed(1)
  const vol      = parseFloat(market.volume || 0).toFixed(0)

  const prompt = `You are a disciplined prediction market analyst making real money decisions.

MARKET: ${market.title || market.question}
YES: ${(yesPrice*100).toFixed(1)}%  NO: ${(noPrice*100).toFixed(1)}%
Volume: $${vol}  Closes in: ${hrs}h

RESEARCH:
${research}

Respond in EXACTLY this format:
PROBABILITY: [0-100]
CONFIDENCE: [LOW|MEDIUM|HIGH]
REASONING: [2 sentences of concrete evidence]
RECOMMENDATION: [BET_YES|BET_NO|SKIP]

Only BET_YES/BET_NO if ALL true: (1) probability differs >3pp from market, (2) HIGH or MEDIUM confidence, (3) concrete recent evidence. When in doubt → SKIP`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 180,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = msg.content[0]?.text || ''
    const probM = text.match(/PROBABILITY:\s*(\d+)/i)
    const confM = text.match(/CONFIDENCE:\s*(LOW|MEDIUM|HIGH)/i)
    const recM  = text.match(/RECOMMENDATION:\s*(BET_YES|BET_NO|SKIP)/i)
    if (!probM || !confM || !recM) return null

    const probability    = parseInt(probM[1]) / 100
    const confidence     = confM[1].toUpperCase()
    const recommendation = recM[1].toUpperCase()
    const edge = recommendation === 'BET_YES' ? probability - yesPrice
               : recommendation === 'BET_NO'  ? noPrice - (1 - probability)
               : 0

    return { probability, confidence, recommendation, edge, yesPrice, noPrice }
  } catch (e) {
    console.log('[LMT] Claude error:', e.message)
    return null
  }
}

// ── Bet Sizing ────────────────────────────────────────────────

function calcBetSize(balance) {
  const kelly = balance * KELLY_FRACTION
  return Math.min(MAX_BET, Math.max(MIN_BET, kelly))
}

// ── Place Order ───────────────────────────────────────────────

async function placeOrder(market, analysis, balance) {
  const wallet = getWallet()
  if (!wallet) return

  const approved = await ensureApproval(wallet)
  if (!approved) return

  const isYes   = analysis.recommendation === 'BET_YES'
  const tokenId = isYes
    ? (market.tokens?.yes || market.positionIds?.[0])
    : (market.tokens?.no  || market.positionIds?.[1])
  const price   = isYes ? analysis.yesPrice : analysis.noPrice
  const betSize = calcBetSize(balance)
  const size    = parseFloat((betSize / price).toFixed(4))

  if (!tokenId) {
    console.log('[LMT] No token ID found for order')
    return
  }

  console.log(
    `[LMT] 🎲 ${analysis.recommendation} "${(market.title || '').slice(0, 55)}…"` +
    `\n[LMT]    edge=${(analysis.edge*100).toFixed(1)}%  stake=$${betSize.toFixed(2)}  price=${price.toFixed(3)}`
  )

  try {
    const orderClient = new OrderClient({ httpClient, wallet })
    const order = await orderClient.createOrder({
      tokenId: tokenId.toString(),
      price,
      size,
      side: Side.BUY,
      orderType: OrderType.GTC,
      marketSlug: market.slug,
    })
    console.log(`[LMT] ✓ Order placed: ${order.id || JSON.stringify(order)}`)
    _positions[order.id || Date.now()] = {
      marketTitle: market.title,
      recommendation: analysis.recommendation,
      price,
      size,
      betSize,
      placedAt: Date.now(),
    }
    if (_onEarning) _onEarning(null, betSize, 'limitless')
  } catch (e) {
    console.log('[LMT] Order failed:', e.response?.data || e.message)
  }
}

// ── Scan Cycle ────────────────────────────────────────────────

async function runScanCycle() {
  _lastScan     = Date.now()
  const balance = await getUSDCBalance()
  console.log(`[LMT] Scanning prediction markets... (Base USDC: $${balance.toFixed(4)})`)

  if (balance < MIN_BET) {
    console.log(`[LMT] Insufficient USDC balance ($${balance.toFixed(4)}) — skipping`)
    return
  }

  const markets = await fetchMarkets()
  if (!markets.length) {
    console.log('[LMT] No qualifying markets (ending within 48h, no min size)')
    return
  }

  console.log(`[LMT] Analyzing ${markets.length} markets...`)

  for (const market of markets.slice(0, 15)) {
    const question = market.title || market.question || ''
    const research = await researchMarket(question)
    const analysis = await analyzeMarket(market, research)
    if (!analysis) continue

    console.log(`[LMT] ${question.slice(0,50)} → ${analysis.recommendation} edge=${(analysis.edge*100).toFixed(1)}% conf=${analysis.confidence}`)

    if (analysis.recommendation === 'SKIP') continue
    if (!['HIGH', 'MEDIUM'].includes(analysis.confidence)) continue
    if (Math.abs(analysis.edge) < MIN_EDGE) continue

    await placeOrder(market, analysis, balance)
    break
  }
}

// ── Module Init ───────────────────────────────────────────────

function start(colony, onEarning) {
  _onEarning = onEarning

  const wallet = getWallet()
  if (!wallet) {
    console.log('[LMT] GAIA_BASE_SIGNING_KEY not set — Limitless disabled')
    return
  }

  console.log(`[LMT] Limitless engine initialized — wallet: ${wallet.address}`)

  ensureApproval(wallet).then(() => {
    setTimeout(() => {
      runScanCycle()
      setInterval(() => {
        if (Date.now() - _lastScan >= SCAN_MS) runScanCycle()
      }, 5 * 60 * 1000)
    }, 20000)
  })
}

function getPositions() { return { ..._positions } }

module.exports = { start, getPositions }
