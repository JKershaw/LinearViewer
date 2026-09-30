// LIN-3170: every dispatch item simple-dispatcher claimed since 20 June, with its shape (fresh session, cold resume, warm follow-up), session, follow-up parent, ticket and bootstrap prompt length, into a git-ignored snapshot.
// Usage: node scripts/survey-doubling-runner.mjs [--state ~/development/simple-dispatcher/state] [--out data/survey-doubling/runner.json]
// Reads every dispatcher*.log (a "Found dispatch item" block per sighting; an item can be sighted several times, e.g. QUEUED-BUSY then
// SIGNAL, and every sighting's lines are merged) and the oplog (the first time each item appears, from 12 July; otherwise the item is
// dated by its position within its log file). A follow-up's ticket is its own Issue line where the log has one, else its root's.
// Also counts, per session, the runner's own re-beats that are not dispatch items: stall-failsafe re-fires, and the oplog's hook
// verdicts (blocked for "not done yet", paused PENDING-EXTERNAL). No proxy calls.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--state', join(homedir(), 'development/simple-dispatcher/state'));
const out = arg('--out', 'data/survey-doubling/runner.json');
const U = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// ---- Oplog: first sighting of each item; per-session hook verdict counts.
const itemTs = new Map(); const sessHook = new Map(); let oplogFrom = null;
const bump = (s, k) => { const o = sessHook.get(s) || {}; o[k] = (o[k] || 0) + 1; sessHook.set(s, o); };
for (const line of readFileSync(join(dir, 'oplog.jsonl'), 'utf8').split('\n')) {
  if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
  oplogFrom ??= o.ts;
  if (o.item && !itemTs.has(o.item)) itemTs.set(o.item, o.ts);
  if (o.event === 'hook.enter' && o.session) bump(o.session, 'stops');
  if (o.event === 'feedback.post' && o.item && typeof o.msg === 'string') {
    if (/^PENDING-EXTERNAL/.test(o.msg)) bump(`item:${o.item}`, 'pendingExternal');
    else if (/^\[working · verifying\] Not done yet/.test(o.msg)) bump(`item:${o.item}`, 'notDoneYet');
  }
}

// ---- Run logs, oldest first.
const logs = readdirSync(dir).filter((f) => /^dispatcher(\.run-.*)?\.log$/.test(f)).map((f) => {
  const m = f.match(/(\d{8})-(\d{6})\.log$/); const end = statSync(join(dir, f)).mtime;
  const start = m ? new Date(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4)}`) : new Date(end.getTime() - 864e5);
  return { f, start, end };
}).sort((a, b) => a.start - b.start);

const items = new Map(); const refires = new Map();
const get = (id) => items.get(id) || items.set(id, { item: id, sightings: 0 }).get(id);
for (const { f, start, end } of logs) {
  const lines = readFileSync(join(dir, f), 'utf8').split('\n');
  let cur = null;
  lines.forEach((l, i) => {
    let m;
    if ((m = l.match(new RegExp(`^Found dispatch item: (${U})`)))) {
      cur = get(m[1]); cur.sightings++;
      if (!cur.at) { cur.at = itemTs.get(m[1]) || new Date(start.getTime() + (end - start) * (i / Math.max(1, lines.length))).toISOString(); cur.dated = itemTs.has(m[1]) ? 'oplog' : 'log'; cur.log = f; }
      return;
    }
    if ((m = l.match(/^\[stall-failsafe\] session ([0-9a-f]{8}) \(item ([0-9a-f]{8})\) → (\w+)/))) { const k = m[1]; const r = refires.get(k) || {}; r[m[3]] = (r[m[3]] || 0) + 1; refires.set(k, r); }
    if (!cur) return;
    if ((m = l.match(/^  Workspace: (.*)/))) cur.ws ??= m[1].trim().toLowerCase();
    else if ((m = l.match(/^  Issue: ([A-Z]+-\d+)/))) cur.issueLine ??= m[1];
    else if ((m = l.match(/^  Model \(payload\): (.*)/))) cur.model ??= m[1].trim();
    else if ((m = l.match(/^  Harness \(payload\): (.*)/))) cur.harness ??= m[1].trim();
    else if ((m = l.match(new RegExp(`^\\[follow-up\\] item [0-9a-f]{8} \\(followUpTo ([^)\\s]+)\\) → ([A-Z_-]+)`)))) { cur.followUpTo8 ??= m[1]; cur.route = m[2]; }
    else if ((m = l.match(new RegExp(`^Claimed item \\(target: (\\w+)\\), creating session: (${U})`)))) { cur.shape = 'fresh'; cur.session = m[2]; cur.target = m[1]; }
    else if ((m = l.match(new RegExp(`^Resuming session (${U}) for follow-up \\(orig dispatch: (${U})`)))) { cur.shape = 'cold'; cur.session = m[1]; cur.followUpTo = m[2]; }
    else if ((m = l.match(new RegExp(`^Signalling follow-up into held session (${U}) \\(orig dispatch: (${U})`)))) { cur.shape = 'warm'; cur.session = m[1]; cur.followUpTo = m[2]; }
    else if ((m = l.match(/^\[executors\] prepareCommand model: (\S+)(?: effort: (\S+))? promptLen: (\d+)/)) && cur.promptLen == null) { cur.promptLen = +m[3]; cur.launchModel = m[1]; cur.effort = m[2] || null; }
    else if (/^Aborting session /.test(l)) cur.shape ??= 'abort';
    else if (/^Launched session .* opencode|opencode run/.test(l)) cur.opencode = true;
  });
}

// ---- Resolve tickets: own Issue line, else the root of its follow-up chain, else the session's launch.
const byId = new Map([...items.values()].map((it) => [it.item, it]));
const by8 = new Map([...items.values()].map((it) => [it.item.slice(0, 8), it]));
const sessionLaunch = new Map();
for (const it of [...items.values()].sort((a, b) => (a.at || '').localeCompare(b.at || ''))) if (it.shape === 'fresh' && it.session && !sessionLaunch.has(it.session)) sessionLaunch.set(it.session, it);
const rootOf = (it) => { let x = it; const seen = new Set(); while (x && !seen.has(x.item)) { seen.add(x.item); const p = x.followUpTo ? byId.get(x.followUpTo) : x.followUpTo8 ? by8.get(x.followUpTo8) : null; if (!p) break; x = p; } return x; };
for (const it of items.values()) {
  if (!it.shape) it.shape = it.route === 'QUEUED-BUSY' ? 'queued' : it.route === 'REJECT' ? 'rejected' : 'other';
  const root = it.shape === 'fresh' ? it : rootOf(it) || (it.session && sessionLaunch.get(it.session)) || it;
  it.root = root.item;
  it.issue = it.issueLine || root.issueLine || (it.session && sessionLaunch.get(it.session)?.issueLine) || null;
  it.issueFrom = it.issueLine ? 'own' : it.issue ? 'root' : null;
  const s8 = it.session?.slice(0, 8); it.session8 = s8 || null;
}
const rows = [...items.values()].filter((it) => it.at).sort((a, b) => a.at.localeCompare(b.at)).map(({ sightings, followUpTo8, ...r }) => r);
const sessions = {};
for (const [k, v] of sessHook) if (!k.startsWith('item:')) (sessions[k] ||= {}).stops = v.stops;
for (const [k, v] of refires) (sessions[k] ||= {}).refires = v;
const itemHook = {}; for (const [k, v] of sessHook) if (k.startsWith('item:')) itemHook[k.slice(5)] = v;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), logs: logs.map((l) => l.f), oplogFrom, rows, sessions, itemHook }));
const by = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
console.log(`items=${rows.length} logs=${logs.length} oplogFrom=${oplogFrom}`, by('shape'), by('issueFrom'), 'withPromptLen', rows.filter((r) => r.promptLen != null).length);
