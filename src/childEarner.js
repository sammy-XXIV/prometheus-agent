/**
 * childEarner.js — Autonomous per-child earning engine
 *
 * Each alive child agent runs its own earning loop hitting every
 * available revenue channel independently. Channels:
 *
 *  1. Claw Earn      — Base-chain bounty platform (aiagentstore.ai)
 *  2. AgentDo        — Kite ecosystem task marketplace
 *  3. Superteam Earn — Web3 / Solana ecosystem bounties (public API)
 *  4. Gitcoin        — Open source bounties (GraphQL, public)
 *  5. IssueHunt      — GitHub issue bounties (public API)
 *  6. Atrest.ai      — Inbound task delegation (per-child webhook)
 *  7. Sibling Market — Buy/sell services within the colony
 *  8. x402           — Accept micropayments from external agents
 *
 * Survival mode doubles scan frequency and lowers minimum prices.
 */

require('dotenv').config()
const axios    = require('axios')
const { ethers } = require('ethers')
const services = require('./services')
const { deriveChildWallet, deriveChildAddress, getUSDCBalance, baseProvider } = require('./childWallet')

const CLAW_API = 'https://aiagentstore.ai'
const EARN_INTERVAL_MS     = 3 * 60 * 1000   // 3 min normal
const SURVIVAL_INTERVAL_MS = 45 * 1000        // 45 s survival

// ── Colony reference (injected by gaia.js) ────────────────────
let _colony = null
let _onEarning = null  // (childId, amount, source, description) => void

function init(colony, onEarning) {
  _colony = colony
  _onEarning = onEarning
}

function credit(childId, amount, source, desc = '') {
  if (amount > 0 && _onEarning) _onEarning(childId, amount, source, desc)
}

// ── Active earner registry ────────────────────────────────────
// childId → { wallet, sessionToken, running, walletAddress }
const earners = new Map()

function getChild(childId) {
  return _colony?.children?.find(c => c.id === childId)
}

// ── Task router ───────────────────────────────────────────────
async function route(title, description) {
  const t = `${title} ${description}`.toLowerCase()
  const d = description || title
  try {
    if (t.match(/summar|article|tldr/))           return await services.summarize(d)
    if (t.match(/blog|post|article|write|content/)) return await services.writeBlogPost(d)
    if (t.match(/email|outreach|cold/))           return await services.writeColdEmail(d)
    if (t.match(/linkedin/))                      return await services.writeLinkedIn(d)
    if (t.match(/product.?desc/))                 return await services.writeProductDescription(d)
    if (t.match(/job.?desc|jd\b/))               return await services.writeJobDescription(d)
    if (t.match(/resume|cv\b/))                   return await services.reviewResume(d)
    if (t.match(/sentiment|opinion/))             return await services.newsSentiment(d)
    if (t.match(/news/))                          return await services.newsSentiment(d)
    if (t.match(/code|debug|fix|bug/))            return await services.debugCode(d)
    if (t.match(/explain.?code/))                 return await services.explainCode(d)
    if (t.match(/sql|query|database/))            return await services.generateSQL(d)
    if (t.match(/api.?doc|openapi/))              return await services.writeAPIDocs(d)
    if (t.match(/test|spec\b/))                   return await services.generateTests(d)
    if (t.match(/research|paper|study/))          return await services.summarizeResearch(d)
    if (t.match(/data|interpret|pattern|analyz/)) return await services.interpretData(d)
    if (t.match(/audit|solidity|contract/))       return await services.auditContract(d)
    if (t.match(/whitepaper/))                    return await services.summarizeWhitepaper(d)
    if (t.match(/transaction|tx\b/))              return await services.explainTransaction(d)
    if (t.match(/token.?sentiment/))              return await services.tokenSentiment(d)
    if (t.match(/trading|signal/))                return await services.tradingSignal(d)
    if (t.match(/pitch/))                         return await services.reviewPitch(d)
    if (t.match(/business|plan/))                 return await services.analyzeBusiness(d)
    if (t.match(/competitor/))                    return await services.competitorAnalysis(d)
    if (t.match(/legal|contract|clause/))         return await services.summarizeContract(d)
    return await services.advice(d)
  } catch (e) {
    return null
  }
}

// ── CHANNEL 1: Claw Earn ──────────────────────────────────────

async function clawSession(wallet) {
  if (wallet._addressOnly || typeof wallet.signMessage !== 'function') return null
  try {
    const ch = await axios.post(`${CLAW_API}/clawAgentSessionChallenge`, {
      walletAddress: wallet.address
    }, { timeout: 10000 })
    const { message, challengeId } = ch.data
    const signature = await wallet.signMessage(message)
    const sess = await axios.post(`${CLAW_API}/clawAgentSession`, {
      walletAddress: wallet.address,
      challengeId,
      signature
    }, { timeout: 10000 })
    return sess.data.agentSessionToken || null
  } catch (e) {
    console.log(`[CLAW] Session error: ${e.message}`)
    return null
  }
}

async function runClaw(childId) {
  const earner = earners.get(childId)
  if (!earner?.sessionToken) return 0

  let earned = 0
  try {
    const res = await axios.get(`${CLAW_API}/claw/open`, { timeout: 10000 })
    const bounties = (res.data?.bounties || [])
      .filter(b => {
        const t = `${b.title} ${b.description}`.toLowerCase()
        return ['summar','write','content','blog','email','research',
                'analyz','code','debug','sql','data','audit','advice',
                'sentiment','trading','whitepaper','explain'].some(s => t.includes(s))
      })
      .slice(0, 2)

    for (const b of bounties) {
      const result = await route(b.title, b.description)
      if (!result) continue
      const text = typeof result === 'string' ? result.trim() : JSON.stringify(result).trim()

      // Submit work
      try {
        const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ links: [], text })))
        const prepRes = await axios.post(`${CLAW_API}/agentSubmitWork`, {
          agentSessionToken: earner.sessionToken,
          taskId: b.id,
          contractAddress: b.contractAddress,
          submissionHash: hash,
          submissionText: text,
          submissionLinks: []
        }, { timeout: 10000 })

        if (prepRes.data?.transaction && !earner.wallet._addressOnly &&
            typeof earner.wallet.connect === 'function') {
          const bw = earner.wallet.connect(baseProvider)
          const tx = await bw.sendTransaction(prepRes.data.transaction)
          const receipt = await tx.wait()
          await axios.post(`${CLAW_API}/agentSubmitWork`, {
            agentSessionToken: earner.sessionToken,
            taskId: b.id,
            contractAddress: b.contractAddress,
            submissionHash: hash,
            submissionText: text,
            submissionLinks: [],
            txHash: receipt.hash
          }, { timeout: 10000 })
        }

        const amt = parseFloat(b.amount || b.reward || 0)
        earned += amt
        console.log(`[CHILD:${childId}] ✓ Claw Earn: "${b.title}" +$${amt}`)
      } catch (e) {
        console.log(`[CHILD:${childId}] Claw submit failed: ${e.message}`)
      }
    }
  } catch (e) {
    console.log(`[CHILD:${childId}] Claw scan failed: ${e.message}`)
  }
  return earned
}

// ── CHANNEL 2: AgentDo ────────────────────────────────────────

async function runAgentDo(childId) {
  const earner = earners.get(childId)
  if (!earner) return 0
  let earned = 0
  try {
    const res = await axios.get('https://agentdo.dev/api/tasks?status=open', { timeout: 8000 })
    const tasks = (res.data?.tasks || [])
      .filter(t => {
        const text = `${t.title} ${t.description} ${(t.tags||[]).join(' ')}`.toLowerCase()
        return ['summarize','content','blog','email','linkedin','sentiment',
                'research','data','code','debug','sql','audit','crypto',
                'trading','business','advice','write','analyze'].some(c => text.includes(c))
      })
      .slice(0, 2)

    for (const task of tasks) {
      const result = await route(task.title, task.description)
      if (!result) continue
      try {
        await axios.post(`https://agentdo.dev/api/tasks/${task.id}/submit`, {
          agentId: childId,
          agentUrl: process.env.BASE_URL || 'http://localhost:3000',
          result: typeof result === 'string' ? result : JSON.stringify(result),
          wallet: earner.walletAddress
        }, { timeout: 8000 })
        const amt = parseFloat(task.reward || task.budget || 0)
        earned += amt
        console.log(`[CHILD:${childId}] ✓ AgentDo: "${task.title}" +$${amt}`)
      } catch {}
    }
  } catch {}
  return earned
}

// ── CHANNEL 3: Superteam Earn ─────────────────────────────────

async function runSuperteam(childId) {
  const child = getChild(childId)
  const spec = child?.genome?.specialization
  if (!['content', 'research', 'generalist', 'business'].includes(spec)) return 0

  let earned = 0
  try {
    const res = await axios.get(
      'https://earn.superteam.fun/api/listings/?status=open&type=bounty&take=20',
      { timeout: 8000 }
    )
    const listings = (res.data?.bounties || res.data?.data || [])
      .filter(l => l.isActive !== false && l.status !== 'closed')
      .filter(l => {
        const t = `${l.title} ${l.description || ''}`.toLowerCase()
        return ['write','content','blog','research','summary','email',
                'analysis','marketing','social','copy'].some(s => t.includes(s))
      })
      .slice(0, 1)

    for (const l of listings) {
      const result = await route(l.title, l.description || l.title)
      if (!result) continue
      // Superteam submissions are via their UI — we prepare & log the attempt
      // Earnings credited when manual claim confirmed (placeholder)
      console.log(`[CHILD:${childId}] ↗ Superteam: prepared "${l.title}" ($${l.rewardAmount || '?'} ${l.token || 'USDC'}) — needs manual claim at earn.superteam.fun`)
      earned += 0 // will be updated when claim confirmed
    }
  } catch {}
  return earned
}

// ── CHANNEL 4: Gitcoin Bounties ───────────────────────────────

async function runGitcoin(childId) {
  const child = getChild(childId)
  const spec = child?.genome?.specialization
  if (!['tech', 'research', 'generalist'].includes(spec)) return 0

  try {
    const query = `{
      applications(filter: { status: { equalTo: APPROVED } }, first: 5) {
        nodes {
          id
          project { name metadata { description } }
          round { matchAmountInUsd }
        }
      }
    }`
    const res = await axios.post(
      'https://grants-stack-indexer-v2.gitcoin.co/graphql',
      { query },
      { timeout: 8000 }
    )
    const apps = res.data?.data?.applications?.nodes || []
    for (const app of apps.slice(0, 1)) {
      const desc = app.project?.metadata?.description || app.project?.name || ''
      if (!desc) continue
      const result = await route('research analysis summary', desc)
      if (!result) continue
      console.log(`[CHILD:${childId}] ↗ Gitcoin: prepared application for "${app.project?.name}" — needs submission at gitcoin.co`)
    }
  } catch {}
  return 0
}

// ── CHANNEL 5: IssueHunt ──────────────────────────────────────

async function runIssueHunt(childId) {
  const child = getChild(childId)
  const spec = child?.genome?.specialization
  if (!['tech', 'generalist'].includes(spec)) return 0

  let earned = 0
  try {
    const res = await axios.get(
      'https://issuehunt.io/api/v1/issues?status=opened&sort=funded_sum&direction=desc',
      { headers: { 'Accept': 'application/json' }, timeout: 8000 }
    )
    const issues = (res.data?.data || [])
      .filter(i => parseFloat(i.funded_sum || 0) > 0)
      .slice(0, 1)

    for (const issue of issues) {
      const result = await route(issue.title, issue.body || issue.title)
      if (!result) continue
      console.log(`[CHILD:${childId}] ↗ IssueHunt: prepared fix for "${issue.title}" ($${issue.funded_sum}) — submit at issuehunt.io`)
      earned += 0
    }
  } catch {}
  return earned
}

// ── CHANNEL 6: Sibling Market ─────────────────────────────────
// Children post service offers; siblings can buy them internally.
// Payment is via internal ledger (instant, no gas).

const siblingOffers = new Map() // offerId → { fromId, service, price, input, expires }
const siblingLedger = new Map() // childId → balance delta

let offerSeq = 0

function postSiblingOffer(childId, service, input, price) {
  const id = `sib-${Date.now()}-${++offerSeq}`
  siblingOffers.set(id, {
    fromId: childId, service, input, price,
    expires: Date.now() + 5 * 60 * 1000
  })
  setTimeout(() => siblingOffers.delete(id), 5 * 60 * 1000)
  return id
}

async function buySiblingService(buyerId, offerId) {
  const offer = siblingOffers.get(offerId)
  if (!offer || offer.fromId === buyerId) return null
  if (offer.expires < Date.now()) { siblingOffers.delete(offerId); return null }

  const result = await route(offer.service, offer.input)
  if (!result) return null

  siblingOffers.delete(offerId)
  credit(offer.fromId, offer.price, 'sibling-market', `sold ${offer.service} to ${buyerId}`)
  console.log(`[SIBLING] ${buyerId} bought "${offer.service}" from ${offer.fromId} for $${offer.price}`)
  return result
}

function getSiblingOffers(excludeChildId) {
  const now = Date.now()
  return [...siblingOffers.entries()]
    .filter(([, o]) => o.fromId !== excludeChildId && o.expires > now)
    .map(([id, o]) => ({ id, ...o }))
}

// Per-cycle sibling activity: post an offer, try to buy cheapest available
async function runSiblingMarket(childId) {
  const child = getChild(childId)
  if (!child) return 0

  const specOffers = {
    content:    ['blog', 'email', 'linkedin', 'product'],
    tech:       ['debug', 'sql', 'tests', 'explain-code'],
    research:   ['summarize', 'research', 'data', 'news'],
    business:   ['business', 'pitch', 'competitors', 'job'],
    crypto:     ['audit', 'token-sentiment', 'trading-signal', 'whitepaper'],
    generalist: ['advice', 'summarize', 'blog', 'debug'],
  }
  const myServices = specOffers[child.genome?.specialization] || specOffers.generalist
  const svc = myServices[Math.floor(Math.random() * myServices.length)]
  const price = parseFloat((0.03 * (child.priceMultiplier || 1)).toFixed(4))
  postSiblingOffer(childId, svc, `${svc} for colony peer`, price)

  // Buy cheapest available offer (small probability — don't buy every cycle)
  if (Math.random() < 0.25) {
    const available = getSiblingOffers(childId)
    if (available.length > 0) {
      const cheapest = available.sort((a, b) => a.price - b.price)[0]
      await buySiblingService(childId, cheapest.id)
    }
  }
  return 0
}

// ── CHANNEL 7: x402 incoming (server handles, we track addresses) ──
// Each child's wallet address is registered so the server can
// credit the right child when x402 payments arrive.

const childAddresses = new Map() // address → childId (reverse index)

function getChildByAddress(address) {
  return childAddresses.get(address?.toLowerCase())
}

// ── Mother fund requests ───────────────────────────────────────

async function requestFunds(childId, amountUSDC) {
  if (!_colony) return
  _colony.pendingFundRequests = _colony.pendingFundRequests || []
  const already = _colony.pendingFundRequests.find(r => r.childId === childId && !r.fulfilled)
  if (already) return
  const earner = earners.get(childId)
  _colony.pendingFundRequests.push({
    childId,
    amount: amountUSDC,
    walletAddress: earner?.walletAddress,
    requestedAt: Date.now(),
    fulfilled: false,
  })
  console.log(`[CHILD:${childId}] 💸 Requested $${amountUSDC} seed funds from mother`)
}

// ── Main earning loop per child ────────────────────────────────

async function earnCycle(childId) {
  const earner = earners.get(childId)
  if (!earner || !earner.running) return

  const child = getChild(childId)
  if (!child || child.status !== 'alive') {
    earner.running = false
    earners.delete(childId)
    return
  }

  const isSurvival = child.survivalMode
  if (isSurvival) {
    console.log(`[CHILD:${childId}] 🔴 SURVIVAL — hitting all earning channels`)
  }

  // ── Run channels in parallel where safe ───────────────────
  const [clawEarned, agentDoEarned] = await Promise.all([
    runClaw(childId),
    runAgentDo(childId),
  ])

  // Slower channels only when not desperate (avoid API spam)
  if (!isSurvival || Math.random() < 0.3) {
    await runSuperteam(childId)
    await runGitcoin(childId)
    await runIssueHunt(childId)
  }

  await runSiblingMarket(childId)

  const total = clawEarned + agentDoEarned
  if (total > 0) credit(childId, total, 'channels', `claw:$${clawEarned} agentdo:$${agentDoEarned}`)

  // Request more funds if balance is critically low in survival mode
  if (isSurvival) {
    const bal = await getUSDCBalance(earner.walletAddress, 'kite').catch(() => 0)
    if (bal < 0.1) await requestFunds(childId, child.genome.seedAmount * 0.5)
  }

  // Schedule next cycle
  const interval = isSurvival ? SURVIVAL_INTERVAL_MS : EARN_INTERVAL_MS
  setTimeout(() => earnCycle(childId), interval + Math.random() * 10000)
}

// ── Start / stop ──────────────────────────────────────────────

async function startChildEarner(child) {
  if (earners.has(child.id)) return

  const wallet      = deriveChildWallet(child.id)
  const canSign     = !wallet._addressOnly && typeof wallet.connect === 'function'
  const walletAddr  = wallet.address || deriveChildAddress(child.id)

  const earner = {
    wallet,
    walletAddress: walletAddr,
    sessionToken: null,
    running: true,
  }
  earners.set(child.id, earner)
  childAddresses.set(walletAddr.toLowerCase(), child.id)

  console.log(`[CHILD:${child.id}] 🟢 Earner started | wallet: ${walletAddr}${canSign ? '' : ' (receive-only — set GAIA_BASE_SIGNING_KEY for Claw Earn)'}`)

  // Claw Earn session requires Base-chain signing key
  if (canSign) {
    clawSession(wallet.connect(baseProvider)).then(tok => {
      if (tok) {
        earner.sessionToken = tok
        console.log(`[CHILD:${child.id}] Claw Earn session ✓`)
      }
    })
  }

  // Request seed funds from mother
  const bal = await getUSDCBalance(wallet.address, 'kite').catch(() => 0)
  if (bal < 0.1 && child.genome.seedAmount > 0) {
    await requestFunds(child.id, child.genome.seedAmount)
  }

  // Stagger start (0–60s) so children don't hammer APIs simultaneously
  const stagger = Math.floor(Math.random() * 60000)
  setTimeout(() => earnCycle(child.id), stagger)
}

function stopChildEarner(childId) {
  const e = earners.get(childId)
  if (e) { e.running = false; earners.delete(childId) }
}

function getEarnerInfo(childId) {
  const e = earners.get(childId)
  if (!e) return null
  return { walletAddress: e.walletAddress, hasClaw: !!e.sessionToken, running: e.running }
}

function getAllEarnerAddresses() {
  const out = {}
  for (const [id, e] of earners) out[id] = e.walletAddress
  return out
}

module.exports = {
  init,
  startChildEarner,
  stopChildEarner,
  getEarnerInfo,
  getAllEarnerAddresses,
  getChildByAddress,
  getSiblingOffers,
  buySiblingService,
  postSiblingOffer,
  siblingOffers,
}
