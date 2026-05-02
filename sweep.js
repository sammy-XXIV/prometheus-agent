/**
 * sweep.js — Drain all child wallets back to the mother address.
 *
 * Run: node sweep.js
 *
 * Kite chain  — uses each child's kpass session (registry.sessionId)
 * Base chain  — uses GAIA_BASE_SIGNING_KEY to sign transfers directly
 * Native ETH  — sweeps ETH on Base (leaves 0.0001 for gas)
 */

require('dotenv').config()
const { ethers } = require('ethers')
const { baseProvider, kiteProvider, throttledLog } = require('./src/rpcProvider')
const { deriveChildAddress, deriveChildWallet, KITE_USDC, BASE_USDC, MOTHER_ADDRESS } = require('./src/childWallet')
const registry = require('./src/registry')
const { execFile } = require('child_process')
const path = require('path')

const KPASS_BIN = process.env.KPASS_BIN || path.join(process.env.HOME || '', '.local/bin/kpass')
const GAS_RESERVE_ETH = 0.0001  // leave this much ETH on Base for gas

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]

// ── helpers ───────────────────────────────────────────────────

function kpass(args) {
  return new Promise(resolve => {
    execFile(KPASS_BIN, args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) { resolve({ ok: false, error: err.message }); return }
      try {
        const data = JSON.parse(stdout.trim())
        resolve({ ok: ['success', 'submitted', 'pending'].includes(data.status), data })
      } catch {
        resolve({ ok: false, error: 'parse fail', raw: stdout })
      }
    })
  })
}

function encodeTransfer(to, amount) {
  const iface = new ethers.Interface(['function transfer(address,uint256) returns (bool)'])
  return iface.encodeFunctionData('transfer', [to, amount])
}

// ── Kite drain via kpass session ──────────────────────────────

async function drainKite(childId, sessionId) {
  const addr = deriveChildAddress(childId)
  const usdc = new ethers.Contract(KITE_USDC, ERC20_ABI, kiteProvider)
  let bal
  try { bal = await usdc.balanceOf(addr) } catch (e) { console.log(`  [KITE] RPC error: ${e.message}`); return 0 }

  const balFloat = parseFloat(ethers.formatUnits(bal, 6))
  if (balFloat < 0.001) { console.log(`  [KITE] balance: $0.000 — skip`); return 0 }

  console.log(`  [KITE] balance: $${balFloat.toFixed(4)} — draining via kpass session ${sessionId}`)
  const calldata = encodeTransfer(MOTHER_ADDRESS, bal)
  const result = await kpass(['agent:session', 'execute',
    '--session-id', sessionId,
    '--to', KITE_USDC,
    '--calldata', calldata,
    '--output', 'json',
  ])
  if (result.ok) { console.log(`  [KITE] ✓ drained $${balFloat.toFixed(4)}`); return balFloat }
  console.log(`  [KITE] ✗ failed: ${result.data?.hint || result.error}`)
  return 0
}

// ── Base drain via signing key ────────────────────────────────

async function drainBase(childId) {
  const wallet = deriveChildWallet(childId)
  if (wallet._addressOnly) {
    console.log(`  [BASE] no GAIA_BASE_SIGNING_KEY — skip`)
    return 0
  }

  const connected = wallet.connect(baseProvider)
  let total = 0

  // USDC
  const usdc = new ethers.Contract(BASE_USDC, ERC20_ABI, connected)
  try {
    const bal = await usdc.balanceOf(wallet.address)
    const balFloat = parseFloat(ethers.formatUnits(bal, 6))
    if (balFloat >= 0.001) {
      console.log(`  [BASE] USDC balance: $${balFloat.toFixed(4)} — sending`)
      const tx = await usdc.transfer(MOTHER_ADDRESS, bal, { gasLimit: 100_000n })
      await tx.wait()
      console.log(`  [BASE] ✓ USDC drained $${balFloat.toFixed(4)} — tx: ${tx.hash}`)
      total += balFloat
    } else {
      console.log(`  [BASE] USDC balance: $0.000 — skip`)
    }
  } catch (e) { console.log(`  [BASE] USDC error: ${e.message}`) }

  // Native ETH
  try {
    const ethBal = await baseProvider.getBalance(wallet.address)
    const ethFloat = parseFloat(ethers.formatEther(ethBal))
    if (ethFloat > GAS_RESERVE_ETH + 0.00005) {
      const sendFloat = ethFloat - GAS_RESERVE_ETH
      const sendWei = ethers.parseEther(sendFloat.toFixed(18))
      console.log(`  [BASE] ETH balance: ${ethFloat.toFixed(6)} — sending ${sendFloat.toFixed(6)} ETH`)
      const tx = await connected.sendTransaction({ to: MOTHER_ADDRESS, value: sendWei, gasLimit: 21000n })
      await tx.wait()
      console.log(`  [BASE] ✓ ETH drained ${sendFloat.toFixed(6)} ETH — tx: ${tx.hash}`)
    } else {
      console.log(`  [BASE] ETH balance: ${ethFloat.toFixed(6)} — skip`)
    }
  } catch (e) { console.log(`  [BASE] ETH error: ${e.message}`) }

  return total
}

// ── Main ──────────────────────────────────────────────────────

async function sweep() {
  const all = registry.getAllIdentities()
  console.log(`\n[SWEEP] Mother: ${MOTHER_ADDRESS}`)
  console.log(`[SWEEP] Found ${all.length} children in registry\n`)

  if (all.length === 0) {
    console.log('[SWEEP] No children registered — nothing to sweep.')
    console.log('[SWEEP] Children are added when the agent spawns them (node src/prometheus.js)')
    return
  }

  let grandTotal = 0

  for (const identity of all) {
    const { childId, sessionId, deceased } = identity
    console.log(`── ${childId}${deceased ? ' [DECEASED]' : ''} ──`)

    const kiteTotal = sessionId
      ? await drainKite(childId, sessionId)
      : (console.log(`  [KITE] no session — skip`), 0)

    const baseTotal = await drainBase(childId)
    grandTotal += kiteTotal + baseTotal
  }

  console.log(`\n[SWEEP] Done. Total swept: $${grandTotal.toFixed(4)} USDC`)
}

sweep().catch(e => { console.error('[SWEEP] Fatal:', e.message); process.exit(1) })
