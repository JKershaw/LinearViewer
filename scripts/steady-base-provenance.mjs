// LIN-3143: for every ticket cited in the prompt text at HEAD, classify what its own commits changed: prompt text only, or prompt text plus runtime code (lib/, routes/, server.js outside the prompt files).
// Usage: node scripts/steady-base-provenance.mjs [rev=HEAD] [--json] [--tickets LIN-550,LIN-810,…]  (--tickets replaces the cited set)
import { execFileSync } from 'child_process';
import { GROUPS } from './steady-base-growth.mjs';

const argv = process.argv.slice(2);
const ti = argv.indexOf('--tickets');
const only = ti >= 0 ? argv.splice(ti, 2)[1].split(',') : null;
const rev = argv.find((a) => !a.startsWith('--')) || 'HEAD';
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
const PROMPT = new Set([...GROUPS['worker templates'], ...GROUPS['meta-prompt'], ...GROUPS['autopilot kickoff'], ...GROUPS['operating manual'], ...GROUPS['lane + passage prompts']]);

const cited = new Set(only || []);
if (!only) for (const p of PROMPT) try { for (const t of git(['show', `${rev}:${p}`]).match(/\bLIN-\d+\b/g) || []) cited.add(t); } catch {}

// completion-signals.js holds the strings appended to prompts, so it counts as prompt text.
const isRuntime = (f) => !PROMPT.has(f) && f !== 'lib/completion-signals.js' && /\.(js|mjs)$/.test(f) && (f === 'server.js' || /^(lib|routes)\//.test(f)) && !/^lib\/prompts\//.test(f);
const isTest = (f) => /^tests\//.test(f);
// LIN-3145: prompt bytes are counted once per LANDING commit (the first-parent commit on rev that
// brought the change in), so a merge and the branch commits it lands are not summed twice.
const firstParent = new Set(git(['rev-list', '--first-parent', rev]).trim().split('\n'));
const landing = (sha) => firstParent.has(sha) ? sha
  : git(['rev-list', '--ancestry-path', '--reverse', `${sha}..${rev}`]).trim().split('\n').find((c) => firstParent.has(c)) || sha;
const rows = [];
for (const t of [...cited].sort((a, b) => a.slice(4) - b.slice(4))) {
  // The ticket's OWN commits: its id leads the subject ("LIN-12: …", squash merges) or names the
  // PR branch ("Merge pull request #N from owner/lin-12-…"). A passing mention elsewhere does not count.
  const own = new RegExp(`^${t}\\b|/${t.toLowerCase()}(\\b|-)`);
  const log = git(['log', rev, '-i', '-P', `--grep=\\b${t}\\b`, '--format=%H %s']).trim();
  const files = new Set();
  const shas = (log ? log.split('\n') : []).filter((l) => own.test(l.slice(41))).map((l) => l.slice(0, 40));
  let promptBytesAdded = 0, first = null;
  for (const sha of shas) {
    for (const f of git(['show', '--format=', '--name-only', '-m', '--first-parent', sha]).trim().split('\n')) if (f) files.add(f);
    const day = git(['log', '-1', '--format=%cs', sha]).trim(); if (!first || day < first) first = day;
  }
  for (const sha of new Set(shas.map(landing))) {
    for (const l of git(['diff', '--word-diff=porcelain', '--unified=0', `${sha}^1`, sha, '--', ...PROMPT]).split('\n')) if (l.startsWith('+') && !l.startsWith('+++')) promptBytesAdded += Buffer.byteLength(l) - 1;
  }
  const f = [...files];
  const kind = !f.length ? 'no-commit' : f.some(isRuntime) ? 'prompt+runtime-code' : f.some((x) => PROMPT.has(x) || /^lib\/prompts\//.test(x)) ? 'prompt-only' : 'other';
  rows.push({ ticket: t, first, commits: shas.length, promptBytesAdded, kind, runtime: f.filter(isRuntime).length, tests: f.filter(isTest).length, promptFiles: f.filter((x) => PROMPT.has(x)).length });
}
const tally = rows.reduce((a, r) => ((a[r.kind] = (a[r.kind] || 0) + 1), a), {});
if (process.argv.includes('--json')) console.log(JSON.stringify({ tally, rows }));
else { for (const r of rows) console.log(`${r.ticket.padEnd(9)} ${String(r.first).padEnd(10)} +${String(r.promptBytesAdded).padStart(6)}B ${r.kind.padEnd(20)} runtime=${r.runtime} tests=${r.tests} prompt=${r.promptFiles}`); console.log(JSON.stringify(tally)); }
