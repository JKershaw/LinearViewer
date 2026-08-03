#!/usr/bin/env node
/**
 * scripts/delivery-composition.mjs
 *
 * "Did delivery fall, and if so what replaced it?" — a read-only, network-free
 * read of delivery throughput and its COMPOSITION, built entirely from local git
 * history across both repositories. No proxy calls, no LLM, no schema change.
 *
 * Written for the 2026-08-03 Recent Headwinds review, which had to answer a
 * question the prior runs could not: git merge cadence tracks throughput, not
 * forward delivery (the 07-09 run's own honesty gate), so a commit count alone
 * cannot say whether output fell. This script reports four substrates side by
 * side so the reader can see where they disagree:
 *
 *   1. TICKETS LANDED  — distinct LIN-#### ids whose FIRST citing commit falls in
 *      the week. The closest available proxy for "a unit of work reached code".
 *   2. RAW COMMITS     — every commit. Inflated or deflated by merge policy.
 *   3. MAINLINE UNITS  — `git log --first-parent`: one unit per merged PR,
 *      INVARIANT to squash-vs-merge. This is the honest delivery substrate.
 *   4. COMPOSITION     — lines changed, split production / test / docs by path.
 *
 * Why (3) matters: between June and July this repo's merge mix moved from ~92%
 * squash to ~25%. A squash PR contributes one raw commit; a merge PR contributes
 * one plus its whole branch. Raw commit counts across that boundary are not
 * comparable, and reading them as throughput inverts the conclusion. Any future
 * run comparing across 2026-06/07 must use --first-parent or repeat the error.
 *
 * KNOWN LIMITS, stated so they are not rediscovered:
 *  - A ticket parked in plan-review that never reaches code produces NO commit,
 *    so it is invisible to every count here. Sessions burned on it are unmeasured
 *    by this script (they are visible via /api/proxy/issues/{id}/cost).
 *  - The most recent week is RIGHT-CENSORED: its tickets are still accruing
 *    commits. `--skip-partial` (default) drops any week whose tickets have a
 *    commit within 3 days of the cutoff.
 *  - "Test" is a PATH heuristic, not a semantic one.
 *
 * Usage:
 *   node scripts/delivery-composition.mjs [--repo <path>]... [--weeks 16]
 *                                         [--since YYYY-MM-DD] [--json]
 * Defaults to the current repo plus ../simple-dispatcher when it exists.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const repos = [];
let weeks = 16;
let since = '2026-01-01';
let asJson = false;
let skipPartial = true;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--repo') repos.push(args[++i]);
  else if (args[i] === '--weeks') weeks = Number(args[++i]);
  else if (args[i] === '--since') since = args[++i];
  else if (args[i] === '--json') asJson = true;
  else if (args[i] === '--include-partial') skipPartial = false;
}

if (repos.length === 0) {
  repos.push(process.cwd());
  const sibling = path.resolve(process.cwd(), '..', 'simple-dispatcher');
  if (existsSync(path.join(sibling, '.git'))) repos.push(sibling);
}

const git = (repo, gitArgs) => {
  try {
    return execFileSync('git', ['-C', repo, ...gitArgs], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    console.error(`git failed in ${repo}: ${err.message}`);
    return '';
  }
};

/** Monday of the ISO week containing `iso` (a YYYY-MM-DD string). */
const weekOf = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;         // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
};

const isTest = (p) => /(^|\/)tests?\//i.test(p) || /\.(test|spec)\./i.test(p)
  || /(^|\/)(e2e|fixtures)\//i.test(p) || /playwright/i.test(p);
const isDoc = (p) => /\.md$/i.test(p) || /(^|\/)docs\//i.test(p) || /claude\.md$/i.test(p);

const tickets = new Map();                      // LIN-id -> { first, last }
const raw = new Map(), mainline = new Map();
const lines = new Map();                        // week -> {code,test,doc}
const bump = (m, k, f, n = 1) => {
  if (!m.has(k)) m.set(k, { code: 0, test: 0, doc: 0 });
  m.get(k)[f] += n;
};

for (const repo of repos) {
  // subjects — ticket attribution + raw cadence
  for (const line of git(repo, ['log', `--since=${since}`, '--date=short',
    '--pretty=format:%ad|%s']).split('\n')) {
    const i = line.indexOf('|');
    if (i < 0) continue;
    const date = line.slice(0, i), subject = line.slice(i + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    raw.set(weekOf(date), (raw.get(weekOf(date)) || 0) + 1);
    for (const id of new Set(subject.match(/\bLIN-\d+\b/g) || [])) {
      const cur = tickets.get(id);
      if (!cur) tickets.set(id, { first: date, last: date });
      else {
        if (date < cur.first) cur.first = date;
        if (date > cur.last) cur.last = date;
      }
    }
  }
  // first-parent — merge-policy-invariant delivery units
  for (const d of git(repo, ['log', '--first-parent', `--since=${since}`,
    '--date=short', '--pretty=format:%ad']).split('\n')) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) mainline.set(weekOf(d), (mainline.get(weekOf(d)) || 0) + 1);
  }
  // numstat — composition
  let cur = null;
  for (const line of git(repo, ['log', '--no-merges', `--since=${since}`, '--date=short',
    '--pretty=format:C|%ad', '--numstat']).split('\n')) {
    if (line.startsWith('C|')) { cur = weekOf(line.slice(2)); continue; }
    if (!line.trim() || !cur) continue;
    const [a, d, p] = line.split('\t');
    if (a === undefined || a === '-' || d === '-' || !p) continue;
    bump(lines, cur, isTest(p) ? 'test' : isDoc(p) ? 'doc' : 'code', Number(a) + Number(d));
  }
}

const landed = new Map();
for (const { first } of tickets.values()) {
  landed.set(weekOf(first), (landed.get(weekOf(first)) || 0) + 1);
}

// Two DIFFERENT incompleteness problems, deliberately not conflated — getting this
// wrong once already inverted a conclusion, so the distinction is load-bearing:
//
//  (a) PARTIAL week — the week has not finished as of the last commit in history,
//      so every count in it is simply short. This is the one worth dropping.
//  (b) STILL-ACCRUING week — the week HAS finished, so its ticket-landing count is
//      FINAL (a ticket lands in the week of its first commit, whatever happens
//      afterwards), but its tickets may still gain commits, so any commits-PER-ticket
//      ratio for it reads low. Advisory only. Do NOT drop the row: that throws away a
//      complete ticket count to fix a ratio, and silently shortens the window.
const cutoff = [...tickets.values()].reduce((m, t) => (t.last > m ? t.last : m), '0000-00-00');
const lastFullWeek = (() => {
  const d = new Date(`${weekOf(cutoff)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);              // the week before the one containing cutoff
  return d.toISOString().slice(0, 10);
})();
const stillLive = new Map();
for (const { first, last } of tickets.values()) {
  const w = weekOf(first);
  const days = (new Date(cutoff) - new Date(last)) / 86400000;
  if (!stillLive.has(w)) stillLive.set(w, { live: 0, total: 0 });
  stillLive.get(w).total++;
  if (days <= 3) stillLive.get(w).live++;
}

const allWeeks = [...new Set([...landed.keys(), ...raw.keys(), ...mainline.keys()])].sort();
const rows = allWeeks.map((w) => {
  const l = lines.get(w) || { code: 0, test: 0, doc: 0 };
  const sl = stillLive.get(w) || { live: 0, total: 0 };
  return {
    week: w,
    tickets: landed.get(w) || 0,
    commits: raw.get(w) || 0,
    mainline: mainline.get(w) || 0,
    code: l.code, test: l.test, docs: l.doc,
    testShare: l.code + l.test ? +(l.test / (l.code + l.test) * 100).toFixed(1) : 0,
    partial: w > lastFullWeek,
    accruing: sl.total > 0 && sl.live / sl.total > 0.5,
  };
}).filter((r) => !(skipPartial && r.partial)).slice(-weeks);

if (asJson) {
  console.log(JSON.stringify({ repos, rows }, null, 1));
} else {
  console.log(`\nrepos: ${repos.join(', ')}`);
  console.log('(the unfinished current week is dropped; --include-partial keeps it.'
    + ' ~ marks a week still accruing commits: its ticket count is final, its per-ticket ratio reads low)\n');
  console.log('week          tickets  commits  mainline    code    test  test%');
  for (const r of rows) {
    console.log(`  ${r.week}  ${String(r.tickets).padStart(6)} ${String(r.commits).padStart(8)}`
      + ` ${String(r.mainline).padStart(9)} ${String(r.code).padStart(7)} ${String(r.test).padStart(7)}`
      + ` ${String(r.testShare).padStart(5)}${r.accruing ? '  ~' : ''}`);
  }
  if (rows.length >= 8) {
    const A = rows.slice(-8, -4), B = rows.slice(-4);
    const avg = (rs, k) => rs.reduce((s, r) => s + r[k], 0) / rs.length;
    const pct = (a, b) => (a ? `${((b - a) / a * 100).toFixed(0)}%` : 'n/a');
    console.log(`\n  4-week windows: ${A[0].week}.. vs ${B[0].week}..`);
    for (const k of ['tickets', 'commits', 'mainline', 'code', 'test']) {
      const a = avg(A, k), b = avg(B, k);
      console.log(`    ${k.padEnd(9)} ${a.toFixed(1).padStart(9)} -> ${b.toFixed(1).padStart(9)}   ${pct(a, b).padStart(6)}`);
    }
    const pa = avg(A, 'mainline') / avg(A, 'tickets'), pb = avg(B, 'mainline') / avg(B, 'tickets');
    console.log(`    ${'per-ticket'.padEnd(9)} ${pa.toFixed(2).padStart(8)} -> ${pb.toFixed(2).padStart(9)}   ${pct(pa, pb).padStart(6)}`
      + '   <- mainline units per ticket (merge-policy invariant)');
  }
  console.log('');
}
