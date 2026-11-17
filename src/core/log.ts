// Minimal structured logger (JSON lines). Redacts anything that looks like a secret.
type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: Level = 'info';

export function setLogLevel(l: Level) {
  threshold = l;
}

const SECRET_RE = /(0x[0-9a-fA-F]{64})|(\d{8,10}:[A-Za-z0-9_-]{30,})/g; // private keys, telegram tokens

export function redact(s: string): string {
  return s.replace(SECRET_RE, '[REDACTED]');
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < order[threshold]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const out = redact(line);
  if (level === 'error' || level === 'warn') process.stderr.write(out + '\n');
  else process.stdout.write(out + '\n');
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
};
