// LIN-3188: per-session rows and cross-session events (proxy errors, waits, fresh launches, vigilance) from dispatched Claude Code transcripts.
// Usage: node scripts/survey-hides-transcripts.mjs [--projects ~/.claude/projects] [--since 2026-08-29] [--out data/survey-hides]
// Population: every main transcript of a session simple-dispatcher launched (project dirs -Users-work-development-simple-dispatcher-workspaces-*),
// modified since --since. Weighted units as survey-wake-extract.mjs (frontier 1, mid 0.6, cheap 0.2; output 5x, cache read 0.1x, writes 1.25x/2x).
// Events written to events.jsonl, one per line:
//   err    a tool result of a Bash call that reached the Harbour proxy (harbour.cat, $HARBOUR_LOCAL_BASE, /api/proxy) and failed: a JSON
//          body starting {"error", a gateway page (502/503/504), an HTTP 401/403/429/5xx status printed by curl -w, or a curl network exit
//          code (6, 7, 28, 35, 52, 56). sig = code or status class; cls = auth | transient | guard (a duplicate-dispatch refusal) | client. healed = a later call to the same
//          proxy path in the same session returned no error within 15 minutes; retryUnits = weighted units of the steps between the error and that success.
//   wait   assistant text that parks the session on something else: a PENDING-EXTERNAL answer or a "[pending] Not done — Waiting on" line.
//          Targets: full dispatch ids and 8-hex tokens (with a digit and a letter) anywhere in the text, resolved later against delivered items; LIN ids within 80 characters after a wait word.
//   launch a fresh launch (the session's first delivery is a launch header, not a resume handshake): issue, kind, ts.
//   vigil  assistant text naming a cross-session pattern (VIGIL below), with 300 characters of context.
// Repo of a session: 'runner' when its Edit/Write calls touch the simple-dispatcher clone more than the LinearViewer clone, or, with no
// edits, when its Bash commands name the simple-dispatcher clone more often; otherwise 'harbour'. Per session also: busy (tool calls
// whose result took over 3 minutes, as [start, end] minutes) and arms (minutes of a Monitor, ScheduleWakeup, CronCreate or background
// Bash call), so a detector can tell a session blocked on its own long call or timer from one that stopped. No proxy calls.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const since = Date.parse(arg('--since', '2026-08-29'));
const out = arg('--out', 'data/survey-hides'); mkdirSync(out, { recursive: true });

const tier = (m = '') => (/opus|fable/i.test(m) ? 1 : /sonnet/i.test(m) ? 0.6 : /haiku/i.test(m) ? 0.2 : 0);
const unitsOf = (u, m) => { const w = tier(m); const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1; return w * ((u.input_tokens || 0) + 5 * (u.output_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 2 * c1 + 1.25 * c5); };
const U = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text || '').join('\n') : '');
const resText = (b) => (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x.text || '').join('\n') : '');

const PROXY = /harbour\.cat|HARBOUR_LOCAL_BASE|\/api\/proxy|127\.0\.0\.1:\d+\/api/;
// The proxy path a call hits, for matching a retry to its error.
const pathOf = (cmd) => (cmd.match(/\/api\/proxy\/[\w\-./{}$]*/)?.[0] || cmd.match(/\/api\/[\w\-./]*/)?.[0] || '?').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').replace(/LIN-\d+/g, ':lin').slice(0, 80);
function errOf(t, isError) {
  const head = t.trimStart().slice(0, 600); const tail = t.slice(-300);
  const j = head.match(/^\{\s*"error"\s*:\s*"([^"]{0,120})"/);
  if (j) {
    const code = head.match(/"code"\s*:\s*"([A-Z_]+)"/)?.[1]; const cat = head.match(/"category"\s*:\s*"(\w+)"/)?.[1];
    const st = head.match(/"status"\s*:\s*(\d{3})/)?.[1];
    const sig = code || (st ? `http-${st}` : j[1].replace(/\d+/g, 'n').toLowerCase().slice(0, 40));
    const cls = /AUTH|CREDENTIAL|TOKEN/.test(code || '') || cat === 'auth' || /authenticat|credential|unauthori|token (expired|revoked|invalid)/i.test(head) ? 'auth'
      : /^5|429/.test(st || '') || cat === 'transient' || /timeout|timed out|request failed|unavailable|upstream|rate.?limit|ECONN|try again|http=5\d\d/i.test(head) ? 'transient' : /DUPLICATE_DISPATCH|created moments ago/.test(head) ? 'guard' : 'client';
    return { sig, cls };
  }
  if (/\b(502 Bad Gateway|503 Service Unavailable|504 Gateway Time-?out)\b/.test(head)) return { sig: 'gateway-' + head.match(/\b(50[234])\b/)[1], cls: 'transient' };
  const w = tail.match(/(?:HTTP|http_code|status)[ _:=]*\s*(401|403|429|5\d\d)\s*$/m) || head.match(/^HTTP\/[\d.]+ (401|403|429|5\d\d)\b/m);
  if (w) return { sig: `http-${w[1]}`, cls: w[1] === '401' || w[1] === '403' ? 'auth' : 'transient' };
  if (isError) { const x = head.match(/^Exit code (6|7|28|35|52|56)\b/); if (x) return { sig: `curl-exit-${x[1]}`, cls: 'transient' }; }
  return null;
}
const WAIT = /^\s*(\*\*)?PENDING-EXTERNAL\b|\[pending\] Not done\s*[—-]\s*Waiting on/;
const WAITWORD = /wait(ing|s)? (on|for)|await(ing|s)?|blocked (on|by)|standing by for|until|depends? on|parked on/gi;
const VIGIL = [
  ['circular', /\b(circular (wait|dependency)|deadlock(ed)?|waiting on each other|wait(s|ing)? on (its|their) (own )?parent)\b/i],
  ['already-running', /\balready (been )?(dispatched|running|in flight|in progress|launched|open)\b/i],
  ['duplicate', /\bduplicate[sd]? (dispatch|session|PR|pull request|work|ticket|launch|implementation)|\b(double|twice)[- ]dispatch/i],
  ['orphan', /\borphan(ed)? (wait|session|dispatch|child|hold)|\bnobody (is )?(working|running)/i],
  ['stale-wait', /\bstale (wait|hold|lease|session)|\bstuck (in|at) (AWAITING|PENDING|a hold)|\bnever (woke|woken|delivered|arrived)/i],
  ['stalled', /\b(stalled|wedged|went silent|silent for \d+)/i],
  ['repeat-failure', /\bkeeps? (failing|returning|retrying|re-?firing)|\bevery (30|\d+) seconds?\b|\bsame error (again|repeatedly)/i],
  ['credential', /\bcredential (is )?(dead|expired|revoked|invalid)|\btoken (has )?(expired|been revoked)|LINEAR_AUTH/i],
  ['flaky', /\bflak(y|e|iness)\b|\bpass(ed|es)? (only )?on (a )?retry/i],
  ['lost-wake', /\b(lost|missed|missing|dropped) (the )?wake|\bwake (was )?(lost|never|not delivered)/i],
];

const ARM = new Set(['Monitor', 'ScheduleWakeup', 'CronCreate']);
const sessions = []; const events = [];
const repoDirLV = /\/LinearViewer(?![-\w])/; const repoDirSD = /workspaces\/[\w-]+\/simple-dispatcher(?![-\w])/;
for (const d of readdirSync(root)) {
  if (!d.startsWith('-Users-work-development-simple-dispatcher-workspaces-')) continue;
  const dir = join(root, d);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = join(dir, f); if (statSync(p).mtimeMs < since) continue;
    const s = { id: f.slice(0, 36), ws: d.match(new RegExp(U))?.[0]?.slice(0, 8) || null, issue: null, kind: null, itemKind: null, first: null, last: null, units: 0, resume: false, items: [], steps: [], busy: [], arms: [], edLV: 0, edSD: 0, cmLV: 0, cmSD: 0 };
    const seen = new Set(); const calls = new Map(); const uses = new Map(); const openErrs = []; let firstUser = true; let unitsSoFar = 0;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
      const ts = e.timestamp; if (!ts) continue;
      if (e.type === 'user') {
        const c = e.message?.content;
        if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) {
          for (const b of c) {
            if (b.type !== 'tool_result') continue;
            const u0 = uses.get(b.tool_use_id); if (u0 != null && Math.floor(Date.parse(ts) / 60000) - u0 > 3) s.busy.push([u0, Math.floor(Date.parse(ts) / 60000)]);
            const call = calls.get(b.tool_use_id); if (!call) continue;
            const t = resText(b);
            if (!s.kind && /promptName/.test(t) && s.items[0] && t.includes(s.items[0])) s.itemKind = t.match(/"kind"\s*:\s*"([a-z-]+)"/)?.[1] || null;
            const er = errOf(t, b.is_error);
            if (er) {
              const ev = { type: 'err', session: s.id, at: ts, ...er, path: call.path, head: t.trimStart().slice(0, 160).replace(/\s+/g, ' '), healed: false, retryUnits: 0, healedAt: null, u0: unitsSoFar };
              events.push(ev); openErrs.push(ev);
            } else {
              for (let i = openErrs.length - 1; i >= 0; i--) {
                const ev = openErrs[i];
                if (ev.path === call.path && Date.parse(ts) - Date.parse(ev.at) <= 15 * 60e3) { ev.healed = true; ev.healedAt = ts; ev.retryUnits = Math.round(unitsSoFar - ev.u0); openErrs.splice(i, 1); }
              }
            }
          }
          continue;
        }
        const t = textOf(c).trim(); if (!t) continue;
        s.first ??= ts;
        for (const m of t.matchAll(new RegExp(`dispatch item (${U})\\)? is ready`, 'g'))) s.items.push(m[1]);
        if (firstUser) {
          firstUser = false;
          if (/^This session is being resumed/.test(t)) s.resume = true;
        }
        if (!s.issue) { const h = t.match(/^# (LIN-\d+) · ([\w-]+)/m); if (h) { s.issue = h[1]; s.kind = h[2]; if (!s.resume) events.push({ type: 'launch', session: s.id, at: ts, issue: h[1], kind: h[2] }); } }
        continue;
      }
      if (e.type !== 'assistant') continue;
      const m = e.message; s.last = ts;
      if (m?.id && !seen.has(m.id)) {
        seen.add(m.id); s.steps.push(Math.floor(Date.parse(ts) / 60000));
        if (m.usage) { const u = unitsOf(m.usage, m.model); s.units += u; unitsSoFar += u; }
      }
      for (const b of m?.content || []) {
        if (b.type === 'text' && b.text) {
          const t = b.text;
          if (WAIT.test(t)) {
            const ids = [...new Set([...(t.match(new RegExp(U, 'g')) || []), ...(t.replace(new RegExp(U, 'g'), ' ').match(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8}\b/g) || [])])];
            const lins = new Set();
            for (const w of t.matchAll(WAITWORD)) for (const x of t.slice(w.index).matchAll(/LIN-\d+/g)) if (x.index < 80) lins.add(x[0]);
            const pr = [...new Set((t.match(/PR #\d+/g) || []))];
            events.push({ type: 'wait', session: s.id, at: ts, issue: null, dispatchTargets: ids, linTargets: [...lins], prTargets: pr, ci: /\bCI\b/.test(t), text: t.slice(0, 400).replace(/\s+/g, ' ') });
          }
          for (const [k, re] of VIGIL) {
            const x = t.match(re);
            if (x) { const i = x.index; events.push({ type: 'vigil', session: s.id, at: ts, pattern: k, ctx: t.slice(Math.max(0, i - 150), i + 150).replace(/\s+/g, ' ') }); }
          }
        }
        if (b.type !== 'tool_use') continue;
        uses.set(b.id, Math.floor(Date.parse(ts) / 60000));
        if (ARM.has(b.name) || b.input?.run_in_background) s.arms.push(Math.floor(Date.parse(ts) / 60000));
        const cmd = String(b.input?.command || ''); const fp = String(b.input?.file_path || '');
        if (b.name === 'Edit' || b.name === 'Write' || b.name === 'MultiEdit') { if (repoDirSD.test(fp)) s.edSD++; else if (repoDirLV.test(fp)) s.edLV++; }
        if (b.name === 'Bash') {
          if (repoDirSD.test(cmd) || /\bcd [^;&]*simple-dispatcher(?![-\w])/.test(cmd)) s.cmSD++; if (repoDirLV.test(cmd)) s.cmLV++;
          if (PROXY.test(cmd)) calls.set(b.id, { path: pathOf(cmd) });
        }
      }
    }
    if (!s.first) continue;
    s.kind = s.kind === 'custom' && s.itemKind ? s.itemKind : s.kind;
    s.repo = s.edSD + s.edLV ? (s.edSD > s.edLV ? 'runner' : 'harbour') : s.cmSD > s.cmLV ? 'runner' : 'harbour';
    s.units = Math.round(s.units);
    sessions.push(s);
  }
}
const byId = new Map(sessions.map((s) => [s.id, s]));
for (const e of events) { const s = byId.get(e.session); e.issue ??= s?.issue || null; e.repo = s?.repo || null; delete e.u0; }
writeFileSync(join(out, 'sessions.jsonl'), sessions.map(({ edLV, edSD, cmLV, cmSD, itemKind, ...r }) => JSON.stringify({ ...r, steps: [...new Set(r.steps)] })).join('\n') + '\n');
writeFileSync(join(out, 'events.jsonl'), events.map((x) => JSON.stringify(x)).join('\n') + '\n');
const by = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
console.log(`sessions=${sessions.length} first=${sessions.map((s) => s.first).sort()[0]} units=${Math.round(sessions.reduce((a, s) => a + s.units, 0) / 1e6)}M`, by(sessions, (s) => s.repo));
console.log(by(events, (e) => e.type), by(events.filter((e) => e.type === 'err'), (e) => e.cls));
