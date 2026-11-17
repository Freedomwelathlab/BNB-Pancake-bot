// Entry point. Paper mode unless three live switches AND the evidence gate all agree.
import { loadConfig, liveSwitchesOn, readPrivateKey } from './core/config.ts';
import { log, setLogLevel } from './core/log.ts';
import { Db } from './db/db.ts';
import { Rpc } from './chain/rpc.ts';
import { LaunchRecorder } from './chain/recorder.ts';
import { LiveExecutor, PaperExecutor, type Executor } from './exec/executor.ts';
import { Notifier } from './notify/telegram.ts';
import { Bot, loadUniverse } from './bot.ts';
import { startDashboard } from './dashboard/server.ts';

const cfg = loadConfig();
setLogLevel(cfg.LOG_LEVEL);
const db = new Db(cfg.DB_PATH);
const rpc = new Rpc(cfg.RPC_HTTP_URLS, cfg.RPC_WS_URLS);
const notify = new Notifier(cfg.TELEGRAM_BOT_TOKEN, cfg.TELEGRAM_CHAT_ID);

let exec: Executor;
const sw = liveSwitchesOn(cfg);
if (cfg.MODE === 'live' && !sw.ok) {
  log.error('live_refused', { reasons: sw.reasons });
  console.error(`Live mode refused: ${sw.reasons.join('; ')}. Starting in PAPER mode.`);
}
if (sw.ok) {
  const key = readPrivateKey(cfg.PRIVATE_KEY_FILE);
  exec = new LiveExecutor(rpc.http, key, cfg.RPC_HTTP_URLS[0]!, { maxTradeBnb: cfg.MAX_TRADE_BNB, deadlineSec: cfg.TX_DEADLINE_SEC, maxGasGwei: cfg.MAX_GAS_GWEI });
  log.warn('LIVE_MODE', { wallet: (exec as LiveExecutor).walletAddress });
} else {
  const saved = Number(db.getKv('paper_balance') ?? cfg.PAPER_START_BNB);
  const state = { balance: saved };
  exec = new PaperExecutor(rpc.http, state);
  setInterval(() => db.setKv('paper_balance', String(state.balance)), 10_000).unref();
}

const universe = loadUniverse(cfg);
if (universe.length === 0) log.warn('empty_universe', { hint: 'run `npm run fetch-history` to build data/history/_universe.json' });
const bot = new Bot(cfg, db, rpc, exec, notify, universe);

await rpc.start();
let recorder: LaunchRecorder | null = null;
if (cfg.WATCH_FOUR_MEME) {
  recorder = new LaunchRecorder(db, rpc, (token, pool) => notify.send(`Graduation recorded: ${token} -> ${pool} (research only)`));
  recorder.start();
}
await bot.recover();
bot.refreshGate();
startDashboard({ host: cfg.DASHBOARD_HOST, port: cfg.DASHBOARD_PORT, token: cfg.DASHBOARD_TOKEN, bot, db, rpc, recorder, capitalBnb: cfg.PAPER_START_BNB });
notify.send(`Bot started in ${exec.mode.toUpperCase()} mode. Universe: ${universe.map((u) => u.symbol).join(', ') || 'empty'}. Gate: ${bot.gate.pass ? 'pass' : 'not passed'}.`);
log.info('started', { mode: exec.mode, universe: universe.length, dashboard: `http://${cfg.DASHBOARD_HOST}:${cfg.DASHBOARD_PORT}` });

const loop = setInterval(() => void bot.tick(), cfg.POLL_SECONDS * 1000);
void bot.tick();
// Daily backup at ~00:10 UTC, checked hourly.
setInterval(() => {
  const d = new Date();
  if (d.getUTCHours() === 0) {
    try {
      log.info('backup', { file: db.backup('./backups') });
    } catch (e) {
      log.error('backup_failed', { err: String(e) });
    }
  }
}, 3600_000).unref();

let stopping = false;
const shutdown = async (sig: string) => {
  if (stopping) return;
  stopping = true;
  log.warn('shutdown', { sig });
  clearInterval(loop);
  // let an in-flight tick finish (max 30s); positions stay open and are recovered on restart
  const until = Date.now() + 30_000;
  while ((bot as unknown as { ticking: boolean }).ticking && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
  notify.send(`Bot stopping (${sig}). Open positions persist and resume on restart.`);
  await new Promise((r) => setTimeout(r, 1500));
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => log.error('unhandled_rejection', { err: String(e).slice(0, 400) }));
