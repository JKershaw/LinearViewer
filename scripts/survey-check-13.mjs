// LIN-3220: the figures survey-check-13.md adds to prompt-kinds.md (LIN-3207), from the same git-ignored survey-kinds snapshots.
// Usage: node scripts/survey-check-13.mjs [--dir data/survey-kinds]
// Prints: the census by legs (every route but beat) and by fresh-session header; how many beats re-enter a session of their own kind;
// enqueue ids printed twice and whether their routes differ; the coverage bound in each unit; September-only unparsed enqueues and
// previews; and, for finding D, the body-only length ratios (appended sections cut), the review's own Regression Check step, the
// Principle 0 phrase or its BLOCKED / PENDING-EXTERNAL substance, and the Plan Review Verdict instruction. No proxy calls.
import { readFileSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-kinds');
const T = JSON.parse(readFileSync(join(dir, 'transcripts.json'), 'utf8'));
const C = JSON.parse(readFileSync(join(dir, 'census.json'), 'utf8'));
const inWin = (t) => t && t >= '2026-09-01' && t < '2026-10-01';
const CORE = ['implementation', 'plan', 'review', 'close-out', 'research', 'plan-review'];
const OFF = ['breakdown', 'triage', 'design', 'blocked', 'bug', 'look-into', 'scoping', 'spike', 'retrospective-audit', 'context', 'retro'];
const ROUTES = ['recommender', 'override', 'written', 'beat', 'untraced'];
const pct = (n, d) => `${n}/${d} (${(100 * n / d).toFixed(1)}%)`;

// Census by dispatches, legs and fresh sessions.
const sum = (k, rs) => rs.reduce((s, r) => s + (C.census[k]?.[r] || 0), 0);
const legs = (k) => sum(k, ROUTES.filter((r) => r !== 'beat'));
const tot = (f, ks) => ks.reduce((s, k) => s + f(k), 0);
const hdr = (k) => C.headers[k] || 0;
for (const [name, f] of [['dispatches', (k) => sum(k, ROUTES)], ['legs', legs], ['fresh sessions', hdr]]) {
  const core = tot(f, CORE); const all = core + tot(f, OFF);
  console.log(`${name}: core ${pct(core, all)}; bound if all 309 unseen fresh sessions were off-loop: ${(100 * (all - core + 309) / (all + 309)).toFixed(1)}%`);
}
console.log('legs by kind', Object.fromEntries([...CORE, ...OFF].map((k) => [k, `${legs(k)} (fresh ${hdr(k)})`])));

// Beats: does a fetched beat land in a session already of its kind?
const hdrOf = Object.fromEntries(T.sessions.map((s) => [s.file, s.header]));
const seen = new Set(); const firsts = []; const byId = {};
for (const e of T.enqueues) { if (!e.ok || e.error) continue; (byId[e.id] ??= []).push(e); if (!seen.has(e.id)) { seen.add(e.id); firsts.push(e); } }
const beats = firsts.filter((e) => e.ep === 'dispatch' && e.followUp && inWin(e.at) && [...CORE, ...OFF].includes(e.kind));
const fetchedBeats = beats.filter((e) => T.items[e.id]);
console.log(`template beats ${beats.length}; fetched ${fetchedBeats.length}; into a session of the same kind ${fetchedBeats.filter((e) => hdrOf[T.items[e.id].session] === e.kind).length}`);
const route = (e) => (e.ep === 'recommend-and-dispatch' ? (e.override ? 'override' : 'engine') : e.ep === 'dispatch' ? (e.followUp ? 'beat' : 'written') : e.ep);
const dups = Object.values(byId).filter((es) => es.length > 1);
console.log(`ids enqueued twice ${dups.length}; with two routes ${dups.filter((es) => new Set(es.map(route)).size > 1).length}`);
console.log(`unparsed enqueues in September ${pct(T.enqueues.filter((e) => e.error === 'unparsed' && inWin(e.at)).length, T.enqueues.filter((e) => inWin(e.at)).length)}; previews in September ${T.previews.filter((p) => inWin(p.at)).length} of ${T.previews.length}`);

// Finding D on September only, one row per item.
const CUTS = ['\n\n## Re-ground the Ticket (staleness check)', '\n\n## Task Already Complete', '\n\n## All Subtasks Complete', '\n\n## Prior Investigation On Record', '\n---\n## Workspace API access', '\n## Workspace API access'];
const body = (p) => Math.min(p.length, ...CUTS.map((c) => p.indexOf(c)).filter((i) => i >= 0));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rows = []; const got = new Set();
for (const e of T.enqueues) {
  if (!e.ok || e.error || e.ep !== 'recommend-and-dispatch' || !inWin(e.at) || got.has(e.id) || !T.items[e.id]?.prompt) continue;
  got.add(e.id); const p = T.items[e.id].prompt; rows.push({ kind: e.kind, arm: e.override ? 'template' : 'written', p, b: body(p) });
}
const arm = (k, a) => rows.filter((r) => r.kind === k && r.arm === a);
console.log(`finding D sample, September, deduplicated: written ${rows.filter((r) => r.arm === 'written').length}, template ${rows.filter((r) => r.arm === 'template').length}`);
for (const k of ['review', 'close-out', 'plan', 'research', 'implementation', 'plan-review']) {
  const w = arm(k, 'written'); const t = arm(k, 'template');
  console.log(`${k}: n ${w.length}/${t.length}; whole ${(100 * med(w.map((r) => r.p.length)) / med(t.map((r) => r.p.length))).toFixed(0)}%; body only ${(100 * med(w.map((r) => r.b)) / med(t.map((r) => r.b))).toFixed(0)}%`);
}
const has = (k, a, re) => { const xs = arm(k, a); return pct(xs.filter((r) => re.test(r.p)).length, xs.length); };
const hasBody = (k, a, re) => { const xs = arm(k, a); return pct(xs.filter((r) => re.test(r.p.slice(0, r.b))).length, xs.length); };
console.log(`review: "regression" ${has('review', 'written', /regression/i)}; git log in the written body ${hasBody('review', 'written', /git log/i)}; reintroduce / previously fixed / revert ${hasBody('review', 'written', /re-?introduc|previously[- ]fixed|revert/i)}`);
const p0 = /Principle 0/i; const p0sub = { test: (s) => p0.test(s) || (/PENDING-EXTERNAL/.test(s) && /BLOCKED/.test(s)) };
for (const k of ['plan', 'implementation']) console.log(`${k}: Principle 0 phrase ${has(k, 'written', p0)}; phrase or BLOCKED + PENDING-EXTERNAL ${has(k, 'written', p0sub)}`);
for (const k of ['plan', 'plan-review']) console.log(`${k}: Plan Review Verdict written ${has(k, 'written', /Plan Review Verdict/i)}, template ${has(k, 'template', /Plan Review Verdict/i)}`);
