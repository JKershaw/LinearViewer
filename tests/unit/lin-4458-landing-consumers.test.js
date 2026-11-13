/**
 * LIN-4458 (piece 2 of LIN-4447): the consumers of the one landing (lib/run-trail.js readTrail).
 *
 * Every surface that names "this task's PRs" takes them from the landing, and statuses are matched
 * to PRs by URL:
 *   - the blind-read write check (routes/proxy-writes.js refusedByBlindRead) and the blind-read prompt
 *     (lib/prompt-template-defs.js) name the landing under the new rule: an audit's re-cite of a
 *     merged landing PR and an area read's PR are not in it;
 *   - the stop-at guard (lib/close-out-readiness.js closeOutNotReady) reads the landing's PR and
 *     decides from it, not from every cited PR;
 *   - the pipeline merge recorder (lib/close-out-merges.js) records the landing's merges only.
 * The box and the owner's Done check are in lin-4458-trail-characterization.test.js. Each case says
 * what the code before beat 3 (ad2ee9301, or main for the prompt/write rule) did.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4458-landing-consumers.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProviderInterface } from '../../lib/providers/interface.js';
import { BLIND_READ_CODES } from '../../lib/run-ledger.js';
import { landingPrUrls } from '../../lib/run-trail.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { closeOutNotReady } from '../../lib/close-out-readiness.js';
import { createPipelineMergeRecorder } from '../../lib/close-out-merges.js';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { resolveRunPrRef } from '../../lib/pr-state-store.js';
import { CloseOutEventsStore } from '../../lib/close-out-events-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const REPO = 'acme/widget';
const PR = (n) => `https://github.com/${REPO}/pull/${n}`;
const PR1 = PR(41);
const PR2 = PR(42);
const PR_OLD = PR(40);
const REVIEWED = 'aaaaaaa1111111';

const T = (n) => `2026-11-12T${String(n).padStart(2, '0')}:00:00.000Z`;
const c = (n, body) => ({ id: `c${n}`, body, createdAt: T(n), user: 'agent' });
const summary = (n, url = PR1) => c(n, `Implementation done: ${url}, CI green.`);
const review = (n, verdict = 'Approve', url = PR1) => c(n, `## Code Review\n\nReviewed head \`${REVIEWED}\` of ${url}.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | a repro |\n\n**Verdict: ${verdict}**`);
const read = (n, ...urls) => c(n, `## Blind read\nVerdict: same. It gave the gate one owner and left nothing worse.\n\nRead: ${urls.join(', ')}.`);
const closeOut = (n, body) => c(n, `## Close-out\n\n${body}`);
const audit = (n) => c(n, `## Retrospective audit — LIN-1\n\nThe landing ${PR1} holds; one note entry is wrong. Notes PR: ${PR2}.`);
const areaRead = (n, url) => c(n, `## Area read: Runs & dispatch @ 4b5001ddf\n\nAn earlier landing was ${url}.`);

// Row 14 of lin-4438-blind-read-gate: a Done ticket, landing close-out, then an audit notes PR and its review.
const ROW_14 = [summary(1), review(2), read(3, PR1), closeOut(4, `Merged ${PR1}; set Done.`), audit(5), review(6, 'Approve', PR2)];
const AREA_READ = [summary(1), review(2), areaRead(3, PR_OLD)];

// ── The blind-read write check ────────────────────────────────────────────────────────────────────
const URL_KEY = 'acme-4458';
const ISSUE_ID = '44584458-4458-4458-4458-445844584458';
class FakeProvider extends ProviderInterface {
  constructor(trail) {
    super();
    this.name = 'fake';
    this.calls = { createComment: 0 };
    this.createComment = async (token, issueId, body) => { this.calls.createComment++; return { id: `n-${this.calls.createComment}`, body, createdAt: T(9), user: { name: 'Agent' } }; };
    this.issueWriteGuard = async () => ({ id: ISSUE_ID, team: { id: 't' } });
    this.fetchIssueComments = async () => trail;
  }
}
async function postRead(trail, prs) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'ws-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {}, recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} }, taskSnapshotStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(), workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) }, provider: new FakeProvider(trail),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/issues/${ISSUE_ID}/comments`, {
      method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: `${read(1, ...prs).body}\n\n(${Math.random()})` }),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe('the blind-read write check names the landing under the new rule', () => {
  // Before: the landing was [PR1, PR2] (the audit's re-cite of PR1 joined it), so a read of the notes
  // PR alone was refused and one naming both was posted.
  test('row 14: a read naming the notes PR alone is posted; one naming the merged landing PR too is refused', async () => {
    assert.equal((await postRead(ROW_14, [PR2])).status, 201);
    const both = await postRead(ROW_14, [PR1, PR2]);
    assert.equal(both.status, 422);
    assert.equal(both.body.code, BLIND_READ_CODES.prsMismatch);
    assert.deepEqual(both.body.expected, [PR2]);
  });

  // Before: an area read's PR joined the landing, so the read had to name PR_OLD too.
  test('an area read\'s PR is not in the landing: a read naming the reviewed PR alone is posted', async () => {
    assert.deepEqual(landingPrUrls(AREA_READ), [PR1]);
    assert.equal((await postRead(AREA_READ, [PR1])).status, 201);
    const extra = await postRead(AREA_READ, [PR1, PR_OLD]);
    assert.equal(extra.status, 422);
    assert.deepEqual(extra.body.expected, [PR1]);
  });
});

describe('the blind-read prompt names the landing under the new rule', () => {
  const prompt = (comments, state = { name: 'In Progress', type: 'started' }) => generatePrompt('blind-read',
    { identifier: 'LIN-1', title: 'Gate fixture', description: '', state, labels: [] },
    { parent: null, siblings: [], project: null, children: [], comments, focusedChild: null, attachments: [], runs: [], allRuns: [] }).prompt;

  test('row 14: the notes PR alone (before: both PRs)', () => {
    const p = prompt(ROW_14, { name: 'Done', type: 'completed' });
    assert.ok(p.includes(`**The change:** ${PR2}`));
    assert.ok(!p.includes(`**The change:** ${PR1}`));
  });

  test('an area read\'s PR is not named (before: the reviewed PR and the area read\'s)', () => {
    const p = prompt(AREA_READ);
    assert.ok(p.includes(`**The change:** ${PR1}`));
    assert.ok(!p.includes(PR_OLD), 'the area read\'s PR is nowhere in the prompt');
  });
});

// ── The stop-at guard and the merge recorder, over a PR cited outside the landing ────────────────
// B (42) was an earlier round's PR, closed unmerged; a not-ready close-out anchors past it; A (41) is
// the landing, reviewed, approved and read.
const A = PR1;
const B = PR2;
const CITED_NOT_LANDED = [
  summary(1, B),
  review(2, 'Request Changes', B),
  closeOut(3, `Not ready: ${B} was closed unmerged. Next: implementation.`),
  summary(4, A),
  review(5, 'Approve', A),
  read(6, A),
];
const status = (number, over = {}) => ({ readable: true, repo: REPO, number, state: 'open', merged: false, head: { ref: 'f', sha: REVIEWED }, ref: REVIEWED, checks: [], ...over });

describe('the stop-at guard decides from the landing', () => {
  const guard = (statuses, reads = []) => closeOutNotReady({
    workspace: { urlKey: 'acme' }, issueIdentifier: 'LIN-1',
    seam: {
      resolveProvider: () => ({ provider: { name: 'local', async fetchIssueComments() { return CITED_NOT_LANDED; } }, callScope: 'scope' }),
      readPrStatus: async ({ number }) => { reads.push(number); return statuses[number]; },
      isStopAtRun: async () => 'pr',
    },
  });

  test('it reads the landing\'s PR only (before: every cited PR, B and A)', async () => {
    const reads = [];
    assert.equal(await guard({ 41: status(41), 42: status(42, { state: 'closed' }) }, reads), null, 'a ready landing is admitted');
    assert.deepEqual(reads, [41]);
  });

  // Before: two cited PRs took the multi-PR path, which never reaches head-moved, so the guard admitted
  // a close-out of a landing whose head moved after the review. Now the landing's one PR is checked.
  test('a moved head on the landing\'s PR is refused head-moved, whatever older PR is cited', async () => {
    const refusal = await guard({ 41: status(41, { head: { ref: 'f', sha: 'bbbbbbb2222222' }, ref: 'bbbbbbb2222222' }), 42: status(42, { state: 'closed' }) });
    assert.equal(refusal?.reason, 'head-moved');
    assert.deepEqual(refusal.prs.map(p => p.url), [A], 'the refusal lists the landing');
  });
});

describe('the pipeline merge recorder records the landing\'s merges only', () => {
  const harness = createMangoTmpdir('lin-4458-landing-consumers-');
  before(() => harness.connect());
  after(() => harness.close());

  // Before: it read every cited PR and recorded a merged event for each merged one, B included.
  test('A merged and B merged outside the landing: only A\'s merge is recorded, and only A is read', async () => {
    const collection = harness.freshDb().collection('close-out-events');
    const reads = [];
    const record = createPipelineMergeRecorder({
      closeOutEventsStore: new CloseOutEventsStore({ collection }),
      dispatchStore: { async listItems() { return []; }, async listHistory() { return []; }, async getItemStatus() { return null; } },
      readPrStatus: async ({ number }) => { reads.push(number); return status(number, { state: 'closed', merged: true, created_at: T(1), merged_at: T(8) }); },
      log: () => {},
    });
    const provider = { name: 'github', async fetchIssueComments() { return CITED_NOT_LANDED; } };
    const { recorded } = await record({ urlKey: 'ws', workspaceId: 'ws-id', accountId: 'acct-1', provider, callScope: { token: 'ghs_token', repo: REPO }, written: { id: 'iss-1', identifier: 'LIN-1', state: { type: 'completed' } } });
    assert.deepEqual(reads, [41]);
    assert.deepEqual(recorded.map(r => r.prUrl), [A]);
    assert.deepEqual((await collection.find({}).toArray()).map(e => e.prUrl), [A]);
  });
});

describe('a PR cited only outside the landing is not read (the box\'s one read is the landing\'s)', () => {
  // Before (ad2ee9301): the page read the one cited PR (the box listed it: not-ready/review-not-approve;
  // the page state: ready). Now the landing is empty, so nothing is read: the box has no PR, the page's
  // own PR state reads unknown, and the picker still offers the one cited PR for its checks.
  test('a PR cited only by a Survey report: no read, box no-pr, picker one, page state unknown', async () => {
    const reads = [];
    const survey = c(1, `## Survey open-0: LIN-1 @ abc\n\nAn earlier attempt is ${PR_OLD}.`);
    const model = await readRunEvidence({ issueIdentifier: 'LIN-1', comments: [survey], stopAt: 'pr', runnerReady: true, viewerIsOwner: true, readPrStatus: async ({ number }) => { reads.push(number); return status(number); } });
    assert.deepEqual(reads, []);
    assert.equal(model.closeOut.status, 'no-pr');
    assert.equal(resolveRunPrRef(model).status, 'one');
    assert.equal(model.state.status, 'unknown');
  });
});
