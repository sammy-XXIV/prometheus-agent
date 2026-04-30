---
name: x402-execute
description: >-
  Make paid API requests through an approved spending session. The backend handles
  x402 payment negotiation automatically. Invoke when the task requires calling a
  paid endpoint, accessing a gated resource, or fetching data from a Kite catalog
  service. Prefer this over manual web scraping when a paid Kite service exists for
  the task. Requires an active session from request-session.
user-invocable: true
allowed-tools:
  - "Bash(kpass agent:session list *)"
  - "Bash(kpass agent:session execute *)"
---

# x402 Execute

Execute HTTP requests through an approved Kite Passport spending session. The Passport backend handles x402 payment negotiation transparently -- you specify the target URL and the backend negotiates payment with the remote service on your behalf.

## When to Use This Skill

- The user asks you to access a paid API or service that requires payment.
- You encounter an HTTP `402 Payment Required` response and the user has a Kite Passport session.
- The user asks you to make a request to a URL that you know requires x402 payment.

## Prerequisites

Before using this skill, you MUST have:

1. **User authenticated** -- Use the **`authenticate-user`** skill if not logged in.
2. **Agent registered** -- Use the **`request-session`** skill to register the agent.
3. **Active spending session** -- Use the **`request-session`** skill to create and get approval for a session with an appropriate delegation.

If any of these are missing, the command will fail with exit code 3 (auth error). Follow the error message to the appropriate prerequisite skill.

## Defaults (Do Not Ask the User Unless They Specify Otherwise)

| Setting | Default value | Override |
|---------|--------------|---------|
| Output format | `--output json` | Always use JSON output. Never omit this flag. |
| HTTP method | `POST` | Only pass `--method` if the target API requires a different method (GET, PUT, DELETE, etc.). |
| Session ID | Auto-read from agent config (`current_session_id`) | Only pass `--session-id` if the user wants to use a specific session different from the current one. |
| Headers | Omit | Only pass `--headers` if the target API requires additional headers. |
| Body | Omit | Only pass `--body` if the request needs a payload. |
| Base URL | Omit (uses built-in default) | Only pass `--base-url` if the user explicitly provides a custom backend URL. |

## Display Cards -- MANDATORY

**CRITICAL: You MUST display the formatted status cards shown in this skill after every major step. This is NOT optional. Never skip, summarize, or replace these cards with plain text. The exact horizontal-rule format must be used every time -- no exceptions.**

If a command succeeds and has a display card template below, you MUST output that card before doing anything else. Do not proceed to the next step until the card is displayed.

---

## Command Reference

### `agent:session execute` -- Execute x402 Request

Sends an HTTP request through the Passport backend, which handles payment negotiation with the target service.

**Timeout:** This command has a **5-minute timeout**. Payment operations involve on-chain transaction broadcasting and receipt polling, which can take 1-3 minutes. The CLI shows a progress spinner with elapsed time in non-JSON mode. Do NOT treat a slow response as a failure — wait for the full timeout before giving up.

```
kpass agent:session execute --url <URL> --output json
```

Full form with all optional flags:

```
kpass agent:session execute \
  --url <URL> \
  --method <METHOD> \
  --headers '<JSON_OBJECT>' \
  --body '<JSON_VALUE>' \
  --session-id <session_id> \
  --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Target URL | `--url` | Yes | The URL the user wants to access, or the URL you need to call | Must be a valid URL (https preferred) |
| HTTP method | `--method` | No | Default: `POST` | One of: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| Request headers | `--headers` | No | Only if target API requires custom headers | Must be a valid JSON object string (key-value pairs) |
| Request body | `--body` | No | Only if the request needs a payload | Must be a valid JSON string |
| Session ID | `--session-id` | No | Auto-read from agent config | Only pass to override the current session |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Important Notes on `--headers` and `--body`

- Both flags accept **JSON strings**. You must pass valid JSON.
- `--headers` must be a JSON **object** (not array, not string). Example: `'{"X-Custom": "value"}'`
- `--body` can be any valid JSON value (object, array, string, number, etc.).
- Quote the JSON with single quotes on the outside to avoid shell escaping issues.

**Correct:**
```bash
--headers '{"Content-Type": "application/json", "X-Api-Key": "abc123"}'
--body '{"query": "What is Kite?", "max_tokens": 100}'
```

**Incorrect:**
```bash
--headers {"Content-Type": "application/json"}    # Missing quotes -- shell will break this
--headers "Content-Type: application/json"         # Not JSON -- this is a raw header string
```

#### Success Output (exit code 0)

```json
{
  "session_id": "session_xyz789",
  "session_status": "active",
  "delegation": {
    "task": {
      "summary": "Query the weather forecast API at weather.example.com."
    },
    "payment_policy": {
      "allowed_payment_approaches": ["x402"],
      "assets": ["USDC"],
      "max_amount_per_tx": "5.00",
      "max_total_amount": "50.00"
    }
  },
  "usage": {
    "spent_total": "6.00",
    "reserved_total": "0.00"
  },
  "payment_requirement": {
    "asset": "USDC",
    "amount": "1.00"
  },
  "x402": {
    "status_code": 200,
    "response_body": "{\"forecast\": \"sunny, 72F\"}",
    "parsed_response_body": {
      "forecast": "sunny, 72F"
    },
    "wallet_address": "0xabc123...",
    "chain_id": 2366
  },
  "_version": "1",
  "status": "success",
  "hint": "x402 request to https://weather.example.com/v1/forecast completed with HTTP 200.",
  "next_command": ""
}
```

**Key fields:**
- `x402.status_code` -- The HTTP status code returned by the **target service** (not the Passport backend). This tells you whether the target request succeeded.
- `x402.response_body` -- The raw response body from the target service, as a string.
- `x402.parsed_response_body` -- If the response body is valid JSON, the CLI parses it for you. Use this field for structured data.
- `x402.wallet_address` -- The wallet address used for payment (informational).
- `x402.chain_id` -- The blockchain chain ID used for payment (informational).
- `delegation` -- The session's delegation policy (confirms task, payment policy).
- `usage` -- Current usage tracking: `spent_total` (total spent so far) and `reserved_total` (amount currently reserved for in-flight payments).
- `payment_requirement` -- The payment that was made for this request: `asset` and `amount`.
- `session_status` -- The session's current status after this transaction.

#### How to Present the Response to the User

1. Check `x402.status_code`. If it is a 2xx code, the request succeeded.
2. Use `x402.parsed_response_body` (if available) or `x402.response_body` to extract the data.
3. Present the relevant data to the user in a clear, readable format. Do NOT dump raw JSON unless the user asks.

**MANDATORY -- After this command succeeds, you MUST display the following card to the user. Do not skip this. Do not summarize. Do not replace with plain text:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ Payment Processed

🎯 Target:     {url}
📡 Method:     {method}
📊 HTTP:       {status_code}
💰 Paid:       {payment_amount} {payment_asset}
📊 Budget:     {spent_total} / {max_total_amount} spent
🏦 Wallet:     {wallet_address}
⛓️  Chain:      {chain_id}

📦 Response received successfully.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{url}` | From the `--url` flag value used in the execute command |
| `{method}` | From the `--method` flag value (default: `POST`) |
| `{status_code}` | From JSON response field `x402.status_code` |
| `{payment_amount}` | From JSON response field `payment_requirement.amount` |
| `{payment_asset}` | From JSON response field `payment_requirement.asset` |
| `{spent_total}` | From JSON response field `usage.spent_total` |
| `{max_total_amount}` | From JSON response field `delegation.payment_policy.max_total_amount` (if set; show "unlimited" if not) |
| `{wallet_address}` | From JSON response field `x402.wallet_address` |
| `{chain_id}` | From JSON response field `x402.chain_id` |

**You MUST always display this card after a successful response. No exceptions.** Fill in all placeholders from the JSON output.

---

### `agent:session list` -- Check Session Before Executing

Before executing, you may want to verify you have an active session with sufficient budget remaining.

```
kpass agent:session list --status active --output json
```

See the **`request-session`** skill for full documentation on this command. Sessions now include `delegation` and `usage` fields showing the task, payment policy, and how much of the budget has been spent.

---

## Complete Worked Example: Access a Paid API

**Context:** The user asks "Query the weather API for a 5-day forecast." There is already an active session with an appropriate delegation.

**Step 1:** Verify there is an active session (optional but recommended).
```bash
kpass agent:session list --status active --output json
```
Output confirms an active session exists with delegation for the weather API, budget of 10.00 USDC with 3.00 spent.

**Step 2:** Execute the request.
```bash
kpass agent:session execute \
  --url https://weather.example.com/v1/forecast \
  --method POST \
  --body '{"city": "San Francisco", "days": 5}' \
  --output json
```
Output:
```json
{
  "session_id": "session_xyz789",
  "session_status": "active",
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
    "spent_total": "4.00",
    "reserved_total": "0.00"
  },
  "payment_requirement": {
    "asset": "USDC",
    "amount": "1.00"
  },
  "x402": {
    "status_code": 200,
    "response_body": "{\"forecast\": [{\"day\": 1, \"temp\": \"72F\", \"condition\": \"sunny\"}]}",
    "parsed_response_body": {
      "forecast": [{"day": 1, "temp": "72F", "condition": "sunny"}]
    },
    "wallet_address": "0xabc123...",
    "chain_id": 2366
  },
  "_version": "1",
  "status": "success",
  "hint": "x402 request to https://weather.example.com/v1/forecast completed with HTTP 200.",
  "next_command": ""
}
```

Display the mandatory card:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ Payment Processed

🎯 Target:     https://weather.example.com/v1/forecast
📡 Method:     POST
📊 HTTP:       200
💰 Paid:       1.00 USDC
📊 Budget:     4.00 / 10.00 spent
🏦 Wallet:     0xabc123...
⛓️  Chain:      2366

📦 Response received successfully.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Step 3:** Present the result to the user.
Extract `x402.parsed_response_body.forecast` and present it naturally.

---

## Complete Worked Example: GET Request with Custom Headers

```bash
kpass agent:session execute \
  --url https://data.example.com/v1/report/2026-q1 \
  --method GET \
  --headers '{"Accept": "application/json"}' \
  --output json
```

Note: No `--body` is needed for GET requests.

---

## Complete Worked Example: Using a Specific Session

If the user has multiple sessions and wants to use a specific one:

```bash
kpass agent:session execute \
  --url https://api.example.com/v1/resource \
  --session-id session_specific123 \
  --output json
```

---

## Error Handling

| Exit Code | Meaning | Error Message Pattern | Recovery Action |
|-----------|---------|----------------------|-----------------|
| 0 | Success | `status: "success"` | Parse the response and present to user. |
| 1 | Network error / service unavailable | `network error: ...`, `treasury relay is paused`, `service is temporarily unavailable` | Check connectivity. Retry after a brief pause. If the payment service is paused, wait a few minutes. |
| 2 | Usage error | `--url is required`, `--headers must be a valid JSON string`, `--body must be a valid JSON string`, `--headers must be a JSON object`, `No session specified`, `error_code: "merchant_unsupported"` | Fix the command syntax or check the target URL. See details below. |
| 3 | Auth error | `Agent not registered`, `Agent is registered to a different user` | See specific scenarios below. |
| 4 | Not found | `not found` | Check that the URL is correct. |
| 5 | Rate limited | `rate limit` | Wait 30 seconds, then retry. |
| 6 | Session policy / payment violation | `error_code: "session_asset_forbidden"`, `"session_endpoint_forbidden"`, `"session_rule_exceeded"`, `"session_total_exceeded"`, `"insufficient_balance"`, `"payment_cap_exceeded"`, `"merchant_not_allowed"`, `"payment_redirect_not_allowed"` | Do NOT re-authenticate. Check `error_code` and `hint` for the specific violation. For session policy errors, create a new session with corrected parameters using the **`request-session`** skill. For `insufficient_balance`, fund the wallet. For `payment_cap_exceeded`, try a smaller request. |

**Error envelope fields:** Error responses include `error` (raw backend message), `error_code` (machine-readable classification — prefer this for programmatic matching), and `hint` (recovery guidance). The `error` field is a passthrough of the backend's original message.

### Specific Error Scenarios

**"--url is required for agent:session execute" (exit code 2):**
- You forgot the `--url` flag. Always pass the target URL.

**"--headers must be a valid JSON string" (exit code 2):**
- The `--headers` value is not valid JSON. Check for proper quoting and JSON syntax.

**"--headers must be a JSON object (key-value pairs)" (exit code 2):**
- You passed a JSON array or primitive instead of an object. Headers must be `{"key": "value"}` format.

**"--body must be a valid JSON string" (exit code 2):**
- The `--body` value is not valid JSON. Check for proper quoting and JSON syntax.

**"No session specified" (exit code 2):**
- No `--session-id` was passed and no `current_session_id` is set in the agent config.
- Use the **`request-session`** skill to create and approve a session first.

**"Agent not registered" (exit code 3):**
- Use the **`request-session`** skill: run `agent:register --type claude --output json`. (The `--type` is your own agent identity, never user-provided.)

**"Agent is registered to a different user" (exit code 3):**
- The user switched accounts. Re-register with `agent:register --type claude --output json`.

**"Asset not allowed by delegation" (exit code 6, `error_code: "session_asset_forbidden"`):**
- The payment required by the target service uses an asset not listed in the session's `delegation.payment_policy.assets`. Create a new session with the correct asset in the delegation.

**"Endpoint not in allowed scope" (exit code 6, `error_code: "session_endpoint_forbidden"`):**
- The target URL (method + host + path) does not match any entry in the session's `delegation.execution_constraints.x402_http.allowed_endpoints`. Either create a new session with broader scope, or create one without execution constraints.

**"Amount exceeds per-transaction limit" (exit code 6, `error_code: "session_rule_exceeded"`):**
- The payment amount for this request exceeds the session's `delegation.payment_policy.max_amount_per_tx`. Create a new session with a higher per-tx limit.

**"Total spend would exceed budget" (exit code 6, `error_code: "session_total_exceeded"`):**
- The session's `delegation.payment_policy.max_total_amount` would be exceeded by this payment. Check `usage.spent_total` to see how much has been spent. Create a new session with a larger budget if needed.

**"Insufficient balance" (exit code 6, `error_code: "insufficient_balance"`):**
- The user's wallet does not have enough funds for this payment. Use the **`wallet-send`** skill to check balance and fund the wallet before retrying.

**"Payment cap exceeded" (exit code 6, `error_code: "payment_cap_exceeded"`):**
- The payment amount exceeds the system's per-transaction cap. Try a request that costs less, or contact support for higher limits.

**"Payment redirect not allowed" (exit code 6, `error_code: "payment_redirect_not_allowed"`):**
- The target URL redirected during payment preflight. Redirects are not allowed. Verify the URL is the final endpoint, not a redirect.

**"Merchant not allowed" (exit code 6, `error_code: "merchant_not_allowed"`):**
- The merchant URL is not allowlisted for payments. Verify the URL is correct and check the service discovery list using the **`kite-discovery`** skill.

**"Merchant unsupported" (exit code 2, `error_code: "merchant_unsupported"`):**
- The merchant does not support the expected payment protocol (e.g., does not expose the expected x402 challenge). Try a different payment approach or merchant.

**Service temporarily unavailable (exit code 1):**
- The payment service is paused or temporarily unavailable. Wait a few minutes and retry.

**Target service returns non-2xx status (in `x402.status_code`):**
- This is NOT a CLI error. The CLI still exits with code 0.
- Check `x402.status_code` and `x402.parsed_response_body` (or `x402.response_body`) for the error from the target service.
- Present the error to the user and determine next steps based on the target API's documentation.

---

## Commands That DO NOT Exist

Do NOT attempt any of the following. They will fail:

- `kpass agent:session execute` without `--url` -- the URL is required
- `kpass agent:execute` -- the command is `agent:session execute`, not `agent:execute`
- `kpass execute` -- does not exist
- `kpass x402` -- does not exist
- `kpass pay` -- does not exist; use `agent:session execute` for paid requests, or `wallet send` for direct transfers
- `kpass agent:session execute --type transfer` -- the `--type` flag does not exist on execute; execution type is determined by the target URL
- `kpass agent:session execute --amount` -- does not exist; payment amount is determined by the target service's x402 requirements
- `kpass agent:session execute --currency` -- does not exist
- `kpass agent:session execute --to` -- does not exist; use `wallet send` for direct transfers
- `kpass agent:session execute --idempotency-key` -- does not exist in the current CLI
- Any command with `--json` -- the correct flag is `--output json` (two separate tokens)

---

## Input Validation Checklist

Before running the command, verify:

1. **URL:** Must be a valid HTTP/HTTPS URL. Do not pass bare domains without protocol.
2. **Method:** If specified, must be a standard HTTP method. Default is `POST` if omitted.
3. **Headers JSON:** If specified, must be a valid JSON object. Wrap with single quotes for shell safety.
4. **Body JSON:** If specified, must be valid JSON. Wrap with single quotes for shell safety.
5. **Session exists:** Ensure an active session is set (via `agent:session status --wait` or `agent:session use`).
6. **Budget remaining:** Before executing, consider checking `usage.spent_total` against `delegation.payment_policy.max_total_amount` to ensure there is sufficient budget remaining for the request.

---

## Cross-Skill References

### Prerequisites (before this skill)

- **Prerequisite (auth):** User must be logged in. Use the **`authenticate-user`** skill.
- **Prerequisite (session):** Agent must be registered and have an active session with appropriate delegation. Use the **`request-session`** skill.
- **Delegation construction:** For understanding the delegation schema and how payment policy and execution constraints work, see the **`form-session-delegation`** skill.
- **For direct wallet transfers:** To send tokens directly to an address (not through x402), use the **`wallet-send`** skill.
- **For diagnostics:** To inspect registered agents and sessions from the user's perspective, use the **`manage-agents`** skill.

### After Successful Execution (what to do next)

- **If the session has remaining budget** and the user may want follow-up requests, mention: "The session still has budget. Want to make another request?"
- **After a completed payment:** Suggest that the user can verify the transaction in their history using the **`activity`** skill.
- **If the session is exhausted or expired:** A new session is needed for further requests -- use **`request-session`**.
