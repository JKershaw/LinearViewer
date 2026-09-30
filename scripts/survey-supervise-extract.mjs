// LIN-3150: extract every model step (one API message) of September's supervisor sessions (Runner, leg, stepper, ticket autopilot, wake) from local Claude Code transcripts.
// Usage: node scripts/survey-supervise-extract.mjs [--since 2026-09-01] [--until 2026-09-30T12:00:00Z] [--projects ~/.claude/projects] [--out data/survey-supervise]
// Layers follow scripts/survey-effort-fleet.mjs (LIN-3148): Runner carries the passage prompt; leg is an autopilot a Runner dispatched onto its
// issue; stepper carries the STEPPER disposition; otherwise the ticket's own autopilot; kind `wake` is a wake. A step is one assistant API
// message (content blocks sharing message.id), with its weighted units, its tool calls, the text it wrote, what it was answering, and the
// wall-clock the step owns: the generation gap before it plus the run time of the tools it called. Gaps over two minutes are waits, not work.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const since = Date.parse(arg('--since', '2026-09-01')); const until = Date.parse(arg('--until', '2026-09-30T12:00:00Z'));
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const out = arg('--out', 'data/survey-supervise'); mkdirSync(out, { recursive: true });

// Weights as survey-effort-analyse.mjs: frontier-tier input-token equivalents; mid tier x0.6.
const tier = (m = '') => (/opus|fable/i.test(m) ? 1 : /sonnet/i.test(m) ? 0.6 : /haiku/i.test(m) ? 0.2 : 0);
const unitsOf = (u, m) => { const w = tier(m); const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1; return w * ((u.input_tokens || 0) + 5 * (u.output_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 2 * c1 + 1.25 * c5); };
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');
const toolText = (b) => { const i = b.input || {}; return clip(i.command ?? i.prompt ?? i.file_path ?? i.pattern ?? i.url ?? JSON.stringify(i), 600); };
const resultText = (b) => clip(typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x.text || '').join(' ') : '', 300);

const sessions = []; const steps = [];
for (const d of readdirSync(root)) {
  if (!d.includes('simple-dispatcher-workspaces')) continue;
  const dir = join(root, d);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = join(dir, f); if (statSync(p).mtimeMs < since) continue;
    const text = readFileSync(p, 'utf8');
    const s = { id: f.slice(0, 8), workspace: d.slice(-36, -28), issue: null, kind: null, runner: /You're \*{0,2}flying\*{0,2} a passage/.test(text), stepper: /You're running as the STEPPER/.test(text), first: null, last: null, dispatchedIssues: new Set(), subagentUnits: 0, subagentActiveMs: 0 };
    const mine = []; const byId = new Map(); let taskArrived = false; let prevTs = null; let owner = null; let lastUser = '';
    for (const line of text.split('\n')) {
      if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
      const t = Date.parse(e.timestamp); const m = e.message;
      if (!t || !m || t >= until) continue;
      s.first ??= t; s.last = t;
      const gap = prevTs ? t - prevTs : 0; prevTs = t;
      if (e.type === 'user') {
        const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        if (!s.kind) { const h = c.match(/# (LIN-\d+) · ([a-z-]+)/); if (h) { s.issue = h[1]; s.kind = h[2]; } }
        const isText = typeof m.content === 'string' || (Array.isArray(m.content) && m.content.some((b) => b.type === 'text') && !m.content.some((b) => b.type === 'tool_result'));
        const results = Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : [];
        if (!taskArrived && byId.size > 0 && (/Stop hook feedback/.test(c) || (isText && !e.isMeta))) taskArrived = true;
        if (/promptName/.test(c)) { if (!taskArrived) { const pk = c.match(/\\?["']kind\\?["']\s*:\s*\\?["']([a-z-]+)/); if (pk && (!s.kind || s.kind === 'custom')) s.kind = pk[1]; } taskArrived = true; }
        if (results.length && owner) {
          // Tool run time belongs to the step that called the tool; a long one is a blocking wait.
          if (gap <= 120e3) owner.toolMs += gap; else owner.blockMs += gap;
          for (const r of results) { if (r.is_error) owner.errors++; owner.results.push(resultText(r)); }
        } else if (isText) {
          // A human, hook or wake message: the session was parked (or starting) until it arrived.
          lastUser = clip(typeof m.content === 'string' ? m.content : m.content.map((b) => b.text || '').join(' '), 400);
          if (owner) owner.parkedAfterMs += gap;
        }
        continue;
      }
      if (e.type !== 'assistant') continue;
      let st = byId.get(m.id);
      if (!st) {
        st = { session: s.id, n: byId.size, t: new Date(t).toISOString(), model: tier(m.model) === 1 ? 'frontier' : tier(m.model) === 0.6 ? 'mid' : 'other', units: m.usage ? unitsOf(m.usage, m.model) : 0, genMs: gap <= 120e3 ? gap : 0, genWaitMs: gap > 120e3 ? gap : 0, toolMs: 0, blockMs: 0, parkedAfterMs: 0, errors: 0, preTask: !taskArrived, trigger: lastUser, tools: [], text: '', results: [] };
        byId.set(m.id, st); mine.push(st); lastUser = '';
      } else if (gap <= 120e3) st.genMs += gap;
      owner = st;
      for (const b of m.content || []) {
        if (b.type === 'text') st.text = clip(st.text + ' ' + b.text, 1200).trim();
        if (b.type === 'tool_use') {
          st.tools.push({ name: b.name, input: toolText(b) });
          if (/autopilot\/kickoff|api\/proxy\/dispatch\b/.test(b.input?.command || '')) for (const x of (b.input.command.match(/LIN-\d+/g) || [])) s.dispatchedIssues.add(x);
        }
      }
    }
    // In-session subagents: counted to the session, attributed to the step that spawned them (the Agent/Task call).
    const sub = join(dir, f.replace('.jsonl', ''), 'subagents');
    if (existsSync(sub)) for (const sf of readdirSync(sub)) {
      if (!sf.endsWith('.jsonl')) continue; const seen = new Set(); let pt = null;
      for (const line of readFileSync(join(sub, sf), 'utf8').split('\n')) {
        if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
        const t = Date.parse(e.timestamp); if (t && pt && t - pt <= 120e3) s.subagentActiveMs += t - pt; if (t) pt = t;
        if (e.type === 'assistant' && e.message?.usage && !seen.has(e.message.id)) { seen.add(e.message.id); s.subagentUnits += unitsOf(e.message.usage, e.message.model); }
      }
    }
    if (s.first && s.last >= since && s.first < until && s.kind) { s.steps = mine; sessions.push(s); }
  }
}
const legIssues = new Set(); for (const s of sessions) if (s.runner && s.kind === 'autopilot') for (const x of s.dispatchedIssues) if (x !== s.issue) legIssues.add(x);
const SUP = new Set(['Runner', 'leg', 'stepper', 'autopilot', 'wake']);
const kept = [];
for (const s of sessions) {
  s.layer = s.kind === 'autopilot' ? (s.runner ? 'Runner' : legIssues.has(s.issue) ? 'leg' : s.stepper ? 'stepper' : 'autopilot') : s.kind === 'wake' ? 'wake' : null;
  if (!SUP.has(s.layer)) continue;
  for (const st of s.steps) steps.push({ layer: s.layer, issue: s.issue, ...st });
  kept.push({ id: s.id, workspace: s.workspace, issue: s.issue, layer: s.layer, first: new Date(s.first).toISOString(), last: new Date(s.last).toISOString(), steps: s.steps.length, units: s.steps.reduce((a, x) => a + x.units, 0), subagentUnits: s.subagentUnits, subagentActiveMs: s.subagentActiveMs, dispatched: [...s.dispatchedIssues] });
}
writeFileSync(join(out, 'sessions.json'), JSON.stringify(kept, null, 1));
writeFileSync(join(out, 'steps.jsonl'), steps.map((x) => JSON.stringify(x)).join('\n') + '\n');
const by = {}; for (const s of kept) { const b = (by[s.layer] ||= { n: 0, steps: 0, units: 0, sub: 0 }); b.n++; b.steps += s.steps; b.units += s.units; b.sub += s.subagentUnits; }
console.log(`supervisor sessions ${kept.length}, steps ${steps.length} (${new Date(since).toISOString().slice(0, 10)} to ${new Date(until).toISOString()})`);
for (const [k, b] of Object.entries(by)) console.log([k, b.n, b.steps, (b.units / 1e6).toFixed(1) + 'M', 'subagents ' + (b.sub / 1e6).toFixed(1) + 'M'].join('\t'));
