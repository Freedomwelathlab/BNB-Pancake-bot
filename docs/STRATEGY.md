# Strategy research and recommendation

*Research date: 2026-11-17. Data, contracts and fees were checked live on that day. Re-run before relying on any of it.*

## Bottom line

**No strategy tested has an edge after costs. The bot must not trade live.** It is built to keep collecting evidence in paper mode and to unlock live trading on its own only if a future evaluation and real paper results both clear the bar. Today they clearly do not. Every variant lost money out of sample, on two different train/test splits.

## 1. What the chain looks like right now (measured, not assumed)

| Fact | Value | How measured |
|---|---|---|
| Block time | 0.45 s (Fermi hard fork, 2026-01-14) | Press coverage plus BNB Chain BEPs |
| Gas price | 0.05 gwei → a swap costs ~0.00001 BNB | `eth_gasPrice` on mainnet |
| Public RPC limits | bnbchain.org: 10K requests / 5 min, `eth_getLogs` **disabled**; publicnode allows logs in ~5K-block windows | BNB Chain docs, live probes |
| Four.meme launches | **788 in ~5 hours** (~3,800/day) | `TokenCreate` logs on the proxy `0x5c95…762b` (event topic verified against receipts) |
| Four.meme activity per launch | 1,695 buys and 432 sells across those 788 tokens, **~2 buys per token** | `TokenPurchase` / `TokenSale` logs |
| Four.meme quote asset | Most curves are now **USDT-quoted**, not BNB | Transfer logs in purchase receipts |
| Four.meme graduations | **0 found in ~24 h** (`LiquidityAdded` topic; PancakeSwap V2 `PairCreated` + V3 `PoolCreated` with Four.meme-style token addresses) | 5,660 V2 pairs and 116 V3 pools scanned; about 1/3 of log windows errored on the free RPC, so coverage is about 65% |
| DEX Screener latest BSC profiles | 1 BSC token in the latest-profiles/boosts feed | DEX Screener API |
| Safety screen of 32 PancakeSwap WBNB pools older than 30 days with more than $150k liquidity | **Only 5 passed** (BTCB, ETH, LINK, DOGE, SKYAI) | GoPlus + Honeypot.is + market checks |

Common reasons for rejection: Honeypot.is simulation flagged (15 tokens), removable LP, top-10 holders above 60%, mint function, transfer pause, hidden owner, suspected wash trading.

## 2. Strategy comparison

| Approach | Edge thesis | What kills it | Evidence | Verdict |
|---|---|---|---|---|
| **A. Four.meme bonding-curve / first-block sniping** | Get in before the crowd | You race MEV bots with private builders (48 Club, BlockRazor) at 0.45 s blocks from a VPS. Most launches get about 2 buys and die. 1% curve fee each side. Creator dumps. The prompt itself says to prefer confirmed entries | Market measured above; academic work finds BSC "1-day rug pulls" and wash trading are common (Cernera et al.; Mongardini & Mei 2025) | **Rejected.** Not implemented. The recorder logs launches for research only |
| **B. Post-graduation PancakeSwap entries** | Tokens that fill the curve show real demand; enter after confirmation | **Sample size**: about 0 graduations per day now, so it cannot be tested or traded at any useful rate. Historically, post-migration dumps are common | 0 graduations in the 24 h scan | **Research only.** Strategy code exists (`postgrad`). The recorder builds a survivorship-free dataset. Re-evaluate once ≥ 200 graduations are recorded |
| **C. Momentum / pullback in established pools** | Trend continuation in liquid pools; low rug risk; backtestable | Fees + gas + slippage (~0.55% round trip at 0.02 BNB) vs. a small per-trade edge | Walk-forward backtest below | **Best risk-adjusted of the three, but it still fails.** It is the default paper strategy |

**Selected method: C** (established-pool pullback and breakout), because it is the only one with enough data to test honestly and enough liquidity to exit. Its results are still negative.

## 3. Backtest: established pools (walk-forward)

Full report: `reports/backtest-report.md` (regenerate with `npm run backtest`).

- **Universe:** 5 PancakeSwap WBNB pools that passed the safety screen (BTCB, ETH, LINK, DOGE, SKYAI). 90 days of 5-minute bars (2026-07-20 → 2026-11-17, 25,975 bars each), plus 1-hour bars aggregated from the same data.
- **Costs:** per-pool fee both legs (0.05% / 0.25%), constant-product price impact, gas 0.00002 BNB/swap, 3% failed-tx gas, 5 bps latency each leg, worst-case intrabar stop ordering, fill at the next bar's open. Trade size 0.02 BNB on 0.2 BNB capital.
- **Method:** 96 parameter sets across 4 variants. Parameters were picked on the first 60% (in-sample) and judged on the last 40% (out-of-sample). The variant sent to the gate is chosen by **in-sample** results only.

### Out-of-sample results (net BNB, after all modelled costs)

| Variant | Trades | Win rate | Net PnL (BNB) | Expectancy / trade | Profit factor | t-stat | Max DD (% of capital) | Risk of ruin* |
|---|---|---|---|---|---|---|---|---|
| Pullback 5m | 33 | 33.3% | −0.00462 | −0.70% | 0.53 | −1.66 | 2.5% | 0.0% |
| Breakout 5m | 117 | 36.8% | −0.01700 | −0.73% | 0.52 | −2.91 | 9.8% | 0.0% |
| Pullback 1h | too few signals | – | – | – | – | – | – | – |
| Breakout 1h (sent to gate) | 15 | 26.7% | −0.00291 | −0.97% | 0.70 | −0.57 | 2.0% | 8.9% |

Robustness (50/50 split): pullback 5m −0.69%/trade (PF 0.38), breakout 5m −0.61% (PF 0.58), breakout 1h −0.60% (PF 0.68). The sign is the same in every case.

\*Risk of ruin = share of 4,000 bootstrap paths of 500 trades at 10% of equity per trade that lose 50% of equity. Small per-trade losses at small size erode slowly, so 0% here does **not** mean safe. The negative expectancy does all the damage.

**Reading it:** the in-sample "winners" (for example breakout 1h, +0.64%/trade, PF 1.35 on 18 trades) collapse out of sample. That is the classic sign of fitting noise. Adding the ~0.55% modelled round-trip cost back still leaves the 5-minute variants at about −0.15% gross per trade. There is no gross edge to protect; fees only make it worse.

### Known biases (all make these results look *better* than reality)

1. **Survivorship:** the universe was chosen by today's volume and safety. Pools that died during the window are missing.
2. **Multiple testing:** the best of 96 settings was chosen in-sample.
3. **Liquidity:** depth is estimated from current TVL with constant k.
4. **Conservative false negatives:** the safety screen rejected CAKE, ADA and DOT on missing DEX Screener fields (fail-closed), which shrinks the universe.

## 4. Evidence gate result

`npm run status` → **NOT PASSED**: oos_trades 15 < 50, OOS net PnL not positive, expectancy not positive, PF 0.70 < 1.3, t-stat −0.57 < 2, risk of ruin 8.9%, 0 paper trades. Live trading is refused in code.

## 5. Recommendation

1. **Do not fund a live wallet.** Run paper mode on a free or $10 server only if you want the forward data. It costs gas-free paper "trades" and records Four.meme launches and graduations.
2. Re-run `fetch-history` + `backtest` monthly. The gate re-evaluates automatically. Expect it to keep failing unless market conditions change.
3. If you want to keep researching, the most promising directions are (a) **post-graduation**, once ≥ 200 recorded graduations exist (the recorder is already collecting them), and (b) **larger size on V3 0.01–0.05% pools**, where gas is a smaller share. Both need new evidence, not hope.
4. The honest alternative: holding BNB is the benchmark this bot measures itself against, and today it does not beat it.

## Sources

- [BNB Chain JSON-RPC endpoints (rate limits, eth_getLogs disabled)](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/)
- [Fermi hard fork, 0.45 s blocks (Cointelegraph)](https://cointelegraph.com/news/bnb-chain-fermi-upgrade-faster-block-times-finality)
- [PancakeSwap v2 addresses](https://developer.pancakeswap.finance/contracts/v2/addresses) · [v3 addresses](https://developer.pancakeswap.finance/contracts/v3/addresses)
- [Four.meme proxy and events (Bitquery docs)](https://docs.bitquery.io/docs/blockchain/BSC/four-meme-api/) · [four-flap-meme-sdk (addresses, Helper3 ABI)](https://cdn.jsdelivr.net/npm/four-flap-meme-sdk@2.2.2/README.en.md)
- [DEX Screener API reference (rate limits)](https://docs.dexscreener.com/api/reference)
- [Honeypot.is API](https://docs.honeypot.is/ishoneypot) · [GoPlus token security API](https://docs.gopluslabs.io/reference/api-overview)
- [Oracle Always Free resources (A1 limits, idle reclamation)](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Mongardini & Mei, meme coin manipulation across chains (arXiv 2507.01963)](https://arxiv.org/abs/2507.01963v2) · [Early rug-pull warning for BSC meme tokens (arXiv 2603.13830)](https://arxiv.org/abs/2603.13830)
- Singapore VPS price ranges: [valebyte Singapore listings](https://valebyte.com/en/vps/singapore/?provider=linode), [techplained cheapest VPS 2026](https://www.techplained.com/cheapest-vps-providers)
