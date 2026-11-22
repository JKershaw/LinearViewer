/**
 * LIN-4518 step 2, finding-53f10ec3 (review on PR #2491): the witnesses the review asked for, each run against the real
 * records store and the real routes, so a mutation of the wiring goes red here rather than passing the suite.
 *
 *   - the kind override (`recommend-and-dispatch` with `kind`) hands a blind read the landing's change records;
 *   - the proxy's `/prompt` and `/recommend?kind=` hand them too (mutation M4 in the review);
 *   - the in-app prompt route hands them too (the same class, the sibling the review named);
 *   - `landingChangesFor` picks the OPEN change of a PR over an ended one, even when the ended one was written later
 *     (mutation M3 in the review: `ofPr[last]`);
 *   - the run brief's index line for a change shows its PR, so a review can match the id to the PR it read
 *     (finding-12145bdf).
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createPromptsRoutes } from '../../routes/workspace-api-prompts.js';
import { landingChangesFor } from '../../lib/records/landing.js';
import { composeRunBrief } from '../../lib/records/run-brief.js';
import { ProviderInterface } from '../../lib/providers/interface.js';
import { registerProvider } from '../../lib/providers/registry.js';

const URL_KEY = 'lin-4518-step2-witnesses';
// The ticket every route serves: the proxy reads it through a fake provider (a non-test token, so the live
// fetchIssueContext path runs), the in-app route through the test-mode mock fixture (issue-1, identifier TEST-1).
const TICKET = 'TEST-1';
const NON_TEST_TOKEN = 'fake-linear-shaped-token';
const PR_COMMENT = { id: 'c-impl', body: 'Implementation: https://github.com/example/repo/pull/7', createdAt: '2026-11-22T09:00:00.000Z', user: { name: 'Harbour' } };
const REPO = 'example/repo';
const T0 = '2026-11-22T10:00:00.000Z';
const prUrl = (n) => `https://github.com/${REPO}/pull/${n}`;

const harness = createMangoTmpdir('lin-4518-step2-witnesses-');
before(() => harness.connect());
after(() => harness.close());

let rh;
let store;
let taskId;
let openId;
const PR = 7;

/** A provider that serves one ticket with the implementation comment naming the PR (the comment the blind read reads). */
const FAKE_PROVIDER = 'lin-4518-witness';
class CommentedProvider extends ProviderInterface {
  constructor() { super(); this.name = FAKE_PROVIDER; }
  // The kind-override arm resolves a context only; the default descent (never reached here) would read this.
  async fetchRecommendationContext() { throw new Error('the kind override reads the issue context, not the recommendation context'); }
  async fetchIssueContext(_token, identifier) {
    return {
      issue: { id: 'issue-1', identifier, title: 'Landing', description: '', state: { name: 'In Progress', type: 'started' }, labels: [], url: `https://linear.app/test/issue/${identifier}` },
      parent: null, siblings: [], project: null, children: [], comments: [PR_COMMENT], attachments: [],
    };
  }
}

beforeEach(async () => {
  rh = await createRecordsRouteHarness({
    harness,
    urlKey: URL_KEY,
    tickets: new Map(),
    people: [],
    readTicket: async () => null,
    tracker: () => null,
    changePrReaderFor: () => async () => ({ readable: false }),
  });
  store = rh.store;
  taskId = (await store.ensureTask(URL_KEY, { identifier: TICKET, asked: 'Witness the landing.', closed: false, closedReason: null }, { by: 'Harbour', at: T0 })).id;
  // The PR the landing names: its open change at H1, then an ENDED change for the same PR written after it (merged at H0).
  // The order matters: a reader that takes the last change of a PR, not the open one, picks the ended record here.
  openId = (await store.add(URL_KEY, { kind: 'change', state: 'open', fields: { ref: prUrl(PR), head: 'H1' }, links: {}, in: taskId }, { by: 'implementation', at: T0 })).id;
  await store.add(URL_KEY, { kind: 'change', state: 'merged', fields: { ref: prUrl(PR), head: 'H0' }, links: {}, in: taskId }, { by: 'implementation', at: T0 });
});

afterEach(async () => {
  if (rh) await rh.close();
  rh = null;
});

/** The precondition the witnesses rest on: the store lists the open change before the ended one for this PR. */
async function assertOpenListedBeforeEnded() {
  const held = await store.find(URL_KEY, { kind: 'change', inRef: taskId });
  assert.deepEqual(held.map((c) => c.state), ['open', 'merged'], 'the fixture must list the open change first, or the witness proves nothing');
}

/** The proxy app with the records store wired, a non-test token and the fake provider (the live context path). */
function proxyApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({ grants: ['dispatch'], workspaceId: 'ws-acme', tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: NON_TEST_TOKEN, reason: 'ok' }),
    getWorkspaceAccessToken: async () => NON_TEST_TOKEN,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    recordsStore: store,
    provider: new CommentedProvider(),
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        proxyApp.captured = item;
        return { _id: 'disp-1', dispatchedAt: T0, ...item };
      },
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

async function call(app, method, path, body) {
  // The live /prompt path races the provider against a 25s timer it never clears (see proxy-provider-routed-compute.test.js):
  // unref the timers this call schedules so the test process can exit.
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (...args) => realSetTimeout(...args).unref?.();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    global.setTimeout = realSetTimeout;
    await new Promise((resolve) => server.close(resolve));
  }
}

/** The blind-read prompt must name the open change's id and its PR, and never say the record cannot be written. */
function assertNamesOpenChange(prompt, label) {
  assert.ok(typeof prompt === 'string' && prompt.length > 0, `${label}: no prompt text came back`);
  assert.match(prompt, /"judgement": "blind-read"/, `${label}: the verdict record is not written as a blind-read record`);
  assert.ok(prompt.includes(`\`${openId}\` is the change record for ${prUrl(PR)}.`), `${label}: the prompt does not name the open change ${openId} for ${prUrl(PR)}`);
  assert.doesNotMatch(prompt, /cannot be written/, `${label}: the landing's change records were not handed to the prompt`);
}

describe('finding-53f10ec3 (3): landingChangesFor answers the OPEN change of a PR, not the later ended one', () => {
  test('the landing hands the open change id, at its head, when an ended change for the same PR was written after it', async () => {
    await assertOpenListedBeforeEnded();
    const ids = await landingChangesFor({ urlKey: URL_KEY, ticket: TICKET, recordsStore: store });
    assert.deepEqual(ids, [{ id: openId, ref: prUrl(PR), head: 'H1' }]);
  });
});

describe('finding-53f10ec3 (3, M4): the proxy routes hand a blind read the landing\'s change records', () => {
  test('GET /api/proxy/prompt/:identifier/blind-read names the open change id', async () => {
    await assertOpenListedBeforeEnded();
    const res = await call(proxyApp(), 'get', `/api/proxy/prompt/${TICKET}/blind-read`);
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assertNamesOpenChange(res.body.prompt, '/api/proxy/prompt');
  });

  test('GET /api/proxy/recommend/:identifier?kind=blind-read names the open change id', async () => {
    await assertOpenListedBeforeEnded();
    const res = await call(proxyApp(), 'get', `/api/proxy/recommend/${TICKET}?kind=blind-read`);
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assertNamesOpenChange(res.body.prompt, '/api/proxy/recommend?kind=');
  });
});

describe('finding-53f10ec3 (1): a blind read dispatched through the kind override is handed the landing\'s change records', () => {
  test('POST /api/proxy/recommend-and-dispatch { kind: blind-read } dispatches a prompt that names the open change id', async () => {
    await assertOpenListedBeforeEnded();
    proxyApp.captured = null;
    const res = await call(proxyApp(), 'post', '/api/proxy/recommend-and-dispatch', { issueIdentifier: TICKET, kind: 'blind-read' });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(proxyApp.captured, 'the override must dispatch an item');
    assertNamesOpenChange(proxyApp.captured.prompt, 'recommend-and-dispatch kind override');
  });
});

describe('finding-53f10ec3 (1): the in-app prompt route hands a blind read the landing\'s change records', () => {
  before(() => registerProvider(new CommentedProvider()));

  function inAppApp() {
    const app = express();
    app.use((req, _res, next) => {
      req.session = {};
      req.workspace = { accessToken: NON_TEST_TOKEN, urlKey: URL_KEY, provider: FAKE_PROVIDER };
      next();
    });
    app.use(createPromptsRoutes({
      workspaceFromUrl: (req, _res, next) => next(),
      promptTraceStore: {},
      customPromptsStore: { get: async () => null },
      recordsStore: store,
    }));
    return app;
  }

  test('GET /workspace/:urlKey/api/prompt/:issueId/blind-read names the open change id', async () => {
    await assertOpenListedBeforeEnded();
    const res = await call(inAppApp(), 'get', `/workspace/${URL_KEY}/api/prompt/${TICKET}/blind-read`);
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assertNamesOpenChange(res.body.prompt, 'in-app /api/prompt');
  });
});

describe('finding-12145bdf: a review run\'s brief names each change by its PR, so the id can be matched to the PR read', () => {
  test('the change line in the run brief carries the PR URL beside the change id', async () => {
    await store.openRun(URL_KEY, { id: 'row-review-brief', stage: 'review', taskId, lineage: 'row-root', at: T0 });
    const built = await composeRunBrief({ store, urlKey: URL_KEY, runId: 'row-review-brief' });
    assert.ok(!built.problem, `the brief was not composed: ${built.problem}`);
    const text = built.text ?? built.brief ?? JSON.stringify(built);
    const line = text.split('\n').find((l) => l.includes(openId));
    assert.ok(line, `the brief does not name the open change ${openId}`);
    assert.ok(line.includes(prUrl(PR)), `the change line does not name its PR: ${line}`);
  });
});

// LIN-4520 (finding-2f1e89d3): attachLandingChanges hands an implementation prompt the fix round read from the records, but the
// three entrances that project the context through promptContextOf dropped it, so a request-changes round got the fresh-start
// "Open a PR" workflow. Each witness is a request-changes review on record, then the prompt each entrance renders.
describe('finding-2f1e89d3: an implementation prompt after a request-changes review continues the PR on every entrance', () => {
  beforeEach(async () => {
    // The review judged the open change at its head; its verdict on record is request-changes.
    await store.add(URL_KEY, {
      kind: 'verdict', state: 'stands', in: taskId,
      fields: { judgement: 'review', outcome: 'request-changes', reasoning: 'read at the head named' },
      links: { on: [`${openId}@1`] },
    }, { by: 'review', at: '2026-11-22T10:30:00.000Z' });
  });

  /** The fix-round workflow, and not the fresh-start one. */
  function assertFixRound(prompt, label) {
    assert.ok(typeof prompt === 'string' && prompt.length > 0, `${label}: no prompt text came back`);
    assert.match(prompt, /Continue the existing branch and the PR the task's change record names/, `${label}: the fix-round workflow did not reach the prompt`);
    assert.doesNotMatch(prompt, /\*\*Open a PR\*\*/, `${label}: the fresh-start "Open a PR" workflow was handed to a fix round`);
  }

  test('GET /api/proxy/prompt/:identifier/implementation', async () => {
    const res = await call(proxyApp(), 'get', `/api/proxy/prompt/${TICKET}/implementation`);
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assertFixRound(res.body.prompt, '/api/proxy/prompt');
  });

  test('GET /api/proxy/recommend/:identifier?kind=implementation', async () => {
    const res = await call(proxyApp(), 'get', `/api/proxy/recommend/${TICKET}?kind=implementation`);
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assertFixRound(res.body.prompt, '/api/proxy/recommend?kind=');
  });

  test('POST /api/proxy/recommend-and-dispatch { kind: implementation } (the pinned dispatch entrance)', async () => {
    proxyApp.captured = null;
    const res = await call(proxyApp(), 'post', '/api/proxy/recommend-and-dispatch', { issueIdentifier: TICKET, kind: 'implementation' });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(proxyApp.captured, 'the override must dispatch an item');
    assertFixRound(proxyApp.captured.prompt, 'recommend-and-dispatch kind override');
  });
});
