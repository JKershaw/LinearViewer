// LIN-3188: three cross-session detectors (D1 shared-error burst, D2 wait graph, D7 duplicate launch) run over the transcript snapshots.
// Usage: node scripts/survey-hides-detect-sessions.mjs [--in data/survey-hides] (run survey-hides-transcripts.mjs first)
// Rules, each deliberately simple and run over data Harbour or the runner already holds:
//   D1 shared-error burst (P1). An alarm fires when one error signature (survey-hides-transcripts.mjs's sig) is seen by 3 or more
//      distinct sessions within 60 minutes. Alarming errors less than 60 minutes apart are merged into one episode. Reported per
//      episode: start (first error), alarm time (the third session's error), end, sessions, errors, healed share, retry units.
//      Client-class signatures (a malformed request) are run too and reported apart, as the rule's false-alarm class.
//   D2 wait graph (P2, and P5 where the awaited child had stopped). A session's activity is split into bursts (assistant steps with
//      gaps of 3 minutes or less). A session is WAITING after a burst whose last 3 minutes hold a wait event, until its next burst
//      (capped at 6 hours); ACTIVE if it has a step in the 5 minutes before t. A wait's dispatch targets resolve to the session the
//      item was delivered to (full id or 8-hex prefix); its LIN targets to every session of that ticket. At checkpoints 30, 60, 90 …
//      minutes after the waiting burst ends, the rule walks the targets transitively: a chain is COVERED if any session in it is
//      active (a step in the last 5 minutes, or a tool call of its own still running), has armed its own timer (Monitor,
//      ScheduleWakeup, a background command), or is waiting on something the rule cannot see (an unresolved id, CI, a PR, or a
//      person, a ruling or a deliberate pause: PERSON below). An uncovered chain that
//      returns to a session already on it is a CYCLE; one whose leaves have all stopped is an ORPHAN, by dispatch (a named child
//      stopped) or by ticket (no session of a named ticket active or waiting). The first failing checkpoint is the alarm.
//      Idle minutes run from the chain's last step before the alarm to the end of the wait (the waiter's next burst, capped at 6 hours
//      and at the snapshot's last step). wakeLatencyMin is the waiter's next burst less the awaited chain's last step.
//   D7 duplicate launch (P7). Two fresh launches with the same issue and kind whose spans (first to last step) overlap, or the
//      second launched within 15 minutes of the first, are candidates; a HIT is a candidate pair that worked at the same time (2 or
//      more of the later session's step-minutes within 2 minutes of a step of the earlier one). The rest are 'sequential' (a leg
//      that followed a finished one, usually a send-back round: the false-alarm class of the looser rule). Kinds 'autopilot' (a Runner, leg or stepper re-launch is often a deliberate
//      replacement) and 'custom' (one kind for many different prompts) are reported apart, not counted as hits.
// Costs are weighted units as in survey-wake-extract.mjs; shares are of all units in sessions.jsonl.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { joinDuplicateAlarms, bucketCounts } from './survey-hides-d7-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--in', 'data/survey-hides');
const state = arg('--state', '/Users/work/development/simple-dispatcher/state');
const sessions = readFileSync(join(dir, 'sessions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byId = new Map(sessions.map((s) => [s.id, s]));
const fleetUnits = sessions.reduce((a, s) => a + s.units, 0);
const month = (ts) => ts.slice(0, 7);
const min = (ts) => Math.floor(Date.parse(ts) / 60000);
const iso = (m) => new Date(m * 60000).toISOString().slice(0, 16);
const count = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});

// ---------- D1 shared-error burst ----------
const errs = events.filter((e) => e.type === 'err').sort((a, b) => a.at.localeCompare(b.at));
const errMonthly = {};
for (const e of errs) {
  const k = `${month(e.at)} ${e.repo} ${e.cls}`; const r = (errMonthly[k] ??= { errors: 0, healed: 0, sessions: new Set(), retryUnits: 0 });
  r.errors++; if (e.healed) { r.healed++; r.retryUnits += e.retryUnits; } r.sessions.add(e.session);
}
for (const r of Object.values(errMonthly)) r.sessions = r.sessions.size;
const episodes = [];
for (const sig of new Set(errs.map((e) => e.sig))) {
  const xs = errs.filter((e) => e.sig === sig); let ep = null;
  xs.forEach((e, i) => {
    const t = Date.parse(e.at); const win = xs.filter((y, j) => j <= i && t - Date.parse(y.at) <= 3600e3);
    const alarm = new Set(win.map((y) => y.session)).size >= 3;
    if (alarm && ep && t - Date.parse(ep.end) <= 3600e3) { ep.end = e.at; win.forEach((y) => ep.members.add(y)); return; }
    if (alarm) { ep = { sig, cls: e.cls, start: win[0].at, alarmAt: e.at, end: e.at, members: new Set(win) }; episodes.push(ep); return; }
    if (ep && t - Date.parse(ep.end) <= 3600e3 && new Set(win.map((y) => y.session)).size >= 2) { ep.end = e.at; ep.members.add(e); }
  });
}
const d1 = episodes.map(({ members, ...ep }) => {
  const m = [...members];
  return { ...ep, hours: +((Date.parse(ep.end) - Date.parse(ep.start)) / 3600e3).toFixed(2), sessions: new Set(m.map((e) => e.session)).size, errors: m.length, healed: m.filter((e) => e.healed).length, retryUnits: m.reduce((a, e) => a + (e.retryUnits || 0), 0), repos: count(m, (e) => e.repo), paths: count(m, (e) => e.path) };
}).sort((a, b) => a.start.localeCompare(b.start));

// ---------- D2 wait graph ----------
const itemTo = new Map(); const prefixTo = new Map();
for (const s of sessions) for (const it of s.items) { itemTo.set(it, s.id); prefixTo.set(it.slice(0, 8), s.id); }
const byTicket = new Map(); for (const s of sessions) if (s.issue) (byTicket.get(s.issue) || byTicket.set(s.issue, []).get(s.issue)).push(s.id);
const waitsBy = new Map(); for (const e of events) if (e.type === 'wait') (waitsBy.get(e.session) || waitsBy.set(e.session, []).get(e.session)).push(e);
const bursts = new Map();
for (const s of sessions) {
  const st = [...s.steps].sort((a, b) => a - b); const bs = []; let cur = null;
  for (const m of st) { if (cur && m - cur.end <= 3) cur.end = m; else { cur = { start: m, end: m }; bs.push(cur); } }
  const ws = (waitsBy.get(s.id) || []).map((w) => ({ ...w, m: min(w.at) }));
  for (const b of bs) b.wait = ws.filter((w) => w.m >= b.end - 3 && w.m <= b.end).pop() || null;
  bursts.set(s.id, bs);
}
// The state of session id at minute t: 'active', { wait } or 'stopped'.
function stateAt(id, t) {
  const bs = bursts.get(id); if (!bs?.length) return 'unknown';
  let lo = 0, hi = bs.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (bs[m].start <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 0) return 'notyet';
  const b = bs[k]; if (t - b.end <= 5) return 'active';
  const s = byId.get(id); if (s.busy.some(([x, y]) => x <= t && t <= y + 5)) return 'active';
  if (s.arms.some((m) => m >= b.start && m <= b.end)) return 'armed';
  if (b.wait && t - b.end <= 360) return { wait: b.wait, burst: b, next: bs[k + 1]?.start ?? null };
  return 'stopped';
}
const PERSON = /\b(wait\w* (on|for)|until|answer\w*|holding|owes?)\b[^.]{0,60}\b(John|the human|a ruling|ruling `|witness)\b|\bpaused for\b|\bwind-down\b|\bweekly cap\b|\bafter (the )?(weekly )?reset\b/i;
const resolve = (x) => itemTo.get(x) || (x.length === 8 ? prefixTo.get(x) : null);
// Walk the chain from session id at minute t. Returns { covered, cycle, orphan, members, unseen }.
function walk(id, t) {
  const members = new Set([id]); const stack = [id]; let cycle = false; let orphanD = false; let orphanT = false;
  while (stack.length) {
    const cur = stack.pop(); const st = stateAt(cur, t);
    if (st === 'active') return { covered: true };
    if (st === 'stopped') { orphanD = true; continue; }
    if (typeof st !== 'object') return { covered: true }; // not started yet (queued) or no steps: not this rule's call
    const w = st.wait;
    if (PERSON.test(w.text)) return { covered: true }; // waits on a person, a ruling or a deliberate pause
    const tg =w.dispatchTargets.map(resolve).filter((x) => x && x !== cur);
    const unresolvedIds = w.dispatchTargets.filter((x) => x.length === 36 && !resolve(x));
    const linT = w.linTargets.filter((l) => l !== byId.get(cur)?.issue);
    if (!tg.length && !linT.length) return { covered: true }; // waits on CI, a PR, a person or an id the rule cannot see
    if (unresolvedIds.length && !tg.length) return { covered: true };
    for (const x of tg) { if (x === id) cycle = true; if (members.has(x)) continue; members.add(x); stack.push(x); }
    for (const l of linT) {
      const ss = (byTicket.get(l) || []).filter((x) => x !== cur);
      if (!ss.length) return { covered: true }; // a ticket with no transcript session: worked elsewhere (opencode, a person)
      const live = ss.filter((x) => { const s2 = stateAt(x, t); return s2 === 'active' || typeof s2 === 'object'; });
      if (!live.length) { orphanT = true; continue; }
      for (const x of live) { if (x === id) cycle = true; if (members.has(x)) continue; members.add(x); stack.push(x); }
    }
  }
  return { covered: false, cycle, orphan: cycle ? null : orphanD ? 'dispatch' : orphanT ? 'ticket' : 'dispatch', members: [...members] };
}
const windowEnd = Math.max(...sessions.flatMap((s) => (s.steps.length ? [Math.max(...s.steps)] : [])));
const alarms = [];
for (const s of sessions) {
  for (const b of bursts.get(s.id)) {
    if (!b.wait) continue;
    const next = bursts.get(s.id).find((x) => x.start > b.end);
    const end = Math.min(next ? next.start : Infinity, b.end + 360, windowEnd);
    for (let t = b.end + 30; t <= end; t += 30) {
      const r = walk(s.id, t); if (r.covered) continue;
      const lastStep = Math.max(...r.members.map((x) => { const bs = bursts.get(x) || []; const p = bs.filter((y) => y.start <= t).pop(); return p ? p.end : 0; }));
      const childStop = Math.max(0, ...r.members.filter((x) => x !== s.id).map((x) => { const p = (bursts.get(x) || []).filter((y) => y.start <= t).pop(); return p ? p.end : 0; }));
      alarms.push({ childStopAt: childStop ? iso(childStop) : null, wakeLatencyMin: next && next.start <= b.end + 360 && childStop ? next.start - childStop : null, session: s.id, issue: s.issue, repo: s.repo, kind: s.kind, waitAt: b.wait.at, alarmAt: iso(t), endAt: iso(end), woken: !!next && next.start <= b.end + 360, type: r.cycle ? 'cycle' : `orphan-${r.orphan}`, members: r.members.map((x) => `${x.slice(0, 8)}:${byId.get(x)?.issue || '?'}`), idleMin: end - lastStep, text: b.wait.text.slice(0, 220) });
      break;
    }
  }
}
// One incident per set of overlapping alarms that share a member session.
const incidents = [];
for (const a of alarms.sort((x, y) => x.alarmAt.localeCompare(y.alarmAt))) {
  const inc = incidents.find((i) => i.type === a.type && a.alarmAt <= i.endAt && a.members.some((m) => i.members.has(m)));
  if (inc) { inc.alarms.push(a); a.members.forEach((m) => inc.members.add(m)); if (a.endAt > inc.endAt) inc.endAt = a.endAt; inc.idleMin = Math.max(inc.idleMin, a.idleMin); }
  else incidents.push({ type: a.type, alarmAt: a.alarmAt, endAt: a.endAt, members: new Set(a.members), idleMin: a.idleMin, repo: a.repo, alarms: [a] });
}
const d2 = incidents.map((i) => ({ ...i, members: [...i.members], waiters: i.alarms.length, alarms: i.alarms.map((a) => ({ session: a.session.slice(0, 8), issue: a.issue, kind: a.kind, waitAt: a.waitAt.slice(0, 16), endAt: a.endAt, woken: a.woken, idleMin: a.idleMin, childStopAt: a.childStopAt, wakeLatencyMin: a.wakeLatencyMin, text: a.text })) }));

// ---------- D7 duplicate launch ----------
// LIN-3210: join each hit to the M23 `launch.duplicate` alarm (simple-dispatcher oplog) by
// `(issue|kind, second session id)` — the alarm's `session` is the newly launched one
// (dispatcher.js:1144/1162). A missing state dir (a transcript-only run) leaves every hit unalarmed.
const duplicateAlarms = [];
try {
  for (const line of readFileSync(join(state, 'oplog.jsonl'), 'utf8').split('\n')) {
    if (!line || !line.includes('launch.duplicate')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.event === 'launch.duplicate') duplicateAlarms.push(o);
  }
} catch { /* no state: no alarms to join */ }
const launches = events.filter((e) => e.type === 'launch').map((e) => ({ ...e, s: byId.get(e.session) })).filter((e) => e.s?.steps.length);
const groups = new Map(); for (const l of launches) { const k = `${l.issue}|${l.kind}`; (groups.get(k) || groups.set(k, []).get(k)).push(l); }
const pairs = [];
for (const [k, ls] of groups) {
  ls.sort((a, b) => a.at.localeCompare(b.at));
  for (let i = 1; i < ls.length; i++) {
    const a = ls[i - 1]; const b = ls[i];
    const aEnd = Math.max(...a.s.steps); const bStart = min(b.at); const gap = bStart - min(a.at);
    const overlap = Math.max(0, Math.min(aEnd, Math.max(...b.s.steps)) - bStart);
    const aSet = new Set(a.s.steps.flatMap((m) => [m - 2, m - 1, m, m + 1, m + 2]));
    const concurrent = b.s.steps.filter((m) => aSet.has(m)).length;
    // Parked-only: the first session was in a wait window when the second launched (not active, not terminal).
    const firstParked = typeof stateAt(a.session, bStart) === 'object';
    if (overlap > 0 || gap <= 15) pairs.push({ concurrentMin: concurrent, issue: a.issue, kind: a.kind, repo: b.s.repo, first: a.session.slice(0, 8), second: b.session.slice(0, 8), firstAt: a.at.slice(0, 16), secondAt: b.at.slice(0, 16), gapMin: gap, overlapMin: overlap, secondUnits: b.s.units, firstParked, set: a.kind === 'autopilot' || a.kind === 'custom' ? 'excluded-kind' : concurrent >= 2 ? 'hit' : 'sequential' });
  }
}
const bucketedPairs = joinDuplicateAlarms(pairs, duplicateAlarms);
const d7Buckets = bucketCounts(bucketedPairs);
const hits7 = bucketedPairs.filter((p) => p.set === 'hit');

// ---------- write ----------
const out = {
  window: { first: sessions.map((s) => s.first).sort()[0], last: sessions.map((s) => s.last).filter(Boolean).sort().pop(), sessions: sessions.length, byRepo: count(sessions, (s) => s.repo), fleetUnits: Math.round(fleetUnits) },
  d1: { rule: '>=3 distinct sessions, same signature, within 60 min', errorsByMonthRepoClass: errMonthly, episodes: d1, episodesByClass: count(d1, (e) => e.cls) },
  d2: { rule: 'checkpoints every 30 min after a waiting burst; uncovered chain = cycle or orphan', waits: events.filter((e) => e.type === 'wait').length, waitingBursts: [...bursts.values()].flat().filter((b) => b.wait).length, alarms: alarms.length, incidentsByType: count(d2, (i) => i.type), incidentsByMonthRepo: count(d2, (i) => `${i.alarmAt.slice(0, 7)} ${i.repo} ${i.type}`), idleMinByType: d2.reduce((m, i) => ((m[i.type] = (m[i.type] || 0) + i.idleMin), m), {}), incidents: d2 },
  d7: { rule: 'same issue and kind, spans overlap or second launch within 15 min; hits joined to launch.duplicate by (issue|kind, second session id): alarmed > alreadyEnded > parkedOnly > unalarmed', launches: launches.length, duplicateAlarms: duplicateAlarms.length, hits: hits7.length, alarmed: d7Buckets.alarmed, unalarmed: d7Buckets.unalarmed, parkedOnly: d7Buckets.parkedOnly, alreadyEnded: d7Buckets.alreadyEnded, sequentialPairs: pairs.filter((p) => p.set === 'sequential').length, excludedKindPairs: pairs.filter((p) => p.set === 'excluded-kind').length, hitsByMonthRepoKind: count(hits7, (p) => `${p.secondAt.slice(0, 7)} ${p.repo} ${p.kind}`), secondUnits: hits7.reduce((a, p) => a + p.secondUnits, 0), pairs: bucketedPairs },
};
writeFileSync(join(dir, 'detect-sessions.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ window: out.window, d1: { episodes: d1.length, byClass: out.d1.episodesByClass }, d2: { alarms: alarms.length, incidents: out.d2.incidentsByType, idle: out.d2.idleMinByType }, d7: { hits: hits7.length, buckets: d7Buckets, excluded: pairs.length - hits7.length, units: out.d7.secondUnits } }, null, 1));
