// LIN-3189: checks every tool call the replay's implementer, reviewer and close-out made against the pre-registered fences (no git past HEAD, no remote, no proxy or HTTP call, no read of the live clones).
// Usage: node scripts/survey-replay-fences.mjs --subagents <replay session's subagents dir> [--out data/survey-replay/fences.json]
// A call is flagged when its input matches one of the patterns below. Route strings inside code an agent writes match the proxy pattern
// too, so a flag in an Edit, Write or heredoc body is listed as "in written code", not as a breach. No proxy calls.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const subDir = arg('--subagents');
if (!subDir) throw new Error('--subagents is required');
const out = arg('--out', 'data/survey-replay/fences.json');
const FENCES = {
  pastHead: /--all\b|origin\/|git\s+(reflog|branch|rev-list|stash\s+list)|git\s+(log|show|diff)\s+[^\n|;&]*\b[0-9a-f]{7,40}\.\./i,
  remote: /git\s+(fetch|push|pull)\b|(^|[;&|]\s*)gh\s/i,
  service: /curl\s|wget\s|HARBOUR_LOCAL|api\/proxy/i,
  liveClone: /\/development\/(simple-dispatcher|LinearViewer)\b|\/simple-dispatcher-workspaces\/(?!480e1ef6)/,
  subagent: /^(Agent|Task)$/,
};
const rows = []; let calls = 0;
for (const f of readdirSync(subDir).filter((x) => x.endsWith('.jsonl'))) {
  const lines = readFileSync(join(subDir, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const first = lines.find((e) => e.type === 'user'); const c = first?.message?.content;
  const m = (typeof c === 'string' ? c : (c || []).map((x) => x.text || '').join('')).match(/^\[replay (LIN-\d+) (implementer|reviewer|close-out)\]/);
  if (!m) continue;
  for (const e of lines) if (e.type === 'assistant') for (const b of e.message.content || []) {
    if (b.type !== 'tool_use') continue;
    calls++;
    const cmd = String(b.input?.command ?? ''); const body = JSON.stringify(b.input);
    for (const [fence, re] of Object.entries(FENCES)) {
      const hit = fence === 'subagent' ? re.test(b.name) : re.exec(body);
      if (!hit) continue;
      // Is the match inside text the agent writes (an Edit/Write body or a heredoc), rather than a command it runs?
      const written = /^(Edit|Write|MultiEdit)$/.test(b.name) || (/<<\s*'?EOF/.test(cmd) && cmd.indexOf(hit[0] ?? '') > cmd.search(/<<\s*'?EOF/));
      rows.push({ id: m[1], role: m[2], tool: b.name, fence, written, excerpt: body.slice(Math.max(0, (hit.index ?? 0) - 60), (hit.index ?? 0) + 80) });
    }
  }
}
const breaches = rows.filter((r) => !r.written);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ calls, flagged: rows.length, breaches }, null, 1));
console.log(`tool calls ${calls}; flagged ${rows.length}; in written code ${rows.length - breaches.length}; breaches ${breaches.length}`);
for (const b of breaches) console.log(b.id, b.role, b.fence, b.excerpt);
