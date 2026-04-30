const express = require('express')
const config = require('./config')
const app = express()
app.use(express.json())

app.use((req, res, next) => {
  const payment = req.headers['x-payment']
  if (!payment) {
    return res.status(402).json({
      error: 'Payment required',
      accepts: [{
        scheme: 'gokite-aa',
        network: 'kite-mainnet',
        maxAmountRequired: '100000000000000000',
        resource: `http://localhost:${config.port}${req.path}`,
        description: 'Prometheus AI Service',
        payTo: config.walletAddress,
        asset: '0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e',
        maxTimeoutSeconds: 300,
        merchantName: 'Prometheus'
      }],
      x402Version: 1
    })
  }
  next()
})

app.get('/services', (req, res) => {
  res.json(config.services)
})

app.listen(config.port, () => {
  console.log(`Prometheus serving on port ${config.port}`)
})

module.exports = app
