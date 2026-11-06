#!/usr/bin/env node
// analyse.mjs — LIN-4315. Derives evidence-table.tsv and analysis.json from ONE frozen folder.
// It makes no network call and no git call; every input is a file in the folder:
//   manifest.json, git/*.tsv|json|md, comments/LIN-4150.json, issue/, cost/, blind-codes.json, roles.json
// Byte-identical on re-run from the same folder. Each number in the paper is a key in analysis.json,
// with its n.
//
// Usage: node docs/papers/harbour/cleaner-than-it-started-scripts/analyse.mjs <evidence-dir> --inputs <file.json>
// Every version-specific value (window, pins for the Periodical windows, blind ticket and batch sessions,
// per-ticket notes, cost-group patterns, named costs) comes from the inputs file. Why v1's inputs live in
// this folder and not in v1's evidence folder is in inputs.mjs.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { takeInputs, need, blindCutoff, postsAfter } from './inputs.mjs';
import { selectPairs, isProductionFile } from './pair-rule.mjs';

const { inputs: I, positional } = takeInputs(process.argv.slice(2), 'analyse.mjs <evidence-dir>');
const dir = positional[0];
if (!dir) { console.error('usage: analyse.mjs <evidence-dir> --inputs <file.json>'); process.exit(2); }
const WINDOW_START = need(I, 'window_start');
const BLIND_TICKET = need(I, 'blind.ticket');
const SESSIONS = need(I, 'blind.sessions');
const BLIND_BASELINE_NOTE = need(I, 'blind.baseline_note');
const BASELINE_FILE = need(I, 'baseline_3nov_file');
const LV_END = need(I, 'periodicals.linearviewer_end');          // the Periodical windows end here (LinearViewer)
const SD_RUN2 = need(I, 'periodicals.simple_dispatcher_run2');   // Drift run 2 grounding (simple-dispatcher)
const SD_RUN3 = need(I, 'periodicals.simple_dispatcher_run3');   // Drift run 3 and Comprehension-Debt run 5 (simple-dispatcher)
const TICKET_NOTES = need(I, 'ticket_notes');
const COST_GROUPS = need(I, 'cost_groups');
const FIVE_NOV_RE = new RegExp(need(I, 'cost_groups.five_nov_and_ordinary'));
const FAKE_DOM_GROUP = need(I, 'fake_dom_piece_group');
const NAMED_COSTS = need(I, 'named_costs');
const cutoffMs = blindCutoff(I);                       // v2 only; null for v1
// The pair_baseline section (LIN-4333 v2) is emitted only when the inputs name one. Its selection rule and
// expected pairs are the v2 subtask's work; this gate only makes room for the section.
const PAIR_ENABLED = I.pair_baseline !== undefined;
const SURVEY_ON = I.survey_recount !== undefined;            // v2 only
const V1_ON = I.v1_reference !== undefined;                  // v2 only: v1's frozen analysis, read for the comparison
const V2_COMPARE = SURVEY_ON && V1_ON;
const POST_AF55_ON = I.periodicals?.linearviewer_seams_run9 !== undefined; // v2 only
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..', '..');
const V1_PATH = V1_ON ? path.resolve(REPO_ROOT, I.v1_reference) : null;
const read = (rel) => readFileSync(path.join(dir, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const manifest = readJson('manifest.json');
const roles = readJson('roles.json');
const blind = readJson('blind-codes.json');
const census = readJson('git/census-by-merge.json');
const ledger = read('git/place-ledger.at-pin.snapshot');

const tsvRows = (rel) => read(rel).split('\n').slice(1).filter(Boolean).map((l) => {
  const [full, short, committed, subject] = l.split('\t');
  return { full, short, committed, subject };
});
const lvMerges = tsvRows('git/merges-LinearViewer.tsv').map((m) => ({ ...m, repo: 'LinearViewer' })).reverse();
const sdMerges = tsvRows('git/merges-simple-dispatcher.tsv').map((m) => ({ ...m, repo: 'simple-dispatcher' })).reverse();
const lvCommitted = (s) => (lvMerges.find((m) => m.full.startsWith(s)) || {}).committed;
const sdCommitted = (s) => (sdMerges.find((m) => m.full.startsWith(s)) || {}).committed;
const AF55_COMMITTED = lvCommitted(LV_END);
const D8D_COMMITTED = sdCommitted(SD_RUN2);
const baselineMerges = tsvRows(BASELINE_FILE).map((m) => ({ ...m, repo: 'LinearViewer' })).reverse();

// ---- pair baseline (LIN-4334): the rule run on the frozen Oct list. A mismatch with expected_pairs throws here,
// before any output is written; the rule is never tuned to fit. ----
let pairSelection = null;
if (PAIR_ENABLED) {
  const octRows = read(need(I, 'oct_merges.file')).split('\n').slice(1).filter(Boolean).map((l) => {
    const [full, short, committed, subject, files = ''] = l.split('\t');
    return { full, short, committed, subject, files: files.split(',').filter(Boolean) };
  });
  const rule = need(I, 'pair_baseline.rule_params');
  const selected = selectPairs(octRows, rule);
  const expected = need(I, 'pair_baseline.expected_pairs');
  const labels = selected.map((p) => p.label);
  if (JSON.stringify(labels) !== JSON.stringify(expected)) {
    throw new Error(`pair rule selected ${JSON.stringify(labels)}, not expected_pairs ${JSON.stringify(expected)}. Stop and report the mismatch; the rule is not tuned to fit.`);
  }
  const candidates = octRows.filter((m) => m.files.some((f) => isProductionFile(f, rule.production))).length;
  pairSelection = { octRows, selected, candidates, matchesExpected: true };
}

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
const pairPasses = [];   // kind 'pair-baseline': no ticket, kept out of the subjects loop and areaFor (LIN-4333)
for (const p of blind.passes) {
  if (p.kind === 'batch') for (const r of p.rows) batchRows.push({ pass: p.id, session: p.session, row: r.row, sign: r.sign, score: r.score, tickets: r.tickets, shas: r.shas.map((s) => s.full), note: r.note ?? null, commit_cell: r.commit_cell, balance_raw: r.balance_raw, quote: r.quote });
  else if (p.kind === 'pair-baseline') pairPasses.push({ id: p.id, subject: p.subject, sign: p.rows[0]?.sign ?? null, score: p.rows[0]?.score ?? null, rows: p.rows.length });
  else singlePasses.push({ id: p.id, subject_tickets: p.subject_tickets, title: p.title, shas: p.rows.flatMap((r) => r.shas.map((x) => x.full)), sign: p.rows[0]?.sign ?? null, score: p.rows[0]?.score ?? null, balance_raw: p.rows[0]?.balance_raw ?? null, quote: p.rows[0]?.quote ?? null, leans: p.rows[0]?.leans ?? null });
}
// Pair passes with no inputs naming a pair_baseline section would be dropped silently. Refuse instead.
if (pairPasses.length && !PAIR_ENABLED) {
  throw new Error(`blind-codes.json holds ${pairPasses.length} pair-baseline pass(es), but the inputs file does not name a pair_baseline section`);
}

// ---- the LIN-4150 survey and after-answer facts ----
// Comments posted after the inputs' cutoff are kept in the raw file and left out of every reading (LIN-4333 v2).
const blindComments = readJson(`comments/${BLIND_TICKET}.json`).comments.filter((c) => !postsAfter(c.createdAt, cutoffMs));
const surveyOnBlind = new Set();
for (const c of blindComments) {
  const h = (c.body || '').split('\n')[0];
  if (/^## Survey/.test(h)) for (const m of h.matchAll(/LIN-(\d+)/g)) surveyOnBlind.add(`LIN-${m[1]}`);
}

// ---- rows ----
const rowsAll = [];
const inWindow = (m) => m.committed >= WINDOW_START;
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
// An area reading belongs to the merges its passes cite. In v2 that is the rule; v1 keeps its ticket rule, so its
// evidence table is unchanged. (LIN-4334: afe9074f is a LIN-4254 merge that LIN-4254's area read, BE/BF, does not cite.)
const areaFor = (ticket, full) => singlePasses.filter((p) => p.subject_tickets && p.subject_tickets.includes(ticket) && (!V2_COMPARE || p.shas.includes(full)));

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
const NOTE = TICKET_NOTES;

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
  const sl = [surveyOnBlind.has(t) ? BLIND_TICKET : null, ownSurvey ? 'own ticket' : null].filter(Boolean).join(' + ') || 'none found';
  const unsurveyedByLedger = (roles.unsurveyed_by_ledger ?? []).includes(t);
  const b = batchFor(m.full);
  const bA = b.find((x) => x.session === SESSIONS[0].name) ?? null;
  const bC = b.find((x) => x.session === SESSIONS[1].name) ?? null;
  const areas = areaFor(t, m.full).map((p) => `${p.id}:${p.sign ?? 'none'}`);
  const cs = costState(t ? costOf(t) : null);
  const cen = censusBySha.get(m.full);
  const per = m.repo === 'LinearViewer'
    ? (m.committed <= AF55_COMMITTED ? `covered: Periodical windows through ${LV_END}` : `none (after ${LV_END})`)
    : `Comprehension-Debt run 5 (SD to ${SD_RUN3})` + (m.committed > D8D_COMMITTED ? `; Drift run 3 (${SD_RUN2}..${SD_RUN3})` : `; Drift run 2 grounding at ${SD_RUN2} (window start not stated)`);
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
const BASE = new Set(Object.entries(ROLE).filter(([, v]) => v.group.startsWith(COST_GROUPS.baseline)).map(([k]) => k));
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
const pass1 = batchSummary(SESSIONS[0].name);
const pass2 = batchSummary(SESSIONS[1].name);

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
const fakeDomPieces = ROLE && Object.entries(ROLE).filter(([, v]) => v.group.startsWith(FAKE_DOM_GROUP)).map(([k]) => k);
const pieceCost = fakeDomPieces.map((t) => costState(costOf(t)).total);
const ledgerDollarCheck = table.filter((r) => r.code_notebook_note.includes('vs live')).map((r) => ({ ticket: r.primary_ticket, note: r.code_notebook_note }));


// ---- v2 sections (LIN-4334). Each is emitted only when its inputs key is present; v1 emits none of them. ----
const headOfComment = (c) => (c.body || '').split('\n')[0];
const namesTicket = (head, t) => new RegExp(`\\bLIN-${t.slice(4)}\\b`).test(head);

// The Survey rule. A ticket is visible when a '## Survey' heading naming it is on the ticket itself or on the
// blind-read ticket. The any-time rule (v1's) is that test with no bound on time; the pre-work rule is the same
// test, with the comment posted before the ticket's first merge in the population. Computed on any folder, so the
// same code gives v1's numbers from v1's frozen folder and v2's from this one.
function surveyVisibility(folder, allRows, blindCs, placeTickets) {
  const firstMerge = new Map();
  for (const r of allRows) {
    if (!r.ticket) continue;
    if (!firstMerge.has(r.ticket) || Date.parse(r.committed) < Date.parse(firstMerge.get(r.ticket))) firstMerge.set(r.ticket, r.committed);
  }
  const blindSurveys = blindCs.filter((c) => /^## Survey/.test(headOfComment(c)));
  const per = new Map();
  for (const t of placeTickets) {
    const f = path.join(folder, `issue/${t}.json`);
    const own = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')).comments || []) : [];
    const posted = [
      ...own.filter((c) => /^## Survey/.test(headOfComment(c)) && namesTicket(headOfComment(c), t)),
      ...blindSurveys.filter((c) => namesTicket(headOfComment(c), t)),
    ].map((c) => c.createdAt);
    const pre = posted.filter((ts) => Date.parse(ts) < Date.parse(firstMerge.get(t)));
    per.set(t, { any: posted.length > 0, pre_work: pre.length > 0 });
  }
  return per;
}

function surveyRecountSection(v1Path) {
  const v2Place = [...new Set(place.map((r) => r.primary_ticket))].filter(Boolean);
  const v2All = table.map((r) => ({ ticket: r.primary_ticket, committed: r.committed, role: r.role }));
  const v2 = surveyVisibility(dir, v2All, blindComments, v2Place);

  // The same rule on v1's own frozen folder: v1's evidence table names the rows, its issue/ and comments/ hold the raw reads.
  const v1Dir = path.dirname(v1Path);
  const v1Lines = readFileSync(path.join(v1Dir, 'evidence-table.tsv'), 'utf8').split('\n').filter(Boolean);
  const h = v1Lines[0].split('\t');
  const col = (n) => h.indexOf(n);
  const v1Rows = v1Lines.slice(1).map((l) => l.split('\t')).map((c) => ({ ticket: c[col('primary_ticket')], committed: c[col('committed')], role: c[col('role')] }));
  const v1Place = [...new Set(v1Rows.filter((r) => r.role === 'place').map((r) => r.ticket))].filter(Boolean);
  const v1Blind = JSON.parse(readFileSync(path.join(v1Dir, `comments/${BLIND_TICKET}.json`), 'utf8')).comments || [];
  const v1Vis = surveyVisibility(v1Dir, v1Rows, v1Blind, v1Place);

  const countOf = (m, f) => [...m.values()].filter(f).length;
  const v1Any = countOf(v1Vis, (x) => x.any);
  const v1Pre = countOf(v1Vis, (x) => x.pre_work);
  const v2Any = countOf(v2, (x) => x.any);
  const v2Pre = countOf(v2, (x) => x.pre_work);
  return {
    place_tickets: { v1_data: v1Place.length, v2_data: v2Place.length },
    v1_data: { visible_any_time: v1Any, visible_pre_work: v1Pre, n: v1Place.length },
    v2_data: { visible_any_time: v2Any, visible_pre_work: v2Pre, n: v2Place.length },
    split: {
      more_comments_visible: { n: v2Any - v1Any },            // v1 rule on v2 data minus v1 rule on v1 data
      stricter_rule: { n: v2Pre - v2Any },                     // pre-work rule minus v1 rule, both on v2 data
      v1_to_v2_pre_work: { n: v2Pre - v1Any },
    },
    pre_work_gained_by_v1_tickets: { n: [...v1Vis.keys()].filter((t) => !v1Vis.get(t).pre_work && v2.get(t)?.pre_work).length, tickets: [...v1Vis.keys()].filter((t) => !v1Vis.get(t).pre_work && v2.get(t)?.pre_work) },
    pre_work_on_new_tickets: { n: [...v2.keys()].filter((t) => !v1Vis.has(t) && v2.get(t).pre_work).length, tickets: [...v2.keys()].filter((t) => !v1Vis.has(t) && v2.get(t).pre_work) },
    visible_only_after_merge_v2: [...v2.keys()].filter((t) => v2.get(t).any && !v2.get(t).pre_work),
    visible_only_after_merge_v1: [...v1Vis.keys()].filter((t) => v1Vis.get(t).any && !v1Vis.get(t).pre_work),
    v1_finding_9_reference: '17 of 59 (paper Finding 9, v1 frozen data)',
    v1_rule_reproduces_17: v1Any === 17,
  };
}

// The v1 numbers this v2 is compared with, read from v1's frozen analysis.json (path in the inputs).
function v1VsV2Section(v1, v2, surveyRec) {
  const pair = (a, b) => ({ v1: a, v2: b });
  return {
    blind_passes_total: pair(v1.blind_reads.passes_total, v2.blind_reads.passes_total),
    linearviewer_merges_in_window: pair(v1.inputs.merges_in_window.LinearViewer, v2.inputs.merges_in_window.LinearViewer),
    place_tickets: pair(v1.surveys.place_tickets, v2.surveys.place_tickets),
    place_rows: pair(v1.costs.place_rows, v2.costs.place_rows),
    census_last_count: pair(v1.census.last?.count ?? null, v2.census.last?.count ?? null),
    single_ticket_subjects: pair(v1.single_and_area_reads.single_ticket_subjects, v2.single_and_area_reads.single_ticket_subjects),
    pair_or_area_subjects: pair(v1.single_and_area_reads.pair_or_area_subjects, v2.single_and_area_reads.pair_or_area_subjects),
    both_passes_better_count: pair(v1.single_and_area_reads.both_passes_better_count, v2.single_and_area_reads.both_passes_better_count),
    tickets_with_visible_survey: pair(v1.surveys.place_tickets - v1.surveys.tickets_with_no_survey_found.length, v2.surveys.place_tickets - v2.surveys.tickets_with_no_survey_found.length),
    survey_visible_any_time_rule: pair(surveyRec.v1_data.visible_any_time, surveyRec.v2_data.visible_any_time),
    survey_visible_pre_work_rule: pair(surveyRec.v1_data.visible_pre_work, surveyRec.v2_data.visible_pre_work),
  };
}

// The merges after af55cb73 (v1's last Periodical window end), and which later Periodical windows read each.
function postAf55Section() {
  const s9 = Date.parse(lvCommitted(need(I, 'periodicals.linearviewer_seams_run9')));
  const d5 = Date.parse(lvCommitted(need(I, 'periodicals.linearviewer_drift_run5')));
  const after = lvMerges.filter(inWindow).filter((m) => Date.parse(m.committed) > Date.parse(AF55_COMMITTED));
  const rows = after.map((m) => {
    const t = primaryTicket(m.subject);
    const ts = Date.parse(m.committed);
    return { short_sha: m.short, committed: m.committed, primary_ticket: t, role: (roles.merge_overrides?.[m.short.slice(0, 8)] ?? ROLE[t])?.role ?? 'unclassified', read_by_seams_run9: ts <= s9, read_by_drift_run5: ts <= d5, subject: m.subject.slice(0, 80) };
  });
  return {
    merges: { n: rows.length },
    read_by_seams_run9: { n: rows.filter((r) => r.read_by_seams_run9).length },
    read_by_drift_run5: { n: rows.filter((r) => r.read_by_drift_run5).length },
    read_by_neither: { n: rows.filter((r) => !r.read_by_seams_run9 && !r.read_by_drift_run5).length },
    read_by_neither_place: { n: rows.filter((r) => !r.read_by_seams_run9 && !r.read_by_drift_run5 && r.role === 'place').length },
    rows,
  };
}

// A cross-check, not an input: the area and single tally against plan-review note 8's recount. Differences are
// reported as they are, never tuned away.
function crossCheckSection() {
  const areas = subjectList.filter((s) => s.kind === 'pair or area');
  const singles = subjectList.filter((s) => s.kind === 'single ticket');
  const areaTickets = new Set(areas.flatMap((s) => s.tickets));
  const expected = { areas: 9, singles: 16, areas_all_better: true };
  const baseRows = place.filter((r) => r.group.startsWith(COST_GROUPS.baseline));
  const loopRows = place.filter((r) => !r.group.startsWith(COST_GROUPS.baseline));
  return {
    place_rows: {
      n: place.length,
      baseline: { n: baseRows.length },
      loop: { n: loopRows.length, LinearViewer: loopRows.filter((r) => r.repo === 'LinearViewer').length, 'simple-dispatcher': loopRows.filter((r) => r.repo === 'simple-dispatcher').length },
    },
    areas: { n: areas.length, both_better: { n: areas.filter((s) => s.both_better).length }, subjects: areas.map((s) => `${s.subject}:${s.reading}`) },
    singles: { n: singles.length, both_better: { n: singles.filter((s) => s.both_better).length }, subjects: singles.map((s) => `${s.subject}:${s.reading}`) },
    area_readings_over_tickets: { readings: areas.length, tickets: areaTickets.size },
    plan_review_note_8_expected: expected,
    differs: [
      ...(areas.length !== expected.areas ? [`areas ${areas.length}, expected ${expected.areas}`] : []),
      ...(singles.length !== expected.singles ? [`singles ${singles.length}, expected ${expected.singles}`] : []),
      ...(areas.every((s) => s.both_better) === expected.areas_all_better ? [] : ['not all areas better/better']),
    ],
  };
}

// The pair baseline (LIN-4334): the rule run on the frozen Oct list (above), and what the passes read. Each pass
// is checked against the pair the rule picked for its number: the commits its rows cite must be that pair's.
function pairBaselineSection() {
  const bySubject = new Map();
  for (const p of pairPasses) {
    if (!bySubject.has(p.subject)) bySubject.set(p.subject, []);
    bySubject.get(p.subject).push({ id: p.id, sign: p.sign, score: p.score, rows: p.rows });
  }
  const citedFull = (subject) => new Set(blind.passes.filter((b) => b.kind === 'pair-baseline' && b.subject === subject).flatMap((b) => b.rows.flatMap((r) => r.shas.map((s) => s.full))));
  const selected = pairSelection.selected;
  const subjects = [...bySubject].map(([subject, passes]) => {
    const n = Number(subject.match(/(\d+)$/)[1]);
    const pick = selected[n - 1];
    const cited = citedFull(subject);
    return {
      subject,
      passes,
      both_better: passes.length === 2 && passes.every((x) => x.sign === 'better'),
      selected_pair: pick.label,
      cites_selected_pair: cited.size === 2 && cited.has(pick.first.full) && cited.has(pick.second.full),
    };
  }).sort((a, b) => a.subject.localeCompare(b.subject));
  const commits = selected.flatMap((p) => [p.first, p.second]);
  const times = commits.map((m) => Date.parse(m.committed));
  return {
    selection: {
      merges_in_frozen_list: { n: pairSelection.octRows.length },
      production_candidates: { n: pairSelection.candidates },
      pairs: { n: selected.length, labels: selected.map((p) => p.label), matches_expected: pairSelection.matchesExpected },
      selected: selected.map((p) => ({
        pair: p.label,
        first: { short: p.first.short, committed: p.first.committed, subject: p.first.subject.slice(0, 60) },
        second: { short: p.second.short, committed: p.second.committed, subject: p.second.subject.slice(0, 60) },
        shared_production_files: p.first.files.filter((f) => p.second.files.includes(f) && isProductionFile(f, need(I, 'pair_baseline.rule_params.production'))),
      })),
      commits_in_pairs: { n: commits.length, earliest: new Date(Math.min(...times)).toISOString(), latest: new Date(Math.max(...times)).toISOString() },
    },
    readings: {
      passes_total: { n: pairPasses.length },
      subjects_count: { n: subjects.length },
      both_better_count: { n: subjects.filter((s) => s.both_better).length },
      all_passes_cite_selected_pair: { n: subjects.filter((s) => s.cites_selected_pair).length },
      subjects,
    },
  };
}

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
    note: BLIND_BASELINE_NOTE,
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
    at_af55cb73: censusLadder.find((c) => c.short.startsWith(LV_END)) ?? null,
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
    ...Object.fromEntries(Object.entries(NAMED_COSTS).map(([key, t]) => [key, costState(costOf(t)).total])),
  },
  surveys: {
    place_tickets: placeTickets.length,
    tickets_with_survey_on_own_ticket: tk(place, (r) => r.survey_location.includes('own ticket')).length,
    tickets_with_survey_on_LIN_4150: tk(place, (r) => r.survey_location.includes(BLIND_TICKET)).length,
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
    median_usd_baseline: median(place.filter((r) => r.group.startsWith(COST_GROUPS.baseline) && r.cost_usd !== null).map((r) => r.cost_usd)),
    median_usd_forward_4Nov: median(place.filter((r) => r.group.startsWith(COST_GROUPS.forward) && r.cost_usd !== null).map((r) => r.cost_usd)),
    // Rows whose group is a 5 Nov read, the LIN-4255 fake-DOM pieces or an ordinary feature (n given).
    median_usd_5Nov_groups: { n: place.filter((r) => FIVE_NOV_RE.test(r.group) && r.cost_usd !== null).length, median: median(place.filter((r) => FIVE_NOV_RE.test(r.group) && r.cost_usd !== null).map((r) => r.cost_usd)) },
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
  // Each v2 section is emitted only when its inputs key is present. v1's inputs name none, so v1 emits none.
  ...(PAIR_ENABLED ? { pair_baseline: pairBaselineSection() } : {}),
  ...(V2_COMPARE ? { survey_recount: surveyRecountSection(V1_PATH) } : {}),
  ...(POST_AF55_ON ? { post_af55cb73: postAf55Section() } : {}),
  ...(SURVEY_ON ? { cross_check: crossCheckSection() } : {}),
};
if (V1_ON) {
  analysis.inputs_sha256['v1 analysis.json'] = createHash('sha256').update(readFileSync(V1_PATH)).digest('hex');
}
if (V2_COMPARE) analysis.v1_vs_v2 = v1VsV2Section(JSON.parse(readFileSync(V1_PATH, 'utf8')), analysis, analysis.survey_recount);
writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
console.error(`rows ${table.length}; place ${place.length}; unclassified ${unclassified.length}; subjects ${subjectList.length}`);
