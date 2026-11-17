import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSeries, type ExecModel } from '../src/backtest/engine.ts';
import { computeMetrics, riskOfRuin } from '../src/backtest/metrics.ts';
import { walkForward } from '../src/backtest/walkforward.ts';
import { evaluateGate, DEFAULT_THRESHOLDS, type EvaluationReport } from '../src/gate/evidence.ts';
import { STRATEGIES, type Strategy } from '../src/strategy/strategies.ts';
import { ema, rsi } from '../src/strategy/indicators.ts';
import type { Candle } from '../src/core/types.ts';
import type { ExitPolicy } from '../src/risk/exits.ts';

const zeroCost: ExecModel = { feeBps: 0, buyTaxBps: 0, sellTaxBps: 0, gasBnbPerSwap: 0, failureProb: 0, latencySlippageBps: 0 };
const realCost: ExecModel = { feeBps: 25, buyTaxBps: 0, sellTaxBps: 0, gasBnbPerSwap: 0.00002, failureProb: 0.02, latencySlippageBps: 5 };
const exitP: ExitPolicy = { hardStopPct: 3, trailActivatePct: 2, trailPct: 1.5, takeProfitPct: 5, takeProfitFraction: 0.5, maxHoldMinutes: 120, illiquidityDropPct: 60 };

function randomWalk(n: number, seed: number, drift = 0): Candle[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let p = 1;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const o = p;
    const r = (rnd() - 0.5) * 0.02 + drift;
    p = Math.max(1e-6, p * (1 + r));
    out.push({ t: i * 300, o, h: Math.max(o, p) * (1 + rnd() * 0.004), l: Math.min(o, p) * (1 - rnd() * 0.004), c: p, v: 1 });
  }
  return out;
}

test('indicators are causal: appending future data does not change past values', () => {
  const c = randomWalk(400, 1).map((x) => x.c);
  const a = ema(c.slice(0, 300), 20);
  const b = ema(c, 20);
  const r1 = rsi(c.slice(0, 300));
  const r2 = rsi(c);
  for (let i = 0; i < 300; i++) {
    if (Number.isFinite(a[i])) assert.equal(a[i], b[i]);
    if (Number.isFinite(r1[i])) assert.equal(r1[i], r2[i]);
  }
});

test('strategy signals do not look ahead (future candles cannot change past signals)', () => {
  const full = randomWalk(1500, 3, 0.0003);
  for (const [name, strat, params] of [
    ['pullback', STRATEGIES.pullback, { fast: 20, slow: 50, trend: 200, rsiMax: 40, dipLookback: 6, minAtrPct: 0.001, maxAtrPct: 0.05 }],
    ['breakout', STRATEGIES.breakout, { fast: 20, slow: 50, trend: 200, lookback: 24, minAtrPct: 0.001, maxAtrPct: 0.05 }],
  ] as [string, Strategy<any>, any][]) {
    const pf = strat.prepare(full, params);
    const cut = 1000;
    const pc = strat.prepare(full.slice(0, cut), params);
    for (let i = strat.warmup; i < cut; i++) assert.equal(strat.signal(pc, i, params), strat.signal(pf, i, params), `${name} differs at ${i}`);
  }
});

test('engine fills at next bar open, never at the signal bar', () => {
  const candles = randomWalk(300, 5);
  const always: Strategy<null> = { name: 'always', warmup: 0, prepare: (c) => ({ candles: c, close: [], high: [], emaFast: [], emaSlow: [], emaTrend: [], rsi: [], atrPct: [] }), signal: (_x, i) => i === 10 };
  const tr = runSeries({ token: 't', candles, barSeconds: 300, reserveBnbNow: 1e9 }, always, null, { ...exitP, maxHoldMinutes: 30 }, zeroCost, 1);
  assert.equal(tr.length, 1);
  assert.equal(tr[0]!.entryTime, candles[11]!.t);
});

test('with zero costs a flat round trip is ~0 pnl; with real costs it is negative', () => {
  const flat: Candle[] = Array.from({ length: 50 }, (_, i) => ({ t: i * 60, o: 1, h: 1, l: 1, c: 1, v: 1 }));
  const once: Strategy<null> = { name: 'once', warmup: 0, prepare: (c) => ({ candles: c, close: [], high: [], emaFast: [], emaSlow: [], emaTrend: [], rsi: [], atrPct: [] }), signal: (_x, i) => i === 1 };
  const ep = { ...exitP, maxHoldMinutes: 5 };
  const a = runSeries({ token: 't', candles: flat, barSeconds: 60, reserveBnbNow: 1e12 }, once, null, ep, zeroCost, 1);
  assert.ok(Math.abs(a[0]!.pnlBnb) < 1e-6);
  const b = runSeries({ token: 't', candles: flat, barSeconds: 60, reserveBnbNow: 1e12 }, once, null, ep, realCost, 1);
  assert.ok(b[0]!.pnlBnb < -0.004, `pnl ${b[0]!.pnlBnb}`);
});

test('random walk has no edge after costs (sanity check against overfitting the engine)', () => {
  const series = [1, 2, 3, 4, 5, 6].map((seed) => ({ token: `t${seed}`, candles: randomWalk(6000, seed), barSeconds: 300, reserveBnbNow: 1e6 }));
  const p = { fast: 20, slow: 50, trend: 200, rsiMax: 40, dipLookback: 6, minAtrPct: 0.001, maxAtrPct: 0.05 };
  const trades = series.flatMap((s) => runSeries(s, STRATEGIES.pullback, p, exitP, realCost, 0.02));
  const m = computeMetrics(trades, 0.2);
  assert.ok(m.trades > 20, `trades ${m.trades}`);
  assert.ok(m.expectancyPct < 0.2, `random data should not show a real edge, got ${m.expectancyPct}%`);
});

test('metrics: profit factor, drawdown, expectancy', () => {
  const mk = (pnl: number, t: number) => ({ id: String(t), token: 'x', strategy: 's', entryTime: t, exitTime: t + 1, sizeBnb: 1, proceedsBnb: 1 + pnl, pnlBnb: pnl, returnPct: pnl * 100, exitReason: 'manual' as const });
  const m = computeMetrics([mk(0.1, 1), mk(-0.05, 2), mk(-0.05, 3), mk(0.2, 4)], 1);
  assert.equal(m.trades, 4);
  assert.ok(Math.abs(m.profitFactor - 3) < 1e-9);
  assert.ok(Math.abs(m.maxDrawdownBnb - 0.1) < 1e-9);
  assert.ok(Math.abs(m.netPnlBnb - 0.2) < 1e-9);
});

test('risk of ruin is high for losing returns and ~0 for winning ones', () => {
  assert.ok(riskOfRuin([-5, -4, -6, 1], 1) > 90);
  assert.ok(riskOfRuin([2, 3, 1, -0.5], 0.1) < 1);
});

test('walk-forward chooses params in-sample and reports out-of-sample separately', () => {
  const series = [11, 12, 13].map((seed) => ({ token: `t${seed}`, candles: randomWalk(5000, seed, 0.0002), barSeconds: 300, reserveBnbNow: 1e6 }));
  const grid = [35, 45].map((rsiMax) => ({ params: { fast: 20, slow: 50, trend: 200, rsiMax, dipLookback: 6, minAtrPct: 0.001, maxAtrPct: 0.05 }, exit: exitP }));
  const wf = walkForward(series, STRATEGIES.pullback, grid, realCost, 0.02, 0.2, 0.6, 5);
  assert.ok(wf.chosen);
  assert.ok(wf.oosTrades.every((t) => t.entryTime >= wf.splitTime));
});

test('evidence gate fails closed and passes only when every threshold is met', () => {
  assert.equal(evaluateGate(null, { trades: 100, netPnlBnb: 1, profitFactor: 2 }, DEFAULT_THRESHOLDS).pass, false);
  const good: EvaluationReport = {
    generatedAt: new Date().toISOString(), strategy: 'pullback', params: {}, exit: {}, expectedEdgePct: 0.02, dataNotes: [],
    oos: { trades: 80, wins: 50, winRatePct: 62, netPnlBnb: 0.1, grossWinBnb: 0.3, grossLossBnb: 0.2, profitFactor: 1.5, expectancyBnb: 0.001, expectancyPct: 0.5, stdReturnPct: 2, tStat: 2.2, maxDrawdownBnb: 0.02, maxDrawdownPctOfCapital: 10, riskOfRuinPct: 0.1, avgHoldMinutes: 60, exitReasons: {} },
  };
  assert.equal(evaluateGate(good, { trades: 40, netPnlBnb: 0.01, profitFactor: 1.4 }, DEFAULT_THRESHOLDS).pass, true);
  assert.equal(evaluateGate(good, { trades: 10, netPnlBnb: 0.01, profitFactor: 1.4 }, DEFAULT_THRESHOLDS).pass, false);
  assert.equal(evaluateGate({ ...good, oos: { ...good.oos, tStat: 1 } }, { trades: 40, netPnlBnb: 0.01, profitFactor: 1.4 }, DEFAULT_THRESHOLDS).pass, false);
  const old = { ...good, generatedAt: new Date(Date.now() - 30 * 86_400_000).toISOString() };
  assert.equal(evaluateGate(old, { trades: 40, netPnlBnb: 0.01, profitFactor: 1.4 }, DEFAULT_THRESHOLDS).pass, false);
});
