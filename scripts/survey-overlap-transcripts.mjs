// LIN-3179: per dispatched Claude Code session (local transcripts, 29 Aug on), what it was asked to do, which ticket text it loaded (comment ids it actually received), which comments it posted, which files it read, and its tokens, into a git-ignored snapshot.
// Usage: node scripts/survey-overlap-transcripts.mjs [--root ~/.claude/projects] [--until 2026-10-01T06:00:00Z] [--out data/survey-overlap/transcripts.json]
// Main transcripts only (a subagent's reads are not in its parent's file). A session's kind at any moment is the kind of the last
// dispatch item it fetched (or its "# LIN-n · kind" header before the first fetch). A ticket read is any tool call that hits
// /api/proxy/issues/LIN-n, /brief/LIN-n or /issues/LIN-n/comments; the comment ids are the ones present in what came back, so a
// read piped through `head -c` or a filter counts only what the session saw. A block of B bytes received before turn i of an
// N-turn session is carried (B/4) × (N − i) tokens (scripts/steady-base-carry.mjs's rule). The text of every ticket read goes to
// <out>-reads.jsonl (keyed by session file and read index) so the analysis can tell which comments entered context. No proxy calls.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('--root', join(homedir(), '.claude/projects'));
const out = arg('--out', 'data/survey-overlap/transcripts.json');
const until = arg('--until', '2026-10-01T06:00:00Z'); // sessions that began before the wave started, so the snapshot is fixed
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ITEM_RE = new RegExp(`"id"\\s*:\\s*"(${UUID})"\\s*,\\s*"promptName"\\s*:\\s*(?:null|"[^"]*")\\s*,\\s*"kind"\\s*:\\s*(null|"[^"]*")`, 'g');
const COMMENT_ID_RE = new RegExp(`"id"\\s*:\\s*"(${UUID})"\\s*,\\s*"body"`, 'g');
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x.text === 'string' ? x.text : '')).join('\n') : '');
// Repo-relative path: strip everything up to the workspace's repo directory.
// Absolute paths and paths relative to the repo root (after a `cd`) both reduce to the path inside the repo; the repo itself is not kept,
// since a relative path does not say which one it is.
const rel = (p) => { const x = String(p); const m = x.match(/(?:^|\/)(?:LinearViewer|simple-dispatcher)\/(.+)$/); return m ? m[1] : x.startsWith('/') ? null : x.replace(/^\.\//, ''); };

const sessions = []; const commentBytes = {}; const readTexts = [];
const dirs = readdirSync(root).filter((d) => d.startsWith('-Users-work-development-simple-dispatcher-workspaces-'));
for (const d of dirs) {
  let files; try { files = readdirSync(join(root, d)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
  for (const f of files) {
    const p = join(root, d, f); let raw; try { raw = readFileSync(p, 'utf8'); } catch { continue; }
    const s = { ws: d.match(new RegExp(UUID))?.[0] || null, file: f.slice(0, 8), header: null, headerIssue: null, first: null, last: null, turns: 0, tokens: 0, window: 0, output: 0, tasks: [], reads: [], posts: [], descPatches: [], files: [], resultBytes: 0 };
    const uses = new Map(); const seenMsg = new Set(); let kind = null;
    const evs = []; // carry events in order: {turn} or {bytes, ref}
    for (const line of raw.split('\n')) {
      if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.isSidechain) continue;
      const m = o.message; if (!m) continue;
      if (o.timestamp) { s.first ??= o.timestamp; s.last = o.timestamp; }
      if (o.type === 'assistant') {
        for (const b of m.content || []) if (b.type === 'tool_use') uses.set(b.id, b);
        if (m.usage && !seenMsg.has(m.id)) {
          seenMsg.add(m.id); const u = m.usage; s.turns++;
          const w = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          s.window += w; s.output += u.output_tokens || 0; s.tokens += w + (u.output_tokens || 0); evs.push({ turn: true });
        }
        continue;
      }
      if (o.type !== 'user') continue;
      const content = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
      for (const b of content) {
        if (b.type === 'text' && !s.header) { const h = String(b.text || '').match(/^# (LIN-\d+) · ([\w-]+)/); if (h) { s.header = h[2]; s.headerIssue = h[1]; kind ??= h[2]; } }
        if (b.type !== 'tool_result') continue;
        const t = textOf(b.content); const bytes = Buffer.byteLength(t); s.resultBytes += bytes;
        const use = uses.get(b.tool_use_id); const cmd = String(use?.input?.command || ''); const at = o.timestamp;
        if (/\/api\/proxy\/dispatch\/[0-9a-f-]+\/prompt/.test(cmd) && t.includes('"promptName"')) {
          for (const mm of t.matchAll(ITEM_RE)) {
            const k = JSON.parse(mm[2]); const issue = t.slice(mm.index).match(/"issueIdentifier"\s*:\s*"([A-Z]+-\d+)"/)?.[1] || null;
            s.tasks.push({ item: mm[1], kind: k, issue, at, turn: s.turns }); kind = k || kind;
          }
          evs.push({ bytes, ref: 'prompt' }); continue;
        }
        const isWrite = /-X\s*'?(POST|PATCH|PUT)|--request\s+(POST|PATCH)|X-Harbour-Intent:\s*write/.test(cmd);
        const ticketHits = [...cmd.matchAll(/\/api\/proxy\/(issues|brief)\/(LIN-\d+)(\/comments)?/g)];
        if (isWrite && ticketHits.length) {
          for (const h of ticketHits) {
            if (h[3]) s.posts.push({ issue: h[2], at, kind, commentId: t.match(new RegExp(UUID))?.[0] || null });
            else if (h[1] === 'issues') s.descPatches.push({ issue: h[2], at, kind, named: /description/.test(cmd) });
          }
          evs.push({ bytes, ref: 'other' }); continue;
        }
        if (ticketHits.length) {
          const ids = [...new Set([...t.matchAll(COMMENT_ID_RE)].map((x) => x[1]))];
          // Where the result is the proxy's JSON whole, keep each comment's and the description's size (sizes seen anywhere fill in the rest).
          let parsed = null; try { parsed = JSON.parse(t); } catch { /* filtered or truncated */ }
          for (const c of parsed?.comments || []) if (c?.id && typeof c.body === 'string') commentBytes[c.id] ??= { bytes: Buffer.byteLength(c.body), issue: ticketHits[0][2], at: c.createdAt };
          const descBytes = typeof parsed?.description === 'string' ? Buffer.byteLength(parsed.description) : null;
          readTexts.push(JSON.stringify({ ws: s.ws, file: s.file, i: s.reads.length, text: t }));
          for (const h of ticketHits) s.reads.push({ issue: h[2], endpoint: h[1] === 'brief' ? 'brief' : h[3] ? 'comments' : 'issue', at, turn: s.turns, kind, bytes: Math.round(bytes / ticketHits.length), commentIds: ids, desc: /"description"\s*:/.test(t), descBytes, whole: !!parsed });
          evs.push({ bytes, ref: `read:${s.reads.length - 1}` }); continue;
        }
        let path = null;
        if (use?.name === 'Read') path = rel(use.input?.file_path || '');
        else if (/^\s*(cd [^&;]+(&&|;)\s*)?(cat|sed -n|head|tail|nl)\b/.test(cmd)) { const pm = cmd.match(/(?:cat|sed -n '[^']*'|head(?: -n? ?\d+)?|tail(?: -n? ?\d+)?|nl(?: -ba)?)\s+([^\s|;&]+\.(?:m?js|json|md|sh|ya?ml|css|html))/); if (pm) path = rel(pm[1]); }
        if (path || use?.name === 'Grep' || /\b(grep|rg)\b/.test(cmd)) { s.files.push({ path, grep: !path, turn: s.turns, kind, bytes }); evs.push({ bytes, ref: `file:${s.files.length - 1}` }); continue; }
        evs.push({ bytes, ref: 'other' });
      }
    }
    if (!s.first || s.first >= until || (!s.header && !s.tasks.length)) continue;
    // Carry: tokens each read block occupies across the turns after it.
    let after = s.turns;
    for (const ev of evs) { if (ev.turn) { after--; continue; } if (ev.ref.startsWith('read:')) { const r = s.reads[+ev.ref.slice(5)]; r.carry = Math.round((ev.bytes / 4) * after); r.turnsAfter = after; } else if (ev.ref.startsWith('file:')) s.files[+ev.ref.slice(5)].carry = Math.round((ev.bytes / 4) * after); }
    s.promptCarry = 0; after = s.turns; for (const ev of evs) { if (ev.turn) { after--; continue; } if (ev.ref === 'prompt') s.promptCarry += Math.round((ev.bytes / 4) * after); }
    s.mtime = statSync(p).mtime.toISOString();
    sessions.push(s);
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out.replace(/\.json$/, '-reads.jsonl'), readTexts.join('\n'));
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), root, sessions, commentBytes }));
const by = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
console.log(`sessions=${sessions.length} first=${sessions.map((s) => s.first).sort()[0]} reads=${sessions.reduce((a, s) => a + s.reads.length, 0)} posts=${sessions.reduce((a, s) => a + s.posts.length, 0)} postsWithId=${sessions.reduce((a, s) => a + s.posts.filter((p) => p.commentId).length, 0)}`);
console.log('first-task kind', by(sessions, (s) => s.tasks[0]?.kind || s.header));
