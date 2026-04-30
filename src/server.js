require('dotenv').config()
const express = require('express')
const config = require('./config')
const services = require('./services')
const verifyPayment = require('./verify')

const app = express()
app.use(express.json())

// Real on-chain payment verification
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
          maxAmountRequired: ethers_units(service.price),
          resource: `${process.env.BASE_URL || 'http://localhost:3000'}${req.path}`,
          description: service.description,
          payTo: config.walletAddress,
          asset: '0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e',
          maxTimeoutSeconds: 300,
          merchantName: 'Prometheus'
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

function ethers_units(price) {
  return String(Math.floor(parseFloat(price) * 1e6))
}

// Free endpoints
// root replaced
app.get('/dashboard', (req, res) => res.sendFile(__dirname + '/../src/dashboard.html'))
app.get('/', (req, res) => {
  res.json({
    name: 'Prometheus',
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
  console.log(`Prometheus serving ${Object.keys(config.services).length} services on port ${config.port}`)
})

module.exports = app
