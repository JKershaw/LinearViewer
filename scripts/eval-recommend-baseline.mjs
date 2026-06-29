#!/usr/bin/env node
/**
 * Recommendation-engine baseline eval harness (LIN-432 — the "red test"; LIN-587 — fixtures-only).
 *
 * The safety net every later subtask of LIN-431 measures against. It exercises the
 * LOCAL recommendation pipeline — `resolveRecommendation` (lib/recommend-recurse.js)
 * driving a `computeOne` that calls `getRecommendation` (lib/openrouter.js) — NOT the
 * deployed `GET /api/proxy/recommend/:id`. The deployed endpoint runs production and
 * would not see later branch changes, so it can only ever be reference data; the
 * committed output of THIS harness is the baseline subtasks 2–5 compare against.
 *
 * LIN-587 — fixtures only, no proxy. The harness used to fetch each descent node from
 * the proxy and reshape it into context. That coupled it to a live token AND to the
 * proxy wire shape (which has since flattened — the old `{nodes:[]}` reshape went
 * stale, building empty context). It now runs purely on COMMITTED context-bundle
 * fixtures under `scripts/eval/fixtures/recommend/*.json`, so it needs no token, no
 * network for context, and runs identically on any clone / in CI. Only the LLM leg
 * (`getRecommendation`, the thing under test) hits the network — `OPENROUTER_API_KEY`.
 *
 * Each fixture file is a workspace:
 *   { name, targets: [{ id, role }], bundles: { <identifier>: <contextBundle> } }
 * where a contextBundle is the exact object getRecommendation consumes:
 *   { issue, parent, siblings, siblingsTotal, project, children, comments, focusedChild }
 * `computeOne` resolves an identifier straight out of `bundles` (a missing id throws
 * "not found", which resolveRecommendation surfaces as an `unresolved` descent stop —
 * never a crash). Descent works because each non-leaf bundle carries a `focusedChild`
 * and a matching `children` entry; the leaf bundle has neither, so the descent ends.
 *
 * The real-task fixtures are curated, committed real text (Harbour is a public pet
 * project; LinearViewer is this repo's own public tracker) — regenerated, text-free,
 * by `scripts/eval/build-recommend-fixtures.mjs`. The synthetic FIX-448-leaf fixture
 * is deliberately constructed (no real equivalent reproduces its loop in isolation;
 * the authoritative guard is the unit test — see synthetic.json's note).
 *
 * Usage:
 *   OPENROUTER_API_KEY=... node scripts/eval-recommend-baseline.mjs
 *   (OPENROUTER_API_KEY is also picked up from .env via dotenv.)
 *
 * Env knobs:
 *   OPENROUTER_API_KEY   OpenRouter key for the local LLM call    (required; from env or .env)
 *   MODEL                model id                                 (default openai/gpt-5.4-mini — the prod default)
 *   K                    repeats per target                       (default 6)
 *   ONLY                 substring filter on target id            (e.g. ONLY=HAR-149)
 *   FIXTURES_DIR         fixtures dir override                    (default scripts/eval/fixtures/recommend)
 *   OUT_DIR              output dir override                      (default scripts/eval/recommend-baseline/<DATE>)
 *   DATE                 baseline date stamp                      (default 2026-06-12 — passed in; no clock in-script)
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRecommendation } from '../lib/openrouter.js';
import { resolveRecommendation } from '../lib/recommend-recurse.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) { console.error('Set OPENROUTER_API_KEY (env or .env)'); process.exit(1); }
const MODEL = process.env.MODEL || 'openai/gpt-5.4-mini';
const K = Number(process.env.K) || 6;
const ONLY = process.env.ONLY;
const DATE = process.env.DATE || '2026-06-12';
const FIXTURES_DIR = process.env.FIXTURES_DIR || join(HERE, 'eval', 'fixtures', 'recommend');
const OUT_DIR = process.env.OUT_DIR || join(HERE, 'eval', 'recommend-baseline', DATE);

/** Load each committed fixture file as a workspace ({ name, targets, bundles }). */
function loadWorkspaces(dir) {
  if (!existsSync(dir)) { console.error(`No fixtures dir: ${dir} (run scripts/eval/build-recommend-fixtures.mjs)`); process.exit(1); }
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  return files.map(f => {
    const ws = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (!ws.bundles || !ws.targets) throw new Error(`fixture ${f} missing targets/bundles`);
    return { name: ws.name || f.replace(/\.json$/, ''), file: f, targets: ws.targets, bundles: ws.bundles };
  });
}

// ---- deterministic grader (LIN-596) -----------------------------------------------
// Mirrors scripts/eval-research-routing.mjs: grade off the terminal action label, no
// LLM judge. Each target carries an `expect` (acceptable terminal action[s]) and a
// `descentExpect` (the identifier the descent should terminate on; defaults to the
// target id for leaf-only fixtures). A run is:
//   • terminal-action correct  — its terminal action ∈ expect
//   • descent correct          — its terminal id === descentExpect
const norm = s => (s || '').toLowerCase().trim();
function acceptSet(target) {
  const e = Array.isArray(target.expect) ? target.expect : (target.expect ? [target.expect] : []);
  return new Set(e.map(norm));
}

/**
 * One recommend hop — the harness's own `computeOne`, mirroring routes/proxy.js's
 * inner computeRecommendation live branch (the shape resolveRecommendation needs:
 * recommendedAction + deferTo drive descent; state + children arm the LIN-353 guards).
 * Context comes straight from the committed bundle — no network, no proxy reshape.
 */
function makeComputeOne(bundles) {
  return async function computeOne(identifier) {
    const b = bundles[identifier];
    // A missing bundle is "not found" — resolveRecommendation turns that into an
    // `unresolved` descent stop rather than crashing the run.
    if (!b) throw new Error(`not found: ${identifier}`);

    const recommendation = await getRecommendation(
      b.issue,
      {
        parent: b.parent,
        siblings: b.siblings || [],
        siblingsTotal: b.siblingsTotal || 0,
        project: b.project,
        children: b.children || [],
        comments: b.comments || [],
        focusedChild: b.focusedChild || null
      },
      { apiKey: OPENROUTER_API_KEY, model: MODEL, featureFlags: {} }
    );

    return {
      identifier: b.issue.identifier,
      reasoning: recommendation.reasoning,
      prompt: recommendation.prompt,
      truncated: recommendation.truncated,
      recommendedAction: recommendation.recommendedAction,
      deferTo: recommendation.deferTo || null,
      state: b.issue.state,
      children: b.children || []
    };
  };
}

/** Run one target K times through resolveRecommendation, capturing each run. */
async function runTarget(workspace, target) {
  const computeOne = makeComputeOne(workspace.bundles);
  const runs = [];
  for (let i = 0; i < K; i++) {
    try {
      const { recommendation, deferredVia, deferTruncated, deferStopReason } =
        await resolveRecommendation({ computeOne, startIdentifier: target.id });
      runs.push({
        run: i + 1,
        descentPath: deferredVia,
        terminal: recommendation?.identifier || null,
        action: recommendation?.recommendedAction || null,
        promptLength: recommendation?.prompt ? recommendation.prompt.length : 0,
        deferTruncated,
        deferStopReason,
        prompt: recommendation?.prompt || null,
        reasoning: recommendation?.reasoning || null
      });
      process.stdout.write('.');
    } catch (e) {
      runs.push({ run: i + 1, error: e.message });
      process.stdout.write('x');
    }
  }
  process.stdout.write('\n');
  const descentExpect = target.descentExpect || target.id;
  const expect = Array.isArray(target.expect) ? target.expect : (target.expect ? [target.expect] : []);
  return { id: target.id, role: target.role, workspace: workspace.name, expect, descentExpect, runs };
}

// ---- main ----
const workspaces = loadWorkspaces(FIXTURES_DIR);
const results = [];

for (const ws of workspaces) {
  const targets = ws.targets.filter(t => !ONLY || t.id.includes(ONLY));
  if (!targets.length) continue;
  console.log(`\n[${ws.name}] fixtures=${ws.file}  model=${MODEL}  K=${K}  targets=${targets.map(t => t.id).join(', ')}`);
  for (const t of targets) {
    console.log(`  ${t.id} (${t.role})`);
    results.push(await runTarget(ws, t));
  }
}

// ---- write artifacts ----
mkdirSync(OUT_DIR, { recursive: true });

// ---- grade every run (LIN-596): terminal-action accuracy + descent-correct rate ----
// Mirrors eval-research-routing's deterministic grading. A run with an error counts as a
// miss on both metrics (it produced no usable terminal decision).
const grade = { actionHit: 0, descentHit: 0, n: 0 };
const perAction = {}; // expected-action → { hit, n } (recall breakdown, like routing)
for (const r of results) {
  const accept = new Set((r.expect || []).map(norm));
  const expectKey = (r.expect || []).map(norm).sort().join('|') || '—';
  perAction[expectKey] = perAction[expectKey] || { hit: 0, n: 0, descentExpect: r.descentExpect };
  for (const run of r.runs) {
    grade.n += 1; perAction[expectKey].n += 1;
    if (run.error) continue;
    const actionOk = accept.size ? accept.has(norm(run.action)) : false;
    const descentOk = norm(run.terminal) === norm(r.descentExpect);
    run.actionCorrect = actionOk;
    run.descentCorrect = descentOk;
    if (actionOk) { grade.actionHit += 1; perAction[expectKey].hit += 1; }
    if (descentOk) grade.descentHit += 1;
  }
}
const pct = (x, n) => n ? (x / n * 100).toFixed(0) + '%' : '-';

const summary = {
  terminalActionAccuracy: { hit: grade.actionHit, n: grade.n, pct: pct(grade.actionHit, grade.n) },
  descentCorrectRate: { hit: grade.descentHit, n: grade.n, pct: pct(grade.descentHit, grade.n) },
  distinctExpectedActions: new Set(results.flatMap(r => (r.expect || []).map(norm))).size,
  perExpectedAction: perAction
};
const meta = { date: DATE, model: MODEL, repeats: K, generatedBy: 'scripts/eval-recommend-baseline.mjs (LIN-432; fixtures-only LIN-587; scored re-freeze LIN-596)' };
writeFileSync(join(OUT_DIR, 'run.json'), JSON.stringify({ meta, summary, results }, null, 2));

// Compact per-run table: descent path / terminal / action (graded) / prompt length.
const tableLines = [
  `# Recommendation baseline — ${DATE}`,
  '',
  `model: \`${MODEL}\` · repeats: ${K} · harness: \`scripts/eval-recommend-baseline.mjs\` (local pipeline, fixtures-only — NOT deployed proxy)`,
  '',
  '## Scored summary (LIN-596)',
  '',
  `Deterministic grader (no LLM judge): terminal action ∈ \`expect\`; descent terminal id === \`descentExpect\`.`,
  '',
  '| metric | value |',
  '|---|---|',
  `| terminal-action accuracy | ${grade.actionHit}/${grade.n} (${pct(grade.actionHit, grade.n)}) |`,
  `| descent-correct rate | ${grade.descentHit}/${grade.n} (${pct(grade.descentHit, grade.n)}) |`,
  `| distinct expected next-actions | ${new Set(results.flatMap(r => (r.expect || []).map(norm))).size} |`,
  '',
  '### Per expected-action recall',
  '',
  '| expect | descentExpect | accuracy |',
  '|---|---|---|'
];
for (const [key, v] of Object.entries(perAction)) {
  tableLines.push(`| ${key} | ${v.descentExpect} | ${v.hit}/${v.n} (${pct(v.hit, v.n)}) |`);
}
tableLines.push(
  '',
  '## Per-run capture',
  '',
  '| target | role | run | descent path | terminal | action | expect | ✓action | ✓descent | prompt len | stop |',
  '|---|---|---|---|---|---|---|---|---|---|---|'
);
for (const r of results) {
  const expectStr = (r.expect || []).join('/') || '—';
  for (const run of r.runs) {
    if (run.error) {
      tableLines.push(`| ${r.id} | ${r.role} | ${run.run} | — | — | ERROR | ${expectStr} | ✗ | ✗ | — | ${run.error.slice(0, 40)} |`);
      continue;
    }
    const path = (run.descentPath || []).join(' → ');
    const a = run.actionCorrect ? '✓' : '✗';
    const d = run.descentCorrect ? '✓' : '✗';
    tableLines.push(`| ${r.id} | ${r.role} | ${run.run} | ${path} | ${run.terminal || '—'} | ${run.action || '—'} | ${expectStr} | ${a} | ${d} | ${run.promptLength} | ${run.deferStopReason || ''} |`);
  }
}
writeFileSync(join(OUT_DIR, 'table.md'), tableLines.join('\n') + '\n');

// Stable pointer file (the documented "red baseline" entry point).
const pointer = [
  '# Recommendation engine — red baseline (LIN-432)',
  '',
  `The committed baseline the LIN-431 subtasks (2–5) compare against. Produced by the`,
  `LOCAL recommendation pipeline via \`scripts/eval-recommend-baseline.mjs\` — never the`,
  `deployed \`/api/proxy/recommend\` (which runs production and won't see branch changes).`,
  '',
  `**Fixtures-only (LIN-587):** context comes from committed bundles under`,
  `\`scripts/eval/fixtures/recommend/*.json\` — no proxy token, no network for context.`,
  `Only the LLM leg needs \`OPENROUTER_API_KEY\`. Real-task fixtures (Harbour HAR-149/545/616,`,
  `LinearViewer LIN-385/389/428) are curated real text, re-frozen at key in-progress moments`,
  `(LIN-596) — each node keeps its first \`keep\` comments so \`state\` and the trimmed trail`,
  `agree. Graded leaf-only targets re-use one real leaf at several decision moments to cover a`,
  `spread of next-actions. Synthetic FIX-448-leaf is deliberately constructed (see its note).`,
  `The synthetic \`closeout-review.json\` fixtures (LIN-812) cover the close-out/review routing`,
  `gate — the positive/negative pair of one Step-0/Step-3 decision (LIN-550 split, LIN-810,`,
  `LIN-811): an Approve verdict on record + unmerged → \`close-out\`; work that looks done with`,
  `no review-verdict comment → \`review\`. Previously \`close-out\` was un-eval'ed (LIN-804).`,
  `Regenerate from the committed \`_source/\` captures with \`scripts/eval/build-recommend-fixtures.mjs\`.`,
  '',
  `**Scored (LIN-596):** each target carries \`expect\` (acceptable terminal action[s]) +`,
  `\`descentExpect\` (terminal id the descent should reach). The harness grades deterministically`,
  `(no LLM judge) and emits **terminal-action accuracy** + **descent-correct rate**.`,
  '',
  `**Latest baseline:** \`scripts/eval/recommend-baseline/${DATE}/\``,
  `- \`table.md\` — scored summary + per-run capture (descent path / terminal / action / grade)`,
  `- \`run.json\` — full capture incl. every prompt + reasoning + the scored summary`,
  '',
  '## Regenerate',
  '',
  '```',
  '# the eval itself (context from committed fixtures; only the LLM call needs a key):',
  'OPENROUTER_API_KEY=<key> node scripts/eval-recommend-baseline.mjs',
  '',
  '# refresh the real-task fixtures from the proxy (text-free recipe; needs read tokens):',
  'PROXY_TOKEN=<linearviewer read> HARBOUR_PROXY_TOKEN=<harbour read> \\',
  '  node scripts/eval/build-recommend-fixtures.mjs',
  '```',
  ''
].join('\n');
writeFileSync(join(HERE, 'eval', 'recommend-baseline.md'), pointer);

console.log(`\nScored summary (LIN-596):`);
console.log(`  terminal-action accuracy: ${grade.actionHit}/${grade.n} (${pct(grade.actionHit, grade.n)})`);
console.log(`  descent-correct rate:     ${grade.descentHit}/${grade.n} (${pct(grade.descentHit, grade.n)})`);
console.log(`  distinct expected actions: ${summary.distinctExpectedActions}`);
console.log(`\nBaseline written:`);
console.log(`  ${join(OUT_DIR, 'table.md')}`);
console.log(`  ${join(OUT_DIR, 'run.json')}`);
console.log(`  ${join(HERE, 'eval', 'recommend-baseline.md')} (pointer)`);
