// Performance metrics on a list of closed trades. All money in BNB.
import type { Trade } from '../core/types.ts';

export interface Metrics {
  trades: number;
  wins: number;
  winRatePct: number;
  netPnlBnb: number;
  grossWinBnb: number;
  grossLossBnb: number;
  profitFactor: number;
  expectancyBnb: number; // mean pnl per trade
  expectancyPct: number; // mean return per trade, %
  stdReturnPct: number;
  tStat: number; // mean / (sd / sqrt(n)); ~2 means the mean is unlikely to be zero by luck
  maxDrawdownBnb: number;
  maxDrawdownPctOfCapital: number;
  riskOfRuinPct: number;
  avgHoldMinutes: number;
  exitReasons: Record<string, number>;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap risk of ruin: resample per-trade returns with replacement, apply them at a fixed
 * fraction of current equity, and count paths whose equity falls to `ruinLevel` of the start.
 */
export function riskOfRuin(returnsPct: number[], fractionOfEquity: number, horizon = 500, paths = 4000, ruinLevel = 0.5, seed = 7): number {
  if (returnsPct.length === 0) return 100;
  const rnd = mulberry32(seed);
  let ruined = 0;
  for (let p = 0; p < paths; p++) {
    let eq = 1;
    for (let k = 0; k < horizon; k++) {
      const r = returnsPct[Math.floor(rnd() * returnsPct.length)]! / 100;
      eq *= 1 + fractionOfEquity * r;
      if (eq <= ruinLevel) {
        ruined++;
        break;
      }
    }
  }
  return (ruined / paths) * 100;
}

export function computeMetrics(trades: Trade[], capitalBnb: number): Metrics {
  const t = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const n = t.length;
  const rets = t.map((x) => x.returnPct);
  const pnl = t.map((x) => x.pnlBnb);
  const wins = pnl.filter((x) => x > 0);
  const losses = pnl.filter((x) => x <= 0);
  const gw = wins.reduce((a, b) => a + b, 0);
  const gl = -losses.reduce((a, b) => a + b, 0);
  const mean = n ? rets.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  let eq = 0;
  let peak = 0;
  let mdd = 0;
  for (const x of pnl) {
    eq += x;
    peak = Math.max(peak, eq);
    mdd = Math.max(mdd, peak - eq);
  }
  const reasons: Record<string, number> = {};
  for (const x of t) reasons[x.exitReason] = (reasons[x.exitReason] ?? 0) + 1;
  const avgSize = n ? t.reduce((a, b) => a + b.sizeBnb, 0) / n : 0;
  return {
    trades: n,
    wins: wins.length,
    winRatePct: n ? (wins.length / n) * 100 : 0,
    netPnlBnb: eq,
    grossWinBnb: gw,
    grossLossBnb: gl,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    expectancyBnb: n ? eq / n : 0,
    expectancyPct: mean,
    stdReturnPct: sd,
    tStat: sd > 0 ? mean / (sd / Math.sqrt(n)) : 0,
    maxDrawdownBnb: mdd,
    maxDrawdownPctOfCapital: capitalBnb > 0 ? (mdd / capitalBnb) * 100 : 0,
    riskOfRuinPct: riskOfRuin(rets, capitalBnb > 0 ? Math.min(1, avgSize / capitalBnb) : 0.1),
    avgHoldMinutes: n ? t.reduce((a, b) => a + (b.exitTime - b.entryTime) / 60, 0) / n : 0,
    exitReasons: reasons,
  };
}
