// Execution cost model. Pure functions, no I/O.
import type { CostInputs } from './types.ts';

/**
 * Constant-product output for an exact input, Uniswap V2 style.
 * amountOut = (in * (1-fee) * rOut) / (rIn + in * (1-fee))
 */
export function v2AmountOut(amountIn: number, reserveIn: number, reserveOut: number, feeBps: number): number {
  if (amountIn <= 0 || reserveIn <= 0 || reserveOut <= 0) return 0;
  const inAfterFee = amountIn * (1 - feeBps / 10_000);
  return (inAfterFee * reserveOut) / (reserveIn + inAfterFee);
}

/** Fractional price impact of trading `sizeBnb` into a pool with `reserveBnb` on the BNB side (fee excluded). */
export function priceImpact(sizeBnb: number, reserveBnb: number): number {
  if (reserveBnb <= 0) return 1;
  return sizeBnb / (reserveBnb + sizeBnb);
}

/**
 * For a V2 pool whose LP supply is fixed (k constant), the BNB reserve tracks sqrt(price).
 * Used to estimate liquidity at later points in a backtest from price alone.
 */
export function reserveFromPrice(entryReserveBnb: number, entryPrice: number, price: number): number {
  if (entryPrice <= 0 || price <= 0) return 0;
  return entryReserveBnb * Math.sqrt(price / entryPrice);
}

export interface RoundTrip {
  buyFillPrice: number; // effective BNB per token paid
  tokensReceived: number;
  sellProceedsBnb: number; // BNB back if sold at markPrice immediately
  totalCostBnb: number; // sizeBnb - sellProceeds at unchanged mid price (+ expected failure gas)
  costPct: number; // totalCost / sizeBnb
}

/**
 * Cost of buying `sizeBnb` worth and immediately selling back at the same mid price.
 * This is the hurdle a trade's expected move must clear.
 */
export function roundTripCost(c: CostInputs, midPrice = 1): RoundTrip {

  const buyTax = c.buyTaxBps / 10_000;
  const sellTax = c.sellTaxBps / 10_000;
  const reserveTok = c.reserveBnb / midPrice;
  // buy: BNB -> token (tax taken from tokens received)
  const tokOut = v2AmountOut(c.sizeBnb, c.reserveBnb, reserveTok, c.feeBps) * (1 - buyTax);
  // Conservative: assume arbitrage restores the pool to the original mid before we sell,
  // so the sell pays its own price impact instead of "undoing" ours.
  // sell: token -> BNB (tax taken from tokens sent)
  const tokIn = tokOut * (1 - sellTax);
  const bnbOut = v2AmountOut(tokIn, reserveTok, c.reserveBnb, c.feeBps);

  const gas = 2 * c.gasBnbPerSwap;
  const failureGas = c.failureProb * 2 * c.gasBnbPerSwap; // reverted swaps still pay gas
  const total = c.sizeBnb - bnbOut + gas + failureGas;
  return {
    buyFillPrice: tokOut > 0 ? c.sizeBnb / tokOut : Infinity,
    tokensReceived: tokOut,
    sellProceedsBnb: bnbOut,
    totalCostBnb: total,
    costPct: total / c.sizeBnb,
  };
}

/** Effective fill price for a market buy of sizeBnb (BNB per token, including fee, impact and buy tax). */
export function buyFill(midPrice: number, sizeBnb: number, reserveBnb: number, feeBps: number, buyTaxBps: number): { price: number; tokens: number } {
  const reserveTok = reserveBnb / midPrice;
  const tokens = v2AmountOut(sizeBnb, reserveBnb, reserveTok, feeBps) * (1 - buyTaxBps / 10_000);
  return { price: tokens > 0 ? sizeBnb / tokens : Infinity, tokens };
}

/** BNB received for selling `tokens` at `midPrice` into a pool with `reserveBnb` (fee, impact, sell tax). */
export function sellProceeds(midPrice: number, tokens: number, reserveBnb: number, feeBps: number, sellTaxBps: number): number {
  const reserveTok = reserveBnb / midPrice;
  return v2AmountOut(tokens * (1 - sellTaxBps / 10_000), reserveTok, reserveBnb, feeBps);
}

/**
 * Trade only when expected reward clears the full cost hurdle with a margin.
 * expectedMovePct: strategy's expected favourable move (e.g. average winning move * win rate - losses), as a fraction.
 */
export function clearsHurdle(expectedNetEdgePct: number, roundTripCostPct: number, marginMultiple: number): boolean {
  return expectedNetEdgePct > roundTripCostPct * marginMultiple;
}
