// Small helpers for the interactive setup scripts: hidden input and .env editing.
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

/** Read a line without echoing it (for tokens). Works in Windows Terminal, PowerShell and bash. */
export function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('Run this in an interactive terminal.'));
    process.stdout.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value.trim());
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

export async function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

/** Set KEY=value in .env (creating it from .env.example if missing). Never logs values. */
export function upsertEnv(updates: Record<string, string>, path = '.env') {
  if (!existsSync(path)) {
    if (existsSync('.env.example')) copyFileSync('.env.example', path);
    else writeFileSync(path, '');
  }
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    if (/[\r\n]/.test(value)) throw new Error(`Refusing to write a multi-line value for ${key}`);
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(path, lines.join('\n').replace(/\n*$/, '\n'));
}
