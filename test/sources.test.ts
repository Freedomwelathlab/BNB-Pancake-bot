import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoPlus } from '../src/safety/sources.ts';
import { parseFeeBps, fillGaps } from '../src/data/gecko.ts';

test('GoPlus parser excludes LP, burn and locked holders from concentration', () => {
  const g = parseGoPlus(
    {
      is_open_source: '1', buy_tax: '0', sell_tax: '0.05', holder_count: '1200',
      holders: [
        { address: '0xpair', percent: '0.40' },
        { address: '0x000000000000000000000000000000000000dead', percent: '0.30' },
        { address: '0xaaa', percent: '0.10' },
        { address: '0xlock', percent: '0.10', is_locked: 1 },
        { address: '0xbbb', percent: '0.05' },
      ],
      lp_holders: [
        { address: '0x000000000000000000000000000000000000dead', percent: '0.95' },
        { address: '0xccc', percent: '0.05' },
      ],
      lp_holder_count: '2',
    },
    new Set(['0xpair']),
  );
  assert.ok(Math.abs(g.top10HolderPct - 15) < 1e-9, `top10 ${g.top10HolderPct}`);
  assert.ok(Math.abs(g.sellTaxPct! - 5) < 1e-9);
  assert.equal(g.buyTaxPct, 0);
  assert.ok(Math.abs(g.lpLockedOrBurnedPct - 95) < 1e-9);
  assert.equal(g.lpHolderCount, 2);
  assert.ok(Math.abs(g.lpTopHolderPct - 5) < 1e-9);
  assert.equal(g.isOpenSource, true);
  assert.equal(g.isMintable, false);
});

test('GoPlus parser marks missing tax as unknown (null) and missing LP data as 0 holders', () => {
  const g = parseGoPlus({ is_open_source: '1' }, new Set());
  assert.equal(g.buyTaxPct, null);
  assert.equal(g.lpHolderCount, 0);
});

test('fee parsing from pool names', () => {
  assert.equal(parseFeeBps('BTCB / WBNB 0.05%', 'pancakeswap-v3-bsc'), 5);
  assert.equal(parseFeeBps('ETH / WBNB 0.01%', 'pancakeswap-v3-bsc'), 1);
  assert.equal(parseFeeBps('SKYAI / WBNB', 'pancakeswap_v2'), 25);
});

test('gap filling inserts flat bars at previous close', () => {
  const out = fillGaps([{ t: 0, o: 1, h: 1, l: 1, c: 2, v: 1 }, { t: 900, o: 2, h: 3, l: 2, c: 3, v: 1 }], 300);
  assert.equal(out.length, 4);
  assert.deepEqual(out[1], { t: 300, o: 2, h: 2, l: 2, c: 2, v: 0 });
});

test('resample aggregates OHLCV on aligned boundaries', async () => {
  const { resample } = await import('../src/data/gecko.ts');
  const c = [0, 300, 600, 900].map((t, i) => ({ t: t + 3600, o: i + 1, h: i + 1.5, l: i + 0.5, c: i + 1.2, v: 1 }));
  const r = resample(c, 300, 2);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { t: 3600, o: 1, h: 2.5, l: 0.5, c: 2.2, v: 2 });
});
