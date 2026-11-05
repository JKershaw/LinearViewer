#!/usr/bin/env node
// size-survey-balance.mjs — LIN-4257. Bound size as judged by the Survey: reads the
// Balance column of docs/plans/survey/place-ledger.md IN PLACE (no prose copied) and
// prints one row per ledger line that names a LIN ticket: { ticket, line, balance }.
// `balance` is the first bolded token of the last cell (the ledger's own judgement);
// the ledger's prose stays where it is and is cited by line. Read-only.
//
// Usage (LinearViewer root): node docs/papers/harbour/task-size-and-cost-scripts/size-survey-balance.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = path.resolve(HERE, '..', '..', '..', '..', 'docs', 'plans', 'survey', 'place-ledger.md');
const rows = [];
readFileSync(LEDGER, 'utf8').split('\n').forEach((text, i) => {
  if (!text.startsWith('|')) return;
  const cells = text.split('|').map((c) => c.trim()).filter((c, j, a) => !(j === 0 || j === a.length - 1));
  const idCell = cells[0] || '';
  const m = idCell.match(/\bLIN-(\d+)\b/);
  if (!m || cells.length < 2) return;
  const last = cells[cells.length - 1] || '';
  const bold = last.match(/\*\*([^*]+)\*\*/);
  rows.push({ ticket: `LIN-${m[1]}`, line: i + 1, balance: bold ? bold[1].trim() : null, row_has_balance_cell: Boolean(bold) });
});
console.log(JSON.stringify({ source: 'docs/plans/survey/place-ledger.md', rows }, null, 1));
