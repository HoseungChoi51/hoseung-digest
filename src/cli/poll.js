#!/usr/bin/env node
import { loadConfig } from '../lib/config.js';
import { pollSubreddits } from '../lib/poller.js';
import { postStoreStats } from '../lib/post-store.js';

async function main() {
  const config = loadConfig();
  const result = await pollSubreddits(config);
  const stats = postStoreStats(result.store);

  console.log(`Polled ${result.subreddits.length} subreddits`);
  console.log(`Fetched: ${result.fetched}`);
  console.log(`New posts: ${result.inserted}`);
  console.log(`Updated posts: ${result.updated}`);
  console.log(`Enriched: ${result.enriched}`);
  console.log(`Stored posts: ${stats.totalPosts}`);

  if (result.errors.length) {
    console.log('Feed errors:');
    for (const error of result.errors) {
      console.log(`- r/${error.subreddit}: ${error.error}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
