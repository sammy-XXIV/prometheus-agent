/**
 * polymarket.js — Prediction Market Intelligence Engine
 *
 * Scans Polymarket for markets closing within 24h. Researches each
 * market with live web search, analyzes with Claude, and places bets
 * when edge ≥ 15% with HIGH confidence.
 *
 * Betting discipline:
 *   Kelly fraction: 2% of child balance per bet
 *   Min: $0.10  Max: $0.50  Exposure cap: 20% of balance
 *   Required: HIGH confidence + ≥15% edge vs market price
 *
 * Credentials needed for live betting (add to .env):
 *   POLYMARKET_PK          — Polygon EOA private key
 *   POLYMARKET_API_KEY     — CLOB L2 API key
 *   POLYMARKET_SECRET      — CLOB L2 secret
 *   POLYMARKET_PASSPHRASE  — CLOB L2 passphrase
 * Without these, bets are tracked as paper trades.
 *
 * Research priority: SerpAPI (SERPAPI_KEY) → DuckDuckGo → Wikipedia
 */

require('dotenv').config()
const axios      = require('axios')
const Anthropic  = require('@anthropic-ai/sdk')
const { ethers } = require('ethers')
const fs         = require('fs')
const path       = require('path')
const crypto     = require('crypto')

const GAMMA_API      = 'https://gamma-api.polymarket.com'
const CLOB_HOST      = 'https://clob.polymarket.com'
const POLYGON_CHAIN  = 137

const MIN_BET          = 0.10
const MAX_BET          = 0.50
const KELLY_FRACTION   = 0.02
const MAX_EXPOSURE     = 0.20
const MIN_EDGE         = 0.15
const MAX_MARKETS      = 8     // max markets to research per scan
const SCAN_MS          = 60 * 60 * 1000    // 1h normal
const SURVIVAL_SCAN_MS = 15 * 60 * 1000   // 15min survival
const RESOLVE_MS       = 30 * 60 * 1000   // 30min position check

const POSITIONS_PATH = path.join(__dirname, '../data/polymarket_positions.json')

// ── Module state ──────────────────────────────────────────────

let _colony    = null
let _onEarning = null
let _markets   = []   // cached analyses: [{ market, research, analysis, analyzedAt }]
let positions  = {}   // positionId → position object
let _lastScan  = 0

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Persistence ───────────────────────────────────────────────

function ensureDataDir() {
  const dir = path.dirname(POSITIONS_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function loadPositions() {
  try {
    ensureDataDir()
    if (fs.existsSync(POSITIONS_PATH)) {
      positions = JSON.parse(fs.readFileSync(POSITIONS_PATH, 'utf8'))
      const open = Object.values(positions).filter(p => !p.resolved).length
      if (open > 0) console.log(`[POLY] Loaded ${open} open positions`)
    }
  } catch { positions = {} }
}

function savePositions() {
  try {
    ensureDataDir()
    fs.writeFileSync(POSITIONS_PATH, JSON.stringify(positions, null, 2))
  } catch {}
}

// ── Market scanning ───────────────────────────────────────────

async function fetchMarkets() {
  try {
    const res = await axios.get(`${GAMMA_API}/markets`, {
      params: { active: true, closed: false, limit: 50 },
      timeout: 12000,
    })
    const now = Date.now()
    return (res.data || [])
      .filter(m => {
        const end = new Date(m.endDate || m.end_date_iso || 0).getTime()
        const hrs  = (end - now) / 3600000
        return hrs > 0.5 && hrs <= 24 && parseFloat(m.volume || 0) > 100
      })
      .sort((a, b) => parseFloat(b.volume || 0) - parseFloat(a.volume || 0))
      .slice(0, MAX_MARKETS)
  } catch (e) {
    console.log('[POLY] Market fetch failed:', e.message)
    return []
  }
}

// ── Research ──────────────────────────────────────────────────

async function searchSerpAPI(query) {
  const key = (process.env.SERPAPI_KEY || '').trim()
  if (!key) return []
  try {
    const res = await axios.get('https://serpapi.com/search.json', {
      params: { q: query, api_key: key, num: 4, hl: 'en', gl: 'us' },
      timeout: 10000,
    })
    return (res.data?.organic_results || []).map(r => ({
      url: r.link, title: r.title, snippet: r.snippet || '',
    }))
  } catch { return [] }
}

async function searchDDG(query) {
  try {
    const res = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query },
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
      timeout: 10000,
    })
    const html = res.data || ''
    const results = []
    // Extract result links and snippets from DDG HTML
    const linkRe    = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi
    const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/gi
    const snippets  = []
    let m
    while ((m = snippetRe.exec(html)) !== null && snippets.length < 6) snippets.push(m[1].trim())
    let si = 0
    while ((m = linkRe.exec(html)) !== null && results.length < 4) {
      let url = m[1]
      if (url.startsWith('//duckduckgo.com/l/?uddg=')) {
        url = decodeURIComponent(url.replace('//duckduckgo.com/l/?uddg=', 'https://'))
      }
      if (!url.startsWith('http')) continue
      results.push({ url, title: m[2].trim(), snippet: snippets[si++] || '' })
    }
    return results
  } catch { return [] }
}

async function searchWikipedia(query) {
  try {
    const s = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: { action: 'query', list: 'search', srsearch: query, format: 'json', srlimit: 3 },
      timeout: 8000,
    })
    const hits = s.data?.query?.search || []
    const results = []
    for (const hit of hits.slice(0, 2)) {
      try {
        const r = await axios.get(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`,
          { timeout: 6000 }
        )
        results.push({ url: r.data.content_urls?.desktop?.page || '', title: hit.title, snippet: r.data.extract || '' })
      } catch {}
    }
    return results
  } catch { return [] }
}

async function fetchPageText(url, maxChars = 3000) {
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GAIABot/1.0)' },
      timeout: 8000,
      maxContentLength: 300000,
    })
    return String(res.data)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxChars)
  } catch { return '' }
}

async function researchMarket(market) {
  const query = `${market.question} site:reuters.com OR site:apnews.com OR site:bbc.com`
  let results = await searchSerpAPI(query)
  if (results.length === 0) results = await searchDDG(market.question + ' latest 2025')
  if (results.length === 0) results = await searchWikipedia(market.question)

  const sections = []
  for (const r of results.slice(0, 3)) {
    const text = r.snippet.length > 150
      ? r.snippet
      : await fetchPageText(r.url, 2000)
    if (text) sections.push(`[${r.title}]\n${text.slice(0, 1800)}`)
  }
  return sections.join('\n\n---\n\n') || '(no research available — using market data only)'
}

// ── Market categorisation ─────────────────────────────────────

function getCategory(market) {
  const text = `${market.question} ${(market.tags || []).join(' ')}`.toLowerCase()
  if (text.match(/bitcoin|btc|eth|crypto|token|defi|nft|blockchain|solana/)) return 'crypto'
  if (text.match(/trump|biden|harris|election|president|senate|congress|democrat|republican|vote|poll/)) return 'politics'
  if (text.match(/fed|inflation|gdp|recession|stock|market|rate|economy|cpi|unemployment/)) return 'economics'
  if (text.match(/nba|nfl|soccer|football|baseball|sports|team|playoff|champion|oscar|emmy/)) return 'sports'
  if (text.match(/openai|gpt|gemini|anthropic|ai|microsoft|apple|google|tech|startup/)) return 'tech'
  if (text.match(/russia|ukraine|china|taiwan|war|military|conflict|nato|israel|iran|geopolit/)) return 'geopolitics'
  return 'other'
}

// ── Claude analysis ───────────────────────────────────────────

async function analyzeMarket(market, research, childKnowledge) {
  const yesPrice = parseFloat((market.outcomePrices || [])[0] ?? 0.5)
  const noPrice  = parseFloat((market.outcomePrices || [])[1] ?? (1 - yesPrice))
  const category = getCategory(market)
  const pm       = childKnowledge?.polymarket
  const catStats = pm?.categoryPerformance?.[category]

  const catHint = catStats?.bets >= 3
    ? `\nHistory: ${catStats.wins}/${catStats.bets} wins in ${category} markets (${(catStats.wins/catStats.bets*100).toFixed(0)}% win rate, P&L: ${catStats.totalPnL >= 0 ? '+' : ''}$${catStats.totalPnL.toFixed(3)}).`
    : ''

  const closeDate = new Date(market.endDate || market.end_date_iso).toISOString().slice(0, 16).replace('T', ' ')

  const prompt = `You are a disciplined prediction market analyst making real money decisions. Be precise and conservative.

MARKET: ${market.question}
YES price: ${(yesPrice * 100).toFixed(1)}% implied probability
NO price:  ${(noPrice  * 100).toFixed(1)}% implied probability
Volume: $${parseFloat(market.volume || 0).toLocaleString()}  Closes: ${closeDate} UTC${catHint}

RESEARCH:
${research}

Respond in EXACTLY this format (no other text):
PROBABILITY: [integer 0-100]
CONFIDENCE: [LOW|MEDIUM|HIGH]
REASONING: [2 sentences of concrete evidence, not speculation]
RECOMMENDATION: [BET_YES|BET_NO|SKIP]

RULES — only BET_YES or BET_NO if ALL true:
1. Your probability differs from market price by MORE than 15 percentage points
2. Confidence is HIGH (not medium)
3. Research contains specific recent evidence (event occurred, poll numbers, official statement)
4. When in doubt about the evidence quality → SKIP`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 180,
      messages: [{ role: 'user', content: prompt }],
    })
    return parseAnalysis(msg.content[0]?.text || '', yesPrice, noPrice, category)
  } catch (e) {
    console.log('[POLY] Claude error:', e.message)
    return null
  }
}

function parseAnalysis(text, yesPrice, noPrice, category) {
  const probM  = text.match(/PROBABILITY:\s*(\d+)/i)
  const confM  = text.match(/CONFIDENCE:\s*(LOW|MEDIUM|HIGH)/i)
  const recM   = text.match(/RECOMMENDATION:\s*(BET_YES|BET_NO|SKIP)/i)
  const rsM    = text.match(/REASONING:\s*(.+?)(?:\nRECOMMENDATION|$)/is)
  if (!probM || !confM || !recM) return null

  const probability    = Math.max(0, Math.min(100, parseInt(probM[1]))) / 100
  const confidence     = confM[1].toUpperCase()
  const recommendation = recM[1].toUpperCase()
  const reasoning      = (rsM?.[1] || '').trim().slice(0, 200)

  const edge = recommendation === 'BET_YES'
    ? probability - yesPrice
    : recommendation === 'BET_NO'
    ? noPrice - (1 - probability)
    : 0

  return { probability, confidence, recommendation, reasoning, edge, yesPrice, noPrice, category }
}

// ── Bet sizing (conservative Kelly) ──────────────────────────

function calcBetSize(balance, childId) {
  const openExposure = Object.values(positions)
    .filter(p => p.childId === childId && !p.resolved)
    .reduce((s, p) => s + p.stake, 0)

  const maxByExposure = Math.max(0, balance * MAX_EXPOSURE - openExposure)
  const kellySz       = balance * KELLY_FRACTION
  return Math.min(MAX_BET, Math.max(0, Math.min(kellySz, maxByExposure)))
}

// ── CLOB order signing ────────────────────────────────────────

const ORDER_TYPES = [
  { name: 'salt',          type: 'uint256' },
  { name: 'maker',         type: 'address' },
  { name: 'signer',        type: 'address' },
  { name: 'taker',         type: 'address' },
  { name: 'tokenId',       type: 'uint256' },
  { name: 'makerAmount',   type: 'uint256' },
  { name: 'takerAmount',   type: 'uint256' },
  { name: 'expiration',    type: 'uint256' },
  { name: 'nonce',         type: 'uint256' },
  { name: 'feeRateBps',    type: 'uint256' },
  { name: 'side',          type: 'uint8'   },
  { name: 'signatureType', type: 'uint8'   },
]

const CLOB_DOMAIN = { name: 'ClobAuthDomain', version: '1', chainId: POLYGON_CHAIN }

function getClobWallet() {
  const pk = (process.env.POLYMARKET_PK || '').trim()
  if (!pk) return null
  try { return new ethers.Wallet(pk) } catch { return null }
}

function buildClobAuthHeaders(method, reqPath, body = '') {
  const apiKey     = (process.env.POLYMARKET_API_KEY     || '').trim()
  const secret     = (process.env.POLYMARKET_SECRET      || '').trim()
  const passphrase = (process.env.POLYMARKET_PASSPHRASE  || '').trim()
  if (!apiKey || !secret || !passphrase) return null

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const msg       = timestamp + method.toUpperCase() + reqPath + body
  const sig       = crypto.createHmac('sha256', secret).update(msg).digest('base64')

  return {
    'POLY-API-KEY':    apiKey,
    'POLY-SIGNATURE':  sig,
    'POLY-TIMESTAMP':  timestamp,
    'POLY-PASSPHRASE': passphrase,
    'Content-Type':    'application/json',
  }
}

async function placeClobOrder(market, side, stakeUSDC) {
  const wallet = getClobWallet()
  if (!wallet) return { ok: false, paper: true }

  const headers = buildClobAuthHeaders('POST', '/order')
  if (!headers) return { ok: false, paper: true }

  try {
    let tokenIds = []
    try { tokenIds = JSON.parse(market.clobTokenIds || '[]') } catch {}
    const tokenId = side === 'YES' ? tokenIds[0] : tokenIds[1]
    if (!tokenId) return { ok: false, paper: true, error: 'no token ID' }

    const price      = side === 'YES' ? market._yesPrice : (1 - market._yesPrice)
    const makerAmt   = BigInt(Math.floor(stakeUSDC * 1e6))
    const takerAmt   = BigInt(Math.floor((stakeUSDC / Math.max(price, 0.01)) * 1e6))

    const order = {
      salt:          BigInt(Math.floor(Math.random() * 1e15)),
      maker:         wallet.address,
      signer:        wallet.address,
      taker:         '0x0000000000000000000000000000000000000000',
      tokenId:       BigInt(tokenId),
      makerAmount:   makerAmt,
      takerAmount:   takerAmt,
      expiration:    0n,
      nonce:         0n,
      feeRateBps:    0n,
      side:          0n,   // BUY
      signatureType: 0n,   // EOA
    }

    const signature = await wallet.signTypedData(CLOB_DOMAIN, { Order: ORDER_TYPES }, order)
    const body = JSON.stringify({
      order: Object.fromEntries(Object.entries(order).map(([k, v]) => [k, v.toString()])),
      signature,
      orderType: 'FOK',
    })

    const res = await axios.post(`${CLOB_HOST}/order`, body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    })

    return {
      ok: true,
      orderId:  res.data?.orderID,
      txHash:   res.data?.transactionHash,
    }
  } catch (e) {
    const detail = e.response?.data?.error || e.message
    console.log('[POLY] CLOB order error:', detail)
    return { ok: false, paper: true, error: detail }
  }
}

// ── Position tracking ─────────────────────────────────────────

function openPosition(market, side, stake, priceAtBet, childId, analysis) {
  const posId = `poly_${childId}_${(market.conditionId || market.id || Date.now()).toString().slice(-8)}_${Date.now()}`
  positions[posId] = {
    posId,
    marketId:    market.id || market.conditionId,
    conditionId: market.conditionId || market.id,
    question:    market.question,
    category:    analysis.category,
    side,
    stake,
    priceAtBet,
    edge:        analysis.edge,
    reasoning:   analysis.reasoning,
    childId,
    openedAt:    Date.now(),
    resolved:    false,
    outcome:     null,
    pnl:         null,
  }
  savePositions()
  return posId
}

// ── Resolution checker ────────────────────────────────────────

async function checkResolutions() {
  const open = Object.values(positions).filter(p => !p.resolved)
  if (open.length === 0) return

  for (const pos of open) {
    try {
      const marketId = pos.conditionId || pos.marketId
      const res = await axios.get(`${GAMMA_API}/markets/${marketId}`, { timeout: 8000 })
      const m   = res.data
      if (!m || m.active !== false) continue  // still live

      const yesPrice  = parseFloat((m.outcomePrices || [])[0] ?? -1)
      if (yesPrice < 0) continue  // no resolution data yet

      const won = pos.side === 'YES' ? yesPrice >= 0.99 : yesPrice <= 0.01
      const pnl = won
        ? parseFloat((pos.stake * (1 / pos.priceAtBet - 1)).toFixed(6))
        : -pos.stake

      pos.resolved   = true
      pos.outcome    = won ? 'WIN' : 'LOSS'
      pos.pnl        = pnl
      pos.resolvedAt = Date.now()
      savePositions()

      const sign = pnl >= 0 ? '+' : ''
      console.log(
        `[POLY] 🎯 RESOLVED: "${pos.question.slice(0, 55)}"` +
        `\n[POLY]    ${pos.childId} bet ${pos.side} $${pos.stake.toFixed(2)} → ` +
        `${pos.outcome} | P&L: ${sign}$${pnl.toFixed(4)}`
      )

      // Credit child
      if (pnl > 0 && _onEarning) {
        _onEarning(pos.childId, pnl, 'polymarket', `${pos.outcome} on "${pos.question.slice(0, 40)}"`)
      }

      // Update child's polymarket knowledge genome
      if (_colony) {
        const child = _colony.children?.find(c => c.id === pos.childId)
        if (child?.knowledge) {
          const km = require('./knowledge')
          km.updatePolymarketKnowledge(child.knowledge, pos, won, pnl)
        }
      }
    } catch { /* market not resolved yet or API error */ }
  }
}

// ── Per-child bet decision ────────────────────────────────────

async function runForChild(child, getBalance) {
  if (!child || child.status !== 'alive') return 0

  const balance = await getBalance().catch(() => 0)
  if (balance < MIN_BET * 3) return 0

  const km = require('./knowledge')
  km.initPolymarketKnowledge(child.knowledge)

  let betsPlaced = 0

  for (const entry of _markets) {
    const { market, analysis } = entry
    if (!analysis) continue
    if (analysis.recommendation === 'SKIP') continue
    if (analysis.confidence !== 'HIGH') continue
    if (Math.abs(analysis.edge) < MIN_EDGE) continue

    // Already have a position on this market?
    const alreadyOpen = Object.values(positions).some(
      p => (p.marketId === market.id || p.conditionId === market.conditionId) &&
           p.childId === child.id && !p.resolved
    )
    if (alreadyOpen) continue

    // Category preference from knowledge
    const pm         = child.knowledge?.polymarket
    const catWeight  = pm?.categoryWeights?.[analysis.category] ?? 1.0
    if (catWeight < 0.25 && !child.survivalMode) {
      console.log(`[POLY] ${child.id} skips ${analysis.category} (weight ${catWeight.toFixed(2)})`)
      continue
    }

    const betSize = calcBetSize(balance, child.id)
    if (betSize < MIN_BET) {
      console.log(`[POLY] ${child.id} exposure cap reached — skipping bets this cycle`)
      break
    }

    const side  = analysis.recommendation === 'BET_YES' ? 'YES' : 'NO'
    const price = side === 'YES' ? analysis.yesPrice : (1 - analysis.yesPrice)

    market._yesPrice = analysis.yesPrice  // cache for order building

    console.log(
      `[POLY] 🎲 ${child.id} → ${side} "${market.question.slice(0, 55)}…"` +
      `\n[POLY]    edge=${(analysis.edge * 100).toFixed(1)}%  conf=HIGH  stake=$${betSize.toFixed(2)}` +
      `\n[POLY]    reason: ${analysis.reasoning.slice(0, 100)}`
    )

    const result = await placeClobOrder(market, side, betSize)

    if (result.paper) {
      console.log(`[POLY] 📝 Paper trade (add POLYMARKET_PK + CLOB creds to .env for real money)`)
    } else if (!result.ok) {
      console.log(`[POLY] Order failed: ${result.error}`)
      continue
    } else {
      console.log(`[POLY] ✅ Order filled | tx: ${result.txHash?.slice(0, 12)}…`)
    }

    openPosition(market, side, betSize, price, child.id, analysis)
    betsPlaced++
    break  // one bet per child per cycle — discipline
  }

  return 0   // earnings come via checkResolutions → _onEarning callback
}

// ── Colony-wide scan cycle ────────────────────────────────────

async function runScanCycle() {
  _lastScan = Date.now()
  const anySurvival = _colony?.children?.some(c => c.status === 'alive' && c.survivalMode)
  const label = anySurvival ? '[POLY:SURVIVAL]' : '[POLY]'

  console.log(`${label} Scanning prediction markets...`)
  const markets = await fetchMarkets()
  if (markets.length === 0) {
    console.log(`${label} No qualifying markets (closing within 24h, vol > $100)`)
    return
  }
  console.log(`${label} ${markets.length} qualifying markets found`)

  const entries = []
  for (const market of markets) {
    try {
      const research = await researchMarket(market)
      // Small delay to avoid rate-limiting Claude
      await new Promise(r => setTimeout(r, 1200))
      const analysis = await analyzeMarket(market, research, null)
      entries.push({ market, research, analysis, analyzedAt: Date.now() })

      if (analysis && analysis.recommendation !== 'SKIP') {
        console.log(
          `${label} "${market.question.slice(0, 60)}"` +
          `\n${label}   → ${analysis.recommendation} | conf=${analysis.confidence}` +
          ` | edge=${(analysis.edge * 100).toFixed(1)}%`
        )
      }
    } catch (e) {
      console.log(`${label} Failed: ${e.message}`)
    }
  }

  _markets = entries
  const actionable = entries.filter(e => e.analysis?.recommendation !== 'SKIP' && e.analysis?.confidence === 'HIGH').length
  console.log(`${label} Scan done — ${actionable} actionable markets (HIGH confidence)`)

  // Let each alive child decide whether to bet
  if (_colony) {
    const { getUSDCBalance } = require('./childWallet')
    for (const child of (_colony.children || []).filter(c => c.status === 'alive')) {
      const earnerMod = require('./childEarner')
      const info = earnerMod.getEarnerInfo(child.id)
      const addr = info?.walletAddress || child.walletAddress
      if (!addr) continue
      await runForChild(child, () => getUSDCBalance(addr, 'kite'))
    }
  }
}

// ── Module init ───────────────────────────────────────────────

let _scanTimer    = null
let _resolveTimer = null

function start(colony, onEarning) {
  _colony    = colony
  _onEarning = onEarning
  loadPositions()

  // Stagger initial scan 45s after startup
  setTimeout(() => {
    runScanCycle()
    // Dynamic rescan — check every 5min if any child is in survival mode
    _scanTimer = setInterval(() => {
      const anySurvival = colony.children?.some(c => c.status === 'alive' && c.survivalMode)
      const elapsed = Date.now() - (_lastScan || 0)
      const threshold = anySurvival ? SURVIVAL_SCAN_MS : SCAN_MS
      if (elapsed >= threshold) runScanCycle()
    }, 5 * 60 * 1000)
  }, 45000)

  _resolveTimer = setInterval(checkResolutions, RESOLVE_MS)

  console.log('[POLY] Prediction market engine initialized')
}

function getPositions() { return { ...positions } }

module.exports = {
  start,
  runForChild,
  getPositions,
  getCategory,
}
