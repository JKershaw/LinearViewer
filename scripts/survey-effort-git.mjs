// LIN-3148: per-ticket change size (production / tests / docs lines and files) and risk class from first-parent merges since June, in LinearViewer and simple-dispatcher.
// Usage: node scripts/survey-effort-git.mjs [--since 2026-06-01] [--sd ../simple-dispatcher] [--out data/survey-effort/git.json]
// A ticket's change is the union of every first-parent commit on origin/main whose branch name or merged subjects carry its
// LIN-id. Lines are added + deleted. Risk class is the highest class of any production path it touches (see RISK below).
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const since = arg('--since', '2026-06-01');
const out = arg('--out', 'data/survey-effort/git.json');
const repos = { LinearViewer: resolve('.'), 'simple-dispatcher': resolve(arg('--sd', '../simple-dispatcher')) };

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });

// Path classes. Tests and docs are counted beside production, never inside it.
export const isTest = (p) => /(^|\/)(tests?|e2e|__tests__|fixtures)\//.test(p) || /\.(test|spec)\.[mc]?js$/.test(p);
export const isDoc = (p) => /\.md$/.test(p) || /^docs\//.test(p) || /(^|\/)(prototypes|plans|content)\//.test(p);
const isNoise = (p) => /(^|\/)package-lock\.json$/.test(p) || /\.(svg|png|jpg|snap)$/.test(p);
// Risk, highest first. high: credentials, auth, tokens, sessions, security, data migration. low: UI-only surfaces.
// Everything else in production is "rest". A ticket with no production lines is "docs/tests only".
export const RISK = [
  ['high', /(auth|credential|token|oauth|secret|crypto|security|permission|grant|session-store|connection|migrat|encrypt|revoke|refresh|login|account)/i],
  ['low', /^(public\/|lib\/components\/|lib\/render[^/]*\.js$|views\/)|\.css$/],
];
export function riskOf(prodPaths) {
  if (!prodPaths.length) return 'docs/tests only';
  if (prodPaths.some((p) => RISK[0][1].test(p))) return 'high';
  if (prodPaths.every((p) => RISK[1][1].test(p))) return 'UI only';
  return 'rest';
}

const tickets = new Map();
for (const [repo, cwd] of Object.entries(repos)) {
  const log = git(cwd, ['log', 'origin/main', '--first-parent', `--since=${since}`, '--format=%H%x09%P%x09%cI%x09%s']).trim().split('\n').filter(Boolean);
  for (const line of log) {
    const [sha, parents, date, subject] = line.split('\t');
    const ps = parents.split(' ');
    let text = subject;
    if (ps.length > 1) text += '\n' + git(cwd, ['log', '--format=%s', `${ps[0]}..${ps[1]}`]);
    const ids = [...new Set((text.match(/\blin-\d+\b/gi) || []).map((x) => x.toUpperCase()))];
    // A merge naming several tickets is credited to the one its branch/subject names first.
    const branchIds = subject.match(/\blin-\d+\b/gi);
    const id = (branchIds ? branchIds[0] : ids[0])?.toUpperCase();
    if (!id) continue;
    const num = git(cwd, ['diff', '--numstat', `${ps[0]}`, sha]).trim().split('\n').filter(Boolean);
    const t = tickets.get(id) || { id, repos: {}, merges: [], prod: 0, test: 0, doc: 0, prodFiles: new Set(), testFiles: new Set(), docFiles: new Set() };
    t.repos[repo] = (t.repos[repo] || 0) + 1;
    t.merges.push({ repo, sha: sha.slice(0, 8), date });
    for (const n of num) {
      const [a, d, p] = n.split('\t');
      if (a === '-' || isNoise(p)) continue;
      const lines = +a + +d;
      if (isTest(p)) { t.test += lines; t.testFiles.add(p); }
      else if (isDoc(p)) { t.doc += lines; t.docFiles.add(p); }
      else { t.prod += lines; t.prodFiles.add(`${repo}:${p}`); }
    }
    tickets.set(id, t);
  }
}

const rows = [...tickets.values()].map((t) => {
  const prodPaths = [...t.prodFiles].map((p) => p.split(':').slice(1).join(':'));
  const last = t.merges.map((m) => m.date).sort().at(-1);
  return {
    id: t.id, repos: Object.keys(t.repos), merges: t.merges.length, lastMerge: last, month: last.slice(0, 7),
    prodLines: t.prod, testLines: t.test, docLines: t.doc,
    prodFiles: t.prodFiles.size, testFiles: t.testFiles.size, docFiles: t.docFiles.size,
    risk: riskOf(prodPaths),
  };
}).sort((a, b) => +a.id.slice(4) - +b.id.slice(4));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ since, generatedAt: new Date().toISOString(), heads: Object.fromEntries(Object.entries(repos).map(([r, c]) => [r, git(c, ['rev-parse', '--short=8', 'origin/main']).trim()])), rows }, null, 1));
const by = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
console.log(`tickets=${rows.length} since ${since}`, 'byMonth', by('month'), 'byRisk', by('risk'));
