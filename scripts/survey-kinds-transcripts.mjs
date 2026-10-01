// LIN-3207: every dispatch a local Claude transcript enqueued (route, kind, prompt name, override flag, caller's role), every recommend preview it read, and every item it fetched (kind, prompt size, opening), into a git-ignored snapshot.
// Usage: node scripts/survey-kinds-transcripts.mjs [--root ~/.claude/projects] [--out data/survey-kinds/transcripts.json]
// An enqueue is a Bash tool call that POSTs to /api/proxy/recommend-and-dispatch, /api/proxy/dispatch or /api/proxy/autopilot/kickoff;
// (each fetched item keeps its prompt text, for survey-kinds-fidelity.mjs); its route is read from the endpoint and the JSON the call returned ("override": true marks a verb override on
// recommend-and-dispatch; a POST /dispatch carries a prompt its caller wrote). A recommend preview is a GET of
// /issues/<id>/recommend. A fetch is the item JSON a session read from /dispatch/<id>/prompt (as survey-doubling-transcripts.mjs).
// Transcripts are kept for about 30 days, so this sees September only. Main transcripts only. No proxy calls.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('--root', join(homedir(), '.claude/projects'));
const out = arg('--out', 'data/survey-kinds/transcripts.json');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ITEM_RE = new RegExp(`"id"\\s*:\\s*"(${UUID})"\\s*,\\s*"promptName"\\s*:\\s*(null|"(?:[^"\\\\]|\\\\.)*")\\s*,\\s*"kind"\\s*:\\s*(null|"[^"]*")`, 'g');
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x.text === 'string' ? x.text : typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.map((y) => y.text || '').join('\n') : '')).join('\n') : '');
// Results are printed as JSON, as a Python dict, or as "key = value" lines; read a field in any of the three.
const str = (t, k) => {
  const m = t.match(new RegExp(`["']${k}["']\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|'[^']*'|true|false|True|False|null|None)`)) || t.match(new RegExp(`^\\s*${k}\\s*=\\s*('[^']*'|"[^"]*"|True|False|None)`, 'm'));
  if (!m) return undefined; const v = m[1];
  if (/^(true|True)$/.test(v)) return true; if (/^(false|False)$/.test(v)) return false; if (/^(null|None)$/.test(v)) return null;
  if (v.startsWith("'")) return v.slice(1, -1); try { return JSON.parse(v); } catch { return undefined; }
};
const ID_RE = new RegExp(`(?:["']id["']\\s*:|^\\s*id\\s*=)\\s*["'](${UUID})["']`, 'gm');
const endpointOf = (cmd) => {
  if (!/curl|fetch\(|requests\.|urllib/.test(cmd)) return null;
  if (/api\/proxy\/recommend-and-dispatch/.test(cmd)) return 'recommend-and-dispatch';
  if (/api\/proxy\/autopilot\/kickoff/.test(cmd) && /-X\s*'?POST|--data|-d\s/.test(cmd)) return 'kickoff';
  if (/api\/proxy\/dispatch(?![\w/-]*\/(prompt|halt))\b/.test(cmd) && /-X\s*'?POST|--request\s+POST/.test(cmd)) return 'dispatch';
  return null;
};
const RECO_RE = /api\/proxy\/issues\/([A-Z]+-\d+)\/recommend\b/;

const items = {}; const enqueues = []; const previews = []; const sessions = [];
const dirs = readdirSync(root).filter((d) => d.startsWith('-Users-work-development-simple-dispatcher-workspaces-'));
for (const d of dirs) {
  let files; try { files = readdirSync(join(root, d)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
  for (const f of files) {
    const p = join(root, d, f); let raw; try { raw = readFileSync(p, 'utf8'); } catch { continue; }
    const ws = d.match(new RegExp(`(${UUID})`))?.[1] || null;
    const s = { ws, file: f.replace('.jsonl', ''), mtime: statSync(p).mtime.toISOString(), header: null, headerIssue: null, first: null,
      runner: /You're \*{0,2}flying\*{0,2} a passage/.test(raw), stepper: /You're running as the STEPPER/.test(raw),
      autopilot: /You are the \*{0,2}Autopilot\*{0,2}|Autopilot orchestrator/.test(raw), fetched: [] };
    const pending = new Map();
    for (const line of raw.split('\n')) {
      if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'assistant') {
        for (const b of o.message?.content || []) {
          if (b.type !== 'tool_use') continue;
          const cmd = String(b.input?.command || ''); if (!cmd) continue;
          const ep = endpointOf(cmd);
          if (ep) pending.set(b.id, { kind: 'enqueue', ep, at: o.timestamp, bodyKind: cmd.match(/"kind"\s*:\s*"([\w-]+)"/)?.[1] || null, bodyFollowUp: /followUpTo/.test(cmd), issues: [...new Set(cmd.match(/LIN-\d+/g) || [])] });
          else if (RECO_RE.test(cmd) && !/-X\s*'?POST/.test(cmd)) pending.set(b.id, { kind: 'preview', issue: cmd.match(RECO_RE)[1], at: o.timestamp, noDescend: /noDescend=(1|true)/.test(cmd) });
        }
        continue;
      }
      if (o.type !== 'user') continue;
      const content = o.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type !== 'tool_result' || !pending.has(b.tool_use_id)) continue;
          const call = pending.get(b.tool_use_id); pending.delete(b.tool_use_id);
          const t = textOf(b.content || '');
          if (call.kind === 'enqueue') {
            const hits = [...t.matchAll(ID_RE)];
            const error = hits.length ? null : (/["']error["']\s*:/.test(t) ? (str(t, 'code') || str(t, 'error') || 'error') : 'unparsed');
            const chunks = hits.length ? hits.map((h, i) => t.slice(h.index, hits[i + 1]?.index ?? t.length)) : [t];
            chunks.forEach((c, i) => { const err = hits[i] && /["']error["']\s*:/.test(c) ? (str(c, 'code') || 'error') : error; enqueues.push({ ws, session: s.file, ep: call.ep, at: call.at, id: hits[i]?.[1] || null, ok: !!hits[i] && !err,
              kind: str(c, 'kind') ?? null, promptName: str(c, 'promptName') ?? null, override: str(c, 'override') === true, issue: str(c, 'issueIdentifier') ?? call.issues[0] ?? null,
              followUp: call.bodyFollowUp, bodyKind: call.bodyKind, error: err }); });
          } else {
            previews.push({ ws, session: s.file, issue: call.issue, at: call.at, noDescend: call.noDescend, ok: !/"error"\s*:/.test(t.slice(0, 400)),
              action: str(t, 'action') ?? str(t, 'kind') ?? null, promptName: str(t, 'promptName') ?? str(t, 'name') ?? null, head: t.slice(0, 240) });
          }
        }
      }
      const t = textOf(content);
      if (!t) continue;
      if (!Array.isArray(content) || content.some((b) => b.type === 'text')) s.first ??= o.timestamp;
      if (!s.header) { const h = t.match(/^# (LIN-\d+) · ([\w-]+)/); if (h) { s.header = h[2]; s.headerIssue = h[1]; } }
      if (t.includes('"promptName"')) {
        for (const m of t.matchAll(ITEM_RE)) {
          const id = m[1]; if (items[id]) continue;
          const tail = t.slice(m.index, m.index + 400000);
          let prompt = null; const pm = tail.match(/"prompt"\s*:\s*("(?:[^"\\]|\\.)*")/); if (pm) { try { prompt = JSON.parse(pm[1]); } catch { /* truncated */ } }
          items[id] = { promptName: JSON.parse(m[2]), kind: JSON.parse(m[3]), issue: tail.match(/"issueIdentifier"\s*:\s*"([A-Z]+-\d+)"/)?.[1] || null,
            followUpTo: tail.match(new RegExp(`"followUpTo"\\s*:\\s*"(${UUID})"`))?.[1] || null, ws, session: s.file, at: o.timestamp,
            promptLen: prompt ? prompt.length : null, promptHead: prompt ? prompt.slice(0, 160) : null, prompt };
          s.fetched.push(id);
        }
      }
    }
    if (s.first) sessions.push(s);
  }
}
const role = new Map(sessions.map((s) => [s.file, s.runner ? 'passage-runner' : s.stepper ? 'stepper' : s.header === 'autopilot' || s.autopilot ? 'autopilot' : s.header || 'unknown']));
for (const e of enqueues) e.callerRole = role.get(e.session) || 'unknown';
for (const e of previews) e.callerRole = role.get(e.session) || 'unknown';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), sessions: sessions.map(({ fetched, ...r }) => ({ ...r, fetched: fetched.length })), items, enqueues, previews }));
const by = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const okE = enqueues.filter((e) => e.ok);
console.log(`transcripts=${sessions.length} first=${sessions.map((s) => s.first).sort()[0]} items=${Object.keys(items).length} enqueues=${enqueues.length} ok=${okE.length} previews=${previews.length}`);
console.log('enqueue routes', by(okE, (e) => `${e.ep}${e.override ? '+override' : ''}${e.followUp ? '+followUp' : ''}`));
console.log('caller roles', by(okE, (e) => e.callerRole));
console.log('item kinds', by(Object.values(items), (i) => i.kind));
