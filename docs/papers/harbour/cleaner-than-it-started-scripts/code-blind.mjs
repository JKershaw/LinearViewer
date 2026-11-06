#!/usr/bin/env node
// code-blind.mjs — LIN-4315. Reads the FROZEN LIN-4150 comments and the frozen git merge lists
// (no network, no git) and writes <out-dir>/blind-codes.json: one entry per blind pass and per row.
//
// Each row's sign is the reviewer's own Balance cell, copied verbatim (bold markers removed) and
// mapped to a score: better = +1, neutral / mixed / worse = 0 / 0 / -1. "mixed (leans worse)" stays
// mixed and is flagged `leans`. A row with no sign of its own ("(with #3)") keeps sign null.
// Commit labels are resolved to frozen merges by hash prefix (>= 7 chars, unique), and each row
// is attributed to tickets through the merge subject; the pass title names the ticket(s) of a
// single or combined read.
//
// Usage: node docs/papers/harbour/cleaner-than-it-started-scripts/code-blind.mjs <out-dir> --inputs <file.json>
// The blind ticket, batch names, session split and baseline merge file come from the inputs file; the
// reason v1's inputs live in this folder and not in v1's evidence folder is in inputs.mjs.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { takeInputs, need } from './inputs.mjs';

const { inputs: I, positional } = takeInputs(process.argv.slice(2), 'code-blind.mjs <out-dir>');
const outDir = positional[0];
if (!outDir) { console.error('usage: code-blind.mjs <out-dir> --inputs <file.json>'); process.exit(2); }
const BLIND_TICKET = need(I, 'blind.ticket');
const BATCHES = need(I, 'blind.expected_batches');
const SESSIONS = need(I, 'blind.sessions');
const BASELINE_FILE = need(I, 'baseline_3nov_file');
const sessionFor = (b) => {
  const s = SESSIONS.find((x) => x.batches.includes(b));
  if (!s) throw new Error(`batch ${b} is in no session in the inputs file`);
  return s.name;
};

const frozen = (rel) => readFileSync(path.join(outDir, rel), 'utf8');

// ---- merges (frozen git lists) ----
const merges = [];
for (const [repo, file] of [['LinearViewer', 'git/merges-LinearViewer.tsv'], ['simple-dispatcher', 'git/merges-simple-dispatcher.tsv'], ['LinearViewer', BASELINE_FILE]]) {
  for (const line of frozen(file).split('\n').slice(1).filter(Boolean)) {
    const [full, short, committed, subject] = line.split('\t');
    const ids = [...new Set([...subject.matchAll(/\bLIN-(\d+)\b/g)].map((m) => `LIN-${m[1]}`))];
    merges.push({ repo, full, short, committed, subject, tickets: ids });
  }
}
function resolve(label) {
  const hits = merges.filter((m) => m.full.startsWith(label) || m.short.startsWith(label));
  const uniq = [...new Map(hits.map((h) => [h.full, h])).values()];
  return uniq.length === 1 ? uniq[0] : null;
}

// ---- the blind comments ----
const { comments } = JSON.parse(frozen(`comments/${BLIND_TICKET}.json`));
const blind = comments.filter((c) => /^## Blind place scoring, /.test(c.body || ''))
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const SCORE = { better: 1, neutral: 0, mixed: 0, worse: -1 };
const cleanCell = (s) => (s || '').replace(/\*\*/g, '').trim();
const passes = [];
const unresolved = [];

for (const c of blind) {
  const lines = c.body.split('\n');
  const title = lines[0].replace(/^## Blind place scoring, /, '').trim();
  const batch = title.match(new RegExp(`^batch ([${BATCHES.join('')}])$`));
  const single = title.match(/^(.*?) pass ([A-Z]{1,2})$/);
  const id = batch ? `batch ${batch[1]}` : single[2];
  const subjectTickets = batch ? null : [...new Set(single[1].match(/\d+/g).map((n) => `LIN-${n}`))];
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('|') || line.startsWith('|---') || line.startsWith('| #')) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
    if (!/^\d+$/.test(cells[0])) continue;
    const n = Number(cells[0]);
    const commitCell = cells[1];
    const balanceRaw = cells[2] ?? '';
    const reason = cells.slice(3).join(' | ');
    const balance = cleanCell(balanceRaw);
    const word = (balance.match(/^(better|neutral|mixed|worse)\b/i) || [])[1]?.toLowerCase() ?? null;
    const labels = [...commitCell.matchAll(/\b[0-9a-f]{7,9}\b/g)].map((m) => m[0]);
    const resolved = labels.map(resolve);
    labels.forEach((l, i) => { if (!resolved[i]) unresolved.push({ pass: id, row: n, label: l }); });
    const tickets = batch
      ? [...new Set(resolved.filter(Boolean).flatMap((m) => m.tickets))]
      : subjectTickets;
    rows.push({
      row: n,
      commit_cell: commitCell,
      shas: resolved.filter(Boolean).map((m) => ({ repo: m.repo, short: m.short, full: m.full, subject: m.subject })),
      tickets,
      balance_raw: balanceRaw.trim(),
      sign: word,
      score: word === null ? null : SCORE[word],
      leans: /leans worse/i.test(balance) ? 'worse' : null,
      ...(/with #\d+/.test(commitCell) ? { note: 'row linked to an earlier row (not scored on its own)' } : {}),
      quote: { balance: balance, reason: reason.replace(/\*\*/g, '') },
    });
  }
  passes.push({
    id,
    kind: batch ? 'batch' : 'single-or-area',
    title,
    comment_id: c.id,
    created_at: c.createdAt,
    session: batch ? sessionFor(batch[1]) : `pass ${id}`,
    subject_tickets: subjectTickets,
    rows,
  });
}

const out = {
  source: 'comments/LIN-4150.json (frozen); every sign is the pass\'s own Balance cell, copied verbatim',
  scoring: 'better=+1, neutral=0, mixed=0, worse=-1; "mixed (leans worse)" kept as mixed with leans=worse',
  passes_count: passes.length,
  unresolved_labels: unresolved,
  passes,
};
writeFileSync(path.join(outDir, 'blind-codes.json'), JSON.stringify(out, null, 2) + '\n');
const rowCount = passes.reduce((n, p) => n + p.rows.length, 0);
console.error(`coded ${passes.length} passes, ${rowCount} rows, unresolved labels: ${unresolved.length}`);
