const { ethers } = require('ethers')
const { kiteProvider, throttledLog } = require('./rpcProvider')

const USDC_ADDRESS = '0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e'
const WALLET       = '0x9BeD7776262076B016798d6Ee74Dea3a6B1Ac662'
const ABI          = ['function balanceOf(address) view returns (uint256)']

async function getBalance() {
  try {
    const usdc = new ethers.Contract(USDC_ADDRESS, ABI, kiteProvider)
    const raw  = await usdc.balanceOf(WALLET)
    return parseFloat(ethers.formatUnits(raw, 6))
  } catch (e) {
    throttledLog('getBalance', `[BALANCE] RPC error (retrying in 30s): ${e.message}`)
    return 0
  }
}

module.exports = getBalance
