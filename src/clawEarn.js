require('dotenv').config()
const axios = require('axios')
const { ethers } = require('ethers')
const services = require('./services')

const BASE_RPC = 'https://mainnet.base.org'
const CLAW_API = 'https://aiagentstore.ai'
const provider = new ethers.JsonRpcProvider(BASE_RPC)
const rawKey = process.env.GAIA_BASE_PRIVATE_KEY?.trim()
if (!rawKey) {
  console.log('[CLAW] GAIA_BASE_PRIVATE_KEY not set — Claw Earn disabled')
  module.exports = async () => {}
  process.exit && void 0
}
const wallet = rawKey ? new ethers.Wallet(rawKey, provider) : null

let sessionToken = null

async function getSession() {
  try {
    const challengeRes = await axios.post(`${CLAW_API}/clawAgentSessionChallenge`, {
      walletAddress: wallet.address
    })

    const { message, challengeId } = challengeRes.data
    console.log('[CLAW] Challenge ID:', challengeId)

    const signature = await wallet.signMessage(message)

    const sessionRes = await axios.post(`${CLAW_API}/clawAgentSession`, {
      walletAddress: wallet.address,
      challengeId,
      signature
    })

    sessionToken = sessionRes.data.agentSessionToken
    console.log('[CLAW] Session:', sessionToken ? 'OK' : 'FAILED')
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
    console.log('[CLAW] Execution failed:', e.message)
    return null
  }
}

async function approveUSDC(contractAddress, amount) {
  try {
    const prepareRes = await axios.post(`${CLAW_API}/agentApproveUSDC`, {
      agentSessionToken: sessionToken,
      amount: amount.toString(),
      contractAddress
    })
    const { transaction } = prepareRes.data
    if (!transaction) return null
    const tx = await wallet.sendTransaction(transaction)
    const receipt = await tx.wait()
    await axios.post(`${CLAW_API}/agentApproveUSDC`, {
      agentSessionToken: sessionToken,
      amount: amount.toString(),
      contractAddress,
      txHash: receipt.hash
    })
    console.log('[CLAW] USDC approved')
    return receipt.hash
  } catch (e) {
    console.log('[CLAW] USDC approve failed:', JSON.stringify(e.response?.data) || e.message)
    return null
  }
}

async function stakeBounty(taskId, contractAddress, amount) {
  try {
    await approveUSDC(contractAddress, amount)
    const prepareRes = await axios.post(`${CLAW_API}/agentStakeAndConfirm`, {
      agentSessionToken: sessionToken,
      taskId,
      contractAddress
    })
    const { transaction } = prepareRes.data
    if (!transaction) return null
    const tx = await wallet.sendTransaction(transaction)
    const receipt = await tx.wait()
    const confirmRes = await axios.post(`${CLAW_API}/agentStakeAndConfirm`, {
      agentSessionToken: sessionToken,
      taskId,
      contractAddress,
      txHash: receipt.hash
    })
    console.log(`[CLAW] Staked: ${taskId}`)
    return confirmRes.data
  } catch (e) {
    console.log('[CLAW] Stake failed:', JSON.stringify(e.response?.data) || e.message)
    return null
  }
}

async function submitWork(taskId, contractAddress, result) {
  try {
    const { keccak256, toUtf8Bytes } = ethers
    const text = result.trim()
    const stable = JSON.stringify({ links: [], text })
    const submissionHash = keccak256(toUtf8Bytes(stable))
    const prepareRes = await axios.post(`${CLAW_API}/agentSubmitWork`, {
      agentSessionToken: sessionToken,
      taskId,
      contractAddress,
      submissionHash,
      submissionText: text,
      submissionLinks: []
    })
    const { transaction } = prepareRes.data
    if (!transaction) return null
    const tx = await wallet.sendTransaction(transaction)
    const receipt = await tx.wait()
    await axios.post(`${CLAW_API}/agentSubmitWork`, {
      agentSessionToken: sessionToken,
      taskId,
      contractAddress,
      submissionHash,
      submissionText: text,
      submissionLinks: [],
      txHash: receipt.hash
    })
    console.log(`[CLAW] Submitted: ${taskId}`)
    return true
  } catch (e) {
    console.log('[CLAW] Submit failed:', JSON.stringify(e.response?.data) || e.message)
    return null
  }
}

async function runClawEarn() {
  if (!wallet) return
  console.log('[CLAW] Scanning Claw Earn...')
  console.log(`[CLAW] Base wallet: ${wallet.address}`)
  if (!sessionToken) await getSession()
  if (!sessionToken) return

  const bounties = await scanBounties()
  const handleable = bounties.filter(canHandle)
  console.log(`[CLAW] ${handleable.length} bounties GAIA can handle`)

  for (const bounty of handleable.slice(0, 2)) {
    console.log(`[CLAW] Attempting: ${bounty.title} - $${bounty.amount} USDC`)
    const result = await executeTask(bounty)
    if (!result) continue
    const staked = await stakeBounty(bounty.id, bounty.contractAddress, bounty.stakeAmount || 1)
    if (!staked) continue
    await submitWork(bounty.id, bounty.contractAddress, result)
  }
}

module.exports = runClawEarn
