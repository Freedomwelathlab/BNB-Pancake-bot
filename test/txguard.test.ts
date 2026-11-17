import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, parseEther, type Hex } from 'viem';
import { guardTx, type GuardContext } from '../src/exec/txGuard.ts';
import { ABI, ADDR, ROUTER_ADDRESS_THIS } from '../src/core/constants.ts';

const wallet = '0x1111111111111111111111111111111111111111';
const attacker = '0x2222222222222222222222222222222222222222';
const token = '0x3333333333333333333333333333333333333333';
const now = 1_800_000_000;
const ctx: GuardContext = { wallet, maxValueWei: parseEther('0.02'), nowSec: now, maxDeadlineSec: 60 };
const dl = BigInt(now + 30);

const v2buy = (to: string, value = parseEther('0.01'), path = [ADDR.WBNB, token]) => ({
  to: ADDR.PCS_V2_ROUTER,
  value,
  data: encodeFunctionData({ abi: ABI.v2Router, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens', args: [1n, path as `0x${string}`[], to as `0x${string}`, dl] }),
});

test('allows a V2 buy to the bot wallet', () => {
  assert.deepEqual(guardTx(v2buy(wallet), ctx), { ok: true });
});

test('refuses any swap whose proceeds go elsewhere (no withdrawals)', () => {
  assert.equal(guardTx(v2buy(attacker), ctx).ok, false);
  const sell = { to: ADDR.PCS_V2_ROUTER, value: 0n, data: encodeFunctionData({ abi: ABI.v2Router, functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens', args: [1n, 1n, [token, ADDR.WBNB], attacker, dl] }) };
  assert.equal(guardTx(sell, ctx).ok, false);
});

test('refuses oversized value, far deadlines, wrong path, non-allowlisted targets', () => {
  assert.equal(guardTx(v2buy(wallet, parseEther('1')), ctx).ok, false);
  const far = { ...v2buy(wallet), data: encodeFunctionData({ abi: ABI.v2Router, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens', args: [1n, [ADDR.WBNB, token], wallet, BigInt(now + 3600)] }) };
  assert.equal(guardTx(far, ctx).ok, false);
  assert.equal(guardTx(v2buy(wallet, parseEther('0.01'), [token, ADDR.WBNB]), ctx).ok, false);
  assert.equal(guardTx({ to: attacker, value: parseEther('0.01'), data: '0x' as Hex }, ctx).ok, false);
});

test('approve is only allowed for allowlisted routers', () => {
  const ok = { to: token, value: 0n, data: encodeFunctionData({ abi: ABI.erc20, functionName: 'approve', args: [ADDR.PCS_V2_ROUTER, 10n] }) };
  const bad = { to: token, value: 0n, data: encodeFunctionData({ abi: ABI.erc20, functionName: 'approve', args: [attacker, 10n] }) };
  assert.equal(guardTx(ok, ctx).ok, true);
  assert.equal(guardTx(bad, ctx).ok, false);
});

test('V3 sell must unwrap to the wallet and buy must carry a deadline', () => {
  const swap = encodeFunctionData({ abi: ABI.smartRouter, functionName: 'exactInputSingle', args: [{ tokenIn: token, tokenOut: ADDR.WBNB, fee: 500, recipient: ROUTER_ADDRESS_THIS, amountIn: 5n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }] });
  const unwrapOk = encodeFunctionData({ abi: ABI.smartRouter, functionName: 'unwrapWETH9', args: [1n, wallet] });
  const unwrapBad = encodeFunctionData({ abi: ABI.smartRouter, functionName: 'unwrapWETH9', args: [1n, attacker] });
  const mk = (calls: Hex[], value = 0n) => ({ to: ADDR.PCS_SMART_ROUTER, value, data: encodeFunctionData({ abi: ABI.smartRouter, functionName: 'multicall', args: [dl, calls] }) });
  assert.equal(guardTx(mk([swap, unwrapOk]), ctx).ok, true);
  assert.equal(guardTx(mk([swap, unwrapBad]), ctx).ok, false);
  const bareBuy = { to: ADDR.PCS_SMART_ROUTER, value: parseEther('0.01'), data: encodeFunctionData({ abi: ABI.smartRouter, functionName: 'exactInputSingle', args: [{ tokenIn: ADDR.WBNB, tokenOut: token, fee: 500, recipient: wallet, amountIn: 1n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }] }) };
  assert.equal(guardTx(bareBuy, ctx).ok, false, 'buy without deadline refused');
  const buyCall = encodeFunctionData({ abi: ABI.smartRouter, functionName: 'exactInputSingle', args: [{ tokenIn: ADDR.WBNB, tokenOut: token, fee: 500, recipient: wallet, amountIn: 1n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }] });
  assert.equal(guardTx(mk([buyCall], parseEther('0.01')), ctx).ok, true);
});
