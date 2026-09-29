/**
 * LIN-1892 S3 (G3) — the one-time, skippable provider-user email prompt.
 *
 * The middleware is installed only when a transport exists AND the availability
 * resolver chose a prompting mode (lib/email-availability.js
 * resolvePromptStepMode). It fires once per session on the workspace root HTML
 * page and never blocks the provider flow. Real express-session + MangoDB via
 * the email harness (which mounts a sentinel `/workspace/:urlKey/` route AFTER
 * the email router, so "redirected" and "passed through" are distinguishable).
 *
 * Run with: node --test tests/unit/email-prompt-step.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { startEmailAuthHarness, hiddenField } from '../fixtures/email-auth-harness.js';
import { resolvePromptStepMode, resolveEmailTransportKind } from '../../lib/email-availability.js';

const WORKSPACE = '/workspace/ws-1/';

async function signIn(harness, { provider = 'linear', scope = 'prompt-p', workspaceId = 'ws-1', urlKey = 'ws-1', isPAT = false } = {}) {
  const browser = harness.browser();
  await browser.post('/__test/sign-in', { provider, scope, workspaceId, urlKey, ...(isPAT ? { isPAT: '1' } : {}) });
  return browser;
}

describe('the prompt gate is structural (G3 availability)', () => {
  test('the S2 link-origin refusal resolves the step off', () => {
    // Resend keys without a valid link origin: email sign-in is off, so the
    // step MUST be off too (it must never prompt where links cannot be sent).
    const env = { NODE_ENV: 'production', RESEND_API_KEY: 'k', EMAIL_FROM: 'Harbour <h@x.io>' };
    assert.strictEqual(resolveEmailTransportKind(env), null);
    assert.strictEqual(resolvePromptStepMode(env), 'off');
  });

  test('no transport → the middleware never installs and never writes the flag', async () => {
    const harness = await startEmailAuthHarness({ transport: null, promptStep: 'on' });
    try {
      const browser = await signIn(harness);
      const res = await browser.get(WORKSPACE);
      assert.strictEqual(res.status, 200);
      assert.match(res.text, /workspace-root/);
      assert.strictEqual((await browser.session()).emailPrompt, undefined);
    } finally { await harness.close(); }
  });

  test('a transport but promptStep off → passes through, flag untouched', async () => {
    const harness = await startEmailAuthHarness({ promptStep: 'off' });
    try {
      const browser = await signIn(harness);
      const res = await browser.get(WORKSPACE);
      assert.strictEqual(res.status, 200);
      assert.strictEqual((await browser.session()).emailPrompt, undefined);
    } finally { await harness.close(); }
  });

  test('opt-in mode without this session\'s flag → passes through, flag untouched', async () => {
    const harness = await startEmailAuthHarness({ promptStep: 'opt-in' });
    try {
      const browser = await signIn(harness);
      const res = await browser.get(WORKSPACE);
      assert.strictEqual(res.status, 200);
      assert.strictEqual((await browser.session()).emailPrompt, undefined);
    } finally { await harness.close(); }
  });
});

describe('the prompt fires once under an enabling mode', () => {
  let harness;
  before(async () => { harness = await startEmailAuthHarness({ promptStep: 'on' }); });
  after(async () => { await harness?.close(); });

  test('a provider user with no email is redirected once to the step, then never again', async () => {
    const browser = await signIn(harness, { scope: `prompt-once-${Date.now()}` });

    const first = await browser.get(WORKSPACE);
    assert.strictEqual(first.status, 302);
    assert.strictEqual(first.location, `/auth/email/register?next=${encodeURIComponent(WORKSPACE)}&step=1`);
    assert.strictEqual((await browser.session()).emailPrompt, 'shown');

    const second = await browser.get(WORKSPACE);
    assert.strictEqual(second.status, 200);
    assert.match(second.text, /workspace-root/);
  });

  test('the step page carries the step copy and a Skip link back to next', async () => {
    const browser = await signIn(harness, { scope: `prompt-step-${Date.now()}` });
    await browser.get(WORKSPACE);
    const step = await browser.get(`/auth/email/register?next=${encodeURIComponent(WORKSPACE)}&step=1`);
    assert.strictEqual(step.status, 200);
    assert.match(step.text, /data-testid="email-register-step"/);
    assert.match(step.text, /To register an account, type your email/);
    assert.match(step.text, /data-testid="email-register-skip"[^>]*>Skip for now</);
    assert.match(step.text, /href="\/workspace\/ws-1\/"[^>]*data-testid="email-register-skip"|data-testid="email-register-skip"[^>]*href="\/workspace\/ws-1\/"/);
    assert.ok(hiddenField(step.text, 'nonce'), 'the step mints a send nonce');
    assert.strictEqual(hiddenField(step.text, 'mode'), 'link');
  });

  test('an account that already has an email is marked done, with no redirect', async () => {
    const browser = harness.browser();
    await browser.post('/__test/sign-in', { provider: 'email', scope: `has-email-${Date.now()}@x.io` });
    const res = await browser.get(WORKSPACE);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await browser.session()).emailPrompt, 'done');
  });

  test('non-HTML, non-workspace-root and non-GET requests are untouched', async () => {
    const browser = await signIn(harness, { scope: `prompt-shapes-${Date.now()}` });
    const json = await browser.get(WORKSPACE, { headers: { Accept: 'application/json' } });
    assert.strictEqual(json.status, 200, 'non-HTML passes through');
    const other = await browser.get('/auth/email');
    assert.strictEqual(other.status, 200, 'a non-workspace-root path is untouched');
    assert.strictEqual((await browser.session()).emailPrompt, undefined);
  });

  test('a pure PAT session is not prompted', async () => {
    const browser = await signIn(harness, { scope: `prompt-pat-${Date.now()}`, isPAT: true });
    const res = await browser.get(WORKSPACE);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await browser.session()).emailPrompt, undefined);
  });
});

describe('the opt-in test gate fires only after /test/email-prompt-opt-in', () => {
  let harness;
  before(async () => { harness = await startEmailAuthHarness({ promptStep: 'opt-in' }); });
  after(async () => { await harness?.close(); });

  test('after opting in, the step redirects exactly once', async () => {
    const browser = await signIn(harness, { scope: `prompt-optin-${Date.now()}` });
    assert.strictEqual((await browser.get(WORKSPACE)).status, 200, 'no opt-in → no redirect');
    await browser.post('/__test/prompt-opt-in', {});

    const first = await browser.get(WORKSPACE);
    assert.strictEqual(first.status, 302);
    assert.match(first.location, /^\/auth\/email\/register\?next=/);
    const second = await browser.get(WORKSPACE);
    assert.strictEqual(second.status, 200, 'once only');
  });
});
