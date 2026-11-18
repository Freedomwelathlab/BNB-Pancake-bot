// GeckoTerminal public API: pool discovery and OHLCV history (free tier ~30 calls/min).
import type { Candle } from '../core/types.ts';
import { ADDR } from '../core/constants.ts';
import { getJson } from './http.ts';

const BASE = 'https://api.geckoterminal.com/api/v2';
const SPACING = 6_500; // free tier returned 429 at 2.2s spacing (2026-11-17)

export interface PoolInfo {
  pool: string;
  name: string;
  dex: string;
  token: string; // non-WBNB side
  tokenSymbol: string;
  feeBps: number;
  createdAt: number; // unix s
  reserveUsd: number;
  bnbPriceUsd: number; // implied from the pool
  volume24hUsd: number;
}

interface GPool {
  attributes: { address: string; name: string; pool_created_at: string; reserve_in_usd: string; base_token_price_usd: string; base_token_price_native_currency: string; quote_token_price_usd: string; quote_token_price_native_currency: string; volume_usd: { h24: string } };
  relationships: { base_token: { data: { id: string } }; quote_token: { data: { id: string } }; dex: { data: { id: string } } };
}

const strip = (id: string) => id.replace(/^bsc_/, '').toLowerCase();

export function parseFeeBps(name: string, dex: string): number {
  const m = name.match(/(\d+(?:\.\d+)?)%/);
  if (m) return Math.round(parseFloat(m[1]!) * 100);
  if (/v2/i.test(dex)) return 25;
  return 25;
}

/** Deepest PancakeSwap WBNB pool for each given token (seed universe). */
export async function poolsForTokens(tokens: string[]): Promise<PoolInfo[]> {
  const wbnb = ADDR.WBNB.toLowerCase();
  const out: PoolInfo[] = [];
  for (const t of tokens) {
    const j = await getJson<{ data: GPool[] }>(`${BASE}/networks/bsc/tokens/${t}/pools`, { minSpacingMs: SPACING });
    const pools = j.data.map((p) => toInfo(p, wbnb)).filter((p): p is PoolInfo => p !== null && /pancakeswap/i.test(p.dex));
    const best = pools.sort((a, b) => b.reserveUsd - a.reserveUsd)[0];
    if (best) out.push(best);
  }
  return out;
}

function toInfo(p: GPool, wbnb: string): PoolInfo | null {
  const base = strip(p.relationships.base_token.data.id);
  const quote = strip(p.relationships.quote_token.data.id);
  if (base !== wbnb && quote !== wbnb) return null;
  const tokenIsBase = quote === wbnb;
  const token = tokenIsBase ? base : quote;
  if (token === wbnb) return null;
  const bnbUsd = tokenIsBase ? Number(p.attributes.quote_token_price_usd) : Number(p.attributes.base_token_price_usd);
  return {
    pool: p.attributes.address.toLowerCase(),
    name: p.attributes.name,
    dex: p.relationships.dex.data.id,
    token,
    tokenSymbol: (tokenIsBase ? p.attributes.name.split(' / ')[0] : p.attributes.name.split(' / ')[1]?.split(' ')[0]) ?? '?',
    feeBps: parseFeeBps(p.attributes.name, p.relationships.dex.data.id),
    createdAt: Math.floor(Date.parse(p.attributes.pool_created_at) / 1000),
    reserveUsd: Number(p.attributes.reserve_in_usd),
    bnbPriceUsd: bnbUsd,
    volume24hUsd: Number(p.attributes.volume_usd.h24),
  };
}

/** Top WBNB-paired pools on BSC by 24h volume. NOTE: selecting by today's ranking introduces survivorship bias. */
export async function discoverWbnbPools(pages = 5): Promise<PoolInfo[]> {
  const wbnb = ADDR.WBNB.toLowerCase();
  const out: PoolInfo[] = [];
  for (let page = 1; page <= pages; page++) {
    const j = await getJson<{ data: GPool[] }>(`${BASE}/networks/bsc/pools?sort=h24_volume_usd_desc&page=${page}`, { minSpacingMs: SPACING });
    for (const p of j.data) {
      const info = toInfo(p, wbnb);
      if (info) out.push(info);
    }
  }
  return out;
}

/**
 * OHLCV of `token` priced in the pool's other token (WBNB), oldest first.
 * timeframe: minute|hour|day with aggregate (e.g. minute+5 = 5m bars).
 */
export async function fetchOhlcv(pool: string, token: string, timeframe: 'minute' | 'hour' | 'day', aggregate: number, maxBars: number, onPage?: (n: number) => void): Promise<Candle[]> {
  const rows = new Map<number, Candle>();
  let before: number | undefined;
  while (rows.size < maxBars) {
    const url = `${BASE}/networks/bsc/pools/${pool}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=1000&currency=token&token=${token}` + (before ? `&before_timestamp=${before}` : '');
    const j = await getJson<{ data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } } }>(url, { minSpacingMs: SPACING });
    const list = j.data?.attributes?.ohlcv_list ?? [];
    if (list.length === 0) break;
    for (const [t, o, h, l, c, v] of list) if (o > 0 && c > 0) rows.set(t, { t, o, h, l, c, v });
    const oldest = Math.min(...list.map((r) => r[0]));
    if (before !== undefined && oldest >= before) break;
    before = oldest;
    onPage?.(rows.size);
    if (list.length < 1000) break;
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

/** Fill missing bars (no trades) with flat candles at the previous close so bar indices map to time. */
export function fillGaps(c: Candle[], barSeconds: number): Candle[] {
  if (c.length === 0) return c;
  const out: Candle[] = [c[0]!];
  for (let i = 1; i < c.length; i++) {
    const prev = out[out.length - 1]!;
    for (let t = prev.t + barSeconds; t < c[i]!.t; t += barSeconds) out.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
    out.push(c[i]!);
  }
  return out;
}

/** Aggregate consecutive bars by `factor` (e.g. 12 x 5m -> 1h), aligned to the bar boundary. */
export function resample(c: Candle[], barSeconds: number, factor: number): Candle[] {
  const size = barSeconds * factor;
  const out: Candle[] = [];
  for (const k of c) {
    const t = Math.floor(k.t / size) * size;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, k.h);
      last.l = Math.min(last.l, k.l);
      last.c = k.c;
      last.v += k.v;
    } else out.push({ t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v });
  }
  return out;
}
