/**
 * LIN-4405 (part 2 of LIN-4395): "Sessions on one clock" on the task page, end to end.
 *
 * Witnesses:
 *  - the loader: `loadTaskPage` sets `model.timeline` from the injected reader, with the page model's open ids, the
 *    close-out events its merged-by read already holds (one events read, not two) and the PR status's merge time;
 *    `loadTaskState` never calls it (a quiet poll does no cost read); a failed read renders "sessions could not be
 *    read" and the page still loads; a loader built without a reader draws no section;
 *  - builder note 9: the task page itself, for a task whose only lineage is 40 days old, through the real dispatch
 *    store, the real cost read and the real renderer, shows its session;
 *  - the owner/member fragment returns the timeline with spend, and the page carries its URL;
 *  - the guest: all three responses (`/t/:token`, `/t/:token/timeline`, `/t/:token/state`) for a priced task carry no
 *    dollar figure and no cost attribute, and the cached page model is never mutated by the strip.
 *
 * Run with: node --test tests/unit/task-timeline-page.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { renderTaskPage } from '../../lib/render-task-page.js';
import { createTaskTimelineReader, createTimelineFragmentReader, taskTimeline, mergeMarksOf, withoutSpend } from '../../lib/task-timeline.js';
import { renderTaskTimeline } from '../../lib/render-task-timeline.js';
import { createTaskShareRoutes } from '../../routes/task-share.js';
import { createTaskPageRoutes } from '../../routes/task-page.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { NO_REQUEST_RECORDS } from '../fixtures/request-usage-loader.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { LIN_4393_SESSIONS, LIN_4393_PRICED_USD, LIN_4393_MERGE_EVENTS, LIN_4393_NOW } from '../fixtures/task-timeline/lin-4393.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const ISSUE_UUID = '11111111-2222-3333-4444-555555555555';
const PR_URL = 'https://github.com/acme/app/pull/41';
const TOKEN = 'A'.repeat(43);

function ctxFor(identifier) {
  return {
    issue: { id: ISSUE_UUID, identifier, title: 'Build the task page', url: `https://linear.app/x/issue/${identifier}`, state: { name: 'Done', type: 'completed' }, labels: [], description: null, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z' },
    parent: null, children: [], comments: [], stateTransitions: [],
  };
}
const provider = (identifier = 'LIN-50') => ({ provider: { async fetchRecommendationContext() { return ctxFor(identifier); } }, callScope: 'tok' });

function loop(over = {}) {
  return {
    loopId: 'loop-1', issueIdentifier: 'LIN-50', issueId: ISSUE_UUID, issueTitle: 'Stored', kind: 'implementation', iteration: 1, source: 'history',
    historyStatus: 'taken', agentState: 'running', dispatchedAt: '2026-11-10T10:00:00.000Z', takenAt: '2026-11-10T10:01:00.000Z',
    resolvedAt: '2026-11-10T10:01:00.000Z', terminalStatus: null, terminalCompletedAt: null, wakeMarker: null, waitingMessage: null,
    feedback: [], telemetry: { producedArtifacts: [] }, followUpTo: null, ...over,
  };
}

/** The LIN-4393 timeline: a real, priced task. */
const pricedTimeline = () => taskTimeline({
  sessions: LIN_4393_SESSIONS, merges: mergeMarksOf({ events: LIN_4393_MERGE_EVENTS }), now: LIN_4393_NOW, totalUsd: LIN_4393_PRICED_USD, pricedUsd: LIN_4393_PRICED_USD,
});

/** A dollar figure as the formatter writes one (`$0.84`, `<$0.01`). */
const DOLLAR = /\$\d|<\$0/;

describe('the loader: the page load reads the timeline, the poll never does', () => {
  test('loadTaskPage hands the reader the open ids, the events it already read and the PR merge time', async () => {
    const seen = [];
    const events = [{ by: 'person', merged: true, prUrl: PR_URL, prMergedAt: null }];
    let eventReads = 0;
    const loader = createTaskPageLoader({
      dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting,
      getLoopsForIssue: async () => [loop({ loopId: 'open-1' }), loop({ loopId: 'done-1', terminalStatus: 'done', terminalCompletedAt: '2026-11-10T10:30:00.000Z' })],
      readRunEvidence: async () => ({ closeOut: { status: 'merged', pr: { url: PR_URL, number: 41, merged: true, mergedAt: '2026-11-10T11:00:00Z' } } }),
      closeOutEventsStore: { async listForIssue() { eventReads += 1; return events; } },
      readTaskTimeline: async (args) => { seen.push(args); return { lanes: [], scale: null, marks: { merges: [], untimedMerge: false }, totals: {} }; },
      now: () => NOW,
    });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: provider() });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].openItemIds, ['open-1']);
    assert.equal(seen[0].closeOutEvents, events, 'the merged-by read\'s own list, not a second read');
    assert.deepEqual(seen[0].pr, { merged: true, mergedAt: '2026-11-10T11:00:00Z', url: PR_URL });
    assert.equal(eventReads, 1);
    assert.ok(model.timeline);
    assert.equal(model.evidence.closeOut.mergedBy, 'person', 'the merged-by fact is unchanged');
  });

  test('loadTaskState never calls the reader, and its model has no timeline', async () => {
    let calls = 0;
    const loader = createTaskPageLoader({
      dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting,
      getLoopsForIssue: async () => [loop()], readTaskTimeline: async () => { calls += 1; return {}; }, now: () => NOW,
    });
    const { model } = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-50' });
    assert.equal(calls, 0);
    assert.equal('timeline' in model, false);
  });

  test('a failed read renders "sessions could not be read" and the page still loads', async () => {
    const loader = createTaskPageLoader({
      dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting,
      getLoopsForIssue: async () => [loop()], readTaskTimeline: async () => { throw new Error('store down'); }, now: () => NOW,
    });
    const error = console.error;
    console.error = () => {};
    try {
      const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: provider() });
      assert.deepEqual(model.timeline, { error: true });
      const html = renderTaskPage(model, { urlKey: 'ws', now: NOW });
      assert.match(html, /Sessions on one clock/);
      assert.match(html, /sessions could not be read/);
      assert.match(html, /data-testid="task-page-track-mount"/, 'the rest of the page is there');
    } finally {
      console.error = error;
    }
  });

  test('a loader built without a reader carries no timeline and draws no section', async () => {
    const loader = createTaskPageLoader({ dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, getLoopsForIssue: async () => [loop()], now: () => NOW });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: provider() });
    assert.equal('timeline' in model, false);
    assert.doesNotMatch(renderTaskPage(model, { urlKey: 'ws', now: NOW }), /task-timeline/);
  });
});

describe('builder note 9: a task whose only lineage is 40 days old shows its session, through the page', () => {
  const harness = createMangoTmpdir('lin-4405-timeline-');
  before(() => harness.connect());
  after(() => harness.close());

  test('the real store, the real cost read and the real renderer draw it as a session with unknown working times', async () => {
    const db = harness.freshDb();
    const dispatchStore = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
    const agentStatusStore = new AgentStatusStore({ collection: db.collection('foreman-status') });
    const old = await dispatchStore.addItem('ws', { prompt: 'p', promptName: 'research', kind: 'research', issueIdentifier: 'LIN-50', issueTitle: 'Stored' });
    await dispatchStore.takeItem(old._id, 'ws');
    await db.collection('dispatch-history').updateOne({ _id: old._id }, { $set: { dispatchedAt: new Date(NOW.getTime() - 40 * DAY_MS) } });

    const readTaskTimeline = createTaskTimelineReader({ dispatchQueueStore: dispatchStore, requestUsageLoader: NO_REQUEST_RECORDS, now: () => NOW });
    const loader = createTaskPageLoader({ dispatchStore, agentStatusStore, enrichLoop, deriveSessionWaiting, readTaskTimeline, now: () => NOW });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access: provider() });
    const html = renderTaskPage(model, { urlKey: 'ws', now: NOW });

    assert.match(html, /<h2 class="section-header">Sessions on one clock<\/h2>/);
    const lanes = [...html.matchAll(/<li class="tl-lane"[^>]*>/g)].map(m => m[0]);
    assert.equal(lanes.length, 1, 'its one session is drawn');
    assert.match(lanes[0], /data-kind="research"/);
    assert.match(lanes[0], /data-lane-id="[^"]+"/);
    assert.match(lanes[0], /data-times="unknown"/, 'no request records: working times unknown, never a guessed bar');
    assert.match(html, /1 session/);
  });
});

describe('the owner/member fragment', () => {
  async function build({ loader, timelineFragment }) {
    const app = express();
    app.use(createTaskPageRoutes({
      workspaceFromUrl: (req, res, next) => { req.workspace = { id: 'ws-1', urlKey: 'acme', provider: {}, callScope: 'tok', bindings: [] }; req.session = { accountId: 'acct-1', workspaces: [] }; next(); },
      getOpenRouterSource: () => null, getDeployInfo: () => ({}), loader, timelineFragment, now: () => NOW,
    }));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
  }

  test('returns the timeline with spend, through the shared reader, with open ids from the state read', async () => {
    const asked = [];
    const loader = { async loadTaskPage() { return {}; }, async loadTaskState(args) { asked.push(args); return { model: { sessions: [{ loopId: 'x', open: true }] } }; } };
    const reads = [];
    const timelineFragment = createTimelineFragmentReader({ loadTaskState: (a) => loader.loadTaskState(a), readTaskTimeline: async (args) => { reads.push(args); return pricedTimeline(); }, now: () => NOW });
    const { base, close } = await build({ loader, timelineFragment });
    try {
      const res = await fetch(`${base}/workspace/acme/api/task/LIN-50/timeline?issueId=${ISSUE_UUID}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const body = await res.json();
      assert.deepEqual(Object.keys(body), ['timelineHtml']);
      assert.match(body.timelineHtml, /total \$14\.75/);
      assert.deepEqual(asked, [{ urlKey: 'acme', identifier: 'LIN-50', issueId: ISSUE_UUID }]);
      assert.deepEqual(reads[0].openItemIds, ['x']);
      assert.equal((await fetch(`${base}/workspace/acme/api/task/not%20an%20id/timeline`)).status, 404);
    } finally {
      await close();
    }
  });

  test('a failed read is a 500 the page script ignores (it keeps its paint)', async () => {
    const loader = { async loadTaskPage() { return {}; }, async loadTaskState() { throw new Error('down'); } };
    const timelineFragment = createTimelineFragmentReader({ loadTaskState: (a) => loader.loadTaskState(a), readTaskTimeline: async () => ({}), now: () => NOW });
    const { base, close } = await build({ loader, timelineFragment });
    const error = console.error;
    console.error = () => {};
    try {
      assert.equal((await fetch(`${base}/workspace/acme/api/task/LIN-50/timeline`)).status, 500);
    } finally {
      console.error = error;
      await close();
    }
  });
});

describe('the guest: no dollars in any of the three responses', () => {
  const record = { _id: 'share-1', tokenHash: 'hash', urlKey: 'acme', workspaceId: 'ws-1', ownerAccountId: 'acct-1', issueIdentifier: 'LIN-50', issueId: ISSUE_UUID, source: 'linear', createdAt: NOW, revokedAt: null };

  async function build() {
    const pageModel = {
      identifier: 'LIN-50', title: 'Build the task page', issueId: ISSUE_UUID, tracker: null, status: 'done', sentence: 'Merged.',
      live: false, sessions: [], stages: [], brief: null, recap: null, evidence: null, details: null, timeline: pricedTimeline(),
    };
    const pristine = structuredClone(pageModel);
    const loader = {
      async loadTaskPage() { return { model: pageModel, taskState: null }; },
      async loadTaskState() { return { model: { ...pageModel, timeline: undefined }, taskState: { state: 'done' }, incomplete: null }; },
    };
    const timelineFragment = createTimelineFragmentReader({ loadTaskState: (a) => loader.loadTaskState(a), readTaskTimeline: async () => pricedTimeline(), now: () => NOW });
    const app = express();
    app.use(createTaskShareRoutes({
      taskShareStore: { async getByToken() { return record; } },
      loader,
      workspaceFromUrl: (req, res, next) => next(),
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      guestAccess: async () => ({ provider: {}, callScope: 'tok' }),
      now: () => NOW,
      timelineFragment,
    }));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)), pageModel, pristine };
  }

  /** Every attribute in the HTML: none names a cost, none carries a dollar. */
  function assertNoCostAttribute(html, where) {
    for (const [, name, value] of html.matchAll(/\s([a-zA-Z-]+)="([^"]*)"/g)) {
      assert.doesNotMatch(name, /cost|usd|spend/i, `${where}: ${name}`);
      assert.doesNotMatch(value, DOLLAR, `${where}: ${name}="${value}"`);
    }
  }

  test('/t/:token, /t/:token/timeline and /t/:token/state: the picture without a dollar anywhere', async () => {
    const { base, close, pageModel, pristine } = await build();
    try {
      const page = await (await fetch(`${base}/t/${TOKEN}`)).text();
      assert.match(page, /Sessions on one clock/);
      assert.match(page, /elapsed 1h 3m · worked 2m 22s/, 'the same picture');
      assert.match(page, new RegExp(`data-timeline-url="/t/${TOKEN}/timeline"`));
      const section = page.slice(page.indexOf('data-testid="task-timeline"'), page.indexOf('</ol>', page.indexOf('data-testid="task-timeline"')));
      assert.doesNotMatch(section, /\$/, 'no dollar sign in the section at all');
      assert.doesNotMatch(page, DOLLAR);
      assertNoCostAttribute(page, '/t/:token');

      const fragmentRes = await fetch(`${base}/t/${TOKEN}/timeline`);
      assert.equal(fragmentRes.status, 200);
      const fragment = await fragmentRes.json();
      assert.deepEqual(Object.keys(fragment), ['timelineHtml']);
      assert.match(fragment.timelineHtml, /Kick-off · held/);
      assert.doesNotMatch(fragment.timelineHtml, /\$/);
      assertNoCostAttribute(fragment.timelineHtml, '/t/:token/timeline');

      const stateText = await (await fetch(`${base}/t/${TOKEN}/state`)).text();
      assert.doesNotMatch(stateText, DOLLAR);
      assert.doesNotMatch(stateText, /timeline|costUsd|totalUsd/, 'the state reply carries no timeline');
      assertNoCostAttribute(JSON.parse(stateText).trackHtml || '', '/t/:token/state');

      // The strip copied: the cached page model still carries its spend for the owner's next read.
      assert.deepEqual(pageModel, pristine);
      assert.equal(pageModel.timeline.totals.totalUsd, LIN_4393_PRICED_USD);
    } finally {
      await close();
    }
  });

  test('the renderer\'s own gate: a stripped timeline writes no pricing word for priced, incomplete, no-usage, unpriced or foreign lanes', () => {
    // withoutSpend removes the figures; the renderer must also drop the words that would stand in for them. This pins
    // `laneCost`'s and `totalWords`' `if (!spend) return null;` (review fix 2), which the route tests cannot see.
    const MIN = 60 * 1000;
    const T0 = Date.parse('2026-11-08T12:00:00.000Z');
    const at = m => new Date(T0 + m * MIN).toISOString();
    const d = (itemId, kind, start, first, last, { costUsd = 0.1, followUpTo = null } = {}) => ({
      itemId, kind, dispatchedAt: at(start), followUpTo, byModel: [{ model: 'claude-opus-5-5', requests: 3, costUsd }],
      requests: 3, costUsd, firstRequestAt: at(first), lastRequestAt: at(last),
    });
    const s = (rootItemId, kind, start, dur, dispatches, extra = {}) => ({
      rootItemId, kind, dispatchedAt: at(start), harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high',
      costUsd: 1, durationMs: dur * MIN, dispatches, telemetry: true, incomplete: false, ...extra,
    });
    const tl = taskTimeline({
      sessions: [
        s('priced', 'plan', 0, 5, [d('priced', 'plan', 0, 1, 4)], { costUsd: 2 }),
        s('partial', 'implementation', 6, 5, [d('partial', 'implementation', 6, 7, 10)], { costUsd: null, incomplete: true }),
        s('silent', 'review', 12, 5, [d('silent', 'review', 12, 13, 15, { costUsd: null })], { costUsd: null, telemetry: false }),
        s('unpriced', 'close-out', 18, 5, [d('unpriced', 'close-out', 18, 19, 21, { costUsd: null })], { costUsd: null }),
      ],
      foundedElsewhere: [{
        ...s('P', 'autopilot', -60, 120, [d('P', 'autopilot', -60, -59, -58), d('W1', 'wake', 8, 8.5, 9, { followUpTo: 'P' })], { costUsd: 9 }),
        countedUnder: 'LIN-9', taggedItemIds: ['W1'],
      }],
      now: at(30), totalUsd: null, pricedUsd: 2, lineagesTruncated: true,
    });
    const WORDS = /not priced|cost not complete|no usage posted|lineage cost|total/;
    // What a reader sees: text between tags plus title attributes (a `data-testid` naming "total" is not a word shown).
    const shown = html => [...html.replace(/<[^>]*>/g, m => (m.match(/\stitle="([^"]*)"/) || ['', ' '])[1] + ' ').split(/\s+/)].join(' ');
    const owner = shown(renderTaskTimeline(tl));
    for (const word of ['not priced', 'cost not complete', 'no usage posted', 'lineage cost', 'total']) {
      assert.ok(owner.includes(word), `the owner's picture writes "${word}", so its absence below is meaningful`);
    }
    const guestHtml = renderTaskTimeline(withoutSpend(tl));
    assert.match(guestHtml, /data-testid="task-timeline-lane"/, 'the guest still sees the lanes');
    assert.doesNotMatch(shown(guestHtml), WORDS);
    assert.doesNotMatch(guestHtml, /\$/);
  });

  test('a malformed token never reaches the timeline read', async () => {
    const { base, close } = await build();
    try {
      assert.equal((await fetch(`${base}/t/short/timeline`)).status, 404);
    } finally {
      await close();
    }
  });
});
