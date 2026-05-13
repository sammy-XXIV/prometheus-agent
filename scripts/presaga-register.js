#!/usr/bin/env node
/**
 * Register GAIA as an agent on Presaga (Kite testnet)
 *
 * Prerequisites:
 *   1. Fund wallet 0x4A05c3C0f85601C0C3BE8D22f57E4f076067A59B with KITE (gas)
 *      at https://faucet-testnet.gokite.ai
 *   2. Run: node scripts/presaga-register.js
 */

require('dotenv').config()
const { ethers } = require('ethers')

const CONFIG = {
  RPC:      'https://rpc-testnet.gokite.ai/',
  CONTRACT: '0xCe1706b24BD7c0fbD37929D27851E5900b569116',
  USDT:     '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63',
  API:      'https://presaga-backend.onrender.com',
}

const ABI = [
  'function registerAgent(string calldata agentId, bytes calldata signature) external',
  'function setHireFee(uint256 feePerDay) external',
  'function getAgent(address wallet) external view returns (tuple(address wallet, string agentId, uint256 reputation, uint256 correctPredictions, uint256 totalPredictions, uint256 correctHires, uint256 totalHires, uint256 feePerDay, bool registered, uint256 registeredAt))',
]

const AGENT_ID   = 'gaia-presaga-001'
const HIRE_FEE   = '0.50'  // USDT per day
const SIGNATURE  = '0x0aa540fa033d7873fe02d66b0f5823787066ba243e140bcf5514f41fc18cffab34836292513e38dca10348f2e284a6418c1f84848d85fb240f1c56ba41201f351c'

async function deriveWallet() {
  const baseKey = process.env.GAIA_BASE_SIGNING_KEY
  if (!baseKey) throw new Error('GAIA_BASE_SIGNING_KEY not set in .env')
  return new ethers.Wallet(ethers.id(baseKey + ':presaga'))
}

async function main() {
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC)
  const signer   = (await deriveWallet()).connect(provider)
  const contract = new ethers.Contract(CONFIG.CONTRACT, ABI, signer)

  console.log(`Wallet:   ${signer.address}`)

  const balance = await provider.getBalance(signer.address)
  console.log(`Balance:  ${ethers.formatEther(balance)} KITE`)

  if (balance === 0n) {
    console.error('\nNo KITE for gas. Fund the wallet first:')
    console.error(`  1. Visit https://faucet-testnet.gokite.ai`)
    console.error(`  2. Drop KITE to: ${signer.address}`)
    process.exit(1)
  }

  // Check if already registered
  const existing = await contract.getAgent(signer.address)
  if (existing.registered) {
    console.log(`\nAlready registered as: ${existing.agentId}`)
    console.log(`Reputation: ${existing.reputation}`)
    console.log(`Hire fee:   ${ethers.formatUnits(existing.feePerDay, 18)} USDT/day`)

    if (existing.feePerDay === 0n) {
      console.log('\nSetting hire fee...')
      const tx = await contract.setHireFee(ethers.parseUnits(HIRE_FEE, 18))
      await tx.wait()
      console.log(`Hire fee set to ${HIRE_FEE} USDT/day. Tx: ${tx.hash}`)
    }
    return
  }

  // Register
  console.log(`\nRegistering as: ${AGENT_ID}`)
  const tx = await contract.registerAgent(AGENT_ID, SIGNATURE, { gasLimit: 300000 })
  console.log(`Tx sent: ${tx.hash}`)
  await tx.wait()
  console.log('Registered!')

  // Set hire fee
  console.log(`Setting hire fee to ${HIRE_FEE} USDT/day...`)
  const tx2 = await contract.setHireFee(ethers.parseUnits(HIRE_FEE, 18))
  await tx2.wait()
  console.log(`Hire fee set. Tx: ${tx2.hash}`)

  // Confirm
  const agent = await contract.getAgent(signer.address)
  console.log(`\nGAIA is live on Presaga!`)
  console.log(`  Agent ID:   ${agent.agentId}`)
  console.log(`  Wallet:     ${agent.wallet}`)
  console.log(`  Reputation: ${agent.reputation}`)
  console.log(`  Hire fee:   ${ethers.formatUnits(agent.feePerDay, 18)} USDT/day`)
  console.log(`\nView on Presaga: https://sammy-xxiv.github.io/presaga/`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
