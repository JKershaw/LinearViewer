/**
 * LIN-3300: what the stage selector decides from.
 *
 * - Trail facts computed in code from the WHOLE trail: the latest code review
 *   (run-ledger's reader, so a plan-review verdict or a bug write-up is never one),
 *   work and close-out reported after it, the PRs linked, the latest person's comment and
 *   ruling, and for a leaf the plan facts (LIN-4504: from records, passed in; never ticket text).
 * - The selector's own view of the ticket: title, state, labels, relations, the
 *   description without its old plan section (LIN-4504), the latest 3 comments (capped) and the
 *   latest ruling wherever it sits. Older comment bodies and the worker-only epic-list
 *   nudge are not in it, and formatIssueContext (brief, recap, scan, task chat) is
 *   unchanged.
 *
 * Run with: node --test tests/unit/stage-selector-input.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assembleTrailFacts, formatTrailFactsBlock } from '../../lib/recommendation-facts.js';
import { planFactsOf } from '../../lib/records/plan-facts.js';
import { planReviewRunOf } from '../../lib/records/plan-review-run.js';
import { RULING_MARK } from '../../lib/run-trail.js';
import { personFindingsOf } from '../../lib/comment-ingest.js';
import { fixedIdOf } from '../../lib/records/refs.js';
import { formatSelectorView, formatIssueContext, buildSelectorArgs } from '../../lib/openrouter.js';

const at = (d) => `2026-10-0${d}T10:00:00.000Z`;
const PR = 'https://github.com/JKershaw/LinearViewer/pull/1747';
// LIN-4535: a person's comment is its finding (lib/comment-ingest.js personFindingsOf). The facts read findings, never a
// comment's words: a comment that reads like an agent's note is still a person's when it has a person's finding.
const personFinding = (d, says) => personFindingsOf([{ id: `finding-${d}`, by: 'person:john', via: 'comment', at: at(d), fields: { says } }])[0];
// The finding a comment's id makes (lib/comment-ingest.js: fixedIdOf('finding', 'comment', commentId)).
const findingFor = (commentId, d, says) => personFindingsOf([{ id: fixedIdOf('finding', 'comment', commentId), by: 'person:john', via: 'comment', at: at(d), fields: { says } }]);

const review = (verdict, d) => ({ createdAt: at(d), body: `## Review — LIN-1\n\nReviewed ${PR}.\n\n### Verdict\n${verdict}\n\n### What CI Did Not Prove\n- L1 (inside): the live run.` });
const planReview = (d) => ({ createdAt: at(d), body: '### Plan Review Verdict\n\n**Verdict:** Approve.' });
// LIN-4520: the review, its work and close-out facts are records: the trail a records read gives (lib/task-standing.js
// trailForTicket). The comments still carry the PR links and the person's words; a trail is passed in beside them.
const trailOf = ({ review = null, ...facts } = {}) => ({
  review, landing: [], workAfterReview: false, closeOutAfterReview: false, closeOutOnTrail: false,
  landingHasNotesPr: false, notesPrs: [], auditAfterCloseOut: false, ...facts,
});
const reviewOf = (outcome, d) => ({ verdict: outcome, at: at(d), sha: null, heads: {}, commentId: `review-${d}`, blindRead: null, staleUrls: [] });
// LIN-4504: plan facts are records, folded by lib/records/plan-facts.js.
const TASK = { id: 'task-1', kind: 'task', state: 'open' };
const planRec = (id, to, v = 1, d = 1) => ({ id, v, kind: 'plan', state: 'kept', in: 'task-1', to, at: at(d) });
const PLANNED = (to, findings = []) => planFactsOf({ task: TASK, inside: [planRec('plan-aa', to)], findings });

describe('trail facts (LIN-3300)', () => {
  test('the latest code review is the records review; a plan-review Approve is not one', () => {
    const facts = assembleTrailFacts([planReview(1)], '', { trail: trailOf() });
    assert.equal(facts.review, null);
    const withReview = assembleTrailFacts([planReview(1), review('Request Changes.', 2)], '', { trail: trailOf({ review: reviewOf('request-changes', 2) }) });
    assert.equal(withReview.review.verdict, 'request-changes');
    assert.equal(withReview.review.openFindings.state, 'not-read', 'the findings come from the records, passed in: not measured by default');
    assert.equal(withReview.workAfterReview, false);
  });

  // LIN-4520: work after the review is the records' fact (a change recorded after the review), not a comment's: a later
  // comment that links a PR no longer makes it, and the trail's fact is what the selector reads.
  test('work after the review is the records fact: a comment linking a PR does not make it; the trail\'s fact does', () => {
    const fixes = [review('Request Changes.', 1), { createdAt: at(2), body: `## Review fixes landed — PR updated\n\n${PR}` }];
    const unrecorded = assembleTrailFacts(fixes, '', { trail: trailOf({ review: reviewOf('request-changes', 1) }) });
    assert.equal(unrecorded.workAfterReview, false, 'no change is recorded after the review: the comment is not the fact');
    const fixed = assembleTrailFacts(fixes, '', { trail: trailOf({ review: reviewOf('request-changes', 1), workAfterReview: true }) });
    assert.equal(fixed.workAfterReview, true);
    const closed = assembleTrailFacts([review('Approve.', 1), { createdAt: at(2), body: `## Close-out — LIN-1\n\nMerged ${PR}.` }], '', { trail: trailOf({ review: reviewOf('approve', 1), closeOutAfterReview: true }) });
    assert.equal(closed.workAfterReview, false);
    assert.equal(closed.closeOutAfterReview, true);
  });

  test('PR links are the trail landing, oldest first, never a comment\'s text; the latest person and ruling are the latest person findings', () => {
    const facts = assembleTrailFacts([
      { createdAt: at(3), body: `Go to implementation.\n\n${RULING_MARK}` },
      { createdAt: at(1), body: `Opened https://github.com/a/b/pull/1` },
      { createdAt: at(2), body: `Hold.\n\n${RULING_MARK}` },
      { createdAt: at(4), body: `Now ${PR}` }
    ], '', { trail: trailOf({ landing: ['https://github.com/a/b/pull/1', PR] }), personFindings: [personFinding(2, `Hold.\n\n${RULING_MARK}`), personFinding(3, `Go to implementation.\n\n${RULING_MARK}`)] });
    assert.deepEqual(facts.prUrls, ['https://github.com/a/b/pull/1', PR]);
    assert.deepEqual(assembleTrailFacts([{ createdAt: at(1), body: `Opened ${PR}` }], '').prUrls, [], 'no trail read: no PR, and a comment does not supply one');
    assert.equal(facts.latestPerson.at, at(3));
    assert.equal(facts.latestPerson.ruling, true);
    assert.equal(facts.latestRuling.at, at(3));
  });

  test('a ruling is a finding whose words end with the mark; a quote of the mark mid-text is a person\'s words, not a ruling', () => {
    assert.equal(personFinding(1, `Go.\n\n${RULING_MARK}\n`).ruling, true, 'trailing whitespace is fine');
    assert.equal(personFinding(1, `Quotes "${RULING_MARK}" mid-text.`).ruling, false);
    const facts = assembleTrailFacts([{ createdAt: at(1), body: 'x' }, { createdAt: at(2), body: 'y' }], '', {
      personFindings: [personFinding(1, `Quotes "${RULING_MARK}" mid-text.`), personFinding(2, 'Plain words.')]
    });
    assert.equal(facts.latestPerson.at, at(2));
    assert.equal(facts.latestPerson.ruling, false);
    assert.equal(facts.latestRuling, null, 'no ruling: the quote does not make one');
  });

  test('no person finding means no latest person, even when a comment reads like a person\'s words', () => {
    const facts = assembleTrailFacts([{ createdAt: at(1), body: 'Go on with the narrow revision.' }], '', { personFindings: [] });
    assert.equal(facts.latestPerson, null);
  });

  test('a person\'s finding whose words look like an agent note is still the person\'s', () => {
    const facts = assembleTrailFacts([
      { createdAt: at(1), body: '**Last round before re-review (FC, an engineering call):**\n- land F1.' }
    ], '', { personFindings: [personFinding(1, '**Last round before re-review (FC, an engineering call):**\n- land F1.')] });
    assert.equal(facts.latestPerson.at, at(1));
    assert.equal(facts.latestPerson.ruling, false);
  });

  test('actedAfter: a dispatched run after the person\'s finding; a run before it does not count', () => {
    const finding = personFinding(2, 'Take the narrow revision.');
    const after = assembleTrailFacts([], '', { personFindings: [finding], runTimes: [Date.parse(at(3))] });
    assert.equal(after.latestPerson.actedAfter, true, 'a run dispatched after the finding');
    const before = assembleTrailFacts([], '', { personFindings: [finding], runTimes: [Date.parse(at(1))] });
    assert.equal(before.latestPerson.actedAfter, false, 'a run dispatched before the finding is not acting on it');
    const unknown = assembleTrailFacts([], '', { personFindings: [finding], runTimes: null });
    assert.equal(unknown.latestPerson.actedAfter, false);
  });

  test('a landing report in a comment is not landed work; a change record version written after the finding is', () => {
    const reportOnly = assembleTrailFacts([
      { createdAt: at(2), body: `## Review fixes landed — PR updated\n\n${PR}` }
    ], '', { personFindings: [personFinding(1, 'Addendum: two more items for this round.')] });
    assert.equal(reportOnly.latestPerson.actedAfter, false, 'a landing report in a comment is not landed work');
    const landed = assembleTrailFacts([
      { createdAt: at(2), body: `## Review fixes landed — PR updated\n\n${PR}` }
    ], '', { personFindings: [personFinding(1, 'Addendum: two more items for this round.')], planReviewRun: planReviewRunOf({ changes: [{ at: at(3), fields: { ref: PR } }] }) });
    assert.equal(landed.latestPerson.actedAfter, true, 'a change record version written after it is landed work');
  });

  test('TRAIL FACTS names the latest person\'s finding, whether it is a ruling, and whether a run was dispatched after it', () => {
    const withRuling = formatTrailFactsBlock(assembleTrailFacts([], '', { personFindings: [personFinding(3, `Go.\n\n${RULING_MARK}`)] }), 1);
    assert.match(withRuling, /- Latest person's comment[^:]*: 2026-10-03 10:00, a ruling recorded via Harbour \(shown with the comments\); a run was dispatched after it, or landed work followed: no/);
    assert.match(formatTrailFactsBlock(assembleTrailFacts([], '', { personFindings: [] }), 0), /- Latest person's comment[^:]*: none/);
    assert.match(formatTrailFactsBlock(assembleTrailFacts([], ''), 0), /- Latest person's comment[^:]*: not measured/, 'no findings read: not measured, never none');
    assert.equal(assembleTrailFacts([], '').personRead, false);
  });

  // LIN-4533: a stage run posts no comment, so its PR is on its change record: the selector reads the trail's landing, and a PR
  // named only in a comment is not on the trail.
  test('PRs on the trail come from the records landing, never from comment text', () => {
    const OTHER = 'https://github.com/JKershaw/LinearViewer/pull/2502';
    const comments = [{ createdAt: at(2), body: `Implementation done: ${OTHER}` }];
    const landed = formatTrailFactsBlock(assembleTrailFacts(comments, '', { trail: trailOf({ review: reviewOf('request-changes', 1), landing: [PR] }) }));
    assert.match(landed, /PRs linked on the trail: https:\/\/github\.com\/JKershaw\/LinearViewer\/pull\/1747$/m);
    assert.doesNotMatch(landed, /pull\/2502/);
    const onlyComment = formatTrailFactsBlock(assembleTrailFacts(comments, '', { trail: trailOf() }));
    assert.match(onlyComment, /PRs linked on the trail: none/);
    assert.match(formatTrailFactsBlock(assembleTrailFacts(comments, '', { trail: trailOf({ landing: [OTHER] }) })), /PRs linked on the trail: https:\/\/github\.com\/JKershaw\/LinearViewer\/pull\/2502$/m);
  });

  // LIN-4520: the agent notes and the unheaded close-out are not work: the trail (records) decides, and the comments do not.
  test('work after the review ignores agent notes and an unheaded close-out', () => {
    const facts = assembleTrailFacts([
      review('Approve.', 1),
      { createdAt: at(2), body: `**Close-out: PR #1747 merged.** ${PR}` },
      { createdAt: at(3), body: `**Autopilot run summary (stepper): P0 landed.** ${PR}` }
    ], '', { trail: trailOf({ review: reviewOf('approve', 1), closeOutAfterReview: true }) });
    assert.equal(facts.workAfterReview, false);
    assert.equal(facts.closeOutAfterReview, true);
  });

  test('LIN-4504: a plan posted as a comment, or written in the description, is not read: the facts are the records', () => {
    const plan = { createdAt: at(1), body: `**Plan — the migration (technical-planner pass).**\n\nSession-fit: does NOT fit one session. 4 sessions.\n\nplan-review due: yes` };
    const description = 'Goal.\n\n## Implementation Plan\n\nSession fit: does not fit one session.\n\nplan-review due: yes\n';
    const none = planFactsOf({ task: TASK });
    const facts = assembleTrailFacts([plan], description, { leaf: true, planFacts: none });
    assert.equal(facts.plan, none);
    const block = formatTrailFactsBlock(facts, 1);
    assert.match(block, /- Plan records on this task: none/);
    assert.match(block, /- Session fit \(the plan records' addressee\): none/);
    assert.match(block, /- Plan review owed: no/);
  });

  test('a leaf gets its plan facts from records: addressee, version, last change and whether a review is owed', () => {
    const one = assembleTrailFacts([], 'Goal.', { leaf: true, planFacts: PLANNED('implementation') });
    const block = formatTrailFactsBlock(one, 0);
    assert.match(block, /- Plan records on this task: plan-aa v1 to implementation \(changed 2026-10-01 10:00\)/);
    assert.match(block, /- Session fit \(the plan records' addressee\): one session \(addressed to implementation\)/);
    assert.match(block, /- Plan review owed: no/);
    const several = formatTrailFactsBlock(assembleTrailFacts([], 'Goal.', { leaf: true, planFacts: PLANNED('breakdown') }), 0);
    assert.match(several, /several sessions \(a plan is addressed to breakdown\)/);
    assert.match(several, /- Plan review owed: yes \(plan-aa is addressed to breakdown and no plan-review finding is about it\)/);
    const asked = PLANNED('implementation', [{ id: 'finding-r1', kind: 'finding', state: 'open', to: 'plan-review', links: { about: ['plan-aa'] } }]);
    assert.match(formatTrailFactsBlock(assembleTrailFacts([], '', { leaf: true, planFacts: asked }), 0), /- Plan review owed: yes \(open finding finding-r1 to plan-review about plan-aa\)/);
    assert.equal(assembleTrailFacts([], 'Goal.', { leaf: false, planFacts: PLANNED('breakdown') }).plan, null, 'a node reads its plan facts in the node facts instead');
  });

  test('plan facts not read say so, and claim no plan', () => {
    const block = formatTrailFactsBlock(assembleTrailFacts([], 'Goal.\n\n## Implementation Plan\n\nfits one session', { leaf: true }), 0);
    assert.match(block, /- Plan records: not measured \(no records read for this trail\); ticket text is not read for a plan/);
    assert.doesNotMatch(block, /Session fit|Plan review owed/);
  });

  test('the block states each fact once and reads the records, not the comments', () => {
    const block = formatTrailFactsBlock(assembleTrailFacts([review('Approve — conditional on close-out.', 1)], 'x', { leaf: true, trail: trailOf({ review: reviewOf('approve', 1), landing: [PR] }) }));
    assert.match(block, /TRAIL FACTS \(computed in code from the ticket's records — do not re-derive\)/);
    assert.match(block, /Latest code review: approve \(/);
    assert.match(block, /Work reported after it \(a later comment links a PR\): no/);
    assert.match(block, /PRs linked on the trail: https:\/\/github\.com\/JKershaw\/LinearViewer\/pull\/1747/);
    assert.match(block, /- Plan records: not measured/);
    const none = formatTrailFactsBlock(assembleTrailFacts([], '', { leaf: false, trail: trailOf() }));
    assert.match(none, /Latest code review: none/);
    assert.doesNotMatch(none, /Plan records/);
  });
});

describe('LIN-4504: the selector view and the kept section leave the old plan section out', () => {
  const description = ['Intro to the ticket.', '', '## Implementation Plan', '', 'Old plan words.', '', '### Session fit', '', 'Old fit words.', '', '## After the plan', '', 'Kept whole.'].join('\n');
  const issue = { identifier: 'LIN-1', title: 'A task', state: { name: 'Todo', type: 'unstarted' }, labels: [], description };

  test('formatSelectorView: the section and its subsections go, text around it stays', () => {
    const view = formatSelectorView(issue, {});
    assert.match(view, /\*\*Description:\*\* Intro to the ticket\.\n\n## After the plan\n\nKept whole\./);
    assert.doesNotMatch(view, /Old plan words|Old fit words|Implementation Plan/);
  });

  test('formatIssueContext (the brief\'s kept section, recap, scan, task chat) does the same', () => {
    const ctx = formatIssueContext(issue, {});
    assert.match(ctx, /Intro to the ticket\.\n\n## After the plan\n\nKept whole\./);
    assert.doesNotMatch(ctx, /Old plan words|Implementation Plan/);
  });

  test('a description that is only a plan leaves no Description line; one with no plan is unchanged', () => {
    assert.doesNotMatch(formatSelectorView({ ...issue, description: '## Implementation Plan\n\nonly' }, {}), /Description/);
    assert.match(formatSelectorView({ ...issue, description: 'No plan here.' }, {}), /\*\*Description:\*\* No plan here\./);
  });
});

describe('the selector view (LIN-3300)', () => {
  const issue = {
    identifier: 'LIN-1', title: 'A task', state: { name: 'In Progress', type: 'started' }, labels: ['bug'],
    description: 'Do it.', createdAt: at(1), updatedAt: at(2),
    blockedBy: [{ identifier: 'LIN-2', title: 'b', state: { name: 'Todo', type: 'unstarted' } }, { identifier: 'LIN-3', title: 'c', state: { name: 'Done', type: 'completed' } }]
  };
  const comments = [
    { user: 'John', commentId: 'c1', createdAt: at(1), body: `Ruling: plan first.\n\n${RULING_MARK}` },
    { user: 'Agent', createdAt: at(2), body: 'Older note one.' },
    { user: 'Agent', createdAt: at(3), body: 'Newer note two.' },
    { user: 'Agent', createdAt: at(4), body: 'y'.repeat(2500) },
    { user: 'Agent', createdAt: at(5), body: 'Newest note.' }
  ];
  const context = {
    parent: { identifier: 'LIN-0', title: 'Epic', state: { name: 'In Progress' } }, parentChildCount: 30,
    siblings: [{ identifier: 'LIN-4', title: 's', state: { name: 'Todo' } }], siblingsTotal: 9,
    cousins: [{ identifier: 'LIN-5', title: 'cousin', state: { name: 'Todo' } }], cousinsTotal: 40,
    project: { name: 'Harbour' }, children: [], comments,
    // LIN-4535: the person's findings, keyed by the comment's fixed id (the ingest's rule); the selector reads these, not the words.
    personFindings: findingFor('c1', 1, `Ruling: plan first.\n\n${RULING_MARK}`)
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

  test('a comment that only quotes the mark is never shown as the latest ruling', () => {
    const quoting = { user: 'John', commentId: 'c6', createdAt: at(6), body: `### Plan Review Verdict\n\nThe suffix "${RULING_MARK}" is quoted here.\n\n**Verdict:** Request Changes.` };
    const view = formatSelectorView(issue, { ...context, personFindings: [...context.personFindings, ...findingFor('c6', 6, quoting.body)], comments: [...comments, ...[7, 8, 9].map(d => ({ user: 'A', createdAt: `2026-10-0${d}T10:00:00.000Z`, body: `n${d}` })), quoting].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
    assert.match(view, /Latest ruling recorded via Harbour[^\n]*\n+Ruling: plan first\./, 'the real ruling, not the quoting verdict');
  });

  test('a ruling among the latest 3 is not shown twice', () => {
    const view = formatSelectorView(issue, { ...context, comments: comments.slice(0, 2) });
    assert.match(view, /Latest 2 of 2 comments/);
    assert.doesNotMatch(view, /Latest ruling recorded via Harbour/, 'not repeated above the comments');
    assert.match(view, /\*\*John, the latest person's comment \(a ruling recorded via Harbour\)\*\*/, 'the latest person\'s finding is marked where its comment sits; an unfiled comment is not a person\'s');
    assert.equal(view.split('Ruling: plan first.').length, 2, 'shown once');
  });
});

describe('trail facts: the misroute fixes (LIN-3378)', () => {
  // LIN-4520: the review's outcome is the records' (approve | request-changes | needs-discussion). A conditional approve is
  // an approve with open findings to close-out, so the comment-era `approve-conditional` word is retired.
  test('d: under an approving review the open findings to close-out are left for close-out to settle; otherwise not settled (LIN-4495)', () => {
    const one = { state: 'read', count: 1, ids: ['finding-aaaaaaaa'] };
    const line = (outcome, reading) => formatTrailFactsBlock(assembleTrailFacts([], '', { openFindings: reading, trail: trailOf({ review: reviewOf(outcome, 1) }) }), 1)
      .split('\n').find(l => l.startsWith('- Latest code review'));
    assert.match(line('approve', one), /Latest code review: approve \(.*open findings to close-out: 1, left for close-out to settle\)/);
    assert.match(line('request-changes', one), /open findings to close-out: 1, not settled\)/);
    assert.match(line('approve', { state: 'read', count: 0, ids: [] }), /open findings to close-out: 0\)/);
    assert.match(line('approve', { state: 'not-read', count: null, ids: [], why: 'x' }), /open findings to close-out: not measured\)/);
  });

  // LIN-4504: part of the parent's plan is a `piece`, never the parent's description.
  const PIECE = planFactsOf({ task: { ...TASK, links: { piece: 'plan-p9' } }, piece: { id: 'plan-p9', v: 2, kind: 'plan', state: 'kept', in: 'task-9', to: 'implementation', at: at(2) } });

  test('c: a leaf with a piece names its parent\'s plan record, reads one session and owes no review', () => {
    const block = formatTrailFactsBlock(assembleTrailFacts([], 'Do step 2.', { leaf: true, planFacts: PIECE }), 0);
    assert.match(block, /- Plan records on this task: none of its own; it is a piece of its parent's plan: plan-p9 v2 to implementation \(changed 2026-10-02 10:00\)/);
    assert.match(block, /one session/);
    assert.match(block, /- Plan review owed: no/);
  });

  test('c: buildSelectorArgs passes the records\' plan facts, and a parent description plan adds nothing', () => {
    const issue = { identifier: 'LIN-10', title: 'Step', description: 'Do step 2.', state: { name: 'Todo', type: 'unstarted' }, labels: [] };
    const parent = { identifier: 'LIN-9', title: 'Epic', description: 'Epic.\n\n## Implementation Plan\n\nDo the steps.' };
    const withPiece = buildSelectorArgs(issue, { parent, children: [], comments: [], planFacts: PIECE });
    assert.match(withPiece.facts, /a piece of its parent's plan: plan-p9/);
    const without = buildSelectorArgs(issue, { parent, children: [], comments: [], planFacts: planFactsOf({ task: TASK }) });
    assert.match(without.facts, /- Plan records on this task: none$/m);
    assert.doesNotMatch(without.facts, /LIN-9/);
    const node = buildSelectorArgs(issue, { parent, children: [{ identifier: 'LIN-11', title: 'c', state: { type: 'unstarted' } }], comments: [], planFacts: PIECE });
    assert.doesNotMatch(node.facts, /Plan records/);
    assert.match(node.facts, /- Session fit \(this task's own plan records\): one session/);
  });
});
