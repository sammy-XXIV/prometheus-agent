/**
 * childWallet.js — Child wallet addressing and funding
 *
 * GAIA's main wallet is an Account Abstraction wallet on Kite.
 * No traditional private key exists for Kite chain transactions.
 * All Kite sends go through kpass agent:session execute.
 *
 * Child wallets:
 *   - Each child has a deterministic receive address derived from childId.
 *   - External agents send x402 payments to child addresses directly.
 *   - Kite sends (fund / drain) use kpass sessions, not raw signing.
 *   - Base-chain operations (Claw Earn) use GAIA_BASE_SIGNING_KEY if set.
 */

require('dotenv').config()
const { execFile } = require('child_process')
const { ethers } = require('ethers')
const path = require('path')
const { kiteProvider, baseProvider, throttledLog } = require('./rpcProvider')

const KPASS_BIN = process.env.KPASS_BIN ||
  path.join(process.env.HOME || '', '.local/bin/kpass')

const KITE_USDC      = '0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e'
const BASE_USDC      = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const MOTHER_ADDRESS = '0x9BeD7776262076B016798d6Ee74Dea3a6B1Ac662'  // Kite AA wallet (correct for Kite chain drains)

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]

// ── kpass wrapper ─────────────────────────────────────────────

function kpass(args, timeoutMs = 30000) {
  return new Promise(resolve => {
    execFile(KPASS_BIN, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) { resolve({ ok: false, error: err.message, raw: stderr || stdout }); return }
      try {
        const data = JSON.parse(stdout.trim())
        resolve({ ok: ['success', 'submitted', 'pending'].includes(data.status), data })
      } catch {
        resolve({ ok: false, error: 'JSON parse failed', raw: stdout })
      }
    })
  })
}

function encodeTransfer(to, amountRaw) {
  const iface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)'])
  return iface.encodeFunctionData('transfer', [to, amountRaw])
}

// ── Child address derivation ──────────────────────────────────

// Derives a stable EOA address for a child from its ID.
// This address receives x402 payments. Kite sends out use kpass sessions.
function deriveChildAddress(childId) {
  const privKey = ethers.id('gaia:child:' + childId)
  return new ethers.Wallet(privKey).address
}

// Returns a wallet for Base-chain signing (Claw Earn) if
// GAIA_BASE_SIGNING_KEY is available, otherwise returns an address-only
// object so callers can still read .address without crashing.
function deriveChildWallet(childId) {
  const signingKey = (process.env.GAIA_BASE_SIGNING_KEY || process.env.GAIA_BASE_PRIVATE_KEY || '').trim()
  if (signingKey) {
    const derived = ethers.id(signingKey + ':child:' + childId)
    return new ethers.Wallet(derived)
  }
  // Address-only — no signing capability
  return { address: deriveChildAddress(childId), _addressOnly: true }
}

// ── Balance query (read-only, no signing needed) ──────────────

async function getUSDCBalance(address, chain = 'kite') {
  try {
    const [provider, token] = chain === 'base'
      ? [baseProvider, BASE_USDC]
      : [kiteProvider, KITE_USDC]
    const usdc = new ethers.Contract(token, ERC20_ABI, provider)
    const raw  = await usdc.balanceOf(address)
    return parseFloat(ethers.formatUnits(raw, 6))
  } catch (e) {
    throttledLog(`getUSDCBalance:${chain}`, `[WALLET] RPC error on ${chain} (retrying in 30s): ${e.message}`)
    return 0
  }
}

// ── Fund child (mother → child, Kite chain) ───────────────────
//
// Uses kpass agent:session execute with the mother's active session.
// Set GAIA_SESSION_ID in .env once the mother's kpass session is approved.

async function fundChild(childAddress, amountUSDC) {
  const sessionId = (process.env.GAIA_SESSION_ID || '').trim()
  if (!sessionId) {
    console.log('[WALLET] GAIA_SESSION_ID not set — cannot fund child (Kite AA wallet requires kpass)')
    return false
  }

  try {
    const amountRaw = ethers.parseUnits(String(amountUSDC), 6)
    const calldata  = encodeTransfer(childAddress, amountRaw)

    const result = await kpass([
      'agent:session', 'execute',
      '--session-id', sessionId,
      '--to',         KITE_USDC,
      '--calldata',   calldata,
      '--output',     'json',
    ])

    if (result.ok) {
      console.log(`[WALLET] ✓ Funded ${childAddress} $${amountUSDC} USDC (Kite via kpass)`)
      return true
    }
    const hint = result.data?.hint || result.error || 'unknown'
    console.log(`[WALLET] Fund failed: ${hint}`)
    return false
  } catch (e) {
    console.log('[WALLET] Fund error:', e.message)
    return false
  }
}

// ── Drain child → mother (child's Kite session) ───────────────
//
// Each child has its own kpass spending session created at spawn
// (stored in registry as sessionId). That session executes the
// USDC transfer back to the mother address.

async function drainToMother(childId) {
  let total = 0
  const childAddr = deriveChildAddress(childId)

  // ── Kite drain via child's kpass session ─────────────────────
  try {
    const bal = await getUSDCBalance(childAddr, 'kite')
    if (bal > 0) {
      const registry  = require('./registry')
      const identity  = registry.getIdentity(childId)
      const sessionId = identity?.sessionId

      if (sessionId) {
        const amountRaw = ethers.parseUnits(bal.toFixed(6), 6)
        const calldata  = encodeTransfer(MOTHER_ADDRESS, amountRaw)

        const result = await kpass([
          'agent:session', 'execute',
          '--session-id', sessionId,
          '--to',         KITE_USDC,
          '--calldata',   calldata,
          '--output',     'json',
        ])

        if (result.ok) {
          total += bal
          console.log(`[WALLET] ✓ ${childId} drained $${bal.toFixed(4)} → mother (Kite)`)
        } else {
          const hint = result.data?.hint || result.error || 'unknown'
          console.log(`[WALLET] Kite drain failed for ${childId}: ${hint}`)
        }
      } else {
        console.log(`[WALLET] ${childId} has $${bal.toFixed(4)} Kite USDC but no approved session — funds remain`)
      }
    }
  } catch (e) {
    console.log(`[WALLET] Kite drain error for ${childId}:`, e.message)
  }

  return total
}

module.exports = {
  deriveChildWallet,
  deriveChildAddress,
  getUSDCBalance,
  fundChild,
  drainToMother,
  KITE_USDC,
  BASE_USDC,
  MOTHER_ADDRESS,
  kiteProvider,
  baseProvider,
}
