// DEX Screener: discovery and market snapshot only (never a safety source on its own).
// Rate limits (docs 2026-11): token-pairs 300/min, profiles/boosts 60/min.
import type { MarketFacts } from '../core/types.ts';
import { ADDR } from '../core/constants.ts';
import { getJson } from './http.ts';

interface DsPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  labels?: string[];
  baseToken: { address: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceNative: string;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h1?: number; h24?: number };
  txns?: { h1?: { buys: number; sells: number } };
  priceChange?: { h1?: number };
  fdv?: number;
  pairCreatedAt?: number;
}

export async function tokenPairs(token: string): Promise<DsPair[]> {
  return getJson<DsPair[]>(`https://api.dexscreener.com/token-pairs/v1/bsc/${token}`, { minSpacingMs: 250 });
}

/** Market facts for the deepest WBNB pair of `token` (or a specific pool if given). */
export async function marketFacts(token: string, pool?: string): Promise<(MarketFacts & { pair: string; reserveBnb: number; priceBnb: number }) | null> {
  const pairs = (await tokenPairs(token)).filter((p) => p.chainId === 'bsc');
  const wbnb = ADDR.WBNB.toLowerCase();
  const cands = pairs.filter((p) => (pool ? p.pairAddress.toLowerCase() === pool.toLowerCase() : p.quoteToken.address.toLowerCase() === wbnb || p.baseToken.address.toLowerCase() === wbnb));
  const p = cands.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (!p) return null;
  const quoteIsWbnb = p.quoteToken.address.toLowerCase() === wbnb;
  const reserveBnb = (quoteIsWbnb ? p.liquidity?.quote : p.liquidity?.base) ?? 0;
  const priceNative = Number(p.priceNative);
  return {
    pair: p.pairAddress,
    reserveBnb,
    priceBnb: quoteIsWbnb ? priceNative : priceNative > 0 ? 1 / priceNative : 0,
    liquidityUsd: p.liquidity?.usd ?? 0,
    pairAgeMinutes: p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 60_000 : 0,
    volume1hUsd: p.volume?.h1 ?? 0,
    volume24hUsd: p.volume?.h24 ?? 0,
    buys1h: p.txns?.h1?.buys ?? 0,
    sells1h: p.txns?.h1?.sells ?? 0,
    priceChange1hPct: p.priceChange?.h1 ?? 0,
    fdvUsd: p.fdv ?? null,
  };
}
