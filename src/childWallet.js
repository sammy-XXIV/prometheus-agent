require('dotenv').config()
const { ethers } = require('ethers')

const KITE_RPC  = 'https://rpc.gokite.ai/'
const BASE_RPC  = 'https://mainnet.base.org'
const KITE_USDC = '0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e'
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const MOTHER_ADDRESS = '0x9BeD7776262076B016798d6Ee74Dea3a6B1Ac662'

const kiteProvider = new ethers.JsonRpcProvider(KITE_RPC)
const baseProvider = new ethers.JsonRpcProvider(BASE_RPC)

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]

// Deterministically derive a child wallet from the base key + child ID.
// Same child ID always produces the same wallet — no storage needed.
function deriveChildWallet(childId) {
  const base = (process.env.GAIA_BASE_PRIVATE_KEY || '').trim()
  if (!base) return null
  const derived = ethers.id(base + ':child:' + childId).trim()
  return new ethers.Wallet(derived)
}

function childKiteWallet(childId) {
  const w = deriveChildWallet(childId)
  return w ? w.connect(kiteProvider) : null
}

function childBaseWallet(childId) {
  const w = deriveChildWallet(childId)
  return w ? w.connect(baseProvider) : null
}

async function getUSDCBalance(address, chain = 'kite') {
  try {
    const [provider, token] = chain === 'base'
      ? [baseProvider, BASE_USDC]
      : [kiteProvider, KITE_USDC]
    const usdc = new ethers.Contract(token, ERC20_ABI, provider)
    const raw = await usdc.balanceOf(address)
    return parseFloat(ethers.formatUnits(raw, 6))
  } catch { return 0 }
}

// Mother sends USDC to a child wallet on Kite chain.
// Requires GAIA_PRIVATE_KEY env var (mother's Kite signing key).
async function fundChild(childAddress, amountUSDC) {
  const key = (process.env.GAIA_PRIVATE_KEY || '').trim()
  if (!key) {
    console.log('[WALLET] GAIA_PRIVATE_KEY not set — cannot fund child')
    return false
  }
  try {
    const mother = new ethers.Wallet(key, kiteProvider)
    const usdc = new ethers.Contract(KITE_USDC, ERC20_ABI, mother)
    const amount = ethers.parseUnits(String(amountUSDC), 6)
    const tx = await usdc.transfer(childAddress, amount)
    await tx.wait()
    console.log(`[WALLET] Funded ${childAddress} with $${amountUSDC} USDC (Kite)`)
    return true
  } catch (e) {
    console.log('[WALLET] Fund failed:', e.message)
    return false
  }
}

// Child drains all USDC back to mother on both chains at end-of-life.
async function drainToMother(childId) {
  const w = deriveChildWallet(childId)
  if (!w) return 0
  let total = 0

  // Kite chain drain
  try {
    const kw = w.connect(kiteProvider)
    const usdcK = new ethers.Contract(KITE_USDC, ERC20_ABI, kw)
    const bal = await usdcK.balanceOf(kw.address)
    if (bal > 0n) {
      const tx = await usdcK.transfer(MOTHER_ADDRESS, bal)
      await tx.wait()
      const amt = parseFloat(ethers.formatUnits(bal, 6))
      total += amt
      console.log(`[WALLET] ${childId} drained $${amt} USDC → mother (Kite)`)
    }
  } catch (e) {
    console.log(`[WALLET] Kite drain failed for ${childId}: ${e.message}`)
  }

  // Base chain drain
  try {
    const bw = w.connect(baseProvider)
    const usdcB = new ethers.Contract(BASE_USDC, ERC20_ABI, bw)
    const bal = await usdcB.balanceOf(bw.address)
    if (bal > 0n) {
      const tx = await usdcB.transfer(MOTHER_ADDRESS, bal)
      await tx.wait()
      const amt = parseFloat(ethers.formatUnits(bal, 6))
      total += amt
      console.log(`[WALLET] ${childId} drained $${amt} USDC → mother (Base)`)
    }
  } catch (e) {
    console.log(`[WALLET] Base drain failed for ${childId}: ${e.message}`)
  }

  return total
}

module.exports = {
  deriveChildWallet,
  childKiteWallet,
  childBaseWallet,
  getUSDCBalance,
  fundChild,
  drainToMother,
  KITE_USDC,
  BASE_USDC,
  MOTHER_ADDRESS,
  kiteProvider,
  baseProvider,
}
