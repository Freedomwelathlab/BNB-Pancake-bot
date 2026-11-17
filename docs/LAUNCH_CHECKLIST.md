# Launch checklist

Tick every line. If any line fails, stay in paper mode.

## A. Evidence (the bot also enforces these)

- [ ] `reports/backtest-report.md` is less than 14 days old and you have read the **out-of-sample** row, not the in-sample one.
- [ ] Out of sample: ≥ 50 trades, net PnL > 0 after costs, profit factor ≥ 1.3, t-stat ≥ 2, max drawdown ≤ 20% of capital, risk of ruin ≤ 1%.
- [ ] Paper trading: ≥ 30 closed trades over **at least 2–4 weeks**, net PnL > 0 BNB, and results not far below the backtest. If paper results are much worse, the backtest is wrong; do not go live.
- [ ] You understand the known biases: the universe was chosen by today's volume (survivorship), the best in-sample setting was picked from a grid (multiple testing), and liquidity is estimated from current depth.
- [ ] `npm run status` shows `Evidence gate: PASS`.

## B. Wallet and keys

- [ ] A brand-new wallet, used only by the bot. Never your main wallet or seed phrase.
- [ ] Funded with an amount you can lose entirely. Start with `MAX_TRADE_BNB=0.005–0.01`.
- [ ] The key is in `secrets/hot_wallet_key` (one line, `0x` + 64 hex), `chmod 600`, and not in git, `.env`, chat or email.
- [ ] You have checked on BscScan that the addresses in `src/core/constants.ts` are still the official PancakeSwap contracts.

## C. Infrastructure

- [ ] `npm test` passes on the server (`docker compose run --rm bot npm test`).
- [ ] Firewall allows SSH only. The dashboard is reached through an SSH tunnel. `DASHBOARD_TOKEN` is set.
- [ ] Telegram alerts arrive (restart the bot and confirm the "Bot started" message).
- [ ] An RPC provider key is configured, and at least 2 HTTP URLs and 1 WS URL are set.
- [ ] The backup cron is installed and one restore has been tested.
- [ ] You have practised the kill switch in paper mode (dashboard button **and** CLI).

## D. Switching on

1. Set in `.env`: `MODE=live`, `LIVE_TRADING_ENABLED=true`, and `LIVE_CONFIRM=I ACCEPT THAT I CAN LOSE ALL FUNDS IN THIS HOT WALLET`.
2. Keep the limits small: `MAX_TRADE_BNB=0.005`, `MAX_OPEN_POSITIONS=1`, `DAILY_LOSS_CAP_BNB=0.005`.
3. `docker compose up -d`, then watch the logs for `LIVE_MODE` and the wallet address.
4. Watch the first trade end to end on BscScan: approve, buy, sell, and the recipient is your wallet.
5. Run for 2 weeks at tiny size. Compare live fills with paper quotes (slippage, gas). Only then raise limits, and never more than 2× per step.

## E. Stop conditions (write them down before you start)

- Live net PnL below −X BNB (your number): kill switch, back to paper, investigate.
- Live results consistently worse than paper: stop. The edge may be an artefact.
- Any unexplained transaction: kill switch, move funds out, rotate the key.
