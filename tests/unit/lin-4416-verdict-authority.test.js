/**
 * LIN-4416 (plan-33a70884 v5): a verdict stands only when the stage that judges it wrote it.
 *
 * Rule 1: a verdict whose judgement is a stage kind is added, revised or linked only by that stage (lib/records/check.js
 * verdictWriterProblems, through the one checked pipeline, lib/records/writes.js). Rule 2: a withdrawn verdict is no
 * verdict to any reader (lib/records/words.js verdictCounts). Rule 3 (the dispatch lane) is witnessed in
 * tests/unit/lin-4416-judging-run.test.js.
 *
 * Witnesses, by the plan's numbers: 1 (who may add), 2 (revise and link), 3 (withdrawn, with a census over every
 * verdict reader in lib/), 4 (every stage prompt that teaches a judgement belongs to that judge), 5 (the E2E seed route
 * writes as the judge and passes), 7 (one judging-kind question, no list). Each was run against the unfixed code and
 * failed there (recorded on the PR).
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';
import { KINDS, judgesAs } from '../../lib/records/check.js';
import { standingOf, readStandingRecords, trailOfStanding } from '../../lib/records/standing.js';
import { readLanding, roundOf, writeTimesOfVersions } from '../../lib/records/landing.js';
import { planReviewRunOf } from '../../lib/records/plan-review-run.js';
import { verdictsInWindow, verdictViewOf } from '../../lib/records/verdict-facts.js';
import { verdictCounts } from '../../lib/records/words.js';
import { BLIND_READ_KIND } from '../../lib/prompts/blind-read-words.js';
import { PROMPT_TEMPLATES, generatePrompt } from '../../lib/prompt-templates.js';
import { closeOutDecision } from '../../lib/run-closeout-state.js';
import { readOpenFindings } from '../../lib/close-out-findings.js';
import { createTestRoutes } from '../../routes/test.js';

const URL_KEY = 'lin-4416-workspace';
const TICKET = 'LIN-4416';
const T0 = '2026-11-24T09:00:00.000Z';
const PR = 'https://github.com/acme/widget/pull/41';
const STAGES = Object.keys(STAGE_KINDS);
const JUDGEMENTS = { review: 'review', blindRead: BLIND_READ_KIND, adversarialRead: 'adversarial-read' };

const harness = createMangoTmpdir('lin-4416-verdict-authority-');
before(() => harness.connect());
after(() => harness.close());

let rh;
let store;
let writes;
let taskId;
let tokens;

beforeEach(async () => {
  rh = await createRecordsRouteHarness({ harness, urlKey: URL_KEY, tickets: new Map(), people: [{ accountId: 'acc-john', name: 'John' }] });
  store = rh.store;
  for (const [id, stage] of [['row-impl', 'implementation'], ['row-review', 'review'], ['row-blind', 'blind-read'], ['row-plan-review', 'plan-review'], ['row-close', 'close-out']]) {
    await store.openRun(URL_KEY, { id, stage, lineage: 'row-root', at: T0 });
  }
  tokens = {
    impl: await rh.mintRunToken('row-impl'),
    review: await rh.mintRunToken('row-review'),
    blind: await rh.mintRunToken('row-blind'),
    planReview: await rh.mintRunToken('row-plan-review'),
    close: await rh.mintRunToken('row-close'),
    john: await rh.mintPersonToken('acc-john'),
  };
  taskId = (await store.ensureTask(URL_KEY, { identifier: TICKET, asked: 'Verdict authority.', closed: false, closedReason: null }, { by: 'Harbour', at: T0 })).id;
  // The writer Harbour's own steps would use, knowing the stage kinds (as every verdict-writing production writer does).
  writes = createRecordWrites({ recordsStore: store, isTerminalState, stageKinds: STAGES });
});

afterEach(async () => {
  if (rh) await rh.close();
  rh = null;
});

const post = (path, token, body) => rh.post(path, token, body);
const records = (token, body) => post('/api/proxy/records', token, body);

async function addChange(sha = 'H1') {
  const r = await records(tokens.impl, { kind: 'change', in: taskId, ref: PR, head: sha, run: 'row-impl' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

const reviewBody = (changeId, run, outcome = 'approve') => ({
  kind: 'verdict', in: taskId, judgement: 'review', outcome, reasoning: 'read at H1', on: [changeId], heads: { [changeId]: 'H1' }, run,
});

/** The refusal names the judging stage, on the judgement field. */
function refusedNamingJudge(r, judge) {
  assert.equal(r.status, 422, JSON.stringify(r.body));
  const p = r.body.problems.find((x) => x.field === 'judgement');
  assert.ok(p, `no judgement problem: ${JSON.stringify(r.body)}`);
  assert.match(p.message, new RegExp(`only by the ${judge} stage`));
  assert.deepEqual(p.works, [judge]);
}

describe('witness 1: a verdict is added only by the stage that judges it', () => {
  test('implementation, a person and harbour are refused a review verdict, naming review; the review run is not', async () => {
    const changeId = await addChange();
    refusedNamingJudge(await records(tokens.impl, reviewBody(changeId, 'row-impl')), 'review');
    refusedNamingJudge(await records(tokens.john, reviewBody(changeId, undefined)), 'review');
    // Close-out, the stage that reads the verdict, may not write it either.
    refusedNamingJudge(await records(tokens.close, reviewBody(changeId, 'row-close')), 'review');
    const asHarbour = await writes.add({ urlKey: URL_KEY, kind: 'verdict', input: { in: taskId, judgement: 'review', outcome: 'approve', on: [`${changeId}@1`] }, by: 'harbour' });
    assert.ok(asHarbour.problems?.some((p) => p.field === 'judgement' && /only by the review stage/.test(p.message)), JSON.stringify(asHarbour));
    const byJudge = await records(tokens.review, reviewBody(changeId, 'row-review'));
    assert.equal(byJudge.status, 201, JSON.stringify(byJudge.body));
    assert.equal(byJudge.body.by, 'review');
  });

  test('plan-review and blind-read are held to their own judges the same way', async () => {
    const plan = await records(tokens.impl, { kind: 'plan', in: taskId, says: 'Build it.', order: 1, to: 'implementation', run: 'row-impl' });
    assert.equal(plan.status, 201, JSON.stringify(plan.body));
    const pr = (run) => ({ kind: 'verdict', in: taskId, judgement: 'plan-review', outcome: 'approve', reasoning: 'ok', on: plan.body.id, run });
    refusedNamingJudge(await records(tokens.review, pr('row-review')), 'plan-review');
    assert.equal((await records(tokens.planReview, pr('row-plan-review'))).status, 201);
    const blind = await writes.add({ urlKey: URL_KEY, kind: 'verdict', input: { in: taskId, judgement: 'blind-read', outcome: 'same', on: plan.body.id }, by: 'review' });
    assert.ok(blind.problems?.some((p) => /only by the blind-read stage/.test(p.message)), JSON.stringify(blind));
  });

  test('an adversarial-read verdict passes for any writer: no stage is named for it, so the rule names no judge (no map, no exception)', async () => {
    assert.equal(STAGES.includes('adversarial-read'), false, 'the premise: adversarial-read is no stage kind');
    const changeId = await addChange();
    for (const by of ['implementation', 'retro', 'harbour']) {
      const out = await writes.add({ urlKey: URL_KEY, kind: 'verdict', input: { in: taskId, judgement: 'adversarial-read', outcome: 'agree', differed: 'no', disposition: 'no change', on: [`${changeId}@1`] }, by });
      assert.ok(!out.problems, `${by}: ${JSON.stringify(out.problems)}`);
    }
  });

  test('a writer built without the stage kinds writes no verdict: it cannot tell the judge, so it fails closed', async () => {
    const changeId = await addChange();
    const blind = createRecordWrites({ recordsStore: store, isTerminalState });
    const out = await blind.add({ urlKey: URL_KEY, kind: 'verdict', input: { in: taskId, judgement: 'review', outcome: 'approve', on: [`${changeId}@1`] }, by: 'review' });
    assert.ok(out.problems?.some((p) => p.field === 'judgement' && /without the stage kinds/.test(p.message)), JSON.stringify(out));
    // Its other writes are untouched: a finding still goes through.
    const f = await blind.add({ urlKey: URL_KEY, kind: 'finding', input: { in: taskId, to: 'project', says: 'x' }, by: 'implementation' });
    assert.ok(!f.problems, JSON.stringify(f.problems));
  });
});

describe('witness 2: a verdict is revised or linked only by its judge', () => {
  test('a non-judge cannot revise a request-changes into an approve; the judge can', async () => {
    const changeId = await addChange();
    const v = await records(tokens.review, reviewBody(changeId, 'row-review', 'request-changes'));
    assert.equal(v.status, 201, JSON.stringify(v.body));
    refusedNamingJudge(await post(`/api/proxy/records/${v.body.id}/revise`, tokens.impl, { outcome: 'approve', reason: 'fixed', run: 'row-impl' }), 'review');
    refusedNamingJudge(await post(`/api/proxy/records/${v.body.id}/revise`, tokens.john, { outcome: 'approve', reason: 'I say so' }), 'review');
    const own = await post(`/api/proxy/records/${v.body.id}/revise`, tokens.review, { outcome: 'approve', reason: 're-read', run: 'row-review' });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.fields.outcome, 'approve');
  });

  test('a revise cannot move a verdict onto a judgement its writer does not judge', async () => {
    const changeId = await addChange();
    const blind = await writes.add({ urlKey: URL_KEY, kind: 'verdict', input: { in: taskId, judgement: 'blind-read', outcome: 'same', on: [`${changeId}@1`] }, by: 'blind-read' });
    assert.ok(!blind.problems, JSON.stringify(blind.problems));
    const moved = await writes.revise({ urlKey: URL_KEY, id: blind.record.id, input: { judgement: 'review', outcome: 'approve', reason: 'now a review' }, by: 'blind-read' });
    assert.ok(moved.problems?.some((p) => /only by the review stage/.test(p.message)), JSON.stringify(moved));
  });

  test('a link to a verdict by a non-judge is refused; by the judge it lands', async () => {
    const changeId = await addChange();
    const v = await records(tokens.review, reviewBody(changeId, 'row-review'));
    const f = await records(tokens.impl, { kind: 'finding', in: taskId, to: 'close-out', says: 'Add the test.', run: 'row-impl' });
    refusedNamingJudge(await post(`/api/proxy/records/${v.body.id}/link`, tokens.impl, { about: [f.body.id], run: 'row-impl' }), 'review');
    const own = await post(`/api/proxy/records/${v.body.id}/link`, tokens.review, { about: [f.body.id], run: 'row-review' });
    assert.equal(own.status, 200, JSON.stringify(own.body));
  });

  test('ending a verdict is not changed by this rule (finding-8b1bfbb5 tracks it)', async () => {
    const changeId = await addChange();
    const v = await records(tokens.review, reviewBody(changeId, 'row-review'));
    const ended = await post(`/api/proxy/records/${v.body.id}/end`, tokens.john, { state: 'withdrawn', reason: 'PR closed unmerged' });
    assert.equal(ended.status, 200, JSON.stringify(ended.body));
  });
});

describe('witness 3: a withdrawn verdict is read as no verdict by every reader', () => {
  async function withdrawnApprove() {
    const changeId = await addChange();
    const v = await records(tokens.review, reviewBody(changeId, 'row-review'));
    assert.equal(v.status, 201, JSON.stringify(v.body));
    const before = await readStandingRecords({ recordsStore: store, urlKey: URL_KEY, taskId, judgements: JUDGEMENTS });
    assert.equal(before.review?.outcome, 'approve', 'the control: the standing Approve reads approve');
    const ended = await post(`/api/proxy/records/${v.body.id}/end`, tokens.john, { state: 'withdrawn', reason: 'PR closed unmerged' });
    assert.equal(ended.status, 200, JSON.stringify(ended.body));
    return { changeId, verdictId: v.body.id, before };
  }

  test('standingOf gives no review, and the close-out decision reads no approval', async () => {
    const { before } = await withdrawnApprove();
    const after = await readStandingRecords({ recordsStore: store, urlKey: URL_KEY, taskId, judgements: JUDGEMENTS });
    assert.equal(after.review, null, `a withdrawn Approve still stands: ${JSON.stringify(after.review)}`);
    assert.equal(trailOfStanding(after).review, null);
    const openFindings = await readOpenFindings({ store, urlKey: URL_KEY, ticket: TICKET });
    const prStatuses = new Map([[PR, { readable: true, state: 'open', merged: false, head: { sha: 'H1' } }]]);
    const was = closeOutDecision({ trail: trailOfStanding(before), prStatuses, stopAt: 'pr', openFindings });
    const now = closeOutDecision({ trail: trailOfStanding(after), prStatuses, stopAt: 'pr', openFindings });
    assert.notEqual(now.reason, was.reason, `the decision did not change: ${now.reason}`);
    assert.equal(now.setDone, false);
  });

  test('readLanding: a withdrawn review does not cut the round', async () => {
    // A merged change, a close-out that ended, then a review: the review cuts the round at that close-out, so the merged
    // change is out of the landing. Withdraw the review and there is no cut: the merged change is back in.
    const old = await records(tokens.impl, { kind: 'change', in: taskId, ref: 'https://github.com/acme/widget/pull/7', head: 'H0', run: 'row-impl' });
    store.now = () => new Date('2026-11-24T09:01:00.000Z');
    await post(`/api/proxy/records/${old.body.id}/end`, tokens.impl, { state: 'merged', reason: 'merged', run: 'row-impl' });
    store.now = () => new Date('2026-11-24T09:02:00.000Z');
    await store.openRun(URL_KEY, { id: 'row-close-1', stage: 'close-out', taskId, lineage: 'row-close-1', at: '2026-11-24T09:01:30.000Z' });
    await store.endRun(URL_KEY, 'row-close-1', { state: 'done', at: '2026-11-24T09:02:00.000Z' });
    store.now = () => new Date('2026-11-24T09:03:00.000Z');
    const changeId = await addChange();
    store.now = () => new Date('2026-11-24T09:04:00.000Z');
    const v = await records(tokens.review, reviewBody(changeId, 'row-review'));
    assert.equal(v.status, 201, JSON.stringify(v.body));
    const cut = await readLanding({ recordsStore: store, urlKey: URL_KEY, taskId });
    assert.deepEqual(cut, [PR], 'the control: the review cuts the round');
    store.now = () => new Date('2026-11-24T09:05:00.000Z');
    await post(`/api/proxy/records/${v.body.id}/end`, tokens.john, { state: 'withdrawn', reason: 'PR closed unmerged' });
    const uncut = await readLanding({ recordsStore: store, urlKey: URL_KEY, taskId });
    assert.deepEqual(uncut, ['https://github.com/acme/widget/pull/7', PR], `a withdrawn review still cuts the round: ${JSON.stringify(uncut)}`);
  });

  test('planReviewRunOf: a withdrawn Approve does not reset the loop or stand as the latest verdict', () => {
    const verdicts = [
      { id: 'v1', at: '2026-11-24T09:00:00.000Z', state: 'stands', fields: { judgement: 'plan-review', outcome: 'request-changes' } },
      { id: 'v2', at: '2026-11-24T09:01:00.000Z', state: 'withdrawn', fields: { judgement: 'plan-review', outcome: 'approve' } },
    ];
    const run = planReviewRunOf({ verdicts });
    assert.equal(run.verdicts, 1);
    assert.equal(run.latestVerdict, 'request changes');
    assert.deepEqual(run.run.map((r) => r.verdict), ['request changes']);
  });

  /**
   * The census. Every reader of verdict records in lib/ (found by search: a `kind: 'verdict'` find or a
   * `kind === 'verdict'` filter, and the injected aliases they pass verdicts through) is run here over one withdrawn
   * verdict of each judgement, and must read none. The source search below fails when a new reader appears that this
   * census does not run, so a reader cannot be added that still counts a withdrawn verdict without this test seeing it.
   */
  test('census: every verdict reader reads a withdrawn verdict as none', () => {
    const ended = (id, judgement, outcome) => ({ id, v: 2, at: '2026-11-24T09:01:00.000Z', op: 'end', kind: 'verdict', state: 'withdrawn', in: 'task-1', by: 'person:acc', links: { on: [] }, fields: { judgement, outcome }, ended: { reason: 'withdrawn' } });
    const first = (s) => ({ ...s, v: 1, at: '2026-11-24T09:00:00.000Z', op: 'add', state: 'stands', ended: undefined });
    const snaps = [ended('verdict-r', 'review', 'approve'), ended('verdict-b', 'blind-read', 'same'), ended('verdict-a', 'adversarial-read', 'agree'), ended('verdict-p', 'plan-review', 'approve')];
    const versions = snaps.flatMap((s) => [first(s), s]);
    const standing = standingOf({ taskId: 'task-1', versions, judgements: JUDGEMENTS });
    assert.equal(standing.review, null, 'standingOf review');
    assert.equal(standing.blindRead, null, 'standingOf blind read');
    assert.equal(standing.adversarialRead, null, 'standingOf adversarial read (the periodical gate)');
    const times = writeTimesOfVersions(versions);
    const round = roundOf({ changes: [], runs: [{ id: 'run-c', kind: 'run', state: 'done', fields: { stage: 'close-out' }, at: '2026-11-24T08:00:00.000Z' }], verdicts: snaps, times, words: { review: 'review', closeOut: 'close-out' } });
    assert.equal(round.cutAt, null, 'roundOf: a withdrawn review cuts nothing');
    assert.equal(planReviewRunOf({ verdicts: snaps.map((s) => ({ ...s, at: s.at })) }).verdicts, 0, 'planReviewRunOf');
    const views = snaps.map((s) => verdictViewOf(s, '2026-11-24T09:00:00.000Z'));
    for (const judgement of ['review', 'blind-read', 'plan-review', 'adversarial-read']) {
      assert.deepEqual(verdictsInWindow(views, { judgement }), [], `verdictsInWindow ${judgement}`);
    }
    assert.equal(snaps.some(verdictCounts), false, 'the predicate itself');

    // The search: the files in lib/ and routes/ that read verdict records. Each is run above, or reads through one that is
    // (named beside it), or reads verdicts as a list to show rather than to count (the brief and the task page, which
    // drop or label ended records), or writes them.
    const COVERED = {
      'lib/records/standing.js': 'standingOf, run above',
      'lib/records/landing.js': 'roundOf / readLanding, run above',
      'lib/records/plan-review-run.js': 'planReviewRunOf, run above',
      'lib/records/verdict-facts.js': 'verdictsInWindow, run above',
      'lib/records-store.js': 'verdictFactsForTickets -> verdictsInWindow; planReviewRunForTicket -> planReviewRunOf',
      'lib/records/brief.js': 'part 4 shows only records not ended (!r.ended), stricter than verdictCounts',
      'lib/records/views.js': 'the stale flag reads a target ended withdrawn as stale; it counts no verdict',
      'lib/records/summary.js': 'the summary comment of a version being written',
      'lib/records/check.js': 'the write check (rule 1)',
      'lib/records/writes.js': 'the write pipeline',
      'lib/wake-shadow.js': "its own collection's `kind: 'verdict'` rows (a wake classification), not records",
      'routes/proxy-records.js': 'the write route',
      'routes/test.js': 'the E2E seed route (a writer)',
    };
    const found = execFileSync('git', ['grep', '-lE', "kind: 'verdict'|kind === 'verdict'|kind !== 'verdict'", '--', 'lib', 'routes', 'server.js'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    const unrun = found.filter((f) => !COVERED[f]);
    assert.deepEqual(unrun, [], `a verdict reader this census does not run: ${unrun.join(', ')}. Run it over a withdrawn verdict above.`);
  });
});

describe('witness 4: every stage prompt that teaches a judgement belongs to that judge', () => {
  test('the rendered stage prompts teach `"judgement": "<j>"` only from the stage <j>, so no legitimate writer is refused', () => {
    const issue = { id: 'LIN-0000', identifier: 'LIN-0000', title: 't', description: 'd', url: 'https://linear.app/x/issue/LIN-0000', state: { name: 'In Progress', type: 'started' }, labels: [], createdAt: T0 };
    const ctx = { parent: null, siblings: [], project: { name: 'p', description: 'd' }, children: [], comments: [{ body: 'Implementation: https://github.com/example/repo/pull/1', createdAt: T0 }], landingChanges: [{ id: 'change-1', ref: 'https://github.com/example/repo/pull/1', head: 'abc' }] };
    const teaching = {};
    for (const key of Object.keys(PROMPT_TEMPLATES)) {
      const out = generatePrompt(key, issue, ctx);
      if (!out) continue;
      const taught = [...out.prompt.matchAll(/"judgement": "([^"]+)"|`judgement` ([a-z-]+)/g)].map((m) => m[1] || m[2]);
      if (taught.length) teaching[key] = [...new Set(taught)];
    }
    for (const [key, taught] of Object.entries(teaching)) {
      for (const j of taught.filter((x) => STAGES.includes(x))) assert.equal(key, j, `the ${key} prompt teaches a ${j} verdict, which only the ${j} stage may write`);
    }
    // Production's three verdict writers are exactly these.
    assert.deepEqual(Object.keys(teaching).sort(), ['blind-read', 'plan-review', 'review']);
  });
});

describe('witness 5: the E2E seed route writes each verdict as its judge, and it passes the rule', () => {
  test('/test/seed-ticket-records seeds a review and a blind read', async () => {
    const app = express();
    app.use(createTestRoutes({ recordsStore: store }));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/test/seed-ticket-records`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urlKey: URL_KEY, ticket: 'LIN-9001', events: [
          { kind: 'pr', pr: PR, head: 'H1', at: '2026-11-24T09:00:00.000Z' },
          { kind: 'review', on: PR, at: '2026-11-24T09:01:00.000Z' },
          { kind: 'blindRead', on: PR, at: '2026-11-24T09:02:00.000Z' },
        ] }),
      });
      assert.equal(res.status, 200, await res.clone().text());
      const verdicts = await store.find(URL_KEY, { kind: 'verdict' });
      assert.deepEqual(verdicts.map((v) => [v.fields.judgement, v.by]).sort(), [['blind-read', 'blind-read'], ['review', 'review']]);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('witness 7: one judging-kind question, and no list of judging kinds', () => {
  test('judgesAs is the keys of KINDS.outcomes, defined once and asked by the write rule, the dispatch step and the factory\'s freshness guard only', () => {
    for (const j of Object.keys(KINDS.outcomes)) assert.equal(judgesAs(j), true, j);
    for (const k of ['implementation', 'close-out', 'custom', '', null, undefined, 'toString', '__proto__']) assert.equal(judgesAs(k), false, String(k));
    const defs = execFileSync('git', ['grep', '-n', 'export function judgesAs', '--', 'lib', 'routes'], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(defs.length, 1, defs.join('\n'));
    const callers = execFileSync('git', ['grep', '-n', 'judgesAs(', '--', 'lib', 'routes', 'server.js'], { encoding: 'utf8' }).trim().split('\n')
      .filter((l) => !/export function judgesAs/.test(l)).map((l) => l.split(':')[0]);
    assert.deepEqual([...new Set(callers)].sort(), ['lib/dispatch-entrance.js', 'lib/dispatch-factory.js', 'lib/records/check.js']);
  });

  test('kinds.json gained no map: its top-level keys and outcome sets are as before', () => {
    const raw = JSON.parse(readFileSync(new URL('../../lib/records/kinds.json', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(raw).sort(), Object.keys(KINDS).sort());
    assert.deepEqual(Object.keys(raw.outcomes).sort(), ['adversarial-read', 'blind-read', 'plan-review', 'review']);
    for (const file of ['lib/records/check.js', 'lib/dispatch-entrance.js', 'lib/dispatch-factory.js']) {
      const src = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(src, /\[\s*'review',\s*'plan-review'|new Set\(\[\s*'review'|JUDG\w*_KINDS\s*=/, `${file} names a list of judging kinds`);
    }
  });
});
