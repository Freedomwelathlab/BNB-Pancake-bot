// Evidence gate: live trading is refused unless a recent out-of-sample evaluation
// and the bot's own paper-trading record both clear fixed thresholds.
import { existsSync, readFileSync } from 'node:fs';
import type { Metrics } from '../backtest/metrics.ts';

export interface EvidenceThresholds {
  minOosTrades: number;
  minProfitFactor: number;
  minTStat: number;
  maxDrawdownPctOfCapital: number;
  maxRiskOfRuinPct: number;
  maxReportAgeDays: number;
  minPaperTrades: number;
}

export const DEFAULT_THRESHOLDS: EvidenceThresholds = {
  minOosTrades: 50,
  minProfitFactor: 1.3,
  minTStat: 2,
  maxDrawdownPctOfCapital: 20,
  maxRiskOfRuinPct: 1,
  maxReportAgeDays: 14,
  minPaperTrades: 30,
};

export interface EvaluationReport {
  generatedAt: string; // ISO
  strategy: string;
  params: unknown;
  exit: unknown;
  oos: Metrics;
  expectedEdgePct: number; // OOS mean return per trade BEFORE costs, used by the risk engine hurdle
  barSeconds?: number; // bar size the strategy was evaluated on (live uses the same)
  selection?: string; // how this variant was chosen (must not use OOS results)
  dataNotes: string[];
}

export interface PaperRecord {
  trades: number;
  netPnlBnb: number;
  profitFactor: number;
}

export interface GateResult {
  pass: boolean;
  reasons: string[];
  strategy?: string;
  expectedEdgePct?: number;
}

export function evaluateGate(report: EvaluationReport | null, paper: PaperRecord, th: EvidenceThresholds, now = Date.now()): GateResult {
  const r: string[] = [];
  if (!report) return { pass: false, reasons: ['no_evaluation_report'] };
  const ageDays = (now - Date.parse(report.generatedAt)) / 86_400_000;
  if (!(ageDays <= th.maxReportAgeDays)) r.push(`report_age_${ageDays.toFixed(1)}d`);
  const m = report.oos;
  if (m.trades < th.minOosTrades) r.push(`oos_trades_${m.trades}<${th.minOosTrades}`);
  if (!(m.netPnlBnb > 0)) r.push('oos_net_pnl_not_positive');
  if (!(m.expectancyPct > 0)) r.push('oos_expectancy_not_positive');
  if (!(m.profitFactor >= th.minProfitFactor)) r.push(`oos_profit_factor_${fmt(m.profitFactor)}<${th.minProfitFactor}`);
  if (!(m.tStat >= th.minTStat)) r.push(`oos_tstat_${fmt(m.tStat)}<${th.minTStat}`);
  if (m.maxDrawdownPctOfCapital > th.maxDrawdownPctOfCapital) r.push(`oos_drawdown_${fmt(m.maxDrawdownPctOfCapital)}pct`);
  if (m.riskOfRuinPct > th.maxRiskOfRuinPct) r.push(`risk_of_ruin_${fmt(m.riskOfRuinPct)}pct`);
  if (paper.trades < th.minPaperTrades) r.push(`paper_trades_${paper.trades}<${th.minPaperTrades}`);
  if (!(paper.netPnlBnb > 0)) r.push('paper_net_pnl_not_positive');
  return { pass: r.length === 0, reasons: r, strategy: report.strategy, expectedEdgePct: report.expectedEdgePct };
}

function fmt(x: number) {
  return Number.isFinite(x) ? x.toFixed(2) : String(x);
}

export function loadReport(path: string): EvaluationReport | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as EvaluationReport;
  } catch {
    return null;
  }
}
