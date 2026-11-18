# Backtest evaluation

Generated 2026-11-18T01:50:59.898Z

## Data and assumptions

- WHAT-IF COST PROFILE (lowcost): 0.01% fee per leg, 0.000002 BNB gas, 2 bps latency, pools 100x deeper. Not used by the evidence gate.
- Universe: 5 WBNB pools on PancakeSwap (LINK, BTCB, DOGE, SKYAI, ETH), chosen by CURRENT volume and liquidity -> survivorship bias (pools that died are absent; results are optimistic).
- Data: GeckoTerminal 5-minute OHLCV priced in WBNB. Fills at next bar open + 2bps latency; stop fills assume worst intrabar order.
- Costs: per-pool swap fee both legs, constant-product price impact (V2-equivalent depth from current TVL, conservative for V3), gas 0.000002 BNB/swap, 3% failed-tx gas, zero-tax tokens only.
- Parameters chosen on the first 60% of the window (in-sample) and judged only on the rest (out-of-sample). 96 parameter sets tested across 4 variants (2 strategies x 5m/1h); the in-sample winner is biased upward by multiple testing. The variant sent to the evidence gate is chosen by IN-SAMPLE expectancy only.
- Trade size 0.02 BNB on 0.2 BNB capital.

## Results (net of all modeled costs, in BNB)

| Strategy | Sample | Trades | Win rate | Net PnL BNB | Expectancy/trade | Profit factor | t-stat | Max DD % cap | Risk of ruin |
|---|---|---|---|---|---|---|---|---|---|
| pullback 5m | in-sample | 50 | 46.0% | 0.00689 | 0.689% | 1.78 | 1.61 | 1.3% | 0.0% |
| pullback 5m | **out-of-sample** | 33 | 36.4% | 0.00004 | 0.007% | 1.01 | 0.02 | 0.9% | 0.0% |
| breakout 5m | in-sample | 223 | 46.6% | 0.00240 | 0.054% | 1.04 | 0.24 | 6.5% | 0.0% |
| breakout 5m | **out-of-sample** | 117 | 39.3% | -0.00092 | -0.039% | 0.96 | -0.16 | 4.7% | 0.0% |
| pullback 1h | in-sample | - | - | - | - | - | - | - | - |
| pullback 1h | **out-of-sample** | - | - | - | - | - | - | - | - |
| breakout 1h | in-sample | 18 | 61.1% | 0.00452 | 1.255% | 1.79 | 1.05 | 2.4% | 0.0% |
| breakout 1h | **out-of-sample** | 15 | 26.7% | -0.00085 | -0.284% | 0.90 | -0.17 | 1.7% | 0.0% |

Modeled round-trip cost at 0.02 BNB: 0.041% average across the universe.

### pullback 5m

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"rsiMax":38,"dipLookback":3,"minAtrPct":0.002,"maxAtrPct":0.03}`

Chosen exits: `{"hardStopPct":2,"trailActivatePct":3.5999999999999996,"trailPct":1.2,"takeProfitPct":6,"takeProfitFraction":0.5,"maxHoldMinutes":1440,"illiquidityDropPct":40}`

OOS exit reasons: `{"trailing_stop":10,"hard_stop":15,"time_exit":8}`

| Token | OOS trades | OOS net BNB |
|---|---|---|
| LINK | 7 | -0.00057 |
| BTCB | 1 | -0.00041 |
| DOGE | 6 | -0.00148 |
| SKYAI | 19 | 0.00250 |

### breakout 5m

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"lookback":24,"minAtrPct":0.002,"maxAtrPct":0.03}`

Chosen exits: `{"hardStopPct":3.5,"trailActivatePct":3.5999999999999996,"trailPct":2.1,"takeProfitPct":6,"takeProfitFraction":0.5,"maxHoldMinutes":1440,"illiquidityDropPct":40}`

OOS exit reasons: `{"trailing_stop":30,"hard_stop":21,"time_exit":65,"end_of_data":1}`

| Token | OOS trades | OOS net BNB |
|---|---|---|
| LINK | 25 | -0.00277 |
| BTCB | 4 | 0.00052 |
| DOGE | 28 | -0.00554 |
| SKYAI | 52 | 0.00801 |
| ETH | 8 | -0.00114 |

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
| LINK | 2 | -0.00090 |
| SKYAI | 12 | 0.00086 |
| ETH | 1 | -0.00081 |


**What-if only:** nothing from this report is sent to the evidence gate.
