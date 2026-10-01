/**
 * LIN-3098 S4 — the runner setup page, `GET /workspace/:urlKey/runner`
 * (routes/runner-setup.js, lib/render-runner-setup.js).
 *
 * The page is where a workspace owner mints the runner credential from the UI
 * (John's 29 Sep requirement: through "○ set up ›", usable from a phone) and
 * copies the served runner prompt plus the credential in two taps.
 *
 * Pinned here:
 *   - every state renders 200 and never redirects: proxy off, not the owner,
 *     no recorded owner, owner check unavailable, owner with dispatch off,
 *     owner with both on;
 *   - the mint button and `data-account-id` appear in the owner states only;
 *   - the owner state comes from `checkWorkspaceOwner` (NB7), which
 *     canonicalises a merged account, and is never asked when proxy is off;
 *   - the served prompt is on the page (a person without a runner token can
 *     still get it: S3 ledger item 6), escaped;
 *   - the honesty copy, consistent with the S3 prompt;
 *   - no token anywhere in the HTML.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderRunnerSetupPage, RUNNER_SETUP_STATES } from '../../lib/render-runner-setup.js';
import { renderDispatchPage } from '../../lib/render-dispatch.js';
import { createRunnerSetupRoutes } from '../../routes/runner-setup.js';
import { buildRunnerKickoff } from '../../lib/prompts/runner-kickoff.js';
import { RUNNER_BOOTSTRAP_TTL_SECONDS, RUNNER_WORKING_TTL_SECONDS } from '../../lib/proxy-scopes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'https://harbour.example';
const PROMPT = buildRunnerKickoff({ baseUrl: BASE });
const OWNER = 'acct-owner-1';

const render = (state, over = {}) => renderRunnerSetupPage(
  { state, urlKey: 'acme', accountId: OWNER, prompt: PROMPT, baseUrl: BASE, ...over },
  { featureFlags: { proxy: state !== 'proxy-off', dispatch: state !== 'owner-dispatch-off' } }
);

const has = (html, testid) => html.includes(`data-testid="${testid}"`);

describe('the page\'s states', () => {
  test('the state set', () => {
    assert.deepEqual([...RUNNER_SETUP_STATES].sort(), ['no-owner', 'not-owner', 'owner', 'owner-dispatch-off', 'proxy-off', 'unavailable']);
  });

  for (const state of RUNNER_SETUP_STATES) {
    test(`${state}: renders, names its state, carries the url key`, () => {
      const html = render(state);
      assert.match(html, new RegExp(`data-state="${state}"`));
      assert.match(html, /data-url-key="acme"/);
      assert.ok(has(html, 'runner-setup-page'));
    });
  }

  for (const state of ['owner', 'owner-dispatch-off']) {
    test(`${state}: the mint button, the copy target and the owner's account id`, () => {
      const html = render(state);
      assert.ok(has(html, 'runner-setup-mint'));
      assert.ok(has(html, 'runner-setup-copy'));
      assert.ok(has(html, 'runner-setup-output'));
      assert.match(html, new RegExp(`data-account-id="${OWNER}"`));
      assert.match(html, new RegExp(`data-base-url="${BASE}"`));
      assert.match(html, /<textarea[^>]*data-testid="runner-setup-output"[^>]*readonly/);
    });
  }

  for (const state of ['proxy-off', 'not-owner', 'no-owner', 'unavailable']) {
    test(`${state}: a notice, and no mint button or account id`, () => {
      const html = render(state);
      assert.ok(has(html, 'runner-setup-notice'));
      assert.ok(!has(html, 'runner-setup-mint'));
      assert.ok(!has(html, 'runner-setup-copy'));
      assert.doesNotMatch(html, /data-account-id=/);
    });
  }

  test('proxy-off: says so and links to Settings', () => {
    const html = render('proxy-off');
    assert.match(html, /workspace API access/i);
    assert.match(html, /href="\/workspace\/acme\/settings"/);
  });

  test('not-owner: only the owner can set one up', () => {
    assert.match(render('not-owner'), /Only this workspace's owner/);
  });

  test('no-owner and unavailable say what is wrong', () => {
    assert.match(render('no-owner'), /no recorded owner/i);
    assert.match(render('unavailable'), /try again/i);
  });

  test('owner-dispatch-off: the mint works, and it says how to turn on the Dispatch queue for "run this step"', () => {
    const html = render('owner-dispatch-off');
    assert.ok(has(html, 'runner-setup-dispatch-note'));
    assert.match(html, /run this step/);
    assert.match(html, /Dispatch queue/);
    assert.match(html, /href="\/workspace\/acme\/settings"/);
    assert.ok(!has(render('owner'), 'runner-setup-dispatch-note'));
  });

  test('every state shows the served prompt, escaped, in a disclosure', () => {
    for (const state of RUNNER_SETUP_STATES) {
      const html = render(state);
      assert.ok(has(html, 'runner-setup-prompt'), state);
      assert.ok(html.includes('# Harbour runner (Claude Code)'), state);
    }
    const hostile = render('owner', { prompt: '<script>alert(1)</script>' });
    assert.ok(!hostile.includes('<script>alert(1)</script>'));
    assert.ok(hostile.includes('&lt;script&gt;'));
  });

  test('links to the Runner credentials list, where the credential is revoked', () => {
    assert.match(render('owner'), /href="\/workspace\/acme\/proxy#proxy-runner-credentials"/);
  });

  test('the page loads the shared common.js (getRunnerBootstrap) and its own script', () => {
    const html = render('owner');
    assert.match(html, /<script src="\/common\.js"><\/script>/);
    assert.match(html, /<script src="\/runner-setup\.js"><\/script>/);
  });
});

describe('the honesty copy, consistent with the S3 prompt', () => {
  const html = render('owner');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  test('Claude Code only, Node 18+, macOS or Linux', () => {
    assert.match(text, /Claude Code only/);
    assert.match(text, /opencode has no subagents/i);
    assert.match(text, /Node 18\+/);
    assert.match(text, /macOS or Linux/);
  });
  test('laptop sleep and close, with the orphan truth', () => {
    assert.match(text, /laptop sleeps/i);
    assert.match(text, /laptop closes/i);
    assert.match(text, /stay taken/);
    assert.match(text, /30 days/);
    assert.match(text, /re-dispatch/i);
  });
  test('the credential lifetimes: the bootstrap window and the working life, from source', () => {
    assert.match(text, new RegExp(`${RUNNER_BOOTSTRAP_TTL_SECONDS / 3600}h`));
    assert.match(text, new RegExp(`${RUNNER_WORKING_TTL_SECONDS / 3600}h`));
    assert.match(text, /mint again/i);
  });
  test('the owner-only rule, unconditionally', () => {
    assert.match(text, /only items the workspace owner enqueued/i);
    assert.doesNotMatch(text, /before T3[^.]*owner/i);
  });
  test('the same-user boundary, stated plainly', () => {
    assert.match(text, /same OS user/i);
    assert.match(text, /subagents included/i);
    assert.match(text, /credential file/i);
    assert.match(text, /live broker/i);
  });
  test('no token-shaped string in any state', () => {
    for (const state of RUNNER_SETUP_STATES) {
      // The kit's sha256 pins and the shell's own base64 image data URIs are
      // not credentials; anything else token-shaped would be.
      const t = render(state).replace(/[0-9a-f]{64}/g, '').replace(/data:[a-z/+]+;base64,[A-Za-z0-9+/=]+/g, '');
      assert.doesNotMatch(t, /[A-Za-z0-9_-]{40,}/, state);
    }
  });
});

describe('the route', () => {
  function app({ features = { proxy: true, dispatch: true }, accountId = OWNER, ownerCheck, stores } = {}) {
    const calls = [];
    const a = express();
    a.use(createRunnerSetupRoutes({
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { id: 'ws-1', urlKey: req.params.urlKey };
        req.session = { features, accountId, workspaces: [] };
        next();
      },
      getOpenRouterSource: () => null,
      getDeployInfo: () => ({}),
      ...(stores || {}),
      ...(ownerCheck ? { ownerCheck: async (args) => { calls.push(args); return ownerCheck(args); } } : {})
    }));
    return { app: a, calls };
  }

  async function get(a, path = '/workspace/acme/runner') {
    const server = a.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { redirect: 'manual' });
      return { status: res.status, body: await res.text() };
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  const rows = [
    ['proxy off', { features: { proxy: false, dispatch: true } }, () => ({ status: 'owner' }), 'proxy-off'],
    ['owner, both on', {}, () => ({ status: 'owner' }), 'owner'],
    ['owner, dispatch off', { features: { proxy: true, dispatch: false } }, () => ({ status: 'owner' }), 'owner-dispatch-off'],
    ['not the owner', {}, () => ({ status: 'not-owner' }), 'not-owner'],
    ['no recorded owner', {}, () => ({ status: 'no-owner' }), 'no-owner'],
    ['the owner check throws', {}, () => { throw new Error('corrupt merge chain'); }, 'unavailable']
  ];
  for (const [name, over, ownerCheck, want] of rows) {
    test(`${name} → 200, ${want}, never a redirect`, async () => {
      const { app: a } = app({ ...over, ownerCheck });
      const r = await get(a);
      assert.equal(r.status, 200);
      assert.match(r.body, new RegExp(`data-state="${want}"`));
    });
  }

  test('the owner check is asked with this workspace and the session account', async () => {
    const { app: a, calls } = app({ ownerCheck: () => ({ status: 'owner' }) });
    await get(a);
    assert.deepEqual(calls, [{ workspaceId: 'ws-1', accountId: OWNER }]);
  });

  test('proxy off never asks the owner check', async () => {
    const { app: a, calls } = app({ features: { proxy: false }, ownerCheck: () => ({ status: 'owner' }) });
    await get(a);
    assert.equal(calls.length, 0);
  });

  test('NB7: by default it is checkWorkspaceOwner, so a merged-away account resolves to its survivor', async () => {
    const stores = {
      accountWorkspaceStore: { getWorkspaceOwnerAccountId: async (workspaceId) => (workspaceId === 'ws-1' ? 'acct-survivor' : null) },
      accountStore: { resolveCanonicalAccountId: async (id) => (id === 'acct-merged' ? 'acct-survivor' : id) }
    };
    const merged = await get(app({ accountId: 'acct-merged', stores }).app);
    assert.match(merged.body, /data-state="owner"/);
    const stranger = await get(app({ accountId: 'acct-stranger', stores }).app);
    assert.match(stranger.body, /data-state="not-owner"/);
  });

  test('the prompt on the page is built for this request\'s base URL', async () => {
    const r = await get(app({ ownerCheck: () => ({ status: 'owner' }) }).app);
    assert.match(r.body, /http:\/\/127\.0\.0\.1:\d+\/runner-kit\/runner\.mjs/);
  });

  test('routes/runner-setup.js uses checkWorkspaceOwner, not getWorkspaceOwnerAccountId directly (NB7)', () => {
    const src = readFileSync(join(ROOT, 'routes', 'runner-setup.js'), 'utf8');
    assert.match(src, /import \{[^}]*checkWorkspaceOwner[^}]*\} from '\.\.\/lib\/workspace-owner\.js'/);
    assert.doesNotMatch(src, /getWorkspaceOwnerAccountId/);
  });

  test('server.js mounts the setup page', () => {
    const src = readFileSync(join(ROOT, 'server.js'), 'utf8');
    assert.match(src, /app\.use\(createRunnerSetupRoutes\(\{/);
  });
});

describe('the Dispatch page links to the setup page (B2 entry point)', () => {
  test('one line in the Tokens section', () => {
    const html = renderDispatchPage('Acme', { urlKey: 'acme' });
    const tokens = html.slice(html.indexOf('>Tokens<'));
    assert.match(tokens, /Run on your own machine instead: <a [^>]*href="\/workspace\/acme\/runner"[^>]*data-testid="dispatch-runner-setup-link"[^>]*>set up a runner \u203A<\/a>/);
  });
});
