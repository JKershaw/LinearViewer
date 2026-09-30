// LIN-3148: fleet-wide share of weighted Claude tokens and session time by supervision layer and phase, from local Claude Code transcripts of dispatched sessions (30-day retention).
// Usage: node scripts/survey-effort-fleet.mjs [--since 2026-08-31] [--until 2026-09-30T06:50:00Z] [--projects ~/.claude/projects] [--out data/survey-effort/fleet.json]
// Layer of an autopilot session: Runner if its prompt is the passage runner's ("flying a passage"); leg if a Runner session
// dispatched an autopilot onto its issue; stepper if it carries the STEPPER disposition; otherwise the ticket's own autopilot.
// Re-orientation is the turns before the task prompt arrives (the bootstrap summarise). Weights as survey-effort-analyse.mjs.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const since = Date.parse(arg('--since', '2026-08-31')); const until = Date.parse(arg('--until', '2026-09-30T06:50:00Z'));
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const out = arg('--out', 'data/survey-effort/fleet.json');

const tier = (m = '') => (/opus|fable/i.test(m) ? 1 : /sonnet/i.test(m) ? 0.6 : /haiku/i.test(m) ? 0.2 : 0);
const unitsOf = (u, m) => { const w = tier(m); const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1; return w * ((u.input_tokens || 0) + 5 * (u.output_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 2 * c1 + 1.25 * c5); };
const PHASE = { research: 'research', plan: 'plan', 'plan-review': 'plan-review', implementation: 'implementation', review: 'review', 'close-out': 'close-out', wake: 'wakes' };

const sessions = [];
for (const d of readdirSync(root)) {
  if (!d.includes('simple-dispatcher-workspaces')) continue;
  const dir = join(root, d);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = join(dir, f); if (statSync(p).mtimeMs < since) continue;
    const files = [p]; const sub = join(dir, f.replace('.jsonl', ''), 'subagents');
    if (existsSync(sub)) for (const s of readdirSync(sub)) if (s.endsWith('.jsonl')) files.push(join(sub, s));
    const s = { file: f.slice(0, 8), issue: null, kind: null, units: 0, reorient: 0, first: null, last: null, activeMs: 0, runner: false, stepper: false, dispatchedIssues: new Set() };
    const seen = new Set(); let taskArrived = false; let prevTs = null;
    for (const [fi, file] of files.entries()) {
      const text = readFileSync(file, 'utf8');
      if (fi === 0) { s.runner = /You're \*{0,2}flying\*{0,2} a passage/.test(text); s.stepper = /You're running as the STEPPER/.test(text); }
      for (const line of text.split('\n')) {
        if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
        const t = Date.parse(e.timestamp); const m = e.message;
        if (fi === 0 && t) { s.first ??= t; if (prevTs && t - prevTs <= 120e3) s.activeMs += t - prevTs; prevTs = t; s.last = t; }
        if (!m) continue;
        if (fi === 0 && e.type === 'user') {
          const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          if (!s.kind) { const h = c.match(/# (LIN-\d+) · ([a-z-]+)/); if (h) { s.issue = h[1]; s.kind = h[2]; } }
          // The task arrives either as a fetched dispatch prompt or as text the Stop hook injects after the bootstrap turn.
          const isText = typeof m.content === 'string' || (Array.isArray(m.content) && m.content.some((b) => b.type === 'text') && !m.content.some((b) => b.type === 'tool_result'));
          if (!taskArrived && seen.size > 0 && (/Stop hook feedback/.test(c) || (isText && !e.isMeta))) taskArrived = true;
          if (/promptName/.test(c)) {
            if (!taskArrived) { const pk = c.match(/\\?["']kind\\?["']\s*:\s*\\?["']([a-z-]+)/); if (pk && (!s.kind || s.kind === 'custom')) s.kind = pk[1]; }
            taskArrived = true;
          }
        }
        if (e.type === 'assistant') {
          for (const b of m.content || []) if (b.type === 'tool_use' && /autopilot\/kickoff|api\/proxy\/dispatch\b/.test(b.input?.command || '')) for (const x of (b.input.command.match(/LIN-\d+/g) || [])) s.dispatchedIssues.add(x);
          if (m.usage && !seen.has(m.id)) { seen.add(m.id); const u = unitsOf(m.usage, m.model); s.units += u; if (fi === 0 && !taskArrived) s.reorient += u; }
        }
      }
    }
    if (s.first && s.last >= since && s.first < until && s.kind) sessions.push(s);
  }
}
const legIssues = new Set(); for (const s of sessions) if (s.runner && s.kind === 'autopilot') for (const x of s.dispatchedIssues) if (x !== s.issue) legIssues.add(x);
for (const s of sessions) {
  s.layer = s.kind === 'autopilot' ? (s.runner ? 'Runner' : legIssues.has(s.issue) ? 'leg' : s.stepper ? 'stepper' : 'autopilot') : PHASE[s.kind] || 'other worker';
  delete s.dispatchedIssues;
}
const tot = sessions.reduce((a, s) => a + s.units, 0); const act = sessions.reduce((a, s) => a + s.activeMs, 0); const wall = sessions.reduce((a, s) => a + (s.last - s.first), 0);
const by = {}; for (const s of sessions) { const b = (by[s.layer] ||= { sessions: 0, units: 0, reorient: 0, activeMs: 0, wallMs: 0 }); b.sessions++; b.units += s.units; b.reorient += s.reorient; b.activeMs += s.activeMs; b.wallMs += s.last - s.first; }
const pct = (x) => +(100 * x).toFixed(1);
const rows = Object.entries(by).sort((a, b) => b[1].units - a[1].units).map(([k, b]) => ({ layer: k, sessions: b.sessions, unitShare: pct(b.units / tot), activeTimeShare: pct(b.activeMs / act), activeOfWall: pct(b.activeMs / b.wallMs), reorientOfLayer: pct(b.reorient / b.units) }));
const weekly = {}; for (const s of sessions) { const d = new Date(s.first); const w = d < new Date('2026-09-07') ? 'w1' : d < new Date('2026-09-14') ? 'w2' : d < new Date('2026-09-21') ? 'w3' : 'w4'; const x = (weekly[w] ||= {}); x[s.layer] = (x[s.layer] || 0) + s.units; }
writeFileSync(out, JSON.stringify({ since: new Date(since).toISOString(), sessions: sessions.length, runnerSessions: sessions.filter((s) => s.layer === 'Runner').length, legIssues: legIssues.size, reorientShare: pct(sessions.reduce((a, s) => a + s.reorient, 0) / tot), activeOfWall: pct(act / wall), rows, weekly }, null, 1));
console.log(`sessions=${sessions.length} (${new Date(since).toISOString().slice(0, 10)} on); runner sessions ${sessions.filter((s) => s.layer === 'Runner').length}, leg issues ${legIssues.size}; re-orientation ${pct(sessions.reduce((a, s) => a + s.reorient, 0) / tot)}% of units; active ${pct(act / wall)}% of summed session wall-clock`);
console.log(['layer', 'sessions', 'unit%', 'activeTime%', 'active/wall%', 'reorient/layer%'].join('\t'));
for (const r of rows) console.log([r.layer, r.sessions, r.unitShare, r.activeTimeShare, r.activeOfWall, r.reorientOfLayer].join('\t'));
