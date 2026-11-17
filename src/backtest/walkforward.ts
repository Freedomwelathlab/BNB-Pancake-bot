// Walk-forward evaluation: parameters are chosen on the earlier (in-sample) part of every
// series and judged only on the later (out-of-sample) part. The split is by TIME, applied
// at the same timestamp across all series, so no future information leaks into selection.
import type { Trade } from '../core/types.ts';
import type { ExitPolicy } from '../risk/exits.ts';
import type { Strategy } from '../strategy/strategies.ts';
import { runSeries, type ExecModel, type SeriesInput } from './engine.ts';
import { computeMetrics, type Metrics } from './metrics.ts';

export interface Candidate<P> {
  params: P;
  exit: ExitPolicy;
}

export interface WalkForwardResult<P> {
  strategy: string;
  splitTime: number;
  candidatesTested: number;
  chosen: Candidate<P> | null;
  inSample: Metrics | null;
  outOfSample: Metrics | null;
  oosTrades: Trade[];
  ranking: { params: P; exit: ExitPolicy; isExpectancyPct: number; isTrades: number }[];
}

function sliceSeries(s: SeriesInput, from: number, to: number, warmupBars: number): SeriesInput {
  // Include warmup bars before `from` so indicators are valid, but drop trades entering before `from`.
  const idxFrom = s.candles.findIndex((c) => c.t >= from);
  const start = Math.max(0, (idxFrom < 0 ? s.candles.length : idxFrom) - warmupBars);
  const candles = s.candles.slice(start).filter((c) => c.t < to);
  return { ...s, candles };
}

export function walkForward<P>(
  series: SeriesInput[],
  strat: Strategy<P>,
  grid: Candidate<P>[],
  ex: ExecModel,
  sizeBnb: number,
  capitalBnb: number,
  splitFrac = 0.6,
  minIsTrades = 30,
): WalkForwardResult<P> {
  const t0 = Math.min(...series.map((s) => s.candles[0]?.t ?? Infinity));
  const t1 = Math.max(...series.map((s) => s.candles.at(-1)?.t ?? -Infinity));
  const split = Math.floor(t0 + (t1 - t0) * splitFrac);

  const run = (c: Candidate<P>, from: number, to: number) =>
    series.flatMap((s) => runSeries(sliceSeries(s, from, to, strat.warmup), strat, c.params, c.exit, ex, sizeBnb).filter((t) => t.entryTime >= from));

  const ranking = grid.map((c) => {
    const tr = run(c, t0, split);
    const m = computeMetrics(tr, capitalBnb);
    return { c, m };
  });
  const eligible = ranking.filter((r) => r.m.trades >= minIsTrades).sort((a, b) => b.m.expectancyPct - a.m.expectancyPct);
  const best = eligible[0];
  if (!best) {
    return { strategy: strat.name, splitTime: split, candidatesTested: grid.length, chosen: null, inSample: null, outOfSample: null, oosTrades: [], ranking: [] };
  }
  const oos = run(best.c, split, t1 + 1);
  return {
    strategy: strat.name,
    splitTime: split,
    candidatesTested: grid.length,
    chosen: best.c,
    inSample: best.m,
    outOfSample: computeMetrics(oos, capitalBnb),
    oosTrades: oos,
    ranking: eligible.slice(0, 10).map((r) => ({ params: r.c.params, exit: r.c.exit, isExpectancyPct: r.m.expectancyPct, isTrades: r.m.trades })),
  };
}
