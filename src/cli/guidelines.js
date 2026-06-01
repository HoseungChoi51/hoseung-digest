#!/usr/bin/env node
import { generatePreferenceGuidelines, formatPreferenceGuidelinesMarkdown } from '../lib/preference-guidelines.js';
import { loadConfig } from '../lib/config.js';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--stdout') {
      args.stdout = true;
    } else if (item === '--json') {
      args.json = true;
    } else if (item === '--markdown') {
      args.markdown = true;
    } else if (item === '--deterministic' || item === '--no-llm') {
      args.useLlm = false;
    } else if (item === '--items') {
      args.itemStorePath = argv[index + 1];
      index += 1;
    } else if (item === '--preferences') {
      args.preferenceStorePath = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const result = await generatePreferenceGuidelines({
    itemStorePath: args.itemStorePath,
    preferenceStorePath: args.preferenceStorePath,
    config,
    useLlm: args.useLlm,
    write: !args.stdout
  });

  if (args.stdout) {
    if (args.json) {
      console.log(JSON.stringify(result.guidelines, null, 2));
    } else {
      console.log(formatPreferenceGuidelinesMarkdown(result.guidelines));
    }
    return;
  }

  console.log(`Wrote ${result.markdownPath}`);
  console.log(`Wrote ${result.jsonPath}`);
  console.log(`Rules: ${result.guidelines.rule_counts.total}`);
  console.log(`Preferences analyzed: ${result.guidelines.labeled_item_count}`);
  console.log(`Generator: ${result.guidelines.generated_by}`);
  if (result.guidelines.llm_error) console.log(`LLM note: ${result.guidelines.llm_error}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
