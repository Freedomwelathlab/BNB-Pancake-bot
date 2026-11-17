// Last line of defence before any transaction is signed. Pure function.
// The bot can only: approve a router, swap BNB->token, swap token->BNB, with proceeds to itself.
// It can never transfer BNB or tokens to another address (no withdrawals).
import { decodeFunctionData, type Hex } from 'viem';
import { ABI, ADDR, ROUTER_ADDRESS_THIS, TX_ALLOWLIST } from '../core/constants.ts';

export interface TxRequest {
  to: string;
  data: Hex;
  value: bigint;
}

export interface GuardContext {
  wallet: string;
  maxValueWei: bigint; // max BNB per tx (MAX_TRADE_BNB)
  nowSec: number;
  maxDeadlineSec: number;
}

const lc = (a: string) => a.toLowerCase();

export function guardTx(tx: TxRequest, ctx: GuardContext): { ok: true } | { ok: false; reason: string } {
  const to = lc(tx.to);
  const wallet = lc(ctx.wallet);
  if (tx.value > ctx.maxValueWei) return { ok: false, reason: 'value_above_max_trade' };

  // ERC20 approve: only to an allowlisted router; any token address is acceptable as `to`.
  if (tx.data.startsWith('0x095ea7b3')) {
    if (tx.value !== 0n) return { ok: false, reason: 'approve_with_value' };
    const d = decodeFunctionData({ abi: ABI.erc20, data: tx.data });
    const spender = lc(String(d.args?.[0]));
    if (!TX_ALLOWLIST.has(spender)) return { ok: false, reason: 'approve_spender_not_allowlisted' };
    return { ok: true };
  }

  if (!TX_ALLOWLIST.has(to)) return { ok: false, reason: 'target_not_allowlisted' };

  if (to === lc(ADDR.PCS_V2_ROUTER)) {
    const d = decodeFunctionData({ abi: ABI.v2Router, data: tx.data });
    const a = d.args as readonly unknown[];
    if (d.functionName === 'swapExactETHForTokensSupportingFeeOnTransferTokens') {
      const [, path, recipient, deadline] = a as [bigint, string[], string, bigint];
      if (lc(path[0]!) !== lc(ADDR.WBNB)) return { ok: false, reason: 'buy_path_not_from_wbnb' };
      return checkRecipientDeadline(recipient, deadline, wallet, ctx);
    }
    if (d.functionName === 'swapExactTokensForETHSupportingFeeOnTransferTokens') {
      if (tx.value !== 0n) return { ok: false, reason: 'sell_with_value' };
      const [, , path, recipient, deadline] = a as [bigint, bigint, string[], string, bigint];
      if (lc(path[path.length - 1]!) !== lc(ADDR.WBNB)) return { ok: false, reason: 'sell_path_not_to_wbnb' };
      return checkRecipientDeadline(recipient, deadline, wallet, ctx);
    }
    return { ok: false, reason: `v2_function_not_allowed:${d.functionName}` };
  }

  if (to === lc(ADDR.PCS_SMART_ROUTER)) {
    const d = decodeFunctionData({ abi: ABI.smartRouter, data: tx.data });
    // Only multicall(deadline, ...) is allowed so every V3 swap carries a deadline.
    if (d.functionName === 'multicall') {
      const [deadline, calls] = d.args as [bigint, Hex[]];
      if (deadline > BigInt(ctx.nowSec + ctx.maxDeadlineSec)) return { ok: false, reason: 'deadline_too_far' };
      if (deadline < BigInt(ctx.nowSec)) return { ok: false, reason: 'deadline_in_past' };
      if (calls.length === 1) {
        // buy: BNB (msg.value) -> token, delivered to wallet
        const swap = decodeFunctionData({ abi: ABI.smartRouter, data: calls[0]! });
        if (swap.functionName !== 'exactInputSingle') return { ok: false, reason: 'multicall_functions' };
        const [prm] = swap.args as unknown as [{ tokenIn: string; recipient: string }];
        if (lc(prm.tokenIn) !== lc(ADDR.WBNB)) return { ok: false, reason: 'v3_buy_not_from_wbnb' };
        if (lc(prm.recipient) !== wallet) return { ok: false, reason: 'recipient_not_wallet' };
        return { ok: true };
      }
      if (tx.value !== 0n) return { ok: false, reason: 'sell_with_value' };
      if (calls.length !== 2) return { ok: false, reason: 'multicall_shape' };
      const swap = decodeFunctionData({ abi: ABI.smartRouter, data: calls[0]! });
      const unwrap = decodeFunctionData({ abi: ABI.smartRouter, data: calls[1]! });
      if (swap.functionName !== 'exactInputSingle' || unwrap.functionName !== 'unwrapWETH9') return { ok: false, reason: 'multicall_functions' };
      const [sp] = swap.args as unknown as [{ tokenOut: string; recipient: string }];
      if (lc(sp.tokenOut) !== lc(ADDR.WBNB)) return { ok: false, reason: 'v3_sell_not_to_wbnb' };
      if (lc(sp.recipient) !== lc(ROUTER_ADDRESS_THIS)) return { ok: false, reason: 'v3_sell_recipient' };
      const [, unwrapTo] = unwrap.args as [bigint, string];
      if (lc(unwrapTo) !== wallet) return { ok: false, reason: 'unwrap_recipient_not_wallet' };
      return { ok: true };
    }
    return { ok: false, reason: `smart_router_function_not_allowed:${d.functionName}` };
  }
  return { ok: false, reason: 'unreachable' };
}

function checkRecipientDeadline(recipient: string, deadline: bigint, wallet: string, ctx: GuardContext) {
  if (lc(recipient) !== wallet) return { ok: false as const, reason: 'recipient_not_wallet' };
  if (deadline > BigInt(ctx.nowSec + ctx.maxDeadlineSec)) return { ok: false as const, reason: 'deadline_too_far' };
  if (deadline < BigInt(ctx.nowSec)) return { ok: false as const, reason: 'deadline_in_past' };
  return { ok: true as const };
}
