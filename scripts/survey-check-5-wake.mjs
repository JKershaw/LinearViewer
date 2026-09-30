// LIN-3173: the independent check of wake-inventory.md (LIN-3172). Recounts the paper's traffic figures from the extract's snapshots
// without its analyse script, and tests the definitions behind them: what a "relay" is, what "changed nothing" folds in, which
// ticket a wake is charged to (the child's, as the paper does, or the session it entered, as survey-check-4.md's rule does), and
// how the wake window cuts a cohort ticket's history. Offline; no proxy calls.
// Usage: node scripts/survey-check-5-wake.mjs [--dir data/survey-wake] [--score data/survey/scorecard.json] [--from 2026-09-01] [--to 2026-09-29] [--sample N] [--reclass [dispatch] [--write DIR] [--projects ~/.claude/projects]]
import { readFileSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir', 'data/survey-wake'); const SCORE = arg('--score', 'data/survey/scorecard.json');
const FROM = arg('--from', '2026-09-01'); const TO = arg('--to', '2026-09-29'); const SAMPLE = +arg('--sample', 0);
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const D = readFileSync(join(DIR, 'deliveries.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sessions = J(join(DIR, 'sessions.json')); const S = new Map(sessions.map((s) => [s.id, s]));
const runner = J(join(DIR, 'runner.json')); const changes = J(SCORE).changes;
const inWin = (t) => t >= FROM && t < TO;
const pc = (a, b) => (b ? +((100 * a) / b).toFixed(1) : null); const f2 = (x) => +x.toFixed(2);
const tally = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
const out = (k, v) => console.log(k.padEnd(46), typeof v === 'object' ? JSON.stringify(v) : v);
const R = { none: 0, arm: 1, read: 2, act: 3, dispatch: 4 }; const quietOut = (o) => R[o] <= 2;

// --reclass: re-read the transcripts' tool inputs, keyed to each delivery by (session, n) exactly as survey-wake-extract.mjs numbers
// them, and re-derive every delivery's outcome with a WRITE pattern that counts -d/--data/--json as a write only inside a curl call
// (so `gh pr view --json`, `gh pr checks --json`, `date -d`, `jq --json` are reads). Everything below then runs on those outcomes.
// --projects defaults to ~/.claude/projects. Prints which WRITE alternative each "act" Bash command matched under the old pattern.
const RECLASS = process.argv.includes('--reclass');
if (RECLASS) {
  const { readdirSync, statSync } = await import('fs'); const { homedir } = await import('os');
  const root = arg('--projects', join(homedir(), '.claude', 'projects'));
  const DISPATCH = /api\/proxy\/dispatch\b[^|]*(-X\s*'?POST|-d\s|--data|--json)|autopilot\/kickoff|recommend-and-dispatch|\/dispatch\/[^\s"']*\/(abort|withdraw)/;
  const WRITE = /\s(-d|--data(-raw|-binary)?|--json)\s|-X\s*'?(POST|PATCH|PUT|DELETE)|--request\s+(POST|PATCH|PUT|DELETE)|X-Harbour-Intent:\s*write|gh pr (merge|create|comment|review|edit|close)|gh issue (create|comment|edit)|git push|git commit|git merge|git rebase/;
  const DATA = /\s(-d|--data(-raw|-binary)?|--json)\s/;
  // A curl segment: no pipe, ';' or '&', and a newline only as a backslash continuation.
  const CURLDATA = /curl\b(?:[^|;&\n]|\\\n)*\s(-d|--data(-raw|-binary)?|--data-urlencode|--json|-F|--form)[\s=]/;
  const WRITE2 = new RegExp(WRITE.source.replace('\\s(-d|--data(-raw|-binary)?|--json)\\s|', ''));
  // --reclass dispatch also confines DISPATCH to one command (no ';' or '&&' between the path and the data flag) and drops /prompt GETs.
  const DISPATCH2 = process.argv.includes('dispatch') ? /api\/proxy\/dispatch(?![\w/-]*\/prompt)(?:[^|;&\n]|\\\n)*(-X\s*'?POST|\s-d\s|--data|--json)|autopilot\/kickoff|recommend-and-dispatch|\/dispatch\/[^\s"']*\/(abort|withdraw)/ : DISPATCH;
  const ARM = new Set(['Monitor', 'ScheduleWakeup', 'TaskStop', 'CronCreate', 'CronDelete']); const EDIT = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Agent', 'Task']);
  const cls = (b, alt) => { const c = String(b.input?.command || ''); if (b.name === 'Bash' && (alt ? DISPATCH2 : DISPATCH).test(c)) return 'dispatch'; if (b.name === 'Bash' && (alt ? WRITE2.test(c) || CURLDATA.test(c) : WRITE.test(c))) return 'act'; if (EDIT.has(b.name)) return 'act'; if (ARM.has(b.name)) return 'arm'; return 'read'; };
  const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text || '').join('\n') : '');
  const alt = new Map(); const why = {}; const dataOnly = {}; const dispOnlyOld = {}; let nOld = 0;
  const sids = new Set(D.map((d) => d.session));
  for (const dd of readdirSync(root)) {
    if (!dd.startsWith('-Users-work-development-simple-dispatcher-workspaces-')) continue;
    for (const f of readdirSync(join(root, dd))) {
      if (!f.endsWith('.jsonl') || !sids.has(f.slice(0, 36))) continue;
      const sid = f.slice(0, 36); let n = -1;
      for (const line of readFileSync(join(root, dd, f), 'utf8').split('\n')) {
        if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; } if (!e.timestamp) continue;
        if (e.type === 'user') { const c = e.message?.content; if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) continue; if (textOf(c).trim()) n++; continue; }
        if (e.type !== 'assistant' || n < 0) continue;
        for (const b of e.message?.content || []) {
          if (b.type !== 'tool_use') continue; const k = sid + '|' + n; const a = alt.get(k) || { old: 'none', neu: 'none' };
          const o = cls(b, false), nw = cls(b, true); if (R[o] > R[a.old]) a.old = o; if (R[nw] > R[a.neu]) a.neu = nw; alt.set(k, a);
          if (b.name === 'Bash' && o !== nw) { const c = String(b.input.command); const prog = (c.match(/\b(gh \w+ \w+|curl|date|jq|grep|git \w+|node|python3?|sed|awk)\b/) || ['?'])[0]; (o === 'dispatch' ? dispOnlyOld : dataOnly)[prog] = ((o === 'dispatch' ? dispOnlyOld : dataOnly)[prog] || 0) + 1; nOld++; }
        }
      }
    }
  }
  let same = 0, diff = 0, missing = 0, oldMismatch = 0;
  for (const d of D) { const a = alt.get(d.session + '|' + d.n); if (!a) { if (d.tools) missing++; continue; } if (a.old !== d.outcome) oldMismatch++; if (a.neu !== a.old) diff++; else same++; d.outcome = a.neu; }
  // --write DIR: the re-derived deliveries, with the extract's sessions and runner snapshots beside them, for survey-wake-analyse.mjs.
  const WR = arg('--write', null);
  if (WR) {
    const { writeFileSync, mkdirSync, copyFileSync } = await import('fs'); mkdirSync(WR, { recursive: true });
    writeFileSync(join(WR, 'deliveries.jsonl'), D.map((x) => JSON.stringify(x)).join('\n') + '\n');
    for (const f of ['sessions.json', 'runner.json']) copyFileSync(join(DIR, f), join(WR, f));
    out('wrote', WR);
  }
  console.log('== Reclass: -d/--data/--json a write only inside curl' + (DISPATCH2 === DISPATCH ? '; DISPATCH as the extract' : '; DISPATCH confined to one command'));
  out('deliveries re-keyed: unchanged / changed / tools but no key / old class != snapshot', [same, diff, missing, oldMismatch]);
  out('tool calls whose class fell: act→read by program', dataOnly); out('tool calls whose class fell: dispatch→lower by program', dispOnlyOld);
}

// ---- 1. Episodes, rebuilt: one per non-gate, non-handshake delivery; a handshake joins the next one, gates and noise the one before.
const eps = []; const grouped = new Map(); const orphanGates = [];
for (const d of D) { if (!grouped.has(d.session)) grouped.set(d.session, []); grouped.get(d.session).push(d); }
for (const [sid, ds] of grouped) {
  ds.sort((a, b) => a.n - b.n); let cur = null; let pend = null;
  for (const d of ds) {
    const fold = d.source === 'completion-gate' || d.source === 'noise' || d.source === 'compaction';
    if (d.source === 'resume-handshake') { pend = d; continue; }
    if (fold) { if (cur) { cur.parts.push(d); if (d.source === 'completion-gate') cur.gates.push(d); } else if (d.source === 'completion-gate') orphanGates.push(d); continue; }
    let kind = d.source;
    if (kind === 'item-ready') kind = d.own ? 'own-task' : d.wake ? 'wake-' + d.wake : /^beat \d/i.test(d.promptName || '') ? 'beat' : (d.kind == null || d.kind === 'custom') ? 'relay' : 'follow-up';
    else if (kind === 'wake-inline') kind = 'wake-' + d.wake;
    cur = { sid, d, kind, at: d.at, parts: pend ? [pend, d] : [d], gates: [], hs: pend }; pend = null; eps.push(cur);
  }
}
for (const e of eps) {
  e.units = sum(e.parts, (p) => p.units); e.gateUnits = sum(e.gates, (g) => g.units);
  e.outcome = e.parts.reduce((o, p) => (R[p.outcome] > R[o] ? p.outcome : o), 'none');
  e.outcomeNoGate = e.parts.filter((p) => p.source !== 'completion-gate').reduce((o, p) => (R[p.outcome] > R[o] ? p.outcome : o), 'none');
  e.quiet = quietOut(e.outcome); e.layer = S.get(e.sid).layer;
}
const sep = eps.filter((e) => inWin(e.at)); const W = sep.filter((e) => e.kind.startsWith('wake-'));
const T = W.filter((e) => e.kind === 'wake-terminal'); const P = W.filter((e) => e.kind === 'wake-pause');
console.log('== Episodes and outcomes (window', FROM, 'to', TO, 'exclusive)');
out('harbour wakes (terminal / pause)', `${W.length} (${T.length} / ${P.length})`);
out('terminal: quiet / act / dispatch %', [pc(T.filter((e) => e.quiet).length, T.length), pc(T.filter((e) => e.outcome === 'act').length, T.length), pc(T.filter((e) => e.outcome === 'dispatch').length, T.length)]);
out('pause: quiet / act / dispatch %', [pc(P.filter((e) => e.quiet).length, P.length), pc(P.filter((e) => e.outcome === 'act').length, P.length), pc(P.filter((e) => e.outcome === 'dispatch').length, P.length)]);
out('quiet if the gate were NOT folded in (T / P %)', [pc(T.filter((e) => quietOut(e.outcomeNoGate)).length, T.length), pc(P.filter((e) => quietOut(e.outcomeNoGate)).length, P.length)]);
out('wakes whose gate raised the outcome', W.filter((e) => e.outcome !== e.outcomeNoGate).length);
out('quiet wakes that armed (arm outcome)', W.filter((e) => e.outcome === 'arm').length);
const G = [['terminal', ['wake-terminal']], ['pause', ['wake-pause']], ['beat/follow-up', ['beat', 'follow-up']], ['own wake-ups', ['task-notification', 'scheduled']], ['relay (ruling/note)', ['relay']], ['stall failsafe', ['failsafe-reconfirm', 'silence-refire']]];
const totU = sum(sep, (e) => e.units);
for (const [g, ks] of G) { const xs = sep.filter((e) => ks.includes(e.kind)); out(`path ${g}: n, quiet%, act%, disp%, tok%`, [xs.length, pc(xs.filter((e) => e.quiet).length, xs.length), pc(xs.filter((e) => e.outcome === 'act').length, xs.length), pc(xs.filter((e) => e.outcome === 'dispatch').length, xs.length), pc(sum(xs, (e) => e.units), totU)]); }
out('failsafe-reconfirm / silence-refire', [sep.filter((e) => e.kind === 'failsafe-reconfirm').length, sep.filter((e) => e.kind === 'silence-refire').length]);

// ---- 2. Tokens: what the 29% is a share of.
const dWin = D.filter((d) => inWin(d.at)); const allDelivU = sum(dWin, (d) => d.units);
const sessU = sum(sessions.filter((s) => s.first && inWin(s.first)), (s) => s.units);
console.log('== Tokens');
out('episode units in window (M)', f2(totU / 1e6)); out('all delivery units in window (M)', f2(allDelivU / 1e6));
out('wakes share of episodes / of all deliveries', [pc(sum(W, (e) => e.units), totU), pc(sum(W, (e) => e.units), allDelivU)]);
const Wq = W.filter((e) => e.quiet);
out('quiet wakes share; quiet wake median k; gate share of quiet', [pc(sum(Wq, (e) => e.units), totU), Math.round(med(Wq.map((e) => e.units)) / 1e3), pc(sum(Wq, (e) => e.gateUnits), sum(Wq, (e) => e.units))]);
out('handshake units share of wakes', pc(sum(W, (e) => (e.hs ? e.hs.units : 0)), sum(W, (e) => e.units)));

// ---- 3. Gates.
const gates = D.filter((d) => d.source === 'completion-gate' && inWin(d.at));
const gk = (r) => (/PENDING-EXTERNAL/.test(r) ? 'PE' : /PENDING-INTERNAL/.test(r) ? 'PI' : /\bDONE\b/.test(r) ? 'DONE' : /BLOCKED/.test(r) ? 'BLOCKED' : 'other');
console.log('== Completion gate');
out('asks; replies', [gates.length, tally(gates, (g) => gk(g.reply))]);
out('PE share %', pc(gates.filter((g) => gk(g.reply) === 'PE').length, gates.length));
out('gate units share of episodes %', pc(sum(gates, (g) => g.units), totU));
const byL = {}; for (const g of gates) { const l = S.get(g.session).layer; byL[l] ||= [0, 0, 0]; byL[l][0]++; if (gk(g.reply) === 'PE') byL[l][1]++; if (gk(g.reply) === 'DONE') byL[l][2]++; }
out('by layer [n, PE, DONE] (extract layers)', byL);
out('gate replies with PENDING-EXTERNAL not at start', gates.filter((g) => /PENDING-EXTERNAL/.test(g.reply) && !/^\W*PENDING-EXTERNAL/.test(g.reply)).length);

// ---- 4. Linking (same rules as stated in the Method, re-implemented) and re-layering.
const alias = new Map(); for (const s of sessions) for (const a of [s.rootItem, ...(s.aliases || [])]) if (a) alias.set(a, s.id);
const kids = new Map(); for (const s of sessions) { const p = s.parentItem && alias.get(s.parentItem); if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(s); } }
const key = (x) => (x || '').replace(/\s+/g, ' ').replace(/[`*_]/g, '').trim().slice(0, 50).toLowerCase();
const pendIdx = new Map(); const endG = [];
for (const d of D) if (['completion-gate', 'failsafe-reconfirm', 'silence-refire'].includes(d.source)) {
  const m = d.reply.match(/PENDING(?:-EXTERNAL)?:\s*(.*)/); if (m) { const k = key(m[1]); if (!pendIdx.has(k)) pendIdx.set(k, []); pendIdx.get(k).push(d); }
  if (/\b(DONE|BLOCKED|FAILED)\b/.test(d.reply)) endG.push(d);
}
const allW = eps.filter((e) => e.kind.startsWith('wake-'));
const epsOf = new Map(); for (const e of eps) { if (!epsOf.has(e.sid)) epsOf.set(e.sid, []); epsOf.get(e.sid).push(e); }
for (const w of allW) {
  const ci = w.d.child?.match(/^(LIN-\d+)/)?.[1] || null; const t0 = Date.parse(w.at);
  const c1 = (kids.get(w.sid) || []).filter((c) => c.first <= w.at && (!ci || c.issue === ci));
  const live = c1.filter((c) => Date.parse(c.last) >= t0 - 15 * 60e3);
  let c = [...(live.length ? live : c1)].sort((a, b) => b.last.localeCompare(a.last))[0]; w.link = c ? 'parent' : null;
  if (!c) {
    const pm = (w.d.outcomeLine || '').match(/^\[pending\] Not done — (.*)/);
    const cand = (pm ? pendIdx.get(key(pm[1])) || [] : endG.filter((g) => ci && S.get(g.session)?.issue === ci))
      .filter((g) => g.session !== w.sid && t0 - Date.parse(g.at) >= -60e3 && t0 - Date.parse(g.at) <= 15 * 60e3).sort((a, b) => b.at.localeCompare(a.at));
    if (cand[0]) { c = S.get(cand[0].session); w.link = 'text'; w.linkGate = cand[0]; }
  }
  w.child = c ? c.id : null;
  if (!c && (/\(beat \d|beat \d+\/\d+/i.test(w.d.child || '') || /\(opencode\)\.?\s*$/.test(w.d.outcomeLine || ''))) { w.link = 'name'; w.childWorker = true; }
  if (c) { const prev = (epsOf.get(c.id) || []).filter((e) => e.at <= w.at); w.cause = prev[prev.length - 1] || null; if (w.cause) (w.cause.caused ||= []).push(w); }
}
// Layers: a non-Runner autopilot is a leg if more of the wakes it caused went to a Runner than elsewhere.
const votes = new Map(); for (const w of allW) if (w.child) { const v = votes.get(w.child) || { R: 0, o: 0 }; v[S.get(w.sid).runner ? 'R' : 'o']++; votes.set(w.child, v); }
const layer = new Map(); for (const s of sessions) { let l = s.layer; if (s.kind === 'autopilot' && !s.runner) { const v = votes.get(s.id) || { R: 0, o: 0 }; l = v.R > v.o ? 'leg' : (!v.o && s.layer === 'leg') ? 'leg' : s.stepper ? 'stepper' : 'autopilot'; } layer.set(s.id, l); }
const L = (sid) => layer.get(sid);
for (const e of eps) e.layer = L(e.sid);
for (const w of allW) w.childLayer = w.child ? L(w.child) : w.childWorker ? 'worker' : 'unlinked';
console.log('== Linking and edges');
out('linking in window', tally(W, (w) => w.link || 'none'));
const edges = {}; for (const w of W) { const k = `${w.childLayer}→${w.layer}`; const r = (edges[k] ||= { n: 0, t: 0, p: 0, q: 0, rel: 0 }); r.n++; r[w.kind === 'wake-terminal' ? 't' : 'p']++; if (w.quiet) r.q++; if (w.cause && w.cause.kind.startsWith('wake-')) r.rel++; }
for (const [k, r] of Object.entries(edges).sort((a, b) => b[1].n - a[1].n)) out('edge ' + k, `n=${r.n} T/P=${r.t}/${r.p} quiet=${pc(r.q, r.n)}% relayOfWake=${pc(r.rel, r.n)}%`);
out('wakes into a Runner', W.filter((w) => w.layer === 'Runner').length);

// ---- 5. Relays: the paper's 1,749 is "pause wakes whose child is a supervisor", not "caused by the child's wake". Test both.
const SUP = new Set(['stepper', 'leg', 'autopilot']);
const supP = P.filter((w) => SUP.has(w.childLayer));
console.log('== Relays');
out('pause wakes from a supervisor child (paper 1,749)', `${supP.length} = ${pc(supP.length, W.length)}% of wakes, ${pc(supP.length, P.length)}% of pause; quiet ${pc(supP.filter((w) => w.quiet).length, supP.length)}%; tokens ${pc(sum(supP, (w) => w.units), totU)}%`);
out('  ...their cause episode kind', tally(supP, (w) => (w.cause ? w.cause.kind : 'none')));
out('  ...cause episode had a PE gate reply', supP.filter((w) => w.cause && w.cause.gates.some((g) => /PENDING-EXTERNAL/.test(g.reply))).length);
out('  ...cause episode quiet / acted / dispatched', tally(supP.filter((w) => w.cause), (w) => w.cause.outcome));
out('  ...cause episode was a wake that changed nothing', supP.filter((w) => w.cause && w.cause.kind.startsWith('wake-') && w.cause.quiet).length);
const relW = W.filter((w) => w.cause && w.cause.kind.startsWith('wake-'));
const supW = supP.filter((w) => w.cause && w.cause.kind.startsWith('wake-'));
out('sup-child pause caused by the child\'s wake handling', `${supW.length}; quiet ${supW.filter((w) => w.quiet).length} (${pc(supW.filter((w) => w.quiet).length, supW.length)}%); tokens ${pc(sum(supW, (w) => w.units), totU)}%`);
out('wakes caused by the child\'s own wake (any class)', `${relW.length} = ${pc(relW.length, W.length)}%; pause ${relW.filter((w) => w.kind === 'wake-pause').length}; quiet ${pc(relW.filter((w) => w.quiet).length, relW.length)}%`);
const strict = supP.filter((w) => w.cause && w.cause.kind.startsWith('wake-') && w.cause.gates.some((g) => /PENDING-EXTERNAL/.test(g.reply)));
out('strict relay: sup-child pause, cause=wake with PE gate', `${strict.length} = ${pc(strict.length, W.length)}% of wakes; quiet ${pc(strict.filter((w) => w.quiet).length, strict.length)}%`);
const lag = supP.filter((w) => w.cause).map((w) => (Date.parse(w.at) - Date.parse(w.cause.at)) / 60e3);
out('minutes from cause episode start to relay (p50/p90/max)', [med(lag).toFixed(1), q(lag, 0.9).toFixed(1), Math.max(...lag).toFixed(0)]);

// ---- 6. Repeats, duplicates, two-path counts.
console.log('== Repeats and two paths');
const last = new Map(); let rep = 0; const repTo = {}; let repQ = 0;
for (const w of [...P].sort((a, b) => a.at.localeCompare(b.at))) { const k = w.sid + '|' + (w.child || w.d.child); const nn = (x) => (x || '').replace(/\d+/g, 'N'); if (last.has(k) && nn(last.get(k)) === nn(w.d.outcomeLine)) { rep++; repTo[w.layer] = (repTo[w.layer] || 0) + 1; if (w.quiet) repQ++; } last.set(k, w.d.outcomeLine); }
out('pause repeats; quiet; by woken layer', [rep, repQ, repTo]);
const notes = D.filter((d) => d.source === 'task-notification' && inWin(d.at));
out('task notifications into supervisors (paper 72)', notes.filter((d) => L(d.session) !== 'worker').length);
out('  ...of which the head mentions a child/dispatch/wake', notes.filter((d) => L(d.session) !== 'worker' && /child|dispatch|wake|LIN-\d+|feedback|beat/i.test(d.head)).length);
out('wakes caused by a stall re-fire (paper 27)', W.filter((w) => w.cause && ['failsafe-reconfirm', 'silence-refire'].includes(w.cause.kind)).length);
out('pause→terminal same child within 5 min (paper 97)', T.filter((w) => w.child && allW.some((p) => p.sid === w.sid && p.child === w.child && p.kind === 'wake-pause' && p.at < w.at && Date.parse(w.at) - Date.parse(p.at) <= 5 * 60e3)).length);

// ---- 7. Propagation from worker events.
console.log('== Propagation');
const pv = new Map(); for (const w of allW) if (w.child) { const v = pv.get(w.child) || new Map(); v.set(w.sid, (v.get(w.sid) || 0) + 1); pv.set(w.child, v); }
const par = (id) => { const v = pv.get(id); return v ? [...v].sort((a, b) => b[1] - a[1])[0][0] : null; };
const inPassage = (id) => { const seen = new Set(); for (let x = id; x && !seen.has(x); x = par(x)) { seen.add(x); if (['leg', 'Runner'].includes(L(x))) return true; } return false; };
const roots = {};
for (const w of W.filter((x) => x.childLayer === 'worker')) {
  const k = L(w.sid) + (inPassage(w.sid) ? ' (in a passage)' : ''); const r = (roots[k] ||= { n: 0, wakes: 0, q: 0, byL: {}, deep: 0, layers3: 0 }); r.n++;
  const st = [[w, 1]]; let dmax = 0; const ls = new Set();
  while (st.length) { const [x, dd] = st.pop(); r.wakes++; if (x.quiet) r.q++; r.byL[x.layer] = (r.byL[x.layer] || 0) + 1; ls.add(x.layer); dmax = Math.max(dmax, dd); for (const y of x.caused || []) st.push([y, dd + 1]); }
  if (dmax >= 3) r.deep++; if (ls.size >= 3) r.layers3++;
}
for (const [k, r] of Object.entries(roots)) out('root ' + k, `events=${r.n} wakes/event=${f2(r.wakes / r.n)} quiet=${pc(r.q, r.wakes)}% depth>=3: ${r.deep} distinct layers>=3: ${r.layers3} per-layer ${JSON.stringify(Object.fromEntries(Object.entries(r.byL).map(([a, b]) => [a, f2(b / r.n)])))}`);

// ---- 8. Runner log and follow-up coverage.
console.log('== Runner log');
const rw = runner.rows.filter((r) => inWin(r.at)); out('shapes in window', tally(rw, (r) => r.shape));
const fuEps = sep.filter((e) => ['wake-terminal', 'wake-pause', 'beat', 'follow-up', 'relay'].includes(e.kind));
out('transcript follow-up episodes; distinct items', [fuEps.length, new Set(fuEps.map((e) => e.d.item || e.d.session + e.d.n)).size]);
const rItems = new Set(rw.filter((r) => r.shape === 'warm' || r.shape === 'cold').map((r) => r.item));
out('transcript follow-up items in the runner log as warm/cold', fuEps.filter((e) => rItems.has(e.d.item)).length);
const rByItem = new Map(runner.rows.map((r) => [r.item, r]));
out('  ...their runner shape', tally(fuEps, (e) => rByItem.get(e.d.item)?.shape || 'not in log'));

// ---- 9. Cohort and per correct change under several charging rules.
const epic = new Set(['LIN-3099', 'LIN-2888']); const first = new Map();
for (const r of runner.rows) if (r.issue && ['fresh', 'warm', 'cold'].includes(r.shape)) if (!first.has(r.issue) || r.at < first.get(r.issue)) first.set(r.issue, r.at);
const cohort = (code, from = FROM, to = TO) => new Map(changes.filter((c) => !epic.has(c.id) && (!code || c.prodLines > 0) && c.lastMerge && c.lastMerge.slice(0, 10) >= from && c.lastMerge.slice(0, 10) < to && first.get(c.id) >= '2026-08-30').map((c) => [c.id, c]));
const good = (c) => c.correct && c.complete; const lv = (c) => c.repos.includes('LinearViewer'); const sd = (c) => c.repos.includes('simple-dispatcher');
const CO = cohort(true); const CA = cohort(false); const cv = [...CO.values()];
console.log('== Cohort and per correct change');
out('code cohort: changes, correct, LV, SD, both', [CO.size, cv.filter(good).length, cv.filter((c) => good(c) && lv(c)).length, cv.filter((c) => good(c) && sd(c)).length, cv.filter((c) => good(c) && lv(c) && sd(c)).length]);
out('all cohort: changes, correct', [CA.size, [...CA.values()].filter(good).length]);
const rules = {
  child: (w) => (w.child && S.get(w.child).issue) || w.d.itemIssue || S.get(w.sid).issue, // the paper's rule
  entered: (w) => S.get(w.sid).issue, // survey-check-4.md's rule: the ticket of the session the wake entered
};
const per = (xs, rule, co, pred = () => true) => { const g = [...co.values()].filter((c) => good(c) && pred(c)).length; return f2(xs.filter((w) => { const c = co.get(rule(w)); return c && pred(c); }).length / g); };
const perGood = (xs, rule, co) => { const g = [...co.values()].filter(good).length; return f2(xs.filter((w) => { const c = co.get(rule(w)); return c && good(c); }).length / g); };
for (const [name, rule] of Object.entries(rules)) {
  out(`[${name}] wakes/correct (all, LV, SD)`, [per(W, rule, CO), per(W, rule, CO, lv), per(W, rule, CO, sd)]);
  out(`[${name}] quiet wakes/correct`, per(Wq, rule, CO));
  out(`[${name}] numerator = correct changes only`, perGood(W, rule, CO));
  for (const k of ['worker→stepper', 'worker→autopilot', 'stepper→autopilot', 'stepper→leg', 'leg→Runner', 'stepper→stepper', 'worker→leg']) out(`[${name}]   edge ${k}`, per(W.filter((w) => `${w.childLayer}→${w.layer}` === k), rule, CO));
  out(`[${name}]   into a Runner (all 617)`, per(W.filter((w) => w.layer === 'Runner'), rule, CO));
  out(`[${name}]   unattributed wakes`, W.filter((w) => !rule(w)).length);
}
out('wakes where the two rules differ', W.filter((w) => rules.child(w) !== rules.entered(w)).length);
out('  ...and a different cohort membership', W.filter((w) => !!CO.get(rules.child(w)) !== !!CO.get(rules.entered(w))).length);
// The window cuts history: cohort tickets' wakes before 1 Sep or after 28 Sep are left out of the numerator.
const allTick = allW.filter((w) => CO.has(rules.child(w)));
out('cohort wakes (child rule) before FROM / in / after TO', [allTick.filter((w) => w.at < FROM).length, allTick.filter((w) => inWin(w.at)).length, allTick.filter((w) => w.at >= TO).length]);
out('  ...per correct if the whole history counted', f2(allTick.length / cv.filter(good).length));
// what-doubled-the-dispatches.md's periods: code changes merged 1–13 and 14–28 Sep, charged to the session entered, whole history.
for (const [a, b] of [['2026-09-01', '2026-09-14'], ['2026-09-14', '2026-09-29']]) {
  const co = cohort(true, a, b); const g = [...co.values()].filter(good).length;
  const n = (rule, all) => (all ? allW : W).filter((w) => co.has(rule(w))).length;
  out(`merge ${a}..${b}: correct; entered (window, whole); child (window, whole)`, [g, f2(n(rules.entered) / g), f2(n(rules.entered, 1) / g), f2(n(rules.child) / g), f2(n(rules.child, 1) / g)]);
}
out('wakes charged to an epic under each rule (child, entered)', [W.filter((w) => epic.has(rules.child(w))).length, W.filter((w) => epic.has(rules.entered(w))).length]);

if (SAMPLE) {
  console.log('== Sample of supervisor-child pause wakes (for reading transcripts)');
  const pick = supP.filter((_, i) => i % Math.floor(supP.length / SAMPLE) === 0).slice(0, SAMPLE);
  for (const w of pick) console.log(JSON.stringify({ woken: w.sid, at: w.at, layer: w.layer, child: w.child, childLayer: w.childLayer, link: w.link, outcome: w.d.outcomeLine?.slice(0, 90), cause: w.cause && { kind: w.cause.kind, at: w.cause.at, outcome: w.cause.outcome, gate: w.cause.gates.map((g) => g.reply.slice(0, 50)) }, quiet: w.quiet }));
}
function med(xs) { const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length ? (s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2) : 0; }
function q(xs, p) { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; }

// ---- 10. Follow-ups for the definitions above.
console.log('== Definition probes');
out('gates by analysed layer [n, PE, DONE]', gates.reduce((m, g) => { const l = L(g.session); m[l] ||= [0, 0, 0]; m[l][0]++; if (gk(g.reply) === 'PE') m[l][1]++; if (gk(g.reply) === 'DONE') m[l][2]++; return m; }, {}));
// Where the paper's rule sends each edge's wakes: cohort (code), a scorecard change outside the cohort, an epic, or no change.
const where = (t) => (!t ? 'none' : epic.has(t) ? 'epic' : CO.has(t) ? (good(CO.get(t)) ? 'cohort-correct' : 'cohort-other') : CA.has(t) ? 'docs-only' : changes.some((c) => c.id === t) ? 'change-outside-window' : 'not-a-change');
for (const k of ['leg→Runner', 'stepper→leg', 'stepper→autopilot', 'unlinked→Runner']) out(`[child] ${k} lands on`, tally(W.filter((w) => `${w.childLayer}→${w.layer}` === k), (w) => where(rules.child(w))));
for (const k of ['leg→Runner', 'stepper→leg', 'stepper→autopilot', 'worker→stepper']) out(`[entered] ${k} lands on`, tally(W.filter((w) => `${w.childLayer}→${w.layer}` === k), (w) => where(rules.entered(w))));
// The session entered, with the runner log's root Issue line where the transcript names no ticket for the session.
const rowBy = new Map(runner.rows.map((r) => [r.item, r]));
const launchIssue = new Map(); for (const r of [...runner.rows].sort((a, b) => a.at.localeCompare(b.at))) if (r.shape === 'fresh' && r.session && r.issueLine && !launchIssue.has(r.session)) launchIssue.set(r.session, r.issueLine);
rules.entered2 = (w) => S.get(w.sid).issue || launchIssue.get(w.sid) || (rowBy.get(w.d.item) && rowBy.get(rowBy.get(w.d.item).root)?.issueLine) || null;
out('[entered2] wakes/correct (all, LV, SD); unattributed', [per(W, rules.entered2, CO), per(W, rules.entered2, CO, lv), per(W, rules.entered2, CO, sd), W.filter((w) => !rules.entered2(w)).length]);
out('[entered2] quiet wakes/correct; into Runner', [per(Wq, rules.entered2, CO), per(W.filter((w) => w.layer === 'Runner'), rules.entered2, CO)]);
out('unattributed under [entered] by woken layer', tally(W.filter((w) => !rules.entered(w)), (w) => w.layer));
// Propagation: stepper roots with no parent seen, and passage events that reached the Runner.
const stepRoots = W.filter((x) => x.childLayer === 'worker' && L(x.sid) === 'stepper' && !inPassage(x.sid));
out('"stepper under a ticket autopilot" roots whose stepper has no parent', stepRoots.filter((w) => !par(w.sid)).length);
const passRoots = W.filter((x) => x.childLayer === 'worker' && L(x.sid) === 'stepper' && inPassage(x.sid));
const reaches = (w, l) => { const st = [w]; while (st.length) { const x = st.pop(); if (x.layer === l) return true; st.push(...(x.caused || [])); } return false; };
out('passage stepper events reaching the Runner / a leg', [passRoots.filter((w) => reaches(w, 'Runner')).length, passRoots.filter((w) => reaches(w, 'leg')).length]);
// Stall failsafe: how often the re-ask follows the failsafe resume in the same session (one re-fire, two deliveries).
const byS = new Map(); for (const e of eps) { if (!byS.has(e.sid)) byS.set(e.sid, []); byS.get(e.sid).push(e); }
let pair = 0; for (const xs of byS.values()) for (let i = 1; i < xs.length; i++) if (xs[i].kind === 'silence-refire' && xs[i - 1].kind === 'failsafe-reconfirm' && inWin(xs[i].at)) pair++;
out('silence-refire directly after a failsafe resume', pair);
// what-doubled-the-dispatches.md's "wakes": every runner follow-up (warm or cold) into an autopilot session, charged to the session entered.
const sessKind = new Map(sessions.map((s) => [s.id, s.kind]));
const cohortRun = (from, to) => new Map(changes.filter((c) => !epic.has(c.id) && c.prodLines > 0 && c.lastMerge && c.lastMerge.slice(0, 10) >= from && c.lastMerge.slice(0, 10) < to && first.has(c.id)).map((c) => [c.id, c]));
for (const [a, b] of [['2026-09-01', '2026-09-14'], ['2026-09-14', '2026-09-29'], ['2026-09-01', '2026-09-29']]) {
  const co = cohortRun(a, b); const g = [...co.values()].filter(good).length;
  const fu = runner.rows.filter((r) => (r.shape === 'warm' || r.shape === 'cold') && sessKind.get(r.session) === 'autopilot');
  const ent = (r) => launchIssue.get(r.session) || rowBy.get(r.root)?.issueLine || null;
  out(`runner follow-ups into autopilots, merge ${a}..${b} (no 30 Aug filter): correct; entered; own Issue line`, [g, f2(fu.filter((r) => co.has(ent(r))).length / g), f2(fu.filter((r) => co.has(r.issue)).length / g)]);
}
// Which sessions the leg→Runner wakes came from, and the ticket each session carries.
out('leg→Runner children: session:issue:stepper → wakes', tally(W.filter((w) => w.childLayer === 'leg' && w.layer === 'Runner'), (w) => `${w.child.slice(0, 8)}:${S.get(w.child).issue}:${S.get(w.child).kind}${S.get(w.child).stepper ? ':stepper' : ''}:disp=${(S.get(w.child).dispatchedIssues || []).length}`));
out('Harbour wakes quiet (n, %)', [Wq.length, pc(Wq.length, W.length)]);
