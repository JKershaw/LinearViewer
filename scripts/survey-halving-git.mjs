// LIN-3155: every first-parent commit on origin/main since May in LinearViewer and simple-dispatcher, with the ticket it names (survey-effort-git.mjs's rule), its kind (PR merge, squash, direct push), its branch's commit count, and its lines by class and product area.
// Usage: node scripts/survey-halving-git.mjs [--since 2026-05-04] [--sd ../simple-dispatcher] [--out data/survey-halving/git.json]
// Unlike survey-effort-git.mjs this keeps the commits that name no ticket, so product lines landed on main can be counted
// whether or not a ticket claims them. Lines are added + deleted; lockfiles and images are dropped, as there. No proxy calls.
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { GROUPS } from './steady-base-growth.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const since = arg('--since', '2026-05-04');
const out = arg('--out', 'data/survey-halving/git.json');
const repos = { LinearViewer: resolve('.'), 'simple-dispatcher': resolve(arg('--sd', '../simple-dispatcher')) };
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });

// Path classes as survey-effort-git.mjs defines them (copied: that script runs on import).
const isTest = (p) => /(^|\/)(tests?|e2e|__tests__|fixtures)\//.test(p) || /\.(test|spec)\.[mc]?js$/.test(p);
const isDoc = (p) => /\.md$/.test(p) || /^docs\//.test(p) || /(^|\/)(prototypes|plans|content)\//.test(p);
const isNoise = (p) => /(^|\/)package-lock\.json$/.test(p) || /\.(svg|png|jpg|snap)$/.test(p);
const READING = new Set(Object.values(GROUPS).flat());
// Product area of a production path. 'process' is the text and code that tells agents how to work (prompts, templates,
// the proxy's instructions); 'scripts' is tooling, including the survey scripts; 'ui' is survey-effort-git.mjs's UI-only class.
export function areaOf(repo, p) {
  if (READING.has(p) || /^lib\/prompts?\//.test(p) || /prompt-template/.test(p)) return 'process';
  if (/^scripts\//.test(p) || /\.sh$/.test(p)) return 'scripts';
  if (repo === 'simple-dispatcher') return 'runner';
  if (/^(public\/|lib\/components\/|lib\/render[^/]*\.js$|views\/)|\.css$/.test(p)) return 'ui';
  return 'server';
}
// Tier from the trailer text; product names stay in this script and never reach the paper. No trailer: 'none'.
export function tierOf(trailer) {
  if (!trailer) return 'none';
  if (/opus|fable/i.test(trailer)) return 'frontier';
  if (/sonnet/i.test(trailer)) return 'mid';
  if (/haiku|gpt|gemini|glm|qwen|deepseek|kimi|minimax/i.test(trailer)) return 'cheap';
  return 'unstated';
}
export const classOf = (p) => (isTest(p) ? 'test' : isDoc(p) ? 'doc' : 'prod');

const rows = [];
for (const [repo, cwd] of Object.entries(repos)) {
  const log = git(cwd, ['log', 'origin/main', '--first-parent', `--since=${since}`, '--format=%H%x09%P%x09%cI%x09%s']).trim().split('\n').filter(Boolean);
  for (const line of log) {
    const [sha, parents, date, subject] = line.split('\t');
    const ps = parents.split(' ');
    let text = subject; let branchCommits = 1;
    if (ps.length > 1) { const inner = git(cwd, ['log', '--format=%s', `${ps[0]}..${ps[1]}`]); text += '\n' + inner; branchCommits = inner.trim().split('\n').filter(Boolean).length; }
    // Model tier of each commit the change carries, from its Co-Authored-By trailers (a squash keeps every trailer).
    const trailers = git(cwd, ['log', '--format=%(trailers:key=Co-Authored-By,valueonly,separator=%x1f)%x1e', ps.length > 1 ? `${ps[0]}..${ps[1]}` : `${ps[0]}..${sha}`]);
    const tiers = {};
    for (const c of trailers.split('\x1e').map((x) => x.trim()).filter((x, i, a) => i < a.length - 1 || x)) { const t = tierOf(c); tiers[t] = (tiers[t] || 0) + 1; }
    const ids = [...new Set((text.match(/\blin-\d+\b/gi) || []).map((x) => x.toUpperCase()))];
    const branchIds = subject.match(/\blin-\d+\b/gi);
    const ticket = (branchIds ? branchIds[0] : ids[0])?.toUpperCase() || null;
    const kind = ps.length > 1 ? 'merge' : /\(#\d+\)\s*$/.test(subject) ? 'squash' : 'direct';
    const lines = { prod: 0, test: 0, doc: 0 }; const area = {}; let reading = 0;
    const num = git(cwd, ['diff', '--numstat', ps[0], sha]).trim().split('\n').filter(Boolean);
    for (const n of num) {
      const [a, d, p] = n.split('\t');
      if (a === '-' || isNoise(p)) continue;
      const k = classOf(p); const l = +a + +d;
      lines[k] += l;
      if (k === 'prod') { const ar = areaOf(repo, p); area[ar] = (area[ar] || 0) + l; }
      if (READING.has(p)) reading += +a - +d;
    }
    rows.push({ repo, sha: sha.slice(0, 8), date, kind, ticket, branchCommits, tiers, ...lines, area, readingNet: reading, subject: subject.slice(0, 120) });
  }
}

mkdirSync(dirname(out), { recursive: true });
const heads = Object.fromEntries(Object.entries(repos).map(([r, c]) => [r, git(c, ['rev-parse', '--short=8', 'origin/main']).trim()]));
writeFileSync(out, JSON.stringify({ since, generatedAt: new Date().toISOString(), heads, rows }, null, 1));
const by = (f) => rows.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {});
console.log(`commits=${rows.length} since ${since}`, heads, by((r) => `${r.repo}:${r.kind}:${r.ticket ? 'named' : 'unnamed'}`));
