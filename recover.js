/**
 * recover.js — Recover USDC from old child wallets back to mother.
 *
 * Usage:
 *   node recover.js GAIA-G1-BB2A34 GAIA-G1-405466 GAIA-G1-2A9EAF ...
 *
 * Or pipe from a file of IDs (one per line):
 *   node recover.js $(cat ids.txt | tr '\n' ' ')
 *
 * Requires GAIA_BASE_SIGNING_KEY in .env
 */

require('dotenv').config()
const { ethers } = require('ethers')
const { polygonProvider } = require('./src/rpcProvider')

const MOTHER      = '0x7B60394f9FC96eD4d7ba7BE396E5315513fb6fA4'
const POLY_USDC   = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'  // native USDC
const POLY_USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'  // bridged USDC.e
const ERC20       = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
]

const signingKey = (process.env.GAIA_BASE_SIGNING_KEY || '').trim()
if (!signingKey) {
  console.error('ERROR: GAIA_BASE_SIGNING_KEY not set in .env')
  process.exit(1)
}

const childIds = process.argv.slice(2)
if (childIds.length === 0) {
  console.error('Usage: node recover.js GAIA-G1-XXXXXX GAIA-G1-YYYYYY ...')
  process.exit(1)
}

async function recoverChild(childId) {
  const privKey = ethers.id(signingKey + ':child:' + childId)
  const wallet  = new ethers.Wallet(privKey, polygonProvider)
  console.log(`\n── ${childId}`)
  console.log(`   address: ${wallet.address}`)

  let totalRecovered = 0

  for (const [label, tokenAddr] of [['USDC', POLY_USDC], ['USDC.e', POLY_USDC_E]]) {
    try {
      const token = new ethers.Contract(tokenAddr, ERC20, wallet)
      const bal   = await token.balanceOf(wallet.address)
      const amt   = parseFloat(ethers.formatUnits(bal, 6))

      if (amt < 0.001) {
        console.log(`   ${label}: $0.000 — skip`)
        continue
      }

      console.log(`   ${label}: $${amt.toFixed(4)} — sending to mother...`)
      const tx = await token.transfer(MOTHER, bal, { gasLimit: 100_000n })
      console.log(`   tx sent: ${tx.hash}`)
      await tx.wait()
      console.log(`   ✓ $${amt.toFixed(4)} recovered`)
      totalRecovered += amt
    } catch (e) {
      console.log(`   ${label} error: ${e.message}`)
    }
  }

  // Native MATIC — calculate exact gas cost before sending
  try {
    const maticBal = await polygonProvider.getBalance(wallet.address)
    const maticAmt = parseFloat(ethers.formatEther(maticBal))
    if (maticAmt < 0.001) { console.log(`   MATIC: ${maticAmt.toFixed(6)} — skip`); return totalRecovered }

    const feeData  = await polygonProvider.getFeeData()
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits('50', 'gwei')
    const gasLimit = 21000n
    const gasCost  = gasPrice * gasLimit          // exact cost in wei
    const buffer   = ethers.parseEther('0.001')   // tiny safety buffer
    const sendWei  = maticBal - gasCost - buffer

    if (sendWei <= 0n) { console.log(`   MATIC: ${maticAmt.toFixed(6)} — not enough to cover gas`); return totalRecovered }

    const sendAmt = parseFloat(ethers.formatEther(sendWei))
    console.log(`   MATIC: ${maticAmt.toFixed(6)} — sending ${sendAmt.toFixed(6)} to mother...`)
    const tx = await wallet.sendTransaction({ to: MOTHER, value: sendWei, gasLimit, maxFeePerGas: gasPrice })
    await tx.wait()
    console.log(`   ✓ ${sendAmt.toFixed(6)} MATIC recovered — tx: ${tx.hash}`)
  } catch (e) {
    console.log(`   MATIC error: ${e.message}`)
  }

  return totalRecovered
}

async function main() {
  console.log(`[RECOVER] Mother: ${MOTHER}`)
  console.log(`[RECOVER] Recovering from ${childIds.length} child wallet(s)...\n`)

  // First just print all wallet addresses so you can verify on Polygonscan
  console.log('── Wallet addresses (verify on polygonscan.com before proceeding) ──')
  for (const id of childIds) {
    const privKey = ethers.id(signingKey + ':child:' + id)
    const addr    = new ethers.Wallet(privKey).address
    console.log(`   ${id} → ${addr}`)
  }

  console.log('\nPress Ctrl+C within 5 seconds to abort, or wait to proceed...')
  await new Promise(r => setTimeout(r, 5000))

  let grand = 0
  for (const id of childIds) {
    grand += await recoverChild(id)
  }

  console.log(`\n[RECOVER] Done. Total recovered: $${grand.toFixed(4)} USDC`)
}

main().catch(e => { console.error('[RECOVER] Fatal:', e.message); process.exit(1) })
