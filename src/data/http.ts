// Small HTTP helper with timeout, retries and a per-host minimum spacing (rate limiting).
const lastCall = new Map<string, number>();

export interface FetchOpts {
  minSpacingMs?: number; // per-host spacing
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getJson<T = unknown>(url: string, o: FetchOpts = {}): Promise<T> {
  const host = new URL(url).host;
  const retries = o.retries ?? 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const spacing = o.minSpacingMs ?? 0;
    const wait = (lastCall.get(host) ?? 0) + spacing - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall.set(host, Date.now());
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'bnb-edge-bot/0.1', ...o.headers }, signal: AbortSignal.timeout(o.timeoutMs ?? 15_000) });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} from ${host}`);
        await sleep(Math.min(90_000, 15_000 * 2 ** attempt)); // 429: back off hard
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${host}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(1_000 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
