/**
 * LIN-4514 (P1 of LIN-4513): the five comment-path seeds the walks lack, each frozen with its decision.
 *
 * tests/fixtures/walk-8/comment-path/seeds.json holds the inputs (real LIN-4499 comments where the scenario is real,
 * synthetic ones marked as such where it is built); goldens/seeds.json holds what the comment path decided. Each test
 * reruns the comment path over its seed NOW and checks it (a) gives the committed golden and (b) gives the decision
 * the seed exists to pin, named cell by cell. So the seed fails when the behaviour it pins changes, without
 * regenerating anything. P5 (LIN-4518) replays these seeds on records and must reach the same cells.
 *
 *   1. converging plan-review loop (plan-review note 1): a narrowing Request Changes run buys rounds past the bound
 *      (3) up to the ceiling (5); a flat run stops at the bound;
 *   2. parked close-out (note 2, LIN-4499): with close-out parked, codeRouteOf answers live-wait before any other
 *      route; without it, the blind-read route still stands aside (the note's new PR is work after review) while
 *      both guards refuse for a blind read: the deadlock, as the comment path has it;
 *   3. a partly merged two-PR landing (note 3): the landing keeps the merged PR, so only a read naming both passes
 *      the write check and clears the wait;
 *   4. the ladder lane (note 7): the ladder guard makes no PR read, and head-moved refuses only at stop-at-PR;
 *   5. LIN-4499's unheaded 22:14 note (note 8): landed work, not a person's comment, so it leaves personSince and
 *      latestPerson where they were.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4514-comment-path-seeds.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { captureSeeds, loadDerived, loadSeeds, internRefs, resolveRefs } from '../helpers/comment-path-capture.js';

const GOLDEN = loadDerived('goldens/seeds.json');
let live;
before(async () => { live = resolveRefs(internRefs(await captureSeeds())); });

const seedOf = (doc, id) => doc.seeds.find((s) => s.id === id);
const casesOf = (id) => Object.fromEntries(seedOf(live, id).cases.map((c) => [c.id, c.output]));
const refusal = (guard) => (guard ? guard.reason : null);
const pr = (n) => `https://github.com/acme/widget/pull/${n}`;

/** The rerun gives the committed golden for this seed, case by case. */
function matchesGolden(id) {
  const want = seedOf(GOLDEN, id);
  const got = seedOf(live, id);
  assert.deepEqual(got.cases.map((c) => c.id), want.cases.map((c) => c.id), `${id}: the cases`);
  for (const [i, c] of got.cases.entries()) assert.deepEqual(c.output, want.cases[i].output, `${id}/${c.id}: the comment path decides as frozen`);
}

describe('the seed inputs name where each comment came from (LIN-4514)', () => {
  test('every comment is real (a LIN-4499 comment) or synthetic (with what it was built from)', () => {
    const { comments, seeds } = loadSeeds();
    assert.equal(seeds.length, 5);
    for (const cm of Object.values(comments)) assert.match(cm.origin, /^(real: LIN-4499 comment [0-9a-f-]{36}|synthetic: .{20,})$/, cm.id);
    const realIds = Object.values(comments).filter((cm) => cm.origin.startsWith('real:')).map((cm) => cm.id);
    assert.ok(realIds.every((id) => comments[id].origin.endsWith(id)), 'a real comment keeps its tracker id');
    for (const seed of seeds) for (const sc of seed.cases) for (const id of sc.commentIds) assert.ok(comments[id], `${seed.id}/${sc.id}: ${id}`);
  });
});

describe('seed 1: a converging plan-review loop buys rounds to the ceiling; a flat one stops at the bound', () => {
  test('converging run 3,2,1,1,1 and flat run 3,3,3, at each prefix', () => {
    matchesGolden('converging-plan-review-loop');
    const c = casesOf('converging-plan-review-loop');
    const at = (run, k) => c[`${run}/${k}-verdicts`];
    assert.deepEqual([1, 2, 3, 4, 5].map((k) => at('converging', k).planReview.facts.count), [1, 2, 3, 4, 5]);
    assert.deepEqual(at('converging', 5).planReview.facts.run.map((r) => r.blocking), [3, 2, 1, 1, 1], 'the reviewer\'s counts are read');
    assert.deepEqual([1, 2, 3, 4, 5].map((k) => at('converging', k).planReview.converging), [false, true, true, true, true]);
    assert.deepEqual([1, 2, 3, 4, 5].map((k) => at('converging', k).planReview.stop), [null, null, null, null, 'ceiling'], 'past the bound while narrowing, stopped at the ceiling');
    assert.deepEqual([1, 2, 3, 4, 5].map((k) => at('converging', k).surfaces.route.codeRoute), [null, null, null, null, 'blocked']);
    assert.deepEqual([1, 2, 3].map((k) => at('flat', k).planReview.stop), [null, null, 'not-converging'], 'a flat count stops at the bound');
    assert.equal(at('flat', 3).surfaces.route.codeRoute, 'blocked');
    for (const k of [1, 2, 3, 4, 5]) assert.equal(at('converging', k).planReview.facts.personSince, false);
  });
});

describe('seed 2: a parked close-out holds the ticket before any other route (LIN-4499)', () => {
  test('with close-out parked: live-wait; without: the read route stands aside while both guards wait for a read', () => {
    matchesGolden('parked-close-out');
    const { 'parked-close-out': parked, 'no-live-run': free } = casesOf('parked-close-out');
    assert.equal(parked.surfaces.route.codeRoute, 'live-wait', 'CODE_ROUTES[0] answers first');
    assert.equal(parked.liveWait.wait.kind, 'close-out');
    assert.equal(parked.surfaces.route.liveWait.kind, 'close-out');
    assert.equal(free.surfaces.route.codeRoute, null, 'no code route: the selector is asked');
    assert.equal(free.liveWait, null);
    for (const o of [parked, free]) {
      assert.deepEqual(o.trail.landing, ['https://github.com/JKershaw/LinearViewer/pull/2478'], 'the note\'s PR is the landing');
      assert.equal(o.trail.workAfterReview, true, 'the note cites a PR the review did not hold');
      assert.equal(o.selector.blindReadStep, null, 'so the blind-read route stands aside');
      assert.equal(o.trail.review.verdict, 'approve-conditional');
      assert.equal(refusal(o.surfaces.stopAtGuard), 'blind-read-missing', 'while the stop-at guard waits for a read');
      assert.equal(refusal(o.surfaces.ladderGuard), 'blind-read-missing', 'and so does the ladder guard');
    }
  });
});

describe('seed 3: a partly merged two-PR landing keeps both PRs; only a read naming both clears it', () => {
  test('no read, a read naming both, the open one only, the merged one only', () => {
    matchesGolden('two-pr-partly-merged');
    const c = casesOf('two-pr-partly-merged');
    for (const o of Object.values(c)) {
      assert.deepEqual(o.trail.landing, [pr(41), pr(42)], 'the merged PR stays in the landing');
      assert.equal(o.decision.stopAtHarbour.status, 'partial');
    }
    assert.equal(c['no-read'].decision.stopAtHarbour.waitsOn, 'blind-read');
    assert.equal(c['no-read'].selector.blindReadStep.step, 'blind-read');
    assert.equal(c['read-both'].writeCheck.check.ok, true, 'a read naming both is posted');
    assert.equal(c['read-both'].decision.stopAtHarbour.waitsOn, null, 'and clears the wait');
    assert.equal(c['read-both'].selector.blindReadStep, null);
    for (const [id, got] of [['read-open-only', [pr(42)]], ['read-merged-only', [pr(41)]]]) {
      assert.equal(c[id].writeCheck.check.code, 'BLIND_READ_PRS_MISMATCH', `${id}: refused at write`);
      assert.deepEqual(c[id].writeCheck.check.expected, [pr(41), pr(42)], `${id}: against the landing`);
      assert.deepEqual(c[id].writeCheck.check.got, got);
      assert.equal(c[id].decision.stopAtHarbour.waitsOn, 'blind-read', `${id}: a read of one PR never satisfies the wait`);
    }
  });
});

describe('seed 4: the ladder lane reads no PR, and head-moved refuses only at stop-at-PR', () => {
  test('approve; approve and a read at a moved head; request changes', () => {
    matchesGolden('ladder-lane');
    const c = casesOf('ladder-lane');
    for (const [id, o] of Object.entries(c)) {
      assert.deepEqual(o.surfaces.prReads.ladderGuard, [], `${id}: the ladder guard makes no PR read`);
      assert.notEqual(refusal(o.surfaces.ladderGuard), 'head-moved', `${id}: the ladder never refuses head-moved`);
      assert.equal(o.decision.ladder.headMoved, false, `${id}: the ladder lane sees no head`);
    }
    assert.equal(refusal(c['approve-no-read'].surfaces.ladderGuard), 'blind-read-missing', 'its one refusal is the gate');
    assert.equal(refusal(c['approve-read-moved-head'].surfaces.ladderGuard), null, 'a moved head admits on the ladder');
    assert.equal(refusal(c['approve-read-moved-head'].surfaces.stopAtGuard), 'head-moved', 'and refuses at stop-at-PR');
    assert.equal(c['approve-read-moved-head'].decision.stopAtHarbour.refuses, 'head-moved');
    assert.equal(refusal(c['request-changes'].surfaces.ladderGuard), null);
  });
});

describe('seed 5: LIN-4499\'s unheaded 22:14 note is landed work, not a person\'s comment', () => {
  const NOTE = '63019b84-0e44-4608-b062-70dbb81f104f';
  test('the note reads as landed work; personSince and latestPerson move only for a person', () => {
    matchesGolden('unheaded-agent-note');
    const c = casesOf('unheaded-agent-note');
    for (const [id, o] of Object.entries(c)) {
      const note = o.authorship.find((a) => a.id === NOTE);
      assert.ok(note, `${id}: the note is on the trail`);
      assert.deepEqual([note.isPerson, note.landedWork, note.ruling], [false, true, false], `${id}: not a person; landed work`);
    }
    assert.equal(c['note-after-verdict'].planReview.facts.personSince, false, 'the note after the verdict is not a person');
    assert.equal(c['note-after-verdict'].selector.trailFacts.latestPerson, null);
    assert.equal(c['ruling-after-verdict'].planReview.facts.personSince, true, 'John\'s ruling is');
    assert.equal(c['ruling-after-verdict'].selector.trailFacts.latestPerson.at, '2026-11-20T20:27:05.140Z');
    assert.equal(c['person-after-note'].selector.trailFacts.latestPerson.at, '2026-11-20T22:20:00.000Z', 'an unheaded person\'s comment is the person');
    assert.equal(c['lin-4499-to-22-14'].selector.trailFacts.latestPerson.at, '2026-11-20T20:27:05.140Z', 'on the real trail, the 20:27 ruling, not the 22:14 note');
  });
});
