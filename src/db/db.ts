// SQLite persistence (node:sqlite, no native build). WAL mode, single writer.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Trade } from '../core/types.ts';

export interface OpenPositionRow {
  id: string;
  token: string;
  pool: string;
  venue: string;
  fee_bps: number;
  symbol: string;
  strategy: string;
  mode: string;
  entry_time: number;
  entry_price: number;
  size_bnb: number;
  tokens_raw: string; // bigint as string
  remaining_frac: number;
  high_water: number;
  realized_bnb: number;
  stages_taken: number;
  entry_reserve_bnb: number;
}

export class Db {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY, token TEXT NOT NULL, pool TEXT NOT NULL, venue TEXT NOT NULL, fee_bps INTEGER NOT NULL, symbol TEXT,
        strategy TEXT NOT NULL, mode TEXT NOT NULL, entry_time INTEGER NOT NULL, entry_price REAL NOT NULL, size_bnb REAL NOT NULL,
        tokens_raw TEXT NOT NULL, remaining_frac REAL NOT NULL, high_water REAL NOT NULL, realized_bnb REAL NOT NULL,
        stages_taken INTEGER NOT NULL, entry_reserve_bnb REAL NOT NULL, status TEXT NOT NULL DEFAULT 'open');
      -- one open position per token per mode (duplicate prevention at the storage layer)
      CREATE UNIQUE INDEX IF NOT EXISTS ux_open_token ON positions(token, mode) WHERE status='open';
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY, token TEXT, symbol TEXT, strategy TEXT, mode TEXT, entry_time INTEGER, exit_time INTEGER,
        size_bnb REAL, proceeds_bnb REAL, pnl_bnb REAL, return_pct REAL, exit_reason TEXT);
      CREATE TABLE IF NOT EXISTS orders (
        client_id TEXT PRIMARY KEY, token TEXT NOT NULL, side TEXT NOT NULL, mode TEXT NOT NULL, created_at INTEGER NOT NULL,
        status TEXT NOT NULL, tx_hash TEXT, nonce INTEGER, detail TEXT);
      CREATE TABLE IF NOT EXISTS decisions (ts INTEGER, token TEXT, symbol TEXT, strategy TEXT, action TEXT, reasons TEXT);
      CREATE TABLE IF NOT EXISTS launches (token TEXT PRIMARY KEY, creator TEXT, name TEXT, symbol TEXT, quote TEXT, created_block INTEGER, created_at INTEGER, buys INTEGER DEFAULT 0, sells INTEGER DEFAULT 0, funds_raised REAL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS graduations (token TEXT PRIMARY KEY, pool TEXT, venue TEXT, block INTEGER, ts INTEGER, tx TEXT, from_four INTEGER);
      CREATE TABLE IF NOT EXISTS equity (ts INTEGER PRIMARY KEY, mode TEXT, wallet_bnb REAL, open_value_bnb REAL);
      CREATE INDEX IF NOT EXISTS ix_trades_exit ON trades(exit_time);
      CREATE INDEX IF NOT EXISTS ix_decisions_ts ON decisions(ts);
    `);
  }

  getKv(k: string): string | null {
    const r = this.db.prepare('SELECT v FROM kv WHERE k=?').get(k) as { v: string } | undefined;
    return r?.v ?? null;
  }
  setKv(k: string, v: string) {
    this.db.prepare('INSERT INTO kv(k,v,updated_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at').run(k, v, Date.now());
  }

  openPositions(mode: string): OpenPositionRow[] {
    return this.db.prepare("SELECT * FROM positions WHERE status='open' AND mode=?").all(mode) as unknown as OpenPositionRow[];
  }
  insertPosition(p: OpenPositionRow) {
    this.db.prepare(`INSERT INTO positions(id,token,pool,venue,fee_bps,symbol,strategy,mode,entry_time,entry_price,size_bnb,tokens_raw,remaining_frac,high_water,realized_bnb,stages_taken,entry_reserve_bnb)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.id, p.token.toLowerCase(), p.pool, p.venue, p.fee_bps, p.symbol, p.strategy, p.mode, p.entry_time, p.entry_price, p.size_bnb, p.tokens_raw, p.remaining_frac, p.high_water, p.realized_bnb, p.stages_taken, p.entry_reserve_bnb);
  }
  updatePosition(p: Pick<OpenPositionRow, 'id' | 'tokens_raw' | 'remaining_frac' | 'high_water' | 'realized_bnb' | 'stages_taken'>) {
    this.db.prepare('UPDATE positions SET tokens_raw=?, remaining_frac=?, high_water=?, realized_bnb=?, stages_taken=? WHERE id=?').run(p.tokens_raw, p.remaining_frac, p.high_water, p.realized_bnb, p.stages_taken, p.id);
  }
  closePosition(id: string, trade: Trade & { symbol: string; mode: string }) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare("UPDATE positions SET status='closed' WHERE id=?").run(id);
      this.db.prepare('INSERT OR REPLACE INTO trades VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(trade.id, trade.token, trade.symbol, trade.strategy, trade.mode, trade.entryTime, trade.exitTime, trade.sizeBnb, trade.proceedsBnb, trade.pnlBnb, trade.returnPct, trade.exitReason);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Returns false if an order with this client id already exists (idempotency / duplicate prevention). */
  createOrder(clientId: string, token: string, side: 'buy' | 'sell', mode: string): boolean {
    try {
      this.db.prepare("INSERT INTO orders(client_id,token,side,mode,created_at,status) VALUES(?,?,?,?,?,'pending')").run(clientId, token.toLowerCase(), side, mode, Date.now());
      return true;
    } catch {
      return false;
    }
  }
  updateOrder(clientId: string, status: string, fields: { tx_hash?: string; nonce?: number; detail?: string } = {}) {
    this.db.prepare('UPDATE orders SET status=?, tx_hash=COALESCE(?,tx_hash), nonce=COALESCE(?,nonce), detail=COALESCE(?,detail) WHERE client_id=?').run(status, fields.tx_hash ?? null, fields.nonce ?? null, fields.detail ?? null, clientId);
  }
  pendingOrders(mode: string): { client_id: string; token: string; side: string; tx_hash: string | null; created_at: number }[] {
    return this.db.prepare("SELECT client_id, token, side, tx_hash, created_at FROM orders WHERE status IN ('pending','sent') AND mode=?").all(mode) as never;
  }

  logDecision(token: string, symbol: string, strategy: string, action: string, reasons: string[]) {
    this.db.prepare('INSERT INTO decisions VALUES(?,?,?,?,?,?)').run(Date.now(), token, symbol, strategy, action, reasons.join(','));
  }

  trades(mode: string, sinceSec = 0): Trade[] {
    return (this.db.prepare('SELECT * FROM trades WHERE mode=? AND exit_time>=? ORDER BY exit_time').all(mode, sinceSec) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id), token: String(r.token), strategy: String(r.strategy), entryTime: Number(r.entry_time), exitTime: Number(r.exit_time),
      sizeBnb: Number(r.size_bnb), proceedsBnb: Number(r.proceeds_bnb), pnlBnb: Number(r.pnl_bnb), returnPct: Number(r.return_pct), exitReason: r.exit_reason as Trade['exitReason'],
    }));
  }

  realizedSince(mode: string, sinceSec: number): number {
    const r = this.db.prepare('SELECT COALESCE(SUM(pnl_bnb),0) s FROM trades WHERE mode=? AND exit_time>=?').get(mode, sinceSec) as { s: number };
    return r.s;
  }

  recordEquity(mode: string, wallet: number, openValue: number) {
    this.db.prepare('INSERT OR REPLACE INTO equity VALUES(?,?,?,?)').run(Math.floor(Date.now() / 1000), mode, wallet, openValue);
  }

  /** Online backup via VACUUM INTO; keeps the newest `keep` files. */
  backup(dir: string, keep = 14): string {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `bot-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const files = readdirSync(dir).filter((f) => f.startsWith('bot-') && f.endsWith('.db')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) rmSync(join(dir, f));
    return file;
  }
}
