#!/usr/bin/env node
import { loadConfig } from '../lib/config.js';
import { pollSources } from '../lib/poller.js';
import { itemStoreStats } from '../lib/item-store.js';

async function main() {
  const config = loadConfig();
  const result = await pollSources(config);
  const stats = itemStoreStats(result.store);

  console.log(`Polled ${result.sources.length} sources`);
  console.log(`Fetched: ${result.fetched}`);
  console.log(`New items: ${result.inserted}`);
  console.log(`Updated items: ${result.updated}`);
  console.log(`Enriched: ${result.enriched}`);
  console.log(`Not modified: ${result.notModified.length}`);
  console.log(`Stored items: ${stats.totalItems}`);

  if (result.errors.length) {
    console.log('Source errors:');
    for (const error of result.errors) {
      console.log(`- ${error.source || error.source_id}: ${error.error}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
