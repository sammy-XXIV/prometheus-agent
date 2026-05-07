const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')

const USERS_FILE = path.join(__dirname, '../data/users.json')

function load() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) }
  catch { return {} }
}

function save(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true })
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2))
}

function findByEmail(email) {
  return Object.values(load()).find(u => u.email === email) || null
}

function findById(id) {
  return load()[id] || null
}

function create(email, passwordHash) {
  const users = load()
  const id    = crypto.randomUUID()

  // Derive a deterministic Polygon/Base wallet for this user from the master key
  let walletAddress = null
  const masterKey   = (process.env.GAIA_BASE_SIGNING_KEY || '').trim()
  if (masterKey) {
    const { ethers } = require('ethers')
    walletAddress = new ethers.Wallet(ethers.id(masterKey + ':user:' + id)).address
  }

  users[id] = {
    id,
    email,
    passwordHash,
    walletAddress,
    colonyStatus: 'awaiting_deposit',
    createdAt:    new Date().toISOString(),
  }
  save(users)
  return users[id]
}

function updateStatus(id, status, extra = {}) {
  const users = load()
  if (!users[id]) return
  Object.assign(users[id], { colonyStatus: status, ...extra })
  save(users)
}

module.exports = { findByEmail, findById, create, updateStatus }
