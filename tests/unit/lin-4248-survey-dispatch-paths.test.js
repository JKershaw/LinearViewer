/**
 * LIN-4248 — every dispatch entry path gives the two Survey kinds the read-only
 * preamble. The witness is at the production wire: lib/dispatch-entrance.js
 * finalizePrompt -> attachProxyContext({ writes: PROMPT_TEMPLATES[resolvedKind].writes })
 * (LIN-4253; LIN-4248 passed `kind: resolvedKind`). Without that the preamble falls
 * back to the generic text, which tells the worker to
 * "open PRs" and to end with a "PR link" — wrong for a stage that must change
 * nothing.
 *
 * Paths (observed at the addItem seam):
 *   (a) POST /api/proxy/dispatch with an explicit `kind`
 *   (b) POST /api/proxy/dispatch with `promptName: <kind>` and no `kind` (derived kind)
 *   (c) POST /api/proxy/recommend-and-dispatch with `kind` (the override arm)
 * Control: kind 'implementation' still carries the PR wording.
 *
 * Set NODE_ENV before importing routes so the test-mode short-circuit applies.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { PROMPT_TEMPLATES } from '../../lib/prompt-templates.js';
import { WRITES } from '../../lib/stage-writes.js';

const MARKER = '## Workspace API access (auto-appended)';
const MINTED = 'bootstrap-xyz';

// `dispatchDefaults` drives resolveDispatchDefaults; use it to prove the harness
// RESOLVED from workspace defaults (not just the body param) reaches the append
// after the hoist (reorder-correctness).
function buildApp(captured, { workspaceHarnessDefault = null, itemForWatch = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
      // fixture:LIN-3136: the writer holds the dispatch grant (overrides the stub above)
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1', grants: ['dispatch'], workspaceId: 'ws-acme' }),
      // /fixture:LIN-3136
      // fixture:LIN-3136: the declared (M1) mint, mirroring createToken
      mintGrantBootstrap: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' }),
      // /fixture:LIN-3136
      createToken: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item };
      },
      getItemStatus: async () => itemForWatch,
      getItemFeedback: async () => itemForWatch,
      getItemPrompt: async () => itemForWatch,
      listItems: async () => (itemForWatch ? [itemForWatch] : []),
      listHistory: async () => ({ items: [], total: 0 }),
      listHistoryLineageRows: async () => ({ items: [], total: 0 }),
      ensureLineageStatus: async () => {},
      // The resume helper's lookup (LIN-3134): no declared record, so a follow-up takes the plain path.
      getGrantDeclaration: async () => ({ state: 'none' })
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {
      getWorkspacePreferences: async () => (workspaceHarnessDefault ? { dispatchDefaults: { harness: workspaceHarnessDefault } } : {})
    },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}


const PR_WORDING = /open PRs|PR link|commit SHA/;
// LIN-4253 / LIN-4251: every kind whose template declares a write mode other than `work` (the Surveys,
// context, look-into, retro, triage), found from the templates, not a literal list.
const NON_WORK_KINDS = Object.keys(PROMPT_TEMPLATES).filter(kind => PROMPT_TEMPLATES[kind].writes !== WRITES.WORK);

function assertNoPrWording(item, where) {
  assert.ok(item, `${where}: an item was dispatched`);
  assert.ok(item.prompt.includes(MARKER), `${where}: still gets the access block`);
  assert.doesNotMatch(item.prompt, PR_WORDING, `${where}: no PR wording in a non-work dispatch`);
}

describe('LIN-4248 / LIN-4251 — every non-work stage gets its own preamble on every entry path', () => {
  for (const kind of NON_WORK_KINDS) {
    test(`${kind}: POST /dispatch with an explicit kind`, async () => {
      const captured = {};
      const res = await call(buildApp(captured), 'post', '/api/proxy/dispatch', {
        prompt: 'survey it', issueIdentifier: 'TEST-1', kind
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assertNoPrWording(captured.item,`${kind} (a)`);
    });

    test(`${kind}: POST /dispatch with promptName and no kind (derived kind)`, async () => {
      const captured = {};
      const res = await call(buildApp(captured), 'post', '/api/proxy/dispatch', {
        prompt: 'survey it', issueIdentifier: 'TEST-1', promptName: kind
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assertNoPrWording(captured.item,`${kind} (b)`);
    });

    test(`${kind}: POST /recommend-and-dispatch with kind`, async () => {
      const captured = {};
      const res = await call(buildApp(captured), 'post', '/api/proxy/recommend-and-dispatch', {
        issueIdentifier: 'TEST-1', kind
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assertNoPrWording(captured.item,`${kind} (c)`);
    });
  }

  test('control: kind implementation still carries the PR wording', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', '/api/proxy/dispatch', {
      prompt: 'build it', issueIdentifier: 'TEST-1', kind: 'implementation'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item.prompt.includes(MARKER));
    assert.match(captured.item.prompt, PR_WORDING, 'non-Survey kinds keep the PR lines');
  });
});

// LIN-4251: a follow-up resumes a parent's session and carries its own stage's preamble
// (dispatch-entrance's follow-up arm passes `writes` to the resume helper's attach).
const PARENT = '5d1c6a7e-2b3f-4c8d-9e0f-1a2b3c4d5e6f';
// The opening of each non-work value's closing sentence, as the block states it.
const CLOSING_OPENER = {
  none: 'Just END with your findings',
  'one-comment': 'Just END with the link to the one comment',
  'blind-comment': 'Just END with the link to the one comment',
  'ticket-fields': 'Just END with each field change',
};

describe('LIN-4251 — a follow-up gets the block of the stage it names, through the resume arm', () => {
  for (const kind of NON_WORK_KINDS) {
    test(`follow-up naming ${kind}: its own closing, no PR wording`, async () => {
      const writes = PROMPT_TEMPLATES[kind].writes;
      assert.ok(CLOSING_OPENER[writes], `${writes} has a closing opener in this witness`);
      const captured = {};
      const res = await call(buildApp(captured), 'post', '/api/proxy/dispatch', {
        prompt: 'carry on', issueIdentifier: 'TEST-1', kind, followUpTo: PARENT, appendProxyContext: true
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assertNoPrWording(captured.item, `${kind} follow-up`);
      assert.ok(captured.item.prompt.includes(CLOSING_OPENER[writes]), `${kind} follow-up carries its closing`);
    });
  }

  test('a kind-less follow-up is the work stage: the PR block is kept', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', '/api/proxy/dispatch', {
      prompt: 'carry on', issueIdentifier: 'TEST-1', followUpTo: PARENT, appendProxyContext: true
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item.prompt.includes(MARKER));
    assert.match(captured.item.prompt, PR_WORDING, 'no stage named, so the work block');
  });
});
