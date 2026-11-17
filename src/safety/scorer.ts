// Token safety verdict. Pure function. Fails closed: a missing independent source is a reject.
import type { SafetyFacts, SafetyVerdict } from '../core/types.ts';

export interface SafetyPolicy {
  maxTaxPct: number;
  maxTop10HolderPct: number;
  maxCreatorPct: number;
  minLpLockedPct: number;
  minLiquidityUsd: number;
  minPairAgeMinutes: number;
  minSafetyScore: number;
  /** Max |buys-sells|/(buys+sells) in the last hour; wash trading tends to be either one-sided or perfectly matched. */
  maxFlowImbalance: number;
  /** Volume/liquidity per day above this suggests wash trading on a thin pool. */
  maxTurnoverPerDay: number;
}

export const DEFAULT_POLICY: SafetyPolicy = {
  maxTaxPct: 0,
  maxTop10HolderPct: 60,
  maxCreatorPct: 5,
  minLpLockedPct: 90,
  minLiquidityUsd: 150_000,
  minPairAgeMinutes: 30 * 24 * 60,
  minSafetyScore: 70,
  maxFlowImbalance: 0.8,
  maxTurnoverPerDay: 30,
};

/** Tokens whose holder/LP structure is not meaningful (wrapped majors, stables, exchange-issued). Hard checks on LP/holders are skipped for them. */
export function isBlueChip(token: string, allow: ReadonlySet<string>): boolean {
  return allow.has(token.toLowerCase());
}

export function scoreSafety(f: SafetyFacts, p: SafetyPolicy, opts: { blueChip?: boolean } = {}): SafetyVerdict {
  const hard: string[] = [];
  const warn: string[] = [];
  let score = 100;
  let sourcesOk = 0;
  const g = f.goplus;
  const h = f.honeypot;
  const m = f.market;

  // --- Independent sources must both answer ---
  if (g) sourcesOk++;
  else hard.push('goplus_unavailable');
  if (h) sourcesOk++;
  else hard.push('honeypot_sim_unavailable');
  if (!m) hard.push('market_data_unavailable');

  // --- Honeypot / sell simulation ---
  if (h) {
    if (h.isHoneypot) hard.push('honeypot_is_flagged');
    if (!h.simulationSuccess) hard.push('sell_simulation_failed');
  }
  if (g) {
    if (g.isHoneypot) hard.push('goplus_honeypot');
    if (g.cannotSellAll) hard.push('cannot_sell_all');
    if (g.cannotBuy) hard.push('cannot_buy');
  }

  // --- Taxes: worst of the two sources, and they must roughly agree ---
  const buyTax = Math.max(g?.buyTaxPct ?? 0, h?.buyTaxPct ?? 0);
  const sellTax = Math.max(g?.sellTaxPct ?? 0, h?.sellTaxPct ?? 0, h?.transferTaxPct ?? 0);
  if (buyTax > p.maxTaxPct) hard.push(`buy_tax_${buyTax.toFixed(2)}pct`);
  if (sellTax > p.maxTaxPct) hard.push(`sell_tax_${sellTax.toFixed(2)}pct`);
  if (g && h && g.sellTaxPct !== null && Math.abs(g.sellTaxPct - h.sellTaxPct) > 2) hard.push('tax_sources_disagree');
  if (g && (g.buyTaxPct === null || g.sellTaxPct === null)) hard.push('tax_unknown');

  // --- Contract permissions ---
  if (g) {
    if (!g.isOpenSource) hard.push('not_open_source');
    // Issuer-pegged majors (BTCB, ETH on BSC) are mintable by design; accepted only for the blue-chip allowlist.
    if (g.isMintable && !opts.blueChip) hard.push('mintable');
    if (g.ownerChangeBalance) hard.push('owner_can_change_balance');
    if (g.hiddenOwner) hard.push('hidden_owner');
    if (g.canTakeBackOwnership) hard.push('can_take_back_ownership');
    if (g.selfDestruct) hard.push('self_destruct');
    if (g.isBlacklisted) hard.push('blacklist_function');
    if (g.transferPausable) hard.push('transfer_pausable');
    if (g.slippageModifiable) hard.push('tax_changeable');
    if (g.personalSlippageModifiable) hard.push('per_address_tax');
    if (g.tradingCooldown) hard.push('trading_cooldown');
    if (g.isProxy && !opts.blueChip) {
      warn.push('upgradeable_proxy');
      score -= 20;
    }
    if (g.externalCall) {
      warn.push('external_call');
      score -= 10;
    }
    if (g.isWhitelisted) {
      warn.push('whitelist_function');
      score -= 10;
    }
    if (g.ownerAddress && !/^0x0{40}$/i.test(g.ownerAddress) && !/dead$/i.test(g.ownerAddress)) {
      warn.push('owner_not_renounced');
      score -= 10;
    }

    // --- Distribution and liquidity lock (skipped for blue chips) ---
    if (!opts.blueChip) {
      if (g.top10HolderPct > p.maxTop10HolderPct) hard.push(`top10_hold_${g.top10HolderPct.toFixed(0)}pct`);
      else if (g.top10HolderPct > p.maxTop10HolderPct * 0.75) {
        warn.push('concentrated_holders');
        score -= 10;
      }
      if (g.creatorPct > p.maxCreatorPct) hard.push(`creator_holds_${g.creatorPct.toFixed(1)}pct`);
      // Liquidity can't be rugged if LP is burned/locked, OR spread across many independent LPs.
      if (g.lpHolderCount === 0) {
        warn.push('lp_unknown'); // V3 positions are NFTs; GoPlus cannot see them
        score -= 20;
      } else {
        const distributed = g.lpHolderCount >= 10 && g.lpTopHolderPct <= 50;
        if (g.lpLockedOrBurnedPct < p.minLpLockedPct && !distributed) hard.push(`lp_removable_${(100 - g.lpLockedOrBurnedPct).toFixed(0)}pct`);
      }
      if (g.holderCount < 500) {
        warn.push('few_holders');
        score -= 10;
      }
    }
  }

  // --- Market quality ---
  if (m) {
    if (m.liquidityUsd < p.minLiquidityUsd) hard.push(`liquidity_${Math.round(m.liquidityUsd)}usd`);
    if (m.pairAgeMinutes < p.minPairAgeMinutes) hard.push(`pool_age_${Math.round(m.pairAgeMinutes)}min`);
    const flow = m.buys1h + m.sells1h;
    if (flow >= 20) {
      const imb = Math.abs(m.buys1h - m.sells1h) / flow;
      if (imb > p.maxFlowImbalance) {
        warn.push('one_sided_flow');
        score -= 15;
      }
    } else {
      warn.push('thin_activity');
      score -= 10;
    }
    if (m.liquidityUsd > 0 && m.volume24hUsd / m.liquidityUsd > p.maxTurnoverPerDay) hard.push('suspected_wash_trading');
  }

  score = Math.max(0, Math.min(100, score));
  if (hard.length === 0 && score < p.minSafetyScore) hard.push(`score_${score}_below_${p.minSafetyScore}`);
  return { pass: hard.length === 0, score, hardRejects: hard, warnings: warn, sourcesOk, buyTaxPct: buyTax, sellTaxPct: sellTax };
}
