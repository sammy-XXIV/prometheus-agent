---
name: request-session
description: >-
  Authorize this agent to spend on behalf of the user by creating a spending
  session. Invoke before any payment, paid API call (x402-execute), or shopping
  checkout. Handles agent registration, merchant preflight, delegation construction,
  and user approval via passkey. If a task will cost money, this skill must run
  first.
user-invocable: true
allowed-tools:
  - "Bash(bash */setup.sh*)"
  - "Bash(kpass agent:register*)"
  - "Bash(kpass agent:session *)"
  - "Bash(curl *)"
  - "Bash(open *)"
  - "Bash(xdg-open *)"
---

# Request Session

Register the agent identity and create, monitor, or reuse spending sessions with user approval. A session authorizes the agent to spend funds on behalf of the user, gated by a delegation policy (task description, payment policy with per-tx and total caps, optional execution constraints).

## Step 0: Ensure CLI is Installed — MANDATORY

**CRITICAL: Before running ANY kpass command, you MUST run the setup script first. This is NOT optional. Do not skip this step. Do not run any kpass command before setup completes successfully.**

```bash
bash <skill-directory>/scripts/setup.sh
```

Where `<skill-directory>` is the directory containing this SKILL.md file (e.g., the directory this skill is installed in).

**If setup succeeds** (`status: "ok"`): proceed.
**If setup fails** (`status: "error"`): **STOP immediately.** Show the user the error and installation instructions. Do NOT search for the binary elsewhere.

## When to Use This Skill

- The user asks you to make a payment, access a paid API, or perform any action that requires spending.
- The **`shopping`** skill needs a session before checkout. The cart total is the budget source — no 402 preflight needed. **Important:** shopping checkout requires the `crossmint` payment approach, not `x402`.
- Another skill (e.g., `x402-execute`) fails with "Agent not registered" or "No session specified".
- You need to create a new spending session because the previous one expired or was consumed.
- The user wants to see their active sessions.

## Payment Approaches -- Supported Values (Read Before Constructing a Delegation)

The `payment_policy.allowed_payment_approaches` field accepts **exactly one** of the following enum values per session. This is the complete list -- do not invent other values:

| Value | Use when | Notes |
|-------|----------|-------|
| `x402` | Paid API access where the merchant returns 402 Payment Required on preflight | Default for paid-API tasks. Supports `execution_constraints.x402_http` for endpoint scoping. |
| `crossmint` | Shopping checkout (e.g., the **`shopping`** skill, Amazon, Crossmint-backed merchants) | Required for cart checkout -- `x402` is rejected by the backend. No execution constraints needed. |
| `tempo` | Tempo MPP streaming payments | Required for streaming-payment tasks. |

**Do NOT use any other string** -- not a catalog literal (e.g., the merchant's product name), not `"http"`, not `"api"`, not a guess. The backend rejects unknown approaches with `session_mode_forbidden` (exit code 6).

For the full delegation schema, derivation rules, and per-approach examples, see the **`form-session-delegation`** skill.

## Prerequisites

The user MUST be authenticated before using this skill. If not logged in (exit code 3 with "No user_id found" or "Not logged in"), use the **`authenticate-user`** skill first.

**Diagnostics:** If you encounter "agent not registered" or "no active sessions" errors and need to investigate, use the **`manage-agents`** skill to inspect registered agents (`user agents`) and session history (`user sessions`) from the user's perspective.

## Defaults (Do Not Ask the User Unless They Specify Otherwise)

| Setting | Default value | Override |
|---------|--------------|---------|
| Output format | `--output json` | Always use JSON output. Never omit this flag. |
| Agent type | Your own agent identity (e.g., `claude` for Claude Code, `cursor` for Cursor, `codex` for Codex, `cline` for Cline) | Never ask the user. Each agent passes its own name automatically. |
| TTL | `3600` (1 hour) in delegation `ttl_seconds` | Use 1 hour unless the user specifies a different duration. |
| Max amount per tx | Derive automatically from 402 preflight response OR from a known amount (e.g., shopping cart total) | Never ask the user for this. See **`form-session-delegation`** for derivation rules. |
| Max total amount | Derive automatically: per-tx price × estimated requests, or equal to per-tx for single transactions (e.g., shopping checkout) | Never ask the user. See **`form-session-delegation`** for derivation rules. |
| Base URL | Omit (uses built-in default) | Only pass `--base-url` if the user explicitly provides a custom backend URL. |

## Display Cards -- MANDATORY

**CRITICAL: You MUST display the formatted status cards shown in this skill after every major step. This is NOT optional. Never skip, summarize, or replace these cards with plain text. The exact horizontal-rule format must be used every time -- no exceptions.**

If a command succeeds and has a display card template below, you MUST output that card before doing anything else. Do not proceed to the next step until the card is displayed.

---

## Command Reference

### `agent:register` -- Register Agent Identity

Registers this agent with the Passport backend, linking it to the currently logged-in user. Saves the agent token locally.

```
kpass agent:register --type claude --output json
```

**The `--type` value is NOT user-provided.** Each AI agent passes its own identity automatically: `claude` for Claude Code, `cursor` for Cursor, `codex` for Codex, `cline` for Cline. Never ask the user what to put here.

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Agent type | `--type` | Yes | Agent provides automatically -- use your own agent name (e.g., `claude`, `cursor`, `codex`, `cline`) | String identifier for the agent platform. Never ask the user. |
| Owner ID | `--owner-id` | No | Auto-read from config (logged-in user's `user_id`) | Only pass if overriding |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

```json
{
  "agent_id": "agent_abc123",
  "token": "agt_token_value",
  "type": "claude",
  "owner_id": "user_789xyz",
  "_version": "1",
  "status": "success",
  "hint": "Agent registered as claude.",
  "next_command": ""
}
```

#### Already Registered Output (exit code 0)

If the agent is already registered for the current user, the command succeeds silently:

```json
{
  "agent_id": "agent_abc123",
  "type": "claude",
  "owner_id": "user_789xyz",
  "_version": "1",
  "status": "success",
  "hint": "Agent already registered for this user.",
  "next_command": ""
}
```

This is safe to call multiple times. It is idempotent for the same user.

#### Owner Mismatch Behavior

If the agent was previously registered to a different user (e.g., the user logged out and a different user logged in), the command automatically re-registers the agent for the new user. This is not an error.

#### What to Do After This Command

Proceed to check for existing sessions or create a new one.

**MANDATORY -- After this command succeeds, you MUST display the following card to the user. Do not skip this. Do not summarize. Do not replace with plain text:**

For a **new registration**:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 Agent Registered

🏷️  Type:     {type}
🆔 Agent ID: {agent_id}
👤 Owner:    {owner_email}
🔑 Token:    saved to project config

Your agent is ready.
Create a spending session to start.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{type}` | From JSON response field `type` |
| `{agent_id}` | From JSON response field `agent_id` |
| `{owner_email}` | From the user's email already known from the login/signup step (not in the register response) |

For the **already registered** no-op case (hint contains "already registered"):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 Agent Already Registered

🏷️  Type:     {type}
🆔 Agent ID: {agent_id}
✅ Status:   Ready
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{type}` | From JSON response field `type` |
| `{agent_id}` | From JSON response field `agent_id` |

**You MUST always display the appropriate card after a successful response. No exceptions.** Fill in all placeholders from the JSON output.

---

### `agent:session list` -- List Agent Sessions

Lists sessions for the registered agent, optionally filtered by status.

```
kpass agent:session list --output json
kpass agent:session list --status active --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Status filter | `--status` | No | Pass `active` to filter for usable sessions | String: `active`, `expired`, or omit for all |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output -- Sessions Found (exit code 0)

```json
{
  "sessions": [
    {
      "id": "session_abc123",
      "status": "active",
      "expires_at": "2026-03-17T13:00:00Z",
      "delegation": {
        "task": {
          "summary": "Query the weather API for forecasts."
        },
        "payment_policy": {
          "allowed_payment_approaches": ["x402"],
          "assets": ["USDC"],
          "max_amount_per_tx": "5.00",
          "max_total_amount": "50.00"
        }
      },
      "usage": {
        "spent_total": "10.00",
        "reserved_total": "0.00"
      }
    }
  ],
  "_version": "1",
  "status": "success",
  "hint": "Found 1 session(s).",
  "next_command": ""
}
```

#### Success Output -- No Sessions (exit code 0)

```json
{
  "sessions": [],
  "_version": "1",
  "status": "success",
  "hint": "No active sessions found.",
  "next_command": ""
}
```

#### What to Do After This Command — MANDATORY Reuse Evaluation

**CRITICAL: Before creating a new session, you MUST evaluate every returned active session against ALL six checks below. This is NOT optional. A session is reusable ONLY when EVERY check passes. If any check fails, create a new session instead. Never reuse based on a single field (e.g., "it's active and has budget") — all checks must pass together.**

For each active session, verify ALL of the following:

1. **Goal match** — The current user goal fits within the existing `delegation.task.summary`. The merchant/service AND the kind of action must match. If the new goal targets a different merchant, a different action, or a materially broader scope than the stored summary, this check FAILS. When in doubt, FAIL — a fresh session is cheap; a wrong-scope reuse is a policy violation.
2. **Asset match** — The required payment asset appears in `delegation.payment_policy.assets`.
3. **Per-tx fit** — The expected per-request price is ≤ `delegation.payment_policy.max_amount_per_tx`.
4. **Budget fit** — The expected total spend for the task is ≤ remaining budget, where `remaining = max_total_amount − usage.spent_total − usage.reserved_total`.
5. **Not expired** — `expires_at` is in the future AND leaves enough time to complete the task.
6. **Scope match** — If `execution_constraints.x402_http.scope_mode == "scoped"`, the target endpoint (`method`, `host`, `path_prefix`) MUST match one of `allowed_endpoints`. If `scope_mode` is unscoped or `execution_constraints` is absent, this check passes.

**MANDATORY — Before reusing, you MUST display the Session Reuse Evaluation card showing the per-check result. Do not skip this. Do not summarize. Do not replace with plain text:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔎 Session Reuse Evaluation

🎫 Session:      {session_id}
📝 Goal match:   {✅|❌} — {reason}
💱 Asset match:  {✅|❌} — need {asset}, have {assets}
💰 Per-tx fit:   {✅|❌} — need ≤ {price}, limit {max_amount_per_tx}
💰 Budget fit:   {✅|❌} — need {estimate}, remaining {remaining}
⏰ Not expired:  {✅|❌} — expires {expires_at}
🎯 Scope match:  {✅|❌} — {scope_detail}

Decision: {Reuse this session | Create new session}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Resolution:

- **0 sessions returned** → proceed to create a new session (Steps 3–6 below).
- **All 6 checks pass for exactly one session** → reuse it. If it is not already the current session, call `agent:session use --session-id <id>` first. Then display the `🚀 Session Approved` card (from `agent:session status` above) as the post-decision confirmation so the user sees the active session details.
- **All 6 checks pass for 2+ sessions** → display the evaluation card for each candidate, then ask the user which to use.
- **No session passes all 6 checks** → proceed to create a new session. Briefly tell the user which check(s) failed so they understand why a new approval is needed.

---

### `agent:session create` -- Create a Spending Session with Delegation

Creates a new spending session request using a delegation object. The user MUST approve it via the returned `approval_url` before the session becomes active.

```
kpass agent:session create --delegation '<JSON>' --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Delegation | `--delegation` | Yes | Constructed from preflight + user context. See the **`form-session-delegation`** skill for the full schema and construction rules. | Must be a valid JSON string containing a `delegation` object. |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

**The `--delegation` flag accepts an inline JSON string.** Wrap with single quotes on the outside for shell safety. See the delegation construction section below and the **`form-session-delegation`** skill for the complete schema.

#### Success Output (exit code 0)

```json
{
  "action": "approve_session",
  "request_id": "req_abc123",
  "approval_url": "https://passport.dev.gokite.ai/approve/req_abc123",
  "expires_at": "2026-03-17T12:05:00Z",
  "_version": "1",
  "status": "human_action_required",
  "hint": "A session request was created. Show the approval URL to the user: https://passport.dev.gokite.ai/approve/req_abc123",
  "next_command": "kpass agent:session status --request-id req_abc123 --output json"
}
```

**Key fields:**
- `status` is `"human_action_required"` -- NOT an error. Exit code is 0.
- `request_id` -- needed for polling the approval status.
- `approval_url` -- MUST be shown to the user. This is the URL where they review and approve the session.
- `next_command` -- contains the `agent:session status` command to check approval (the agent manages polling timing -- see the Polling Strategy section below).

#### What to Do After This Command

1. **Show the approval URL to the user** by displaying the mandatory card below.
2. **MANDATORY — Open the approval URL in the user's default browser automatically. Do not skip this.**
   ```bash
   open "{approval_url}"          # macOS
   xdg-open "{approval_url}"      # Linux
   start "{approval_url}"         # Windows
   ```
   Detect the OS and use the appropriate command. This saves the user from having to copy-paste the URL. If the `open` command fails, the URL is still in the card — the user can click or copy it manually. **You MUST attempt to open the browser. No exceptions.**
3. **Immediately start polling for approval** using `agent:session status --request-id <request_id> --wait --output json`. This is MANDATORY -- never skip this step. Never just tell the user to "let me know when done" without polling first. See the Polling Strategy in the `agent:session status` section below.

**CRITICAL:** Do NOT attempt to execute any transactions until the session is approved. The session is not active until the user approves it.

**MANDATORY -- After this command succeeds, you MUST display the following card to the user. Do not skip this. Do not summarize. Do not replace with plain text:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ Approval Required

A spending session needs your approval:

🌐 {approval_url}

📝 Task:           {task_summary}
💰 Per-tx limit:    {max_amount_per_tx} {assets}
💰 Total budget:    {max_total_amount} {assets}
⏰ Valid for:       {ttl_human_readable}
🔒 Payment method:  {allowed_payment_approaches}
📋 Request ID:      {request_id}

👆 Open the link, review, and approve with passkey.
⏳ I'll wait automatically...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{approval_url}` | From JSON response field `approval_url` |
| `{task_summary}` | From the delegation `task.summary` you constructed |
| `{max_amount_per_tx}` | From the delegation `payment_policy.max_amount_per_tx` |
| `{max_total_amount}` | From the delegation `payment_policy.max_total_amount` (if set; omit line if not set) |
| `{assets}` | From the delegation `payment_policy.assets` (e.g., `USDC`). If not set, omit. |
| `{ttl_human_readable}` | Calculate from the delegation `payment_policy.ttl_seconds` (e.g., `3600` -> "1 hour") |
| `{allowed_payment_approaches}` | From the delegation `payment_policy.allowed_payment_approaches` (e.g., `x402`) |
| `{request_id}` | From JSON response field `request_id` |

**You MUST always display this card after a successful response. No exceptions.** Fill in all placeholders from the delegation you constructed and the JSON output.

---

### `agent:session status` -- Check Session Approval Status

Checks the current status of a session approval request. Use with `--wait` to automatically poll until approved, rejected, expired, or timed out (5 minutes).

```
kpass agent:session status --request-id <request_id> --wait --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Request ID | `--request-id` | Yes | From `agent:session create` output: `request_id` field | String starting with `req_` |
| Wait for resolution | `--wait` | Yes (MANDATORY) | Always pass | Polls every 3 seconds for up to 300 seconds (5 minutes) |
| Poll interval | `--poll-interval` | No | Default `3` (seconds) | Positive integer. Do not change unless instructed. |
| Timeout | `--timeout` | No | Default `300` (seconds = 5 minutes) | Positive integer. Do not change unless instructed. |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Polling Strategy -- MANDATORY

**CRITICAL: After creating a session and showing the approval card, you MUST immediately start polling for approval. This is NOT optional. Never skip polling. Never just tell the user to "let you know" without polling first.**

Use the `--wait` flag with default settings (3-second intervals, 300-second timeout):

```
kpass agent:session status --request-id <request_id> --wait --output json
```

This polls the backend every 3 seconds for up to 5 minutes automatically.

**If approved within 5 minutes:** The command returns success with the session details. Display the "Session Approved" card and proceed.

**If 5 minutes pass without approval (timeout):** The command returns with a pending/timeout status. At this point, STOP polling and tell the user:

```
Still waiting for your approval. Please let me know once you've approved the session, and I'll check the status.
```

Then wait for the user to respond. When they indicate approval (e.g., "done", "approved", "I approved it", "ok"), do a single status check:

```
kpass agent:session status --request-id <request_id> --output json
```

If still pending after the user says they approved, retry 2-3 more times with short pauses, then inform the user there may be an issue:

```
The session still shows as pending. There might be an issue with the approval. Please try visiting the approval link again: {approval_url}
```

**The flow is always:**
1. Create session -> show approval card (MANDATORY)
2. Start polling immediately with `--wait` (MANDATORY -- never skip this)
3. If timeout -> ask user and wait for their signal
4. On user signal -> single check (without `--wait`)

#### Approved Output (exit code 0)

When the user approves the session:

```json
{
  "request_id": "req_abc123",
  "session_id": "session_xyz789",
  "session": {
    "id": "session_xyz789",
    "status": "active",
    "expires_at": "2026-03-17T13:00:00Z",
    "delegation": {
      "task": {
        "summary": "Query the weather API for forecasts."
      },
      "payment_policy": {
        "allowed_payment_approaches": ["x402"],
        "assets": ["USDC"],
        "max_amount_per_tx": "5.00",
        "max_total_amount": "50.00"
      }
    },
    "usage": {
      "spent_total": "0.00",
      "reserved_total": "0.00"
    }
  },
  "current_session_id": "session_xyz789",
  "_version": "1",
  "status": "success",
  "hint": "Session approved and set as current. Expires at 2026-03-17T13:00:00Z.",
  "next_command": ""
}
```

**Important:** When a session is approved, the CLI automatically sets `current_session_id` in the agent config. You do NOT need to run `agent:session use` separately after approval.

**MANDATORY -- After this command returns an approved session, you MUST display the following card to the user. Do not skip this. Do not summarize. Do not replace with plain text:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 Session Approved -- Ready to Transact!

🎫 Session:     {session_id}
📝 Task:        {task_summary}
💰 Per-tx:      Up to {max_amount_per_tx} {assets}
💰 Budget:      {max_total_amount} {assets}
📊 Spent:       {spent_total} / {max_total_amount}
⏰ Expires:     {expires_at}
✅ Status:      Active

All set. I can now execute payments on your behalf.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{session_id}` | From JSON response field `session_id` or `session.id` |
| `{task_summary}` | From JSON response field `session.delegation.task.summary` |
| `{max_amount_per_tx}` | From JSON response field `session.delegation.payment_policy.max_amount_per_tx` |
| `{max_total_amount}` | From JSON response field `session.delegation.payment_policy.max_total_amount` (if set; show "unlimited" if not) |
| `{assets}` | From JSON response field `session.delegation.payment_policy.assets` (e.g., `USDC`). If not set, omit. |
| `{spent_total}` | From JSON response field `session.usage.spent_total` |
| `{expires_at}` | From JSON response field `session.expires_at` |

**You MUST always display this card after an approved session response. No exceptions.** Fill in all placeholders from the JSON output.

#### Rejected Output (exit code 3)

```json
{
  "_version": "1",
  "status": "error",
  "error": "Session request was rejected by the user.",
  "hint": "Create a new session request with 'kpass agent:session create'.",
  "next_command": ""
}
```

If rejected, inform the user: "The session request was not approved. Would you like me to create a new one, perhaps with different terms?"

#### Expired Output (exit code 3)

```json
{
  "_version": "1",
  "status": "error",
  "error": "Session request expired before approval.",
  "hint": "Create a new session request with 'kpass agent:session create'.",
  "next_command": ""
}
```

If expired, inform the user and offer to create a new session request.

#### Pending Output (exit code 0)

```json
{
  "request_id": "req_abc123",
  "expires_at": "2026-03-17T12:05:00Z",
  "_version": "1",
  "status": "pending",
  "hint": "Session request is still pending approval.",
  "next_command": "kpass agent:session status --request-id req_abc123 --output json"
}
```

This means the user has not yet approved, rejected, or let the request expire. If you used `--wait` and received this after timeout, follow the stop-and-ask flow described in the Polling Strategy above.

---

### `agent:session use` -- Set Current Session

Sets a specific session as the current active session in the agent config. Use this when you want to switch to a different session.

```
kpass agent:session use --session-id <session_id> --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Session ID | `--session-id` | Yes | From `agent:session list` or `agent:session status` output | String starting with `session_` |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

```json
{
  "current_session_id": "session_xyz789",
  "_version": "1",
  "status": "success",
  "hint": "Current session set to session_xyz789. The agent is ready to transact.",
  "next_command": ""
}
```

**Note:** You usually do NOT need to call this command after `agent:session status` returns `approved`, because that command auto-sets the current session. Use `agent:session use` only when switching between multiple sessions.

---

## Full Session Creation Flow

The delegation model adds preflight discovery and structured delegation construction. Here is the complete flow.

### Step 1: Ensure Agent is Registered

```bash
kpass agent:register --type claude --output json
```

Idempotent, safe to call every time. Display the registration card.

### Step 2: Check for Existing Active Sessions — MANDATORY Reuse Evaluation

```bash
kpass agent:session list --status active --output json
```

**You MUST run the six-check Reuse Evaluation defined under `agent:session list` → "What to Do After This Command" against every returned session, and display the `🔎 Session Reuse Evaluation` card before making a decision. Only reuse when ALL six checks pass (goal match, asset match, per-tx fit, budget fit, not expired, scope match). Otherwise, proceed to create a new session.**

### Step 3: Get Merchant URL

If the user has not provided a merchant URL or service endpoint, ask:

> "What is the merchant URL or service you want to access?"

You need the URL to perform preflight discovery and to potentially scope the delegation.

### Step 4: Preflight -- Discover Payment Requirements — MANDATORY

**CRITICAL: You MUST perform a preflight request to the merchant URL before creating a session. This is NOT optional. Do not skip this step. Do not guess the payment requirements. Do not ask the user for tx limits or budget — derive them from the 402 response.**

Use `curl` to probe the merchant URL:

```bash
curl -s -w "\n%{http_code}" <MERCHANT_URL>
```

Or for POST endpoints:

```bash
curl -s -w "\n%{http_code}" -X POST <MERCHANT_URL> -H "Content-Type: application/json"
```

Parse the response. See the **`form-session-delegation`** skill for detailed guidance on parsing 402 responses. The structure varies by merchant -- there is no standard schema.

If the preflight does not return a 402, or you cannot parse the 402 response, use conservative defaults (`max_amount_per_tx: "1"`, `max_total_amount: "10"`, `assets: ["USDC"]`) and note this in the confirmation card. Do NOT ask the user for individual parameter values — let them review and adjust via the confirmation card.

**MANDATORY — After parsing the 402 response, you MUST display the Payment Requirements Discovered card to the user. Do not skip this. Do not summarize. Do not replace with plain text:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Payment Requirements Discovered

🏪 Merchant:   {merchant_host}
🌐 Endpoint:   {method} {merchant_url}
💰 Price:      {amount} {asset} per request
⛓️  Network:    {network}
📦 Resource:   {resource_description}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**You MUST always display this card after a successful 402 parse. No exceptions.** See `form-session-delegation` skill for the full field mapping.

### Step 5: Confirm Session Parameters with User — MANDATORY

**CRITICAL: Before creating the session, you MUST present the proposed session parameters to the user and get explicit confirmation. Never create a session without user confirmation.**

Construct the delegation parameters from the 402 response + user context (see `form-session-delegation` skill for construction rules), then display:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Proposed Session Parameters

🏪 Merchant:         {merchant_host}
📝 Task:             {task_summary}
💰 Per-tx limit:     {max_amount_per_tx} {asset}
💰 Total budget:     {max_total_amount} {asset}
⏰ Session duration: {ttl_human_readable}
🔒 Payment method:   x402
🎯 Scope:            {scope_description}

Shall I proceed with creating this session?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**You MUST always display this card and wait for the user to confirm before proceeding. No exceptions.**

The user may:
- **Confirm** ("yes", "proceed", "looks good") → proceed to Step 6
- **Adjust** ("make the budget 50", "change TTL to 2 hours") → update parameters and show the card again
- **Cancel** ("no", "cancel") → stop

### Step 6: Construct the Delegation

Only after user confirmation, build the delegation JSON from:
1. The user's stated goal (becomes `task.summary`)
2. The 402 preflight response (asset, amount per request)
3. The confirmed parameters from Step 5
4. The endpoint scope (from the merchant URL)

See the **`form-session-delegation`** skill for the complete schema, construction rules, validation checklist, and examples.

### Step 7: Create Session with `--delegation`

```bash
kpass agent:session create --delegation '<DELEGATION_JSON>' --output json
```

Display the mandatory approval card with delegation details.

### Step 8: Poll for Approval

```bash
kpass agent:session status --request-id <request_id> --wait --output json
```

Follow the polling strategy described in the `agent:session status` section above. Display the mandatory approved card when the session is approved.

---

## Complete Worked Example: Preflight and Create Session

**Context:** The user says "I want to query the weather API at https://weather.example.com/v1/forecast"

**Step 1:** Register the agent.
```bash
kpass agent:register --type claude --output json
```
Output: Agent already registered. Display "Agent Already Registered" card.

**Step 2:** Check for existing active sessions.
```bash
kpass agent:session list --status active --output json
```
Output: No active sessions. Proceed to create one.

**Step 3:** Merchant URL is already known: `https://weather.example.com/v1/forecast`

**Step 4:** Preflight the merchant URL.
```bash
curl -s -w "\n%{http_code}" -X POST https://weather.example.com/v1/forecast -H "Content-Type: application/json"
```
Output:
```
{"error":"payment required","payment":{"accepts":[{"asset":"USDC","amount":"1.00","network":"kite"}]},"resource":"/v1/forecast"}
402
```
Parsed: The service requires **1.00 USDC** per request for the `/v1/forecast` endpoint.

**Step 5:** Construct the delegation. The user wants to query forecasts. Set per-tx to match the price, total budget for a few queries, scope to the known endpoint.
```json
{
  "delegation": {
    "task": {
      "summary": "Query the weather forecast API at weather.example.com."
    },
    "payment_policy": {
      "allowed_payment_approaches": ["x402"],
      "assets": ["USDC"],
      "max_amount_per_tx": "1",
      "max_total_amount": "10",
      "ttl_seconds": 3600
    },
    "execution_constraints": {
      "x402_http": {
        "scope_mode": "scoped",
        "allowed_endpoints": [
          {
            "method": "POST",
            "host": "weather.example.com",
            "path_prefix": "/v1/forecast"
          }
        ]
      }
    }
  }
}
```

**Step 6:** Create the session.
```bash
kpass agent:session create --delegation '{"task":{"summary":"Query the weather forecast API at weather.example.com."},"payment_policy":{"allowed_payment_approaches":["x402"],"assets":["USDC"],"max_amount_per_tx":"1","max_total_amount":"10","ttl_seconds":3600},"execution_constraints":{"x402_http":{"scope_mode":"scoped","allowed_endpoints":[{"method":"POST","host":"weather.example.com","path_prefix":"/v1/forecast"}]}}}' --output json
```
Output:
```json
{
  "action": "approve_session",
  "request_id": "req_abc123",
  "approval_url": "https://passport.dev.gokite.ai/approve/req_abc123",
  "expires_at": "2026-03-17T12:05:00Z",
  "_version": "1",
  "status": "human_action_required",
  "hint": "A session request was created. Show the approval URL to the user: https://passport.dev.gokite.ai/approve/req_abc123",
  "next_command": "kpass agent:session status --request-id req_abc123 --output json"
}
```

Display the mandatory approval card:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ Approval Required

A spending session needs your approval:

🌐 https://passport.dev.gokite.ai/approve/req_abc123

📝 Task:           Query the weather forecast API at weather.example.com.
💰 Per-tx limit:    1 USDC
💰 Total budget:    10 USDC
⏰ Valid for:       1 hour
🔒 Payment method:  x402
📋 Request ID:      req_abc123

👆 Open the link, review, and approve with passkey.
⏳ I'll wait automatically...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Step 7:** Poll for approval.
```bash
kpass agent:session status --request-id req_abc123 --wait --output json
```
Output (user approves):
```json
{
  "request_id": "req_abc123",
  "session_id": "session_xyz789",
  "session": {
    "id": "session_xyz789",
    "status": "active",
    "expires_at": "2026-03-17T13:00:00Z",
    "delegation": {
      "task": {
        "summary": "Query the weather forecast API at weather.example.com."
      },
      "payment_policy": {
        "allowed_payment_approaches": ["x402"],
        "assets": ["USDC"],
        "max_amount_per_tx": "1.00",
        "max_total_amount": "10.00"
      }
    },
    "usage": {
      "spent_total": "0.00",
      "reserved_total": "0.00"
    }
  },
  "current_session_id": "session_xyz789",
  "_version": "1",
  "status": "success",
  "hint": "Session approved and set as current. Expires at 2026-03-17T13:00:00Z.",
  "next_command": ""
}
```

Display the mandatory approved card:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 Session Approved -- Ready to Transact!

🎫 Session:     session_xyz789
📝 Task:        Query the weather forecast API at weather.example.com.
💰 Per-tx:      Up to 1.00 USDC
💰 Budget:      10.00 USDC
📊 Spent:       0.00 / 10.00
⏰ Expires:     2026-03-17T13:00:00Z
✅ Status:      Active

All set. I can now execute payments on your behalf.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Ready to execute transactions with the `x402-execute` skill.

---

## Complete Worked Example: Reuse Existing Session

**Step 1:** Check for existing active sessions.
```bash
kpass agent:session list --status active --output json
```
Output:
```json
{
  "sessions": [
    {
      "id": "session_xyz789",
      "status": "active",
      "expires_at": "2026-03-17T13:00:00Z",
      "delegation": {
        "task": {
          "summary": "Query the weather forecast API at weather.example.com."
        },
        "payment_policy": {
          "allowed_payment_approaches": ["x402"],
          "assets": ["USDC"],
          "max_amount_per_tx": "1.00",
          "max_total_amount": "10.00"
        }
      },
      "usage": {
        "spent_total": "3.00",
        "reserved_total": "0.00"
      }
    }
  ],
  "_version": "1",
  "status": "success",
  "hint": "Found 1 session(s).",
  "next_command": ""
}
```

Run the six-check Reuse Evaluation and display the card. Example (current goal: "query weather forecast at weather.example.com", scoped to `POST /v1/forecast`, expected spend ~2 USDC):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔎 Session Reuse Evaluation

🎫 Session:      session_xyz789
📝 Goal match:   ✅ — same merchant + forecast queries
💱 Asset match:  ✅ — need USDC, have [USDC]
💰 Per-tx fit:   ✅ — need ≤ 1.00, limit 1.00
💰 Budget fit:   ✅ — need 2.00, remaining 7.00
⏰ Not expired:  ✅ — expires 2026-03-17T13:00:00Z
🎯 Scope match:  ✅ — POST weather.example.com/v1/forecast allowed

Decision: Reuse this session
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

All six checks pass → reuse.

**Step 2:** Set it as the current session (only needed if not already current).
```bash
kpass agent:session use --session-id session_xyz789 --output json
```

Ready to execute transactions.

---

## Error Handling

| Exit Code | Meaning | Error Message Pattern | Recovery Action |
|-----------|---------|----------------------|-----------------|
| 0 | Success or human action required | `status: "human_action_required"` | Show approval URL to user. Wait for approval. |
| 1 | Network error | `network error: ...` | Check connectivity. Retry after a brief pause. |
| 2 | Usage error | `--delegation is required`, `Invalid delegation JSON`, `delegation.payment_policy.max_amount_per_tx is required` | Fix the delegation JSON. Check required fields. |
| 3 | Auth error | `Agent not registered`, `No user_id found`, `Agent is registered to a different user`, `Session request rejected`, `Session request expired` | See specific scenarios below. |
| 4 | Not found | `not found` | Verify the request_id or session_id is correct. |
| 5 | Rate limited | `rate limit` | Wait 30 seconds, then retry. |
| 6 | Session policy / payment violation | `error_code: "session_mode_forbidden"`, `"session_asset_forbidden"`, `"session_rule_exceeded"`, `"session_total_exceeded"`, `"session_endpoint_forbidden"`, `"session_forbidden"`, `"session_owner_forbidden"`, `"payment_target_forbidden"`, `"payment_redirect_not_allowed"`, `"session_request_forbidden"` | Do NOT re-authenticate. Create a new session with corrected parameters. Check `error_code` and `hint` for the specific violation. |

**Error envelope fields:** Error responses include `error` (raw backend message), `error_code` (machine-readable classification — prefer this for programmatic matching), and `hint` (recovery guidance).

### Specific Error Scenarios

**"No user_id found. Run signup or login first." (exit code 3):**
- The user is not logged in. Use the **`authenticate-user`** skill to sign up or log in.

**"Agent not registered. Run 'kpass agent:register --type <type>' first." (exit code 3):**
- Run `agent:register --type claude --output json` before using any session commands. (Replace `claude` with your own agent identity if you are not Claude Code.)
- To investigate from the user's perspective, use `user agents --output json` (see the **`manage-agents`** skill) to verify what agents are registered.

**"Agent is registered to a different user" (exit code 3):**
- The user switched accounts. Run `agent:register --type claude --output json` to re-register for the current user. This automatically updates the agent config.

**"Invalid delegation JSON" or "delegation.payment_policy.max_amount_per_tx is required" (exit code 2):**
- The `--delegation` flag value is not valid JSON, or a required field is missing. Check the delegation schema in the **`form-session-delegation`** skill and fix the JSON.

**Session request rejected (exit code 3):**
- The user chose not to approve. Ask if they want to create a new session with different terms.

**Session request expired (exit code 3):**
- The approval URL timed out. Create a new session request.

---

## Commands That DO NOT Exist

Do NOT attempt any of the following. They will fail:

- `kpass agent:session` (without a sub-command) -- must use `list`, `create`, `status`, `use`, or `execute`
- `kpass agent:register --agent-app` -- the flag is `--type`, not `--agent-app`
- `kpass agent:register --name` -- does not exist; use `--type`
- `kpass agent:register --type <AGENT_TYPE>` with a user-provided value -- the `--type` value is NEVER user-provided. The agent always passes its own identity (e.g., `claude`, `cursor`, `codex`, `cline`). Do not ask the user what agent type to use.
- `kpass agent:balance` -- does not exist; use `wallet balance` for balance checks
- `kpass agent:session create --max-amount-per-tx` -- **REMOVED.** Use `--delegation` with the full delegation JSON instead.
- `kpass agent:session create --ttl` -- **REMOVED.** TTL is now inside the delegation JSON as `payment_policy.ttl_seconds`.
- `kpass agent:session create --ttl-seconds` -- **REMOVED.** Use `--delegation` with `payment_policy.ttl_seconds`.
- `kpass agent:session create --budget` -- does not exist
- `kpass agent:session create --currency` -- does not exist
- `kpass agent:session create --expires-in` -- does not exist
- `kpass agent:session create --allowed-domains` -- does not exist
- `kpass agent:session create --spending-rules` -- does not exist. The old `spending_rules` model is replaced by `delegation`.
- `kpass agent:session status --session-id` -- the flag is `--request-id`, not `--session-id`
- `kpass agent:session status` without `--wait` as the primary polling method -- Always use `--wait` for the initial polling phase. Only omit `--wait` for single follow-up checks after the user signals they have approved.
- Any command with `--json` -- the correct flag is `--output json` (two separate tokens)

---

## Input Validation Checklist

Before running any command, verify:

1. **Agent type:** Your own agent identity string, no spaces. Use `claude` for Claude Code, `cursor` for Cursor, `codex` for Codex, `cline` for Cline. Never ask the user.
2. **Delegation JSON:** Must be valid JSON. Must contain a `delegation` object with `task.summary`, `payment_policy.allowed_payment_approaches`, `payment_policy.max_amount_per_tx`, and `payment_policy.ttl_seconds` at minimum. See the **`form-session-delegation`** skill for the complete schema.
3. **Session ID:** Must come from a `session list` or `session status` response. Do not fabricate values.
4. **Request ID:** Must come from a `session create` response. Do not fabricate values.

---

## Recommended Flow

The standard sequence for setting up agent spending capability:

```
1. authenticate-user skill       -->  User is logged in
2. agent:register                -->  Agent is registered
3. agent:session list            -->  Check for existing sessions
4. Get merchant URL from user    -->  Know what service to access
5. curl preflight                -->  Discover payment requirements (402)
6. Construct delegation          -->  Build policy from 402 + user context
7. agent:session create          -->  Create session with --delegation
8. agent:session status --wait   -->  Wait for user approval
9. x402-execute or               -->  Execute transactions
   wallet-send skill
```

---

## Cross-Skill References

- **Prerequisite:** The user must be authenticated. Use the **`authenticate-user`** skill if the user is not logged in.
- **Delegation construction:** For the complete delegation schema, construction rules, validation checklist, and examples, see the **`form-session-delegation`** skill.
- **After session is active:** To execute x402 paid API requests, use the **`x402-execute`** skill.
- **For direct wallet transfers (no session):** Use the **`wallet-send`** skill.
- **For diagnostics:** To inspect registered agents and sessions from the user's perspective, use the **`manage-agents`** skill (`user agents`, `user sessions`).
