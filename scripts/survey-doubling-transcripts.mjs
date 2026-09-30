// LIN-3170: the exact kind, prompt name and follow-up parent of every dispatch item a local Claude transcript fetched (31 Aug on), plus each session's header kind, into a git-ignored snapshot.
// Usage: node scripts/survey-doubling-transcripts.mjs [--root ~/.claude/projects] [--out data/survey-doubling/transcripts.json]
// A dispatched Claude session's first message is "# LIN-n · kind"; every task it runs arrives as "dispatch item <id> is ready" and the
// session curls /dispatch/<id>/prompt, whose JSON (id, promptName, kind, issueIdentifier, followUpTo) lands in a tool result. Older
// sessions got the prompt injected whole; those still carry the header. Transcripts are kept for about 30 days, so this sees September
// only. Main transcripts only (subagent files carry no dispatch fetches). No proxy calls.
// Per session it also records the passage Runner ("flying a passage") and STEPPER markers, the issues it dispatched, compactions,
// and, for every task it was handed, whether it acted before the next one arrived: a write to the proxy, a dispatch or kickoff,
// a push, or a PR create/merge/comment. A wake that is followed by none of these is "quiet" (survey-check-2.md's reading merges
// the follow-up handshake into its wake; this is the cruder transcript-only version).
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('--root', join(homedir(), '.claude/projects'));
const out = arg('--out', 'data/survey-doubling/transcripts.json');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ITEM_RE = new RegExp(`"id"\\s*:\\s*"(${UUID})"\\s*,\\s*"promptName"\\s*:\\s*(null|"[^"]*")\\s*,\\s*"kind"\\s*:\\s*(null|"[^"]*")`, 'g');
const READY_RE = new RegExp(`dispatch item (${UUID})\\)? is ready`);
const ACT = /\s(-d|--data(-raw|-binary)?|--json)\s|-X\s*'?(POST|PATCH|PUT|DELETE)|--request\s+(POST|PATCH|PUT|DELETE)|X-Harbour-Intent:\s*write|autopilot\/kickoff|gh pr (merge|create|comment|review)|git push/;
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x.text === 'string' ? x.text : typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.map((y) => y.text || '').join('\n') : '')).join('\n') : '');

const items = {}; const sessions = [];
const dirs = readdirSync(root).filter((d) => d.startsWith('-Users-work-development-simple-dispatcher-workspaces-'));
for (const d of dirs) {
  let files; try { files = readdirSync(join(root, d)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
  for (const f of files) {
    const p = join(root, d, f); let raw; try { raw = readFileSync(p, 'utf8'); } catch { continue; }
    const ws = d.match(new RegExp(`(${UUID})`))?.[1] || null;
    const s = { ws, file: f.replace('.jsonl', ''), mtime: statSync(p).mtime.toISOString(), header: null, headerIssue: null, first: null, readies: [], compactions: 0, fetched: [], runner: /You're \*{0,2}flying\*{0,2} a passage/.test(raw), stepper: /You're running as the STEPPER/.test(raw), dispatchedIssues: [], acted: {} };
    let current = null;
    for (const line of raw.split('\n')) {
      if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'system' && o.subtype === 'compact_boundary') s.compactions++;
      if (o.type === 'assistant') {
        for (const b of o.message?.content || []) {
          const cmd = b.type === 'tool_use' ? String(b.input?.command || '') : '';
          if (!cmd) continue;
          if (/autopilot\/kickoff|api\/proxy\/dispatch\b/.test(cmd) && /POST|kickoff/.test(cmd)) for (const x of cmd.match(/LIN-\d+/g) || []) if (!s.dispatchedIssues.includes(x)) s.dispatchedIssues.push(x);
          if (current && ACT.test(cmd)) s.acted[current] = true;
        }
        continue;
      }
      if (o.type !== 'user') continue;
      const t = textOf(o.message?.content);
      if (!t) continue;
      s.first ??= o.timestamp;
      if (!s.header) { const h = t.match(/^# (LIN-\d+) · ([\w-]+)/); if (h) { s.header = h[2]; s.headerIssue = h[1]; } }
      const r = t.match(READY_RE); if (r && /Stop hook feedback|is ready\. Fetch it now/.test(t)) { s.readies.push({ item: r[1], at: o.timestamp }); current = r[1]; s.acted[current] ??= false; }
      if (t.includes('"promptName"')) {
        for (const m of t.matchAll(ITEM_RE)) {
          const id = m[1]; if (items[id]) continue;
          const tail = t.slice(m.index, m.index + 200000);
          const issue = tail.match(/"issueIdentifier"\s*:\s*"([A-Z]+-\d+)"/)?.[1] || null;
          const fu = tail.match(new RegExp(`"followUpTo"\\s*:\\s*"(${UUID})"`))?.[1] || null;
          items[id] = { promptName: JSON.parse(m[2]), kind: JSON.parse(m[3]), issue, followUpTo: fu, ws, at: o.timestamp };
          s.fetched.push(id);
        }
      }
    }
    if (s.first) sessions.push(s);
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), sessions, items }));
const by = (xs, k) => xs.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {});
console.log(`transcripts=${sessions.length} items=${Object.keys(items).length} first=${sessions.map((s) => s.first).sort()[0]}`);
console.log('header kinds', by(sessions, 'header'));
console.log('item kinds', by(Object.values(items), 'kind'));
console.log('item promptNames', by(Object.values(items), 'promptName'));
