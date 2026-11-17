// Independent safety sources: GoPlus (static analysis + holders) and Honeypot.is (buy/sell simulation).
// Each returns null on failure so the scorer fails closed.
import type { GoPlusFacts, HoneypotFacts, SafetyFacts } from '../core/types.ts';
import { getJson } from '../data/http.ts';
import { marketFacts } from '../data/dexscreener.ts';
import { log } from '../core/log.ts';

const DEAD = /^(0x0{40}|0x0{36}dead|0x000000000000000000000000000000000000dead)$/i;
const b = (v: unknown) => v === '1' || v === 1;
const pct = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v) * 100);

interface GpHolder { address: string; percent: string; is_locked?: number; is_contract?: number; tag?: string }
interface GpToken {
  is_honeypot?: string; is_open_source?: string; is_proxy?: string; is_mintable?: string; can_take_back_ownership?: string;
  owner_change_balance?: string; hidden_owner?: string; selfdestruct?: string; external_call?: string; is_blacklisted?: string;
  is_whitelisted?: string; transfer_pausable?: string; trading_cooldown?: string; slippage_modifiable?: string;
  personal_slippage_modifiable?: string; cannot_sell_all?: string; cannot_buy?: string; buy_tax?: string; sell_tax?: string;
  holder_count?: string; holders?: GpHolder[]; lp_holders?: GpHolder[]; creator_percent?: string; owner_address?: string; lp_holder_count?: string;
}

export function parseGoPlus(t: GpToken, lpPairs: Set<string>): GoPlusFacts {
  const holders = t.holders ?? [];
  // Exclude pools, burn and locked addresses from concentration.
  const top10 = holders
    .filter((h) => !DEAD.test(h.address) && !lpPairs.has(h.address.toLowerCase()) && h.is_locked !== 1)
    .slice(0, 10)
    .reduce((a, h) => a + Number(h.percent) * 100, 0);
  const lp = t.lp_holders ?? [];
  const lpSafe = lp.filter((h) => DEAD.test(h.address) || h.is_locked === 1).reduce((a, h) => a + Number(h.percent) * 100, 0);
  return {
    isHoneypot: b(t.is_honeypot),
    isOpenSource: b(t.is_open_source),
    isProxy: b(t.is_proxy),
    isMintable: b(t.is_mintable),
    canTakeBackOwnership: b(t.can_take_back_ownership),
    ownerChangeBalance: b(t.owner_change_balance),
    hiddenOwner: b(t.hidden_owner),
    selfDestruct: b(t.selfdestruct),
    externalCall: b(t.external_call),
    isBlacklisted: b(t.is_blacklisted),
    isWhitelisted: b(t.is_whitelisted),
    transferPausable: b(t.transfer_pausable),
    tradingCooldown: b(t.trading_cooldown),
    slippageModifiable: b(t.slippage_modifiable),
    personalSlippageModifiable: b(t.personal_slippage_modifiable),
    cannotSellAll: b(t.cannot_sell_all),
    cannotBuy: b(t.cannot_buy),
    buyTaxPct: pct(t.buy_tax),
    sellTaxPct: pct(t.sell_tax),
    holderCount: Number(t.holder_count ?? 0),
    top10HolderPct: top10,
    creatorPct: Number(t.creator_percent ?? 0) * 100,
    ownerAddress: t.owner_address || null,
    lpLockedOrBurnedPct: lp.length ? lpSafe : 0,
    lpHolderCount: lp.length ? Number(t.lp_holder_count ?? lp.length) : 0,
    lpTopHolderPct: lp.filter((h) => !DEAD.test(h.address) && h.is_locked !== 1).reduce((m, h) => Math.max(m, Number(h.percent) * 100), 0),
  };
}

export async function fetchGoPlus(token: string, lpPairs: Set<string> = new Set()): Promise<GoPlusFacts | null> {
  try {
    // Free tier rate-limits bursts with a non-1 "code" (HTTP 200), so retry with backoff.
    for (let attempt = 0; attempt < 4; attempt++) {
      const j = await getJson<{ code: number; message?: string; result: Record<string, GpToken> }>(`https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=${token}`, { minSpacingMs: 3_000 });
      const t = j.result?.[token.toLowerCase()];
      if (j.code === 1 && t) return parseGoPlus(t, lpPairs);
      if (j.code === 1 && !t) return null;
      await new Promise((r) => setTimeout(r, 5_000 * 2 ** attempt));
    }
    return null;
  } catch (e) {
    log.warn('goplus_failed', { token, err: String(e) });
    return null;
  }
}

interface HpResp {
  honeypotResult?: { isHoneypot: boolean };
  simulationSuccess?: boolean;
  simulationResult?: { buyTax: number; sellTax: number; transferTax: number };
  flags?: (string | { flag: string })[];
}

export async function fetchHoneypot(token: string): Promise<HoneypotFacts | null> {
  try {
    const j = await getJson<HpResp>(`https://api.honeypot.is/v2/IsHoneypot?address=${token}&chainID=56`, { minSpacingMs: 1_000 });
    if (!j.honeypotResult) return null;
    return {
      isHoneypot: j.honeypotResult.isHoneypot,
      simulationSuccess: j.simulationSuccess === true,
      buyTaxPct: j.simulationResult?.buyTax ?? 100,
      sellTaxPct: j.simulationResult?.sellTax ?? 100,
      transferTaxPct: j.simulationResult?.transferTax ?? 0,
      flags: (j.flags ?? []).map((f) => (typeof f === 'string' ? f : f.flag)),
    };
  } catch (e) {
    log.warn('honeypot_failed', { token, err: String(e) });
    return null;
  }
}

export async function gatherSafetyFacts(token: string, pool?: string): Promise<SafetyFacts & { reserveBnb: number; priceBnb: number; pair?: string }> {
  const mkt = await marketFacts(token, pool).catch(() => null);
  const lp = new Set<string>(mkt?.pair ? [mkt.pair.toLowerCase()] : []);
  if (pool) lp.add(pool.toLowerCase());
  const [goplus, honeypot] = await Promise.all([fetchGoPlus(token, lp), fetchHoneypot(token)]);
  return { token, goplus, honeypot, market: mkt, reserveBnb: mkt?.reserveBnb ?? 0, priceBnb: mkt?.priceBnb ?? 0, pair: mkt?.pair };
}
