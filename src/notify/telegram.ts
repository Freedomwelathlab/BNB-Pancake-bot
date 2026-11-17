// Telegram alerts (outbound only; the bot never accepts commands over Telegram).
import { log, redact } from '../core/log.ts';

export class Notifier {
  private queue: string[] = [];
  private sending = false;
  constructor(private token: string, private chatId: string) {}

  get enabled() {
    return Boolean(this.token && this.chatId);
  }

  send(text: string) {
    if (!this.enabled) return;
    this.queue.push(redact(text).slice(0, 3500));
    void this.flush();
  }

  private async flush() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length) {
        const text = this.queue.shift()!;
        try {
          const r = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: this.chatId, text, disable_web_page_preview: true }),
            signal: AbortSignal.timeout(10_000),
          });
          if (r.status === 429) {
            this.queue.unshift(text);
            await new Promise((res) => setTimeout(res, 5_000));
          }
        } catch (e) {
          log.warn('telegram_failed', { err: String(e).slice(0, 120) });
        }
        await new Promise((res) => setTimeout(res, 1_100)); // ~1 msg/s per chat
      }
    } finally {
      this.sending = false;
    }
  }
}
