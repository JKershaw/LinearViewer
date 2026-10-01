// LIN-3188: classes every D2 wait-graph incident by what the transcripts show happened, to count D2's hits and false alarms.
// Usage: node scripts/survey-hides-code-waits.mjs [--projects ~/.claude/projects] [--in data/survey-hides] (after survey-hides-detect-sessions.mjs)
// For each incident's first alarm, the awaited sessions' transcripts are read up to the alarm and the waiter's up to its next delivery.
// Rules, in order (first match wins):
//   cycle            D2 found a cycle.
//   usage-limit      an awaited session's last reply before the alarm is the usage-limit notice ("You've hit your … limit").
//   child-background an awaited session's last reply says a run is still going in the background: the child was working, so a
//                    false alarm.
//   prompt-wake      the waiter was woken within 10 minutes of the awaited chain's last step: the wake path worked, a false alarm.
//   child-stalled    an awaited session's last act before the alarm is a tool call with no result, or no awaited session's last
//                    reply reports an outcome (CLOSING below; a bare "ready" after a resume handshake counts as none): it died,
//                    hung mid-turn, or was resumed and never handed its follow-up.
//   late-wake / lost-wake  the awaited child had stopped (a DONE, BLOCKED or PENDING reply) and the waiter was not woken for over
//                    10 minutes: late if a wake (an item-ready delivery) came within the 6-hour window, lost if the failsafe or a
//                    follow-up resume reached it instead, or nothing did.
// replacedBy lists sessions on the waiter's ticket launched within 6 hours of the child's stop (a parent or person working round it).
// Output data/survey-hides/d2-codes.json. No proxy calls.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const dir = arg('--in', 'data/survey-hides');
const det = JSON.parse(readFileSync(join(dir, 'detect-sessions.json'), 'utf8'));
const sessions = readFileSync(join(dir, 'sessions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byShort = new Map(sessions.map((s) => [s.id.slice(0, 8), s]));
const dirs = readdirSync(root).filter((d) => d.startsWith('-Users-work-development-simple-dispatcher-workspaces-'));
function entries(id) {
  for (const d of dirs) { const p = join(root, d, `${id}.jsonl`); if (existsSync(p)) return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  return [];
}
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text || '').join('\n') : '');
// The last reply, last user text and whether a tool call was still open, as of the cut-off.
function lastState(id, cut) {
  let reply = ''; let user = ''; const open = new Set();
  for (const e of entries(id)) {
    if (!e.timestamp) continue; if (e.timestamp.slice(0, 16) > cut) break;
    const c = e.message?.content;
    if (e.type === 'assistant') for (const b of c || []) { if (b.type === 'text') reply = b.text; if (b.type === 'tool_use') open.add(b.id); }
    if (e.type === 'user') { if (Array.isArray(c)) for (const b of c) if (b.type === 'tool_result') open.delete(b.tool_use_id); const t = textOf(c).trim(); if (t) user = t; }
  }
  return { reply: reply.slice(0, 300), user: user.slice(0, 200), openCall: open.size > 0 };
}
function nextDelivery(id, after) {
  for (const e of entries(id)) {
    if (e.type !== 'user' || !e.timestamp || e.timestamp.slice(0, 16) <= after) continue;
    const t = textOf(e.message?.content).trim(); if (t) return { at: e.timestamp.slice(0, 16), head: t.slice(0, 120) };
  }
  return null;
}
// A reply that reports an outcome; a child whose last reply is none of these stopped mid-task (or only acknowledged a resume).
const CLOSING = /^\W*(DONE|BLOCKED|PENDING|FAILED)\b|\b(complete|completed|done|merged|posted|verdict|landed|confirmed|verified|no change)\b/i;
const codes = [];
for (const inc of det.d2.incidents) {
  const a = inc.alarms[0]; const waiter = byShort.get(a.session);
  const kids = inc.members.map((m) => m.slice(0, 8)).filter((k) => k !== a.session).map((k) => ({ k, ...lastState(byShort.get(k)?.id, inc.alarmAt) }));
  const nd = nextDelivery(waiter.id, a.childStopAt || a.waitAt);
  let code;
  if (inc.type === 'cycle') code = 'cycle';
  else if (kids.some((x) => /hit your (session|weekly|usage) limit/i.test(x.reply))) code = 'usage-limit';
  else if (kids.some((x) => /in the background|still running|genuinely in flight/i.test(x.reply))) code = 'child-background';
  else if (a.wakeLatencyMin != null && a.wakeLatencyMin <= 10) code = 'prompt-wake';
  else if (kids.some((x) => x.openCall) || kids.every((x) => x.reply.trim() === 'ready' || !CLOSING.test(x.reply))) code = 'child-stalled';
  else if (nd && /is ready\. Fetch it now|A child session reached/.test(nd.head) && a.woken) code = 'late-wake';
  else code = 'lost-wake';
  const t0 = Date.parse((a.childStopAt || a.waitAt) + ':00Z');
  const replacedBy = sessions.filter((x) => x.issue && x.issue === waiter.issue && x.id !== waiter.id && Date.parse(x.first) > t0 && Date.parse(x.first) - t0 <= 6 * 3600e3).map((x) => `${x.id.slice(0, 8)}:${x.kind}`);
  codes.push({ replacedBy, alarmAt: inc.alarmAt, type: inc.type, repo: inc.repo, waiter: `${a.session}:${a.issue}`, idleMin: inc.idleMin, wakeLatencyMin: a.wakeLatencyMin, code, rescuedBy: nd ? (/failsafe|went silent/.test(nd.head) ? 'failsafe' : /resumed to handle a follow-up/.test(nd.head) ? 'follow-up resume' : /is ready/.test(nd.head) ? 'wake' : 'other') : 'none', kids: kids.map((x) => ({ k: x.k, reply: x.reply.slice(0, 120), openCall: x.openCall })) });
}
const sum = {};
for (const c of codes) { const r = (sum[c.code] ??= { n: 0, idleMin: 0, harbour: 0, runner: 0, rescuedBy: {} }); r.n++; r.idleMin += c.idleMin; r[c.repo]++; r.rescuedBy[c.rescuedBy] = (r.rescuedBy[c.rescuedBy] || 0) + 1; }
writeFileSync(join(dir, 'd2-codes.json'), JSON.stringify({ rule: 'see header of scripts/survey-hides-code-waits.mjs', summary: sum, codes }, null, 1));
console.log(JSON.stringify(sum, null, 1));
