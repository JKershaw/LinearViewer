// LIN-3172: every turn delivered into a dispatched Claude Code session since 29 August (a wake, a gate, a re-fire, a task notification…), classed by the path that delivered it, with what the session did until the next delivery.
// Usage: node scripts/survey-wake-extract.mjs [--projects ~/.claude/projects] [--since 2026-08-29] [--out data/survey-wake]
// A *delivery* is a user-role text turn that is not a tool result: the session's launch header, a Stop-hook injection, the runner's
// resume handshake, a task notification, a scheduled wake-up. The *cycle* it opens runs to the next delivery; its steps (one API
// message each, weighted as survey-supervise-extract.mjs) and tool calls say what the session did: nothing but text (a re-arm or
// a sentinel), reads only (a fetch, then re-arm), an outward action (a proxy write, a push, a PR action, a file edit, a subagent),
// or a new dispatch (POST /dispatch, a kickoff, recommend-and-dispatch). For a dispatch item delivered by "Your task (dispatch item X)
// is ready", the fetched item's kind and, for a wake, its "Child:" and "Outcome:" lines are read from the cycle's tool results.
// Layers follow survey-effort-fleet.mjs. Main transcripts only; in-session subagent tokens are added to the session, not to a cycle.
// No proxy calls. Snapshots go to the git-ignored data/survey-wake/.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const since = Date.parse(arg('--since', '2026-08-29'));
const out = arg('--out', 'data/survey-wake'); mkdirSync(out, { recursive: true });

const tier = (m = '') => (/opus|fable/i.test(m) ? 1 : /sonnet/i.test(m) ? 0.6 : /haiku/i.test(m) ? 0.2 : 0);
const unitsOf = (u, m) => { const w = tier(m); const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1; return w * ((u.input_tokens || 0) + 5 * (u.output_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 2 * c1 + 1.25 * c5); };
const U = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// The delivering path, read from the delivered text. Order matters: the first match wins.
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
const WRITE = /\s(-d|--data(-raw|-binary)?|--json)\s|-X\s*'?(POST|PATCH|PUT|DELETE)|--request\s+(POST|PATCH|PUT|DELETE)|X-Harbour-Intent:\s*write|gh pr (merge|create|comment|review|edit|close)|gh issue (create|comment|edit)|git push|git commit|git merge|git rebase/;
const ARM = new Set(['Monitor', 'ScheduleWakeup', 'TaskStop', 'CronCreate', 'CronDelete']);
const EDIT = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Agent', 'Task']);
function toolClass(b) {
  const cmd = String(b.input?.command || '');
  if (b.name === 'Bash' && DISPATCH.test(cmd)) return 'dispatch';
  if (b.name === 'Bash' && WRITE.test(cmd)) return 'act';
  if (EDIT.has(b.name)) return 'act';
  if (ARM.has(b.name)) return 'arm';
  return 'read';
}
const RANK = { none: 0, arm: 1, read: 2, act: 3, dispatch: 4 };
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text || '').join('\n') : '');
const resultText = (c) => (Array.isArray(c) ? c.filter((b) => b.type === 'tool_result').map((b) => (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x.text || '').join('\n') : '')).join('\n') : '');

const sessions = []; const deliveries = [];
for (const d of readdirSync(root)) {
  if (!d.startsWith('-Users-work-development-simple-dispatcher-workspaces-')) continue;
  const dir = join(root, d);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = join(dir, f); if (statSync(p).mtimeMs < since) continue;
    const raw = readFileSync(p, 'utf8');
    const s = { id: f.slice(0, 36), ws: d.match(new RegExp(U))?.[0]?.slice(0, 8) || null, issue: null, kind: null, runner: /You're \*{0,2}flying\*{0,2} a passage/.test(raw), stepper: /You're running as the STEPPER/.test(raw), rootItem: null, parentItem: null, items: [], dispatchedIssues: [], first: null, last: null, units: 0 };
    const seen = new Set(); let cur = null; let scheduled = false; let n = 0;
    const open = (t, ts, meta) => {
      const source = classify(t, scheduled); scheduled = false;
      cur = { session: s.id, n: n++, at: ts, source, meta: !!meta, head: t.slice(0, 160).replace(/\s+/g, ' '), item: t.match(new RegExp(`dispatch item (${U})\\)? is ready`))?.[1] || null, steps: 0, units: 0, outcome: 'none', tools: 0, reply: '' };
      if (source === 'wake-inline') { cur.wake = /pause boundary/.test(t) ? 'pause' : 'terminal'; cur.outcomeLine = t.match(/Outcome: ([^\n]*)/)?.[1]?.slice(0, 300) || null; cur.child = t.match(/Child: ([^\n]*)/)?.[1]?.slice(0, 200) || null; }
      deliveries.push(cur);
    };
    for (const line of raw.split('\n')) {
      if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
      const ts = e.timestamp; if (!ts) continue;
      if (e.type === 'system' && e.subtype === 'scheduled_task_fire') { scheduled = true; continue; }
      if (e.type === 'user') {
        const c = e.message?.content;
        const isResult = Array.isArray(c) && c.some((b) => b.type === 'tool_result');
        if (isResult) {
          if (!cur) continue;
          const t = resultText(c);
          // The fetched dispatch item: its kind, parent and (for a wake) child and outcome lines.
          if ((cur.source === 'item-ready' || cur.source === 'launch') && cur.item && t.includes(cur.item) && /promptName/.test(t) && !cur.kind) {
            const at = t.indexOf(cur.item); const win = t.slice(Math.max(0, at - 50), at + 4000);
            cur.kind = win.match(/kind\\?["']?\s*[:=,|]?\s*\\?["']?([a-z-]+)/)?.[1] || null;
            cur.promptName = win.match(/promptName\\?["']?\s*:\s*\\?["']([^"'\\]*)/)?.[1] || null;
            cur.followUpTo = win.match(new RegExp(`followUpTo\\\\?["']?\\s*:\\s*\\\\?["'](${U})`))?.[1] || null;
            cur.sessionId = win.match(new RegExp(`sessionId\\\\?["']?\\s*:\\s*\\\\?["'](${U})`))?.[1] || null;
            cur.itemIssue = win.match(/issueIdentifier\\?["']?\s*:\s*\\?["'](LIN-\d+)/)?.[1] || null;
          }
          if (cur.source === 'item-ready' && !cur.wake && /A child session reached a (pause boundary|terminal outcome)/.test(t)) {
            cur.wake = /pause boundary/.test(t) ? 'pause' : 'terminal';
            cur.child = t.match(/Child: ([^\n]*)/)?.[1]?.slice(0, 200) || null;
            cur.outcomeLine = t.match(/Outcome: ([^\n]*)/)?.[1]?.slice(0, 300) || null;
          }
          if (cur.source === 'item-ready' && !cur.grant && /your dispatch grant was refused/.test(t)) cur.grant = true;
          continue;
        }
        const t = textOf(c).trim(); if (!t) continue;
        s.first ??= ts;
        if (!s.kind) { const h = t.match(/^# (LIN-\d+) · ([\w-]+)/); if (h) { s.issue = h[1]; s.kind = h[2]; } }
        open(t, ts, e.isMeta);
        continue;
      }
      if (e.type !== 'assistant' || !cur) continue;
      const m = e.message; s.last = ts;
      if (m?.id && !seen.has(m.id)) { seen.add(m.id); cur.steps++; if (m.usage) { const u = unitsOf(m.usage, m.model); cur.units += u; s.units += u; } }
      for (const b of m?.content || []) {
        if (b.type === 'text' && cur.reply.length < 200) cur.reply = (cur.reply + ' ' + b.text).trim().slice(0, 200);
        if (b.type !== 'tool_use') continue;
        cur.tools++; const k = toolClass(b); if (RANK[k] > RANK[cur.outcome]) cur.outcome = k;
        const cmd = String(b.input?.command || '');
        if (k === 'dispatch') for (const x of cmd.match(/LIN-\d+/g) || []) if (!s.dispatchedIssues.includes(x)) s.dispatchedIssues.push(x);
      }
    }
    // The session's own dispatch item is the first one it was handed; later ones are follow-ups into it.
    const mine = deliveries.filter((x) => x.session === s.id);
    // A bootstrap-free launch carries its own item on the launch line; a bootstrapped one is handed it at its first Stop.
    const own = mine.find((x) => (x.source === 'item-ready' || x.source === 'launch') && x.item);
    // Every follow-up into the session names the session's root dispatch as followUpTo, which also covers sessions launched inline.
    s.aliases = [...new Set(mine.filter((x) => x.source === 'item-ready' && x.followUpTo && x !== own).map((x) => x.followUpTo))];
    if (own) { own.own = true; s.rootItem = own.item; s.parentItem = own.sessionId && own.sessionId !== own.item ? own.sessionId : null; if (!s.kind || s.kind === 'custom') s.kind = own.kind || s.kind; s.issue ??= own.itemIssue; }
    if (s.first && s.kind) sessions.push(s); else for (const x of mine) x.drop = true;
  }
}
const legIssues = new Set(); for (const s of sessions) if (s.runner && s.kind === 'autopilot') for (const x of s.dispatchedIssues) if (x !== s.issue) legIssues.add(x);
for (const s of sessions) s.layer = s.kind === 'autopilot' ? (s.runner ? 'Runner' : legIssues.has(s.issue) ? 'leg' : s.stepper ? 'stepper' : 'autopilot') : s.kind === 'wake' ? 'wake' : 'worker';
const kept = deliveries.filter((x) => !x.drop);
writeFileSync(join(out, 'sessions.json'), JSON.stringify(sessions.map(({ items, ...r }) => r)));
writeFileSync(join(out, 'deliveries.jsonl'), kept.map((x) => JSON.stringify(x)).join('\n') + '\n');
const by = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
console.log(`sessions=${sessions.length} deliveries=${kept.length}`, by(sessions, (s) => s.layer));
console.log(by(kept, (x) => x.source));
console.log('item-ready kinds', by(kept.filter((x) => x.source === 'item-ready' && !x.own), (x) => (x.wake ? 'wake:' + x.wake : x.kind || '?')));
