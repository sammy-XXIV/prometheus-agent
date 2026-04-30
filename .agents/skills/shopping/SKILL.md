---
name: shopping
description: >-
  Buy products, shop on Amazon, find deals, compare prices, build a product list,
  and checkout with crypto. Proactively invoke for any task involving purchasing
  physical items, product search, product recommendations, price comparison, adding
  to cart, order placement, order tracking, or delivery status -- even if the user
  does not say "shop" or "buy". Also handles "build me a [thing]", "find the best
  [product] under $X", or "curate items within a budget" requests. Supports Amazon
  (more providers coming).
user-invocable: true
allowed-tools:
  - "Bash(kpass shop:*)"
---

# Shopping

Search for products, manage a shopping cart, collect shipping information, and place orders paid with cryptocurrency via headless checkout.

**Currently supported providers:** `amazon`. More providers will be added — the system is provider-agnostic.

## When to Use This Skill

- The user asks to buy something, shop for a product, or search for a product.
- The user says "I want to buy a type C cable" or "find me a phone charger under $10".
- The user asks to view, modify, or clear their shopping cart.
- The user asks to checkout, place an order, or confirm a purchase.
- The user asks about their shipping info or wants to update it.
- The user asks about their order status.

## When NOT to Use This Skill

- If the user asks to pay for a digital service or API — use **`x402-execute`**.
- If the user asks for a direct wallet-to-wallet transfer — use **`wallet-send`**.
- If the user asks about their wallet balance without shopping context — use **`wallet-send`**.

## Prerequisites

1. **User authenticated** — The user MUST be logged in. If not (exit code 3), use the **`authenticate-user`** skill first.
2. **Agent registered** — The agent MUST be registered. If not (exit code 3 with "Agent not registered"), run `kpass agent:register --type claude --output json`.
3. **Active spending session** — Required ONLY for `shop:checkout`. All other commands (search, cart, shipping) do NOT require a session. Before checkout, create a session with budget derived from the cart total (see Pre-Checkout Checklist in the `shop:checkout` section).

## Defaults (Do Not Ask the User Unless They Specify Otherwise)

| Setting | Default value | Override |
|---------|--------------|---------|
| Output format | `--output json` | Always use JSON output. Never omit this flag. |
| Max search results | 5 | Only pass `--max-results` if user requests more/fewer. |
| Quantity | 1 | Only pass `--quantity` if user specifies a different quantity. |
| Base URL | Omit (uses built-in default) | Only pass `--base-url` if the user explicitly provides a custom backend URL. |

## How Providers Work

**You do NOT choose the provider.** The backend decides which provider(s) to search. Here's the flow:

1. **Search** — You pass only a query. The backend searches all enabled providers and returns results. Each result is tagged with its `provider` (e.g., `"amazon"`).
2. **Add to cart** — You pass through the `provider` and `external_identifier` exactly as they appeared in the search results. Never hardcode or guess a provider.
3. **Remove from cart** — Same: use the `provider` and `external_identifier` from the cart view.

**Never ask the user "which store?"** The search handles provider routing automatically. If a user asks to buy from a store that isn't supported, the search will return no results — tell them that store isn't available yet.

## Conversation Flow

Follow this flow for a full shopping transaction. You may skip steps if the user has already completed them (e.g., shipping is already on file).

1. **Search** — User describes what they want. Run a product search.
2. **Present results** — Show products in the display card format. Ask which to add.
3. **Confirm details before adding** — Ask quantity if user didn't specify. Default to 1 only if user says "add this" for a single item.
4. **Add to cart** — Add the selected item(s). Only `--provider` and `--external-id` are required; the backend fetches product details automatically.
5. **View cart** — Show the cart with totals. Offer to continue shopping or checkout.
6. **Check shipping** — View the shipping profile. If incomplete, ask for missing fields.
7. **Update shipping** — Fill in any missing fields the user provides.
8. **Cost summary** — Show the cart total + shipping info. Ask for **explicit confirmation**.
9. **Checkout** — ONLY after the user explicitly says "confirm", "buy now", "place order", or equivalent. Requires a spending session.
10. **Order tracking** — Report the order ID and allow status checks.

**CRITICAL: NEVER run `shop:checkout` unless the user has explicitly confirmed the purchase. Phrases like "looks good", "sure", "yes" in response to a confirmation prompt count. Phrases like "buy this" or "order it" count. But NEVER auto-checkout without asking first.**

## Agent Behavior Guide — Be a Helpful Shopping Assistant

You are not just a CLI wrapper. You are guiding the user through a shopping experience. Follow these rules:

### Always Clarify Before Acting

- **User says "add this coffee to cart"** → If a specific product is clear from context, add 1 directly. Only ask quantity if the user's phrasing suggests they might want more than one (e.g., "add some coffee", "stock up on cables").
- **User says "buy a USB cable"** → Search first, show results, then ask which one. Never pick for them.
- **User says "add number 3"** after search results → Add it directly (user already made a clear choice). Show the "Added to Cart" card.
- **User says "I want 5 of those"** → Pass `--quantity 5`.
- **User says "remove the cable"** → If multiple items in cart match, ask which one. If only one, remove it.

### Always Confirm at Key Moments

- **Before checkout:** Always show the mandatory Order Summary confirmation card (defined in the `shop:checkout` Pre-Checkout Checklist section) with cart items, shipping address, estimated total, and payment method. Wait for explicit "yes" before proceeding.
- **Before clearing cart:** "This will remove all items from your cart. Are you sure?"
- **Before updating shipping:** If the user provides partial info, fill what they gave and ask for the rest. Don't leave fields blank.

### Guide Through Missing Information

- **Shipping is incomplete:** Don't just say "fields are missing". Instead, ask naturally:
  "I need a few details to ship your order:
  1. Full name
  2. Email address
  3. Street address
  4. City, State, ZIP code

  You can provide them all at once or one at a time."

- **No search results:** "I couldn't find anything for [query]. Try a different search term — maybe be more specific or use different keywords?"

- **Cart is empty at checkout:** "Your cart is empty! Would you like to search for something?"

### Proactive Suggestions

- After adding an item: "Added to cart! Would you like to keep shopping, or proceed to checkout?"
- After viewing an empty cart: "Your cart is empty. What would you like to shop for?"
- After a successful order: "Your order is placed! You can check the status anytime by asking me."
- If shipping is already complete when they go to checkout: Skip asking for shipping details — just show the summary.

### Handle Ambiguity

- **"Add the cheap one"** → Pick the lowest-priced item from the last search results. Confirm: "The cheapest option is [name] at $X.XX — adding that?"
- **"Add the best rated"** → Pick the highest-rated item. Confirm before adding.
- **"Get me something under $10"** → Search, filter results mentally, present only items under $10. If none, say so.
- **"Add all of them"** → Clarify: "You want to add all [N] items from the search results? That would be [list with prices]. Confirm?"

### Never Do These

- Never add items without the user knowing which product.
- Never checkout without explicit confirmation.
- Never guess an external ID — always use IDs from search results.
- Never silently fail — if a command errors, explain what went wrong and how to fix it.
- Never show raw JSON to the user — always use the display cards.

## Display Cards — MANDATORY

**CRITICAL: You MUST display the formatted status cards shown in this skill after every major step. This is NOT optional. Never skip, summarize, or replace these cards with plain text. The exact horizontal-rule format must be used every time — no exceptions.**

If a command succeeds and has a display card template below, you MUST output that card before doing anything else. Do not proceed to the next step until the card is displayed.

---

## Command Reference

### `shop:search` — Search Products

Searches for products via the configured provider (currently Amazon via SerpAPI) and returns results with provider and external identifier.

```
kpass shop:search --query <QUERY> --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Search query | `--query` | Yes | From user's request | Non-empty string describing the product |
| Max results | `--max-results` | No | Default: 5 | Integer 1–20 |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

```json
{
  "query": "usb c cable",
  "source": "serpapi",
  "items": [
    {
      "provider": "amazon",
      "external_identifier": "B01GGKZ2SC",
      "title": "Amazon Basics USB-C Cable, 6 Foot, White",
      "link": "https://www.amazon.com/dp/B01GGKZ2SC",
      "price": "$5.85",
      "rating": 4.5,
      "reviews": 54800,
      "thumbnail": "https://m.media-amazon.com/images/I/61c0UMl3MPL._AC_UY218_.jpg"
    }
  ],
  "_version": "1",
  "status": "success",
  "hint": "Found 5 products for 'usb c cable'.",
  "next_command": "kpass shop:cart add --provider amazon --external-id B01GGKZ2SC --output json"
}
```

**Key fields:**
- `items[].provider` — The product provider (e.g., `"amazon"`). Pass this to `shop:cart add`.
- `items[].external_identifier` — The provider-specific product ID (e.g., ASIN for Amazon). Pass this to `shop:cart add`.
- `items[].price` — Display price string (e.g., `"$5.85"`).
- `items[].rating` — Star rating (e.g., `4.5`).
- `items[].reviews` — Number of reviews.

#### Error Output — Search Failed (exit code 1)

The SerpAPI request failed. Retry after a brief pause.

#### What to Do After This Command

Present the results to the user using the display card below. Number them clearly so the user can say "add number 2" or "I want the Anker one". Do NOT invent products not in the search results.

**MANDATORY display card — you MUST show this after every search:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Search Results — "{query}"

{for each item, numbered:}
  {i}. {title}
     💲 {price}  ⭐ {rating} ({reviews} reviews)
     🏷️  ID: {external_identifier}

Reply with a number to add to cart.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{query}` | From JSON field `query` |
| `{i}` | Sequential number starting at 1 |
| `{title}` | From `items[i].title` — truncate to ~80 chars if very long |
| `{price}` | From `items[i].price` |
| `{rating}` | From `items[i].rating` |
| `{reviews}` | From `items[i].reviews` — format with commas (e.g., `54,800`) |
| `{external_identifier}` | From `items[i].external_identifier` |

**Example rendered card:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Search Results — "usb c cable"

  1. Amazon Basics USB-C Cable, 6 Foot, White
     💲 $5.85  ⭐ 4.5 (54,800 reviews)
     🏷️  ID: B01GGKZ2SC

  2. LISEN USB C to USB C Cable, 5-Pack
     💲 $8.99  ⭐ 4.6 (13,800 reviews)
     🏷️  ID: B0CFQ5T5F6

  3. Anker USB C to USB C Cable (6 FT, 2Pack)
     💲 $9.99  ⭐ 4.7 (79,300 reviews)
     🏷️  ID: B088NRLMPV

Reply with a number to add to cart.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### `shop:cart add` — Add Item to Cart

Adds a product to the cart. Only requires the provider and external identifier — the backend automatically fetches the product title, price, link, and thumbnail from the provider.

```
kpass shop:cart add --provider <PROVIDER> --external-id <ID> --output json
```

Use the `provider` and `external_identifier` values exactly as returned from `shop:search`.

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Provider | `--provider` | Yes | From search results `provider` field — pass through exactly as returned | Do not hardcode or guess |
| External ID | `--external-id` | Yes | From search results `external_identifier` field — pass through exactly as returned | Do not hardcode or guess |
| Quantity | `--quantity` | No | Default: 1 | Positive integer |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

Returns the updated cart (same shape as `shop:cart view`).

#### Error Output — Product Not Found (exit code 1)

The backend could not fetch product details from the provider. Verify the external ID is correct.

#### What to Do After This Command

Confirm to the user what was added. Show the updated cart using the cart display card.

**MANDATORY display card:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Added to Cart

  {title}
  💲 {price}  ×{quantity}

Cart now has {item_count} item(s).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{title}` | From the matching item in `items[]` in the response |
| `{price}` | From the matching item's `price` field |
| `{quantity}` | From the matching item's `quantity` field |
| `{item_count}` | From `item_count` in the response |

---

### `shop:cart view` — View Cart

Returns the current cart contents.

```
kpass shop:cart view --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

```json
{
  "items": [
    {
      "provider": "amazon",
      "external_identifier": "B0CXYYWL6G",
      "product_locator": "amazon:B0CXYYWL6G",
      "title": "Maxwell House Coffee 27.5oz",
      "link": "https://www.amazon.com/dp/B0CXYYWL6G",
      "price": "$12.49",
      "thumbnail": "https://...",
      "quantity": 1
    }
  ],
  "item_count": 1,
  "payment": {
    "chain": "ethereum-sepolia",
    "currency": "USDC"
  },
  "_version": "1",
  "status": "success",
  "hint": "Cart has 1 item(s).",
  "next_command": ""
}
```

#### What to Do After This Command

Display the cart card. If the cart is empty, tell the user and suggest searching for products.

**MANDATORY display card:**

When cart has items:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛒 Shopping Cart ({item_count} item(s))

{for each item, numbered:}
  {i}. {title}
     💲 {price}  ×{quantity}
     🏷️  {provider}:{external_identifier}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

When cart is empty:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛒 Shopping Cart

  Your cart is empty.
  Search for products with: shop:search --query "..."
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### `shop:cart remove` — Remove Item from Cart

Removes an item by provider and external identifier.

```
kpass shop:cart remove --provider <PROVIDER> --external-id <ID> --output json
```

Use the `provider` and `external_identifier` values from `shop:cart view`.

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Provider | `--provider` | Yes | From cart item's `provider` field — pass through exactly | Must match an item in cart |
| External ID | `--external-id` | Yes | From cart item's `external_identifier` field — pass through exactly | Must match an item in cart |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

Returns the updated cart.

#### What to Do After This Command

Show the updated cart using the cart display card.

---

### `shop:cart clear` — Clear Cart

Removes all items from the cart.

```
kpass shop:cart clear --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

Returns an empty cart.

---

### `shop:shipping view` — View Shipping Profile

Returns the user's shipping profile with a list of missing required fields.

```
kpass shop:shipping view --output json
```

#### Success Output (exit code 0)

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "line1": "456 Oak Ave",
  "line2": "",
  "city": "Austin",
  "state": "TX",
  "postal_code": "78701",
  "country": "US",
  "missing": [],
  "complete": true,
  "_version": "1",
  "status": "success",
  "hint": "Shipping profile is complete.",
  "next_command": ""
}
```

**Key fields:**
- `complete` — `true` if all required fields are filled. `false` if any are missing.
- `missing` — Array of missing field names (e.g., `["email", "line1", "city"]`). Empty when complete.

#### What to Do After This Command

If `complete` is `true`: show the profile card and confirm with the user.
If `complete` is `false`: list the `missing` fields and ask the user to provide them. Then call `shop:shipping update`.

**MANDATORY display card:**

When complete:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Shipping Profile ✅

  👤 {name}
  📧 {email}
  🏠 {line1}
     {line2}
     {city}, {state} {postal_code}
     {country}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

When incomplete:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Shipping Profile ⚠️  Incomplete

  Missing: {missing fields, comma-separated}

  Please provide:
  {for each missing field:}
  - {field name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Omit `{line2}` from the card if it is empty.

---

### `shop:shipping update` — Update Shipping Profile

Merges provided fields into the shipping profile. Only pass fields that need updating — omitted fields are left unchanged.

```
kpass shop:shipping update --name <NAME> --email <EMAIL> --line1 <ADDR> --city <CITY> --state <STATE> --postal <ZIP> --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Full name | `--name` | No* | Ask user | Non-empty string |
| Email | `--email` | No* | Ask user | Valid email address |
| Address line 1 | `--line1` | No* | Ask user | Non-empty string |
| Address line 2 | `--line2` | No | Ask user | Optional |
| City | `--city` | No* | Ask user | Non-empty string |
| State/Province | `--state` | No* | Ask user | Non-empty string |
| Postal/ZIP code | `--postal` | No* | Ask user | Non-empty string |
| Country code | `--country` | No | Default: `US` | 2-letter country code |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

*Required if listed in `missing` from `shop:shipping view`.

#### Success Output (exit code 0)

Returns the updated shipping profile (same shape as `shop:shipping view`).

#### What to Do After This Command

Show the updated shipping profile card. If now complete, proceed toward checkout.

---

### `shop:checkout` — Place Order

Executes the checkout flow: validates cart and shipping, creates order, signs and broadcasts payment.

**Timeout:** This command has a **5-minute timeout**. Checkout involves creating a Crossmint order, signing and broadcasting an on-chain transaction, and polling for receipt confirmation. This can take 1-3 minutes. The CLI shows a progress spinner with elapsed time in non-JSON mode. Do NOT treat a slow response as a failure — wait for the full timeout before giving up.

**CRITICAL PREREQUISITES:**
1. Cart must not be empty.
2. Shipping profile must be complete.
3. Agent must have an active spending session with sufficient budget to cover the cart total.

**CRITICAL: NEVER call this unless the user has explicitly confirmed the purchase.**

```
kpass shop:checkout --confirmed --output json
```

The CLI automatically resolves the session ID from the agent config (`current_session_id`, set when a session is approved). You do not need to pass `--session-id` explicitly unless overriding.

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Confirmed | `--confirmed` | Yes | User must explicitly say "confirm", "buy now", "place order" | Must be present |
| Session ID | `--session-id` | No | Auto-resolved from agent config. Only pass to override. | Must be an active session with sufficient budget |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Pre-Checkout Checklist

Before calling checkout, you MUST do ALL of the following in order:

1. **Cart is not empty** — run `shop:cart view`. Calculate the estimated total by summing each item's price × quantity.
2. **Shipping is complete** — run `shop:shipping view` and check `complete: true`.
3. **Show confirmation dialog** — display the order summary card below and ask for explicit confirmation. Do NOT proceed without a "yes".
4. **Active spending session** — if none exists, use the **`request-session`** skill. The cart total is the budget source — the `form-session-delegation` skill will derive the session parameters from it (no 402 preflight needed). **The session MUST use `crossmint` as the payment approach** (pass `--payment-approach crossmint` or set `"allowed_payment_approaches": ["crossmint"]` in the delegation). The backend will reject `x402` sessions for checkout. Tell the user the estimated total so they know what they're approving.

**MANDATORY — You MUST show this confirmation card before calling checkout. No exceptions:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Order Summary — Please Confirm

🛒 Cart:
{for each item, numbered:}
  {i}. {title}
     💲 {price}  ×{quantity}

📦 Ship to:
  {name}
  {line1}
  {city}, {state} {postal_code}, {country}

💰 Estimated total: {sum of price × quantity for all items}
💳 Payment: {currency} on {chain}

⚠️  Do you want to place this order?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| Cart items | From `shop:cart view` response `items[]` |
| Shipping fields | From `shop:shipping view` response |
| `{chain}` | From `shop:cart view` response field `payment.chain` |
| `{currency}` | From `shop:cart view` response field `payment.currency` |
| Estimated total | Sum of each item's price × quantity. Parse the `$X.XX` price strings. If a price cannot be parsed, show "see cart" instead of a number. |

**Only after the user responds with "yes", "confirm", "place order", or equivalent, proceed to create a session (if needed) and call `shop:checkout`.**

**Session budget:** The checkout deducts the cart total from the session's spending budget. If the payment fails (e.g., insufficient balance), the reservation is released and the budget is restored. You do not need to manage the budget manually.

#### Success Output (exit code 0)

```json
{
  "order_id": "ord_abc123",
  "crossmint_order_id": "ce5bcec3-b6a0-...",
  "order_status": "payment_submitted",
  "tx_hash": "0xdeadbeef...",
  "currency": "usdc",
  "chain": "ethereum-sepolia",
  "_version": "1",
  "status": "success",
  "hint": "Order placed. Order ID: ord_abc123.",
  "next_command": "kpass shop:order status --order-id ord_abc123 --output json"
}
```

**Note:** The envelope `status` field (`"success"`) is the CLI status. The `order_status` field (`"payment_submitted"`) is the payment provider's order status.

#### Error Output — Cart Empty (exit code 2, `error_code: "cart_empty"`)

```json
{"_version": "1", "status": "error", "error": "cart is empty", "error_code": "cart_empty", "hint": "Cart is empty. Add items before checking out. Run 'kpass shop cart add' to add items.", "next_command": ""}
```
Recovery: Add items to cart first.

#### Error Output — Shipping Incomplete (exit code 2, `error_code: "shipping_incomplete"`)

```json
{"_version": "1", "status": "error", "error": "shipping profile is incomplete", "error_code": "shipping_incomplete", "hint": "Shipping profile is incomplete. Run 'kpass shop shipping view --output json' to see missing fields, then update with 'kpass shop shipping update'.", "next_command": ""}
```
Recovery: Run `shop:shipping view` to see missing fields, then `shop:shipping update`.

#### Error Output — Checkout Not Confirmed (exit code 2, `error_code: "checkout_not_confirmed"`)

```json
{"_version": "1", "status": "error", "error": "checkout not confirmed by user", "error_code": "checkout_not_confirmed", "hint": "Checkout was not confirmed. Include --confirmed flag to proceed with checkout.", "next_command": ""}
```
Recovery: You called checkout without `--confirmed`. The `--confirmed` flag is required.

#### Error Output — No Active Session (exit code 2)

```json
{"status": "error", "error": "No active session."}
```
Recovery: Create a spending session first using the **`request-session`** skill with the cart total as budget.

#### Error Output — No Session Private Key (exit code 3)

```json
{"status": "error", "error": "No session private key found."}
```
Recovery: The session is missing its signing credentials. Re-create and approve a session with `kpass agent:session create`.

#### Error Output — Signature Verification Failed (exit code 3)

```json
{"status": "error", "error": "signature verification failed"}
```
Recovery: The session credentials don't match what the server expects. Re-create and approve a session with `kpass agent:session create`.

#### Error Output — Session Budget Exceeded (exit code 6, `error_code: "session_total_exceeded"`)

```json
{"_version": "1", "status": "error", "error": "payment amount exceeds max_total_amount", "error_code": "session_total_exceeded", "hint": "Payment amount exceeds the session's total budget. Create a new session with a higher --max-total-amount.", "next_command": ""}
```
Recovery: The session budget is too small for the cart total. Create a new session with a higher budget using the **`request-session`** skill.

#### Error Output — Wrong Payment Approach (exit code 6, `error_code: "session_mode_forbidden"`)

```json
{"_version": "1", "status": "error", "error": "payment approach is not allowed by session delegation", "error_code": "session_mode_forbidden", "hint": "Session payment approach is not allowed. Create a new session with the correct payment approach (e.g., --payment-approach crossmint for shopping).", "next_command": ""}
```
Recovery: The session uses the wrong payment approach. Shopping checkout **requires** `crossmint`. If the session was created with `x402` or another approach, create a new session with `--payment-approach crossmint` or `"allowed_payment_approaches": ["crossmint"]` in the delegation.

#### Error Output — Per-Transaction Limit Exceeded (exit code 6, `error_code: "session_rule_exceeded"`)

```json
{"_version": "1", "status": "error", "error": "payment amount exceeds max_amount_per_tx", "error_code": "session_rule_exceeded", "hint": "Payment amount exceeds the session's per-transaction limit. Create a new session with a higher --max-amount-per-tx.", "next_command": ""}
```
Recovery: The cart total exceeds the session's per-transaction limit. Create a new session with a higher `--max-amount-per-tx`.

#### Error Output — Wallet Not Found (exit code 4)

```json
{"status": "error", "error": "user wallet not found"}
```
Recovery: The user's wallet has not been provisioned. This usually means authentication is incomplete. Re-run login.

#### Error Output — Insufficient Balance (exit code 6, `error_code: "insufficient_balance"`)

```json
{"_version": "1", "status": "error", "error": "user Kite balance is insufficient", "error_code": "insufficient_balance", "hint": "Wallet balance is insufficient for this payment. Fund the wallet or reduce the payment amount.", "next_command": ""}
```
Recovery: The user's wallet does not have enough of the payment currency. Check `payment.chain` and `payment.currency` from `shop:cart view` to know which chain and currency are needed. Use the **`wallet-send`** skill to check balance, and fund the wallet before retrying.

#### Error Output — Payment Cap Exceeded (exit code 6, `error_code: "payment_cap_exceeded"`)

```json
{"_version": "1", "status": "error", "error": "payment amount exceeds per-transaction cap", "error_code": "payment_cap_exceeded", "hint": "Payment amount exceeds the per-transaction cap. Try a smaller amount or contact support for higher limits.", "next_command": ""}
```
Recovery: The cart total exceeds the system's per-transaction cap. Try splitting the order into smaller purchases or contact support.

#### Error Output — Service Temporarily Unavailable (exit code 1)

The payment service may be temporarily paused or unavailable. The CLI will return exit code 1 with a message like `"treasury relay is paused"` or `"too many undercollected payments, relay paused until resolved"`. Recovery: Wait and retry after a few minutes. This is a transient infrastructure issue.

#### Error Output — Payment Provider Timeout (exit code 1)

The CLI has a 5-minute timeout for checkout. If it still times out, the payment may have been submitted on-chain but the receipt wasn't confirmed in time. Check `shop:order list` to see if the order was recorded, and `kpass activity` to see the payment attempt status. Retry only after verifying the previous attempt didn't succeed.

#### What to Do After This Command

**MANDATORY display card:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 Order Placed!

📦 Order ID:          {order_id}
🧾 Crossmint Order:   {crossmint_order_id}
💰 Payment:           {currency} on {chain}
🔗 Tx Hash:           {tx_hash}
📋 Status:            {order_status}

Track with: kpass shop:order status --order-id {order_id} --output json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{order_id}` | From JSON field `order_id` |
| `{crossmint_order_id}` | From JSON field `crossmint_order_id` |
| `{currency}` | From JSON field `currency` — uppercase (e.g., `USDC`) |
| `{chain}` | From JSON field `chain` |
| `{tx_hash}` | From JSON field `tx_hash` |
| `{order_status}` | From JSON field `order_status` |

---

### `shop:order status` — Check Order Status

Fetches the latest order status, refreshing from the payment provider if the order is not yet completed.

```
kpass shop:order status --order-id <ID> --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Order ID | `--order-id` | Yes | From checkout response `order_id` | Non-empty string |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

```json
{
  "order_id": "ord_abc123",
  "crossmint_order_id": "ce5bcec3-...",
  "phase": "completed",
  "payment_status": "confirmed",
  "tx_hash": "0xdeadbeef...",
  "currency": "usdc",
  "chain": "ethereum-sepolia",
  "_version": "1",
  "status": "success",
  "hint": "Order ord_abc123: completed",
  "next_command": ""
}
```

**Note:** This endpoint does NOT include delivery status. For delivery tracking, use `shop:order delivery`.

#### Error Output — Order Not Found (exit code 4)

Check the order ID is correct.

#### What to Do After This Command

**MANDATORY display card:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Order Status

  📋 Order:     {order_id}
  🔄 Phase:     {phase}
  💳 Payment:   {payment_status}
  🔗 Tx Hash:   {tx_hash}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If the user asks about delivery or tracking, use `shop:order delivery` instead.

---

### `shop:order delivery` — Check Delivery Status

Fetches the latest delivery status from the payment provider. Unlike `shop:order status` (which uses cached data for completed orders), this always makes a live API call to get real-time delivery and tracking info.

```
kpass shop:order delivery --order-id <ID> --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Order ID | `--order-id` | Yes | From checkout response `order_id` | Non-empty string |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

```json
{
  "order_id": "ord_abc123",
  "crossmint_order_id": "ce5bcec3-...",
  "delivery_status": "shipped",
  "tracking_number": "1Z999AA10123456784",
  "tracking_url": "https://track.example.com/1Z999AA10123456784",
  "carrier": "UPS",
  "estimated_arrival": "2026-04-10",
  "_version": "1",
  "status": "success",
  "hint": "Order ord_abc123 delivery: shipped",
  "next_command": ""
}
```

**Key fields:**
- `delivery_status` — Current delivery state (e.g., `"pending"`, `"shipped"`, `"delivered"`, `"unknown"`).
- `tracking_number` — Carrier tracking number (may be empty if not yet shipped).
- `tracking_url` — URL to track the shipment (may be empty).
- `carrier` — Shipping carrier name (may be empty).
- `estimated_arrival` — Estimated delivery date (may be empty).

#### What to Do After This Command

**MANDATORY display card:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚚 Delivery Status

  📋 Order:     {order_id}
  📦 Status:    {delivery_status}
  🏢 Carrier:   {carrier}
  🔢 Tracking:  {tracking_number}
  🔗 Track URL: {tracking_url}
  📅 ETA:       {estimated_arrival}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Omit lines where the value is empty (e.g., if no tracking number yet, don't show the Tracking line).

---

### `shop:order list` — List All Orders

Returns all orders for the user, newest first.

```
kpass shop:order list --output json
```

#### Success Output (exit code 0)

```json
{
  "orders": [
    {
      "order_id": "ord_abc123",
      "phase": "completed",
      "payment_status": "confirmed",
      "currency": "usdc",
      "chain": "ethereum-sepolia"
    }
  ],
  "_version": "1",
  "status": "success",
  "hint": "Found 1 order(s).",
  "next_command": ""
}
```

---

## Complete Worked Example: Buy a USB-C Cable

**Context:** User says "I want to buy a type C cable".

---

**Step 1: Search.** User wants a type C cable — run a product search.
```bash
kpass shop:search --query "type C cable" --output json
```

**Agent says:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Search Results — "type C cable"

  1. Amazon Basics USB-C Cable, 6 Foot, White
     💲 $5.85  ⭐ 4.5 (54,800 reviews)
     🏷️  ID: B01GGKZ2SC

  2. LISEN USB C to USB C Cable, 5-Pack
     💲 $8.99  ⭐ 4.6 (13,800 reviews)
     🏷️  ID: B0CFQ5T5F6

  3. Anker USB C to USB C Cable (6 FT, 2Pack)
     💲 $9.99  ⭐ 4.7 (79,300 reviews)
     🏷️  ID: B088NRLMPV

Reply with a number to add to cart.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Which one would you like? You can also say "the cheapest" or "the best rated".
```

---

**Step 2: User picks an item.** User says "add the Anker one".

The user said "the Anker one" (singular), so add 1:
```bash
kpass shop:cart add --provider amazon --external-id B088NRLMPV --output json
```

**Agent says:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Added to Cart

  Anker USB C to USB C Cable (6 FT, 2Pack)
  💲 $9.99  ×1

Cart now has 1 item(s).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Would you like to keep shopping, or proceed to checkout?
```

---

**Step 3: User wants to checkout.** User says "let's checkout".

**Agent checks shipping first:**
```bash
kpass shop:shipping view --output json
```
Response: `"missing": ["email", "line1", "city", "state", "postal_code"]`, `"complete": false`.

**Agent says:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Shipping Profile ⚠️  Incomplete

  Missing: email, line1, city, state, postal_code

  Please provide:
  - Email address
  - Street address
  - City, State, ZIP code
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

I need a few details to ship your order. You can provide them all at once, like:

"Jane Doe, jane@example.com, 456 Oak Ave, Austin, TX 78701"
```

---

**Step 4: User provides shipping.** User says "Jane Doe, jane@example.com, 456 Oak Ave, Austin, TX 78701".

```bash
kpass shop:shipping update --name "Jane Doe" --email "jane@example.com" --line1 "456 Oak Ave" --city "Austin" --state "TX" --postal "78701" --output json
```

**Agent says:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Shipping Profile ✅

  👤 Jane Doe
  📧 jane@example.com
  🏠 456 Oak Ave
     Austin, TX 78701
     US
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

**Step 5: Order summary and confirmation.** Agent shows the mandatory confirmation card:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Order Summary — Please Confirm

🛒 Cart:
  1. Anker USB C to USB C Cable (6 FT, 2Pack)
     💲 $9.99  ×1

📦 Ship to:
  Jane Doe
  456 Oak Ave
  Austin, TX 78701, US

💰 Estimated total: $9.99
💳 Payment: USDC on ethereum-sepolia

⚠️  Do you want to place this order?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

**Step 6: User confirms.** User says "yes, place the order".

Cart total is $9.99. Agent needs a spending session — uses the **`request-session`** skill with the cart total as the budget source and `crossmint` as the payment approach. Example delegation:

```json
{"task":{"summary":"Shopping checkout — estimated total $9.99"},"payment_policy":{"allowed_payment_approaches":["crossmint"],"assets":["USDC"],"max_amount_per_tx":"15","max_total_amount":"15","ttl_seconds":3600}}
```

The `form-session-delegation` skill derives the parameters (per-tx limit, total budget, TTL) from the cart total. The user approves the session via passkey.

Once the session is active (session ID is automatically saved in agent config), run checkout:
```bash
kpass shop:checkout --confirmed --output json
```
The checkout automatically uses the current session and deducts the cart total from its budget.

**Agent says:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 Order Placed!

📦 Order ID:          ord_abc123
🧾 Crossmint Order:   ce5bcec3-b6a0-...
💰 Payment:           USDC on ethereum-sepolia
🔗 Tx Hash:           0xdeadbeef...
📋 Status:            payment_submitted

Track with: kpass shop:order status --order-id ord_abc123 --output json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your order is placed! I'll keep the order ID so you can check status anytime.
```

---

**Step 7: Order tracking.** User asks "what's the status of my order?" later.

```bash
kpass shop:order status --order-id ord_abc123 --output json
```

**Agent says:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Order Status

  📋 Order:     ord_abc123
  🔄 Phase:     completed
  💳 Payment:   confirmed
  🔗 Tx Hash:   0xdeadbeef...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If the user asks about delivery: `kpass shop:order delivery --order-id ord_abc123 --output json`

---

## Complete Worked Example: Multiple Items with Quantity

**Context:** User says "I need 3 of those LISEN cables and also add the Amazon Basics one".

**Agent recognizes two items from the previous search results.**

```bash
kpass shop:cart add --provider amazon --external-id B0CFQ5T5F6 --quantity 3 --output json
```
**Agent says:** "Added 3x LISEN USB C Cable ($8.99 each) to your cart."

```bash
kpass shop:cart add --provider amazon --external-id B01GGKZ2SC --output json
```
**Agent says:** "Added 1x Amazon Basics USB-C Cable ($5.85) to your cart."

```bash
kpass shop:cart view --output json
```
**Agent says:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛒 Shopping Cart (2 item(s))

  1. LISEN USB C to USB C Cable, 5-Pack
     💲 $8.99  ×3
     🏷️  amazon:B0CFQ5T5F6

  2. Amazon Basics USB-C Cable, 6 Foot, White
     💲 $5.85  ×1
     🏷️  amazon:B01GGKZ2SC

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Estimated total: $32.82. Ready to checkout, or want to keep shopping?
```

---

## Complete Worked Example: User Says "Buy This" Without Searching

**Context:** User says "add this coffee to cart" without a prior search.

**Agent says:** "I'd need to find that product first. What kind of coffee are you looking for? For example, 'ground coffee', 'coffee pods', or a specific brand?"

User says: "Maxwell House ground coffee".

```bash
kpass shop:search --query "Maxwell House ground coffee" --output json
```

Agent displays results. User picks one.

User says: "add 2 of those".

```bash
kpass shop:cart add --provider amazon --external-id B0CXYYWL6G --quantity 2 --output json
```

---

## Complete Worked Example: Insufficient Balance at Checkout

**Step 1:** Checkout fails with "ERC20: transfer amount exceeds balance".

**Agent says:**
```
⚠️ Checkout failed — your wallet doesn't have enough {currency} on {chain} to cover this order.

Your cart total is approximately $9.99 in {currency}. You can check your wallet balance with the `wallet-send` skill, or fund your wallet before trying again.
```

**Agent does NOT auto-retry.** The user needs to fund the wallet first.

---

## Error Handling

| Exit Code | Meaning | Error Message Pattern | Recovery Action |
|-----------|---------|----------------------|-----------------|
| 0 | Success | `status: "success"` | Present the result using the appropriate display card. |
| 1 | Network error / service unavailable | `network error: ...`, `context deadline exceeded`, `treasury relay is paused`, `service is temporarily unavailable` | Retry after 10–30 seconds. The payment provider can be slow, or the payment service may be temporarily paused. |
| 2 | Usage error | `Missing --query flag`, `Missing required flags`, `error_code: "checkout_not_confirmed"`, `"cart_empty"`, `"shipping_incomplete"`, `"cart_item_invalid_price"`, `No active session` | Fix the command flags or complete the prerequisite (fill cart, complete shipping, add `--confirmed`, create a session). Check `error_code` for the specific issue. |
| 3 | Auth error | `Agent not registered`, `invalid authorization header` | Register the agent: `kpass agent:register --type claude --output json`. If that fails with "Not logged in", use **`authenticate-user`** first. |
| 4 | Not found | `order not found`, `user wallet not found` | Check the ID is correct. For wallet errors, re-run login. |
| 5 | Rate limited | `rate limit` | Wait 30 seconds, then retry. |
| 6 | Session policy / payment violation | `error_code: "session_mode_forbidden"`, `"session_total_exceeded"`, `"session_rule_exceeded"`, `"session_asset_forbidden"`, `"session_endpoint_forbidden"`, `"insufficient_balance"`, `"payment_cap_exceeded"`, `"merchant_not_allowed"` | Do NOT re-authenticate. Check `error_code` and `hint` for the specific violation. For session policy errors, create a new session with corrected parameters using the **`request-session`** skill. For `insufficient_balance`, fund the wallet. For `payment_cap_exceeded`, reduce the order size. |

**Error envelope fields:** Error responses include `error` (raw backend message), `error_code` (machine-readable classification — prefer this for programmatic matching), and `hint` (recovery guidance).

### Specific Error Scenarios

**`error_code: "cart_empty"` (exit code 2):**
- The user tried to checkout with no items. Search for products and add to cart first.

**`error_code: "shipping_incomplete"` (exit code 2):**
- Missing shipping fields. Run `shop:shipping view` to see which fields are missing, ask the user, then `shop:shipping update`.

**`error_code: "checkout_not_confirmed"` (exit code 2):**
- You forgot `--confirmed`. Always pass this flag — but only after the user explicitly confirmed.

**`error_code: "cart_item_invalid_price"` (exit code 2):**
- A cart item has an invalid or missing price. Remove the item and re-add from a fresh search.

**"user wallet not found" (exit code 4):**
- The user's payment wallet is not provisioned. Usually means authentication is incomplete. Try logging out and back in.

**`error_code: "insufficient_balance"` (exit code 6):**
- The wallet does not have enough of the payment currency. Check `payment.chain` and `payment.currency` from `shop:cart view` to tell the user exactly what's needed. Use the **`wallet-send`** skill to check balance.

**`error_code: "payment_cap_exceeded"` (exit code 6):**
- The cart total exceeds the system's per-transaction cap. Try splitting the order into smaller purchases.

**`error_code: "merchant_not_allowed"` (exit code 6):**
- The merchant URL is not allowlisted for payments. This is an infrastructure issue — contact support.

**"Invalid product locator" (from checkout):**
- The `external_identifier` in the cart is invalid. Clear the cart and re-add items from a fresh search.

**Service temporarily unavailable (exit code 1):**
- The payment service is paused or temporarily unavailable (`"treasury relay is paused"`, `"too many undercollected payments"`). Wait a few minutes and retry.

**Timeout errors (exit code 1):**
- The payment provider can be slow in staging. Retry after 30 seconds. If persistent, try again later.

---

## Input Validation Checklist

Before running any command, verify:

1. **Search query (`--query`):** Non-empty string. If the user says "buy something" without specifics, ask what they're looking for.
2. **Provider (`--provider`):** Always pass through from search results or cart view. Never hardcode or guess.
3. **External ID (`--external-id`):** Always pass through from search results or cart view. Never invent or guess IDs. If the user says "add this" without specifying, ask which item number.
4. **Shipping fields:** Check `shop:shipping view` before checkout. All fields in `missing` must be filled.
5. **Checkout confirmation:** Must have explicit user approval. Never assume.
6. **Order ID (`--order-id`):** Must come from a previous checkout response.

---

## Cross-Skill References

### Prerequisites (before this skill)

- **Authentication:** User must be logged in. Use the **`authenticate-user`** skill.
- **Agent registration:** Agent must be registered. Use `agent:register` from the **`request-session`** skill.
- **Spending session (checkout only):** Use the **`request-session`** skill to create a session before checkout.
- **Wallet balance:** To check if the wallet has enough funds for checkout, use the **`wallet-send`** skill (`wallet balance`).
- **Diagnostics:** To inspect agent registration and sessions, use the **`manage-agents`** skill.

### After Completion (what to do next)

- **After successful checkout:** Suggest the user can track their order with `kpass shop:order status` or check delivery with `kpass shop:order delivery`. Mention that `activity` shows this purchase in their transaction history.
- **After adding items to cart:** If the user's task is complete (e.g., "add to cart only"), stop. Otherwise, guide toward shipping and checkout.
- **After order status check:** If the user seems done, mention that `activity` provides a full spending overview.
