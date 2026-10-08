/**
 * LIN-3329 — the task page loader (`lib/task-page-loader.js`).
 *
 * Pins what the page reads and what it must never do:
 *   - the whole history, oldest-first, repeats unfolded — a 45-day-old row seeded
 *     through the REAL dispatch store still shows (LIN-3328's `horizon:'all'`);
 *   - brief/recap are cache `get` only (no `put`, no generate);
 *   - exactly one task-scoped tracker read, `fetchRecommendationContext(...,
 *     {noDescend:true})`; evidence reuses its comments (no `fetchIssueComments`).
 *     The repo allowlist is a workspace-level `fetchProjects` read, named here;
 *   - sessions are read under the tracker's canonical identifier (a UUID open);
 *   - no stored-only fallback: a tracker that can't be read is not-found or
 *     unavailable, whatever is stored (John's no-fallback decision, LIN-3329);
 *   - the stage-guess rule and the header sentence.
 *
 * Run with: node --test tests/unit/task-page-loader.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPageLoader, buildTaskPageModel, guessStages, deriveHeader, fmtWhen } from '../../lib/task-page-loader.js';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const NOW = new Date('2026-10-06T15:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const ISSUE_UUID = '11111111-2222-3333-4444-555555555555';
const PR_URL = 'https://github.com/acme/app/pull/41';

/** A tracker context in `fetchRecommendationContext`'s canonical shape. */
function ctxFor(identifier, { stateType = 'started', stateName = 'In Progress', comments = [] } = {}) {
  return {
    issue: {
      id: ISSUE_UUID,
      identifier,
      title: 'Build the task page',
      url: `https://linear.app/x/issue/${identifier}`,
      state: { name: stateName, type: stateType },
      labels: ['frontend'],
      blockedBy: [{ identifier: 'LIN-1', title: 'Lift helpers', state: { name: 'Done', type: 'completed' } }],
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-06T10:00:00.000Z',
    },
    parent: { id: 'p', identifier: 'LIN-0', title: 'Parent', state: { name: 'In Progress', type: 'started' } },
    children: [{ id: 'c', identifier: 'LIN-9', title: 'Child', state: { name: 'Todo', type: 'unstarted' } }],
    comments,
    stateTransitions: [{ createdAt: '2026-10-05T12:00:00.000Z', fromState: 'In Review', toState: stateName }],
  };
}

/** A provider spy: counts every method call by name. */
function spyProvider({ ctx = null, throwOnRead = null } = {}) {
  const calls = [];
  const provider = {
    async fetchRecommendationContext(scope, id, opts) {
      calls.push({ method: 'fetchRecommendationContext', id, opts });
      if (throwOnRead) throw throwOnRead;
      return ctx;
    },
    async fetchIssueComments() { calls.push({ method: 'fetchIssueComments' }); return []; },
    async fetchIssueFields() { calls.push({ method: 'fetchIssueFields' }); return null; },
    async fetchProjects() { calls.push({ method: 'fetchProjects' }); return { projects: [{ content: 'repo=acme/app' }] }; },
  };
  return { provider, calls };
}

/** Brief/recap cache spies: `get` answers, `put` must never run. */
function cacheSpy(doc) {
  const calls = { get: 0, put: 0 };
  return {
    calls,
    store: {
      async get() { calls.get += 1; return doc; },
      async put() { calls.put += 1; },
    },
  };
}

/** A loop in `_buildLoops` shape (only the fields the loader reads). */
function loop(over = {}) {
  return {
    loopId: over.loopId || `loop-${Math.random().toString(36).slice(2, 8)}`,
    issueIdentifier: 'LIN-50',
    issueId: ISSUE_UUID,
    issueTitle: 'Stored title',
    kind: 'implementation',
    iteration: 1,
    source: 'history',
    historyStatus: 'taken',
    agentState: 'running',
    dispatchedAt: '2026-10-06T10:00:00.000Z',
    takenAt: '2026-10-06T10:01:00.000Z',
    resolvedAt: '2026-10-06T10:01:00.000Z',
    terminalStatus: null,
    terminalCompletedAt: null,
    wakeMarker: null,
    waitingMessage: null,
    feedback: [],
    telemetry: { producedArtifacts: [] },
    followUpTo: null,
    ...over,
  };
}

function done(over = {}) {
  return loop({ terminalStatus: 'done', terminalCompletedAt: '2026-10-06T11:00:00.000Z', feedback: [{ message: '[done] landed it', timestamp: '2026-10-06T11:00:00.000Z' }], ...over });
}

function loaderWith({ loops = [], brief = null, recap = null, getLoops = null, evidence = undefined, prStateStore = null } = {}) {
  const briefSpy = cacheSpy(brief);
  const recapSpy = cacheSpy(recap);
  const loader = createTaskPageLoader({
    dispatchStore: {},
    agentStatusStore: {},
    briefCacheStore: briefSpy.store,
    recapCacheStore: recapSpy.store,
    readRunEvidence: evidence === undefined ? readRunEvidence : evidence,
    prStateStore,
    enrichLoop,
    deriveSessionWaiting,
    getLoopsForIssue: getLoops || (async () => loops),
    now: () => NOW,
  });
  return { loader, briefSpy, recapSpy };
}

describe('task page loader: what it reads', () => {
  test('exactly one task-scoped tracker read; evidence reuses its comments', async () => {
    const comments = [{ id: 'c1', body: `opened ${PR_URL}`, createdAt: '2026-10-06T11:00:00.000Z' }];
    const { provider, calls } = spyProvider({ ctx: ctxFor('LIN-50', { comments }) });
    const prReads = [];
    const prStateStore = {
      now: () => NOW.getTime(),
      async readResult(ref) { prReads.push(ref); return { result: { readable: true, state: 'open', merged: false, head: { sha: 'abc1234' }, checks: [] }, via: 'cache' }; },
    };
    const { loader } = loaderWith({ loops: [done()], prStateStore });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: { provider, callScope: 'tok' } });

    assert.deepEqual(calls.map(c => c.method), ['fetchRecommendationContext'], 'one task-scoped read, nothing else (no allowlist read — LIN-3333)');
    assert.deepEqual(calls[0].opts, { noDescend: true });
    assert.equal(calls.filter(c => c.method === 'fetchIssueComments').length, 0, 'readRunEvidence used the supplied comments');
    assert.deepEqual(prReads, [{ repo: 'acme/app', number: 41 }], 'PR state went through the shared prStateStore');
    assert.equal(model.evidence.state.pr.url, PR_URL);
    assert.equal(model.details.headSha, 'abc1234');
  });

  test('brief and recap are read from the cache only — get, never put', async () => {
    const { provider } = spyProvider({ ctx: ctxFor('LIN-50') });
    const { loader, briefSpy, recapSpy } = loaderWith({
      loops: [done()],
      brief: { brief: 'The brief', model: 'm', generatedAt: '2026-10-06T09:00:00.000Z' },
      recap: { recap: { done: [{ item: 'x' }] }, model: 'm', generatedAt: '2026-10-06T09:00:00.000Z' },
    });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: { provider, callScope: 'tok' } });
    assert.equal(briefSpy.calls.get, 1);
    assert.equal(recapSpy.calls.get, 1);
    assert.equal(briefSpy.calls.put, 0, 'the page never writes the brief cache');
    assert.equal(recapSpy.calls.put, 0, 'the page never writes the recap cache');
    assert.equal(model.brief.body, 'The brief');
    assert.deepEqual(model.recap.body, { done: [{ item: 'x' }] });
  });

  test('a cache miss is a null panel, not an error', async () => {
    const { provider } = spyProvider({ ctx: ctxFor('LIN-50') });
    const { loader } = loaderWith({ loops: [done()] });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: { provider, callScope: 'tok' } });
    assert.equal(model.brief, null);
    assert.equal(model.recap, null);
  });

  test('every session shows, oldest-first, repeats NOT folded', async () => {
    const review1 = done({ loopId: 'r1', kind: 'review', dispatchedAt: '2026-10-06T08:00:00.000Z' });
    const impl = done({ loopId: 'i1', kind: 'implementation', dispatchedAt: '2026-10-06T09:00:00.000Z', lineageId: 'r1' });
    const review2 = loop({ loopId: 'r2', kind: 'review', dispatchedAt: '2026-10-06T10:00:00.000Z', followUpTo: 'r1', lineageId: 'r1' });
    const { provider } = spyProvider({ ctx: ctxFor('LIN-50') });
    const { loader } = loaderWith({ loops: [review1, impl, review2] });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: { provider, callScope: 'tok' } });
    assert.deepEqual(model.sessions.map(s => s.loopId), ['r1', 'i1', 'r2'], 'same lineage, three rows');
    assert.deepEqual(model.sessions.map(s => s.state), ['done', 'done', 'running']);
    assert.deepEqual(model.sessions.map(s => s.open), [false, false, true], 'the running row starts open');
  });

  test('getLoopsForIssue is asked for the whole history (horizon:"all")', async () => {
    const seen = [];
    const { provider } = spyProvider({ ctx: ctxFor('LIN-50') });
    const { loader } = loaderWith({ getLoops: async (urlKey, id, deps) => { seen.push({ urlKey, id, horizon: deps.horizon }); return []; } });
    await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: { provider, callScope: 'tok' } });
    assert.deepEqual(seen, [{ urlKey: 'ws', id: 'LIN-50', horizon: 'all' }]);
  });
});

describe('task page loader: unbounded history through the real store', () => {
  const harness = createMangoTmpdir('lin-3329-task-page-');
  before(() => harness.connect());
  after(() => harness.close());

  test('a 45-day-old session seeded through DispatchQueueStore is on the track', async () => {
    const db = harness.freshDb();
    const dispatchStore = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
    const agentStatusStore = new AgentStatusStore({ collection: db.collection('foreman-status') });

    const old = await dispatchStore.addItem('ws', { prompt: 'p', promptName: 'research', kind: 'research', issueIdentifier: 'LIN-50', issueTitle: 'Stored title' });
    await dispatchStore.takeItem(old._id, 'ws');
    // Age the archived row past the 30-day read horizon.
    const aged = new Date(NOW.getTime() - 45 * DAY_MS);
    await db.collection('dispatch-history').updateOne({ _id: old._id }, { $set: { dispatchedAt: aged } });
    const fresh = await dispatchStore.addItem('ws', { prompt: 'p', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-50', issueTitle: 'Stored title' });

    const loader = createTaskPageLoader({ dispatchStore, agentStatusStore, enrichLoop, deriveSessionWaiting, now: () => NOW });
    const { provider } = spyProvider({ ctx: ctxFor('LIN-50') });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: { provider, callScope: 'tok' } });
    assert.deepEqual(model.sessions.map(s => s.loopId), [String(old._id), String(fresh._id)], 'oldest-first, the aged row included');
    assert.deepEqual(model.sessions.map(s => s.state), ['running', 'queued']);
  });
});

describe('task page loader: no stored-only fallback', () => {
  // John's no-fallback decision (LIN-3329 close-out): if the tracker can't be
  // read, the page is not-found or try-again, as the task-edit page is — stored
  // sessions don't turn it into a partial page.
  const stored = [done({ loopId: 'a' }), done({ loopId: 'b' })];
  const access = (read) => ({ provider: spyProvider(read).provider, callScope: 'tok' });

  test('stored sessions and a tracker error → unavailable, not a stored-only page', async () => {
    const { loader, briefSpy } = loaderWith({ loops: stored, brief: { brief: 'cached brief' } });
    const result = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: access({ throwOnRead: new Error('Linear API 500') }) });
    assert.deepEqual(result, { unavailable: true });
    assert.equal(briefSpy.calls.get, 0, 'nothing else is read once the tracker failed');
  });

  test('no sessions and a tracker error → unavailable', async () => {
    const { loader } = loaderWith({ loops: [] });
    assert.deepEqual(await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: access({ throwOnRead: new Error('ECONNRESET') }) }), { unavailable: true });
  });

  test('no tracker access at all → unavailable (the guest route\'s "owner login unusable")', async () => {
    const { loader } = loaderWith({ loops: stored });
    assert.deepEqual(await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: null }), { unavailable: true });
  });

  test('stored sessions but the tracker says not found → notFound, not a stored-only page', async () => {
    const { loader } = loaderWith({ loops: stored });
    assert.deepEqual(await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: access({ throwOnRead: new Error('Issue not found: LIN-50') }) }), { notFound: true });
  });

  test('no sessions and the tracker says not found → notFound', async () => {
    const { loader } = loaderWith({ loops: [] });
    assert.deepEqual(await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-404', access: access({ throwOnRead: new Error('Issue not found: LIN-404') }) }), { notFound: true });
  });

  test('a tracker answer with no issue → notFound', async () => {
    const { loader } = loaderWith({ loops: stored });
    assert.deepEqual(await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: access({ ctx: null }) }), { notFound: true });
  });

  test('the state read never reaches a provider and never reports done', async () => {
    const { loader } = loaderWith({ loops: [done()] });
    const { model } = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-50' });
    assert.equal(model.tracker, null, 'not read this time');
    assert.equal(model.status, 'idle');
    assert.equal(model.sentence, 'No session running. Last: Build done 6 Oct, 11:00 UTC.');
  });
});

describe('task page loader: the canonical identifier', () => {
  test('a task opened by UUID reads its sessions under the tracker\'s identifier', async () => {
    const seen = [];
    const { provider, calls } = spyProvider({ ctx: ctxFor('LIN-9') });
    const { loader } = loaderWith({ getLoops: async (urlKey, id) => { seen.push(id); return [done({ issueIdentifier: 'LIN-9' })]; } });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: ISSUE_UUID, access: { provider, callScope: 'tok' } });
    assert.equal(calls[0].id, ISSUE_UUID, 'the tracker is asked by what the URL carried');
    assert.deepEqual(seen, ['LIN-9'], 'sessions are stored by identifier, so they are read by the canonical one');
    assert.equal(model.identifier, 'LIN-9');
    assert.equal(model.sessions.length, 1);
  });
});

describe('guessStages: the usual stages after the FURTHEST one reached', () => {
  const k = (...kinds) => kinds.map(kind => ({ kind }));
  const cases = [
    ['no sessions → all five', [], null, ['research', 'plan', 'implementation', 'review', 'close-out']],
    ['only off-spine kinds → all five', k('triage', 'plan-review', 'autopilot'), null, ['research', 'plan', 'implementation', 'review', 'close-out']],
    ['after plan', k('research', 'plan'), 'started', ['implementation', 'review', 'close-out']],
    ['review → implementation loop: furthest, not last', k('plan', 'implementation', 'review', 'implementation'), 'started', ['close-out']],
    ['close-out reached → nothing ahead', k('close-out'), 'started', []],
    ['tracker completed → none', k('plan'), 'completed', []],
    ['tracker canceled → none', k(), 'canceled', []],
  ];
  for (const [name, sessions, type, expected] of cases) {
    test(name, () => assert.deepEqual(guessStages(sessions, type), expected));
  }
});

describe('deriveHeader: one row per branch, in order done → waiting → running → idle', () => {
  const s = (state, kind, over = {}) => ({ state, kind, loop: { takenAt: '2026-10-06T14:02:00.000Z', dispatchedAt: '2026-10-06T14:00:00.000Z' }, endedAt: '2026-10-06T13:30:00.000Z', ...over });
  const tracker = (type) => ({ state: { name: type, type }, finishedAt: '2026-10-05T12:00:00.000Z' });
  const noWait = { waiting: false, message: null };
  const cases = [
    ['done (completed), even with a stale running row', { sessions: [s('running', 'review')], waiting: noWait, tracker: tracker('completed') }, 'done', 'Finished 5 Oct, 12:00 UTC.'],
    ['done (canceled)', { sessions: [], waiting: noWait, tracker: tracker('canceled') }, 'done', 'Cancelled 5 Oct, 12:00 UTC.'],
    ['waiting beats running; message cut to one line, marker dropped', { sessions: [s('running', 'review')], waiting: { waiting: true, message: '[blocked] Which API?\nmore detail' }, tracker: tracker('started') }, 'waiting', 'Which API?'],
    ['running', { sessions: [s('done', 'plan'), s('running', 'implementation')], waiting: noWait, tracker: tracker('started') }, 'running', 'Build running since 6 Oct, 14:02 UTC.'],
    ['queued only', { sessions: [s('done', 'plan'), s('queued', 'review')], waiting: noWait, tracker: tracker('started') }, 'running', 'Review queued, waiting for a worker.'],
    ['idle after a session', { sessions: [s('failed', 'review')], waiting: noWait, tracker: tracker('started') }, 'idle', 'No session running. Last: Review failed 6 Oct, 13:30 UTC.'],
    ['idle, nothing yet', { sessions: [], waiting: noWait, tracker: tracker('unstarted') }, 'idle', 'No sessions yet.'],
    ['tracker not read (the state endpoint): never done, no suffix', { sessions: [s('done', 'close-out')], waiting: noWait, tracker: null }, 'idle', 'No session running. Last: Close-out done 6 Oct, 13:30 UTC.'],
    ['unknown kind falls back to stepKindWord', { sessions: [s('running', 'brand-new-kind')], waiting: noWait, tracker: null }, 'running', 'Brand-new-kind running since 6 Oct, 14:02 UTC.'],
  ];
  for (const [name, input, status, sentence] of cases) {
    test(name, () => assert.deepEqual(deriveHeader({ ...input, now: NOW }), { status, sentence }));
  }
});

describe('session rows', () => {
  test('a marker-less end (cancelled / agent-status complete) reads as ended, not running', () => {
    const model = buildTaskPageModel({
      identifier: 'LIN-50',
      loops: [loop({ loopId: 'c', historyStatus: 'cancelled', agentState: 'complete' }), loop({ loopId: 'a', agentState: 'complete' })],
      enrichLoop, deriveSessionWaiting, now: NOW,
    });
    assert.deepEqual(model.sessions.map(s => s.state), ['cancelled', 'done']);
    assert.deepEqual(model.sessions.map(s => s.loop.terminalStatus), ['cancelled', 'done'], 'the face gets the named end');
    assert.equal(model.live, false);
  });

  test('a blocked row is open and waiting until a follow-up supersedes it', () => {
    const blocked = loop({ loopId: 'b1', wakeMarker: 'blocked', waitingMessage: '[blocked] need a key', feedback: [{ message: '[blocked] need a key' }] });
    const solo = buildTaskPageModel({ identifier: 'LIN-50', loops: [blocked], enrichLoop, deriveSessionWaiting, now: NOW });
    assert.equal(solo.sessions[0].state, 'waiting');
    assert.equal(solo.sessions[0].open, true);
    assert.equal(solo.sessions[0].message, 'need a key', 'marker stripped');
    assert.equal(solo.status, 'waiting');

    const followed = buildTaskPageModel({ identifier: 'LIN-50', loops: [blocked, done({ loopId: 'f1', followUpTo: 'b1' })], enrichLoop, deriveSessionWaiting, now: NOW });
    assert.equal(followed.sessions[0].state, 'continued', 'superseded: ended when the follow-up took over, not waiting and not running');
    assert.equal(followed.sessions[0].loop.terminalStatus, 'continued', 'the face reads it too');
    assert.equal(followed.status, 'idle', 'a replied-to block never drives the header');
  });

  test('evidence is hosted once, by the newest implementation/review/close-out row', () => {
    const model = buildTaskPageModel({
      identifier: 'LIN-50',
      loops: [done({ loopId: 'p', kind: 'plan' }), done({ loopId: 'i', kind: 'implementation' }), done({ loopId: 'r', kind: 'review' }), done({ loopId: 'w', kind: 'wake' })],
      enrichLoop, deriveSessionWaiting, now: NOW,
    });
    assert.deepEqual(model.sessions.filter(s => s.evidenceHost).map(s => s.loopId), ['r']);
  });

  test('[evidence] links are http(s) only', () => {
    const model = buildTaskPageModel({
      identifier: 'LIN-50',
      loops: [done({ telemetry: { producedArtifacts: [{ url: 'https://example.com/pr/1', label: 'PR' }, { url: 'javascript:alert(1)', label: 'x' }] } })],
      enrichLoop, deriveSessionWaiting, now: NOW,
    });
    assert.deepEqual(model.sessions[0].links, [{ url: 'https://example.com/pr/1', label: 'PR' }]);
  });
});

test('fmtWhen is UTC and adds the year only when it differs from now', () => {
  assert.equal(fmtWhen('2026-10-06T09:05:00.000Z', NOW), '6 Oct, 09:05 UTC');
  assert.equal(fmtWhen('2025-01-02T23:59:00.000Z', NOW), '2 Jan 2025, 23:59 UTC');
  assert.equal(fmtWhen(null, NOW), null);
  assert.equal(fmtWhen('not a date', NOW), null);
});
