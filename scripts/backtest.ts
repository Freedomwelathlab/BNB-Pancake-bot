// Walk-forward evaluation on downloaded history. Writes reports/latest-evaluation.json
// (read by the evidence gate) and a human-readable markdown report.
// Usage: npm run backtest -- [splitFrac=0.6] [--cost=bsc|lowcost]
// --cost=lowcost is a what-if: 0.01% swap fee, ~$0.001 gas and 100x deeper pools
// (roughly Solana/Base majors). It writes its own report and never feeds the gate.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig } from '../src/core/config.ts';
import { fillGaps, resample } from '../src/data/gecko.ts';
import { walkForward, type Candidate } from '../src/backtest/walkforward.ts';
import { roundTripCost } from '../src/core/costs.ts';
import type { ExecModel, SeriesInput } from '../src/backtest/engine.ts';
import { STRATEGIES, type BreakoutParams, type PullbackParams } from '../src/strategy/strategies.ts';
import type { ExitPolicy } from '../src/risk/exits.ts';
import type { EvaluationReport } from '../src/gate/evidence.ts';
import type { Metrics } from '../src/backtest/metrics.ts';
import type { PoolInfo } from '../src/data/gecko.ts';

const args = process.argv.slice(2);
const splitFrac = Number(args.find((a) => !a.startsWith('--')) ?? 0.6);
const costProfile = (args.find((a) => a.startsWith('--cost='))?.slice(7) ?? 'bsc') as 'bsc' | 'lowcost';
if (!['bsc', 'lowcost'].includes(costProfile)) throw new Error('--cost must be bsc or lowcost');
const lowCost = costProfile === 'lowcost';
const cfg = loadConfig();
const dir = './data/history';
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
if (files.length === 0) {
  console.error('No history found. Run: npm run fetch-history');
  process.exit(1);
}

const series: (SeriesInput & { symbol: string })[] = [];
for (const f of files) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { pool: PoolInfo; barSeconds: number; candles: SeriesInput['candles'] };
  if (j.candles.length < 2000) continue;
  const reserveBnbNow = j.pool.bnbPriceUsd > 0 ? j.pool.reserveUsd / 2 / j.pool.bnbPriceUsd : 0;
  series.push({ token: j.pool.token, symbol: j.pool.tokenSymbol, candles: fillGaps(j.candles, j.barSeconds), barSeconds: j.barSeconds, reserveBnbNow: lowCost ? reserveBnbNow * 100 : reserveBnbNow, feeBps: lowCost ? 1 : j.pool.feeBps });
}
const first = Math.min(...series.map((s) => s.candles[0]!.t));
const last = Math.max(...series.map((s) => s.candles.at(-1)!.t));
console.log(`series: ${series.length}, window ${new Date(first * 1000).toISOString().slice(0, 10)} -> ${new Date(last * 1000).toISOString().slice(0, 10)}`);

// Gas: ~150k gas/swap at the observed 0.05 gwei = 0.0000075 BNB; use 0.00002 to cover spikes and approvals.
const ex: ExecModel = lowCost
  ? { feeBps: 1, buyTaxBps: 0, sellTaxBps: 0, gasBnbPerSwap: 0.000002, failureProb: 0.03, latencySlippageBps: 2 }
  : { feeBps: 25, buyTaxBps: 0, sellTaxBps: 0, gasBnbPerSwap: 0.00002, failureProb: 0.03, latencySlippageBps: 5 };
const size = cfg.MAX_TRADE_BNB;
const capital = cfg.PAPER_START_BNB;

const mkExits = (stops: number[], tps: number[], holds: number[]): ExitPolicy[] => {
  const out: ExitPolicy[] = [];
  for (const hardStopPct of stops)
    for (const takeProfitPct of tps)
      for (const maxHoldMinutes of holds)
        out.push({ hardStopPct, trailActivatePct: takeProfitPct * 0.6, trailPct: hardStopPct * 0.6, takeProfitPct, takeProfitFraction: 0.5, maxHoldMinutes, illiquidityDropPct: 40 });
  return out;
};
const timeframes = [
  { label: '5m', factor: 1, exits: mkExits([2, 3.5], [3, 6], [240, 1440]), atr: [0.002, 0.03] },
  { label: '1h', factor: 12, exits: mkExits([4, 7], [6, 12], [2880, 10080]), atr: [0.005, 0.08] },
];

type Res = ReturnType<typeof walkForward<unknown>> & { variant: string; barSeconds: number };
const results: Res[] = [];
let gridTotal = 0;
for (const tf of timeframes) {
  const ser = series.map((s) => ({ ...s, candles: tf.factor === 1 ? s.candles : resample(s.candles, s.barSeconds, tf.factor), barSeconds: s.barSeconds * tf.factor }));
  const pbGrid: Candidate<PullbackParams>[] = [];
  for (const rsiMax of [30, 38])
    for (const dipLookback of [3, 8])
      for (const exit of tf.exits) pbGrid.push({ params: { fast: 20, slow: 50, trend: 200, rsiMax, dipLookback, minAtrPct: tf.atr[0]!, maxAtrPct: tf.atr[1]! }, exit });
  const boGrid: Candidate<BreakoutParams>[] = [];
  for (const lookback of [24, 72]) for (const exit of tf.exits) boGrid.push({ params: { fast: 20, slow: 50, trend: 200, lookback, minAtrPct: tf.atr[0]!, maxAtrPct: tf.atr[1]! }, exit });
  gridTotal += pbGrid.length + boGrid.length;
  const minIs = tf.factor === 1 ? 30 : 15;
  results.push({ ...walkForward(ser, STRATEGIES.pullback, pbGrid, ex, size, capital, splitFrac, minIs), variant: `pullback ${tf.label}`, barSeconds: 300 * tf.factor } as Res);
  results.push({ ...walkForward(ser, STRATEGIES.breakout, boGrid, ex, size, capital, splitFrac, minIs), variant: `breakout ${tf.label}`, barSeconds: 300 * tf.factor } as Res);
}

// Average modeled round-trip cost at our size across the universe (for the gross-edge figure).
const avgCostPct = series.reduce((a, s) => a + roundTripCost({ sizeBnb: size, feeBps: s.feeBps ?? 25, buyTaxBps: 0, sellTaxBps: 0, reserveBnb: s.reserveBnbNow, gasBnbPerSwap: ex.gasBnbPerSwap, failureProb: ex.failureProb }).costPct, 0) / series.length;

const fmt = (m: Metrics | null) =>
  m ? `| ${m.trades} | ${m.winRatePct.toFixed(1)}% | ${m.netPnlBnb.toFixed(5)} | ${m.expectancyPct.toFixed(3)}% | ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : 'inf'} | ${m.tStat.toFixed(2)} | ${m.maxDrawdownPctOfCapital.toFixed(1)}% | ${m.riskOfRuinPct.toFixed(1)}% |` : '| - | - | - | - | - | - | - | - |';

const notes = [
  ...(lowCost ? ['WHAT-IF COST PROFILE (lowcost): 0.01% fee per leg, 0.000002 BNB gas, 2 bps latency, pools 100x deeper. Not used by the evidence gate.'] : []),
  `Universe: ${series.length} WBNB pools on PancakeSwap (${series.map((s) => s.symbol).join(', ')}), chosen by CURRENT volume and liquidity -> survivorship bias (pools that died are absent; results are optimistic).`,
  `Data: GeckoTerminal 5-minute OHLCV priced in WBNB. Fills at next bar open + ${ex.latencySlippageBps}bps latency; stop fills assume worst intrabar order.`,
  `Costs: per-pool swap fee both legs, constant-product price impact (V2-equivalent depth from current TVL, conservative for V3), gas ${ex.gasBnbPerSwap} BNB/swap, ${ex.failureProb * 100}% failed-tx gas, zero-tax tokens only.`,
  `Parameters chosen on the first ${(splitFrac * 100).toFixed(0)}% of the window (in-sample) and judged only on the rest (out-of-sample). ${gridTotal} parameter sets tested across 4 variants (2 strategies x 5m/1h); the in-sample winner is biased upward by multiple testing. The variant sent to the evidence gate is chosen by IN-SAMPLE expectancy only.`,
  `Trade size ${size} BNB on ${capital} BNB capital.`,
];

mkdirSync('./reports', { recursive: true });
let md = `# Backtest evaluation\n\nGenerated ${new Date().toISOString()}\n\n## Data and assumptions\n\n${notes.map((n) => `- ${n}`).join('\n')}\n\n`;
md += `## Results (net of all modeled costs, in BNB)\n\n| Strategy | Sample | Trades | Win rate | Net PnL BNB | Expectancy/trade | Profit factor | t-stat | Max DD % cap | Risk of ruin |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  md += `| ${r.variant} | in-sample ${fmt(r.inSample)}\n| ${r.variant} | **out-of-sample** ${fmt(r.outOfSample)}\n`;
}
md += `\nModeled round-trip cost at ${size} BNB: ${(avgCostPct * 100).toFixed(3)}% average across the universe.\n\n`;
for (const r of results) {
  md += `### ${r.variant}\n\nChosen parameters: \`${JSON.stringify(r.chosen?.params)}\`\n\nChosen exits: \`${JSON.stringify(r.chosen?.exit)}\`\n\nOOS exit reasons: \`${JSON.stringify(r.outOfSample?.exitReasons ?? {})}\`\n\n`;
  const byTok = new Map<string, { n: number; pnl: number }>();
  for (const t of r.oosTrades) {
    const e = byTok.get(t.token) ?? { n: 0, pnl: 0 };
    e.n++;
    e.pnl += t.pnlBnb;
    byTok.set(t.token, e);
  }
  md += `| Token | OOS trades | OOS net BNB |\n|---|---|---|\n`;
  for (const s of series) {
    const e = byTok.get(s.token);
    if (e) md += `| ${s.symbol} | ${e.n} | ${e.pnl.toFixed(5)} |\n`;
  }
  md += '\n';
}

// Choose the variant for the gate by IN-SAMPLE expectancy (choosing by OOS would leak the test set).
const best = results.filter((r) => r.inSample && r.outOfSample).sort((a, b) => b.inSample!.expectancyPct - a.inSample!.expectancyPct)[0];
if (best?.outOfSample && !lowCost) {
  const report: EvaluationReport = {
    generatedAt: new Date().toISOString(),
    strategy: best.strategy,
    params: best.chosen?.params,
    exit: best.chosen?.exit,
    oos: best.outOfSample,
    expectedEdgePct: best.outOfSample.expectancyPct / 100 + avgCostPct,
    barSeconds: best.barSeconds,
    selection: `${best.variant}: highest in-sample expectancy of ${results.length} variants`,
    dataNotes: notes,
  };
  writeFileSync('./reports/latest-evaluation.json', JSON.stringify(report, null, 2));
}
if (best && lowCost) md += `\n**What-if only:** nothing from this report is sent to the evidence gate.\n`;
else if (best) md += `\n**Variant sent to the evidence gate:** ${best.variant} (highest in-sample expectancy). The gate decides pass/fail from its out-of-sample row.\n`;
writeFileSync(lowCost ? './reports/backtest-report-lowcost.md' : './reports/backtest-report.md', md);
console.log(md);
