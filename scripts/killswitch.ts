// Usage: npm run kill -- on|off
// Works even if the bot process is wedged: it writes both the DB flag and a KILL file the bot checks every tick.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../src/core/config.ts';
import { Db } from '../src/db/db.ts';

const arg = process.argv[2];
if (arg !== 'on' && arg !== 'off') {
  console.error('usage: npm run kill -- on|off');
  process.exit(2);
}
const cfg = loadConfig();
const db = new Db(cfg.DB_PATH);
db.setKv('kill_switch', arg);
mkdirSync('./data', { recursive: true });
if (arg === 'on') writeFileSync('./data/KILL', new Date().toISOString());
else if (existsSync('./data/KILL')) rmSync('./data/KILL');
console.log(`kill switch ${arg.toUpperCase()}. ${arg === 'on' ? 'The bot stops new entries and closes open positions on its next tick.' : 'New entries allowed again.'}`);
