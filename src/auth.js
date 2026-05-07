const bcrypt      = require('bcryptjs')
const jwt         = require('jsonwebtoken')
const nodemailer  = require('nodemailer')
const { OAuth2Client } = require('google-auth-library')
const db          = require('./db')

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

const JWT_SECRET        = process.env.JWT_SECRET || 'gaia-dev-secret-change-in-prod'
const MIN_DEPOSIT_MATIC = 0.5
const OTP_TTL_MS        = 10 * 60 * 1000  // 10 minutes

// In-memory pending signups: email → { passwordHash, otp, expiresAt }
const pending = new Map()

// ── Email sender ──────────────────────────────────────────────

async function sendOTP(email, otp) {
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD

  if (!gmailUser || !gmailPass) {
    console.log(`[AUTH] OTP for ${email}: ${otp}`)
    return true
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  })

  await transporter.sendMail({
    from:    `GAIA Colony <${gmailUser}>`,
    to:      email,
    subject: 'Your GAIA verification code',
    text:    `Your GAIA verification code is: ${otp}\n\nExpires in 10 minutes.`,
    html:    `
      <div style="background:#0a0a1a;color:#ddeeff;font-family:monospace;padding:32px;max-width:480px">
        <div style="font-size:24px;color:#00ee77;letter-spacing:6px;margin-bottom:8px">GAIA</div>
        <div style="color:rgba(0,238,119,0.5);font-size:11px;letter-spacing:2px;margin-bottom:28px">COLONY VERIFICATION</div>
        <div style="font-size:13px;margin-bottom:20px;color:#aabbcc">Your verification code:</div>
        <div style="font-size:40px;letter-spacing:12px;color:#00ee77;background:rgba(0,238,119,0.06);border:1px solid rgba(0,238,119,0.2);padding:16px 24px;display:inline-block;margin-bottom:20px">${otp}</div>
        <div style="font-size:11px;color:rgba(221,238,255,0.4)">Expires in 10 minutes. Do not share this code.</div>
      </div>
    `,
  })
}

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
  if (!email || !password)   return res.status(400).json({ error: 'Email and password required' })
  if (password.length < 8)   return res.status(400).json({ error: 'Password must be at least 8 characters' })
  if (db.findByEmail(email)) return res.status(409).json({ error: 'Email already registered' })

  const otp          = String(Math.floor(100000 + Math.random() * 900000))
  const passwordHash = await bcrypt.hash(password, 10)

  pending.set(email.toLowerCase(), {
    passwordHash,
    otp,
    expiresAt: Date.now() + OTP_TTL_MS,
  })

  // Auto-clean after TTL
  setTimeout(() => pending.delete(email.toLowerCase()), OTP_TTL_MS + 1000)

  // Send email in background — don't block the response
  res.json({ step: 'verify', message: 'Verification code sent to your email' })

  Promise.race([
    sendOTP(email, otp),
    new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 10000)),
  ]).catch(e => console.error('[AUTH] Email send failed:', e.message))
}

async function verify(req, res) {
  const { email, otp } = req.body || {}
  if (!email || !otp) return res.status(400).json({ error: 'Email and code required' })

  const entry = pending.get(email.toLowerCase())
  if (!entry)                    return res.status(400).json({ error: 'No pending signup — please sign up first' })
  if (Date.now() > entry.expiresAt) {
    pending.delete(email.toLowerCase())
    return res.status(400).json({ error: 'Code expired — please sign up again' })
  }
  if (otp.trim() !== entry.otp)  return res.status(400).json({ error: 'Incorrect code' })

  pending.delete(email.toLowerCase())

  const user  = db.create(email, entry.passwordHash)
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' })

  // Start deposit watcher immediately (lazy require to avoid circular dep at module load)
  if (user.walletAddress) {
    const userColony = require('./userColony')
    userColony.watchForDeposit(user.id, user.walletAddress)
  }

  res.status(201).json({
    token,
    user: {
      id:            user.id,
      email:         user.email,
      walletAddress: user.walletAddress,
      colonyStatus:  user.colonyStatus,
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

  // Resume deposit watch if still awaiting (e.g. after server restart)
  if (user.colonyStatus === 'awaiting_deposit' && user.walletAddress) {
    const userColony = require('./userColony')
    userColony.watchForDeposit(user.id, user.walletAddress)
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' })
  res.json({
    token,
    user: {
      id:            user.id,
      email:         user.email,
      walletAddress: user.walletAddress,
      colonyStatus:  user.colonyStatus,
    },
  })
}

function me(req, res) {
  const user = db.findById(req.user.userId)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({
    id:            user.id,
    email:         user.email,
    walletAddress: user.walletAddress,
    colonyStatus:  user.colonyStatus,
    createdAt:     user.createdAt,
    depositInstruction: user.walletAddress
      ? `Send MATIC to ${user.walletAddress} on Polygon (chain ID 137)`
      : null,
  })
}

async function googleAuth(req, res) {
  const { credential } = req.body || {}
  if (!credential) return res.status(400).json({ error: 'Missing Google credential' })

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken:  credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
    const { email, email_verified } = ticket.getPayload()
    if (!email_verified) return res.status(400).json({ error: 'Google email not verified' })

    let user = db.findByEmail(email)
    if (!user) user = db.create(email, null)

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' })

    if (user.colonyStatus === 'awaiting_deposit' && user.walletAddress) {
      const userColony = require('./userColony')
      userColony.watchForDeposit(user.id, user.walletAddress)
    }

    res.json({
      token,
      user: { id: user.id, email: user.email, walletAddress: user.walletAddress, colonyStatus: user.colonyStatus },
      next: user.walletAddress
        ? `Deposit at least ${MIN_DEPOSIT_MATIC} MATIC to ${user.walletAddress} on Polygon to launch your colony`
        : 'Set GAIA_BASE_SIGNING_KEY to enable wallet generation',
    })
  } catch (e) {
    res.status(401).json({ error: 'Invalid Google token' })
  }
}

module.exports = { requireAuth, signup, verify, login, me, googleAuth, JWT_SECRET, MIN_DEPOSIT_MATIC }
