// Exit rules evaluated on each new candle. Pure function.
import type { Candle, ExitDecision, Position } from '../core/types.ts';

export interface ExitPolicy {
  hardStopPct: number; // e.g. 4 => exit if price <= entry * 0.96
  trailActivatePct: number; // trailing stop arms once high >= entry * (1 + x)
  trailPct: number; // exit if price <= highWater * (1 - x)
  takeProfitPct: number; // staged exit level
  takeProfitFraction: number; // fraction of original size sold at TP (0 disables)
  maxHoldMinutes: number;
  illiquidityDropPct: number; // exit if pool BNB reserve falls this much from entry
}

/**
 * Decide on a bar. Intrabar ordering is unknown from OHLC, so we assume the worst:
 * if the bar's low touches the stop, the stop fills first even if the high also reached TP.
 * `reserveBnb` is the current BNB reserve estimate (for illiquidity exits).
 */
export function evaluateExit(pos: Position, bar: Candle, p: ExitPolicy, reserveBnb: number, barSeconds: number): ExitDecision {
  const remaining = pos.remainingFrac;
  if (remaining <= 0) return { action: 'hold', fraction: 0 };

  // Illiquidity: liquidity pulled or collapsed. Exit at the close (best available reference).
  if (pos.entryReserveBnb > 0 && reserveBnb < pos.entryReserveBnb * (1 - p.illiquidityDropPct / 100)) {
    return { action: 'exit', fraction: remaining, reason: 'illiquidity', price: bar.c };
  }

  const stop = pos.entryPrice * (1 - p.hardStopPct / 100);
  const armed = pos.highWater >= pos.entryPrice * (1 + p.trailActivatePct / 100);
  const trail = armed ? pos.highWater * (1 - p.trailPct / 100) : -Infinity;
  const effectiveStop = Math.max(stop, trail);

  // Gap through the stop at the open: fill at the open, not at the stop level.
  if (bar.o <= effectiveStop) {
    return { action: 'exit', fraction: remaining, reason: trail >= stop ? 'trailing_stop' : 'hard_stop', price: bar.o };
  }
  if (bar.l <= effectiveStop) {
    return { action: 'exit', fraction: remaining, reason: trail >= stop ? 'trailing_stop' : 'hard_stop', price: effectiveStop };
  }

  // Staged take profit (one stage). Runner keeps trailing afterwards.
  const tp = pos.entryPrice * (1 + p.takeProfitPct / 100);
  if (p.takeProfitFraction > 0 && pos.stagesTaken === 0 && bar.h >= tp) {
    const frac = Math.min(p.takeProfitFraction, remaining);
    return { action: 'exit', fraction: frac, reason: 'take_profit', price: Math.max(tp, bar.o) };
  }

  // Time exit at the close of the bar that crosses the limit.
  if ((bar.t + barSeconds - pos.entryTime) / 60 >= p.maxHoldMinutes) {
    return { action: 'exit', fraction: remaining, reason: 'time_exit', price: bar.c };
  }
  return { action: 'hold', fraction: 0 };
}

/** Update high-water mark AFTER exit evaluation on the bar (prevents using the bar's high to arm a trail that then stops out on the same bar's low). */
export function updateHighWater(pos: Position, bar: Candle): void {
  if (bar.h > pos.highWater) pos.highWater = bar.h;
}
