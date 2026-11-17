# Architecture

```
                 ┌──────────────────────────── BNB Chain ────────────────────────────┐
                 │  WebSocket (newHeads, logs)          HTTP RPC (quotes, sends)      │
                 └───────┬──────────────────────────────────────┬────────────────────┘
                         │                                      │
                ┌────────▼────────┐                    ┌────────▼────────┐
                │  chain/rpc.ts   │ failover, health,  │  chain/dex.ts   │ V2 getAmountsOut,
                │                 │ WS URL rotation    │                 │ V3 QuoterV2, impact
                └───┬─────────┬───┘                    └────────┬────────┘
                    │         │                                 │
     ┌──────────────▼──┐   ┌──▼──────────────────┐              │
     │ chain/recorder  │   │ bot.ts (tick loop)  │◄─────────────┘
     │ Four.meme       │   │ 1. exits first      │
     │ launches +      │   │ 2. candles (Gecko)  │──► data/gecko.ts (same 5m bars as backtest)
     │ graduations     │   │ 3. strategy signal  │──► strategy/strategies.ts  (pure)
     │ (research only) │   │ 4. safety verdict   │──► safety/sources.ts + scorer.ts (pure)
     └──────┬──────────┘   │ 5. cost + risk      │──► core/costs.ts, risk/riskEngine.ts (pure)
            │              │ 6. execute          │──► exec/executor.ts ──► exec/txGuard.ts (pure)
            │              │ 7. persist + alert  │
            │              └──┬────────┬─────────┘
            ▼                 ▼        ▼
       ┌─────────────────────────┐  ┌────────────────┐   ┌──────────────────────┐
       │ db/db.ts  SQLite (WAL)  │  │ notify/telegram│   │ dashboard/server.ts  │
       │ positions, trades,      │  └────────────────┘   │ 127.0.0.1:8787       │
       │ orders (idempotent),    │                       │ /health  /api/state  │
       │ decisions, launches,    │◄──────────────────────│ /api/kill /resume    │
       │ graduations, equity, kv │                       └──────────────────────┘
       └─────────────────────────┘
                     ▲
   offline:  scripts/fetchHistory.ts ─► data/history ─► scripts/backtest.ts ─► reports/latest-evaluation.json
                                                                                   │
                                                              gate/evidence.ts ◄───┘  (live refused unless PASS)
```

## Design rules

- **Decision code is pure.** Costs, safety scoring, risk checks, exits, signals, the tx guard and the evidence gate are pure functions with unit tests. I/O lives at the edges.
- **Same data for backtest and live.** Both use GeckoTerminal 5-minute bars priced in WBNB and the same strategy functions. Live fills use on-chain quotes.
- **No look-ahead.** Signals use closed bars only. Fills happen at the next bar's open. Stops assume the worst intrabar order. Tests check that future candles cannot change past signals.
- **Fail closed.** If a safety source is down, the token is rejected. A stale RPC pauses entries. A missing or old evaluation report blocks live trading. A malformed config stops the process.
- **Exits always run.** The bot keeps managing exits even when it is paused or the kill switch is on.
- **Idempotency.** Each order has a deterministic client id (mode:strategy:token:bar). A unique index allows only one open position per token. Restarts reconcile orders that were in flight.
- **No AI in execution.** No LLM calls anywhere in the runtime.

## Module map

| Path | Role |
|---|---|
| `src/core/constants.ts` | Verified contract addresses, ABIs, tx allowlist, blue-chip list |
| `src/core/config.ts` | zod-validated env; three live switches; key read from file |
| `src/core/costs.ts` | V2 math, price impact, round-trip cost hurdle |
| `src/safety/scorer.ts` | Hard rejects and score from GoPlus + Honeypot.is + market data |
| `src/safety/sources.ts` | GoPlus / Honeypot.is / DEX Screener clients (return null on failure) |
| `src/strategy/*` | Causal indicators and the pullback / breakout / postgrad signals |
| `src/risk/riskEngine.ts` | Kill switch, daily loss cap, caps, duplicates, gas cap, edge-vs-cost hurdle |
| `src/risk/exits.ts` | Hard stop, trailing stop, staged take-profit, time exit, illiquidity exit |
| `src/exec/txGuard.ts` | Allowlist that blocks withdrawals and checks recipients and deadlines |
| `src/exec/executor.ts` | Paper executor (real quotes) and live executor (simulate, guard, nonce, send) |
| `src/chain/recorder.ts` | Records every Four.meme launch and graduation (survivorship-free dataset) |
| `src/backtest/*` | Engine, metrics (PnL, drawdown, expectancy, PF, t-stat, risk of ruin), walk-forward |
| `src/gate/evidence.ts` | Live-trading gate thresholds |
| `src/dashboard/*` | Dashboard page and JSON API |
