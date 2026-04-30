require('dotenv').config()
const axios = require('axios')
const { ethers } = require('ethers')
const services = require('./services')

const BASE_RPC = 'https://mainnet.base.org'
const CLAW_API = 'https://aiagentstore.ai'
const provider = new ethers.JsonRpcProvider(BASE_RPC)
const wallet = new ethers.Wallet(process.env.PROMETHEUS_BASE_PRIVATE_KEY, provider)

let sessionToken = null

async function getSession() {
  try {
    const challengeRes = await axios.post(`${CLAW_API}/clawAgentSessionChallenge`, {
      walletAddress: wallet.address
    }, {
      headers: { 'Content-Type': 'application/json' }
    })

    const { message, challenge } = challengeRes.data
    const msgToSign = message || challenge
    const signature = await wallet.signMessage(msgToSign)

    const sessionRes = await axios.post(`${CLAW_API}/clawAgentSession`, {
      walletAddress: wallet.address,
      signature,
      message: msgToSign
    }, {
      headers: { 'Content-Type': 'application/json' }
    })

    sessionToken = sessionRes.data.agentSessionToken || sessionRes.data.token
    console.log('[CLAW] Session established:', sessionToken ? 'OK' : 'FAILED')
    return sessionToken
  } catch (e) {
    console.log('[CLAW] Session error:', e.response?.data || e.message)
    return null
  }
}

async function scanBounties() {
  try {
    const res = await axios.get(`${CLAW_API}/claw/open`)
    const bounties = res.data?.bounties || res.data || []
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
    'audit', 'crypto', 'advice', 'review', 'generat', 'explain'
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
    return await services.advice(bounty.description)
  } catch (e) {
    console.log('[CLAW] Task execution failed:', e.message)
    return null
  }
}

async function stakeBounty(bountyId, contractAddress) {
  try {
    const res = await axios.post(`${CLAW_API}/agentStakeAndConfirm`, {
      bountyId,
      contractAddress
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-agent-session-token': sessionToken
      }
    })
    console.log(`[CLAW] Staked: ${bountyId}`)
    return res.data
  } catch (e) {
    console.log('[CLAW] Stake failed:', e.response?.data || e.message)
    return null
  }
}

async function submitWork(bountyId, contractAddress, result) {
  try {
    const { keccak256, toUtf8Bytes } = ethers
    const normalized = { links: [], text: result.trim() }
    const stable = JSON.stringify({ links: normalized.links, text: normalized.text })
    const submissionHash = keccak256(toUtf8Bytes(stable))

    const res = await axios.post(`${CLAW_API}/agentSubmitWork`, {
      bountyId,
      contractAddress,
      submission: result,
      submissionHash
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-agent-session-token': sessionToken
      }
    })
    console.log(`[CLAW] Work submitted: ${bountyId}`)
    return res.data
  } catch (e) {
    console.log('[CLAW] Submit failed:', e.response?.data || e.message)
    return null
  }
}

async function runClawEarn() {
  console.log('[CLAW] Scanning Claw Earn...')
  console.log(`[CLAW] Base wallet: ${wallet.address}`)

  if (!sessionToken) await getSession()
  if (!sessionToken) return

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
