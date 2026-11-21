/**
 * LIN-4514 (P1 of LIN-4513): the comment path's decisions, frozen before verdicts and changes become records.
 *
 * tests/fixtures/walk-8/comment-path/ holds the frozen inputs (LIN-4469, LIN-4446 and LIN-4450's real comments, PR
 * head timelines and ticket states, beside walk 8's step boundaries) and what the comment path decided from them
 * (goldens/, rows.json), derived by tests/helpers/comment-path-capture.js. This file checks:
 *   1. the inputs are whole: every comment matches walk 8's real/*.md where that file holds it, every PR the trail
 *      cites has a head timeline, and each head says where its time came from;
 *   2. the derive helper reruns over the inputs and gives the committed goldens' instants, each carrying every part
 *      (a later beat compares the bytes);
 *   3. LIN-4469: the commit pushed after the 23:21 re-review (534524f92, 23:30), which no review saw, reads as a
 *      moved head against the re-review's sha at that instant and at every instant after it. The records side
 *      (P5, LIN-4518) must show that verdict stale;
 *   4. rows.json agrees with the cells its source tests assert (lin-4438, lin-4458, lin-4460), so a row copied into
 *      tests/helpers/comment-path-rows.js that drifts from its source fails here instead of freezing another row.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4514-comment-path-goldens.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { prUrlsIn } from '../../lib/run-ledger.js';
import { TICKETS, loadInput, loadDerived, captureTicket, instantsOf } from '../helpers/comment-path-capture.js';

// The derived files store each repeated text once (internRefs); loadDerived puts every one back.
const golden = (name) => loadDerived(`goldens/${name}.json`);
const ROWS = loadDerived('rows.json').rows;
const PARTS = ['trail', 'decision', 'selector', 'runEvidence'];
const LANES = ['stopAtHarbour', 'stopAtPerson', 'ladder'];

describe('the frozen inputs are whole (LIN-4514)', () => {
  for (const name of TICKETS) {
    test(`${name}: comments match walk 8's real/*.md where it holds them, and every cited PR has a head timeline`, () => {
      const input = loadInput(name);
      assert.ok(input.comments.length >= 7, `${name}: the trail's comments are there`);
      assert.equal(input.realCheck.length, input.comments.length, `${name}: every comment was cross-checked`);
      for (const check of input.realCheck) assert.ok(['same', 'absent'].includes(check.real), `${name}: comment ${check.id} differs from real/*.md`);
      assert.ok(input.realCheck.filter((r) => r.real === 'same').length >= input.comments.length - 2, `${name}: most comments are in real/*.md`);
      const cited = new Set(input.comments.flatMap((cm) => prUrlsIn(cm.body)));
      assert.deepEqual([...cited].sort(), input.prs.map((p) => p.url).sort(), `${name}: one timeline per cited PR`);
      for (const pr of input.prs) {
        assert.ok(pr.heads.length > 0, `${name}: PR #${pr.number} has heads`);
        for (const h of pr.heads) assert.match(h.source, /^(check-run|next-check-run|committed-date):/, `${name}: PR #${pr.number} ${h.sha} names its push-time source`);
        if (pr.mergedAt) assert.equal(pr.mergedHead, pr.heads[pr.heads.length - 1].sha, `${name}: PR #${pr.number} merged at its last head`);
      }
      assert.ok(input.steps.length > 0 && input.ticketStates.length === 2, `${name}: step boundaries and states`);
    });
  }
});

describe('the derive helper reruns over the frozen inputs (LIN-4514)', () => {
  for (const name of TICKETS) {
    test(`${name}: every comment time and step boundary is an instant, each with every part, as committed`, async () => {
      const input = loadInput(name);
      const rerun = await captureTicket(input);
      const committed = golden(name);
      assert.deepEqual(rerun.instants.map((i) => i.at), committed.instants.map((i) => i.at), `${name}: the same instants`);
      const ats = new Set(rerun.instants.map((i) => Date.parse(i.at)));
      for (const cm of input.comments) assert.ok(ats.has(Date.parse(cm.createdAt)), `${name}: comment ${cm.id} is an instant`);
      for (const s of input.steps) assert.ok(ats.has(Date.parse(s.start)), `${name}: step ${s.n} is an instant`);
      assert.equal(rerun.instants.length, instantsOf(input).length);
      for (const instant of committed.instants) {
        for (const part of PARTS) assert.ok(instant[part], `${name} ${instant.at}: ${part}`);
        for (const lane of LANES) assert.equal(typeof instant.decision[lane].status, 'string', `${name} ${instant.at}: ${lane} decided`);
        assert.ok(instant.because.length > 0);
      }
      // Non-trivial: the trail reaches a review and a blind read, and the decision moves.
      const last = committed.instants[committed.instants.length - 1];
      assert.equal(last.trail.review.verdict, 'approve-conditional', `${name}: the last review approved`);
      assert.equal(last.trail.review.blindRead.verdict, 'better', `${name}: the blind read is on the trail`);
      const statuses = new Set(committed.instants.map((i) => i.decision.stopAtHarbour.status));
      assert.ok(statuses.size >= 3, `${name}: the decision moves (${[...statuses].join(', ')})`);
    });
  }
});

describe('LIN-4469: a commit no review saw reads as a moved head on the comment path (LIN-4514)', () => {
  const PR_2447 = 'https://github.com/JKershaw/LinearViewer/pull/2447';
  const instants = golden('lin-4469').instants;
  const entryOf = (instant) => instant.decision.stopAtHarbour.entries.find((e) => e.url === PR_2447);
  const pushed = instants.findIndex((i) => i.because.includes('PR #2447 head 534524f92 (check-run)'));

  test('534524f92 is an instant, after the 23:21 re-review', () => {
    assert.ok(pushed > 0, 'the push of 534524f92 is an instant');
    assert.equal(instants[pushed].at, '2026-11-13T23:30:04.000Z');
    const review = instants[pushed].trail.review;
    assert.equal(review.commentId, '042f607d-474b-49c2-acbc-15f45c3969e9', 'the latest review is the 23:21 re-review');
    assert.ok(Date.parse(review.at) < Date.parse(instants[pushed].at));
  });

  test('from 534524f92 to the merge, #2447\'s head is not the re-review\'s sha, and every lane that reads it says moved', () => {
    const after = instants.slice(pushed);
    assert.ok(after.length >= 4, '534524f92, cc7792e58, 350410829 and the merge');
    for (const instant of after) {
      const entry = entryOf(instant);
      const where = `${instant.at} (${instant.because.join('; ')})`;
      assert.equal(instant.trail.review.sha, '05b592742', `${where}: the re-review's sha`);
      assert.ok(entry && entry.headSha && !entry.headSha.startsWith('05b592742'), `${where}: #2447 is at another head`);
      assert.equal(entry.headMoved, true, `${where}: #2447 reads moved`);
      assert.equal(instant.decision.stopAtHarbour.headMoved, true, `${where}: the stop-at decision reads moved`);
      assert.equal(instant.decision.stopAtPerson.headMoved, true, `${where}: the owner's check reads moved`);
    }
    assert.equal(entryOf(instants[pushed]).headSha, '534524f9287f0e2e4abef5599a6d1d821aae686e');
  });

  // Recorded as the comment path decides it, so the records replay knows what it is matched against: the landing
  // holds #2444 too (the 21:49 comment cites LIN-4467's PR; row 15's stated limit), so it is a two-PR landing, and
  // the multi-PR branch of closeOutDecision has no head-moved refusal. No lane refused the unseen commits.
  test('the comment path never refused them: a two-PR landing (#2444 cited first) takes the multi-PR branch', () => {
    for (const instant of instants.slice(pushed)) {
      assert.deepEqual(instant.trail.landing, ['https://github.com/JKershaw/LinearViewer/pull/2444', PR_2447], instant.at);
      assert.equal(instant.decision.stopAtHarbour.refuses, null, `${instant.at}: nothing refused`);
    }
  });
});

describe('rows.json agrees with the cells its source tests assert (LIN-4514)', () => {
  const refusal = (guard) => (guard ? guard.reason : null);
  const routeOf = (s) => (['blind-read', 'blocked'].includes(s.route.codeRoute) ? s.route.codeRoute : 'aside');

  test('every source is frozen: lin-4438 rows 1-15, lin-4458\'s 15 cases, lin-4460\'s 10 rows in both reads', () => {
    const count = (prefix) => ROWS.filter((r) => r.id.startsWith(prefix)).length;
    assert.equal(count('lin-4438/'), 15);
    assert.deepEqual(ROWS.filter((r) => r.id.startsWith('lin-4438/')).map((r) => r.id).slice(12), ['lin-4438/row-13', 'lin-4438/row-14', 'lin-4438/row-15']);
    assert.equal(count('lin-4458/'), 15);
    assert.equal(count('lin-4460/'), 20);
    for (const row of ROWS) for (const part of [...PARTS, 'surfaces']) assert.ok(row.output[part], `${row.id}: ${part}`);
  });

  for (const row of ROWS.filter((r) => r.id.startsWith('lin-4438/'))) {
    test(`${row.id}: route ${row.expected.route}, gate ${row.expected.gate}`, () => {
      const { output: o, expected: e } = row;
      assert.equal(routeOf(o.surfaces), e.route);
      const want = e.gate === 'wait' ? 'blind-read-missing' : null;
      assert.equal(refusal(o.surfaces.stopAtGuard), want, 'stop-at guard');
      assert.equal(refusal(o.surfaces.ladderGuard), want, 'ladder guard');
      if (e.ready) assert.deepEqual([o.surfaces.check.status, o.runEvidence.closeOut.status], ['ready', 'ready']);
      if (e.landing) assert.deepEqual([...o.trail.landing].sort(), [...e.landing].sort());
    });
  }

  for (const row of ROWS.filter((r) => r.id.startsWith('lin-4458/'))) {
    test(`${row.id}: ${Object.keys(row.expected).join(', ')}`, () => {
      const { output: o, expected: e } = row;
      const got = {
        landing: o.trail.landing,
        workAfterReview: o.trail.workAfterReview,
        // closeOutWaitsOn(review, landing): the ladder lane reads no status, so its waitsOn is that call's answer.
        waitsOn: o.decision.ladder.waitsOn,
        step: o.selector.blindReadStep ? o.selector.blindReadStep.step : null,
        ladderGuard: refusal(o.surfaces.ladderGuard),
        landingHasNotesPr: o.trail.landingHasNotesPr,
        closeOutOnTrail: o.trail.closeOutOnTrail,
        boxStatus: o.runEvidence.closeOut.status,
        boxPrs: o.runEvidence.closeOut.prs.map((p) => p.url),
        boxReads: o.runEvidence.prReads.map((u) => Number(u.split('/').pop())),
        checkStatus: o.surfaces.check.status,
        checkSetDone: o.surfaces.check.setDone,
        checkPr: o.surfaces.check.pr ? o.surfaces.check.pr.url : null,
      };
      for (const [key, want] of Object.entries(e)) assert.deepEqual(got[key], want, key);
    });
  }

  for (const row of ROWS.filter((r) => r.id.startsWith('lin-4460/'))) {
    test(`${row.id}`, () => {
      const { output: o, expected: { cell } } = row;
      assert.deepEqual([o.runEvidence.closeOut.status, o.runEvidence.closeOut.refuses ?? null], cell.box, 'box (status, refuses)');
      assert.deepEqual([o.surfaces.check.status, o.surfaces.check.setDone], cell.check, 'person\'s check (status, setDone)');
      assert.equal(refusal(o.surfaces.stopAtGuard), cell.stopAt, 'stop-at guard lane');
      assert.equal(refusal(o.surfaces.ladderGuard), cell.ladder, 'ladder guard lane');
      assert.equal(o.selector.blindReadStep !== null, cell.routesRead, 'the recommendation\'s read');
    });
  }

  test('the ladder guard makes no PR read on any row (LIN-4438)', () => {
    for (const row of ROWS) assert.deepEqual(row.output.surfaces.prReads.ladderGuard, [], row.id);
  });
});
