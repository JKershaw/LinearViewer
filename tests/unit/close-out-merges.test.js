// LIN-3756: the pipeline merge recorder (lib/close-out-merges.js), over the real
// CloseOutEventsStore on MangoDB, with fake provider / PR reader / fetch only.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineMergeRecorder, createSessionWorkspaceIdResolver } from '../../lib/close-out-merges.js';
import { CloseOutEventsStore } from '../../lib/close-out-events-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

before(() => { process.env.NODE_ENV = 'test'; });
const harness = createMangoTmpdir('lin-3756-close-out-merges-');
before(() => harness.connect());
after(() => harness.close());

const PR = 'https://github.com/acme/widget/pull/41';
const OPENED = '2026-10-20T10:00:00Z';
const MERGED = '2026-10-20T12:30:00Z';
const mergedStatus = { readable: true, repo: 'acme/widget', number: 41, state: 'closed', merged: true, head: { ref: 'f', sha: 'abc1234' }, ref: 'abc1234', checks: [], created_at: OPENED, merged_at: MERGED };
const openStatus = { ...mergedStatus, state: 'open', merged: false, created_at: OPENED, merged_at: null };
const doneIssue = { id: 'iss-1', identifier: 'LIN-1', state: { type: 'completed' } };

function setup({ stopAt = null, comments = [{ body: PR, createdAt: '2026-10-20T11:00:00Z', user: 'w' }], token = 'ghs_token', status = mergedStatus, workspaceResolver = null, listOwnerInstall = null } = {}) {
  const collection = harness.freshDb().collection('close-out-events');
  const store = new CloseOutEventsStore({ collection });
  const reads = [];
  const provider = { name: 'github', async fetchIssueComments() { return comments; } };
  const dispatchStore = {
    async listItems() { return stopAt ? [{ issueIdentifier: 'LIN-1', stopAt }] : []; },
    async listHistory() { return []; },
    async getItemStatus() { return null; },
  };
  const readPrStatus = async (args) => { reads.push(args); return status; };
  const record = createPipelineMergeRecorder({
    closeOutEventsStore: store, dispatchStore, readPrStatus, log: () => {},
    installationTokenFor: listOwnerInstall,
    ...(workspaceResolver ? { resolveWorkspaceId: workspaceResolver } : {}),
  });
  // A GitHub-bound call scope carries its token (prReadToken); 'none' carries none.
  const callScope = token ? { token, repo: 'acme/widget' } : 'no-link';
  const run = (over = {}) => record({ urlKey: 'ws', workspaceId: 'ws-id', accountId: 'acct-1', provider, callScope, written: doneIssue, ...over });
  return { run, collection, reads, store };
}

const rows = (c) => c.collection.find({}).toArray();

describe('createPipelineMergeRecorder', () => {
  test('a Linear-bound workspace reads through the owner installation, and without a workspace id records nothing', async () => {
    const asked = [];
    const c = setup({ workspaceResolver: async () => null, listOwnerInstall: async (a) => { asked.push(a); return 'ghs_install'; } });
    const linear = { name: 'linear', async fetchIssueComments() { return [{ body: PR, createdAt: '2026-10-20T11:00:00Z', user: 'w' }]; } };
    await c.run({ provider: linear, callScope: 'linear-token', workspaceId: null });
    assert.equal((await rows(c)).length, 0, 'no workspace id: owner installation skipped, no token, no read');
    assert.equal(c.reads.length, 0);
    await c.run({ provider: linear, callScope: 'linear-token' });
    assert.deepEqual(asked, [{ workspaceId: 'ws-id', repo: 'acme/widget' }]);
    assert.equal((await rows(c)).length, 1);
  });

  test('every run reads PR status through its own fresh cache, never the shared 60 s one', async () => {
    const c = setup();
    await c.run();
    await c.run();
    assert.equal(c.reads.length, 2);
    for (const r of c.reads) {
      assert.ok(r.cache instanceof Map, 'a cache is passed, so the reader never falls back to the shared one');
    }
    assert.notEqual(c.reads[0].cache, c.reads[1].cache);
  });

  test('a Done write on a merged PR records exactly one event with both forge times; a repeat adds nothing', async () => {
    const c = setup();
    const first = await c.run();
    assert.equal(first.recorded.length, 1);
    const [ev] = await rows(c);
    assert.equal(ev.by, 'close-out');
    assert.equal(ev.merged, true);
    assert.equal(ev.accountId, 'acct-1');
    assert.equal(ev.prUrl, PR);
    assert.equal(new Date(ev.prOpenedAt).toISOString(), '2026-10-20T10:00:00.000Z');
    assert.equal(new Date(ev.prMergedAt).toISOString(), '2026-10-20T12:30:00.000Z');
    await c.run();
    assert.equal((await rows(c)).length, 1);
  });

  test('a person Done (writer: person) on an ordinary task records by person, once, with both forge times', async () => {
    const c = setup();
    const first = await c.run({ writer: 'person' });
    assert.equal(first.recorded.length, 1);
    const [ev] = await rows(c);
    assert.equal(ev.by, 'person');
    assert.equal(ev.merged, true);
    assert.equal(new Date(ev.prOpenedAt).toISOString(), '2026-10-20T10:00:00.000Z');
    assert.equal(new Date(ev.prMergedAt).toISOString(), '2026-10-20T12:30:00.000Z');
    assert.ok(!ev.doneAt, 'an ordinary task is not stamped: only a stop-at-PR merge reads doneAt');
    const repeat = await c.run({ writer: 'person' });
    assert.equal((await rows(c)).length, 1, 'a repeat person Done writes nothing new');
    assert.deepEqual(repeat.recorded.map(r => r.id), first.recorded.map(r => r.id));
  });

  test('a person Done with no GitHub token records nothing and never reads the PR', async () => {
    const c = setup({ token: null });
    await c.run({ writer: 'person' });
    assert.equal((await rows(c)).length, 0);
    assert.equal(c.reads.length, 0);
  });

  test('a person Done on a stop-at-PR task records by person and stamps doneAt', async () => {
    const c = setup({ stopAt: 'pr' });
    await c.run({ writer: 'person' });
    const [ev] = await rows(c);
    assert.equal(ev.by, 'person');
    assert.ok(ev.doneAt, 'doneAt is stamped so a later person check does not write Done again');
  });

  test('a non-completed write records nothing and reads nothing', async () => {
    const c = setup();
    await c.run({ written: { ...doneIssue, state: { type: 'canceled' } } });
    assert.equal((await rows(c)).length, 0);
    assert.equal(c.reads.length, 0);
  });

  test('no GitHub token: nothing recorded and the PR reader is never called', async () => {
    const c = setup({ token: null });
    await c.run();
    assert.equal((await rows(c)).length, 0);
    assert.equal(c.reads.length, 0);
  });

  test('a still-open PR records nothing', async () => {
    const c = setup({ status: openStatus });
    await c.run();
    assert.equal((await rows(c)).length, 0);
  });

  test('a stop-at-PR task keeps the check route rule: person, with doneAt stamped', async () => {
    const c = setup({ stopAt: 'pr' });
    await c.run();
    const [ev] = await rows(c);
    assert.equal(ev.by, 'person');
    assert.ok(ev.doneAt, 'doneAt is stamped so a later person check does not write Done again');
  });

  test('a stop-at-PR task with a prior press records close-out', async () => {
    const c = setup({ stopAt: 'pr' });
    await c.store.record({ accountId: 'acct-1', urlKey: 'ws', issueIdentifier: 'LIN-1', by: 'press', dispatchId: 'd-1', prUrl: PR, headSha: 'old', merged: false, openItems: { inside: 0, outside: 0, unknown: 0, total: 0 } });
    await c.run();
    const merged = (await rows(c)).filter(e => e.merged);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].by, 'close-out');
  });

  test('a missing workspace id is resolved through resolveWorkspaceId', async () => {
    const seen = [];
    const c = setup({ workspaceResolver: async (k) => { seen.push(k); return 'resolved-id'; } });
    await c.run({ workspaceId: null });
    assert.deepEqual(seen, ['ws']);
    assert.equal((await rows(c)).length, 1);
  });

  test('a throwing resolver or provider is swallowed', async () => {
    const c = setup({ workspaceResolver: async () => { throw new Error('boom'); } });
    await assert.doesNotReject(c.run({ workspaceId: null }));
    const bad = await c.run({ provider: { name: 'github', async fetchIssueComments() { throw new Error('down'); } } });
    assert.deepEqual(bad, { recorded: [] });
  });
});

// LIN-3756: the legacy-token fallback, wired only in server.js. Session-bound: a live
// session names the workspace, an expired one does not.
describe('createSessionWorkspaceIdResolver', () => {
  const T = Date.parse('2026-10-24T10:00:00Z');
  const row = (expires, workspaces) => ({ expires, session: JSON.stringify({ workspaces }) });
  const sessionsCollection = {
    find: () => ({
      toArray: async () => [
        row(new Date(T + 3600e3), [{ id: 'w-9', urlKey: 'ws' }]),
        row(new Date(T - 1), [{ id: 'w-old', urlKey: 'old' }]),
      ],
    }),
  };

  test('resolves a live session\'s workspace and nothing else', async () => {
    const resolver = createSessionWorkspaceIdResolver({ sessionsCollection, now: () => T });
    assert.equal(await resolver('ws'), 'w-9');
    assert.equal(await resolver('old'), null);
    assert.equal(await resolver('nope'), null);
  });
});
