const axios = require('axios')
const { exec } = require('child_process')
const services = require('./services')
const getBalance = require('./getBalance')

const PROMETHEUS_URL = process.env.BASE_URL
const CHECK_INTERVAL = 60000 // check every 60 seconds

// Tasks Prometheus can handle based on its services
const CAPABILITIES = [
  'summarize', 'content', 'blog', 'email', 'linkedin',
  'sentiment', 'research', 'data', 'analysis',
  'code', 'debug', 'sql', 'documentation', 'test',
  'audit', 'crypto', 'trading', 'business', 'pitch'
]

// Check AgentDo for available tasks
async function scanAgentDo() {
  try {
    const res = await axios.get('https://agentdo.dev/api/tasks?status=open', {
      timeout: 10000
    })
    const tasks = res.data?.tasks || []
    console.log(`[HUNTER] AgentDo: ${tasks.length} open tasks found`)
    return tasks
  } catch (e) {
    console.log(`[HUNTER] AgentDo scan failed: ${e.message}`)
    return []
  }
}

// Check Kite for available services to consume and resell
async function scanKiteServices() {
  return new Promise((resolve) => {
    exec('kpass service:list --output json', (err, stdout) => {
      try {
        const data = JSON.parse(stdout)
        resolve(data?.services || [])
      } catch {
        resolve([])
      }
    })
  })
}

// Determine if Prometheus can handle a task
function canHandle(task) {
  const taskText = `${task.title} ${task.description} ${task.tags?.join(' ')}`.toLowerCase()
  return CAPABILITIES.some(cap => taskText.includes(cap))
}

// Execute a task autonomously
async function executeTask(task) {
  console.log(`[HUNTER] Attempting task: ${task.title}`)
  
  try {
    let result

    const text = `${task.title} ${task.description}`

    if (text.match(/summar|article|text|read/i)) {
      result = await services.summarize(text)
    } else if (text.match(/blog|post|write|content/i)) {
      result = await services.writeBlogPost(task.description)
    } else if (text.match(/email|outreach|cold/i)) {
      result = await services.writeColdEmail(task.description)
    } else if (text.match(/sentiment|analyze|opinion/i)) {
      result = await services.sentiment(task.description)
    } else if (text.match(/code|debug|fix|bug/i)) {
      result = await services.debugCode(task.description)
    } else if (text.match(/sql|query|database/i)) {
      result = await services.generateSQL(task.description)
    } else if (text.match(/research|paper|study/i)) {
      result = await services.summarizeResearch(task.description)
    } else if (text.match(/data|interpret|pattern/i)) {
      result = await services.interpretData(task.description)
    } else if (text.match(/audit|contract|solidity/i)) {
      result = await services.auditContract(task.description)
    } else if (text.match(/advice|suggest|recommend/i)) {
      result = await services.advice(task.description)
    } else {
      result = await services.summarize(task.description)
    }

    console.log(`[HUNTER] Task completed: ${task.title}`)
    return { success: true, result }

  } catch (e) {
    console.log(`[HUNTER] Task failed: ${e.message}`)
    return { success: false, error: e.message }
  }
}

// Submit completed task result
async function submitResult(task, result) {
  try {
    await axios.post(`https://agentdo.dev/api/tasks/${task.id}/submit`, {
      agentId: 'prometheus',
      agentUrl: PROMETHEUS_URL,
      result: result.result,
      wallet: process.env.WALLET_ADDRESS || '0x9BeD7776262076B016798d6Ee74Dea3a6B1Ac662'
    }, { timeout: 10000 })
    console.log(`[HUNTER] Result submitted for task: ${task.title}`)
  } catch (e) {
    console.log(`[HUNTER] Submission failed: ${e.message}`)
  }
}

// Main hunting loop
async function hunt() {
  const balance = await getBalance()
  console.log(`[HUNTER] Scanning for work... Balance: $${balance.toFixed(4)}`)

  // Scan all sources
  const agentDoTasks = await scanAgentDo()

  // Filter tasks Prometheus can handle
  const handleable = agentDoTasks.filter(canHandle)
  console.log(`[HUNTER] ${handleable.length} tasks Prometheus can handle`)

  // Execute up to 3 tasks per cycle
  const toExecute = handleable.slice(0, 3)
  
  for (const task of toExecute) {
    const result = await executeTask(task)
    if (result.success) {
      await submitResult(task, result)
    }
  }
}

// Start hunting
function startHunter() {
  console.log('[HUNTER] Prometheus job hunter activated')
  console.log(`[HUNTER] Scanning every ${CHECK_INTERVAL/1000} seconds`)
  
  hunt() // immediate first scan
  setInterval(hunt, CHECK_INTERVAL)
}

module.exports = startHunter

// Claw Earn integration
const runClawEarn = require('./clawEarn')

async function huntClawEarn() {
  await runClawEarn()
}

// Run Claw Earn every 2 minutes
setInterval(huntClawEarn, 120000)
huntClawEarn()
