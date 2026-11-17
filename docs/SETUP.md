# Beginner setup guide

You will set up the bot in **paper mode** (no real money). Live trading stays off until the evidence gate passes, and even then only you can switch it on.

## 1. Try it on your own computer first (Windows, macOS or Linux)

You need Node.js 22.13 or newer (`node --version`).

```bash
npm install
```

```bash
copy .env.example .env
```
(on macOS/Linux: `cp .env.example .env`)

```bash
npm test
```

```bash
npm run fetch-history -- 90 14
```

This takes about 30–40 minutes because the free data API is rate-limited. If it stops, run it again: it resumes where it left off.

```bash
npm run backtest
```

Read `reports/backtest-report.md`. If out-of-sample results are weak, the bot will never trade live. That is the intended outcome.

```bash
npm start
```

Open http://127.0.0.1:8787 and paste your `DASHBOARD_TOKEN`. When it is empty and the dashboard is bound to 127.0.0.1, no token is needed.

## 2. Telegram alerts (optional, 5 minutes)

1. In Telegram, message **@BotFather** → `/newbot` → copy the token into `TELEGRAM_BOT_TOKEN`.
2. Send any message to your new bot, then message **@userinfobot** to get your numeric id → `TELEGRAM_CHAT_ID`.
3. Restart. You get alerts for starts, buys, exits, failures, pauses and graduations.

## 3. Rent a server (Singapore)

See `docs/COSTS.md`. Recommended: a 2 GB VPS in Singapore running **Ubuntu 24.04**. Add your SSH public key when you create it.

## 4. Harden the server and install Docker

From your computer:

```bash
scp deploy/harden-ubuntu.sh root@YOUR_SERVER_IP:/root/
```

```bash
ssh root@YOUR_SERVER_IP "bash /root/harden-ubuntu.sh bot"
```

Then log in as the new user:

```bash
ssh bot@YOUR_SERVER_IP
```

```bash
git clone <your-private-repo-url> BNB-Sniping-Bot && cd BNB-Sniping-Bot
```

(or copy the folder with `scp -r`; do not copy `.env` or `secrets/` over insecure channels)

```bash
cp .env.example .env && nano .env
```

Set `DASHBOARD_TOKEN` (generate one with `openssl rand -hex 24`) and, optionally, the Telegram settings.

```bash
mkdir -p secrets data reports backups && touch secrets/hot_wallet_key && chmod 600 secrets/hot_wallet_key
```

```bash
docker compose run --rm bot node --import tsx scripts/fetchHistory.ts 90 14
```

```bash
docker compose run --rm bot node --import tsx scripts/backtest.ts
```

```bash
docker compose up -d --build
```

## 5. View the dashboard safely (SSH tunnel)

```bash
ssh -N -L 8787:127.0.0.1:8787 bot@YOUR_SERVER_IP
```

Then open http://127.0.0.1:8787 on your computer. Never open port 8787 in the firewall.

## 6. Backups

```bash
crontab -e
```

Add `15 0 * * * /home/bot/BNB-Sniping-Bot/deploy/backup.sh >> /home/bot/backup.log 2>&1`. Copy `~/bot-backups` off the server now and then, for example with `scp` to your PC.

## 7. Going live (only if the gate passes)

Follow `docs/LAUNCH_CHECKLIST.md` line by line. Do not skip it.
