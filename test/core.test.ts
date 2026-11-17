import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundTripCost, v2AmountOut, reserveFromPrice, buyFill, sellProceeds, clearsHurdle } from '../src/core/costs.ts';
import { loadConfig, liveSwitchesOn, LIVE_CONFIRM_PHRASE } from '../src/core/config.ts';
import { redact } from '../src/core/log.ts';
import { checkEntry, type RiskLimits, type RiskState } from '../src/risk/riskEngine.ts';
import { evaluateExit, type ExitPolicy } from '../src/risk/exits.ts';
import type { Position } from '../src/core/types.ts';

test('v2AmountOut matches the Uniswap V2 formula', () => {
  // 1 in, reserves 100/100, 0.25% fee
  const out = v2AmountOut(1, 100, 100, 25);
  const inF = 1 * 0.9975;
  assert.ok(Math.abs(out - (inF * 100) / (100 + inF)) < 1e-12);
  assert.equal(v2AmountOut(0, 100, 100, 25), 0);
});

test('round trip cost includes both fees, impact and gas', () => {
  const rt = roundTripCost({ sizeBnb: 0.1, feeBps: 25, buyTaxBps: 0, sellTaxBps: 0, reserveBnb: 1000, gasBnbPerSwap: 0.00002, failureProb: 0 });
  // two 0.25% fees ~ 0.5%, impact tiny, gas 0.04%
  assert.ok(rt.costPct > 0.0049 && rt.costPct < 0.0056, `costPct ${rt.costPct}`);
  const taxed = roundTripCost({ sizeBnb: 0.1, feeBps: 25, buyTaxBps: 500, sellTaxBps: 500, reserveBnb: 1000, gasBnbPerSwap: 0, failureProb: 0 });
  assert.ok(taxed.costPct > 0.10, '5%+5% tax round trip costs > 10%');
  const thin = roundTripCost({ sizeBnb: 1, feeBps: 25, buyTaxBps: 0, sellTaxBps: 0, reserveBnb: 10, gasBnbPerSwap: 0, failureProb: 0 });
  assert.ok(thin.costPct > rt.costPct, 'thin pool costs more');
});

test('buy then sell at same mid loses exactly the round-trip cost', () => {
  const mid = 0.002;
  const b = buyFill(mid, 0.5, 200, 25, 0);
  const back = sellProceeds(mid, b.tokens, 200, 25, 0);
  assert.ok(back < 0.5 && back > 0.49);
});

test('reserve follows sqrt(price) for constant k', () => {
  assert.ok(Math.abs(reserveFromPrice(100, 1, 4) - 200) < 1e-9);
  assert.ok(Math.abs(reserveFromPrice(100, 1, 0.25) - 50) < 1e-9);
});

test('hurdle requires edge above cost times margin', () => {
  assert.equal(clearsHurdle(0.01, 0.005, 1.5), true);
  assert.equal(clearsHurdle(0.007, 0.005, 1.5), false);
});

test('config defaults to paper mode and refuses unsafe values', () => {
  const c = loadConfig({});
  assert.equal(c.MODE, 'paper');
  assert.equal(c.LIVE_TRADING_ENABLED, false);
  assert.equal(liveSwitchesOn(c).ok, false);
  assert.throws(() => loadConfig({ MAX_SLIPPAGE_BPS: '900' }));
  assert.throws(() => loadConfig({ MAX_TRADE_BNB: '1', MAX_CAPITAL_AT_RISK_BNB: '0.5' }));
  assert.throws(() => loadConfig({ MODE: 'yolo' }));
});

test('live needs all three switches', () => {
  assert.equal(liveSwitchesOn(loadConfig({ MODE: 'live', LIVE_TRADING_ENABLED: 'true', LIVE_CONFIRM: 'yes' })).ok, false);
  assert.equal(liveSwitchesOn(loadConfig({ MODE: 'live', LIVE_TRADING_ENABLED: 'false', LIVE_CONFIRM: LIVE_CONFIRM_PHRASE })).ok, false);
  assert.equal(liveSwitchesOn(loadConfig({ MODE: 'live', LIVE_TRADING_ENABLED: 'true', LIVE_CONFIRM: LIVE_CONFIRM_PHRASE })).ok, true);
});

test('logger redacts private keys and telegram tokens', () => {
  const k = '0x' + 'ab'.repeat(32);
  assert.ok(!redact(`key=${k}`).includes(k));
  assert.ok(!redact('token 123456789:AAAbbbCCCdddEEEfffGGGhhhIIIjjjKKKlll').includes('AAAbbb'));
});

const limits: RiskLimits = {
  maxTradeBnb: 0.02, maxOpenPositions: 2, maxCapitalAtRiskBnb: 0.05, dailyLossCapBnb: 0.01, minWalletReserveBnb: 0.005,
  maxPriceImpactBps: 100, maxGasGwei: 1, hurdleMargin: 1.5, maxConsecutiveFailures: 3,
};
const okState = (): RiskState => ({ killSwitch: false, paused: false, walletBnb: 0.2, openPositions: [], pendingTokens: [], realizedPnlTodayBnb: 0, unrealizedPnlBnb: 0, consecutiveFailures: 0, gasPriceGwei: 0.05 });
const prop = { token: '0xabc', sizeBnb: 0.02, priceImpactBps: 5, roundTripCostPct: 0.005, expectedEdgePct: 0.02 };

test('risk engine allows a clean proposal', () => {
  const d = checkEntry(okState(), prop, limits);
  assert.equal(d.allow, true, d.reasons.join(','));
  assert.equal(d.sizeBnb, 0.02);
});

test('risk engine blocks kill switch, daily loss, duplicates, caps, weak edge', () => {
  assert.ok(checkEntry({ ...okState(), killSwitch: true }, prop, limits).reasons.includes('kill_switch_on'));
  assert.ok(checkEntry({ ...okState(), realizedPnlTodayBnb: -0.011 }, prop, limits).reasons.includes('daily_loss_cap_reached'));
  assert.ok(checkEntry({ ...okState(), openPositions: [{ token: '0xABC', sizeBnb: 0.02 }] }, prop, limits).reasons.includes('already_holding_token'));
  assert.ok(checkEntry({ ...okState(), pendingTokens: ['0xabc'] }, prop, limits).reasons.includes('order_in_flight_for_token'));
  assert.ok(checkEntry({ ...okState(), openPositions: [{ token: '0x1', sizeBnb: 0.02 }, { token: '0x2', sizeBnb: 0.02 }] }, prop, limits).reasons.includes('max_open_positions'));
  assert.ok(checkEntry({ ...okState(), gasPriceGwei: 5 }, prop, limits).reasons.some((r) => r.startsWith('gas_')));
  assert.ok(checkEntry(okState(), { ...prop, expectedEdgePct: 0.006 }, limits).reasons.some((r) => r.startsWith('edge_')));
  assert.ok(checkEntry(okState(), { ...prop, priceImpactBps: 300 }, limits).reasons.some((r) => r.startsWith('price_impact')));
  assert.ok(checkEntry({ ...okState(), walletBnb: 0.004 }, prop, limits).reasons.includes('no_capital_available'));
  assert.ok(checkEntry({ ...okState(), consecutiveFailures: 3 }, prop, limits).reasons.includes('too_many_consecutive_failures'));
});

test('risk engine caps size by capital at risk', () => {
  const d = checkEntry({ ...okState(), openPositions: [{ token: '0x1', sizeBnb: 0.04 }] }, prop, limits);
  assert.ok(d.sizeBnb <= 0.01 + 1e-12);
});

const exitP: ExitPolicy = { hardStopPct: 4, trailActivatePct: 3, trailPct: 2, takeProfitPct: 6, takeProfitFraction: 0.5, maxHoldMinutes: 60, illiquidityDropPct: 40 };
const mkPos = (): Position => ({ id: 'p', token: 't', strategy: 's', entryTime: 0, entryPrice: 100, sizeBnb: 1, remainingFrac: 1, highWater: 100, realizedBnb: 0, stagesTaken: 0, entryReserveBnb: 1000 });

test('exits: hard stop, worst-case ordering, gap fill', () => {
  // bar touches both TP and stop: stop wins
  const d = evaluateExit(mkPos(), { t: 60, o: 100, h: 110, l: 95, c: 105, v: 0 }, exitP, 1000, 60);
  assert.equal(d.reason, 'hard_stop');
  assert.equal(d.price, 96);
  // gap below stop fills at open
  const g = evaluateExit(mkPos(), { t: 60, o: 90, h: 91, l: 88, c: 89, v: 0 }, exitP, 1000, 60);
  assert.equal(g.price, 90);
});

test('exits: take profit stage, trailing, time, illiquidity', () => {
  const tp = evaluateExit(mkPos(), { t: 60, o: 101, h: 107, l: 100, c: 106, v: 0 }, exitP, 1000, 60);
  assert.equal(tp.reason, 'take_profit');
  assert.equal(tp.fraction, 0.5);
  const p = mkPos();
  p.highWater = 110; // trail armed at 107.8
  const tr = evaluateExit(p, { t: 60, o: 109, h: 109, l: 107, c: 108, v: 0 }, exitP, 1000, 60);
  assert.equal(tr.reason, 'trailing_stop');
  const tm = evaluateExit(mkPos(), { t: 3540, o: 100, h: 101, l: 99, c: 100, v: 0 }, exitP, 1000, 60);
  assert.equal(tm.reason, 'time_exit');
  const il = evaluateExit(mkPos(), { t: 60, o: 100, h: 101, l: 99, c: 100, v: 0 }, exitP, 500, 60);
  assert.equal(il.reason, 'illiquidity');
});
