/**
 * LIN-4504: the branch-only slice-2 import (scripts/records/slice-2-import.mjs). Deleted with the script in the PR's last
 * commit. The old facts here are what the deployed readers return (the capture computes them from a worktree of the
 * deployed commit); these tests drive the importer's own decisions on them:
 *   - a session-fit line saying several sessions lands `to: breakdown`, and one session `to: implementation`;
 *   - a comment plan is imported, its text the comment's;
 *   - a review-due yes with no Approve gets an open plan-review finding; an Approve as the latest verdict gets the
 *     finding already ended, and reads not due;
 *   - note A (finding-f8a27c72): a leaf planned only through its parent is held, never linked to the parent's plan;
 *   - an unreadable plan is held with no default; a task already holding plan records is held;
 *   - a breakdown child's copied slice becomes a child-local plan to implementation, saying it cannot be mapped;
 *   - apply writes through the checked writer `via: import` with fixed ids: a dry run writes nothing, a re-apply makes
 *     nothing twice, and no summary is posted;
 *   - compare classifies each difference against the closed list, and flags anything else as unexplained.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { askedOf } from '../../lib/asked-of.js';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';
import {
  planTicket, importPlanOf, applyImport, compareFacts, recordsAfter, importIdsOf, oldFactsOf, ADDRESSEE_OF_FIT, EXPLAINED, PROPOSED,
} from '../../scripts/records/slice-2-import.mjs';

const old = (over = {}) => ({ leaf: true, where: null, parent: null, at: null, sessionFit: null, planReviewDue: null, nodeSessionFit: null, latestVerdict: { verdict: null, at: null }, lookFirstHasPlan: false, ...over });
const ticket = (identifier, over = {}) => ({ identifier, description: 'Goal.', comments: [], children: [], state: { type: 'started', name: 'In Progress' }, parentRef: null, planSection: null, planComment: null, old: old(), ...over });
const NO_STORE = { taskOf: () => null, plansIn: () => [] };

describe('planTicket: what each in-flight plan becomes', () => {
  test('several sessions lands to: breakdown, and one session to: implementation (ADDRESSEE_OF_FIT)', () => {
    const several = planTicket(ticket('LIN-1', { planSection: 'The plan.', old: old({ where: 'description', sessionFit: 'needs multiple sessions' }) }), NO_STORE);
    assert.equal(several.action, 'import');
    assert.equal(several.plan.to, 'breakdown');
    assert.equal(several.plan.says, 'The plan.');
    const one = planTicket(ticket('LIN-2', { planSection: 'The plan.', old: old({ where: 'description', sessionFit: 'fits one session' }) }), NO_STORE);
    assert.equal(one.plan.to, 'implementation');
    assert.deepEqual(Object.values(ADDRESSEE_OF_FIT).sort(), ['breakdown', 'implementation']);
  });

  test('a comment plan is imported with the comment\'s text', () => {
    const c = { id: 'c1', body: 'Plan: do it in one go.', createdAt: '2026-11-19T10:00:00.000Z' };
    const r = planTicket(ticket('LIN-3', { comments: [c], planComment: c, old: old({ where: 'comment', at: c.createdAt, sessionFit: 'fits one session' }) }), NO_STORE);
    assert.equal(r.from, 'comment');
    assert.equal(r.plan.says, 'Plan: do it in one go.');
  });

  test('review due yes with no Approve: an open finding about the plan; Approve latest: the finding already ended', () => {
    const due = planTicket(ticket('LIN-4', { planSection: 'p', old: old({ where: 'description', sessionFit: 'fits one session', planReviewDue: 'yes' }) }), NO_STORE);
    assert.deepEqual([due.finding.to, due.finding.about, due.finding.end], ['plan-review', importIdsOf('LIN-4').plan, null]);
    const approved = planTicket(ticket('LIN-5', { planSection: 'p', old: old({ where: 'description', sessionFit: 'needs multiple sessions', planReviewDue: 'yes', latestVerdict: { verdict: 'approve', at: '2026-11-18T00:00:00.000Z' } }) }), NO_STORE);
    assert.equal(approved.finding.end.state, 'done');
    assert.match(approved.finding.end.reason, /Approve/);
    const noReview = planTicket(ticket('LIN-6', { planSection: 'p', old: old({ where: 'description', sessionFit: 'fits one session', planReviewDue: 'no' }) }), NO_STORE);
    assert.equal(noReview.finding, null);
  });

  test('note A: a leaf planned only through its parent is held for replanning, not linked by piece', () => {
    const r = planTicket(ticket('LIN-7', { old: old({ parent: 'LIN-1' }) }), NO_STORE);
    assert.deepEqual([r.action, r.reason], ['held', 'parent-only']);
    assert.equal(r.plan, undefined, 'no record, no piece');
  });

  test('an unreadable plan is held, with no default addressee; a ticket with no plan gets nothing', () => {
    assert.deepEqual(planTicket(ticket('LIN-8', { planSection: 'p', old: old({ where: 'description' }) }), NO_STORE).reason, 'unreadable');
    assert.equal(planTicket(ticket('LIN-9'), NO_STORE).action, 'none');
    const node = ticket('LIN-10', { children: [{ identifier: 'LIN-11', state: { type: 'unstarted' } }], old: old({ leaf: false, nodeSessionFit: 'needs multiple sessions' }) });
    assert.equal(planTicket(node, NO_STORE).reason, 'unreadable', 'a node with a session-fit phrase and no plan section');
    assert.equal(planTicket({ ...node, planSection: 'Pieces A and B.' }, NO_STORE).plan.to, 'breakdown', 'a node\'s plan section imports by its session fit');
  });

  test('a task that already holds plan records is held; a copied slice becomes a child-local plan', () => {
    const store = { taskOf: () => ({ id: 'task-x' }), plansIn: () => [{ id: 'plan-72a996db', state: 'kept' }] };
    assert.deepEqual(planTicket(ticket('LIN-12', { planSection: 'p', old: old({ where: 'description', sessionFit: 'fits one session' }) }), store).reason, 'has-records');
    const copied = planTicket(ticket('LIN-13', {
      parentRef: 'LIN-1',
      description: 'Piece A.\n\n## Implementation Plan\n\nSlice A of the parent plan.\n\n**Plan-review due:** no — covered by LIN-1\'s approving plan-review',
      planSection: 'Slice A of the parent plan.\n\n**Plan-review due:** no — covered by LIN-1\'s approving plan-review', old: old({ where: 'description', sessionFit: 'fits one session', planReviewDue: 'no' }),
    }), NO_STORE);
    assert.equal(copied.copied, true);
    assert.equal(copied.plan.to, 'implementation');
    assert.match(copied.plan.says, /cannot be mapped to a parent piece/);
    // The covered-by words in the asked text, with a plan of the ticket's own below them, are not a copied slice.
    const own = planTicket(ticket('LIN-14', {
      description: '## As asked\n\nPlan-review due: no — covered by LIN-1\'s approving plan-review.\n\n## Implementation Plan\n\nMy own plan.',
      planSection: 'My own plan.', old: old({ where: 'description', sessionFit: 'needs multiple sessions' }),
    }), NO_STORE);
    assert.equal(own.copied, false);
    assert.equal(own.plan.says, 'My own plan.');
    // A plan that quotes the covered-by words about some other ticket is not a copy either.
    const quoting = planTicket(ticket('LIN-15', { parentRef: 'LIN-1', planSection: 'It regexes `plan-review due: no ... covered by` out of descriptions.', old: old({ where: 'description', sessionFit: 'fits one session' }) }), NO_STORE);
    assert.equal(quoting.copied, false);
  });

  test('ids come from fixedIdOf, so a second plan of the same capture names the same records', () => {
    assert.deepEqual(importIdsOf('LIN-1'), importIdsOf('LIN-1'));
    assert.notEqual(importIdsOf('LIN-1').plan, importIdsOf('LIN-2').plan);
    assert.match(importIdsOf('LIN-1').plan, /^plan-[0-9a-f]{8}$/);
  });

  test('oldFactsOf reads through the deployed readers it is given (look-first is plan.where with no parent)', () => {
    const legacy = {
      trailPlan: (c, d, parent) => ({ where: d ? 'description' : null, parent: parent ? 'LIN-0' : undefined, at: null, sessionFit: 'fits one session', planReviewDue: 'no' }),
      nodeSessionFit: () => 'needs multiple sessions',
      latestVerdict: () => ({ verdict: 'approve', at: 'x' }),
    };
    const leaf = oldFactsOf(legacy, { description: 'd', comments: [], children: [], parent: { identifier: 'LIN-0', description: 'p' } });
    assert.deepEqual([leaf.where, leaf.parent, leaf.lookFirstHasPlan, leaf.nodeSessionFit], ['description', 'LIN-0', true, null]);
    assert.equal(oldFactsOf(legacy, { description: 'd', children: [{}] }).nodeSessionFit, 'needs multiple sessions');
  });
});

describe('compare: every difference is classified against the closed list', () => {
  const capOf = (tickets, records = {}) => ({ open: Object.keys(tickets), tickets, records: { tasks: [], plans: [], findings: [], ...records } });

  test('A (Approve clears review due), B (unreadable held), C (note A held), D (breakdown plan with no finding); and an unexplained one', () => {
    const tickets = {
      'LIN-1': ticket('LIN-1', { planSection: 'p', old: old({ where: 'description', sessionFit: 'needs multiple sessions', planReviewDue: 'yes', lookFirstHasPlan: true, latestVerdict: { verdict: 'approve', at: 't' } }) }),
      'LIN-2': ticket('LIN-2', { planSection: 'p', old: old({ where: 'description', lookFirstHasPlan: true }) }),
      'LIN-3': ticket('LIN-3', { old: old({ parent: 'LIN-1' }) }),
      'LIN-4': ticket('LIN-4', { planSection: 'p', old: old({ where: 'description', sessionFit: 'needs multiple sessions', planReviewDue: 'no', lookFirstHasPlan: true }) }),
    };
    const cap = capOf(tickets);
    const planned = importPlanOf(cap);
    const result = compareFacts(cap, planned, recordsAfter(cap, planned));
    const by = (t, f) => result.differences.find((d) => d.ticket === t && d.fact === f);
    assert.equal(by('LIN-1', 'reviewDue').explained, 'A');
    assert.equal(by('LIN-2', 'hasPlan').explained, 'B');
    assert.equal(by('LIN-3', 'hasPlan').explained, 'C');
    assert.equal(by('LIN-3', 'partOfParent').explained, 'C');
    assert.equal(by('LIN-4', 'reviewDue').explained, 'D');
    assert.deepEqual(result.unexplained, []);
    assert.deepEqual(Object.keys(EXPLAINED), ['A', 'B', 'C', 'D', 'E']);

    // A record the import did not write (or wrote wrongly) shows as unexplained: here a plan addressed the other way.
    const wrong = recordsAfter(cap, planned);
    wrong.plans.find((p) => p.id === importIdsOf('LIN-4').plan).to = 'implementation';
    const bad = compareFacts(cap, planned, wrong);
    assert.ok(bad.unexplained.some((d) => d.ticket === 'LIN-4' && d.fact === 'sessionFit'), JSON.stringify(bad.unexplained));
  });

  test('a session-fit phrase on a ticket with no plan is proposed as F, and stays unexplained until a person accepts it', () => {
    const cap = capOf({ 'LIN-9': ticket('LIN-9', { description: '## Scope\n\nOne session will do.', old: old({ sessionFit: 'fits one session' }) }) });
    const planned = importPlanOf(cap);
    assert.equal(planned.rows[0].action, 'none', 'prose is not a plan: nothing is imported');
    const result = compareFacts(cap, planned, recordsAfter(cap, planned));
    assert.deepEqual(result.unexplained.map((d) => [d.fact, d.proposal]), [['sessionFit', 'F']]);
    assert.ok(PROPOSED.F);
  });

  test('matching facts give no difference, and the ticket holding the throwaway plan is E', () => {
    const tickets = {
      'LIN-5': ticket('LIN-5', { planSection: 'p', old: old({ where: 'description', sessionFit: 'fits one session', lookFirstHasPlan: true }) }),
      'LIN-6': ticket('LIN-6', { old: old() }),
    };
    const cap = capOf(tickets, { tasks: [{ id: 'task-6', kind: 'task', state: 'open', fields: { ref: 'LIN-6' }, links: {} }], plans: [{ id: 'plan-72a996db', kind: 'plan', state: 'kept', in: 'task-6', to: 'implementation', v: 1 }] });
    const planned = importPlanOf(cap);
    const result = compareFacts(cap, planned, recordsAfter(cap, planned));
    assert.ok(result.differences.every((d) => d.ticket === 'LIN-6' && d.explained === 'E'), JSON.stringify(result.differences));
    assert.ok(result.differences.length >= 1);
  });
});

describe('apply: through the checked writer, via import, with fixed ids', () => {
  const URL_KEY = 'lin-4504-import';
  const harness = createMangoTmpdir('lin-4504-import-');
  let store;
  let writes;
  let summaries;
  before(() => harness.connect());
  after(() => harness.close());
  beforeEach(async () => {
    const db = harness.freshDb();
    await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
    store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
    summaries = [];
    const tickets = { 'LIN-21': 'Do the thing.\n\n## Implementation Plan\n\nold', 'LIN-22': 'Other.' };
    writes = createRecordWrites({
      recordsStore: store, isTerminalState, askedText: askedOf, stageKinds: Object.keys(STAGE_KINDS),
      readTicket: async (_ctx, ref) => (tickets[ref] !== undefined ? { identifier: ref, description: tickets[ref], state: { type: 'started' }, trashed: false, parent: null } : null),
      tracker: () => ({ comment: async (...args) => { summaries.push(args); return { id: 'c' }; } }),
    });
  });

  const plannedOf = () => {
    const cap = { open: ['LIN-21', 'LIN-22'], records: { tasks: [], plans: [], findings: [] }, tickets: {
      'LIN-21': ticket('LIN-21', { planSection: 'Build it in pieces.', old: old({ where: 'description', sessionFit: 'needs multiple sessions', planReviewDue: 'yes', latestVerdict: { verdict: 'approve', at: '2026-11-18T00:00:00.000Z' } }) }),
      'LIN-22': ticket('LIN-22', { planSection: 'One go.', old: old({ where: 'description', sessionFit: 'fits one session', planReviewDue: 'yes' }) }),
    } };
    return { ...importPlanOf(cap), urlKey: URL_KEY };
  };

  test('a dry run writes nothing; apply writes the plans and findings; a re-apply makes nothing twice', async () => {
    const planned = plannedOf();
    const dry = await applyImport({ writes, recordsStore: store, urlKey: URL_KEY, planned });
    assert.deepEqual(dry.map((r) => r.action), ['would-import', 'would-import']);
    assert.equal((await store.snapshots(URL_KEY)).length, 0, 'the dry run wrote nothing');

    const first = await applyImport({ writes, recordsStore: store, urlKey: URL_KEY, planned, write: true });
    assert.deepEqual(first.map((r) => [r.action, r.to, r.finding]), [['imported', 'breakdown', 'ended'], ['imported', 'implementation', 'open']], JSON.stringify(first));
    const plan = await store.current(URL_KEY, importIdsOf('LIN-21').plan);
    assert.deepEqual([plan.kind, plan.state, plan.to, plan.via, plan.by], ['plan', 'kept', 'breakdown', 'import', 'import']);
    const facts = await store.planFactsForTickets(URL_KEY, ['LIN-21', 'LIN-22']);
    assert.deepEqual([facts.get('LIN-21').sessionFit, facts.get('LIN-21').reviewOwed.owed], ['several', false], 'Approve ended the finding: not owed');
    assert.deepEqual([facts.get('LIN-22').sessionFit, facts.get('LIN-22').reviewOwed.why], ['one', 'open-finding']);
    assert.deepEqual(summaries, [], 'an import posts no summary');

    const count = (await store.snapshots(URL_KEY)).length;
    const again = await applyImport({ writes, recordsStore: store, urlKey: URL_KEY, planned, write: true });
    assert.deepEqual(again.map((r) => r.action), ['already-imported', 'already-imported']);
    assert.equal((await store.snapshots(URL_KEY)).length, count, 'nothing written twice');
  });
});
