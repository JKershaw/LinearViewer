// LIN-3148: per-ticket dispatches, fresh sessions and working vs waiting hours from simple-dispatcher's own run logs (June on) and oplog (12 Jul on).
// Usage: node scripts/survey-effort-runner.mjs [--state ~/development/simple-dispatcher/state] [--out data/survey-effort/runner.json]
// Run logs map each claimed dispatch item to its issue and say whether it launched a fresh session, resumed one cold, or was
// signalled into a held one warm. The oplog times each session's phases: SUMMARIZING/RESUMING/EXECUTING are working;
// BLOCKED is waiting on a human; AWAITING_FOLLOWUP/AWAITING_EXTERNAL are waiting on another session. No proxy calls.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const state = arg('--state', join(homedir(), 'development', 'simple-dispatcher', 'state'));
const out = arg('--out', 'data/survey-effort/runner.json');

const itemIssue = new Map(); const sessionIssue = new Map(); const issues = new Map();
const rec = (id) => { if (!issues.has(id)) issues.set(id, { items: new Set(), fresh: 0, cold: 0, warm: 0, sessions: new Set() }); return issues.get(id); };
const logs = readdirSync(state).filter((f) => /^dispatcher\.run-\d{8}-\d{6}\.log$/.test(f)).sort();
for (const f of logs) {
  let item = null;
  for (const line of readFileSync(join(state, f), 'utf8').split('\n')) {
    let m;
    if ((m = line.match(/^Found dispatch item: ([0-9a-f-]{36})/))) { item = m[1]; continue; }
    if ((m = line.match(/^\s+Issue: (LIN-\d+)/)) && item) { itemIssue.set(item, m[1]); continue; }
    if ((m = line.match(/^Claimed item .*creating session: ([0-9a-f-]{36})/)) && item) {
      const iss = itemIssue.get(item); if (!iss) continue;
      const r = rec(iss); if (!r.items.has(item)) { r.items.add(item); r.fresh++; r.sessions.add(m[1].slice(0, 8)); }
      sessionIssue.set(m[1].slice(0, 8), iss); continue;
    }
    if ((m = line.match(/^(Signalling follow-up into held session|Resuming session) ([0-9a-f-]{36}).*orig dispatch: ([0-9a-f-]{36})/)) && item) {
      const iss = itemIssue.get(item) || itemIssue.get(m[3]) || sessionIssue.get(m[2].slice(0, 8)); if (!iss) continue;
      itemIssue.set(item, iss);
      const r = rec(iss); if (!r.items.has(item)) { r.items.add(item); if (m[1].startsWith('Resuming')) r.cold++; else r.warm++; }
    }
  }
}

// Phase clock per session from the oplog.
const WORK = new Set(['SUMMARIZING', 'RESUMING', 'EXECUTING']); const HUMAN = new Set(['BLOCKED']); const PEER = new Set(['AWAITING_FOLLOWUP', 'AWAITING_EXTERNAL']);
const sess = new Map();
let firstTs = null;
for (const line of readFileSync(join(state, 'oplog.jsonl'), 'utf8').split('\n')) {
  if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
  const t = Date.parse(o.ts); firstTs ??= o.ts;
  let phase = null;
  if (o.event === 'state.session_added') phase = o.fields?.phase;
  else if (o.event === 'state.change' && o.changed?.phase) phase = o.changed.phase[1];
  else if (o.event === 'state.session_removed') phase = 'REMOVED';
  if (!phase || !o.session) continue;
  const s = sess.get(o.session) || { start: t, last: null, phase: null, work: 0, human: 0, peer: 0, end: t };
  if (s.phase) { const d = t - s.last; if (WORK.has(s.phase)) s.work += d; else if (HUMAN.has(s.phase)) s.human += d; else if (PEER.has(s.phase)) s.peer += d; }
  s.phase = phase; s.last = t; if (!['COMPLETED', 'FAILED', 'CANCELLED', 'REMOVED'].includes(phase)) s.end = t; else s.end = Math.max(s.end, t);
  sess.set(o.session, s);
}

const rows = [...issues.entries()].map(([id, r]) => {
  const ss = [...r.sessions].map((k) => sess.get(k)).filter(Boolean);
  const h = (ms) => +(ms / 36e5).toFixed(3);
  return {
    id, dispatches: r.items.size, freshSessions: r.fresh, coldResumes: r.cold, warmFollowUps: r.warm,
    timedSessions: ss.length, untimedSessions: r.sessions.size - ss.length,
    workH: h(ss.reduce((a, s) => a + s.work, 0)), humanWaitH: h(ss.reduce((a, s) => a + s.human, 0)), peerWaitH: h(ss.reduce((a, s) => a + s.peer, 0)),
    spanH: ss.length ? h(Math.max(...ss.map((s) => s.end)) - Math.min(...ss.map((s) => s.start))) : null,
  };
});
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ logs: logs.length, firstLog: logs[0], oplogFrom: firstTs, rows }, null, 1));
console.log(`run logs ${logs.length} (${logs[0]} …), oplog from ${firstTs}; issues with runner dispatches: ${rows.length}`);
