// Pre-trade risk checks. Pure: takes a snapshot of state, returns allow/deny with reasons.

export interface RiskLimits {
  maxTradeBnb: number;
  maxOpenPositions: number;
  maxCapitalAtRiskBnb: number;
  dailyLossCapBnb: number;
  minWalletReserveBnb: number;
  maxPriceImpactBps: number;
  maxGasGwei: number;
  hurdleMargin: number;
  maxConsecutiveFailures: number;
}

export interface RiskState {
  killSwitch: boolean;
  paused: boolean;
  pauseReason?: string;
  walletBnb: number;
  openPositions: { token: string; sizeBnb: number }[];
  pendingTokens: string[]; // orders in flight (duplicate prevention)
  realizedPnlTodayBnb: number; // negative = loss
  unrealizedPnlBnb: number;
  consecutiveFailures: number;
  gasPriceGwei: number;
}

export interface Proposal {
  token: string;
  sizeBnb: number;
  priceImpactBps: number;
  roundTripCostPct: number; // from cost model at current liquidity
  expectedEdgePct: number; // from the evidence report (OOS expectancy per trade, before costs)
}

export interface RiskDecision {
  allow: boolean;
  sizeBnb: number;
  reasons: string[];
}

export function checkEntry(s: RiskState, p: Proposal, l: RiskLimits): RiskDecision {
  const r: string[] = [];
  if (s.killSwitch) r.push('kill_switch_on');
  if (s.paused) r.push(`paused:${s.pauseReason ?? 'unknown'}`);
  if (s.consecutiveFailures >= l.maxConsecutiveFailures) r.push('too_many_consecutive_failures');
  const dayLoss = -Math.min(0, s.realizedPnlTodayBnb + Math.min(0, s.unrealizedPnlBnb));
  if (dayLoss >= l.dailyLossCapBnb) r.push('daily_loss_cap_reached');
  if (s.openPositions.length >= l.maxOpenPositions) r.push('max_open_positions');
  const tok = p.token.toLowerCase();
  if (s.openPositions.some((o) => o.token.toLowerCase() === tok)) r.push('already_holding_token');
  if (s.pendingTokens.some((t) => t.toLowerCase() === tok)) r.push('order_in_flight_for_token');
  if (s.gasPriceGwei > l.maxGasGwei) r.push(`gas_${s.gasPriceGwei}gwei_above_cap`);
  if (p.priceImpactBps > l.maxPriceImpactBps) r.push(`price_impact_${p.priceImpactBps.toFixed(0)}bps`);

  const atRisk = s.openPositions.reduce((a, o) => a + o.sizeBnb, 0);
  const lossRoom = l.dailyLossCapBnb - dayLoss;
  let size = Math.min(p.sizeBnb, l.maxTradeBnb, l.maxCapitalAtRiskBnb - atRisk, s.walletBnb - l.minWalletReserveBnb);
  // A single trade must not be able to blow through the remaining daily loss allowance
  // under a full stop-out plus costs. Approximated as 100% loss of the costs + stop distance budget handled by caller;
  // here we cap size so that even a 25% adverse move fits in the remaining allowance.
  size = Math.min(size, lossRoom / 0.25);
  if (size <= 0) r.push('no_capital_available');
  else if (size < p.sizeBnb * 0.5) r.push('size_reduced_below_half_of_requested');

  if (!(p.expectedEdgePct > p.roundTripCostPct * l.hurdleMargin)) {
    r.push(`edge_${(p.expectedEdgePct * 100).toFixed(2)}pct_below_hurdle_${(p.roundTripCostPct * l.hurdleMargin * 100).toFixed(2)}pct`);
  }
  return { allow: r.length === 0, sizeBnb: Math.max(0, size), reasons: r };
}

/** Faults that should pause new entries (exits still run). */
export function shouldPause(s: { rpcHealthy: boolean; consecutiveFailures: number; dataStaleSeconds: number }, l: RiskLimits & { maxDataStaleSeconds: number }): string | null {
  if (!s.rpcHealthy) return 'rpc_unhealthy';
  if (s.consecutiveFailures >= l.maxConsecutiveFailures) return 'repeated_tx_failures';
  if (s.dataStaleSeconds > l.maxDataStaleSeconds) return 'market_data_stale';
  return null;
}
