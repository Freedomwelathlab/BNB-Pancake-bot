# BNB Snipping bot

A 24/7 BNB Chain trading bot whose single goal is to grow a hot wallet's **net BNB balance**, and which **refuses to trade live without evidence of an edge**.

> **No profit is promised.** High returns and low risk conflict. Most automated memecoin strategies lose money after fees, taxes, slippage and rugs. Run this in paper mode and believe the reports, including when they say "don't trade". This is software, not financial advice.

## What it does

- **Watches** BNB Chain over WebSocket with HTTP RPC failover. It records every Four.meme launch and graduation to PancakeSwap as research data with no survivorship bias.
- **Trades** (paper by default) established PancakeSwap WBNB pools with two rule-based strategies, pullback-in-uptrend and breakout. Both are tested walk-forward on 5-minute data.
- **Screens** every token through two independent sources (GoPlus contract analysis and the Honeypot.is buy/sell simulation) plus market-quality checks. If either source is unavailable, the token is rejected.
- **Trades only when** the expected edge beats gas, fees, taxes, slippage and failure risk by a margin, within hard caps on size, positions, capital at risk and daily loss.
- **Exits** with a hard stop, trailing stop, staged take-profit, time exit and illiquidity exit. Exits keep running when the bot is paused or killed.
- **Blocks live trading** unless three switches are set **and** a fresh out-of-sample report **and** ≥ 30 profitable paper trades pass the evidence gate.
- **Cannot withdraw:** a transaction guard only allows swaps whose proceeds go back to the bot's own wallet.

What it deliberately does **not** do: race first blocks, buy on bonding curves, use private-mempool tricks, wash trade, or call an AI model in the execution path.

## Quick start (paper mode)

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm test
```

```bash
npm run fetch-history -- 90 14
```

```bash
npm run backtest
```

```bash
npm start
```

Dashboard: http://127.0.0.1:8787 · Status: `npm run status` · Kill switch: `npm run kill -- on`

## Run on a Windows laptop or PC (no Docker)

```
npm ci
npm run wallet -- new                       # dedicated bot wallet; key goes to secrets/, never printed
npm run telegram-setup                      # optional: paste the @BotFather token at a hidden prompt
deploy\windows\install-autostart.cmd        # start now, and at every logon (no admin needed)
```

`deploy\windows\stop-bot.cmd` stops it, `start-bot.cmd` starts it again, and `uninstall-autostart.cmd` removes the autostart. Logs go to `data\bot.log`. The bot pauses while the laptop sleeps.

## Documents

| | |
|---|---|
| [docs/STRATEGY.md](docs/STRATEGY.md) | Research, strategy comparison and the recommendation |
| [reports/backtest-report.md](reports/backtest-report.md) | Latest walk-forward results (net BNB PnL, drawdown, expectancy, PF, risk of ruin) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components and design rules |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model and controls |
| [docs/SETUP.md](docs/SETUP.md) | Beginner setup, local to Singapore VPS |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Daily checks, alerts, emergencies, restore |
| [docs/COSTS.md](docs/COSTS.md) | Oracle Free vs Singapore VPS, RPC and on-chain costs |
| [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) | Must-pass list before any live trade |
| [docs/CHAIN_COMPARISON.md](docs/CHAIN_COMPARISON.md) | Low-cost chains vs BNB Chain, measured costs, and the Solana plan |
| [reports/backtest-report-lowcost.md](reports/backtest-report-lowcost.md) | What-if backtest with near-zero costs (still no edge) |

## Stack

TypeScript on Node 22+, viem, SQLite (`node:sqlite`), zod, Docker Compose. Tests use `node:test`.
