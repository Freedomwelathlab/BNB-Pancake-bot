// Read-mostly dashboard. Binds to 127.0.0.1 by default (reach it over an SSH tunnel).
// /health is unauthenticated (for Docker/uptime checks); everything else needs DASHBOARD_TOKEN.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Bot } from '../bot.ts';
import type { Db } from '../db/db.ts';
import type { Rpc } from '../chain/rpc.ts';
import type { LaunchRecorder } from '../chain/recorder.ts';
import { computeMetrics } from '../backtest/metrics.ts';
import { PAGE } from './page.ts';

export function startDashboard(opts: { host: string; port: number; token: string; bot: Bot; db: Db; rpc: Rpc; recorder: LaunchRecorder | null; capitalBnb: number }) {
  const { bot, db, rpc } = opts;
  const authed = (h: string | undefined) => {
    if (!opts.token) return opts.host === '127.0.0.1'; // no token: only allow when bound to localhost
    const got = Buffer.from((h ?? '').replace(/^Bearer /, ''));
    const want = Buffer.from(opts.token);
    return got.length === want.length && timingSafeEqual(got, want);
  };

  const state = () => {
    const trades = db.trades(bot.mode);
    const m = computeMetrics(trades, opts.capitalBnb);
    const open = db.openPositions(bot.mode);
    const decisions = db.db.prepare('SELECT ts, symbol, strategy, action, reasons FROM decisions ORDER BY ts DESC LIMIT 40').all();
    const equity = db.db.prepare('SELECT ts, wallet_bnb, open_value_bnb FROM equity WHERE mode=? ORDER BY ts DESC LIMIT 2000').all(bot.mode);
    const launches = db.db.prepare('SELECT COUNT(*) n, SUM(buys) buys, SUM(sells) sells FROM launches').get();
    const grads = db.db.prepare('SELECT COUNT(*) n FROM graduations').get();
    return {
      mode: bot.mode,
      killSwitch: bot.killSwitch,
      status: bot.status,
      gate: bot.gate,
      rpc: { ...rpc.health, lastBlock: rpc.health.lastBlock.toString() },
      metrics: m,
      open,
      recentTrades: trades.slice(-30).reverse(),
      decisions,
      equity: (equity as { ts: number; wallet_bnb: number; open_value_bnb: number }[]).reverse(),
      research: { launches, graduations: grads, recorder: opts.recorder?.stats ?? null },
      markets: [...bot.markets.values()].map((s) => ({ symbol: s.m.symbol, token: s.m.token, venue: s.m.venue, feeBps: s.m.feeBps, bars: s.candles.length, lastBar: s.candles.at(-1)?.t ?? null, safety: s.safety ?? null })),
    };
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (code: number, body: unknown, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self' 'unsafe-inline'" });
      res.end(typeof body === 'string' ? body : JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    };
    if (url.pathname === '/health') {
      const ok = rpc.health.healthy && Date.now() - bot.status.lastTickAt < 5 * 60_000;
      return send(ok ? 200 : 503, { ok, mode: bot.mode, lastTickAt: bot.status.lastTickAt, rpcHealthy: rpc.health.healthy });
    }
    if (url.pathname === '/') return send(200, PAGE, 'text/html; charset=utf-8');
    const tokenParam = url.searchParams.get('token') ?? undefined;
    if (!authed(req.headers.authorization ?? (tokenParam ? `Bearer ${tokenParam}` : undefined))) return send(401, { error: 'unauthorized' });
    if (url.pathname === '/api/state' && req.method === 'GET') return send(200, state());
    if (url.pathname === '/api/kill' && req.method === 'POST') {
      bot.setKill(true, 'dashboard');
      return send(200, { killSwitch: true });
    }
    if (url.pathname === '/api/resume' && req.method === 'POST') {
      bot.setKill(false, 'dashboard');
      return send(200, { killSwitch: false });
    }
    return send(404, { error: 'not_found' });
  });
  server.listen(opts.port, opts.host);
  return server;
}
