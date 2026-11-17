# Runbook

All commands are run from the project folder on the server. In Docker, prefix scripts with `docker compose exec bot node --import tsx`.

## Daily check (2 minutes)

```bash
docker compose ps
```

```bash
docker compose exec bot node --import tsx scripts/status.ts
```

Look at: mode, gate reasons, today's PnL against the daily cap, open positions, and recent decisions.

## Emergency stop

| Situation | Action |
|---|---|
| Anything looks wrong | `docker compose exec bot node --import tsx scripts/killswitch.ts on`, or the **Kill switch** button on the dashboard. New entries stop and open positions are sold on the next tick. |
| Bot process is stuck | `touch data/KILL` (checked every tick), then `docker compose restart bot` |
| Suspected key leak | Kill switch on. **From another device**, move the funds out of the hot wallet. Stop the container (`docker compose down`). Create a new wallet and key file. |
| Need to stop everything immediately | `docker compose down`. Positions stay open on-chain. The bot reconciles them on the next start. |

Resume after review: `scripts/killswitch.ts off`, or the **Resume** button on the dashboard.

## Alerts and what to do

| Alert / symptom | Meaning | Action |
|---|---|---|
| `Paused new entries: rpc_unhealthy` | No new block for 20 s from any RPC | Usually self-heals. If it lasts more than 10 min, add or replace URLs in `RPC_HTTP_URLS` / `RPC_WS_URLS` and restart |
| `Paused new entries: repeated_tx_failures` | 3 failed sends in a row | Read the logs (`docker compose logs --tail 200 bot`). Common causes are gas above the cap, low balance or slippage. Fix the cause, then restart |
| `BUY FAILED` / `SELL FAILED` | Simulation or transaction failed. Nothing was sent if simulation failed | A sell is retried every tick. If it keeps failing, sell manually from your wallet app |
| `Recovery: order ... was filled but not recorded` | The bot crashed between send and save | Check the wallet on BscScan. If you hold the token, sell it manually or let the bot exit it after adding the position by hand |
| Dashboard `/health` returns 503 | No successful tick for 5 min, or RPC unhealthy | `docker compose logs bot`, then `docker compose restart bot` |
| Gate says `report_age_*` | The evaluation is older than 14 days | Re-run `fetchHistory.ts` and `backtest.ts`. Live entries stay paused until the gate passes again |

## Routine maintenance

- **Weekly:** re-run `fetchHistory.ts` (it resumes) and `backtest.ts` so the gate stays fresh and the universe is re-screened.
- **Monthly:** `git pull`, `docker compose up -d --build`, `npm test` in the container, then review `docs/LAUNCH_CHECKLIST.md` again if live.
- **Backups:** a nightly in-container `VACUUM INTO` writes to `./backups` (14 kept), plus `deploy/backup.sh` via cron. Test a restore: `sqlite3 backups/<file>.db "select count(*) from trades"`.

## Restore from backup

```bash
docker compose down
```

```bash
cp backups/bot-<timestamp>.db data/bot.db && rm -f data/bot.db-wal data/bot.db-shm
```

```bash
docker compose up -d
```

## Logs

JSON lines on stdout/stderr, rotated by Docker (5 × 20 MB). Useful filters:

```bash
docker compose logs bot | grep -E '"level":"(warn|error)"'
```
