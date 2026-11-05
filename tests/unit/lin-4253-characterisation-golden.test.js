/**
 * LIN-4253 characterisation golden (SCAFFOLD: removed by the last commit of this ticket).
 *
 * Pins what every kind's dispatch looks like before the trait refactor, so the refactor
 * is proven byte-identical rather than asserted. For every PROMPT_TEMPLATES key it records
 * a sha256 of:
 *   - generatePrompt(kind) under a fixed fixture (the stage's rendered prompt);
 *   - the four production dispatch arms, through the real routes (lib/dispatch-entrance.js
 *     -> attachProxyContext -> buildProxyContextPreamble):
 *       a  POST /dispatch with an explicit `kind`                 (prose harness)
 *       b  POST /dispatch with `promptName` and no `kind`         (prose harness)
 *       c  POST /recommend-and-dispatch with `kind` (override)    (prose harness)
 *       m  POST /dispatch with `kind` on the claude-code (MCP) harness
 *   - the resume helper's plain attach (a follow-up with no recorded grant declaration);
 * plus formatStageOptions(), the selectable stage keys, the excluded set, and the router's
 * refusal (rejectExcludedKind) for every kind and for `defer`.
 *
 * The fixture is tests/fixtures/lin-4253-golden.json. Regenerate it only at the base, with
 * LIN_4253_WRITE_GOLDEN=1; a mismatch names the key that moved.
 */
process.env.NODE_ENV = 'test';
// Pin the origin the prompts embed: publicOrigin() otherwise reads the ephemeral test port.
process.env.PUBLIC_ORIGIN = 'https://golden.harbour.test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import {
  PROMPT_TEMPLATES, generatePrompt, formatStageOptions, getSelectableStages, EXCLUDED_FROM_AI_RECOMMENDATION
} from '../../lib/prompt-templates.js';
import { rejectExcludedKind } from '../../lib/action-kind.js';
import { provisionResumeCredential } from '../../lib/proxy-preamble.js';

const GOLDEN_PATH = new URL('../fixtures/lin-4253-golden.json', import.meta.url);
const MCP_MARKER = 'HARBOUR_LOCAL_BASE';
const MINTED = 'bootstrap-xyz';

const FIXTURE_ISSUE = {
  id: 'LIN-0000',
  identifier: 'LIN-0000',
  title: 'Representative leaf task for the LIN-4253 golden',
  description: 'A short fixed description used only to pin rendered dispatch output.',
  url: 'https://linear.app/example/issue/LIN-0000',
  state: { name: 'In Progress', type: 'started' },
  labels: ['plan'],
  assignee: { name: 'Fixture' },
  estimate: 3,
  createdAt: '2026-01-01T00:00:00.000Z'
};

const FIXTURE_CONTEXT = {
  parent: null,
  siblings: [],
  project: { name: 'Fixture Project', description: 'A fixed project used only for the LIN-4253 golden.' },
  children: [],
  comments: []
};

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

function buildApp({ captured, workspaceHarnessDefault = null }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1', grants: ['dispatch'], workspaceId: 'ws-acme' }),
      mintGrantBootstrap: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' }),
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
      getItemStatus: async () => null,
      getItemFeedback: async () => null,
      getItemPrompt: async () => null,
      listItems: async () => [],
      listHistory: async () => ({ items: [], total: 0 }),
      listHistoryLineageRows: async () => ({ items: [], total: 0 }),
      ensureLineageStatus: async () => {}
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

/** One dispatch arm: the status, the prompt's hash and the item's field names. */
async function dispatchArm(app, captured, method, path, body) {
  const res = await call(app, method, path, body);
  if (!captured.item) return `status=${res.status} no-item`;
  const keys = sha(Object.keys(captured.item).sort().join(','));
  return `status=${res.status} prompt=${sha(captured.item.prompt)} len=${captured.item.prompt.length} fields=${keys}`;
}

/** Everything the golden pins, as a flat key -> string map. */
export async function observe() {
  const out = {};
  const kinds = Object.keys(PROMPT_TEMPLATES);

  out['format:stage-options'] = sha(formatStageOptions());
  out['selectable:keys'] = getSelectableStages().map(s => s.key).join(',');
  out['excluded:order'] = [...EXCLUDED_FROM_AI_RECOMMENDATION].join(',');

  for (const kind of kinds) {
    const generated = generatePrompt(kind, FIXTURE_ISSUE, FIXTURE_CONTEXT);
    out[`generate:${kind}`] = generated ? `${generated.name} ${sha(generated.prompt)} len=${generated.prompt.length}` : 'null';

    try {
      rejectExcludedKind(PROMPT_TEMPLATES[kind].name);
      out[`refuse:${kind}`] = 'allowed';
    } catch (err) {
      out[`refuse:${kind}`] = `refused: ${err.message}`;
    }
  }
  for (const name of ['defer', 'custom']) {
    try {
      rejectExcludedKind(name);
      out[`refuse:${name}`] = 'allowed';
    } catch (err) {
      out[`refuse:${name}`] = `refused: ${err.message}`;
    }
  }

  for (const kind of kinds) {
    const name = PROMPT_TEMPLATES[kind].name;

    // Prose arms: the workspace default is opencode, so the bootstrap is embedded inline.
    const arms = [
      ['a', { workspaceHarnessDefault: 'opencode' }, 'post', '/api/proxy/dispatch', { prompt: 'golden prompt', issueIdentifier: 'TEST-1', kind }],
      ['b', { workspaceHarnessDefault: 'opencode' }, 'post', '/api/proxy/dispatch', { prompt: 'golden prompt', issueIdentifier: 'TEST-1', promptName: name }],
      ['c', { workspaceHarnessDefault: 'opencode' }, 'post', '/api/proxy/recommend-and-dispatch', { issueIdentifier: 'TEST-1', kind }],
      // MCP arm: the claude-code harness, reached through $HARBOUR_LOCAL_BASE with no token in the text.
      ['m', { workspaceHarnessDefault: 'claude-code' }, 'post', '/api/proxy/dispatch', { prompt: 'golden prompt', issueIdentifier: 'TEST-1', kind }]
    ];
    for (const [arm, opts, method, path, body] of arms) {
      const captured = {};
      out[`${arm}:${kind}`] = await dispatchArm(buildApp({ captured, ...opts }), captured, method, path, body);
      out[`${arm}-mcp:${kind}`] = captured.item ? String(captured.item.prompt.includes(MCP_MARKER)) : 'no-item';
    }
  }

  // The follow-up's plain attach: no recorded grant declaration, so the resume helper attaches
  // the block with no dispatch kind. Pinned on both harness shapes.
  const store = {
    createToken: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' }),
    mintGrantBootstrap: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' })
  };
  for (const harness of ['opencode', 'claude-code']) {
    const resumed = await provisionResumeCredential({
      proxyTokenStore: store,
      dispatchStore: null,
      urlKey: 'acme',
      baseUrl: 'https://host.test',
      harness,
      followUpTo: null,
      createdBy: 'u1',
      prompt: 'follow up',
      mint: true,
      grantDeclaration: null,
      attach: { issueIdentifier: 'TEST-1', prompt: 'follow up', providerDisplayName: 'Linear', providerUi: null }
    });
    out[`resume:${harness}`] = `${sha(resumed.prompt)} len=${resumed.prompt.length}`;
  }

  return out;
}

describe('LIN-4253 characterisation golden (scaffold)', () => {
  test('every kind renders, dispatches and is refused exactly as at the base', async () => {
    const observed = await observe();
    if (process.env.LIN_4253_WRITE_GOLDEN === '1' || !existsSync(GOLDEN_PATH)) {
      writeFileSync(GOLDEN_PATH, JSON.stringify(observed, null, 2) + '\n');
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
    const moved = [];
    for (const key of new Set([...Object.keys(golden), ...Object.keys(observed)])) {
      if (golden[key] !== observed[key]) moved.push(`${key}: golden ${JSON.stringify(golden[key])} != observed ${JSON.stringify(observed[key])}`);
    }
    assert.deepEqual(moved, [], `${moved.length} golden key(s) moved:\n${moved.join('\n')}`);
  });
});
