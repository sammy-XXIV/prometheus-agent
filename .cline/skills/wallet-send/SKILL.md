---
name: wallet-send
description: >-
  Check wallet balance, send crypto tokens, or get test tokens from the faucet
  (staging/testnet only). Proactively invoke for any task involving token
  transfers, balance inquiries, "how much do I have?" questions, or funding a
  wallet on testnet. No spending session required -- works directly with the
  user's wallet.
user-invocable: true
allowed-tools:
  - "Bash(kpass wallet *)"
  - "Bash(kpass faucet *)"
---

# Wallet Send

Check wallet balance, send tokens directly from the user's Kite wallet to a recipient address, and request test tokens from the faucet. Balance and send commands use the user's own JWT (not an agent session) and do NOT require a spending session. The faucet command is public and requires no authentication.

## When to Use This Skill

- The user asks to check their wallet balance.
- The user asks to send or transfer tokens to a specific wallet address.
- The user asks "how much do I have?" or "what's in my wallet?"
- The user asks for test tokens, wants to "top up" on testnet, or needs to fund a wallet for development/testing. **Faucet is staging/testnet only (chain_id 2368). If the user is on mainnet (chain_id 2366), do NOT offer the faucet.**

## When NOT to Use This Skill

- If the user asks to pay for a service or access a paid API, use the **`x402-execute`** skill instead (which requires a spending session).
- If the user asks to make a payment through a session, use the **`request-session`** skill to set up a session, then **`x402-execute`**.

## Prerequisites

For `wallet balance` and `wallet send`, the user MUST be authenticated. If not logged in (exit code 3 with "Not logged in"), use the **`authenticate-user`** skill first.

For `faucet drop`, **no authentication is required.** The faucet is a public endpoint. You only need the recipient wallet address and the token name.

No agent registration or spending session is required. Wallet commands operate with the user's JWT directly. The faucet operates with no credentials at all.

## Defaults (Do Not Ask the User Unless They Specify Otherwise)

| Setting | Default value | Override |
|---------|--------------|---------|
| Output format | `--output json` | Always use JSON output. Never omit this flag. |
| Asset | Ask the user | There is no default. You must know which token to send (e.g., `USDC`, `KITE`). |
| Base URL | Omit (uses built-in default) | Only pass `--base-url` if the user explicitly provides a custom backend URL. |

## Display Cards — MANDATORY

**CRITICAL: You MUST display the formatted status cards shown in this skill after every major step. This is NOT optional. Never skip, summarize, or replace these cards with plain text. The exact horizontal-rule format must be used every time — no exceptions.**

If a command succeeds and has a display card template below, you MUST output that card before doing anything else. Do not proceed to the next step until the card is displayed.

---

## Command Reference

### `wallet balance` -- Check Wallet Balance

Returns the wallet address, type, chain, and asset balances for the logged-in user.

```
kpass wallet balance --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

```json
{
  "wallet_address": "0x1234abcd5678ef90...",
  "wallet_type": "custodial",
  "chain_id": 2366,
  "assets": [
    {
      "symbol": "KITE",
      "balance": "1500.00",
      "native": true
    },
    {
      "symbol": "USDC",
      "balance": "250.50",
      "native": false
    }
  ],
  "_version": "1",
  "status": "success",
  "hint": "Wallet balance for 0x1234abcd5678ef90....",
  "next_command": ""
}
```

**Key fields:**
- `wallet_address` -- The user's wallet address on the Kite chain.
- `wallet_type` -- The wallet type (e.g., `"custodial"`).
- `chain_id` -- The blockchain chain ID (e.g., `2366` for Kite mainnet, `2368` for testnet).
- `assets` -- Array of token balances. Each asset has `symbol`, `balance`, and `native` (whether it is the chain's native token).

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

#### What to Do After This Command

- Present the balances to the user in a clear format.
- If the user wants to send tokens, verify they have sufficient balance in the desired asset before proceeding to `wallet send`.

---

### `wallet send` -- Send Tokens

Sends tokens from the user's wallet to a recipient address.

```
kpass wallet send --to <RECIPIENT> --amount <AMOUNT> --asset <ASSET> --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Recipient address | `--to` | Yes | Ask the user | Must be a valid wallet address |
| Amount | `--amount` | Yes | Ask the user | Must be a positive number (decimal string, e.g., `"25"`, `"0.50"`, `"100.00"`) |
| Asset symbol | `--asset` | Yes | Ask the user | Token symbol string (e.g., `USDC`, `KITE`) |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

**All three flags (`--to`, `--amount`, `--asset`) are required.** The command will fail with exit code 2 if any is missing.

#### Success Output (exit code 0)

```json
{
  "wallet_address": "0x1234abcd5678ef90...",
  "wallet_type": "custodial",
  "chain_id": 2366,
  "recipient_address": "0x9876fedc5432ba10...",
  "recipient": "0x9876fedc5432ba10...",
  "asset": "USDC",
  "amount": "25.00",
  "transaction_hash": "0xdeadbeef12345678...",
  "_version": "1",
  "status": "success",
  "hint": "Sent 25.00 USDC to 0x9876fedc5432ba10....",
  "next_command": ""
}
```

**Key fields:**
- `transaction_hash` -- The blockchain transaction hash. You can use this to look up the transaction on the block explorer.
- `recipient_address` -- Confirmed recipient address.
- `amount` -- Confirmed amount sent.
- `asset` -- Confirmed asset symbol.
- `wallet_address` -- The sender's wallet address.
- `chain_id` -- The chain ID where the transaction was executed.

#### What to Do After This Command

Tell the user the transfer is complete. Include:
- The amount and asset sent.
- The recipient address.
- The transaction hash (so they can verify on-chain if desired).

Example: "Sent **25.00 USDC** to `0x9876...ba10`. Transaction hash: `0xdead...5678`."

**MANDATORY — After this command succeeds, you MUST display the following card to the user. Do not skip this. Do not summarize. Do not replace with plain text:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💸 Transfer Complete

📤 Sent:     {amount} {asset}
📬 To:       {recipient_address}
🏦 From:     {wallet_address}
🧾 Tx Hash:  {transaction_hash}
⛓️  Chain:    {chain_id}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{amount}` | From JSON response field `amount` |
| `{asset}` | From JSON response field `asset` |
| `{recipient_address}` | From JSON response field `recipient_address` |
| `{wallet_address}` | From JSON response field `wallet_address` |
| `{transaction_hash}` | From JSON response field `transaction_hash` |
| `{chain_id}` | From JSON response field `chain_id` |

**You MUST always display this card after a successful response. No exceptions.** Fill in all placeholders from the JSON output.

---

### `faucet drop` -- Request Test Tokens (Staging/Testnet Only)

Requests test tokens from the Kite faucet. This is a **public endpoint** -- no authentication or login is required. The faucet **only works on staging/testnet environments** and is **disabled on production**.

```
kpass faucet drop --recipient <WALLET_ADDRESS> --token <TOKEN_NAME> --output json
```

**IMPORTANT: This is a TESTNET faucet.** It dispenses test tokens for development and testing purposes only. It does NOT work on mainnet/production. Do not tell the user they are receiving real funds.

**Before running this command**, verify the user is on testnet:
1. Run `kpass wallet balance --output json` (or use a recent balance response if available).
2. Check the `chain_id` field in the response.
3. If `chain_id` is `2368` (testnet) -- proceed with faucet drop.
4. If `chain_id` is `2366` (mainnet/production) -- **STOP**. Tell the user: "The faucet is only available on staging/testnet environments. Your wallet is on mainnet (chain_id 2366)."

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Recipient address | `--recipient` | Yes | From `wallet balance` output: `wallet_address` field | Must be a valid wallet address (e.g., `0x...`) |
| Token name | `--token` | Yes | Agent knows the token name, or ask the user | Token symbol string (e.g., `USDC`, `KITE`) |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

**Both flags (`--recipient`, `--token`) are required.** The command will fail with exit code 2 if either is missing.

#### Success Output (exit code 0)

```json
{
  "amount": "100.00",
  "asset": "USDC",
  "chain_id": 2368,
  "recipient": "0x1234abcd5678ef90...",
  "recipient_address": "0x1234abcd5678ef90...",
  "transaction_hash": "0xfaucet12345678...",
  "wallet_address": "0xfaucet_sender...",
  "wallet_type": "custodial",
  "_version": "1",
  "status": "success",
  "hint": "Dropped 100.00 USDC to 0x1234abcd5678ef90....",
  "next_command": ""
}
```

**Key fields:**
- `amount` -- The amount of test tokens dispensed.
- `asset` -- The token symbol that was dropped.
- `chain_id` -- The chain ID (testnet, e.g., `2368`).
- `recipient_address` -- The wallet address that received the tokens.
- `transaction_hash` -- The blockchain transaction hash for the faucet drop.
- `wallet_address` -- The faucet's sender wallet address (informational).

#### What to Do After This Command

Tell the user the faucet drop succeeded. Include the amount and asset. Optionally, run `wallet balance` to confirm the tokens arrived.

**MANDATORY — After this command succeeds, you MUST display the following card to the user. Do not skip this. Do not summarize. Do not replace with plain text:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🪂 Tokens Received!

💰 Amount:     {amount} {asset}
📬 Dropped to: {recipient_address}
🧾 Tx Hash:    {transaction_hash}
⛓️  Chain:      {chain_id}

Your wallet is funded and ready to use.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{amount}` | From JSON response field `amount` |
| `{asset}` | From JSON response field `asset` |
| `{recipient_address}` | From JSON response field `recipient_address` |
| `{transaction_hash}` | From JSON response field `transaction_hash` |
| `{chain_id}` | From JSON response field `chain_id` |

**You MUST always display this card after a successful response. No exceptions.** Fill in all placeholders from the JSON output.

---

## Complete Worked Example: Fund Wallet with Test Tokens

**Context:** The user is on testnet and needs USDC to test with. They have no tokens yet.

**Step 1:** Check the current balance to get the wallet address.
```bash
kpass wallet balance --output json
```
Output:
```json
{
  "wallet_address": "0x1234abcd5678ef90...",
  "wallet_type": "custodial",
  "chain_id": 2368,
  "assets": [
    {
      "symbol": "KITE",
      "balance": "0.00",
      "native": true
    },
    {
      "symbol": "USDC",
      "balance": "0.00",
      "native": false
    }
  ],
  "_version": "1",
  "status": "success",
  "hint": "Wallet balance for 0x1234abcd5678ef90....",
  "next_command": ""
}
```
Extract `wallet_address` = `"0x1234abcd5678ef90..."`. USDC balance is 0.00.

**Step 2:** Request test USDC from the faucet.
```bash
kpass faucet drop --recipient 0x1234abcd5678ef90... --token USDC --output json
```
Output:
```json
{
  "amount": "100.00",
  "asset": "USDC",
  "chain_id": 2368,
  "recipient": "0x1234abcd5678ef90...",
  "recipient_address": "0x1234abcd5678ef90...",
  "transaction_hash": "0xfaucet12345678...",
  "wallet_address": "0xfaucet_sender...",
  "wallet_type": "custodial",
  "_version": "1",
  "status": "success",
  "hint": "Dropped 100.00 USDC to 0x1234abcd5678ef90....",
  "next_command": ""
}
```

**Step 3:** Verify the balance updated.
```bash
kpass wallet balance --output json
```
Output now shows USDC balance is `"100.00"`.

**Step 4:** Confirm to the user: "Dropped **100.00 USDC** (test tokens) to your wallet. Your USDC balance is now **100.00**."

---

## Complete Worked Example: Check Balance and Send Tokens

**Context:** The user asks "Send 25 USDC to 0x9876fedc5432ba10..."

**Step 1:** Check the balance first (recommended, not required).
```bash
kpass wallet balance --output json
```
Output:
```json
{
  "wallet_address": "0x1234abcd5678ef90...",
  "wallet_type": "custodial",
  "chain_id": 2366,
  "assets": [
    {
      "symbol": "KITE",
      "balance": "1500.00",
      "native": true
    },
    {
      "symbol": "USDC",
      "balance": "250.50",
      "native": false
    }
  ],
  "_version": "1",
  "status": "success",
  "hint": "Wallet balance for 0x1234abcd5678ef90....",
  "next_command": ""
}
```
Verify: USDC balance is 250.50, which is greater than 25. Proceed.

**Step 2:** Send the tokens.
```bash
kpass wallet send --to 0x9876fedc5432ba10 --amount 25 --asset USDC --output json
```
Output:
```json
{
  "wallet_address": "0x1234abcd5678ef90...",
  "wallet_type": "custodial",
  "chain_id": 2366,
  "recipient_address": "0x9876fedc5432ba10",
  "recipient": "0x9876fedc5432ba10",
  "asset": "USDC",
  "amount": "25.00",
  "transaction_hash": "0xdeadbeef12345678...",
  "_version": "1",
  "status": "success",
  "hint": "Sent 25.00 USDC to 0x9876fedc5432ba10.",
  "next_command": ""
}
```

**Step 3:** Confirm to the user: "Sent **25.00 USDC** to `0x9876fedc5432ba10`. Transaction: `0xdeadbeef12345678...`"

---

## Complete Worked Example: Insufficient Balance

**Step 1:** Check balance.
```bash
kpass wallet balance --output json
```
Output shows USDC balance is `"5.00"` but the user wants to send 25 USDC.

**Step 2:** Do NOT attempt the send. Instead, tell the user: "Your USDC balance is 5.00, which is not enough to send 25.00 USDC. Please fund your wallet first."

---

## Error Handling

| Exit Code | Meaning | Error Message Pattern | Recovery Action |
|-----------|---------|----------------------|-----------------|
| 0 | Success | `status: "success"` | Present the result to the user. |
| 1 | Network error | `network error: ...` | Check connectivity. Retry after a brief pause. |
| 2 | Usage error | `--to is required`, `--amount is required`, `--asset is required`, `--amount must be a positive number`, `--recipient is required`, `--token is required` | Fix the command syntax. Check required flags for the specific command. |
| 3 | Auth error | `Not logged in. Run signup or login first.` | Use the **`authenticate-user`** skill to log in. (Does not apply to `faucet drop`, which is public.) |
| 4 | Not found | `not found` | Check that the recipient address is correct. |
| 5 | Rate limited | `rate limit` | Wait 30 seconds, then retry. |
| 6 | Payment violation | `error_code: "insufficient_balance"` | The wallet does not have enough funds. Check balance with `wallet balance` and fund the wallet before retrying. |

### Specific Error Scenarios

**"Not logged in. Run signup or login first." (exit code 3):**
- Use the **`authenticate-user`** skill. After logging in, retry the wallet command.
- Note: `faucet drop` does NOT require authentication. If you get this error on a faucet command, you are running the wrong command.

**"--amount must be a positive number" (exit code 2):**
- The amount must be a positive decimal. Check that it is not zero, negative, or non-numeric.

**"--to is required for wallet send (recipient address)" (exit code 2):**
- You omitted `--to`. Always pass the recipient's wallet address.

**"--asset is required for wallet send (e.g., USDC, KITE)" (exit code 2):**
- You omitted `--asset`. Always specify the token symbol.

**"Missing --recipient flag" (exit code 2):**
- You omitted `--recipient` on `faucet drop`. Pass the wallet address to receive test tokens (from `wallet balance` output).

**"Missing --token flag" (exit code 2):**
- You omitted `--token` on `faucet drop`. Pass the token symbol (e.g., `USDC`, `KITE`).

**Insufficient balance (exit code 6, `error_code: "insufficient_balance"`):**

```json
{"_version": "1", "status": "error", "error": "insufficient available balance", "error_code": "insufficient_balance", "hint": "Wallet balance is insufficient for this payment. Fund the wallet or reduce the payment amount.", "next_command": ""}
```
- The backend rejects the transfer when the wallet's available balance (on-chain minus inflight holds) is below the requested amount. Always check `wallet balance` first and compare before sending. If the balance is too low on testnet (chain_id 2368), use `faucet drop` to top up. On mainnet (chain_id 2366), the faucet is not available -- the user must fund their wallet through other means.

---

## Commands That DO NOT Exist

Do NOT attempt any of the following. They will fail:

- `kpass wallet` (without a sub-command) -- must use `wallet balance` or `wallet send`
- `kpass wallet transfer` -- does not exist; use `wallet send`
- `kpass wallet send --recipient` -- the flag is `--to`, not `--recipient`
- `kpass wallet send --token` -- the flag is `--asset`, not `--token`
- `kpass wallet send --currency` -- the flag is `--asset`, not `--currency`
- `kpass send` -- does not exist; use `wallet send`
- `kpass balance` -- does not exist; use `wallet balance`
- `kpass wallet fund` -- does not exist; use `faucet drop` for test tokens
- `kpass wallet deposit` -- does not exist
- `kpass wallet withdraw` -- does not exist
- `kpass faucet` (without a sub-command) -- must use `faucet drop`
- `kpass faucet drop --to` -- the flag is `--recipient`, not `--to`
- `kpass faucet drop --asset` -- the flag is `--token`, not `--asset`
- `kpass faucet drop --address` -- the flag is `--recipient`, not `--address`
- `kpass faucet drop --amount` -- the amount is determined by the faucet, not the caller
- `kpass faucet request` -- does not exist; use `faucet drop`
- `kpass faucet fund` -- does not exist; use `faucet drop`
- Any command with `--json` -- the correct flag is `--output json` (two separate tokens)

---

## Input Validation Checklist

Before running any command, verify:

1. **Recipient address (`--to` for `wallet send`, `--recipient` for `faucet drop`):** Must be a valid wallet address. Typically starts with `0x` followed by hexadecimal characters. If the user provides a name instead of an address, ask them for the actual wallet address.
2. **Amount (`--amount`):** Must be a positive number. Can be decimal (e.g., `"0.50"`, `"100.00"`). Do not pass `0` or negative values. (Not applicable to `faucet drop` -- the faucet determines the amount.)
3. **Asset (`--asset` for `wallet send`, `--token` for `faucet drop`):** Must be a recognized token symbol (e.g., `USDC`, `KITE`). Note the different flag names between the two commands.
4. **Sufficient balance:** Before sending, check `wallet balance` and confirm the user has enough of the specified asset. If the balance is insufficient on testnet, consider using `faucet drop` to top up.

---

## Cross-Skill References

### Prerequisites (before this skill)

- **Prerequisite (wallet commands):** User must be logged in. Use the **`authenticate-user`** skill.
- **No prerequisite (faucet):** `faucet drop` is a public endpoint. No authentication required.
- **For paid API access:** To make x402 payments to services (not direct transfers), use the **`request-session`** and **`x402-execute`** skills.
- **For diagnostics:** To inspect registered agents and their sessions from the user's perspective, use the **`manage-agents`** skill.

### After Completion (what to do next)

- **After a successful transfer:** Suggest verifying the transaction in history using the **`activity`** skill.
- **After a balance check:** If the user is preparing for a purchase or payment, guide them to the relevant skill (**`shopping`** or **`request-session`**).
- **After a faucet drop:** Confirm the tokens were received and mention the user can now make payments or transfers.
