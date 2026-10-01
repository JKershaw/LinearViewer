// LIN-3178: from local Claude Code transcripts of dispatched sessions, every tool call classed (read, search, ticket read, run, edit, write …), every file or ticket read keyed, each task beat's first productive action, and the context each class carries, into a git-ignored snapshot.
// Usage: node scripts/survey-context-extract.mjs [--root ~/.claude/projects] [--out data/survey-context/sessions.json]
// A dispatched session's first message is "# LIN-n · kind". A task beat starts where a task arrives: the fetched dispatch prompt
// (its JSON carries kind and issueIdentifier) or the Stop hook's "is ready. Fetch it now". Turns before the first beat are the
// bootstrap summarise. Main transcripts give turns, beats and carry; subagent transcripts add their tokens and reads to the session.
// Units are survey-effort-fleet.mjs's: frontier-input equivalents at list-price ratios, mid tier × 0.6, small tier × 0.2.
// "Productive" is per role (survey-context-analyse.mjs states it); this script records, per beat, the first call of each action class.
// Bytes → tokens at --bpt bytes a token (default 2.6): the script measures the ratio itself, per turn, as the bytes entering the
// main thread between two turns over the growth of the window less the earlier turn's output, and prints it. Attachment lines
// (hook text, CLAUDE.md files loaded on demand, harness reminders) enter the context too and are counted; the stored system-prompt
// snapshot is not. No proxy calls.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync, existsSync } from 'fs';
import { join, dirname, posix } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('--root', join(homedir(), '.claude/projects'));
const out = arg('--out', 'data/survey-context/sessions.json');
const BPT = Number(arg('--bpt', '2.6'));
const calib = [];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const WS_ROOT = '/Users/work/development/simple-dispatcher-workspaces/';
const REPOS = ['LinearViewer', 'simple-dispatcher'];
const tier = (m = '') => (/opus|fable/i.test(m) ? 1 : /sonnet/i.test(m) ? 0.6 : /haiku/i.test(m) ? 0.2 : 0);
const unitsOf = (u, m) => { const w = tier(m); const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1; return w * ((u.input_tokens || 0) + 5 * (u.output_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 2 * c1 + 1.25 * c5); };
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x.text === 'string' ? x.text : typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.map((y) => y.text || '').join('\n') : '')).join('\n') : '');

// --- paths -------------------------------------------------------------------------------------------------------------
// A path is keyed as repo:relative-path when it falls inside a workspace's LinearViewer or simple-dispatcher checkout (or a
// worktree of one in scratch, which keeps the repo's layout), as "scratch" for /tmp and the scratchpad, "transcripts" for
// ~/.claude/projects, else "other".
const STRIP = /^(\.\/)+/;
function keyPath(p, cwd) {
  if (!p) return null;
  p = p.replace(/^["']|["']$/g, '').replace(STRIP, '');
  if (/^~\//.test(p)) p = homedir() + p.slice(1);
  if (!p.startsWith('/')) {
    if (!cwd) return null;
    p = posix.normalize(posix.join(cwd, p));
  }
  if (p.includes('/.claude/projects')) return { area: 'transcripts', key: null };
  for (const r of REPOS) {
    const i = p.indexOf(`/${r}/`);
    if (i >= 0 && (p.startsWith(WS_ROOT) || p.startsWith('/Users/work/development/'))) return { area: 'repo', repo: r, key: `${r}:${p.slice(i + r.length + 2)}` };
  }
  // A worktree beside the checkouts (<workspace>/lv-2889/…) keeps the repo's layout; its repo is read from its name.
  const wt = p.match(/^\/Users\/work\/development\/simple-dispatcher-workspaces\/[0-9a-f-]{36}\/([^/]+)\/(.+)$/);
  if (wt) { const r = /sd|dispatch/i.test(wt[1]) ? 'simple-dispatcher' : 'LinearViewer'; return { area: 'repo', repo: r, key: `${r}:${wt[2]}` }; }
  if (/^\/(private\/)?tmp\//.test(p)) {
    // A worktree under scratch that mirrors a repo layout: key by the repo-relative tail when it starts in a known top-level dir.
    const m = p.match(/\/(lib|routes|public|tests|test|scripts|docs|content)\/.+$/);
    return { area: 'scratch', key: null, tail: m ? m[0].slice(1) : null };
  }
  return { area: 'other', key: null };
}
function fileCat(rel) {
  if (!rel) return 'other';
  if (/^lib\/prompts\/|prompt-template|(^|\/)[\w-]*-prompt\.md$|runner-prompt|operating-manual|^docs\/autopilot-/.test(rel)) return 'prompts and templates';
  if (/(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[mc]?js$/.test(rel)) return 'test code';
  if (/\.md$|^docs\//.test(rel) || /CLAUDE\.md$/.test(rel)) return 'docs';
  if (/^data\/|\.jsonl?$/.test(rel) && !/package(-lock)?\.json$/.test(rel)) return 'data';
  return 'code';
}

// --- tool classing -----------------------------------------------------------------------------------------------------
const READ_CMD = /^(cat|sed|head|tail|nl|less|more|bat)$/;
const SEARCH_CMD = /^(grep|rg|egrep|find|ls|tree|wc|fd|ag|stat|file|du)$/;
const RUN_HEAD = /^(npm|npx|pnpm|yarn|make|playwright|vitest|jest|bash|sh|zsh|deno|bun|\.\/\S+|time)$/;
// Strongest class wins for a compound command; reads are collected from every segment.
const RANK = ['dispatch', 'proxy-write', 'gh-write', 'git-write', 'edit', 'run', 'compute', 'web', 'subagent', 'prompt-fetch', 'ticket-read', 'proxy-read', 'read', 'git-read', 'gh-read', 'search', 'transcript-read', 'nav', 'other'];
const stronger = (a, b) => (RANK.indexOf(a) <= RANK.indexOf(b) ? a : b);

function splitSegments(cmd) {
  // Drop heredoc bodies (they are written, not run) but remember that a heredoc wrote a file.
  const heredocWrites = [];
  const body = cmd.replace(/(?:cat|tee)\s*(?:-a\s*)?>?\s*>?\s*("?)([^\s"<>|;&]+)\1\s*<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\3\b/g, (m, q, f) => { heredocWrites.push(f); return ' :heredoc: '; })
    .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, ' :heredoc: ');
  const segs = [];
  for (const line of body.split(/\n|&&|\|\||;/)) {
    const pipe = line.split(/\|(?!\|)/);
    pipe.forEach((p, i) => segs.push({ text: p.trim(), piped: i > 0 }));
  }
  return { segs: segs.filter((s) => s.text), heredocWrites };
}
function words(s) { return (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) => w.replace(/^["']|["']$/g, '')); }

function classBash(cmd, state) {
  let cls = 'other'; const reads = []; const writes = []; const q = []; let curlSeen = false;
  const { segs, heredocWrites } = splitSegments(cmd);
  for (const f of heredocWrites) writes.push(keyPath(f, state.cwd));
  let localCwd = state.cwd;
  for (const { text, piped } of segs) {
    let w = words(text.replace(/\b\w+=\$\(|\$\(|`|^\(|\)$/g, ' ')); while (w.length && (/^\w+=/.test(w[0]) || /^(do|then|else|elif|if|while|until|\{|!|time|command)$/.test(w[0]))) w.shift();
    if (!w.length || /^(for|done|fi|esac|case|\}|function)$/.test(w[0])) continue;
    const h = w[0].replace(/^.*\//, (m) => (w[0].startsWith('./') ? m : ''));
    if (h === 'cd') { const k = w[1] ? (w[1].startsWith('/') ? w[1] : localCwd ? posix.join(localCwd, w[1]) : null) : null; if (k && !/\$/.test(k)) { localCwd = k; state.cwd = k; } cls = stronger(cls, 'nav'); continue; }
    if (h === ':heredoc:') continue;
    if (h === 'curl') {
      curlSeen = true;
      // Sessions often hold the base in a variable ($B/issues/LIN-1), so the route is matched on its own path segments.
      const url = text.match(/\/(dispatch|issues|brief|relations|instructions|autopilot|search|stack|agent|recommend[\w-]*|north-star|periodicals|tokens?|projects|labels|comments|recap|cost)\b[^\s"']*/)?.[0] || (/HARBOUR_LOCAL_BASE|127\.0\.0\.1|localhost|api\/proxy|"?\$\{?\w+\}?\//.test(text) || !/https?:\/\//.test(text) ? '/proxy' : '');
      const write = /-X\s*'?"?(POST|PATCH|PUT|DELETE)|--request\s+(POST|PATCH|PUT|DELETE)|\s(-d|--data(-raw|-binary)?|--json|-F)\s/.test(text) || /X-Harbour-Intent:\s*write/.test(text);
      if (/autopilot\/kickoff/.test(url) || (write && /^\/dispatch\/?$|^\/dispatch\/?\?|recommend-and-dispatch/.test(url))) { cls = stronger(cls, 'dispatch'); q.push('dispatch'); continue; }
      if (write) { cls = stronger(cls, 'proxy-write'); q.push('proxy write'); continue; }
      if (/\/dispatch\/[0-9a-f-]{36}\/prompt/.test(url)) { cls = stronger(cls, 'prompt-fetch'); continue; }
      const t = url.match(/(?:issues|brief|relations)\/([A-Z]+-\d+)/);
      if (t) { cls = stronger(cls, 'ticket-read'); reads.push({ key: `ticket:${t[1]}`, cat: 'tickets and comments' }); q.push(/\/cost/.test(url) ? 'ticket cost' : /comments/.test(url) ? 'ticket comments' : /brief/.test(url) ? 'ticket brief' : /relations/.test(url) ? 'ticket relations' : 'ticket'); continue; }
      if (/\/instructions/.test(url)) { cls = stronger(cls, 'proxy-read'); reads.push({ key: 'proxy:instructions', cat: 'prompts and templates' }); q.push('proxy instructions'); continue; }
      if (/^\/dispatch(\?|\/?$)/.test(url)) { cls = stronger(cls, 'proxy-read'); q.push('dispatch history of a ticket'); continue; }
      if (/\/dispatch\/[0-9a-f-]{36}/.test(url)) { cls = stronger(cls, 'proxy-read'); reads.push({ key: `dispatch:${url.match(/[0-9a-f-]{36}/)[0]}`, cat: 'tickets and comments' }); q.push('dispatch feedback'); continue; }
      if (/^\/issues(\?|\/?$)|^\/(search|stack|projects|labels)/.test(url)) { cls = stronger(cls, 'proxy-read'); q.push('ticket search or list'); continue; }
      if (url) { cls = stronger(cls, 'proxy-read'); q.push('other proxy read'); continue; }
      cls = stronger(cls, 'web'); q.push('web'); continue;
    }
    if (h === 'git') {
      const sub = w.find((x, i) => i > 0 && !x.startsWith('-') && !/^-C$/.test(w[i - 1])) || '';
      if (/^(add|commit|push|merge|rebase|cherry-pick|revert|tag|am|apply|rm|mv)$/.test(sub)) { cls = stronger(cls, 'git-write'); continue; }
      if (sub === 'grep') { cls = stronger(cls, 'search'); q.push('where is a symbol'); continue; }
      if (sub === 'show') { const p = w.find((x) => /:[\w./-]+\.\w+$/.test(x)); if (p) reads.push({ ...(keyPath(p.split(':').slice(1).join(':'), localCwd) || {}), via: 'git show' }); }
      if (/^(log|show|diff|blame|shortlog|rev-list|rev-parse|ls-files|ls-tree|status|describe|reflog|cat-file|merge-base|name-rev|for-each-ref|branch|remote|config)$/.test(sub)) { cls = stronger(cls, 'git-read'); q.push(/--grep|LIN-\d+/.test(text) && sub === 'log' ? 'commits for a ticket' : sub === 'log' || sub === 'blame' ? 'history of a path' : sub === 'diff' || sub === 'show' ? 'a diff' : 'repo state'); continue; }
      cls = stronger(cls, 'nav'); continue;
    }
    if (h === 'gh') {
      if (/\bpr\s+(create|merge|comment|review|edit|close|ready)|\bissue\s+(create|comment|edit)|\bapi\b.*-X\s*(POST|PATCH|PUT)/.test(text)) { cls = stronger(cls, 'gh-write'); continue; }
      cls = stronger(cls, 'gh-read'); q.push(/\brun\b|checks/.test(text) ? 'CI state' : /pr\s+(list|view|diff)/.test(text) ? 'PR state or diff' : 'other GitHub read'); continue;
    }
    if (READ_CMD.test(h)) {
      if (h === 'sed' && /\s-i\b/.test(text)) { for (const x of w.slice(1).filter((x) => !x.startsWith('-') && /[./]/.test(x) && !/^s\//.test(x))) writes.push(keyPath(x, localCwd)); cls = stronger(cls, 'edit'); continue; }
      const files = w.slice(1).filter((x, i, a) => !x.startsWith('-') && !/^\d+(,\d+)?p?$/.test(x) && !/^'?\d/.test(x) && !(h === 'sed' && i === a.findIndex((y) => !y.startsWith('-'))) && /[\w-]\.[\w]+$|\//.test(x) && !/^[<>]/.test(x) && !/^\$/.test(x));
      if (!files.length && piped) { cls = stronger(cls, 'other'); continue; }
      let anyTx = false;
      for (const f of files) { const k = keyPath(f, localCwd); if (k?.area === 'transcripts') anyTx = true; else if (k) reads.push(k); }
      cls = stronger(cls, anyTx ? 'transcript-read' : 'read'); if (anyTx) q.push('session transcripts'); continue;
    }
    if (SEARCH_CMD.test(h)) {
      if (/\.claude\/projects/.test(text)) { cls = stronger(cls, 'transcript-read'); q.push('session transcripts'); continue; }
      if (piped && /^(grep|wc|rg)$/.test(h)) continue; // a filter on another command's output
      cls = stronger(cls, 'search'); if (/^(grep|rg|ag)$/.test(h)) q.push('where is a symbol'); continue;
    }
    if (/^(node|python3?|ruby|perl)$/.test(h)) {
      const inline = w.some((x) => /^-(e|p|c|-eval|-print|-input-type=module)$/.test(x));
      if (/\.claude\/projects/.test(text)) { cls = stronger(cls, 'transcript-read'); q.push('session transcripts'); continue; }
      if (inline) { if (piped || curlSeen) continue; cls = stronger(cls, 'compute'); q.push('re-derive a number'); continue; }
      cls = stronger(cls, 'run'); if (/--test|\.test\./.test(text)) q.push('run tests'); else if (/scripts\/survey|scripts\//.test(text)) q.push('run an analysis script'); else q.push('run code'); continue;
    }
    if (/^(jq|awk|sort|uniq|cut|tr|xargs|column|paste|bc|expr|printf|echo|date|sleep|true|false|test|\[|export|set|source|which|type|env|pwd|mkdir|cp|touch|rm|mv|ln|chmod|open|osascript|tmux|kill|pkill|ps|lsof|diff|cmp|base64|shasum|md5|sqlite3|unzip|tar|gzip|zcat)$/.test(h)) {
      if (/^(cp|mv|touch|mkdir|rm|ln|chmod)$/.test(h)) cls = stronger(cls, 'nav');
      else if (h === 'sqlite3') { cls = stronger(cls, 'compute'); q.push('re-derive a number'); }
      else if (/^(jq|awk)$/.test(h) && !piped && !curlSeen) { cls = stronger(cls, 'compute'); q.push('re-derive a number'); }
      continue;
    }
    if (RUN_HEAD.test(h)) { cls = stronger(cls, 'run'); q.push(/test/.test(text) ? 'run tests' : 'run code'); continue; }
    cls = stronger(cls, 'other');
  }
  // Output redirection to a file: a write when the command produced something (a heredoc or a run), a saved read otherwise.
  for (const m of cmd.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, '').matchAll(/(?:^|[^0-9&>])>{1,2}\s*("?)([^\s"&|;)]+)\1/g)) {
    if (/^\/dev\//.test(m[2]) || m[2] === '&1') continue;
    const k = keyPath(m[2], localCwd); if (k && heredocWrites.length) writes.push(k);
  }
  if (writes.filter(Boolean).length) cls = stronger(cls, 'edit');
  return { cls, reads: reads.filter((r) => r && (r.key || r.area)), writes: writes.filter(Boolean), q };
}

function classTool(b, state) {
  const n = b.name; const i = b.input || {};
  if (n === 'Bash') return classBash(String(i.command || ''), state);
  if (n === 'Read') { const k = keyPath(i.file_path, state.cwd); if (k?.area === 'transcripts') return { cls: 'transcript-read', reads: [], writes: [], q: ['session transcripts'] }; return { cls: 'read', reads: k ? [k] : [], writes: [], q: [] }; }
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n)) { const k = keyPath(i.file_path || i.notebook_path, state.cwd); return { cls: 'edit', reads: [], writes: k ? [k] : [], q: [] }; }
  if (n === 'Grep' || n === 'Glob' || n === 'LS') return { cls: 'search', reads: [], writes: [], q: ['where is a symbol'] };
  if (n === 'Task' || n === 'Agent') return { cls: 'subagent', reads: [], writes: [], q: [] };
  if (/^Web(Fetch|Search)$/.test(n)) return { cls: 'web', reads: [], writes: [], q: ['web'] };
  if (/^mcp__/.test(n)) return { cls: 'other', reads: [], writes: [], q: [] };
  if (/^(TodoWrite|ToolSearch|ExitPlanMode|EnterPlanMode|Monitor|ScheduleWakeup|TaskOutput|BashOutput|KillShell|KillBash|TaskStop)$/.test(n)) return { cls: 'nav', reads: [], writes: [], q: [] };
  return { cls: 'other', reads: [], writes: [], q: [] };
}

// The context a tool result adds, by what it holds.
function contentCat(c) {
  if (c.cls === 'prompt-fetch') return 'prompts and templates';
  if (c.cls === 'ticket-read') return 'tickets and comments';
  if (c.cls === 'proxy-read') return c.reads.some((r) => r.cat === 'prompts and templates') ? 'prompts and templates' : 'other proxy reads';
  if (c.cls === 'read' || (c.reads.length && ['nav', 'other', 'search', 'git-read'].includes(c.cls))) {
    const r = c.reads.find((x) => x.key || x.tail); if (r) return fileCat(r.key ? r.key.split(':').slice(1).join(':') : r.tail);
    return 'other files';
  }
  if (c.cls === 'git-read' || c.cls === 'gh-read') return 'git and GitHub';
  if (c.cls === 'search') return 'search results';
  if (c.cls === 'transcript-read') return 'session transcripts';
  if (c.cls === 'run' || c.cls === 'compute') return 'command output';
  if (c.cls === 'subagent') return 'subagent reports';
  return 'other tool results';
}

// --- per-session pass --------------------------------------------------------------------------------------------------
const READY = /dispatch item (\S{36})\)? is ready|is ready\. Fetch it now/;
function parseFile(file) {
  let raw; try { raw = readFileSync(file, 'utf8'); } catch { return null; }
  const lines = [];
  for (const l of raw.split('\n')) { if (!l) continue; try { lines.push(JSON.parse(l)); } catch { /* torn line */ } }
  return { raw, lines };
}

const sessions = [];
const dirs = readdirSync(root).filter((d) => d.startsWith('-Users-work-development-simple-dispatcher-workspaces-'));
let nFiles = 0;
for (const d of dirs) {
  let files; try { files = readdirSync(join(root, d)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
  const ws = d.match(new RegExp(`(${UUID})`))?.[1] || null;
  for (const f of files) {
    const p = join(root, d, f); const parsed = parseFile(p); if (!parsed) continue; nFiles++;
    const { raw, lines } = parsed;
    const s = {
      ws, file: f.replace('.jsonl', ''), header: null, headerIssue: null, kind: null, promptName: null,
      runner: /You're \*{0,2}flying\*{0,2} a passage/.test(raw), stepper: /You're running as the STEPPER/.test(raw),
      first: null, last: null, activeMs: 0, units: 0, subUnits: 0, subUnitsBeforeProd: 0, compactions: 0, dispatchedIssues: [],
      boot: { units: 0, calls: 0, activeMs: 0, turns: 0 }, beats: [], calls: [], reads: [], edits: [], carry: {}, windowSum: 0,
      itemKinds: [], ticketText: null, promptText: null, repoVotes: {},
    };
    const state = { cwd: ws ? `${WS_ROOT}${ws}` : null };
    const uses = new Map(); const seen = new Set();
    let beat = null; let prevTs = null; let turnIdx = -1; let firstTurnWindow = null; let firstUserBytes = 0;
    let prevWin = null; let prevOut = 0; let pendBytes = 0; s.attach = {};
    const blocks = []; // {turn: index of the next turn, cat, tokens, seg} — carried until the next compaction
    let seg = 0; const segEnds = [];
    const startBeat = (ts, item) => {
      beat = { start: ts, startTurn: turnIdx + 1, issue: item?.issue || s.headerIssue, itemKind: item?.kind || null, units: 0, calls: 0, activeMs: 0, firstOf: {}, unitsBefore: {}, callsBefore: {}, msBefore: {}, ended: null };
      s.beats.push(beat);
    };
    const curIssue = () => (beat ? beat.issue : s.headerIssue);
    for (const e of lines) {
      if (e.type === 'system' && e.subtype === 'compact_boundary') { s.compactions++; segEnds[seg] = turnIdx + 1; seg++; continue; }
      const t = Date.parse(e.timestamp); const m = e.message;
      if (t) { s.first ??= t; if (prevTs && t - prevTs <= 120e3) { const g = t - prevTs; s.activeMs += g; if (beat) beat.activeMs += g; else s.boot.activeMs += g; } prevTs = t; s.last = t; }
      if (e.type === 'attachment' && !e.isSidechain) {
        const a = e.attachment || {}; if (a.type === 'prompt_snapshot') continue;
        const bytes = Buffer.byteLength(JSON.stringify(a)); pendBytes += bytes; if (turnIdx < 0) firstUserBytes += bytes;
        const cat = /^hook_|queued_command/.test(a.type || '') ? 'prompts and templates' : a.type === 'nested_memory' ? 'CLAUDE.md loaded by the harness' : 'harness reminders';
        s.attach[a.type] = (s.attach[a.type] || 0) + bytes / BPT;
        blocks.push({ turn: turnIdx + 1, cat, tokens: bytes / BPT, seg });
        if (a.type === 'nested_memory' && a.path) { const k = keyPath(a.path, state.cwd); if (k?.key) s.reads.push({ key: k.key, cat: 'docs', ts: t, beat: s.beats.length - 1, issue: curIssue(), sub: false, via: 'auto-loaded', call: -1, tokens: bytes / BPT }); }
        continue;
      }
      if (!m || e.isSidechain) continue;
      if (e.type === 'assistant') {
        if (m.usage && !seen.has(m.id)) {
          seen.add(m.id); turnIdx++;
          const u = unitsOf(m.usage, m.model); s.units += u;
          const win = (m.usage.input_tokens || 0) + (m.usage.cache_read_input_tokens || 0) + (m.usage.cache_creation_input_tokens || 0);
          s.windowSum += win; firstTurnWindow ??= win;
          if (beat) beat.units += u; else { s.boot.units += u; s.boot.turns++; }
          blocks.push({ turn: turnIdx + 1, cat: "the model's own output", tokens: m.usage.output_tokens || 0, seg });
          if (prevWin != null && pendBytes > 4000 && win > prevWin) calib.push(pendBytes / (win - prevWin - prevOut));
          prevWin = win; prevOut = m.usage.output_tokens || 0; pendBytes = 0;
        }
        for (const b of m.content || []) {
          if (b.type !== 'tool_use') continue;
          const c = classTool(b, state);
          uses.set(b.id, { c, ts: t, ci: s.calls.length });
          if (b.name === 'Bash' && /autopilot\/kickoff|api\/proxy\/dispatch\b/.test(b.input?.command || '')) for (const x of b.input.command.match(/LIN-\d+/g) || []) if (!s.dispatchedIssues.includes(x)) s.dispatchedIssues.push(x);
          const substantive = c.cls === 'proxy-write' && (String(b.input?.command || '').length >= 500 || /(-d|--data(-binary|-raw)?)\s+@|--json\s+@/.test(b.input?.command || ''));
          const call = { ts: t, cls: c.cls, cmd: String(b.input?.command || b.input?.file_path || b.input?.pattern || b.name).slice(0, 160), beat: s.beats.length - 1, q: c.q, substantive, repoWrite: c.writes.some((w) => w.area === 'repo'), anyWrite: c.writes.length > 0, issue: curIssue() };
          s.calls.push(call);
          if (beat) {
            beat.calls++;
            // Record the first call of each class in this beat, with the units, calls and active time spent before it.
            const tags = [c.cls]; if (call.repoWrite) tags.push('repo-edit'); if (call.anyWrite) tags.push('any-edit'); if (substantive) tags.push('proxy-write-substantive');
            for (const tg of tags) if (!(tg in beat.firstOf)) { beat.firstOf[tg] = t; beat.unitsBefore[tg] = beat.units - (m.usage && seen.has(m.id) ? unitsOf(m.usage, m.model) : 0); beat.callsBefore[tg] = beat.calls - 1; beat.msBefore[tg] = beat.activeMs; }
          } else s.boot.calls++;
          for (const r of c.reads) if (r.key || r.tail) { s.reads.push({ key: r.key || `scratch:${r.tail}`, cat: r.cat || fileCat(r.key ? r.key.split(':').slice(1).join(':') : r.tail), ts: t, beat: s.beats.length - 1, issue: curIssue(), sub: false, via: r.via || null, call: s.calls.length - 1 }); if (r.repo) s.repoVotes[r.repo] = (s.repoVotes[r.repo] || 0) + 1; }
          for (const w of c.writes) if (w.area === 'repo') { s.edits.push({ key: w.key, ts: t, beat: s.beats.length - 1, issue: curIssue() }); s.repoVotes[w.repo] = (s.repoVotes[w.repo] || 0) + 2; }
        }
        continue;
      }
      if (e.type !== 'user') continue;
      const content = m.content;
      if (Array.isArray(content) && content.some((x) => x.type === 'tool_result')) {
        for (const b of content) {
          if (b.type !== 'tool_result') continue;
          const tx = textOf(b.content); const bytes = Buffer.byteLength(tx); pendBytes += bytes;
          const use = uses.get(b.tool_use_id);
          const cat = use ? contentCat(use.c) : 'other tool results';
          const bl = { turn: turnIdx + 1, cat, tokens: bytes / BPT, seg }; blocks.push(bl);
          if (use) { const call = s.calls[use.ci]; if (call) { call.tokens = (call.tokens || 0) + bytes / BPT; call.block = bl; } }
          if (use?.c.cls === 'prompt-fetch' && tx.includes('"promptName"')) {
            const kind = tx.match(/"kind"\s*:\s*"([\w-]+)"/)?.[1] || null; const issue = tx.match(/"issueIdentifier"\s*:\s*"([A-Z]+-\d+)"/)?.[1] || null;
            const pn = tx.match(/"promptName"\s*:\s*"([^"]*)"/)?.[1] || null;
            s.itemKinds.push(kind); s.promptName ??= pn;
            if (!beat || (beat.itemKind && beat.calls > 1)) startBeat(t, { kind, issue }); else { beat.itemKind = kind; if (issue) beat.issue = issue; }
            s.promptText ??= tx.slice(0, 120000);
          }
          if (use?.c.cls === 'ticket-read' && !s.ticketText && tx.includes('"description"') && s.headerIssue && tx.includes(`"identifier":"${s.headerIssue}"`)) s.ticketText = tx.slice(0, 120000);
        }
        continue;
      }
      const tx = textOf(content); if (!tx) continue;
      const bytes = Buffer.byteLength(tx); pendBytes += bytes;
      if (!s.header) { const h = tx.match(/^# (LIN-\d+) · ([\w-]+)/); if (h) { s.header = h[2]; s.headerIssue = h[1]; } }
      if (turnIdx < 0) firstUserBytes += bytes;
      blocks.push({ turn: turnIdx + 1, cat: e.isCompactSummary || /^This session is being continued from a previous conversation/.test(tx) ? 'compaction summaries' : 'prompts and templates', tokens: bytes / BPT, seg });
      // A task arrives: the hook names a ready item, or (older launches) the hook injects the task text after the bootstrap turn.
      if (READY.test(tx) && /Stop hook feedback|is ready/.test(tx)) { if (!beat || beat.calls > 0) startBeat(t, null); }
      else if (!beat && turnIdx >= 0 && !e.isMeta && !e.isCompactSummary && /Stop hook feedback|^#|\n/.test(tx) && bytes > 400 && !/confirm its true state/.test(tx)) startBeat(t, null);
    }
    // Carry: a block of T tokens entering before turn i is carried by every turn from i to the end of its compaction segment.
    const N = turnIdx + 1; segEnds[seg] = N;
    for (const bl of blocks) { const end = segEnds[bl.seg] ?? N; const n = Math.max(0, end - bl.turn); s.carry[bl.cat] = (s.carry[bl.cat] || 0) + bl.tokens * n; }
    if (firstTurnWindow != null) s.carry['base context (system prompt, tools, CLAUDE.md)'] = Math.max(0, firstTurnWindow - firstUserBytes / BPT) * (segEnds[0] ?? N);
    // Each call's result is carried for the rest of its compaction segment: its share of the summed window.
    for (const c of s.calls) if (c.block) { c.carry = c.block.tokens * Math.max(0, (segEnds[c.block.seg] ?? N) - c.block.turn); delete c.block; }
    s.turns = N;
    // Subagents: their tokens join the session, split at the first beat's first edit or run (whichever comes first); their reads are the session's.
    const sub = join(root, d, f.replace('.jsonl', ''), 'subagents');
    if (existsSync(sub)) {
      for (const sf of readdirSync(sub).filter((x) => x.endsWith('.jsonl'))) {
        const sp = parseFile(join(sub, sf)); if (!sp) continue;
        const sseen = new Set(); const sstate = { cwd: state.cwd }; const suses = new Map();
        for (const e of sp.lines) {
          const m = e.message; if (!m) continue; const t = Date.parse(e.timestamp);
          if (e.type === 'user' && Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_result' && suses.has(b.tool_use_id)) { const ci = suses.get(b.tool_use_id).ci; s.calls[ci].tokens = (s.calls[ci].tokens || 0) + Buffer.byteLength(textOf(b.content)) / BPT; }
          if (e.type === 'assistant') {
            if (m.usage && !sseen.has(m.id)) { sseen.add(m.id); const u = unitsOf(m.usage, m.model); s.units += u; s.subUnits += u; (s.subTimes ||= []).push([t, u]); }
            for (const b of m.content || []) {
              if (b.type !== 'tool_use') continue;
              const c = classTool(b, sstate); suses.set(b.id, { c, ci: s.calls.length });
              const bi = s.beats.findLastIndex((x) => x.start <= t);
              s.calls.push({ ts: t, cls: c.cls, cmd: String(b.input?.command || b.input?.file_path || b.input?.pattern || b.name).slice(0, 160), beat: bi, q: c.q, sub: true, issue: bi >= 0 ? s.beats[bi].issue : s.headerIssue });
              for (const r of c.reads) if (r.key || r.tail) s.reads.push({ key: r.key || `scratch:${r.tail}`, cat: r.cat || fileCat(r.key ? r.key.split(':').slice(1).join(':') : r.tail), ts: t, beat: bi, issue: bi >= 0 ? s.beats[bi].issue : s.headerIssue, sub: true, call: s.calls.length - 1 });
            }
          }
        }
      }
    }
    s.kind = s.header || s.itemKinds[0] || null;
    if (s.kind === 'custom' && s.itemKinds.find((k) => k && k !== 'custom')) s.kind = s.itemKinds.find((k) => k && k !== 'custom');
    s.repo = Object.entries(s.repoVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    delete s.repoVotes;
    if (s.kind !== 'implementation') { s.ticketText = null; s.promptText = null; } // only the finder (part 4) reads them
    if (s.first) sessions.push(s);
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), root, files: nFiles, sessions }));
const by = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`transcripts=${nFiles} sessions=${sessions.length} first=${new Date(Math.min(...sessions.map((s) => s.first))).toISOString()} last=${new Date(Math.max(...sessions.map((s) => s.last))).toISOString()}`);
console.log('kinds', by(sessions, (s) => s.kind));
console.log('repo', by(sessions, (s) => s.repo));
{ const r = [...calib].sort((a, b) => a - b); const at = (p) => r[Math.floor(p * r.length)]?.toFixed(2); console.log(`bytes per token, measured on ${r.length} turns: median ${at(0.5)} (IQR ${at(0.25)}–${at(0.75)}); using ${BPT}`); }
console.log('beats per session', by(sessions, (s) => Math.min(s.beats.length, 6)));
