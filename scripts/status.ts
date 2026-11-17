// Prints a text summary: mode, gate, PnL, open positions, recent decisions.
import { loadConfig } from '../src/core/config.ts';
import { Db } from '../src/db/db.ts';
import { computeMetrics } from '../src/backtest/metrics.ts';
import { evaluateGate, loadReport, DEFAULT_THRESHOLDS } from '../src/gate/evidence.ts';

const cfg = loadConfig();
const db = new Db(cfg.DB_PATH);
for (const mode of ['paper', 'live']) {
  const t = db.trades(mode);
  if (t.length === 0 && db.openPositions(mode).length === 0) continue;
  const m = computeMetrics(t, cfg.PAPER_START_BNB);
  console.log(`\n== ${mode.toUpperCase()} ==`);
  console.log(`trades ${m.trades}  net ${m.netPnlBnb.toFixed(5)} BNB  win ${m.winRatePct.toFixed(1)}%  expectancy ${m.expectancyPct.toFixed(3)}%/trade  PF ${m.profitFactor.toFixed(2)}  maxDD ${m.maxDrawdownBnb.toFixed(5)} BNB  RoR ${m.riskOfRuinPct.toFixed(1)}%`);
  for (const p of db.openPositions(mode)) console.log(`  open ${p.symbol} ${p.strategy} size ${p.size_bnb.toFixed(4)} since ${new Date(p.entry_time * 1000).toISOString()}`);
}
const paper = computeMetrics(db.trades('paper'), cfg.PAPER_START_BNB);
const g = evaluateGate(loadReport(cfg.EVIDENCE_REPORT), { trades: paper.trades, netPnlBnb: paper.netPnlBnb, profitFactor: paper.profitFactor }, { ...DEFAULT_THRESHOLDS, maxReportAgeDays: cfg.EVIDENCE_MAX_AGE_DAYS, minPaperTrades: cfg.MIN_PAPER_TRADES_FOR_LIVE });
console.log(`\nEvidence gate: ${g.pass ? 'PASS' : 'NOT PASSED'}${g.reasons.length ? '\n  - ' + g.reasons.join('\n  - ') : ''}`);
console.log(`Kill switch: ${db.getKv('kill_switch') ?? 'off'}`);
const dec = db.db.prepare('SELECT ts, symbol, strategy, action, reasons FROM decisions ORDER BY ts DESC LIMIT 10').all() as { ts: number; symbol: string; strategy: string; action: string; reasons: string }[];
if (dec.length) console.log('\nRecent decisions:\n' + dec.map((d) => `  ${new Date(d.ts).toISOString()} ${d.symbol} ${d.strategy} ${d.action} ${d.reasons}`).join('\n'));
const l = db.db.prepare('SELECT COUNT(*) n FROM launches').get() as { n: number };
const gr = db.db.prepare('SELECT COUNT(*) n FROM graduations').get() as { n: number };
console.log(`\nResearch: ${l.n} Four.meme launches recorded, ${gr.n} graduations.`);
