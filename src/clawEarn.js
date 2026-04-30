require('dotenv').config()
const axios = require('axios')
const { ethers } = require('ethers')
const services = require('./services')

const BASE_RPC = 'https://mainnet.base.org'
const CLAW_API = 'https://aiagentstore.ai'
const provider = new ethers.JsonRpcProvider(BASE_RPC)
const wallet = new ethers.Wallet(process.env.PROMETHEUS_BASE_PRIVATE_KEY, provider)

let sessionToken = null
let sessionWallet = null

async function getSession() {
  try {
    // Step 1: Get challenge
    const challengeRes = await axios.post(`${CLAW_API}/clawAgentSessionChallenge`, {
      walletAddress: wallet.address
    })

    const { message } = challengeRes.data
    if (!message) {
      console.log('[CLAW] No message in challenge response:', challengeRes.data)
      return null
    }

    // Step 2: Sign message
    const signature = await wallet.signMessage(message)

    // Step 3: Exchange for session token
    const sessionRes = await axios.post(`${CLAW_API}/clawAgentSession`, {
      walletAddress: wallet.address,
      signature,
      message
    })

    sessionToken = sessionRes.data.agentSessionToken
    sessionWallet = wallet.address
    console.log('[CLAW] Session established for:', wallet.address)
    return sessionToken
  } catch (e) {
    console.log('[CLAW] Session error:', JSON.stringify(e.response?.data) || e.message)
    return null
  }
}

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

function canHandle(bounty) {
  const text = `${bounty.title} ${bounty.description}`.toLowerCase()
  const skills = [
    'summar', 'write', 'content', 'blog', 'email', 'research',
    'analyz', 'sentiment', 'code', 'debug', 'sql', 'data',
    'audit', 'crypto', 'advice', 'review', 'generat', 'explain',
    'translate', 'report', 'draft', 'document'
  ]
  return skills.some(s => text.includes(s))
}

async function executeTask(bounty) {
  const text = `${bounty.title} ${bounty.description}`
  try {
    if (text.match(/summar|article|text/i)) return await services.summarize(text)
    if (text.match(/blog|post|write|content/i)) return await services.writeBlogPost(bounty.description)
    if (text.match(/email|outreach/i)) return await services.writeColdEmail(bounty.description)
    if (text.match(/sentiment|analyz/i)) return await services.newsSentiment(bounty.description)
    if (text.match(/code|debug|fix/i)) return await services.debugCode(bounty.description)
    if (text.match(/sql|query/i)) return await services.generateSQL(bounty.description)
    if (text.match(/research|paper/i)) return await services.summarizeResearch(bounty.description)
    if (text.match(/data|interpret/i)) return await services.interpretData(bounty.description)
    if (text.match(/audit|contract/i)) return await services.auditContract(bounty.description)
    if (text.match(/translate/i)) return await services.advice(`Translate this: ${bounty.description}`)
    if (text.match(/report|document/i)) return await services.writeBlogPost(bounty.description)
    return await services.advice(bounty.description)
  } catch (e) {
    console.log('[CLAW] Execution failed:', e.message)
    return null
  }
}

async function stakeBounty(bountyId, contractAddress) {
  try {
    // Prepare stake
    const prepareRes = await axios.post(`${CLAW_API}/agentStakeAndConfirm`, {
      bountyId,
      contractAddress,
      step: 'prepare'
    }, {
      headers: { 'x-agent-session-token': sessionToken }
    })

    const { transaction } = prepareRes.data
    if (!transaction) {
      console.log('[CLAW] No transaction in stake prepare:', prepareRes.data)
      return null
    }

    // Sign and send transaction
    const tx = await wallet.sendTransaction(transaction)
    const receipt = await tx.wait()

    // Confirm stake
    const confirmRes = await axios.post(`${CLAW_API}/agentStakeAndConfirm`, {
      bountyId,
      contractAddress,
      txHash: receipt.hash,
      step: 'confirm'
    }, {
      headers: { 'x-agent-session-token': sessionToken }
    })

    console.log(`[CLAW] Staked bounty: ${bountyId}`)
    return confirmRes.data
  } catch (e) {
    console.log('[CLAW] Stake failed:', JSON.stringify(e.response?.data) || e.message)
    return null
  }
}

async function submitWork(bountyId, contractAddress, result) {
  try {
    const { keccak256, toUtf8Bytes } = ethers
    const text = result.trim()
    const links = []
    const stable = JSON.stringify({ links, text })
    const submissionHash = keccak256(toUtf8Bytes(stable))

    // Prepare submission
    const prepareRes = await axios.post(`${CLAW_API}/agentSubmitWork`, {
      bountyId,
      contractAddress,
      submission: text,
      submissionHash,
      step: 'prepare'
    }, {
      headers: { 'x-agent-session-token': sessionToken }
    })

    const { transaction } = prepareRes.data
    if (!transaction) {
      console.log('[CLAW] No transaction in submit prepare:', prepareRes.data)
      return null
    }

    // Sign and send
    const tx = await wallet.sendTransaction(transaction)
    const receipt = await tx.wait()

    // Confirm submission
    const confirmRes = await axios.post(`${CLAW_API}/agentSubmitWork`, {
      bountyId,
      contractAddress,
      submission: text,
      submissionHash,
      txHash: receipt.hash,
      step: 'confirm'
    }, {
      headers: { 'x-agent-session-token': sessionToken }
    })

    console.log(`[CLAW] Work submitted: ${bountyId}`)
    return confirmRes.data
  } catch (e) {
    console.log('[CLAW] Submit failed:', JSON.stringify(e.response?.data) || e.message)
    return null
  }
}

async function runClawEarn() {
  console.log('[CLAW] Scanning Claw Earn...')
  console.log(`[CLAW] Base wallet: ${wallet.address}`)

  if (!sessionToken) await getSession()
  if (!sessionToken) {
    console.log('[CLAW] No session - skipping this cycle')
    return
  }

  const bounties = await scanBounties()
  const handleable = bounties.filter(canHandle)
  console.log(`[CLAW] ${handleable.length} bounties Prometheus can handle`)

  for (const bounty of handleable.slice(0, 2)) {
    console.log(`[CLAW] Attempting: ${bounty.title} - $${bounty.amount} USDC`)
    const result = await executeTask(bounty)
    if (!result) continue
    const staked = await stakeBounty(bounty.id, bounty.contractAddress)
    if (!staked) continue
    await submitWork(bounty.id, bounty.contractAddress, result)
  }
}

module.exports = runClawEarn
