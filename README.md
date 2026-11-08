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
