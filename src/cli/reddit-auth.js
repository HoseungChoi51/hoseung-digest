#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { buildAuthUrl, exchangeAuthorizationCode } from '../lib/reddit.js';
import { loadConfig } from '../lib/config.js';

function extractCode(value) {
  try {
    const url = new URL(value);
    return url.searchParams.get('code') || value;
  } catch {
    return value.trim();
  }
}

async function main() {
  loadConfig();
  const auth = buildAuthUrl();
  console.log('Open this URL and authorize the app:');
  console.log(auth.url);
  console.log('');

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question('Paste the redirected URL or code here: ');
  rl.close();

  const code = extractCode(answer);
  if (!code) throw new Error('No OAuth code found.');

  const token = await exchangeAuthorizationCode(code);
  console.log(`Reddit token saved. Scopes: ${token.scope}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
