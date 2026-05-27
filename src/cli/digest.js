#!/usr/bin/env node
import { generateDigest } from '../lib/digest.js';
import { loadConfig } from '../lib/config.js';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--date') {
      args.date = argv[index + 1];
      index += 1;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(item)) {
      args.date = item;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const { digest, filePath } = await generateDigest({ date: args.date, config });

  console.log(`Wrote ${filePath}`);
  console.log(`Posts: ${digest.posts.length}`);
  console.log(`Summary status: ${digest.summaryStatus}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
