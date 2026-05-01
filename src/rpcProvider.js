/**
 * rpcProvider.js — Shared RPC provider instances with throttled error logging.
 *
 * Centralises provider creation so all modules share the same instance
 * and RPC failures only emit one log line per 30 seconds instead of
 * spamming on every failed call.
 */

const { ethers } = require('ethers')

const KITE_RPC    = 'https://rpc.gokite.ai/'
const BASE_RPC    = 'https://mainnet.base.org'
const POLYGON_RPC = process.env.POLYGON_RPC || 'https://polygon-rpc.com'

// Throttle: one log line per error key per 30 seconds
const _lastLogged = {}
const THROTTLE_MS = 30 * 1000

function throttledLog(key, msg) {
  const now = Date.now()
  if (!_lastLogged[key] || now - _lastLogged[key] >= THROTTLE_MS) {
    _lastLogged[key] = now
    console.log(msg)
  }
}

// Provider factory — static network avoids an extra eth_chainId call on startup
function makeProvider(url, chainId) {
  return new ethers.JsonRpcProvider(
    url,
    chainId ? { chainId, name: 'custom' } : undefined,
    { staticNetwork: true, polling: false }
  )
}

const kiteProvider    = makeProvider(KITE_RPC,    2368)   // Kite chain ID
const baseProvider    = makeProvider(BASE_RPC,    8453)   // Base mainnet
const polygonProvider = makeProvider(POLYGON_RPC, 137)    // Polygon mainnet

module.exports = {
  kiteProvider,
  baseProvider,
  polygonProvider,
  throttledLog,
  KITE_RPC,
  BASE_RPC,
  POLYGON_RPC,
}
