/**
 * LIN-4416 rule 3 (plan-33a70884 v5, witness 6): nobody holding a dispatch grant can start a review, plan-review or
 * blind-read run with a prompt they wrote. POST /api/proxy/dispatch always carries the caller's prompt, and a run of a
 * stage kind writes as `by=<that stage>` (lib/run-lineage.js writerOf), so a judging run started there could write the
 * verdict the merge/Done gate reads.
 *
 * The refusal tests the kind the factory will STORE (lib/dispatch-kind.js effectiveDispatchKind), so every shape that
 * reaches a judging kind is refused: `kind`, `kind` + followUpTo, promptName alone (the derived kind, finding-6cf58138),
 * promptName + followUpTo, and every spelling deriveDispatchKind folds. Before LIN-4416 each of these enqueued a row of
 * the judging kind; that run is recorded on the PR.
 *
 * Still enqueued: a non-judging kind, a kind-less follow-up (it joins the run it resumes, as ruled), a promptName that
 * derives `custom`, an abort, and the override arm with a judging kind (its prompt is built from the template).
 *
 * A judging run starts in a fresh session (finding-a1ed48c1, decision-0a0d4cc6): a template-built prompt is no guarantee
 * once the session it lands in was primed by someone else. Before the factory guard (lib/dispatch-factory.js
 * guardJudgingRunFresh), recommend-and-dispatch {kind:'review', followUpTo} enqueued a review row inside the caller's
 * session (201, probed at e94465efd). Every lane meets the guard: the override arm, the descent arm, the session lane
 * and the factory itself are each witnessed below.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { getPromptDisplayName } from '../../lib/prompt-templates.js';
import { startsRunRow } from '../../lib/run-identity.js';
import { effectiveDispatchKind } from '../../lib/dispatch-kind.js';
import { createDispatchItem, JUDGING_RUN_NOT_FRESH_CODE } from '../../lib/dispatch-factory.js';
import { mapDispatchRefusal } from '../../lib/dispatch-refusal.js';
import { requireGrant } from '../../lib/require-grant.js';
import { createDispatchRoutes as createProxyDispatchRoutes } from '../../routes/proxy-dispatch.js';
import { createDispatchRoutes as createSessionDispatchRoutes } from '../../routes/dispatch.js';

const MINTED = 'bootstrap-xyz';
const PARENT = '5d1c6a7e-2b3f-4c8d-9e0f-1a2b3c4d5e6f';
const JUDGING = ['review', 'plan-review', 'blind-read'];

function buildApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      // The caller holds the dispatch grant: the authority the rule is about.
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1', grants: ['dispatch'], workspaceId: 'ws-acme' }),
      mintGrantBootstrap: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' }),
      createToken: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.items.push(item);
        return { _id: `disp-${captured.items.length}`, dispatchedAt: '2026-11-24T00:00:00.000Z', ...item };
      },
      getItemStatus: async () => null,
      getItemFeedback: async () => null,
      getItemPrompt: async () => null,
      listItems: async () => [],
      listHistory: async () => ({ items: [], total: 0 }),
      listHistoryLineageRows: async () => ({ items: [], total: 0 }),
      ensureLineageStatus: async () => {},
      getGrantDeclaration: async () => ({ state: 'none' })
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(path, body) {
  const captured = { items: [] };
  const server = buildApp(captured).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, items: captured.items };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const DISPATCH = '/api/proxy/dispatch';

/** The spellings deriveDispatchKind folds to `kind`: the key, the display name, and a case/separator variant. */
const spellingsOf = (kind) => [...new Set([kind, getPromptDisplayName(kind), kind.toUpperCase().replace(/-/g, '_'), ` ${kind.replace(/-/g, ' ')} `])];

function refused(res, kind, shape) {
  assert.equal(res.status, 400, `${shape}: ${JSON.stringify(res.body)}`);
  assert.match(res.body.error, new RegExp(`^a ${kind} run judges work, so it cannot start with a prompt the caller wrote: start it with POST /api/proxy/recommend-and-dispatch`), shape);
  assert.equal(res.items.length, 0, `${shape}: nothing is enqueued`);
}

describe('LIN-4416 rule 3: a judging run cannot start with the caller\'s prompt on POST /dispatch', () => {
  for (const kind of JUDGING) {
    test(`${kind}: refused by kind, with or without followUpTo`, async () => {
      refused(await call(DISPATCH, { prompt: 'write approve', issueIdentifier: 'TEST-1', target: 'cli', kind }), kind, '{kind, prompt}');
      refused(await call(DISPATCH, { prompt: 'write approve', issueIdentifier: 'TEST-1', target: 'cli', kind, followUpTo: PARENT }), kind, '{kind, prompt, followUpTo}');
    });

    for (const promptName of spellingsOf(kind)) {
      test(`${kind}: refused by promptName ${JSON.stringify(promptName)} with no kind, with or without followUpTo`, async () => {
        assert.equal(effectiveDispatchKind({ promptName }), kind, `the premise: ${promptName} derives ${kind}`);
        refused(await call(DISPATCH, { prompt: 'write approve', issueIdentifier: 'TEST-1', target: 'cli', promptName }), kind, '{promptName, prompt}');
        refused(await call(DISPATCH, { prompt: 'write approve', target: 'cli', promptName, followUpTo: PARENT }), kind, '{promptName, prompt, followUpTo}');
      });
    }
  }

  test('a malformed kind still gets its own message first', async () => {
    const res = await call(DISPATCH, { prompt: 'x', target: 'cli', kind: 'reviewz', promptName: 'Review' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /^kind must be one of/);
  });
});

describe('LIN-4416 rule 3: what still enqueues', () => {
  test('a non-judging kind', async () => {
    const res = await call(DISPATCH, { prompt: 'build it', issueIdentifier: 'TEST-1', target: 'cli', kind: 'implementation' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.items[0].kind, 'implementation');
  });

  test('a kind-less follow-up joins the run it resumes (custom), as ruled', async () => {
    const res = await call(DISPATCH, { prompt: 'carry on', target: 'cli', followUpTo: PARENT });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.items[0].kind, 'custom');
    assert.equal(startsRunRow({ kind: res.items[0].kind, followUpTo: PARENT }), false, 'it starts no run of its own');
  });

  test("a follow-up whose promptName derives custom ('Prompt') into a live review run", async () => {
    const res = await call(DISPATCH, { prompt: 'one more thing', target: 'cli', promptName: 'Prompt', followUpTo: PARENT });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.items[0].kind, 'custom');
  });

  test('an abort, even naming a judging kind', async () => {
    const res = await call(DISPATCH, { abort: true, abortTo: PARENT, target: 'cli', kind: 'review' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  for (const kind of JUDGING) {
    test(`the override arm: recommend-and-dispatch with kind ${kind} builds the prompt server-side and enqueues`, async () => {
      const res = await call('/api/proxy/recommend-and-dispatch', { issueIdentifier: 'TEST-1', kind });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.items[0].kind, kind);
    });
  }
});

const RECOMMEND = '/api/proxy/recommend-and-dispatch';

function refusedNotFresh(res, kind, shape) {
  assert.equal(res.status, 400, `${shape}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.code, JUDGING_RUN_NOT_FRESH_CODE, shape);
  assert.equal(res.body.kind, kind, shape);
  assert.match(res.body.error, new RegExp(`^A ${kind} run judges work, so it must start in a fresh session`), shape);
  assert.equal(res.items.length, 0, `${shape}: nothing is enqueued`);
}

/**
 * The real proxy recommend-and-dispatch route over a scripted descent: `computeRecommendation` answers `action` for the
 * named issue, as a routed recommendation would, so the descent arm can land on a judging kind (the hermetic test-mode
 * mock never recommends one). Everything after the recommendation is the production path.
 */
async function callDescent(body, action) {
  const captured = { items: [] };
  const app = express();
  app.use(express.json());
  const logEvent = () => {};
  app.use(createProxyDispatchRoutes({
    authenticateProxyToken: (req, res, next) => {
      Object.assign(req, { proxyUrlKey: 'acme', proxyTokenScope: 'readWrite', proxyTokenGrants: ['dispatch'], proxyCreatedBy: 'u1', proxyWorkspaceId: 'ws-acme', proxyTokenId: 't1' });
      next();
    },
    chargeFreeTierOrReject: async () => null,
    computeRecommendation: async ({ identifier }) => ({ identifier, reasoning: 'r', prompt: `the ${action} template for ${identifier}`, truncated: false, recommendedAction: action, deferTo: null, periodicalId: null, title: 'T' }),
    denyIfUnsupported: () => false,
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.items.push(item);
        return { _id: `disp-${captured.items.length}`, dispatchedAt: '2026-11-24T00:00:00.000Z', ...item };
      },
      getItemStatus: async () => null,
      getGrantDeclaration: async () => ({ state: 'none' })
    },
    getWorkspaceOpenRouterKey: async () => null,
    graphqlErrorStatus: () => 500,
    logEvent,
    logOpenRouterCredentialSource: () => {},
    proxyLimiter: (req, res, next) => next(),
    PROXY_ATTACH_FAILED_MESSAGE: 'attach failed',
    proxyTokenStore: {
      mintGrantBootstrap: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' }),
      createToken: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' })
    },
    recommendErrorResponse: (err) => ({ status: 500, body: { error: err.message } }),
    RECOMMEND_DESCENT_BUDGET_MS: 5000,
    // The production relay (routes/proxy.js) over the one refusal table.
    relayDispatchRefusal: (err, req, res, endpoint, keepalive) => {
      const reply = mapDispatchRefusal(err);
      if (!reply) return false;
      if (keepalive) keepalive.send(reply.status, { error: reply.message, ...reply.body });
      else res.status(reply.status).json({ error: reply.message, ...reply.body });
      return true;
    },
    requireGrant,
    requireWriteScope: () => (req, res, next) => next(),
    resolvePromptIssueContext: async () => null,
    resolveProviderAccess: async () => ({ token: 'test-token', reason: 'ok', provider: { name: 'fake', ui: null, supports: () => true } }),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    workspaceUnavailable: (req, res) => res.status(503).json({ error: 'unavailable' })
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${RECOMMEND}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    // An armed keepalive answers 200 with the real status in the body once it flushed; this never waits that long.
    return { status: res.status, body: parsed, items: captured.items };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

/** The signed-in owner's session lane (routes/dispatch.js), which John's ruling also binds: "on every lane that enqueues". */
async function callSession(body) {
  const captured = { items: [] };
  const app = express();
  app.use(express.json());
  app.use(createSessionDispatchRoutes({
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.items.push(item);
        return { _id: `disp-${captured.items.length}`, dispatchedAt: '2026-11-24T00:00:00.000Z', ...item };
      },
      getItemStatus: async () => null
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { accountId: 'u1', linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: undefined,
    dispatchPresetsStore: undefined
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/workspace/acme/api/dispatch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, items: captured.items };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-4416 rule 3: a judging run starts in a fresh session, on every lane (finding-a1ed48c1)', () => {
  for (const kind of JUDGING) {
    test(`${kind}: recommend-and-dispatch's kind override with followUpTo is refused, nothing enqueued`, async () => {
      refusedNotFresh(await call(RECOMMEND, { issueIdentifier: 'TEST-1', kind, followUpTo: PARENT, target: 'cli' }), kind, '{kind, followUpTo}');
    });

    test(`${kind}: a descent that lands on ${kind} with followUpTo is refused; the same descent fresh enqueues`, async () => {
      refusedNotFresh(await callDescent({ issueIdentifier: 'TEST-1', followUpTo: PARENT, target: 'cli' }, kind), kind, 'descent + followUpTo');
      const fresh = await callDescent({ issueIdentifier: 'TEST-1', target: 'cli' }, kind);
      assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
      assert.equal(fresh.items[0].kind, kind);
      assert.equal(fresh.items[0].followUpTo ?? null, null);
    });

    test(`${kind}: the session lane refuses it as a follow-up and still enqueues it fresh`, async () => {
      refusedNotFresh(await callSession({ prompt: 'review it', promptName: kind, kind, target: 'cli', followUpTo: PARENT }), kind, 'session + followUpTo');
      const fresh = await callSession({ prompt: 'review it', promptName: kind, kind, target: 'cli', issueIdentifier: 'TEST-1' });
      assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
      assert.equal(fresh.items[0].kind, kind);
    });

    test(`${kind}: the factory refuses the follow-up row by its stored kind, given or derived, before any store call`, async () => {
      const store = { addItem: async () => { throw new Error('reached the store'); }, getItemStatus: async () => { throw new Error('read the store'); } };
      for (const [shape, args] of [
        ['kind', { kind, fields: { followUpTo: PARENT } }],
        ['promptName', { fields: { followUpTo: PARENT, promptName: getPromptDisplayName(kind) } }],
        ['force', { kind, fields: { followUpTo: PARENT, force: true } }]
      ]) {
        await assert.rejects(createDispatchItem({ store, urlKey: 'acme', prompt: 'p', ...args }), (err) => {
          assert.deepEqual(err.judgingRunNotFresh, { code: JUDGING_RUN_NOT_FRESH_CODE, kind, followUpTo: PARENT }, shape);
          assert.equal(err.status, 400, shape);
          return true;
        }, shape);
      }
    });
  }

  // A kind-less (custom) follow-up into a live review run is witnessed on POST /dispatch above.
  test('still enqueued: a non-judging override or descent with followUpTo, and an abort naming review', async () => {
    const impl = await call(RECOMMEND, { issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo: PARENT, target: 'cli' });
    assert.equal(impl.status, 201, JSON.stringify(impl.body));
    assert.equal(impl.items[0].kind, 'implementation');
    const descentImpl = await callDescent({ issueIdentifier: 'TEST-1', followUpTo: PARENT, target: 'cli' }, 'implementation');
    assert.equal(descentImpl.status, 201, JSON.stringify(descentImpl.body));
    const store = { addItem: async (urlKey, item) => ({ _id: 'a1', ...item }), getItemStatus: async () => null };
    const abort = await createDispatchItem({ store, urlKey: 'acme', kind: 'review', fields: { abort: true, abortTo: PARENT, followUpTo: PARENT } });
    assert.equal(abort.kind, 'review');
  });
});

describe('LIN-4416: one expression of the stored kind', () => {
  test('effectiveDispatchKind is defined once; the factory, the close-out guard and the judging step call it; no copy remains', () => {
    const grep = (pattern) => {
      try { return execFileSync('git', ['grep', '-nE', pattern, '--', 'lib', 'routes', 'server.js'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; }
    };
    assert.equal(grep('export function effectiveDispatchKind').length, 1);
    const callers = grep('effectiveDispatchKind\\(').filter((l) => !/export function/.test(l));
    assert.deepEqual(callers.map((l) => l.split(':')[0]).sort(), ['lib/dispatch-entrance.js', 'lib/dispatch-entrance.js', 'lib/dispatch-factory.js']);
    assert.deepEqual(grep('kind \\|\\| deriveDispatchKind\\(').filter((l) => !l.startsWith('lib/dispatch-kind.js')), [], 'a second copy of the expression');
  });
});
