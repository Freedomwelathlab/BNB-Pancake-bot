// RPC layer: HTTP with ranked failover, WebSocket subscriptions with reconnect and URL rotation,
// and a health monitor fed by new block headers.
import { createPublicClient, fallback, http, webSocket, type PublicClient, type Log } from 'viem';
import { bsc } from 'viem/chains';
import { log } from '../core/log.ts';

export interface RpcHealth {
  healthy: boolean;
  lastBlock: bigint;
  lastBlockAt: number; // ms
  wsUrl: string | null;
  wsReconnects: number;
  httpErrors: number;
}

export class Rpc {
  readonly http: PublicClient;
  private wsUrls: string[];
  private wsIdx = 0;
  private ws: PublicClient | null = null;
  private unsubs: (() => void)[] = [];
  private subs: { address: `0x${string}` | `0x${string}`[]; onLogs: (logs: Log[]) => void; name: string }[] = [];
  health: RpcHealth = { healthy: false, lastBlock: 0n, lastBlockAt: 0, wsUrl: null, wsReconnects: 0, httpErrors: 0 };
  private staleMs: number;
  private reconnecting = false;

  constructor(httpUrls: string[], wsUrls: string[], staleMs = 20_000) {
    if (httpUrls.length === 0) throw new Error('At least one RPC_HTTP_URL is required');
    this.http = createPublicClient({
      chain: bsc,
      transport: fallback(httpUrls.map((u) => http(u, { timeout: 10_000, retryCount: 1 })), { rank: { interval: 30_000 }, retryCount: 2 }),
    }) as PublicClient;
    this.wsUrls = wsUrls;
    this.staleMs = staleMs;
  }

  /** Register a log subscription; it is (re)attached on every WS (re)connect. */
  subscribeLogs(name: string, address: `0x${string}` | `0x${string}`[], onLogs: (logs: Log[]) => void) {
    this.subs.push({ name, address, onLogs });
    if (this.ws) this.attach(this.subs[this.subs.length - 1]!);
  }

  async start() {
    await this.connectWs();
    // Poll fallback for block height so health works even without WS.
    setInterval(() => void this.pollHead(), 3_000).unref();
    setInterval(() => this.checkStale(), 5_000).unref();
  }

  private attach(s: { address: `0x${string}` | `0x${string}`[]; onLogs: (logs: Log[]) => void; name: string }) {
    if (!this.ws) return;
    const un = this.ws.watchEvent({
      address: s.address,
      onLogs: (logs) => s.onLogs(logs as Log[]),
      onError: (e) => {
        log.warn('ws_sub_error', { sub: s.name, err: String(e).slice(0, 200) });
        void this.rotate();
      },
    });
    this.unsubs.push(un);
  }

  private async connectWs() {
    if (this.wsUrls.length === 0) {
      log.warn('no_ws_urls', { note: 'running on HTTP polling only; launch/graduation recorder disabled' });
      return;
    }
    const url = this.wsUrls[this.wsIdx % this.wsUrls.length]!;
    try {
      this.ws = createPublicClient({ chain: bsc, transport: webSocket(url, { reconnect: { attempts: 3, delay: 2_000 }, keepAlive: { interval: 15_000 } }) }) as PublicClient;
      this.health.wsUrl = url;
      const un = this.ws.watchBlocks({
        onBlock: (b) => this.onHead(b.number),
        onError: (e) => {
          log.warn('ws_block_error', { url, err: String(e).slice(0, 200) });
          void this.rotate();
        },
      });
      this.unsubs.push(un);
      for (const s of this.subs) this.attach(s);
      log.info('ws_connected', { url });
    } catch (e) {
      log.error('ws_connect_failed', { url, err: String(e) });
      await this.rotate();
    }
  }

  private async rotate() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      for (const u of this.unsubs.splice(0)) {
        try {
          u();
        } catch {
          /* ignore */
        }
      }
      this.ws = null;
      this.wsIdx++;
      this.health.wsReconnects++;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1_000 * this.health.wsReconnects)));
      await this.connectWs();
    } finally {
      this.reconnecting = false;
    }
  }

  private onHead(n: bigint) {
    if (n > this.health.lastBlock) {
      this.health.lastBlock = n;
      this.health.lastBlockAt = Date.now();
    }
  }

  private async pollHead() {
    try {
      this.onHead(await this.http.getBlockNumber());
    } catch (e) {
      this.health.httpErrors++;
      log.warn('http_head_failed', { err: String(e).slice(0, 200) });
    }
  }

  private checkStale() {
    const stale = Date.now() - this.health.lastBlockAt > this.staleMs;
    if (this.health.healthy && stale) log.warn('rpc_stale', { lastBlock: this.health.lastBlock.toString() });
    this.health.healthy = !stale;
    // WS silent but HTTP fine -> rotate WS
    if (this.ws && stale) void this.rotate();
  }
}
