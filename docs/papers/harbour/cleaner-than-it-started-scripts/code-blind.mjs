#!/usr/bin/env node
// code-blind.mjs — LIN-4315. Reads the FROZEN blind-ticket comments and the frozen git merge lists
// (no network, no git) and writes <out-dir>/blind-codes.json: one entry per blind pass and per row.
//
// Each row's sign is the reviewer's own Balance cell, copied verbatim (bold markers removed) and
// mapped to a score: better = +1, neutral / mixed / worse = 0 / 0 / -1. "mixed (leans worse)" stays
// mixed and is flagged `leans`. A row with no sign of its own ("(with #3)") keeps sign null.
// Commit labels are resolved to frozen merges by hash prefix (>= 7 chars, unique), and each row
// is attributed to tickets through the merge subject; the pass title names the ticket(s) of a
// single or combined read.
//
// Title parser (LIN-4333): a pass title is read by parseTitle(), which accepts exactly three shapes and
// throws on anything else, naming the title. Numbers are never read out of a title on their own.
//   batch <X>                    X one of the batch names in the inputs file (v1: A-D)
//   <tickets> pass <ID>          tickets are LIN-<n> or <n> joined by "+"; only the first may carry LIN-
//   baseline pair <N> pass <ID>  kind 'pair-baseline', subject 'baseline pair <N>', no ticket
//
// Usage: node docs/papers/harbour/cleaner-than-it-started-scripts/code-blind.mjs <out-dir> --inputs <file.json>
// The blind ticket, batch names, session split and baseline merge file come from the inputs file; the
// reason v1's inputs live in this folder and not in v1's evidence folder is in inputs.mjs.
// Importing this module has no side effects: the run happens only when it is executed directly.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { takeInputs, need, blindCutoff, postsAfter } from './inputs.mjs';

// Returns { kind, id, subject_tickets, batch?, subject? } for a title, or throws naming the title.
// `id` is 'batch <X>' for a batch and the pass letter otherwise (the same ids the coder always used).
export function parseTitle(rawTitle, batchNames) {
  const title = rawTitle.trim();
  const fail = (why) => { throw new Error(`blind pass title is not one of the three known shapes (${why}): "${title}"`); };
  if (!title) fail('empty');
  let m = title.match(new RegExp(`^batch ([${batchNames.join('')}])$`));
  if (m) return { kind: 'batch', batch: m[1], id: `batch ${m[1]}`, subject_tickets: null };
  m = title.match(/^baseline pair (\d+) pass ([A-Z]{1,2})$/);
  if (m) return { kind: 'pair-baseline', subject: `baseline pair ${m[1]}`, id: m[2], subject_tickets: null };
  m = title.match(/^((?:LIN-)?\d+(?:\+\d+)*) pass ([A-Z]{1,2})$/);
  if (m) {
    const nums = m[1].split('+').map((t) => t.replace(/^LIN-/, ''));
    if (new Set(nums).size !== nums.length) fail('a ticket is listed twice');
    return { kind: 'single-or-area', id: m[2], subject_tickets: nums.map((n) => `LIN-${n}`) };
  }
  if (/ pass .* pass /.test(title)) fail('two "pass" separators: ambiguous');
  fail('no shape matches');
}

function main() {
  const { inputs: I, positional } = takeInputs(process.argv.slice(2), 'code-blind.mjs <out-dir>');
  const outDir = positional[0];
  if (!outDir) { console.error('usage: code-blind.mjs <out-dir> --inputs <file.json>'); process.exit(2); }
  const BLIND_TICKET = need(I, 'blind.ticket');
  const BATCHES = need(I, 'blind.expected_batches');
  const SESSIONS = need(I, 'blind.sessions');
  const BASELINE_FILE = need(I, 'baseline_3nov_file');
  const cutoffMs = blindCutoff(I);
  const sessionFor = (b) => {
    const s = SESSIONS.find((x) => x.batches.includes(b));
    if (!s) throw new Error(`batch ${b} is in no session in the inputs file`);
    return s.name;
  };

  const frozen = (rel) => readFileSync(path.join(outDir, rel), 'utf8');

  // ---- merges (frozen git lists) ----
  const merges = [];
  const lists = [['LinearViewer', 'git/merges-LinearViewer.tsv'], ['simple-dispatcher', 'git/merges-simple-dispatcher.tsv'], ['LinearViewer', BASELINE_FILE]];
  // The pair-baseline's Oct merge list (LIN-4333 v2): loaded only when the inputs name one, so pair-baseline
  // commit labels from 20 Oct - 1 Nov can resolve. v1 names none, so v1 loads exactly the three lists above.
  if (I.oct_merges) lists.push(['LinearViewer', need(I, 'oct_merges.file')]);
  for (const [repo, file] of lists) {
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
  // Comments posted after the inputs' cutoff stay in the raw file and are left out of the coding (LIN-4333 v2).
  const blind = comments.filter((c) => /^## Blind place scoring, /.test(c.body || '') && !postsAfter(c.createdAt, cutoffMs))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const SCORE = { better: 1, neutral: 0, mixed: 0, worse: -1 };
  const cleanCell = (s) => (s || '').replace(/\*\*/g, '').trim();
  const passes = [];
  const unresolved = [];

  for (const c of blind) {
    const lines = c.body.split('\n');
    const title = lines[0].replace(/^## Blind place scoring, /, '').trim();
    const parsed = parseTitle(title, BATCHES);
    const isBatch = parsed.kind === 'batch';
    const id = parsed.id;
    const subjectTickets = parsed.subject_tickets;
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
      const tickets = isBatch
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
      kind: isBatch ? 'batch' : parsed.kind === 'pair-baseline' ? 'pair-baseline' : 'single-or-area',
      title,
      ...(parsed.kind === 'pair-baseline' ? { subject: parsed.subject } : {}),
      comment_id: c.id,
      created_at: c.createdAt,
      session: isBatch ? sessionFor(parsed.batch) : `pass ${id}`,
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
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
