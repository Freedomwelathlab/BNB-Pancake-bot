// Executors. Paper fills use real on-chain quotes plus latency slippage and gas.
// Live fills: build -> guard -> simulate -> sign -> send -> wait, with nonce management.
import { createWalletClient, encodeFunctionData, formatEther, http, maxUint256, parseEther, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { ABI, ADDR, ROUTER_ADDRESS_THIS } from '../core/constants.ts';
import type { MarketRef } from '../core/types.ts';
import { quoteBuy, quoteSell } from '../chain/dex.ts';
import { guardTx } from './txGuard.ts';
import { log } from '../core/log.ts';

export interface Fill {
  ok: boolean;
  bnbDelta: number; // BNB spent (negative) or received (positive), after gas
  tokensDelta: bigint; // tokens received (positive) or sent (negative)
  gasBnb: number;
  txHash?: string;
  error?: string;
}

export interface Executor {
  readonly mode: 'paper' | 'live';
  walletBnb(): Promise<number>;
  buy(m: MarketRef, sizeBnb: number, maxSlippageBps: number): Promise<Fill>;
  sell(m: MarketRef, tokens: bigint, maxSlippageBps: number): Promise<Fill>;
}

const GAS_SWAP = 220_000n;

export class PaperExecutor implements Executor {
  readonly mode = 'paper' as const;
  constructor(private c: PublicClient, private state: { balance: number }, private latencyBps = 5) {}
  async walletBnb() {
    return this.state.balance;
  }
  private async gasBnb() {
    return Number(formatEther((await this.c.getGasPrice()) * GAS_SWAP));
  }
  async buy(m: MarketRef, sizeBnb: number): Promise<Fill> {
    const gas = await this.gasBnb();
    const out = await quoteBuy(this.c, m, sizeBnb);
    const tokens = (out * BigInt(10_000 - this.latencyBps)) / 10_000n;
    if (this.state.balance < sizeBnb + gas) return { ok: false, bnbDelta: 0, tokensDelta: 0n, gasBnb: 0, error: 'insufficient_paper_balance' };
    this.state.balance -= sizeBnb + gas;
    return { ok: tokens > 0n, bnbDelta: -(sizeBnb + gas), tokensDelta: tokens, gasBnb: gas };
  }
  async sell(m: MarketRef, tokens: bigint): Promise<Fill> {
    const gas = await this.gasBnb();
    const bnb = (await quoteSell(this.c, m, tokens)) * (1 - this.latencyBps / 10_000);
    this.state.balance += bnb - gas;
    return { ok: true, bnbDelta: bnb - gas, tokensDelta: -tokens, gasBnb: gas };
  }
}

export class LiveExecutor implements Executor {
  readonly mode = 'live' as const;
  private wallet: WalletClient;
  private address: `0x${string}`;
  private nextNonce: number | null = null;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private c: PublicClient, privateKey: Hex, rpcUrl: string, private limits: { maxTradeBnb: number; deadlineSec: number; maxGasGwei: number }) {
    const account = privateKeyToAccount(privateKey);
    this.address = account.address;
    this.wallet = createWalletClient({ account, chain: bsc, transport: http(rpcUrl, { timeout: 15_000 }) });
  }

  get walletAddress() {
    return this.address;
  }

  async walletBnb() {
    return Number(formatEther(await this.c.getBalance({ address: this.address })));
  }

  /** Serialize sends so nonces never collide; resync nonce from chain on any error. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private async send(to: `0x${string}`, data: Hex, value: bigint): Promise<{ hash: Hex; gasBnb: number }> {
    const now = Math.floor(Date.now() / 1000);
    const g = guardTx({ to, data, value }, { wallet: this.address, maxValueWei: parseEther(this.limits.maxTradeBnb.toFixed(18)), nowSec: now, maxDeadlineSec: this.limits.deadlineSec + 5 });
    if (!g.ok) throw new Error(`tx_guard_refused:${g.reason}`);
    const gasPrice = await this.c.getGasPrice();
    if (Number(gasPrice) / 1e9 > this.limits.maxGasGwei) throw new Error('gas_above_cap');
    // Simulate first: a revert here costs nothing.
    await this.c.call({ account: this.address, to, data, value });
    const gas = ((await this.c.estimateGas({ account: this.address, to, data, value })) * 12n) / 10n;
    return this.serialize(async () => {
      if (this.nextNonce === null) this.nextNonce = await this.c.getTransactionCount({ address: this.address, blockTag: 'pending' });
      const nonce = this.nextNonce;
      try {
        const hash = await this.wallet.sendTransaction({ account: this.wallet.account!, chain: bsc, to, data, value, gas, gasPrice, nonce });
        this.nextNonce = nonce + 1;
        const rcpt = await this.c.waitForTransactionReceipt({ hash, timeout: 60_000 });
        if (rcpt.status !== 'success') throw new Error(`tx_reverted:${hash}`);
        return { hash, gasBnb: Number(formatEther(rcpt.gasUsed * rcpt.effectiveGasPrice)) };
      } catch (e) {
        this.nextNonce = null; // resync next time
        throw e;
      }
    });
  }

  private async tokenBalance(token: `0x${string}`) {
    return (await this.c.readContract({ address: token, abi: ABI.erc20, functionName: 'balanceOf', args: [this.address] })) as bigint;
  }

  async buy(m: MarketRef, sizeBnb: number, maxSlippageBps: number): Promise<Fill> {
    const token = m.token as `0x${string}`;
    const value = parseEther(sizeBnb.toFixed(18));
    try {
      const quoted = await quoteBuy(this.c, m, sizeBnb);
      const minOut = (quoted * BigInt(10_000 - maxSlippageBps)) / 10_000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + this.limits.deadlineSec);
      const before = await this.tokenBalance(token);
      let to: `0x${string}`;
      let data: Hex;
      if (m.venue === 'pcs_v2') {
        to = ADDR.PCS_V2_ROUTER;
        data = encodeFunctionData({ abi: ABI.v2Router, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens', args: [minOut, [ADDR.WBNB, token], this.address, deadline] });
      } else {
        to = ADDR.PCS_SMART_ROUTER;
        const call = encodeFunctionData({ abi: ABI.smartRouter, functionName: 'exactInputSingle', args: [{ tokenIn: ADDR.WBNB, tokenOut: token, fee: m.feeBps * 100, recipient: this.address, amountIn: value, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
        data = encodeFunctionData({ abi: ABI.smartRouter, functionName: 'multicall', args: [deadline, [call]] });
      }
      const { hash, gasBnb } = await this.send(to, data, value);
      const got = (await this.tokenBalance(token)) - before;
      return { ok: got > 0n, bnbDelta: -(sizeBnb + gasBnb), tokensDelta: got, gasBnb, txHash: hash };
    } catch (e) {
      log.error('live_buy_failed', { token, err: String(e).slice(0, 300) });
      return { ok: false, bnbDelta: 0, tokensDelta: 0n, gasBnb: 0, error: String(e).slice(0, 300) };
    }
  }

  async sell(m: MarketRef, tokens: bigint, maxSlippageBps: number): Promise<Fill> {
    const token = m.token as `0x${string}`;
    try {
      const router = m.venue === 'pcs_v2' ? ADDR.PCS_V2_ROUTER : ADDR.PCS_SMART_ROUTER;
      const allowance = (await this.c.readContract({ address: token, abi: ABI.erc20, functionName: 'allowance', args: [this.address, router] })) as bigint;
      if (allowance < tokens) {
        await this.send(token, encodeFunctionData({ abi: ABI.erc20, functionName: 'approve', args: [router, maxUint256] }), 0n);
      }
      const quotedBnb = await quoteSell(this.c, m, tokens);
      const minOut = (parseEther(quotedBnb.toFixed(18)) * BigInt(10_000 - maxSlippageBps)) / 10_000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + this.limits.deadlineSec);
      const balBefore = await this.c.getBalance({ address: this.address });
      let data: Hex;
      if (m.venue === 'pcs_v2') {
        data = encodeFunctionData({ abi: ABI.v2Router, functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens', args: [tokens, minOut, [token, ADDR.WBNB], this.address, deadline] });
      } else {
        const swap = encodeFunctionData({ abi: ABI.smartRouter, functionName: 'exactInputSingle', args: [{ tokenIn: token, tokenOut: ADDR.WBNB, fee: m.feeBps * 100, recipient: ROUTER_ADDRESS_THIS, amountIn: tokens, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
        const unwrap = encodeFunctionData({ abi: ABI.smartRouter, functionName: 'unwrapWETH9', args: [minOut, this.address] });
        data = encodeFunctionData({ abi: ABI.smartRouter, functionName: 'multicall', args: [deadline, [swap, unwrap]] });
      }
      const { hash, gasBnb } = await this.send(router, data, 0n);
      const delta = Number(formatEther((await this.c.getBalance({ address: this.address })) - balBefore));
      return { ok: true, bnbDelta: delta, tokensDelta: -tokens, gasBnb, txHash: hash };
    } catch (e) {
      log.error('live_sell_failed', { token, err: String(e).slice(0, 300) });
      return { ok: false, bnbDelta: 0, tokensDelta: 0n, gasBnb: 0, error: String(e).slice(0, 300) };
    }
  }
}
