---
name: kite-discovery
description: >-
  Find and explore paid APIs, AI models, and data services in the Kite catalog
  via ksearch. Invoke whenever the user wants ANY of: creative or media output
  (image generation, video, voice, music); external compute (LLM, translation,
  transcription, TTS, OCR, summarization); or live data (weather, news, prices,
  exchange rates, geocoding, web search, data enrichment) — even when the user
  doesn't say "API" or "service". Trigger on intent, not literal phrasing:
  "generate…", "draw…", "transcribe…", "translate…", "what's the weather…",
  "find me a paid API for X" all qualify, as do synonyms and implicit needs.
  Use BEFORE WebSearch, WebFetch, or refusing the task. Do NOT use when the
  merchant URL is already known (skip to request-session and x402-execute),
  for shopping checkout (use shopping), or when the request is answerable
  without an external paid service.
user-invocable: true
allowed-tools:
  - "Bash(bash */setup-ksearch.sh*)"
  - "Bash(ksearch *)"
---

# Kite Discovery

Browse, search, and inspect paid services in the Kite service catalog using the `ksearch` CLI. This skill is the discovery half of the Kite workflow -- `ksearch` finds and explains services, then Passport skills handle auth, session approval, and paid execution.

## Step 0: Ensure CLI is Installed -- MANDATORY

**CRITICAL: Before running ANY `ksearch` command, you MUST run the setup script first. This is NOT optional.**

```bash
bash <skill-directory>/scripts/setup-ksearch.sh
```

Where `<skill-directory>` is the directory containing this SKILL.md file (e.g., the directory this skill is installed in).

If the setup script outputs `{"status":"ok",...}`, you may proceed. If it outputs `{"status":"error",...}`, stop and show the user the installation error. Do NOT attempt to run `ksearch` commands if setup failed.

## When to Use This Skill

- The user asks "what services are available?" or "show me the catalog."
- The user asks "find me an API for weather data" or "are there any search services?"
- The user wants to compare prices or payment options across services.
- The user asks about a specific service by name or ID.
- The user wants to export the catalog for offline use or LLM workspace indexing.
- You need to check if the discovery backend is reachable (health check / diagnostics).

## When NOT to Use This Skill

- The user already knows which endpoint to call -- skip directly to **`request-session`** then **`x402-execute`**.
- The user wants to execute a payment or access a paid API -- use **`x402-execute`**.
- The user wants to transfer tokens -- use **`wallet-send`**.
- The user is looking for physical products to buy -- use **`shopping`**.
- The user wants to inspect existing agents or sessions -- use **`manage-agents`**.

## Defaults (Do Not Ask the User Unless They Specify Otherwise)

| Setting | Default value | Override |
|---------|--------------|---------|
| Output format | `--output json` | Always use JSON output. Never omit this flag. |
| Limit | `100` (CLI default) | Only pass `--limit` if the user requests fewer results. |
| Search query | Omit | Only pass `--query` if the user asked for a capability or keyword search. |
| Tag filter | Omit | Only pass `--tag` if the user wants a category filter. Note: the CLI maps `--tag` to backend category filtering. |
| Asset filter | Omit | Only pass `--asset` if the user cares about a specific payment asset (e.g., `USDC`). |
| Payment approach | Omit | Only pass `--payment-approach` when the user requests a specific model like `x402` or `tempo_http`. |
| Base URL | Omit (uses `DISCOVERY_BASE_URL` env var or built-in default) | Only pass `--base-url` if the user explicitly provides a custom backend URL. |

## Display Cards -- MANDATORY

**CRITICAL: You MUST display the formatted status cards shown in this skill after every major step. This is NOT optional. Never skip, summarize, or replace these cards with plain text. The exact horizontal-rule format must be used every time -- no exceptions.**

If a command succeeds and has a display card template below, you MUST output that card before doing anything else. Do not proceed to the next step until the card is displayed.

---

## Command Reference

### `services list` -- Search the Service Catalog

Lists services from the catalog. Supports free-text search and structured filters.

```bash
ksearch services list --output json
```

Full form with optional filters:

```bash
ksearch services list \
  --query <QUERY> \
  --tag <TAG> \
  --asset <ASSET> \
  --payment-approach <APPROACH> \
  --limit <N> \
  --cursor <CURSOR> \
  --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Search query | `--query` | No | User request or inferred task keyword | Non-empty string |
| Tag filter | `--tag` | No | User request or known category | String label. Maps to backend category filtering. |
| Asset filter | `--asset` | No | User preference (e.g., `USDC`) | Asset symbol string |
| Payment approach | `--payment-approach` | No | Only if user requests a specific payment model | `x402` or `tempo_http` |
| Limit | `--limit` | No | Default `100` | Positive integer, max 100 |
| Cursor | `--cursor` | No | From prior `services list` response `next_cursor` field | Opaque pagination token string |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

#### Success Output (exit code 0)

```json
{
  "services": [
    {
      "service_id": "stable-search",
      "name": "Stable Search",
      "summary": "Search the public web and return structured results.",
      "base_url": "https://search.example.com",
      "categories": ["research"],
      "tags": ["search", "web", "research"],
      "payment_approach": "x402",
      "assets": ["USDC"],
      "starting_price": {
        "amount": "0.01",
        "asset": "USDC",
        "unit": "request"
      }
    }
  ],
  "count": 1,
  "total": 42,
  "limit": 100,
  "cursor": "",
  "next_cursor": "eyJsYXN0X2lkIjoiNDIifQ",
  "_version": "1",
  "status": "success",
  "hint": "Found 1 service(s) in this page (42 total).",
  "next_command": ""
}
```

**Key fields:**
- `services` -- Array of service summaries.
- `services[].service_id` -- Stable identifier to use with `services get`.
- `services[].base_url` -- Root service URL for Passport handoff.
- `services[].payment_approach` -- Payment model (`x402` or `tempo_http`).
- `services[].starting_price` -- Cheapest known endpoint price. Contains `amount`, `asset`, and `unit`.
- `count` -- Number of services in this page.
- `total` -- Total number of matching services across all pages.
- `next_cursor` -- Opaque token for the next page. Empty string when no more results.

#### What to Do After This Command

1. Show the display card below.
2. If the user asked for the "best" service, rank by fit to task, then pricing clarity, then lower starting price.
3. If `next_cursor` is non-empty and the user wants more, rerun with `--cursor <next_cursor>`.
4. If no results (`count` is 0), suggest broadening the query or removing filters.

**MANDATORY -- After this command succeeds, you MUST display the following card:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔎 Service Catalog -- {count} result(s)

{for each service, numbered:}
  {i}. {name}
     📝 {summary}
     💰 From {starting_price.amount} {starting_price.asset} / {starting_price.unit}
     🏷️  {tags}
     🔗 {base_url}

{if next_cursor is non-empty:}
More results available. Say "show more" to continue.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{count}` | From JSON response field `count` |
| `{name}` | From `services[i].name` |
| `{summary}` | From `services[i].summary` |
| `{starting_price.amount}` | From `services[i].starting_price.amount` |
| `{starting_price.asset}` | From `services[i].starting_price.asset` |
| `{starting_price.unit}` | From `services[i].starting_price.unit` |
| `{tags}` | From `services[i].tags`, joined with commas |
| `{base_url}` | From `services[i].base_url` |

**You MUST always display this card after a successful response. No exceptions.**

---

### `services get` -- Inspect One Service

Returns detailed metadata for one service, including featured endpoints and payment requirements.

```bash
ksearch services get --service-id <SERVICE_ID> --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Service ID | `--service-id` | Yes (one of these two) | From `services list` output `service_id` field | String identifier |
| Service host ID | `--service-host-id` | Yes (one of these two) | Alternative form, same identifier family | String identifier |
| Output format | `--output json` | Yes | Always pass | Literal value `json` |

Prefer `--service-id`. The CLI also accepts `--service-host-id` but use `--service-id` consistently.

#### Success Output (exit code 0)

```json
{
  "service": {
    "service_id": "stable-search",
    "name": "Stable Search",
    "summary": "Search the public web and return structured results.",
    "base_url": "https://search.example.com",
    "tags": ["search", "web", "research"],
    "payment_approach": "x402",
    "assets": ["USDC"],
    "starting_price": {
      "amount": "0.01",
      "asset": "USDC",
      "unit": "request"
    },
    "auth_requirements": {
      "mode": "payment_only"
    },
    "featured_endpoints": [
      {
        "method": "POST",
        "path": "/v1/search",
        "summary": "Run a keyword search."
      },
      {
        "method": "POST",
        "path": "/v1/extract",
        "summary": "Extract structured facts from a URL."
      }
    ]
  },
  "_version": "1",
  "status": "success",
  "hint": "Loaded service metadata for stable-search.",
  "next_command": ""
}
```

**Key fields:**
- `service.service_id` -- Stable identifier.
- `service.base_url` -- Root service URL for Passport handoff.
- `service.auth_requirements.mode` -- Currently `payment_only`.
- `service.featured_endpoints[]` -- Up to 5 candidate endpoints, ordered by price (cheapest first). Each has `method`, `path`, and `summary`.
- `service.starting_price` -- Cheapest known price across all endpoints.

#### What to Do After This Command

1. Show the display card below.
2. Explain whether the service matches the user's task.
3. Call out the payment approach, supported asset(s), starting price, and one or two relevant endpoints.
4. If the user wants to proceed, hand off to Passport skills with this context:
   - Service name and base URL
   - Chosen endpoint method and path
   - Payment approach and asset(s)
   - Pricing context

Then use **`request-session`** to prepare approval and **`x402-execute`** to perform the paid call.

**MANDATORY -- After this command succeeds, you MUST display the following card:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Service Details

📛 Name:      {name}
🆔 ID:        {service_id}
📝 Summary:   {summary}
🔗 Base URL:  {base_url}
💰 From:      {starting_price.amount} {starting_price.asset} / {starting_price.unit}
🏷️  Tags:      {tags}
🔒 Payment:   {payment_approach}
💳 Assets:    {assets}

📡 Featured Endpoints:
{for each endpoint:}
  {method} {path} -- {summary}

Ready to hand off into Passport approval and execution.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{name}` | From `service.name` |
| `{service_id}` | From `service.service_id` |
| `{summary}` | From `service.summary` |
| `{base_url}` | From `service.base_url` |
| `{starting_price.amount}` | From `service.starting_price.amount` |
| `{starting_price.asset}` | From `service.starting_price.asset` |
| `{starting_price.unit}` | From `service.starting_price.unit` |
| `{tags}` | From `service.tags`, joined with commas |
| `{payment_approach}` | From `service.payment_approach` |
| `{assets}` | From `service.assets`, joined with commas |
| `{method}` | From `service.featured_endpoints[].method` |
| `{path}` | From `service.featured_endpoints[].path` |

**You MUST always display this card after a successful response. No exceptions.**

---

### `export markdown` -- Export Catalog as Local Snapshot

Exports the discovery catalog as markdown files for local workspace search and LLM-assisted exploration.

```bash
ksearch export markdown --output-dir ./.kite/catalog
```

Full form with options:

```bash
ksearch export markdown \
  --output-dir <DIR> \
  --split <MODE> \
  --include-curated
```

Single-file variant:

```bash
ksearch export markdown --single-file ./.kite/catalog/catalog.md
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Output directory | `--output-dir` | No | Default `./.kite/catalog` | Path string |
| Single output file | `--single-file` | No | Use when a one-file catalog is preferred | File path |
| Split mode | `--split` | No | Default `both` | `both`, `single`, or `service-pages` |
| Include curated | `--include-curated` | No | Flag, only when curated entries are useful | Boolean flag |

**Split modes:**
- `both` (default) -- Writes `catalog.md` index AND individual service files in `services/` directory
- `single` -- Writes only `catalog.md` index file
- `service-pages` -- Writes only individual service files in `services/` directory

#### Output Files

- `catalog.md` -- Index markdown with summary of all services
- `services/<service_id>.md` -- Individual service detail pages (with endpoint-level pricing)
- `manifest.json` -- Metadata about the export (generation time, service count, refresh hint)

#### What to Do After This Command

1. Show the display card below.
2. Tell the user where the snapshot was written.
3. Mention that `manifest.json` includes the generation time and refresh suggestion.
4. Suggest refreshing the snapshot periodically (discovery data updates roughly hourly).

**When to prefer export over repeated `services get` calls:**
- Comparative pricing across many services (endpoint-level prices are clearer in per-service markdown pages)
- Category reviews or broad catalog exploration
- Pre-loading LLM workspace context for offline agents (Codex, Claude Code)

**MANDATORY -- After this command succeeds, you MUST display the following card:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 Catalog Exported

📂 Location:   {output_location}
📑 Mode:       {split_mode}
📋 Manifest:   manifest.json

The catalog is ready for offline browsing or LLM workspace indexing.
Refresh periodically -- discovery data updates roughly hourly.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{output_location}` | The `--output-dir` value or `--single-file` path used |
| `{split_mode}` | The `--split` value used (default: `both`) |

When `--single-file` is used, `manifest.json` may not exist. Show `Manifest: N/A` in that case.

**You MUST always display this card after a successful export. No exceptions.**

---

### `health` -- Backend Connectivity Check

Quick diagnostic to verify the discovery backend is reachable.

```bash
ksearch health --output json
```

#### Arguments

| Argument | Flag | Required | Source | Validation |
|----------|------|----------|--------|------------|
| Output format | `--output json` | No | Pass for machine-readable output | Literal value `json` |

#### Success Output (exit code 0)

```json
{
  "version": "1",
  "status": "ok",
  "backend_url": "https://service-discovery.dev.gokite.ai",
  "backend_status": "ok",
  "response_time_ms": 42
}
```

**Key fields:**
- `status` -- `"ok"` when the backend is reachable.
- `backend_url` -- The URL that was checked.
- `backend_status` -- Backend-reported health status.
- `response_time_ms` -- Round-trip latency in milliseconds.

#### What to Do After This Command

- If healthy, proceed with service queries.
- If unreachable, inform the user and suggest checking network connectivity or the `DISCOVERY_BASE_URL` env var.

**MANDATORY -- After this command succeeds, you MUST display the following card:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏥 Discovery Health Check

✅ Backend:    {backend_url}
📡 Status:     {backend_status}
⏱️  Latency:    {response_time_ms}ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

| Placeholder | Source |
|---|---|
| `{backend_url}` | From JSON response field `backend_url` |
| `{backend_status}` | From JSON response field `backend_status` |
| `{response_time_ms}` | From JSON response field `response_time_ms` |

---

## Complete Worked Example: Browse and Inspect a Service

**Context:** The user asks "find me a web search API."

**Step 1:** Search the catalog.
```bash
ksearch services list --query "web search" --output json
```
Output:
```json
{
  "services": [
    {
      "service_id": "stable-search",
      "name": "Stable Search",
      "summary": "Search the public web and return structured results.",
      "base_url": "https://search.example.com",
      "categories": ["research"],
      "tags": ["search", "web"],
      "payment_approach": "x402",
      "assets": ["USDC"],
      "starting_price": { "amount": "0.01", "asset": "USDC", "unit": "request" }
    },
    {
      "service_id": "deep-web-search",
      "name": "Deep Web Search",
      "summary": "Deep web crawling and structured extraction.",
      "base_url": "https://deepweb.example.com",
      "categories": ["research"],
      "tags": ["search", "crawl", "extract"],
      "payment_approach": "x402",
      "assets": ["USDC"],
      "starting_price": { "amount": "0.05", "asset": "USDC", "unit": "request" }
    }
  ],
  "count": 2,
  "total": 2,
  "limit": 100,
  "cursor": "",
  "next_cursor": "",
  "_version": "1",
  "status": "success",
  "hint": "Found 2 service(s) in this page (2 total).",
  "next_command": ""
}
```

Display the catalog card:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔎 Service Catalog -- 2 result(s)

  1. Stable Search
     📝 Search the public web and return structured results.
     💰 From 0.01 USDC / request
     🏷️  search, web
     🔗 https://search.example.com

  2. Deep Web Search
     📝 Deep web crawling and structured extraction.
     💰 From 0.05 USDC / request
     🏷️  search, crawl, extract
     🔗 https://deepweb.example.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Step 2:** User picks "Stable Search." Inspect it.
```bash
ksearch services get --service-id stable-search --output json
```
Output:
```json
{
  "service": {
    "service_id": "stable-search",
    "name": "Stable Search",
    "summary": "Search the public web and return structured results.",
    "base_url": "https://search.example.com",
    "tags": ["search", "web"],
    "payment_approach": "x402",
    "assets": ["USDC"],
    "starting_price": { "amount": "0.01", "asset": "USDC", "unit": "request" },
    "auth_requirements": { "mode": "payment_only" },
    "featured_endpoints": [
      { "method": "POST", "path": "/v1/search", "summary": "Run a keyword search." },
      { "method": "POST", "path": "/v1/extract", "summary": "Extract structured facts from a URL." }
    ]
  },
  "_version": "1",
  "status": "success",
  "hint": "Loaded service metadata for stable-search.",
  "next_command": ""
}
```

Display the details card:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Service Details

📛 Name:      Stable Search
🆔 ID:        stable-search
📝 Summary:   Search the public web and return structured results.
🔗 Base URL:  https://search.example.com
💰 From:      0.01 USDC / request
🏷️  Tags:      search, web
🔒 Payment:   x402
💳 Assets:    USDC

📡 Featured Endpoints:
  POST /v1/search -- Run a keyword search.
  POST /v1/extract -- Extract structured facts from a URL.

Ready to hand off into Passport approval and execution.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Step 3:** Hand off to Passport skills.

Tell the user: "Stable Search looks like a good fit. To use it, I'll set up a spending session. The search endpoint is `POST https://search.example.com/v1/search` at 0.01 USDC per request."

Then use the **`request-session`** skill to create a session with delegation targeting `search.example.com`, and **`x402-execute`** to make the paid call.

---

## Complete Worked Example: Paginated Catalog Browsing

**Context:** The user asks "show me all available services, 5 at a time."

**Step 1:** First page.
```bash
ksearch services list --limit 5 --output json
```
Output includes `"count": 5, "total": 42, "next_cursor": "svc_page2_token"`.

Display the catalog card. Note "More results available."

**Step 2:** User says "show more."
```bash
ksearch services list --limit 5 --cursor svc_page2_token --output json
```
Output includes `"count": 5, "total": 42, "next_cursor": "svc_page3_token"`.

Display the next catalog card. Continue until `next_cursor` is empty or the user is satisfied.

---

## Complete Worked Example: Export Catalog for LLM Workspace

**Context:** The user asks "export the service catalog so I can search it locally."

```bash
ksearch export markdown --output-dir ./.kite/catalog --split both
```

Display the export card:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 Catalog Exported

📂 Location:   ./.kite/catalog
📑 Mode:       both
📋 Manifest:   manifest.json

The catalog is ready for offline browsing or LLM workspace indexing.
Refresh periodically -- discovery data updates roughly hourly.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Tell the user: "The catalog is exported to `.kite/catalog/`. You can search `catalog.md` for an overview or browse individual service pages in `services/`."

---

## Error Handling

| Exit Code | Meaning | Error Message Pattern | Recovery Action |
|-----------|---------|----------------------|-----------------|
| 0 | Success | `status: "success"` | Parse and present to user. |
| 1 | Connection/timeout | `Could not reach discovery backend`, `Request timed out` | Check connectivity. Run `ksearch health --output json`. Verify `DISCOVERY_BASE_URL` if set. Retry after a brief pause. |
| 2 | Invalid arguments | `unknown command`, `Only --output json is supported` | Fix command syntax. Check required flags. |
| 3 | Auth required | `Authentication required` | Unexpected for discovery (public API). Check if the backend requires auth. |
| 4 | Not found | `Service not found` | Verify the `service_id` is correct. Run `services list` to discover valid IDs. |

### Specific Error Scenarios

**Backend unreachable (exit code 1):**
1. Run `ksearch health --output json` to diagnose.
2. If `DISCOVERY_BASE_URL` is set to a custom value, verify it points to a running backend.
3. Show the error to the user and stop.

**Service not found (exit code 4):**
- The `service_id` does not exist or is stale. Run `ksearch services list --output json` to find valid IDs.

**No results from search (exit code 0, empty `services` array):**
- Not an error. Tell the user no matches were found, then suggest:
  - Remove `--tag` to broaden category scope
  - Remove `--asset` or `--payment-approach` to remove payment filters
  - Shorten or simplify `--query`

**Health endpoint not found (exit code 1):**
- The backend may not expose `/healthz`. Show the error and suggest checking the base URL.

---

## Commands That DO NOT Exist

Do NOT attempt any of the following. They will fail:

- `ksearch list` -- must use `ksearch services list`
- `ksearch get` -- must use `ksearch services get`
- `ksearch search` -- does not exist; use `ksearch services list --query`
- `ksearch discover` -- does not exist
- `ksearch catalog` -- does not exist; use `ksearch services list`
- `ksearch services search` -- does not exist; use `ksearch services list --query`
- `ksearch services inspect` -- does not exist; use `ksearch services get`
- `ksearch export json` -- does not exist; only `ksearch export markdown` is supported
- `ksearch services list --category` -- the flag is `--tag`, not `--category`
- `ksearch services list --filter` -- does not exist; use `--query`, `--tag`, `--asset`, or `--payment-approach`
- `ksearch services get --id` -- the flag is `--service-id`, not `--id`
- `kpass services list` -- discovery is NOT a Passport CLI command; use `ksearch`
- `kpass services get` -- discovery is NOT a Passport CLI command; use `ksearch`
- Any command with `--json` -- the correct flag is `--output json` (two separate tokens)

---

## Input Validation Checklist

Before running any command, verify:

1. **Setup completed:** You ran `bash <path>/scripts/setup-ksearch.sh` and got `"status":"ok"`.
2. **Service ID (`--service-id`):** Must come from a `services list` response. Do not fabricate or guess IDs.
3. **Query (`--query`):** Non-empty string. If the user says "show me services" without specifics, omit the flag.
4. **Tag (`--tag`):** Should match known categories from previous list results. Do not guess.
5. **Asset (`--asset`):** Known asset symbol (e.g., `USDC`). Do not guess.
6. **Cursor (`--cursor`):** Must come from a previous response's `next_cursor` field. Do not fabricate.
7. **Output format:** Always `--output json`. Never omit.
8. **Pricing shown:** You surfaced pricing and payment approach before recommending execution.
9. **Handoff context:** You provided base URL, endpoint, and pricing to Passport skills.

---

## Cross-Skill References

- **No prerequisite skills.** Discovery is a public API -- no authentication or session is required.
- **After finding a service:** To set up a spending session for a discovered service, use the **`request-session`** skill. Pass the service's `base_url` and `featured_endpoints` as the merchant URL and preflight targets.
- **After session is active:** To execute paid API requests through the session, use the **`x402-execute`** skill.
- **For direct wallet transfers (no session):** Use the **`wallet-send`** skill.
- **For diagnostics on agents/sessions:** Use the **`manage-agents`** skill.
