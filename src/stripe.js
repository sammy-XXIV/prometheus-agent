require('dotenv').config()
const Stripe   = require('stripe')
const crypto   = require('crypto')
const config   = require('./config')
const services = require('./services')

const STRIPE_ENABLED = !!process.env.STRIPE_SECRET_KEY
if (!STRIPE_ENABLED) console.log('[STRIPE] STRIPE_SECRET_KEY not set — card payments disabled')

const stripe = STRIPE_ENABLED ? Stripe(process.env.STRIPE_SECRET_KEY) : null

// In-memory store: pendingId → {service, input, status, result}
// Each entry lives for 2 hours then is GC'd
const pending = new Map()

function storePending(service, input) {
  const id = crypto.randomUUID()
  pending.set(id, { service, input, status: 'pending', result: null })
  setTimeout(() => pending.delete(id), 2 * 60 * 60 * 1000)
  return id
}

async function createCheckoutSession(serviceKey, input) {
  if (!STRIPE_ENABLED) throw new Error('Card payments not configured — set STRIPE_SECRET_KEY')
  const service = config.services[serviceKey]
  if (!service) throw new Error(`Unknown service: ${serviceKey}`)

  const priceInCents = Math.round(parseFloat(service.price) * 100)
  const baseUrl      = process.env.BASE_URL || 'http://localhost:3000'
  const pendingId    = storePending(serviceKey, input)

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `GAIA — ${service.description}`,
          description: 'AI service · Kite blockchain agent',
        },
        unit_amount: priceInCents,
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${baseUrl}/result/{CHECKOUT_SESSION_ID}`,
    cancel_url:  `${baseUrl}/services`,
    metadata: { pendingId, service: serviceKey },
  })

  return { url: session.url, sessionId: session.id, pendingId }
}

// Called by webhook OR by /result polling — executes the service and caches result
async function fulfil(pendingId) {
  const entry = pending.get(pendingId)
  if (!entry)                    return null
  if (entry.status === 'done')   return entry
  if (entry.status === 'running') {
    // Wait briefly for in-flight execution
    await new Promise(r => setTimeout(r, 3000))
    return pending.get(pendingId)
  }

  entry.status = 'running'
  try {
    const { service: key, input } = entry
    let result

    switch (key) {
      case 'audit':           result = await services.auditContract(input);          break
      case 'whitepaper':      result = await services.summarizeWhitepaper(input);    break
      case 'transaction':     result = await services.explainTransaction(input);     break
      case 'token_sentiment': result = await services.tokenSentiment(input);         break
      case 'trading_signal':  result = await services.tradingSignal(input);          break
      case 'pitch':           result = await services.reviewPitch(input);            break
      case 'business':        result = await services.analyzeBusiness(input);        break
      case 'contract':        result = await services.summarizeContract(input);      break
      case 'competitors':     result = await services.competitorAnalysis(input);     break
      case 'job':             result = await services.writeJobDescription(input);    break
      case 'blog':            result = await services.writeBlogPost(input);          break
      case 'linkedin':        result = await services.writeLinkedIn(input);          break
      case 'email':           result = await services.writeColdEmail(input);         break
      case 'product':         result = await services.writeProductDescription(input);break
      case 'resume':          result = await services.reviewResume(input);           break
      case 'debug':           result = await services.debugCode(input);              break
      case 'explain_code':    result = await services.explainCode(input);            break
      case 'sql':             result = await services.generateSQL(input);            break
      case 'api_docs':        result = await services.writeAPIDocs(input);           break
      case 'tests':           result = await services.generateTests(input);          break
      case 'summarize':       result = await services.summarize(input);              break
      case 'research':        result = await services.summarizeResearch(input);      break
      case 'data':            result = await services.interpretData(input);          break
      case 'news':            result = await services.newsSentiment(input);          break
      case 'sentiment':       result = String((await services.sentiment(input)).sentiment); break
      case 'advice':          result = await services.advice(input);                 break
      default:                result = await services.summarize(input)
    }

    entry.status = 'done'
    entry.result = result
    console.log(`[STRIPE] Fulfilled: ${key} (pendingId=${pendingId})`)
  } catch (e) {
    entry.status = 'error'
    entry.result = `Error: ${e.message}`
    console.log(`[STRIPE] Fulfilment error: ${e.message}`)
  }

  return entry
}

// Verify and process incoming Stripe webhook
async function handleWebhook(rawBody, sig) {
  if (!STRIPE_ENABLED) return { error: 'Stripe not configured' }
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  let event

  if (secret) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret)
    } catch (e) {
      console.log(`[STRIPE] Webhook signature failed: ${e.message}`)
      return { error: e.message }
    }
  } else {
    // No secret set — parse body directly (dev/testing only)
    event = JSON.parse(rawBody)
  }

  if (event.type === 'checkout.session.completed') {
    const session   = event.data.object
    const pendingId = session.metadata?.pendingId
    if (pendingId) {
      console.log(`[STRIPE] Payment confirmed — fulfilling pendingId=${pendingId}`)
      fulfil(pendingId)  // fire-and-forget; result available via /result/:sessionId
    }
  }

  return { received: true }
}

// Retrieve result for a Stripe session (used by success_url redirect)
async function getResultForSession(sessionId) {
  if (!STRIPE_ENABLED) return { status: 'error', error: 'Stripe not configured' }
  let session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (e) {
    return { status: 'error', error: 'Session not found' }
  }

  if (session.payment_status !== 'paid') {
    return { status: 'unpaid' }
  }

  const pendingId = session.metadata?.pendingId
  if (!pendingId) return { status: 'error', error: 'No pending job found' }

  const entry = await fulfil(pendingId)
  if (!entry)  return { status: 'error', error: 'Job expired' }

  return { status: entry.status, result: entry.result, service: entry.service }
}

module.exports = { createCheckoutSession, handleWebhook, getResultForSession }
