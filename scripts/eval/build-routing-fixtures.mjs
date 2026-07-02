#!/usr/bin/env node
/**
 * Build committed REAL-task fixtures for the routing eval (scripts/eval-research-routing.mjs).
 *
 * LIN-587: the routing suite carries hand-authored synthetic distillations (SYN-16/17/18)
 * of real LinearViewer episodes. Real frozen text is denser and less forgiving than a clean
 * distillation (the HAR-697 finding), so where a real task reproduces the shape we freeze the
 * REAL trail and keep the synthetic only as a cheap pre-check. This is the committed, text-free
 * recipe (mirrors build-har697-red.mjs — it holds ids + the grading sidecar, never body text).
 *
 * Each fixture is frozen at its RED MOMENT by keeping the first `keep` comments and dropping
 * the trailing close-out, and the state is forced to `started` (these tasks have since merged).
 * Output is the graded-leaf shape the routing harness's fixtures loader reads:
 *   { identifier, state, labels, createdAt, title, description, comments[], expect[], loop, avoid, scale, why }
 *
 * Usage:
 *   PROXY_TOKEN=<linearviewer read token> node scripts/eval/build-routing-fixtures.mjs
 *
 * Env knobs:
 *   PROXY_TOKEN / HARBOUR_PROXY_TOKEN   proxy READ token (PROXY_TOKEN preferred)
 *   PROXY_BASE                          proxy base URL (default https://projects.jkershaw.com/api/proxy)
 *   ONLY                                substring filter on identifier (e.g. ONLY=LIN-510)
 *
 * Context hygiene: prints only a metadata line per fixture (no body text) to stdout.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.PROXY_TOKEN || process.env.HARBOUR_PROXY_TOKEN;
if (!TOKEN) { console.error('Set PROXY_TOKEN (proxy READ token for LinearViewer)'); process.exit(1); }
const BASE = process.env.PROXY_BASE || 'https://projects.jkershaw.com/api/proxy';
const ONLY = process.env.ONLY;
const STARTED = { name: 'In Progress', type: 'started' };

/**
 * Per-fixture recipe: which real task, how many leading comments to keep (the red
 * moment, before the close-out), and the grading sidecar the harness reads. `forceLabels`
 * is set where the real task's label set is the signal under test.
 */
const FIXTURES = [
  {
    identifier: 'LIN-510', file: 'LIN-510-review-loop.json', keep: 5,
    expect: ['implement', 'blocked', 'plan', 'bug'], loop: true, avoid: 'review',
    scale: 'real (frozen at the red moment: 3× Request-Changes on an unaddressed blocker, pre-merge)',
    why: 'REAL LIN-510 stuck-review loop (real counterpart to synthetic SYN-17). The trail runs '
      + 'research → implement → Review #1/#2/#3, all Request-Changes on the SAME unaddressed blocker '
      + '(dishonest visual-regression baselines on an unchanged commit). A 4th review repeats the loop; '
      + 'the correct break is to route to the blocker fix (regenerate the baselines), not another review. '
      + 'Frozen before the close-out comment. Real scale + real distractors vs the forgiving synthetic.'
  },
  {
    identifier: 'LIN-537', file: 'LIN-537-bug-investigated.json', keep: 1,
    expect: ['implement', 'plan'], loop: true, avoid: 'bug',
    scale: 'real (frozen after the investigation comment, before the fix landed)',
    why: 'REAL LIN-537 bug-already-investigated (real counterpart to synthetic SYN-18). The single kept '
      + 'comment is a code-grounded investigation naming the root cause AND a minimal fix (isolated, not a '
      + 'class). The honest next action is to advance to the fix, NOT to re-investigate. Frozen before the '
      + 'fix/review/close comments. NOTE: the real task carries no `bug` label (its title/description are '
      + 'the bug signal), so this measures the investigation-done advance; SYN-18 retains the bug-LABEL test.'
  },
  {
    identifier: 'LIN-420', file: 'LIN-420-landed-review.json', keep: 1,
    expect: ['review'], loop: false, avoid: null,
    scale: 'real (frozen at landed-awaiting-review: PR open + CI green, before the approve/merge)',
    why: 'REAL LIN-420 landed-awaiting-review (real counterpart to synthetic SYN-16). The single kept '
      + 'comment is the completion recap (envelope helpers adopted across the three route files, PR open, '
      + 'CI green). Work has demonstrably landed but is not yet reviewed → confirm-and-close (review), not '
      + 're-implement. Frozen before the approve + merge comments.'
  },
  // ---- DESIGN-expected (LIN-878): the richer-kind recall bar. Sole expect:['design'],
  // NOT aliased to research, so the per-kind metric can discriminate design from research.
  {
    identifier: 'LIN-813', file: 'LIN-813-design-shape-fork.json', keep: 2,
    expect: ['design'], loop: false, avoid: null,
    scale: 'real (frozen pre-plan: scope narrowed by John, before the plan comment silently picked the shape)',
    why: 'REAL LIN-813 shape-fork — THE gold design case (LIN-878). Frozen at keep=2 (the dogfooding '
      + 'proof + John\'s scope-narrowing comment) — the pre-plan red moment. Knowledge is gathered and scope '
      + 'is pinned to the first slice (one head AP + one child AP per task), but the SOLUTION SHAPE is still '
      + 'contested: the next comment (dropped here) is the plan, which silently picked a launch-time '
      + 'coordinator VARIANT — a choice John reversed twice (PR #718 built→reviewed→CHANGES-REQUESTED→closed '
      + 'unmerged, rebuilt guide-driven as #719). A deliberate `design` pass weighing coordinator-variant vs '
      + 'guide-driven would have surfaced that fork before implementation. The honest next action is `design`, '
      + 'not straight to `plan`. Frozen before the plan/implement/review/close-out trail.'
  },
  {
    identifier: 'LIN-748', file: 'LIN-748-design-theme.json', keep: 2,
    expect: ['design'], loop: false, avoid: null,
    scale: 'real (frozen post-research, before "direction locked" — the harder real design case)',
    why: 'REAL LIN-748 "Theme and Observation page design" (LIN-878). Frozen at keep=2 (bookkeeping + the '
      + 'research/exploration comment), before comment [2] "Breakdown — direction locked with John" decided '
      + 'the shape inline. The attachments (theme-design.md, observation-page-design.md, AgentRuns.jsx mockup) '
      + 'are read but the SHAPE of reconciling mockup-vs-existing is contested (light/dark default, retire '
      + 'theme-amber, relax the CLI-mono principle) — the deliberate `design` step this task never got, whose '
      + 'absence let the delivery drift from the intended design (→ rebuild LIN-873 + fidelity follow-ups). '
      + 'HARDER than LIN-813: the description embeds research findings and a two-track (Task 1/Task 2) framing, '
      + 'so it can also attract `research`/`breakdown` — a realistic, less-forgiving design fixture on purpose.'
  }
];

async function fetchIssue(identifier) {
  const r = await fetch(`${BASE}/issues/${identifier}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) { throw new Error(`proxy ${r.status} on /issues/${identifier}`); }
  const d = await r.json();
  if (d.error) throw new Error(`proxy error: ${d.error} (${d.code || ''})`);
  return d;
}

const OUT = join(HERE, 'fixtures');
mkdirSync(OUT, { recursive: true });

for (const f of FIXTURES) {
  if (ONLY && !f.identifier.includes(ONLY)) continue;
  const d = await fetchIssue(f.identifier);
  const comments = (d.comments || [])
    .slice(0, f.keep)
    .map(c => ({ user: (c.user || {}).name || 'agent', createdAt: c.createdAt, body: c.body }));

  const fixture = {
    identifier: d.identifier,
    state: STARTED,
    labels: f.forceLabels || (Array.isArray(d.labels) ? d.labels : []),
    createdAt: d.createdAt,
    title: d.title,
    description: d.description,
    comments,
    expect: f.expect,
    loop: f.loop,
    avoid: f.avoid,
    scale: f.scale,
    why: f.why
  };

  const path = join(OUT, f.file);
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');

  const descLen = (fixture.description || '').length;
  const cmtChars = comments.reduce((n, c) => n + (c.body || '').length, 0);
  console.log(`wrote ${path}`);
  console.log(`  ${fixture.identifier}  kept ${comments.length}/${(d.comments || []).length} comments  `
    + `expect=[${f.expect.join('|')}]${f.loop ? ` avoid=${f.avoid}` : ''}  `
    + `desc ${descLen} + comments ${cmtChars} = ${descLen + cmtChars} chars (~${Math.round((descLen + cmtChars) / 4)} tok)`);
}
console.log('\nDone. Committed real-task fixtures; the routing harness auto-loads scripts/eval/fixtures/*.json.');
