// LIN-3143: byte size, ticket-citation count and imperative count of the prompt-bearing files at the last first-parent commit of each ISO week, from git history alone.
// Usage: node scripts/steady-base-growth.mjs [rev=HEAD] [--json]
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

const rev = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'HEAD';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });

// Groups are summed; a path that does not exist at a snapshot counts 0.
// prompt-templates.js held the template bodies until the 2026-02 split into -defs/-formatters.
export const GROUPS = {
  'worker templates': ['lib/prompt-templates.js', 'lib/prompt-template-defs.js', 'lib/prompt-formatters.js', 'lib/prompt-contract.js'],
  'meta-prompt': ['lib/prompts/meta-prompt-template.js'],
  'brief writer': ['lib/prompts/brief-writer.js'],
  'autopilot kickoff': ['lib/prompts/autopilot-kickoff.js', 'lib/prompts/autopilot-manual.js'],
  'operating manual': ['docs/autopilot-operating-manual.md'],
  'lane + passage prompts': ['docs/worker-lane-prompt.md', 'docs/passage-runner-prompt.md', 'docs/passage-planner-prompt.md', 'docs/runner-prompt.md'],
  'prompt-system.md': ['docs/architecture/prompt-system.md'],
  'CLAUDE.md': ['CLAUDE.md'],
  'proxy instructions': ['lib/proxy-instructions.js'],
};

const TICKET = /\bLIN-\d+\b/g;
const IMPERATIVE = /\b(MUST|NEVER|must not|never|do not|Do not|Do NOT|BLOCKS?|refuse)\b/g;

function snapshots() {
  const lines = git('log', '--first-parent', '--format=%H %cs', rev).trim().split('\n');
  const byWeek = new Map(); // newest first, so the first seen per week is the week's last commit
  for (const l of lines) {
    const [sha, day] = l.split(' ');
    const d = new Date(day + 'T00:00:00Z');
    const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const wk = monday.toISOString().slice(0, 10);
    if (!byWeek.has(wk)) byWeek.set(wk, { sha, day });
  }
  return [...byWeek.entries()].reverse().map(([week, v]) => ({ week, ...v }));
}

function measure(sha, paths) {
  let bytes = 0, tickets = new Set(), imperatives = 0;
  for (const p of paths) {
    let text;
    try { text = git('show', `${sha}:${p}`); } catch { continue; }
    bytes += Buffer.byteLength(text);
    for (const m of text.match(TICKET) || []) tickets.add(m);
    imperatives += (text.match(IMPERATIVE) || []).length;
  }
  return { bytes, tickets: tickets.size, imperatives };
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
const out = !isMain ? [] : snapshots().map((s) => ({
  ...s,
  groups: Object.fromEntries(Object.entries(GROUPS).map(([g, ps]) => [g, measure(s.sha, ps)])),
}));

if (!isMain) { /* imported for GROUPS only */ }
else if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else {
  const names = Object.keys(GROUPS);
  console.log(['week', 'sha', ...names.map((n) => `${n} (KB/LIN-ids/imperatives)`)].join('\t'));
  for (const r of out) console.log([r.week, r.sha.slice(0, 8), ...names.map((n) => {
    const g = r.groups[n]; return `${(g.bytes / 1024).toFixed(1)}/${g.tickets}/${g.imperatives}`;
  })].join('\t'));
}
