/**
 * LIN-3962: GET /workspace/:urlKey/api/dispatch/decision-panel, the owner-only read Home's Change panel calls
 * when it opens. It returns the shared panel's HTML and the job's numbers, priced from the same history read
 * Settings › Models uses, keyed on the kind the server derives (never the step's label).
 *
 * Witnesses: the numbers are keyed on the derived kind; a priced run shows its typical cost and an unpriced run
 * never reads $0; a blank harness judges effort by the harness in force; a stored effort outside the set is kept;
 * the "as Settings sets it" words come from the resolution with the run's own fields cleared; a non-owner is refused.
 *
 * Run with: node --test tests/unit/decision-panel-route.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { emptyTable } from '../../lib/model-routing.js';

// A `[usage]` feedback entry, as the runner posts it. `costUsd` pins a price; omit it to be unpriced.
function usage({ model = 'claude-sonnet-5', costUsd } = {}) {
  const payload = costUsd === undefined ? { model } : { model, costUsd };
  return { kind: 'usage', timestamp: '2026-10-20T10:01:00Z', message: `[usage] ${JSON.stringify(payload)}` };
}
const taken = (kind, id, feedback) => ({ id, status: 'taken', kind, dispatchedAt: '2026-10-20T10:00:00Z', feedback });

function buildApp({ owner = true, table = emptyTable(), history = [] } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      addItem: async () => ({ _id: 'disp-1' }),
      listHistoryWithBodies: async () => ({ items: history, total: history.length })
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      // The test token keeps the catalog on its mock path (lib/should-mock-ai.js): no live OpenRouter call.
      req.workspace = { id: 'ws-1', urlKey: req.params.urlKey, accessToken: 'test-token' };
      req.session = { accountId: 'acct-1', linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: { getRoutingTable: async () => table },
    dispatchPresetsStore: { get: async () => null },
    workspaceOwnerCheck: async () => ({ status: owner ? 'owner' : 'not-owner' })
  }));
  return app;
}

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const PANEL = '/workspace/acme/api/dispatch/decision-panel';

describe('GET /api/dispatch/decision-panel: the numbers are the derived kind\'s own', () => {
  test('the numbers answer for the kind the promptName derives, not for every job', async () => {
    const history = [
      taken('implementation', 'a', [usage({ costUsd: 1.5 })]),
      taken('review', 'b', [usage({ costUsd: 9 })])
    ];
    const { status, body } = await get(buildApp({ history }), `${PANEL}?promptName=implementation`);
    assert.equal(status, 200);
    assert.equal(body.kind, 'implementation');
    assert.equal(body.numbers.runs, 1);
    assert.equal(body.numbers.spendUsd, 1.5);
  });

  test('an explicit kind wins over the promptName, as the preview takes it', async () => {
    const history = [taken('review', 'b', [usage({ costUsd: 9 })])];
    const { body } = await get(buildApp({ history }), `${PANEL}?promptName=implementation&kind=review`);
    assert.equal(body.kind, 'review');
    assert.equal(body.numbers.spendUsd, 9);
  });

  test('a priced run shows its runs and typical cost in the panel', async () => {
    const history = [taken('implementation', 'a', [usage({ costUsd: 1.5 })]), taken('implementation', 'b', [usage({ costUsd: 0.5 })])];
    const { body } = await get(buildApp({ history }), `${PANEL}?promptName=implementation`);
    assert.match(body.html, /\$2\.00 · typical \$1\.00 a run/);
    assert.equal(body.numbers.runs, 2);
  });

  test('an unpriced run is unpriced, never $0, in the numbers and the HTML', async () => {
    const history = [taken('implementation', 'a', [usage({})])];
    const { body } = await get(buildApp({ history }), `${PANEL}?promptName=implementation`);
    assert.equal(body.numbers.priced, 0);
    assert.match(body.html, /unknown/);
    assert.doesNotMatch(body.html, /\$0\.00/);
  });
});

describe('GET /api/dispatch/decision-panel: what the panel says about the harness, effort and follow', () => {
  test('a blank harness judges effort by the harness in force: opencode from Models hides effort', async () => {
    const table = emptyTable();
    table.jobs.implementation = { harness: 'opencode' };
    const { body } = await get(buildApp({ table }), `${PANEL}?promptName=implementation&surface=home`);
    assert.match(body.html, /data-harness-in-force="opencode"/);
    assert.match(body.html, /data-decision-effort hidden/);
    assert.ok(body.withoutEffort.includes('opencode'), 'Home\'s summary judges effort by the same list, for the draft\'s harness');
  });

  test('a stored effort outside the set is shown as itself and kept', async () => {
    const { body } = await get(buildApp(), `${PANEL}?promptName=implementation&effort=turbo`);
    assert.match(body.html, /<option value="turbo" selected>turbo<\/option>/);
  });

  test('a blank field says what Settings › Models sets it to for this step', async () => {
    const { body } = await get(buildApp(), `${PANEL}?promptName=implementation&surface=home`);
    assert.match(body.html, /As Settings › Models sets it for this step:/);
  });

  test('the Home panel has no name attributes: it is a client page, and the draft is not a form post', async () => {
    const { body } = await get(buildApp(), `${PANEL}?promptName=implementation`);
    assert.doesNotMatch(body.html, /\sname="/);
    assert.match(body.html, /data-testid="run-harness"/);
    assert.match(body.html, /data-testid="run-model"/);
    assert.match(body.html, /data-testid="run-effort"/);
  });
});

describe('GET /api/dispatch/decision-panel: a store fault is not a false figure', () => {
  test('a failed history read answers the panel with the numbers unavailable, never "no runs"', async () => {
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore: { listHistoryWithBodies: async () => { throw new Error('store down'); } },
      dispatchTokenStore: {},
      workspaceFromUrl: (req, res, next) => { req.workspace = { id: 'ws-1', urlKey: req.params.urlKey, accessToken: 'test-token' }; req.session = { accountId: 'acct-1' }; next(); },
      userPreferencesStore: {},
      harbourFeedbackTokenStore: null,
      workspacePreferencesStore: { getRoutingTable: async () => emptyTable() },
      dispatchPresetsStore: { get: async () => null },
      workspaceOwnerCheck: async () => ({ status: 'owner' })
    }));
    const { status, body } = await get(app, `${PANEL}?promptName=implementation`);
    assert.equal(status, 200);
    assert.equal(body.numbers, null);
    assert.match(body.html, /could not be read just now/);
    assert.doesNotMatch(body.html, /no runs in 30 days/);
  });
});

describe('GET /api/dispatch/decision-panel: refusals', () => {
  test('a non-owner is refused with the preview\'s owner code, not answered', async () => {
    const { status, body } = await get(buildApp({ owner: false }), `${PANEL}?promptName=implementation`);
    assert.equal(status, 403);
    assert.equal(body.code, 'PREVIEW_OWNER_ONLY');
  });
});
