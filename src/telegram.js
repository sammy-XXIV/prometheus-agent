require('dotenv').config()
const TelegramBot = require('node-telegram-bot-api')
const services = require('./services')
const config = require('./config')

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true })

const PAYMENT_ADDRESS = config.walletAddress

function serviceMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Crypto', callback_data: 'cat_crypto' }, { text: 'Business', callback_data: 'cat_business' }],
        [{ text: 'Content', callback_data: 'cat_content' }, { text: 'Tech', callback_data: 'cat_tech' }],
        [{ text: 'Research', callback_data: 'cat_research' }]
      ]
    }
  }
}

const categories = {
  cat_crypto: {
    name: 'Crypto Services',
    services: [
      { key: 'audit', label: 'Smart Contract Audit - $2.00' },
      { key: 'whitepaper', label: 'Whitepaper Summary - $0.50' },
      { key: 'transaction', label: 'Transaction Explainer - $0.20' },
      { key: 'token_sentiment', label: 'Token Sentiment - $0.30' },
      { key: 'trading_signal', label: 'Trading Signal - $1.00' }
    ]
  },
  cat_business: {
    name: 'Business Services',
    services: [
      { key: 'pitch', label: 'Pitch Deck Review - $1.50' },
      { key: 'business', label: 'Business Plan Analysis - $1.00' },
      { key: 'contract', label: 'Contract Summary - $0.75' },
      { key: 'competitors', label: 'Competitor Analysis - $1.00' },
      { key: 'job', label: 'Job Description - $0.50' }
    ]
  },
  cat_content: {
    name: 'Content Services',
    services: [
      { key: 'blog', label: 'Blog Post - $0.50' },
      { key: 'linkedin', label: 'LinkedIn Post - $0.30' },
      { key: 'email', label: 'Cold Email - $0.25' },
      { key: 'product', label: 'Product Description - $0.25' },
      { key: 'resume', label: 'Resume Review - $0.75' }
    ]
  },
  cat_tech: {
    name: 'Tech Services',
    services: [
      { key: 'debug', label: 'Debug Code - $0.50' },
      { key: 'explain_code', label: 'Explain Code - $0.30' },
      { key: 'sql', label: 'SQL Generator - $0.25' },
      { key: 'api_docs', label: 'API Docs - $0.75' },
      { key: 'tests', label: 'Unit Tests - $0.50' }
    ]
  },
  cat_research: {
    name: 'Research Services',
    services: [
      { key: 'summarize', label: 'Summarize Text - $0.10' },
      { key: 'research', label: 'Research Paper - $0.50' },
      { key: 'data', label: 'Data Analysis - $0.40' },
      { key: 'news', label: 'News Sentiment - $0.25' },
      { key: 'sentiment', label: 'Sentiment Analysis - $0.05' },
      { key: 'advice', label: 'AI Advice - $0.20' }
    ]
  }
}

// Track user state
const userState = {}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id
  bot.sendMessage(chatId,
    `PROMETHEUS - Autonomous AI Agent\n\n` +
    `26 professional services powered by AI.\n` +
    `Pay in USDC on Kite chain.\n\n` +
    `Wallet: ${PAYMENT_ADDRESS}\n\n` +
    `Select a category to get started:`,
    serviceMenu()
  )
})

bot.onText(/\/services/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Select a category:', serviceMenu())
})

bot.onText(/\/balance/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `Prometheus Wallet: ${PAYMENT_ADDRESS}\n` +
    `Explorer: https://kitescan.ai/address/${PAYMENT_ADDRESS}`
  )
})

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `Commands:\n` +
    `/start - Welcome\n` +
    `/services - Browse all services\n` +
    `/balance - View Prometheus wallet\n` +
    `/help - This menu\n\n` +
    `How it works:\n` +
    `1. Pick a service\n` +
    `2. Send USDC to Prometheus wallet on Kite chain\n` +
    `3. Send tx hash + your input\n` +
    `4. Get your result`
  )
})

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id
  const data = query.data

  // Category selected
  if (categories[data]) {
    const cat = categories[data]
    const keyboard = cat.services.map(s => ([{
      text: s.label,
      callback_data: `service_${s.key}`
    }]))
    keyboard.push([{ text: 'Back', callback_data: 'back' }])

    bot.editMessageText(cat.name, {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: { inline_keyboard: keyboard }
    })
  }

  // Back button
  if (data === 'back') {
    bot.editMessageText('Select a category:', {
      chat_id: chatId,
      message_id: query.message.message_id,
      ...serviceMenu()
    })
  }

  // Service selected
  if (data.startsWith('service_')) {
    const serviceKey = data.replace('service_', '')
    const service = config.services[serviceKey]
    if (!service) return

    userState[chatId] = { service: serviceKey, step: 'awaiting_payment' }

    bot.sendMessage(chatId,
      `Service: ${service.description}\n` +
      `Price: $${service.price} USDC\n\n` +
      `To pay:\n` +
      `1. Send $${service.price} USDC to:\n` +
      `${PAYMENT_ADDRESS}\n` +
      `(Kite network only)\n\n` +
      `2. Reply with your tx hash and input in this format:\n` +
      `TXHASH | your input here`
    )
  }

  bot.answerCallbackQuery(query.id)
})

// Handle payment + input
bot.on('message', async (msg) => {
  const chatId = msg.chat.id
  const text = msg.text
  if (!text || text.startsWith('/')) return

  const state = userState[chatId]
  if (!state || state.step !== 'awaiting_payment') return

  if (!text.includes('|')) {
    bot.sendMessage(chatId, 'Please use the format: TXHASH | your input')
    return
  }

  const [txHash, ...inputParts] = text.split('|')
  const input = inputParts.join('|').trim()
  const tx = txHash.trim()

  bot.sendMessage(chatId, 'Verifying payment and processing...')

  try {
    const verifyPayment = require('./verify')
    const service = config.services[state.service]
    const verification = await verifyPayment(tx, service.price)

    if (!verification.valid) {
      bot.sendMessage(chatId, `Payment invalid: ${verification.reason}`)
      return
    }

    // Process the service
    let result
    switch(state.service) {
      case 'audit':           result = await services.auditContract(input); break
      case 'whitepaper':      result = await services.summarizeWhitepaper(input); break
      case 'transaction':     result = await services.explainTransaction(input); break
      case 'token_sentiment': result = await services.tokenSentiment(input); break
      case 'trading_signal':  result = await services.tradingSignal(input); break
      case 'pitch':           result = await services.reviewPitch(input); break
      case 'business':        result = await services.analyzeBusiness(input); break
      case 'contract':        result = await services.summarizeContract(input); break
      case 'competitors':     result = await services.competitorAnalysis(input); break
      case 'job':             result = await services.writeJobDescription(input); break
      case 'blog':            result = await services.writeBlogPost(input); break
      case 'linkedin':        result = await services.writeLinkedIn(input); break
      case 'email':           result = await services.writeColdEmail(input); break
      case 'product':         result = await services.writeProductDescription(input); break
      case 'resume':          result = await services.reviewResume(input); break
      case 'debug':           result = await services.debugCode(input); break
      case 'explain_code':    result = await services.explainCode(input); break
      case 'sql':             result = await services.generateSQL(input); break
      case 'api_docs':        result = await services.writeAPIDocs(input); break
      case 'tests':           result = await services.generateTests(input); break
      case 'summarize':       result = await services.summarize(input); break
      case 'research':        result = await services.summarizeResearch(input); break
      case 'data':            result = await services.interpretData(input); break
      case 'news':            result = await services.newsSentiment(input); break
      case 'sentiment':       result = (await services.sentiment(input)).sentiment; break
      case 'advice':          result = await services.advice(input); break
      default: result = 'Service not found'
    }

    // Clear state
    delete userState[chatId]

    // Send result in chunks if too long
    const chunks = result.match(/.{1,4000}/gs) || [result]
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk)
    }

    bot.sendMessage(chatId, 'Done. Use /services for another request.')

  } catch(e) {
    bot.sendMessage(chatId, `Error: ${e.message}`)
  }
})

console.log('Prometheus Telegram bot running...')

module.exports = bot
