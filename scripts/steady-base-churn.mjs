// LIN-3143: per first-parent commit, bytes of prompt text added vs removed (word-level diff) in the prompt-bearing files, and the ticket citations that left them.
// Usage: node scripts/steady-base-churn.mjs [rev=HEAD] [--json]
import { execFileSync } from 'child_process';
import { GROUPS } from './steady-base-growth.mjs';

const rev = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'HEAD';
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
// Prompt text only: everything an agent is handed, not prompt-system.md, CLAUDE.md or the proxy instructions.
const PATHS = [...GROUPS['worker templates'], ...GROUPS['meta-prompt'], ...GROUPS['autopilot kickoff'], ...GROUPS['operating manual'], ...GROUPS['lane + passage prompts']];

const commits = git(['log', '--first-parent', '--format=%H %cs %s', rev, '--', ...PATHS]).trim().split('\n').reverse();
const rows = [];
for (const c of commits) {
  const [sha, day, ...subj] = c.split(' ');
  const diff = git(['diff', '--word-diff=porcelain', '--unified=0', `${sha}^1`, sha, '--', ...PATHS]);
  let added = 0, removed = 0; const tAdded = new Set(), tRemoved = new Set();
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) { added += Buffer.byteLength(line) - 1; for (const t of line.match(/\bLIN-\d+\b/g) || []) tAdded.add(t); }
    else if (line.startsWith('-')) { removed += Buffer.byteLength(line) - 1; for (const t of line.match(/\bLIN-\d+\b/g) || []) tRemoved.add(t); }
  }
  rows.push({ sha: sha.slice(0, 8), day, subject: subj.join(' ').slice(0, 90), added, removed, ticketsRemoved: [...tRemoved].filter((t) => !tAdded.has(t)) });
}
// Citations present at some commit and absent at rev: the only direct trace of a rule leaving.
const at = (sha) => new Set(PATHS.flatMap((p) => { try { return git(['show', `${sha}:${p}`]).match(/\bLIN-\d+\b/g) || []; } catch { return []; } }));
const head = at(rev); const ever = new Set();
for (const r of rows) for (const t of r.ticketsRemoved) ever.add(t);
const gone = [...ever].filter((t) => !head.has(t));

const totals = { commits: rows.length, added: rows.reduce((s, r) => s + r.added, 0), removed: rows.reduce((s, r) => s + r.removed, 0), netNegative: rows.filter((r) => r.removed > r.added).length, headCitations: head.size, citationsGone: gone };
if (process.argv.includes('--json')) console.log(JSON.stringify({ totals, rows }));
else {
  for (const r of rows.filter((r) => r.removed > r.added && r.removed - r.added > 500)) console.log(`${r.day} ${r.sha} +${r.added} -${r.removed}  ${r.subject}`);
  console.log(JSON.stringify(totals));
}
