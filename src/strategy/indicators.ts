// Causal indicators: value at index i uses only data[0..i].

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (i < period - 1) {
      sum += v;
      continue;
    }
    if (i === period - 1) {
      sum += v;
      prev = sum / period;
    } else prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder RSI. */
export function rsi(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  let avgG = 0;
  let avgL = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= period) {
      avgG += g / period;
      avgL += l / period;
      if (i === period) out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    } else {
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
      out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
  }
  return out;
}

/** Average true range as a fraction of close. */
export function atrPct(h: number[], l: number[], c: number[], period = 14): number[] {
  const tr: number[] = c.map((_, i) => (i === 0 ? h[0]! - l[0]! : Math.max(h[i]! - l[i]!, Math.abs(h[i]! - c[i - 1]!), Math.abs(l[i]! - c[i - 1]!))));
  const a = ema(tr, period);
  return a.map((v, i) => v / c[i]!);
}

export function highest(values: number[], end: number, lookback: number): number {
  let m = -Infinity;
  for (let i = Math.max(0, end - lookback + 1); i <= end; i++) m = Math.max(m, values[i]!);
  return m;
}
