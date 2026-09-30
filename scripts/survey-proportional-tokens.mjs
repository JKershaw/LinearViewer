// LIN-3166: per-ticket tokens from the local Claude Code transcripts of every session simple-dispatcher launched for the ticket (run logs map session to ticket; transcripts are kept about 30 days).
// Usage: node scripts/survey-proportional-tokens.mjs [--state ~/development/simple-dispatcher/state] [--projects ~/.claude/projects] [--out data/survey-proportional/tokens.json]
// Tokens are input + cache read + cache write + output over the session's assistant messages, each message id counted once,
// subagent transcripts included. A ticket is "covered" only when every session launched for it has a transcript; OpenCode
// sessions write none, so a ticket with one is never covered. No proxy calls.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const state = arg('--state', join(homedir(), 'development', 'simple-dispatcher', 'state'));
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const out = arg('--out', 'data/survey-proportional/tokens.json');

// Session → ticket and harness, from the run logs (the same lines survey-effort-runner.mjs reads).
const sessions = new Map();
const logs = readdirSync(state).filter((f) => /^dispatcher\.run-\d{8}-\d{6}\.log$/.test(f)).sort();
for (const f of logs) {
  let issue = null; let harness = 'claude-code';
  for (const line of readFileSync(join(state, f), 'utf8').split('\n')) {
    let m;
    if (/^Found dispatch item: /.test(line)) { issue = null; harness = 'claude-code'; continue; }
    if ((m = line.match(/^\s+Issue: (LIN-\d+)/))) { issue = m[1]; continue; }
    if ((m = line.match(/^\s+Harness \([^)]*\): (\S+)/))) { harness = m[1]; continue; }
    if ((m = line.match(/^Claimed item .*creating session: ([0-9a-f-]{36})/)) && issue) sessions.set(m[1], { issue, harness });
  }
}

function tokensOf(file) {
  const seen = new Set(); let total = 0, output = 0, first = null, last = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const m = e.message; if (!m?.usage || !m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const u = m.usage;
    total += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
    output += u.output_tokens || 0;
    if (e.timestamp) { first ??= e.timestamp; last = e.timestamp; }
  }
  return { total, output, first, last };
}

const tickets = new Map();
let found = 0;
for (const [sid, { issue, harness }] of sessions) {
  const t = tickets.get(issue) || { id: issue, sessions: 0, withTranscript: 0, opencode: 0, tokens: 0, outputTokens: 0, first: null };
  t.sessions++;
  if (harness === 'opencode') t.opencode++;
  const dir = join(root, `-Users-work-development-simple-dispatcher-workspaces-${sid}`);
  const main = join(dir, `${sid}.jsonl`);
  if (existsSync(main)) {
    found++; t.withTranscript++;
    const files = [main];
    const sub = join(dir, sid, 'subagents');
    if (existsSync(sub)) for (const f of readdirSync(sub)) if (f.endsWith('.jsonl')) files.push(join(sub, f));
    for (const f of files) { const r = tokensOf(f); t.tokens += r.total; t.outputTokens += r.output; if (r.first && (!t.first || r.first < t.first)) t.first = r.first; }
  }
  tickets.set(issue, t);
}
const rows = [...tickets.values()].map((t) => ({ ...t, covered: t.sessions > 0 && t.withTranscript === t.sessions }));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ logs: logs.length, sessions: sessions.size, transcripts: found, rows }, null, 1));
console.log(`sessions ${sessions.size}, with transcript ${found}; tickets ${rows.length}, fully covered ${rows.filter((r) => r.covered).length}`);
