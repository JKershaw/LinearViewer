// LIN-3189: what the originals' sessions spent their turns on — tracker calls, git remote / PR / CI, waiting, code work — so the lean replay's cost gap can be split into skipped chores and lighter work.
// Usage: node scripts/survey-replay-chores.mjs [--selection data/survey-replay/selection.json] [--costmix data/survey-replay/costmix-tokens.json] [--projects ~/.claude/projects] [--out data/survey-replay/chores.json]
// Each assistant message id counts once, weighted as survey-costmix-tokens.mjs weights it, and is charged to the action its tool calls
// take. A message with several calls is split evenly between them. Classes, first match wins:
// tracker  — a call to the workspace proxy (curl …/api/proxy, $HARBOUR_LOCAL_BASE, a harbour MCP tool);
// remote   — gh, git push/fetch/pull/merge/rebase/checkout of a remote ref, git worktree;
// wait     — sleep, Monitor, ScheduleWakeup, a polling loop;
// test     — node --test, npm test/run test*, playwright;
// read     — Read, Grep, Glob, LS, cat/sed/head/rg/grep/ls/find, git log/show/diff/status/blame;
// edit     — Edit, Write, MultiEdit, NotebookEdit, git add/commit;
// text     — a message with no tool call (reasoning, the final report); other — anything else.
// Sessions are the original tickets' own (survey-costmix-tokens.mjs's session rows), so no replay transcript is read. No proxy calls.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const sel = JSON.parse(readFileSync(arg('--selection', 'data/survey-replay/selection.json'), 'utf8'));
const costmix = JSON.parse(readFileSync(arg('--costmix', 'data/survey-replay/costmix-tokens.json'), 'utf8'));
const projects = arg('--projects', join(homedir(), '.claude', 'projects'));
const out = arg('--out', 'data/survey-replay/chores.json');

const tier = (m = '') => (/opus|fable/i.test(m) ? 1 : /sonnet/i.test(m) ? 0.6 : /haiku/i.test(m) ? 0.2 : 0);
const unitsOf = (u, m) => { const w = tier(m); const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1; return w * ((u.input_tokens || 0) + 5 * (u.output_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 2 * c1 + 1.25 * c5); };
function classOf(tu) {
  const n = tu.name || ''; const cmd = String(tu.input?.command ?? '');
  if (/^mcp__harbour/.test(n) || /api\/proxy|HARBOUR_LOCAL_BASE/.test(cmd)) return 'tracker';
  if (/(^|[;&|(]\s*)gh\s|git\s+(push|fetch|pull|merge|rebase|worktree)|git\s+checkout\s+origin/.test(cmd)) return 'remote';
  if (/^(Monitor|ScheduleWakeup)$/.test(n) || /(^|[;&|]\s*)sleep\s|while\s.*;\s*do/.test(cmd)) return 'wait';
  if (/node\s+(--require\s+\S+\s+)?--test|npm\s+(run\s+)?test|playwright/.test(cmd)) return 'test';
  if (/^(Read|Grep|Glob|LS)$/.test(n) || /^\s*(cat|sed|head|tail|rg|grep|ls|find|wc)\s|git\s+(log|show|diff|status|blame)/.test(cmd)) return 'read';
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n) || /git\s+(add|commit)/.test(cmd)) return 'edit';
  return 'other';
}

const ids = new Set(sel.selected.map((s) => s.id));
const byKind = {}; const byTicket = {}; const perSession = [];
let sessions = 0;
for (const s of costmix.sessionRows.filter((r) => ids.has(r.issue))) {
  const dir = join(projects, `-Users-work-development-simple-dispatcher-workspaces-${s.ws}`);
  const files = [join(dir, `${s.ws}.jsonl`)];
  const sub = join(dir, s.ws, 'subagents');
  if (existsSync(sub)) for (const f of readdirSync(sub)) if (f.endsWith('.jsonl')) files.push(join(sub, f));
  if (!existsSync(files[0])) continue;
  sessions++;
  // Streamed messages repeat their id once per content block: take the usage from the first line (as survey-costmix-tokens.mjs
  // does) and the tool calls from every line sharing the id.
  const msgs = new Map();
  for (const f of files) for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const m = e.message; if (!m?.usage || !m.id) continue;
    const r = msgs.get(m.id) || msgs.set(m.id, { u: unitsOf(m.usage, m.model), calls: [] }).get(m.id);
    for (const c of m.content || []) if (c.type === 'tool_use') r.calls.push(c);
  }
  perSession.push({ ws: s.ws, issue: s.issue, kind: s.kind, turns: msgs.size, units: Math.round([...msgs.values()].reduce((a, m) => a + m.u, 0)) });
  for (const { u, calls } of msgs.values()) {
    const classes = calls.length ? calls.map(classOf) : ['text'];
    for (const c of classes) {
      const k = (byKind[s.kind] ||= {}); k[c] = (k[c] || 0) + u / classes.length;
      const t = (byTicket[s.issue] ||= {}); t[c] = (t[c] || 0) + u / classes.length;
    }
  }
}
const share = (o) => { const tot = Object.values(o).reduce((a, b) => a + b, 0); return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { units: Math.round(v), share: +(v / tot).toFixed(3) }])); };
const all = {}; for (const k of Object.values(byKind)) for (const [c, v] of Object.entries(k)) all[c] = (all[c] || 0) + v;
const med = (xs) => { const a = [...xs].sort((x, y) => x - y); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };
const sessionShape = Object.fromEntries([...new Set(perSession.map((p) => p.kind))].map((k) => { const ps = perSession.filter((p) => p.kind === k); return [k, { sessions: ps.length, medianTurns: med(ps.map((p) => p.turns)), medianUnitsPerTurn: Math.round(med(ps.map((p) => p.units / Math.max(1, p.turns)))) }]; }));
const res = { sessions, sessionShape, perSession, all: share(all), byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, share(v)])), byTicket: Object.fromEntries(Object.entries(byTicket).map(([k, v]) => [k, share(v)])) };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(res, null, 1));
console.log(`sessions read: ${sessions}`);
for (const [k, v] of Object.entries(sessionShape)) console.log(k.padEnd(16), JSON.stringify(v));
for (const [k, v] of Object.entries({ all: res.all, ...res.byKind })) console.log(k.padEnd(16), Object.entries(v).map(([c, x]) => `${c} ${(x.share * 100).toFixed(0)}%`).join('  '));
