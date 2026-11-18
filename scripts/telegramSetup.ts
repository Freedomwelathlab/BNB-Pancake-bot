// Interactive Telegram alert setup. Run in your own terminal: npm run telegram-setup
// 1. Create a bot with @BotFather in Telegram and copy the token it gives you.
// 2. Paste the token at the hidden prompt (nothing is echoed or logged).
// 3. Open the bot in Telegram and press Start; the script finds your chat id,
//    saves both values to .env and sends a test message.
import { readHidden, upsertEnv } from './lib/terminal.ts';

const api = (token: string, method: string, body?: unknown) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(35_000),
  }).then((r) => r.json() as Promise<{ ok: boolean; result?: any; description?: string }>);

console.log(`
Telegram alert setup
--------------------
Step 1. In Telegram, open @BotFather, send /newbot, pick a name and a username
        ending in "bot". BotFather replies with a token like 123456789:AA...
        Keep it private: anyone with it can post as your bot.
`);

const token = await readHidden('Step 2. Paste the bot token here (hidden), then press Enter: ');
if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) {
  console.error('That does not look like a BotFather token (digits:letters). Nothing was saved.');
  process.exit(1);
}

const me = await api(token, 'getMe');
if (!me.ok) {
  console.error(`Telegram rejected the token (${me.description ?? 'unknown error'}). Nothing was saved.`);
  process.exit(1);
}
const username = me.result.username as string;
console.log(`\nToken works: bot @${username}.`);

// Clear old updates so we only pick up the message the user sends now.
const pending = await api(token, 'getUpdates', { timeout: 0 });
let offset = pending.ok && pending.result.length ? pending.result.at(-1).update_id + 1 : 0;

console.log(`Step 3. Open https://t.me/${username} in Telegram and press Start (or send any message).`);
console.log('        Waiting up to 5 minutes...');

let chatId: string | null = null;
const deadline = Date.now() + 5 * 60_000;
while (!chatId && Date.now() < deadline) {
  const r = await api(token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
  if (!r.ok) {
    console.error(`getUpdates failed: ${r.description}`);
    process.exit(1);
  }
  for (const u of r.result) {
    offset = u.update_id + 1;
    if (u.message?.chat?.type === 'private') chatId = String(u.message.chat.id);
  }
}
if (!chatId) {
  console.error('No message arrived. Run the script again and press Start in the bot chat.');
  process.exit(1);
}
await api(token, 'getUpdates', { offset, timeout: 0 }); // acknowledge

upsertEnv({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId });
const test = await api(token, 'sendMessage', {
  chat_id: chatId,
  text: 'BNB Snipping bot: alerts are connected. You will get trade, pause, kill-switch and error alerts here. The bot never accepts commands from Telegram.',
});
console.log(test.ok ? '\nSaved to .env and sent a test message. Restart the bot to start sending alerts.' : `\nSaved to .env, but the test message failed: ${test.description}`);
