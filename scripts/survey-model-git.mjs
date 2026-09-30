// LIN-3165: per-change writer tier (from Co-Authored-By trailers), production files, merge dates and later same-file fix commits since January, in LinearViewer and simple-dispatcher.
// Usage: node scripts/survey-model-git.mjs [--since 2026-01-01] [--sd ../simple-dispatcher] [--out data/survey-model/git.json]
// A change is survey-effort-git.mjs's: the union of first-parent commits on origin/main whose branch name or merged subjects carry
// a LIN-id, credited to the id the branch/subject names first. Its writer tier is the tier most of its commits' trailers name
// (frontier: Opus or Fable; mid: Sonnet; cheap: Haiku); a commit with no model trailer, or a bare "Claude" one, is unattributed —
// agent sessions commit under the operator's git identity, so an untrailered commit may be a cheap-tier (OpenRouter) session or a
// person. A later fix is a first-parent commit whose subjects read as a fix (fix|bug|regress|revert|hotfix|broken) and that
// touches one of the change's production files within 60 days after its last merge (whole-life cost counts 30; the curve runs to 60), credited to a different ticket (or none).
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const since = arg('--since', '2026-01-01');
const out = arg('--out', 'data/survey-model/git.json');
const repos = { LinearViewer: resolve('.'), 'simple-dispatcher': resolve(arg('--sd', '../simple-dispatcher')) };
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30 });
const DAY = 86400000;
// Path classes and risk, as survey-effort-git.mjs defines them (copied: importing that script runs it).
const isTest = (p) => /(^|\/)(tests?|e2e|__tests__|fixtures)\//.test(p) || /\.(test|spec)\.[mc]?js$/.test(p);
const isDoc = (p) => /\.md$/.test(p) || /^docs\//.test(p) || /(^|\/)(prototypes|plans|content)\//.test(p);
const riskOf = (ps) => (!ps.length ? 'docs/tests only' : ps.some((p) => /(auth|credential|token|oauth|secret|crypto|security|permission|grant|session-store|connection|migrat|encrypt|revoke|refresh|login|account)/i.test(p)) ? 'high'
  : ps.every((p) => /^(public\/|lib\/components\/|lib\/render[^/]*\.js$|views\/)|\.css$/.test(p)) ? 'UI only' : 'rest');
const isNoise = (p) => /(^|\/)package-lock\.json$/.test(p) || /\.(svg|png|jpg|snap)$/.test(p);

export const tierOfModelName = (s) => (/opus|fable/i.test(s) ? 'frontier' : /sonnet/i.test(s) ? 'mid' : /haiku/i.test(s) ? 'cheap' : null);
// Area: where most of a change's production lines sit.
export const areaOf = (repo, p) => (repo === 'simple-dispatcher' ? 'runner' : /^(public\/|views\/|lib\/components\/|lib\/render)|\.css$/.test(p) ? 'UI' : /^routes\//.test(p) ? 'routes' : /^lib\/prompts\//.test(p) ? 'prompts' : /^lib\//.test(p) ? 'lib' : 'other');
const FIXY = /\b(fix|fixes|fixed|bug|regress\w*|revert\w*|hotfix|broken)\b/i;

const tickets = new Map();
const commitWeek = {}; // ISO week -> repo -> tier -> commits (every commit a first-parent merge or push carries)
const mondayOf = (iso) => { const d = new Date(iso); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7)); return m.toISOString().slice(0, 10); };
const commits = []; // first-parent commits with their files, for the later-fix join
for (const [repo, cwd] of Object.entries(repos)) {
  const log = git(cwd, ['log', 'origin/main', '--first-parent', `--since=${since}`, '--format=%H%x09%P%x09%cI%x09%s']).trim().split('\n').filter(Boolean);
  for (const line of log) {
    const [sha, parents, date, subject] = line.split('\t');
    const ps = parents.split(' ');
    if (!ps[0]) continue; // the root commit
    const range = ps.length > 1 ? `${ps[0]}..${ps[1]}` : `${ps[0]}..${sha}`;
    const inner = git(cwd, ['log', '--format=%x00%s%x09%(trailers:key=Co-Authored-By,valueonly,separator=;)', range]).split('\x00').filter(Boolean).map((c) => { const [s, t = ''] = c.trim().split('\t'); return { s, t }; });
    for (const c of inner.length ? inner : [{ t: '' }]) { const w = ((commitWeek[mondayOf(date)] ||= {})[repo] ||= {}); const t = tierOfModelName(c.t) || 'unattributed'; w[t] = (w[t] || 0) + 1; }
    const text = [subject, ...inner.map((c) => c.s)].join('\n');
    const ids = [...new Set((text.match(/\blin-\d+\b/gi) || []).map((x) => x.toUpperCase()))];
    const branchIds = subject.match(/\blin-\d+\b/gi);
    const id = (branchIds ? branchIds[0] : ids[0])?.toUpperCase() || null;
    const files = git(cwd, ['diff', '--numstat', ps[0], sha]).trim().split('\n').filter(Boolean).map((n) => { const [a, d, p] = n.split('\t'); return { a, d, p }; }).filter((f) => f.a !== '-' && !isNoise(f.p));
    const prod = files.filter((f) => !isTest(f.p) && !isDoc(f.p));
    commits.push({ repo, sha: sha.slice(0, 8), at: date, id, fixy: FIXY.test(text), prodPaths: prod.map((f) => `${repo}:${f.p}`), prodLines: prod.reduce((s, f) => s + +f.a + +f.d, 0) });
    if (!id) continue;
    const t = tickets.get(id) || { id, repos: {}, merges: [], writer: { frontier: 0, mid: 0, cheap: 0, unattributed: 0 }, prod: 0, test: 0, doc: 0, prodFiles: new Map() };
    t.repos[repo] = (t.repos[repo] || 0) + 1;
    t.merges.push({ repo, sha: sha.slice(0, 8), date });
    for (const c of inner.length ? inner : [{ t: '' }]) t.writer[tierOfModelName(c.t) || 'unattributed']++;
    for (const f of files) {
      const lines = +f.a + +f.d;
      if (isTest(f.p)) t.test += lines; else if (isDoc(f.p)) t.doc += lines;
      else { t.prod += lines; const k = `${repo}:${f.p}`; t.prodFiles.set(k, (t.prodFiles.get(k) || 0) + lines); }
    }
    tickets.set(id, t);
  }
}

const rows = [...tickets.values()].map((t) => {
  const dates = t.merges.map((m) => m.date).sort();
  const last = Date.parse(dates.at(-1)); const first = Date.parse(dates[0]);
  const prodPaths = [...t.prodFiles.keys()];
  const byArea = {};
  for (const [k, n] of t.prodFiles) { const [repo, ...rest] = k.split(':'); const a = areaOf(repo, rest.join(':')); byArea[a] = (byArea[a] || 0) + n; }
  const area = Object.entries(byArea).sort((a, b) => b[1] - a[1])[0]?.[0] || 'docs/tests only';
  const w = t.writer; const attributed = w.frontier + w.mid + w.cheap;
  const writerTier = attributed ? Object.entries({ frontier: w.frontier, mid: w.mid, cheap: w.cheap }).sort((a, b) => b[1] - a[1])[0][0] : 'unattributed';
  // Later fixes: fix-looking first-parent commits touching this change's production files, 0–60 days after its last merge, not its own.
  const own = new Set(prodPaths);
  const laterFixes = commits.filter((c) => c.fixy && c.id !== t.id && Date.parse(c.at) > last && Date.parse(c.at) - last <= 60 * DAY && c.prodPaths.some((p) => own.has(p)))
    .map((c) => ({ repo: c.repo, sha: c.sha, id: c.id, days: +((Date.parse(c.at) - last) / DAY).toFixed(1), prodLines: c.prodLines, shared: c.prodPaths.filter((p) => own.has(p)).length }));
  // A re-landing: a merge for the same ticket three or more days after its first merge (the nearest git sign of a reopen).
  const relanded = dates.some((d) => Date.parse(d) - first >= 3 * DAY);
  return {
    id: t.id, repos: Object.keys(t.repos), merges: t.merges.length, firstMerge: dates[0], lastMerge: dates.at(-1), relanded,
    writer: t.writer, writerTier, writerShare: attributed ? +(Math.max(w.frontier, w.mid, w.cheap) / attributed).toFixed(2) : null,
    prodLines: t.prod, testLines: t.test, docLines: t.doc, prodFiles: prodPaths.length, risk: riskOf(prodPaths.map((p) => p.split(':').slice(1).join(':'))), area,
    laterFixes,
  };
}).sort((a, b) => +a.id.slice(4) - +b.id.slice(4));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ since, generatedAt: new Date().toISOString(), heads: Object.fromEntries(Object.entries(repos).map(([r, c]) => [r, git(c, ['rev-parse', '--short=8', 'origin/main']).trim()])), commitWeek, rows }, null, 1));
const by = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
console.log(`tickets=${rows.length} since ${since}`, 'writerTier', by('writerTier'), 'area', by('area'), 'withLaterFix', rows.filter((r) => r.laterFixes.length).length);
