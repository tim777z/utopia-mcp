# Utopia Megastore — MCP server

MCP (Model Context Protocol) server for [Utopia Megastore](https://utopia-megastore.pages.dev) — a
real store selling tech and desk gear (wireless earbuds, mechanical keyboards, GaN chargers, monitor
light bars, smart plugs, desk mats, webcams), sourced to order via CJ Dropshipping with USPS last-mile.

**Remote, hosted, no install.** No API key, no npm package.

- **Endpoint:** `POST https://utopia-orders.precogsecurity.workers.dev/mcp`
- **Transport:** Streamable HTTP, stateless, JSON responses
- **Protocol:** `2025-06-18`
- **Server card:** https://utopia-megastore.pages.dev/.well-known/mcp/server-card.json
- **Agent reference:** https://utopia-megastore.pages.dev/llms.txt
- **OpenAPI 3.1:** https://utopia-megastore.pages.dev/openapi.json

## Tools

| Tool | Read-only | What it does |
|---|---|---|
| `list_products` | yes | 15 products + 4 bundles with prices, categories, supplier variant ids |
| `search_products` | yes | Fuzzy catalog search, ranked, with matching bundles |
| `suggest_bundle` | yes | Build a set that fits a budget. Cross-subsidised: big-ticket items drop ~18%, cheap items carry +8%, and per-line `allocation` is returned so multi-party splits stay fair |
| `negotiate_price` | yes | Propose a target total; returns the lowest acceptable price (floor = supplier cost + 12%) |
| `validate_split` | yes | Check that a multi-agent payment allocation sums exactly to the order total |
| `create_checkout` | **no** | Creates the order and returns a PayPal payment URL. **Nothing is charged** — the URL must be approved by whoever holds the funds |

## Client config

```json
{
  "mcpServers": {
    "utopia-megastore": {
      "type": "streamable-http",
      "url": "https://utopia-orders.precogsecurity.workers.dev/mcp"
    }
  }
}
```

## Flow

```
list_products / search_products   ->  find items
suggest_bundle(budget)            ->  fit the budget, get per-line allocation
negotiate_price(budget)           ->  push the total down to the margin floor
validate_split                    ->  only if several agents share the bill
create_checkout                   ->  returns pay_url; human or agent approves payment
```

Payment capture auto-forwards the order to CJ Dropshipping (`logisticName: USPS`).

## Verify it yourself

Every claim above is checkable in one command. No install, no API key, Node 18+.

```bash
curl -sO https://raw.githubusercontent.com/tim777z/utopia-mcp/main/conformance/mcp-conformance.mjs
node mcp-conformance.mjs --url https://utopia-orders.precogsecurity.workers.dev/mcp
```

Real output against the live endpoint, 2026-11-10:

```text
MCP conformance: https://utopia-orders.precogsecurity.workers.dev/mcp

  [PASS] endpoint reachable â€” HTTP 200
  [PASS] initialize returns HTTP 200 â€” got 200
  [PASS] response is JSON (or SSE carrying JSON) â€” application/json
  [PASS] jsonrpc field is "2.0" â€” 2.0
  [PASS] initialize has no error object â€” ok
  [PASS] initialize returns protocolVersion â€” 2024-11-05
  [PASS] initialize returns serverInfo.name â€” utopia-megastore
  [PASS] initialize advertises tools capability â€” {"tools":{"listChanged":false}}
  [PASS] tools/list returns HTTP 200 â€” got 200
  [PASS] tools/list has no error object â€” ok
  [PASS] tools/list returns an array â€” 6 tools
  [PASS] every tool has name, description and object inputSchema â€” 6/6 valid
  [PASS] every required field is declared in properties â€” ok
  [PASS] no tool is both readOnly and destructive â€” ok
  [PASS] tool names unique and MCP-conventional â€” 6 unique
  [PASS] unknown tool returns a JSON-RPC error (no crash) â€” HTTP 200, error surfaced

16/16 checks passed
tools: list_products, search_products, suggest_bundle, negotiate_price, validate_split, create_checkout
```

The checker requests `2024-11-05`, which is why that version appears above. This server negotiates:
it echoes any known protocol version the client asks for and falls back to `2025-06-18` otherwise
(verified 2026-11-10 â€” requesting `2025-06-18` returns `2025-06-18`; requesting `2099-01-01` returns
`2025-06-18`).
The checker is not a rubber stamp. `conformance/selftest-conformance.mjs` starts a mock server with
four planted defects (missing inputSchema, a required field absent from `properties`, contradictory
`readOnly`/`destructive` annotations, a duplicate tool name, and a silent success for an unknown
tool) and asserts every one is caught, then runs the same checker against this live endpoint. If the
checker ever stopped detecting defects, that self-test fails.
## Notes on scope

- This server never charges a card and never stores payment credentials. It returns a PayPal link.
- `create_checkout` is the only mutating tool; it is annotated `readOnlyHint: false`, `destructiveHint: false`.
- Product availability and pricing come from the live catalog, not from this repository.

## Implementation

The server is a single Cloudflare Worker module (`src/mcp.js` in the private store repo) exposing a
stateless Streamable HTTP transport. This repository is the public descriptor: `server.json` for the
official MCP registry, plus documentation for directory listings.

## Licence

Proprietary. The MCP endpoint is free to call.
