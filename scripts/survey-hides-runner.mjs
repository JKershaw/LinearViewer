// LIN-3188: The runner's own record of failures across sessions: failed feedback posts, stall-failsafe and watchdog fires (with the silence before each), and its in-code detectors' firing counts, by month.
// Usage: node scripts/survey-hides-runner.mjs [--state /Users/work/development/simple-dispatcher/state] [--out data/survey-hides]
// Reads simple-dispatcher's state directory read-only: oplog.jsonl (JSONL, from 12 July; `ts` on every line) and the
// dispatcher.run-*.log files (since June; no per-line time, so a run log's lines are dated by the run's start in its file
// name, and a fire is re-dated from the oplog's matching phase change where one exists). Repo: simple-dispatcher (the runner),
// except the HTTP statuses on feedback posts, which are Harbour's availability as the runner saw it. No proxy calls.
// Snapshot goes to the git-ignored data/survey-hides/runner.json.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { classifyDonePosts } from './survey-hides-d5x-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const state = arg('--state', '/Users/work/development/simple-dispatcher/state');
const out = arg('--out', 'data/survey-hides'); mkdirSync(out, { recursive: true });
const month = (ts) => ts.slice(0, 7);
const inc = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; return m; };
const min = (ms) => Math.round(ms / 6000) / 10;

// ---- The oplog ------------------------------------------------------------------------------------------------
const ops = [];
for (const line of readFileSync(join(state, 'oplog.jsonl'), 'utf8').split('\n')) {
  if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
  if (!o.ts) continue;
  // Unit tests that ran without SD_OPLOG_FILE wrote fixture lines (item 'i1', workspace 'ws-1') into the live log; drop them.
  if (o.item && !/^[0-9a-f-]{8,}$/.test(o.item)) continue;
  o.t = Date.parse(o.ts); ops.push(o);
}
ops.sort((a, b) => a.t - b.t);
const window = { from: ops[0].ts, to: ops[ops.length - 1].ts };

// item -> session (8-char), from every hook line that names both.
const itemSession = new Map();
for (const o of ops) if (o.item && o.session && !itemSession.has(o.item)) itemSession.set(o.item, o.session);
// Per-session activity times (any oplog line naming the session), for "silent since".
const activity = new Map();
for (const o of ops) {
  const s = o.session || (o.item && itemSession.get(o.item)); if (!s) continue;
  if (!activity.has(s)) activity.set(s, []); activity.get(s).push(o.t);
}
// Per-session phase history.
const phases = new Map();
for (const o of ops) if (o.event === 'state.change' && o.changed?.phase) {
  if (!phases.has(o.session)) phases.set(o.session, []);
  phases.get(o.session).push({ t: o.t, ts: o.ts, from: o.changed.phase[0], to: o.changed.phase[1], pid: o.pid });
}

// ---- 1. Failed feedback posts (P1, runner side) ---------------------------------------------------------------
// sendFeedback is fire-and-forget with no retry (feedback.js), so a failed post is lost unless a later post on the same
// item carries the same line. "Healed" = the same item later posted the same line (first 40 chars) successfully within 24 h.
const lineKind = (m = '') => (m.match(/^\[([a-z· -]+)\]/)?.[1]?.split(' ')[0]) || (m.match(/^([A-Z-]+):/)?.[1]?.toLowerCase()) || 'text';
const posts = ops.filter((o) => o.event === 'feedback.post');
const okByItem = new Map();
for (const p of posts) if (p.ok) { if (!okByItem.has(p.item)) okByItem.set(p.item, []); okByItem.get(p.item).push(p); }
const failures = posts.filter((p) => !p.ok).map((p) => {
  const later = (okByItem.get(p.item) || []).filter((q) => q.t > p.t && q.t - p.t < 864e5);
  const healed = later.some((q) => (q.msg || '').slice(0, 40) === (p.msg || '').slice(0, 40));
  const kind = lineKind(p.msg);
  const terminal = /^(done|failed|blocked|aborted|complete)$/.test(kind) || /^(DONE|FAILED|BLOCKED)/.test(p.msg || '');
  return { ts: p.ts, t: p.t, item: p.item, session: itemSession.get(p.item) || null, status: p.status ?? null, error: p.error || null, cause: p.cause || null, kind, terminal, healed, laterOk: later.length, msg: (p.msg || '').slice(0, 60) };
});
const failByMonth = {};
for (const f of failures) { const k = month(f.ts); failByMonth[k] ??= { total: 0, byStatus: {}, byKind: {}, terminal: 0, terminalLost: 0, healed: 0 }; const m = failByMonth[k]; m.total++; inc(m.byStatus, String(f.status ?? f.cause ?? f.error)); inc(m.byKind, f.kind); if (f.terminal) { m.terminal++; if (!f.healed) m.terminalLost++; } if (f.healed) m.healed++; }
// LIN-3210: align the failed-post summary with the D5x semantics. `terminalLost` already excludes a healed
// retry (a post that later succeeded is not a loss). Alongside it, count the honest post-change companions
// from the oplog: `doneLoggedAnyway` (a FALSE `done_posted` — no ok `[done]` feedback.post for the item,
// i.e. what the old unconditional marker lied about), `donePostFailed` (retries exhausted) and `unresolved`
// (a `done_post_started` with no posted/failed outcome). These are the M22 after-read's companions.
const opsByMonth = new Map();
for (const o of ops) { const k = month(o.ts); if (!opsByMonth.has(k)) opsByMonth.set(k, []); opsByMonth.get(k).push(o); }
for (const [k, monthOps] of opsByMonth) {
  const c = classifyDonePosts(monthOps, failures.filter((f) => month(f.ts) === k));
  failByMonth[k] ??= { total: 0, byStatus: {}, byKind: {}, terminal: 0, terminalLost: 0, healed: 0 };
  Object.assign(failByMonth[k], { doneLoggedAnyway: c.doneLoggedAnyway, donePostFailed: c.donePostFailed, unresolved: c.unresolved });
}
const postsByMonth = {}; for (const p of posts) inc(postsByMonth, month(p.ts));
// Episodes: failures from >=3 distinct items (sessions where known) inside 60 minutes; overlapping windows merge.
const episodes = [];
{
  const fs = failures.slice().sort((a, b) => a.t - b.t); let cur = null;
  for (let i = 0; i < fs.length; i++) {
    const win = fs.filter((g) => g.t >= fs[i].t && g.t - fs[i].t <= 36e5);
    const who = new Set(win.map((g) => g.session || g.item));
    if (who.size >= 3) {
      const end = win[win.length - 1].t;
      if (cur && fs[i].t <= cur.endT) { cur.endT = Math.max(cur.endT, end); }
      else { cur = { startT: fs[i].t, endT: end }; episodes.push(cur); }
    }
  }
  for (const e of episodes) {
    const inE = fs.filter((g) => g.t >= e.startT && g.t <= e.endT);
    Object.assign(e, { start: new Date(e.startT).toISOString(), end: new Date(e.endT).toISOString(), minutes: min(e.endT - e.startT), failures: inE.length, sessions: new Set(inE.map((g) => g.session || g.item)).size, statuses: inE.reduce((m, g) => inc(m, String(g.status ?? g.cause ?? g.error)), {}), terminalLost: inE.filter((g) => g.terminal && !g.healed).length });
  }
}

// ---- 2. Stall-failsafe and watchdog fires, from the run logs (P6) ----------------------------------------------
const runFiles = readdirSync(state).filter((f) => /^dispatcher\.run-.*\.log$/.test(f)).sort();
const runStart = (f) => {
  let m = f.match(/run-(?:manual-)?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`); // local time, as the runner names them
  m = f.match(/run-(\d{2})(\d{2})(\d{2})\.log/); return m ? Date.parse('2026-06-20T00:00:00') : NaN;
};
const silentMs = (s) => { const m = s.match(/(\d+)m(?: (\d+)s)?/); return m ? (Number(m[1]) * 60 + Number(m[2] || 0)) * 1000 : null; };
const fires = []; const tagByMonth = {};
const usedChange = new Set();
for (let fi = 0; fi < runFiles.length; fi++) {
  const f = runFiles[fi]; const t0 = runStart(f); const t1 = fi + 1 < runFiles.length ? runStart(runFiles[fi + 1]) : Date.now();
  const text = readFileSync(join(state, f), 'utf8');
  for (const line of text.split('\n')) {
    const tag = line.match(/^\[(stall-failsafe|fast-fail-watchdog|verify-backstop|hold-backstop|window-close)\]/)?.[1];
    if (!tag) continue;
    let m; const fire = { tag, run: f, runStart: new Date(t0).toISOString(), line: line.slice(0, 220) };
    if ((m = line.match(/session (\w{8})\w*(?:-[\w-]+)? \(item (\w{8})\w*\) → (RESUMING|FAILED|BLOCKED|EXECUTING|COMPLETED) — (.*)/))) {
      fire.session = m[1]; fire.item = m[2]; fire.to = m[3];
      fire.from = m[4].match(/in ([A-Z_]+)/)?.[1] || null;
      fire.silentMs = silentMs(m[4].match(/(?:silent for|after|lapsed) (?:a )?(\d+m(?: \d+s)?)/)?.[1] || m[4].match(/(\d+m(?: \d+s)?)/)?.[1] || '');
      fire.action = fire.to === 'RESUMING' ? (/re-delivering the task/.test(m[4]) ? 'redeliver' : 'refire') : fire.to === 'FAILED' ? (/re-fire cap/.test(m[4]) ? 'fail-cap' : /no-transcript/.test(m[4]) ? 'fail-no-transcript' : /kitty/.test(m[4]) ? 'fail-terminal' : 'fail-terminal-fallback') : fire.to === 'BLOCKED' ? 'repark' : 'other';
    } else if ((m = line.match(/opencode session (\w{8}).*\(item (\w{8})\w*\) → (\w+) — (.*)/))) {
      fire.session = m[1]; fire.item = m[2]; fire.to = m[3]; fire.action = m[3] === 'COMPLETED' ? 'reap-orphan' : 'refire'; fire.silentMs = silentMs(m[4]);
    } else if ((m = line.match(/session (\w{8}) fast-failed on a blocked-startup pattern \(([\w-]+)\) after (\d+m(?: \d+s)?)/))) {
      fire.session = m[1]; fire.action = 'fast-fail:' + m[2]; fire.silentMs = silentMs(m[3]); fire.to = 'FAILED';
    } else if ((m = line.match(/session (\w{8}) \(item (\w{8})\w*\) force-completed → COMPLETED — silent for (\d+m(?: \d+s)?)/))) {
      fire.session = m[1]; fire.item = m[2]; fire.to = 'COMPLETED'; fire.action = 'verify-backstop'; fire.silentMs = silentMs(m[3]);
    } else if ((m = line.match(/session (\w{8}) \(item (\w{8})\w*\) → (\w+) — its held hook/))) {
      fire.session = m[1]; fire.item = m[2]; fire.to = m[3]; fire.action = 'hold-backstop';
    } else continue; // "left untouched this pass", broker re-arm notes, window-close housekeeping: not a fire.
    // Date it from the oplog: the first unused phase change of this session into fire.to inside this run's span.
    const ph = (phases.get(fire.session) || []).find((p) => p.to === fire.to && p.t >= t0 - 36e5 && p.t <= t1 + 36e5 && !usedChange.has(p) && (!fire.from || p.from === fire.from));
    if (ph) { usedChange.add(ph); fire.ts = ph.ts; fire.t = ph.t; fire.dated = 'oplog'; } else { fire.t = t0; fire.ts = new Date(t0).toISOString(); fire.dated = 'run-start'; }
    // What happened next to the session (oplog): the next terminal phase after the fire, and whether it worked again.
    const after = (phases.get(fire.session) || []).filter((p) => p.t > fire.t);
    const nextTerm = after.find((p) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(p.to));
    fire.next = fire.to === 'RESUMING' ? (after.some((p) => p.from === 'RESUMING' && p.to === 'EXECUTING') ? 'worked-again' : 'no-work') : null;
    fire.end = nextTerm ? nextTerm.to : (fire.to === 'FAILED' || fire.to === 'COMPLETED' ? fire.to : null);
    fires.push(fire);
    inc(tagByMonth[month(fire.ts)] ??= {}, `${tag}:${fire.action}`);
  }
}
const stallByMonth = {};
for (const f of fires) {
  const k = month(f.ts); const m = (stallByMonth[k] ??= { fires: 0, sessions: new Set(), silentHours: 0, refire: 0, redeliver: 0, failed: 0, refireWorkedAgain: 0, refireThenCompleted: 0, refireThenFailed: 0, byFrom: {} });
  m.fires++; m.sessions.add(f.session); if (f.silentMs) m.silentHours += f.silentMs / 36e5;
  if (f.action === 'refire') { m.refire++; if (f.next === 'worked-again') m.refireWorkedAgain++; if (f.end === 'COMPLETED') m.refireThenCompleted++; if (f.end === 'FAILED') m.refireThenFailed++; }
  if (f.action === 'redeliver') m.redeliver++;
  if (f.to === 'FAILED') m.failed++;
  if (f.from) inc(m.byFrom, f.from);
}
for (const k in stallByMonth) { stallByMonth[k].sessions = stallByMonth[k].sessions.size; stallByMonth[k].silentHours = Math.round(stallByMonth[k].silentHours * 10) / 10; }

// ---- 6. The runner's in-code detectors, by month (oplog events plus run-log fires) ----------------------------------
const CODE_EVENTS = ['hook.staleWait', 'withdraw.suppressed', 'withdraw.ignored', 'decision.suppressed', 'decision.refused', 'hook.zeroToolChallenge', 'feedback.skip', 'halt.engage'];
const censusByMonth = {};
for (const o of ops) if (CODE_EVENTS.includes(o.event)) inc(censusByMonth[month(o.ts)] ??= {}, o.event);
for (const k in tagByMonth) Object.assign(censusByMonth[k] ??= {}, tagByMonth[k]);
const runFilesByMonth = {}; for (const f of runFiles) { const t = runStart(f); if (!Number.isNaN(t)) inc(runFilesByMonth, new Date(t).toISOString().slice(0, 7)); }
// hook.staleWait: how long the abandoned wait had been outstanding.
const staleWaits = ops.filter((o) => o.event === 'hook.staleWait').map((o) => ({ ts: o.ts, session: o.session, waitKind: o.waitKind, ageMin: min(o.ageMs || 0), type: o.type }));

const result = {
  about: 'LIN-3188 runner-side extraction. Repo: simple-dispatcher, except feedback-post HTTP statuses (Harbour availability seen from the runner).',
  window, oplogLines: ops.length, runFiles: runFiles.length, runFilesByMonth,
  feedback: { postsByMonth, failByMonth, failures: failures.map(({ t, ...r }) => r), episodes: episodes.map(({ startT, endT, ...r }) => r) },
  stalls: { byMonth: stallByMonth, fires: fires.map(({ t, ...r }) => r) },
  census: { byMonth: censusByMonth, staleWaits },
};
writeFileSync(join(out, 'runner.json'), JSON.stringify(result, null, 1));
console.log('oplog', window, 'lines', ops.length, 'run files', runFiles.length, runFilesByMonth);
console.log('posts by month', postsByMonth);
console.log('failed posts by month', JSON.stringify(failByMonth, null, 0));
console.log('episodes', JSON.stringify(result.feedback.episodes));
console.log('stalls by month', JSON.stringify(stallByMonth));
console.log('fires dated from oplog', fires.filter((f) => f.dated === 'oplog').length, 'of', fires.length);
console.log('census by month', JSON.stringify(censusByMonth));
