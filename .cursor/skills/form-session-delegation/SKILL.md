---
name: form-session-delegation
description: Construct a delegation object for agent session creation. Covers preflight discovery, 402 response parsing, and delegation schema. Called by request-session, not directly by users.
user-invocable: false
allowed-tools:
  - "Bash(curl *)"
  - "Bash(kpass agent:session create *)"
---

# Form Session Delegation

Use this skill when you need to create an agent session in Passport and must construct the `delegation` object correctly. This skill is a helper -- it is called by the **`request-session`** skill, not triggered directly by the user.

## Goal

Produce a valid `delegation` draft and pass it to the session create command:

```bash
kpass agent:session create --delegation '<JSON>' --output json
```

## What the Delegation Means

The delegation is the policy the user is approving. It has 3 parts:

1. **`task`** -- descriptive only. A human-readable summary for approval review.
2. **`payment_policy`** -- enforced by Passport. Defines how the agent is allowed to spend.
3. **`execution_constraints`** -- optional. Payment-approach-specific constraints enforced at execution time.

## Current Platform Contract

Supported payment approaches:

- `x402` — for paid API access (402 Payment Required flows). Supports `execution_constraints.x402_http` for endpoint scoping.
- `crossmint` — for shopping checkout (Crossmint-based purchases). No execution constraints needed; the backend handles the payment flow internally.
- `tempo` — for Tempo MPP streaming payments.

Do not invent other values unless the platform contract is updated.

---

## Step 1: Preflight -- Discover Payment Requirements

Before constructing the delegation, do a preflight HTTP request to the merchant URL to discover what payment the service requires.

### How to Preflight

Use `curl` to send a request to the merchant URL. Many x402-enabled services return a `402 Payment Required` response with payment requirement details:

```bash
curl -s -w "\n%{http_code}" <MERCHANT_URL>
```

Or for a POST endpoint:

```bash
curl -s -w "\n%{http_code}" -X POST <MERCHANT_URL> -H "Content-Type: application/json" -d '<BODY>'
```

The `-s` flag silences progress output. The `-w "\n%{http_code}"` appends the HTTP status code on a new line so you can distinguish the response body from the status.

### Parsing the 402 Response

**The 402 response structure varies by merchant. There is no standard schema.**

Look for fields indicating:
- **Required asset** (e.g., `USDC`, `KITE`)
- **Required amount** (e.g., `"1.00"`, `"0.50"`)
- **Accepted network / chain** (e.g., chain ID, network name)
- **Resource description** (what the payment is for)

Common patterns include:

```json
{"payment": {"accepts": [{"asset": "USDC", "amount": "1.00", "network": "kite"}]}}
```

```json
{"price": "0.50", "currency": "USDC", "description": "API call"}
```

```json
{"cost": {"amount": "2.00", "token": "USDC"}, "resource": "/v1/data"}
```

Field names vary: `payment.accepts[]`, `price`, `cost`, `amount`, `fee`, `required_payment` -- names are not standardized.

**Use your best judgment to extract the payment requirements.**

If the preflight returns a non-402 status (e.g., 200, 401, 403, 500), it may not be an x402-enabled endpoint, or it may require auth headers first. In that case:
- If 200: the resource may not require payment. Inform the user.
- If 401/403: the resource requires authentication, not payment. Different problem.
- If you cannot confidently parse the 402 response, **use conservative defaults** (`max_amount_per_tx: "1"`, `max_total_amount: "10"`, `assets: ["USDC"]`) and note this in the confirmation card. The user will see the proposed parameters and can adjust before approving.

### What to Extract from the 402

From a successful 402 parse, you should know:
- The **asset** the merchant accepts (e.g., `USDC`, `pieUSD`)
- The **amount** per request (may be in atomic units — divide by 10^decimals for human-readable)
- The **host** and **path** of the endpoint (from the URL itself)
- The **HTTP method** used

These feed directly into the delegation fields.

### Display Cards — MANDATORY

## Display Cards — MANDATORY

**CRITICAL: You MUST display the formatted status cards shown in this skill after every major step. This is NOT optional. Never skip, summarize, or replace these cards with plain text. The exact horizontal-rule format must be used every time — no exceptions.**

**MANDATORY — After parsing the 402 response, you MUST display the following card to the user. Do not skip this. Do not summarize. Do not replace with plain text:**

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

| Placeholder | Source |
|---|---|
| `{merchant_host}` | The hostname from the merchant URL (e.g., `api.example.com`) |
| `{method}` | The HTTP method used in the preflight (e.g., `POST`) |
| `{merchant_url}` | The full merchant URL |
| `{amount}` | The human-readable amount per request from the 402 response. If the amount is in atomic units (e.g., `100000000000000000`), convert to human-readable by dividing by 10^decimals. |
| `{asset}` | The asset name or symbol from the 402 response (e.g., `USDC`, `pieUSD`) |
| `{network}` | The network/chain from the 402 response (e.g., `eip155:2368`, `kite`) |
| `{resource_description}` | The resource description from the 402 response, or the URL path if not available |

**You MUST always display this card after parsing a 402 response. No exceptions.** If a field is not available from the 402 response, omit that line from the card rather than guessing.

---

## Step 2: Confirm Session Parameters with User — MANDATORY

**CRITICAL: After discovering payment requirements and BEFORE creating the session, you MUST present the proposed session parameters to the user and get explicit confirmation. Never create a session without user confirmation. This is NOT optional.**

**MANDATORY — Display the following confirmation card and wait for user approval before proceeding:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Proposed Session Parameters

🏪 Merchant:         {merchant_host}
📝 Task:             {task_summary}
💰 Per-tx limit:     {max_amount_per_tx} {asset}
💰 Total budget:     {max_total_amount} {asset}
⏰ Session duration: {ttl_human_readable}
🔒 Payment method:   {payment_approach}
🎯 Scope:            {scope_description}

Shall I proceed with creating this session?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{merchant_host}` | The hostname from the merchant URL |
| `{task_summary}` | The task summary you will put in the delegation (derived from user's request) |
| `{max_amount_per_tx}` | The per-tx limit (from 402 response or user) |
| `{max_total_amount}` | The total budget (calculated from per-tx * expected requests, or user-specified) |
| `{asset}` | The payment asset |
| `{ttl_human_readable}` | Human-readable duration (e.g., "1 hour", "24 hours") |
| `{scope_description}` | Either "Scoped to {host}{path}" or "Unscoped (any endpoint)" |

**You MUST always display this card and wait for the user to confirm. No exceptions.**

The user may:
- **Confirm** ("yes", "proceed", "looks good") → proceed to create the session
- **Adjust** ("make the budget 50", "change TTL to 2 hours") → update parameters and show the card again
- **Cancel** ("no", "cancel") → stop and inform the user

Only after the user explicitly confirms should you proceed to construct the delegation and call `agent:session create`.

---

## Step 3: Construct the Delegation

Build the delegation from these input sources:

1. **User goal** -- what the user asked to do (becomes `task.summary`)
2. **Preflight 402 response** -- payment requirements (becomes `payment_policy` fields)
3. **Platform-supported payment approaches** -- currently only `x402`
4. **Endpoint scope** -- if the plan is stable, add execution constraints

---

## Schema

The delegation draft passed to `agent:session create --delegation '<JSON>'` must follow this shape:

**IMPORTANT: Do NOT wrap the delegation in an outer `{"delegation": ...}` object. The CLI does that automatically. Pass only the inner object directly.**

```json
{
  "task": {
    "summary": "string"
  },
  "payment_policy": {
    "allowed_payment_approaches": ["x402"],
    "assets": ["string"],
    "max_amount_per_tx": "string",
    "max_total_amount": "string",
    "ttl_seconds": 3600
  },
  "execution_constraints": {
    "x402_http": {
      "scope_mode": "scoped",
      "allowed_endpoints": [
        {
          "method": "POST",
          "host": "api.example.com",
          "path_prefix": "/v1/example"
        }
      ]
    }
  }
}
```

### Field Requirements

| Field | Required | Notes |
|-------|----------|-------|
| `delegation.task.summary` | Yes | Human-readable task description |
| `delegation.payment_policy.allowed_payment_approaches` | Yes | Supported: `"x402"`, `"crossmint"`, `"tempo"`. Choose based on payment context. |
| `delegation.payment_policy.max_amount_per_tx` | Yes | Max amount for any single payment |
| `delegation.payment_policy.ttl_seconds` | Yes | Session lifetime in seconds |
| `delegation.payment_policy.assets` | Optional | Asset symbols (e.g., `["USDC"]`). Prefer explicit when known. |
| `delegation.payment_policy.max_total_amount` | Optional | Total budget. Recommended when task has bounded spend. |
| `delegation.execution_constraints` | Optional | Only when endpoint scope is known and stable |
| `delegation.execution_constraints.x402_http.allowed_endpoints` | Required when `scope_mode == "scoped"` | Each entry needs `method`, `host`, `path_prefix` |

---

## Construction Rules

### 1. `task.summary`

Write one short sentence describing what the user is authorizing.

**Good:**

```json
"task": {
  "summary": "Query the weather API for a 5-day forecast."
}
```

```json
"task": {
  "summary": "Access paid article on news.example.com."
}
```

**Bad:**

```json
"task": {
  "summary": "Handle stuff."
}
```

Rules:
- Keep it short -- one sentence, under 80 characters
- Make it reviewable by a user on the approval screen
- Derive from the user's exact words -- do not invent detail
- Do not over-model task semantics into structured fields

### 2. `payment_policy.allowed_payment_approaches`

Choose only from platform-supported values based on the payment context:

- **`x402`** — paid API access via 402 Payment Required flows
- **`crossmint`** — shopping checkout (Crossmint-based purchases like Amazon)
- **`tempo`** — Tempo MPP streaming payments

```json
"allowed_payment_approaches": ["x402"]
```

This is the payment approach the agent is selecting up front. The backend validates and enforces it later. Use exactly one approach per session — do not combine approaches in a single session.

### 3. `payment_policy.assets`

If the expected payment asset is known (from the 402 response or the user), include it:

```json
"assets": ["USDC"]
```

If the asset is truly unknown and the caller cannot constrain it, omit it only if the product flow allows that. **Prefer explicit assets when possible.**

### 4. `payment_policy.max_amount_per_tx`

Required. The maximum amount allowed for any single payment.

**Do NOT ask the user for this value.** Derive it automatically:
1. Use the price from the 402 preflight response as the baseline
2. Add a small buffer (1.5x to 2x the price) to account for price fluctuations
3. If the 402 response shows the exact price (e.g., "0.1 pieUSD"), set `max_amount_per_tx` to that price or slightly above (e.g., "0.2")
4. Only if the 402 response cannot be parsed at all AND you have no other information, use a conservative default (e.g., "1") and note this in the confirmation card

```json
"max_amount_per_tx": "0.2"
```

### 5. `payment_policy.max_total_amount`

Optional but strongly recommended. The total amount the session may spend across all executions.

**Do NOT ask the user for this value.** Derive it automatically:
1. Estimate the number of requests the task will need (default: 10 if unclear)
2. Multiply: `per_tx_price * estimated_requests`
3. For a single-request task (e.g., "pay this merchant once"), set `max_total_amount` equal to `max_amount_per_tx`
4. For multi-request tasks (e.g., "query this API multiple times"), set a reasonable multiple (e.g., 10x the per-tx price)
5. When in doubt, prefer a smaller budget — the user can always create a new session

```json
"max_total_amount": "50.00"
```

### 6. `payment_policy.ttl_seconds`

Required. Becomes the session expiration after approval.

Default to `3600` (1 hour) unless the user specifies a different duration or the task requires longer.

```json
"ttl_seconds": 3600
```

Common values:

| Duration | Seconds |
|----------|---------|
| 30 minutes | 1800 |
| 1 hour | 3600 |
| 24 hours | 86400 |
| 7 days | 604800 |

### 7. `execution_constraints`

Include only when the agent can plan execution scope ahead of time and Passport can enforce it. For `x402_http`, the current supported constraint is scoped HTTP endpoints.

```json
"execution_constraints": {
  "x402_http": {
    "scope_mode": "scoped",
    "allowed_endpoints": [
      {
        "method": "POST",
        "host": "api.example.com",
        "path_prefix": "/v1/data"
      }
    ]
  }
}
```

If the agent cannot plan endpoints ahead of time, **omit `execution_constraints` entirely** instead of guessing.

When the preflight clearly identifies a single endpoint (you know the host, path, and method from the merchant URL), you should include scoped constraints.

---

## Complete Example -- Full Delegation

Scenario: The user wants to query a paid API at `api.example.com/v1/flights/search`. The 402 response indicates USDC at $5 per request. The user wants to make up to 10 queries.

```json
{
  "task": {
    "summary": "Search for flights on api.example.com within the approved budget."
  },
  "payment_policy": {
    "allowed_payment_approaches": ["x402"],
    "assets": ["USDC"],
    "max_amount_per_tx": "5",
    "max_total_amount": "50",
    "ttl_seconds": 3600
  },
  "execution_constraints": {
    "x402_http": {
      "scope_mode": "scoped",
      "allowed_endpoints": [
        {
          "method": "POST",
          "host": "api.example.com",
          "path_prefix": "/v1/flights/search"
        }
      ]
    }
  }
}
```

## Minimal Example -- Budget Only

Use this when the task is bounded by spend but the agent cannot reliably predict exact endpoints:

```json
{
  "task": {
    "summary": "Complete the approved paid task within the authorized budget."
  },
  "payment_policy": {
    "allowed_payment_approaches": ["x402"],
    "assets": ["USDC"],
    "max_amount_per_tx": "20",
    "max_total_amount": "100",
    "ttl_seconds": 3600
  }
}
```

## Shopping Checkout Example -- Cart-Based Budget

Use this when the payment amount is already known from a shopping cart total. No 402 preflight needed.

Scenario: User is checking out a shopping cart with estimated total $32.82. Budget = $32.82 × 1.5 = $49.23, rounded up to $50.

```json
{
  "task": {
    "summary": "Shopping checkout — estimated total $32.82"
  },
  "payment_policy": {
    "allowed_payment_approaches": ["crossmint"],
    "assets": ["USDC"],
    "max_amount_per_tx": "50",
    "max_total_amount": "50",
    "ttl_seconds": 3600
  }
}
```

Note: Shopping checkout **must** use `crossmint` — the backend will reject `x402` sessions for checkout. No `execution_constraints` needed — checkout is handled by the backend, not by direct merchant calls.

---

## Practical Heuristics

**The agent should autonomously decide all session parameters. Never ask the user for individual parameter values.** The user's only interaction is confirming the "Proposed Session Parameters" card.

There are two derivation paths depending on the context:

### Path A: From 402 Preflight Response (x402 API payments)

Use this when the agent is accessing a paid API or merchant that returns a 402 Payment Required response.

- `allowed_payment_approaches`: always `["x402"]`
- `assets`: from the 402 response (asset name/symbol). If unknown, default to `["USDC"]`
- `max_amount_per_tx`: from the 402 response price, with 1.5-2x buffer. For a 0.1 pieUSD price → set "0.2"
- `max_total_amount`: per-tx price * estimated requests. Single request → same as per-tx. Multiple → 10x per-tx as default
- `ttl_seconds`: 3600 (1 hour) for quick tasks, 86400 (24 hours) for longer tasks. Use judgment based on context
- `execution_constraints`: include scoped endpoints only when the merchant URL is known. Omit if uncertain
- `task.summary`: derive from the user's original request in one sentence

### Path B: From a Known Amount (shopping checkout)

Use this when the payment amount is already known before session creation — for example, a shopping cart total. **Skip the 402 preflight entirely.**

- `allowed_payment_approaches`: `["crossmint"]` — shopping checkout **requires** the `crossmint` approach. The backend will reject `x402` sessions for checkout.
- `assets`: `["USDC"]` (or the checkout currency if different)
- `max_amount_per_tx`: known amount × 1.5, rounded up to the nearest whole number. This buffer accounts for price fluctuations and transaction fees
- `max_total_amount`: same as `max_amount_per_tx` (single checkout transaction)
- `ttl_seconds`: `3600` (1 hour — enough time for user to approve and complete checkout)
- `execution_constraints`: omit (not applicable for shopping checkout)
- `task.summary`: describe the purchase with the estimated total (e.g., `"Shopping checkout — estimated total $32.82"`)

---

## Validation Checklist

Before passing the delegation to `agent:session create`, verify:

1. `task.summary` is non-empty and describes the user's intent
2. `allowed_payment_approaches` contains only supported values (`"x402"`, `"crossmint"`, or `"tempo"`)
3. `max_amount_per_tx` is present and is a positive decimal string
4. `ttl_seconds` is present and is a positive integer
5. If `max_total_amount` is set, it is >= `max_amount_per_tx` and consistent with the expected task budget
6. If `assets` is set, it contains valid token symbols from the 402 response or user input
7. If `execution_constraints.x402_http.scope_mode == "scoped"`, every allowed endpoint has:
   - `method` (e.g., `GET`, `POST`)
   - `host` (e.g., `api.example.com`)
   - `path_prefix` (e.g., `/v1/data`)

---

## What Not To Do

Do not:
- **Ask the user for tx limits, total budget, or TTL** -- derive these automatically from the 402 response and task context. The user confirms via the "Proposed Session Parameters" card, not by answering questions about individual parameters.
- **Wrap the delegation in `{"delegation": {...}}`** -- the CLI wraps it automatically. Pass only the inner object: `{"task":{...},"payment_policy":{...}}`. Double-wrapping causes exit code 2.
- Invent unsupported payment approaches (only `x402`, `crossmint`, and `tempo` are supported)
- Put hidden reasoning or internal notes into the delegation
- Guess endpoint constraints when the plan is uncertain -- omit them instead
- Rely on `task.summary` for enforcement -- it is descriptive only
- Omit `max_amount_per_tx` -- it is always required
- Set `max_total_amount` lower than `max_amount_per_tx`
- Pass the delegation as a file path -- it must be an inline JSON string in the `--delegation` flag

---

## Mental Model

The agent is doing 4 things:

1. **Discovering** payment requirements via preflight (curl the merchant)
2. **Summarizing** the user-authorized task
3. **Compiling** the spend envelope from 402 data + user context
4. **Optionally declaring** enforceable execution scope

The delegation is not free-form text. It is a structured policy proposal for user approval and backend enforcement.
