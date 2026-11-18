# Low-cost chain comparison and plan

*Measured 2026-11-18 from live public APIs and RPCs. Prices move daily; re-measure before acting. This is a technical comparison for the bot, not financial advice.*

## Bottom line

1. **Solana is the cheapest chain with real trading activity.** A swap costs about $0.0004–$0.001 in network fees. Solana also had the highest DEX volume of any chain that day ($1.6B) and about 138M transactions a day. Round-trip quotes on SOL/USDC and JUP/USDC lost 0.00–0.04% at $12.
2. **Base is the cheapest EVM option and the easiest port.** It runs the same `viem` code, and GoPlus and Honeypot.is both cover it. Gas is about $0.005–0.01 per swap, there was $1.1B of DEX volume and about 15M transactions a day.
3. **A cheaper chain will not make today's strategies profitable.** I re-ran the same 90-day walk-forward backtest with near-zero costs: a 0.01% fee per leg, about $0.001 gas and pools 100× deeper. Modelled round-trip cost fell from 0.548% to 0.041%. The best out-of-sample result was then break-even, not profitable: pullback 5m made +0.007% per trade (profit factor 1.01, t-stat 0.02). Every other variant was still negative. Gas was never the main problem; the strategies have no edge before costs. See `reports/backtest-report-lowcost.md`.

**Recommendation:** keep the bot in paper mode on BNB Chain for now. Don't port it until a strategy shows a gross edge in the low-cost test (`npm run backtest -- 0.6 --cost=lowcost`). When one does, Solana is the target chain. If you'd rather change less code, use Base.

## Comparison with BNB Chain

All figures were measured today. "Round trip" means buying and selling straight back through an aggregator (Jupiter on Solana, KyberSwap on the EVM chains). It covers pool fees, spread and price impact, with gas shown separately.

| Chain | Network fee per swap | Round trip at $12 (price + gas) | Round trip at $500 | DEX volume, 24h | Transactions per day | Block time | Bot port effort | Verdict |
|---|---|---|---|---|---|---|---|---|
| **BNB Chain (current)** | ~$0.004–0.01 (0.05 gwei) | WBNB 0.00% + 0.18% gas; BTCB 0.02% + 0.16% | ~0.01–0.09% | $877M | ~13.9M | 0.44 s | none | Fine on majors; the 0.55% cost in the backtest came from 0.25% V2 pools and thin tokens |
| **Solana** | ~$0.0004 base + priority (median priority 0 today) | SOL 0.00%; JUP 0.035%; gas ~0.01% | ~0.00% (SOL) | **$1,607M (#1)** | **~138M** | 0.4 s | high: new wallet type, Jupiter API, new safety sources | **Best on cost and liquidity.** Main risk: sandwich bots (use tight slippage and Jito DontFront) |
| **Base** | ~$0.005–0.009 (incl. L1 data fee) | WETH 0.00% + 0.16% gas; cbBTC ~0.00% + 0.09% | WETH 0.13%; cbBTC ~0.00% | $1,132M | ~15.1M | 0.2 s | **low: same viem code** | Best EVM choice |
| Arbitrum | ~$0.01–0.05 | WETH 0.03% + 0.21% gas | 0.06% | $147M | ~0.9M | 0.28 s | low | Pricier than Base, less volume |
| Polygon PoS | ~$0.003–0.02 | WETH 0.06% + 0.14% gas | 0.12% | $142M | ~3.8M | 1.5 s | low | Thin liquidity |
| Monad | ~$0.0002 | not measured | not measured | $27M | ~9.0M | 0.3 s | low (EVM) | Cheap but little DEX liquidity |
| opBNB | ~$0.0001 | not measured | not measured | small (outside the top 25) | ~1.1M | 0.26 s | low (EVM) | Near-zero gas, almost no liquidity |
| Avalanche C-Chain | ~$0.008 | not measured | not measured | $52M | ~0.2M | 0.9 s | low | Low activity |
| Sonic / Sei / HyperEVM | ~$0.0003 / small / small | not measured | not measured | outside the top 25 | <0.2M | ~0.5–1 s | low | Too little activity |
| Hyperliquid (order book) | $0 gas; fees 0.045% taker / 0.015% maker on perps, 0.07% / 0.04% on spot | BTC spread 0.16 bps | ~0.09% taker round trip | $346M spot plus perps | n/a | n/a | medium | **Excluded:** Singapore's MAS put it on its Investor Alert List, and some reports say Singapore IPs are geo-blocked |
| Tron, TON, Sui, Aptos | varies | not measured | not measured | $60M / – / $20M / – | – | – | high | Too little DEX liquidity for the bot |

How the numbers were measured:
- **Network fee:** `eth_gasPrice` on each chain × about 150k gas × the token's CoinGecko price. For Solana: 5,000 lamports per signature plus the median priority fee.
- **Transactions per day:** the average transactions per block over recent blocks, scaled by block time. For Solana: `getRecentPerformanceSamples`.
- **DEX volume:** DefiLlama's DEX overview, summed by chain.

What the table shows:
- **Gas only matters for small trades.** At $12 a trade, gas is 0.1–0.2% round trip on every EVM chain, and 0.01% on Solana. At $500 it falls below 0.02% everywhere.
- **Pool choice matters more than chain choice.** On BNB Chain, routing through deep V3 or aggregator pools costs about 0.02% before gas. The bot's 0.25% PancakeSwap V2 pools cost more than ten times that.
- **Quotes are not fills.** A round trip quoted at 0.00% can still lose to latency, quote changes and sandwich bots. The backtest's 2–5 bps latency allowance covers that.

## Plan for the new chain: Solana

Each phase has an exit test. If a phase fails, stop and stay in paper mode on BNB Chain.

| Phase | Work | Exit test | Rough effort |
|---|---|---|---|
| 0. Find an edge (any chain) | New strategy ideas tested with `--cost=lowcost` on the existing data | Out-of-sample profit factor ≥ 1.3 and t-stat ≥ 2 **before** chain-specific costs | ongoing research |
| 1. Solana data | Point `src/data/gecko.ts` at GeckoTerminal's `solana` network, pick 5–10 deep USDC and SOL pools, backtest with Solana costs (0.01–0.05% pool fee, about $0.001 gas) | Same gate thresholds as now | 1–2 days |
| 2. Solana execution | New `SolanaExecutor`: quotes and swaps from the Jupiter Swap API, a priority-fee cap, tight slippage, Jito DontFront, and an allowlist of the Jupiter program plus your own token accounts only (the same "can't withdraw" rule) | Tests pass; simulated transactions only | 3–5 days |
| 3. Solana safety | GoPlus Solana token-security endpoint plus mint and freeze-authority checks; reject tokens whose mint or freeze authority is still active | Screen passes known-good tokens and rejects known rugs | 1–2 days |
| 4. Paper trading | Run in paper mode beside the BNB bot | 30+ paper trades with positive net PnL | 2–4 weeks |
| 5. Tiny live | New Solana hot wallet, funded with an amount you can afford to lose | Gate passes; three live switches on | – |

What carries over unchanged: the risk engine, exits, backtester, metrics, evidence gate, SQLite store, dashboard and Telegram alerts. These need replacing: RPC, executor, transaction guard, safety sources and wallet. A Solana key is a different type from your BNB key, so it needs its own wallet.

Running costs: free public Solana RPCs are heavily rate-limited, so you'll need a free-tier key from an RPC provider. Check its current limits before relying on it. Your laptop or PC is enough to run it.

**The fallback is Base.** The same code runs with new contract addresses (Uniswap or Aerodrome routers, WETH) and a new chain id. That's about 1–2 days of work. A round trip costs about 0.1–0.15% at $12 and is near zero at $500.

## Sources

Live data:
- DefiLlama DEX overview API (`api.llama.fi/overview/dexs`)
- CoinGecko simple price API
- publicnode / chain RPCs (`eth_gasPrice`, blocks)
- Solana mainnet RPC (`getRecentPerformanceSamples`, `getRecentPrioritizationFees`)
- Jupiter quote API (`lite-api.jup.ag`)
- KyberSwap aggregator API
- Hyperliquid info API (order books)

Hyperliquid fees:
- [hyperliquidguide fees](https://hyperliquidguide.pages.dev/guides/fees/fees-explained)
- [datawallet](https://www.datawallet.com/crypto/hyperliquid-fees-explained)
- [dwellir](https://www.dwellir.com/blog/hyperliquid-fees-explained)

Hyperliquid in Singapore:
- [The Defiant](https://thedefiant.io/news/regulation/hyperliquid-confirms-singapore-base-but-says-it-has-no-mas-license)
- [CryptoSlate](https://cryptoslate.com/hyperliquids-mas-alert-exposes-defis-next-regulatory-weak-spot/)
- [crypto.news](https://crypto.news/hyperliquid-confirms-singapore-base-as-mas-says/)

Solana MEV protection:
- [solana.com: MEV protection with Jito DontFront](https://solana.com/docs/defi/mev-protection)
