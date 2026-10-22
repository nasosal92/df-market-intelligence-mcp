# DF Market Intelligence — MCP server

Give Claude, Cursor or any MCP client live **market intelligence**, paid per call in **USDC on Base** via [x402](https://x402.org). No API key, no signup, no subscription: just a wallet with a few dollars of USDC.

| Tool | What you get | Price |
|---|---|---|
| `insider_latest` | Latest SEC Form 4 insider trades, parsed (filter buys/sales, min $ value) | $0.01 |
| `insider_ticker` | All insider buys/sells for a stock + net buying/selling signal | $0.02 |
| `insider_clusters` | Stocks where several insiders bought in the same window | $0.05 |
| `predictions_top` | Highest-volume Polymarket + Kalshi markets with implied odds | $0.005 |
| `predictions_search` | Market-implied probability of any event, by keyword | $0.01 |
| `predictions_movers` | Biggest 24h probability moves | $0.01 |
| `macro_latest` | 24 US indicators: CPI, PCE, payrolls, yields, curve, M2… | $0.01 |
| `macro_series` | History for one FRED series | $0.005 |
| `macro_calendar` | Upcoming US economic releases | $0.005 |
| `x402_overview` | State of the x402 agent economy | $0.01 |
| `x402_services` | Ranked x402 services by calls, payers or revenue | $0.01 |
| `x402_search` | Find the right paid API for a task, ranked by real usage | $0.005 |
| `x402_trending` | Fastest-growing / declining x402 services | $0.02 |
| `x402_pricing` | What paid agent APIs cost, per category | $0.01 |
| `df_catalog`, `df_status`, `df_wallet` | Tool list, data freshness, your spend this session | free |

Data refreshes every 10–15 minutes. Sources: SEC EDGAR, FRED, Polymarket, Kalshi, the public x402 Bazaar catalogue. Informational only, not investment advice.

## Install

You need a **dedicated wallet with a little USDC on Base** (e.g. $2–5). No ETH is needed — x402 payments are gasless for the payer.

### Claude Desktop

Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "df-market-intelligence": {
      "command": "npx",
      "args": ["-y", "df-market-intelligence-mcp"],
      "env": {
        "DF_WALLET_PRIVATE_KEY": "0xYOUR_DEDICATED_WALLET_KEY",
        "DF_SESSION_BUDGET": "1.00"
      }
    }
  }
}
```

### Cursor / other clients

Same command: `npx -y df-market-intelligence-mcp`, with the environment variables below.

## Configuration

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `DF_WALLET_PRIVATE_KEY` | one of these two | – | Private key of the paying wallet (USDC on Base) |
| `DF_WALLET_MNEMONIC` | one of these two | – | Or its 12/24-word recovery phrase (first account) |
| `DF_SESSION_BUDGET` | no | `1.00` | Max USD this server may spend per session |
| `DF_MAX_PRICE_PER_CALL` | no | `0.10` | Refuse any single call priced above this |
| `DF_API_URL` | no | `https://df-data-agent.vercel.app` | API base URL |

Without a wallet, the free tools still work and paid tools explain how to set one up.

## Safety

- Use a **separate wallet** holding only a few dollars. The key never leaves your machine; it only signs individual USDC payments.
- Every call is checked against your per-call cap and session budget **before** signing.
- Invalid requests are rejected before payment, and failed requests are never settled — you are not charged.

## For agents and developers

The same data is available directly over HTTP with any x402 client: see the [catalog](https://df-data-agent.vercel.app/api/v1/catalog), [OpenAPI spec](https://df-data-agent.vercel.app/openapi.json) and [llms.txt](https://df-data-agent.vercel.app/llms.txt).

Built by [DF Capital](https://dfcapital.io).
