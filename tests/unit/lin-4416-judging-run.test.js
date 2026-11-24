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
