// LIN-3166: six size-and-risk classifiers, fixed before any outcome was read, and the per-ticket features they need (paths touched from git at the scorecard's heads; ticket text from the tracker snapshot).
// Usage: node scripts/survey-proportional-classifiers.mjs [--git data/survey-effort/git.json] [--tracker data/survey/reliability-tracker.json] [--sd ../simple-dispatcher] [--out data/survey-proportional/features.json]
// Committed before the backtest joins any outcome (escapes, fixes, follow-ups, effort): the rules below are not tuned afterwards.
// A ticket's change is survey-effort-git.mjs's: the union of first-parent merges on origin/main since June whose branch or merged
// subjects carry its LIN-id. Git is read at the heads survey-effort-git.mjs recorded, so the population is the scorecard's.
// Merge-time rules (M*) read the paths and lines a change touched. Plan-time rules (P*) read only the ticket's title and
// description as the tracker holds them now, and the repository paths that text names.
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// ---- Path classes ------------------------------------------------------------------------------------------------------
// Tests, docs and noise exactly as survey-effort-git.mjs classes them (copied: importing that script would re-run it).
export const isTest = (p) => /(^|\/)(tests?|e2e|__tests__|fixtures)\//.test(p) || /\.(test|spec)\.[mc]?js$/.test(p);
export const isDoc = (p) => /\.md$/.test(p) || /^docs\//.test(p) || /(^|\/)(prototypes|plans|content)\//.test(p);
export const isNoise = (p) => /(^|\/)package-lock\.json$/.test(p) || /\.(svg|png|jpg|snap)$/.test(p);
// Text an agent is told to read: CLAUDE.md files, the architecture docs, agent/skill config. A subset of docs.
export const isProcessText = (p) => /(^|\/)(CLAUDE|AGENTS)\.md$/.test(p) || /^docs\/architecture\//.test(p) || /^\.claude\//.test(p);
// Production categories named in LIN-3166. A production path can sit in several.
export const CATEGORIES = {
  auth: (p) => /(auth|credential|token|oauth|secret|crypto|security|permission|grant|encrypt|revoke|login|account|password)/i.test(p),
  data: (p) => /(-store\.js$|(^|\/)stores?\/|db-|mongo|migrat|state-store|oplog|local-store|sessions\.json)/i.test(p),
  prompts: (p) => /(^lib\/prompts\/|(^|\/)prompt[^/]*\.js$|template|proxy-preamble|meta-prompt|kickoff)/i.test(p),
  ci: (p) => /^\.github\//.test(p) || /(^|\/)(package\.json|playwright[^/]*\.config\.js)$/.test(p),
  ui: (p) => /^(public\/|lib\/components\/|lib\/render[^/]*\.js$|views\/)|\.css$/.test(p),
};
// Paths an invariant in the repo's CLAUDE.md (at the scorecard heads) names or governs.
export const INVARIANT_PATHS = {
  LinearViewer: [
    /^CLAUDE\.md$/, // "This file must stay ≤110 lines / ≤12,000 bytes"
    /^lib\/prompt-templates\.js$/, /^lib\/openrouter\.js$/, /^lib\/prompts\/meta-prompt-template\.js$/, // update BOTH prompt paths
    /^docs\/architecture\//, // citations must resolve; source-map roster checked at test time
    /^\.github\/workflows\//, // ci-success must be green
    /^lib\/account-workspace-store\.js$/, // workspace owner = role:'owner' edge
    /^lib\/proxy-tokens\.js$/, /^routes\/proxy-runner[^/]*\.js$/, /^routes\/proxy-tokens-admin\.js$/, // runner copies
    /^lib\/scheduler[^/]*\.js$/, // registered-job roster
    /^lib\/email-[^/]*\.js$/, /^routes\/email-auth\.js$/, // email is an identity type
  ],
  'simple-dispatcher': [
    /^CLAUDE\.md$/,
    /^state-store\.js$/, // never hold a snapshot across an await (LIN-459)
    /^watch-restart\.sh$/, // the watcher does not relaunch a dead dispatcher
    /^(hook|phases|dispatcher)\.js$/, // the hook substrate and its phase machine
  ],
};
export const touchesInvariant = (repo, p) => (INVARIANT_PATHS[repo] || []).some((re) => re.test(p));
export const RISKY = ['auth', 'data', 'prompts', 'ci'];

// Thresholds for "small": at most SMALL_LINES production lines (added + deleted) in at most SMALL_FILES production files.
// 50 is the scorecard's own size-bin edge (survey-scorecard.mjs's sizeBin: 1-49 | 50-299).
export const SMALL_LINES = 49;
export const SMALL_FILES = 3;

// ---- Merge-time features -----------------------------------------------------------------------------------------------
export function mergeFeatures(files) { // files: [{ repo, path, lines }]
  const f = { prodLines: 0, prodFiles: 0, testLines: 0, docLines: 0, processText: false, cats: {}, invariant: false, sd: false, paths: 0 };
  for (const { repo, path, lines } of files) {
    if (isNoise(path)) continue;
    f.paths++;
    if (touchesInvariant(repo, path)) f.invariant = true;
    if (isTest(path)) { f.testLines += lines; continue; }
    if (isDoc(path)) { f.docLines += lines; if (isProcessText(path)) f.processText = true; continue; }
    f.prodLines += lines; f.prodFiles++;
    if (repo === 'simple-dispatcher') f.sd = true;
    for (const [k, test] of Object.entries(CATEGORIES)) if (test(path)) f.cats[k] = true;
    if (repo === 'LinearViewer' && !Object.keys(CATEGORIES).some((k) => CATEGORIES[k](path))) f.cats.serverLib = true;
  }
  return f;
}

// ---- Plan-time features ------------------------------------------------------------------------------------------------
// Repository paths a ticket's text names: a token with a slash or a file extension we recognise.
const PATH_RE = /(?:^|[\s`'"(\[])((?:\.?[\w.-]+\/)*[\w.-]+\.(?:m?js|cjs|md|json|css|html|sh|ya?ml|toml))(?=$|[\s`'"),:;\].!?])|(?:^|[\s`'"(\[])((?:[\w.-]+\/)+)(?=$|[\s`'"),:;\].!?])/g;
export function namedPaths(text) {
  const out = new Set(); let m;
  PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(text || ''))) { const p = (m[1] || m[2]).replace(/^\.\//, ''); if (!/^https?:|^\w+\.\w+\.\w+/.test(p) && !/^\d/.test(p) && !/^[A-Z][a-z]+\.js$/.test(p)) out.add(p); }
  return [...out];
}
// Words in a ticket's text that name a risky surface. Fixed list; matched on word starts, case-insensitive.
export const RISK_WORDS = /\b(auth\w*|oauth|credential\w*|token\w*|secret\w*|security|permission\w*|grant\w*|encrypt\w*|revoke\w*|login|password\w*|migrat\w*|schema|database|mongo\w*|data loss|state-store|sessions\.json|invariant\w*|meta-prompt|prompt template\w*)\b/i;
export function planFeatures(title, description) {
  const text = `${title || ''}\n${description || ''}`;
  const paths = namedPaths(text);
  const cls = paths.map((p) => (isTest(p) ? 'test' : isDoc(p) ? 'doc' : 'prod'));
  const prodPaths = paths.filter((_, i) => cls[i] === 'prod');
  const risky = prodPaths.some((p) => RISKY.some((k) => CATEGORIES[k](p)) || touchesInvariant('LinearViewer', p) || touchesInvariant('simple-dispatcher', p));
  return {
    named: paths.length, namedDocTest: cls.filter((c) => c !== 'prod').length, namedProd: prodPaths.length,
    namedRisky: risky || paths.some((p) => isProcessText(p)), riskWords: RISK_WORDS.test(text), bug: false,
  };
}

// ---- The six classifiers -----------------------------------------------------------------------------------------------
// Each returns true when the ticket would be routed LIGHT.
export const CLASSIFIERS = [
  { key: 'M1', when: 'merge', name: 'docs and tests only',
    rule: 'no production lines (every path is docs or tests)',
    light: (m) => m.prodLines === 0 },
  { key: 'M2', when: 'merge', name: 'docs and tests only, no process text',
    rule: 'M1, and touches no CLAUDE.md, AGENTS.md, docs/architecture/ or .claude/ file',
    light: (m) => m.prodLines === 0 && !m.processText },
  { key: 'M3', when: 'merge', name: 'small and low-risk paths',
    rule: `≤${SMALL_LINES} production lines in ≤${SMALL_FILES} files, no auth/data/prompts/CI path, no CLAUDE.md-invariant path, no process text`,
    light: (m) => m.prodLines <= SMALL_LINES && m.prodFiles <= SMALL_FILES && !RISKY.some((k) => m.cats[k]) && !m.invariant && !m.processText },
  { key: 'M4', when: 'merge', name: 'small by size alone',
    rule: `≤${SMALL_LINES} production lines in ≤${SMALL_FILES} files, any path`,
    light: (m) => m.prodLines <= SMALL_LINES && m.prodFiles <= SMALL_FILES },
  { key: 'P1', when: 'plan', name: 'plan-time: names only docs or tests',
    rule: 'the ticket text names at least one path, every named path is docs or tests, and no risk word appears',
    light: (_, p) => p.named > 0 && p.namedProd === 0 && !p.namedRisky && !p.riskWords },
  { key: 'P2', when: 'plan', name: 'plan-time: names no risky path',
    rule: 'the ticket text names at least one path, none is an auth/data/prompts/CI, invariant or process-text path, and no risk word appears',
    light: (_, p) => p.named > 0 && !p.namedRisky && !p.riskWords },
];

// ---- Feature extraction (run as a script) ------------------------------------------------------------------------------
const main = () => {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const gitSnap = JSON.parse(readFileSync(arg('--git', 'data/survey-effort/git.json'), 'utf8'));
  const tracker = JSON.parse(readFileSync(arg('--tracker', 'data/survey/reliability-tracker.json'), 'utf8'));
  const out = arg('--out', 'data/survey-proportional/features.json');
  const since = gitSnap.since || '2026-06-01';
  const repos = { LinearViewer: resolve('.'), 'simple-dispatcher': resolve(arg('--sd', '../simple-dispatcher')) };
  const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });

  // Same attribution rule as survey-effort-git.mjs, at its recorded heads.
  const files = new Map();
  for (const [repo, cwd] of Object.entries(repos)) {
    const head = gitSnap.heads[repo];
    const log = git(cwd, ['log', head, '--first-parent', `--since=${since}`, '--format=%H%x09%P%x09%cI%x09%s']).trim().split('\n').filter(Boolean);
    for (const line of log) {
      const [sha, parents, , subject] = line.split('\t');
      const ps = parents.split(' ');
      let text = subject;
      if (ps.length > 1) text += '\n' + git(cwd, ['log', '--format=%s', `${ps[0]}..${ps[1]}`]);
      const ids = [...new Set((text.match(/\blin-\d+\b/gi) || []).map((x) => x.toUpperCase()))];
      const branchIds = subject.match(/\blin-\d+\b/gi);
      const id = (branchIds ? branchIds[0] : ids[0])?.toUpperCase();
      if (!id) continue;
      const num = git(cwd, ['diff', '--numstat', ps[0], sha]).trim().split('\n').filter(Boolean);
      const list = files.get(id) || [];
      for (const n of num) { const [a, d, p] = n.split('\t'); if (a === '-') continue; list.push({ repo, path: p, lines: +a + +d }); }
      files.set(id, list);
    }
  }
  const text = new Map(tracker.list.map((t) => [t.identifier, t]));
  const rows = gitSnap.rows.map((r) => {
    const fs = files.get(r.id) || [];
    const merge = mergeFeatures(fs);
    const t = text.get(r.id);
    const plan = t ? planFeatures(t.title, t.description) : null;
    if (plan) plan.bug = (t.labels || []).includes('Bug');
    const light = Object.fromEntries(CLASSIFIERS.map((c) => [c.key, c.when === 'plan' && !plan ? null : c.light(merge, plan)]));
    return { id: r.id, repos: r.repos, merge, plan, light, paths: [...new Set(fs.filter((f) => !isNoise(f.path)).map((f) => `${f.repo === 'simple-dispatcher' ? 'sd:' : ''}${f.path}`))] };
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ heads: gitSnap.heads, since, classifiers: CLASSIFIERS.map(({ light, ...c }) => c), rows }, null, 1));
  // Agreement check against survey-effort-git.mjs's own production-line count (same rule, so it should match exactly).
  const gitById = new Map(gitSnap.rows.map((r) => [r.id, r]));
  const mismatch = rows.filter((r) => gitById.get(r.id).prodLines !== r.merge.prodLines).length;
  console.log(`tickets=${rows.length}; prodLines mismatches vs git.json: ${mismatch}; without tracker text: ${rows.filter((r) => !r.plan).length}`);
  for (const c of CLASSIFIERS) console.log(`${c.key} ${c.name}: light ${rows.filter((r) => r.light[c.key]).length}`);
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
