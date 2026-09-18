#!/usr/bin/env node
/**
 * scripts/review-consumption-recompute.mjs  (LIN-2911)
 *
 * Recomputes the sentence-level section table in
 * `docs/papers/harbour/review-consumption.md` straight from the committed
 * hand marks in `docs/papers/harbour/review-consumption-marks.json` — no
 * network read, no re-fetching the ten reviews. Exists so the paper's
 * sentence counts and consumed shares can be checked by running one command
 * rather than re-deriving them by hand from the marks file's section ranges.
 *
 * Usage:
 *   node scripts/review-consumption-recompute.mjs
 *   node scripts/review-consumption-recompute.mjs --block plan_reviews
 *   node scripts/review-consumption-recompute.mjs --block fix_round
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const marksPath = path.join(here, '..', 'docs', 'papers', 'harbour', 'review-consumption-marks.json');
const SECTIONS = ['grounding', 'method', 'findings', 'ledger', 'verdict'];

function parseRanges(spec) {
  const out = new Set();
  if (!spec) return out;
  for (const part of spec.split(',')) {
    const p = part.trim();
    if (!p) continue;
    if (p.includes('-')) {
      const [a, b] = p.split('-').map(Number);
      for (let i = a; i <= b; i++) out.add(i);
    } else {
      out.add(Number(p));
    }
  }
  return out;
}

function recompute(block) {
  const sectionTotals = Object.fromEntries(SECTIONS.map((s) => [s, 0]));
  const sectionConsumed = Object.fromEntries(SECTIONS.map((s) => [s, 0]));
  let allTotal = 0;
  let allConsumed = 0;
  const perTicket = [];

  for (const [ticket, rec] of Object.entries(block)) {
    const aSet = new Set(rec.a || []);
    let union = new Set();
    for (const s of SECTIONS) {
      const rng = parseRanges(rec.sections?.[s]);
      for (const u of rng) union.add(u);
      sectionTotals[s] += rng.size;
      sectionConsumed[s] += [...rng].filter((u) => aSet.has(u)).length;
    }
    const consumed = [...union].filter((u) => aSet.has(u)).length;
    allTotal += union.size;
    allConsumed += consumed;
    perTicket.push({ ticket, total: union.size, consumed });
  }

  return { sectionTotals, sectionConsumed, allTotal, allConsumed, perTicket };
}

function pct(n, d) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a';
}

function printTable(label, result) {
  console.log(`\n== ${label} ==`);
  for (const s of SECTIONS) {
    const t = result.sectionTotals[s];
    if (!t) continue;
    console.log(`${s.padEnd(10)} ${String(t).padStart(4)}  ${pct(result.sectionConsumed[s], t)}`);
  }
  console.log(`${'all'.padEnd(10)} ${String(result.allTotal).padStart(4)}  ${pct(result.allConsumed, result.allTotal)}`);
  console.log('\nper ticket:');
  for (const { ticket, total, consumed } of result.perTicket) {
    console.log(`  ${ticket.padEnd(10)} ${String(total).padStart(4)}  ${pct(consumed, total)}`);
  }
}

const args = process.argv.slice(2);
const blockIdx = args.indexOf('--block');
const blockName = blockIdx >= 0 ? args[blockIdx + 1] : 'final_reviews';

const marks = JSON.parse(readFileSync(marksPath, 'utf8'));
const block = marks[blockName];
if (!block) {
  console.error(`No such block "${blockName}" in ${marksPath}. Known blocks: ${Object.keys(marks).filter((k) => typeof marks[k] === 'object').join(', ')}`);
  process.exit(2);
}

printTable(blockName, recompute(block));
