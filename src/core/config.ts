// Configuration from environment, validated with zod. Fails closed: anything
// malformed stops the process instead of falling back to a risky default.
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';

export const LIVE_CONFIRM_PHRASE = 'I ACCEPT THAT I CAN LOSE ALL FUNDS IN THIS HOT WALLET';

const csv = z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const num = (def: number) => z.coerce.number().finite().default(def);

const schema = z.object({
  MODE: z.enum(['paper', 'live']).default('paper'),
  LIVE_TRADING_ENABLED: bool.default('false'),
  LIVE_CONFIRM: z.string().default(''),
  PRIVATE_KEY_FILE: z.string().default('/run/secrets/hot_wallet_key'),

  RPC_HTTP_URLS: csv.default('https://bsc-dataseed.bnbchain.org,https://bsc-rpc.publicnode.com'),
  RPC_WS_URLS: csv.default('wss://bsc-rpc.publicnode.com'),
  LOG_RPC_URL: z.string().default('https://bsc-rpc.publicnode.com'), // must support eth_getLogs

  STRATEGIES: csv.default('pullback'),
  WATCH_FOUR_MEME: bool.default('true'), // record launches/graduations (research only, never auto-trades the curve)

  // Position and capital limits (BNB)
  MAX_TRADE_BNB: num(0.02),
  MAX_OPEN_POSITIONS: num(2),
  MAX_CAPITAL_AT_RISK_BNB: num(0.05),
  DAILY_LOSS_CAP_BNB: num(0.01),
  MIN_WALLET_RESERVE_BNB: num(0.005), // never spend below this (gas buffer)
  PAPER_START_BNB: num(0.2),

  // Execution guards
  MAX_SLIPPAGE_BPS: num(150),
  MAX_PRICE_IMPACT_BPS: num(100),
  MAX_GAS_GWEI: num(1),
  TX_DEADLINE_SEC: num(30),
  HURDLE_MARGIN: num(1.5), // expected edge must exceed costs by this multiple
  MAX_CONSECUTIVE_FAILURES: num(3),

  // Market filters
  MIN_LIQUIDITY_USD: num(150_000),
  MIN_POOL_AGE_DAYS: num(30),
  MAX_TAX_PCT: num(0),
  MAX_TOP10_HOLDER_PCT: num(60),
  MIN_SAFETY_SCORE: num(70),
  UNIVERSE: csv.default(''), // optional fixed token list; empty = discover via GeckoTerminal

  // Exits
  HARD_STOP_PCT: num(4),
  TRAIL_ACTIVATE_PCT: num(3),
  TRAIL_PCT: num(2.5),
  TAKE_PROFIT_PCT: num(6),
  TAKE_PROFIT_FRACTION: num(0.5),
  MAX_HOLD_MINUTES: num(720),
  ILLIQUIDITY_DROP_PCT: num(40),

  // Evidence gate
  EVIDENCE_REPORT: z.string().default('./reports/latest-evaluation.json'),
  EVIDENCE_MAX_AGE_DAYS: num(14),
  MIN_PAPER_TRADES_FOR_LIVE: num(30),

  // Infra
  DB_PATH: z.string().default('./data/bot.db'),
  DASHBOARD_HOST: z.string().default('127.0.0.1'),
  DASHBOARD_PORT: num(8787),
  DASHBOARD_TOKEN: z.string().default(''),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),
  GOPLUS_APP_KEY: z.string().default(''),
  GOPLUS_APP_SECRET: z.string().default(''),
  POLL_SECONDS: num(60),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  if (c.MAX_TRADE_BNB <= 0 || c.MAX_TRADE_BNB > c.MAX_CAPITAL_AT_RISK_BNB) throw new Error('MAX_TRADE_BNB must be > 0 and <= MAX_CAPITAL_AT_RISK_BNB');
  if (c.DAILY_LOSS_CAP_BNB <= 0) throw new Error('DAILY_LOSS_CAP_BNB must be > 0');
  if (c.MAX_SLIPPAGE_BPS > 500) throw new Error('MAX_SLIPPAGE_BPS above 500 (5%) is refused');
  if (c.TX_DEADLINE_SEC > 120) throw new Error('TX_DEADLINE_SEC above 120 is refused');
  return c;
}

/** Live mode requires three independent switches. The evidence gate is checked separately at runtime. */
export function liveSwitchesOn(c: Config): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (c.MODE !== 'live') reasons.push('MODE is not "live"');
  if (!c.LIVE_TRADING_ENABLED) reasons.push('LIVE_TRADING_ENABLED is not true');
  if (c.LIVE_CONFIRM !== LIVE_CONFIRM_PHRASE) reasons.push('LIVE_CONFIRM phrase does not match');
  return { ok: reasons.length === 0, reasons };
}

/** Reads the hot-wallet key from a file (Docker secret). Never from a plain env var, never logged. */
export function readPrivateKey(path: string): `0x${string}` {
  if (!existsSync(path)) throw new Error(`Private key file not found at ${path}`);
  const k = readFileSync(path, 'utf8').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error('Private key file is not a 0x-prefixed 32-byte hex key');
  return k as `0x${string}`;
}
