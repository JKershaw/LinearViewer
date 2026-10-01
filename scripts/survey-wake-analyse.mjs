// LIN-3172: September's wake traffic by source and by edge (who wakes whom), per correct change and in tokens, with what each wake led to, how far each worker event propagates up the chain, and the runner's full-month counts as a cross-check.
// Usage: node scripts/survey-wake-analyse.mjs [--from 2026-09-01] [--to 2026-09-29] [--out data/survey-wake/analysis.json]
// Run first: survey-wake-extract.mjs, survey-doubling-runner.mjs --out data/survey-wake/runner.json, and a same-day
// data/survey/scorecard.json (survey-scorecard.mjs; correct and complete verdicts, repos, production lines).
// An *episode* is a delivery that is not the runner's completion gate or resume handshake, together with the handshake just before
// it and every gate that follows it until the next delivery: the gate is the runner's question at the Stop the delivery caused. An
// episode *changed nothing* when neither it nor its gates wrote, pushed, edited or dispatched (outcome none, arm or read). A wake's
// *edge* is the layer of the child session named on its Child line (its parent-linked session active at that moment) to the layer
// of the woken session. A wake is *caused* by the child's latest episode before it, so each worker event roots a tree of wakes.
// Per correct change: episodes attributed to a ticket (a wake's own issue, i.e. its child's, else the session's), over code changes
// (production lines > 0) last merged in the window whose first runner dispatch is on or after 30 August (so the whole history is in
// the transcripts), excluding the passage epics LIN-3099 and LIN-2888. Numerators count every such change; denominators the correct
// and complete ones. A change in both repos counts in both.
import { readFileSync, writeFileSync } from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const FROM = arg('--from', '2026-09-01'); const TO = arg('--to', '2026-09-29');
const out = arg('--out', 'data/survey-wake/analysis.json');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const D = readFileSync('data/survey-wake/deliveries.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const S = new Map(read('data/survey-wake/sessions.json').map((s) => [s.id, s]));
const runner = read('data/survey-wake/runner.json');
const score = read('data/survey/scorecard.json').changes;
const r1 = (x) => +(+x).toFixed(1); const r2 = (x) => +(+x).toFixed(2); const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const inWin = (ts) => ts >= FROM && ts < TO;
const QUIET = new Set(['none', 'arm', 'read']); const RANK = { none: 0, arm: 1, read: 2, act: 3, dispatch: 4 };
const report = {};

// ---- Episodes.
const bySession = new Map(); for (const d of D) (bySession.get(d.session) || bySession.set(d.session, []).get(d.session)).push(d);
const episodes = [];
for (const [sid, ds] of bySession) {
  ds.sort((a, b) => a.n - b.n); let ep = null; let hs = null;
  for (const d of ds) {
    if (d.source === 'noise' || d.source === 'compaction') { if (ep) { ep.units += d.units; ep.steps += d.steps; if (RANK[d.outcome] > RANK[ep.outcome]) ep.outcome = d.outcome; } continue; }
    if (d.source === 'resume-handshake') { hs = d; continue; }
    if (d.source === 'completion-gate' && ep) { ep.gates++; ep.gateUnits += d.units; ep.units += d.units; if (RANK[d.outcome] > RANK[ep.outcome]) ep.outcome = d.outcome; ep.gateReply = d.reply.slice(0, 60); continue; }
    const s = S.get(sid);
    let source = d.source;
    if (source === 'item-ready') source = d.own ? 'own-task' : d.wake ? `wake-${d.wake}` : d.promptName && /^beat \d/i.test(d.promptName) ? 'beat' : ['custom', undefined, null].includes(d.kind) ? 'relay' : 'follow-up';
    if (source === 'wake-inline') source = `wake-${d.wake}`;
    ep = { session: sid, layer: s.layer, issue: d.itemIssue || s.issue, at: d.at, source, item: d.item, child: d.child || null, outcomeLine: d.outcomeLine || null, followUpTo: d.followUpTo || null,
      units: d.units + (hs ? hs.units : 0), handshakeUnits: hs ? hs.units : 0, gateUnits: 0, steps: d.steps + (hs ? hs.steps : 0), outcome: d.outcome, gates: 0, cold: !!hs };
    hs = null; episodes.push(ep);
  }
}
for (const e of episodes) e.quiet = QUIET.has(e.outcome);

// ---- Edges: resolve each wake's child session (a session whose parent is the woken session's root item, on the Child line's issue,
// alive at that moment), and the episode in it that caused the wake.
const alias = new Map(); for (const s of S.values()) for (const a of [s.rootItem, ...(s.aliases || [])]) if (a) alias.set(a, s.id);
const children = new Map(); for (const s of S.values()) if (s.parentItem && alias.has(s.parentItem)) (children.get(alias.get(s.parentItem)) || children.set(alias.get(s.parentItem), []).get(alias.get(s.parentItem))).push(s);
const epsBySession = new Map(); for (const e of episodes) (epsBySession.get(e.session) || epsBySession.set(e.session, []).get(e.session)).push(e);
const wakes = episodes.filter((e) => e.source.startsWith('wake-'));
// Where the parent link is not in the transcripts (kickoff-launched autopilots, identifier-less children), the child is the session
// whose own gate reply produced the wake's Outcome line: the same PENDING detail, or a DONE/BLOCKED/FAILED on the Child line's
// issue, in the 15 minutes before the wake.
const norm = (x) => (x || '').replace(/\s+/g, ' ').replace(/[`*_]/g, '').trim().slice(0, 50).toLowerCase();
const gateIdx = new Map(); const endIdx = [];
for (const d of D) {
  if (d.source !== 'completion-gate' && d.source !== 'failsafe-reconfirm' && d.source !== 'silence-refire') continue;
  const m = d.reply.match(/PENDING(?:-EXTERNAL)?:\s*(.*)/); if (m) { const k = norm(m[1]); (gateIdx.get(k) || gateIdx.set(k, []).get(k)).push(d); }
  if (/\b(DONE|BLOCKED|FAILED)\b/.test(d.reply)) endIdx.push(d);
}
const within = (a, b, ms) => Date.parse(b) - Date.parse(a) >= -60e3 && Date.parse(b) - Date.parse(a) <= ms;
for (const w of wakes) {
  const P = S.get(w.session); const childIssue = w.child?.match(/^(LIN-\d+)/)?.[1] || null;
  const cands = (children.get(P.id) || []).filter((c) => c.first <= w.at && (!childIssue || c.issue === childIssue));
  const alive = cands.filter((c) => c.last >= new Date(Date.parse(w.at) - 15 * 60e3).toISOString());
  let c = (alive.length ? alive : cands).sort((a, b) => (b.last < a.last ? -1 : 1))[0] || null; w.linkedBy = c ? 'parent' : null;
  if (!c) {
    const pm = (w.outcomeLine || '').match(/^\[pending\] Not done — (.*)/);
    const hits = pm ? (gateIdx.get(norm(pm[1])) || []) : endIdx.filter((d) => childIssue && S.get(d.session)?.issue === childIssue);
    const h = hits.filter((d) => d.session !== w.session && within(d.at, w.at, 15 * 60e3)).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (h) { c = S.get(h.session); w.linkedBy = 'text'; }
  }
  // A beat names itself; an opencode worker leaves no transcript but its outcome says so.
  w.childLayer = c ? c.layer : /\(beat \d|beat \d+\/\d+/i.test(w.child || '') ? 'worker' : /\(opencode\)\.?\s*$/.test(w.outcomeLine || '') ? 'worker' : 'unlinked';
  if (!c && w.childLayer === 'worker') w.linkedBy = 'name';
  w.childSession = c?.id || null;
  if (c) { const ce = (epsBySession.get(c.id) || []).filter((e) => e.at <= w.at).pop(); if (ce) { w.cause = ce; (ce.caused ||= []).push(w); } }
}
// Layers from the wake graph itself: a leg is an autopilot whose linked parent is a Runner (survey-effort-fleet.mjs's issue rule
// is the fallback for a leg that never woke its Runner); a stepper carries the STEPPER disposition; any other autopilot is the ticket's.
const parentVotes = new Map();
for (const w of wakes) if (w.childSession) { const v = parentVotes.get(w.childSession) || {}; const l = S.get(w.session).runner ? 'Runner' : 'other'; v[l] = (v[l] || 0) + 1; parentVotes.set(w.childSession, v); }
for (const s of S.values()) {
  if (s.kind !== 'autopilot' || s.runner) continue;
  const v = parentVotes.get(s.id) || {};
  s.layer = (v.Runner || 0) > (v.other || 0) ? 'leg' : !v.other && s.layer === 'leg' ? 'leg' : s.stepper ? 'stepper' : 'autopilot';
}
for (const e of episodes) e.layer = S.get(e.session).layer;
for (const w of wakes) if (w.childSession) w.childLayer = S.get(w.childSession).layer;
report.layers = [...S.values()].reduce((m, s) => ((m[s.layer] = (m[s.layer] || 0) + 1), m), {});
report.linking = wakes.filter((w) => inWin(w.at)).reduce((m, w) => ((m[w.linkedBy || 'none'] = (m[w.linkedBy || 'none'] || 0) + 1), m), {});

// ---- Tickets, repos, correct changes.
const epicSkip = new Set(['LIN-3099', 'LIN-2888']);
const firstDispatch = new Map(); for (const r of runner.rows) if (r.issue && (r.shape === 'fresh' || r.shape === 'warm' || r.shape === 'cold')) { const p = firstDispatch.get(r.issue); if (!p || r.at < p) firstDispatch.set(r.issue, r.at); }
// Two cohorts: code changes (LIN-3170's series) and every change, docs-only included (passage legs mostly fly papers).
const cohortOf = (code) => { const m = new Map(); for (const c of score) {
  if (epicSkip.has(c.id) || (code && !(c.prodLines > 0))) continue;
  const lm = c.lastMerge?.slice(0, 10); if (!lm || lm < FROM || lm >= TO) continue;
  const fd = firstDispatch.get(c.id); if (!fd || fd < '2026-08-30') continue;
  m.set(c.id, c); } return m; };
const cohorts = { code: cohortOf(true), all: cohortOf(false) };
const repoKeys = { LV: (c) => c.repos.includes('LinearViewer'), SD: (c) => c.repos.includes('simple-dispatcher') };
const good = (c) => c.correct && c.complete;
report.cohort = { window: [FROM, TO] };
for (const [name, co] of Object.entries(cohorts)) { const d = { changes: co.size, correct: [...co.values()].filter(good).length }; for (const [k, f] of Object.entries(repoKeys)) d['correct' + k] = [...co.values()].filter((c) => f(c) && good(c)).length; report.cohort[name] = d; }
// A wake belongs to the ticket of the child that caused it (the leg's ticket for a Runner wake), else its own issue line, else the session's.
const ticketOf = (e) => (e.childSession && S.get(e.childSession).issue) || e.issue;
const perCorrect = (xs) => { const o = {}; for (const [name, co] of Object.entries(cohorts)) { const d = report.cohort[name]; const hit = xs.filter((e) => inWin(e.at) && co.has(ticketOf(e))).map((e) => co.get(ticketOf(e)));
  o[name] = r2(hit.length / d.correct); o[name + 'LV'] = r2(hit.filter(repoKeys.LV).length / d.correctLV); o[name + 'SD'] = r2(hit.filter(repoKeys.SD).length / d.correctSD); } return o; };

// ---- Table 1: every delivery path, September (all tickets) and per correct change (cohort).
const sep = episodes.filter((e) => inWin(e.at));
const gatesSep = D.filter((d) => d.source === 'completion-gate' && inWin(d.at));
const totalUnits = sep.reduce((a, e) => a + e.units, 0);
const srcRows = {};
for (const e of sep) {
  const k = e.source; const r = (srcRows[k] ||= { n: 0, units: 0, gateUnits: 0, gates: 0, quiet: 0, out: { none: 0, arm: 0, read: 0, act: 0, dispatch: 0 }, byLayer: {}, eps: [] });
  r.n++; r.units += e.units; r.gateUnits += e.gateUnits; r.gates += e.gates; r.out[e.outcome]++; if (e.quiet) r.quiet++; r.byLayer[e.layer] = (r.byLayer[e.layer] || 0) + 1;
  r.eps.push(e);
}
report.sources = Object.fromEntries(Object.entries(srcRows).sort((a, b) => b[1].units - a[1].units).map(([k, r]) => [k, {
  n: r.n, per: perCorrect(r.eps), shareUnits: pct(r.units, totalUnits), gateShareOfUnits: pct(r.gateUnits, r.units), gatesPer: r2(r.gates / r.n),
  medianUnitsK: Math.round(median(sep.filter((e) => e.source === k).map((e) => e.units)) / 1e3), quietPct: pct(r.quiet, r.n), out: Object.fromEntries(Object.entries(r.out).map(([o, v]) => [o, pct(v, r.n)])), byLayer: r.byLayer }]));
report.gates = { n: gatesSep.length, replies: (() => { const m = {}; for (const g of gatesSep) { const k = /PENDING-EXTERNAL/.test(g.reply) ? 'PENDING-EXTERNAL' : /PENDING-INTERNAL/.test(g.reply) ? 'PENDING-INTERNAL' : /\bDONE\b/.test(g.reply) ? 'DONE' : /BLOCKED/.test(g.reply) ? 'BLOCKED' : 'other'; m[k] = (m[k] || 0) + 1; } return m; })(), unitsShare: pct(gatesSep.reduce((a, g) => a + g.units, 0), totalUnits) };
report.totalUnitsM = r1(totalUnits / 1e6);

// ---- Table 2: edges (who wakes whom), September.
const edgeRows = {};
for (const w of wakes.filter((e) => inWin(e.at))) {
  const k = `${w.childLayer}→${w.layer}`; const r = (edgeRows[k] ||= { n: 0, terminal: 0, pause: 0, quiet: 0, units: 0, quietUnits: 0, childQuiet: 0, childKnown: 0, eps: [] });
  r.n++; r[w.source === 'wake-terminal' ? 'terminal' : 'pause']++; r.units += w.units; if (w.quiet) { r.quiet++; r.quietUnits += w.units; }
  if (w.cause && w.cause.source.startsWith('wake-')) { r.childKnown++; if (w.cause.quiet) r.childQuiet++; }
  r.eps.push(w);
}
report.edges = Object.fromEntries(Object.entries(edgeRows).sort((a, b) => b[1].n - a[1].n).map(([k, r]) => [k, { n: r.n, terminal: r.terminal, pause: r.pause, per: perCorrect(r.eps), quietPct: pct(r.quiet, r.n), shareUnits: pct(r.units, totalUnits), quietUnitsShare: pct(r.quietUnits, totalUnits), relayedFromWake: r.childKnown, relayedFromQuietWake: r.childQuiet }]));

// ---- Propagation: every wake-tree rooted at a worker event (a wake whose child is a worker, or an unlinked beat).
const layerOf = (w) => w.layer; const trees = [];
const parentVotes2 = new Map(); for (const w of wakes) if (w.childSession) { const v = parentVotes2.get(w.childSession) || new Map(); v.set(w.session, (v.get(w.session) || 0) + 1); parentVotes2.set(w.childSession, v); }
const parentOf = (id) => { const v = parentVotes2.get(id); return v ? [...v].sort((a, b) => b[1] - a[1])[0][0] : null; };
const inPassage = (id) => { const seen = new Set(); let x = id; while (x && !seen.has(x)) { seen.add(x); const l = S.get(x)?.layer; if (l === 'leg' || l === 'Runner') return true; x = parentOf(x); } return false; };
for (const w of wakes.filter((e) => inWin(e.at) && e.childLayer === 'worker')) {
  const counts = {}; let total = 0; let quiet = 0; let units = 0; const stack = [[w, 1]]; let depth = 0;
  while (stack.length) {
    const [x, dd] = stack.pop(); counts[layerOf(x)] = (counts[layerOf(x)] || 0) + 1; total++; if (x.quiet) quiet++; units += x.units; depth = Math.max(depth, dd);
    // What the woken supervisor's episode caused next: wakes into its parent.
    for (const y of x.caused || []) stack.push([y, dd + 1]);
  }
  // Whether the woken session sits under the passage layer (a leg or the Runner among its ancestors), whether or not this chain got there.
  trees.push({ root: w.layer + (inPassage(w.session) ? ' (in a passage)' : ''), total, quiet, units, depth, counts });
}
const byRoot = {};
for (const t of trees) { const r = (byRoot[t.root] ||= { n: 0, wakes: 0, quiet: 0, depth: {}, layers: {} }); r.n++; r.wakes += t.total; r.quiet += t.quiet; r.depth[t.depth] = (r.depth[t.depth] || 0) + 1; for (const [l, v] of Object.entries(t.counts)) r.layers[l] = (r.layers[l] || 0) + v; }
report.propagation = Object.fromEntries(Object.entries(byRoot).map(([k, r]) => [k, { workerEvents: r.n, wakesPerEvent: r2(r.wakes / r.n), quietPct: pct(r.quiet, r.wakes), depth: r.depth, perEventByLayer: Object.fromEntries(Object.entries(r.layers).map(([l, v]) => [l, r2(v / r.n)])) }]));
// Relays: a wake into a supervisor whose child is itself a supervisor that was just woken and re-armed (the pending re-arm bubbled).
const supRelays = wakes.filter((w) => inWin(w.at) && w.cause && w.cause.source.startsWith('wake-'));
report.relays = { n: supRelays.length, ofWakes: pct(supRelays.length, wakes.filter((w) => inWin(w.at)).length), fromQuiet: supRelays.filter((w) => w.cause.quiet).length, pause: supRelays.filter((w) => w.source === 'wake-pause').length, relayQuietPct: pct(supRelays.filter((w) => w.quiet).length, supRelays.length) };

// ---- Duplicates: the same child outcome waking the same session twice (identical Child and Outcome lines within 30 minutes).
const dupKey = new Map(); let dups = 0; const dupEdges = {};
for (const w of wakes.filter((e) => inWin(e.at)).sort((a, b) => a.at.localeCompare(b.at))) {
  const k = `${w.session}|${w.child}|${w.outcomeLine}`; const p = dupKey.get(k);
  if (p && Date.parse(w.at) - Date.parse(p) <= 30 * 60e3) { dups++; const ek = `${w.childLayer}→${w.layer}`; dupEdges[ek] = (dupEdges[ek] || 0) + 1; }
  dupKey.set(k, w.at);
}
// A child's terminal and a notification of the same child (an in-session Agent) are not both visible here; the pause-then-terminal pair is.
const pairs = wakes.filter((w) => inWin(w.at) && w.source === 'wake-terminal' && w.childSession).filter((w) => wakes.some((p) => p.session === w.session && p.childSession === w.childSession && p.source === 'wake-pause' && p.at < w.at && Date.parse(w.at) - Date.parse(p.at) <= 5 * 60e3));
report.duplicates = { identicalWithin30m: dups, byEdge: dupEdges, pauseThenTerminalWithin5m: pairs.length };

// ---- Runner's own record for the whole of September (both repos, every harness): follow-up routes, failsafe re-fires, gate posts.
const rs = runner.rows.filter((r) => inWin(r.at));
const routes = {}; for (const r of rs) if (r.route) routes[r.route] = (routes[r.route] || 0) + 1;
const shapes = {}; for (const r of rs) shapes[r.shape] = (shapes[r.shape] || 0) + 1;
const refires = Object.values(runner.sessions).reduce((m, s) => { for (const [k, v] of Object.entries(s.refires || {})) m[k] = (m[k] || 0) + v; return m; }, {});
report.runner = { items: rs.length, shapes, routes };

// ---- Redundancy: a pause wake whose Outcome line repeats (digits aside) the last pause wake the same session had from the same child.
// Terminal outcomes are left out: "[done] Task completed in Nm Ns" is the same text for every child.
const lastFrom = new Map(); let repeats = 0; const repeatEdges = {};
for (const w of wakes.filter((e) => inWin(e.at) && e.source === 'wake-pause').sort((a, b) => a.at.localeCompare(b.at))) {
  const k = `${w.session}|${w.childSession || w.child}`; const norm2 = (x) => (x || '').replace(/\d+/g, 'N');
  if (lastFrom.has(k) && norm2(lastFrom.get(k)) === norm2(w.outcomeLine)) { repeats++; const ek = `${w.childLayer}→${w.layer}`; repeatEdges[ek] = (repeatEdges[ek] || 0) + 1; w.repeat = true; }
  lastFrom.set(k, w.outcomeLine);
}
const sepW = wakes.filter((e) => inWin(e.at));
const supPending = sepW.filter((w) => w.source === 'wake-pause' && ['stepper', 'leg', 'autopilot'].includes(w.childLayer));
report.redundancy = { repeats, ofPauseWakes: pct(repeats, sepW.filter((w) => w.source === 'wake-pause').length), repeatQuietPct: pct(sepW.filter((w) => w.repeat && w.quiet).length, repeats), byEdge: repeatEdges,
  supervisorPending: supPending.length, supervisorPendingOfWakes: pct(supPending.length, sepW.length), supervisorPendingQuietPct: pct(supPending.filter((w) => w.quiet).length, supPending.length),
  supervisorPendingUnitsShare: pct(supPending.reduce((a, w) => a + w.units, 0), totalUnits), supervisorPendingFromQuietChild: supPending.filter((w) => w.cause && w.cause.source.startsWith('wake-') && w.cause.quiet).length,
  quietWakes: sepW.filter((w) => w.quiet).length, quietWakeUnitsShare: pct(sepW.filter((w) => w.quiet).reduce((a, w) => a + w.units, 0), totalUnits), wakeUnitsShare: pct(sepW.reduce((a, w) => a + w.units, 0), totalUnits),
  quietWakeMedianUnitsK: Math.round(median(sepW.filter((w) => w.quiet).map((w) => w.units)) / 1e3), quietWakeGateShare: pct(sepW.filter((w) => w.quiet).reduce((a, w) => a + w.gateUnits, 0), sepW.filter((w) => w.quiet).reduce((a, w) => a + w.units, 0)) };
// Self-armed CI/PR polls (the only CI path) and supervisor liveness nudges (the prompt's own clock beside the runner's).
const notes = D.filter((d) => d.source === 'task-notification' && inWin(d.at));
report.selfWakes = { taskNotifications: notes.length, ciOrPr: notes.filter((d) => /\b(CI|PR|pr checks|checks|gh run|workflow)\b/i.test(d.head)).length, scheduled: D.filter((d) => d.source === 'scheduled' && inWin(d.at)).length,
  byLayer: notes.reduce((m, d) => ((m[S.get(d.session).layer] = (m[S.get(d.session).layer] || 0) + 1), m), {}) };
// Two paths on one event: a supervisor's liveness nudge to a silent child beside the runner's own stall re-fire, and a pause wake
// minted because the runner's re-fire made the child re-post PENDING-EXTERNAL.
const nudgeRe = /still working|liveness|where things stand|are you (still )?(alive|there)/i;
const byItem = new Map(D.map((d) => [d.item, d]));
report.twoPaths = {
  livenessNudges: episodes.filter((e) => inWin(e.at) && ['beat', 'relay', 'follow-up'].includes(e.source) && nudgeRe.test(byItem.get(e.item)?.promptName || '')).length,
  stallRefires: episodes.filter((e) => inWin(e.at) && e.source === 'failsafe-reconfirm').length,
  wakesFromRefire: sepW.filter((w) => w.cause && ['failsafe-reconfirm', 'silence-refire'].includes(w.cause.source)).length,
  supervisorPolls: notes.filter((d) => S.get(d.session).layer !== 'worker').length,
  pauseThenTerminal5m: report.duplicates.pauseThenTerminalWithin5m,
};
// Gate replies by layer, and the runner's failsafe path (bootstrap then re-ask) in the transcripts.
const gl = {}; for (const g of gatesSep) { const l = S.get(g.session).layer; const k = /PENDING-EXTERNAL/.test(g.reply) ? 'pendingExternal' : /\bDONE\b/.test(g.reply) ? 'done' : 'other'; (gl[l] ||= { n: 0, pendingExternal: 0, done: 0, other: 0 }); gl[l].n++; gl[l][k]++; }
report.gatesByLayer = gl;
// LIN-2121: wakes before 13 September carry no issue id of their own.
const fu = runner.rows.filter((r) => inWin(r.at) && (r.shape === 'warm' || r.shape === 'cold')); const own = (xs) => pct(xs.filter((r) => r.issueFrom === 'own').length, xs.length);
report.lin2121 = { followUpsBefore13Sep: fu.filter((r) => r.at < '2026-09-13').length, ownIssueLineBefore: own(fu.filter((r) => r.at < '2026-09-13')), ownIssueLineAfter: own(fu.filter((r) => r.at >= '2026-09-13')), transcriptWakesUnattributed: sepW.filter((w) => !ticketOf(w)).length, transcriptWakesBefore13Sep: sepW.filter((w) => w.at < '2026-09-13').length };
// Failures on record (what-supervisors-do.md v2's 25, as corrected by survey-check-2.md), mapped onto the inventory by hand.
const fails = read('docs/papers/harbour/wake-inventory-failures.json').failures;
report.failures = { n: fails.length, byPath: fails.reduce((m, f) => ((m[f.path] = (m[f.path] || 0) + 1), m), {}), byEffect: fails.reduce((m, f) => ((m[f.effect] = (m[f.effect] || 0) + 1), m), {}) };
report.edgeLinks = sepW.reduce((m, w) => ((m[w.linkedBy || 'none'] = (m[w.linkedBy || 'none'] || 0) + 1), m), {});

// ---- The paper's tables: delivery paths grouped as the inventory groups them, and the Harbour wake totals.
const GROUPS = { 'terminal wake': ['wake-terminal'], 'pause wake': ['wake-pause'], 'beat or follow-up': ['beat', 'follow-up'], 'own wake-ups': ['task-notification', 'scheduled'], relay: ['relay'], 'stall failsafe': ['failsafe-reconfirm', 'silence-refire'], 'Harbour wakes': ['wake-terminal', 'wake-pause'] };
report.table = {};
for (const [g, keys] of Object.entries(GROUPS)) {
  const xs = sep.filter((e) => keys.includes(e.source)); const n = xs.length;
  const per = perCorrect(xs); const quietPer = perCorrect(xs.filter((e) => e.quiet));
  report.table[g] = { n, per: per.code, perLV: per.codeLV, perSD: per.codeSD, quietPer: quietPer.code, quietPct: pct(xs.filter((e) => e.quiet).length, n), actPct: pct(xs.filter((e) => e.outcome === 'act').length, n), dispatchPct: pct(xs.filter((e) => e.outcome === 'dispatch').length, n), unitsShare: pct(xs.reduce((a, e) => a + e.units, 0), totalUnits) };
}
const unl = sepW.filter((w) => w.childLayer === 'unlinked'); const unlPer = perCorrect(unl);
report.table.unlinked = { n: unl.length, terminal: unl.filter((w) => w.source === 'wake-terminal').length, per: unlPer.code, quietPct: pct(unl.filter((w) => w.quiet).length, unl.length) };
report.table.intoRunner = sepW.filter((w) => w.layer === 'Runner').length;
report.table.deliveries = D.filter((d) => inWin(d.at)).length; report.table.deliveriesAll = D.length; report.table.sessions = S.size;
report.table.transcriptFollowUps = sep.filter((e) => ['wake-terminal', 'wake-pause', 'beat', 'follow-up', 'relay'].includes(e.source)).length;

function median(xs) { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return 0; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }
writeFileSync(out, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
