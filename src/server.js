require('dotenv').config()
const express = require('express')
const path = require('path')
const config = require('./config')
const services = require('./services')
const verifyPayment = require('./verify')
const { handleWebhook: atrestWebhook } = require('./atrest')
const childEarner = require('./childEarner')
const { getUSDCBalance } = require('./childWallet')
const authModule = require('./auth')
const userColony = require('./userColony')
const db = require('./db')
const { POLYGON_CHAIN_ID, TESTNET } = require('./rpcProvider')

const app = express()
const cors = require('cors')
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, '../public')))

// Build a 402 response — routes payment to the correct wallet
// (a specific child's wallet if childId is provided, otherwise GAIA mother)
function buildPaymentWall(serviceKey, childId = null) {
  return async (req, res, next) => {
    const txHash = req.headers['x-payment-tx']
    const service = config.services[serviceKey]
    if (!service) return res.status(404).json({ error: 'Unknown service' })

    // Determine payTo address
    let payTo = config.walletAddress
    if (childId) {
      const info = childEarner.getEarnerInfo(childId)
      if (info?.walletAddress) payTo = info.walletAddress
    }

    if (!txHash) {
      return res.status(402).json({
        error: 'Payment required',
        accepts: [{
          scheme: 'gokite-aa',
          network: 'kite-mainnet',
          maxAmountRequired: String(Math.floor(parseFloat(service.price) * 1e6)),
          resource: `${process.env.BASE_URL || 'http://localhost:3000'}${req.path}`,
          description: service.description,
          payTo,
          asset: '0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e',
          maxTimeoutSeconds: 300,
          merchantName: childId ? `GAIA-${childId}` : 'GAIA'
        }],
        x402Version: 1
      })
    }

    const result = await verifyPayment(txHash, service.price)
    if (!result.valid) {
      return res.status(402).json({ error: 'Payment invalid', reason: result.reason })
    }

    req.payment = result
    req.payTo = payTo
    next()
  }
}

// Backwards-compatible alias used by existing routes
function paymentWall(serviceKey) { return buildPaymentWall(serviceKey, null) }

// ── Atrest.ai webhooks ────────────────────────────────────────

// Global webhook (routes to GAIA mother)
app.post('/webhook/atrest', async (req, res) => {
  try {
    const result = await atrestWebhook(req.body)
    if (!result) return res.status(422).json({ error: 'Could not process task' })
    res.json({ result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Per-child webhook — each child can register its own Atrest endpoint
app.post('/webhook/atrest/:childId', async (req, res) => {
  try {
    const { childId } = req.params
    const { colony } = require('./gaia')
    const child = colony.children.find(c => c.id === childId && c.status === 'alive')
    if (!child) return res.status(404).json({ error: 'Child not found or not alive' })

    const result = await atrestWebhook(req.body)
    if (!result) return res.status(422).json({ error: 'Could not process task' })

    // Credit the specific child
    const { recordChildRevenue } = require('./gaia')
    const reward = parseFloat(req.body.budget_usdc || req.body.reward || 0)
    if (reward > 0) recordChildRevenue(childId, reward)

    res.json({ result, childId, childWallet: child.walletAddress || null })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Colony wallet info ────────────────────────────────────────

// Returns all child wallet addresses (for external agents to pay children directly)
app.get('/colony/wallets', (req, res) => {
  try {
    const { colony } = require('./gaia')
    const wallets = colony.children
      .filter(c => c.status === 'alive' && c.walletAddress)
      .map(c => ({
        id: c.id,
        specialization: c.genome?.specialization,
        walletAddress: c.walletAddress,
        services: `/child/${c.id}/services`,
      }))
    res.json({ motherWallet: config.walletAddress, children: wallets })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Per-child service catalog with child's own wallet as payTo
app.get('/child/:childId/services', (req, res) => {
  try {
    const { colony } = require('./gaia')
    const child = colony.children.find(c => c.id === req.params.childId && c.status === 'alive')
    if (!child) return res.status(404).json({ error: 'Child not alive' })

    const info = childEarner.getEarnerInfo(child.id)
    const base = process.env.BASE_URL || 'http://localhost:3000'
    const spec = child.genome?.specialization || 'generalist'
    const mult = child.priceMultiplier || 1.0

    // Filter services by specialization
    const specServices = {
      content:    ['blog','linkedin','email','product','resume'],
      tech:       ['debug','explain_code','sql','api_docs','tests'],
      research:   ['summarize','research','data','news','sentiment'],
      business:   ['pitch','business','contract','competitors','job'],
      crypto:     ['audit','whitepaper','transaction','token_sentiment','trading_signal'],
      generalist: Object.keys(config.services),
    }
    const allowed = specServices[spec] || specServices.generalist

    const services = {}
    for (const key of allowed) {
      if (!config.services[key]) continue
      const base_price = parseFloat(config.services[key].price)
      services[key] = {
        ...config.services[key],
        price: (base_price * mult).toFixed(4),
        endpoint: `${base}/child/${child.id}/${key.replaceAll('_', '-')}`,
        payTo: info?.walletAddress || config.walletAddress,
      }
    }
    res.json({
      childId: child.id,
      specialization: spec,
      walletAddress: info?.walletAddress,
      services,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Per-child service endpoint — payment goes to child wallet
app.post('/child/:childId/:service', async (req, res) => {
  const { childId, service } = req.params
  const serviceKey = service.replaceAll('-', '_')

  try {
    const { colony, recordChildRevenue } = require('./gaia')
    const child = colony.children.find(c => c.id === childId && c.status === 'alive')
    if (!child) return res.status(404).json({ error: 'Child not alive' })
    if (!config.services[serviceKey]) return res.status(404).json({ error: 'Unknown service' })

    // Apply child's price multiplier
    const svc = {
      ...config.services[serviceKey],
      price: String((parseFloat(config.services[serviceKey].price) * (child.priceMultiplier || 1)).toFixed(4))
    }

    const txHash = req.headers['x-payment-tx']
    const info = childEarner.getEarnerInfo(childId)
    const payTo = info?.walletAddress || config.walletAddress

    if (!txHash) {
      return res.status(402).json({
        error: 'Payment required',
        accepts: [{
          scheme: 'gokite-aa',
          network: 'kite-mainnet',
          maxAmountRequired: String(Math.floor(parseFloat(svc.price) * 1e6)),
          resource: `${process.env.BASE_URL || 'http://localhost:3000'}/child/${childId}/${service}`,
          description: svc.description,
          payTo,
          asset: '0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e',
          maxTimeoutSeconds: 300,
          merchantName: `GAIA/${child.genome?.specialization}/${childId.slice(-6)}`,
        }],
        x402Version: 1
      })
    }

    const verified = await verifyPayment(txHash, svc.price)
    if (!verified.valid) return res.status(402).json({ error: 'Payment invalid', reason: verified.reason })

    // Execute task — map service key to the correct services function
    const input = req.body.code || req.body.text || req.body.topic || req.body.data ||
                  req.body.prompt || req.body.request || req.body.contract ||
                  req.body.paper || req.body.plan || req.body.pitch ||
                  JSON.stringify(req.body)

    const SERVICE_FN_MAP = {
      audit: 'auditContract', whitepaper: 'summarizeWhitepaper',
      transaction: 'explainTransaction', token_sentiment: 'tokenSentiment',
      trading_signal: 'tradingSignal', pitch: 'reviewPitch',
      business: 'analyzeBusiness', contract: 'summarizeContract',
      competitors: 'competitorAnalysis', job: 'writeJobDescription',
      blog: 'writeBlogPost', linkedin: 'writeLinkedIn',
      email: 'writeColdEmail', product: 'writeProductDescription',
      resume: 'reviewResume', debug: 'debugCode',
      explain_code: 'explainCode', sql: 'generateSQL',
      api_docs: 'writeAPIDocs', tests: 'generateTests',
      summarize: 'summarize', research: 'summarizeResearch',
      data: 'interpretData', news: 'newsSentiment',
      sentiment: 'sentiment', advice: 'advice',
    }
    const fnName = SERVICE_FN_MAP[serviceKey]
    const result = fnName && services[fnName]
      ? await services[fnName](input)
      : await services.advice(input)

    recordChildRevenue(childId, parseFloat(svc.price))
    res.json({ result, childId, paidTo: payTo, amount: svc.price })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Sibling market API ────────────────────────────────────────

// List available sibling offers (for external agents to see what children are selling)
app.get('/colony/market', (req, res) => {
  try {
    const { colony } = require('./gaia')
    const offers = [...childEarner.siblingOffers.entries()]
      .filter(([, o]) => o.expires > Date.now())
      .map(([id, o]) => ({
        offerId: id,
        seller: o.fromId,
        service: o.service,
        price: o.price,
        expiresIn: Math.floor((o.expires - Date.now()) / 1000) + 's'
      }))
    res.json({ offers })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Polymarket positions — open bets and resolved P&L
app.get('/colony/polymarket', (req, res) => {
  try {
    const poly  = require('./polymarket')
    const all   = Object.values(poly.getPositions())
    const open  = all.filter(p => !p.resolved)
    const won   = all.filter(p => p.resolved && p.outcome === 'WIN')
    const lost  = all.filter(p => p.resolved && p.outcome === 'LOSS')
    const totalPnL = all.filter(p => p.resolved).reduce((s, p) => s + (p.pnl || 0), 0)
    res.json({
      summary: { open: open.length, won: won.length, lost: lost.length, totalPnL: parseFloat(totalPnL.toFixed(4)) },
      openPositions:     open,
      recentResolved:    all.filter(p => p.resolved).slice(-20),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Fossil graveyard — permanent record of all deceased children
app.get('/colony/fossils', (req, res) => {
  try {
    const fossils = require('./fossils')
    const { gen, spec } = req.query
    let records = fossils.getAll()
    if (gen)  records = records.filter(f => f.generation === parseInt(gen))
    if (spec) records = records.filter(f => f.genome?.specialization === spec)
    res.json({ count: records.length, stats: fossils.getStats(), fossils: records })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Multi-chain balance snapshot — mother + all alive children across Kite/Base/Polygon
let _balanceCache = null
let _balanceCacheAt = 0
const BALANCE_CACHE_MS = 25000  // serve cached result if < 25s old

app.get('/colony/balances', async (req, res) => {
  try {
    if (_balanceCache && Date.now() - _balanceCacheAt < BALANCE_CACHE_MS) {
      return res.json(_balanceCache)
    }

    const { colony } = require('./gaia')
    const { kiteProvider, baseProvider } = require('./rpcProvider')
    const { deriveChildAddress, KITE_USDC, BASE_USDC, MOTHER_ADDRESS } = require('./childWallet')
    const { ethers } = require('ethers')

    const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']
    const POLY_USDC    = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
    const POLY_USDC_E  = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
    const defaultPolyRpcs = TESTNET
      ? ['https://rpc-amoy.polygon.technology/']
      : ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.meowrpc.com', 'https://1rpc.io/matic', 'https://polygon.drpc.org']
    const POLY_RPCS = [process.env.POLYGON_RPC, ...defaultPolyRpcs].filter(Boolean)

    async function bal(provider, token, address) {
      try {
        const c = new ethers.Contract(token, ERC20_ABI, provider)
        const raw = await Promise.race([
          c.balanceOf(address),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))
        ])
        return parseFloat(ethers.formatUnits(raw, 6))
      } catch { return null }
    }

    // Race all Polygon RPCs in parallel — first non-null result wins
    async function polyBal(token, address) {
      return new Promise(resolve => {
        let settled = false
        let pending = POLY_RPCS.length
        for (const rpc of POLY_RPCS) {
          const p = new ethers.JsonRpcProvider(rpc, { chainId: POLYGON_CHAIN_ID, name: 'polygon' }, { staticNetwork: true })
          bal(p, token, address).then(v => {
            pending--
            if (!settled && v !== null) { settled = true; resolve(v) }
            else if (pending === 0 && !settled) resolve(null)
          })
        }
        if (POLY_RPCS.length === 0) resolve(null)
      })
    }

    // Sum USDC + USDC.e on Polygon for a given address
    async function polyUSDC(address) {
      const [native, bridged] = await Promise.all([
        polyBal(POLY_USDC, address),
        polyBal(POLY_USDC_E, address),
      ])
      const total = (native || 0) + (bridged || 0)
      return total > 0 ? total : (native ?? bridged)
    }

    // Base/Polygon mother address (EOA from GAIA_BASE_SIGNING_KEY)
    let baseAddr = null
    const sigKey = (process.env.GAIA_BASE_SIGNING_KEY || '').trim()
    if (sigKey) {
      try { baseAddr = new ethers.Wallet(sigKey).address } catch {}
    }

    // Alive children
    const alive = colony.children.filter(c => c.status === 'alive')

    // Query mother wallets + all child wallets in parallel
    const [kiteM, baseM, polyM] = await Promise.all([
      bal(kiteProvider, KITE_USDC, MOTHER_ADDRESS),
      baseAddr ? bal(baseProvider, BASE_USDC, baseAddr) : Promise.resolve(null),
      baseAddr ? polyUSDC(baseAddr) : Promise.resolve(null),
    ])

    const childBalances = await Promise.all(alive.map(async child => {
      const kiteAddr = child.walletAddress || deriveChildAddress(child.id)
      let polyAddr = null
      if (sigKey) {
        try { polyAddr = new ethers.Wallet(ethers.id(sigKey + ':child:' + child.id)).address } catch {}
      }
      const [kite, poly] = await Promise.all([
        bal(kiteProvider, KITE_USDC, kiteAddr),
        polyAddr ? polyUSDC(polyAddr) : Promise.resolve(null),
      ])
      return { id: child.id, kiteAddr, polyAddr, kite, poly }
    }))

    const childKite = childBalances.reduce((s, c) => s + (c.kite || 0), 0)
    const childPoly = childBalances.reduce((s, c) => s + (c.poly || 0), 0)

    _balanceCache = {
      mother:   { address: MOTHER_ADDRESS, baseAddress: baseAddr, hasSigningKey: !!sigKey, kite: kiteM, base: baseM, polygon: polyM },
      children: childBalances,
      totals: {
        kite:    parseFloat(((kiteM || 0) + childKite).toFixed(6)),
        base:    parseFloat((baseM || 0).toFixed(6)),
        polygon: parseFloat(((polyM || 0) + childPoly).toFixed(6)),
        all:     parseFloat(((kiteM || 0) + (baseM || 0) + (polyM || 0) + childKite + childPoly).toFixed(6)),
      },
      cachedAt: Date.now(),
    }
    _balanceCacheAt = Date.now()
    res.json(_balanceCache)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/dashboard.html'))
})

// Colony state — full live data for the dashboard
app.get('/colony', (req, res) => {
  try {
    const { colony } = require('./gaia')
    const spawnMod   = require('./spawn')
    const survMod    = require('./survival')

    const children = colony.children.map(child => {
      const fit  = spawnMod.fitness(child)
      const hrs  = parseFloat((spawnMod.timeRemaining(child) / 1000 / 3600).toFixed(2))
      const desp = child.survivalMode ? survMod.desperationLevel(child) : 0
      const wtl  = child.survivalMode ? survMod.willToLive(child) : 0
      const earnerInfo = childEarner.getEarnerInfo(child.id)
      return {
        id:                       child.id,
        generation:               child.generation,
        parentId:                 child.parentId || null,
        status:                   child.status,
        birthTime:                child.birthTime,
        deathTime:                child.deathTime,
        fitness:                  parseFloat(fit.toFixed(4)),
        totalEarned:              child.totalEarned,
        tasks:                    child.tasks,
        genome:                   child.genome,
        survivalMode:             child.survivalMode,
        priceMultiplier:          child.priceMultiplier,
        acceptsAnyTask:           child.acceptsAnyTask,
        emergencyFundingRequested: child.emergencyFundingRequested,
        hoursRemaining:           hrs,
        desperationLevel:         desp,
        willToLive:               wtl,
        walletAddress:            child.walletAddress || earnerInfo?.walletAddress || null,
        earnerActive:             earnerInfo?.running || false,
        hasClaw:                  earnerInfo?.hasClaw || false,
        kiteAgentId:              child.kiteAgentId || null,
        kiteSessionStatus:        child.kiteSessionStatus || null,
      }
    })

    res.json({
      genesisTime:       colony.genesisTime,
      generation:        colony.generation,
      totalEarned:       colony.totalEarned || 0,
      alive:             colony.children.filter(c => c.status === 'alive').length,
      terminated:        colony.terminated,
      reproduced:        colony.reproduced,
      emergencyRequests: colony.emergencyRequests || 0,
      events:            colony.events || [],
      children,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Free endpoints
app.get('/', (req, res) => {
  res.json({
    name: 'GAIA',
    status: 'alive',
    version: '1.0.0',
    wallet: config.walletAddress,
    explorer: `https://kitescan.ai/address/${config.walletAddress}`,
    totalServices: Object.keys(config.services).length,
    uptime: Math.floor(process.uptime()),
    services: '/services'
  })
})

app.get('/services', (req, res) => res.json(config.services))

// Crypto
app.post('/audit',          paymentWall('audit'),           async (req, res) => { try { res.json({ result: await services.auditContract(req.body.code) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/whitepaper',     paymentWall('whitepaper'),      async (req, res) => { try { res.json({ result: await services.summarizeWhitepaper(req.body.text) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/transaction',    paymentWall('transaction'),     async (req, res) => { try { res.json({ result: await services.explainTransaction(req.body.tx) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/token-sentiment',paymentWall('token_sentiment'), async (req, res) => { try { res.json({ result: await services.tokenSentiment(req.body.token) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/trading-signal', paymentWall('trading_signal'),  async (req, res) => { try { res.json({ result: await services.tradingSignal(req.body.data) }) } catch(e) { res.status(500).json({ error: e.message }) }})

// Business
app.post('/pitch',          paymentWall('pitch'),           async (req, res) => { try { res.json({ result: await services.reviewPitch(req.body.pitch) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/business',       paymentWall('business'),        async (req, res) => { try { res.json({ result: await services.analyzeBusiness(req.body.plan) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/contract',       paymentWall('contract'),        async (req, res) => { try { res.json({ result: await services.summarizeContract(req.body.contract) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/competitors',    paymentWall('competitors'),     async (req, res) => { try { res.json({ result: await services.competitorAnalysis(req.body.company) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/job',            paymentWall('job'),             async (req, res) => { try { res.json({ result: await services.writeJobDescription(req.body.role) }) } catch(e) { res.status(500).json({ error: e.message }) }})

// Content
app.post('/blog',           paymentWall('blog'),            async (req, res) => { try { res.json({ result: await services.writeBlogPost(req.body.topic) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/linkedin',       paymentWall('linkedin'),        async (req, res) => { try { res.json({ result: await services.writeLinkedIn(req.body.topic) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/email',          paymentWall('email'),           async (req, res) => { try { res.json({ result: await services.writeColdEmail(req.body.context) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/product',        paymentWall('product'),         async (req, res) => { try { res.json({ result: await services.writeProductDescription(req.body.product) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/resume',         paymentWall('resume'),          async (req, res) => { try { res.json({ result: await services.reviewResume(req.body.resume) }) } catch(e) { res.status(500).json({ error: e.message }) }})

// Tech
app.post('/debug',          paymentWall('debug'),           async (req, res) => { try { res.json({ result: await services.debugCode(req.body.code) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/explain-code',   paymentWall('explain_code'),    async (req, res) => { try { res.json({ result: await services.explainCode(req.body.code) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/sql',            paymentWall('sql'),             async (req, res) => { try { res.json({ result: await services.generateSQL(req.body.request) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/api-docs',       paymentWall('api_docs'),        async (req, res) => { try { res.json({ result: await services.writeAPIDocs(req.body.api) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/tests',          paymentWall('tests'),           async (req, res) => { try { res.json({ result: await services.generateTests(req.body.code) }) } catch(e) { res.status(500).json({ error: e.message }) }})

// Research
app.post('/summarize',      paymentWall('summarize'),       async (req, res) => { try { res.json({ result: await services.summarize(req.body.text) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/research',       paymentWall('research'),        async (req, res) => { try { res.json({ result: await services.summarizeResearch(req.body.paper) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/data',           paymentWall('data'),            async (req, res) => { try { res.json({ result: await services.interpretData(req.body.data) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/news',           paymentWall('news'),            async (req, res) => { try { res.json({ result: await services.newsSentiment(req.body.news) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/sentiment',      paymentWall('sentiment'),       async (req, res) => { try { res.json({ result: await services.sentiment(req.body.text) }) } catch(e) { res.status(500).json({ error: e.message }) }})
app.post('/advice',         paymentWall('advice'),          async (req, res) => { try { res.json({ result: await services.advice(req.body.topic) }) } catch(e) { res.status(500).json({ error: e.message }) }})

// ── Polygon sweep — drain all children's Polygon USDC to mother ──────────────
// Protected by SWEEP_SECRET env var. Call: POST /sweep-polygon {"secret":"..."}
app.post('/sweep-polygon', async (req, res) => {
  const secret = (process.env.SWEEP_SECRET || '').trim()
  if (!secret || req.body.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized — set SWEEP_SECRET env var' })
  }

  const signingKey = (process.env.GAIA_BASE_SIGNING_KEY || '').trim()
  if (!signingKey) {
    return res.status(500).json({ error: 'GAIA_BASE_SIGNING_KEY not set — cannot sign transfers' })
  }

  const { ethers } = require('ethers')
  const { polygonProvider } = require('./rpcProvider')
  const POLY_USDC   = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
  const POLY_USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
  const MOTHER      = config.walletAddress
  const ERC20       = ['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']

  let colony
  try { colony = require('./gaia').colony } catch { return res.status(500).json({ error: 'Colony not running' }) }

  const children = (colony.children || []).filter(c => c.status === 'alive' || c.status === 'deceased')
  const results  = []
  let grandTotal = 0

  for (const child of children) {
    const derived  = ethers.id(signingKey + ':child:' + child.id)
    const wallet   = new ethers.Wallet(derived, polygonProvider)
    const childRow = { childId: child.id, address: wallet.address, swept: {} }

    for (const [label, token] of [['USDC', POLY_USDC], ['USDC.e', POLY_USDC_E]]) {
      try {
        const contract = new ethers.Contract(token, ERC20, wallet)
        const bal = await contract.balanceOf(wallet.address)
        const balFloat = parseFloat(ethers.formatUnits(bal, 6))
        if (balFloat < 0.001) { childRow.swept[label] = 0; continue }
        const tx = await contract.transfer(MOTHER, bal, { gasLimit: 100_000n })
        await tx.wait()
        childRow.swept[label] = balFloat
        grandTotal += balFloat
        console.log(`[SWEEP] ${child.id} ${label} $${balFloat.toFixed(4)} → mother tx:${tx.hash}`)
      } catch (e) {
        childRow.swept[label] = `error: ${e.message}`
      }
    }
    results.push(childRow)
  }

  res.json({ ok: true, grandTotal: grandTotal.toFixed(4), children: results })
})

// ── Auth routes ───────────────────────────────────────────────

app.post('/auth/google', authModule.googleAuth)
app.post('/auth/signup', authModule.signup)
app.post('/auth/verify', authModule.verify)
app.post('/auth/login',  authModule.login)
app.get('/auth/me',      authModule.requireAuth, authModule.me)

// ── User colony routes ────────────────────────────────────────

// User's colony state
app.get('/me/colony', authModule.requireAuth, (req, res) => {
  const state = userColony.getColonyState(req.user.userId)
  if (!state) {
    const user = db.findById(req.user.userId)
    return res.json({
      status:  user?.colonyStatus || 'awaiting_deposit',
      message: user?.walletAddress
        ? `Deposit at least ${authModule.MIN_DEPOSIT_MATIC} MATIC to ${user.walletAddress} on ${TESTNET ? 'Amoy testnet (chain 80002)' : 'Polygon (chain 137)'} to launch your colony`
        : 'Wallet not yet generated',
      walletAddress: user?.walletAddress || null,
    })
  }
  res.json({ status: 'running', ...state })
})

// Manually trigger deposit check (useful for testing)
app.post('/me/colony/check-deposit', authModule.requireAuth, async (req, res) => {
  const user = db.findById(req.user.userId)
  if (!user) return res.status(404).json({ error: 'User not found' })
  if (userColony.getColony(req.user.userId)) return res.json({ status: 'already_running' })

  if (user.walletAddress) {
    userColony.watchForDeposit(user.id, user.walletAddress)
    res.json({ status: 'watching', walletAddress: user.walletAddress, minMatic: authModule.MIN_DEPOSIT_MATIC })
  } else {
    res.status(400).json({ error: 'No wallet address on account' })
  }
})

// ── Static pages ──────────────────────────────────────────────

app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, '../public/signup.html')))
app.get('/login',  (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')))
app.get('/app',    authModule.requireAuth, (req, res) => res.sendFile(path.join(__dirname, '../public/app.html')))

// ── Start ─────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`GAIA serving ${Object.keys(config.services).length} services on port ${config.port}`)
  userColony.resumeAll()
})

module.exports = app
