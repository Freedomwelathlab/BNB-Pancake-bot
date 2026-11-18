// Solana token safety from on-chain mint data (no third-party API needed).
// Honeypot-style traps on Solana come from token authorities and Token-2022 extensions:
// an active freeze authority can freeze your account so you cannot sell, a mint authority
// can inflate supply, and extensions can tax, hook, pause or seize transfers.
// Fails closed: if the mint cannot be read, the token is rejected.

export interface SolanaMintFacts {
  program: string; // spl-token | spl-token-2022
  decimals: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  transferFeeBps: number; // 0 when none
  extensions: string[]; // only extensions that are armed (see armedExtension)
}

export interface SolanaVerdict {
  pass: boolean;
  rejects: string[];
}

// Extensions that let the issuer block, pause, seize or run code on every transfer. They only
// count when actually armed: Token-2022 mints often carry the slot with a null program/delegate.
function armedExtension(e: any): string | null {
  const s = e.state ?? {};
  switch (e.extension) {
    case 'transferHook':
      return s.programId ? 'transferHook' : null;
    case 'permanentDelegate':
      return s.delegate ? 'permanentDelegate' : null;
    case 'pausableConfig':
      return s.authority || s.paused ? 'pausableConfig' : null;
    case 'nonTransferable':
      return 'nonTransferable';
    case 'defaultAccountState':
      return s.accountState === 'frozen' ? 'defaultFrozen' : null;
    default:
      return null;
  }
}

/**
 * Established Solana tokens whose issuer or bridge legitimately keeps a mint (and for cbBTC a
 * freeze) authority. Mint addresses are the canonical ones; anything else with the same symbol
 * is still screened normally. Dangerous extensions are never exempt.
 */
export const SOL_BLUE_CHIPS: Record<string, string> = {
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': 'WETH (Wormhole)',
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh': 'WBTC (Wormhole)',
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: 'cbBTC',
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 'JUP',
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: 'JTO',
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: 'PYTH',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 'BONK',
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: 'WIF',
  orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE: 'ORCA',
};

/** Parse the `jsonParsed` account data returned by getAccountInfo for a mint. */
export function parseMint(value: any): SolanaMintFacts | null {
  const parsed = value?.data?.parsed;
  if (!parsed || parsed.type !== 'mint') return null;
  const info = parsed.info ?? {};
  const exts: any[] = info.extensions ?? [];
  let transferFeeBps = 0;
  const names: string[] = [];
  for (const e of exts) {
    const armed = armedExtension(e);
    if (armed) names.push(armed);
    if (e.extension === 'transferFeeConfig') {
      const s = e.state ?? {};
      transferFeeBps = Math.max(Number(s.newerTransferFee?.transferFeeBasisPoints ?? 0), Number(s.olderTransferFee?.transferFeeBasisPoints ?? 0));
    }
  }
  return {
    program: value.data.program,
    decimals: Number(info.decimals),
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    transferFeeBps,
    extensions: names,
  };
}

export function scoreSolanaMint(f: SolanaMintFacts | null, maxTaxPct: number, opts: { blueChip?: boolean } = {}): SolanaVerdict {
  if (!f) return { pass: false, rejects: ['mint_unreadable'] };
  const r: string[] = [];
  if (f.freezeAuthority && !opts.blueChip) r.push('freeze_authority_active');
  if (f.mintAuthority && !opts.blueChip) r.push('mint_authority_active');
  if (f.transferFeeBps / 100 > maxTaxPct) r.push(`transfer_fee_${f.transferFeeBps / 100}pct`);
  for (const e of f.extensions) r.push(`ext_${e}`);
  return { pass: r.length === 0, rejects: r };
}

export async function fetchSolanaMint(mint: string, rpcUrl = 'https://api.mainnet-beta.solana.com'): Promise<SolanaMintFacts | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [mint, { encoding: 'jsonParsed' }] }),
        signal: AbortSignal.timeout(15_000),
      });
      if (r.status === 429) throw new Error('429');
      const j = (await r.json()) as { result?: { value: unknown } };
      return parseMint(j.result?.value);
    } catch {
      await new Promise((res) => setTimeout(res, 2_000 * 2 ** attempt));
    }
  }
  return null;
}
