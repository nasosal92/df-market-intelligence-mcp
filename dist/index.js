#!/usr/bin/env node
// DF Market Intelligence — MCP server.
// Exposes every paid DF endpoint as an MCP tool and pays for calls automatically via x402
// (USDC on Base) from a wallet the user configures, with per-call and per-session spending caps.
// Logs go to stderr only: stdout is the MCP protocol channel.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SNAPSHOT = require("./catalog.snapshot.json");
const VERSION = "1.0.0";
// ─── Config ──────────────────────────────────────────────────────────────────
const API = (process.env.DF_API_URL ?? "https://df-data-agent.vercel.app").replace(/\/$/, "");
const MAX_PER_CALL = Number(process.env.DF_MAX_PRICE_PER_CALL ?? "0.10");
const BUDGET = Number(process.env.DF_SESSION_BUDGET ?? "1.00");
const log = (...a) => console.error("[df-mcp]", ...a);
function loadAccount() {
    const key = process.env.DF_WALLET_PRIVATE_KEY?.trim();
    const phrase = process.env.DF_WALLET_MNEMONIC?.trim().replace(/\s+/g, " ");
    if (key) {
        const k = key.startsWith("0x") ? key : `0x${key}`;
        if (!/^0x[0-9a-fA-F]{64}$/.test(k))
            throw new Error("DF_WALLET_PRIVATE_KEY must be 64 hex characters");
        return privateKeyToAccount(k);
    }
    if (phrase)
        return mnemonicToAccount(phrase);
    return null;
}
let account = null;
let walletError = null;
try {
    account = loadAccount();
}
catch (e) {
    walletError = e instanceof Error ? e.message : String(e);
}
let spent = 0;
let paidCalls = 0;
const payFetch = account
    ? wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [{ network: "eip155:*", client: new ExactEvmScheme(account) }],
        paymentRequirementsSelector: (_v, reqs) => {
            const capAtomic = BigInt(Math.round(MAX_PER_CALL * 1e6));
            const ok = reqs.find((r) => BigInt(r.amount ?? r.maxAmountRequired ?? 0) <= capAtomic);
            if (!ok)
                throw new Error(`price is above your per-call cap of $${MAX_PER_CALL} (DF_MAX_PRICE_PER_CALL)`);
            const usd = Number(BigInt(ok.amount ?? ok.maxAmountRequired ?? 0)) / 1e6;
            if (spent + usd > BUDGET + 1e-9)
                throw new Error(`session budget of $${BUDGET} reached (DF_SESSION_BUDGET); restart the server or raise the budget`);
            return ok;
        },
    })
    : null;
// ─── Catalog ─────────────────────────────────────────────────────────────────
const toolName = (path) => path.replace(/^\/api\/v1\//, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
const toEndpoint = (e) => ({ ...e, name: toolName(e.path), priceUsd: Number(e.price.replace("$", "")) });
let catalog = null;
async function getCatalog() {
    if (catalog)
        return catalog;
    try {
        const ctrl = AbortSignal.timeout(6000);
        const res = await fetch(`${API}/api/v1/catalog`, { signal: ctrl });
        const json = await res.json();
        const live = (json?.endpoints ?? []).map((e) => ({
            path: new URL(e.url).pathname,
            price: e.price,
            title: e.title,
            description: e.description,
            inputSchema: e.inputSchema,
        }));
        if (live.length) {
            catalog = live.map(toEndpoint);
            return catalog;
        }
    }
    catch (e) {
        log("live catalog unavailable, using built-in list:", e instanceof Error ? e.message : e);
    }
    catalog = SNAPSHOT.map(toEndpoint);
    return catalog;
}
// ─── Tools ───────────────────────────────────────────────────────────────────
const FREE_TOOLS = [
    {
        name: "df_catalog",
        description: "Free. List every DF Market Intelligence data tool with its price per call and what it returns.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "df_status",
        description: "Free. Data freshness: when each dataset (insider trades, prediction markets, macro, x402 economy) was last refreshed.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "df_wallet",
        description: "Free. Show the paying wallet address, spending caps and how much this session has spent.",
        inputSchema: { type: "object", properties: {} },
    },
];
const text = (s, isError = false) => ({ content: [{ type: "text", text: s.length > 60000 ? s.slice(0, 60000) + "\n…(truncated)" : s }], isError });
const SETUP_HELP = `No payment wallet is configured, so paid tools can't run yet.
Add ONE of these to this MCP server's environment and restart your client:
  DF_WALLET_PRIVATE_KEY=0x…            (private key of a wallet holding a little USDC on Base)
  DF_WALLET_MNEMONIC="twelve words …"  (or its recovery phrase)
Use a dedicated wallet with only a few dollars. Optional caps: DF_MAX_PRICE_PER_CALL (default 0.10), DF_SESSION_BUDGET (default 1.00).
Calls cost $0.005–$0.05 in USDC; no ETH is needed for gas.`;
function toQuery(args) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(args ?? {}))
        if (v !== undefined && v !== null && v !== "")
            q.set(k, String(v));
    return q.size ? `?${q}` : "";
}
const server = new Server({ name: "df-market-intelligence", version: VERSION }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
    const eps = await getCatalog();
    return {
        tools: [
            ...FREE_TOOLS,
            ...eps.map((e) => ({
                name: e.name,
                description: `${e.title} — ${e.description} Costs ${e.price} USDC per call (x402 on Base), paid automatically from your configured wallet.`,
                inputSchema: e.inputSchema,
            })),
        ],
    };
});
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
        if (name === "df_catalog") {
            const eps = await getCatalog();
            return text(JSON.stringify(eps.map((e) => ({ tool: e.name, price: e.price, title: e.title, description: e.description })), null, 2));
        }
        if (name === "df_status") {
            const res = await fetch(`${API}/api/status`, { signal: AbortSignal.timeout(10000) });
            return text(JSON.stringify(await res.json(), null, 2));
        }
        if (name === "df_wallet") {
            return text(JSON.stringify({
                wallet: account?.address ?? null,
                configured: !!account,
                error: walletError,
                api: API,
                max_price_per_call_usd: MAX_PER_CALL,
                session_budget_usd: BUDGET,
                spent_this_session_usd: Math.round(spent * 1e6) / 1e6,
                paid_calls_this_session: paidCalls,
            }, null, 2));
        }
        const ep = (await getCatalog()).find((e) => e.name === name);
        if (!ep)
            return text(`Unknown tool "${name}". Call df_catalog to see available tools.`, true);
        if (!payFetch)
            return text(walletError ? `Wallet configuration error: ${walletError}\n\n${SETUP_HELP}` : SETUP_HELP, true);
        for (const r of ep.inputSchema.required ?? []) {
            if (args?.[r] === undefined || args?.[r] === "")
                return text(`Missing required parameter "${r}".`, true);
        }
        const res = await payFetch(`${API}${ep.path}${toQuery(args)}`, { signal: AbortSignal.timeout(45000) });
        const body = await res.text();
        const settled = !!res.headers.get("PAYMENT-RESPONSE");
        if (settled) {
            spent += ep.priceUsd;
            paidCalls++;
        }
        if (!res.ok)
            return text(`Request failed (${res.status}); you were not charged.\n${body.slice(0, 2000)}`, true);
        return text(body);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(name, "failed:", msg);
        return text(`Error: ${msg}`, true);
    }
});
await server.connect(new StdioServerTransport());
log(`v${VERSION} ready — api ${API}, wallet ${account ? account.address : "not configured (free tools only)"}`);
