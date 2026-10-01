// LIN-3178: from survey-context-extract.mjs's snapshot, orientation before the first productive action by role, what a session's context holds, re-reads within a ticket (charged both ways), and what research sessions spend their tools on.
// Usage: node scripts/survey-context-analyse.mjs [--in data/survey-context/sessions.json] [--since 2026-08-31] [--until 2026-10-01T00:00Z] [--out data/survey-context/analysis.json]
// Population: dispatched Claude sessions that started in the window (both repos; a session's repo is the checkout most of its reads
// and edits fall in). Role: the header kind; an autopilot is the passage Runner, a leg, a stepper or the ticket's own autopilot, by
// survey-effort-fleet.mjs's rules; a custom session whose prompt name says paper, survey, check or research is "research (custom)".
// "Productive" per role is PRODUCTIVE below. Orientation is the bootstrap summarise plus, in each task beat, the turns before the
// beat's first productive call. A beat with no productive call is counted on its own. Units as the extractor's.
import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const input = arg('--in', 'data/survey-context/sessions.json');
const since = Date.parse(arg('--since', '2026-08-31')); const until = Date.parse(arg('--until', '2026-10-01T00:00:00Z'));
const outPath = arg('--out', 'data/survey-context/analysis.json');
const REPO_DIRS = { LinearViewer: '.', 'simple-dispatcher': arg('--sd', '../simple-dispatcher') };
const { sessions: all } = JSON.parse(readFileSync(input, 'utf8'));

// The first productive call, per role: the first act that is the role's own output rather than finding its bearings.
const PRODUCTIVE = {
  implementation: ['repo-edit'], // the first edit to a file in a repo checkout
  plan: ['any-edit', 'proxy-write-substantive'], // the first file written (a draft) or a substantive write to the ticket
  'plan-review': ['run', 'any-edit', 'proxy-write-substantive', 'gh-write'], // the first check of its own: a run, a file written, or the verdict posted
  review: ['run', 'any-edit', 'proxy-write-substantive', 'gh-write'],
  'close-out': ['repo-edit', 'git-write', 'gh-write', 'proxy-write-substantive', 'run'], // the first change to the repo, PR or ticket
  research: ['run', 'any-edit'], // the first script run or file written
  'research (custom)': ['run', 'any-edit'],
  supervisor: ['dispatch', 'proxy-write', 'gh-write', 'git-write'], // the first dispatch, ticket write, merge or push
  other: ['any-edit', 'run', 'dispatch', 'proxy-write-substantive', 'gh-write', 'git-write'],
};
// The uniform reading, for sensitivity: the first call of any class that is not reading, searching or navigating.
const UNIFORM = ['any-edit', 'run', 'compute', 'proxy-write', 'dispatch', 'gh-write', 'git-write'];
const SUPERVISORS = ['Runner', 'leg', 'stepper', 'autopilot'];
const ROLES = ['research', 'research (custom)', 'plan', 'plan-review', 'implementation', 'review', 'close-out', ...SUPERVISORS];

const pop = all.filter((s) => s.first >= since && s.first < until && s.kind);
const legIssues = new Set(); for (const s of pop) if (s.runner && s.kind === 'autopilot') for (const x of s.dispatchedIssues) if (x !== s.headerIssue) legIssues.add(x);
for (const s of pop) {
  if (s.kind === 'autopilot') s.role = s.runner ? 'Runner' : legIssues.has(s.headerIssue) ? 'leg' : s.stepper ? 'stepper' : 'autopilot';
  else if (s.kind === 'custom') s.role = /paper|survey|check|research|essay|study/i.test(s.promptName || '') ? 'research (custom)' : 'other';
  else s.role = ['research', 'plan', 'plan-review', 'implementation', 'review', 'close-out'].includes(s.kind) ? s.kind : 'other';
  s.prodTags = PRODUCTIVE[SUPERVISORS.includes(s.role) ? 'supervisor' : s.role] || PRODUCTIVE.other;
}

const firstProd = (b, tags) => { let best = null; for (const t of tags) if (t in b.firstOf && (!best || b.firstOf[t] < b.firstOf[best])) best = t; return best; };
const median = (a) => { const s = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const q = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); if (!s.length) return null; return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
const r1 = (x) => (x == null ? null : +x.toFixed(1));

// --- Part 1: orientation by role -----------------------------------------------------------------------------------------
function split(s, tags) {
  const o = { boot: s.boot.units, ticketCtx: 0, orient1: 0, reorient: 0, noAction: 0, work: 0, sub: s.subUnits, firstCalls: null, firstMin: null, firstUnits: null, firstHas: false, lowUnits: null, lowCalls: null };
  s.beats.forEach((b, i) => {
    const t = firstProd(b, tags);
    if (!t) { o.noAction += b.units; return; }
    const before = b.unitsBefore[t];
    if (i === 0) {
      // The lower bound: the turns spent on the prompt, ticket, instructions and repo state before the first file read or search.
      const look = firstProd(b, ['read', 'search']); const low = look && b.firstOf[look] < b.firstOf[t] ? b.unitsBefore[look] : before;
      o.ticketCtx += low; o.orient1 += before - low; o.firstHas = true;
      o.firstCalls = s.boot.calls + b.callsBefore[t]; o.firstMin = (s.boot.activeMs + b.msBefore[t]) / 60e3; o.firstUnits = s.boot.units + before;
      o.lowUnits = s.boot.units + low; o.lowCalls = s.boot.calls + (look && b.firstOf[look] < b.firstOf[t] ? b.callsBefore[look] : b.callsBefore[t]);
    }
    else o.reorient += before;
    o.work += b.units - before;
  });
  return o;
}
const part1 = {}; const part1u = {};
for (const role of [...ROLES, 'other']) {
  const ss = pop.filter((s) => s.role === role && s.beats.length);
  if (!ss.length) continue;
  for (const [label, store, tagsOf] of [['role', part1, (s) => s.prodTags], ['uniform', part1u, () => UNIFORM]]) {
    const sp = ss.map((s) => ({ s, o: split(s, tagsOf(s)) }));
    const tot = sp.reduce((a, { s }) => a + s.units, 0);
    const sum = (k) => sp.reduce((a, { o }) => a + o[k], 0);
    const withProd = sp.filter(({ o }) => o.firstHas);
    store[role] = {
      sessions: ss.length, reachedProductive: withProd.length, units: Math.round(tot),
      share: { bootstrap: pct(sum('boot'), tot), ticketContext: pct(sum('ticketCtx'), tot), orientation: pct(sum('orient1'), tot), reorientation: pct(sum('reorient'), tot), noActionBeats: pct(sum('noAction'), tot), work: pct(sum('work'), tot), subagents: pct(sum('sub'), tot) },
      orientationShare: pct(sum('boot') + sum('ticketCtx') + sum('orient1') + sum('reorient'), tot),
      orientationLowerShare: pct(sum('boot') + sum('ticketCtx'), tot),
      medianSessionOrientationShare: r1(median(sp.map(({ s, o }) => 100 * (o.boot + o.ticketCtx + o.orient1 + o.reorient) / (s.units || 1)))),
      lower: { medianUnitsK: r1(median(withProd.map(({ o }) => o.lowUnits / 1e3))), medianCalls: median(withProd.map(({ o }) => o.lowCalls)) },
      firstProductive: { medianUnitsK: r1(median(withProd.map(({ o }) => o.firstUnits / 1e3))), p75UnitsK: r1(q(withProd.map(({ o }) => o.firstUnits / 1e3), 0.75)), medianCalls: median(withProd.map(({ o }) => o.firstCalls)), p75Calls: q(withProd.map(({ o }) => o.firstCalls), 0.75), medianMin: r1(median(withProd.map(({ o }) => o.firstMin))), p75Min: r1(q(withProd.map(({ o }) => o.firstMin), 0.75)) },
      medianSessionUnitsK: r1(median(ss.map((s) => s.units / 1e3))), medianSessionCalls: median(ss.map((s) => s.calls.filter((c) => !c.sub).length)), medianSessionMin: r1(median(ss.map((s) => s.activeMs / 60e3))),
      laterBeats: ss.reduce((a, s) => a + Math.max(0, s.beats.length - 1), 0),
      repo: Object.fromEntries(['LinearViewer', 'simple-dispatcher'].map((r) => [r, ss.filter((s) => s.repo === r).length])),
    };
  }
}
// Fleet totals: orientation share of all tokens, by repo too.
const fleet = (filter) => {
  const ss = pop.filter(filter); const tot = ss.reduce((a, s) => a + s.units, 0); let boot = 0; let tc = 0; let o1 = 0; let re = 0; let na = 0; let sub = 0; let wk = 0;
  for (const s of ss) { const o = split(s, s.prodTags); boot += o.boot; tc += o.ticketCtx; o1 += o.orient1; re += o.reorient; na += o.noAction; sub += o.sub; wk += o.work; }
  return { sessions: ss.length, unitsM: +(tot / 1e6).toFixed(1), work: pct(wk, tot), bootstrap: pct(boot, tot), ticketContext: pct(tc, tot), orientation: pct(o1, tot), reorientation: pct(re, tot), noActionBeats: pct(na, tot), subagents: pct(sub, tot), orientationTotal: pct(boot + tc + o1 + re, tot), orientationLower: pct(boot + tc, tot) };
};
const fleetAll = { all: fleet(() => true), LinearViewer: fleet((s) => s.repo === 'LinearViewer'), 'simple-dispatcher': fleet((s) => s.repo === 'simple-dispatcher') };

// The bootstrap summarise: which sessions still run it (broker-armed launches of some kinds skip it), and what it reads.
const bootstrap = (() => {
  const ran = pop.filter((s) => s.boot.turns > 0 && s.beats.length);
  const reads = pop.flatMap((s) => s.reads.filter((r) => r.beat === -1 && r.via !== 'auto-loaded'));
  const top = {}; for (const r of reads) top[r.key] = (top[r.key] || 0) + 1;
  return { sessionsWithBootstrap: ran.length, ofSessions: pop.filter((s) => s.beats.length).length, byRole: Object.fromEntries([...ROLES, 'other'].map((r) => [r, `${ran.filter((s) => s.role === r).length}/${pop.filter((s) => s.role === r && s.beats.length).length}`])), medianCalls: median(ran.map((s) => s.boot.calls)), medianUnitsK: r1(median(ran.map((s) => s.boot.units / 1e3))), reads: reads.length, topReads: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 6) };
})();

// Each role's share of the fleet's weighted units, and the proxy instructions' share of the carried window.
const roleShare = (() => { const tot = pop.reduce((a, s) => a + s.units, 0); return Object.fromEntries([...ROLES, 'other'].map((r) => [r, pct(pop.filter((s) => s.role === r).reduce((a, s) => a + s.units, 0), tot)])); })();
const instructions = (() => { const W = pop.reduce((a, s) => a + s.windowSum, 0); let c = 0; let n = 0; for (const s of pop) { const seen = new Set(); for (const r of s.reads) if (r.key === 'proxy:instructions') { seen.add(r.call); } for (const ci of seen) { c += s.calls[ci]?.carry || 0; n++; } } return { reads: n, sessions: pop.filter((s) => s.reads.some((r) => r.key === 'proxy:instructions')).length, carryPctOfWindow: pct(c, W) }; })();

// --- Part 2: what the context holds ---------------------------------------------------------------------------------------
const CATS = ['base context (system prompt, tools, CLAUDE.md)', 'prompts and templates', 'tickets and comments', 'code', 'test code', 'docs', 'CLAUDE.md loaded by the harness', 'data', 'other proxy reads', 'git and GitHub', 'search results', 'command output', 'session transcripts', 'subagent reports', 'compaction summaries', 'harness reminders', "the model's own output", 'other files', 'other tool results'];
const part2 = {};
for (const role of [...ROLES, 'all']) {
  const ss = pop.filter((s) => role === 'all' || s.role === role); if (!ss.length) continue;
  const W = ss.reduce((a, s) => a + s.windowSum, 0); const row = { sessions: ss.length };
  // One bytes-a-token ratio overcounts prose (prompts tokenize at nearer 4 bytes a token than 2.6), so a prompt-heavy role can
  // attribute more than its window. Such a row is scaled back to 100% and the excess recorded.
  const v = Object.fromEntries(CATS.map((c) => [c, ss.reduce((a, s) => a + (s.carry[c] || 0), 0)])); const acc = Object.values(v).reduce((a, b) => a + b, 0);
  const k = acc > W ? W / acc : 1; for (const c of CATS) row[c] = pct(v[c] * k, W);
  row.unattributed = pct(Math.max(0, W - acc), W); row.overAttributedPct = acc > W ? pct(acc - W, W) : 0;
  // What enters the context, not what is carried: tool-result tokens by content class, excluding the base.
  part2[role] = row;
}
// Same, per repo, for 'all'.
for (const repo of ['LinearViewer', 'simple-dispatcher']) {
  const ss = pop.filter((s) => s.repo === repo); const W = ss.reduce((a, s) => a + s.windowSum, 0); const row = { sessions: ss.length };
  const v = Object.fromEntries(CATS.map((c) => [c, ss.reduce((a, s) => a + (s.carry[c] || 0), 0)])); const acc = Object.values(v).reduce((a, b) => a + b, 0); const k = acc > W ? W / acc : 1;
  for (const c of CATS) row[c] = pct(v[c] * k, W); row.unattributed = pct(Math.max(0, W - acc), W); row.overAttributedPct = acc > W ? pct(acc - W, W) : 0;
  part2[`all · ${repo}`] = row;
}

// --- Part 3: re-reading within a ticket ------------------------------------------------------------------------------------
// A read is a file in a repo checkout, a ticket (issue, brief, relations), a dispatch item's feedback, or the proxy's instructions.
// Charged two ways: to the session's own ticket (the session entered) or to the ticket of the dispatch item it was working at the
// time (the child the log names). A repeat is a key the same session already read (within-session), or that an earlier session
// charged to the same ticket read (cross-session).
// A read's tokens and carry are its call's, split evenly over the reads that call made.
for (const s of pop) { const n = new Map(); for (const r of s.reads) n.set(r.call, (n.get(r.call) || 0) + 1); for (const r of s.reads) { const c = s.calls[r.call]; const k = n.get(r.call) || 1; r.tok = r.call >= 0 ? (c?.tokens || 0) / k : 0; r.carry = r.call >= 0 ? (c?.carry || 0) / k : 0; } }
const readTokens = (s, r) => r.tok;
function rereads(rule) {
  const byTicket = new Map();
  for (const s of pop) for (const r of s.reads) {
    if (!r.key || r.key.startsWith('scratch:') || r.via === 'auto-loaded') continue;
    const t = rule === 'entered' ? s.headerIssue : r.issue || s.headerIssue; if (!t) continue;
    (byTicket.get(t) || byTicket.set(t, []).get(t)).push({ s, r, tok: readTokens(s, r) });
  }
  const tickets = [];
  let N = 0; let within = 0; let cross = 0; let tokAll = 0; let tokWithin = 0; let tokCross = 0;
  const filesPerTicket = [];
  for (const [t, rs] of byTicket) {
    rs.sort((a, b) => a.r.ts - b.r.ts);
    const seenBy = new Map(); // key -> Set(session file)
    let n = 0; let w = 0; let c = 0; let tw = 0; let tc = 0; let ta = 0;
    for (const { s, r, tok } of rs) {
      const set = seenBy.get(r.key) || seenBy.set(r.key, new Set()).get(r.key);
      n++; ta += tok;
      if (set.has(s.file)) { w++; tw += tok; } else if (set.size) { c++; tc += tok; }
      set.add(s.file);
    }
    const sessions = new Set(rs.map((x) => x.s.file)).size;
    const repo = (() => { const v = {}; for (const { s } of rs) v[s.repo] = (v[s.repo] || 0) + 1; return Object.entries(v).sort((a, b) => b[1] - a[1])[0]?.[0]; })();
    const firstAt = rs[0].r.ts;
    const multi = [...seenBy.values()].filter((x) => x.size > 1);
    // Session-file pairs: a pair repeats when an earlier session charged to this ticket read the same key; its tokens are every read of the key in the session.
    const pairTok = new Map(); const pairCarry = new Map(); for (const { s, r, tok } of rs) { const k = `${s.file}|${r.key}`; pairTok.set(k, (pairTok.get(k) || 0) + tok); pairCarry.set(k, (pairCarry.get(k) || 0) + r.carry); }
    const firstSess = new Map(); for (const { s, r } of rs) { const ks = firstSess.get(r.key) || firstSess.set(r.key, []).get(r.key); if (!ks.includes(s.file)) ks.push(s.file); }
    let pairs = 0; let rp = 0; let ptAll = 0; let ptRep = 0; let pcAll = 0; let pcRep = 0;
    for (const [key, list] of firstSess) list.forEach((f, i) => { pairs++; const tk = pairTok.get(`${f}|${key}`) || 0; const cy = pairCarry.get(`${f}|${key}`) || 0; ptAll += tk; pcAll += cy; if (i > 0) { rp++; ptRep += tk; pcRep += cy; } });
    const win = [...new Set(rs.map((x) => x.s))].reduce((a, x) => a + x.windowSum, 0);
    tickets.push({ ticket: t, repo, sessions, pairs, repeatPairs: rp, pairTokens: ptAll, repeatPairTokens: ptRep, readCarry: pcAll, repeatCarry: pcRep, window: win, reads: n, within: w, cross: c, tokens: ta, tokWithin: tw, tokCross: tc, keys: seenBy.size, keysReadByMany: multi.length, meanSessionsPerKey: +(([...seenBy.values()].reduce((a, x) => a + x.size, 0)) / seenBy.size).toFixed(2), maxSessionsOnAKey: Math.max(...[...seenBy.values()].map((x) => x.size)), firstAt });
    N += n; within += w; cross += c; tokAll += ta; tokWithin += tw; tokCross += tc;
    filesPerTicket.push(...[...seenBy.values()].map((x) => x.size));
  }
  const multiSession = tickets.filter((x) => x.sessions >= 2 && x.firstAt >= Date.parse('2026-09-01'));
  const sumOf = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
  return {
    tickets: tickets.length, reads: N, withinPct: pct(within, N), crossPct: pct(cross, N), repeatPct: pct(within + cross, N),
    tokWithinPct: pct(tokWithin, tokAll), tokCrossPct: pct(tokCross, tokAll), readTokensM: +(tokAll / 1e6).toFixed(1),
    multiSessionCohort: {
      note: 'tickets with two or more sessions whose first read was on or after 1 September',
      tickets: multiSession.length, reads: sumOf(multiSession, 'reads'), withinPct: pct(sumOf(multiSession, 'within'), sumOf(multiSession, 'reads')), crossPct: pct(sumOf(multiSession, 'cross'), sumOf(multiSession, 'reads')),
      tokWithinPct: pct(sumOf(multiSession, 'tokWithin'), sumOf(multiSession, 'tokens')), tokCrossPct: pct(sumOf(multiSession, 'tokCross'), sumOf(multiSession, 'tokens')),
      pairs: sumOf(multiSession, 'pairs'), repeatPairPct: pct(sumOf(multiSession, 'repeatPairs'), sumOf(multiSession, 'pairs')), repeatPairTokenPct: pct(sumOf(multiSession, 'repeatPairTokens'), sumOf(multiSession, 'pairTokens')),
      medianTicketRepeatPairPct: r1(median(multiSession.map((x) => 100 * x.repeatPairs / x.pairs))), p25TicketRepeatPairPct: r1(q(multiSession.map((x) => 100 * x.repeatPairs / x.pairs), 0.25)), p75TicketRepeatPairPct: r1(q(multiSession.map((x) => 100 * x.repeatPairs / x.pairs), 0.75)),
      readsPerPair: +(sumOf(multiSession, 'reads') / sumOf(multiSession, 'pairs')).toFixed(2),
      readCarryPctOfWindow: pct(sumOf(multiSession, 'readCarry'), sumOf(multiSession, 'window')), repeatCarryPctOfWindow: pct(sumOf(multiSession, 'repeatCarry'), sumOf(multiSession, 'window')),
      medianTicketCrossPct: r1(median(multiSession.map((x) => 100 * x.cross / x.reads))), medianTicketRepeatPct: r1(median(multiSession.map((x) => 100 * (x.cross + x.within) / x.reads))),
      medianSessions: median(multiSession.map((x) => x.sessions)), medianMeanSessionsPerKey: median(multiSession.map((x) => x.meanSessionsPerKey)), medianMaxSessionsOnAKey: median(multiSession.map((x) => x.maxSessionsOnAKey)),
      byRepo: Object.fromEntries(['LinearViewer', 'simple-dispatcher'].map((r) => { const xs = multiSession.filter((x) => x.repo === r); return [r, { tickets: xs.length, crossPct: pct(sumOf(xs, 'cross'), sumOf(xs, 'reads')), withinPct: pct(sumOf(xs, 'within'), sumOf(xs, 'reads')), repeatPairPct: pct(sumOf(xs, 'repeatPairs'), sumOf(xs, 'pairs')), repeatPairTokenPct: pct(sumOf(xs, 'repeatPairTokens'), sumOf(xs, 'pairTokens')), medianTicketRepeatPairPct: r1(median(xs.map((x) => 100 * x.repeatPairs / x.pairs))) }]; })),
    },
    perTicket: multiSession.map(({ ticket, repo, sessions, pairs, repeatPairs, reads, within, cross, keys, meanSessionsPerKey, maxSessionsOnAKey }) => ({ ticket, repo, sessions, pairs, repeatPairs, reads, within, cross, keys, meanSessionsPerKey, maxSessionsOnAKey })),
  };
}
const part3 = { entered: rereads('entered'), byItem: rereads('item') };
// By read class (file kind) under the item rule: which kinds of thing are re-read across sessions.
{
  const byKey = new Map(); const cls = {};
  for (const s of pop) for (const r of s.reads) {
    if (!r.key || r.key.startsWith('scratch:') || r.via === 'auto-loaded') continue; const t = r.issue || s.headerIssue; if (!t) continue;
    const k = `${t}|${r.key}`; const set = byKey.get(k) || byKey.set(k, new Set()).get(k);
    const c = r.key.startsWith('ticket:') ? 'tickets' : r.key.startsWith('dispatch:') ? 'dispatch feedback' : r.key === 'proxy:instructions' ? 'proxy instructions' : r.cat;
    cls[c] ||= { reads: 0, cross: 0 }; cls[c].reads++; if (set.size && !set.has(s.file)) cls[c].cross++; set.add(s.file);
  }
  part3.byClassItem = Object.fromEntries(Object.entries(cls).map(([k, v]) => [k, { reads: v.reads, crossPct: pct(v.cross, v.reads) }]));
}
// Re-finding inside orientation: of the reads a session makes before its beat's first productive call, how many (and how many
// tokens) repeat what an earlier session charged to the same ticket read; and of a later beat's reads, how many the same session
// had already made in an earlier beat. Item rule.
{
  const firstSeen = new Map(); // ticket|key -> earliest ts per session
  for (const s of pop) for (const r of s.reads) { if (!r.key || r.key.startsWith('scratch:') || r.via === 'auto-loaded') continue; const t = r.issue || s.headerIssue; if (!t) continue; const k = `${t}|${r.key}`; const m = firstSeen.get(k) || firstSeen.set(k, new Map()).get(k); if (!m.has(s.file) || m.get(s.file) > r.ts) m.set(s.file, r.ts); }
  const isRepeat = (s, r) => { const t = r.issue || s.headerIssue; const m = firstSeen.get(`${t}|${r.key}`); if (!m) return false; const mine = m.get(s.file); for (const [f, ts] of m) if (f !== s.file && ts < mine) return true; return false; };
  const byRole = {};
  for (const s of pop) {
    const prodTs = s.beats.map((b) => { const t = firstProd(b, s.prodTags); return t ? b.firstOf[t] : Infinity; });
    const seenInBeat = new Map();
    for (const r of s.reads) {
      if (!r.key || r.key.startsWith('scratch:') || r.via === 'auto-loaded') continue;
      const row = byRole[s.role] ||= { orientReads: 0, orientRepeat: 0, orientTok: 0, orientRepeatTok: 0, laterReads: 0, laterSeen: 0, allReads: 0, allRepeat: 0, allTok: 0, allRepeatTok: 0 };
      const rep = isRepeat(s, r); row.allReads++; row.allTok += r.tok; if (rep) { row.allRepeat++; row.allRepeatTok += r.tok; }
      if (r.beat >= 0 && r.ts < prodTs[r.beat]) { row.orientReads++; row.orientTok += r.tok; if (rep) { row.orientRepeat++; row.orientRepeatTok += r.tok; } }
      if (r.beat > 0) { row.laterReads++; const b0 = seenInBeat.get(r.key); if (b0 != null && b0 < r.beat) row.laterSeen++; }
      if (!seenInBeat.has(r.key)) seenInBeat.set(r.key, r.beat);
    }
  }
  // Was the file unchanged between the earlier session's read and this one? Changed means a session charged to the ticket edited
  // it, or a commit reached origin/main touching it, in between. Ticket reads are left out: a ticket gains comments as it moves.
  const mainTimes = {};
  for (const [repo, dir] of Object.entries(REPO_DIRS)) {
    let log = ''; try { log = execFileSync('git', ['-C', dir, 'log', '--format=@%ct', '--name-only', '--since=2026-08-20', 'origin/main'], { encoding: 'utf8', maxBuffer: 256e6 }); } catch { /* repo absent */ }
    for (const block of log.split('@').filter(Boolean)) { const [t, ...fs] = block.split('\n'); for (const f of fs.filter(Boolean)) (mainTimes[`${repo}:${f}`] ||= []).push(Number(t) * 1000); }
  }
  const editsBy = new Map(); for (const s of pop) for (const e of s.edits) { const k = `${e.issue || s.headerIssue}|${e.key}`; (editsBy.get(k) || editsBy.set(k, []).get(k)).push(e.ts); }
  const changedBetween = (t, key, a, b) => (editsBy.get(`${t}|${key}`) || []).some((x) => x > a && x < b) || (mainTimes[key] || []).some((x) => x > a && x < b);
  const fileRep = { pairs: 0, repeat: 0, unchanged: 0, tok: 0, repTok: 0, unchTok: 0, carry: 0, unchCarry: 0, window: 0 };
  const byRoleU = {};
  for (const s of pop) {
    const pairTok = new Map(); const pairCarry = new Map(); const pairFirst = new Map();
    for (const r of s.reads) { if (!r.key || r.via === 'auto-loaded' || !/^(LinearViewer|simple-dispatcher):/.test(r.key)) continue; const t = r.issue || s.headerIssue; if (!t) continue; const k = `${t}|${r.key}`; pairTok.set(k, (pairTok.get(k) || 0) + r.tok); pairCarry.set(k, (pairCarry.get(k) || 0) + r.carry); if (!pairFirst.has(k)) pairFirst.set(k, r.ts); }
    fileRep.window += s.windowSum;
    const row = byRoleU[s.role] ||= { pairs: 0, repeat: 0, unchanged: 0, carry: 0, unchCarry: 0, window: 0 }; row.window += s.windowSum;
    for (const [k, ts] of pairFirst) {
      const [t, ...rest] = k.split('|'); const key = rest.join('|'); const m = firstSeen.get(k);
      let earliest = Infinity; for (const [f, x] of m) if (f !== s.file && x < ts) earliest = Math.min(earliest, x);
      fileRep.pairs++; row.pairs++; fileRep.tok += pairTok.get(k); fileRep.carry += pairCarry.get(k); row.carry += pairCarry.get(k);
      if (earliest === Infinity) continue;
      fileRep.repeat++; row.repeat++; fileRep.repTok += pairTok.get(k);
      // The most recent earlier read by another session is the one whose content could have been handed on.
      let latest = -Infinity; for (const [f, x] of m) if (f !== s.file && x < ts) latest = Math.max(latest, x);
      if (!changedBetween(t, key, latest, ts)) { fileRep.unchanged++; row.unchanged++; fileRep.unchTok += pairTok.get(k); fileRep.unchCarry += pairCarry.get(k); row.unchCarry += pairCarry.get(k); }
    }
  }
  part3.unchangedFiles = { note: 'repo-file reads only, item rule; a pair is one session reading one file', pairs: fileRep.pairs, repeatPct: pct(fileRep.repeat, fileRep.pairs), unchangedRepeatPct: pct(fileRep.unchanged, fileRep.pairs), unchangedOfRepeatsPct: pct(fileRep.unchanged, fileRep.repeat), unchangedRepeatTokPct: pct(fileRep.unchTok, fileRep.tok), fileReadCarryPctOfWindow: pct(fileRep.carry, fileRep.window), unchangedRepeatCarryPctOfWindow: pct(fileRep.unchCarry, fileRep.window),
    byRole: Object.fromEntries(Object.entries(byRoleU).map(([k, x]) => [k, { pairs: x.pairs, repeatPct: pct(x.repeat, x.pairs), unchangedRepeatPct: pct(x.unchanged, x.pairs), fileReadCarryPctOfWindow: pct(x.carry, x.window), unchangedRepeatCarryPctOfWindow: pct(x.unchCarry, x.window) }])) };
  // Re-finding in weighted units: each beat's orientation units (bootstrap included for the first beat) times the share of that
  // span's read tokens that repeat an earlier session's reads on the ticket. An estimate: it assumes a span's units follow its reads.
  const rf = {}; let rfAll = 0; let orAll = 0; const totU = pop.reduce((a, s) => a + s.units, 0);
  for (const s of pop) {
    const row = rf[s.role] ||= { units: 0, orient: 0, refind: 0 }; row.units += s.units;
    s.beats.forEach((b, i) => {
      const t = firstProd(b, s.prodTags); if (!t) return;
      const end = b.firstOf[t]; const start = b.start; const ou = b.unitsBefore[t] + (i === 0 ? s.boot.units : 0);
      const rs = s.reads.filter((r) => r.beat === i && r.ts < end && r.key && !r.key.startsWith('scratch:') && r.via !== 'auto-loaded');
      const tk = rs.reduce((a, r) => a + r.tok, 0); const rep = rs.filter((r) => isRepeat(s, r)).reduce((a, r) => a + r.tok, 0);
      // The strict reading: only repo files no session on the ticket and no commit to main had changed since the earlier read.
      const strict = rs.filter((r) => /^(LinearViewer|simple-dispatcher):/.test(r.key) && isRepeat(s, r) && (() => { const t = r.issue || s.headerIssue; const m = firstSeen.get(`${t}|${r.key}`); let latest = -Infinity; for (const [f, x] of m) if (f !== s.file && x < r.ts) latest = Math.max(latest, x); return !changedBetween(t, r.key, latest, r.ts); })()).reduce((a, r) => a + r.tok, 0);
      row.orient += ou; if (tk) { row.refind += ou * rep / tk; row.strict = (row.strict || 0) + ou * strict / tk; }
    });
  }
  let stAll = 0; for (const r of Object.values(rf)) { rfAll += r.refind; orAll += r.orient; stAll += r.strict || 0; }
  part3.refindUnits = { all: { orientationPct: pct(orAll, totU), refindPct: pct(rfAll, totU), refindStrictPct: pct(stAll, totU), refindShareOfOrientation: pct(rfAll, orAll), refindStrictShareOfOrientation: pct(stAll, orAll) }, ...Object.fromEntries(Object.entries(rf).map(([k, r]) => [k, { orientationPct: pct(r.orient, r.units), refindPct: pct(r.refind, r.units), refindStrictPct: pct(r.strict || 0, r.units), refindShareOfOrientation: pct(r.refind, r.orient) }])) };
  const tot = Object.values(byRole).reduce((a, x) => { for (const [k, v] of Object.entries(x)) a[k] = (a[k] || 0) + v; return a; }, {});
  part3.refinding = Object.fromEntries([...Object.entries(byRole), ['all', tot]].map(([k, x]) => [k, { orientReads: x.orientReads, orientRepeatPct: pct(x.orientRepeat, x.orientReads), orientRepeatTokPct: pct(x.orientRepeatTok, x.orientTok), orientShareOfReadsPct: pct(x.orientReads, x.allReads), allRepeatPct: pct(x.allRepeat, x.allReads), allRepeatTokPct: pct(x.allRepeatTok, x.allTok), laterBeatReads: x.laterReads, laterBeatAlreadyReadPct: pct(x.laterSeen, x.laterReads) }]));
}
// CLAUDE.md files the harness loaded on demand, and how often the same session also read that file itself.
{
  let auto = 0; let both = 0; let autoTok = 0;
  for (const s of pop) { const a = s.reads.filter((r) => r.via === 'auto-loaded'); auto += a.length; autoTok += a.reduce((x, r) => x + (r.tokens || 0), 0); for (const r of a) if (s.reads.some((x) => x.key === r.key && x.via !== 'auto-loaded')) both++; }
  part3.autoLoaded = { loads: auto, sessions: pop.filter((s) => s.reads.some((r) => r.via === 'auto-loaded')).length, alsoReadByHand: both, tokensK: Math.round(autoTok / 1e3) };
}
// Fleet-wide: the files the most distinct sessions read, whatever their ticket.
{
  const m = new Map();
  for (const s of pop) for (const r of new Set(s.reads.filter((x) => x.via !== 'auto-loaded').map((x) => x.key))) { if (!r || r.startsWith('scratch:') || r.startsWith('ticket:') || r.startsWith('dispatch:')) continue; m.set(r, (m.get(r) || 0) + 1); }
  part3.mostReadAcrossSessions = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => ({ key: k, sessions: n, pctOfSessions: pct(n, pop.length) }));
}

// --- Part 5: research sessions ---------------------------------------------------------------------------------------------
const GROUP = { search: 'search', read: 'read files', 'ticket-read': 'read tickets and feedback', 'proxy-read': 'read tickets and feedback', 'prompt-fetch': 'read tickets and feedback', 'git-read': 'git and GitHub history', 'gh-read': 'git and GitHub history', 'transcript-read': 'read session transcripts', run: 'run scripts and tests', compute: 'inline computation', edit: 'write files', 'proxy-write': 'write to tracker, dispatch, merge', dispatch: 'write to tracker, dispatch, merge', 'gh-write': 'write to tracker, dispatch, merge', 'git-write': 'write to tracker, dispatch, merge', web: 'web', subagent: 'subagents', nav: 'other', other: 'other' };
const part5 = {};
for (const role of ['research', 'research (custom)', 'implementation', 'review']) {
  const ss = pop.filter((s) => s.role === role); const calls = ss.flatMap((s) => s.calls);
  const g = {}; let tok = 0;
  for (const c of calls) { const k = GROUP[c.cls] || 'other'; g[k] ||= { calls: 0, tokens: 0 }; g[k].calls++; g[k].tokens += c.tokens || 0; tok += c.tokens || 0; }
  const qs = {}; for (const c of calls) for (const x of new Set(c.q || [])) qs[x] = (qs[x] || 0) + 1; // once per call
  // Searches by shape, from the command's text: repo-wide (grep -r, rg, git grep, the Grep tool), inside a named file, or a listing.
  const shape = (c) => { const t = c.cmd.replace(/^(cd [^;&\n]+(;|&&)\s*)+/, ''); if (/\b(git grep|rg |ag )|grep\s+(-\w*[rR]\w*|--recursive)|^[^\s]+$/.test(t)) return 'repo-wide'; if (/^\s*(ls|find|wc|du|tree|stat|file)\b/.test(t)) return 'listing'; if (/\bgrep\b/.test(t)) return 'in a named file'; return 'listing'; };
  const sk = {}; for (const c of calls) if (c.cls === 'search') sk[shape(c)] = (sk[shape(c)] || 0) + 1;
  part5[role] = { searchShapes: Object.fromEntries(Object.entries(sk).map(([k, v]) => [k, { calls: v, perSession: +(v / ss.length).toFixed(1) }])), sessions: ss.length, calls: calls.length, medianCalls: median(ss.map((s) => s.calls.length)), byGroup: Object.fromEntries(Object.entries(g).sort((a, b) => b[1].calls - a[1].calls).map(([k, v]) => [k, { callsPct: pct(v.calls, calls.length), tokensPct: pct(v.tokens, tok) }])), questions: Object.fromEntries(Object.entries(qs).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { calls: v, perSession: +(v / ss.length).toFixed(1) }])) };
}

const out = { generatedAt: new Date().toISOString(), window: [new Date(since).toISOString(), new Date(until).toISOString()], population: pop.length, bootstrap, roleShare, instructions, roles: Object.fromEntries([...ROLES, 'other'].map((r) => [r, pop.filter((s) => s.role === r).length])), fleet: fleetAll, part1, part1uniform: part1u, part2, part3, part5 };
writeFileSync(outPath, JSON.stringify(out, null, 1));
const p = (x) => console.log(JSON.stringify(x, null, 1));
console.log(`population ${pop.length} sessions`, out.roles);
console.log('\n## Fleet orientation share of weighted units'); p(fleetAll); p({ bootstrap, roleShare, instructions });
console.log('\n## Part 1: by role (role definition)');
console.log(['role', 'n', 'reached', 'boot%', 'ticket%', 'orient%', 'reorient%', 'noAction%', 'work%', 'sub%', 'ORIENT%', 'medSess%', 'medK', 'p75K', 'medCalls', 'p75Calls', 'medMin', 'p75Min', 'sessK', 'sessCalls', 'sessMin'].join('\t'));
for (const [r, v] of Object.entries(part1)) console.log([r, v.sessions, v.reachedProductive, v.share.bootstrap, v.share.ticketContext, v.share.orientation, v.share.reorientation, v.share.noActionBeats, v.share.work, v.share.subagents, v.orientationShare, v.medianSessionOrientationShare, v.firstProductive.medianUnitsK, v.firstProductive.p75UnitsK, v.firstProductive.medianCalls, v.firstProductive.p75Calls, v.firstProductive.medianMin, v.firstProductive.p75Min, v.medianSessionUnitsK, v.medianSessionCalls, v.medianSessionMin, 'low', v.orientationLowerShare, v.lower.medianUnitsK, v.lower.medianCalls].join('\t'));
console.log('\n## Part 1: uniform definition (first non-reading call)');
for (const [r, v] of Object.entries(part1u)) console.log([r, v.sessions, v.reachedProductive, v.orientationShare, v.medianSessionOrientationShare, v.firstProductive.medianUnitsK, v.firstProductive.medianCalls, v.firstProductive.medianMin].join('\t'));
console.log('\n## Part 2: share of summed per-turn window (carried), pooled');
console.log(['role', 'n', ...CATS.map((c) => c.split(' ')[0]), 'unattr', 'over'].join('\t'));
for (const [r, v] of Object.entries(part2)) console.log([r, v.sessions, ...CATS.map((c) => v[c]), v.unattributed, v.overAttributedPct].join('\t'));
console.log('\n## Part 3: re-reads'); for (const k of ['entered', 'byItem']) { const { perTicket, ...rest } = part3[k]; console.log(k); p(rest); }
p({ byClassItem: part3.byClassItem }); p(part3.mostReadAcrossSessions); p({ autoLoaded: part3.autoLoaded }); p(part3.refinding); p(part3.unchangedFiles); p(part3.refindUnits);
console.log('\n## Part 5'); p(part5);
