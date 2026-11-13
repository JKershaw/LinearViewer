#!/usr/bin/env node
/**
 * Writes the prompt catalogue section of public/llms.txt from the stage-kind records (LIN-4467).
 *
 *   node scripts/gen-llms-catalogue.mjs          rewrite the section in place
 *   node scripts/gen-llms-catalogue.mjs --check  exit 1 when the file differs from the records
 *
 * The section runs from its heading to the next heading (lib/prompts/stage-catalogue.js names both).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderPromptCatalogue, CATALOGUE_HEADING, CATALOGUE_NEXT_HEADING } from '../lib/prompts/stage-catalogue.js';

const FILE = fileURLToPath(new URL('../public/llms.txt', import.meta.url));

/** The file text with its catalogue section replaced by the rendered one. */
export function withCatalogue(text) {
  const start = text.indexOf(CATALOGUE_HEADING);
  const end = text.indexOf(CATALOGUE_NEXT_HEADING, start);
  if (start < 0 || end < 0) throw new Error(`public/llms.txt: no catalogue section between "${CATALOGUE_HEADING}" and "${CATALOGUE_NEXT_HEADING}"`);
  return text.slice(0, start) + renderPromptCatalogue() + text.slice(end);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = readFileSync(FILE, 'utf8');
  const next = withCatalogue(text);
  if (process.argv.includes('--check')) {
    if (next !== text) { console.error('public/llms.txt: the prompt catalogue differs from the stage-kind records; run node scripts/gen-llms-catalogue.mjs'); process.exit(1); }
    console.log('public/llms.txt: prompt catalogue matches the records');
  } else {
    writeFileSync(FILE, next);
    console.log('public/llms.txt: prompt catalogue written');
  }
}
