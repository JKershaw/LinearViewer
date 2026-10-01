// LIN-3143: from local Claude Code transcripts of dispatched legs, how much of the context a leg carries is the dispatched prompt, the ticket it reads, files, or everything else.
// Usage: node scripts/steady-base-carry.mjs [--since 2026-09-24] [--until 2026-09-29T20:00Z] [--projects ~/.claude/projects] [--json]
// A block of T tokens entering before turn i of an N-turn session is carried T × (N − i) times; that is its share of the
// session's summed per-turn window (input + cache read + cache write). Bytes → tokens at 4 bytes/token.
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const since = new Date(arg('--since', '2026-09-24'));
const until = new Date(arg('--until', '2026-09-29T20:00:00Z'));
const root = arg('--projects', join(homedir(), '.claude', 'projects'));

const files = [];
for (const d of readdirSync(root)) {
  if (!d.includes('simple-dispatcher-workspaces')) continue;
  const dir = join(root, d);
  for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) { const p = join(dir, f); const t = statSync(p).mtime; if (t >= since && t < until) files.push(p); }
}

const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x.type === 'text' ? x.text : '')).join('') : '');
const sessions = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const toolInput = new Map(); const seen = new Set();
  const events = []; // {type:'turn', window} | {type:'block', cat, bytes}
  let kind = null;
  for (const e of lines) {
    if (e.isSidechain) continue;
    const m = e.message; if (!m) continue;
    if (e.type === 'assistant') {
      for (const b of m.content || []) if (b.type === 'tool_use') toolInput.set(b.id, b);
      if (m.usage && !seen.has(m.id)) {
        seen.add(m.id);
        const u = m.usage; events.push({ type: 'turn', window: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) });
      }
    } else if (e.type === 'user') {
      for (const b of Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]) {
        if (b.type !== 'tool_result') continue;
        const t = text(b.content); const bytes = Buffer.byteLength(t);
        const use = toolInput.get(b.tool_use_id); const cmd = use?.input?.command || '';
        let cat = 'other tool results';
        if (/\/api\/proxy\/dispatch\/[0-9a-f-]+\/prompt/.test(cmd) && /"promptName"/.test(t)) {
          cat = 'dispatched prompt';
          if (!kind) { const k = t.match(/"kind"\s*:\s*"([a-z-]+)"/); kind = k ? k[1] : null; }
        } else if (/\/api\/proxy\/(issues\/[A-Z]+-\d+|brief\/)/.test(cmd)) cat = 'ticket reads';
        else if (use?.name === 'Read' || /\b(cat|sed -n|head|tail)\b/.test(cmd)) cat = 'file reads';
        events.push({ type: 'block', cat, bytes });
      }
    }
  }
  const turns = events.filter((x) => x.type === 'turn');
  if (!kind || turns.length < 3) continue;
  const total = turns.reduce((s, x) => s + x.window, 0);
  const carry = {}; let after = turns.length;
  for (const ev of events) {
    if (ev.type === 'turn') { after--; continue; }
    carry[ev.cat] = (carry[ev.cat] || 0) + (ev.bytes / 4) * after;
  }
  sessions.push({ file: f.split('/').pop().slice(0, 8), kind, turns: turns.length, total, carry });
}

const cats = ['dispatched prompt', 'ticket reads', 'file reads', 'other tool results'];
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const byKind = {};
for (const s of sessions) (byKind[s.kind] ||= []).push(s);
const out = Object.entries(byKind).sort((a, b) => b[1].length - a[1].length).map(([k, ss]) => {
  const pooledTotal = ss.reduce((a, s) => a + s.total, 0);
  const row = { kind: k, sessions: ss.length, medianTurns: median(ss.map((s) => s.turns)) };
  for (const c of cats) row[c] = +(100 * ss.reduce((a, s) => a + (s.carry[c] || 0), 0) / pooledTotal).toFixed(1);
  // Pooled shares are dominated by the longest sessions; the per-session median is the typical leg.
  row.medianPromptShare = +(100 * median(ss.map((s) => (s.carry['dispatched prompt'] || 0) / s.total))).toFixed(1);
  return row;
});
const all = sessions.reduce((a, s) => a + s.total, 0);
const pooled = Object.fromEntries(cats.map((c) => [c, +(100 * sessions.reduce((a, s) => a + (s.carry[c] || 0), 0) / all).toFixed(1)]));
pooled.medianPromptShare = +(100 * median(sessions.map((s) => (s.carry['dispatched prompt'] || 0) / s.total))).toFixed(1);
if (process.argv.includes('--json')) console.log(JSON.stringify({ since: since.toISOString(), until: until.toISOString(), sessions: sessions.length, pooled, byKind: out }));
else {
  console.log(`sessions=${sessions.length} last written ${since.toISOString()} … ${until.toISOString()}; share of summed per-turn window, pooled`);
  console.log(['kind', 'n', 'medTurns', ...cats.map((c) => c.replace(/ /g, '_')), 'median_session_prompt_share'].join('\t'));
  for (const r of out) console.log([r.kind, r.sessions, r.medianTurns, ...cats.map((c) => r[c] + '%'), r.medianPromptShare + '%'].join('\t'));
  console.log(['ALL', sessions.length, '-', ...cats.map((c) => pooled[c] + '%'), pooled.medianPromptShare + '%'].join('\t'));
}
