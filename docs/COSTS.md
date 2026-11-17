# Hosting, RPC and running costs

Prices were checked on 2026-11-17 from provider docs and comparison sites, and they change often. Re-check them on the provider's own pricing page before you buy.

## What the bot needs

About 150–300 MB of RAM, very little CPU, under 5 GB of disk and a stable connection. Load is about 1 RPC call per second plus 1 GeckoTerminal call per market every 5 minutes. A 1–2 GB VPS is plenty.

## Oracle Cloud Always Free (ARM) vs a paid Singapore VPS

| | Oracle Always Free (A1 Flex) | Paid VPS, Singapore, 2 GB |
|---|---|---|
| Price | $0 | about $8–12 per month (Hostinger about $7.70, Vultr $10–12, DigitalOcean about $11–12; Hetzner raised prices 30–37% in April 2026 and charges for bandwidth overage in SIN) |
| Resources | Up to **2 OCPU / 12 GB** total for Always Free tenancies (reduced from 4/24) | 1 vCPU / 2 GB / 50 GB, 1–3 TB traffic |
| Region | Must be your **home region** (choose Singapore at signup; it cannot be changed later) | Choose Singapore |
| Capacity | "Out of host capacity" errors are common for A1 in popular regions; you may wait days | Instant |
| Reclamation risk | Oracle **reclaims idle Always Free instances**: over 7 days, 95th-percentile CPU < 20%, network < 20% and (A1) memory < 20%. This bot is idle by those measures | None |
| Mitigation | Upgrade the tenancy to Pay-As-You-Go. Always Free resources stay free and are not reclaimed as idle. Set a budget alert and quotas | n/a |
| Verdict | Fine for **paper trading and research** | Recommended for **anything live**: predictable, supported, $10/month |

Latency: BNB Chain validators are spread worldwide. Singapore is a good region, but this bot does not race for the first block, so a few tens of milliseconds do not matter. Location is chosen for reliability, not speed.

## RPC

| Option | Cost | Notes |
|---|---|---|
| Public endpoints (bnbchain.org dataseed, publicnode) | $0 | bnbchain.org: 10K requests / 5 min, `eth_getLogs` disabled. publicnode: logs allowed, about 5K-block ranges, occasional errors. Enough for paper mode |
| Provider free tiers (NodeReal, QuickNode, Ankr, Chainstack, dRPC) | $0 | Get a key, add the HTTPS and WSS URLs first in the lists. Recommended for live |
| Paid tier | about $10–50 per month | Only if free tiers rate-limit you; this bot uses a small fraction of typical quotas |
| Private / MEV-protected send (48 Club, BlockRazor) | $0 to subscription | Optional. Reduces sandwich risk on sends |

Data APIs: GeckoTerminal (free, rate-limited; the bot spaces calls 6.5 s apart), DEX Screener (free, 300/min), GoPlus (free tier, bursts are rate-limited), Honeypot.is (free, no key at present). Total: $0.

## On-chain costs per trade

| Item | Typical |
|---|---|
| Gas | Observed 0.05 gwei. A swap is about 150–220k gas, so roughly 0.00001 BNB per swap. An approve is about the same, once per token |
| PancakeSwap fee | V3 majors 0.01–0.05% per swap; V2 0.25% per swap |
| Price impact | Under 0.01% at 0.02 BNB in the screened pools |
| Round trip at 0.02 BNB | About 0.1–0.2% on V3 majors, about 0.5–0.6% on V2 |

## Monthly total

| Setup | Cost |
|---|---|
| Paper/research on Oracle Free + public RPC | $0 |
| Live on a $10 Singapore VPS + free-tier RPC key | about $10/month + gas (cents) |

The bot only covers its costs if its edge beats them. See `reports/backtest-report.md`.
