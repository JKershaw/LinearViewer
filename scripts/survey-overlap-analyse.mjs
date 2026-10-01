// LIN-3179: every step-overlap number: text and work overlap between steps on the four-step census, the read multiplier and its token share (transcripts) and trend (runner log), split siblings' overlap, and the coded samples' tallies; writes a git-ignored analysis.
// Usage: node scripts/survey-overlap-analyse.mjs [--sd ../simple-dispatcher] [--out data/survey-overlap/analysis.json]
// Inputs: data/survey-overlap/{transcripts.json,transcripts-reads.jsonl,proxy.json,select.json}, data/survey-doubling/runner.json, both repos' origin/main,
// and docs/papers/harbour/step-overlap-codes.json when it exists. No proxy calls.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { gitCommits } from './survey-rules-timeline.mjs';
import { STEPS, stepOfKind, attribute, splitDescription, words, restated, verbatim, refShare, seenShare, median, quart } from './survey-overlap-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const sd = arg('--sd', '../simple-dispatcher');
const outPath = arg('--out', 'data/survey-overlap/analysis.json');
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const TX = J('data/survey-overlap/transcripts.json'); const sessions = TX.sessions;
const proxy = J('data/survey-overlap/proxy.json'); const D = proxy.details;
const sel = J('data/survey-overlap/select.json');
const runner = J('data/survey-doubling/runner.json').rows;
const readText = new Map();
for (const l of readFileSync('data/survey-overlap/transcripts-reads.jsonl', 'utf8').split('\n')) { if (!l) continue; const o = JSON.parse(l); readText.set(`${o.ws}/${o.file}/${o.i}`, o.text); }
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const out = { generatedAt: new Date().toISOString() };

// ---- Repo and size per ticket, from both repos' merges.
const commits = [...gitCommits('LinearViewer', '.'), ...gitCommits('simple-dispatcher', sd)];
const repoOf = new Map(); const prodOf = new Map();
for (const c of commits) for (const id of c.ids) { (repoOf.get(id) || repoOf.set(id, new Set()).get(id)).add(c.repo); prodOf.set(id, (prodOf.get(id) || 0) + c.lines.prod); }
const repo = (id) => { const r = repoOf.get(id); return !r ? 'none' : r.size > 1 ? 'both' : r.has('simple-dispatcher') ? 'simple-dispatcher' : 'LinearViewer'; };

// ---- Session index: kind and ticket of a session's first task; which step posted each comment.
const sKind = (s) => stepOfKind(s.tasks[0]?.kind || s.header);
const sIssue = (s) => s.tasks[0]?.issue || s.headerIssue;
const postKind = new Map();
for (const s of sessions) for (const p of s.posts) if (p.commentId) postKind.set(p.commentId, p.kind || s.tasks[0]?.kind || s.header);
const artefacts = (id) => {
  const d = D[id]; if (!d) return null;
  const list = d.comments.map((c) => ({ ...c, ...attribute(c, postKind.get(c.id)), words: words(c.body) }));
  const parts = splitDescription(d.description);
  return { d, list, parts, text: (step) => [parts[step] || '', ...list.filter((c) => c.step === step).map((c) => c.body)].filter(Boolean).join('\n\n') };
};

// ---- 1. Text overlap between steps on the census.
const census = sel.census.filter((id) => D[id]);
const pairs = []; for (let i = 0; i < STEPS.length; i++) for (let j = i + 1; j < STEPS.length; j++) pairs.push([STEPS[i], STEPS[j]]);
const perTicket = []; const attributedHow = { transcript: 0, heading: 0 };
for (const id of census) {
  const a = artefacts(id); for (const c of a.list) attributedHow[c.how]++;
  const row = { id, repo: repo(id), prod: prodOf.get(id) || 0, state: a.d.state, words: Object.fromEntries(STEPS.map((s) => [s, words(a.text(s))])), cells: {} };
  for (const [A, B] of pairs) { const at = a.text(A); const bt = a.text(B); if (words(at) < 30 || words(bt) < 30) continue; row.cells[`${A}>${B}`] = { restated: r3(restated(at, bt)), verbatim: r3(verbatim(at, bt)), refs: r3(refShare(at, bt)) }; }
  // Everything before B, pooled: how much of B is already somewhere earlier.
  for (let j = 1; j < STEPS.length; j++) { const B = STEPS[j]; const bt = a.text(B); const prior = STEPS.slice(0, j).map((s) => a.text(s)).join('\n\n'); if (words(bt) >= 30 && words(prior) >= 30) row.cells[`prior>${B}`] = { restated: r3(restated(prior, bt)), verbatim: r3(verbatim(prior, bt)), refs: r3(refShare(prior, bt)) }; }
  perTicket.push(row);
}
const matrix = {};
for (const key of [...pairs.map(([A, B]) => `${A}>${B}`), ...STEPS.slice(1).map((B) => `prior>${B}`)]) {
  const xs = perTicket.map((t) => t.cells[key]).filter(Boolean); if (!xs.length) continue;
  matrix[key] = { n: xs.length, restated: quart(xs.map((x) => x.restated)).map(r3), verbatim: quart(xs.map((x) => x.verbatim)).map(r3), refs: quart(xs.map((x) => x.refs)).map(r3) };
}
const byRepo = {};
for (const rp of ['LinearViewer', 'simple-dispatcher', 'both']) { const ts = perTicket.filter((t) => t.repo === rp); byRepo[rp] = { n: ts.length, 'research>plan': r3(median(ts.map((t) => t.cells['research>plan']?.restated))), 'prior>plan-review': r3(median(ts.map((t) => t.cells['prior>plan-review']?.restated))), 'prior>implementation': r3(median(ts.map((t) => t.cells['prior>implementation']?.restated))) }; }
out.census = { n: census.length, byRepo: perTicket.reduce((m, t) => ((m[t.repo] = (m[t.repo] || 0) + 1), m), {}), done: perTicket.filter((t) => t.state === 'Done').length, prodMedian: median(perTicket.map((t) => t.prod)), attributedHow, wordsMedian: Object.fromEntries(STEPS.map((s) => [s, median(perTicket.map((t) => t.words[s]).filter((w) => w > 0))])), matrix, byRepoText: byRepo, perTicket };

// ---- 2. Work overlap: share of a later session's file-read bytes on files an earlier step's session on the ticket had already read.
const work = []; const workByPair = {};
for (const id of census) {
  const ss = sessions.filter((s) => sIssue(s) === id && STEPS.includes(sKind(s))).sort((a, b) => a.first.localeCompare(b.first));
  const readBy = {}; // step -> Set(path) so far
  for (const s of ss) {
    const B = sKind(s); const fr = s.files.filter((f) => f.path);
    const total = fr.reduce((a, f) => a + f.bytes, 0);
    const row = { id, step: B, file: s.file, readBytes: total, tokens: s.tokens, turns: s.turns, window: s.window, fileCarry: s.files.reduce((a, f) => a + (f.carry || 0), 0), shares: {} };
    { const anyPrior = new Set(Object.values(readBy).flatMap((x) => [...x])); row.rereadCarry = fr.filter((f) => anyPrior.has(f.path)).reduce((a, f) => a + (f.carry || 0), 0);
      // Across steps only: files an earlier session of a different step read; the first session of its step on the ticket.
      const other = new Set(Object.entries(readBy).filter(([k]) => k !== B).flatMap(([, x]) => [...x])); row.firstOfStep = !readBy[B];
      row.crossShare = total && other.size ? r3(fr.filter((f) => other.has(f.path)).reduce((a, f) => a + f.bytes, 0) / total) : total ? 0 : null; row.crossCarry = fr.filter((f) => other.has(f.path)).reduce((a, f) => a + (f.carry || 0), 0); }
    if (total > 0) {
      for (const A of STEPS) if (readBy[A]?.size) row.shares[A] = r3(fr.filter((f) => readBy[A].has(f.path)).reduce((a, f) => a + f.bytes, 0) / total);
      const anyPrior = new Set(Object.values(readBy).flatMap((x) => [...x]));
      row.shares.prior = anyPrior.size ? r3(fr.filter((f) => anyPrior.has(f.path)).reduce((a, f) => a + f.bytes, 0) / total) : 0;
    }
    work.push(row);
    for (const f of fr) (readBy[B] ||= new Set()).add(f.path);
  }
}
for (const B of STEPS) for (const A of [...STEPS, 'prior']) { const xs = work.filter((w) => w.step === B && w.shares[A] != null).map((w) => w.shares[A]); if (xs.length) workByPair[`${A}>${B}`] = { n: xs.length, share: quart(xs).map(r3) }; }
// Bytes-weighted re-read share per later step (pooled), and the tokens those sessions spent.
const pooledWork = {};
for (const B of STEPS) {
  const ws = work.filter((w) => w.step === B && w.readBytes > 0 && w.shares.prior != null); const tot = ws.reduce((a, w) => a + w.readBytes, 0); const win = ws.reduce((a, w) => a + w.window, 0);
  // Carried tokens: every file read's share of the session's summed context, and the part on files an earlier session had read.
  const fs1 = ws.filter((w) => w.firstOfStep && w.crossShare != null); const tb1 = fs1.reduce((a, w) => a + w.readBytes, 0); const win1 = fs1.reduce((a, w) => a + w.window, 0);
  pooledWork[B] = ws.length ? { firstRound: { sessions: fs1.length, crossShare: r3(fs1.reduce((a, w) => a + w.readBytes * w.crossShare, 0) / (tb1 || 1)), crossCarryShare: r3(fs1.reduce((a, w) => a + w.crossCarry, 0) / (win1 || 1)), medianCrossShare: r3(median(fs1.map((w) => w.crossShare))) }, sessions: ws.length, rereadShare: r3(ws.reduce((a, w) => a + w.readBytes * w.shares.prior, 0) / tot), fileCarryShare: r3(ws.reduce((a, w) => a + w.fileCarry, 0) / win), rereadCarryShare: r3(ws.reduce((a, w) => a + w.rereadCarry, 0) / win), medianTokens: median(ws.map((w) => w.tokens)) } : null;
}
{ const ws = work.filter((w) => w.step !== 'research' && w.readBytes > 0); const win = ws.reduce((a, w) => a + w.window, 0); out.workAll = { sessions: ws.length, rereadCarryShare: r3(ws.reduce((a, w) => a + w.rereadCarry, 0) / win), crossCarryShare: r3(ws.reduce((a, w) => a + w.crossCarry, 0) / win), fileCarryShare: r3(ws.reduce((a, w) => a + w.fileCarry, 0) / win), tokens: ws.reduce((a, w) => a + w.tokens, 0) }; }
const workByRepo = {};
for (const rp of ['LinearViewer', 'simple-dispatcher', 'both']) { const ws = work.filter((w) => repo(w.id) === rp && w.step !== 'research' && w.readBytes > 0 && w.shares.prior != null); const tb = ws.reduce((a, w) => a + w.readBytes, 0); const win = ws.reduce((a, w) => a + w.window, 0); workByRepo[rp] = { tickets: new Set(ws.map((w) => w.id)).size, sessions: ws.length, rereadShare: r3(ws.reduce((a, w) => a + w.readBytes * w.shares.prior, 0) / (tb || 1)), rereadCarryShare: r3(ws.reduce((a, w) => a + w.rereadCarry, 0) / (win || 1)) }; }
out.work = { sessions: work.length, byPair: workByPair, pooled: pooledWork, all: out.workAll, byRepo: workByRepo };

// ---- 3. Read multiplier (September, transcripts): which later sessions received each comment, and the tokens it was carried for.
const T0 = '2026-08-30T00:00:00Z'; // every session after this is on disk, so a comment written after it has its whole reading record
const readsOf = new Map();
for (const s of sessions) s.reads.forEach((r, i) => { if (r.endpoint === 'brief') return; (readsOf.get(r.issue) || readsOf.set(r.issue, []).get(r.issue)).push({ s, r, i }); });
const briefOf = new Map(); for (const s of sessions) for (const r of s.reads) if (r.endpoint === 'brief') (briefOf.get(r.issue) || briefOf.set(r.issue, new Set()).get(r.issue)).add(s.file);
const mult = []; const classAgg = {};
for (const id of Object.keys(D)) {
  const a = artefacts(id); if (!a) continue;
  // Description sections count as the step that wrote them, from that step's first session (or first comment) on the ticket.
  const stepStart = (k) => [sessions.filter((s) => sIssue(s) === id && sKind(s) === k).map((s) => s.first).sort()[0], a.list.find((c) => c.step === k)?.createdAt].filter(Boolean).sort()[0];
  const descItems = Object.entries(a.parts).filter(([, t]) => words(t)).map(([k, t]) => ({ id: `desc:${k}`, step: k, body: t, createdAt: k === 'description' ? a.d.createdAt : stepStart(k) || a.d.createdAt, words: words(t), how: 'description' }));
  const items = [...a.list, ...descItems].filter((c) => c.createdAt >= T0);
  for (const c of items) {
    if (!c.words) continue;
    const later = (readsOf.get(id) || []).filter((x) => x.r.at > c.createdAt);
    const loaders = new Map(); let carry = 0;
    for (const x of later) { const t = readText.get(`${x.s.ws}/${x.s.file}/${x.i}`) || ''; const sh = seenShare(c.body, t); if (sh <= 0) continue; const prev = loaders.get(x.s.file) || 0; loaders.set(x.s.file, Math.max(prev, sh)); carry += ((Buffer.byteLength(c.body) * sh) / 4) * (x.r.turnsAfter || 0); }
    const own = [...loaders.keys()].filter((f) => sIssue(sessions.find((s) => s.file === f)) === id).length;
    const laterFresh = sessions.filter((s) => sIssue(s) === id && s.first > c.createdAt).length;
    const full = [...loaders.values()].filter((v) => v >= 0.5).length;
    const row = { ticket: id, step: c.step, how: c.how, words: c.words, at: c.createdAt, loads: loaders.size, fullLoads: full, ownTicketLoads: own, laterSessionsOnTicket: laterFresh, briefOnly: [...(briefOf.get(id) || [])].filter((f) => !loaders.has(f)).length, carry: Math.round(carry) };
    mult.push(row);
    const k = c.step; const g = (classAgg[k] ||= { comments: 0, words: 0, wordLoads: 0, wordFullLoads: 0, wordPotential: 0, carry: 0 });
    g.comments++; g.words += c.words; g.wordLoads += c.words * row.loads; g.wordFullLoads += c.words * full; g.wordPotential += c.words * laterFresh; g.carry += row.carry;
  }
}
for (const g of Object.values(classAgg)) { g.multiplier = r3(g.wordLoads / g.words); g.fullMultiplier = r3(g.wordFullLoads / g.words); g.potential = r3(g.wordPotential / g.words); g.loadedShareOfPotential = r3(g.wordLoads / (g.wordPotential || 1)); }
const allW = mult.reduce((a, m) => a + m.words, 0);
out.readMultiplier = { since: T0, tickets: new Set(mult.map((m) => m.ticket)).size, comments: mult.length, words: allW, overall: r3(mult.reduce((a, m) => a + m.words * m.loads, 0) / allW), overallFull: r3(mult.reduce((a, m) => a + m.words * m.fullLoads, 0) / allW), potential: r3(mult.reduce((a, m) => a + m.words * m.laterSessionsOnTicket, 0) / allW), byStep: classAgg, crossTicketLoadShare: r3(1 - mult.reduce((a, m) => a + m.ownTicketLoads, 0) / (mult.reduce((a, m) => a + m.loads, 0) || 1)) };
out.readMultiplier.byRepo = {};
for (const rp of ['LinearViewer', 'simple-dispatcher', 'both', 'none']) { const ms = mult.filter((m) => repo(m.ticket) === rp); const w = ms.reduce((a, m) => a + m.words, 0); if (w) out.readMultiplier.byRepo[rp] = { tickets: new Set(ms.map((m) => m.ticket)).size, multiplier: r3(ms.reduce((a, m) => a + m.words * m.loads, 0) / w), potential: r3(ms.reduce((a, m) => a + m.words * m.laterSessionsOnTicket, 0) / w) }; }
// Weekly series of the measured multiplier, by the week a comment was written.
const wk = (at) => { const d = new Date(at); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const weekly = {};
for (const m of mult) { const g = (weekly[wk(m.at)] ||= { comments: 0, words: 0, wl: 0, wp: 0 }); g.comments++; g.words += m.words; g.wl += m.words * m.loads; g.wp += m.words * m.laterSessionsOnTicket; }
out.readMultiplier.weekly = Object.fromEntries(Object.entries(weekly).sort().map(([k, g]) => [k, { comments: g.comments, multiplier: r3(g.wl / g.words), potential: r3(g.wp / g.words) }]));

// ---- 3b. Token share of ticket text across every session on disk (not just the fetched tickets).
const tot = sessions.reduce((a, s) => a + s.window, 0);
const carryIssue = sessions.reduce((a, s) => a + s.reads.filter((r) => r.endpoint !== 'brief').reduce((b, r) => b + (r.carry || 0), 0), 0);
const carryBrief = sessions.reduce((a, s) => a + s.reads.filter((r) => r.endpoint === 'brief').reduce((b, r) => b + (r.carry || 0), 0), 0);
const byKindShare = {};
for (const s of sessions) { const k = sKind(s) || 'other'; const g = (byKindShare[k] ||= { sessions: 0, window: 0, issue: 0, brief: 0, readsPerSession: 0 }); g.sessions++; g.window += s.window; g.issue += s.reads.filter((r) => r.endpoint !== 'brief').reduce((b, r) => b + (r.carry || 0), 0); g.brief += s.reads.filter((r) => r.endpoint === 'brief').reduce((b, r) => b + (r.carry || 0), 0); g.readsPerSession += s.reads.length; }
for (const g of Object.values(byKindShare)) { g.issueShare = r3(g.issue / g.window); g.briefShare = r3(g.brief / g.window); g.readsPerSession = r3(g.readsPerSession / g.sessions); delete g.issue; delete g.brief; }
// Apportion the issue-read carry to steps by the fetched tickets' measured carry.
const carryAll = Object.values(classAgg).reduce((a, g) => a + g.carry, 0);
out.tokenShare = { sessions: sessions.length, windowTokens: tot, ticketReadShare: r3(carryIssue / tot), briefShare: r3(carryBrief / tot), byStepOfArtefact: Object.fromEntries(Object.entries(classAgg).map(([k, g]) => [k, r3((carryIssue / tot) * (g.carry / (carryAll || 1)))])), byReaderKind: byKindShare };

// ---- 4. Trend since June (runner log): words written per ticket and the later sessions that could load them, by half-month of the ticket's first session.
const launchIssue = new Map(); for (const r of runner) if (r.shape === 'fresh' && r.session && !launchIssue.has(r.session)) launchIssue.set(r.session, r.issueLine || r.issue);
const rowsBy = new Map(); const push = (k, r) => (rowsBy.get(k) || rowsBy.set(k, []).get(k)).push(r);
for (const r of runner) { const t = r.issueLine || r.issue; if (t) push(t, r); const se = (r.session && launchIssue.get(r.session)) || t; if (se) push(`s:${se}`, r); } // by the log's line; by the session entered
const trend = {};
for (const [bin, t] of [...Object.entries(sel.trend), ['census', { ids: sel.census }]]) {
  const g = { tickets: 0, words: 0, byStep: {}, wFresh: 0, wLog: 0, wSession: 0 };
  for (const id of t.ids) {
    const a = artefacts(id); if (!a) continue; g.tickets++;
    const firstOf = (k) => a.list.find((c) => c.step === k)?.createdAt || a.d.createdAt;
    const items = [...Object.entries(a.parts).map(([k, t]) => ({ step: k, words: words(t), createdAt: k === 'description' ? a.d.createdAt : firstOf(k) })), ...a.list];
    const own = rowsBy.get(id) || []; const ent = rowsBy.get(`s:${id}`) || [];
    for (const c of items) {
      g.words += c.words; g.byStep[c.step] = (g.byStep[c.step] || 0) + c.words;
      g.wFresh += c.words * own.filter((r) => r.shape === 'fresh' && r.at > c.createdAt).length;
      g.wLog += c.words * own.filter((r) => ['fresh', 'cold', 'warm'].includes(r.shape) && r.at > c.createdAt).length;
      g.wSession += c.words * ent.filter((r) => ['fresh', 'cold', 'warm'].includes(r.shape) && r.at > c.createdAt).length;
    }
  }
  trend[bin] = { tickets: g.tickets, wordsPerTicket: Math.round(g.words / (g.tickets || 1)), byStepPerTicket: Object.fromEntries(Object.entries(g.byStep).map(([k, v]) => [k, Math.round(v / g.tickets)])), potentialFresh: r3(g.wFresh / (g.words || 1)), perDispatchByLog: r3(g.wLog / (g.words || 1)), perDispatchBySession: r3(g.wSession / (g.words || 1)), wordReadsPerTicketFresh: Math.round(g.wFresh / (g.tickets || 1)) };
}
out.trend = trend;

// ---- 5. Splitting: children of one parent, each with research or plan text; overlap with the parent's and with earlier siblings'.
const split = [];
for (const [p, kids] of Object.entries(sel.split)) {
  const pa = artefacts(p); const ka = kids.map((k) => [k, artefacts(k)]).filter(([, a]) => a).sort((x, y) => (x[1].d.createdAt || '').localeCompare(y[1].d.createdAt || ''));
  const parentText = pa ? ['description', 'research', 'plan', 'orchestrator'].map((s) => pa.text(s)).join('\n\n') : '';
  for (let i = 0; i < ka.length; i++) {
    const [k, a] = ka[i]; const own = ['research', 'plan'].map((s) => a.text(s)).join('\n\n');
    const sib = ka.slice(0, i).map(([, b]) => ['research', 'plan'].map((s) => b.text(s)).join('\n\n')).join('\n\n');
    // Work: share of this child's research/plan sessions' read bytes on files an earlier sibling's research/plan session read.
    const mine = sessions.filter((s) => sIssue(s) === k && ['research', 'plan'].includes(sKind(s)));
    const sibSess = sessions.filter((s) => ka.slice(0, i).some(([b]) => sIssue(s) === b) && ['research', 'plan'].includes(sKind(s)) && s.first < (mine[0]?.first || '9'));
    const sibFiles = new Set(sibSess.flatMap((s) => s.files.filter((f) => f.path).map((f) => f.path)));
    const fr = mine.flatMap((s) => s.files.filter((f) => f.path)); const tb = fr.reduce((x, f) => x + f.bytes, 0);
    // A breakdown that copied an approved plan slice leaves this line in the child (lib/prompt-template-defs.js:485).
    const inherited = /plan-review due:?\**\s*no\b[^\n]{0,40}covered by/i.test(a.d.description || '');
    split.push({ parent: p, child: k, order: i, repo: repo(k), inherited, ranPlan: mine.some((s) => sKind(s) === 'plan'), ranResearch: mine.some((s) => sKind(s) === 'research'), ranPlanReview: sessions.some((s) => sIssue(s) === k && sKind(s) === 'plan-review'), words: words(own), fromParent: words(own) >= 30 ? r3(restated(parentText, own)) : null, refsFromParent: words(own) >= 30 ? r3(refShare(parentText, own)) : null, fromSiblings: i && words(own) >= 30 ? r3(restated(sib, own)) : null, refsFromSiblings: i && words(own) >= 30 ? r3(refShare(sib, own)) : null, siblingReread: i && tb && sibFiles.size ? r3(fr.filter((f) => sibFiles.has(f.path)).reduce((x, f) => x + f.bytes, 0) / tb) : null, tokens: mine.reduce((x, s) => x + s.tokens, 0) });
  }
}
const later = split.filter((s) => s.order > 0);
out.split = { inherited: split.filter((s) => s.inherited).length, inheritedThenPlanned: split.filter((s) => s.inherited && (s.ranPlan || s.ranPlanReview)).length, ranPlan: split.filter((s) => s.ranPlan).length, ranPlanReview: split.filter((s) => s.ranPlanReview).length, withText: split.filter((s) => s.words >= 30).length, parents: new Set(split.map((s) => s.parent)).size, children: split.length, laterSiblings: later.length, fromParent: quart(split.map((s) => s.fromParent)).map(r3), refsFromParent: quart(split.map((s) => s.refsFromParent)).map(r3), fromSiblings: quart(later.map((s) => s.fromSiblings)).map(r3), refsFromSiblings: quart(later.map((s) => s.refsFromSiblings)).map(r3), siblingReread: quart(later.map((s) => s.siblingReread)).map(r3), siblingRereadN: later.filter((s) => s.siblingReread != null).length, rows: split };

// ---- 5b. Split census (transcripts and the ticket list): for every parent with two or more children that ran a session on disk,
// which planning steps the parent and each child ran, and the tokens the children's own research, plan and plan-review sessions took.
{
  const kindsOn = new Map(); const tokOn = new Map();
  for (const s of sessions) { const i = sIssue(s); const k = sKind(s); if (!i) continue; (kindsOn.get(i) || kindsOn.set(i, new Set()).get(i)).add(s.tasks[0]?.kind || s.header); if (['research', 'plan', 'plan-review'].includes(k)) tokOn.set(`${i}:${k}`, (tokOn.get(`${i}:${k}`) || 0) + s.tokens); }
  const kidsOf = {}; for (const t of proxy.list) if (t.parent && kindsOn.has(t.identifier)) (kidsOf[t.parent] ||= []).push(t.identifier);
  const fams = Object.entries(kidsOf).filter(([, c]) => c.length >= 2);
  const has = (i, k) => kindsOn.get(i)?.has(k) || false;
  const kids = fams.flatMap(([p, c]) => c.map((k) => ({ parent: p, child: k, parentPlanned: has(p, 'plan') || has(p, 'breakdown'), research: has(k, 'research'), plan: has(k, 'plan'), planReview: has(k, 'plan-review'), implementation: has(k, 'implementation'), tokens: ['research', 'plan', 'plan-review'].reduce((a, x) => a + (tokOn.get(`${k}:${x}`) || 0), 0) })));
  const pp = kids.filter((k) => k.parentPlanned);
  const allTok = sessions.reduce((a, s) => a + s.tokens, 0);
  out.splitCensus = { parents: fams.length, parentsPlanned: new Set(pp.map((k) => k.parent)).size, children: kids.length, childrenOfPlannedParents: pp.length,
    ofPlannedParents: { research: pp.filter((k) => k.research).length, plan: pp.filter((k) => k.plan).length, planReview: pp.filter((k) => k.planReview).length, implementation: pp.filter((k) => k.implementation).length },
    planningTokensOfPlannedParentsChildren: pp.reduce((a, k) => a + k.tokens, 0), shareOfAllTokens: r3(pp.reduce((a, k) => a + k.tokens, 0) / allTok), rows: kids };
}

// ---- 6. Coded samples, when present.
if (existsSync('docs/papers/harbour/step-overlap-codes.json')) out.codes = J('docs/papers/harbour/step-overlap-codes.json').summary || null;

writeFileSync(outPath, JSON.stringify(out, null, 1));
const show = (k) => { const m = matrix[k]; return m ? `${k} n=${m.n} restated ${m.restated[1]} [${m.restated[0]}–${m.restated[2]}] verbatim ${m.verbatim[1]} refs ${m.refs[1]}` : `${k} —`; };
console.log(`census ${census.length} tickets`, out.census.byRepo, 'attributed', attributedHow, 'median prod', out.census.prodMedian);
for (const k of ['description>research', 'research>plan', 'plan>plan-review', 'research>plan-review', 'prior>plan-review', 'plan>implementation', 'prior>implementation', 'prior>review', 'prior>close-out']) console.log(show(k));
console.log('work reread (pooled, bytes):', Object.fromEntries(Object.entries(pooledWork).map(([k, v]) => [k, v && v.rereadShare])));
console.log('read multiplier', out.readMultiplier.overall, 'full', out.readMultiplier.overallFull, 'potential', out.readMultiplier.potential, 'comments', out.readMultiplier.comments, 'cross-ticket loads', out.readMultiplier.crossTicketLoadShare);
console.log('token share: ticket reads', out.tokenShare.ticketReadShare, 'briefs', out.tokenShare.briefShare);
console.log('trend', Object.entries(trend).map(([b, t]) => `${b}: ${t.tickets}t ${t.wordsPerTicket}w ×${t.potentialFresh}`).join(' | '));
console.log('split', JSON.stringify({ ...out.split, rows: undefined }));
console.log('split census', JSON.stringify({ ...out.splitCensus, rows: undefined }));
