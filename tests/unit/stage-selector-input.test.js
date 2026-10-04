/**
 * LIN-3300: what the stage selector decides from.
 *
 * - Trail facts computed in code from the WHOLE trail: the latest code review
 *   (run-ledger's reader, so a plan-review verdict or a bug write-up is never one),
 *   work and close-out reported after it, the PRs linked, the latest ruling recorded
 *   via Harbour, and for a leaf the plan, its session fit and whether plan-review is due.
 * - The selector's own view of the ticket: title, state, labels, relations, the
 *   description with a long plan body condensed, the latest 3 comments (capped) and the
 *   latest ruling wherever it sits. Older comment bodies and the worker-only epic-list
 *   nudge are not in it, and formatIssueContext (brief, recap, scan, task chat, the
 *   full meta path) is unchanged.
 *
 * Run with: node --test tests/unit/stage-selector-input.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleTrailFacts, formatTrailFactsBlock, condensePlan, RULING_MARK
} from '../../lib/recommendation-facts.js';
import { formatSelectorView, formatIssueContext } from '../../lib/openrouter.js';

const at = (d) => `2026-10-0${d}T10:00:00.000Z`;
const PR = 'https://github.com/JKershaw/LinearViewer/pull/1747';
const review = (verdict, d) => ({ createdAt: at(d), body: `## Review — LIN-1\n\nReviewed ${PR}.\n\n### Verdict\n${verdict}\n\n### What CI Did Not Prove\n- L1 (inside): the live run.` });
const planReview = (d) => ({ createdAt: at(d), body: '### Plan Review Verdict\n\n**Verdict:** Approve.' });

describe('trail facts (LIN-3300)', () => {
  test('the latest code review comes from the run ledger; a plan-review Approve is not one', () => {
    const facts = assembleTrailFacts([planReview(1)], '');
    assert.equal(facts.review, null);
    const withReview = assembleTrailFacts([planReview(1), review('Request Changes.', 2)], '');
    assert.equal(withReview.review.verdict, 'request-changes');
    assert.equal(withReview.review.ledgerItems, 1);
    assert.equal(withReview.workAfterReview, false);
  });

  test('a later comment linking a PR is work reported after the review; a close-out is not', () => {
    const fixed = assembleTrailFacts([review('Request Changes.', 1), { createdAt: at(2), body: `## Review fixes landed — PR updated\n\n${PR}` }], '');
    assert.equal(fixed.workAfterReview, true);
    const closed = assembleTrailFacts([review('Approve.', 1), { createdAt: at(2), body: `## Close-out — LIN-1\n\nMerged ${PR}.` }], '');
    assert.equal(closed.workAfterReview, false);
    assert.equal(closed.closeOutAfterReview, true);
  });

  test('PR links and the latest ruling are read from every comment, in time order', () => {
    const facts = assembleTrailFacts([
      { createdAt: at(3), body: `Go to implementation.\n\n${RULING_MARK}` },
      { createdAt: at(1), body: `Opened https://github.com/a/b/pull/1` },
      { createdAt: at(2), body: `Hold.\n\n${RULING_MARK}` },
      { createdAt: at(4), body: `Now ${PR}` }
    ], '');
    assert.deepEqual(facts.prUrls, ['https://github.com/a/b/pull/1', PR]);
    assert.equal(facts.latestRuling.at, at(3));
    assert.match(facts.latestRuling.body, /^Go to implementation\./);
  });

  test('a leaf gets its plan facts; the negated session fit reads as multiple sessions', () => {
    const description = 'Goal.\n\n## Implementation Plan\n\nRevision 3 — addresses plan-review F1.\n\nSession fit: does not fit one session.\n\nplan-review due: yes\n';
    const facts = assembleTrailFacts([], description, { leaf: true });
    assert.deepEqual(facts.plan, { present: true, revision: 3, sessionFit: 'needs multiple sessions', planReviewDue: 'yes' });
    assert.equal(assembleTrailFacts([], 'Plan-review due: no — covered by LIN-9.', { leaf: true }).plan.planReviewDue, 'no');
    assert.deepEqual(assembleTrailFacts([], 'Just a goal.', { leaf: true }).plan, { present: false, revision: null, sessionFit: null, planReviewDue: null });
    assert.equal(assembleTrailFacts([], description, { leaf: false }).plan, null, 'a node reads session fit from FRONTIER FACTS instead');
  });

  test('the block states each fact once and says which comments it read', () => {
    const block = formatTrailFactsBlock(assembleTrailFacts([review('Approve — conditional on close-out.', 1)], 'x', { leaf: true }), 7);
    assert.match(block, /TRAIL FACTS \(computed in code from all 7 comments — do not re-derive\)/);
    assert.match(block, /Latest code review: approve-conditional/);
    assert.match(block, /Work reported after it \(a later comment links a PR\): no/);
    assert.match(block, /PRs linked on the trail: https:\/\/github\.com\/JKershaw\/LinearViewer\/pull\/1747/);
    assert.match(block, /Implementation plan in the description: no/);
    const none = formatTrailFactsBlock(assembleTrailFacts([], '', { leaf: false }), 0);
    assert.match(none, /Latest code review: none/);
    assert.doesNotMatch(none, /Implementation plan in the description/);
  });
});

describe('condensePlan (LIN-3300)', () => {
  const section = (title, body) => `### ${title}\n\n${body}\n`;
  const long = 'x'.repeat(900);
  const plan = [
    'Intro to the ticket.',
    '',
    '## Implementation Plan',
    '',
    'Revision 2 — addresses plan-review F1.',
    '',
    section('Surfaces', `First paragraph of surfaces.\n\n${long}`),
    section('Session fit', 'Does not fit one session: each phase is its own implementation session.\n\nPhase 1 lands alone.\n\nPhase 2 follows.'),
    section('Tests', `Test lead.\n\n${long}\n\n${long}`),
    'plan-review due: yes',
    '',
    '## After the plan',
    '',
    'Kept whole.'
  ].join('\n');

  test('a long plan keeps each subsection lead, the whole Session fit section and the machine lines', () => {
    const out = condensePlan(plan, { threshold: 500 });
    assert.ok(out.length < plan.length, 'it is shorter');
    assert.match(out, /Intro to the ticket\./);
    assert.match(out, /Revision 2 — addresses plan-review F1\./);
    assert.match(out, /### Surfaces\n\nFirst paragraph of surfaces\./);
    assert.match(out, /Phase 1 lands alone\.\n\nPhase 2 follows\./, 'the Session fit section is whole');
    assert.match(out, /### Tests\n\nTest lead\./);
    assert.match(out, /plan-review due: yes/);
    assert.doesNotMatch(out, /x{900}/, 'subsection bodies are cut');
    assert.match(out, /## After the plan\n\nKept whole\./, 'text outside the plan is unchanged');
    assert.match(out, /Plan body condensed for routing/);
  });

  test('a short plan, or none, is unchanged', () => {
    assert.equal(condensePlan(plan, { threshold: 1e6 }), plan);
    assert.equal(condensePlan('No plan here.'), 'No plan here.');
    assert.equal(condensePlan(''), '');
  });
});

describe('the selector view (LIN-3300)', () => {
  const issue = {
    identifier: 'LIN-1', title: 'A task', state: { name: 'In Progress', type: 'started' }, labels: ['bug'],
    description: 'Do it.', createdAt: at(1), updatedAt: at(2),
    blockedBy: [{ identifier: 'LIN-2', title: 'b', state: { name: 'Todo', type: 'unstarted' } }, { identifier: 'LIN-3', title: 'c', state: { name: 'Done', type: 'completed' } }]
  };
  const comments = [
    { user: 'John', createdAt: at(1), body: `Ruling: plan first.\n\n${RULING_MARK}` },
    { user: 'Agent', createdAt: at(2), body: 'Older note one.' },
    { user: 'Agent', createdAt: at(3), body: 'Newer note two.' },
    { user: 'Agent', createdAt: at(4), body: 'y'.repeat(2500) },
    { user: 'Agent', createdAt: at(5), body: 'Newest note.' }
  ];
  const context = {
    parent: { identifier: 'LIN-0', title: 'Epic', state: { name: 'In Progress' } }, parentChildCount: 30,
    siblings: [{ identifier: 'LIN-4', title: 's', state: { name: 'Todo' } }], siblingsTotal: 9,
    cousins: [{ identifier: 'LIN-5', title: 'cousin', state: { name: 'Todo' } }], cousinsTotal: 40,
    project: { name: 'Harbour' }, children: [], comments
  };

  test('only the latest 3 comment bodies, capped, plus the latest ruling wherever it sits', () => {
    const view = formatSelectorView(issue, context);
    assert.match(view, /Latest 3 of 5 comments/);
    assert.doesNotMatch(view, /Older note one\./);
    assert.match(view, /Newer note two\./);
    assert.match(view, /Newest note\./);
    assert.doesNotMatch(view, /y{2001}/, 'a comment is capped');
    assert.match(view, /Latest ruling recorded via Harbour[^\n]*\n+Ruling: plan first\./);
  });

  test('the ticket, its labels and relations stay; the worker-only nudge and cousins go', () => {
    const view = formatSelectorView(issue, context);
    for (const part of ['**Issue:** LIN-1 - A task', '**State:** In Progress (started)', '**Labels:** bug', '**Project:** Harbour',
      '**Parent Task:** LIN-0 - Epic', 'LIN-4: s (Todo)', '**Blocked by (open):** LIN-2', '**Blockers already resolved:** LIN-3', '**Description:** Do it.']) {
      assert.ok(view.includes(part), `keeps ${part}`);
    }
    assert.doesNotMatch(view, /fetch the parent epic/i);
    assert.doesNotMatch(view, /cousin/i);
    assert.match(view, /8 siblings not shown/);
  });

  test('formatIssueContext is unchanged for its other consumers', () => {
    const full = formatIssueContext(issue, context);
    assert.match(full, /Older note one\./);
    assert.match(full, /fetch the parent epic's full child list/);
  });

  test('a ruling among the latest 3 is not shown twice', () => {
    const view = formatSelectorView(issue, { ...context, comments: comments.slice(0, 2) });
    assert.match(view, /Latest 2 of 2 comments/);
    assert.doesNotMatch(view, /Latest ruling recorded via Harbour/);
  });
});
