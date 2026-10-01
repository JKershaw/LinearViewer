// LIN-3176: every dispatched Claude Code session's turns since 29 August, step by step: each API message's input, cache-read, cache-write and output tokens and the context it carried, grouped by the delivery (wake, gate, handshake, launch) that opened it, with what each fresh session read before its first decision.
// Usage: node scripts/survey-held-extract.mjs [--projects ~/.claude/projects] [--since 2026-08-29] [--out data/survey-held]
// Deliveries are classed exactly as survey-wake-extract.mjs (LIN-3172) does, and layers follow survey-effort-fleet.mjs, so a row here
// joins a row there on (session, n). A step is one assistant API message (content blocks sharing message.id; usage counted once).
// Its *context* is input + cache read + cache write: the whole prompt the model was sent. Weighted units as survey-supervise-extract.mjs
// (frontier input 1, output 5, cache read 0.1, 1-hour cache write 2, 5-minute cache write 1.25; mid tier x0.6, cheap x0.2).
// A session's *first decision* is the first step after its task arrived that dispatches, writes outward or edits (survey-wake-extract's
// act/dispatch classes); what it read before then is tallied by source, in characters of tool result. Main transcripts only; no proxy calls.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const since = Date.parse(arg('--since', '2026-08-29'));
const out = arg('--out', 'data/survey-held'); mkdirSync(out, { recursive: true });

const tier = (m = '') => (/opus|fable/i.test(m) ? 1 : /sonnet/i.test(m) ? 0.6 : /haiku/i.test(m) ? 0.2 : 0);
const U = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// survey-wake-extract.mjs's delivery classes, verbatim.
const SOURCES = [
  ['launch', /^# LIN-\d+ · [\w-]+|^Summarise this project briefly|^# You're Autopilot/],
  ['item-ready', /is ready\. Fetch it now/],
  ['completion-gate', /^Stop hook feedback:\s*Before this task is marked complete, confirm its true state/],
  ['silence-refire', /^Stop hook feedback:\s*This session went silent while its completion was still unconfirmed/],
  ['failsafe-reconfirm', /^This session is being resumed by a failsafe to re-confirm its completion state/],
  ['resume-handshake', /^This session is being resumed to handle a follow-up/],
  ['wake-inline', /^Stop hook feedback:\s*A child session reached/],
  ['task-notification', /^<task-notification>/],
  ['continue', /^Continue from where you left off\.$/],
  ['compaction', /^This session is being continued from a previous conversation/],
  ['noise', /^\[Image: |^Base directory for this skill|^\[Your previous response had no visible output/],
];
const classify = (t, scheduled) => { if (scheduled) return 'scheduled'; for (const [k, re] of SOURCES) if (re.test(t)) return k; return 'other'; };
const DISPATCH = /api\/proxy\/dispatch\b[^|]*(-X\s*'?POST|-d\s|--data|--json)|autopilot\/kickoff|recommend-and-dispatch|\/dispatch\/[^\s"']*\/(abort|withdraw)/;
// Version 2's write pattern (survey-check-5-wake.mjs --reclass): -d, --data and --json count as a write only inside a curl call.
const WRITE = /curl[^|]*\s(-d|--data(-raw|-binary)?|--json)\s|-X\s*'?(POST|PATCH|PUT|DELETE)|--request\s+(POST|PATCH|PUT|DELETE)|X-Harbour-Intent:\s*write|gh pr (merge|create|comment|review|edit|close)|gh issue (create|comment|edit)|git push|git commit|git merge|git rebase/;
const ARM = new Set(['Monitor', 'ScheduleWakeup', 'TaskStop', 'CronCreate', 'CronDelete']);
const EDIT = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Agent', 'Task']);
const toolClass = (b) => { const cmd = String(b.input?.command || ''); if (b.name === 'Bash' && DISPATCH.test(cmd)) return 'dispatch'; if (b.name === 'Bash' && WRITE.test(cmd)) return 'act'; if (EDIT.has(b.name)) return 'act'; if (ARM.has(b.name)) return 'arm'; return 'read'; };
// Where an orienting read went: the tracker (ticket, brief, comments, relations), the dispatch record (items, feedback), the code host
// (PRs, CI), git, the repo's files, or a search. Read from the tool call itself.
function readSource(b) {
  const i = b.input || {}; const cmd = String(i.command || '');
  if (b.name === 'Read' || b.name === 'NotebookRead') return /\.md$/i.test(i.file_path || '') ? 'docs' : 'code';
  if (b.name === 'Grep' || b.name === 'Glob') return 'search';
  if (b.name !== 'Bash') return 'other';
  if (/api\/proxy\/dispatch/.test(cmd)) return 'dispatch record';
  if (/api\/proxy\/(issues|brief|relations|search|comments|stack|projects)/.test(cmd)) return 'tracker';
  if (/api\/proxy/.test(cmd)) return 'other proxy';
  if (/\bgh (pr|run|api|issue)/.test(cmd)) return 'PR and CI';
  if (/\bgit (log|show|diff|fetch|status|branch|rev-parse|blame)/.test(cmd)) return 'git';
  if (/\b(cat|sed|head|tail|less|wc)\b/.test(cmd)) return /\.md\b/.test(cmd) ? 'docs' : 'code';
  if (/\b(grep|rg|find|ls)\b/.test(cmd)) return 'search';
  return 'other';
}
const RANK = { none: 0, arm: 1, read: 2, act: 3, dispatch: 4 };
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text || '').join('\n') : '');
const resultLen = (b) => (typeof b.content === 'string' ? b.content.length : Array.isArray(b.content) ? b.content.reduce((a, x) => a + (x.text || '').length, 0) : 0);

const sessions = [];
for (const d of readdirSync(root)) {
  if (!d.startsWith('-Users-work-development-simple-dispatcher-workspaces-')) continue;
  const dir = join(root, d);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = join(dir, f); if (statSync(p).mtimeMs < since) continue;
    const raw = readFileSync(p, 'utf8');
    const s = { id: f.slice(0, 36), issue: null, kind: null, runner: /You're \*{0,2}flying\*{0,2} a passage/.test(raw), stepper: /You're running as the STEPPER/.test(raw), dispatchedIssues: [], first: null, last: null, d: [], taskAt: null, taskN: null, decisionAt: null, decisionStep: null, orientReads: {}, orientCalls: 0 };
    const seen = new Map(); const pending = new Map(); let cur = null; let scheduled = false; let stepN = 0; let ownItem = null;
    for (const line of raw.split('\n')) {
      if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
      const ts = e.timestamp; if (!ts) continue;
      if (e.type === 'system' && e.subtype === 'scheduled_task_fire') { scheduled = true; continue; }
      if (e.type === 'user') {
        const c = e.message?.content;
        if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) {
          for (const b of c) if (b.type === 'tool_result' && pending.has(b.tool_use_id)) { const src = pending.get(b.tool_use_id); pending.delete(b.tool_use_id); s.orientReads[src] = (s.orientReads[src] || 0) + resultLen(b); }
          if (cur && !cur.kind && cur.item) { const t = c.map((b) => (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x.text || '').join('') : '')).join('\n'); if (t.includes(cur.item) && /promptName/.test(t)) { const at = t.indexOf(cur.item); const win = t.slice(Math.max(0, at - 50), at + 4000); cur.kind = win.match(/kind\\?["']?\s*[:=,|]?\s*\\?["']?([a-z-]+)/)?.[1] || null; cur.itemIssue = win.match(/issueIdentifier\\?["']?\s*:\s*\\?["'](LIN-\d+)/)?.[1] || null; if (/A child session reached a (pause boundary|terminal outcome)/.test(t)) { cur.wake = /pause boundary/.test(t) ? 'pause' : 'terminal'; cur.child = t.match(/Child: ([^\n]*)/)?.[1]?.match(/LIN-\d+/)?.[0] || null; } } }
          continue;
        }
        const t = textOf(c).trim(); if (!t) continue;
        s.first ??= ts;
        if (!s.kind) { const h = t.match(/^# (LIN-\d+) · ([\w-]+)/); if (h) { s.issue = h[1]; s.kind = h[2]; } }
        const source = classify(t, scheduled); scheduled = false;
        cur = { n: s.d.length, at: ts, source, item: t.match(new RegExp(`dispatch item (${U})\\)? is ready`))?.[1] || null, outcome: 'none', st: [] };
        if (source === 'wake-inline') { cur.wake = /pause boundary/.test(t) ? 'pause' : 'terminal'; cur.child = t.match(/Child: ([^\n]*)/)?.[1]?.match(/LIN-\d+/)?.[0] || null; }
        // The task arrives with the session's first dispatch item, or with its launch header when the launch carries the task itself.
        if (!s.taskAt && ((source === 'item-ready' && !ownItem) || (source === 'launch' && !/Summarise this project briefly/.test(t)))) { s.taskAt = ts; s.taskN = cur.n; ownItem = cur.item || 'launch'; cur.own = true; }
        s.d.push(cur);
        continue;
      }
      if (e.type !== 'assistant' || !cur) continue;
      const m = e.message; s.last = ts;
      let st = m?.id ? seen.get(m.id) : null;
      if (!st) {
        const u = m?.usage || {}; const w = tier(m?.model); const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const cw = u.cache_creation_input_tokens || 0;
        st = { i: u.input_tokens || 0, r: u.cache_read_input_tokens || 0, w1: c1, w5: cw - c1, o: u.output_tokens || 0, tier: w, k: 'none', at: ts };
        st.ctx = st.i + st.r + cw; st.u = w * (st.i + 5 * st.o + 0.1 * st.r + 2 * c1 + 1.25 * (cw - c1));
        if (m?.id) seen.set(m.id, st); cur.st.push(st); stepN++;
      }
      for (const b of m?.content || []) {
        if (b.type !== 'tool_use') continue;
        const k = toolClass(b); if (RANK[k] > RANK[st.k]) st.k = k; if (RANK[k] > RANK[cur.outcome]) cur.outcome = k;
        if (k === 'dispatch') for (const x of String(b.input?.command || '').match(/LIN-\d+/g) || []) if (!s.dispatchedIssues.includes(x)) s.dispatchedIssues.push(x);
        if (s.taskAt && !s.decisionAt) {
          if (k === 'act' || k === 'dispatch') { s.decisionAt = ts; s.decisionStep = { n: cur.n, idx: cur.st.length - 1 }; }
          else if (k === 'read') { s.orientCalls++; if (b.id) pending.set(b.id, readSource(b)); }
        }
      }
    }
    const own = s.d.find((x) => x.own); if (own?.kind && (!s.kind || s.kind === 'custom')) s.kind = own.kind; if (own?.itemIssue) s.issue ??= own.itemIssue;
    if (!s.first || !s.kind) continue;
    // Compact the steps: [input, cacheRead, write1h, write5m, output, tier, ctx, units, toolClass, ms since the delivery].
    for (const x of s.d) { const t0 = Date.parse(x.at); x.st = x.st.map((st) => [st.i, st.r, st.w1, st.w5, st.o, st.tier, st.ctx, +st.u.toFixed(1), st.k, Date.parse(st.at) - t0]); }
    sessions.push(s);
  }
}
const legIssues = new Set(); for (const s of sessions) if (s.runner && s.kind === 'autopilot') for (const x of s.dispatchedIssues) if (x !== s.issue) legIssues.add(x);
for (const s of sessions) s.layer = s.kind === 'autopilot' ? (s.runner ? 'Runner' : legIssues.has(s.issue) ? 'leg' : s.stepper ? 'stepper' : 'autopilot') : s.kind === 'wake' ? 'wake' : 'worker';
writeFileSync(join(out, 'held.jsonl'), sessions.map((s) => JSON.stringify(s)).join('\n') + '\n');
const by = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
console.log(`sessions=${sessions.length} deliveries=${sessions.reduce((a, s) => a + s.d.length, 0)} steps=${sessions.reduce((a, s) => a + s.d.reduce((b, x) => b + x.st.length, 0), 0)}`, by(sessions, (s) => s.layer));
