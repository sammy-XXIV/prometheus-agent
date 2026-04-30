const { ethers } = require('ethers')
require('dotenv').config()

const provider = new ethers.JsonRpcProvider('https://rpc.gokite.ai/')

const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)'
]

const USDC_ADDRESS = '0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e'
const PROMETHEUS_WALLET = '0x9BeD7776262076B016798d6Ee74Dea3a6B1Ac662'
const PAYMENT_WINDOW_SECONDS = 300 // payment must be within last 5 minutes

async function verifyPayment(txHash, expectedAmount) {
  try {
    if (!txHash) return { valid: false, reason: 'No transaction hash provided' }

    // Get the transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash)
    if (!receipt) return { valid: false, reason: 'Transaction not found on chain' }
    if (!receipt.status) return { valid: false, reason: 'Transaction failed on chain' }

    // Check it's recent
    const block = await provider.getBlock(receipt.blockNumber)
    const now = Math.floor(Date.now() / 1000)
    if (now - block.timestamp > PAYMENT_WINDOW_SECONDS) {
      return { valid: false, reason: 'Payment expired - too old' }
    }

    // Check for USDC transfer to Prometheus
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider)
    const filter = usdc.filters.Transfer(null, PROMETHEUS_WALLET)
    const events = await usdc.queryFilter(filter, receipt.blockNumber, receipt.blockNumber)

    const payment = events.find(e => e.transactionHash === txHash)
    if (!payment) return { valid: false, reason: 'No USDC transfer to Prometheus found' }

    // Verify amount is sufficient
    const paid = parseFloat(ethers.formatUnits(payment.args.value, 6))
    if (paid < parseFloat(expectedAmount)) {
      return { valid: false, reason: `Insufficient payment: paid $${paid}, required $${expectedAmount}` }
    }

    return { valid: true, paid, txHash }

  } catch (e) {
    return { valid: false, reason: e.message }
  }
}

module.exports = verifyPayment
