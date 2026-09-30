#!/usr/bin/env node
/**
 * LIN-3169 — Jev progress-estimation eval: can TypeSafe's Jev estimate how far through a task is,
 * as a 10-band probability curve (a "fuzzy progress bar")?
 *
 * Standalone research infra, like jev-spike.mjs / jev-routing-eval.mjs: nothing here is wired into
 * lib/. Findings and the full method: jev-progress-README.md and jev-progress-out/report.md.
 *
 * Population: completed tasks with 3–12 agent WORK sessions (autopilot/wake driver sessions
 * excluded), from dispatch telemetry (GET /api/proxy/issues/{id}/cost → workerSessions). Each task
 * is frozen just before work session k+1 of N (comments cut at that session's dispatchedAt).
 * Truth = k/N. Split dev/test by a hash of the identifier; all tuning on dev.
 * Configs = view (how the task is rendered as Jev `state`) × question (how progress is asked).
 *
 *   HARBOUR_PROXY_TOKEN=… node scripts/eval/jev-progress-eval.mjs fetch     # issues + session history
 *   HARBOUR_PROXY_TOKEN=… ALLK=1 node scripts/eval/jev-progress-eval.mjs build   # snapshots (fetches issue bodies)
 *   OPENROUTER_API_KEY=… ALLK=1 SPLIT=dev CONFIGS=rawnf:rem2 node scripts/eval/jev-progress-eval.mjs run
 *   ALLK=1 SPLIT=dev node scripts/eval/jev-progress-eval.mjs report [filter]
 *
 * Env: JEV_PROGRESS_DATA (cache dir, default data/jev-progress — git-ignored: it holds live task
 * text and raw answers), HARBOUR_BASE (default https://harbour.cat), ALLK (every session boundary
 * instead of k≈25/50/75% of N), SNAPF (snapshot file override), SPLIT, CONFIGS, CONC, COMBO,
 * FETCH_LIMIT (completed issues to fetch session history for, newest first; default 420).
 * Results cache in results.jsonl keyed by config|snapshot, so iteration only pays for new cells.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(process.env.JEV_PROGRESS_DATA || join(HERE, '../../data/jev-progress'));
export const F = (n) => join(DATA, n);

// ── workspace proxy (read-only use) ───────────────────────────────────────────────────────────
const PROXY = `${process.env.HARBOUR_BASE || 'https://harbour.cat'}/api/proxy`;
async function px(path) {
  const token = process.env.HARBOUR_PROXY_TOKEN;
  if (!token) throw new Error('Set HARBOUR_PROXY_TOKEN (a read-scoped workspace proxy token)');
  for (let a = 0; a < 5; a++) {
    const r = await fetch(PROXY + path, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 5000 * (a + 1))); continue; }
    const t = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${path}: ${t.slice(0, 200)}`);
    return JSON.parse(t);
  }
  throw new Error('429 gave up ' + path);
}
const readJson = (n, dflt) => (existsSync(F(n)) ? JSON.parse(readFileSync(F(n), 'utf8')) : dflt);

// All issues, then session history (workerSessions) for the newest FETCH_LIMIT completed ones.
// The proxy allows 60 req/min; history before ~late Aug 2026 has no session telemetry.
async function fetchData() {
  mkdirSync(DATA, { recursive: true });
  let after = '', all = [];
  for (let p = 0; p < 40; p++) {
    const r = await px(`/issues?limit=250${after ? '&after=' + encodeURIComponent(after) : ''}`);
    all.push(...r.issues); if (!r.pageInfo?.hasNextPage) break; after = r.pageInfo.endCursor;
  }
  writeFileSync(F('issues.json'), JSON.stringify(all));
  const out = readJson('costs.json', {});
  const num = (i) => +i.identifier.split('-')[1];
  const done = all.filter((i) => i.state?.type === 'completed' && !(i.identifier in out)).sort((a, b) => num(b) - num(a)).slice(0, Number(process.env.FETCH_LIMIT || 420));
  let n = 0;
  for (const i of done) {
    try { out[i.identifier] = (await px(`/issues/${i.identifier}/cost`)).workerSessions || []; } catch (e) { out[i.identifier] = { err: e.message.slice(0, 80) }; }
    if (++n % 25 === 0) { writeFileSync(F('costs.json'), JSON.stringify(out)); console.log(n, i.identifier); }
    await new Promise((s) => setTimeout(s, 1050));
  }
  writeFileSync(F('costs.json'), JSON.stringify(out));
  console.log('issues', all.length, 'session histories', Object.keys(out).length);
}
export const SNAPF = process.env.SNAPF || (process.env.ALLK ? 'snapshots-allk.json' : 'snapshots.json');
const DRIVER = new Set(['autopilot', 'wake']);
const BINS = Array.from({ length: 10 }, (_, i) => i);
const MID = BINS.map((i) => i * 10 + 5);
const split = (id) => (createHash('sha1').update(id).digest()[0] % 2 === 0 ? 'dev' : 'test');

// ── snapshots ────────────────────────────────────────────────────────────────────────────────
// The description is TODAY's version; close-outs append "## Shipped" etc. Strip post-hoc material
// so a frozen snapshot is not shown its own ending.
const POSTHOC = /^(shipped|landed|close-?out|closed|resolution|merged|done|status|verification|result)\b/i;
export function scrub(desc) {
  const out = []; let skipLevel = 0;
  for (const line of desc.split('\n')) {
    const h = line.match(/^(#{1,6})\s*(.*)$/);
    if (h) {
      if (skipLevel && h[1].length <= skipLevel) skipLevel = 0;
      if (!skipLevel && POSTHOC.test(h[2].replace(/[*_`]/g, '').trim())) { skipLevel = h[1].length; continue; }
    }
    if (skipLevel) continue;
    if (/^\s*(>\s*)?(\*\*|__)?\s*(shipped|landed|merged|closed out|done)\b[^a-z]/i.test(line)) continue;
    out.push(line.replace(/\[[xX]\]/g, '[ ]'));
  }
  // completion stubs also get appended inside other sections: drop any paragraph carrying them
  const LEAK = /merge commit|merged (as|via|in|into)|landed in|shipped in|what shipped|completion stub|closed out|close-out summary|\bmerged\b.{0,40}\bPR\b|\bPR\b.{0,60}\bmerged\b/i;
  return out.join('\n').split(/\n\s*\n/).filter((p) => !LEAK.test(p)).join('\n\n');
}
const sentences = (t, n) => (t.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) || [t]).slice(0, n).join(' ').trim();
export function doneLooksLike(desc) {
  const m = desc.match(/^#{1,6}\s*(acceptance[^\n]*|done when[^\n]*|definition of done[^\n]*|success criteria[^\n]*|exit criteria[^\n]*|goal[^\n]*|expected[^\n]*)\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/im);
  const body = (m ? m[2] : desc.replace(/^#.*$/gm, '')).replace(/[`*_>#]/g, '').replace(/^\s*[-*]\s*\[ \]\s*/gm, '').trim();
  return { source: m ? 'acceptance-section' : 'description-opening', text: sentences(body, 2).slice(0, 400) };
}
async function build() {
  const costs = readJson('costs.json', {});
  const cache = readJson('issue-cache.json', {});
  const snaps = [];
  for (const [id, v] of Object.entries(costs)) {
    if (!Array.isArray(v)) continue;
    const work = v.filter((s) => !DRIVER.has(s.kind)).sort((a, b) => a.dispatchedAt.localeCompare(b.dispatchedAt));
    if (work.length < 3 || work.length > 12) continue;
    if (!cache[id]) {
      try { cache[id] = await px(`/issues/${id}`); } catch (e) { console.log('skip', id, e.message.slice(0, 60)); continue; }
      writeFileSync(F('issue-cache.json'), JSON.stringify(cache));
      await new Promise((s) => setTimeout(s, 1000));
    }
    const iss = cache[id], N = work.length;
    const ks = process.env.ALLK ? Array.from({ length: N - 1 }, (_, i) => i + 1) : [...new Set([0.25, 0.5, 0.75].map((f) => Math.min(N - 1, Math.max(1, Math.round(N * f)))))];
    for (const k of ks) {
      const cut = work[k].dispatchedAt;
      snaps.push({
        sid: `${id}@${k}`, id, k, N, truth: (k / N) * 100, split: split(id),
        title: iss.title, labels: iss.labels || [], description: scrub(iss.description || ''), done: doneLooksLike(scrub(iss.description || '')),
        comments: (iss.comments || []).filter((c) => c.createdAt < cut).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((c) => ({ at: c.createdAt, body: c.body || '' })),
        sessions: work.slice(0, k).map((w) => ({ kind: w.kind, at: w.dispatchedAt, minutes: Math.round((w.durationMs || 0) / 60000) })),
      });
    }
  }
  writeFileSync(F(SNAPF), JSON.stringify(snaps));
  const c = (s) => snaps.filter((x) => x.split === s);
  console.log('snapshots', snaps.length, 'dev', c('dev').length, `(${new Set(c('dev').map((x) => x.id)).size} issues)`, 'test', c('test').length, `(${new Set(c('test').map((x) => x.id)).size} issues)`);
}

// ── views: how the task is rendered as `state` ───────────────────────────────────────────────
const cap = (s, n) => (s.length > n ? s.slice(0, n) + ' …[truncated]' : s);
const head = (b, n = 400) => cap(b.replace(/\s+/g, ' ').trim(), n);
const d = (iso) => iso.slice(0, 16).replace('T', ' ');
const sessLine = (s) => `${s.kind} (${s.minutes}m)`;
function fitComments(comments, per, total) {
  let out = comments.map((c) => ({ at: c.at, body: cap(c.body, per) }));
  while (out.reduce((s, c) => s + c.body.length, 0) > total && out.length > 2) out.splice(1, 1); // drop oldest-but-first
  return out;
}
function facts(s) {
  const kinds = s.sessions.map((x) => x.kind), byKind = {};
  for (const k of kinds) byKind[k] = (byKind[k] || 0) + 1;
  const all = s.comments.map((c) => c.body).join('\n');
  const last = s.comments.at(-1)?.body || '';
  const lastImpl = kinds.lastIndexOf('implementation');
  return {
    workSessionsRun: kinds.length, sessionsByKind: byKind, sessionSequence: kinds.join(' > '),
    lastSessionKind: kinds.at(-1) || null,
    sessionsSinceLastImplementation: lastImpl < 0 ? null : kinds.length - 1 - lastImpl,
    reviewSessions: byKind.review || 0,
    commentCount: s.comments.length,
    requestChangesMentions: (all.match(/request(ed)?[ -]changes/gi) || []).length,
    approveMentions: (all.match(/\bapprove[ds]?\b/gi) || []).length,
    prMentioned: /\bPR\b|pull\/\d+/i.test(all), mergedMentioned: /\bmerged\b/i.test(all),
    ciGreenMentioned: /CI[^\n]{0,20}green|green CI|all checks pass/i.test(all),
    lastCommentHeadline: head(last, 200),
  };
}
// Workspace norms: computed from the dev split's session histories (see computeNorms); frozen here as
// the text every tuned config saw. KIND_NORMS / NORMS_LO / NORMS_HI are the round-5 and sensitivity probes.
const NORMS = 'In this workspace a task usually takes 4 to 7 agent work sessions in total (median 5). After the first implementation session a median of 3 more sessions follow; after the first review session, a median of 2 more (fixes, re-reviews, close-out).';
const KIND_NORMS = 'Typical number of MORE work sessions after the most recent session, by its kind (median, middle half): after research 5 (4-7); after plan 5 (4-6); after plan-review 5 (3-7); after implementation 2 (2-4); after review 1 (1-3); after close-out 2 (2-3), because a close-out sometimes reopens work.';
const NORMS_LO = 'In this workspace a task usually takes 2 to 4 agent work sessions in total (median 3). After the first implementation session a median of 1 more session follows; after the first review session, a median of 1 more (the close-out).';
const NORMS_HI = 'In this workspace a task usually takes 7 to 12 agent work sessions in total (median 9). After the first implementation session a median of 6 more sessions follow; after the first review session, a median of 4 more (fixes, re-reviews, close-out).';
export function computeNorms(workLists) { // workLists: array of each task's work-session kinds, in order
  const q = (a, p) => { a = [...a].sort((x, y) => x - y); return a[Math.floor(p * (a.length - 1))]; };
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]; // upper median, as the tuned NORMS text used
  const Ns = workLists.map((w) => w.length);
  const after = (k) => workLists.map((w) => w.indexOf(k)).map((i, j) => (i < 0 ? null : workLists[j].length - 1 - i)).filter((x) => x != null);
  return { n: workLists.length, p25: q(Ns, 0.25), median: med(Ns), p75: q(Ns, 0.75), afterImpl: med(after('implementation')), afterReview: med(after('review')) };
}
export function normsText(n) { return `In this workspace a task usually takes ${n.p25} to ${n.p75} agent work sessions in total (median ${n.median}). After the first implementation session a median of ${n.afterImpl} more sessions follow; after the first review session, a median of ${n.afterReview} more (fixes, re-reviews, close-out).`; }
export function flags(s) {
  const verdictOf = (b) => (/request(ed)?[ -]changes/i.test(b) ? 'request-changes' : /\bapprove[ds]?\b/i.test(b) && /review/i.test(b) ? 'approve' : null);
  let latestReviewVerdict = null;
  for (const c of s.comments) { const v = verdictOf(c.body.slice(0, 400)); if (v) latestReviewVerdict = v; }
  const all = s.comments.map((c) => c.body).join('\n');
  return { prOpened: /\bPR\b|pull\/\d+/i.test(all), latestReviewVerdict, reviewRoundsSoFar: s.sessions.filter((x) => x.kind === 'review').length };
}
export const VIEWS = {
  // round 1a: full-text views
  raw: (s) => ({ identifier: s.id, title: s.title, labels: s.labels, description: cap(s.description, 8000), comments: fitComments(s.comments, 6000, 60000) }),
  rawsess: (s) => ({ ...VIEWS.raw(s), agentSessionsRun: s.sessions }),
  md: (s) => [`# ${s.title}`, `Labels: ${s.labels.join(', ') || 'none'}`, '', '## Description', cap(s.description, 8000), '',
    `## Agent work sessions run so far (${s.sessions.length})`, s.sessions.map((x, i) => `${i + 1}. ${d(x.at)} ${sessLine(x)}`).join('\n'), '',
    '## Comments (oldest first; the last is the current state)', ...fitComments(s.comments, 6000, 60000).map((c) => `### ${d(c.at)}\n${c.body}`)].join('\n'),
  nodesc: (s) => ({ title: s.title, agentSessionsRun: s.sessions, comments: fitComments(s.comments, 6000, 60000) }),
  heads: (s) => ({ title: s.title, description: cap(s.description, 2000), agentSessionsRun: s.sessions.map(sessLine), comments: s.comments.map((c) => `${d(c.at)} ${head(c.body)}`) }),
  timeline: (s) => {
    const ev = [...s.sessions.map((x) => ({ at: x.at, t: `[agent session: ${sessLine(x)}]` })), ...s.comments.map((c) => ({ at: c.at, t: `[comment] ${head(c.body)}` }))].sort((a, b) => a.at.localeCompare(b.at));
    return [`# ${s.title}`, '', cap(s.description, 2000), '', '## Timeline (oldest first; the last entry is the current state)', ...ev.map((e) => `${d(e.at)} ${e.t}`)].join('\n');
  },
  last2: (s) => ({ title: s.title, description: cap(s.description, 2000), agentSessionsRun: s.sessions.map(sessLine), latestComments: s.comments.slice(-2).map((c) => cap(c.body, 6000)) }),
  // minimal ladder: each rung adds one layer of metadata
  t: (s) => ({ title: s.title }),
  tm: (s) => ({ title: s.title, labels: s.labels, workSessionsRun: s.sessions.length, sessionSequence: s.sessions.map((x) => x.kind).join(' > ') }),
  tmc: (s) => ({ ...VIEWS.tm(s), commentCount: s.comments.length, daysSinceFirstSession: +((Date.parse(s.sessions.at(-1).at) - Date.parse(s.sessions[0].at)) / 864e5).toFixed(1) }),
  tmh: (s) => ({ ...VIEWS.tmc(s), latestCommentHeadline: head(s.comments.at(-1)?.body || '', 200) }),
  // round 2: workspace norms (computed from the dev split only) and prose-free flags
  tmn: (s) => ({ ...VIEWS.tm(s), workspaceNorms: NORMS }),
  tmf: (s) => ({ ...VIEWS.tm(s), ...flags(s) }),
  tmnf: (s) => ({ ...VIEWS.tm(s), ...flags(s), workspaceNorms: NORMS }),
  tmhnf: (s) => ({ ...VIEWS.tmh(s), ...flags(s), workspaceNorms: NORMS }),
  tmnfl: (s) => ({ ...VIEWS.tm(s), ...flags(s), workspaceNorms: NORMS, latestComment: cap(s.comments.at(-1)?.body || '', 1500) }),
  tmnfl4: (s) => ({ ...VIEWS.tm(s), ...flags(s), workspaceNorms: NORMS, latestComment: cap(s.comments.at(-1)?.body || '', 4000) }),
  tmnfl8: (s) => ({ ...VIEWS.tm(s), ...flags(s), workspaceNorms: NORMS, latestComment: cap(s.comments.at(-1)?.body || '', 8000) }),
  tmnfl2c: (s) => ({ ...VIEWS.tm(s), ...flags(s), workspaceNorms: NORMS, latestComments: s.comments.slice(-2).map((c) => cap(c.body, 4000)) }),
  tmnfld: (s) => ({ ...VIEWS.tm(s), ...flags(s), workspaceNorms: NORMS, description: cap(s.description, 2000), latestComment: cap(s.comments.at(-1)?.body || '', 4000) }),
  // round 4-5: full context under the remaining-sessions question (rawnf:rem2 is the winner)
  rawnf: (s) => ({ ...VIEWS.raw(s), agentSessionsRun: s.sessions.map((x) => x.kind), ...flags(s), workspaceNorms: NORMS }),
  rawnfk: (s) => ({ ...VIEWS.rawnf(s), remainingSessionNormsByLastKind: KIND_NORMS }),
  rawnfs: (s) => ({ ...VIEWS.raw(s), agentSessionsRun: s.sessions, ...flags(s), workspaceNorms: NORMS }),
  mdnf: (s) => [VIEWS.md(s), '', '## Signals', JSON.stringify(flags(s)), '', '## Workspace norms', NORMS].join('\n'),
  timelinenf: (s) => [VIEWS.timeline(s), '', '## Signals', JSON.stringify(flags(s)), '', '## Workspace norms', NORMS].join('\n'),
  tlfull: (s) => {
    const ev = [...s.sessions.map((x) => ({ at: x.at, t: `[agent session: ${sessLine(x)}]` })), ...fitComments(s.comments, 6000, 60000).map((c) => ({ at: c.at, t: `[comment]\n${c.body}` }))].sort((a, b) => a.at.localeCompare(b.at));
    return [`# ${s.title}`, '', cap(s.description, 8000), '', '## Timeline (oldest first; the last entry is the current state)', ...ev.map((e) => `${d(e.at)} ${e.t}`), '', '## Signals', JSON.stringify(flags(s)), '', '## Workspace norms', NORMS].join('\n');
  },
  // norms sensitivity (none / too lean / too heavy) and the drift test (rolling / frozen / oracle)
  rawf0: (s) => ({ ...VIEWS.raw(s), agentSessionsRun: s.sessions.map((x) => x.kind), ...flags(s) }),
  rawnfLo: (s) => ({ ...VIEWS.rawf0(s), workspaceNorms: NORMS_LO }),
  rawnfHi: (s) => ({ ...VIEWS.rawf0(s), workspaceNorms: NORMS_HI }),
  rawnfRoll: (s) => ({ ...VIEWS.rawf0(s), workspaceNorms: s.norms.roll }),
  rawnfFrozen: (s) => ({ ...VIEWS.rawf0(s), workspaceNorms: s.norms.frozen }),
  rawnfOracle: (s) => ({ ...VIEWS.rawf0(s), workspaceNorms: s.norms.oracle }),
  // "what complete looks like" (first two sentences of the Acceptance / Done-when section)
  tmnd: (s) => ({ ...VIEWS.tm(s), doneLooksLike: s.done.text, workspaceNorms: NORMS }),
  tmd: (s) => ({ ...VIEWS.tm(s), doneLooksLike: s.done.text }),
  tmhd: (s) => ({ ...VIEWS.tmh(s), doneLooksLike: s.done.text }),
  facts: (s) => ({ title: s.title, ...facts(s) }),
  factsraw: (s) => ({ ...facts(s), task: VIEWS.raw(s) }),
};

// ── questions ───────────────────────────────────────────────────────────────────────────────
// stage/neutral/score/scorestage ask "what % is done"; cdf asks nine "at least X%?" yes/nos; rem/rem2
// ask how many MORE work sessions remain and map each answer r to band floor(10·k/(k+r)).
const BASE = 'This is a software task in an issue tracker, frozen at one moment before it was finished. Agent work sessions (research, plan, implementation, review, close-out…) are dispatched on it one at a time until it closes; reviews often send work back for more implementation.';
const STAGE = ['Nothing done yet: filed, not scoped or started', 'Being scoped or investigated; approach not settled', 'Approach or plan settled; implementation not started', 'Implementation just started; small part of the change exists', 'Implementation roughly a third to half done', 'Implementation about half done', 'Most of the implementation exists; gaps or failing checks remain', 'Change complete and proposed (PR open) but not yet verified or reviewed', 'Verified and in review; only approval, merge or small fixes remain', 'Merged, shipped or closed; nothing meaningful remains'];
const NEUTRAL = BINS.map((i) => `Between ${i * 10}% and ${i * 10 + 10}% of all the work this task will need before it closes is already done`);
const REM2 = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9-11': 10, '12+': 13 };
const REM = { '1': 1, '2': 2, '3': 3, '4': 4, '5-6': 5.5, '7-9': 8, '10+': 12 };
const INSTR = {
  q: `${BASE} How much of the total work this task will need before it closes is already done?`,
  rem: `${BASE} How many MORE agent work sessions will this task need before it closes? Count every future session, including reviews, fixes after review, and the close-out.`,
};
export const toBins = (probsByBand) => { const z = probsByBand.reduce((a, b) => a + b, 0) || 1; return probsByBand.map((x) => x / z); };
export const QUESTIONS = {
  stage: { q: { p: { type: 'choice', instructions: INSTR.q, criteria: Object.fromEntries(BINS.map((i) => [`${i * 10}-${i * 10 + 10}%`, STAGE[i]])) } }, map: (a) => toBins(BINS.map((i) => a.p.probabilities[`${i * 10}-${i * 10 + 10}%`] || 0)) },
  neutral: { q: { p: { type: 'choice', instructions: INSTR.q, criteria: Object.fromEntries(BINS.map((i) => [`${i * 10}-${i * 10 + 10}%`, NEUTRAL[i]])) } }, map: (a) => toBins(BINS.map((i) => a.p.probabilities[`${i * 10}-${i * 10 + 10}%`] || 0)) },
  score: { q: { p: { type: 'score', instructions: INSTR.q, criteria: NEUTRAL } }, map: (a) => toBins(BINS.map((i) => scoreProb(a.p, i))) },
  scorestage: { q: { p: { type: 'score', instructions: INSTR.q, criteria: STAGE } }, map: (a) => toBins(BINS.map((i) => scoreProb(a.p, i))) },
  rem: {
    q: { p: { type: 'choice', instructions: INSTR.rem, criteria: Object.fromEntries(Object.keys(REM).map((r) => [r, `${r} more work session${r === '1' ? '' : 's'} before the task closes`])) } },
    map: (a, s) => { const b = Array(10).fill(0); for (const [r, v] of Object.entries(REM)) b[Math.min(9, Math.floor((s.k / (s.k + v)) * 10))] += a.p.probabilities[r] || 0; return toBins(b); },
  },
  rem2: {
    q: { p: { type: 'choice', instructions: INSTR.rem, criteria: Object.fromEntries(Object.keys(REM2).map((r) => [r, `${r} more work session${r === '1' ? '' : 's'} before the task closes`])) } },
    map: (a, s) => { const b = Array(10).fill(0); for (const [r, v] of Object.entries(REM2)) b[Math.min(9, Math.floor((s.k / (s.k + v)) * 10))] += a.p.probabilities[r] || 0; return toBins(b); },
  },
  cdf: {
    q: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => [`t${t}`, { type: 'noul', instructions: `${BASE} Is at least ${t * 10}% of the total work this task will need before it closes already done?`, criteria: { true: `At least ${t * 10}% of the work is done`, false: `Less than ${t * 10}% of the work is done` } }])),
    map: (a) => { const S = [1]; for (let t = 1; t <= 9; t++) S.push(Math.min(S.at(-1), a[`t${t}`].noul)); S.push(0); return toBins(BINS.map((i) => S[i] - S[i + 1])); },
  },
};
function scoreProb(ans, i) { // score levels may be keyed 1..n or 0..n-1
  const p = ans.probabilities || {}; const keys = Object.keys(p).map(Number).sort((a, b) => a - b);
  return p[String(keys[0] + i)] || 0;
}

// ── transport ────────────────────────────────────────────────────────────────────────────────
async function decide(state, questions) {
  for (let a = 0; a < 6; a++) {
    const t0 = performance.now();
    const r = await fetch('https://openrouter.ai/api/alpha/decisions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'typesafe/jev-1.13', state, questions }) });
    const ms = Math.round(performance.now() - t0), t = await r.text();
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1000 * 2 ** a)); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
    return { ...JSON.parse(t), ms };
  }
  throw new Error('gave up');
}

async function run() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('Set OPENROUTER_API_KEY');
  const snaps = JSON.parse(readFileSync(F(SNAPF))).filter((s) => s.split === (process.env.SPLIT || 'dev'));
  const done = loadResults();
  const configs = process.env.CONFIGS.split(',');
  const jobs = [];
  for (const cfg of configs) for (const s of snaps) if (!done[`${cfg}|${s.sid}`]) jobs.push([cfg, s]);
  console.log('jobs', jobs.length);
  let cost = 0, n = 0, errs = 0;
  const worker = async () => {
    while (jobs.length) {
      const [cfg, s] = jobs.shift(); const [v, q] = cfg.split(':');
      try {
        const r = await decide(VIEWS[v](s), QUESTIONS[q].q);
        const dist = QUESTIONS[q].map(r.answers, s);
        cost += r.usage?.cost || 0;
        appendFileSync(F('results.jsonl'), JSON.stringify({ cfg, sid: s.sid, dist: dist.map((x) => +x.toFixed(4)), cost: r.usage?.cost, tok: r.usage?.input_tokens, ms: r.ms }) + '\n');
      } catch (e) { errs++; if (errs < 5) console.log('ERR', cfg, s.sid, e.message.slice(0, 200)); }
      if (++n % 200 === 0) console.log(n, `$${cost.toFixed(3)}`);
    }
  };
  await Promise.all(Array.from({ length: Number(process.env.CONC || 6) }, worker));
  console.log('done', n, 'errors', errs, `cost $${cost.toFixed(4)}`);
}
export function loadResults() {
  const m = {}; if (!existsSync(F('results.jsonl'))) return m;
  for (const l of readFileSync(F('results.jsonl'), 'utf8').split('\n')) if (l) { const r = JSON.parse(l); m[`${r.cfg}|${r.sid}`] = r; }
  return m;
}

// ── metrics ──────────────────────────────────────────────────────────────────────────────────
export const ev = (dist) => dist.reduce((s, x, i) => s + x * MID[i], 0);
const sd = (dist) => { const m = ev(dist); return Math.sqrt(dist.reduce((s, x, i) => s + x * (MID[i] - m) ** 2, 0)); };
const tbin = (t) => Math.min(9, Math.floor(t / 10));
export function rps(dist, t) { const tb = tbin(t); let c = 0, s = 0; for (let i = 0; i < 9; i++) { c += dist[i]; s += (c - (i >= tb ? 1 : 0)) ** 2; } return s / 9; }
const rank = (a) => a.map((v) => a.filter((x) => x < v).length + (a.filter((x) => x === v).length - 1) / 2);
const corr = (x, y) => { const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n; const den = Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0) * y.reduce((s, v) => s + (v - my) ** 2, 0)); return den ? x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / den : 0; };
export function score(snaps, distOf) {
  const rows = snaps.map((s) => ({ s, d: distOf(s) })).filter((r) => r.d);
  if (!rows.length) return null;
  const t = rows.map((r) => r.s.truth), e = rows.map((r) => ev(r.d));
  const byId = {}; for (const r of rows) (byId[r.s.id] ||= []).push(r);
  let ok = 0, tot = 0;
  for (const rs of Object.values(byId)) for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { tot++; const dd = ev(rs[j].d) - ev(rs[i].d); ok += dd > 0.5 ? 1 : dd > -0.5 ? 0.5 : 0; }
  // 80% central interval coverage of the truth band
  const cover = rows.filter((r) => { let c = 0, lo = null, hi = null; for (let i = 0; i < 10; i++) { const prev = c; c += r.d[i]; if (lo == null && c >= 0.1) lo = i; if (hi == null && c >= 0.9) hi = i; } const tb = tbin(r.s.truth); return tb >= lo && tb <= hi; }).length;
  return {
    n: rows.length, mae: rows.reduce((s, r, i) => s + Math.abs(e[i] - t[i]), 0) / rows.length, bias: rows.reduce((s, r, i) => s + e[i] - t[i], 0) / rows.length,
    rho: corr(rank(t), rank(e)), rps: rows.reduce((s, r) => s + rps(r.d, r.s.truth), 0) / rows.length,
    order: tot ? ok / tot : null, sd: rows.reduce((s, r) => s + sd(r.d), 0) / rows.length, cover80: cover / rows.length,
  };
}
const point = (v) => { const b = Array(10).fill(0); b[tbin(v)] = 1; return b; };
const RULE = { research: 15, triage: 10, design: 20, plan: 25, 'plan-review': 30, breakdown: 30, implementation: 55, bug: 45, blocked: 50, review: 70, 'close-out': 80, custom: 50 };
export function baselines(snaps, allSnaps) {
  const trainPool = allSnaps.filter((x) => x.split === 'dev');
  // empirical history prior: truth-band histogram of OTHER dev issues with the same last session kind (+1 smoothing)
  const hist = (s, key) => { const b = Array(10).fill(0.1); for (const x of trainPool) if (x.id !== s.id && key(x) === key(s)) b[tbin(x.truth)] += 1; return toBins(b); };
  const lastKind = (x) => x.sessions.at(-1)?.kind;
  const kBucket = (x) => `${lastKind(x)}|${Math.min(x.k, 4)}`;
  return {
    'base:const50': () => point(50), 'base:uniform': () => Array(10).fill(0.1),
    'base:rule(lastKind)': (s) => point(RULE[lastKind(s)] ?? 50),
    'base:history(lastKind)': (s) => hist(s, lastKind),
    'base:history(lastKind,k)': (s) => hist(s, kBucket),
    'base:history(k)': (s) => hist(s, (x) => Math.min(x.k, 6)),
    'base:history(lastKind,k<=8)': (s) => hist(s, (x) => `${lastKind(x)}|${Math.min(x.k, 8)}`),
  };
}
function report() {
  const all = JSON.parse(readFileSync(F(SNAPF)));
  const snaps = all.filter((s) => s.split === (process.env.SPLIT || 'dev'));
  const res = loadResults(); const filter = process.argv[3] || '';
  const cfgs = [...new Set(Object.values(res).map((r) => r.cfg))].filter((c) => c.includes(filter));
  const table = [];
  for (const [name, fn] of Object.entries(baselines(snaps, all))) table.push([name, score(snaps, fn)]);
  const H = baselines(snaps, all)['base:history(lastKind,k)'];
  const avg = (a, b) => a.map((x, i) => (x + b[i]) / 2);
  const geo = (a, b) => toBins(a.map((x, i) => Math.sqrt((x + 1e-3) * (b[i] + 1e-3))));
  for (const c of cfgs) {
    const get = (s) => res[`${c}|${s.sid}`]?.dist;
    const sc = score(snaps, get); if (!sc || sc.n < snaps.length * 0.9) continue;
    table.push([c, sc]);
    if (process.env.COMBO) {
      table.push([`${c} +hist(avg)`, score(snaps, (s) => get(s) && avg(get(s), H(s)))]);
      table.push([`${c} *hist(geo)`, score(snaps, (s) => get(s) && geo(get(s), H(s)))]);
    }
  }
  table.sort((a, b) => a[1].rps - b[1].rps);
  console.log(`split=${process.env.SPLIT || 'dev'} snapshots=${snaps.length}  (sorted by RPS: lower is better; RPS scores the whole fuzzy distribution)`);
  console.log('config'.padEnd(34), 'n'.padStart(4), 'RPS'.padStart(6), 'MAE'.padStart(6), 'bias'.padStart(6), 'rho'.padStart(6), 'order'.padStart(6), 'sd'.padStart(5), 'cov80'.padStart(6));
  for (const [c, m] of table) console.log(c.padEnd(34), String(m.n).padStart(4), m.rps.toFixed(4).padStart(6), m.mae.toFixed(1).padStart(6), m.bias.toFixed(1).padStart(6), m.rho.toFixed(3).padStart(6), (m.order ?? 0).toFixed(2).padStart(6), m.sd.toFixed(1).padStart(5), m.cover80.toFixed(2).padStart(6));
  const spent = Object.values(res).reduce((s, r) => s + (r.cost || 0), 0);
  console.log(`cells cached ${Object.keys(res).length}, spend so far $${spent.toFixed(3)}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const cmd = process.argv[2];
  if (cmd === 'fetch') await fetchData();
  else if (cmd === 'build') await build();
  else if (cmd === 'run') await run();
  else if (cmd === 'report') report();
  else console.log('usage: jev-progress-eval.mjs fetch|build|run|report [filter]');
}
