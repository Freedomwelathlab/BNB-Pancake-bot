# Backtest evaluation

Generated 2026-11-18T04:26:58.535Z

## Data and assumptions

- WHAT-IF COST PROFILE (lowcost): 0.01% fee per leg, 0.000002 BNB gas, 2 bps latency, pools 100x deeper. Not used by the evidence gate.
- Chain: solana. Universe: 11 SOL-quoted Solana pools (JTO, ORCA, Bonk, PYTH, RAY, WBTC, JUP, cbBTC, $WIF, CLAUDIA, WETH), chosen by CURRENT volume and liquidity -> survivorship bias (pools that died are absent; results are optimistic).
- Data: GeckoTerminal 5-minute OHLCV priced in SOL. Fills at next bar open + 2bps latency; stop fills assume worst intrabar order.
- Costs: per-pool swap fee both legs, constant-product price impact (V2-equivalent depth from current TVL, conservative for V3), gas 0.00002 SOL/swap, 3% failed-tx gas, zero-tax tokens only.
- Parameters chosen on the first 60% of the window (in-sample) and judged only on the rest (out-of-sample). 96 parameter sets tested across 4 variants (2 strategies x 5m/1h); the in-sample winner is biased upward by multiple testing. The variant sent to the evidence gate is chosen by IN-SAMPLE expectancy only.
- Trade size 0.15 SOL on 1.5 SOL capital.

## Results (net of all modeled costs, in SOL)

| Strategy | Sample | Trades | Win rate | Net PnL SOL | Expectancy/trade | Profit factor | t-stat | Max DD % cap | Risk of ruin |
|---|---|---|---|---|---|---|---|---|---|
| pullback 5m | in-sample | 50 | 38.0% | -0.01456 | -0.194% | 0.68 | -1.07 | 1.0% | 0.0% |
| pullback 5m | **out-of-sample** | 70 | 51.4% | 0.00572 | 0.054% | 1.10 | 0.30 | 2.0% | 0.0% |
| breakout 5m | in-sample | 294 | 44.2% | -0.01229 | -0.028% | 0.98 | -0.15 | 8.4% | 0.0% |
| breakout 5m | **out-of-sample** | 507 | 47.3% | -0.01558 | -0.020% | 0.99 | -0.14 | 6.3% | 0.0% |
| pullback 1h | in-sample | 17 | 64.7% | 0.04093 | 1.605% | 2.12 | 1.09 | 1.6% | 0.0% |
| pullback 1h | **out-of-sample** | 43 | 46.5% | -0.00598 | -0.093% | 0.95 | -0.15 | 2.6% | 0.0% |
| breakout 1h | in-sample | 26 | 50.0% | 0.04024 | 1.032% | 1.41 | 0.69 | 2.6% | 0.0% |
| breakout 1h | **out-of-sample** | 56 | 51.8% | 0.08107 | 0.965% | 1.36 | 1.04 | 3.9% | 0.0% |

Modeled round-trip cost at 0.15 SOL: 0.048% average across the universe.

### pullback 5m

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"rsiMax":30,"dipLookback":8,"minAtrPct":0.002,"maxAtrPct":0.03}`

Chosen exits: `{"hardStopPct":2,"trailActivatePct":1.7999999999999998,"trailPct":1.2,"takeProfitPct":3,"takeProfitFraction":0.5,"maxHoldMinutes":240,"illiquidityDropPct":40}`

OOS exit reasons: `{"time_exit":47,"trailing_stop":10,"hard_stop":13}`

| Token | OOS trades | OOS net SOL |
|---|---|---|
| JTO | 5 | -0.00344 |
| ORCA | 5 | -0.00954 |
| Bonk | 11 | -0.00067 |
| PYTH | 7 | 0.01963 |
| RAY | 3 | -0.00008 |
| WBTC | 6 | -0.00109 |
| JUP | 25 | 0.00330 |
| cbBTC | 3 | -0.00303 |
| $WIF | 2 | -0.00304 |
| WETH | 3 | 0.00368 |

### breakout 5m

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"lookback":24,"minAtrPct":0.002,"maxAtrPct":0.03}`

Chosen exits: `{"hardStopPct":3.5,"trailActivatePct":3.5999999999999996,"trailPct":2.1,"takeProfitPct":6,"takeProfitFraction":0.5,"maxHoldMinutes":1440,"illiquidityDropPct":40}`

OOS exit reasons: `{"trailing_stop":172,"hard_stop":169,"time_exit":165,"end_of_data":1}`

| Token | OOS trades | OOS net SOL |
|---|---|---|
| JTO | 55 | -0.06019 |
| ORCA | 43 | 0.05343 |
| Bonk | 45 | 0.02003 |
| PYTH | 66 | 0.00174 |
| RAY | 69 | 0.01035 |
| WBTC | 36 | -0.03437 |
| JUP | 53 | -0.00418 |
| cbBTC | 31 | 0.01357 |
| $WIF | 52 | -0.04446 |
| CLAUDIA | 40 | 0.04410 |
| WETH | 17 | -0.01560 |

### pullback 1h

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"rsiMax":38,"dipLookback":8,"minAtrPct":0.005,"maxAtrPct":0.08}`

Chosen exits: `{"hardStopPct":4,"trailActivatePct":3.5999999999999996,"trailPct":2.4,"takeProfitPct":6,"takeProfitFraction":0.5,"maxHoldMinutes":10080,"illiquidityDropPct":40}`

OOS exit reasons: `{"hard_stop":18,"trailing_stop":21,"time_exit":3,"end_of_data":1}`

| Token | OOS trades | OOS net SOL |
|---|---|---|
| JTO | 3 | 0.00152 |
| ORCA | 3 | -0.00840 |
| Bonk | 4 | -0.00159 |
| PYTH | 5 | -0.00765 |
| RAY | 7 | -0.00038 |
| WBTC | 1 | -0.00031 |
| JUP | 7 | -0.01855 |
| cbBTC | 5 | 0.01965 |
| $WIF | 4 | 0.00755 |
| WETH | 4 | 0.00219 |

### breakout 1h

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"lookback":72,"minAtrPct":0.005,"maxAtrPct":0.08}`

Chosen exits: `{"hardStopPct":7,"trailActivatePct":7.199999999999999,"trailPct":4.2,"takeProfitPct":12,"takeProfitFraction":0.5,"maxHoldMinutes":10080,"illiquidityDropPct":40}`

OOS exit reasons: `{"hard_stop":17,"trailing_stop":23,"time_exit":13,"end_of_data":3}`

| Token | OOS trades | OOS net SOL |
|---|---|---|
| JTO | 5 | -0.03216 |
| ORCA | 6 | 0.03420 |
| Bonk | 6 | -0.00591 |
| PYTH | 7 | 0.03572 |
| RAY | 10 | 0.01942 |
| WBTC | 2 | -0.00521 |
| JUP | 9 | 0.02763 |
| cbBTC | 4 | 0.01485 |
| $WIF | 4 | -0.01319 |
| WETH | 3 | 0.00572 |


**What-if only:** nothing from this report is sent to the evidence gate.
