// LIN-3180: weighted Claude tokens per ticket from every local transcript (31 Aug on), charged two ways — to the ticket of the session entered, and to the ticket the dispatch item being worked names (the child the log names) — plus the machine's non-fleet usage.
// Usage: node scripts/survey-costmix-tokens.mjs [--since 2026-09-01] [--until 2026-10-01] [--projects ~/.claude/projects] [--state ~/development/simple-dispatcher/state] [--out data/survey-costmix/tokens.json]
// Weights as survey-effort-fleet.mjs (frontier-input-token equivalents at list-price ratios: input 1, output 5, cache read 0.1,
// 1h cache write 2, 5m cache write 1.25; mid tier × 0.6, small tier × 0.2; non-Claude models 0). Each assistant message id is
// counted once and dated by its own timestamp, so a session that straddles the window is cut at its edges. Subagent transcripts
// count toward their parent session. "Session entered" charges a message to the session's header ticket ("# LIN-n · kind");
// "child named" charges it to the issueIdentifier of the last dispatch item the session fetched before the message (the header
// ticket until the first fetch; a session with no header takes its first fetched item's), so a parent's wake that delivers a child's item is charged to the child. No proxy calls.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const since = Date.parse(arg('--since', '2026-09-01') + (arg('--since', '').includes('T') ? '' : 'T00:00:00Z'));
const until = Date.parse(arg('--until', '2026-10-01') + (arg('--until', '').includes('T') ? '' : 'T00:00:00Z'));
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const out = arg('--out', 'data/survey-costmix/tokens.json');
const state = arg('--state', join(homedir(), 'development', 'simple-dispatcher', 'state'));

// Last resort for a session with neither a header nor a fetched item: the run log line that created it (survey-proportional-tokens.mjs's rule).
const logIssue = new Map();
for (const f of readdirSync(state).filter((x) => /^dispatcher(\.run-\d{8}-\d{6})?\.log$/.test(x)).sort()) {
  let issue = null;
  for (const line of readFileSync(join(state, f), 'utf8').split('\n')) {
    let m;
    if (/^Found dispatch item: /.test(line)) { issue = null; continue; }
    if ((m = line.match(/^\s+Issue: (LIN-\d+)/))) { issue = m[1]; continue; }
    if ((m = line.match(/^Claimed item .*creating session: ([0-9a-f-]{36})/)) && issue) logIssue.set(m[1], issue);
  }
}

const tier = (m = '') => (/opus|fable/i.test(m) ? 1 : /sonnet/i.test(m) ? 0.6 : /haiku/i.test(m) ? 0.2 : 0);
const unitsOf = (u, m) => { const w = tier(m); const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1; return w * ((u.input_tokens || 0) + 5 * (u.output_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 2 * c1 + 1.25 * c5); };
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x.text === 'string' ? x.text : typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.map((y) => y.text || '').join('\n') : '')).join('\n') : '');
const ITEM_RE = /"promptName"\s*:\s*(?:null|"[^"]*")\s*,\s*"kind"\s*:\s*(null|"[^"]*")\s*,\s*"issueIdentifier"\s*:\s*(null|"[A-Z]+-\d+")/g;

const sessions = []; let otherUnits = 0; let otherSessions = 0; let fleetUnmapped = 0; const unmapped = {};
for (const d of readdirSync(root)) {
  const fleet = d.includes('simple-dispatcher-workspaces');
  const dir = join(root, d); let files; try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
  for (const f of files) {
    const p = join(dir, f); if (statSync(p).mtimeMs < since) continue;
    const s = { ws: d.slice(-36), file: f.slice(0, 8), issue: null, kind: null, runner: false, stepper: false, units: 0, byChild: {}, byKind: {}, first: null, last: null };
    const timeline = []; // [t, child ticket, item kind] from the main transcript
    const seen = new Set();
    const main = readFileSync(p, 'utf8');
    s.runner = /You're \*{0,2}flying\*{0,2} a passage/.test(main); s.stepper = /You're running as the STEPPER/.test(main);
    const add = (t, units, child, kind) => {
      if (!(t >= since && t < until) || !units) return;
      s.units += units; s.byChild[child || s.issue || '?'] = (s.byChild[child || s.issue || '?'] || 0) + units;
      s.byKind[kind || s.kind || '?'] = (s.byKind[kind || s.kind || '?'] || 0) + units;
      s.first = Math.min(s.first ?? t, t); s.last = Math.max(s.last ?? t, t);
    };
    let child = null; let childKind = null;
    for (const line of main.split('\n')) {
      if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
      const m = e.message; if (!m) continue; const t = Date.parse(e.timestamp);
      if (e.type === 'user') {
        const c = textOf(m.content); if (!c) continue;
        if (!s.issue) { const h = c.match(/# (LIN-\d+) · ([\w-]+)/); if (h) { s.issue = h[1]; s.kind = h[2]; child = h[1]; childKind = h[2]; timeline.push([t, child, childKind]); } }
        if (c.includes('"promptName"')) for (const x of c.matchAll(ITEM_RE)) {
          const k = JSON.parse(x[1]); const iss = JSON.parse(x[2]);
          if (iss) { child = iss; childKind = k; timeline.push([t, iss, k]); }
          if (!s.issue && iss) { s.issue = iss; s.kind = k; } // a launch with no "# LIN-n · kind" header: the first item it fetched
          s.promptName ??= x[0].match(/"promptName"\s*:\s*"([^"]*)"/)?.[1] || null;
          if (s.kind === 'custom' && k && timeline.length <= 2) s.kind = k;
        }
      } else if (e.type === 'assistant' && m.usage && !seen.has(m.id)) { seen.add(m.id); add(t, unitsOf(m.usage, m.model), child, childKind); }
    }
    const sub = join(dir, f.replace('.jsonl', ''), 'subagents');
    if (existsSync(sub)) for (const sf of readdirSync(sub)) {
      if (!sf.endsWith('.jsonl')) continue;
      for (const line of readFileSync(join(sub, sf), 'utf8').split('\n')) {
        if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type !== 'assistant' || !e.message?.usage || seen.has(e.message.id)) continue; seen.add(e.message.id);
        const t = Date.parse(e.timestamp); let at = [null, s.issue, s.kind]; for (const x of timeline) { if (x[0] <= t) at = x; else break; }
        add(t, unitsOf(e.message.usage, e.message.model), at[1], at[2]);
      }
    }
    if (!s.units) continue;
    if (!fleet) { otherUnits += s.units; otherSessions++; continue; }
    if (!s.issue && logIssue.has(f.replace('.jsonl', ''))) { s.issue = logIssue.get(f.replace('.jsonl', '')); s.kind = 'unknown'; for (const k of Object.keys(s.byChild)) if (k === '?') { s.byChild[s.issue] = s.byChild['?']; delete s.byChild['?']; } }
    if (!s.issue) { fleetUnmapped += s.units; const k = s.promptName || 'no item fetched'; unmapped[k] = (unmapped[k] || 0) + s.units; continue; }
    sessions.push(s);
  }
}

const bySession = {}; const byChild = {}; const kindByTicket = {};
for (const s of sessions) {
  bySession[s.issue] = (bySession[s.issue] || 0) + s.units;
  for (const [k, v] of Object.entries(s.byChild)) byChild[k] = (byChild[k] || 0) + v;
  const layer = s.kind === 'autopilot' ? (s.runner ? 'Runner' : s.stepper ? 'stepper' : 'autopilot') : s.kind;
  const kt = (kindByTicket[s.issue] ||= {}); kt[layer] = (kt[layer] || 0) + s.units;
}
const fleetUnits = sessions.reduce((a, s) => a + s.units, 0);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ since: new Date(since).toISOString(), until: new Date(until).toISOString(), generatedAt: new Date().toISOString(), fleetUnits, fleetUnmapped, unmapped, otherUnits, otherSessions, sessions: sessions.length, bySession, byChild, kindByTicket, sessionRows: sessions.map(({ byChild: _, ...r }) => r) }));
const M = (x) => (x / 1e6).toFixed(1) + 'M';
console.log(`fleet sessions=${sessions.length} units=${M(fleetUnits)} (+${M(fleetUnmapped)} in fleet sessions with no ticket header); other projects on this machine: ${otherSessions} sessions, ${M(otherUnits)} (${(100 * otherUnits / (otherUnits + fleetUnits + fleetUnmapped)).toFixed(1)}% of all)`);
console.log(`tickets charged: by session entered ${Object.keys(bySession).length}, by child named ${Object.keys(byChild).length}`);
