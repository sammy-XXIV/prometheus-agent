require('dotenv').config()
const axios = require('axios')
const { ethers } = require('ethers')
const services = require('./services')

const BASE_RPC = 'https://mainnet.base.org'
const CLAW_API = 'https://aiagentstore.ai'
const provider = new ethers.JsonRpcProvider(BASE_RPC)
const wallet = new ethers.Wallet(process.env.PROMETHEUS_BASE_PRIVATE_KEY, provider)

let sessionToken = null

// Step 1: Get session token
async function getSession() {
  try {
    // Get challenge
    const challenge = await axios.post(`${CLAW_API}/clawAgentSessionChallenge`, {
      walletAddress: wallet.address
    })
    
    const message = challenge.data.message
    const signature = await wallet.signMessage(message)
    
    // Exchange for session
    const session = await axios.post(`${CLAW_API}/clawAgentSession`, {
      walletAddress: wallet.address,
      signature,
      message
    })
    
    sessionToken = session.data.agentSessionToken
    console.log('[CLAW] Session established')
    return sessionToken
  } catch (e) {
    console.log('[CLAW] Session failed:', e.message)
    return null
  }
}

// Step 2: Scan open bounties
async function scanBounties() {
  try {
    const res = await axios.get(`${CLAW_API}/claw/open`)
    const bounties = res.data?.bounties || []
    console.log(`[CLAW] ${bounties.length} open bounties found`)
    return bounties
  } catch (e) {
    console.log('[CLAW] Scan failed:', e.message)
    return []
  }
}

// Step 3: Check if Prometheus can handle the bounty
function canHandle(bounty) {
  const text = `${bounty.title} ${bounty.description}`.toLowerCase()
  const skills = [
    'summar', 'write', 'content', 'blog', 'email', 'research',
    'analyz', 'sentiment', 'code', 'debug', 'sql', 'data',
    'audit', 'crypto', 'advice', 'review', 'generat', 'explain'
  ]
  return skills.some(s => text.includes(s))
}

// Step 4: Execute the task
async function executeTask(bounty) {
  const text = `${bounty.title} ${bounty.description}`
  
  try {
    let result
    if (text.match(/summar|article|text/i)) {
      result = await services.summarize(text)
    } else if (text.match(/blog|post|write|content/i)) {
      result = await services.writeBlogPost(bounty.description)
    } else if (text.match(/email|outreach/i)) {
      result = await services.writeColdEmail(bounty.description)
    } else if (text.match(/sentiment|analyz/i)) {
      result = await services.newsSentiment(bounty.description)
    } else if (text.match(/code|debug|fix/i)) {
      result = await services.debugCode(bounty.description)
    } else if (text.match(/sql|query/i)) {
      result = await services.generateSQL(bounty.description)
    } else if (text.match(/research|paper/i)) {
      result = await services.summarizeResearch(bounty.description)
    } else if (text.match(/data|interpret/i)) {
      result = await services.interpretData(bounty.description)
    } else if (text.match(/audit|contract/i)) {
      result = await services.auditContract(bounty.description)
    } else {
      result = await services.advice(bounty.description)
    }
    return result
  } catch (e) {
    console.log('[CLAW] Task execution failed:', e.message)
    return null
  }
}

// Step 5: Stake and claim bounty
async function stakeBounty(bountyId, contractAddress) {
  try {
    const res = await axios.post(`${CLAW_API}/agentStakeAndConfirm`, {
      bountyId,
      contractAddress
    }, {
      headers: { 'x-agent-session-token': sessionToken }
    })
    console.log(`[CLAW] Staked bounty: ${bountyId}`)
    return res.data
  } catch (e) {
    console.log('[CLAW] Stake failed:', e.message)
    return null
  }
}

// Step 6: Submit work
async function submitWork(bountyId, contractAddress, result) {
  try {
    const { keccak256, toUtf8Bytes } = ethers
    const payload = { links: [], text: result.trim() }
    const stable = JSON.stringify({ links: payload.links, text: payload.text })
    const submissionHash = keccak256(toUtf8Bytes(stable))

    const res = await axios.post(`${CLAW_API}/agentSubmitWork`, {
      bountyId,
      contractAddress,
      submission: result,
      submissionHash
    }, {
      headers: { 'x-agent-session-token': sessionToken }
    })
    console.log(`[CLAW] Work submitted for bounty: ${bountyId}`)
    return res.data
  } catch (e) {
    console.log('[CLAW] Submit failed:', e.message)
    return null
  }
}

// Main Claw Earn loop
async function runClawEarn() {
  console.log('[CLAW] Prometheus Claw Earn hunter starting...')
  console.log(`[CLAW] Base wallet: ${wallet.address}`)

  // Get session
  await getSession()
  if (!sessionToken) return

  // Scan bounties
  const bounties = await scanBounties()
  const handleable = bounties.filter(canHandle)
  console.log(`[CLAW] ${handleable.length} bounties Prometheus can handle`)

  // Take first available bounty
  for (const bounty of handleable.slice(0, 2)) {
    console.log(`[CLAW] Attempting: ${bounty.title} - $${bounty.amount} USDC`)
    
    // Execute task first
    const result = await executeTask(bounty)
    if (!result) continue

    // Stake to claim
    const staked = await stakeBounty(bounty.id, bounty.contractAddress)
    if (!staked) continue

    // Submit work
    await submitWork(bounty.id, bounty.contractAddress, result)
    console.log(`[CLAW] Completed bounty: ${bounty.title}`)
  }
}

// Export for use in hunter
module.exports = runClawEarn
