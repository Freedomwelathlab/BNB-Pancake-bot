// Orchestrator. Deterministic rules only: no AI/LLM calls anywhere in the execution path.
import { existsSync, readFileSync } from 'node:fs';
import type { Config } from './core/config.ts';
import type { Candle, MarketRef, Position } from './core/types.ts';
import { log } from './core/log.ts';
import { BLUE_CHIPS } from './core/constants.ts';
import type { Db, OpenPositionRow } from './db/db.ts';
import type { Rpc } from './chain/rpc.ts';
import { gasPriceGwei, impactBps, quoteSell, tokenDecimals } from './chain/dex.ts';
import { fetchOhlcv, fillGaps } from './data/gecko.ts';
import { gatherSafetyFacts } from './safety/sources.ts';
import { DEFAULT_POLICY, scoreSafety } from './safety/scorer.ts';
import { roundTripCost } from './core/costs.ts';
import { checkEntry, type RiskLimits } from './risk/riskEngine.ts';
import { evaluateExit, updateHighWater, type ExitPolicy } from './risk/exits.ts';
import { STRATEGIES, type StrategyName } from './strategy/strategies.ts';
import type { Executor } from './exec/executor.ts';
import { evaluateGate, loadReport, DEFAULT_THRESHOLDS, type GateResult } from './gate/evidence.ts';
import { computeMetrics } from './backtest/metrics.ts';
import type { Notifier } from './notify/telegram.ts';

export interface UniverseEntry extends MarketRef {
  symbol: string;
  blueChip: boolean;
}

interface MarketState {
  m: UniverseEntry;
  candles: Candle[];
  lastFetch: number;
  safety?: { pass: boolean; at: number; reasons: string[]; score: number };
  decimals?: number;
}


export class Bot {
  readonly markets = new Map<string, MarketState>();
  gate: GateResult = { pass: false, reasons: ['not_evaluated'] };
  status = { startedAt: Date.now(), lastTickAt: 0, lastTickMs: 0, paused: false, pauseReason: '', consecutiveFailures: 0, gasGwei: 0, ticks: 0, errors: 0 };
  private ticking = false;

  constructor(
    private cfg: Config,
    private db: Db,
    private rpc: Rpc,
    private exec: Executor,
    private notify: Notifier,
    universe: UniverseEntry[],
  ) {
    for (const m of universe) this.markets.set(m.token.toLowerCase(), { m, candles: [], lastFetch: 0 });
  }

  /** Bar size: whatever the latest evaluation used (5m default), so live matches the backtest. */
  get barSeconds(): number {
    return loadReport(this.cfg.EVIDENCE_REPORT)?.barSeconds ?? 300;
  }

  get mode() {
    return this.exec.mode;
  }

  get killSwitch(): boolean {
    return this.db.getKv('kill_switch') === 'on' || existsSync('./data/KILL');
  }

  setKill(on: boolean, by: string) {
    this.db.setKv('kill_switch', on ? 'on' : 'off');
    log.warn('kill_switch', { on, by });
    this.notify.send(`Kill switch ${on ? 'ON: no new entries, closing positions' : 'OFF'} (${by})`);
  }

  get limits(): RiskLimits {
    const c = this.cfg;
    return { maxTradeBnb: c.MAX_TRADE_BNB, maxOpenPositions: c.MAX_OPEN_POSITIONS, maxCapitalAtRiskBnb: c.MAX_CAPITAL_AT_RISK_BNB, dailyLossCapBnb: c.DAILY_LOSS_CAP_BNB, minWalletReserveBnb: c.MIN_WALLET_RESERVE_BNB, maxPriceImpactBps: c.MAX_PRICE_IMPACT_BPS, maxGasGwei: c.MAX_GAS_GWEI, hurdleMargin: c.HURDLE_MARGIN, maxConsecutiveFailures: c.MAX_CONSECUTIVE_FAILURES };
  }

  get exitPolicy(): ExitPolicy {
    // Prefer the exits chosen by the latest walk-forward evaluation; fall back to config.
    const r = loadReport(this.cfg.EVIDENCE_REPORT);
    const e = r?.exit as ExitPolicy | undefined;
    if (e && typeof e.hardStopPct === 'number') return e;
    const c = this.cfg;
    return { hardStopPct: c.HARD_STOP_PCT, trailActivatePct: c.TRAIL_ACTIVATE_PCT, trailPct: c.TRAIL_PCT, takeProfitPct: c.TAKE_PROFIT_PCT, takeProfitFraction: c.TAKE_PROFIT_FRACTION, maxHoldMinutes: c.MAX_HOLD_MINUTES, illiquidityDropPct: c.ILLIQUIDITY_DROP_PCT };
  }

  private paperRecord() {
    const t = this.db.trades('paper');
    const m = computeMetrics(t, this.cfg.PAPER_START_BNB);
    return { trades: m.trades, netPnlBnb: m.netPnlBnb, profitFactor: m.profitFactor };
  }

  refreshGate() {
    this.gate = evaluateGate(loadReport(this.cfg.EVIDENCE_REPORT), this.paperRecord(), { ...DEFAULT_THRESHOLDS, maxReportAgeDays: this.cfg.EVIDENCE_MAX_AGE_DAYS, minPaperTrades: this.cfg.MIN_PAPER_TRADES_FOR_LIVE });
    return this.gate;
  }

  /** Startup recovery: reconcile DB positions and in-flight orders with chain state. */
  async recover() {
    for (const o of this.db.pendingOrders(this.mode)) {
      if (this.mode === 'live' && o.tx_hash) {
        try {
          const r = await this.rpc.http.getTransactionReceipt({ hash: o.tx_hash as `0x${string}` });
          this.db.updateOrder(o.client_id, r.status === 'success' ? 'filled_unrecorded' : 'failed', { detail: 'reconciled_on_start' });
          if (r.status === 'success') this.notify.send(`Recovery: order ${o.side} ${o.token} was filled but not recorded. Check positions manually (tx ${o.tx_hash}).`);
        } catch {
          this.db.updateOrder(o.client_id, 'unknown', { detail: 'no_receipt_on_start' });
        }
      } else this.db.updateOrder(o.client_id, 'abandoned', { detail: 'restart' });
    }
    const open = this.db.openPositions(this.mode);
    log.info('recovered', { openPositions: open.length });
    if (open.length) this.notify.send(`Restarted in ${this.mode} mode with ${open.length} open position(s).`);
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    const t0 = Date.now();
    try {
      this.status.gasGwei = await gasPriceGwei(this.rpc.http).catch(() => this.status.gasGwei);
      const fault = !this.rpc.health.healthy ? 'rpc_unhealthy' : this.status.consecutiveFailures >= this.cfg.MAX_CONSECUTIVE_FAILURES ? 'repeated_tx_failures' : '';
      if (fault && !this.status.paused) this.notify.send(`Paused new entries: ${fault}`);
      this.status.paused = Boolean(fault);
      this.status.pauseReason = fault;
      if (this.mode === 'live') {
        this.refreshGate();
        if (!this.gate.pass && !this.status.paused) {
          this.status.paused = true;
          this.status.pauseReason = `evidence_gate:${this.gate.reasons.slice(0, 3).join('|')}`;
        }
      }

      // Exits first (they always run, even when paused or killed).
      await this.manageExits();
      if (!this.killSwitch && !this.status.paused) await this.scanEntries();
      const wallet = await this.exec.walletBnb();
      this.db.recordEquity(this.mode, wallet, await this.openValueBnb());
      this.status.ticks++;
    } catch (e) {
      this.status.errors++;
      log.error('tick_failed', { err: String(e).slice(0, 400) });
    } finally {
      this.status.lastTickAt = Date.now();
      this.status.lastTickMs = Date.now() - t0;
      this.ticking = false;
    }
  }

  private async refreshCandles(s: MarketState) {
    const now = Date.now() / 1000;
    const BAR = this.barSeconds;
    const lastClosed = Math.floor(now / BAR) * BAR - BAR;
    if (s.candles.length && s.candles.at(-1)!.t >= lastClosed) return;
    const need = s.candles.length === 0 ? 400 : 20;
    const fresh = BAR >= 3600 ? await fetchOhlcv(s.m.pool, s.m.token, 'hour', BAR / 3600, need) : await fetchOhlcv(s.m.pool, s.m.token, 'minute', BAR / 60, need);
    const merged = new Map(s.candles.map((c) => [c.t, c]));
    for (const c of fresh) merged.set(c.t, c);
    // drop the still-forming bar
    s.candles = fillGaps([...merged.values()].filter((c) => c.t <= lastClosed).sort((a, b) => a.t - b.t), BAR).slice(-600);
    s.lastFetch = Date.now();
  }

  private async safetyOk(s: MarketState): Promise<{ pass: boolean; reasons: string[]; score: number }> {
    if (s.safety && Date.now() - s.safety.at < 6 * 3600_000) return s.safety;
    const c = this.cfg;
    const facts = await gatherSafetyFacts(s.m.token, s.m.pool);
    const v = scoreSafety(facts, { ...DEFAULT_POLICY, maxTaxPct: c.MAX_TAX_PCT, minLiquidityUsd: c.MIN_LIQUIDITY_USD, minPairAgeMinutes: c.MIN_POOL_AGE_DAYS * 1440, maxTop10HolderPct: c.MAX_TOP10_HOLDER_PCT, minSafetyScore: c.MIN_SAFETY_SCORE }, { blueChip: s.m.blueChip });
    s.safety = { pass: v.pass, at: Date.now(), reasons: v.hardRejects, score: v.score };
    return s.safety;
  }

  private strategyParams(name: StrategyName): unknown {
    const r = loadReport(this.cfg.EVIDENCE_REPORT);
    if (r?.strategy === name && r.params) return r.params;
    if (name === 'pullback') return { fast: 20, slow: 50, trend: 200, rsiMax: 35, dipLookback: 6, minAtrPct: 0.002, maxAtrPct: 0.03 };
    if (name === 'breakout') return { fast: 20, slow: 50, trend: 200, lookback: 48, minAtrPct: 0.002, maxAtrPct: 0.03 };
    return { minAgeBars: 3, maxAgeBars: 48, openingRangeBars: 3, maxDrawdownFromHighPct: 25 };
  }

  private async scanEntries() {
    const names = this.cfg.STRATEGIES.filter((n): n is StrategyName => n in STRATEGIES && n !== 'postgrad');
    for (const s of this.markets.values()) {
      try {
        await this.refreshCandles(s);
        for (const name of names) {
          if (this.mode === 'live' && this.gate.strategy !== name) continue; // live only for the strategy that passed the gate
          const strat = STRATEGIES[name] as (typeof STRATEGIES)['pullback'];
          const params = this.strategyParams(name) as never;
          if (s.candles.length < strat.warmup + 2) continue;
          const prepared = strat.prepare(s.candles, params);
          const i = s.candles.length - 1;
          if (!strat.signal(prepared, i, params)) continue;
          // only act on a bar we have not acted on before (idempotent across restarts)
          const clientId = `${this.mode}:${name}:${s.m.token}:${s.candles[i]!.t}`;
          await this.tryEnter(s, name, clientId);
        }
      } catch (e) {
        log.warn('scan_failed', { token: s.m.symbol, err: String(e).slice(0, 200) });
      }
    }
  }

  private async tryEnter(s: MarketState, strategy: string, clientId: string) {
    const safety = await this.safetyOk(s);
    if (!safety.pass) {
      this.db.logDecision(s.m.token, s.m.symbol, strategy, 'reject_safety', safety.reasons);
      return;
    }
    const size = this.cfg.MAX_TRADE_BNB;
    const { bps, tokensOut } = await impactBps(this.rpc.http, s.m, size);
    const report = loadReport(this.cfg.EVIDENCE_REPORT);
    // Reserve estimate from impact: impact ~= size/(reserve+size)
    const reserveBnb = bps > 0 ? (size * 10_000) / bps - size : 1e9;
    const cost = roundTripCost({ sizeBnb: size, feeBps: s.m.feeBps, buyTaxBps: 0, sellTaxBps: 0, reserveBnb, gasBnbPerSwap: this.status.gasGwei * 1e-9 * 220_000, failureProb: 0.03 });
    const open = this.db.openPositions(this.mode);
    const pending = this.db.pendingOrders(this.mode).map((o) => o.token);
    const dayStart = Math.floor(Date.now() / 86_400_000) * 86_400;
    const decision = checkEntry(
      {
        killSwitch: this.killSwitch,
        paused: this.status.paused,
        pauseReason: this.status.pauseReason,
        walletBnb: await this.exec.walletBnb(),
        openPositions: open.map((p) => ({ token: p.token, sizeBnb: p.size_bnb * p.remaining_frac })),
        pendingTokens: pending,
        realizedPnlTodayBnb: this.db.realizedSince(this.mode, dayStart),
        unrealizedPnlBnb: (await this.openValueBnb()) - open.reduce((a, p) => a + p.size_bnb * p.remaining_frac, 0),
        consecutiveFailures: this.status.consecutiveFailures,
        gasPriceGwei: this.status.gasGwei,
      },
      // Paper mode always trades (it IS the forward test). Live requires the report's edge to clear costs x margin.
      { token: s.m.token, sizeBnb: size, priceImpactBps: bps, roundTripCostPct: cost.costPct, expectedEdgePct: this.mode === 'paper' ? Infinity : report?.strategy === strategy ? report.expectedEdgePct : 0 },
      this.limits,
    );
    if (!decision.allow) {
      this.db.logDecision(s.m.token, s.m.symbol, strategy, 'reject_risk', decision.reasons);
      return;
    }
    if (!this.db.createOrder(clientId, s.m.token, 'buy', this.mode)) return; // already acted on this bar
    const fill = await this.exec.buy(s.m, decision.sizeBnb, this.cfg.MAX_SLIPPAGE_BPS);
    if (!fill.ok) {
      this.status.consecutiveFailures++;
      this.db.updateOrder(clientId, 'failed', { detail: fill.error });
      this.notify.send(`BUY FAILED ${s.m.symbol}: ${fill.error ?? 'unknown'}`);
      return;
    }
    this.status.consecutiveFailures = 0;
    this.db.updateOrder(clientId, 'filled', { tx_hash: fill.txHash });
    s.decimals ??= await tokenDecimals(this.rpc.http, s.m.token as `0x${string}`);
    const tokensHuman = Number(fill.tokensDelta) / 10 ** s.decimals;
    const midEntry = -fill.bnbDelta / Number(fill.tokensDelta); // cost basis per raw unit (see manageExits)
    void tokensOut;
    const row: OpenPositionRow = {
      id: clientId, token: s.m.token.toLowerCase(), pool: s.m.pool, venue: s.m.venue, fee_bps: s.m.feeBps, symbol: s.m.symbol, strategy, mode: this.mode,
      entry_time: Math.floor(Date.now() / 1000), entry_price: midEntry, size_bnb: -fill.bnbDelta, tokens_raw: fill.tokensDelta.toString(),
      remaining_frac: 1, high_water: midEntry, realized_bnb: 0, stages_taken: 0, entry_reserve_bnb: reserveBnb,
    };
    this.db.insertPosition(row);
    this.db.logDecision(s.m.token, s.m.symbol, strategy, 'enter', [`size=${decision.sizeBnb}`, `impact=${bps.toFixed(1)}bps`, `cost=${(cost.costPct * 100).toFixed(2)}%`]);
    this.notify.send(`[${this.mode}] BUY ${s.m.symbol} ${(-fill.bnbDelta).toFixed(4)} BNB -> ${tokensHuman.toPrecision(6)} (${strategy})${fill.txHash ? ' tx ' + fill.txHash : ''}`);
  }

  /** Current BNB value of open positions (sell quote, after fees and impact). */
  async openValueBnb(): Promise<number> {
    let v = 0;
    for (const p of this.db.openPositions(this.mode)) {
      try {
        v += await quoteSell(this.rpc.http, { token: p.token, pool: p.pool, venue: p.venue as MarketRef['venue'], feeBps: p.fee_bps }, BigInt(p.tokens_raw));
      } catch {
        /* quote failure: value unknown, skip */
      }
    }
    return v;
  }

  private async manageExits() {
    const policy = this.exitPolicy;
    for (const p of this.db.openPositions(this.mode)) {
      const m: MarketRef = { token: p.token, pool: p.pool, venue: p.venue as MarketRef['venue'], feeBps: p.fee_bps };
      const tokens = BigInt(p.tokens_raw);
      let bnbNow: number;
      try {
        bnbNow = await quoteSell(this.rpc.http, m, tokens);
      } catch (e) {
        log.warn('exit_quote_failed', { token: p.symbol, err: String(e).slice(0, 160) });
        continue;
      }
      // Both entry_price and mark are "BNB per raw token unit, net of fees and impact" (cost basis vs
      // liquidation value). Stops therefore trigger on real net loss; slightly more conservative than the backtest.
      const price = Number(tokens) > 0 ? bnbNow / Number(tokens) : 0;
      const now = Math.floor(Date.now() / 1000);
      const BAR = this.barSeconds;
      const bar: Candle = { t: now - BAR, o: price, h: price, l: price, c: price, v: 0 };
      const pos: Position = { id: p.id, token: p.token, strategy: p.strategy, entryTime: p.entry_time, entryPrice: p.entry_price, sizeBnb: p.size_bnb, remainingFrac: p.remaining_frac, highWater: p.high_water, realizedBnb: p.realized_bnb, stagesTaken: p.stages_taken, entryReserveBnb: p.entry_reserve_bnb };
      const reserveNow = p.entry_reserve_bnb * Math.sqrt(price / p.entry_price);
      let d = evaluateExit(pos, bar, policy, reserveNow, BAR);
      if (this.killSwitch) d = { action: 'exit', fraction: p.remaining_frac, reason: 'kill_switch', price };
      if (d.action !== 'exit') {
        updateHighWater(pos, bar);
        if (pos.highWater !== p.high_water) this.db.updatePosition({ id: p.id, tokens_raw: p.tokens_raw, remaining_frac: p.remaining_frac, high_water: pos.highWater, realized_bnb: p.realized_bnb, stages_taken: p.stages_taken });
        continue;
      }
      const sellTokens = d.fraction >= p.remaining_frac - 1e-9 ? tokens : (tokens * BigInt(Math.round((d.fraction / p.remaining_frac) * 1e6))) / 1_000_000n;
      const clientId = `${this.mode}:sell:${p.id}:${p.stages_taken}:${d.reason}`;
      if (!this.db.createOrder(clientId, p.token, 'sell', this.mode)) continue;
      const fill = await this.exec.sell(m, sellTokens, this.cfg.MAX_SLIPPAGE_BPS);
      if (!fill.ok) {
        this.status.consecutiveFailures++;
        this.db.updateOrder(clientId, 'failed', { detail: fill.error });
        this.notify.send(`SELL FAILED ${p.symbol} (${d.reason}): ${fill.error ?? 'unknown'}. Will retry next tick.`);
        // allow retry with a new client id next tick
        this.db.updateOrder(clientId, 'retryable');
        this.db.db.prepare('DELETE FROM orders WHERE client_id=? AND status=?').run(clientId, 'retryable');
        continue;
      }
      this.status.consecutiveFailures = 0;
      this.db.updateOrder(clientId, 'filled', { tx_hash: fill.txHash });
      const realized = p.realized_bnb + fill.bnbDelta;
      const remaining = p.remaining_frac - d.fraction;
      const left = tokens - sellTokens;
      if (remaining <= 1e-9 || left <= 0n) {
        const pnl = realized - p.size_bnb;
        this.db.closePosition(p.id, { id: p.id, token: p.token, symbol: p.symbol, mode: this.mode, strategy: p.strategy, entryTime: p.entry_time, exitTime: now, sizeBnb: p.size_bnb, proceedsBnb: realized, pnlBnb: pnl, returnPct: (pnl / p.size_bnb) * 100, exitReason: d.reason! });
        this.notify.send(`[${this.mode}] EXIT ${p.symbol} ${d.reason}: PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(5)} BNB (${((pnl / p.size_bnb) * 100).toFixed(2)}%)`);
      } else {
        this.db.updatePosition({ id: p.id, tokens_raw: left.toString(), remaining_frac: remaining, high_water: Math.max(p.high_water, price), realized_bnb: realized, stages_taken: p.stages_taken + (d.reason === 'take_profit' ? 1 : 0) });
        this.notify.send(`[${this.mode}] PARTIAL ${p.symbol} ${d.reason}: sold ${(d.fraction * 100).toFixed(0)}% for ${fill.bnbDelta.toFixed(5)} BNB`);
      }
    }
  }
}

export function loadUniverse(cfg: Config): UniverseEntry[] {
  const path = './data/history/_universe.json';
  if (!existsSync(path)) return [];
  const u = JSON.parse(readFileSync(path, 'utf8')) as { selected: { pool: string; token: string; tokenSymbol: string; feeBps: number; dex: string }[] };
  const only = new Set(cfg.UNIVERSE.map((t) => t.toLowerCase()));
  const BLUE = new Set(Object.keys(BLUE_CHIPS));
  return u.selected
    .filter((p) => only.size === 0 || only.has(p.token.toLowerCase()))
    .map((p) => ({ token: p.token, pool: p.pool, venue: /v3/i.test(p.dex) ? ('pcs_v3' as const) : ('pcs_v2' as const), feeBps: p.feeBps, symbol: p.tokenSymbol, blueChip: BLUE.has(p.token.toLowerCase()) }));
}
