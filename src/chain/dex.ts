// On-chain quotes for PancakeSwap V2 and V3 (QuoterV2). Read-only.
import { formatEther, parseEther, type PublicClient } from 'viem';
import { ABI, ADDR } from '../core/constants.ts';
import type { MarketRef } from '../core/types.ts';

export async function tokenDecimals(c: PublicClient, token: `0x${string}`): Promise<number> {
  return Number(await c.readContract({ address: token, abi: ABI.erc20, functionName: 'decimals' }));
}

/** Tokens out (raw units) for spending `bnb` BNB. */
export async function quoteBuy(c: PublicClient, m: MarketRef, bnb: number): Promise<bigint> {
  const amountIn = parseEther(bnb.toFixed(18));
  if (m.venue === 'pcs_v2') {
    const out = (await c.readContract({ address: ADDR.PCS_V2_ROUTER, abi: ABI.v2Router, functionName: 'getAmountsOut', args: [amountIn, [ADDR.WBNB, m.token as `0x${string}`]] })) as readonly bigint[];
    return out[1]!;
  }
  const { result } = await c.simulateContract({
    address: ADDR.PCS_V3_QUOTER_V2, abi: ABI.v3QuoterV2, functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: ADDR.WBNB, tokenOut: m.token as `0x${string}`, amountIn, fee: m.feeBps * 100, sqrtPriceLimitX96: 0n }],
  });
  return result[0];
}

/** BNB out (as number) for selling `tokens` raw units. */
export async function quoteSell(c: PublicClient, m: MarketRef, tokens: bigint): Promise<number> {
  if (tokens <= 0n) return 0;
  if (m.venue === 'pcs_v2') {
    const out = (await c.readContract({ address: ADDR.PCS_V2_ROUTER, abi: ABI.v2Router, functionName: 'getAmountsOut', args: [tokens, [m.token as `0x${string}`, ADDR.WBNB]] })) as readonly bigint[];
    return Number(formatEther(out[1]!));
  }
  const { result } = await c.simulateContract({
    address: ADDR.PCS_V3_QUOTER_V2, abi: ABI.v3QuoterV2, functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: m.token as `0x${string}`, tokenOut: ADDR.WBNB, amountIn: tokens, fee: m.feeBps * 100, sqrtPriceLimitX96: 0n }],
  });
  return Number(formatEther(result[0]));
}

/**
 * Price impact estimate in bps: compare the effective price of `bnb` against a tiny probe trade.
 * Includes nothing but impact (fee cancels out between the two quotes).
 */
export async function impactBps(c: PublicClient, m: MarketRef, bnb: number): Promise<{ bps: number; tokensOut: bigint }> {
  const probe = Math.max(bnb / 1000, 1e-6);
  const [small, big] = await Promise.all([quoteBuy(c, m, probe), quoteBuy(c, m, bnb)]);
  if (small === 0n || big === 0n) return { bps: 10_000, tokensOut: big };
  const pSmall = probe / Number(small);
  const pBig = bnb / Number(big);
  return { bps: Math.max(0, (pBig / pSmall - 1) * 10_000), tokensOut: big };
}

export async function gasPriceGwei(c: PublicClient): Promise<number> {
  return Number(await c.getGasPrice()) / 1e9;
}
