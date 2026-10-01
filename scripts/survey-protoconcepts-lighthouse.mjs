// LIN-3187: what a Lighthouse study costs, what its second-agent review changes, and how often a released piece is corrected, from Lighthouse's own committed records at a pinned commit.
// Usage: node scripts/survey-protoconcepts-lighthouse.mjs [--repo data/survey-protoconcepts/repos/lighthouse] [--sha 7828bb8bee4a7996a166957567661ddda0da12de] [--out data/survey-protoconcepts/lighthouse.json]
// Clone first: git clone https://github.com/JKershaw/lighthouse data/survey-protoconcepts/repos/lighthouse (data/ is git-ignored).
// Every file is read with `git show <sha>:<path>`, so the checkout's state does not matter. Sources, all Lighthouse's own:
//   cost   — studies/LH016/data/costs.csv (per-step list-price dollars the agents transcribed from their transcripts), plus the
//            driving-session and subagent figures that file leaves out, each read from the commit message or close-out note named
//            in EXTRA below and checked to contain the quoted text; the 26 September dispatches' token records in
//            harbour/exports/*/history.json are re-priced with harbour/usage.py's formula and harbour/prices.json as a check.
//   review — studies/LH016/data/changes.csv and changes_secondary.csv, LH016's coded public-claim changes by step and round.
//   after release — each full article's `revised:` front matter and its "Correction," and "Later evidence," notices.
// Steps: research = research, writing, reanalysis; review = E, B, R1, R2, RC, adversarial and cold-reading checks, K (relayed,
// cost not recorded); driver = the driving session, which Lighthouse marks incomplete.
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const repo = arg('--repo', 'data/survey-protoconcepts/repos/lighthouse');
const sha = arg('--sha', '7828bb8bee4a7996a166957567661ddda0da12de');
const out = arg('--out', 'data/survey-protoconcepts/lighthouse.json');
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const show = (p) => git('show', `${sha}:${p}`);

// A minimal CSV reader (quoted fields, doubled quotes, commas and newlines inside quotes).
const csv = (s) => {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...body] = rows; return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, j) => [k, r[j] ?? ''])));
};

// ---- Cost per study --------------------------------------------------------------------------------------------------
const stepClass = (s) => (/^(research|writing|reanalysis)/.test(s) ? 'research' : /^driving/.test(s) ? 'driver' : 'review');
const costs = csv(show('studies/LH016/data/costs.csv'));
const study = {};
const add = (id, cls, usd, src) => { const r = (study[id] ||= { id, research: 0, review: 0, driver: 0, sources: new Set(), unknownReview: false }); r[cls] += usd; r.sources.add(src); };
for (const r of costs) {
  if (!/^LH\d+$/.test(r.study)) continue; // the improvement round and LH016's replays are not one study's
  if (r.cost_usd === '') { if (r.step === 'K') study[r.study] && (study[r.study].unknownReview = true); continue; }
  add(r.study, stepClass(r.step), Number(r.cost_usd), 'costs.csv');
}
// Figures costs.csv leaves out, each with the text that states it.
const EXTRA = [
  { id: 'LH002', cls: 'driver', usd: 3.41, commit: 'a2d669f', quote: 'driving session $3.41' },
  { id: 'LH005', cls: 'driver', usd: 2.73, commit: '2c63cac', quote: 'driver $2.73' },
  { id: 'LH006', cls: 'driver', usd: 1.30, commit: '3328692', quote: 'driver about $1.30' },
  { id: 'LH007', cls: 'driver', usd: 1.84, commit: 'a8a34e5', quote: 'driver session 1.84 USD' },
  { id: 'LH008', cls: 'driver', usd: 1.70, commit: '76043cb', quote: '1.70 USD' },
  { id: 'LH009', cls: 'driver', usd: 1.40, commit: '15bd521', quote: '1.40 USD' },
  { id: 'LH010', cls: 'driver', usd: 0.80, commit: 'f5a0021', quote: '0.80 USD' },
  { id: 'LH016', cls: 'research', usd: 11.10 + 3.88 + 0.97, commit: 'd07fac0', quote: 'first coder 11.10 and secondary reader 3.88' },
  { id: 'LH016', cls: 'review', usd: 3.59 + 4.98 + 4.82 + 5.68 + 3.52, commit: 'd07fac0', quote: 'replays 3.59, 4.98 and 4.82, evidence review 5.68 and recheck 3.52' },
  { id: 'LH016', cls: 'driver', usd: 14.3, commit: 'd07fac0', quote: 'driving session about 14.3' },
  { id: 'LH017', cls: 'review', usd: 14.18, file: 'notes/closeout-2026-09-30-ci-workflows.md', quote: '| Subagents in all | | $14.18 |' },
  { id: 'LH017', cls: 'driver', usd: 43.66, file: 'notes/closeout-2026-09-30-ci-workflows.md', quote: '| Opus 5.5 | $43.66 |' },
];
const flat = (s) => s.replace(/\s+/g, ' ');
for (const e of EXTRA) {
  const text = flat(e.commit ? git('log', '-1', '--format=%B', e.commit) : show(e.file));
  if (!text.includes(e.quote)) throw new Error(`${e.id}: "${e.quote}" not found in ${e.commit || e.file}`);
  add(e.id, e.cls, e.usd, e.commit || e.file);
}
const studyRows = Object.values(study).sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({
  id: r.id, research: +r.research.toFixed(2), review: +r.review.toFixed(2), driver: +r.driver.toFixed(2),
  usd: +(r.research + r.review + r.driver).toFixed(2), reviewShareOfSubagents: r.research + r.review ? +(r.review / (r.research + r.review)).toFixed(2) : null,
  driverShare: +(r.driver / (r.research + r.review + r.driver)).toFixed(2), unknownReview: r.unknownReview, sources: [...r.sources],
  note: r.id === 'LH017' ? 'the driving session did the research' : r.unknownReview ? 'plus a relayed review of unknown cost' : '',
}));

// ---- The token-level check: re-price the 26 September dispatches with usage.py's formula ------------------------------------
const prices = JSON.parse(show('harbour/prices.json')).models;
const exportDirs = git('ls-tree', '--name-only', `${sha}:harbour/exports`).trim().split('\n');
const seen = new Map();
for (const d of exportDirs) {
  let h; try { h = JSON.parse(show(`harbour/exports/${d}/history.json`)); } catch { continue; }
  for (const it of h.items || []) for (const fb of it.feedback || []) {
    if (!String(fb.message || '').startsWith('[usage] ')) continue;
    const key = `${it.id}|${fb.timestamp}`; if (seen.has(key)) continue;
    const u = JSON.parse(fb.message.slice(8)); if (u.inputTokens == null) continue;
    const p = prices[String(u.model).replace(/-\d{8}$/, '')]; const w1 = u.cacheCreation1hInputTokens || 0; const w5 = (u.cacheCreationInputTokens || 0) - w1;
    const re = p ? (u.inputTokens * p.input + u.cacheReadInputTokens * p.cacheRead + w5 * p.cacheWrite + w1 * p.cacheWrite1h + u.outputTokens * p.output) / 1e6 : null;
    seen.set(key, { item: it.id, model: u.model, recorded: u.costUsd, repriced: re == null ? null : +re.toFixed(4), cacheReadShare: +(u.cacheReadInputTokens / (u.inputTokens + u.cacheReadInputTokens + (u.cacheCreationInputTokens || 0))).toFixed(3), wallSeconds: u.wallSeconds ?? null });
  }
}
const tokenRows = [...seen.values()];
const tokenCheck = { n: tokenRows.length, matched: tokenRows.filter((r) => r.repriced != null && Math.abs(r.repriced - r.recorded) < 0.005).length, maxDiff: Math.max(...tokenRows.filter((r) => r.repriced != null).map((r) => Math.abs(r.repriced - r.recorded))) };

// ---- What review changed, and what changed after release (LH016's coded data) -------------------------------------------
const ch = csv(show('studies/LH016/data/changes.csv')); const ch2 = csv(show('studies/LH016/data/changes_secondary.csv'));
const tally = (rows, key) => rows.reduce((m, r) => ((m[key(r)] = (m[key(r)] || 0) + 1), m), {});
const STEP = { E: 'evidence review', B: 'blind check', R2: 'reader review, stage 2', RC: 'recheck of resolutions', K: 'outside review relayed by the keeper', D: 'driving session', L: 'later evidence' };
const publicA = ch.filter((r) => r.tier === 'A');
const changes = {
  rows: ch.length, publicClaim: publicA.length, rounds: [...new Set(ch.map((r) => r.round))].length,
  byStep: Object.fromEntries(Object.entries(tally(publicA, (r) => r.step)).map(([k, v]) => [STEP[k] || k, v])),
  byStepType: tally(publicA, (r) => `${STEP[r.step] || r.step}: ${r.type || 'untyped'}`),
  beforeRelease: publicA.filter((r) => r.post_release === 'no').length, afterRelease: publicA.filter((r) => r.post_release === 'yes').length,
  secondaryAfterRelease: ch2.filter((r) => r.tier === 'A').length,
  secondaryByStep: Object.fromEntries(Object.entries(tally(ch2.filter((r) => r.tier === 'A'), (r) => r.step)).map(([k, v]) => [STEP[k] || k, v])),
  secondaryByDirection: tally(ch2.filter((r) => r.tier === 'A'), (r) => r.direction),
  evidenceReviewTypes: tally(publicA.filter((r) => r.step === 'E'), (r) => r.type || 'untyped'),
};

// ---- Released articles and their corrections ----------------------------------------------------------------------------
const arts = git('ls-tree', '--name-only', `${sha}:articles`).trim().split('\n').filter((f) => f.endsWith('.md'));
const articles = arts.map((f) => {
  const s = show(`articles/${f}`); const fm = s.split(/\n# /)[0];
  const revised = (fm.match(/^revised:\n((?:- .*\n?)*)/m)?.[1] || '').split('\n').filter((l) => l.startsWith('- '));
  return { file: f, published: fm.match(/^published: (\S+)/m)?.[1] || null, revisions: revised.length,
    corrections: (s.match(/\*\*Correction, /g) || []).length, laterEvidence: (s.match(/\*\*Later evidence, /g) || []).length };
});
const log = git('log', '--format=%ad', '--date=iso-strict', sha).trim().split('\n');

const result = {
  sha, generatedAt: new Date().toISOString(), commits: log.length, firstCommit: log.at(-1), lastCommit: log[0],
  frontierInputUsdPerM: prices['claude-opus-5-5'].input, priceTable: prices,
  studyRows, tokenCheck, tokenRows, changes, articles,
  articleSummary: { n: articles.length, revised: articles.filter((a) => a.revisions > 0).length, withCorrectionNotice: articles.filter((a) => a.corrections > 0).length, withLaterEvidence: articles.filter((a) => a.laterEvidence > 0).length, notices: articles.reduce((a, x) => a + x.corrections + x.laterEvidence, 0) },
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));
const med = (xs) => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
console.log(`lighthouse@${sha.slice(0, 7)}: ${log.length} commits ${log.at(-1).slice(0, 10)}..${log[0].slice(0, 10)}`);
for (const r of studyRows) console.log(`  ${r.id}  research $${r.research.toFixed(2)}  review $${r.review.toFixed(2)}  driver $${r.driver.toFixed(2)}  total $${r.usd.toFixed(2)}  review/subagents ${r.reviewShareOfSubagents}  ${r.note}`);
const full = studyRows.filter((r) => r.research + r.review > 0 && r.driver > 0);
console.log(`studies with research, review and driver: ${full.length}, median $${med(full.map((r) => r.usd)).toFixed(2)}; LH002–LH010 median $${med(full.filter((r) => r.id <= 'LH010').map((r) => r.usd)).toFixed(2)}, LH011 on $${med(full.filter((r) => r.id > 'LH010').map((r) => r.usd)).toFixed(2)}`);
console.log(`token check: ${tokenCheck.matched} of ${tokenCheck.n} dispatches re-price to the recorded cost (max diff $${tokenCheck.maxDiff.toFixed(4)})`);
console.log(`changes: ${changes.publicClaim} public-claim of ${changes.rows} coded over ${changes.rounds} rounds; ${changes.beforeRelease} before release, ${changes.afterRelease} after (+${changes.secondaryAfterRelease} secondary)`, changes.byStep);
console.log('articles:', result.articleSummary);
