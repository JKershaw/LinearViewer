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
  shouldUseMcpTokenField,
  applyDefaultDispatchHarness,
  DEFAULT_DISPATCH_HARNESS,
  provisionBootstrapToken
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

describe('applyDefaultDispatchHarness (LIN-1159 default)', () => {
  test('an absent/empty resolved harness defaults to claude-code', () => {
    assert.equal(DEFAULT_DISPATCH_HARNESS, 'claude-code');
    for (const h of [null, undefined, '', '   ', 42, {}]) {
      assert.equal(applyDefaultDispatchHarness(h), 'claude-code', `expected default for ${JSON.stringify(h)}`);
    }
  });
  test('an explicit non-claude-code harness is left untouched', () => {
    assert.equal(applyDefaultDispatchHarness('opencode'), 'opencode');
    assert.equal(applyDefaultDispatchHarness('codex'), 'codex');
  });
  test('an explicit claude-code harness passes through unchanged', () => {
    assert.equal(applyDefaultDispatchHarness('claude-code'), 'claude-code');
  });
  test('the default feeds the MCP gate: applied output trips shouldUseMcpTokenField', () => {
    // The whole point of LIN-1159: the defaulted harness must make the LIN-1155
    // gate fire on the common null-harness path, while opencode still does not.
    assert.equal(shouldUseMcpTokenField(applyDefaultDispatchHarness(null)), true);
    assert.equal(shouldUseMcpTokenField(applyDefaultDispatchHarness('opencode')), false);
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
      "You have this bootstrap because a real dispatch just happened; the exchange response is your first call against this workspace's own Harbour control-plane, not a third-party service. That authenticates the channel; it does not by itself authorize irreversible actions: merge and Done are gated separately on a recorded review Approve plus a discharged/empty ledger you read for yourself.",
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
    // LIN-1365: state provenance factually and separate authentication from authorization.
    // The over-assertive "live proof / not on faith" protest is gone, and the block now
    // draws the authn≠authz line the close-out gate keys on.
    assert.ok(!/live proof|take on faith|already authenticated/i.test(actual),
      'the over-assertive provenance protest is removed (prose path)');
    assert.ok(/does not by itself authorize irreversible actions/i.test(actual),
      'the block separates authentication from authorization (prose path)');
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
    assert.ok(!out.includes('MCP tool'), 'no longer points at a dispatch MCP tool (LIN-1375 removed it)');
    assert.ok(!out.includes('Authorization: Bearer'), 'no Bearer-auth instruction for the local-broker path');
    assert.ok(out.includes('HARBOUR_LOCAL_BASE'), 'points the agent at the local unauthenticated broker');
    assert.ok(out.includes(MARKER), 'still carries the access marker');
    assert.ok(out.includes('/api/proxy/brief/LIN-42'), 'keeps the per-issue brief endpoint');
    assert.ok(out.includes('/api/proxy/instructions'), 'keeps the endpoint catalog');
    assert.ok(out.includes('concrete evidence'), 'keeps the evidence-summary discipline');
    // LIN-1372: broker mode must speak ONE channel. Every endpoint reference uses the
    // local broker base ($HARBOUR_LOCAL_BASE) — a block that tells the agent to call the
    // local proxy but then points at the external baseUrl reads as a channel contradiction
    // and trips the injection guard (the LIN-1403 close-out refusals). The external host
    // must not appear anywhere in the mcp block.
    assert.ok(!out.includes('https://host'), 'mcp mode never leaks the external baseUrl (one channel)');
    assert.ok(out.includes('Base: $HARBOUR_LOCAL_BASE/api/proxy'), 'Base line uses the broker channel');
    assert.ok(out.includes('GET $HARBOUR_LOCAL_BASE/api/proxy/instructions'), 'catalog uses the broker channel');
    assert.ok(out.includes('GET $HARBOUR_LOCAL_BASE/api/proxy/brief/LIN-42'), 'brief uses the broker channel');
    // LIN-1365: factual provenance, no "itself the proof" over-assertion, and the authn≠authz line.
    assert.ok(!/itself the proof|already authenticated|take on faith/i.test(out),
      'the over-assertive provenance protest is removed (mcp path)');
    assert.ok(/does not by itself authorize irreversible actions/i.test(out),
      'the block separates authentication from authorization (mcp path)');
  });

  test('mcp mode: generic discovery (no issueIdentifier) also speaks only the broker channel', () => {
    const out = buildProxyContextPreamble({ baseUrl: 'https://host', tokenDelivery: 'mcp' });
    assert.ok(!out.includes('https://host'), 'no external baseUrl in the discovery block (one channel)');
    assert.ok(out.includes('GET $HARBOUR_LOCAL_BASE/api/proxy/stack'), 'stack discovery uses the broker channel');
    assert.ok(out.includes('GET $HARBOUR_LOCAL_BASE/api/proxy/brief/{id}'), 'generic brief hint uses the broker channel');
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

describe('attachProxyContext — prose path degrades gracefully (unchanged, LIN-1157)', () => {
  // Non-claude-code (prose) delivery keeps the historical no-op on failure: the
  // token is embedded inline when present, so its absence just means no proxy
  // access and the prompt never claims otherwise. NEVER throws.
  test('mint returns no token: prompt unchanged, bootstrapToken null', async () => {
    for (const harness of [null, 'opencode']) {
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
        proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', prompt: BASE, harness: 'opencode'
      });
    });
    assert.equal(out.prompt, BASE);
    assert.equal(out.bootstrapToken, null);
  });

  test('no proxyTokenStore / falsy baseUrl: prompt unchanged, no mint attempted', async () => {
    const a = await attachProxyContext({ proxyTokenStore: null, urlKey: 'acme', baseUrl: 'https://host', prompt: BASE, harness: 'opencode' });
    assert.equal(a.prompt, BASE);
    assert.equal(a.bootstrapToken, null);
    const store = fakeStore();
    const b = await attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: '', prompt: BASE, harness: 'opencode' });
    assert.equal(b.prompt, BASE);
    assert.equal(b.bootstrapToken, null);
    assert.equal(store.calls.length, 0, 'no mint without a baseUrl');
  });
});

describe('attachProxyContext — claude-code MCP path fails CLOSED (LIN-1175)', () => {
  // Out-of-band (bootstrapToken field + MCP tool) delivery has NO in-prompt
  // fallback: any inability to attach a token must THROW so the dispatch is
  // refused, never silently launch a credential-less claude-code session whose
  // prompt still claims a token was "supplied alongside" it (the dead-session bug).
  const MCP_HARNESSES = ['claude-code', '  Claude-Code  '];

  test('mint returns no token: throws (does NOT return the prompt unchanged)', async () => {
    for (const harness of MCP_HARNESSES) {
      const store = fakeStore({ result: { token: null } });
      await assert.rejects(
        () => attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', prompt: BASE, harness }),
        /LIN-1175/,
        `throws for harness=${JSON.stringify(harness)}`
      );
      assert.equal(store.calls.length, 1, 'mint was attempted before failing closed');
    }
  });

  test('mint throws: the failure propagates (fail closed), not swallowed', async () => {
    const store = fakeStore({ throwErr: new Error('boom') });
    await assert.rejects(
      () => attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', prompt: BASE, harness: 'claude-code' }),
      /LIN-1175/
    );
  });

  test('no proxyTokenStore: throws before any mint (no silent credential-less dispatch)', async () => {
    await assert.rejects(
      () => attachProxyContext({ proxyTokenStore: null, urlKey: 'acme', baseUrl: 'https://host', prompt: BASE, harness: 'claude-code' }),
      /LIN-1175/
    );
  });

  test('falsy baseUrl: throws before any mint attempt', async () => {
    const store = fakeStore();
    await assert.rejects(
      () => attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: '', prompt: BASE, harness: 'claude-code' }),
      /LIN-1175/
    );
    assert.equal(store.calls.length, 0, 'no mint attempted without a baseUrl');
  });

  test('success path is untouched — token attaches, no throw', async () => {
    const store = fakeStore({ token: 'TOK123' });
    const out = await attachProxyContext({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', prompt: BASE, harness: 'claude-code'
    });
    assert.equal(out.bootstrapToken, 'TOK123');
    assert.ok(out.prompt.includes(MARKER), 'access block still appended on success');
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

// LIN-1429: provisionBootstrapToken is the mint extracted out of
// attachProxyContext (owns the LIN-1175 fail-closed throw + LIN-1376 createdBy
// stamp, prompt-free). These cover what the attachProxyContext-level tests
// above cannot express directly: the bare return shape, and the guard-order /
// log-asymmetry details now that they live on their own export.
describe('provisionBootstrapToken (LIN-1429 — provisioning extracted from attachProxyContext)', () => {
  test('returns the bare token string (not an object) on both harnesses', async () => {
    const proseStore = fakeStore({ token: 'TOK_PROSE' });
    const proseToken = await provisionBootstrapToken({
      proxyTokenStore: proseStore, urlKey: 'acme', baseUrl: 'https://host', harness: null
    });
    assert.equal(proseToken, 'TOK_PROSE');
    assert.equal(typeof proseToken, 'string');

    const mcpStore = fakeStore({ token: 'TOK_MCP' });
    const mcpToken = await provisionBootstrapToken({
      proxyTokenStore: mcpStore, urlKey: 'acme', baseUrl: 'https://host', harness: 'claude-code'
    });
    assert.equal(mcpToken, 'TOK_MCP');
    assert.equal(typeof mcpToken, 'string');
  });

  describe('prose (non-claude-code) degrades gracefully — returns null, never throws', () => {
    test('no proxyTokenStore', async () => {
      const out = await provisionBootstrapToken({
        proxyTokenStore: null, urlKey: 'acme', baseUrl: 'https://host', harness: 'opencode'
      });
      assert.strictEqual(out, null, 'strictEqual so an accidental undefined is not mistaken for null');
    });

    test('falsy baseUrl — no mint attempted', async () => {
      const store = fakeStore();
      const out = await provisionBootstrapToken({
        proxyTokenStore: store, urlKey: 'acme', baseUrl: '', harness: 'opencode'
      });
      assert.strictEqual(out, null);
      assert.equal(store.calls.length, 0, 'no mint without a baseUrl');
    });

    test('mint throws', async () => {
      const store = fakeStore({ throwErr: new Error('boom') });
      const out = await provisionBootstrapToken({
        proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', harness: 'opencode'
      });
      assert.strictEqual(out, null);
    });

    test('mint returns no token', async () => {
      const store = fakeStore({ result: { token: null } });
      const out = await provisionBootstrapToken({
        proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', harness: 'opencode'
      });
      assert.strictEqual(out, null);
      assert.equal(store.calls.length, 1, 'mint was still attempted');
    });
  });

  describe('claude-code fails CLOSED (LIN-1175) — throws, never returns null', () => {
    test('no proxyTokenStore', async () => {
      await assert.rejects(
        () => provisionBootstrapToken({
          proxyTokenStore: null, urlKey: 'acme', baseUrl: 'https://host', harness: 'claude-code'
        }),
        (err) => {
          assert.match(err.message, /LIN-1175/);
          assert.equal(err.proxyAttachFailed, true);
          return true;
        }
      );
    });

    test('falsy baseUrl — no mint attempted before failing closed', async () => {
      const store = fakeStore();
      await assert.rejects(
        () => provisionBootstrapToken({
          proxyTokenStore: store, urlKey: 'acme', baseUrl: '', harness: 'claude-code'
        }),
        /LIN-1175/
      );
      assert.equal(store.calls.length, 0, 'no mint without a baseUrl');
    });

    test('mint throws: the failure propagates, not swallowed', async () => {
      const store = fakeStore({ throwErr: new Error('boom') });
      await assert.rejects(
        () => provisionBootstrapToken({
          proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', harness: 'claude-code'
        }),
        (err) => {
          assert.match(err.message, /LIN-1175/);
          assert.equal(err.proxyAttachFailed, true);
          return true;
        }
      );
    });

    test('mint returns no token: throws (does NOT return null)', async () => {
      const store = fakeStore({ result: { token: null } });
      await assert.rejects(
        () => provisionBootstrapToken({
          proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', harness: 'claude-code'
        }),
        (err) => {
          assert.match(err.message, /LIN-1175/);
          assert.equal(err.proxyAttachFailed, true);
          return true;
        }
      );
      assert.equal(store.calls.length, 1, 'mint was attempted before failing closed');
    });
  });

  test('createdBy pass-through, plus kind/scope/label/ttl on the same options object', async () => {
    const store = fakeStore({ token: 'TOK123' });
    await provisionBootstrapToken({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host',
      label: 'my-label', harness: 'claude-code', createdBy: 'account-A'
    });
    assert.equal(store.calls.length, 1);
    const { urlKey, options } = store.calls[0];
    assert.equal(urlKey, 'acme');
    assert.equal(options.kind, 'bootstrap');
    assert.equal(options.scope, 'readWrite');
    assert.equal(options.label, 'my-label');
    assert.equal(options.ttl, BOOTSTRAP_TOKEN_TTL_SECONDS);
    assert.equal(options.createdBy, 'account-A');
  });

  describe('log asymmetry — only the mint-throws catch logs; the guards are silent', () => {
    test('mint throws (prose path): exactly one console.error call', async (t) => {
      const errorMock = t.mock.method(console, 'error', () => {});
      const store = fakeStore({ throwErr: new Error('boom') });
      await provisionBootstrapToken({
        proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', harness: 'opencode'
      });
      assert.equal(errorMock.mock.calls.length, 1);
    });

    test('no proxyTokenStore (prose path): silent, zero console.error calls', async (t) => {
      const errorMock = t.mock.method(console, 'error', () => {});
      await provisionBootstrapToken({
        proxyTokenStore: null, urlKey: 'acme', baseUrl: 'https://host', harness: 'opencode'
      });
      assert.equal(errorMock.mock.calls.length, 0);
    });

    test('mint returns no token (prose path): silent, zero console.error calls', async (t) => {
      const errorMock = t.mock.method(console, 'error', () => {});
      const store = fakeStore({ result: { token: null } });
      await provisionBootstrapToken({
        proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', harness: 'opencode'
      });
      assert.equal(errorMock.mock.calls.length, 0);
    });
  });
});
