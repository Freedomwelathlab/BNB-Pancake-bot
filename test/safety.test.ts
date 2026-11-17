import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSafety, DEFAULT_POLICY } from '../src/safety/scorer.ts';
import type { GoPlusFacts, HoneypotFacts, MarketFacts, SafetyFacts } from '../src/core/types.ts';

const goodGoplus = (): GoPlusFacts => ({
  isHoneypot: false, isOpenSource: true, isProxy: false, isMintable: false, canTakeBackOwnership: false, ownerChangeBalance: false,
  hiddenOwner: false, selfDestruct: false, externalCall: false, isBlacklisted: false, isWhitelisted: false, transferPausable: false,
  tradingCooldown: false, slippageModifiable: false, personalSlippageModifiable: false, cannotSellAll: false, cannotBuy: false,
  buyTaxPct: 0, sellTaxPct: 0, holderCount: 20000, top10HolderPct: 30, creatorPct: 0, ownerAddress: '0x0000000000000000000000000000000000000000', lpLockedOrBurnedPct: 99, lpHolderCount: 3, lpTopHolderPct: 1,
});
const goodHp = (): HoneypotFacts => ({ isHoneypot: false, simulationSuccess: true, buyTaxPct: 0, sellTaxPct: 0, transferTaxPct: 0, flags: [] });
const goodMkt = (): MarketFacts => ({ liquidityUsd: 2_000_000, pairAgeMinutes: 400 * 24 * 60, volume1hUsd: 50_000, volume24hUsd: 1_000_000, buys1h: 120, sells1h: 110, priceChange1hPct: 1, fdvUsd: 5e8 });
const facts = (o: Partial<SafetyFacts> = {}): SafetyFacts => ({ token: '0xt', goplus: goodGoplus(), honeypot: goodHp(), market: goodMkt(), ...o });

test('clean token passes', () => {
  const v = scoreSafety(facts(), DEFAULT_POLICY);
  assert.equal(v.pass, true, v.hardRejects.join(','));
  assert.equal(v.sourcesOk, 2);
});

test('fails closed when an independent source is missing', () => {
  assert.ok(scoreSafety(facts({ goplus: null }), DEFAULT_POLICY).hardRejects.includes('goplus_unavailable'));
  assert.ok(scoreSafety(facts({ honeypot: null }), DEFAULT_POLICY).hardRejects.includes('honeypot_sim_unavailable'));
  assert.ok(scoreSafety(facts({ market: null }), DEFAULT_POLICY).hardRejects.includes('market_data_unavailable'));
});

test('rejects honeypots, failed sell sims, and dangerous permissions', () => {
  const cases: [Partial<GoPlusFacts> | null, Partial<HoneypotFacts> | null, string][] = [
    [null, { isHoneypot: true }, 'honeypot_is_flagged'],
    [null, { simulationSuccess: false }, 'sell_simulation_failed'],
    [{ isMintable: true }, null, 'mintable'],
    [{ isBlacklisted: true }, null, 'blacklist_function'],
    [{ transferPausable: true }, null, 'transfer_pausable'],
    [{ slippageModifiable: true }, null, 'tax_changeable'],
    [{ hiddenOwner: true }, null, 'hidden_owner'],
    [{ ownerChangeBalance: true }, null, 'owner_can_change_balance'],
    [{ isOpenSource: false }, null, 'not_open_source'],
    [{ cannotSellAll: true }, null, 'cannot_sell_all'],
  ];
  for (const [g, h, reason] of cases) {
    const v = scoreSafety(facts({ goplus: { ...goodGoplus(), ...(g ?? {}) }, honeypot: { ...goodHp(), ...(h ?? {}) } }), DEFAULT_POLICY);
    assert.equal(v.pass, false, reason);
    assert.ok(v.hardRejects.includes(reason), `${reason} not in ${v.hardRejects.join(',')}`);
  }
});

test('rejects taxes, removable LP, concentration, thin or young pools, wash trading', () => {
  assert.ok(scoreSafety(facts({ honeypot: { ...goodHp(), sellTaxPct: 3 } }), DEFAULT_POLICY).hardRejects.some((r) => r.startsWith('sell_tax')));
  assert.ok(scoreSafety(facts({ goplus: { ...goodGoplus(), lpLockedOrBurnedPct: 10 } }), DEFAULT_POLICY).hardRejects.some((r) => r.startsWith('lp_removable')));
  assert.ok(scoreSafety(facts({ goplus: { ...goodGoplus(), top10HolderPct: 90 } }), DEFAULT_POLICY).hardRejects.some((r) => r.startsWith('top10')));
  assert.ok(scoreSafety(facts({ market: { ...goodMkt(), liquidityUsd: 5000 } }), DEFAULT_POLICY).hardRejects.some((r) => r.startsWith('liquidity')));
  assert.ok(scoreSafety(facts({ market: { ...goodMkt(), pairAgeMinutes: 10 } }), DEFAULT_POLICY).hardRejects.some((r) => r.startsWith('pool_age')));
  assert.ok(scoreSafety(facts({ market: { ...goodMkt(), volume24hUsd: 200_000_000 } }), DEFAULT_POLICY).hardRejects.includes('suspected_wash_trading'));
  assert.ok(scoreSafety(facts({ goplus: { ...goodGoplus(), buyTaxPct: null } }), DEFAULT_POLICY).hardRejects.includes('tax_unknown'));
});

test('blue chips skip holder/LP distribution checks only', () => {
  const g = { ...goodGoplus(), top10HolderPct: 95, lpLockedOrBurnedPct: 0 };
  assert.equal(scoreSafety(facts({ goplus: g }), DEFAULT_POLICY, { blueChip: true }).pass, true);
  assert.equal(scoreSafety(facts({ goplus: { ...g, hiddenOwner: true } }), DEFAULT_POLICY, { blueChip: true }).pass, false);
  assert.equal(scoreSafety(facts({ goplus: { ...g, isMintable: true } }), DEFAULT_POLICY, { blueChip: true }).pass, true);
  assert.equal(scoreSafety(facts({ goplus: { ...goodGoplus(), isMintable: true } }), DEFAULT_POLICY).pass, false);
});
