/**
 * polymarket.js — Prediction Market Intelligence Engine
 *
 * Each child agent gets its own Polygon wallet (derived from
 * GAIA_BASE_SIGNING_KEY using the same deterministic scheme as the
 * Base/Kite child wallets — EVM is EVM, same address on every chain).
 *
 * Flow per child:
 *  1. Derive Polygon wallet from GAIA_BASE_SIGNING_KEY + childId
 *  2. Auto-create Polymarket CLOB L2 API credentials (signed challenge)
 *  3. Mother sends USDC + MATIC for gas to child on Polygon
 *  4. Child approves CTF Exchange to spend its USDC (one-time)
 *  5. Child analyzes markets and places EIP-712 signed CLOB orders
 *  6. Positions tracked; wins credited via onEarning callback
 *  7. Knowledge genome records category win/loss → offspring inherit
 *
 * Required:
 *   GAIA_BASE_SIGNING_KEY — mother's Polygon EOA key (same key used
 *                           for Base chain / Claw Earn signing)
 * Optional research boost:
 *   SERPAPI_KEY           — higher-quality web search
 */

require('dotenv').config()
const axios      = require('axios')
const Anthropic  = require('@anthropic-ai/sdk')
const { ethers } = require('ethers')
const fs         = require('fs')
const path       = require('path')
const crypto     = require('crypto')

// ── Constants ─────────────────────────────────────────────────

const FUNDED_PATH      = path.join(__dirname, '../data/funded-children.json')
const GAMMA_API        = 'https://gamma-api.polymarket.com'
const CLOB_HOST        = 'https://clob.polymarket.com'
const POLYGON_CHAIN    = process.env.POLYGON_TESTNET === 'true' ? 80002 : 137
const CTF_EXCHANGE     = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'
const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296'
const POLY_USDC        = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'  // native USDC on Polygon
const POLY_USDC_E      = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'  // bridged USDC.e fallback

const MIN_BET          = 0.10
const MAX_BET          = 0.50
const KELLY_FRACTION   = 0.02
const MAX_EXPOSURE     = 0.20
const MIN_EDGE         = 0.03
const CHILD_POLY_SEED  = 1.00   // USDC to seed each child's Polygon wallet
const CHILD_MATIC_SEED = '0.05' // MATIC for gas
const MAX_MARKETS      = 20
const SCAN_MS          = 15 * 60 * 1000
const SURVIVAL_SCAN_MS = 15 * 60 * 1000
const RESOLVE_MS       = 30 * 60 * 1000

const PAPER_TRADING = process.env.PAPER_TRADING === 'true'

const POSITIONS_PATH = path.join(__dirname, '../data/polymarket_positions.json')
const CREDS_PATH     = path.join(__dirname, '../data/polymarket_creds.json')

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

const CLOB_DOMAIN  = { name: 'ClobAuthDomain', version: '1', chainId: POLYGON_CHAIN }
const ORDER_DOMAIN = { name: 'Polymarket CTF Exchange', version: '1', chainId: POLYGON_CHAIN, verifyingContract: CTF_EXCHANGE }

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

// ── Module state ──────────────────────────────────────────────

let _colony    = null
let _onEarning = null
let _markets   = []
let _lastScan  = 0
let positions  = {}   // positionId → position object
let childCreds = {}   // childId → { apiKey, secret, passphrase }

const approvedWallets  = new Set()   // addresses already approved CTF Exchange
const fundedChildren   = new Set()   // childIds already seeded on Polygon

const { polygonProvider, throttledLog } = require('./rpcProvider')
const anthropic        = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Persistence ───────────────────────────────────────────────

function ensureDataDir() {
  const dir = path.dirname(POSITIONS_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function loadState() {
  ensureDataDir()
  try {
    if (fs.existsSync(POSITIONS_PATH)) {
      positions  = JSON.parse(fs.readFileSync(POSITIONS_PATH, 'utf8'))
      const open = Object.values(positions).filter(p => !p.resolved).length
      if (open) console.log(`[POLY] Loaded ${open} open positions`)
    }
  } catch { positions = {} }

  try {
    if (fs.existsSync(CREDS_PATH)) {
      childCreds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'))
      const n = Object.keys(childCreds).length
      if (n) console.log(`[POLY] Loaded CLOB creds for ${n} child${n !== 1 ? 'ren' : ''}`)
    }
  } catch { childCreds = {} }

  try {
    if (fs.existsSync(FUNDED_PATH)) {
      const saved = JSON.parse(fs.readFileSync(FUNDED_PATH, 'utf8'))
      for (const id of saved) fundedChildren.add(id)
    }
  } catch {}
}

function saveFundedChildren() {
  try { ensureDataDir(); fs.writeFileSync(FUNDED_PATH, JSON.stringify([...fundedChildren], null, 2)) } catch {}
}

async function drainOrphanedChildren(activeIds) {
  let orphans = []
  try {
    if (fs.existsSync(FUNDED_PATH)) {
      const saved = JSON.parse(fs.readFileSync(FUNDED_PATH, 'utf8'))
      orphans = saved.filter(id => !activeIds.includes(id))
    }
  } catch {}
  if (!orphans.length) return

  console.log(`[POLY] Draining ${orphans.length} orphaned child wallet(s): ${orphans.join(', ')}`)
  const mother = motherPolyWallet()
  if (!mother) return

  const usdc = new ethers.Contract(POLY_USDC, ERC20_ABI, mother)

  for (const childId of orphans) {
    try {
      const wallet  = deriveChildPolyWallet(childId)
      if (!wallet) continue
      const addr    = wallet.address
      const usdcBal = await usdc.balanceOf(addr)
      const polBal  = await polygonProvider.getBalance(addr)
      const gasCost = ethers.parseEther('0.005')

      if (usdcBal > 0n) {
        if (polBal < gasCost) {
          await (await mother.sendTransaction({ to: addr, value: gasCost })).wait()
        }
        const tx = await new ethers.Contract(POLY_USDC, ERC20_ABI, wallet).transfer(mother.address, usdcBal)
        await tx.wait()
        console.log(`[POLY] ✓ Drained $${ethers.formatUnits(usdcBal, 6)} USDC from ${childId}`)
      }

      const remaining = await polygonProvider.getBalance(addr)
      if (remaining > gasCost) {
        const send = remaining - gasCost
        await (await wallet.sendTransaction({ to: mother.address, value: send })).wait()
        console.log(`[POLY] ✓ Drained ${ethers.formatEther(send)} POL from ${childId}`)
      }

      fundedChildren.delete(childId)
    } catch (e) {
      console.log(`[POLY] Drain failed for ${childId}: ${e.message}`)
    }
  }
  saveFundedChildren()
}

function savePositions() {
  try { ensureDataDir(); fs.writeFileSync(POSITIONS_PATH, JSON.stringify(positions, null, 2)) } catch {}
}

function saveCreds() {
  try { ensureDataDir(); fs.writeFileSync(CREDS_PATH, JSON.stringify(childCreds, null, 2)) } catch {}
}

// ── Wallet derivation ─────────────────────────────────────────
// Same deterministic scheme as childWallet.js — EVM is EVM, the derived
// address is identical on Polygon, Base, and Kite EVM.

function deriveChildPolyWallet(childId) {
  const key = (process.env.GAIA_BASE_SIGNING_KEY || '').trim()
  if (!key) return null
  try {
    const derived = ethers.id(key + ':child:' + childId)
    return new ethers.Wallet(derived, polygonProvider)
  } catch { return null }
}

function motherPolyWallet() {
  const key = (process.env.GAIA_BASE_SIGNING_KEY || '').trim()
  if (!key) return null
  try { return new ethers.Wallet(key, polygonProvider) } catch { return null }
}

// ── Polygon balances ──────────────────────────────────────────

async function getPolyUSDCBalance(address) {
  try {
    // Try native USDC first, fall back to USDC.e
    const usdc = new ethers.Contract(POLY_USDC, ERC20_ABI, polygonProvider)
    const raw  = await usdc.balanceOf(address)
    const bal  = parseFloat(ethers.formatUnits(raw, 6))
    if (bal > 0) return bal

    const usdce = new ethers.Contract(POLY_USDC_E, ERC20_ABI, polygonProvider)
    const rawE  = await usdce.balanceOf(address)
    return parseFloat(ethers.formatUnits(rawE, 6))
  } catch (e) {
    throttledLog('poly:balance', `[POLY] Polygon RPC error (retrying in 30s): ${e.message}`)
    return 0
  }
}

// ── Mother funds child on Polygon ─────────────────────────────

async function fundChildPoly(childId, childAddress) {
  if (fundedChildren.has(childId)) return
  try { if (require('./server')._polySeedPaused) { console.log('[POLY] Seed paused — skipping'); return } } catch {}
  const mother = motherPolyWallet()
  if (!mother) {
    console.log('[POLY] GAIA_BASE_SIGNING_KEY not set — cannot fund child on Polygon')
    return
  }

  // Send MATIC for gas only if child has less than half the seed amount
  try {
    const childPol  = await polygonProvider.getBalance(childAddress)
    const maticSeed = ethers.parseEther(CHILD_MATIC_SEED)
    const alreadyHasGas = childPol >= maticSeed / 2n

    if (alreadyHasGas) {
      console.log(`[POLY] ${childId} already has ${ethers.formatEther(childPol)} POL — skipping gas seed`)
    } else {
      const maticBal = await polygonProvider.getBalance(mother.address)
      if (maticBal > maticSeed) {
        console.log(`[POLY] 💸 Seeding gas for ${childId} (${childAddress.slice(0, 10)}…)`)
        const tx = await mother.sendTransaction({ to: childAddress, value: maticSeed })
        await tx.wait()
        console.log(`[POLY] ✓ ${CHILD_MATIC_SEED} POL → ${childId}`)
      } else {
        console.log(`[POLY] Mother low on POL (${ethers.formatEther(maticBal)}) — skipping gas seed`)
      }
    }
  } catch (e) { throttledLog('poly:matic-seed', `[POLY] POL seed failed: ${e.message}`) }

  // Send USDC only if child doesn't already have enough
  try {
    const usdc      = new ethers.Contract(POLY_USDC, ERC20_ABI, mother)
    const amount    = ethers.parseUnits(String(CHILD_POLY_SEED), 6)
    const childUsdc = await usdc.balanceOf(childAddress)

    if (childUsdc >= amount / 2n) {
      console.log(`[POLY] ${childId} already has $${ethers.formatUnits(childUsdc, 6)} USDC — skipping USDC seed`)
      fundedChildren.add(childId); saveFundedChildren()
    } else {
      const motherBal = await usdc.balanceOf(mother.address)
      if (motherBal >= amount) {
        const tx = await usdc.transfer(childAddress, amount)
        await tx.wait()
        console.log(`[POLY] ✓ $${CHILD_POLY_SEED} USDC → ${childId}`)
        fundedChildren.add(childId); saveFundedChildren()
      } else {
        throttledLog('poly:usdc-low', `[POLY] Mother has $${ethers.formatUnits(motherBal, 6)} USDC (need $${CHILD_POLY_SEED})`)
      }
    }
  } catch (e) { throttledLog('poly:usdc-seed', `[POLY] USDC seed failed: ${e.message}`) }

  // Pre-approve CTF Exchange so first trade doesn't need extra gas time
  try {
    const wallet = deriveChildPolyWallet(childId)
    if (wallet) {
      const pol = await polygonProvider.getBalance(wallet.address)
      if (pol > 0n) await ensureApproval(wallet)
    }
  } catch (e) { throttledLog('poly:pre-approve', `[POLY] Pre-approval failed: ${e.message}`) }
}

// ── CLOB credential creation ──────────────────────────────────

const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: 'address',   type: 'address' },
    { name: 'timestamp', type: 'string'  },
    { name: 'nonce',     type: 'uint256' },
    { name: 'message',   type: 'string'  },
  ],
}

async function buildL1Headers(wallet, nonce = 0) {
  const timestamp = Math.floor(Date.now() / 1000)
  const sig = await wallet.signTypedData(
    CLOB_DOMAIN,
    CLOB_AUTH_TYPES,
    {
      address:   wallet.address,
      timestamp: timestamp.toString(),
      nonce,
      message:   'This message attests that I control the given wallet',
    }
  )
  return {
    'POLY_ADDRESS':   wallet.address,
    'POLY_SIGNATURE': sig,
    'POLY_TIMESTAMP': timestamp.toString(),
    'POLY_NONCE':     nonce.toString(),
  }
}

async function createClobCreds(wallet) {
  const nonce   = 0
  const headers = await buildL1Headers(wallet, nonce)

  // Try derive first (deterministic, no ToS gate), fall back to create
  try {
    const r = await axios.get(`${CLOB_HOST}/auth/derive-api-key`, { headers, timeout: 15000 })
    if (r.data?.apiKey) return { apiKey: r.data.apiKey, secret: r.data.secret, passphrase: r.data.passphrase }
  } catch {}

  const res = await axios.post(`${CLOB_HOST}/auth/api-key`, { nonce }, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    timeout: 15000,
  })

  return {
    apiKey:     res.data.apiKey,
    secret:     res.data.secret,
    passphrase: res.data.passphrase,
  }
}

async function ensureChildCreds(childId) {
  if (childCreds[childId]) return childCreds[childId]

  const wallet = deriveChildPolyWallet(childId)
  if (!wallet) return null

  try {
    console.log(`[POLY] Creating CLOB credentials for ${childId} (${wallet.address.slice(0, 10)}…)`)
    const creds = await createClobCreds(wallet)
    childCreds[childId] = creds
    saveCreds()
    console.log(`[POLY] ✅ CLOB creds ready for ${childId}`)
    return creds
  } catch (e) {
    console.log(`[POLY] CLOB cred creation failed for ${childId}: ${e.response?.data?.error || e.message}`)
    console.log(`[POLY]   (wallet may need to accept Polymarket ToS at polymarket.com first)`)
    return null
  }
}

// ── USDC approval ─────────────────────────────────────────────

async function ensureApproval(wallet) {
  if (approvedWallets.has(wallet.address)) return true
  try {
    const usdc      = new ethers.Contract(POLY_USDC, ERC20_ABI, wallet)
    const allowance = await usdc.allowance(wallet.address, CTF_EXCHANGE)
    if (allowance < ethers.parseUnits('100', 6)) {
      const tx = await usdc.approve(CTF_EXCHANGE, ethers.MaxUint256)
      await tx.wait()
      // Also approve NEG_RISK_ADAPTER (used by some markets)
      const tx2 = await usdc.approve(NEG_RISK_ADAPTER, ethers.MaxUint256)
      await tx2.wait()
      console.log(`[POLY] ✓ USDC approved for CTF Exchange: ${wallet.address.slice(0, 10)}…`)
    }
    approvedWallets.add(wallet.address)
    return true
  } catch (e) {
    console.log(`[POLY] Approval failed for ${wallet.address.slice(0, 10)}…: ${e.message}`)
    return false
  }
}

// ── CLOB order placement ──────────────────────────────────────

function buildClobAuthHeaders(creds, method, reqPath, body = '') {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const msg       = timestamp + method.toUpperCase() + reqPath + body
  const sig       = crypto.createHmac('sha256', creds.secret).update(msg).digest('base64')
  return {
    'POLY-API-KEY':    creds.apiKey,
    'POLY-SIGNATURE':  sig,
    'POLY-TIMESTAMP':  timestamp,
    'POLY-PASSPHRASE': creds.passphrase,
    'Content-Type':    'application/json',
  }
}

async function placeClobOrder(market, side, stakeUSDC, childId) {
  const wallet = deriveChildPolyWallet(childId)
  if (!wallet) return { ok: false, paper: true, reason: 'no GAIA_BASE_SIGNING_KEY' }

  // Auto-create credentials if not cached
  const creds = await ensureChildCreds(childId)
  if (!creds) return { ok: false, paper: true, reason: 'CLOB creds unavailable' }

  // Check Polygon USDC balance, fund if needed
  const bal = await getPolyUSDCBalance(wallet.address)
  if (bal < stakeUSDC) {
    if (!fundedChildren.has(childId)) {
      await fundChildPoly(childId, wallet.address)
      const newBal = await getPolyUSDCBalance(wallet.address)
      if (newBal < stakeUSDC) {
        return { ok: false, paper: true, reason: `insufficient Polygon USDC ($${newBal.toFixed(4)})` }
      }
    } else {
      return { ok: false, paper: true, reason: `low Polygon USDC ($${bal.toFixed(4)})` }
    }
  }

  // One-time USDC approval for CTF Exchange
  const approved = await ensureApproval(wallet)
  if (!approved) return { ok: false, paper: true, reason: 'USDC approval failed' }

  try {
    let tokenIds = []
    try { tokenIds = JSON.parse(market.clobTokenIds || '[]') } catch {}
    const tokenId = side === 'YES' ? tokenIds[0] : tokenIds[1]
    if (!tokenId) return { ok: false, paper: true, reason: 'no token ID in market data' }

    const price    = side === 'YES' ? market._yesPrice : (1 - market._yesPrice)
    const makerAmt = BigInt(Math.floor(stakeUSDC * 1e6))
    const takerAmt = BigInt(Math.floor((stakeUSDC / Math.max(price, 0.01)) * 1e6))

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

    const signature = await wallet.signTypedData(ORDER_DOMAIN, { Order: ORDER_TYPES }, order)

    const body = JSON.stringify({
      order: Object.fromEntries(Object.entries(order).map(([k, v]) => [k, v.toString()])),
      signature,
      orderType: 'GTC',
    })

    const headers = buildClobAuthHeaders(creds, 'POST', '/order', body)
    const res     = await axios.post(`${CLOB_HOST}/order`, body, { headers, timeout: 15000 })

    return { ok: true, orderId: res.data?.orderID, txHash: res.data?.transactionHash }
  } catch (e) {
    const detail = e.response?.data?.error || e.message
    console.log(`[POLY] Order error for ${childId}: ${detail}`)
    return { ok: false, paper: true, reason: detail }
  }
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
      .sort((a, b) => {
        const aEnd = new Date(a.endDate || a.end_date_iso || 0).getTime()
        const bEnd = new Date(b.endDate || b.end_date_iso || 0).getTime()
        return aEnd - bEnd
      })
      .slice(0, MAX_MARKETS)
  } catch (e) {
    console.log('[POLY] Market fetch failed:', e.message)
    return []
  }
}

// ── Research ──────────────────────────────────────────────────

async function searchTavily(query) {
  const key = (process.env.TAVILY_API_KEY || '').trim()
  if (!key) return []
  try {
    const res = await axios.post('https://api.tavily.com/search', {
      api_key: key,
      query,
      search_depth: 'advanced',
      max_results: 5,
      include_answer: true,
    }, { timeout: 15000 })
    const out = []
    if (res.data?.answer) out.push({ title: 'Summary', snippet: res.data.answer, url: '' })
    for (const r of (res.data?.results || []).slice(0, 4))
      out.push({ title: r.title, snippet: r.content || '', url: r.url })
    return out
  } catch (e) {
    throttledLog('poly:tavily', `[POLY] Tavily error: ${e.message}`)
    return []
  }
}

async function searchWikipedia(query) {
  try {
    const s = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: { action: 'query', list: 'search', srsearch: query, format: 'json', srlimit: 3 },
      timeout: 8000,
    })
    const results = []
    for (const hit of (s.data?.query?.search || []).slice(0, 2)) {
      try {
        const r = await axios.get(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`,
          { timeout: 6000 }
        )
        results.push({ url: '', title: hit.title, snippet: r.data.extract || '' })
      } catch {}
    }
    return results
  } catch { return [] }
}

async function researchMarket(market) {
  let results = await searchTavily(market.question)
  if (!results.length) results = await searchWikipedia(market.question)

  const sections = []
  for (const r of results.slice(0, 4)) {
    if (r.snippet) sections.push(`[${r.title}]\n${r.snippet.slice(0, 1800)}`)
  }
  return sections.join('\n\n---\n\n') || '(no research available)'
}

// ── Market categorisation ─────────────────────────────────────

function getCategory(market) {
  const text = `${market.question} ${(market.tags || []).join(' ')}`.toLowerCase()
  if (text.match(/bitcoin|btc|eth|crypto|token|defi|nft|blockchain|solana/)) return 'crypto'
  if (text.match(/trump|biden|harris|election|president|senate|congress|democrat|republican|vote/)) return 'politics'
  if (text.match(/fed|inflation|gdp|recession|stock|market|rate|economy|cpi/)) return 'economics'
  if (text.match(/nba|nfl|soccer|football|baseball|sports|team|playoff|champion/)) return 'sports'
  if (text.match(/openai|gpt|gemini|anthropic|ai|microsoft|apple|google|tech/)) return 'tech'
  if (text.match(/russia|ukraine|china|taiwan|war|military|conflict|nato|iran/)) return 'geopolitics'
  return 'other'
}

// ── Claude analysis ───────────────────────────────────────────

async function analyzeMarket(market, research, childKnowledge) {
  const yesPrice = parseFloat((market.outcomePrices || [])[0] ?? 0.5)
  const noPrice  = parseFloat((market.outcomePrices || [])[1] ?? (1 - yesPrice))
  const category = getCategory(market)
  const pm       = childKnowledge?.polymarket
  const catStats = pm?.categoryPerformance?.[category]
  const catHint  = catStats?.bets >= 3
    ? `\nHistory: ${catStats.wins}/${catStats.bets} wins in ${category} (P&L: ${catStats.totalPnL >= 0 ? '+' : ''}$${catStats.totalPnL.toFixed(3)}).`
    : ''

  const closeDate = new Date(market.endDate || market.end_date_iso).toISOString().slice(0, 16).replace('T', ' ')
  const prompt = `You are a disciplined prediction market analyst making real money decisions.

MARKET: ${market.question}
YES: ${(yesPrice*100).toFixed(1)}%  NO: ${(noPrice*100).toFixed(1)}%
Volume: $${parseFloat(market.volume||0).toLocaleString()}  Closes: ${closeDate} UTC${catHint}

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
    return parseAnalysis(msg.content[0]?.text || '', yesPrice, noPrice, category)
  } catch (e) {
    throttledLog('poly:claude', `[POLY] Claude error (retrying in 30s): ${e.message}`)
    return null
  }
}

function parseAnalysis(text, yesPrice, noPrice, category) {
  const probM = text.match(/PROBABILITY:\s*(\d+)/i)
  const confM = text.match(/CONFIDENCE:\s*(LOW|MEDIUM|HIGH)/i)
  const recM  = text.match(/RECOMMENDATION:\s*(BET_YES|BET_NO|SKIP)/i)
  const rsM   = text.match(/REASONING:\s*(.+?)(?:\nRECOMMENDATION|$)/is)
  if (!probM || !confM || !recM) return null

  const probability    = Math.max(0, Math.min(100, parseInt(probM[1]))) / 100
  const confidence     = confM[1].toUpperCase()
  const recommendation = recM[1].toUpperCase()
  const reasoning      = (rsM?.[1] || '').trim().slice(0, 200)
  const edge = recommendation === 'BET_YES' ? probability - yesPrice
             : recommendation === 'BET_NO'  ? noPrice - (1 - probability)
             : 0

  return { probability, confidence, recommendation, reasoning, edge, yesPrice, noPrice, category }
}

// ── Bet sizing ────────────────────────────────────────────────

function calcBetSize(polyBalance, childId) {
  const openExposure = Object.values(positions)
    .filter(p => p.childId === childId && !p.resolved)
    .reduce((s, p) => s + p.stake, 0)
  const maxByExposure = Math.max(0, polyBalance * MAX_EXPOSURE - openExposure)
  return Math.min(MAX_BET, Math.max(0, Math.min(polyBalance * KELLY_FRACTION, maxByExposure)))
}

// ── Position tracking ─────────────────────────────────────────

function openPosition(market, side, stake, priceAtBet, childId, analysis, walletAddress) {
  const posId = `poly_${childId.slice(-6)}_${Date.now()}`
  positions[posId] = {
    posId,
    marketId:      market.id || market.conditionId,
    conditionId:   market.conditionId || market.id,
    question:      market.question,
    category:      analysis.category,
    side,
    stake,
    priceAtBet,
    edge:          analysis.edge,
    reasoning:     analysis.reasoning,
    childId,
    walletAddress,
    openedAt:      Date.now(),
    resolved:      false,
    outcome:       null,
    pnl:           null,
  }
  savePositions()
  return posId
}

// ── Resolution checker ────────────────────────────────────────

async function checkResolutions() {
  const open = Object.values(positions).filter(p => !p.resolved)
  if (!open.length) return

  for (const pos of open) {
    try {
      const res = await axios.get(`${GAMMA_API}/markets/${pos.conditionId || pos.marketId}`, { timeout: 8000 })
      const m   = res.data
      if (!m || m.active !== false) continue

      const yesPrice = parseFloat((m.outcomePrices || [])[0] ?? -1)
      if (yesPrice < 0) continue

      const won = pos.side === 'YES' ? yesPrice >= 0.99 : yesPrice <= 0.01
      const pnl = parseFloat((won
        ? pos.stake * (1 / pos.priceAtBet - 1)
        : -pos.stake
      ).toFixed(6))

      pos.resolved   = true
      pos.outcome    = won ? 'WIN' : 'LOSS'
      pos.pnl        = pnl
      pos.resolvedAt = Date.now()
      savePositions()

      const sign = pnl >= 0 ? '+' : ''
      console.log(
        `[POLY] 🎯 ${pos.outcome}: "${pos.question.slice(0, 55)}"` +
        `\n[POLY]    ${pos.childId} bet ${pos.side} $${pos.stake.toFixed(2)} | P&L: ${sign}$${pnl.toFixed(4)}`
      )

      if (pnl > 0 && _onEarning) {
        _onEarning(pos.childId, pnl, 'polymarket', `${pos.outcome} on "${pos.question.slice(0, 40)}"`)
      }

      if (_colony) {
        const child = _colony.children?.find(c => c.id === pos.childId)
        if (child?.knowledge) {
          const km = require('./knowledge')
          km.updatePolymarketKnowledge(child.knowledge, pos, won, pnl)
        }
      }
    } catch { /* market still live or API error */ }
  }
}

// ── Per-child bet decision ────────────────────────────────────

async function runForChild(child) {
  if (!child || child.status !== 'alive') return 0

  const wallet = deriveChildPolyWallet(child.id)
  if (!wallet) return 0  // no signing key — silent skip

  const km = require('./knowledge')
  km.initPolymarketKnowledge(child.knowledge)

  // Get Polygon USDC balance
  const polyBalance = await getPolyUSDCBalance(wallet.address)

  // Seed funding on first encounter
  if (polyBalance < MIN_BET && !fundedChildren.has(child.id)) {
    await fundChildPoly(child.id, wallet.address)
    return 0  // will bet next cycle after funding
  }
  if (polyBalance < MIN_BET) return 0

  for (const { market, analysis } of _markets) {
    if (!analysis) continue
    if (analysis.recommendation === 'SKIP') continue
    if (!['HIGH', 'MEDIUM'].includes(analysis.confidence)) continue
    if (Math.abs(analysis.edge) < MIN_EDGE) continue

    // Already have an open position on this market?
    if (Object.values(positions).some(
      p => (p.marketId === market.id || p.conditionId === market.conditionId) &&
           p.childId === child.id && !p.resolved
    )) continue

    // Category weight filter
    const catWeight = child.knowledge?.polymarket?.categoryWeights?.[analysis.category] ?? 1.0
    if (catWeight < 0.25 && !child.survivalMode) continue

    const betSize = calcBetSize(polyBalance, child.id)
    if (betSize < MIN_BET) break

    const side  = analysis.recommendation === 'BET_YES' ? 'YES' : 'NO'
    const price = side === 'YES' ? analysis.yesPrice : (1 - analysis.yesPrice)
    market._yesPrice = analysis.yesPrice

    console.log(
      `[POLY] 🎲 ${child.id} → ${side} "${market.question.slice(0, 55)}…"` +
      `\n[POLY]    edge=${(analysis.edge*100).toFixed(1)}%  stake=$${betSize.toFixed(2)}` +
      `\n[POLY]    wallet: ${wallet.address.slice(0, 10)}… (Polygon balance: $${polyBalance.toFixed(4)})`
    )

    let result
    if (PAPER_TRADING) {
      result = { ok: false, paper: true, reason: 'PAPER_TRADING mode — no real order sent' }
    } else {
      result = await placeClobOrder(market, side, betSize, child.id)
    }

    if (!result.ok) {
      console.log(`[POLY] 📝 Paper trade — ${side} $${betSize.toFixed(2)} on "${market.question.slice(0, 50)}" (${result.reason})`)
    } else {
      console.log(`[POLY] ✅ Order filled | orderId: ${result.orderId}`)
      if (_colony) {
        const ev = _colony.events
        if (ev) {
          const time = new Date().toTimeString().split(' ')[0]
          ev.unshift({ time, msg: `${child.id.replace('GAIA-','')} bet ${side} $${betSize.toFixed(2)} — "${market.question.slice(0,45)}"`, type: 'success' })
          if (ev.length > 50) ev.pop()
        }
      }
    }

    openPosition(market, side, betSize, price, child.id, analysis, wallet.address)
    break  // one bet per child per cycle
  }

  return 0  // earnings arrive asynchronously via checkResolutions
}

// ── Colony-wide scan ──────────────────────────────────────────

async function runScanCycle() {
  _lastScan = Date.now()
  const anySurvival = _colony?.children?.some(c => c.status === 'alive' && c.survivalMode)
  const label = anySurvival ? '[POLY:SURVIVAL]' : '[POLY]'

  console.log(`${label} Scanning prediction markets…`)
  const markets = await fetchMarkets()
  if (!markets.length) {
    console.log(`${label} No qualifying markets (24h window, vol > $100)`)
    return
  }
  console.log(`${label} ${markets.length} markets qualify`)

  const entries = []
  for (const market of markets) {
    try {
      const research = await researchMarket(market)
      await new Promise(r => setTimeout(r, 1200))  // rate limit Claude
      const analysis = await analyzeMarket(market, research, null)
      entries.push({ market, research, analysis, analyzedAt: Date.now() })
      if (analysis && analysis.recommendation !== 'SKIP') {
        console.log(
          `${label} "${market.question.slice(0, 58)}"` +
          `\n${label}   → ${analysis.recommendation} | conf=${analysis.confidence} | edge=${(analysis.edge*100).toFixed(1)}%`
        )
      }
    } catch (e) { console.log(`${label} Failed: ${e.message}`) }
  }

  _markets = entries
  const hot = entries.filter(e => e.analysis?.recommendation !== 'SKIP' && e.analysis?.confidence === 'HIGH').length
  console.log(`${label} Done — ${hot} HIGH-confidence actionable market${hot !== 1 ? 's' : ''}`)

  // Each alive child independently decides whether to bet
  if (_colony) {
    for (const child of (_colony.children || []).filter(c => c.status === 'alive')) {
      await runForChild(child)
    }
  }
}

// ── Module init ───────────────────────────────────────────────

function start(colony, onEarning) {
  _colony    = colony
  _onEarning = onEarning
  loadState()

  // Drain orphaned children from previous deploys after colony settles
  setTimeout(async () => {
    const activeIds = (colony.children || []).map(c => c.id)
    await drainOrphanedChildren(activeIds)
  }, 30000)

  // Initial scan after 45s (let colony settle)
  setTimeout(() => {
    runScanCycle()
    // Check every 5 min — if any child is in survival, rescan at 15-min rate
    setInterval(() => {
      const anySurvival = colony.children?.some(c => c.status === 'alive' && c.survivalMode)
      const threshold   = anySurvival ? SURVIVAL_SCAN_MS : SCAN_MS
      if (Date.now() - _lastScan >= threshold) runScanCycle()
    }, 5 * 60 * 1000)
  }, 45000)

  setInterval(checkResolutions, RESOLVE_MS)
  console.log('[POLY] Prediction market engine initialized')
}

function getPositions() { return { ...positions } }

// Eagerly seed a newly-spawned child on Polygon.
// Called from gaia.js right after the child wallet address is known.
async function seedChild(child) {
  if (!child?.walletAddress) return
  if (fundedChildren.has(child.id)) return
  const mother = motherPolyWallet()
  if (!mother) return  // no signing key — silent skip
  await fundChildPoly(child.id, child.walletAddress)
}

module.exports = { start, runForChild, seedChild, getPositions, getCategory }
