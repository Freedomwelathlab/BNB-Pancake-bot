// Pre-registered holdout test for one fixed strategy on Solana (no parameter search).
// The parameters are frozen from the phase 1 walk-forward (breakout 1h, chosen in-sample on
// the 90-day 5m window). Here they are judged on OLDER hourly data that phase 1 never saw.
// Usage: npm run holdout-solana -- [days=365]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fetchOhlcv, fillGaps, type PoolInfo } from '../src/data/gecko.ts';
import { runSeries, type ExecModel, type SeriesInput } from '../src/backtest/engine.ts';
import { computeMetrics, type Metrics } from '../src/backtest/metrics.ts';
import { breakout, type BreakoutParams } from '../src/strategy/strategies.ts';
import type { ExitPolicy } from '../src/risk/exits.ts';
import { DEFAULT_THRESHOLDS } from '../src/gate/evidence.ts';
import type { Trade } from '../src/core/types.ts';

const days = Number(process.argv[2] ?? 365);

// Frozen before this test was run (reports/backtest-report-solana.md, 2026-11-18).
const PARAMS: BreakoutParams = { fast: 20, slow: 50, trend: 200, lookback: 72, minAtrPct: 0.005, maxAtrPct: 0.08 };
const EXIT: ExitPolicy = { hardStopPct: 7, trailActivatePct: 7.2, trailPct: 4.2, takeProfitPct: 12, takeProfitFraction: 0.5, maxHoldMinutes: 10080, illiquidityDropPct: 40 };
const SIZE = 0.15; // SOL, same as phase 1
const CAPITAL = 1.5;

const srcDir = './data/history/solana';
const outDir = './data/history/solana-1h';
mkdirSync(outDir, { recursive: true });
const universe = JSON.parse(readFileSync(`${srcDir}/_universe.json`, 'utf8')) as { selected: PoolInfo[] };

// Start of each token's phase 1 (5-minute) data: everything before it is untouched holdout data.
// Per token, because thinly traded pools' 5m files reach further back.
const phase1Start = new Map<string, number>();
for (const p of universe.selected) {
  const f = `${srcDir}/${p.pool}.json`;
  if (existsSync(f)) phase1Start.set(p.token, (JSON.parse(readFileSync(f, 'utf8')) as { candles: { t: number }[] }).candles[0]!.t);
}
const p1 = (s: { token: string }) => phase1Start.get(s.token) ?? 0;

const series: (SeriesInput & { symbol: string })[] = [];
for (const p of universe.selected) {
  const file = `${outDir}/${p.pool}.json`;
  let candles: SeriesInput['candles'];
  if (existsSync(file)) candles = JSON.parse(readFileSync(file, 'utf8')).candles;
  else {
    process.stdout.write(`fetching ${p.tokenSymbol} hourly ...`);
    try {
      candles = await fetchOhlcv(p.pool, p.token, 'hour', 1, days * 24, (n) => process.stdout.write(` ${n}`), 'solana');
    } catch (e) {
      console.log(` FAILED ${String(e).slice(0, 100)}`);
      continue;
    }
    writeFileSync(file, JSON.stringify({ pool: p, fetchedAt: new Date().toISOString(), barSeconds: 3600, candles }));
    console.log(` -> ${candles.length} bars`);
  }
  const reserve = p.bnbPriceUsd > 0 ? p.reserveUsd / 2 / p.bnbPriceUsd : 0;
  series.push({ token: p.token, symbol: p.tokenSymbol, candles: fillGaps(candles, 3600), barSeconds: 3600, reserveBnbNow: reserve, feeBps: p.feeBps });
}

const poolFee: ExecModel = { feeBps: 30, buyTaxBps: 0, sellTaxBps: 0, gasBnbPerSwap: 0.00002, failureProb: 0.05, latencySlippageBps: 5 };
const lowCost: ExecModel = { feeBps: 1, buyTaxBps: 0, sellTaxBps: 0, gasBnbPerSwap: 0.00002, failureProb: 0.03, latencySlippageBps: 2 };

type Range = (s: SeriesInput) => [number, number];
function run(range: Range, ex: ExecModel, deep: boolean): Trade[] {
  return series.flatMap((s) => {
    const [from, to] = range(s);
    if (!(from < to)) return [];
    const iFrom = s.candles.findIndex((c) => c.t >= from);
    if (iFrom < 0) return [];
    const iTo = s.candles.findIndex((c) => c.t >= to);
    const candles = s.candles.slice(Math.max(0, iFrom - breakout.warmup), iTo < 0 ? undefined : iTo);
    if (candles.length <= breakout.warmup) return [];
    const input: SeriesInput = { ...s, candles, reserveBnbNow: deep ? s.reserveBnbNow * 100 : s.reserveBnbNow, feeBps: deep ? 1 : s.feeBps };
    return runSeries(input, breakout, PARAMS, EXIT, ex, SIZE).filter((t) => t.entryTime >= from && t.entryTime < to);
  });
}

const t0 = Math.min(...series.map((s) => s.candles[0]!.t));
const t1 = Math.max(...series.map((s) => s.candles.at(-1)!.t)) + 1;
const d = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const fmt = (m: Metrics) =>
  `| ${m.trades} | ${m.winRatePct.toFixed(1)}% | ${m.netPnlBnb.toFixed(4)} | ${m.expectancyPct.toFixed(3)}% | ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf'} | ${m.tStat.toFixed(2)} | ${m.maxDrawdownPctOfCapital.toFixed(1)}% |`;
const gate = (m: Metrics) => {
  const th = DEFAULT_THRESHOLDS;
  const r: string[] = [];
  if (m.trades < th.minOosTrades) r.push(`trades ${m.trades}<${th.minOosTrades}`);
  if (!(m.expectancyPct > 0)) r.push('expectancy not positive');
  if (!(m.profitFactor >= th.minProfitFactor)) r.push(`PF ${m.profitFactor.toFixed(2)}<${th.minProfitFactor}`);
  if (!(m.tStat >= th.minTStat)) r.push(`t ${m.tStat.toFixed(2)}<${th.minTStat}`);
  return r.length ? `FAIL (${r.join(', ')})` : 'PASS';
};

const p1min = Math.min(...series.map(p1)), p1max = Math.max(...series.map(p1));
const windows: [string, Range][] = [
  [`**Holdout** ${d(t0)} -> each token's phase 1 start (${d(p1min)}..${d(p1max)}); never seen`, (s) => [t0, p1(s)]],
  [`Phase 1 window -> ${d(t1)} (parameters were tuned on part of it)`, (s) => [p1(s), t1]],
  [`Full ${d(t0)} -> ${d(t1)}`, () => [t0, t1]],
];
let md = `# Solana holdout test: breakout 1h, fixed parameters\n\nGenerated ${new Date().toISOString()}\n\n`;
md += `- Parameters frozen from phase 1 (no search): \`${JSON.stringify(PARAMS)}\`, exits \`${JSON.stringify(EXIT)}\`.\n`;
md += `- Universe: ${series.map((s) => s.symbol).join(', ')} (the phase 1 universe; chosen by current liquidity, so survivorship bias remains).\n`;
md += `- Size ${SIZE} SOL on ${CAPITAL} SOL. Pool-fee costs: each pool's 0.25-0.30% fee per leg, 0.00002 SOL gas, 5% failed tx. Low-cost: 0.01% fee, pools 100x deeper.\n\n`;
md += `| Window | Costs | Trades | Win rate | Net SOL | Expectancy/trade | PF | t-stat | Max DD | Gate thresholds |\n|---|---|---|---|---|---|---|---|---|---|\n`;
const results: Record<string, Metrics> = {};
for (const [label, range] of windows)
  for (const [cl, ex, deep] of [['pool fee', poolFee, false], ['low cost', lowCost, true]] as const) {
    const m = computeMetrics(run(range, ex, deep), CAPITAL);
    results[`${label}|${cl}`] = m;
    md += `| ${label} | ${cl} ${fmt(m)} ${gate(m)} |\n`;
  }

// Stability: holdout by quarter and by token (pool-fee costs).
md += `\n## Holdout stability (pool-fee costs)\n\n| Period | Trades | Expectancy/trade | PF |\n|---|---|---|---|\n`;
const q = 91 * 86400;
for (let a = t0; a < p1max; a += q) {
  const m = computeMetrics(run((s) => [a, Math.min(a + q, p1(s))], poolFee, false), CAPITAL);
  md += `| ${d(a)} -> ${d(Math.min(a + q, p1max))} | ${m.trades} | ${m.expectancyPct.toFixed(3)}% | ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf'} |\n`;
}
const hold = run((s) => [t0, p1(s)], poolFee, false);
md += `\n| Token | Holdout trades | Net SOL |\n|---|---|---|\n`;
for (const s of series) {
  const tr = hold.filter((t) => t.token === s.token);
  md += `| ${s.symbol} (holdout ${d(s.candles[0]!.t)} -> ${d(p1(s))}) | ${tr.length} | ${tr.reduce((a, t) => a + t.pnlBnb, 0).toFixed(4)} |\n`;
}
mkdirSync('./reports', { recursive: true });
writeFileSync('./reports/holdout-solana-breakout1h.md', md);
console.log(md);
