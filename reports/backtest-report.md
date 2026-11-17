# Backtest evaluation

Generated 2026-11-17T15:35:58.161Z

## Data and assumptions

- Universe: 5 WBNB pools on PancakeSwap (LINK, BTCB, DOGE, SKYAI, ETH), chosen by CURRENT volume and liquidity -> survivorship bias (pools that died are absent; results are optimistic).
- Data: GeckoTerminal 5-minute OHLCV priced in WBNB. Fills at next bar open + 5bps latency; stop fills assume worst intrabar order.
- Costs: per-pool swap fee both legs, constant-product price impact (V2-equivalent depth from current TVL, conservative for V3), gas 0.00002 BNB/swap, 3% failed-tx gas, zero-tax tokens only.
- Parameters chosen on the first 60% of the window (in-sample) and judged only on the rest (out-of-sample). 96 parameter sets tested across 4 variants (2 strategies x 5m/1h); the in-sample winner is biased upward by multiple testing. The variant sent to the evidence gate is chosen by IN-SAMPLE expectancy only.
- Trade size 0.02 BNB on 0.2 BNB capital.

## Results (net of all modeled costs, in BNB)

| Strategy | Sample | Trades | Win rate | Net PnL BNB | Expectancy/trade | Profit factor | t-stat | Max DD % cap | Risk of ruin |
|---|---|---|---|---|---|---|---|---|---|
| pullback 5m | in-sample | 50 | 42.0% | -0.00018 | -0.018% | 0.99 | -0.04 | 2.6% | 0.0% |
| pullback 5m | **out-of-sample** | 33 | 33.3% | -0.00462 | -0.700% | 0.53 | -1.66 | 2.5% | 0.0% |
| breakout 5m | in-sample | 224 | 40.6% | -0.02880 | -0.643% | 0.62 | -2.94 | 15.4% | 0.0% |
| breakout 5m | **out-of-sample** | 117 | 36.8% | -0.01700 | -0.726% | 0.52 | -2.91 | 9.8% | 0.0% |
| pullback 1h | in-sample | - | - | - | - | - | - | - | - |
| pullback 1h | **out-of-sample** | - | - | - | - | - | - | - | - |
| breakout 1h | in-sample | 18 | 55.6% | 0.00230 | 0.639% | 1.35 | 0.54 | 2.7% | 0.0% |
| breakout 1h | **out-of-sample** | 15 | 26.7% | -0.00291 | -0.969% | 0.70 | -0.57 | 2.0% | 8.9% |

Modeled round-trip cost at 0.02 BNB: 0.548% average across the universe.

### pullback 5m

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"rsiMax":38,"dipLookback":3,"minAtrPct":0.002,"maxAtrPct":0.03}`

Chosen exits: `{"hardStopPct":2,"trailActivatePct":3.5999999999999996,"trailPct":1.2,"takeProfitPct":6,"takeProfitFraction":0.5,"maxHoldMinutes":1440,"illiquidityDropPct":40}`

OOS exit reasons: `{"trailing_stop":10,"hard_stop":15,"time_exit":8}`

| Token | OOS trades | OOS net BNB |
|---|---|---|
| LINK | 7 | -0.00157 |
| BTCB | 1 | -0.00047 |
| DOGE | 6 | -0.00233 |
| SKYAI | 19 | -0.00025 |

### breakout 5m

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"lookback":24,"minAtrPct":0.002,"maxAtrPct":0.03}`

Chosen exits: `{"hardStopPct":3.5,"trailActivatePct":3.5999999999999996,"trailPct":2.1,"takeProfitPct":6,"takeProfitFraction":0.5,"maxHoldMinutes":1440,"illiquidityDropPct":40}`

OOS exit reasons: `{"trailing_stop":30,"hard_stop":21,"time_exit":65,"end_of_data":1}`

| Token | OOS trades | OOS net BNB |
|---|---|---|
| LINK | 25 | -0.00639 |
| BTCB | 4 | 0.00026 |
| DOGE | 28 | -0.00958 |
| SKYAI | 52 | 0.00038 |
| ETH | 8 | -0.00166 |

### pullback 1h

Chosen parameters: `undefined`

Chosen exits: `undefined`

OOS exit reasons: `{}`

| Token | OOS trades | OOS net BNB |
|---|---|---|

### breakout 1h

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"lookback":24,"minAtrPct":0.005,"maxAtrPct":0.08}`

Chosen exits: `{"hardStopPct":4,"trailActivatePct":7.199999999999999,"trailPct":2.4,"takeProfitPct":12,"takeProfitFraction":0.5,"maxHoldMinutes":10080,"illiquidityDropPct":40}`

OOS exit reasons: `{"hard_stop":10,"trailing_stop":4,"end_of_data":1}`

| Token | OOS trades | OOS net BNB |
|---|---|---|
| LINK | 2 | -0.00118 |
| SKYAI | 12 | -0.00086 |
| ETH | 1 | -0.00087 |


**Variant sent to the evidence gate:** breakout 1h (highest in-sample expectancy). The gate decides pass/fail from its out-of-sample row.
