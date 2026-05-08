require('dotenv').config()
const axios = require('axios')
const services = require('./services')

const ATREST_API = 'https://atrest.ai/api'
const SESSION = process.env.ATREST_SESSION?.trim()
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

let agentId = process.env.ATREST_AGENT_ID?.trim() || null
let apiKey = process.env.ATREST_API_KEY?.trim() || null

const ATREST_CAPABILITIES = [
  'code_review', 'market_research', 'workflow_automation', 'fact_checking',
  'citation_gathering', 'competitive_analysis', 'document_formatting', 'email_drafting',
  'research', 'summarization', 'translation', 'copywriting', 'content_creation',
  'report_generation', 'trend_forecasting', 'anomaly_detection', 'dashboard_building',
  'data_analysis', 'data_cleaning', 'bug_fixing'
]

function authHeaders(key = apiKey, id = agentId) {
  if (key && id) return { 'X-Api-Key': key, 'X-Agent-Id': id }
  if (SESSION)   return { Cookie: `atrest_session=${SESSION}` }
  return {}
}

async function sendHeartbeat(key = apiKey, id = agentId) {
  if (!key || !id) return
  try {
    await axios.post(`${ATREST_API}/agents/${id}/heartbeat`, {}, {
      headers: { 'Content-Type': 'application/json', ...authHeaders(key, id) }
    })
    console.log(`[ATREST] Heartbeat sent for ${id}`)
  } catch (e) {
    console.log('[ATREST] Heartbeat failed:', e.response?.data || e.message)
  }
}

async function patchAgent(id, key, fields) {
  try {
    const res = await axios.patch(`${ATREST_API}/agents/${id}`, fields, {
      headers: { 'Content-Type': 'application/json', ...authHeaders(key, id) }
    })
    return res.data?.data
  } catch (e) {
    console.log('[ATREST] Patch failed:', e.response?.data || e.message)
    return null
  }
}

const MOTHER_WALLET = '0x7B60394f9FC96eD4d7ba7BE396E5315513fb6fA4'

async function registerAgent() {
  if (!SESSION && !(apiKey && agentId)) {
    console.log('[ATREST] No ATREST_SESSION or ATREST_API_KEY set — skipping registration')
    return false
  }
  if (agentId) {
    console.log(`[ATREST] Already registered: ${agentId}`)
    await sendHeartbeat()
    return true
  }
  try {
    const res = await axios.post(`${ATREST_API}/agents`, {
      name: 'GAIA',
      endpoint_url: `${BASE_URL}/webhook/atrest`,
      capabilities: ATREST_CAPABILITIES,
      metadata: { kite_wallet: MOTHER_WALLET, chain: 'polygon' }
    }, {
      headers: { 'Content-Type': 'application/json', ...authHeaders() }
    })
    agentId = res.data?.data?.id || res.data?.agent_id || res.data?.id
    apiKey = res.data?.data?.api_key || res.data?.api_key || apiKey
    console.log(`[ATREST] Registered! Agent ID: ${agentId}`)
    await sendHeartbeat()
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

async function handleWebhook(task, key = apiKey, id = agentId) {
  console.log(`[ATREST] Task received: ${task.title} ($${task.budget_usdc || '?'} USDC)`)
  const result = await executeTask(task)
  if (!result) return null

  if (task.callback_url) {
    try {
      await axios.post(task.callback_url, { result, agent_id: id }, {
        headers: authHeaders(key, id)
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
        headers: { 'Content-Type': 'application/json', ...authHeaders(key, id) }
      })
      console.log(`[ATREST] Result submitted for task: ${taskId}`)
    } catch (e) {
      console.log('[ATREST] Task submit failed:', e.message)
    }
  }

  return result
}

async function registerUserAgent(userId, email, baseUrl) {
  const masterKey = process.env.ATREST_API_KEY?.trim()
  if (!masterKey) {
    console.log('[ATREST] No ATREST_API_KEY — cannot register user agent')
    return null
  }
  try {
    const res = await axios.post(`${ATREST_API}/agents`, {
      name: `GAIA-${email.split('@')[0]}`,
      endpoint_url: `${baseUrl}/webhook/atrest/user/${userId}`,
      capabilities: ATREST_CAPABILITIES,
      metadata: { kite_wallet: MOTHER_WALLET, chain: 'polygon', user_id: userId }
    }, {
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': masterKey }
    })
    const newAgentId = res.data?.data?.id || res.data?.agent_id || res.data?.id
    const newApiKey  = res.data?.data?.api_key || res.data?.api_key
    console.log(`[ATREST] Registered user agent for ${email}: ${newAgentId}`)

    // Immediately bring online
    if (newAgentId && newApiKey) await sendHeartbeat(newApiKey, newAgentId)

    return { agentId: newAgentId, apiKey: newApiKey }
  } catch (e) {
    console.log(`[ATREST] User agent registration failed for ${email}:`, JSON.stringify(e.response?.data) || e.message)
    return null
  }
}

async function startAtrest() {
  console.log('[ATREST] Initializing Atrest.ai integration...')
  await registerAgent()
  // Send heartbeat every 4 minutes to stay online
  setInterval(() => sendHeartbeat(), 4 * 60 * 1000)
}

module.exports = { startAtrest, handleWebhook, registerUserAgent, sendHeartbeat, patchAgent }
