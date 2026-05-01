/**
 * registry.js — Colony Identity Registry
 *
 * Tracks every child agent's Kite Passport identity.
 * Attempts kpass agent:register on spawn; falls back to a
 * deterministic Kite-style ID derived from the child's wallet
 * when the CLI is unavailable (e.g. kernel incompatibility).
 *
 * kpass JSON response shapes used here:
 *   agent:register  → { id, type, created_at, _version, status, hint }
 *   agent:session create → { session_request_id (or request_id), _version, status, hint }
 *   agent:session status → { session_id (or id), status, _version, hint }
 */

const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs')

const REGISTRY_PATH = path.join(__dirname, '../data/registry.json')
const KPASS_BIN = process.env.KPASS_BIN ||
  path.join(process.env.HOME || '', '.local/bin/kpass')

// In-memory registry: childId → identity record
const registry = new Map()

// ── Persistence ───────────────────────────────────────────────

function ensureDataDir() {
  const dir = path.dirname(REGISTRY_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function saveRegistry() {
  try {
    ensureDataDir()
    const out = {}
    for (const [id, rec] of registry) out[id] = rec
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(out, null, 2))
  } catch (e) {
    console.log('[REGISTRY] Save failed:', e.message)
  }
}

function loadRegistry() {
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
      for (const [id, rec] of Object.entries(raw)) registry.set(id, rec)
      console.log(`[REGISTRY] Loaded ${registry.size} identit${registry.size !== 1 ? 'ies' : 'y'}`)
    }
  } catch (e) {
    console.log('[REGISTRY] Load failed:', e.message)
  }
}

// ── kpass wrapper ─────────────────────────────────────────────

function kpass(args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(KPASS_BIN, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: err.message, raw: stderr || stdout })
        return
      }
      try {
        const data = JSON.parse(stdout.trim())
        resolve({ ok: data.status === 'success' || data.status === 'pending', data })
      } catch {
        resolve({ ok: false, error: 'JSON parse failed', raw: stdout })
      }
    })
  })
}

// ── Fallback deterministic ID ─────────────────────────────────
// Format mirrors Kite agent IDs: "agent_<12 hex chars>"

function fallbackAgentId(childId, walletAddress) {
  const { createHash } = require('crypto')
  const seed = (walletAddress || childId).toLowerCase().replace('0x', '')
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 12)
  return `agent_${hex}`
}

// ── Agent registration ────────────────────────────────────────

async function registerAgent(child) {
  const childId = child.id
  const walletAddress = child.walletAddress || ''

  // Skip if already registered
  if (registry.has(childId)) return registry.get(childId)

  const record = {
    childId,
    walletAddress,
    kiteAgentId: null,
    sessionRequestId: null,
    sessionId: null,
    sessionStatus: 'none',
    registeredAt: new Date().toISOString(),
    kpassAvailable: false,
    generation: child.generation,
    specialization: child.genome?.specialization || 'generalist',
  }

  // Try kpass agent:register
  const regResult = await kpass([
    'agent:register',
    '--type', 'autonomous',
    '--output', 'json',
  ])

  if (regResult.ok && regResult.data) {
    const d = regResult.data
    // Field may be id, agent_id, or nested
    record.kiteAgentId = d.id || d.agent_id || d.agents?.[0]?.id || fallbackAgentId(childId, walletAddress)
    record.kpassAvailable = true
    console.log(`[REGISTRY] ✓ kpass registered ${childId} → ${record.kiteAgentId}`)
  } else {
    record.kiteAgentId = fallbackAgentId(childId, walletAddress)
    if (regResult.error?.includes('SIGSYS') || regResult.error?.includes('bad system call') ||
        regResult.error?.includes('not found') || regResult.error?.includes('ENOENT')) {
      // kpass not runnable on this platform — suppress repeated warnings
      if (registry.size === 0) {
        console.log(`[REGISTRY] kpass unavailable (kernel incompatibility) — using deterministic IDs`)
      }
    } else {
      console.log(`[REGISTRY] kpass register failed: ${regResult.error || 'unknown'} — using fallback ID`)
    }
  }

  // Try creating a spending session
  await createSession(childId, record, child)

  registry.set(childId, record)
  saveRegistry()

  console.log(`[REGISTRY] ${childId} → ${record.kiteAgentId} (session: ${record.sessionStatus})`)
  return record
}

async function createSession(childId, record, child) {
  const taskSummary = `GAIA child agent ${childId} — autonomous earning, spec: ${child.genome?.specialization || 'generalist'}`

  const delegation = JSON.stringify({
    task: { summary: taskSummary },
    payment_policy: {
      allowed_payment_approaches: ['x402'],
      assets: ['USDC'],
      max_amount_per_tx: '0.5',
      max_total_amount: '1',
      ttl_seconds: 86400,
    },
  })

  const sessResult = await kpass([
    'agent:session', 'create',
    '--delegation', delegation,
    '--output', 'json',
  ])

  if (sessResult.ok && sessResult.data) {
    const d = sessResult.data
    record.sessionRequestId = d.session_request_id || d.request_id || d.id || null
    record.sessionStatus = 'pending'
    console.log(`[REGISTRY] Session request ${record.sessionRequestId} pending approval`)

    // Try to wait for approval (non-blocking — if it times out, that's fine)
    if (record.sessionRequestId) {
      waitForSessionApproval(childId, record.sessionRequestId).catch(() => {})
    }
  } else {
    record.sessionStatus = record.kpassAvailable ? 'failed' : 'unavailable'
  }
}

async function waitForSessionApproval(childId, requestId) {
  const result = await kpass([
    'agent:session', 'status',
    '--request-id', requestId,
    '--wait',
    '--output', 'json',
  ], 120000) // 2-minute wait

  const rec = registry.get(childId)
  if (!rec) return

  if (result.ok && result.data) {
    const d = result.data
    rec.sessionId = d.session_id || d.id || requestId
    rec.sessionStatus = d.status === 'approved' ? 'active' : (d.status || 'approved')
    saveRegistry()
    console.log(`[REGISTRY] Session ${rec.sessionId} approved for ${childId}`)
  } else {
    rec.sessionStatus = 'approval-timeout'
    saveRegistry()
  }
}

// ── Mark deceased in registry ─────────────────────────────────

function markDeceased(childId) {
  const rec = registry.get(childId)
  if (!rec) return
  rec.deceased = true
  rec.deceasedAt = new Date().toISOString()
  saveRegistry()
}

// ── Accessors ─────────────────────────────────────────────────

function getIdentity(childId) {
  return registry.get(childId) || null
}

function getAllIdentities() {
  return [...registry.values()]
}

function getLivingIdentities() {
  return [...registry.values()].filter(r => !r.deceased)
}

// ── Init ──────────────────────────────────────────────────────

loadRegistry()

module.exports = {
  registerAgent,
  markDeceased,
  getIdentity,
  getAllIdentities,
  getLivingIdentities,
  registry,
}
