/**
 * LIN-4458 (piece 2 of LIN-4447): characterization tests, written before lib/run-trail.js exists.
 *
 * Two groups:
 *   - PINS: behaviour that holds today and must still hold after the one trail pass lands. They run
 *     now and pass now. Rows 3, 11, 13 and 15 of tests/unit/lin-4438-blind-read-gate.test.js, plus an
 *     agent note that re-cites the reviewed PR.
 *   - THE NEW RULE: behaviour the one trail pass changes on purpose. Written as `todo` before
 *     lib/run-trail.js existed (beat 1, failing output recorded), lifted when it landed: row 14 flips;
 *     an agent note citing a new PR is work after review; an area read carries no landing; readTrail
 *     carries piece 1's fields. The box and the owner's Done check reading the landing stay `todo`
 *     until beat 3 moves their PR input (BEAT_3 below).
 *
 * The rule, as LIN-4458 reads "the PRs first cited after the anchor" (comment on LIN-4447):
 *   - the anchor is today's (the latest close-out before the latest review);
 *   - "first cited" is first-appearance order after the anchor, NOT "never cited anywhere before":
 *     that literal reading empties row 13's landing and `closeOutWaitsOn` then opens the gate on a
 *     re-reviewed PR, which the row-13 pin below catches;
 *   - each comment kind carries the landing its own way: an audit report carries only the PRs it is
 *     the first on the trail to cite (its notes PRs, today's private set in auditAfterLandingCloseOut);
 *     a blind read, a Survey report and an area read carry none.
 * Work after review: a later comment whose kind counts as work and that cites a PR the reviewed
 * landing did not hold (agent notes included), plus today's non-agent landing evidence. Review,
 * close-out, blind read, Survey report and area read never count (row 3 needs the blind-read one).
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4458-trail-characterization.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { closeOutNotReady } from '../../lib/close-out-readiness.js';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { closeOutWaitsOn } from '../../lib/run-closeout-state.js';
import { landingPrUrls } from '../../lib/run-trail.js';
import { assembleTrailFacts } from '../../lib/recommendation-facts.js';
import { blindReadStep } from '../../lib/recommendation-blind-read.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { resolveRunPrRef } from '../../lib/pr-state-store.js';
import { SURVEY_HEADINGS } from '../../lib/prompts/survey-words.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { CloseOutEventsStore } from '../../lib/close-out-events-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { findRouteLayer } from './lib/route-layer.js';
import * as trail from '../../lib/run-trail.js';

// The box and the owner's check take their PR list from the landing in beat 3; until then these run
// as `todo` (they fail today, by design).
const BEAT_3 = 'LIN-4458 beat 3: the box and the owner\'s check take their PRs from the landing';

const REPO = 'acme/widget';
const PR = (n) => `https://github.com/${REPO}/pull/${n}`;
const PR1 = PR(41);
const PR2 = PR(42);
const PR_OLD = PR(40);
const FOREIGN = 'https://github.com/other/repo/pull/7';
const REVIEWED = 'aaaaaaa1111111';

// The builders are lin-4438-blind-read-gate.test.js's, byte for byte, so a row here is that row.
const T = (n) => `2026-11-12T${String(n).padStart(2, '0')}:00:00.000Z`;
const c = (n, body) => ({ id: `c${n}`, body, createdAt: T(n), user: 'agent' });
const summary = (n, url = PR1) => c(n, `Implementation done: ${url}, CI green.`);
const review = (n, verdict = 'Approve', url = PR1) => c(n, `## Code Review\n\nReviewed head \`${REVIEWED}\` of ${url}.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | a repro |\n\n**Verdict: ${verdict}**`);
const read = (n, ...urls) => c(n, `## Blind read\nVerdict: same. It gave the gate one owner in lib/run-closeout-state.js and left nothing worse.\n\nRead: ${urls.join(', ')} at \`${REVIEWED.slice(0, 9)}\` against \`000000000\`.\n\n### Inside the area, fix-sized\nNone.`);
const closeOut = (n, body) => c(n, `## Close-out\n\n${body}`);
const LINK_BODY = `PR to merge: ${PR2}`;
const link = (n) => c(n, LINK_BODY);
const audit = (n) => c(n, `## Retrospective audit — LIN-1\n\nThe landing ${PR1} holds; one note entry is wrong. Notes PR: ${PR2}.`);
const research = (n) => c(n, `## Research notes\n\nAn earlier attempt elsewhere is ${FOREIGN}; this ticket starts fresh.`);
// An agent's own note (AGENT_NOTE_RE in lib/recommendation-facts.js: first line opens `autopilot`).
const agentNote = (n, url) => c(n, `**Autopilot step record — LIN-1.** Fix pushed: ${url}.`);
// An area read (docs/plans/survey/area-read.md): the prose rule says cite `path@sha`, never a PR URL.
const areaRead = (n, url) => c(n, `## Area read: Runs & dispatch @ 4b5001ddf\n\nThe close-out box reads better than it did; an earlier landing was ${url}.`);

const STARTED = { name: 'In Progress', type: 'started' };
const DONE = { name: 'Done', type: 'completed' };

const ROWS = {
  3: [summary(1), review(2), read(3, PR_OLD)],
  11: [summary(1), review(2), link(3)],
  13: [summary(1), review(2), closeOut(3, `Not ready: CI red on ${PR1}. Next: implementation.`), summary(4), review(5)],
  14: [summary(1), review(2), read(3, PR1), closeOut(4, `Merged ${PR1}; set Done.`), audit(5), review(6, 'Approve', PR2)],
  15: [research(1), summary(2), review(3), read(4, PR1)],
};

const facts = (comments) => assembleTrailFacts(comments, '', { leaf: false });
const step = (comments, state = STARTED) => blindReadStep({ state }, { comments, allRuns: [] })?.step ?? null;
const ladderSeam = (comments) => ({
  resolveProvider: () => ({ provider: { name: 'local', async fetchIssueComments() { return comments; } }, callScope: 'scope' }),
  isStopAtRun: async () => null,
});
const ladderGuard = (comments) => closeOutNotReady({ workspace: { urlKey: 'acme' }, issueIdentifier: 'LIN-1', seam: ladderSeam(comments) });

describe('pins: rows that hold today and after the one trail pass (LIN-4458)', () => {
  test('row 3: a read naming an older PR is not work after review; the landing is the reviewed PR; the route sends blind-read', () => {
    const comments = ROWS[3];
    assert.deepEqual(landingPrUrls(comments), [PR1]);
    assert.equal(facts(comments).workAfterReview, false, 'a blind read never counts as work, whatever PR it cites');
    assert.equal(closeOutWaitsOn(facts(comments).review, landingPrUrls(comments)), 'blind-read');
    assert.equal(step(comments), 'blind-read');
  });

  test('row 11: a plain link comment naming a new PR is work after review and joins the landing', () => {
    const comments = ROWS[11];
    assert.deepEqual(landingPrUrls(comments), [PR1, PR2]);
    assert.equal(facts(comments).workAfterReview, true);
    assert.equal(closeOutWaitsOn(facts(comments).review, landingPrUrls(comments)), 'blind-read');
    assert.equal(step(comments), null, 'work after review sends it back to the selector');
  });

  test('row 13: a fix round that re-cites PR1 after a not-ready close-out keeps PR1 in the landing, so the gate holds', async () => {
    const comments = ROWS[13];
    // The literal "never cited before the anchor" reading gives [] here, and closeOutWaitsOn(…, []) is null.
    assert.deepEqual(landingPrUrls(comments), [PR1], 'first-appearance order after the anchor, not first-ever citation');
    assert.equal(closeOutWaitsOn(facts(comments).review, landingPrUrls(comments)), 'blind-read');
    assert.equal(step(comments), 'blind-read');
    assert.equal((await ladderGuard(comments))?.reason, 'blind-read-missing', 'the ladder guard refuses the re-reviewed PR');
  });

  test('row 15: a foreign PR cited before the first review stays in a first landing (a stated limit: no caller holds the repository)', () => {
    assert.deepEqual(landingPrUrls(ROWS[15]), [FOREIGN, PR1]);
  });

  test('row 14 keeps its route and gate: a Done ticket whose notes PR has no read routes blind-read and the gate waits', async () => {
    const comments = ROWS[14];
    assert.equal(step(comments, DONE), 'blind-read');
    assert.equal(closeOutWaitsOn(facts(comments).review, landingPrUrls(comments)), 'blind-read');
    assert.equal((await ladderGuard(comments))?.reason, 'blind-read-missing');
  });

  test('an agent note after review that re-cites the reviewed PR is not work after review', () => {
    const comments = [summary(1), review(2), agentNote(3, PR1)];
    assert.equal(facts(comments).workAfterReview, false, 're-citing the reviewed PR never restarts review');
    assert.equal(step(comments), 'blind-read');
  });
});

describe('the new rule (LIN-4458)', () => {
  test('row 14 flips: the audit re-cites the merged landing PR, so the notes PR\'s landing is the notes PR alone', () => {
    const comments = ROWS[14];
    assert.deepEqual(landingPrUrls(comments), [PR2]);
    const { review: rv } = facts(comments);
    assert.equal(closeOutWaitsOn({ ...rv, blindRead: { prs: [PR2] } }, landingPrUrls(comments)), null, 'a read of the notes PR alone clears it');
    const prompt = generatePrompt('blind-read', { identifier: 'LIN-1', title: 'Gate fixture', description: '', state: DONE, labels: [] },
      { parent: null, siblings: [], project: null, children: [], comments, focusedChild: null, attachments: [], runs: [], allRuns: [] }).prompt;
    assert.ok(prompt.includes(`**The change:** ${PR2}`) && !prompt.includes(`**The change:** ${PR1}`), 'the reader is told to read the notes PR only');
  });

  test('an agent note after review that cites a new PR is work after review (Seams §3.0a fails toward review)', () => {
    const comments = [summary(1), review(2), agentNote(3, PR2)];
    assert.equal(facts(comments).workAfterReview, true);
    assert.equal(step(comments), null, 'no blind read is offered over a PR the approved review never covered');
  });

  test('an area read carries no landing and is not work after review, even when it names a PR', () => {
    const comments = [summary(1), review(2), areaRead(3, PR_OLD)];
    assert.deepEqual(landingPrUrls(comments), [PR1]);
    assert.equal(facts(comments).workAfterReview, false);
    assert.equal(step(comments), 'blind-read');
  });

  test('readTrail returns the fields piece 1 reads, and its landing is landingPrUrls\'s', () => {
    for (const [n, comments] of Object.entries(ROWS)) {
      const got = trail.readTrail(comments);
      for (const key of ['review', 'landing', 'closeOutAfterReview', 'workAfterReview', 'closeOutOnTrail', 'landingHasNotesPr']) {
        assert.ok(Object.hasOwn(got, key), `row ${n}: readTrail carries ${key}`);
      }
      assert.deepEqual(got.landing, landingPrUrls(comments), `row ${n}: one landing`);
      assert.equal(got.workAfterReview, facts(comments).workAfterReview, `row ${n}: one work-after-review`);
    }
    assert.equal(trail.readTrail(ROWS[14]).landingHasNotesPr, true, 'row 14: the landing is an audit notes PR');
    assert.equal(trail.readTrail(ROWS[13]).landingHasNotesPr, false);
    assert.equal(trail.readTrail([summary(1), review(2), closeOut(3, `Not ready: no blind read yet for ${PR1}.`)]).closeOutOnTrail, true);
    assert.equal(trail.readTrail([summary(1), review(2)]).closeOutOnTrail, false);
  });
});

// ─── The box and the owner's Done check: a PR cited but not landed ─────────────────────────────────
//
// One trail for both. An earlier round's PR B (42) was closed unmerged and a not-ready close-out
// anchors past it; the new landing is A (41), reviewed, approved and read. A Survey report after the
// read cites B again: it joins no landing, but it makes B the NEWEST citation, so extractPrUrls
// (newest first) lists [B, A] while the landing is [A]. An index taken from one list and used on the
// other points at the wrong PR; matching by URL cannot.
const A = PR1;
const B = PR2;
const CITED_NOT_LANDED = [
  summary(1, B),
  review(2, 'Request Changes', B),
  closeOut(3, `Not ready: ${B} was closed unmerged. Next: implementation.`),
  summary(4, A),
  review(5, 'Approve', A),
  read(6, A),
  c(7, `${SURVEY_HEADINGS['survey-task']}: LIN-1 @ abc123def\n\nAn earlier attempt is ${B}; it was closed.`),
];

const openPr = (number) => ({ readable: true, repo: REPO, number, state: 'open', merged: false, head: { ref: 'f', sha: REVIEWED }, ref: REVIEWED, checks: [] });
const mergedPr = (number) => ({ ...openPr(number), state: 'closed', merged: true, merged_at: T(8) });
const closedPr = (number) => ({ ...openPr(number), state: 'closed', merged: false });

describe('the box: a landing of [A] cited beside B', () => {
  test('pin: the landing is [A] and the cited list is [B, A], newest first', () => {
    assert.deepEqual(landingPrUrls(CITED_NOT_LANDED), [A]);
  });

  test('pin: the picker withholds, because it chooses from every cited URL', async () => {
    const model = await readRunEvidence({ issueIdentifier: 'LIN-1', comments: CITED_NOT_LANDED, readPrStatus: async ({ number }) => openPr(number), stopAt: 'pr', runnerReady: true, viewerIsOwner: true });
    assert.deepEqual(model.state.prUrls.map(p => p.url), [B, A]);
    assert.equal(resolveRunPrRef(model).status, 'multiple');
  });

  test('the box counts the landing: its one PR read is A\'s, matched by URL, and it reads ready', { todo: BEAT_3 }, async () => {
    const reads = [];
    const model = await readRunEvidence({
      issueIdentifier: 'LIN-1', comments: CITED_NOT_LANDED, stopAt: 'pr', runnerReady: true, viewerIsOwner: true,
      readPrStatus: async ({ repo, number }) => { reads.push(`${repo}#${number}`); return number === 41 ? openPr(41) : closedPr(number); },
    });
    assert.deepEqual(reads, [`${REPO}#41`], 'one read, of the landing\'s sole PR');
    assert.deepEqual(model.closeOut.prs.map(p => p.url), [A], 'the box lists the landing');
    assert.equal(model.closeOut.status, 'ready');
    assert.equal(resolveRunPrRef(model).status, 'multiple', 'the picker still withholds');
  });
});

describe('the owner\'s Done check: the same trail through the check route', () => {
  const CHECK_PATH = '/workspace/:urlKey/api/run-evidence/:issueIdentifier/check';
  const harness = createMangoTmpdir('lin-4458-trail-characterization-');
  before(() => harness.connect());
  after(() => harness.close());

  async function check(statuses) {
    const collection = harness.freshDb().collection('close-out-events');
    const calls = { markDone: 0, reads: [] };
    const router = createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      closeOutEventsStore: new CloseOutEventsStore({ collection }),
      closeOut: {
        resolveProvider: () => ({ provider: { async fetchIssueComments() { return CITED_NOT_LANDED; } }, callScope: 'scope' }),
        readPrStatus: async ({ number }) => { calls.reads.push(number); return statuses[number]; },
        isStopAtRun: async () => 'pr',
        runnerReady: () => true,
        markDone: async () => { calls.markDone += 1; },
      },
    });
    const layer = findRouteLayer(router, 'post', CHECK_PATH);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const res = { statusCode: 200, jsonBody: null, status(code) { this.statusCode = code; return this; }, json(body) { this.jsonBody = body; return this; }, end() { return this; } };
    const req = { session: { accountId: 'acct-1', workspaces: ['ws'] }, workspace: { urlKey: 'ws', id: 'ws', accessToken: 't' }, params: { urlKey: 'ws', issueIdentifier: 'LIN-1' }, query: {}, body: {} };
    await handler(req, res, (err) => { if (err) throw err; });
    return { res, calls, events: await collection.find({}).toArray() };
  }

  // Named change (plan-review note 3 on LIN-4447): "no other unmerged PR" is checked over the landing.
  // B, abandoned and closed in an earlier round, no longer blocks the person's Done on A.
  test('a merged, approved, read landing [A] sets Done on the person\'s check; B closed unmerged outside the landing does not block it', { todo: BEAT_3 }, async () => {
    const { res, calls, events } = await check({ 41: mergedPr(41), 42: closedPr(42) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state.status, 'merged', 'the landing is merged');
    assert.equal(res.jsonBody.state.pr.url, A, 'the merged PR is A, found by URL');
    assert.equal(calls.markDone, 1, 'Done is set once');
    assert.deepEqual(events.map(e => e.prUrl), [A], 'the merge recorded is A\'s');
  });

  test('pin: an unmerged landing [A] never sets Done, whatever B reads', async () => {
    const { res, calls } = await check({ 41: openPr(41), 42: mergedPr(42) });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.markDone, 0);
  });
});
