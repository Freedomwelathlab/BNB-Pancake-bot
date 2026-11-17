// Research recorder: Four.meme launches and their graduations to PancakeSwap.
// Records EVERY launch (including the ones that die) so later analysis has no survivorship bias.
// It never trades the bonding curve and never races first blocks.
import { decodeEventLog, type Log } from 'viem';
import { ABI, ADDR } from '../core/constants.ts';
import type { Db } from '../db/db.ts';
import type { Rpc } from './rpc.ts';
import { log } from '../core/log.ts';

export class LaunchRecorder {
  private known = new Set<string>();
  stats = { launches: 0, purchases: 0, sales: 0, graduations: 0, decodeErrors: 0 };

  constructor(private db: Db, private rpc: Rpc, private onGraduation: (token: string, pool: string, venue: 'pcs_v2' | 'pcs_v3', feeBps: number) => void) {}

  start() {
    this.rpc.subscribeLogs('four_meme', ADDR.FOUR_MEME_PROXY, (logs) => this.onFour(logs));
    this.rpc.subscribeLogs('pcs_factories', [ADDR.PCS_V2_FACTORY, ADDR.PCS_V3_FACTORY], (logs) => void this.onFactory(logs));
  }

  private onFour(logs: Log[]) {
    for (const l of logs) {
      try {
        const ev = decodeEventLog({ abi: ABI.fourMeme, data: l.data, topics: l.topics });
        const a = ev.args as Record<string, unknown>;
        const token = String(a.token).toLowerCase();
        if (ev.eventName === 'TokenCreate') {
          this.stats.launches++;
          this.known.add(token);
          this.db.db.prepare('INSERT OR IGNORE INTO launches(token,creator,name,symbol,created_block,created_at) VALUES(?,?,?,?,?,?)').run(token, String(a.creator), String(a.name).slice(0, 64), String(a.symbol).slice(0, 32), Number(l.blockNumber), Math.floor(Date.now() / 1000));
        } else if (ev.eventName === 'TokenPurchase') {
          this.stats.purchases++;
          this.db.db.prepare('UPDATE launches SET buys=buys+1, funds_raised=? WHERE token=?').run(Number(a.funds) / 1e18, token);
        } else if (ev.eventName === 'TokenSale') {
          this.stats.sales++;
          this.db.db.prepare('UPDATE launches SET sells=sells+1, funds_raised=? WHERE token=?').run(Number(a.funds) / 1e18, token);
        }
      } catch {
        this.stats.decodeErrors++; // unknown Four.meme events (e.g. companion events) are ignored
      }
    }
  }

  private async onFactory(logs: Log[]) {
    for (const l of logs) {
      try {
        const isV2 = l.address.toLowerCase() === ADDR.PCS_V2_FACTORY.toLowerCase();
        const ev = decodeEventLog({ abi: isV2 ? ABI.v2Factory : ABI.v3Factory, data: l.data, topics: l.topics });
        const a = ev.args as Record<string, unknown>;
        const t0 = String(a.token0).toLowerCase();
        const t1 = String(a.token1).toLowerCase();
        const token = this.known.has(t0) ? t0 : this.known.has(t1) ? t1 : this.isFourLaunch(t0) ? t0 : this.isFourLaunch(t1) ? t1 : null;
        if (!token) continue;
        const pool = String(isV2 ? a.pair : a.pool).toLowerCase();
        const tx = l.transactionHash ? await this.rpc.http.getTransaction({ hash: l.transactionHash }) : null;
        const fromFour = tx?.to?.toLowerCase() === ADDR.FOUR_MEME_PROXY.toLowerCase();
        this.db.db.prepare('INSERT OR IGNORE INTO graduations VALUES(?,?,?,?,?,?,?)').run(token, pool, isV2 ? 'pcs_v2' : 'pcs_v3', Number(l.blockNumber), Math.floor(Date.now() / 1000), l.transactionHash ?? '', fromFour ? 1 : 0);
        this.stats.graduations++;
        log.info('graduation_detected', { token, pool, fromFour });
        this.onGraduation(token, pool, isV2 ? 'pcs_v2' : 'pcs_v3', isV2 ? 25 : Number(a.fee) / 100);
      } catch (e) {
        this.stats.decodeErrors++;
        log.debug('factory_decode_error', { err: String(e).slice(0, 120) });
      }
    }
  }

  private isFourLaunch(token: string): boolean {
    return Boolean(this.db.db.prepare('SELECT 1 FROM launches WHERE token=?').get(token));
  }
}
