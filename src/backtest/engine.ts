// Bar-by-bar backtester. Signal on bar i's CLOSE -> fill at bar i+1's OPEN.
// Costs: pool fee both legs, price impact from a constant-product reserve estimate,
// taxes, gas, expected cost of failed transactions, and extra latency slippage.
import { buyFill, reserveFromPrice, sellProceeds } from '../core/costs.ts';
import type { Candle, Position, Trade } from '../core/types.ts';
import { evaluateExit, updateHighWater, type ExitPolicy } from '../risk/exits.ts';
import type { Strategy } from '../strategy/strategies.ts';

export interface ExecModel {
  feeBps: number;
  buyTaxBps: number;
  sellTaxBps: number;
  gasBnbPerSwap: number;
  failureProb: number; // each swap reverts with this prob; expected gas loss is charged
  latencySlippageBps: number; // adverse move between signal and inclusion, each leg
}

export interface SeriesInput {
  token: string;
  candles: Candle[];
  barSeconds: number;
  /** BNB reserve at the LAST candle; earlier reserves are estimated with k constant. */
  reserveBnbNow: number;
  feeBps?: number; // per-pool swap fee; overrides ExecModel.feeBps
}

export function runSeries<P>(s: SeriesInput, strat: Strategy<P>, params: P, exitP: ExitPolicy, ex: ExecModel, sizeBnb: number): Trade[] {
  const cs = s.candles;
  const n = cs.length;
  if (n < strat.warmup + 2) return [];
  const prepared = strat.prepare(cs, params);
  const lastPrice = cs[n - 1]!.c;
  const reserveAt = (price: number) => reserveFromPrice(s.reserveBnbNow, lastPrice, price);
  const trades: Trade[] = [];
  let pos: (Position & { tokens: number }) | null = null;
  const expectedFailGas = ex.failureProb * ex.gasBnbPerSwap;
  const lat = ex.latencySlippageBps / 10_000;
  const feeBps = s.feeBps ?? ex.feeBps;

  const close = (bar: Candle, fraction: number, price: number, reason: Trade['exitReason']) => {
    if (!pos) return;
    const px = price * (1 - lat);
    const tokensToSell = pos.tokens * (fraction / pos.remainingFrac);
    const proceeds = sellProceeds(px, tokensToSell, reserveAt(px), feeBps, ex.sellTaxBps) - ex.gasBnbPerSwap - expectedFailGas;
    pos.realizedBnb += proceeds;
    pos.tokens -= tokensToSell;
    pos.remainingFrac -= fraction;
    if (reason === 'take_profit') pos.stagesTaken++;
    if (pos.remainingFrac <= 1e-9) {
      const pnl = pos.realizedBnb - pos.sizeBnb;
      trades.push({
        id: `${s.token}-${pos.entryTime}`,
        token: s.token,
        strategy: strat.name,
        entryTime: pos.entryTime,
        exitTime: bar.t,
        sizeBnb: pos.sizeBnb,
        proceedsBnb: pos.realizedBnb,
        pnlBnb: pnl,
        returnPct: (pnl / pos.sizeBnb) * 100,
        exitReason: reason,
      });
      pos = null;
    }
  };

  for (let i = strat.warmup; i < n; i++) {
    const bar = cs[i]!;
    // 1) manage open position on this bar
    if (pos) {
      const d = evaluateExit(pos, bar, exitP, reserveAt(bar.c), s.barSeconds);
      if (d.action === 'exit') close(bar, d.fraction, d.price!, d.reason!);
      if (pos) {
        updateHighWater(pos, bar);
        // a stage exit may leave a runner; re-check the full stop on the same bar is not done (conservative enough: stop checked first above)
      }
    }
    // 2) entry signal on this bar's close -> fill next bar open
    if (!pos && i + 1 < n && strat.signal(prepared, i, params)) {
      const next = cs[i + 1]!;
      const mid = next.o * (1 + lat);
      const fill = buyFill(mid, sizeBnb - ex.gasBnbPerSwap - expectedFailGas, reserveAt(mid), feeBps, ex.buyTaxBps);
      if (fill.tokens > 0 && Number.isFinite(fill.price)) {
        pos = {
          id: `${s.token}-${next.t}`,
          token: s.token,
          strategy: strat.name,
          entryTime: next.t,
          entryPrice: mid, // stops/targets reference the mid at entry; costs are in tokens/proceeds
          sizeBnb,
          remainingFrac: 1,
          highWater: mid,
          realizedBnb: 0,
          stagesTaken: 0,
          entryReserveBnb: reserveAt(mid),
          tokens: fill.tokens,
        };
        // skip to the next bar; that bar is evaluated for exits in step 1 of the next iteration
      }
    }
  }
  if (pos) close(cs[n - 1]!, (pos as Position).remainingFrac, cs[n - 1]!.c, 'end_of_data');
  return trades;
}
