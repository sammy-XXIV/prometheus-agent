require('dotenv').config()
const axios = require('axios')
const services = require('./services')

const ATREST_API = 'https://atrest.ai/api'
const SESSION = process.env.ATREST_SESSION?.trim()
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

let agentId = process.env.ATREST_AGENT_ID?.trim() || null
let apiKey = process.env.ATREST_API_KEY?.trim() || null

function authHeaders() {
  if (apiKey && agentId) {
    return { 'X-Api-Key': apiKey, 'X-Agent-Id': agentId }
  }
  if (SESSION) {
    return { Cookie: `atrest_session=${SESSION}` }
  }
  return {}
}

async function registerAgent() {
  if (!SESSION && !(apiKey && agentId)) {
    console.log('[ATREST] No ATREST_SESSION or ATREST_API_KEY set — skipping registration')
    return false
  }
  if (agentId) {
    console.log(`[ATREST] Already registered: ${agentId}`)
    return true
  }
  try {
    const res = await axios.post(`${ATREST_API}/agents`, {
      name: 'Prometheus',
      endpoint_url: `${BASE_URL}/webhook/atrest`,
      capabilities: [
        'summarize', 'blog', 'email', 'linkedin', 'content',
        'sentiment', 'research', 'data', 'code', 'debug',
        'sql', 'audit', 'crypto', 'trading', 'business', 'advice'
      ]
    }, {
      headers: { 'Content-Type': 'application/json', ...authHeaders() }
    })
    agentId = res.data?.agent_id || res.data?.id
    apiKey = res.data?.api_key || apiKey
    console.log(`[ATREST] Registered! Agent ID: ${agentId}`)
    return true
  } catch (e) {
    console.log('[ATREST] Registration failed:', JSON.stringify(e.response?.data) || e.message)
    return false
  }
}

async function executeTask(task) {
  const text = `${task.title || ''} ${task.description || ''}`
  try {
    if (text.match(/summar|article|text/i))       return await services.summarize(text)
    if (text.match(/blog|post|write|content/i))   return await services.writeBlogPost(task.description)
    if (text.match(/email|outreach/i))            return await services.writeColdEmail(task.description)
    if (text.match(/linkedin/i))                  return await services.writeLinkedIn(task.description)
    if (text.match(/sentiment|analyz/i))          return await services.newsSentiment(task.description)
    if (text.match(/code|debug|fix/i))            return await services.debugCode(task.description)
    if (text.match(/sql|query/i))                 return await services.generateSQL(task.description)
    if (text.match(/research|paper/i))            return await services.summarizeResearch(task.description)
    if (text.match(/data|interpret/i))            return await services.interpretData(task.description)
    if (text.match(/audit|contract/i))            return await services.auditContract(task.description)
    if (text.match(/trading|signal/i))            return await services.tradingSignal(task.description)
    if (text.match(/business|plan/i))             return await services.analyzeBusiness(task.description)
    return await services.advice(task.description)
  } catch (e) {
    console.log('[ATREST] Task execution failed:', e.message)
    return null
  }
}

async function handleWebhook(task) {
  console.log(`[ATREST] Task received: ${task.title} ($${task.budget_usdc || '?'} USDC)`)
  const result = await executeTask(task)
  if (!result) return null

  if (task.callback_url) {
    try {
      await axios.post(task.callback_url, { result, agent_id: agentId }, {
        headers: authHeaders()
      })
      console.log(`[ATREST] Result submitted via callback for: ${task.title}`)
    } catch (e) {
      console.log('[ATREST] Callback submission failed:', e.message)
    }
  }

  if (task.task_id || task.id) {
    const taskId = task.task_id || task.id
    try {
      await axios.post(`${ATREST_API}/tasks/${taskId}/submit`, { result }, {
        headers: { 'Content-Type': 'application/json', ...authHeaders() }
      })
      console.log(`[ATREST] Result submitted for task: ${taskId}`)
    } catch (e) {
      console.log('[ATREST] Task submit failed:', e.message)
    }
  }

  return result
}

async function startAtrest() {
  console.log('[ATREST] Initializing Atrest.ai integration...')
  await registerAgent()
}

module.exports = { startAtrest, handleWebhook }
