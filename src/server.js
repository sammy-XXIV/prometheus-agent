require('dotenv').config()
const express = require('express')
const path = require('path')
const config = require('./config')
const services = require('./services')
const verifyPayment = require('./verify')
const { handleWebhook: atrestWebhook } = require('./atrest')
const { createCheckoutSession, handleWebhook: stripeWebhook, getResultForSession } = require('./stripe')

const app = express()
const cors = require('cors')
app.use(cors())

// Stripe webhook must receive the raw body before express.json() parses it
app.use('/webhook/stripe', express.raw({ type: 'application/json' }))
app.use(express.json())

function paymentWall(serviceKey) {
  return async (req, res, next) => {
    const txHash = req.headers['x-payment-tx']
    const service = config.services[serviceKey]

    if (!txHash) {
      return res.status(402).json({
        error: 'Payment required',
        accepts: [{
          scheme: 'gokite-aa',
          network: 'kite-mainnet',
          maxAmountRequired: String(Math.floor(parseFloat(service.price) * 1e6)),
          resource: `${process.env.BASE_URL || 'http://localhost:3000'}${req.path}`,
          description: service.description,
          payTo: config.walletAddress,
          asset: '0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e',
          maxTimeoutSeconds: 300,
          merchantName: 'GAIA'
        }],
        x402Version: 1
      })
    }

    const result = await verifyPayment(txHash, service.price)
    if (!result.valid) {
      return res.status(402).json({ error: 'Payment invalid', reason: result.reason })
    }

    req.payment = result
    next()
  }
}

// Atrest.ai task webhook
app.post('/webhook/atrest', async (req, res) => {
  try {
    const result = await atrestWebhook(req.body)
    if (!result) return res.status(422).json({ error: 'Could not process task' })
    res.json({ result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Stripe webhook — raw body required (middleware set above)
app.post('/webhook/stripe', async (req, res) => {
  try {
    const result = await stripeWebhook(req.body, req.headers['stripe-signature'])
    if (result.error) return res.status(400).json(result)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Card payment — create Stripe Checkout session
// POST /pay/card  { service: 'audit', input: '...' }
app.post('/pay/card', async (req, res) => {
  try {
    const { service, input } = req.body
    if (!service || !input) return res.status(400).json({ error: 'service and input required' })
    if (!config.services[service]) return res.status(404).json({ error: 'Unknown service' })
    const session = await createCheckoutSession(service, input)
    res.json(session)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Result page — shown after Stripe success_url redirect
app.get('/result/:sessionId', async (req, res) => {
  try {
    const data = await getResultForSession(req.params.sessionId)

    if (data.status === 'unpaid') {
      return res.status(402).send('<h2>Payment not confirmed yet. Please wait a moment and refresh.</h2>')
    }
    if (data.status === 'running' || data.status === 'pending') {
      return res.send('<h2>Processing your request... refresh in a few seconds.</h2>')
    }
    if (data.status === 'error') {
      return res.status(500).send(`<h2>Error: ${data.error || data.result}</h2>`)
    }

    const escaped = String(data.result).replace(/</g, '&lt;').replace(/>/g, '&gt;')
    res.send(
      `<!DOCTYPE html><html><head><title>GAIA Result</title>` +
      `<style>body{font-family:monospace;max-width:800px;margin:40px auto;padding:0 20px;background:#0a0a0a;color:#e0e0e0}` +
      `h2{color:#7fff7f}pre{white-space:pre-wrap;background:#111;padding:20px;border-radius:6px;border:1px solid #333}` +
      `small{color:#666}</style></head><body>` +
      `<h2>GAIA — ${config.services[data.service]?.description || data.service}</h2>` +
      `<pre>${escaped}</pre>` +
      `<small><a href="/services" style="color:#7fff7f">← Back to services</a></small>` +
      `</body></html>`
    )
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

app.listen(config.port, () => {
  console.log(`GAIA serving ${Object.keys(config.services).length} services on port ${config.port}`)
})

module.exports = app
