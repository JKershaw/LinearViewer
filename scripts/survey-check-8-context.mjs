// LIN-3184 (survey-check-8): adversarial re-measures of starting-context.md's load-bearing figures, from the same git-ignored snapshot
// survey-context-extract.mjs writes. Each block re-derives one figure under the paper's own rule and under one alternative, so the
// gap between the two is the sensitivity. Nothing here changes the paper's scripts.
// Usage: node scripts/survey-check-8-context.mjs [--in data/survey-context/sessions.json] [--since 2026-08-31] [--until 2026-10-01T00:00Z] [--sd ../simple-dispatcher] [--out data/survey-check-8/context.json]
// Blocks: (1) what the 82–85% of orientation reads that repeat are made of (repo files, the ticket, the proxy instructions, dispatch
// feedback), per read and per session-thing pair; (2) re-finding units without the bootstrap, and with calls instead of read tokens
// as the weight; (3) "unchanged" with main's change times taken from the merge that landed a file (first-parent) instead of the
// commit's own time; (4) what the bootstrap's reads cost the turns after it, as carried cache reads; (5) later beats' re-reads by class.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { execFileSync } from 'child_process';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const input = arg('--in', 'data/survey-context/sessions.json');
const since = Date.parse(arg('--since', '2026-08-31')); const until = Date.parse(arg('--until', '2026-10-01T00:00:00Z'));
const outPath = arg('--out', 'data/survey-check-8/context.json');
const REPO_DIRS = { LinearViewer: '.', 'simple-dispatcher': arg('--sd', '../simple-dispatcher') };
const { sessions: all } = JSON.parse(readFileSync(input, 'utf8'));
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);

// Role and productive call exactly as survey-context-analyse.mjs assigns them.
const PRODUCTIVE = {
  implementation: ['repo-edit'], plan: ['any-edit', 'proxy-write-substantive'], 'plan-review': ['run', 'any-edit', 'proxy-write-substantive', 'gh-write'],
  review: ['run', 'any-edit', 'proxy-write-substantive', 'gh-write'], 'close-out': ['repo-edit', 'git-write', 'gh-write', 'proxy-write-substantive', 'run'],
  research: ['run', 'any-edit'], 'research (custom)': ['run', 'any-edit'], supervisor: ['dispatch', 'proxy-write', 'gh-write', 'git-write'],
  other: ['any-edit', 'run', 'dispatch', 'proxy-write-substantive', 'gh-write', 'git-write'],
};
const SUPERVISORS = ['Runner', 'leg', 'stepper', 'autopilot'];
const pop = all.filter((s) => s.first >= since && s.first < until && s.kind);
const legIssues = new Set(); for (const s of pop) if (s.runner && s.kind === 'autopilot') for (const x of s.dispatchedIssues) if (x !== s.headerIssue) legIssues.add(x);
for (const s of pop) {
  if (s.kind === 'autopilot') s.role = s.runner ? 'Runner' : legIssues.has(s.headerIssue) ? 'leg' : s.stepper ? 'stepper' : 'autopilot';
  else if (s.kind === 'custom') s.role = /paper|survey|check|research|essay|study/i.test(s.promptName || '') ? 'research (custom)' : 'other';
  else s.role = ['research', 'plan', 'plan-review', 'implementation', 'review', 'close-out'].includes(s.kind) ? s.kind : 'other';
  s.prodTags = PRODUCTIVE[SUPERVISORS.includes(s.role) ? 'supervisor' : s.role] || PRODUCTIVE.other;
}
const firstProd = (b, tags) => { let best = null; for (const t of tags) if (t in b.firstOf && (!best || b.firstOf[t] < b.firstOf[best])) best = t; return best; };
for (const s of pop) { const n = new Map(); for (const r of s.reads) n.set(r.call, (n.get(r.call) || 0) + 1); for (const r of s.reads) { const c = s.calls[r.call]; const k = n.get(r.call) || 1; r.tok = r.call >= 0 ? (c?.tokens || 0) / k : 0; r.carry = r.call >= 0 ? (c?.carry || 0) / k : 0; r.w = 1 / k; } }
const counted = (r) => r.key && !r.key.startsWith('scratch:') && r.via !== 'auto-loaded';
const ticketOf = (s, r) => r.issue || s.headerIssue;
const classOf = (key) => (key.startsWith('ticket:') ? 'ticket' : key.startsWith('dispatch:') ? 'dispatch feedback' : key === 'proxy:instructions' ? 'proxy instructions' : /^(LinearViewer|simple-dispatcher):/.test(key) ? 'repo file' : 'other');

// The paper's repeat rule (item charging): another session charged to the same ticket read the key before this session first did.
const firstSeen = new Map();
for (const s of pop) for (const r of s.reads) { if (!counted(r)) continue; const t = ticketOf(s, r); if (!t) continue; const k = `${t}|${r.key}`; const m = firstSeen.get(k) || firstSeen.set(k, new Map()).get(k); if (!m.has(s.file) || m.get(s.file) > r.ts) m.set(s.file, r.ts); }
const isRepeat = (s, r) => { const m = firstSeen.get(`${ticketOf(s, r)}|${r.key}`); if (!m) return false; const mine = m.get(s.file); for (const [f, ts] of m) if (f !== s.file && ts < mine) return true; return false; };
const latestOther = (s, r) => { const m = firstSeen.get(`${ticketOf(s, r)}|${r.key}`); let latest = -Infinity; for (const [f, x] of m) if (f !== s.file && x < r.ts) latest = Math.max(latest, x); return latest; };
const orientReads = (s) => { const prodTs = s.beats.map((b) => { const t = firstProd(b, s.prodTags); return t ? b.firstOf[t] : Infinity; }); return s.reads.filter((r) => counted(r) && ticketOf(s, r) && r.beat >= 0 && r.ts < prodTs[r.beat]); };

// ---- (1) What the repeating orientation reads are.
const ROLES = ['close-out', 'review', 'plan-review', 'plan', 'implementation', 'research'];
const block1 = {};
for (const role of [...ROLES, 'all']) {
  const ss = pop.filter((s) => role === 'all' || s.role === role);
  const byClass = {}; let reads = 0; let rep = 0; let pairs = 0; let repPairs = 0; let filePairs = 0; let fileRepPairs = 0; let readsPerFirstBeat = 0;
  for (const s of ss) {
    const seen = new Set();
    for (const r of orientReads(s)) {
      const c = classOf(r.key); const g = (byClass[c] ||= { reads: 0, repeat: 0 }); const isRep = isRepeat(s, r);
      reads++; g.reads++; if (isRep) { rep++; g.repeat++; }
      if (!seen.has(r.key)) { seen.add(r.key); pairs++; if (isRep) repPairs++; if (c === 'repo file') { filePairs++; if (isRep) fileRepPairs++; } }
    }
  }
  block1[role] = {
    orientReads: reads, repeatPct: pct(rep, reads),
    repeatsByClassPct: Object.fromEntries(Object.entries(byClass).map(([k, g]) => [k, pct(g.repeat, rep)])),
    readsByClassPct: Object.fromEntries(Object.entries(byClass).map(([k, g]) => [k, pct(g.reads, reads)])),
    repeatPctWithinClass: Object.fromEntries(Object.entries(byClass).map(([k, g]) => [k, pct(g.repeat, g.reads)])),
    pairs, repeatPairPct: pct(repPairs, pairs), repoFilePairs: filePairs, repoFileRepeatPairPct: pct(fileRepPairs, filePairs),
  };
}

// ---- (3) Main's change times: the paper takes each commit's own time (%ct, `git log --name-only`, which lists no files for a merge),
// so a branch commit made before the earlier read and merged after it is missed. The alternative dates a file's change by the
// first-parent commit that brought it to main (the merge, or the commit itself if it was pushed to main directly).
const mainTimes = { own: {}, landed: {} };
for (const [repo, dir] of Object.entries(REPO_DIRS)) {
  const read = (extra) => { try { return execFileSync('git', ['-C', dir, 'log', ...extra, '--format=@%ct', '--name-only', '--since=2026-08-20', 'origin/main'], { encoding: 'utf8', maxBuffer: 256e6 }); } catch { return ''; } };
  for (const [k, log] of [['own', read([])], ['landed', read(['--first-parent', '-m'])]]) {
    for (const block of log.split('@').filter(Boolean)) { const [t, ...fs] = block.split('\n'); for (const f of fs.filter(Boolean)) (mainTimes[k][`${repo}:${f}`] ||= []).push(Number(t) * 1000); }
  }
}
const editsBy = new Map(); for (const s of pop) for (const e of s.edits) { const k = `${e.issue || s.headerIssue}|${e.key}`; (editsBy.get(k) || editsBy.set(k, []).get(k)).push(e.ts); }
const changed = (rule) => (t, key, a, b) => (editsBy.get(`${t}|${key}`) || []).some((x) => x > a && x < b) || (rule === 'both' ? [...(mainTimes.own[key] || []), ...(mainTimes.landed[key] || [])] : mainTimes[rule][key] || []).some((x) => x > a && x < b);
const block3 = {};
for (const rule of ['own', 'landed', 'both']) {
  const ch = changed(rule); let pairsN = 0; let repeat = 0; let unchanged = 0; let unchCarry = 0; let win = 0;
  for (const s of pop) {
    win += s.windowSum; const first = new Map(); const carry = new Map();
    for (const r of s.reads) { if (!counted(r) || classOf(r.key) !== 'repo file') continue; const t = ticketOf(s, r); if (!t) continue; const k = `${t}|${r.key}`; carry.set(k, (carry.get(k) || 0) + r.carry); if (!first.has(k)) first.set(k, r); }
    for (const [k, r] of first) { pairsN++; if (!isRepeat(s, r)) continue; repeat++; const [t] = k.split('|'); if (!ch(t, r.key, latestOther(s, r), r.ts)) { unchanged++; unchCarry += carry.get(k); } }
  }
  block3[rule] = { pairs: pairsN, repeatPct: pct(repeat, pairsN), unchangedOfRepeatsPct: pct(unchanged, repeat), unchangedRepeatCarryPctOfWindow: pct(unchCarry, win) };
}

// ---- (2) Re-finding in weighted units, the paper's way and three alternatives.
const totU = pop.reduce((a, s) => a + s.units, 0);
const rf = { paper: { broad: 0, strict: 0 }, noBootstrap: { broad: 0, strict: 0 }, byCalls: { broad: 0, strict: 0 }, repoFilesOnly: { broad: 0, strict: 0 } };
const strictOk = (s, r) => classOf(r.key) === 'repo file' && isRepeat(s, r) && !changed('own')(ticketOf(s, r), r.key, latestOther(s, r), r.ts);
let orientU = 0; let bootU = 0;
for (const s of pop) {
  s.beats.forEach((b, i) => {
    const t = firstProd(b, s.prodTags); if (!t) return;
    const end = b.firstOf[t]; const own = b.unitsBefore[t]; const boot = i === 0 ? s.boot.units : 0; orientU += own + boot; bootU += boot;
    const rs = s.reads.filter((r) => r.beat === i && r.ts < end && counted(r) && ticketOf(s, r));
    const tk = rs.reduce((a, r) => a + r.tok, 0); const nc = rs.reduce((a, r) => a + r.w, 0); if (!tk || !nc) return;
    const repTok = rs.filter((r) => isRepeat(s, r)).reduce((a, r) => a + r.tok, 0); const stTok = rs.filter((r) => strictOk(s, r)).reduce((a, r) => a + r.tok, 0);
    const repN = rs.filter((r) => isRepeat(s, r)).reduce((a, r) => a + r.w, 0); const stN = rs.filter((r) => strictOk(s, r)).reduce((a, r) => a + r.w, 0);
    const fileRepTok = rs.filter((r) => classOf(r.key) === 'repo file' && isRepeat(s, r)).reduce((a, r) => a + r.tok, 0);
    rf.paper.broad += (own + boot) * repTok / tk; rf.paper.strict += (own + boot) * stTok / tk;
    rf.noBootstrap.broad += own * repTok / tk; rf.noBootstrap.strict += own * stTok / tk;
    rf.byCalls.broad += (own + boot) * repN / nc; rf.byCalls.strict += (own + boot) * stN / nc;
    rf.repoFilesOnly.broad += (own + boot) * fileRepTok / tk; rf.repoFilesOnly.strict += (own + boot) * stTok / tk;
  });
}
const block2 = Object.fromEntries(Object.entries(rf).map(([k, v]) => [k, { broadPct: pct(v.broad, totU), strictPct: pct(v.strict, totU) }]));
block2.orientationPct = pct(orientU, totU); block2.bootstrapInOrientationPct = pct(bootU, totU);

// ---- (4) The bootstrap's downstream cost: its reads and its own output stay in the window for every later turn, as cache reads.
// Carried tokens × 0.1 (a cache read at the frontier tier's weight; the snapshot keeps no per-session tier, so this is an upper estimate
// where a session ran on a cheaper tier).
let bootCarryU = 0; let bootSessions = 0;
for (const s of pop) {
  if (!(s.boot.turns > 0 && s.beats.length)) continue; bootSessions++;
  bootCarryU += 0.1 * s.calls.filter((x) => x.beat === -1).reduce((a, x) => a + (x.carry || 0), 0);
}
const block4 = { sessions: bootSessions, bootstrapPct: pct(pop.reduce((a, s) => a + (s.boot.turns > 0 && s.beats.length ? s.boot.units : 0), 0), totU), downstreamCarryOfBootstrapCallsPct: pct(bootCarryU, totU) };

// ---- (5) Later beats: which re-reads a beat makes of what its own session read in an earlier beat, by class, and how much of the
// 10.9% later-beat re-orientation a file list could reach (re-orientation units × the share of that role's later-beat reads that are
// repo files already read; a ticket re-read is left out because the ticket has new comments by then).
const block5 = {};
for (const grp of ['supervisors', 'other roles']) {
  const ss = pop.filter((s) => (grp === 'supervisors') === SUPERVISORS.includes(s.role)); const byClass = {}; let n = 0; let rep = 0; let reorient = 0; let reach = 0;
  for (const s of ss) {
    const seen = new Map(); let sn = 0; let sfile = 0;
    for (const r of s.reads) { if (!counted(r)) continue; if (r.beat > 0) { const c = classOf(r.key); const g = (byClass[c] ||= { reads: 0, seen: 0 }); g.reads++; n++; sn++; const b0 = seen.get(r.key); if (b0 != null && b0 < r.beat) { g.seen++; rep++; if (c === 'repo file') sfile++; } } if (!seen.has(r.key)) seen.set(r.key, r.beat); }
    const re = s.beats.slice(1).reduce((a, b) => { const t = firstProd(b, s.prodTags); return a + (t ? b.unitsBefore[t] : 0); }, 0); reorient += re; if (sn) reach += re * sfile / sn;
  }
  block5[grp] = { laterBeatReads: n, alreadyReadPct: pct(rep, n), repeatsByClassPct: Object.fromEntries(Object.entries(byClass).map(([k, g]) => [k, pct(g.seen, rep)])), reorientationPctOfFleet: pct(reorient, totU), fileListReachPctOfFleet: pct(reach, totU) };
}

const out = { generatedAt: new Date().toISOString(), window: [new Date(since).toISOString(), new Date(until).toISOString()], sessions: pop.length, orientationRepeats: block1, refinding: block2, unchanged: block3, bootstrap: block4, laterBeats: block5 };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
