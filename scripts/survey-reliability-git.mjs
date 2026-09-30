// LIN-3149: per month and per repo, from git history plus the GitHub snapshot: merged PRs, reverts, hotfix PRs, red CI on main, and fix-follow-ups to a PR's production files within 14 and 30 days.
// Usage: node scripts/survey-reliability-git.mjs [--github data/survey/reliability-github.json] [--tracker data/survey/reliability-tracker.json] [--sd ../simple-dispatcher] [--json]
// Needs both clones fetched: it reads origin/main of LinearViewer (this checkout) and of simple-dispatcher (--sd).
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const here = resolve(new URL('..', import.meta.url).pathname);

export const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
export const REPO_LABEL = { LinearViewer: 'LinearViewer (Harbour)', 'simple-dispatcher': 'simple-dispatcher' };

// Production code, as steady-base-code.mjs defines it for LinearViewer; for simple-dispatcher, the top-level modules.
export const isProd = {
  LinearViewer: (p) => /\.(js|mjs)$/.test(p) && (p === 'server.js' || /^(lib|routes)\//.test(p) || (/^public\//.test(p) && !/vendor|\.min\./.test(p))),
  'simple-dispatcher': (p) => /^[^/]+\.js$/.test(p) && !/^e2e-/.test(p),
};
// "Says fix or regression" (LIN-3149's wording), whole words only.
export const FIX = /\b(fix|fixes|fixed|fixing|regression|regressed|regresses|hotfix|broke|broken|revert|reverts|reverted)\b/i;
export const HOTFIX = /\bhot-?fix\b/i;
export const REVERT = /^revert\b|^LIN-\d+: revert\b/i;
export const ticketOf = (s) => (s.match(/\bLIN-(\d+)\b/i) || [])[0]?.toUpperCase() || null;

const month = (iso) => iso.slice(0, 7);
const DAY = 86400000;

export function load() {
  const github = JSON.parse(readFileSync(arg('--github', 'data/survey/reliability-github.json'), 'utf8'));
  const trackerPath = arg('--tracker', 'data/survey/reliability-tracker.json');
  const tracker = existsSync(trackerPath) ? JSON.parse(readFileSync(trackerPath, 'utf8')) : { list: [] };
  const dirs = { LinearViewer: here, 'simple-dispatcher': resolve(arg('--sd', resolve(here, '../simple-dispatcher'))) };
  return { github, tracker, dirs };
}

// First-parent commits on origin/main with their production files.
function mainCommits(dir, repo) {
  const out = execFileSync('git', ['-C', dir, 'log', 'origin/main', '--first-parent', '-m', '--name-only', '--format=%x00%H%x09%ct%x09%s'],
    { encoding: 'utf8', maxBuffer: 1 << 30 });
  const seen = new Set();
  return out.split('\x00').filter(Boolean).map((chunk) => {
    const [head, ...files] = chunk.split('\n').filter(Boolean);
    const [sha, ct, subject] = head.split('\t');
    return { sha, at: new Date(ct * 1000).toISOString(), subject, prod: files.filter(isProd[repo]) };
  }).filter((c) => !seen.has(c.sha) && seen.add(c.sha)).reverse();
}

export function measure({ github, tracker, dirs }) {
  const titles = new Map(tracker.list.map((i) => [i.identifier, i.title]));
  const descs = new Map(tracker.list.map((i) => [i.identifier, i.description || '']));
  const result = {};
  for (const repo of Object.keys(dirs)) {
    const { prs, runs } = github.repos[repo];
    const commits = mainCommits(dirs[repo], repo);
    const bySha = new Map(commits.map((c) => [c.sha, c]));
    const rows = Object.fromEntries(MONTHS.map((m) => [m, {
      mergedPRs: 0, reverts: 0, hotfixPRs: 0, ciRuns: 0, ciRed: 0,
      prodPRs: 0, followUp14: 0, followUp30: 0, followUpNamed30: 0, fixShareOfMainCommits: [0, 0],
    }]));
    const pick = (iso) => rows[month(iso)];

    for (const p of prs) { const r = pick(p.mergedAt); if (!r) continue; r.mergedPRs++; if (HOTFIX.test(`${p.title} ${p.headRefName}`)) r.hotfixPRs++; }
    for (const c of commits) {
      const r = pick(c.at); if (!r) continue;
      if (REVERT.test(c.subject)) r.reverts++;
      const says = FIX.test(c.subject) || FIX.test(titles.get(ticketOf(c.subject)) || '');
      r.fixShareOfMainCommits[1]++; if (says) r.fixShareOfMainCommits[0]++;
      c.says = says;
    }
    for (const run of runs) { const r = pick(run.created_at); if (!r) continue; r.ciRuns++; if (run.conclusion === 'failure') r.ciRed++; }

    // Fix-follow-up: a later first-parent commit on main, not from the same ticket, within N days of the PR's merge,
    // touching at least one of the PR's production files, whose subject or ticket title says fix/regression.
    // "Named" additionally requires the later commit's subject, or its ticket's title or description, to name the PR's ticket or #number.
    const idx = new Map(commits.map((c, i) => [c.sha, i]));
    const prRows = [];
    for (const p of prs) {
      const r = pick(p.mergedAt); const c = p.mergeCommit && bySha.get(p.mergeCommit);
      if (!r || !c || !c.prod.length) continue;
      r.prodPRs++;
      const ticket = ticketOf(`${p.title} ${p.headRefName}`);
      const files = new Set(c.prod); const t0 = Date.parse(c.at);
      let f14 = false, f30 = false, named = false;
      for (let i = idx.get(c.sha) + 1; i < commits.length; i++) {
        const d = commits[i]; const dt = Date.parse(d.at) - t0;
        if (dt > 30 * DAY) break;
        if (!d.says || (ticket && ticketOf(d.subject) === ticket) || !d.prod.some((f) => files.has(f))) continue;
        f30 = true; if (dt <= 14 * DAY) f14 = true;
        const text = `${d.subject} ${titles.get(ticketOf(d.subject)) || ''} ${descs.get(ticketOf(d.subject)) || ''}`;
        if ((ticket && new RegExp(`\\b${ticket}\\b`, 'i').test(text)) || new RegExp(`#${p.number}\\b`).test(text)) named = true;
      }
      if (f14) r.followUp14++; if (f30) r.followUp30++; if (named) r.followUpNamed30++;
      prRows.push({ number: p.number, ticket, mergedAt: p.mergedAt, lines: p.additions + p.deletions, f14, f30, named });
    }
    result[repo] = { rows, prRows };
  }
  return result;
}

function print(res) {
  for (const [repo, { rows }] of Object.entries(res)) {
    console.log(`\n${REPO_LABEL[repo]}`);
    console.log('month    PRs  reverts hotfix  CI red/runs   prodPRs  FU14   FU30   FU30-named  fix-share of main commits');
    for (const [m, r] of Object.entries(rows)) {
      const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '–');
      console.log(`${m}  ${String(r.mergedPRs).padStart(4)}  ${String(r.reverts).padStart(6)}  ${String(r.hotfixPRs).padStart(5)}  ${`${r.ciRed}/${r.ciRuns}`.padStart(11)}  ${String(r.prodPRs).padStart(8)}  ${pct(r.followUp14, r.prodPRs).padStart(4)}  ${pct(r.followUp30, r.prodPRs).padStart(5)}  ${`${r.followUpNamed30} (${pct(r.followUpNamed30, r.prodPRs)})`.padStart(10)}  ${pct(...r.fixShareOfMainCommits)}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const res = measure(load());
  if (argv.includes('--json')) console.log(JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.rows])), null, 1));
  else print(res);
}
