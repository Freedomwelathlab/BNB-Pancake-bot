# Solana holdout test: breakout 1h, fixed parameters

Generated 2026-11-18T06:08:00.573Z

- Parameters frozen from phase 1 (no search): `{"fast":20,"slow":50,"trend":200,"lookback":72,"minAtrPct":0.005,"maxAtrPct":0.08}`, exits `{"hardStopPct":7,"trailActivatePct":7.2,"trailPct":4.2,"takeProfitPct":12,"takeProfitFraction":0.5,"maxHoldMinutes":10080,"illiquidityDropPct":40}`.
- Universe: WETH, CLAUDIA, WBTC, cbBTC, JUP, PYTH, Bonk, $WIF, RAY, JTO, ORCA (the phase 1 universe; chosen by current liquidity, so survivorship bias remains).
- Size 0.15 SOL on 1.5 SOL. Pool-fee costs: each pool's 0.25-0.30% fee per leg, 0.00002 SOL gas, 5% failed tx. Low-cost: 0.01% fee, pools 100x deeper.

| Window | Costs | Trades | Win rate | Net SOL | Expectancy/trade | PF | t-stat | Max DD | Gate thresholds |
|---|---|---|---|---|---|---|---|---|---|
| **Holdout** 2026-04-07 -> each token's phase 1 start (2026-06-05..2026-10-07); never seen | pool fee | 59 | 40.7% | -0.1278 | -1.444% | 0.60 | -1.73 | 9.1% | FAIL (expectancy not positive, PF 0.60<1.3, t -1.73<2) |
| **Holdout** 2026-04-07 -> each token's phase 1 start (2026-06-05..2026-10-07); never seen | low cost | 58 | 46.6% | -0.0450 | -0.517% | 0.83 | -0.61 | 4.8% | FAIL (expectancy not positive, PF 0.83<1.3, t -0.61<2) |
| Phase 1 window -> 2026-11-18 (parameters were tuned on part of it) | pool fee | 89 | 48.3% | 0.0014 | 0.011% | 1.00 | 0.01 | 4.8% | FAIL (PF 1.00<1.3, t 0.01<2) |
| Phase 1 window -> 2026-11-18 (parameters were tuned on part of it) | low cost | 89 | 48.3% | 0.0811 | 0.607% | 1.21 | 0.81 | 4.1% | FAIL (PF 1.21<1.3, t 0.81<2) |
| Full 2026-04-07 -> 2026-11-18 | pool fee | 147 | 44.9% | -0.1427 | -0.647% | 0.81 | -1.14 | 14.8% | FAIL (expectancy not positive, PF 0.81<1.3, t -1.14<2) |
| Full 2026-04-07 -> 2026-11-18 | low cost | 146 | 47.3% | 0.0184 | 0.084% | 1.03 | 0.15 | 8.8% | FAIL (PF 1.03<1.3, t 0.15<2) |

## Holdout stability (pool-fee costs)

| Period | Trades | Expectancy/trade | PF |
|---|---|---|---|
| 2026-04-07 -> 2026-07-07 | 54 | -1.438% | 0.61 |
| 2026-07-07 -> 2026-10-06 | 5 | -1.462% | 0.34 |
| 2026-10-06 -> 2026-10-07 | 0 | 0.000% | 0.00 |

| Token | Holdout trades | Net SOL |
|---|---|---|
| WETH (holdout 2026-04-24 -> 2026-08-16) | 3 | -0.0119 |
| CLAUDIA (holdout 2026-10-07 -> 2026-10-07) | 0 | 0.0000 |
| WBTC (holdout 2026-04-24 -> 2026-08-19) | 6 | -0.0209 |
| cbBTC (holdout 2026-04-17 -> 2026-06-05) | 3 | -0.0103 |
| JUP (holdout 2026-04-07 -> 2026-07-24) | 10 | 0.0201 |
| PYTH (holdout 2026-04-23 -> 2026-07-10) | 6 | -0.0122 |
| Bonk (holdout 2026-04-24 -> 2026-08-19) | 2 | 0.0070 |
| $WIF (holdout 2026-04-23 -> 2026-07-05) | 5 | -0.0146 |
| RAY (holdout 2026-04-18 -> 2026-06-10) | 3 | -0.0046 |
| JTO (holdout 2026-04-23 -> 2026-07-16) | 17 | -0.0649 |
| ORCA (holdout 2026-05-15 -> 2026-08-01) | 4 | -0.0154 |
