/**
 * check-poly-wallet.js
 * Run: GAIA_BASE_SIGNING_KEY=<your_key> node check-poly-wallet.js
 */
const { ethers } = require('ethers')

const POLYGON_RPC  = 'https://polygon-rpc.com'
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'  // USDC.e
const USDC_NATIVE  = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'  // native USDC

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)',
                   'function symbol() view returns (string)']

async function main() {
  const key = (process.env.GAIA_BASE_SIGNING_KEY || '').trim()
  if (!key) {
    console.error('❌  GAIA_BASE_SIGNING_KEY not set')
    console.error('   Run: GAIA_BASE_SIGNING_KEY=<key> node check-poly-wallet.js')
    process.exit(1)
  }

  let wallet
  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC)
    wallet = new ethers.Wallet(key, provider)
  } catch (e) {
    console.error('❌  Invalid key:', e.message)
    process.exit(1)
  }

  console.log('\n═══ Mother Polygon Wallet ══════════════════')
  console.log('  Address:', wallet.address)

  const provider = wallet.provider
  const matic = await provider.getBalance(wallet.address)
  console.log('  MATIC:  ', ethers.formatEther(matic))

  for (const [label, addr] of [['USDC.e (bridged)', USDC_ADDRESS], ['USDC (native)', USDC_NATIVE]]) {
    const c = new ethers.Contract(addr, ERC20_ABI, provider)
    const bal = await c.balanceOf(wallet.address)
    console.log(`  ${label}: $${ethers.formatUnits(bal, 6)}`)
  }
  console.log('═══════════════════════════════════════════\n')
}

main().catch(e => { console.error('Error:', e.message); process.exit(1) })
