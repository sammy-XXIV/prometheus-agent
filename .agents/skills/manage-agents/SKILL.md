---
name: manage-agents
description: >-
  Inspect registered agents and spending sessions on the user's account. Invoke for
  diagnostics, debugging "agent not registered" errors, reviewing active or expired
  sessions, checking budget remaining, or when the user asks what agents or sessions
  exist. Read-only -- does not create or modify anything.
user-invocable: true
allowed-tools:
  - "Bash(kpass user *)"
  - "Bash(kpass me*)"
---

# Manage Agents

List and inspect registered agents and their spending sessions from the user's perspective. These commands use the user's JWT (not an agent token) and show data across all agents registered to the user's account.

## When to Use This Skill

- The user asks "what agents are registered on my account?" or "show me my agents."
- The user asks "what sessions do I have?" or "show me active sessions."
- You need to debug an "agent not registered" or "no active sessions" error.
- You want to verify an agent registration or session was created successfully.
- The user asks for a history of agent sessions or wants to review session activity.

## When NOT to Use This Skill

- If you need to **create** a new session or **register** an agent, use the **`request-session`** skill instead. This skill is read-only.
- If you need to **execute** a payment through a session, use the **`x402-execute`** skill.
- If you need to list sessions from the **agent's** perspective (using the agent token), use `agent:session list` from the **`request-session`** skill.

## Prerequisites

The user MUST be authenticated before using this skill. If not logged in (exit code 3 with "Not logged in"), use the **`authenticate-user`** skill first.

No agent registration or spending session is required. These commands operate with the user's JWT directly.

## Defaults (Do Not Ask the User Unless They Specify Otherwise)

| Setting | Default value | Override |
|---------|--------------|---------|
| Output format | `--output json` | Always use JSON output. Never omit this flag. |
| Filters | Omit all filters (returns everything) | Only pass filter flags when the user asks to narrow results. |
| Limit | Server default (omit) | Only pass `--limit` if the user requests pagination or you need to limit results. |
| Offset | `0` (omit) | Only pass `--offset` for pagination when combined with `--limit`. |
| Base URL | Omit (uses built-in default) | Only pass `--base-url` if the user explicitly provides a custom backend URL. |

---

## Command Reference

### `me` -- Check Current User

Returns the currently logged-in user. Useful for verifying authentication state before running other commands.

```
kpass me --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

```json
{
  "user_id": "user_789xyz",
  "email": "user@example.com",
  "_version": "1",
  "status": "success",
  "hint": "Logged in as user@example.com.",
  "next_command": ""
}
```

#### Error Output -- Not Logged In (exit code 3)

```json
{
  "_version": "1",
  "status": "error",
  "error": "Not logged in. Run signup or login first.",
  "hint": "Run 'kpass signup init --email <email> --output json' or 'kpass login init --email <email> --output json'.",
  "next_command": ""
}
```

See the **`authenticate-user`** skill for full documentation on `me`.

---

### `user agents` -- List Registered Agents

Lists all agents registered to the currently logged-in user. Optionally filter by agent ID or agent type.

```
kpass user agents --output json
```

Full form with optional filters:

```
kpass user agents --agent-id <AGENT_ID> --agent-type <AGENT_TYPE> --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Agent ID filter | `--agent-id` | No | From prior `user agents` output or `agent:register` output | String agent ID (e.g., `agent_abc123`) |
| Agent type filter | `--agent-type` | No | Known agent type (e.g., `claude`, `cursor`, `codex`, `cline`) | String agent type identifier |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

All filter flags are optional. Omit them to list all agents.

#### Success Output -- Agents Found (exit code 0)

```json
{
  "agents": [
    {
      "id": "agent_abc123",
      "type": "claude",
      "created_at": "2026-03-18T10:00:00Z"
    },
    {
      "id": "agent_def456",
      "type": "cursor",
      "created_at": "2026-03-17T08:30:00Z"
    }
  ],
  "_version": "1",
  "status": "success",
  "hint": "Found 2 agent(s).",
  "next_command": ""
}
```

**Key fields:**
- `agents` -- Array of agent objects. Each has `id`, `type`, and `created_at`.
- `agents[].id` -- The unique agent identifier.
- `agents[].type` -- The agent platform type (e.g., `claude`, `cursor`, `codex`, `cline`).
- `agents[].created_at` -- ISO 8601 timestamp of when the agent was registered.

#### Success Output -- No Agents (exit code 0)

```json
{
  "agents": [],
  "_version": "1",
  "status": "success",
  "hint": "No agents found.",
  "next_command": ""
}
```

#### What to Do After This Command

- If agents were found, present them to the user in a clear format (ID, type, creation date).
- If no agents were found and the user expected some, suggest registering an agent with the **`request-session`** skill (`agent:register --type claude --output json`).
- To see sessions for a specific agent, use `user sessions --agent-id <id>`.

---

### `user sessions` -- List Agent Sessions

Lists spending sessions across all agents registered to the user. Supports filtering by status, agent ID, agent type, session ID, and pagination.

```
kpass user sessions --output json
```

Full form with all optional filters:

```
kpass user sessions \
  --status <STATUS> \
  --agent-id <AGENT_ID> \
  --agent-type <AGENT_TYPE> \
  --session-id <SESSION_ID> \
  --limit <N> \
  --offset <N> \
  --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Status filter | `--status` | No | Use `active` to find usable sessions, `expired` for past ones | String: `active` or `expired` |
| Agent ID filter | `--agent-id` | No | From `user agents` output | String agent ID (e.g., `agent_abc123`) |
| Agent type filter | `--agent-type` | No | Known agent type (e.g., `claude`, `cursor`) | String agent type identifier |
| Session ID filter | `--session-id` | No | From `user sessions` or `agent:session list` output | String session ID (e.g., `session_xyz789`) |
| Limit | `--limit` | No | Default: server-determined. Pass to control page size. | Integer between 1 and 100 |
| Offset | `--offset` | No | Default: 0. Pass for pagination. | Non-negative integer (0 or greater) |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

All filter flags are optional. Omit them to list all sessions.

#### Success Output -- Sessions Found (exit code 0)

```json
{
  "sessions": [
    {
      "id": "session_xyz789",
      "status": "active",
      "agent_type": "claude",
      "expires_at": "2026-03-19T13:00:00Z",
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
        "spent_total": "10.00",
        "reserved_total": "0.00"
      }
    },
    {
      "id": "session_old456",
      "status": "expired",
      "agent_type": "cursor",
      "expires_at": "2026-03-18T10:00:00Z",
      "delegation": {
        "task": {
          "summary": "Access paid data API."
        },
        "payment_policy": {
          "allowed_payment_approaches": ["x402"],
          "assets": ["USDC"],
          "max_amount_per_tx": "50.00",
          "max_total_amount": "200.00"
        }
      },
      "usage": {
        "spent_total": "75.00",
        "reserved_total": "0.00"
      }
    }
  ],
  "total": 2,
  "limit": 25,
  "offset": 0,
  "_version": "1",
  "status": "success",
  "hint": "Found 2 session(s) (total: 2).",
  "next_command": ""
}
```

**Key fields:**
- `sessions` -- Array of session objects.
- `sessions[].id` -- The unique session identifier.
- `sessions[].status` -- Session status (`active` or `expired`).
- `sessions[].agent_type` -- The agent type that owns this session.
- `sessions[].expires_at` -- ISO 8601 timestamp of when the session expires (or expired).
- `sessions[].delegation` -- The delegation policy for this session, containing `task` (summary), `payment_policy` (approaches, assets, caps), and optionally `execution_constraints`.
- `sessions[].delegation.payment_policy.max_amount_per_tx` -- The per-transaction spending limit.
- `sessions[].delegation.payment_policy.max_total_amount` -- The total session budget (if set).
- `sessions[].delegation.payment_policy.assets` -- The allowed assets (e.g., `["USDC"]`).
- `sessions[].usage` -- Current usage: `spent_total` (total spent) and `reserved_total` (amount reserved for in-flight payments).
- `total` -- Total number of sessions matching the filter (for pagination).
- `limit` -- The page size used.
- `offset` -- The offset used.

#### Success Output -- No Sessions (exit code 0)

```json
{
  "sessions": [],
  "total": 0,
  "limit": 25,
  "offset": 0,
  "_version": "1",
  "status": "success",
  "hint": "No sessions found.",
  "next_command": ""
}
```

#### What to Do After This Command

- Present the sessions to the user in a clear format (ID, status, agent type, task summary, budget, spent, expiry).
- If no active sessions exist and one is needed, use the **`request-session`** skill to create a new session.
- For paginated results, check if `offset + sessions.length < total`. If so, there are more pages -- run again with `--offset <next_offset>`.

---

## Complete Worked Example: List All Agents

**Context:** The user asks "What agents are registered on my account?"

**Step 1:** Verify authentication.
```bash
kpass me --output json
```
Output:
```json
{
  "user_id": "user_789xyz",
  "email": "user@example.com",
  "_version": "1",
  "status": "success",
  "hint": "Logged in as user@example.com.",
  "next_command": ""
}
```

**Step 2:** List all agents.
```bash
kpass user agents --output json
```
Output:
```json
{
  "agents": [
    {
      "id": "agent_abc123",
      "type": "claude",
      "created_at": "2026-03-18T10:00:00Z"
    },
    {
      "id": "agent_def456",
      "type": "cursor",
      "created_at": "2026-03-17T08:30:00Z"
    }
  ],
  "_version": "1",
  "status": "success",
  "hint": "Found 2 agent(s).",
  "next_command": ""
}
```

**Step 3:** Present to the user: "You have 2 registered agents: **claude** (registered Mar 18) and **cursor** (registered Mar 17)."

---

## Complete Worked Example: Filter Sessions by Status

**Context:** The user asks "Show me my active sessions."

```bash
kpass user sessions --status active --output json
```
Output:
```json
{
  "sessions": [
    {
      "id": "session_xyz789",
      "status": "active",
      "agent_type": "claude",
      "expires_at": "2026-03-19T13:00:00Z",
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
        "spent_total": "10.00",
        "reserved_total": "0.00"
      }
    }
  ],
  "total": 1,
  "limit": 25,
  "offset": 0,
  "_version": "1",
  "status": "success",
  "hint": "Found 1 session(s) (total: 1).",
  "next_command": ""
}
```

Present to the user: "You have 1 active session: **session_xyz789** (claude agent, task: 'Query the weather forecast API', up to 5.00 USDC per transaction, 10.00 / 50.00 USDC spent, expires Mar 19 at 1:00 PM UTC)."

---

## Complete Worked Example: Paginated Session Listing

**Context:** The user has many sessions and you want to page through them.

**Page 1:**
```bash
kpass user sessions --limit 10 --offset 0 --output json
```
Output:
```json
{
  "sessions": [
    { "id": "session_001", "status": "active", "agent_type": "claude", "expires_at": "2026-03-19T13:00:00Z", "delegation": { "task": { "summary": "Weather API access." }, "payment_policy": { "allowed_payment_approaches": ["x402"], "assets": ["USDC"], "max_amount_per_tx": "5.00", "max_total_amount": "50.00" } }, "usage": { "spent_total": "10.00", "reserved_total": "0.00" } },
    { "id": "session_002", "status": "expired", "agent_type": "cursor", "expires_at": "2026-03-18T10:00:00Z", "delegation": { "task": { "summary": "Data API access." }, "payment_policy": { "allowed_payment_approaches": ["x402"], "assets": ["USDC"], "max_amount_per_tx": "50.00", "max_total_amount": "200.00" } }, "usage": { "spent_total": "75.00", "reserved_total": "0.00" } }
  ],
  "total": 15,
  "limit": 10,
  "offset": 0,
  "_version": "1",
  "status": "success",
  "hint": "Found 2 session(s) (total: 15).",
  "next_command": ""
}
```
There are 15 total but only 2 returned (first page of 10, but server returned 2). Check: `0 + 2 < 15`, so there may be more pages.

**Page 2:**
```bash
kpass user sessions --limit 10 --offset 10 --output json
```
Continue until `offset + sessions.length >= total`.

---

## Complete Worked Example: Diagnose "Agent Not Registered" Error

**Context:** Running `agent:session list` fails with "Agent not registered." You want to check what agents the user actually has.

**Step 1:** Check from the user's perspective.
```bash
kpass user agents --agent-type claude --output json
```
Output:
```json
{
  "agents": [],
  "_version": "1",
  "status": "success",
  "hint": "No agents found.",
  "next_command": ""
}
```

No `claude` agent is registered. Register one using the **`request-session`** skill:
```bash
kpass agent:register --type claude --output json
```

---

## Error Handling

| Exit Code | Meaning | Error Message Pattern | Recovery Action |
|-----------|---------|----------------------|-----------------|
| 0 | Success | `status: "success"` | Present the result to the user. |
| 1 | Network error | `network error: ...` | Check connectivity. Retry after a brief pause. |
| 2 | Usage error | `--limit must be an integer between 1 and 100`, `--offset must be a non-negative integer` | Fix the flag value. See validation rules in the arguments table. |
| 3 | Auth error | `Not logged in. Run ...` | Use the **`authenticate-user`** skill to log in. |
| 4 | Not found | `not found` | The requested resource does not exist. Check the filter values. |
| 5 | Rate limited | `rate limit` | Wait 30 seconds, then retry. |
| 6 | Session policy violation | N/A for manage-agents | Read-only commands do not use spending sessions. This exit code is not expected. |

### Specific Error Scenarios

**"Not logged in." (exit code 3):**
- Use the **`authenticate-user`** skill. After logging in, retry the command.

**"--limit must be an integer between 1 and 100" (exit code 2):**
- The `--limit` value must be a whole number from 1 to 100. Do not pass `0`, negative values, or decimals.

**"--offset must be a non-negative integer" (exit code 2):**
- The `--offset` value must be a whole number that is 0 or greater. Do not pass negative values or decimals.

---

## Commands That DO NOT Exist

Do NOT attempt any of the following. They will fail:

- `kpass user` (without a sub-command) -- must use `user agents` or `user sessions`
- `kpass user agent` (singular) -- does not exist; use `user agents` (plural)
- `kpass user session` (singular) -- does not exist; use `user sessions` (plural)
- `kpass user agents --status` -- the `--status` flag only exists on `user sessions`, not `user agents`
- `kpass user agents --limit` -- the `--limit` flag only exists on `user sessions`, not `user agents`
- `kpass user sessions --type` -- the flag is `--agent-type`, not `--type`
- `kpass user sessions --id` -- the flag is `--session-id`, not `--id`
- `kpass user delete-agent` -- does not exist
- `kpass user revoke-session` -- does not exist
- `kpass agents` -- does not exist; use `user agents`
- `kpass sessions` -- does not exist; use `user sessions`
- Any command with `--json` -- the correct flag is `--output json` (two separate tokens)

---

## Input Validation Checklist

Before running any command, verify:

1. **Authentication:** The user must be logged in. Use `me --output json` to check.
2. **Agent ID (`--agent-id`):** If provided, must be a string from a prior command's output. Do not fabricate values.
3. **Agent type (`--agent-type`):** If provided, must be a known agent type string (e.g., `claude`, `cursor`, `codex`, `cline`).
4. **Session ID (`--session-id`):** If provided, must be a string from a prior command's output. Do not fabricate values.
5. **Status (`--status`):** If provided, must be `active` or `expired`.
6. **Limit (`--limit`):** If provided, must be an integer between 1 and 100.
7. **Offset (`--offset`):** If provided, must be a non-negative integer (0 or greater).

---

## Cross-Skill References

- **Prerequisite:** User must be logged in. Use the **`authenticate-user`** skill.
- **To register an agent or create sessions:** Use the **`request-session`** skill. This skill is read-only and cannot create or modify agents or sessions.
- **To execute payments:** Use the **`x402-execute`** skill (requires an active session).
- **To check wallet balance or send tokens:** Use the **`wallet-send`** skill.
