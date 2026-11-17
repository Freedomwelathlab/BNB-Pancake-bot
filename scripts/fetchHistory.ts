// Builds the historical dataset for the "established pools" strategies.
// 1) discover WBNB pools on BSC, 2) filter by age/liquidity, 3) run the SAME safety checks
// the live bot uses (GoPlus + Honeypot.is must both pass), 4) download 5-minute OHLCV.
// Usage: npm run fetch-history -- [days=90] [maxPools=12]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { discoverWbnbPools, fetchOhlcv, poolsForTokens } from '../src/data/gecko.ts';
import { gatherSafetyFacts } from '../src/safety/sources.ts';
import { scoreSafety, DEFAULT_POLICY } from '../src/safety/scorer.ts';
import { loadConfig } from '../src/core/config.ts';
import { BLUE_CHIPS } from '../src/core/constants.ts';

const days = Number(process.argv[2] ?? 90);
const maxPools = Number(process.argv[3] ?? 12);
const cfg = loadConfig();
const outDir = './data/history';
mkdirSync(outDir, { recursive: true });

const BLUE = new Set(Object.keys(BLUE_CHIPS));

const pools = [...(await poolsForTokens(Object.keys(BLUE_CHIPS))), ...(await discoverWbnbPools(10))];
const now = Date.now() / 1000;
const byToken = new Map<string, (typeof pools)[number]>();
for (const p of pools) {
  if (!/pancakeswap/i.test(p.dex)) continue; // executor supports PancakeSwap V2/V3 only
  if (now - p.createdAt < cfg.MIN_POOL_AGE_DAYS * 86400) continue;
  if (p.reserveUsd < cfg.MIN_LIQUIDITY_USD) continue;
  const prev = byToken.get(p.token);
  if (!prev || p.reserveUsd > prev.reserveUsd) byToken.set(p.token, p);
}
const candidates = [...byToken.values()].sort((a, b) => b.volume24hUsd - a.volume24hUsd);
console.log(`discovered ${pools.length} WBNB pools, ${candidates.length} pass age>=${cfg.MIN_POOL_AGE_DAYS}d & liquidity>=$${cfg.MIN_LIQUIDITY_USD}`);

const policy = { ...DEFAULT_POLICY, maxTaxPct: cfg.MAX_TAX_PCT, minLiquidityUsd: cfg.MIN_LIQUIDITY_USD, minPairAgeMinutes: cfg.MIN_POOL_AGE_DAYS * 1440, maxTop10HolderPct: cfg.MAX_TOP10_HOLDER_PCT, minSafetyScore: cfg.MIN_SAFETY_SCORE };
const selected: typeof candidates = [];
const rejected: { symbol: string; token: string; reasons: string[] }[] = [];
for (const p of candidates) {
  if (selected.length >= maxPools) break;
  const facts = await gatherSafetyFacts(p.token, p.pool);
  const v = scoreSafety(facts, policy, { blueChip: BLUE.has(p.token) });
  if (!v.pass) {
    rejected.push({ symbol: p.tokenSymbol, token: p.token, reasons: v.hardRejects });
    console.log(`  reject ${p.tokenSymbol.padEnd(10)} ${v.hardRejects.join(', ')}`);
    continue;
  }
  console.log(`  accept ${p.tokenSymbol.padEnd(10)} score ${v.score} fee ${p.feeBps}bps liq $${Math.round(p.reserveUsd).toLocaleString()} ${p.dex}`);
  selected.push(p);
}

const bars = Math.ceil((days * 86400) / 300);
// Write the universe first so the run is resumable; skip pools already downloaded.
writeFileSync(`${outDir}/_universe.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), days, selected, rejected, note: 'Universe chosen by CURRENT volume/liquidity: survivorship bias. Pools that died during the window are absent.' }, null, 2));
for (const p of selected) {
  const file = `${outDir}/${p.pool}.json`;
  if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).candles.length >= bars * 0.9) {
    console.log(`have ${p.tokenSymbol}`);
    continue;
  }
  process.stdout.write(`fetching ${p.tokenSymbol} ${p.pool} ...`);
  try {
    const candles = await fetchOhlcv(p.pool, p.token, 'minute', 5, bars, (n) => process.stdout.write(` ${n}`));
    writeFileSync(file, JSON.stringify({ pool: p, fetchedAt: new Date().toISOString(), barSeconds: 300, candles }));
    console.log(` -> ${candles.length} bars`);
  } catch (e) {
    console.log(` FAILED: ${String(e).slice(0, 120)} (re-run to resume)`);
  }
}
writeFileSync(`${outDir}/_universe.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), days, selected, rejected, note: 'Universe chosen by CURRENT volume/liquidity: survivorship bias. Pools that died during the window are absent.' }, null, 2));
console.log('done');
