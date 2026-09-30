// LIN-3166: write one reading digest per light-routed change that a review or plan review sent back (any classifier), for coding what the full process caught on it.
// Usage: node scripts/survey-proportional-digests.mjs [--backtest data/survey-proportional/backtest.json] [--out data/survey-proportional/digests] [--sd ../simple-dispatcher]
// A digest is the ticket's title and description head, then every comment (leg and verdict from survey-rules-timeline.mjs's
// legOf/verdictOf, body cut at 6,000 characters) interleaved with every first-parent commit in either repo that names the
// ticket, each commit with its lines by class (prod / test / docs) and marked AFTER FIRST REVIEW when it follows the first code review. Git-ignored output.
// Delete the digests after coding: the unit suite's CLAUDE.md anchor tests scan every .md file in the tree, git-ignored or not.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, resolve } from 'path';
import { legOf, verdictOf } from './survey-rules-timeline.mjs';
import { isTest, isDoc, isNoise } from './survey-proportional-classifiers.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const bt = read(arg('--backtest', 'data/survey-proportional/backtest.json'));
const outDir = arg('--out', 'data/survey-proportional/digests');
const repos = { LinearViewer: resolve('.'), 'simple-dispatcher': resolve(arg('--sd', '../simple-dispatcher')) };
const details = {}; const text = new Map();
for (const p of ['data/survey/reliability-tracker.json', 'data/survey/rules-tickets.json', 'data/survey-proportional/details.json']) if (existsSync(p)) Object.assign(details, read(p).details);
for (const t of read('data/survey/reliability-tracker.json').list) text.set(t.identifier, t);

const ids = [...new Set(bt.results.flatMap((r) => r.lightSentBack.map((x) => x.id)))].sort((a, b) => +a.slice(4) - +b.slice(4));
mkdirSync(outDir, { recursive: true });
for (const id of ids) {
  const d = details[id]; const t = text.get(id);
  const comments = (d.comments || []).map((c, i) => ({ at: c.createdAt, kind: 'comment', i, leg: legOf(c.body || ''), verdict: verdictOf(c.body || ''), body: c.body || '' }));
  const firstReview = comments.find((c) => c.leg === 'review')?.at; // first CODE review
  const commits = [];
  for (const [repo, dir] of Object.entries(repos)) {
    const raw = execFileSync('git', ['-C', dir, 'log', bt.heads[repo], '--since=2026-05-15', '-i', `--grep=\\b${id}\\b`, '--numstat', '--format=%x00%h%x09%cI%x09%s'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    for (const chunk of raw.split('\x00').filter(Boolean)) {
      const [head, ...lines] = chunk.split('\n').filter(Boolean);
      const [sha, at, subject] = head.split('\t');
      const k = { prod: 0, test: 0, docs: 0 };
      const files = [];
      for (const l of lines) { const [a, dd, p] = l.split('\t'); if (a === '-' || isNoise(p)) continue; const n = +a + +dd; const cls = isTest(p) ? 'test' : isDoc(p) ? 'docs' : 'prod'; k[cls] += n; files.push(`${p} (${cls} ${n})`); }
      commits.push({ at, kind: 'commit', repo, sha, subject, k, files });
    }
  }
  const events = [...comments, ...commits].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let s = `# ${id}: ${t?.title || d.title}\n\nLight under: ${bt.results.filter((r) => r.lightIds.includes(id)).map((r) => r.key).join(', ')}\n\n## Description (first 2,500 characters)\n\n${(t?.description || '').slice(0, 2500)}\n\n## Timeline\n\n`;
  for (const e of events) {
    if (e.kind === 'commit') s += `- COMMIT ${e.repo} ${e.sha} ${e.at}${firstReview && Date.parse(e.at) > Date.parse(firstReview) ? ' AFTER FIRST REVIEW' : ''} — ${e.subject} [prod ${e.k.prod}, test ${e.k.test}, docs ${e.k.docs}]\n  files: ${e.files.slice(0, 12).join('; ')}\n`;
    else s += `\n### comment ${e.i} — ${e.at} — leg: ${e.leg}${e.verdict ? `, verdict: ${e.verdict}` : ''}\n\n${e.body.length > 6000 ? e.body.slice(0, 6000) + '\n[… cut at 6,000 characters]' : e.body}\n\n`;
  }
  writeFileSync(join(outDir, `${id}.md`), s);
}
console.log(`digests: ${ids.length} → ${outDir}`);
