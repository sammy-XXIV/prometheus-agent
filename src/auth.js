const bcrypt = require('bcryptjs')
const jwt    = require('jsonwebtoken')
const db     = require('./db')

const JWT_SECRET = process.env.JWT_SECRET || 'gaia-dev-secret-change-in-prod'
const MIN_DEPOSIT_MATIC = 0.5  // minimum MATIC on Polygon to launch a colony

// ── Middleware ────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Authentication required' })

  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// ── Route handlers ────────────────────────────────────────────

async function signup(req, res) {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
  if (password.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters' })
  if (db.findByEmail(email)) return res.status(409).json({ error: 'Email already registered' })

  const passwordHash = await bcrypt.hash(password, 10)
  const user  = db.create(email, passwordHash)
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' })

  res.status(201).json({
    token,
    user: {
      id:           user.id,
      email:        user.email,
      walletAddress: user.walletAddress,
      colonyStatus: user.colonyStatus,
    },
    next: user.walletAddress
      ? `Deposit at least ${MIN_DEPOSIT_MATIC} MATIC to ${user.walletAddress} on Polygon to launch your colony`
      : 'Set GAIA_BASE_SIGNING_KEY to enable wallet generation',
  })
}

async function login(req, res) {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })

  const user = db.findByEmail(email)
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok)  return res.status(401).json({ error: 'Invalid credentials' })

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' })
  res.json({
    token,
    user: {
      id:           user.id,
      email:        user.email,
      walletAddress: user.walletAddress,
      colonyStatus: user.colonyStatus,
    },
  })
}

function me(req, res) {
  const user = db.findById(req.user.userId)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({
    id:           user.id,
    email:        user.email,
    walletAddress: user.walletAddress,
    colonyStatus: user.colonyStatus,
    createdAt:    user.createdAt,
    depositInstruction: user.walletAddress
      ? `Send MATIC to ${user.walletAddress} on Polygon (chain ID 137)`
      : null,
  })
}

module.exports = { requireAuth, signup, login, me, JWT_SECRET, MIN_DEPOSIT_MATIC }
