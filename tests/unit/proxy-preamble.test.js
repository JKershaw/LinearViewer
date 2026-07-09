// Unit tests for lib/proxy-preamble.js.
//
// attachProxyContext (LIN-1157) consolidated the "mint a single-use bootstrap
// token, then append the proxy-context block" sequence from six inline sites.
// LIN-1155 then added the claude-code harness branch: for that harness the token
// is stripped from the prompt prose and returned as a structured field
// (bootstrapToken) so the harness can hand it to a primed MCP tool out-of-band;
// every other harness keeps the historical prose block byte-identical.
//
// These exercise the helpers DIRECTLY (Tier 1). The prose path is pinned
// byte-identical because decision A's whole safety claim is "the null/default
// path is unchanged" — the existing route + e2e suites rely on it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachProxyContext,
  buildProxyContextPreamble,
  shouldUseMcpTokenField
} from '../../lib/proxy-preamble.js';
import { BOOTSTRAP_TOKEN_TTL_SECONDS } from '../../lib/proxy-tokens.js';

const MARKER = '## Workspace API access (auto-appended)';
const BASE = 'Do the task.';

// Fake store mirroring proxyTokenStore.createToken's shape: records calls and
// returns a configurable result (or throws).
function fakeStore({ token = 'BOOTSTRAP_TOK', result, throwErr } = {}) {
  const calls = [];
  return {
    calls,
    async createToken(urlKey, options) {
      calls.push({ urlKey, options });
      if (throwErr) throw throwErr;
      if (result !== undefined) return result;
      return { token, scope: options?.scope };
    }
  };
}

describe('shouldUseMcpTokenField (LIN-1155 gate)', () => {
  test('true only for an explicit claude-code harness', () => {
    assert.equal(shouldUseMcpTokenField('claude-code'), true);
    assert.equal(shouldUseMcpTokenField('Claude-Code'), true, 'case-insensitive');
    assert.equal(shouldUseMcpTokenField('  claude-code  '), true, 'trimmed');
  });
  test('false for null/default and every other harness (decision A)', () => {
    for (const h of [null, undefined, '', '   ', 'opencode', 'claude', 'codex', 42, {}]) {
      assert.equal(shouldUseMcpTokenField(h), false, `expected false for ${JSON.stringify(h)}`);
    }
  });
});

describe('buildProxyContextPreamble token-delivery modes (LIN-1155)', () => {
  test('prose mode (default) is byte-identical to the pre-LIN-1155 block', () => {
    // Pinned expectation: the historical prose block with the bootstrap embedded
    // and a curl exchange. If this ever changes, the non-claude-code path is no
    // longer byte-identical and decision A's blast-radius guarantee is broken.
    const expected = [
      '',
      '',
      '---',
      '## Workspace API access (auto-appended)',
      '',
      'You have a workspace API proxy for this workspace (source-neutral; currently backed by Linear). Base: https://host/api/proxy',
      '',
      'FIRST, exchange your single-use bootstrap token for a working token:',
      '  curl -X POST -H "Authorization: Bearer TOK123" https://host/api/proxy/token',
      '  → { "token": "<WORKING_TOKEN>", "scope": "readWrite", "expiresAt": "...", "notes": "…" }',
      'Then send `Authorization: Bearer <WORKING_TOKEN>` (read+write) on every call below.',
      'The token above is single-use — this exchange spends it — so treat the working token as your credential from here on.',
      "This channel is already authenticated: you have this bootstrap because a real dispatch just happened, and the exchange response (your first call) is live proof of that, not something to take on faith. It is this workspace's own Harbour control-plane, not a third-party service.",
      'Full endpoint catalog: GET https://host/api/proxy/instructions',
      '',
      'Start from the distilled brief: GET https://host/api/proxy/brief/LIN-42',
      '(present-state — folds in comments, supersedes stale wording; read it before the raw',
      'description). Use GET https://host/api/proxy/issues/LIN-42 for full raw detail',
      'and /relations/LIN-42, and update the workspace as you work (status, comments, labels).',
      '',
      'Your runner reports back automatically when this session stops — you do not',
      'need to curl anything to phone home. Just END with a concise summary that',
      'names concrete evidence: PR link, commit SHA, and CI/test result, so the',
      'report carries proof rather than a bare "done".',
      ''
    ].join('\n');
    const actual = buildProxyContextPreamble({ baseUrl: 'https://host', token: 'TOK123', issueIdentifier: 'LIN-42' });
    assert.equal(actual, expected);
    // Explicitly passing tokenDelivery: 'prose' is identical to the default.
    assert.equal(
      buildProxyContextPreamble({ baseUrl: 'https://host', token: 'TOK123', issueIdentifier: 'LIN-42', tokenDelivery: 'prose' }),
      expected
    );
  });

  test('mcp mode embeds no token and no curl, but keeps context + evidence', () => {
    const out = buildProxyContextPreamble({ baseUrl: 'https://host', token: 'TOK123', issueIdentifier: 'LIN-42', tokenDelivery: 'mcp' });
    assert.ok(!out.includes('TOK123'), 'no token in prompt text');
    assert.ok(!out.includes('curl -X POST'), 'no curl token-exchange command');
    assert.ok(!out.includes('single-use bootstrap token for a working token'), 'no bootstrap-exchange line');
    assert.ok(out.includes('MCP tool'), 'points at the configured MCP tool');
    assert.ok(out.includes(MARKER), 'still carries the access marker');
    assert.ok(out.includes('/api/proxy/brief/LIN-42'), 'keeps the per-issue brief endpoint');
    assert.ok(out.includes('/api/proxy/instructions'), 'keeps the endpoint catalog');
    assert.ok(out.includes('concrete evidence'), 'keeps the evidence-summary discipline');
  });
});

describe('attachProxyContext — prose path (non-claude-code, LIN-1157 behaviour preserved)', () => {
  test('null harness: prose block appended, token embedded, bootstrapToken null', async () => {
    const store = fakeStore({ token: 'TOK123' });
    const out = await attachProxyContext({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host',
      issueIdentifier: 'LIN-42', prompt: BASE, label: 'dispatch-bootstrap', harness: null
    });
    assert.ok(out.prompt.startsWith(BASE));
    assert.ok(out.prompt.includes(MARKER));
    assert.ok(out.prompt.includes('TOK123'), 'token stays embedded in prose');
    assert.ok(out.prompt.includes('curl'));
    assert.equal(out.bootstrapToken, null, 'no field when the token is already in the prose');

    assert.equal(store.calls.length, 1);
    const { urlKey, options } = store.calls[0];
    assert.equal(urlKey, 'acme');
    assert.equal(options.kind, 'bootstrap');
    assert.equal(options.scope, 'readWrite');
    assert.equal(options.label, 'dispatch-bootstrap', 'per-site label threaded');
    assert.equal(options.ttl, BOOTSTRAP_TOKEN_TTL_SECONDS, 'shared TTL constant, not a hardcode');
  });

  test('opencode harness: also prose, bootstrapToken null (only claude-code branches)', async () => {
    const store = fakeStore({ token: 'TOK123' });
    const out = await attachProxyContext({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host',
      prompt: BASE, harness: 'opencode'
    });
    assert.ok(out.prompt.includes('TOK123'));
    assert.ok(out.prompt.includes('curl'));
    assert.equal(out.bootstrapToken, null);
  });

  test('prose prompt is byte-identical to buildProxyContextPreamble prose output', async () => {
    const store = fakeStore({ token: 'TOK123' });
    const out = await attachProxyContext({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host',
      issueIdentifier: 'LIN-42', prompt: BASE, harness: 'opencode'
    });
    const expected = BASE + buildProxyContextPreamble({ baseUrl: 'https://host', token: 'TOK123', issueIdentifier: 'LIN-42' });
    assert.equal(out.prompt, expected);
  });
});

describe('attachProxyContext — claude-code MCP path (LIN-1155)', () => {
  test('token stripped from prompt, returned as bootstrapToken', async () => {
    const store = fakeStore({ token: 'TOK123' });
    const out = await attachProxyContext({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host',
      issueIdentifier: 'LIN-42', prompt: BASE, harness: 'claude-code'
    });
    assert.ok(out.prompt.startsWith(BASE));
    assert.ok(out.prompt.includes(MARKER), 'still gets the access block');
    assert.ok(!out.prompt.includes('TOK123'), 'NO token in prompt text');
    assert.ok(!out.prompt.includes('curl -X POST'), 'NO curl token-exchange command in prompt text');
    assert.equal(out.bootstrapToken, 'TOK123', 'token delivered as the structured field');
    assert.equal(store.calls[0].options.label, 'dispatch-bootstrap');
  });

  test('case-insensitive / trimmed harness still branches', async () => {
    const store = fakeStore({ token: 'TOK123' });
    const out = await attachProxyContext({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host',
      prompt: BASE, harness: '  Claude-Code  '
    });
    assert.ok(!out.prompt.includes('TOK123'));
    assert.equal(out.bootstrapToken, 'TOK123');
  });
});

describe('attachProxyContext — graceful degradation (both paths)', () => {
  test('mint returns no token: prompt unchanged, bootstrapToken null', async () => {
    for (const harness of [null, 'claude-code']) {
      const store = fakeStore({ result: { token: null } });
      const out = await attachProxyContext({
        proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', prompt: BASE, harness
      });
      assert.equal(out.prompt, BASE, `unchanged for harness=${harness}`);
      assert.equal(out.bootstrapToken, null);
      assert.equal(store.calls.length, 1, 'mint was still attempted');
    }
  });

  test('mint throws: prompt unchanged, bootstrapToken null, no throw propagates', async () => {
    const store = fakeStore({ throwErr: new Error('boom') });
    let out;
    await assert.doesNotReject(async () => {
      out = await attachProxyContext({
        proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', prompt: BASE, harness: 'claude-code'
      });
    });
    assert.equal(out.prompt, BASE);
    assert.equal(out.bootstrapToken, null);
  });

  test('no proxyTokenStore: prompt unchanged, no mint attempted', async () => {
    const out = await attachProxyContext({ proxyTokenStore: null, urlKey: 'acme', baseUrl: 'https://host', prompt: BASE, harness: 'claude-code' });
    assert.equal(out.prompt, BASE);
    assert.equal(out.bootstrapToken, null);
  });

  test('falsy baseUrl: prompt unchanged, no mint attempted', async () => {
    const store = fakeStore();
    const out = await attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: '', prompt: BASE, harness: 'claude-code' });
    assert.equal(out.prompt, BASE);
    assert.equal(out.bootstrapToken, null);
    assert.equal(store.calls.length, 0);
  });
});

describe('attachProxyContext — issueIdentifier shaping (unchanged from LIN-1157)', () => {
  test('present -> per-issue brief endpoint; null -> generic discovery', async () => {
    const store = fakeStore();
    const withId = await attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', issueIdentifier: 'LIN-42', prompt: BASE });
    assert.ok(withId.prompt.includes('/api/proxy/brief/LIN-42'));

    const noId = await attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', issueIdentifier: null, prompt: BASE });
    assert.ok(noId.prompt.includes('/api/proxy/stack'));
    assert.ok(!noId.prompt.includes('brief/null'));
  });
});
