/**
 * LIN-4506 (P6 of LIN-4499, slice 2): walk 8's breakdown and a correction, replayed through the proxy routes on a temporary
 * store, with child tickets made on the real local provider.
 *
 * Why a new file rather than more steps in tests/unit/lin-4496-walk8-replay.test.js: that file replays a walk whose plans
 * and children are seeds (written through the pipeline with a historical `by`, no addressee, no ticket). This replay writes
 * every step it asserts through the routes, as today's stages write them: a plan to breakdown, a plan-review finding, a
 * verdict (a records verdict, as the plan-review stage POSTs it), a revise, a finding end, pieces to implementation, and child
 * tasks with their `piece`. The historical file stays as the witness of the walk's end state.
 *
 * Source material: walk 8's `lin-4469` fixture (LIN-4448's breakdown): its seven piece plans (plan-109..115, texts and
 * order) and the six children that name plan-109..114 as their `piece` (task-123..128, done-when). Piece 6 has no child,
 * as in the walk. The fixture has no breakdown plan, so this replay writes one (`to: breakdown`) and the review round on it.
 *
 * Witnesses (the ticket's list):
 *   1. every write is accepted by the route it names (a refusal fails the replay), and the store ends in the replay's shape;
 *   2. breakdown writes the pieces and the child tasks; ensureTicket runs against the local provider: each child has one
 *      ticket, filed under the parent, whose description carries the child's task mark and no copied piece text;
 *   3. a child's run brief carries its piece in full; a sibling stage (plan-review, on the parent) sees a piece's first
 *      paragraph and its id, and not the rest;
 *   4. a correction is a revise with a reason: the child's next brief shows v2, and `get piece@1` still returns v1;
 *   5. the revision round, through the selector's plan facts (the facts prepareRecommendationInput hands the selector,
 *      rendered by buildSelectorArgs): review owed while the finding is open; after request-changes and no revision the plan
 *      has not changed since the verdict; after the revise it has; an Approve ends the finding and the review is no longer owed;
 *   6. a breakdown plan with no plan-review finding reads as review owed; a one-session plan reads as one session; a
 *      piece-linked child reads as one session, part of its parent's plan, with no review owed.
 *
 * Not witnessed here, and why:
 *   - which stage the selector routes to: routing is a model's choice (lib/openrouter.js). The test asserts the facts the
 *     model is given; the routing rules in its prompt are pinned by tests/unit/lin-4504-plan-facts.test.js.
 *   - production readings (held-run sit times): they need the production database and are not run by this file.
 *     The readings this file computes are reported with t.diagnostic, never asserted: they are not a gate.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
import { composeRunBrief } from '../../lib/records/run-brief.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';
import { markedTaskOf } from '../../lib/records/ticket-stub.js';
import { LocalStore } from '../../lib/local-store.js';
import { localProvider } from '../../lib/providers/local/index.js';
import { trackerPortOf } from '../../lib/records-tracker.js';

const URL_KEY = 'lin-4506-breakdown-replay';
const PERSON = { accountId: 'acc-john', name: 'John' };
const PEOPLE = [PERSON];
const STAGES = Object.keys(STAGE_KINDS);
const DONE_WHEN = 'the walk-8 breakdown is replayed through the proxy';

const WALK = JSON.parse(readFileSync(new URL('../fixtures/walk-8/lin-4469.json', import.meta.url), 'utf8'));
const seedOf = (id) => WALK.seeds.find((s) => s.op === 'add' && s.id === id);
const ASKED = seedOf('task-105').fields.asked;
/**
 * A piece's text as the walk holds it, with one formatting change: a piece's `*Witness:*` clause starts its own paragraph
 * (the walk's text has a space there). Without a second paragraph the sibling check has nothing to tell apart from the
 * first paragraph; no words are added or cut.
 */
const pieceText = (s) => s.replace(' *Witness:*', '\n\n*Witness:*');
const PIECES = ['plan-109', 'plan-110', 'plan-111', 'plan-112', 'plan-113', 'plan-114', 'plan-115'].map((id) => ({ seed: id, says: pieceText(seedOf(id).fields.says) }));
/** The walk's six children: each names one piece by its seed id, and carries its done-when (task-123..128). */
const CHILDREN = ['task-123', 'task-124', 'task-125', 'task-126', 'task-127', 'task-128'].map((id) => {
  const s = seedOf(id);
  return { seed: id, doneWhen: s.fields['done-when'], pieceSeed: s.links.piece };
});

const firstParagraph = (s) => String(s).split(/\n\s*\n/)[0];
/** The text after a piece's first paragraph: what a sibling stage must not see. Asserted non-empty, so no check is vacuous. */
const tailOf = (s) => String(s).slice(firstParagraph(s).length).trim();
const PLAN_TEXT = ['Walk 8 (LIN-4448): seven pieces, each built in its own session, in order.', ...PIECES.map((p) => firstParagraph(p.says))].join('\n\n');
const PLAN_TEXT_V2 = `${PLAN_TEXT}\n\nRevised after plan-review: piece 6 names the witness it leaves open.`;
const PIECE0_CORRECTED = PIECES[0].says.replace('Piece 0:', 'Piece 0 (corrected by John):');
// LIN-4520: a plan-review verdict is a records verdict, not a comment: its reasoning is the one-line reason the stage gives.
const CHANGES_REASONING = 'Piece 6 leaves its witness open.';
const APPROVED_REASONING = 'the revised plan names its witness';

const mango = createMangoTmpdir('lin-4506-');
before(() => mango.connect());
after(() => mango.close());

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ok = (r, what) => {
  assert.ok(r.status >= 200 && r.status < 300, `${what} refused ${r.status}: ${JSON.stringify(r.body).slice(0, 500)}`);
  return r.body;
};

let rh = null;
let local = null;
let runCount = 0;

/** A stage's run on a task: a dispatch row, and the credential that writes under it. */
async function stage(stageName, taskId) {
  runCount += 1;
  const runId = `run-lin-4506-${runCount}-${stageName}`;
  await rh.store.openRun(URL_KEY, { id: runId, stage: stageName, taskId, lineage: `lineage-lin-4506-${runCount}` });
  return { runId, stage: stageName, taskId, token: await rh.mintRunToken(runId) };
}

/** The run's brief, as the stage is given it (lib/records/run-brief.js). */
async function briefOf(run) {
  const brief = await composeRunBrief({ store: rh.store, urlKey: URL_KEY, runId: run.runId });
  assert.equal(brief.problem, undefined, `brief for ${run.runId}: ${brief.problem}`);
  return brief;
}

/** The selector's plan facts for a ticket: the fold, the plan-review run, and the facts text the selector is given. */
async function factsOf(identifier, comments = []) {
  const planFacts = (await rh.store.planFactsForTickets(URL_KEY, [identifier])).get(identifier);
  const planReviewRun = await rh.store.planReviewRunForTicket(URL_KEY, identifier);
  const issue = await localProvider.issueDetail(URL_KEY, identifier);
  return { planFacts, planReviewRun, text: buildSelectorArgs(issue, { comments, children: [], planFacts, planReviewRun }).facts };
}

/**
 * A plan-review verdict on `planId`, POSTed under the plan-review run as the stage writes it (lib/prompts/stage-kinds.js).
 * Returns it with the instant the records hold for it.
 */
async function verdictOf(run, planId, outcome, reasoning) {
  const made = ok(await rh.post('/api/proxy/records', run.token, { kind: 'verdict', judgement: 'plan-review', outcome, in: run.taskId, on: [planId], reasoning, run: run.runId }), `plan-review verdict ${outcome}`);
  const { snap } = await rh.store.read(URL_KEY, made.id);
  assert.ok(snap?.at, 'the verdict record reads back with its time');
  return { id: made.id, outcome, at: snap.at };
}

/** A task made from a ticket through the route, as dispatch makes it: `ref` names the ticket. */
async function taskFromTicket(identifier) {
  const john = await rh.mintPersonToken(PERSON.accountId);
  return ok(await rh.post('/api/proxy/records', john, { kind: 'task', ref: identifier, 'done-when': DONE_WHEN }), `task for ${identifier}`).id;
}

/** Walk 8's breakdown, its correction and the revision round, through the proxy. Returns what the tests read. */
async function replay() {
  rh = await createRecordsRouteHarness({
    harness: mango,
    urlKey: URL_KEY,
    tickets: new Map(),
    people: PEOPLE,
    readTicket: (_req, ref) => localProvider.issueDetail(URL_KEY, ref),
    tracker: () => local
  });
  localProvider.configure({ store: new LocalStore({ collection: rh.db.collection('local-issues') }) });
  local = trackerPortOf({ provider: localProvider, scope: URL_KEY });
  const john = await rh.mintPersonToken(PERSON.accountId);
  const out = { runs: [] };
  const track = (run) => { out.runs.push(run); return run; };

  // The parent: the walk's breakdown ticket as a local issue, whose description holds the person's words.
  const parent = await localProvider.createIssue(URL_KEY, { title: 'LIN-4448 walk 8: breakdown, replayed', description: ASKED });
  const parentTask = await taskFromTicket(parent.identifier);
  Object.assign(out, { parent, parentTask });

  // Plan: one plan addressed to breakdown (several sessions), and a plan-review finding about it.
  const planRun = track(await stage('plan', parentTask));
  const plan = ok(await rh.post('/api/proxy/records', planRun.token, { kind: 'plan', in: parentTask, to: 'breakdown', says: PLAN_TEXT, order: 0, run: planRun.runId }), 'plan');
  const finding = ok(await rh.post('/api/proxy/records', planRun.token, { kind: 'finding', to: 'plan-review', in: parentTask, links: { about: [plan.id] }, says: 'Review the plan before breakdown: seven pieces, each with its witness.', how: 'read the plan with GET /api/proxy/records/<plan id>', run: planRun.runId }), 'plan-review finding');
  Object.assign(out, { planId: plan.id, findingId: finding.id });
  out.factsReviewDue = await factsOf(parent.identifier);

  // Plan-review requests changes (a records verdict). The finding stays open and the plan is not yet revised.
  await sleep(10);
  const changesRun = track(await stage('plan-review', parentTask));
  out.changesRequested = await verdictOf(changesRun, plan.id, 'request-changes', CHANGES_REASONING);
  out.factsUnrevised = await factsOf(parent.identifier);

  // The plan is revised (v2, a new last-changed time), with its reason.
  await sleep(10);
  const reviseRun = track(await stage('plan', parentTask));
  out.revised = ok(await rh.post(`/api/proxy/records/${plan.id}/revise`, reviseRun.token, { says: PLAN_TEXT_V2, reason: 'answers the request-changes verdict: piece 6 names its witness', run: reviseRun.runId }), 'plan revise');
  out.factsRevised = await factsOf(parent.identifier);

  // Plan-review again: Approve, which ends the finding (the plan-review route's own step).
  await sleep(10);
  const approveRun = track(await stage('plan-review', parentTask));
  out.approved = await verdictOf(approveRun, plan.id, 'approve', APPROVED_REASONING);
  ok(await rh.post(`/api/proxy/records/${finding.id}/end`, approveRun.token, { state: 'done', reason: 'approved: the verdict on the revised plan', run: approveRun.runId }), 'finding end');
  out.factsApproved = await factsOf(parent.identifier);

  // Breakdown: each piece to implementation, then each child task with its piece. ensureTicket makes each child's ticket.
  const breakdownRun = track(await stage('breakdown', parentTask));
  out.pieces = [];
  for (const [i, p] of PIECES.entries()) {
    const r = ok(await rh.post('/api/proxy/records', breakdownRun.token, { kind: 'plan', in: parentTask, to: 'implementation', says: p.says, order: i + 1, run: breakdownRun.runId }), `piece ${p.seed}`);
    out.pieces.push({ seed: p.seed, id: r.id, says: p.says });
  }
  const pieceOf = (seed) => out.pieces.find((p) => p.seed === seed);
  out.children = [];
  for (const c of CHILDREN) {
    const r = ok(await rh.post('/api/proxy/records', breakdownRun.token, { kind: 'task', in: parentTask, 'done-when': c.doneWhen, links: { piece: pieceOf(c.pieceSeed).id }, run: breakdownRun.runId }), `child of ${c.pieceSeed}`);
    assert.ok(r.ticket && !r.ticket.error, `the child's ticket: ${JSON.stringify(r.ticket)}`);
    out.children.push({ seed: c.seed, id: r.id, identifier: r.ticket.identifier, piece: pieceOf(c.pieceSeed) });
  }

  // A sibling stage on the parent (plan-review) sees each piece's first paragraph and id, not the rest.
  const siblingRun = track(await stage('plan-review', parentTask));
  out.siblingBrief = await briefOf(siblingRun);

  // Each child's implementation run, before the correction: its piece in full.
  out.childBriefV1 = [];
  for (const c of out.children) {
    const run = track(await stage('implementation', c.id));
    out.childBriefV1.push({ child: c.id, brief: await briefOf(run) });
  }

  // A correction: John revises piece 0 with its reason. The child's next brief shows v2; piece@1 still reads v1.
  const piece0 = out.pieces[0];
  out.correction = ok(await rh.post(`/api/proxy/records/${piece0.id}/revise`, john, { says: PIECE0_CORRECTED, reason: 'John\'s correction: the piece names its kit run as the witness' }), 'correction');
  const runV2 = track(await stage('implementation', out.children[0].id));
  out.childBriefV2 = await briefOf(runV2);
  out.pieceNow = ok(await rh.get(`/api/proxy/records/${piece0.id}`, john), 'piece now');
  out.piece0V1 = ok(await rh.get(`/api/proxy/records/${piece0.id}@1`, john), 'piece v1');

  // The selector's facts for the children and the two extra tickets: a child, a breakdown plan with no review, one session.
  out.childFacts = await factsOf(out.children[0].identifier);
  const unreviewed = await localProvider.createIssue(URL_KEY, { title: 'Walk 8 extra: a breakdown with no review', description: 'Extra ticket words.' });
  const unreviewedTask = await taskFromTicket(unreviewed.identifier);
  const unreviewedRun = track(await stage('plan', unreviewedTask));
  ok(await rh.post('/api/proxy/records', unreviewedRun.token, { kind: 'plan', in: unreviewedTask, to: 'breakdown', says: 'Two sessions.', order: 0, run: unreviewedRun.runId }), 'unreviewed plan');
  out.unreviewedFacts = await factsOf(unreviewed.identifier);
  const oneSession = await localProvider.createIssue(URL_KEY, { title: 'Walk 8 extra: one session', description: 'One session words.' });
  const oneSessionTask = await taskFromTicket(oneSession.identifier);
  const oneSessionRun = track(await stage('plan', oneSessionTask));
  ok(await rh.post('/api/proxy/records', oneSessionRun.token, { kind: 'plan', in: oneSessionTask, to: 'implementation', says: 'One session.', order: 0, run: oneSessionRun.runId }), 'one-session plan');
  out.oneSessionFacts = await factsOf(oneSession.identifier);

  for (const run of out.runs) await rh.store.endRun(URL_KEY, run.runId, { state: 'done' });
  out.childIssues = await Promise.all(out.children.map((c) => localProvider.issueDetail(URL_KEY, c.identifier)));
  out.childrenListed = await local.childrenOf(parent.identifier);
  return out;
}

describe('LIN-4506: walk 8 breakdown and correction replayed through the proxy', () => {
  let S = null;
  before(async () => {
    S = await replay();
  });
  after(async () => {
    await rh?.close();
  });

  test('1. every write is accepted, and the store ends in the replay\'s shape', async () => {
    assert.equal(S.pieces.length, PIECES.length, 'seven pieces written');
    assert.equal(S.children.length, CHILDREN.length, 'six children written');
    const { snap: planNow } = await rh.store.read(URL_KEY, S.planId);
    assert.equal(planNow.v, 2, 'the plan is at v2 after its revise');
    assert.equal(planNow.to, 'breakdown', 'the plan stays addressed to breakdown');
    const { snap: finding } = await rh.store.read(URL_KEY, S.findingId);
    assert.equal(finding.state, 'done', 'Approve ended the plan-review finding');
    for (const p of S.pieces) {
      const { snap } = await rh.store.read(URL_KEY, p.id);
      assert.equal(snap.kind, 'plan');
      assert.equal(snap.to, 'implementation', `${p.seed} is addressed to implementation`);
      assert.equal(snap.state, 'kept');
    }
    const openToStages = [];
    for (const stageName of STAGES) {
      for (const snap of await rh.store.find(URL_KEY, { to: stageName, state: 'open' })) openToStages.push(`${snap.id} to ${stageName}`);
    }
    assert.deepEqual(openToStages, [], 'no hand-off addressed to a stage is open at the end');
  });

  test('2. breakdown writes the children, each with one ticket filed under the parent on the local provider, and no piece text copied into it', async () => {
    const listed = await local.childrenOf(S.parent.identifier);
    assert.equal(listed.capped, false, 'the local children read is whole');
    assert.deepEqual([...listed.children].sort(), S.children.map((c) => c.identifier).sort(), 'the parent lists exactly the six children');
    let copied = 0;
    for (const [i, c] of S.children.entries()) {
      const issue = S.childIssues[i];
      assert.equal(issue.parent?.identifier, S.parent.identifier, `${c.identifier} is filed under the parent`);
      assert.equal(markedTaskOf(issue.description), c.id, `${c.identifier} carries its task's mark`);
      assert.match(issue.description, new RegExp(`\\*\\*Piece:\\*\\* ${c.piece.id}`), 'the stub names its piece by id');
      for (const p of S.pieces) if (issue.description.includes(firstParagraph(p.says))) copied += 1;
    }
    assert.equal(copied, 0, 'no child ticket carries a piece\'s text');
  });

  test('3. a child\'s brief carries its piece in full; a sibling stage sees only the piece\'s first paragraph and its id', async () => {
    // The brief renders a multi-line field with its continuation lines indented four spaces (lib/records/brief.js recordText),
    // so "in full" is the stored text in that rendered form.
    const rendered = (s) => s.replace(/\n/g, '\n    ');
    for (const [i, c] of S.children.entries()) {
      const { text } = S.childBriefV1[i].brief;
      assert.ok(text.includes(rendered(c.piece.says)), `${c.identifier}'s brief carries piece ${c.piece.seed} in full`);
    }
    const sibling = S.siblingBrief.text;
    assert.ok(S.pieces.some((p) => tailOf(p.says).length > 0), 'some piece has more than a first paragraph, so the check can fail');
    for (const p of S.pieces) {
      assert.ok(sibling.includes(p.id), `the sibling sees ${p.seed}'s id`);
      assert.ok(sibling.includes(firstParagraph(p.says)), `the sibling sees ${p.seed}'s first paragraph`);
      if (tailOf(p.says).length > 0) assert.ok(!sibling.includes(tailOf(p.says)), `the sibling does not see the rest of ${p.seed}`);
    }
  });

  test('4. a correction is a new version: the next brief shows v2, and get piece@1 still returns v1', async () => {
    const piece0 = S.pieces[0];
    assert.equal(S.correction.v, 2, 'the correction is v2');
    assert.equal(S.pieceNow.v, 2);
    assert.equal(S.pieceNow.fields.says, PIECE0_CORRECTED, 'the current version reads the correction');
    assert.equal(S.piece0V1.v, 1);
    assert.equal(S.piece0V1.fields.says, piece0.says, 'piece@1 still returns the words it was written with');
    const v2 = S.pieceNow.versions.find((x) => x.v === 2);
    assert.equal(v2?.reason, 'John\'s correction: the piece names its kit run as the witness', 'the history keeps v2 with its reason');
    assert.equal(S.pieceNow.versions.find((x) => x.v === 1)?.reason, undefined, 'v1 has no reason: it was written, not revised');
    assert.ok(S.childBriefV2.text.includes('Piece 0 (corrected by John):'), 'the child\'s next brief shows v2');
    assert.ok(!S.childBriefV2.text.includes('Piece 0: That last line'), 'the child\'s next brief no longer shows v1');
  });

  test('5. the revision round: review owed while the finding is open; once the plan has changed since the verdict, it is owed again; an Approve ends it', async () => {
    const verdictAt = Date.parse(S.changesRequested.at);
    assert.equal(S.factsReviewDue.planFacts.sessionFit, 'several');
    assert.equal(S.factsReviewDue.planFacts.reviewOwed.why, 'open-finding');
    assert.equal(S.factsReviewDue.planFacts.reviewOwed.finding, S.findingId);

    const unrevised = S.factsUnrevised.planFacts.own[0];
    assert.equal(unrevised.v, 1, 'before the revise the plan is v1');
    assert.equal(S.factsUnrevised.planFacts.reviewOwed.owed, true, 'the finding is still open');
    assert.ok(Date.parse(unrevised.at) <= verdictAt, 'the unrevised plan has not changed since the request-changes verdict');
    assert.match(S.factsUnrevised.text, /latest: request changes/, 'the verdict is in the facts the selector reads');

    const revised = S.factsRevised.planFacts.own[0];
    assert.equal(revised.v, 2, 'the revised plan shows v2 in the facts');
    assert.match(S.factsRevised.text, new RegExp(`${S.planId} v2 to breakdown`));
    assert.ok(Date.parse(revised.at) > verdictAt, 'the revision is after the verdict, so the review is due again');
    assert.equal(S.factsRevised.planFacts.reviewOwed.owed, true, 'the finding is open until a plan-review ends it');

    assert.equal(S.factsApproved.planFacts.reviewOwed.owed, false, 'after Approve the review is no longer owed');
  });

  test('6. a breakdown plan with no review reads as review owed; a one-session plan reads as one session; a piece-linked child reads as one session, part of the parent\'s plan, with no review owed', async () => {
    assert.equal(S.unreviewedFacts.planFacts.sessionFit, 'several');
    assert.equal(S.unreviewedFacts.planFacts.reviewOwed.why, 'breakdown-unreviewed', 'a breakdown plan no plan-review has seen is owed one');

    assert.equal(S.oneSessionFacts.planFacts.sessionFit, 'one');
    assert.equal(S.oneSessionFacts.planFacts.reviewOwed.owed, false);

    const child = S.childFacts.planFacts;
    assert.equal(child.partOfParent, true, 'the child is part of its parent\'s plan');
    assert.equal(child.piece.id, S.children[0].piece.id, 'the child points at its piece');
    assert.equal(child.hasPlan, true);
    assert.equal(child.sessionFit, 'one', 'a piece-linked child reads as one session');
    assert.equal(child.reviewOwed.owed, false, 'a piece is covered by construction: no review owed');
  });

  test('7. the readings (reported with t.diagnostic, never asserted)', (t) => {
    const copied = S.children.reduce((n, c, i) => n + S.pieces.filter((p) => p.seed !== c.piece.seed && S.childBriefV1[i].brief.text.includes(firstParagraph(p.says))).length, 0);
    const bytes = {
      childV1: S.childBriefV1.map((b) => b.brief.bytes),
      childV2: S.childBriefV2.bytes,
      sibling: S.siblingBrief.bytes
    };
    t.diagnostic(`brief bytes: ${JSON.stringify(bytes)}`);
    t.diagnostic(`copied piece text in child briefs (other pieces' first paragraphs): ${copied}`);
    t.diagnostic('LIN-4491 19 Nov and 13-14 Nov brief-byte readings: not compared here (see the PR)');
  });
});
