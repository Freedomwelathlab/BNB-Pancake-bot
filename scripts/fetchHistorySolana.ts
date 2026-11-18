// Solana port, phase 1: build a 90-day dataset of established SOL-quoted pools.
// 1) seed the deepest SOL pool of each verified blue chip, discover the top SOL pools, 2) filter by age, liquidity and wash
// trading, 3) reject tokens with active mint/freeze authority or dangerous Token-2022
// extensions (on-chain check), 4) download 5-minute OHLCV priced in SOL.
// Usage: npm run fetch-history-solana -- [days=90] [maxPools=12]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deepestPools, discoverPools, fetchOhlcv, WSOL, type PoolInfo } from '../src/data/gecko.ts';
import { fetchSolanaMint, scoreSolanaMint, SOL_BLUE_CHIPS } from '../src/safety/solana.ts';
import { loadConfig } from '../src/core/config.ts';

const days = Number(process.argv[2] ?? 90);
const maxPools = Number(process.argv[3] ?? 12);
const cfg = loadConfig();
const outDir = './data/history/solana';
mkdirSync(outDir, { recursive: true });
const MAX_VOLUME_TO_LIQUIDITY = 30; // same wash-trading rule as the BSC screen

// Pool fee: from the pool name when GeckoTerminal includes it, else a conservative default.
const solFeeBps = (p: PoolInfo) => (/%/.test(p.name) ? p.feeBps : /raydium$/i.test(p.dex) ? 25 : 30);

const pools = [...(await deepestPools('solana', WSOL, Object.keys(SOL_BLUE_CHIPS))), ...(await discoverPools('solana', WSOL, 10))].map((p) => ({ ...p, feeBps: solFeeBps(p) }));
const now = Date.now() / 1000;
const byToken = new Map<string, PoolInfo>();
for (const p of pools) {
  if (now - p.createdAt < cfg.MIN_POOL_AGE_DAYS * 86400) continue;
  if (p.reserveUsd < cfg.MIN_LIQUIDITY_USD) continue;
  if (p.volume24hUsd / p.reserveUsd > MAX_VOLUME_TO_LIQUIDITY) continue;
  const prev = byToken.get(p.token);
  if (!prev || p.reserveUsd > prev.reserveUsd) byToken.set(p.token, p);
}
const candidates = [...byToken.values()].sort((a, b) => b.volume24hUsd - a.volume24hUsd);
console.log(`discovered ${pools.length} SOL pools, ${candidates.length} pass age>=${cfg.MIN_POOL_AGE_DAYS}d, liquidity>=$${cfg.MIN_LIQUIDITY_USD}, volume/liquidity<=${MAX_VOLUME_TO_LIQUIDITY}`);

const selected: PoolInfo[] = [];
const rejected: { symbol: string; token: string; reasons: string[] }[] = [];
for (const p of candidates) {
  if (selected.length >= maxPools) break;
  const v = scoreSolanaMint(await fetchSolanaMint(p.token), cfg.MAX_TAX_PCT, { blueChip: p.token in SOL_BLUE_CHIPS });
  if (!v.pass) {
    rejected.push({ symbol: p.tokenSymbol, token: p.token, reasons: v.rejects });
    console.log(`  reject ${p.tokenSymbol.padEnd(10)} ${v.rejects.join(', ')}`);
    continue;
  }
  console.log(`  accept ${p.tokenSymbol.padEnd(10)} fee ${p.feeBps}bps liq $${Math.round(p.reserveUsd).toLocaleString()} ${p.dex}`);
  selected.push(p);
  await new Promise((r) => setTimeout(r, 400)); // public Solana RPC rate limit
}

const bars = Math.ceil((days * 86400) / 300);
const universe = () =>
  JSON.stringify({ network: 'solana', quote: 'SOL', fetchedAt: new Date().toISOString(), days, selected, rejected, note: 'Universe chosen by CURRENT volume/liquidity: survivorship bias. Pools that died during the window are absent.' }, null, 2);
writeFileSync(`${outDir}/_universe.json`, universe());
for (const p of selected) {
  const file = `${outDir}/${p.pool}.json`;
  if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).candles.length >= bars * 0.9) {
    console.log(`have ${p.tokenSymbol}`);
    continue;
  }
  process.stdout.write(`fetching ${p.tokenSymbol} ${p.pool} ...`);
  try {
    const candles = await fetchOhlcv(p.pool, p.token, 'minute', 5, bars, (n) => process.stdout.write(` ${n}`), 'solana');
    writeFileSync(file, JSON.stringify({ pool: p, fetchedAt: new Date().toISOString(), barSeconds: 300, candles }));
    console.log(` -> ${candles.length} bars`);
  } catch (e) {
    console.log(` FAILED: ${String(e).slice(0, 120)} (re-run to resume)`);
  }
}
writeFileSync(`${outDir}/_universe.json`, universe());
console.log('done');
