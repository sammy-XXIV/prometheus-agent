---
name: authenticate-user
description: >-
  Sign up or log in to Kite Passport. Invoke when the user needs an account, wants
  to sign in, or when any other Kite Passport skill returns an auth error (exit
  code 3). This is the gateway skill -- required before payments, shopping checkout,
  wallet operations, or session creation. Invoke proactively if the user has not
  authenticated yet and a Passport capability is needed.
user-invocable: true
allowed-tools:
  - "Bash(bash */setup.sh*)"
  - "Bash(kpass signup *)"
  - "Bash(kpass login *)"
  - "Bash(kpass logout*)"
  - "Bash(kpass me*)"
---

# Authenticate User

Sign up a new user or log in a returning user to Kite Passport. This skill is a prerequisite for all other Passport skills (`request-session`, `x402-execute`, `wallet-send`).

## Step 0: Ensure CLI is Installed — MANDATORY

**CRITICAL: Before running ANY kpass command, you MUST run the setup script first. This is NOT optional. Do not skip this step. Do not run any kpass command before setup completes successfully.**

```bash
bash <skill-directory>/scripts/setup.sh
```

Where `<skill-directory>` is the directory containing this SKILL.md file (e.g., the directory this skill is installed in).

This script ensures `kpass` is installed and available on PATH. It will attempt to install it automatically if not found.

**If setup succeeds** (`status: "ok"` in JSON output): proceed to the next step.

**If setup fails** (`status: "error"`): **STOP immediately.** Show the user the error message and the installation instructions from the setup output. Do NOT search for the binary elsewhere. Do NOT try to build from source. Do NOT look in other directories. Just show the error and ask the user to install the CLI manually.

## When to Use This Skill

- The user says "sign up", "create an account", "register", or similar.
- The user says "sign in", "log in", "authenticate", or similar.
- The user says "log out", "sign out", or similar.
- Any other skill returns exit code `3` (auth error) with a message like "Not logged in" or "JWT is expired".
- You need to check who is currently logged in.

## Defaults (Do Not Ask the User Unless They Specify Otherwise)

| Setting | Default value | Override |
|---------|--------------|---------|
| Output format | `--output json` | Always use JSON output. Never omit this flag. |
| Interactive mode | `--no-interactive` | Always pass this flag. Never rely on TTY detection. |
| Caller surface | `--client agent` | Always pass this flag on `signup init` and `login init`. It tells the backend an agent is acting on the user's behalf so the email copy reads "Share this code with your agent" instead of "Enter this code in your terminal". Never omit this flag. |
| Base URL | Omit (uses built-in default) | Only pass `--base-url` if the user explicitly provides a custom backend URL. |

**Note on `next_command`:** The CLI's `next_command` field may show `kpass signup init` or `kpass login init` *without* `--client agent`. You must still add `--client agent` when running it. The Defaults table above is authoritative; CLI hints are starting points, not literal commands.

## Display Cards — MANDATORY

**CRITICAL: You MUST display the formatted status cards shown in this skill after every major step. This is NOT optional. Never skip, summarize, or replace these cards with plain text. The exact horizontal-rule format must be used every time — no exceptions.**

If a command succeeds and has a display card template below, you MUST output that card before doing anything else. Do not proceed to the next step until the card is displayed.

## Decision: Login vs Signup

If the user says "sign in" or "authenticate" without specifying whether they have an existing account:

1. **Try login first** with `login init`.
2. If the command fails with **exit code 4** (not found / "email not registered"), fall back to `signup init`.
3. If the user explicitly says "sign up" or "create account", go directly to signup.

**After signup exchange succeeds, the user is fully authenticated.** The `signup exchange` command returns a JWT and saves it to local config. Do NOT run `login init` after signup — it is unnecessary and will generate a conflicting OTP code.

---

## Command Reference

### `signup init` -- Start Signup

Sends a verification link and a sign-up code to the user's email address.

```
kpass signup init --email <EMAIL> --client agent --output json --no-interactive
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Email address | `--email` | Yes | Ask the user | Must be a valid email address |
| Caller surface | `--client agent` | Yes | Always pass | Literal value `agent` |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |
| Non-interactive | `--no-interactive` | Yes | Always pass | Boolean flag, no value |

#### Success Output (exit code 0)

```json
{
  "action": "check_email_for_code",
  "signup_id": "signup_abc123",
  "poll_interval_seconds": 3,
  "expires_at": "2026-03-17T12:00:00Z",
  "_version": "1",
  "status": "human_action_required",
  "hint": "A verification link and sign-up code were sent to user@example.com. Enter the code to complete signup.",
  "next_command": "KPASS_SIGNUP_CODE=<CODE> kpass signup exchange --signup-id signup_abc123 --output json"
}
```

**Key fields:**
- `status` is `"human_action_required"` -- this is NOT an error. Exit code is 0.
- `signup_id` -- needed for `signup exchange`. Extract it from this response.
- `next_command` -- contains the exact `signup exchange` command (with the real signup_id filled in, but `<CODE>` as a placeholder you must get from the user).

#### What to Do After This Command

1. Tell the user: "Two emails were sent to **{email}**: a **verification link** and a **sign-up code**. Please click the verification link first, then share the 8-character code with me."
2. **Wait for the user to provide the 8-character code** from the "Your Kite Passport sign-up code" email.
3. Run `signup exchange` with the `signup_id` from this response and the code the user provided.

**CRITICAL:** You MUST ask the user for the code and wait. Do NOT try to guess or fabricate the code. The user reads it from their email.

---

### `signup poll` -- Wait for Email Verification (Optional)

Polls the backend until the user clicks the verification link. This command is optional — the primary signup flow uses `signup exchange` with the code directly.

```
kpass signup poll --signup-id <signup_id> --wait --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Signup ID | `--signup-id` | Yes | From `signup init` output: `signup_id` field | String starting with `signup_` |
| Wait mode | `--wait` | Yes (for agent use) | Always pass | Boolean flag, no value |
| Poll interval | `--poll-interval` | No | Default: 3 seconds | Positive integer |
| Timeout | `--timeout` | No | Default: 600 seconds | Positive integer |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output -- Verified (exit code 0)

```json
{
  "signup_id": "signup_abc123",
  "verification_status": "verified",
  "_version": "1",
  "status": "success",
  "hint": "Email verified. Proceed to signup exchange.",
  "next_command": "KPASS_SIGNUP_CODE=<CODE> kpass signup exchange --signup-id signup_abc123 --output json"
}
```

**Important:** The `next_command` contains `<CODE>` as a placeholder. You must get the 8-character code from the user (they read it from the "Your Kite Passport sign-up code" email).

#### Expired Output (exit code 3)

```json
{
  "signup_id": "signup_abc123",
  "verification_status": "expired",
  "_version": "1",
  "status": "expired",
  "hint": "Verification link expired. Restart signup.",
  "next_command": "kpass signup init --email <EMAIL> --output json"
}
```

If expired, tell the user the link expired and re-run `signup init` with their email.

#### Pending Output -- Without `--wait` (exit code 0)

If you omit `--wait`, a single check is performed:

```json
{
  "signup_id": "signup_abc123",
  "verification_status": "pending",
  "_version": "1",
  "status": "pending",
  "hint": "Not yet verified. Run with --wait to poll automatically.",
  "next_command": ""
}
```

#### What to Do After This Command

When `verification_status` is `"verified"`:
1. Ask the user for the 8-character code from the "Your Kite Passport sign-up code" email.
2. Run `signup exchange` with the `signup_id` and the code the user provided.

---

### `signup exchange` -- Complete Signup and Authenticate

Completes the signup flow: creates the user account, obtains a JWT, and saves credentials to local config. After this command succeeds, the user is fully authenticated — do NOT run `login init`.

```
KPASS_SIGNUP_CODE=<CODE> kpass signup exchange --signup-id <signup_id> --output json
```

**Security:** Pass the signup code via the `KPASS_SIGNUP_CODE` environment variable (shown above) instead of the `--code` flag. Environment variables are not visible in process listings (`ps`, `/proc/<pid>/cmdline`), while flags are. The `--code` flag still works for backward compatibility but is discouraged.

#### Arguments

| Argument | Env Var / Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Signup ID | `--signup-id` | Yes | From `signup init` output: `signup_id` field | String starting with `signup_` |
| Code | `KPASS_SIGNUP_CODE` env var (preferred) or `--code` flag | Yes | From the user (they read it from the "Your Kite Passport sign-up code" email) | 8-character alphanumeric string |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

```json
{
  "user_id": "user_789xyz",
  "email": "user@example.com",
  "_version": "1",
  "status": "success",
  "hint": "Account created and logged in as user@example.com.",
  "next_command": ""
}
```

#### What to Do After This Command

The user is now authenticated. Do NOT run `login init` — the JWT was already obtained and saved.

**MANDATORY — After this command succeeds, you MUST display the following card to the user. Do not skip this. Do not summarize. Do not replace with plain text:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 Account Created & Logged In!

📧 Email:    {email}
🆔 User ID:  {user_id}
🔓 Session active
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{email}` | From JSON response field `email` |
| `{user_id}` | From JSON response field `user_id` |

**You MUST always display this card after a successful response. No exceptions.** Fill in all placeholders from the JSON output.

---

### `login init` -- Start OTP Login

Sends an 8-character one-time code to the user's email address.

```
kpass login init --email <EMAIL> --client agent --output json --no-interactive
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Email address | `--email` | Yes | Ask the user (or reuse from prior signup) | Must be a valid email address |
| Caller surface | `--client agent` | Yes | Always pass | Literal value `agent` |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |
| Non-interactive | `--no-interactive` | Yes | Always pass | Boolean flag, no value |

**Note:** If `--email` is omitted, the CLI will attempt to read the email from the saved config. However, always pass `--email` explicitly for reliability.

#### Success Output (exit code 0)

```json
{
  "action": "enter_otp",
  "login_id": "login_xyz789",
  "expires_at": "2026-03-17T12:10:00Z",
  "_version": "1",
  "status": "human_action_required",
  "hint": "An 8-character code was sent to user@example.com. Ask the user to share it.",
  "next_command": "KPASS_LOGIN_CODE=<OTP_CODE> kpass login verify --login-id login_xyz789 --output json"
}
```

**Key fields:**
- `status` is `"human_action_required"` -- NOT an error. Exit code is 0.
- `login_id` -- needed for the verify command. Already filled in `next_command`.
- `next_command` -- contains the exact `login verify` command, but `<OTP_CODE>` is a placeholder you must get from the user.

#### What to Do After This Command

1. **Ask the user for the code.** Say: "An 8-character login code was sent to **{email}**. Please check your email and share the code with me."
2. **Wait for the user to provide the code** in the conversation.
3. Run `login verify` with the `login_id` from this response and the code the user provided.

**CRITICAL:** Unlike signup (which uses a link and polls automatically), login requires the user to type the OTP code back to you. You MUST ask the user and wait. Do NOT try to poll or guess the code.

---

### `login verify` -- Verify OTP and Get JWT

Verifies the OTP code and saves the JWT to local config.

```
KPASS_LOGIN_CODE=<OTP_CODE> kpass login verify --login-id <login_id> --output json
```

**Security:** Pass the OTP code via the `KPASS_LOGIN_CODE` environment variable (shown above) instead of the `--code` flag. Environment variables are not visible in process listings (`ps`, `/proc/<pid>/cmdline`), while flags are. The `--code` flag still works for backward compatibility but is discouraged.

#### Arguments

| Argument | Env Var / Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Login ID | `--login-id` | Yes | From `login init` output: `login_id` field | String starting with `login_` |
| OTP code | `KPASS_LOGIN_CODE` env var (preferred) or `--code` flag | Yes | From the user (they read it from their email) | 8-character alphanumeric string |
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

#### What to Do After This Command

The user is now authenticated. Tell the user: "You are now logged in as **{email}**."

If the next step is agent registration or spending, refer to the **`request-session`** skill. If the user needs test tokens (dev/staging environments), refer to the **`wallet-send`** skill for the `faucet drop` command.

If the code was wrong (exit code 3), tell the user: "That code was not valid. Please check your email again and share the correct 8-character code." Then re-run `login verify` with the corrected code. Do NOT re-run `login init` -- the same `login_id` is still valid until it expires.

**MANDATORY — After this command succeeds, you MUST display the following card to the user. Do not skip this. Do not summarize. Do not replace with plain text:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👋 Welcome back!

📧 {email}
🆔 {user_id}
🔓 Session active
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{email}` | From JSON response field `email` |
| `{user_id}` | From JSON response field `user_id` |

**You MUST always display this card after a successful response. No exceptions.** Fill in all placeholders from the JSON output.

---

### `logout` -- Sign Out

Revokes the current session and clears all saved auth (both user JWT and agent token).

```
kpass logout --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

```json
{
  "_version": "1",
  "status": "success",
  "hint": "Logged out.",
  "next_command": ""
}
```

If already logged out:

```json
{
  "_version": "1",
  "status": "success",
  "hint": "Already logged out.",
  "next_command": ""
}
```

**Note:** Logout clears BOTH `config.json` (user JWT) and `agent.json` (agent token/session). After logout, the agent will need to re-authenticate AND re-register.

---

### `me` -- Check Current User

Returns the currently logged-in user, or errors if not logged in.

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

Use `me` when you need to confirm the current auth state before proceeding with other skills.

---

## Complete Worked Example: New User Signup

```
Agent                                  CLI                              User
  |                                     |                                |
  |-- signup init --email user@ex.com ->|                                |
  |<- {status:"human_action_required",  |                                |
  |    signup_id:"signup_abc123",       |                                |
  |    next_command:"...exchange..."}   |                                |
  |                                     |                                |
  |-- "Click the link & share the    ---------------------------------->|
  |    8-char code from your email"     |                                |
  |                                     |                     [clicks    |
  |                                     |                      link,     |
  |                                     |                      reads     |
  |                                     |                      code]     |
  |<- "A1B2C3D4" ----------------------------------------------------- |
  |                                     |                                |
  |-- KPASS_SIGNUP_CODE=A1B2C3D4        |                                |
  |   signup exchange --signup-id      |                                |
  |   signup_abc123 ------------------>|                                |
  |<- {status:"success",               |                                |
  |    user_id:"user_789xyz",           |                                |
  |    email:"user@example.com"}        |                                |
  |                                     |                                |
  |-- "Account created & logged in" ----------------------------------->|
```

### Step-by-step commands:

**Step 1:** Start signup.
```bash
kpass signup init --email user@example.com --client agent --output json --no-interactive
```
Output:
```json
{
  "action": "check_email_for_code",
  "signup_id": "signup_abc123",
  "poll_interval_seconds": 3,
  "expires_at": "2026-03-17T12:00:00Z",
  "_version": "1",
  "status": "human_action_required",
  "hint": "A verification link and sign-up code were sent to user@example.com. Enter the code to complete signup.",
  "next_command": "KPASS_SIGNUP_CODE=<CODE> kpass signup exchange --signup-id signup_abc123 --output json"
}
```
Tell the user to click the verification link, then share the 8-character code.

**Step 2:** User provides the code (e.g., "A1B2C3D4"). Complete signup.
```bash
KPASS_SIGNUP_CODE=A1B2C3D4 kpass signup exchange --signup-id signup_abc123 --output json
```
Output:
```json
{
  "user_id": "user_789xyz",
  "email": "user@example.com",
  "_version": "1",
  "status": "success",
  "hint": "Account created and logged in as user@example.com.",
  "next_command": ""
}
```

Done. The user is authenticated. Display the account-created card.

---

## Complete Worked Example: Returning User Login

**Step 1:** Start login.
```bash
kpass login init --email user@example.com --client agent --output json --no-interactive
```
Output:
```json
{
  "action": "enter_otp",
  "login_id": "login_xyz789",
  "expires_at": "2026-03-17T12:10:00Z",
  "_version": "1",
  "status": "human_action_required",
  "hint": "An 8-character code was sent to user@example.com. Ask the user to share it.",
  "next_command": "KPASS_LOGIN_CODE=<OTP_CODE> kpass login verify --login-id login_xyz789 --output json"
}
```
Ask the user: "An 8-character login code was sent to your email. Please share it with me."

**Step 2:** User provides code (e.g., "A1B2C3D4"). Verify it.
```bash
KPASS_LOGIN_CODE=A1B2C3D4 kpass login verify --login-id login_xyz789 --output json
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

Done. The user is authenticated.

---

## Complete Worked Example: Login Fallback to Signup (New User Says "Sign In")

**Context:** The user says "sign me in" but does not have an account yet. Per the Decision section, try login first, then fall back to signup.

**Step 1:** Try login first.
```bash
kpass login init --email user@example.com --client agent --output json --no-interactive
```
Output (exit code 4):
```json
{
  "_version": "1",
  "status": "error",
  "error": "email not registered",
  "hint": "No account found for user@example.com. Try signup instead.",
  "next_command": "kpass signup init --email user@example.com --output json --no-interactive"
}
```
Email not registered. Fall back to signup.

**Step 2:** Start signup.
```bash
kpass signup init --email user@example.com --client agent --output json --no-interactive
```
Output:
```json
{
  "action": "check_email_for_code",
  "signup_id": "signup_abc123",
  "poll_interval_seconds": 3,
  "expires_at": "2026-03-17T12:00:00Z",
  "_version": "1",
  "status": "human_action_required",
  "hint": "A verification link and sign-up code were sent to user@example.com. Enter the code to complete signup.",
  "next_command": "KPASS_SIGNUP_CODE=<CODE> kpass signup exchange --signup-id signup_abc123 --output json"
}
```
Tell the user to click the verification link, then share the 8-character code.

**Step 3:** User provides the code (e.g., "A1B2C3D4"). Complete signup.
```bash
KPASS_SIGNUP_CODE=A1B2C3D4 kpass signup exchange --signup-id signup_abc123 --output json
```
Output:
```json
{
  "user_id": "user_789xyz",
  "email": "user@example.com",
  "_version": "1",
  "status": "success",
  "hint": "Account created and logged in as user@example.com.",
  "next_command": ""
}
```

Done. The user is authenticated. Display the account-created card.

---

## Error Handling

| Exit Code | Meaning | Error Message Pattern | Recovery Action |
|-----------|---------|----------------------|-----------------|
| 0 | Success or human action required | `status: "human_action_required"` | Follow the `next_command` field. This is NOT an error. |
| 1 | Network error | `network error: ...` | Check connectivity. Retry after a brief pause. |
| 2 | Usage error | `--email is required`, `unknown option` | Fix the command syntax. Check required flags. |
| 3 | Auth error | `invalid OTP`, `verification expired`, `already consumed` | For invalid OTP: ask user to re-check email and provide code again. For expired: restart the flow. |
| 4 | Not found | `email not registered`, `not found` | If trying login: fall back to signup. If unexpected: inform user. |
| 5 | Rate limited | `rate limit` | Wait 30 seconds, then retry. |
| 6 | Session policy violation | N/A for authenticate-user | This exit code is not expected from authentication commands. If encountered, it indicates a session delegation issue — use **`request-session`** to create a new session. |

### Specific Error Scenarios

**Wrong OTP code (exit code 3):**
- Do NOT re-run `login init`. The `login_id` is still valid.
- Ask the user to double-check the code and provide it again.
- Re-run `login verify` with the same `login_id` and the corrected code (via `KPASS_LOGIN_CODE` env var).

**Verification link expired (exit code 3 from `signup poll`):**
- Tell the user the link expired.
- Re-run `signup init` with their email to send a new link.

**Signup exchange fails with "not verified" or "pending" (exit code 3):**
- The user likely hasn't clicked the verification link yet.
- Tell the user: "Please click the verification link in your email first, then share the code."
- After the user confirms they clicked the link, retry `signup exchange` with the same `signup_id` and code (via `KPASS_SIGNUP_CODE` env var).

**Signup session already consumed (exit code 3 from `signup poll` or `signup exchange`):**
- The user already clicked the verification link and the session was consumed (e.g., by the web tab).
- If from `signup poll`: skip polling and proceed — ask the user for the 8-character code, then run `signup exchange` with the `signup_id` and code (via `KPASS_SIGNUP_CODE` env var). The exchange endpoint accepts consumed sessions.
- If from `signup exchange`: run `kpass me --output json` to check if the user is already authenticated. If `me` succeeds, display the welcome-back card. If `me` fails, the exchange may have failed for another reason — check the error message.

**Email not registered during login (exit code 4):**
- Fall back to `signup init` with the same email.
- Tell the user: "It looks like you don't have an account yet. I'll create one for you."

---

## Commands That DO NOT Exist

Do NOT attempt any of the following. They will fail:

- `kpass signup` (without a sub-command) -- must use `signup init`, `signup poll`, or `signup exchange`
- `kpass login` (without a sub-command) -- must use `login init` or `login verify`
- `kpass signup verify` -- does not exist; signup uses `exchange` with `KPASS_SIGNUP_CODE` env var (or `--code` flag)
- `kpass login poll` -- does not exist; login uses `verify` with `KPASS_LOGIN_CODE` env var (or `--code` flag), not polling
- `kpass login exchange` -- does not exist
- `kpass register` -- does not exist; use `signup init` for user registration
- `kpass auth` -- does not exist
- `kpass signin` -- does not exist; use `login init`
- Any command with `--json` -- the correct flag is `--output json` (two separate tokens)
- Any command with `--interactive` -- the correct flag is `--no-interactive`
- Any command with `--exchange-token` -- this flag was removed; use `KPASS_SIGNUP_CODE` env var (or `--code` flag) instead

---

## Input Validation Checklist

Before running any command, verify:

1. **Email format:** Contains `@` and a domain. Do not pass obviously invalid strings.
2. **OTP / signup code:** Should be exactly 8 characters (alphanumeric). If the user provides something shorter or longer, ask them to double-check.
3. **signup_id:** Must come from a `signup init` response. Do not fabricate values.
4. **login_id:** Must come from a `login init` response. Do not fabricate values.

---

## Cross-Skill References

### After Successful Authentication (what to do next)

Once the user is logged in, immediately resume the task that required authentication:

- **If the original task involves shopping or buying products:** Invoke the **`shopping`** skill.
- **If the original task involves a paid API or service:** Invoke the **`request-session`** skill to create a spending session, then **`x402-execute`**.
- **If the original task involves sending tokens or checking balance:** Invoke the **`wallet-send`** skill.
- **If the user just wanted to log in:** Confirm success and mention available capabilities: "You're logged in. I can now shop for products, make payments, transfer tokens, or check your account activity."

### Related Skills

- To register the agent and create a spending session, use the **`request-session`** skill.
- To make direct wallet transfers (no session needed) or request test tokens from the faucet, use the **`wallet-send`** skill.
- To execute x402 paid API requests through a session, use the **`x402-execute`** skill.
- To inspect registered agents and session history, use the **`manage-agents`** skill.

---

## JSON Output Envelope

All commands return this envelope structure when `--output json` is used:

```json
{
  "...": "command-specific fields",
  "_version": "1",
  "status": "success | human_action_required | pending | expired | error",
  "error": "Raw backend error message (present only when status is error)",
  "error_code": "Machine-readable error classification (present only when status is error)",
  "hint": "Human-readable recovery guidance",
  "next_command": "The exact CLI command to run next (may contain <PLACEHOLDER> tokens)"
}
```

**Status values:**
- `"success"` -- Operation completed. Proceed with whatever the user needs next.
- `"human_action_required"` -- NOT an error. The user needs to do something (click link, provide code). Follow `hint` and `next_command`.
- `"pending"` -- Still in progress. Run again with `--wait`, or retry after a delay.
- `"expired"` -- The flow timed out. Restart from the beginning.
- `"error"` -- Something went wrong. Check `error_code` for programmatic classification, `hint` for recovery instructions, and `error` for the raw backend message.
