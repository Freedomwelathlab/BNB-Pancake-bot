import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMint, scoreSolanaMint } from '../src/safety/solana.ts';

const mint = (info: object, program = 'spl-token') => ({ data: { program, parsed: { type: 'mint', info: { decimals: 6, isInitialized: true, supply: '1', ...info } } } });

test('clean SPL mint with revoked authorities passes', () => {
  const v = scoreSolanaMint(parseMint(mint({ mintAuthority: null, freezeAuthority: null })), 5);
  assert.equal(v.pass, true);
});

test('active freeze or mint authority is rejected', () => {
  const v = scoreSolanaMint(parseMint(mint({ mintAuthority: 'Auth1', freezeAuthority: 'Auth2' })), 5);
  assert.deepEqual(v.rejects.sort(), ['freeze_authority_active', 'mint_authority_active']);
});

test('Token-2022 transfer fee above the cap and dangerous extensions are rejected', () => {
  const f = parseMint(
    mint(
      {
        mintAuthority: null,
        freezeAuthority: null,
        extensions: [
          { extension: 'transferFeeConfig', state: { newerTransferFee: { transferFeeBasisPoints: 800 }, olderTransferFee: { transferFeeBasisPoints: 0 } } },
          { extension: 'permanentDelegate', state: { delegate: 'X' } },
          { extension: 'metadataPointer', state: {} },
        ],
      },
      'spl-token-2022',
    ),
  );
  assert.equal(f?.transferFeeBps, 800);
  const v = scoreSolanaMint(f, 5);
  assert.deepEqual(v.rejects.sort(), ['ext_permanentDelegate', 'transfer_fee_8pct']);
});

test('extension slots that are not armed (null hook program / delegate) do not reject', () => {
  const f = parseMint(
    mint(
      {
        mintAuthority: null,
        freezeAuthority: null,
        extensions: [
          { extension: 'transferHook', state: { authority: null, programId: null } },
          { extension: 'permanentDelegate', state: { delegate: null } },
        ],
      },
      'spl-token-2022',
    ),
  );
  assert.deepEqual(scoreSolanaMint(f, 5).rejects, []);
});

test('blue chips may keep mint/freeze authority but never an armed hook', () => {
  const f = parseMint(mint({ mintAuthority: 'Bridge', freezeAuthority: 'Issuer' }));
  assert.equal(scoreSolanaMint(f, 5, { blueChip: true }).pass, true);
  assert.equal(scoreSolanaMint(f, 5).pass, false);
  const hooked = parseMint(mint({ mintAuthority: 'Bridge', freezeAuthority: null, extensions: [{ extension: 'transferHook', state: { programId: 'Hook111' } }] }, 'spl-token-2022'));
  assert.deepEqual(scoreSolanaMint(hooked, 5, { blueChip: true }).rejects, ['ext_transferHook']);
});

test('unreadable or non-mint accounts fail closed', () => {
  assert.equal(scoreSolanaMint(parseMint(null), 5).pass, false);
  assert.equal(scoreSolanaMint(parseMint({ data: { parsed: { type: 'account', info: {} } } }), 5).pass, false);
});
