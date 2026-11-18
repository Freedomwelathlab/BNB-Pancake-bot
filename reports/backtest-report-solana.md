# Backtest evaluation

Generated 2026-11-18T04:26:35.088Z

## Data and assumptions

- Chain: solana. Universe: 11 SOL-quoted Solana pools (JTO, ORCA, Bonk, PYTH, RAY, WBTC, JUP, cbBTC, $WIF, CLAUDIA, WETH), chosen by CURRENT volume and liquidity -> survivorship bias (pools that died are absent; results are optimistic).
- Data: GeckoTerminal 5-minute OHLCV priced in SOL. Fills at next bar open + 5bps latency; stop fills assume worst intrabar order.
- Costs: per-pool swap fee both legs, constant-product price impact (V2-equivalent depth from current TVL, conservative for V3), gas 0.00002 SOL/swap, 5% failed-tx gas, zero-tax tokens only.
- Parameters chosen on the first 60% of the window (in-sample) and judged only on the rest (out-of-sample). 96 parameter sets tested across 4 variants (2 strategies x 5m/1h); the in-sample winner is biased upward by multiple testing. The variant sent to the evidence gate is chosen by IN-SAMPLE expectancy only.
- Trade size 0.15 SOL on 1.5 SOL capital.

## Results (net of all modeled costs, in SOL)

| Strategy | Sample | Trades | Win rate | Net PnL SOL | Expectancy/trade | Profit factor | t-stat | Max DD % cap | Risk of ruin |
|---|---|---|---|---|---|---|---|---|---|
| pullback 5m | in-sample | 50 | 26.0% | -0.05883 | -0.784% | 0.22 | -4.38 | 3.9% | 0.0% |
| pullback 5m | **out-of-sample** | 70 | 32.9% | -0.05973 | -0.569% | 0.39 | -3.19 | 5.0% | 0.0% |
| breakout 5m | in-sample | 293 | 36.9% | -0.26942 | -0.613% | 0.63 | -3.28 | 19.2% | 0.0% |
| breakout 5m | **out-of-sample** | 506 | 42.3% | -0.47412 | -0.625% | 0.65 | -4.26 | 31.8% | 0.0% |
| pullback 1h | in-sample | 17 | 64.7% | 0.02614 | 1.025% | 1.63 | 0.70 | 2.0% | 0.0% |
| pullback 1h | **out-of-sample** | 43 | 46.5% | -0.04418 | -0.685% | 0.68 | -1.15 | 3.4% | 0.0% |
| breakout 1h | in-sample | 26 | 46.2% | 0.01737 | 0.446% | 1.16 | 0.30 | 3.0% | 0.0% |
| breakout 1h | **out-of-sample** | 56 | 51.8% | 0.03038 | 0.362% | 1.12 | 0.39 | 4.7% | 0.0% |

Modeled round-trip cost at 0.15 SOL: 0.608% average across the universe.

### pullback 5m

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"rsiMax":30,"dipLookback":8,"minAtrPct":0.002,"maxAtrPct":0.03}`

Chosen exits: `{"hardStopPct":2,"trailActivatePct":1.7999999999999998,"trailPct":1.2,"takeProfitPct":3,"takeProfitFraction":0.5,"maxHoldMinutes":240,"illiquidityDropPct":40}`

OOS exit reasons: `{"time_exit":47,"trailing_stop":10,"hard_stop":13}`

| Token | OOS trades | OOS net SOL |
|---|---|---|
| JTO | 5 | -0.00835 |
| ORCA | 5 | -0.01419 |
| Bonk | 11 | -0.01134 |
| PYTH | 7 | 0.01378 |
| RAY | 3 | -0.00251 |
| WBTC | 6 | -0.00683 |
| JUP | 25 | -0.02056 |
| cbBTC | 3 | -0.00589 |
| $WIF | 2 | -0.00460 |
| WETH | 3 | 0.00077 |

### breakout 5m

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"lookback":24,"minAtrPct":0.002,"maxAtrPct":0.03}`

Chosen exits: `{"hardStopPct":3.5,"trailActivatePct":3.5999999999999996,"trailPct":2.1,"takeProfitPct":6,"takeProfitFraction":0.5,"maxHoldMinutes":1440,"illiquidityDropPct":40}`

OOS exit reasons: `{"trailing_stop":171,"hard_stop":170,"time_exit":165}`

| Token | OOS trades | OOS net SOL |
|---|---|---|
| JTO | 55 | -0.11315 |
| ORCA | 43 | 0.01213 |
| Bonk | 45 | -0.02389 |
| PYTH | 66 | -0.05224 |
| RAY | 69 | -0.04579 |
| WBTC | 36 | -0.06848 |
| JUP | 53 | -0.05815 |
| cbBTC | 31 | -0.01623 |
| $WIF | 51 | -0.08220 |
| CLAUDIA | 40 | 0.00567 |
| WETH | 17 | -0.03179 |

### pullback 1h

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"rsiMax":38,"dipLookback":8,"minAtrPct":0.005,"maxAtrPct":0.08}`

Chosen exits: `{"hardStopPct":4,"trailActivatePct":3.5999999999999996,"trailPct":2.4,"takeProfitPct":6,"takeProfitFraction":0.5,"maxHoldMinutes":10080,"illiquidityDropPct":40}`

OOS exit reasons: `{"hard_stop":18,"trailing_stop":21,"time_exit":3,"end_of_data":1}`

| Token | OOS trades | OOS net SOL |
|---|---|---|
| JTO | 3 | -0.00139 |
| ORCA | 3 | -0.01121 |
| Bonk | 4 | -0.00541 |
| PYTH | 5 | -0.01161 |
| RAY | 7 | -0.00582 |
| WBTC | 1 | -0.00127 |
| JUP | 7 | -0.02494 |
| cbBTC | 5 | 0.01474 |
| $WIF | 4 | 0.00433 |
| WETH | 4 | -0.00160 |

### breakout 1h

Chosen parameters: `{"fast":20,"slow":50,"trend":200,"lookback":72,"minAtrPct":0.005,"maxAtrPct":0.08}`

Chosen exits: `{"hardStopPct":7,"trailActivatePct":7.199999999999999,"trailPct":4.2,"takeProfitPct":12,"takeProfitFraction":0.5,"maxHoldMinutes":10080,"illiquidityDropPct":40}`

OOS exit reasons: `{"hard_stop":17,"trailing_stop":23,"time_exit":13,"end_of_data":3}`

| Token | OOS trades | OOS net SOL |
|---|---|---|
| JTO | 5 | -0.03675 |
| ORCA | 6 | 0.02825 |
| Bonk | 6 | -0.01171 |
| PYTH | 7 | 0.02981 |
| RAY | 10 | 0.01144 |
| WBTC | 2 | -0.00706 |
| JUP | 9 | 0.01905 |
| cbBTC | 4 | 0.01091 |
| $WIF | 4 | -0.01636 |
| WETH | 3 | 0.00280 |


**Variant sent to the evidence gate:** pullback 1h (highest in-sample expectancy). The gate decides pass/fail from its out-of-sample row.
