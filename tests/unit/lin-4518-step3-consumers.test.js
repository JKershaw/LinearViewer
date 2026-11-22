/**
 * LIN-4518 step 3 (P5 of LIN-4513): the consumers read records, and a parked close-out no longer holds the ticket.
 *
 * Witnesses over the real records store (tests/helpers/records-scenario.js) and the real gates and routes:
 *   - the deadlock (finding 1b9de306, LIN-4499): a close-out held on the blind read does not hold the live-stage wait,
 *     so the read is sent; a close-out with nothing owed still holds it; an unread trail holds it, as before;
 *   - the blind-read prompt names the landing's change records (finding 75b33054): one open change, no comment naming it;
 *   - the audit fact on records (LIN-4432, auditAfterCloseOut), which the standing trail now carries;
 *   - the gate judges each PR at the head its review read (LIN-4469 flaw 1): a push after approval, a PR the review did
 *     not judge, and a clean two-PR landing;
 *   - a change revision stores the change's fields only, through the one non-field list (finding 5a1dcdd1);
 *   - an unreadable ticket is "not read" (null), never "no review".
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4518-step3-consumers.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { recordsStoreFor, seedTicketRecords, seededRecordsStore, ev } from '../helpers/records-scenario.js';
import { trailForTicket } from '../../lib/task-standing.js';
import { landingChangesFor } from '../../lib/records/landing.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { versionChangeWrite, refreshTaskChanges } from '../../lib/change-records.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { getRecommendation, setFetchImpl, setPromptTraceRecorder } from '../../lib/openrouter.js';
import { closeOutDecision, CLOSE_OUT_ACTOR } from '../../lib/run-closeout-state.js';
import { liveWaitOf } from '../../lib/run-live-wait.js';
import { FINDINGS_NONE } from '../../lib/close-out-findings.js';

const harness = createMangoTmpdir('lin-4518-step3-consumers-');
before(() => harness.connect());
after(() => harness.close());

const REPO = 'acme/widget';
const PR = (n) => `https://github.com/${REPO}/pull/${n}`;
const A = PR(41);
const N = PR(42);
const H1 = 'aaaaaaa1111111';
const H2 = 'bbbbbbb2222222';
const STARTED = { name: 'In Progress', type: 'started' };
const ISSUE = { identifier: 'LIN-1', title: 'Step 3 fixture', description: '', state: STARTED, labels: [] };

const heads = (...urls) => Object.fromEntries(urls.map((u) => [u, H1]));
const open = (url, sha) => ({ readable: true, repo: REPO, number: Number(url.split('/').pop()), state: 'open', merged: false, head: { ref: 'f', sha }, ref: sha, checks: [] });

/** The gate's trail for `events`, read from a fresh store (what the entrances hand the gates). */
async function trailOf(events, ticket = 'LIN-1') {
  const store = await seededRecordsStore(harness, events, { urlKey: 'acme', tickets: [ticket] });
  return trailForTicket({ recordsStore: store, urlKey: 'acme', ticket });
}

/** The code route the selector's entrance answers for `trail` with `allRuns` (the code routes run before the selector). */
async function routeFor({ trail, allRuns }) {
  setPromptTraceRecorder(() => {});
  setFetchImpl(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '## Reasoning\n→ **close-out**' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } }) }));
  try {
    return await getRecommendation(ISSUE, { parent: null, siblings: [], project: null, children: [], comments: [], focusedChild: null, attachments: [], runs: [], allRuns, trail }, { apiKey: 'stub', model: 'x' });
  } finally {
    setFetchImpl(null);
    setPromptTraceRecorder(null);
  }
}

describe('a close-out parked on the blind read does not hold the ticket (finding 1b9de306, the LIN-4499 deadlock)', () => {
  const closeOutRunning = { stage: 'close-out', outcome: 'running', id: 'run-close', at: '2026-11-12T03:00:00.000Z', dispatchedAt: '2026-11-12T03:00:00.000Z' };
  const approved = [ev.pr(1, A, H1), ev.review(2, A, { heads: { [A]: H1 } })];

  test('approve, no read on record, a close-out running and parked: the blind read is sent, not a wait', async () => {
    const trail = await trailOf([...approved, ev.run(3, 'close-out', null)]);
    const rec = await routeFor({ trail, allRuns: [closeOutRunning] });
    assert.equal(rec.codeRoute, 'blind-read', `the read is routed: ${rec.codeRoute}`);
    assert.equal(rec.liveWait, undefined, 'no live wait names the parked close-out');
  });

  test('approve and the read on record, a close-out running: nothing is owed, so the live wait holds', async () => {
    const trail = await trailOf([...approved, ev.read(3, A), ev.run(4, 'close-out', null)]);
    const rec = await routeFor({ trail, allRuns: [closeOutRunning] });
    assert.equal(rec.codeRoute, 'live-wait');
    assert.equal(rec.liveWait?.kind, 'close-out');
  });

  test('no records read (the trail is null): the live wait holds, as it did before', async () => {
    const rec = await routeFor({ trail: null, allRuns: [closeOutRunning] });
    assert.equal(rec.codeRoute, 'live-wait');
  });

  test('liveWaitOf skips a parked close-out and still holds the ticket on any other live stage run', () => {
    const implRunning = { stage: 'implementation', outcome: 'running', id: 'run-impl', at: '2026-11-12T02:00:00.000Z', dispatchedAt: '2026-11-12T02:00:00.000Z' };
    assert.equal(liveWaitOf([closeOutRunning], { parked: true }), null, 'the parked close-out is not waited on');
    assert.equal(liveWaitOf([closeOutRunning]).wait.kind, 'close-out', 'unparked, it holds the ticket');
    assert.equal(liveWaitOf([implRunning, closeOutRunning], { parked: true }).wait.kind, 'implementation', 'another live stage still holds');
  });
});

describe('the blind-read prompt names the landing\'s change records (finding 75b33054)', () => {
  test('one open change record for PR N and no comment naming PR N: the prompt lists PR N and names the change id', async () => {
    const store = await recordsStoreFor(harness);
    await seedTicketRecords(store, 'acme', 'LIN-1', [ev.pr(1, N, H1)]);
    const landingChanges = await landingChangesFor({ urlKey: 'acme', ticket: 'LIN-1', recordsStore: store });
    assert.equal(landingChanges.length, 1);
    const p = generatePrompt('blind-read', ISSUE, { comments: [], landingChanges }).prompt;
    assert.ok(p.includes(`**The change:** ${N}`), 'the reader is told to read PR N');
    assert.ok(p.includes(`\`${landingChanges[0].id}\` is the change record for ${N}.`), 'the verdict record names the change id');
    assert.doesNotMatch(p, /\*\*Nothing to read\.\*\*/);
  });

  test('a landing with no change records says nothing to read; a landing not handed in says it could not be read', () => {
    assert.match(generatePrompt('blind-read', ISSUE, { comments: [], landingChanges: [] }).prompt, /\*\*Nothing to read\.\*\*/);
    assert.match(generatePrompt('blind-read', ISSUE, { comments: [], landingChanges: null }).prompt, /\*\*The landing could not be read\.\*\*/);
  });
});

describe('the audit fact on records (LIN-4432, auditAfterCloseOut)', () => {
  test('an audit that started after the landing close-out: true, and its notes PR is on the landing', async () => {
    const trail = await trailOf([ev.pr(1, A, H1), ev.review(2, A, { heads: { [A]: H1 } }), ev.close(3), ev.audit(4, N, H1)]);
    assert.equal(trail.auditAfterCloseOut, true);
    assert.equal(trail.landingHasNotesPr, true);
  });

  test('an audit with no landing close-out before its notes PR: false', async () => {
    const trail = await trailOf([ev.pr(1, A, H1), ev.review(2, A, { heads: { [A]: H1 } }), ev.audit(3, N, H1)]);
    assert.equal(trail.auditAfterCloseOut, false);
  });

  test('the notes PR\'s own close-out after the audit does not reset the fact: still true', async () => {
    const trail = await trailOf([ev.pr(1, A, H1), ev.review(2, A, { heads: { [A]: H1 } }), ev.close(3), ev.audit(4, N, H1), ev.close(5)]);
    assert.equal(trail.auditAfterCloseOut, true);
  });

  test('an audit written before the landing close-out is not after it: false', async () => {
    const trail = await trailOf([ev.pr(1, A, H1), ev.review(2, A, { heads: { [A]: H1 } }), ev.audit(3, N, H1), ev.close(4)]);
    assert.equal(trail.auditAfterCloseOut, false);
  });
});

describe('the gate judges each PR at the head its review read (LIN-4469 flaw 1, on records)', () => {
  const decide = (trail, statuses) => closeOutDecision({
    trail, prStatuses: new Map(Object.entries(statuses).map(([url, sha]) => [url, open(url, sha)])),
    stopAt: 'pr', runnerReady: true, actor: CLOSE_OUT_ACTOR.HARBOUR, openFindings: FINDINGS_NONE,
  });

  test('a push after the approval: the approval is stale, and the press is refused head-moved', async () => {
    const trail = await trailOf([ev.pr(1, A, H1), ev.review(2, A, { heads: { [A]: H1 } }), ev.read(3, A), ev.head(4, A, H2)]);
    assert.ok(trail.review.staleUrls.includes(A), 'the revised change stales the approval');
    assert.equal(decide(trail, { [A]: H2 }).refuses, 'head-moved');
  });

  test('a PR the review did not judge refuses head-moved, even inside a multi-PR landing', async () => {
    const trail = await trailOf([ev.pr(1, A, H1), ev.review(2, A, { heads: { [A]: H1 } }), ev.pr(3, N, H1), ev.read(4, [A, N])]);
    assert.deepEqual([...trail.landing].sort(), [A, N].sort());
    const d = decide(trail, { [A]: H1, [N]: H1 });
    assert.equal(d.refuses, 'head-moved', 'the approval does not cover PR N');
  });

  test('a two-PR landing judged at its reviewed heads, read in full: nothing refuses (and it is not a single-PR close-out)', async () => {
    const trail = await trailOf([ev.pr(1, A, H1), ev.pr(1, N, H1), ev.review(2, [A, N], { heads: heads(A, N) }), ev.read(3, [A, N])]);
    const d = decide(trail, { [A]: H1, [N]: H1 });
    assert.equal(d.refuses, null);
    assert.equal(d.status, 'multiple-prs');
  });
});

describe('a change revision keeps the change\'s fields only (finding 5a1dcdd1)', () => {
  test('a revision through versionChangeWrite stores ref and head, and no routing key', async () => {
    const store = await recordsStoreFor(harness);
    await seedTicketRecords(store, 'acme', 'LIN-1', [ev.pr(1, A, H1)]);
    const writes = createRecordWrites({ recordsStore: store, isTerminalState });
    const out = await versionChangeWrite({
      urlKey: 'acme', kind: 'change', input: { in: 'LIN-1', ref: A, head: H2 }, writes, recordsStore: store, by: 'harbour',
    });
    assert.ok(out?.record, `the write revised the change: ${JSON.stringify(out)}`);
    assert.equal(out.record.v, 2, 'one new version of the one change');
    assert.equal(out.record.fields.head, H2);
    assert.equal(out.record.fields.ref, A);
    for (const key of ['kind', 'run', 'heads', 'in']) assert.equal(key in out.record.fields, false, `${key} is not a field`);
  });
});

describe('an unreadable ticket is "not read", never "no review" (trailForTicket)', () => {
  test('a records read that throws reads as null, so a gate refuses instead of reading no review', async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const down = { async taskForTicket() { throw new Error('the store is down'); } };
      assert.equal(await trailForTicket({ recordsStore: down, urlKey: 'acme', ticket: 'LIN-1' }), null);
    } finally {
      console.error = original;
    }
  });

  test('a ticket with no task on record reads as an empty trail: no review, no landing', async () => {
    const store = await recordsStoreFor(harness);
    const trail = await trailForTicket({ recordsStore: store, urlKey: 'acme', ticket: 'LIN-NONE' });
    assert.equal(trail.review, null);
    assert.deepEqual(trail.landing, []);
  });
});

describe('a head written as its abbreviation is the commit it begins (the records head compare)', () => {
  // The review prompt names the first nine characters of the head it read; GitHub reports the full sha. The refresh that
  // reads the PR must not revise the judged head to the full sha: that would make the approval stale on the spot.
  test('a refresh that reads the full head leaves the abbreviated judged head alone: no new version, the approval current', async () => {
    const FULL = 'abc1234deadbeefdeadbeefdeadbeefdeadbeef0';
    const store = await recordsStoreFor(harness);
    const { taskId, changes } = await seedTicketRecords(store, 'acme', 'LIN-1', [ev.pr(1, A, 'abc1234'), ev.review(2, A, { heads: { [A]: 'abc1234' } })]);
    const writes = createRecordWrites({ recordsStore: store, isTerminalState });
    await refreshTaskChanges({
      urlKey: 'acme', taskId, writes, recordsStore: store,
      readPrStatus: async () => ({ readable: true, repo: REPO, number: 41, state: 'open', merged: false, head: { sha: FULL }, ref: FULL, checks: [] }),
    });
    const [changeId] = [...changes.values()];
    assert.equal((await store.versionsOf('acme', [changeId])).length, 1, 'the same commit is not a new version');
    const trail = await trailForTicket({ recordsStore: store, urlKey: 'acme', ticket: 'LIN-1' });
    assert.deepEqual(trail.review.staleUrls, [], 'the approval is not stale');
    const d = closeOutDecision({ trail, prStatuses: new Map([[A, open(A, FULL)]]), stopAt: 'pr', runnerReady: true, actor: CLOSE_OUT_ACTOR.HARBOUR, openFindings: FINDINGS_NONE });
    assert.notEqual(d.refuses, 'head-moved', 'the live head is the commit the review read');
  });

  test('a head that is a different commit is a move: the refresh revises it, and the approval goes stale', async () => {
    const store = await recordsStoreFor(harness);
    const { taskId } = await seedTicketRecords(store, 'acme', 'LIN-1', [ev.pr(1, A, 'abc1234'), ev.review(2, A, { heads: { [A]: 'abc1234' } })]);
    const writes = createRecordWrites({ recordsStore: store, isTerminalState });
    const MOVED_FULL = 'bbbbbbb2222222cccccccccccccccccccccccccc';
    await refreshTaskChanges({
      urlKey: 'acme', taskId, writes, recordsStore: store,
      readPrStatus: async () => ({ readable: true, repo: REPO, number: 41, state: 'open', merged: false, head: { sha: MOVED_FULL }, ref: MOVED_FULL, checks: [] }),
    });
    const trail = await trailForTicket({ recordsStore: store, urlKey: 'acme', ticket: 'LIN-1' });
    assert.ok(trail.review.staleUrls.includes(A), 'a different commit stales the approval');
  });
});

