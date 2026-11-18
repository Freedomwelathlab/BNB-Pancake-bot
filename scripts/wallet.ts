// Dedicated hot wallet for the bot. The private key goes straight to a file and is
// never printed. Usage:
//   npm run wallet -- new        create a new wallet (refuses to overwrite an existing key)
//   npm run wallet -- address    show the wallet address
//   npm run wallet -- balance    show the wallet's BNB balance
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, formatEther } from 'viem';
import { bsc } from 'viem/chains';
import { readPrivateKey } from '../src/core/config.ts';
import { upsertEnv } from './lib/terminal.ts';

const KEY_PATH = './secrets/hot_wallet_key';
const cmd = process.argv[2] ?? 'address';

function restrictToCurrentUser(path: string) {
  try {
    chmodSync(path, 0o600);
    if (process.platform === 'win32') {
      // Remove inherited access so only this Windows user can read the key file.
      execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], { stdio: 'ignore' });
    }
  } catch {
    console.warn('Could not tighten file permissions; make sure only you can read', path);
  }
}

if (cmd === 'new') {
  if (existsSync(KEY_PATH) && readFileSafe(KEY_PATH)) {
    console.error(`A key already exists at ${KEY_PATH}. Refusing to overwrite it (that would lose the wallet).`);
    process.exit(1);
  }
  mkdirSync('./secrets', { recursive: true });
  const key = generatePrivateKey();
  writeFileSync(KEY_PATH, key + '\n', { mode: 0o600 });
  restrictToCurrentUser(KEY_PATH);
  const address = privateKeyToAccount(key).address;
  upsertEnv({ PRIVATE_KEY_FILE: KEY_PATH, HOT_WALLET_ADDRESS: address });
  console.log(`
New bot wallet created.
  Address: ${address}
  Key file: ${KEY_PATH} (not shown here, not in git)

Next steps:
  1. Back up the key file somewhere offline (USB or password manager). If this
     laptop dies without a backup, anything in the wallet is lost.
  2. Do NOT fund it yet. Live trading is locked until the evidence gate passes
     (npm run status). When it does, send only what you can afford to lose from
     your PancakeSwap wallet to the address above, on BNB Smart Chain (BEP-20).
  3. To view it in MetaMask or Trust Wallet: Import account > Private key, and
     paste the contents of the key file yourself. Never paste it into a chat.
`);
} else if (cmd === 'address' || cmd === 'balance') {
  const path = process.env.PRIVATE_KEY_FILE && existsSync(process.env.PRIVATE_KEY_FILE) ? process.env.PRIVATE_KEY_FILE : KEY_PATH;
  const address = privateKeyToAccount(readPrivateKey(path)).address;
  console.log(`Address: ${address}`);
  if (cmd === 'balance') {
    const client = createPublicClient({ chain: bsc, transport: http('https://bsc-dataseed.bnbchain.org') });
    console.log(`Balance: ${formatEther(await client.getBalance({ address }))} BNB`);
  }
} else {
  console.error('Usage: npm run wallet -- new | address | balance');
  process.exit(1);
}

function readFileSafe(p: string) {
  try {
    return readPrivateKey(p);
  } catch {
    return null;
  }
}
