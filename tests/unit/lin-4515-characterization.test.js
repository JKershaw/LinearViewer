/**
 * LIN-4515 (P2) characterization: the behaviour of the code P2 touches that must not change. Written before the change,
 * so these pass on main; a failure after the change is a behaviour change that needs a reason, not a test to update.
 *
 * Enumerated, not trusted ("no reader changes" is a label, not a check):
 * - recordMergedPrs (lib/close-out-merges.js): which PRs record, the `recorded` shape, headSha = the reader's head sha,
 *   the unpressed default `by`.
 * - createPipelineMergeRecorder's answer: exactly `{recorded}` for a non-completed write, a throw, and a merge.
 * - the PR-head reader close-out uses (closeOutDecision's entries: headSha, headMoved against the review's sha).
 * - readPrStatuses (lib/close-out-readiness.js): one read per PR through the seam, in input order, a throw mapped to an
 *   unreadable status.
 * - the ladder lane (closeOutNotReady, stopAt not 'pr'): one comment read, no PR read, no records read. This is
 *   witness 6 of plan-d5effe81; it passes now and must keep passing, since P2 must add no PR read to the ladder.
 * - the readers of a change's head: none outside the records store (checked by the scan below).
 * - terminalPrUrlOfFeedback: the PR a run reported, which the backstop will take as its input.
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { recordMergedPrs, createPipelineMergeRecorder } from '../../lib/close-out-merges.js';
import { CloseOutEventsStore } from '../../lib/close-out-events-store.js';
import { FINDINGS_NONE } from '../../lib/close-out-findings.js';
import { readPrStatuses, closeOutNotReady } from '../../lib/close-out-readiness.js';
import { closeOutDecision } from '../../lib/run-closeout-state.js';
import { versionsOfComments } from '../helpers/records-trail.js';
import { terminalPrUrlOfFeedback } from '../../lib/dispatch-wake.js';

const harness = createMangoTmpdir('lin-4515-characterization-');
before(() => harness.connect());
after(() => harness.close());

const REPO = 'acme/widget';
const PR1 = `https://github.com/${REPO}/pull/41`;
const PR2 = `https://github.com/${REPO}/pull/42`;
const PR3 = `https://github.com/${REPO}/pull/43`;
const REVIEWED = 'aaaaaaa1111111';
const MOVED = 'bbbbbbb2222222';
const OPENED = '2026-11-21T10:00:00Z';
const MERGED = '2026-11-21T12:30:00Z';

const merged = (n, sha) => ({ repo: REPO, readable: true, number: n, state: 'closed', merged: true, head: { ref: 'feat', sha }, ref: sha, checks: [], created_at: OPENED, merged_at: MERGED });
const open = (n, sha) => ({ ...merged(n, sha), state: 'open', merged: false, merged_at: null });
const unreadable = (n) => ({ repo: REPO, readable: false, number: n, state: 'unknown', reason: 'rate limited' });

function eventsStore() {
  return new CloseOutEventsStore({ collection: harness.freshDb().collection('close-out-events') });
}

describe('recordMergedPrs (characterization)', () => {
  test('records merged readable PRs only, headSha is the reader head sha, and the default unpressed by is person', async () => {
    const store = eventsStore();
    const prs = [{ url: PR1, repo: REPO, number: 41 }, { url: PR2, repo: REPO, number: 42 }, { url: PR3, repo: REPO, number: 43 }];
    const prStatuses = new Map([[PR1, merged(41, 'H9')], [PR2, open(42, 'H8')], [PR3, unreadable(43)]]);
    const out = await recordMergedPrs({ store, workspace: { urlKey: 'ws', id: 'ws-id' }, accountId: 'acct-1', issueIdentifier: 'LIN-1', prs, prStatuses, openFindings: FINDINGS_NONE });
    assert.equal(out.recorded.length, 1, 'only the merged, readable PR records');
    assert.deepEqual(Object.keys(out.recorded[0]).sort(), ['by', 'headSha', 'id', 'prUrl']);
    assert.equal(out.recorded[0].prUrl, PR1);
    assert.equal(out.recorded[0].headSha, 'H9');
    assert.equal(out.recorded[0].by, 'person');
    assert.equal(out.mergedEvent.prUrl, PR1);
  });
});

describe('createPipelineMergeRecorder answers (characterization)', () => {
  const dispatchStore = {
    async listItems() { return []; },
    async listHistory() { return []; },
    async getItemStatus() { return null; },
  };
  const provider = { name: 'github', async fetchIssueComments() { return [{ body: PR1, createdAt: '2026-11-21T11:00:00Z', user: 'w' }]; } };
  const callScope = { token: 'ghs_token', repo: REPO };
  const done = { id: 'iss-1', identifier: 'LIN-1', state: { type: 'completed' } };

  test('a merged PR answers exactly {recorded} with one row, headSha the head sha', async () => {
    const record = createPipelineMergeRecorder({
      closeOutEventsStore: eventsStore(), dispatchStore, log: () => {},
      readPrStatus: async () => merged(41, 'H9'),
    });
    const out = await record({ urlKey: 'ws', workspaceId: 'ws-id', accountId: 'acct-1', provider, callScope, written: done });
    assert.deepEqual(Object.keys(out), ['recorded']);
    assert.equal(out.recorded.length, 1);
    assert.equal(out.recorded[0].headSha, 'H9');
    assert.equal(out.recorded[0].by, 'close-out');
  });

  test('a non-completed write answers exactly {recorded: []} and reads nothing', async () => {
    let reads = 0;
    const record = createPipelineMergeRecorder({ closeOutEventsStore: eventsStore(), dispatchStore, log: () => {}, readPrStatus: async () => { reads++; return merged(41, 'H9'); } });
    const out = await record({ urlKey: 'ws', workspaceId: 'ws-id', accountId: 'acct-1', provider, callScope, written: { ...done, state: { type: 'canceled' } } });
    assert.deepEqual(out, { recorded: [] });
    assert.equal(reads, 0);
  });

  test('a throwing provider answers exactly {recorded: []}, never a throw', async () => {
    const record = createPipelineMergeRecorder({ closeOutEventsStore: eventsStore(), dispatchStore, log: () => {}, readPrStatus: async () => merged(41, 'H9') });
    const bad = { name: 'github', async fetchIssueComments() { throw new Error('down'); } };
    assert.deepEqual(await record({ urlKey: 'ws', workspaceId: 'ws-id', accountId: 'acct-1', provider: bad, callScope, written: done }), { recorded: [] });
  });
});

describe('the PR head close-out reads (characterization)', () => {
  // A review on record at REVIEWED, and one landing PR.
  const trail = { landing: [PR1], review: { sha: REVIEWED, verdict: 'approve', blindRead: null } };
  const decide = (status) => closeOutDecision({
    trail, prStatuses: new Map([[PR1, status]]), stopAt: 'pr', runnerReady: true, actor: 'harbour', openFindings: FINDINGS_NONE,
  });

  test('a PR whose head moved past the reviewed sha is headMoved, with its head sha', () => {
    const d = decide(open(41, MOVED));
    assert.equal(d.entries[0].headSha, MOVED);
    assert.equal(d.entries[0].headMoved, true);
    assert.equal(d.headMoved, true);
  });

  test('a PR still at the reviewed sha is not headMoved', () => {
    const d = decide(open(41, REVIEWED));
    assert.equal(d.entries[0].headMoved, false);
    assert.equal(d.headMoved, false);
  });

  test('an unreadable PR is not headMoved: there is no head to compare', () => {
    const d = decide(unreadable(41));
    assert.equal(d.entries[0].headMoved, false);
    assert.equal(d.headMoved, false);
  });
});

describe('readPrStatuses (characterization)', () => {
  test('one read per PR through the seam, in input order, and a throw maps to an unreadable status', async () => {
    const calls = [];
    const seam = {
      readPrStatus: async ({ repo, number }) => {
        calls.push(`${repo}#${number}`);
        if (number === 2) throw new Error('boom');
        return { repo, readable: true, number, merged: false, state: 'open', head: { sha: `s${number}` } };
      },
    };
    const out = await readPrStatuses({
      prUrls: [{ repo: REPO, number: 1 }, { repo: REPO, number: 2 }],
      callScope: 'scope', workspace: { urlKey: 'ws' }, seam, prStatusCache: null, providerKind: null, workspaceId: null, installationTokenFor: null,
    });
    assert.deepEqual(out.map((s) => s.readable), [true, false]);
    assert.equal(out[0].head.sha, 's1');
    assert.equal(out[1].reason, 'boom');
    assert.deepEqual(calls.sort(), [`${REPO}#1`, `${REPO}#2`]);
  });
});

describe('witness 6: the ladder lane makes no PR read (characterization)', () => {
  // An approving review, then a landing PR cited after it, and no blind read: the ladder refuses on the gate alone.
  const COMMENTS = [
    { id: 'c1', body: 'Implementation done: https://github.com/acme/widget/pull/41, CI green.', createdAt: '2026-07-01T00:00:00.000Z', user: 'agent' },
    { id: 'c2', body: '## Review\n\nReviewed head `aaaaaaa1111111`.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | none |\n\n**Verdict: Approve**', createdAt: '2026-07-02T00:00:00.000Z', user: 'agent' },
  ];

  test('a ladder close-out dispatch reads the comments once, and no PR, GitHub or records read', async () => {
    const counts = { comments: 0, prReads: 0 };
    const seam = {
      resolveProvider: () => ({ provider: { async fetchIssueComments() { counts.comments++; return COMMENTS; } }, callScope: 'scope' }),
      isStopAtRun: async () => null,
      readPrStatus: async () => { counts.prReads++; throw new Error('a PR read on the ladder lane'); },
      githubFetch: async () => { counts.prReads++; throw new Error('a GitHub read on the ladder lane'); },
    };
    // LIN-4518: the ladder lane reads the comments once, as it always did, and consults the ticket's records standing for the
    // gate (lib/task-standing.js gateTrailOf: the records govern once the newest verdict is a record). The store serves the
    // trail's records (tests/helpers/records-trail.js), and its reads are counted.
    const versions = versionsOfComments(COMMENTS);
    const index = (rows) => rows.filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i);
    const current = (kind) => index(versions.filter((v) => v.kind === kind).sort((a, b) => b.v - a.v));
    const recordsStore = {
      reads: 0,
      async taskForTicket() { this.reads++; return 'task-trail'; },
      async find(_urlKey, { kind }) { this.reads++; return current(kind); },
      async versionsOf(_urlKey, ids) { this.reads++; return versions.filter((v) => ids.includes(v.id)); },
    };
    const state = await closeOutNotReady({ openFindings: FINDINGS_NONE, workspace: { urlKey: 'acme' }, issueIdentifier: 'LIN-1', seam, recordsStore });
    assert.deepEqual(counts, { comments: 1, prReads: 0 });
    assert.ok(recordsStore.reads > 0, 'the gate consulted the records standing');
    assert.equal(state?.reason, 'blind-read-missing', 'the ladder still refuses on the gate');
  });
});

describe('readers of a change record\'s head (characterization)', () => {
  test('no module outside the records store reads a change head: nothing reads fields.head', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = join(here, '..', '..');
    // The records store itself (lib/records/) and P2's refresh module (lib/change-records.js) may read a change's head.
    const allowed = new Set(['lib/records/', 'lib/change-records.js']);
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!name.endsWith('.js')) continue;
        const rel = relative(root, path);
        if ([...allowed].some((a) => rel === a || rel.startsWith(a))) continue;
        if (/\bfields\??\.head\b/.test(readFileSync(path, 'utf8'))) offenders.push(rel);
      }
    };
    walk(join(root, 'lib'));
    walk(join(root, 'routes'));
    if (/\bfields\??\.head\b/.test(readFileSync(join(root, 'server.js'), 'utf8'))) offenders.push('server.js');
    assert.deepEqual(offenders, [], 'a change head is read only by the records store and the refresh');
  });
});

describe('the PR a run reported (characterization)', () => {
  test('terminalPrUrlOfFeedback takes the PR a done run named, which the backstop reads', () => {
    const feedback = [
      { message: 'Built it. CI green.' },
      { message: `DONE: ${PR1}` },
      { message: '[done] task completed', url: 'https://github.com/acme/widget/pull/99' },
    ];
    assert.equal(terminalPrUrlOfFeedback(feedback), PR1);
  });
});
