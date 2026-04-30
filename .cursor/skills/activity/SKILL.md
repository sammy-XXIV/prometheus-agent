---
name: activity
description: >-
  View transaction history and recent account activity. Invoke when the user asks
  about past spending, wants to verify a payment went through, check if an order
  completed, review wallet transfers, or see a log of all account actions. Covers
  wallet transfers, faucet drops, API payments, shopping checkouts, agent
  registrations, and session approvals.
user-invocable: true
allowed-tools:
  - "Bash(kpass activity *)"
  - "Bash(kpass me*)"
---

# Activity Feed

View recent account activity for the authenticated user. Returns a paginated list of activity events including wallet transfers, faucet drops, x402 API payments, agent registrations, session approvals, passkey registrations, and shopping checkouts.

## When to Use This Skill

- The user asks "show me my recent activity" or "what have I done recently?"
- The user asks "show me my transaction history" or "what transactions have I made?"
- The user wants to review spending history or verify a payment went through.
- The user asks "did my shopping checkout go through?" or "show me my purchases."
- You need to verify an action was recorded (e.g., confirm a wallet transfer completed).
- The user asks to filter activity by type (e.g., "show me only my wallet transfers").

## When NOT to Use This Skill

- If the user wants to **send** tokens or check wallet balance, use the **`wallet-send`** skill.
- If the user wants to **execute** a payment through a session, use the **`x402-execute`** skill.
- If the user wants to **list agents or sessions**, use the **`manage-agents`** skill.
- If the user wants to **search products or checkout**, use the **`shopping`** skill.

## Prerequisites

The user MUST be authenticated before using this skill. If not logged in (exit code 3 with "Not logged in"), use the **`authenticate-user`** skill first.

No agent registration or spending session is required. This command uses the user's JWT directly.

## Defaults (Do Not Ask the User Unless They Specify Otherwise)

| Setting | Default value | Override |
|---------|--------------|---------|
| Output format | `--output json` | Always use JSON output. Never omit this flag. |
| Kind filter | Omit (returns all kinds) | Only pass `--kind` when the user asks to filter by activity type. |
| Limit | Server default (20, omit) | Only pass `--limit` if the user requests pagination or you need to limit results. |
| Offset | `0` (omit) | Only pass `--offset` for pagination when combined with `--limit`. |
| Base URL | Omit (uses built-in default) | Only pass `--base-url` if the user explicitly provides a custom backend URL. |

---

## Display Cards (MANDATORY)

When presenting activity events to the user, format each event as a card:

**For transaction events** (wallet_transfer, wallet_faucet, x402_payment, shopping_checkout):
> **{title}** -- {status}
> Kind: {kind} | {occurred_at}
> Amount: {details.transaction.amount_raw} {details.transaction.asset_symbol} | Chain: {details.transaction.chain_name}
> Tx: {details.transaction.tx_hash}

**For shopping checkout events** (shopping_checkout):
> **{title}** -- {status}
> Kind: shopping_checkout | {occurred_at}
> Items: {details.transaction.shopping.item_count} ({details.transaction.shopping.item_titles joined})
> Total: {details.transaction.shopping.total_amount_display} | Order: {details.transaction.shopping.order_id}
> Tx: {details.transaction.tx_hash}

**For non-transaction events** (agent_registration, session_approval, passkey_registration):
> **{title}** -- {status}
> Kind: {kind} | {occurred_at}

---

## Command Reference

### `activity` -- List Activity Events

Returns a paginated list of recent activity events for the authenticated user.

```
kpass activity --output json
```

Full form with all optional filters:

```
kpass activity \
  --kind <KIND> \
  --limit <N> \
  --offset <N> \
  --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Kind filter | `--kind` | No | One of the allowed kind values | String: `wallet_transfer`, `wallet_faucet`, `x402_payment`, `agent_registration`, `session_approval`, `passkey_registration`, or `shopping_checkout` |
| Limit | `--limit` | No | Default: 20. Pass to control page size. | Integer between 1 and 100 |
| Offset | `--offset` | No | Default: 0. Pass for pagination. | Non-negative integer (0 or greater) |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

All filter flags are optional. Omit them to list all activity.

#### Activity Kinds

| Kind | Description |
|------|-------------|
| `wallet_transfer` | User transferred tokens to an external wallet |
| `wallet_faucet` | Wallet funded via testnet faucet |
| `x402_payment` | x402 HTTP API payment made by agent |
| `agent_registration` | New agent registered |
| `session_approval` | Agent session approved via passkey |
| `passkey_registration` | Passkey credential added |
| `shopping_checkout` | Shopping checkout completed or failed |

#### Success Output -- Events Found (exit code 0)

```json
{
  "events": [
    {
      "id": "activity_abc123",
      "user_id": "user_789xyz",
      "kind": "shopping_checkout",
      "status": "completed",
      "title": "Shopping checkout -- 2 items",
      "error_code": "",
      "error_message": "",
      "details": {
        "transaction": {
          "agent_id": "agent_def456",
          "direction": "debit",
          "chain_id": 84532,
          "chain_name": "base-sepolia",
          "asset_symbol": "USDC",
          "amount_raw": "124900000",
          "decimals": 6,
          "tx_hash": "0xabc123...",
          "source_address": "0x1234...",
          "wallet_id": "wallet_xyz",
          "shopping": {
            "order_id": "order_abc123",
            "crossmint_order_id": "cm_xyz789",
            "item_count": 2,
            "item_titles": ["Wireless Mouse", "USB-C Hub"],
            "total_amount_display": "$12.49",
            "provider": "amazon"
          }
        }
      },
      "occurred_at": "2026-03-18T14:30:00Z",
      "created_at": "2026-03-18T14:30:05Z",
      "updated_at": "2026-03-18T14:30:05Z"
    },
    {
      "id": "activity_def456",
      "user_id": "user_789xyz",
      "kind": "wallet_transfer",
      "status": "completed",
      "title": "Transfer to external wallet",
      "details": {
        "transaction": {
          "direction": "debit",
          "chain_id": 84532,
          "chain_name": "base-sepolia",
          "asset_symbol": "USDC",
          "amount_raw": "5000000",
          "decimals": 6,
          "tx_hash": "0xdef456...",
          "source_address": "0x1234...",
          "destination_address": "0x5678...",
          "wallet_id": "wallet_xyz"
        }
      },
      "occurred_at": "2026-03-17T10:00:00Z",
      "created_at": "2026-03-17T10:00:02Z",
      "updated_at": "2026-03-17T10:00:02Z"
    },
    {
      "id": "activity_ghi789",
      "user_id": "user_789xyz",
      "kind": "agent_registration",
      "status": "completed",
      "title": "Agent registered",
      "details": {
        "agent": {
          "agent_id": "agent_def456",
          "agent_type": "claude"
        }
      },
      "occurred_at": "2026-03-16T09:00:00Z",
      "created_at": "2026-03-16T09:00:01Z",
      "updated_at": "2026-03-16T09:00:01Z"
    }
  ],
  "total": 3,
  "limit": 20,
  "offset": 0,
  "_version": "1",
  "status": "success",
  "hint": "Found 3 activity event(s) (total: 3).",
  "next_command": ""
}
```

**Key fields:**
- `events` -- Array of activity event objects (newest first).
- `events[].id` -- Unique activity event identifier.
- `events[].kind` -- The type of activity (see Activity Kinds table).
- `events[].status` -- `completed` or `failed`.
- `events[].title` -- Human-readable title summarizing the event.
- `events[].error_code` -- Error code if the event failed (empty on success).
- `events[].error_message` -- Error message if the event failed (empty on success).
- `events[].details.transaction` -- Present for transaction-related events (wallet_transfer, wallet_faucet, x402_payment, shopping_checkout). Contains chain, asset, amount, tx hash, addresses.
- `events[].details.transaction.shopping` -- Present only for `shopping_checkout` events. Contains order ID, item count, item titles, total amount display, provider.
- `events[].details.transaction.x402` -- Present only for `x402_payment` events. Contains session ID, request URL, merchant name/host.
- `events[].details.agent` -- Present for `agent_registration` events. Contains agent ID and type.
- `events[].details.session` -- Present for `session_approval` events. Contains agent ID, session ID, request ID.
- `events[].details.passkey` -- Present for `passkey_registration` events. Contains passkey ID.
- `events[].occurred_at` -- ISO 8601 timestamp of when the action actually happened.
- `total` -- Total number of events matching the filter (for pagination).
- `limit` -- The page size used.
- `offset` -- The offset used.

#### Success Output -- No Events (exit code 0)

```json
{
  "events": [],
  "total": 0,
  "limit": 20,
  "offset": 0,
  "_version": "1",
  "status": "success",
  "hint": "No activity found.",
  "next_command": ""
}
```

#### Error Output -- Not Logged In (exit code 3)

```json
{
  "_version": "1",
  "status": "error",
  "error": "Not logged in. Run 'kpass login init --email <EMAIL> --output json' to authenticate, or 'kpass signup init --email <EMAIL> --output json' to create an account.",
  "hint": "Run 'kpass login init --email <EMAIL> --output json' to authenticate.",
  "next_command": ""
}
```

#### What to Do After This Command

- Present the events to the user using the Display Card format above.
- For transaction events, convert `amount_raw` to human-readable amounts using `decimals` (e.g., `5000000` with `decimals: 6` = `5.00 USDC`).
- For shopping events, use the `shopping.total_amount_display` field directly (already human-readable).
- For paginated results, check if `offset + events.length < total`. If so, there are more pages -- run again with `--offset <next_offset>`.
- If the user asked about a specific transaction and it's not found, suggest filtering by kind or increasing the limit.

---

## Complete Worked Example: View All Recent Activity

**Context:** The user asks "Show me my recent activity."

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

**Step 2:** Fetch activity.
```bash
kpass activity --output json
```
Output:
```json
{
  "events": [
    {
      "id": "activity_abc123",
      "kind": "shopping_checkout",
      "status": "completed",
      "title": "Shopping checkout -- 2 items",
      "details": {
        "transaction": {
          "direction": "debit",
          "chain_name": "base-sepolia",
          "asset_symbol": "USDC",
          "amount_raw": "124900000",
          "decimals": 6,
          "tx_hash": "0xabc123...",
          "shopping": {
            "order_id": "order_abc123",
            "item_count": 2,
            "item_titles": ["Wireless Mouse", "USB-C Hub"],
            "total_amount_display": "$12.49",
            "provider": "amazon"
          }
        }
      },
      "occurred_at": "2026-03-18T14:30:00Z"
    },
    {
      "id": "activity_def456",
      "kind": "wallet_transfer",
      "status": "completed",
      "title": "Transfer to external wallet",
      "details": {
        "transaction": {
          "direction": "debit",
          "asset_symbol": "USDC",
          "amount_raw": "5000000",
          "decimals": 6,
          "tx_hash": "0xdef456..."
        }
      },
      "occurred_at": "2026-03-17T10:00:00Z"
    }
  ],
  "total": 2,
  "limit": 20,
  "offset": 0,
  "_version": "1",
  "status": "success",
  "hint": "Found 2 activity event(s) (total: 2).",
  "next_command": ""
}
```

**Step 3:** Present to the user:

> **Shopping checkout -- 2 items** -- completed
> Kind: shopping_checkout | Mar 18, 2026 2:30 PM UTC
> Items: 2 (Wireless Mouse, USB-C Hub)
> Total: $12.49 | Order: order_abc123
> Tx: 0xabc123...
>
> **Transfer to external wallet** -- completed
> Kind: wallet_transfer | Mar 17, 2026 10:00 AM UTC
> Amount: 5.00 USDC
> Tx: 0xdef456...

---

## Complete Worked Example: Filter by Shopping Checkouts

**Context:** The user asks "Show me my shopping purchases."

```bash
kpass activity --kind shopping_checkout --output json
```
Output:
```json
{
  "events": [
    {
      "id": "activity_abc123",
      "kind": "shopping_checkout",
      "status": "completed",
      "title": "Shopping checkout -- 2 items",
      "details": {
        "transaction": {
          "tx_hash": "0xabc123...",
          "shopping": {
            "order_id": "order_abc123",
            "item_count": 2,
            "item_titles": ["Wireless Mouse", "USB-C Hub"],
            "total_amount_display": "$12.49",
            "provider": "amazon"
          }
        }
      },
      "occurred_at": "2026-03-18T14:30:00Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0,
  "_version": "1",
  "status": "success",
  "hint": "Found 1 activity event(s) (total: 1).",
  "next_command": ""
}
```

Present: "You have 1 shopping checkout: **2 items** (Wireless Mouse, USB-C Hub) for **$12.49** on Mar 18. Order ID: order_abc123."

---

## Complete Worked Example: Paginated Activity

**Context:** The user has many activity events.

**Page 1:**
```bash
kpass activity --limit 10 --offset 0 --output json
```

Check response: if `offset + events.length < total`, fetch next page:

**Page 2:**
```bash
kpass activity --limit 10 --offset 10 --output json
```

Continue until `offset + events.length >= total`.

---

## Error Handling

| Exit Code | Meaning | Error Message Pattern | Recovery Action |
|-----------|---------|----------------------|-----------------|
| 0 | Success | `status: "success"` | Present the result to the user. |
| 1 | Network error | `network error: ...` | Check connectivity. Retry after a brief pause. |
| 2 | Usage error | `--limit must be an integer between 1 and 100`, `--offset must be a non-negative integer` | Fix the flag value. See validation rules in the arguments table. |
| 3 | Auth error | `Not logged in. Run ...` | Use the **`authenticate-user`** skill to log in. |
| 5 | Rate limited | `rate limit` | Wait 30 seconds, then retry. |
| 6 | Session policy violation | N/A for activity | Activity commands do not use spending sessions. This exit code is not expected. |

---

## Commands That DO NOT Exist

Do NOT attempt any of the following. They will fail:

- `kpass activity list` -- does not exist; use `kpass activity` directly
- `kpass activity --type` -- the flag is `--kind`, not `--type`
- `kpass activity --filter` -- does not exist; use `--kind`
- `kpass transactions` -- does not exist; use `kpass activity`
- `kpass history` -- does not exist; use `kpass activity`
- `kpass activity --status` -- does not exist; status is part of the event data, not a filter
- Any command with `--json` -- the correct flag is `--output json` (two separate tokens)

---

## Input Validation Checklist

Before running any command, verify:

1. **Authentication:** The user must be logged in. Use `me --output json` to check.
2. **Kind (`--kind`):** If provided, must be one of: `wallet_transfer`, `wallet_faucet`, `x402_payment`, `agent_registration`, `session_approval`, `passkey_registration`, `shopping_checkout`.
3. **Limit (`--limit`):** If provided, must be an integer between 1 and 100.
4. **Offset (`--offset`):** If provided, must be a non-negative integer (0 or greater).

---

## Cross-Skill References

- **Prerequisite:** User must be logged in. Use the **`authenticate-user`** skill.
- **To send tokens or check balance:** Use the **`wallet-send`** skill.
- **To execute API payments:** Use the **`x402-execute`** skill.
- **To list agents and sessions:** Use the **`manage-agents`** skill.
- **To search products or checkout:** Use the **`shopping`** skill.
