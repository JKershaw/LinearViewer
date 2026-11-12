/**
 * LIN-4438 (piece 3 of LIN-4396): close-out waits on a recorded blind read.
 *
 * The shared-trail table drives the same trails through every place that decides close-out readiness
 * and checks they agree. Five lanes:
 *   - route: lib/openrouter.js codeRouteOf, through getRecommendation (the selector stubbed to answer
 *     `close-out` when the code routes stand aside);
 *   - state: deriveCloseOutState for a stop-at-PR run, through readCloseOutChain (the check route's chain);
 *   - box: buildRunEvidence, the task page's close-out box;
 *   - guard, stop-at lane: closeOutNotReady on a stop-at-PR task;
 *   - guard, ladder lane: closeOutNotReady on an ordinary task.
 * A future place that decides readiness without closeOutWaitsOn and landingPrUrls disagrees with a row.
 *
 * Rows 14 and 15 write their expected landing down, so the behaviour is chosen, not found. Both pin a
 * known skew between landingPrUrls and the other landing readers (a notes PR beside its merged landing,
 * a foreign PR cited before the first review); docs/areas/runs-and-dispatch.md carries it as a Waiting
 * entry, so the pin is not read as a design.
 *
 * Run with: node --test tests/unit/lin-4438-blind-read-gate.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendation, setFetchImpl, setPromptTraceRecorder } from '../../lib/openrouter.js';
import { readCloseOutChain, closeOutNotReady } from '../../lib/close-out-readiness.js';
import { buildRunEvidence } from '../../lib/run-evidence.js';
import { closeOutWaitsOn } from '../../lib/run-closeout-state.js';
import { landingPrUrls } from '../../lib/run-ledger.js';
import { assembleTrailFacts, isAgentNote, isPersonComment } from '../../lib/recommendation-facts.js';
import { blindReadStep, BLIND_READ_ATTEMPT_BOUND } from '../../lib/recommendation-blind-read.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { SURVEY_HEADINGS } from '../../lib/prompts/survey-words.js';

afterEach(() => { setFetchImpl(null); setPromptTraceRecorder(null); });

const REPO = 'acme/widget';
const PR = (n) => `https://github.com/${REPO}/pull/${n}`;
const PR1 = PR(41);
const PR2 = PR(42);
const PR_OLD = PR(40);
const FOREIGN = 'https://github.com/other/repo/pull/7';
const REVIEWED = 'aaaaaaa1111111';

const T = (n) => `2026-11-12T${String(n).padStart(2, '0')}:00:00.000Z`;
const c = (n, body) => ({ id: `c${n}`, body, createdAt: T(n), user: 'agent' });
const summary = (n, url = PR1) => c(n, `Implementation done: ${url}, CI green.`);
const review = (n, verdict = 'Approve', url = PR1) => c(n, `## Code Review\n\nReviewed head \`${REVIEWED}\` of ${url}.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | a repro |\n\n**Verdict: ${verdict}**`);
const read = (n, ...urls) => c(n, `## Blind read\nVerdict: same. It gave the gate one owner in lib/run-closeout-state.js and left nothing worse.\n\nRead: ${urls.join(', ')} at \`${REVIEWED.slice(0, 9)}\` against \`000000000\`.\n\n### Inside the area, fix-sized\nNone.`);
const closeOut = (n, body) => c(n, `## Close-out\n\n${body}`);
// Row 11's link comment: the shape close-out's not-ready sentence asks for (no heading; a first line
// naming the PR that opens with none of Close-out, Autopilot, Plan or Revision).
const LINK_BODY = `PR to merge: ${PR2}`;
const link = (n) => c(n, LINK_BODY);
const audit = (n) => c(n, `## Retrospective audit — LIN-1\n\nThe landing ${PR1} holds; one note entry is wrong. Notes PR: ${PR2}.`);
const research = (n) => c(n, `## Research notes\n\nAn earlier attempt elsewhere is ${FOREIGN}; this ticket starts fresh.`);

const STARTED = { name: 'In Progress', type: 'started' };
const DONE = { name: 'Done', type: 'completed' };
const run = (stage, n, outcome = 'done') => ({ stage, at: T(n), outcome, dispatchedAt: T(n), id: `r${n}` });

const open = (number, sha = REVIEWED) => ({ readable: true, repo: REPO, number, state: 'open', merged: false, head: { ref: 'f', sha }, ref: sha, checks: [] });
const merged = (number) => ({ ...open(number), state: 'closed', merged: true });

/**
 * The table. `route`: what codeRouteOf sends ('blind-read', 'blocked') or 'aside' (the selector is
 * asked). `gate`: 'wait' (every guard refuses blind-read-missing; the state and the box are not ready)
 * or 'admit' (no lane refuses on the gate). `merged`: PR numbers GitHub reports merged.
 */
const ROWS = [
  { n: 1, name: 'approve, no read', comments: [summary(1), review(2)], route: 'blind-read', gate: 'wait' },
  { n: 2, name: 'approve, then a read naming the PR', comments: [summary(1), review(2), read(3, PR1)], route: 'aside', gate: 'admit', ready: true },
  { n: 3, name: 'a read naming an older PR only', comments: [summary(1), review(2), read(3, PR_OLD)], route: 'blind-read', gate: 'wait' },
  { n: 4, name: 'a read, then a new review', comments: [summary(1), review(2), read(3, PR1), review(4)], route: 'blind-read', gate: 'wait' },
  { n: 5, name: 'request changes', comments: [summary(1), review(2, 'Request Changes')], route: 'aside', gate: 'admit' },
  { n: 6, name: 'two ended attempts, runs known', comments: [summary(1), review(2)], allRuns: [run('review', 2), run('blind-read', 3, 'done'), run('blind-read', 4, 'failed')], route: 'blocked', gate: 'wait' },
  { n: 7, name: 'runs unknown', comments: [summary(1), review(2)], allRuns: null, route: 'blind-read', gate: 'wait' },
  { n: 8, name: 'no PR on the trail', comments: [c(1, 'Implementation done, CI green.'), review(2, 'Approve', 'the change')], route: 'aside', gate: 'admit' },
  { n: 9, name: 'no review', comments: [summary(1)], route: 'aside', gate: 'admit' },
  { n: 10, name: 'approve, then a not-ready close-out citing the PR', comments: [summary(1), review(2), closeOut(3, `Not ready: no blind read yet for ${PR1}. Next: blind-read.`)], route: 'blind-read', gate: 'wait' },
  { n: 11, name: 'approve, then a plain link comment naming a new PR', comments: [summary(1), review(2), link(3)], route: 'aside', gate: 'wait' },
  { n: 12, name: 'approve, a read, then a merging close-out on a Done ticket', state: DONE, comments: [summary(1), review(2), read(3, PR1), closeOut(4, `Merged ${PR1}; set Done.`)], merged: [41], route: 'aside', gate: 'admit' },
  { n: 13, name: 'approve, a not-ready close-out, a fix round re-naming the PR, then a re-review', comments: [summary(1), review(2), closeOut(3, `Not ready: CI red on ${PR1}. Next: implementation.`), summary(4), review(5)], route: 'blind-read', gate: 'wait' },
  { n: 14, name: 'a Done ticket: landing close-out, then an audit notes PR and its own review', state: DONE, comments: [summary(1), review(2), read(3, PR1), closeOut(4, `Merged ${PR1}; set Done.`), audit(5), review(6, 'Approve', PR2)], merged: [41], route: 'blind-read', gate: 'wait', landing: [PR1, PR2] },
  { n: 15, name: 'a pre-review comment cites a foreign PR by full URL', comments: [research(1), summary(2), review(3), read(4, PR1)], route: 'blind-read', gate: 'wait', landing: [FOREIGN, PR1] },
];

const SELECTOR_REPLY = { choices: [{ message: { content: '## Reasoning\n→ **close-out**' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } };
const context = (row) => ({ parent: null, siblings: [], project: null, children: [], comments: row.comments, focusedChild: null, attachments: [], runs: [], allRuns: Object.hasOwn(row, 'allRuns') ? row.allRuns : [] });
const issueOf = (row) => ({ identifier: 'LIN-1', title: 'Gate fixture', description: '', state: row.state || STARTED, labels: [] });

function statusFor(row, url) {
  const number = Number(url.split('/').pop());
  return (row.merged || []).includes(number) ? merged(number) : open(number);
}

function seamFor(row, stopAt) {
  return {
    resolveProvider: () => ({ provider: { name: 'local', async fetchIssueComments() { return row.comments; } }, callScope: 'scope' }),
    readPrStatus: async ({ repo, number }) => statusFor(row, `https://github.com/${repo}/pull/${number}`),
    isStopAtRun: async () => stopAt
  };
}

async function routeLane(row) {
  setPromptTraceRecorder(() => {});
  setFetchImpl(async () => ({ ok: true, json: async () => SELECTOR_REPLY }));
  const rec = await getRecommendation(issueOf(row), context(row), { apiKey: 'stub', model: 'x' });
  if (rec.codeRoute === 'blind-read' || rec.codeRoute === 'blocked') {
    assert.equal(rec.recommendedAction, rec.codeRoute, `row ${row.n}: the code route sends its own step`);
    return rec.codeRoute;
  }
  assert.equal(rec.codeRoute, undefined, `row ${row.n}: no other code route fires`);
  return 'aside';
}

async function lanes(row) {
  const workspace = { urlKey: 'acme' };
  const { state } = await readCloseOutChain({ workspace, issueIdentifier: 'LIN-1', seam: seamFor(row, 'pr'), stopAt: 'pr', runnerReady: true, owner: true, byPersonCheck: false, prStatusCache: new Map() });
  const urls = [...new Set(row.comments.flatMap(x => x.body.match(/https:\/\/github\.com\/\S+?\/pull\/\d+/g) || []))];
  const box = buildRunEvidence({ issueIdentifier: 'LIN-1', comments: row.comments, prStatus: urls.length === 1 ? statusFor(row, urls[0]) : null, stopAt: 'pr', runnerReady: true, owner: true }).closeOut;
  const stopAtGuard = await closeOutNotReady({ workspace, issueIdentifier: 'LIN-1', seam: seamFor(row, 'pr') });
  const ladderGuard = await closeOutNotReady({ workspace, issueIdentifier: 'LIN-1', seam: seamFor(row, null) });
  return { route: await routeLane(row), state, box, stopAtGuard, ladderGuard };
}

/** A box or state model that does not advertise a close-out the gate refuses. */
function notReadyForGate(model) {
  return model.ready === false && (model.reason === 'blind-read-missing' || ['merged', 'partial'].includes(model.status));
}

describe('the shared-trail table: every lane agrees (LIN-4438)', () => {
  for (const row of ROWS) {
    test(`row ${row.n}: ${row.name} → route ${row.route}, gate ${row.gate}`, async () => {
      const got = await lanes(row);
      assert.equal(got.route, row.route, `row ${row.n}: route`);
      if (row.gate === 'wait') {
        assert.equal(got.stopAtGuard?.reason, 'blind-read-missing', `row ${row.n}: the stop-at guard refuses`);
        assert.equal(got.ladderGuard?.reason, 'blind-read-missing', `row ${row.n}: the ladder guard refuses`);
        assert.ok(notReadyForGate(got.state), `row ${row.n}: the stop-at state is not ready: ${got.state.status}/${got.state.reason}`);
        assert.ok(notReadyForGate(got.box), `row ${row.n}: the page box is not ready: ${got.box.status}/${got.box.reason}`);
      } else {
        assert.equal(got.stopAtGuard, null, `row ${row.n}: the stop-at guard admits`);
        assert.equal(got.ladderGuard, null, `row ${row.n}: the ladder guard admits`);
        assert.notEqual(got.state.reason, 'blind-read-missing', `row ${row.n}: state`);
        assert.notEqual(got.box.reason, 'blind-read-missing', `row ${row.n}: box`);
      }
      if (row.ready) {
        assert.equal(got.state.status, 'ready', `row ${row.n}: the state is ready`);
        assert.equal(got.box.status, 'ready', `row ${row.n}: the box is ready`);
      }
      if (row.landing) assert.deepEqual([...landingPrUrls(row.comments)].sort(), [...row.landing].sort(), `row ${row.n}: the landing, written down`);
    });
  }
});

describe('rows that need more than the lanes', () => {
  test('row 11: the plain link comment is work after review, not an agent note or a person; the predicate waits', () => {
    const row = ROWS.find(r => r.n === 11);
    assert.equal(isAgentNote(LINK_BODY), false, 'never an AGENT_NOTE_RE opening, so it counts as landing work');
    assert.equal(isPersonComment(LINK_BODY), false, 'never read as a person waiting for an answer');
    const facts = assembleTrailFacts(row.comments, '', { leaf: false });
    assert.equal(facts.workAfterReview, true, 'the selector facts show work after review');
    assert.equal(facts.closeOutAfterReview, false);
    assert.equal(closeOutWaitsOn(facts.review, landingPrUrls(row.comments)), 'blind-read');
    assert.deepEqual(landingPrUrls(row.comments), [PR1, PR2]);
  });

  test('row 14: the audit re-cites the merged landing PR, so the notes PR\'s read must name both (the skew, pinned)', () => {
    const row = ROWS.find(r => r.n === 14);
    const facts = assembleTrailFacts(row.comments, '', { leaf: false });
    assert.equal(closeOutWaitsOn({ ...facts.review, blindRead: { prs: [PR2] } }, landingPrUrls(row.comments)), 'blind-read', 'a read of the notes PR alone does not clear it');
    assert.equal(closeOutWaitsOn({ ...facts.review, blindRead: { prs: [PR1, PR2] } }, landingPrUrls(row.comments)), null);
    const prompt = generatePrompt('blind-read', issueOf(row), context(row)).prompt;
    assert.ok(prompt.includes(`**The change:** ${PR1}, ${PR2}`), 'the reader is told to read both');
  });

  test('row 15: piece 2\'s landingPrUrls keeps a foreign PR cited before the first review in a first landing', () => {
    const row = ROWS.find(r => r.n === 15);
    assert.deepEqual(landingPrUrls(row.comments), [FOREIGN, PR1]);
  });
});

describe('the route\'s own edges', () => {
  const approved = [summary(1), review(2)];

  test('a Canceled or Duplicate ticket stands aside; a Done ticket with no close-out after the review does not', () => {
    for (const type of ['canceled', 'duplicate']) {
      assert.equal(blindReadStep({ state: { type } }, { comments: approved, allRuns: [] }), null, type);
    }
    assert.equal(blindReadStep({ state: DONE }, { comments: approved, allRuns: [] }).step, 'blind-read');
    assert.equal(blindReadStep({ state: DONE }, { comments: [summary(1), review(2), closeOut(3, `Merged ${PR1}; set Done.`)], allRuns: [] }), null, 'Done, closed out after the review, no read: stands aside');
  });

  test('a live blind read is not an ended attempt; runs before the review do not count', () => {
    assert.equal(BLIND_READ_ATTEMPT_BOUND, 2);
    const step = (allRuns) => blindReadStep({ state: STARTED }, { comments: approved, allRuns }).step;
    assert.equal(step([run('blind-read', 3, 'done')]), 'blind-read', 'one ended attempt');
    assert.equal(step([run('blind-read', 3, 'done'), run('blind-read', 4, 'running')]), 'blind-read', 'one ended, one live');
    assert.equal(step([run('blind-read', 0, 'done'), run('blind-read', 1, 'failed'), run('blind-read', 3, 'done')]), 'blind-read', 'two before the review');
    for (const outcome of ['skipped', 'aborted', 'closed', 'waiting on a person']) {
      assert.equal(step([run('blind-read', 3, 'done'), run('blind-read', 4, outcome)]), 'blocked', outcome);
    }
  });

  test('the route reads the ledger whole: a read written before the review is not its read', () => {
    assert.equal(blindReadStep({ state: STARTED }, { comments: [summary(1), read(2, PR1), review(3)], allRuns: [] }).step, 'blind-read');
  });
});

describe('a Survey report is not landing work, for the trail facts as for landingPrUrls (LIN-4438 leftovers)', () => {
  const survey = (n) => c(n, `${SURVEY_HEADINGS['survey-task']}: LIN-1 @ abc123def\n\nAn earlier attempt is ${PR_OLD}; start from it.`);

  test('a Survey after the review is not work after review, and the landing skips it', () => {
    const comments = [summary(1), review(2), survey(3)];
    assert.equal(assembleTrailFacts(comments, '', { leaf: false }).workAfterReview, false);
    assert.deepEqual(landingPrUrls(comments), [PR1]);
  });

  test('a Survey after a plan-review verdict is not landed work', () => {
    const verdict = c(1, '### Plan Review Verdict\n\n**Verdict:** Request Changes. 2 blocking findings.');
    assert.equal(assembleTrailFacts([verdict, survey(2)], '').planReview.landed, null);
  });
});
