/**
 * LIN-4518 (finding-55356e66): the plan-review loop's facts come from records, not comment prose.
 *
 * Witnesses, each seeded with records only (no comment is handed to any reader):
 *   - the run of verdicts since the latest Approve, each with the blocking count of the `to: plan` findings its own run
 *     wrote (lib/records/plan-review-run.js);
 *   - the loop's stop, through reviewLoopStop over loopFactsOf: three request-changes verdicts carrying 3, 2, 1 findings
 *     converge (no stop), 2, 2, 2 stop at the bound, and five verdicts stop at the ceiling;
 *   - the store's reader (RecordsStore.planReviewRunForTicket) folds the same run from the task's records;
 *   - loopFactsOf: a person's speech and landed work lift the bound only when they come after the latest verdict
 *     (LIN-4518 finding-5cdbcb2b; the entrance's own witnesses are in tests/unit/recommendation-input.test.js).
 *
 * Mutation (recorded in the commit): making the reader count zero findings turns the converging witness red.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4518-plan-review-loop.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { recordsStoreFor } from '../helpers/records-scenario.js';
import { planReviewRunOf } from '../../lib/records/plan-review-run.js';
import { loopFactsOf, reviewLoopStop, reviewLoopStep, reviewLoopConverging, REVIEW_LOOP_BOUND, REVIEW_LOOP_CEILING } from '../../lib/recommendation-facts.js';

const harness = createMangoTmpdir('lin-4518-plan-review-loop-');
before(() => harness.connect());
after(() => harness.close());

const URL_KEY = 'acme';
const TICKET = 'LIN-1';
const PLAN_STARTED = { name: 'Todo', type: 'unstarted' };
const ISSUE = { identifier: TICKET, title: 'Loop fixture', description: '', state: PLAN_STARTED, labels: [] };
const at = (day) => `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;

/**
 * A plan-review run as the records hold it: one `to: plan` finding per blocking issue, then the verdict, all under `run`.
 * `outcome` is the verdict's outcome word; `findings` is how many blocking findings the run wrote.
 */
function reviewRun(day, outcome, findings) {
  const run = `run-review-${day}`;
  const out = [];
  for (let i = 0; i < findings; i++) out.push({ kind: 'finding', to: 'plan', run, at: at(day), id: `f-${day}-${i}` });
  return { verdict: { id: `v-${day}`, fields: { judgement: 'plan-review', outcome, reasoning: 'r' }, run, at: at(day) }, findings: out };
}

/** The records of a run sequence, as the store reads them: verdicts and findings in one list each. */
function recordsOf(runs) {
  return {
    verdicts: runs.map((r) => r.verdict),
    findings: runs.flatMap((r) => r.findings),
  };
}

/** The run `n` request-changes rounds with `counts[i]` blocking findings each, on days 1..n. */
const rounds = (...counts) => counts.map((c, i) => reviewRun(i + 1, 'request-changes', c));

describe('planReviewRunOf: the run from records (no comments)', () => {
  test('each request-changes verdict carries the blocking findings its own run wrote', () => {
    const { verdicts, findings } = recordsOf(rounds(3, 2, 1));
    const f = planReviewRunOf({ verdicts, findings });
    assert.equal(f.verdicts, 3);
    assert.deepEqual(f.run.map((r) => r.blocking), [3, 2, 1]);
    assert.deepEqual(f.run.map((r) => r.verdict), ['request changes', 'request changes', 'request changes']);
    assert.equal(f.latestAt, at(3));
  });

  test('an Approve resets the run; only verdicts after it count', () => {
    const runs = [...rounds(3, 3, 3), reviewRun(4, 'approve', 0), ...rounds(2).map((r) => ({ ...r, verdict: { ...r.verdict, id: 'after', at: at(5), run: 'run-after' }, findings: r.findings.map((f) => ({ ...f, run: 'run-after' })) }))];
    const f = planReviewRunOf(recordsOf(runs));
    assert.deepEqual(f.run.map((r) => r.verdict), ['request changes']);
    assert.equal(f.verdicts, 5, 'every plan-review verdict on record is counted in `verdicts`');
  });

  test('a request-changes verdict with no finding of its run is not counted as zero: its blocking count is null', () => {
    const f = planReviewRunOf({
      verdicts: [{ id: 'v', fields: { judgement: 'plan-review', outcome: 'request-changes' }, run: null, at: at(1) }],
      findings: [{ kind: 'finding', to: 'plan', run: 'run-x', at: at(1) }],
    });
    assert.deepEqual(f.run.map((r) => r.blocking), [null]);
    assert.equal(reviewLoopConverging(f.run), false);
  });

  test('other judgements and other addressees are not the plan review', () => {
    const f = planReviewRunOf({
      verdicts: [{ id: 'r', fields: { judgement: 'review', outcome: 'request-changes' }, run: 'x', at: at(1) }],
      findings: [{ kind: 'finding', to: 'close-out', run: 'x', at: at(1) }, { kind: 'finding', to: 'plan', run: 'x', at: at(1) }],
    });
    assert.equal(f.verdicts, 0);
    assert.deepEqual(f.run, []);
  });
});

describe('the loop stop reads the records run, never the comments', () => {
  const loopOf = (runs) => loopFactsOf(planReviewRunOf(recordsOf(runs)), []);
  const issue = (type = 'unstarted') => ({ ...ISSUE, state: { name: type, type } });

  test(`${REVIEW_LOOP_BOUND} rounds carrying 3, 2, 1 blocking findings are converging: no stop`, () => {
    assert.equal(reviewLoopStop(issue(), loopOf(rounds(3, 2, 1))), null);
    assert.equal(reviewLoopStep(issue(), loopOf(rounds(3, 2, 1))), null);
  });

  test(`${REVIEW_LOOP_BOUND} rounds carrying 2, 2, 2 findings stop at the bound`, () => {
    assert.equal(reviewLoopStop(issue(), loopOf(rounds(2, 2, 2))), 'not-converging');
    const step = reviewLoopStep(issue(), loopOf(rounds(2, 2, 2)));
    assert.equal(step.codeRoute, 'blocked');
    assert.match(step.why, /reached its bound/);
  });

  test(`${REVIEW_LOOP_CEILING} rounds stop at the ceiling, whatever the counts`, () => {
    assert.equal(reviewLoopStop(issue(), loopOf(rounds(3, 2, 2, 1, 1))), 'ceiling');
  });

  test('a stage that is not read stands the bound aside (null facts)', () => {
    assert.equal(reviewLoopStop(issue(), null), null);
  });

  test('a terminal ticket is never stopped', () => {
    assert.equal(reviewLoopStop(issue('completed'), loopOf(rounds(2, 2, 2))), null);
  });
});

describe('RecordsStore.planReviewRunForTicket folds the same run from the task records', () => {
  test('verdicts and to:plan findings of the task; a ticket with no task has no run', async () => {
    const store = await recordsStoreFor(harness);
    const task = await store.ensureTask(URL_KEY, { identifier: TICKET, asked: 'asked', closed: false, closedReason: null }, { by: 'harbour', at: at(1) });
    const plan = await store.add(URL_KEY, { kind: 'plan', state: 'kept', in: task.id, to: 'implementation', fields: { says: 'the plan', order: 1 } }, { by: 'harbour', at: at(1) });
    for (const day of [1, 2, 3]) {
      const runs = rounds(3, 2, 1);
      const r = runs[day - 1];
      for (const f of r.findings) {
        await store.add(URL_KEY, { kind: 'finding', state: 'open', in: task.id, to: 'plan', links: { about: [plan.id] }, fields: { says: f.id, how: 'the check' } }, { by: 'plan-review', run: f.run, at: f.at });
      }
      await store.add(URL_KEY, { kind: 'verdict', state: 'stands', in: task.id, links: { on: [`${plan.id}@${plan.v}`] }, fields: { judgement: 'plan-review', outcome: r.verdict.fields.outcome, reasoning: 'r' } }, { by: 'plan-review', run: r.verdict.run, at: r.verdict.at });
    }
    // A finding to another addressee in the same task does not count toward a run.
    await store.add(URL_KEY, { kind: 'finding', state: 'open', in: task.id, to: 'close-out', fields: { says: 'x', how: 'y' } }, { by: 'plan-review', run: 'run-review-1', at: at(1) });

    const f = await store.planReviewRunForTicket(URL_KEY, TICKET);
    assert.equal(f.verdicts, 3);
    assert.deepEqual(f.run.map((r) => r.blocking), [3, 2, 1]);
    assert.equal(reviewLoopStop({ ...ISSUE }, loopFactsOf(f, [])), null, 'converging: no stop');

    const none = await store.planReviewRunForTicket(URL_KEY, 'LIN-NOPE');
    assert.deepEqual(none.run, []);
    assert.equal(none.verdicts, 0);
  });
});

// LIN-4518 (finding-5cdbcb2b): the loop's facts. A person's speech and landed work lift the bound only when they come after
// the latest verdict; the run and that instant come from the records. LIN-4520 (finding-ca44ecba): landed work is the run's
// `landed` change records, one per head-writing version and each dated by its own write, never a comment that cites a PR.
describe('loopFactsOf: a person\'s speech and landed work since the latest verdict', () => {
  const latestAt = at(3);
  const PR_1748 = 'https://github.com/JKershaw/LinearViewer/pull/1748';
  // LIN-4535: a person's speech is a person finding (its `at`); the loop reads findings, never comment text.
  const speech = (day) => ({ id: `finding-${day}`, at: at(day), accountId: 'john', says: 'go on, take it to implementation', ruling: false });
  const landed = (day) => ({ url: PR_1748, at: at(day) });
  const citing = (day) => ({ createdAt: at(day), body: `**Implementation complete — PR opened: ${PR_1748}** (commit e1287c0c).` });

  test('a person\'s comment after the latest verdict sets personSince; one before it, or none, does not', () => {
    assert.equal(loopFactsOf({ run: [], latestAt }, [speech(4)]).personSince, true);
    assert.equal(loopFactsOf({ run: [], latestAt }, [speech(2)]).personSince, false);
    assert.equal(loopFactsOf({ run: [], latestAt }, []).personSince, false);
  });

  test('a comment that reads like a person\'s words is not speech: only a person finding lifts the bound (LIN-4535)', () => {
    assert.equal(loopFactsOf({ run: [], latestAt }, []).personSince, false, 'no finding, no speech, whatever the words');
  });

  test('a change version written after the latest verdict sets landed to its PR; one written before it does not', () => {
    assert.equal(loopFactsOf({ run: [], latestAt, landed: [landed(4)] }, []).landed, PR_1748);
    assert.equal(loopFactsOf({ run: [], latestAt, landed: [landed(2)] }, []).landed, null);
  });

  test('a comment that cites a PR after the latest verdict is not landed work (finding-ca44ecba)', () => {
    assert.equal(loopFactsOf({ run: [], latestAt }, [citing(4)]).landed, null);
  });

  test('with no verdict on record there is no "since": no speech and no landed work is read', () => {
    assert.equal(loopFactsOf({ run: [], latestAt: null, landed: [landed(4)] }, [speech(4)]).personSince, false);
    assert.equal(loopFactsOf({ run: [], latestAt: null, landed: [landed(4)] }, [speech(4)]).landed, null);
  });

  test('the run it returns is the records\' run, untouched by the comments', () => {
    const run = [{ verdict: 'request changes', blocking: 2, at: latestAt }];
    assert.deepEqual(loopFactsOf({ run, latestAt }, [speech(4)]).run, run);
  });
});
