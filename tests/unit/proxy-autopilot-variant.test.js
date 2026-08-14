/**
 * LIN-791 — the `variant` axis on the Autopilot kickoff proxy routes.
 *
 * Mounts the real proxy router over express with a stubbed readWrite token and a
 * fake dispatch store, then proves the POST /api/proxy/autopilot/kickoff verb:
 *   - resolves a MISSING variant to the default ('standard'),
 *   - 400s on an INVALID variant (mirroring the existing invalid-`mode` guard),
 *   - threads a valid 'stepper' through to the response,
 * and that the GET preview twin swaps the disposition in on `?variant=stepper`.
 *
 * General (no issueIdentifier) runs are used so the validation path is exercised
 * without needing a resolved workspace/issue — variant is validated up front,
 * right beside mode, before any issue resolution.
 *
 * LIN-1138 — model/harness forwarding on autopilot kickoff:
 *   - explicit model/harness are forwarded to the dispatch item
 *   - validation rejects non-string, over-length, and control-char values
 *   - omitted model/harness become null
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

before(() => { process.env.NODE_ENV = 'test'; });

const URL_KEY = 'test-workspace';

/**
 * Build an app with the proxy router + a fake readWrite token and dispatch store.
 * `createToken` overrides the bootstrap mint (default: a working mint like
 * production) so a test can exercise the LIN-1175 fail-closed path.
 */
function buildApp({ createToken, recordEvent } = {}) {
  const added = [];
  const events = [];
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      // LIN-1175: claude-code (default harness) dispatch now fails closed without a
      // mintable token; give the stub a minting createToken like production.
      createToken: createToken || (async () => ({ token: "test-bootstrap", kind: "bootstrap", scope: "readWrite" })),
      validateToken: async () => ({
        tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1',
      }),
    },
    proxyEventStore: {
      recordEvent: recordEvent || (async event => { events.push(event); }),
    },
    resolveWorkspaceAccess: async () => ({ token: null, reason: 'not_connected' }),
    getWorkspaceAccessToken: async () => null,
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {
      addItem: async (urlKey, doc) => {
        const item = {
          _id: 'dispatch-1',
          kind: doc.kind,
          promptName: doc.promptName,
          issueIdentifier: doc.issueIdentifier ?? null,
          target: doc.target,
          model: doc.model ?? null,
          harness: doc.harness ?? null,
          dispatchedAt: new Date('2026-06-29T00:00:00Z'),
        };
        added.push({ urlKey, doc, item });
        return item;
      },
    },
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return { app, added, events };
}

async function request(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer anything',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('POST kickoff: missing variant resolves to the default (standard)', async () => {
  const { app } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { goal: 'walk the stack' },
  });
  assert.equal(status, 201);
  assert.equal(body.variant, 'standard');
  assert.equal(body.kind, 'autopilot');
});

test('POST kickoff: an invalid variant is a 400 (mirrors invalid-mode)', async () => {
  const { app, added } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { variant: 'sideways' },
  });
  assert.equal(status, 400);
  assert.match(body.error, /variant must be one of/);
  // a rejected request never reaches the dispatch store.
  assert.equal(added.length, 0);
});

test("POST kickoff: a valid variant 'stepper' is accepted and echoed back", async () => {
  const { app } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { variant: 'stepper' },
  });
  assert.equal(status, 201);
  assert.equal(body.variant, 'stepper');
});

test('POST kickoff: stepper dispatches a prompt carrying the stepper disposition', async () => {
  const { app, added } = buildApp();
  await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { variant: 'stepper' },
  });
  assert.equal(added.length, 1);
  assert.match(added[0].doc.prompt, /You're running as the STEPPER/);
  // a standard run must NOT carry it.
  const std = buildApp();
  await request(std.app, '/api/proxy/autopilot/kickoff', { method: 'POST', body: {} });
  assert.doesNotMatch(std.added[0].doc.prompt, /You're running as the STEPPER/);
});

test('POST kickoff: parks the orchestrator holdable (waitForFollowUps:true) — LIN-826', async () => {
  // Under push-based comms the kickoff must stop at a holdable AWAITING_FOLLOWUP
  // point so subscribed children can wake it, instead of polling. Every variant
  // dispatches with waitForFollowUps:true.
  for (const body of [{}, { variant: 'stepper' }, { goal: 'walk the stack' }]) {
    const { app, added } = buildApp();
    const { status } = await request(app, '/api/proxy/autopilot/kickoff', { method: 'POST', body });
    assert.equal(status, 201);
    assert.equal(added.length, 1);
    assert.equal(added[0].doc.kind, 'autopilot', 'this is the orchestrator kickoff dispatch');
    assert.equal(added[0].doc.waitForFollowUps, true, 'kickoff parks holdable');
  }
});

test('POST kickoff: sessionId + subscription are threaded onto the dispatched child item (LIN-813/§6)', async () => {
  const { app, added } = buildApp();
  const headId = '11111111-2222-4333-8444-555555555555';
  // General run (no issueIdentifier) so the threading is exercised without a
  // resolved workspace — sessionId/subscription are validated + forwarded regardless
  // of variant (this is a guide capability, not a variant). A coordinator declares
  // subscription:'everything' so the child's PENDING/terminal reports wake it.
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { sessionId: headId, subscription: 'everything' },
  });
  assert.equal(status, 201);
  assert.equal(added.length, 1);
  // The up-chain edge: the child carries the coordinator's id as its parent
  // sessionId and a declared 'everything' subscription, so its reports wake the
  // coordinator.
  assert.equal(added[0].doc.sessionId, headId);
  assert.equal(added[0].doc.subscription, 'everything');
});

test('POST kickoff: a top-level kickoff omitting sessionId/subscription stays a parent-less head (terminal-only)', async () => {
  const { app, added } = buildApp();
  await request(app, '/api/proxy/autopilot/kickoff', { method: 'POST', body: {} });
  assert.equal(added.length, 1);
  // Defaults: no parent edge, undeclared subscription → terminal-only (§6).
  assert.equal(added[0].doc.sessionId ?? null, null);
  assert.equal(added[0].doc.subscription, 'terminal-only');
});

test('POST kickoff: an invalid sessionId is a 400; an invalid subscription is a 400 (LIN-813/§6)', async () => {
  // Since LIN-1118 sessionId is an opaque string, so 'not-a-uuid' is VALID and no
  // longer the negative case. The rule still rejects on shape — here, the reserved
  // value that would collide with the observation backfill marker.
  const bad = buildApp();
  const r1 = await request(bad.app, '/api/proxy/autopilot/kickoff', {
    method: 'POST', body: { sessionId: '__meta__' },
  });
  assert.equal(r1.status, 400);
  assert.match(r1.body.error, /sessionId/);
  assert.equal(bad.added.length, 0);

  const bad2 = buildApp();
  const r2 = await request(bad2.app, '/api/proxy/autopilot/kickoff', {
    method: 'POST', body: { subscription: 'yes' },
  });
  assert.equal(r2.status, 400);
  assert.match(r2.body.error, /subscription must be one of/);
  assert.equal(bad2.added.length, 0);
});

test('POST kickoff: a composite sessionId is accepted and stored verbatim (LIN-1118)', async () => {
  const { app, added } = buildApp();
  const composite = 'LIN-1117-autopilot-standalone-2026-07-07';
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST', body: { sessionId: composite, subscription: 'everything' },
  });
  assert.equal(status, 201);
  assert.equal(added.length, 1);
  // Stored blindly, exactly as supplied — no normalisation, no re-minting.
  assert.equal(added[0].doc.sessionId, composite);
});

test("POST kickoff: 'coordinator' is NOT a launch-time variant — it 400s like any unknown variant (LIN-813)", async () => {
  // The coordinator capability lives in the shared guide (operating manual), not in
  // a variant. AUTOPILOT_VARIANTS stays ['standard','stepper']; a coordinator
  // variant is rejected, and the up-chain edge is carried by sessionId/subscription.
  const { app, added } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { variant: 'coordinator' },
  });
  assert.equal(status, 400);
  assert.match(body.error, /variant must be one of/);
  assert.equal(added.length, 0);
});

test('GET kickoff preview: ?variant=stepper swaps in the disposition; default omits it', async () => {
  const { app } = buildApp();
  const stepper = await request(app, '/api/proxy/autopilot/kickoff?variant=stepper');
  assert.equal(stepper.status, 200);
  assert.match(stepper.body, /You're running as the STEPPER/);

  const standard = await request(app, '/api/proxy/autopilot/kickoff');
  assert.equal(standard.status, 200);
  assert.doesNotMatch(standard.body, /You're running as the STEPPER/);

  // an unknown variant falls back to standard (GET is lenient, like ?mode=).
  const bogus = await request(app, '/api/proxy/autopilot/kickoff?variant=sideways');
  assert.equal(bogus.status, 200);
  assert.doesNotMatch(bogus.body, /You're running as the STEPPER/);
});

// ── LIN-1138 — model/harness forwarding on autopilot kickoff ─────────────────

const MODEL = 'anthropic/claude-opus-4.8';
const HARNESS = 'opencode';

test('POST kickoff (LIN-1138): an explicit model is forwarded to the dispatch item', async () => {
  const { app, added } = buildApp();
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { model: MODEL },
  });
  assert.equal(status, 201);
  assert.equal(added.length, 1);
  assert.equal(added[0].doc.model, MODEL);
});

test('POST kickoff (LIN-1138): an explicit harness is forwarded to the dispatch item', async () => {
  const { app, added } = buildApp();
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { harness: HARNESS },
  });
  assert.equal(status, 201);
  assert.equal(added.length, 1);
  assert.equal(added[0].doc.harness, HARNESS);
});

test('POST kickoff (LIN-1138): model and harness are forwarded together', async () => {
  const { app, added } = buildApp();
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { model: MODEL, harness: HARNESS },
  });
  assert.equal(status, 201);
  assert.equal(added.length, 1);
  assert.equal(added[0].doc.model, MODEL);
  assert.equal(added[0].doc.harness, HARNESS);
});

test('POST kickoff (LIN-1138): an omitted model stays null; an omitted harness defaults to claude-code (LIN-1159)', async () => {
  const { app, added } = buildApp();
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: {},
  });
  assert.equal(status, 201);
  assert.equal(added.length, 1);
  assert.strictEqual(added[0].doc.model, null);
  // LIN-1159: the proxy dispatch boundary now interposes claude-code as the
  // default harness (model keeps its null passthrough).
  assert.strictEqual(added[0].doc.harness, 'claude-code');
});

test('POST kickoff (LIN-1138): a non-string model is rejected with 400', async () => {
  const { app, added } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { model: 42 },
  });
  assert.equal(status, 400);
  assert.match(body.error, /model must be a string/);
  assert.equal(added.length, 0);
});

test('POST kickoff (LIN-1138): an over-length model is rejected with 400', async () => {
  const { app, added } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { model: 'x'.repeat(1001) },
  });
  assert.equal(status, 400);
  assert.match(body.error, /model exceeds maximum length/);
  assert.equal(added.length, 0);
});

test('POST kickoff (LIN-1138): a model with dangerous control characters is rejected with 400', async () => {
  const { app, added } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { model: 'anthropic/claude\x00opus' },
  });
  assert.equal(status, 400);
  assert.match(body.error, /model contains invalid characters/);
  assert.equal(added.length, 0);
});

test('POST kickoff (LIN-1138): model: 0 (a falsy non-string) is rejected with 400', async () => {
  const { app, added } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { model: 0 },
  });
  assert.equal(status, 400);
  assert.match(body.error, /model must be a string/);
  assert.equal(added.length, 0);
});

test('POST kickoff (LIN-1138): harness validation rejects non-string, over-length, and control chars', async () => {
  const { app } = buildApp();
  // non-string
  const r1 = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST', body: { harness: 42 },
  });
  assert.equal(r1.status, 400);
  assert.match(r1.body.error, /harness must be a string/);

  // over-length
  const r2 = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST', body: { harness: 'x'.repeat(1001) },
  });
  assert.equal(r2.status, 400);
  assert.match(r2.body.error, /harness exceeds maximum length/);

  // control chars
  const r3 = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST', body: { harness: 'opencode\x00' },
  });
  assert.equal(r3.status, 400);
  assert.match(r3.body.error, /harness contains invalid characters/);
});

// ── LIN-2075 — goal/repo validation messages on kickoff ──────────────────────
// `goal` and `repo` used to collapse non-string / over-length / dangerous-chars
// into a bare 'goal is invalid' / 'repo is invalid'. They now route through the
// same validateOpaqueDispatchField helper as model/harness above, with
// reportReceivedLength:true so the over-length message also names the received
// length (in UTF-16 code units).

test('POST kickoff (LIN-2075): a non-string goal is rejected with 400', async () => {
  const { app, added } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { goal: 42 },
  });
  assert.equal(status, 400);
  assert.match(body.error, /goal must be a string/);
  assert.equal(added.length, 0);
});

test('POST kickoff (LIN-2075): an over-length goal is rejected naming the cap and received length', async () => {
  const { app, added, events } = buildApp();
  const goal = 'x'.repeat(1247);
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { goal },
  });
  assert.equal(status, 400);
  assert.equal(body.error, 'goal exceeds maximum length of 1000 (got 1247)');
  assert.equal(added.length, 0);
  // the reject-branch logEvent(req, '/api/proxy/autopilot/kickoff', 400) call
  // must survive the swap onto the shared helper — this is the regression the
  // swap most plausibly breaks silently.
  assert.ok(
    events.some(e => e.endpoint === '/api/proxy/autopilot/kickoff' && e.status === 400),
    `expected a 400 event for the kickoff endpoint, got ${JSON.stringify(events)}`
  );
});

test('POST kickoff (LIN-2075): the received length counts UTF-16 code units, not visible characters', async () => {
  // 501 x 🚀 is 1002 UTF-16 code units (each emoji is a surrogate pair) —
  // rejected at 501 visible characters, and the reported length must say
  // 1002, or the number contradicts what a caller can count.
  const { app, added } = buildApp();
  const goal = '\u{1F680}'.repeat(501);
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { goal },
  });
  assert.equal(status, 400);
  assert.equal(body.error, 'goal exceeds maximum length of 1000 (got 1002)');
  assert.equal(added.length, 0);
});

test('POST kickoff (LIN-2075): a goal with dangerous control characters is rejected with 400', async () => {
  const { app, added } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { goal: 'walk the stack\x00' },
  });
  assert.equal(status, 400);
  assert.match(body.error, /goal contains invalid characters/);
  assert.equal(added.length, 0);
});

test('POST kickoff (LIN-2075): a valid goal is accepted and threaded into the prompt', async () => {
  const { app, added } = buildApp();
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { goal: 'walk the stack' },
  });
  assert.equal(status, 201);
  assert.equal(added.length, 1);
  assert.match(added[0].doc.prompt, /\*\*Goal from the human:\*\* walk the stack/);
});

test('POST kickoff (LIN-2075): goal: null is now accepted as absent (intentional relaxation)', async () => {
  // Previously null fell through to the type check and was rejected; the
  // shared helper treats null the same as omitted/undefined. This pins the
  // ticket's one intended behaviour change — it must fail if reverted.
  const { app, added } = buildApp();
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { goal: null },
  });
  assert.equal(status, 201);
  assert.equal(added.length, 1);
  // The fallback line an omitted goal also produces, per
  // lib/prompts/autopilot-kickoff.js — proves goal:null took the "absent" branch.
  assert.match(added[0].doc.prompt, /\*\*Goal from the human:\*\* none this run/);
});

test('POST kickoff (LIN-2075): an omitted goal still behaves as today (general run, no goal line)', async () => {
  const { app, added } = buildApp();
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: {},
  });
  assert.equal(status, 201);
  assert.equal(added.length, 1);
  assert.match(added[0].doc.prompt, /\*\*Goal from the human:\*\* none this run/);
});

test('POST kickoff (LIN-2075): a non-string repo is rejected with 400', async () => {
  const { app, added } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { repo: 42 },
  });
  assert.equal(status, 400);
  assert.match(body.error, /repo must be a string/);
  assert.equal(added.length, 0);
});

test('POST kickoff (LIN-2075): an over-length repo is rejected naming the cap and received length', async () => {
  const { app, added } = buildApp();
  const repo = 'x'.repeat(1001);
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { repo },
  });
  assert.equal(status, 400);
  assert.equal(body.error, 'repo exceeds maximum length of 1000 (got 1001)');
  assert.equal(added.length, 0);
});

test('POST kickoff (LIN-2075): a repo with dangerous control characters is rejected with 400', async () => {
  const { app, added } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { repo: 'my-org/my-repo\x00' },
  });
  assert.equal(status, 400);
  assert.match(body.error, /repo contains invalid characters/);
  assert.equal(added.length, 0);
});

test('POST kickoff (LIN-2075): a valid repo is accepted and threaded onto the dispatch item', async () => {
  const { app, added } = buildApp();
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { repo: 'my-org/my-repo' },
  });
  assert.equal(status, 201);
  assert.equal(added.length, 1);
  assert.equal(added[0].doc.repo, 'my-org/my-repo');
});

test('POST kickoff (LIN-2075): repo: null is now accepted as absent (intentional relaxation)', async () => {
  const { app, added } = buildApp();
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { repo: null },
  });
  assert.equal(status, 201);
  assert.equal(added.length, 1);
  assert.strictEqual(added[0].doc.repo, null);
});

test('POST kickoff (LIN-2075): an omitted repo still behaves as today (no repo on the dispatch item)', async () => {
  const { app, added } = buildApp();
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: {},
  });
  assert.equal(status, 201);
  assert.equal(added.length, 1);
  assert.strictEqual(added[0].doc.repo, null);
});

// LIN-1175 — a claude-code autopilot kickoff (the DEFAULT harness) must FAIL
// CLOSED when its out-of-band bootstrap token can't be minted, never launch a
// credential-less session. This is the regression test for the dead-session bug:
// before the fix, attachProxyContext degraded to a no-op and the kickoff enqueued
// a token-less prompt that still claimed "a token is supplied alongside" it.
test('POST kickoff: mint returns no token -> 503, nothing enqueued (fail closed)', async () => {
  const { app, added } = buildApp({ createToken: async () => ({ token: null }) });
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST', body: { goal: 'walk the stack' },
  });
  assert.equal(status, 503, JSON.stringify(body));
  assert.match(body.error, /LIN-1175|credential-less|proxy token could not be created/i);
  assert.equal(added.length, 0, 'no credential-less item is enqueued');
});

test('POST kickoff: mint throws -> 503, nothing enqueued (fail closed)', async () => {
  const { app, added } = buildApp({ createToken: async () => { throw new Error('rate limited'); } });
  const { status } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST', body: { goal: 'walk the stack' },
  });
  assert.equal(status, 503);
  assert.equal(added.length, 0, 'no credential-less item is enqueued');
});
