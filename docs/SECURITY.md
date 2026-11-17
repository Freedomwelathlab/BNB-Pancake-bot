# Security model

## What we protect

1. **The hot wallet's funds.** Keep only what you are willing to lose in it.
2. **The key.** If someone gets it, the wallet is gone.
3. **The decision to trade live.** That decision belongs to you and to evidence, never to a default value.

## Threats and controls

| Threat | Control |
|---|---|
| Key leak through code, logs, git or env dumps | The key is read only from a file (Docker secret `secrets/hot_wallet_key`, chmod 600), never from an env var. Logs redact anything shaped like a 32-byte key or a Telegram token. `.gitignore` excludes `.env`, `secrets/`, `data/` and backups. Backups never include `secrets/`. |
| Bot sends funds somewhere else (bug, compromised dependency, bad config) | `exec/txGuard.ts` checks every transaction before signing. The only allowed targets are the PancakeSwap V2 Router and the SmartRouter. The only allowed functions are approve (to those routers), BNB→token and token→BNB swaps, plus the V3 unwrap to the wallet. The recipient must be the bot wallet, the deadline must be at most 30–35 s away, and the value must be at most MAX_TRADE_BNB. The bot has no plain transfer path, so it cannot withdraw. |
| Accidental live trading | Default mode is paper. Live needs `MODE=live`, `LIVE_TRADING_ENABLED=true`, the exact confirmation phrase, a key file, **and** a passing evidence gate: a recent out-of-sample report plus at least 30 profitable paper trades. If any of these is missing, the bot runs in paper mode or pauses entries. |
| Honeypots, rugs, malicious tokens | Two independent sources must both answer (GoPlus static analysis plus the Honeypot.is buy/sell simulation), and taxes must agree between them. Hard rejects cover mint, blacklist, pause, hidden owner, balance changes, changeable taxes, removable LP, holder concentration, young or thin pools, and wash trading. Default universe: established pools only. |
| Sandwich / MEV | Small sizes, deep pools, price impact capped at 1%, slippage capped at 1.5% via `amountOutMin`, 30 s deadlines. Optional upgrade: send through a private RPC (for example 48 Club or BlockRazor) by putting it first in `RPC_HTTP_URLS`. |
| Runaway losses | Per-trade size cap, capital-at-risk cap, open-position cap, daily loss cap, consecutive-failure pause, kill switch (dashboard, CLI or `data/KILL` file). |
| RPC outage or bad data | Several HTTP RPCs with ranked failover, WS rotation, and a stale-head detector that pauses entries. Every quote is simulated (`eth_call`) before a send. |
| Dashboard exposure | Binds to 127.0.0.1 (Docker publishes `127.0.0.1:8787` only). Reach it through an SSH tunnel. Bearer token with constant-time compare. The firewall allows SSH only. The kill switch can be turned on from the dashboard. |
| Container escape / host compromise | Non-root user, read-only root filesystem, all capabilities dropped, `no-new-privileges`, memory and CPU limits. Host: SSH keys only, no root login, ufw, fail2ban, unattended upgrades. |
| Supply chain | Few dependencies (viem, zod, tsx). Lockfile committed. The Docker build uses `npm ci --ignore-scripts`. |

## Wallet hygiene (do this)

- Create a **new** wallet only for the bot. Never import your main seed phrase. The bot never needs a seed phrase, only one private key.
- Fund it with a small amount. Sweep profits out manually from your own device. The bot cannot do this, by design.
- If you suspect a leak: run `npm run kill -- on`, move the funds out from another device, then generate a new wallet.
