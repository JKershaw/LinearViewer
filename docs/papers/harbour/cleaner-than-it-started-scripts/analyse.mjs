#!/usr/bin/env node
// analyse.mjs — LIN-4315. Derives evidence-table.tsv and analysis.json from ONE frozen folder.
// It makes no network call and no git call; every input is a file in the folder:
//   manifest.json, git/*.tsv|json|md, comments/LIN-4150.json, issue/, cost/, blind-codes.json, roles.json
// Byte-identical on re-run from the same folder. Each number in the paper is a key in analysis.json,
// with its n.
//
// Usage: node docs/papers/harbour/cleaner-than-it-started-scripts/analyse.mjs <evidence-dir>

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: analyse.mjs <evidence-dir>'); process.exit(2); }
const read = (rel) => readFileSync(path.join(dir, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const manifest = readJson('manifest.json');
const roles = readJson('roles.json');
const blind = readJson('blind-codes.json');
const census = readJson('git/census-by-merge.json');
const ledger = read('git/place-ledger.at-pin.snapshot');
const LV_AF55 = 'af55cb73';   // the Periodical windows end here (LinearViewer)
const SD_D8D = 'd8d186c';     // Drift run 2 grounding (simple-dispatcher)
const SD_07C = '07c88f7';     // Drift run 3 and Comprehension-Debt run 5 (simple-dispatcher)

const tsvRows = (rel) => read(rel).split('\n').slice(1).filter(Boolean).map((l) => {
  const [full, short, committed, subject] = l.split('\t');
  return { full, short, committed, subject };
});
const lvMerges = tsvRows('git/merges-LinearViewer.tsv').map((m) => ({ ...m, repo: 'LinearViewer' })).reverse();
const sdMerges = tsvRows('git/merges-simple-dispatcher.tsv').map((m) => ({ ...m, repo: 'simple-dispatcher' })).reverse();
const lvCommitted = (s) => (lvMerges.find((m) => m.full.startsWith(s)) || {}).committed;
const sdCommitted = (s) => (sdMerges.find((m) => m.full.startsWith(s)) || {}).committed;
const AF55_COMMITTED = lvCommitted(LV_AF55);
const D8D_COMMITTED = sdCommitted(SD_D8D);
const baselineMerges = tsvRows('git/merges-LinearViewer-2026-11-02-03.tsv').map((m) => ({ ...m, repo: 'LinearViewer' })).reverse();

const ROLE = roles.tickets;
const issueOf = (id) => { const f = `issue/${id}.json`; return existsSync(path.join(dir, f)) ? readJson(f) : null; };
const costOf = (id) => { const f = `cost/${id}.json`; return existsSync(path.join(dir, f)) ? readJson(f) : null; };

const primaryTicket = (subject) => { const m = subject.match(/\bLIN-(\d+)\b/); return m ? `LIN-${m[1]}` : null; };
const pr = (subject) => { const m = subject.match(/\(#(\d+)\)\s*$/); return m ? Number(m[1]) : null; };

// ---- census by merge ----
const censusBySha = new Map(census.merges.map((m) => [m.sha, m]));

// ---- blind codes: index batch rows and single/area passes ----
const batchRows = [];   // { pass, session, row, sign, score, tickets, shas }
const singlePasses = []; // { id, subject_tickets, title, sign (row 1), balance_raw, quote }
for (const p of blind.passes) {
  if (p.kind === 'batch') for (const r of p.rows) batchRows.push({ pass: p.id, session: p.session, row: r.row, sign: r.sign, score: r.score, tickets: r.tickets, shas: r.shas.map((s) => s.full), note: r.note ?? null, commit_cell: r.commit_cell, balance_raw: r.balance_raw, quote: r.quote });
  else singlePasses.push({ id: p.id, subject_tickets: p.subject_tickets, title: p.title, sign: p.rows[0]?.sign ?? null, score: p.rows[0]?.score ?? null, balance_raw: p.rows[0]?.balance_raw ?? null, quote: p.rows[0]?.quote ?? null, leans: p.rows[0]?.leans ?? null });
}

// ---- the LIN-4150 survey and after-answer facts ----
const l4150 = readJson('comments/LIN-4150.json').comments;
const surveyOn4150 = new Set();
for (const c of l4150) {
  const h = (c.body || '').split('\n')[0];
  if (/^## Survey/.test(h)) for (const m of h.matchAll(/LIN-(\d+)/g)) surveyOn4150.add(`LIN-${m[1]}`);
}

// ---- rows ----
const rowsAll = [];
const inWindow = (m) => m.committed >= '2026-11-04T00:00:00Z';
const merges = [
  ...lvMerges.filter(inWindow),
  ...sdMerges.filter(inWindow),
  ...baselineMerges.filter((m) => {
    const t = primaryTicket(m.subject);
    return t && ROLE[t] && ['place', 'ui-context'].includes(ROLE[t].role);
  }),
];
const unclassified = [];
for (const m of merges) {
  const t = primaryTicket(m.subject);
  const ov = roles.merge_overrides?.[m.short.slice(0, 8)];
  const r = ov ?? ROLE[t] ?? null;
  if (!r) unclassified.push(`${m.repo} ${m.short} ${t}`);
  rowsAll.push({ m, t, r });
}

// signs by commit
const batchFor = (full) => batchRows.filter((b) => b.shas.includes(full));
const areaFor = (ticket) => singlePasses.filter((p) => p.subject_tickets && p.subject_tickets.includes(ticket));

// costs
function costState(c) {
  if (!c) return { total: null, state: 'no read' };
  if (c.noLineage) return { total: null, state: 'unknown (noLineage)' };
  if (c.totalUsd === null && (c.noTelemetryCount ?? 0) > 0) return { total: null, state: 'unknown (no telemetry)' };
  if (c.totalUsd === null && (c.unpriced ?? []).length) return { total: null, state: `partial (unpriced: ${c.unpriced.join(', ')})` };
  if (c.totalUsd === null) return { total: null, state: 'unknown' };
  return { total: Math.round(c.totalUsd * 100) / 100, state: 'exact' };
}

// ledger balance history: the last cell of every row that names the ticket
const ledgerRows = {};
let section = '';
let balanceCol = -1;   // index of the column named Balance (or Ledger, in the blind-scorer tables)
let areaTable = false;  // the Area tables carry cost in dollars and no balance column
for (const line of ledger.split('\n')) {
  if (line.startsWith('## ')) { section = line.replace(/^## /, '').split(':')[0].trim(); balanceCol = -1; areaTable = false; continue; }
  if (!line.startsWith('|')) { balanceCol = -1; areaTable = false; continue; }
  if (line.startsWith('|---')) continue;
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
  if (/^(Ticket|\|?\s*\|)/.test(cells[0]) || cells[0] === '' || cells[0] === 'Area') {
    if (cells[0] === 'Area') { areaTable = true; balanceCol = -1; continue; }
    // a header row: find the balance column by name
    const idx = cells.findIndex((c) => /^(Balance|Ledger)\b/i.test(c));
    if (idx >= 0 && cells[0] === 'Ticket') balanceCol = idx;   // the balance column of a per-ticket table
    else if (cells[0] === '' && idx >= 0) balanceCol = idx;
    continue;
  }
  const tickets = cells.map((c) => (c.match(/LIN-(\d+)/) || [])[1]).filter(Boolean).map((n) => `LIN-${n}`);
  if (!tickets.length) continue;
  if (balanceCol < 0 && !areaTable) continue;   // no header with a Balance/Ledger column: not a ledger balance
  const dollars = cells.map((c) => (c.match(/\$(\d+\.\d\d)/) || [])[1]).filter(Boolean);
  const balance = areaTable ? '(area table: cost only)' : (cells[balanceCol] ?? '').replace(/\*\*/g, '');
  tickets.forEach((t, i) => {
    (ledgerRows[t] ??= []).push({ section, balance, dollars: dollars[i] !== undefined && dollars.length >= tickets.length ? dollars[i] : null });
  });
}
// code/notebook notes (checked in the frozen data; each one is re-derived below where it can be)
const NOTE = {
  'LIN-4254': 'notebook and ticket say 22 (16 movable + 6 stop); the census file at 1d10f9b3 has 18 (12 movable + 6 stop)',
  'LIN-4307': 'the notebook ends at 08:00 UTC 6 Nov and still lists the LIN-4307 rulings as held; the code has LIN-4307 merged',
  'LIN-4253': 'lib/stage-writes.js is not placed on scripts/code-shape/areas.json (research §L9)',
};

// ---- rows out ----
const table = [];
const survey = {};
for (const { m, t, r } of rowsAll) {
  const iss = t ? issueOf(t) : null;
  const own = iss ? (iss.comments || []) : [];
  const headOf = (c) => (c.body || '').split('\n')[0];
  const ownSurvey = own.some((c) => /^## Survey (open-\d|global)/.test(headOf(c)));
  const afterAnswer = own.some((c) => /Survey 1a|round 3|\(after\)/i.test(headOf(c)));
  const scope = iss ? (/How to go about it/.test(iss.description || '') ? 'present' : 'absent') : 'n/a';
  const sl = [surveyOn4150.has(t) ? 'LIN-4150' : null, ownSurvey ? 'own ticket' : null].filter(Boolean).join(' + ') || 'none found';
  const unsurveyedByLedger = (roles.unsurveyed_by_ledger ?? []).includes(t);
  const b = batchFor(m.full);
  const bA = b.find((x) => x.session.startsWith('pass-1')) ?? null;
  const bC = b.find((x) => x.session.startsWith('pass-2')) ?? null;
  const areas = areaFor(t).map((p) => `${p.id}:${p.sign ?? 'none'}`);
  const cs = costState(t ? costOf(t) : null);
  const cen = censusBySha.get(m.full);
  const per = m.repo === 'LinearViewer'
    ? (m.committed <= AF55_COMMITTED ? 'covered: Periodical windows through af55cb73' : 'none (after af55cb73)')
    : `Comprehension-Debt run 5 (SD to ${SD_07C})` + (m.committed > D8D_COMMITTED ? '; Drift run 3 (d8d186c..07c88f7)' : '; Drift run 2 grounding at d8d186c (window start not stated)');
  const led = t ? (ledgerRows[t] ?? []) : [];
  // ledger dollar figures against the frozen live cost (history, not an input)
  const ledgerUsd = led.map((x) => x.dollars).filter((d) => d !== null);
  const costMismatch = (ledgerUsd.length && cs.total !== null)
    ? ledgerUsd.filter((d) => Math.abs(Number(d) - cs.total) > 0.005) : [];
  const row = {
    repo: m.repo, short_sha: m.short, full_sha: m.full, committed: m.committed, pr: pr(m.subject),
    primary_ticket: t, role: r?.role ?? 'unclassified', group: r?.group ?? '',
    survey_location: sl, unsurveyed_by_ledger: unsurveyedByLedger ? 'yes' : '', scope_call: scope, blind_pass_1_AB: bA ? `${bA.pass}:${bA.sign ?? 'none'}` : '',
    blind_pass_2_CD: bC ? `${bC.pass}:${bC.sign ?? 'none'}` : '', area_reads: areas.join(' '),
    ledger_balance_history: led.map((x) => `${x.section}=${x.balance}`).join(' | '),
    periodical_reads: per,
    census_count: cen?.count ?? null, census_stop: cen?.stop_count ?? null, census_movable: cen?.movable_count ?? null,
    cost_usd: cs.total, cost_state: cs.state, after_answer: afterAnswer ? 'present' : 'absent',
    ledger_usd: ledgerUsd.join('/'),
    code_notebook_note: [NOTE[t], costMismatch.length ? `ledger $${ledgerUsd.join('/')} vs live $${cs.total}` : null].filter(Boolean).join('; '),
  };
  table.push(row);
}

const cols = Object.keys(table[0]);
const tsv = [cols.join('\t'), ...table.map((r) => cols.map((c) => String(r[c] ?? '').replace(/\t|\n/g, ' ')).join('\t'))].join('\n') + '\n';
writeFileSync(path.join(dir, 'evidence-table.tsv'), tsv);

// ---- derived claims, each with n ----
const place = table.filter((r) => r.role === 'place');
const placeTickets = [...new Set(place.map((r) => r.primary_ticket))];
// ticket-level: the first row of each ticket (a ticket can have more than one merge)
const tk = (rows, f) => { const seen = new Map(); for (const r of rows) if (f(r) && !seen.has(r.primary_ticket)) seen.set(r.primary_ticket, r); return [...seen.values()]; };
const median = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return Math.round((v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) * 100) / 100; };
const mean = (xs) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;
const sumOf = (xs) => xs.reduce((a, b) => a + b, 0);
const BASE = new Set(Object.entries(ROLE).filter(([, v]) => v.group.startsWith('baseline')).map(([k]) => k));
const UI = new Set(Object.entries(ROLE).filter(([, v]) => v.role === 'ui-context').map(([k]) => k));

const UNSURVEYED = new Set(roles.unsurveyed_by_ledger ?? []);
function batchSummary(session) {
  const xs = batchRows.filter((b) => b.session === session && b.score !== null);
  const base = xs.filter((b) => b.tickets.some((t) => BASE.has(t)));
  const fwdAll = xs.filter((b) => !b.tickets.some((t) => BASE.has(t)));
  const fwd = fwdAll.filter((b) => !b.tickets.some((t) => UNSURVEYED.has(t)));
  const cnt = (arr, w) => arr.filter((b) => b.sign === w).length;
  return {
    session, signed_rows: xs.length,
    baseline: { n: base.length, sum: sumOf(base.map((b) => b.score)), mean: mean(base.map((b) => b.score)), better: cnt(base, 'better'), mixed: cnt(base, 'mixed'), neutral: cnt(base, 'neutral'), worse: cnt(base, 'worse') },
    forward_all: { n: fwdAll.length, sum: sumOf(fwdAll.map((b) => b.score)), mean: mean(fwdAll.map((b) => b.score)), better: cnt(fwdAll, 'better'), mixed: cnt(fwdAll, 'mixed'), neutral: cnt(fwdAll, 'neutral'), worse: cnt(fwdAll, 'worse') },
    forward_surveyed_as_ledger_labels: { n: fwd.length, excluded_unsurveyed: [...UNSURVEYED], sum: sumOf(fwd.map((b) => b.score)), mean: mean(fwd.map((b) => b.score)), better: cnt(fwd, 'better'), mixed: cnt(fwd, 'mixed'), neutral: cnt(fwd, 'neutral'), worse: cnt(fwd, 'worse') },
    unsigned_rows: batchRows.filter((b) => b.session === session && b.score === null).map((b) => ({ pass: b.pass, row: b.row, note: b.note })),
  };
}
const pass1 = batchSummary('pass-1 (batches A+B)');
const pass2 = batchSummary('pass-2 (batches C+D)');

// single / area passes: group into subjects of two passes each
const subjects = new Map();
for (const p of singlePasses) {
  const key = p.subject_tickets.join('+');
  if (!subjects.has(key)) subjects.set(key, { subject: key, tickets: p.subject_tickets, kind: (p.subject_tickets.length > 1 || ROLE[p.subject_tickets[0]]?.role === 'parent') ? 'pair or area' : 'single ticket', passes: [] });
  subjects.get(key).passes.push({ id: p.id, sign: p.sign, leans: p.leans });
}
const subjectList = [...subjects.values()].map((s) => {
  const signs = s.passes.map((p) => p.sign);
  return { ...s, reading: signs.join(','), both_better: signs.length === 2 && signs.every((x) => x === 'better') };
}).sort((a, b) => a.subject.localeCompare(b.subject));
const bothBetter = subjectList.filter((s) => s.both_better);
const countKind = (kind, filt) => subjectList.filter((s) => s.kind === kind && (!filt || filt(s))).length;

// census ladder
const censusLadder = census.merges.filter((m) => m.count !== null).map((m) => ({ short: m.short, committed: m.committed, count: m.count, stop: m.stop_count, movable: m.movable_count, subject: m.subject.slice(0, 60) }));

// cost states over place rows
const costStates = {};
for (const r of place) { const k = r.cost_state.split(' ')[0]; costStates[k] = (costStates[k] || 0) + 1; }
const fakeDomPieces = ROLE && Object.entries(ROLE).filter(([, v]) => v.group.startsWith('LIN-4255 fake-DOM move piece')).map(([k]) => k);
const pieceCost = fakeDomPieces.map((t) => costState(costOf(t)).total);
const ledgerDollarCheck = table.filter((r) => r.code_notebook_note.includes('vs live')).map((r) => ({ ticket: r.primary_ticket, note: r.code_notebook_note }));

const sha = (rel) => createHash('sha256').update(readFileSync(path.join(dir, rel))).digest('hex');
const analysis = {
  inputs_sha256: { 'manifest.json': sha('manifest.json'), 'roles.json': sha('roles.json'), 'blind-codes.json': sha('blind-codes.json'), 'git/census-by-merge.json': sha('git/census-by-merge.json'), 'git/place-ledger.at-pin.snapshot': sha('git/place-ledger.at-pin.snapshot') },
  grounded_at: { LinearViewer: manifest.repos.LinearViewer.pinned_sha, 'simple-dispatcher': manifest.repos['simple-dispatcher'].pinned_sha },
  window_start: manifest.window_start,
  frozen_at: manifest.freeze_finished_at,
  inputs: {
    linear_150_comments: manifest.linear_150_comments,
    merges_in_window: { LinearViewer: lvMerges.filter(inWindow).length, 'simple-dispatcher': sdMerges.filter(inWindow).length },
    rows_in_table: table.length,
    rows_by_role: table.reduce((o, r) => ({ ...o, [r.role]: (o[r.role] || 0) + 1 }), {}),
    unclassified_merges: unclassified,
    custom_prompts_frozen: manifest.custom_prompts,
    population_tickets: manifest.population_count,
  },
  blind_reads: {
    passes_total: blind.passes_count,
    batch_rows: batchRows.length,
    session_pass_1: pass1,
    session_pass_2: pass2,
    scoring: blind.scoring,
    note: 'Baseline = the ledger baseline window 015aa4c6..5334c81a (8 LinearViewer rows, all in the batches). Forward = every other row in the batches.',
  },
  single_and_area_reads: {
    passes_total: singlePasses.length,
    subjects: subjectList,
    subjects_count: subjectList.length,
    single_ticket_subjects: countKind('single ticket'),
    pair_or_area_subjects: countKind('pair or area'),
    both_passes_better: bothBetter.map((s) => s.subject),
    both_passes_better_count: bothBetter.length,
    both_better_pair_or_area: bothBetter.filter((s) => s.kind === 'pair or area').map((s) => s.subject),
    both_better_single: bothBetter.filter((s) => s.kind === 'single ticket').map((s) => s.subject),
  },
  census: {
    merges_with_census: censusLadder.length,
    first: censusLadder[0],
    at_af55cb73: censusLadder.find((c) => c.short.startsWith(LV_AF55)) ?? null,
    last: censusLadder[censusLadder.length - 1],
    ladder: censusLadder,
  },
  costs: {
    place_rows_by_state: costStates,
    place_rows: place.length,
    fake_dom_piece_tickets: fakeDomPieces.length,
    fake_dom_piece_cost_sum_usd: Math.round(sumOf(pieceCost.filter((x) => x !== null)) * 100) / 100,
    fake_dom_piece_states_not_exact: fakeDomPieces.filter((t, i) => pieceCost[i] === null).length,
    not_exact_place_tickets: tk(place, (r) => !r.cost_state.startsWith('exact')).map((r) => `${r.primary_ticket}: ${r.cost_state}`),
    LIN_4271_own_usd: costState(costOf('LIN-4271')).total,
    parent_LIN_4255_usd: costState(costOf('LIN-4255')).total,
  },
  surveys: {
    place_tickets: placeTickets.length,
    tickets_with_survey_on_own_ticket: tk(place, (r) => r.survey_location.includes('own ticket')).length,
    tickets_with_survey_on_LIN_4150: tk(place, (r) => r.survey_location.includes('LIN-4150')).length,
    tickets_with_no_survey_found: tk(place, (r) => r.survey_location === 'none found').map((r) => r.primary_ticket),
    tickets_with_scope_call: tk(place, (r) => r.scope_call === 'present').length,
    tickets_with_scope_call_absent: tk(place, (r) => r.scope_call === 'absent').map((r) => r.primary_ticket),
    tickets_with_after_answer: tk(place, (r) => r.after_answer === 'present').length,
    tickets_with_after_answer_list: tk(place, (r) => r.after_answer === 'present').map((r) => r.primary_ticket),
  },
  periodicals: {
    LinearViewer_place_rows_covered: place.filter((r) => r.repo === 'LinearViewer' && r.periodical_reads.startsWith('covered')).length,
    LinearViewer_place_rows_after_af55cb73: place.filter((r) => r.repo === 'LinearViewer' && r.periodical_reads.startsWith('none')).length,
    simple_dispatcher_place_rows_drift_run3: place.filter((r) => r.repo === 'simple-dispatcher' && r.periodical_reads.includes('Drift run 3')).length,
    simple_dispatcher_place_rows_total: place.filter((r) => r.repo === 'simple-dispatcher').length,
  },
  cost_medians: {
    place_exact_rows: place.filter((r) => r.cost_usd !== null).length,
    median_usd_all_place_exact: median(place.filter((r) => r.cost_usd !== null).map((r) => r.cost_usd)),
    median_usd_baseline: median(place.filter((r) => r.group.startsWith('baseline') && r.cost_usd !== null).map((r) => r.cost_usd)),
    median_usd_forward_4Nov: median(place.filter((r) => r.group.startsWith('forward') && r.cost_usd !== null).map((r) => r.cost_usd)),
    // Rows whose group is a 5 Nov read, the LIN-4255 fake-DOM pieces or an ordinary feature (n given).
    median_usd_5Nov_groups: { n: place.filter((r) => /^5 Nov|^LIN-4255 fake|^ordinary/.test(r.group) && r.cost_usd !== null).length, median: median(place.filter((r) => /^5 Nov|^LIN-4255 fake|^ordinary/.test(r.group) && r.cost_usd !== null).map((r) => r.cost_usd)) },
    // One exact cost per ticket: the first place row per primary_ticket that has one (n = tickets).
    median_usd_per_ticket_exact: (() => {
      const seen = new Map();
      for (const r of place) if (r.cost_usd !== null && !seen.has(r.primary_ticket)) seen.set(r.primary_ticket, r.cost_usd);
      const vals = [...seen.values()];
      return { n: vals.length, median: median(vals) };
    })(),
  },
  tidy_after_pairs: (roles.tidy_after_pairs ?? []).map(([parent, child]) => {
    const pc = costState(costOf(parent)).total, cc = costState(costOf(child)).total;
    return { parent, child, parent_usd: pc, child_usd: cc, child_share_of_parent: pc && cc ? Math.round((cc / pc) * 1000) / 1000 : null };
  }),
  ledger_vs_code: ledgerDollarCheck,
  ledger_usd_rows: table.filter((r) => r.ledger_usd).map((r) => ({ ticket: r.primary_ticket, ledger_usd: r.ledger_usd, live_usd: r.cost_usd })),
  notes: NOTE,
};
writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
console.error(`rows ${table.length}; place ${place.length}; unclassified ${unclassified.length}; subjects ${subjectList.length}`);
