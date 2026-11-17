// Entry signals. Each strategy sees only CLOSED candles [0..i] and decides whether
// to enter at the NEXT bar's open. No strategy may read index > i (enforced by tests).
import type { Candle } from '../core/types.ts';
import { atrPct, ema, highest, rsi } from './indicators.ts';

export interface Prepared {
  candles: Candle[];
  close: number[];
  high: number[];
  emaFast: number[];
  emaSlow: number[];
  emaTrend: number[];
  rsi: number[];
  atrPct: number[];
}

export interface Strategy<P> {
  name: string;
  warmup: number; // bars needed before signals are valid
  prepare(candles: Candle[], p: P): Prepared;
  signal(x: Prepared, i: number, p: P): boolean;
}

function prep(candles: Candle[], fast: number, slow: number, trend: number): Prepared {
  const close = candles.map((c) => c.c);
  return {
    candles,
    close,
    high: candles.map((c) => c.h),
    emaFast: ema(close, fast),
    emaSlow: ema(close, slow),
    emaTrend: ema(close, trend),
    rsi: rsi(close, 14),
    atrPct: atrPct(candles.map((c) => c.h), candles.map((c) => c.l), close, 14),
  };
}

/** Established pools: buy a pullback inside an uptrend, after a bounce confirmation candle. */
export interface PullbackParams {
  fast: number;
  slow: number;
  trend: number;
  rsiMax: number; // RSI must have dipped below this within `dipLookback` bars
  dipLookback: number;
  minAtrPct: number; // skip dead markets (move cannot beat fees)
  maxAtrPct: number; // skip chaos
}

export const pullback: Strategy<PullbackParams> = {
  name: 'pullback',
  warmup: 210,
  prepare: (c, p) => prep(c, p.fast, p.slow, p.trend),
  signal(x, i, p) {
    if (i < 1) return false;
    const c = x.candles[i]!;
    const prev = x.candles[i - 1]!;
    const f = x.emaFast[i]!;
    const s = x.emaSlow[i]!;
    const t = x.emaTrend[i]!;
    const tPrev = x.emaTrend[Math.max(0, i - 12)]!;
    if (![f, s, t, tPrev, x.atrPct[i]!].every(Number.isFinite)) return false;
    const uptrend = s > t && t > tPrev; // slow above trend, trend rising
    if (!uptrend) return false;
    const a = x.atrPct[i]!;
    if (a < p.minAtrPct || a > p.maxAtrPct) return false;
    let dipped = false;
    for (let k = Math.max(0, i - p.dipLookback); k <= i; k++) if (x.rsi[k]! < p.rsiMax) dipped = true;
    if (!dipped) return false;
    // bounce confirmation: green candle closing above prior high and back above the fast EMA
    return c.c > c.o && c.c > prev.h && c.c > f;
  },
};

/** Breakout continuation: close above the N-bar high in an uptrend with expanding range. */
export interface BreakoutParams {
  fast: number;
  slow: number;
  trend: number;
  lookback: number;
  minAtrPct: number;
  maxAtrPct: number;
}

export const breakout: Strategy<BreakoutParams> = {
  name: 'breakout',
  warmup: 210,
  prepare: (c, p) => prep(c, p.fast, p.slow, p.trend),
  signal(x, i, p) {
    if (i < p.lookback + 1) return false;
    const c = x.candles[i]!;
    const s = x.emaSlow[i]!;
    const t = x.emaTrend[i]!;
    const a = x.atrPct[i]!;
    if (![s, t, a].every(Number.isFinite)) return false;
    if (!(s > t) || a < p.minAtrPct || a > p.maxAtrPct) return false;
    const priorHigh = highest(x.high, i - 1, p.lookback);
    return c.c > priorHigh && c.c > c.o;
  },
};

/**
 * Post-graduation confirmation (Four.meme -> PancakeSwap). Never enters in the first bars;
 * requires the pool to survive `minAgeBars`, hold above its opening range and trend up.
 * Research-only until the evidence gate passes on recorded data.
 */
export interface PostGradParams {
  minAgeBars: number;
  maxAgeBars: number;
  openingRangeBars: number;
  maxDrawdownFromHighPct: number;
}

export const postGrad: Strategy<PostGradParams> = {
  name: 'postgrad',
  warmup: 0,
  prepare: (c) => prep(c, 9, 21, 50),
  signal(x, i, p) {
    if (i < p.minAgeBars || i > p.maxAgeBars) return false;
    const c = x.candles[i]!;
    let orHigh = -Infinity;
    for (let k = 0; k < Math.min(p.openingRangeBars, i); k++) orHigh = Math.max(orHigh, x.candles[k]!.h);
    const hi = highest(x.high, i, i + 1);
    const f = x.emaFast[i]!;
    const s = x.emaSlow[i]!;
    if (![f, s].every(Number.isFinite)) return false;
    const dd = (hi - c.c) / hi;
    return c.c > orHigh && f > s && c.c > f && dd * 100 < p.maxDrawdownFromHighPct;
  },
};

export const STRATEGIES = { pullback, breakout, postgrad: postGrad } as const;
export type StrategyName = keyof typeof STRATEGIES;
