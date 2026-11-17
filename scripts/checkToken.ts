// Usage: npm run check-token -- 0xTokenAddress [--blue]
// Runs the same independent safety checks the bot uses and prints the verdict. Read-only.
import { gatherSafetyFacts } from '../src/safety/sources.ts';
import { scoreSafety, DEFAULT_POLICY } from '../src/safety/scorer.ts';
import { loadConfig } from '../src/core/config.ts';

const token = process.argv[2];
if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) {
  console.error('usage: npm run check-token -- 0xTokenAddress [--blue]');
  process.exit(2);
}
const cfg = loadConfig();
const facts = await gatherSafetyFacts(token.toLowerCase());
const v = scoreSafety(facts, { ...DEFAULT_POLICY, maxTaxPct: cfg.MAX_TAX_PCT, minLiquidityUsd: cfg.MIN_LIQUIDITY_USD, minPairAgeMinutes: cfg.MIN_POOL_AGE_DAYS * 1440, maxTop10HolderPct: cfg.MAX_TOP10_HOLDER_PCT, minSafetyScore: cfg.MIN_SAFETY_SCORE }, { blueChip: process.argv.includes('--blue') });
console.log(JSON.stringify({ token, verdict: v, market: facts.market, goplus: facts.goplus ? 'ok' : 'unavailable', honeypot: facts.honeypot }, null, 2));
