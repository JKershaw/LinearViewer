import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
// fixture:LIN-3136
import { mintDriverWriter } from '../fixtures/driver-writer.js';
// /fixture:LIN-3136
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * LIN-3098 S2 — the runner kit's local loop, end to end: the real
 * `lib/runner-kit/runner.mjs` CLI (and the brokers it starts) driven against
 * the running Playwright server, the way a person's Claude Code session drives
 * it through Bash.
 *
 * The workspace comes from `append: true`, so the session's account is its
 * OWNER (LIN-1892) and can mint the runner copy (LIN-3131). Owner items are
 * enqueued through an owner-created proxy token (`dispatchedBy` = the owner).
 * The B1 non-owner item is enqueued by a second session (the canonical Linear
 * test account, in its own request context) through the real SESSION dispatch
 * route, which stamps that account as `dispatchedBy`. Since LIN-3136 a non-owner
 * can no longer hold an enqueue-capable proxy token (the proxy enqueue routes
 * require the owner-minted `dispatch` grant), so the session route is the real
 * path a non-owner's item reaches this queue by. No test-only queue writer, and
 * the owner's session is never touched.
 *
 * Everything stays on loopback; broker sockets live in a short /tmp dir.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(ROOT, 'lib', 'runner-kit', 'runner.mjs');
const BASE = 'http://localhost:3001';

let urlKey;
let home;
let ownerAccountId;
let ownerToken;

function runner(args, { stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUNNER, ...args, '--home', home], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`runner ${args[0]} exited ${code}: ${err}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error(`runner ${args[0]} printed non-JSON: ${out}`)); }
    });
    child.stdin.end(stdin || '');
  });
}

async function cookieHeader(page) {
  const cookies = await page.context().cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function enqueue(request, data) {
  const res = await request.post('/api/proxy/dispatch', {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    data: { harness: 'claude-code', ...data }
  });
  expect(res.status()).toBe(201);
  return res.json();
}

async function watch(request, id) {
  const res = await request.get(`/api/proxy/dispatch/${id}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect(res.status()).toBe(200);
  return res.json();
}

test.beforeEach(async ({ page, request }) => {
  const seeded = await seedLocalWorkspace(page, null, { urlKey: 'runner-kit-loop', append: true, features: { proxy: true } });
  urlKey = seeded.urlKey;
  // LIN-3409: the stop-halt test below halts through the proxy, which is owner-only.
  await seedWorkspaceOwnership(page, urlKey, 'owner');
  await page.goto(`/test/clear-proxy-tokens?urlKey=${urlKey}`);
  await page.goto(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.goto(`/test/clear-dispatch-tokens?urlKey=${urlKey}`);
  const header = await cookieHeader(page);
  ownerAccountId = (await (await request.get('/test/session-account', { headers: { Cookie: header } })).json()).accountId;
  expect(ownerAccountId).toBeTruthy();
  ownerToken = (await (await request.get(`/test/create-proxy-token?urlKey=${urlKey}&scope=readWrite&label=owner-enqueue`, { headers: { Cookie: header } })).json()).token;
  // fixture:LIN-3136: enqueue needs the dispatch grant, so the owner's writer is the owner's driver copy
  ownerToken = (await mintDriverWriter(page, urlKey)).token;
  // /fixture:LIN-3136

  // 1. Mint the runner credential (owner-only), then recover (a no-op) and login.
  home = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'rk-e2e-'));
  const mint = await request.post(`/workspace/${urlKey}/api/proxy/tokens`, {
    headers: { Cookie: header, 'Content-Type': 'application/json' },
    data: { runner: true }
  });
  expect(mint.status()).toBe(201);
  const bootstrap = (await mint.json()).token;
  const recovered = await runner(['recover', '--url-key', urlKey]);
  expect(recovered.fail).toEqual([]);
  const block = `## Your runner credential\n- baseUrl: ${BASE}\n- urlKey: ${urlKey}\n- ownerAccountId: ${ownerAccountId}\n- bootstrap: ${bootstrap}\n`;
  const login = await runner(['login'], { stdin: block });
  expect(login.grants).toEqual(['take', 'dispatch']);
  expect(JSON.stringify(login)).not.toContain(bootstrap);
});

test.afterEach(async () => {
  if (!home) return;
  try {
    const ledger = JSON.parse(readFileSync(join(home, urlKey, 'ledger.json'), 'utf8'));
    for (const id of Object.keys(ledger.items || {})) await runner(['stop-broker', id]).catch(() => {});
  } catch { /* nothing taken */ }
  rmSync(home, { recursive: true, force: true });
  home = null;
});

test.describe('runner kit local loop (LIN-3098 S2)', () => {
  test('poll → take (confirmed) → handoff → [done]; a subscribed child\'s [done] wake passes', async ({ request }) => {
    const parent = await enqueue(request, { prompt: 'parent step' });
    const child = await enqueue(request, { prompt: 'child step', sessionId: parent.id, subscription: 'terminal-only' });

    const polled = await runner(['poll']);
    const by = Object.fromEntries(polled.decisions.map((d) => [d.id, d]));
    expect(by[parent.id].decision).toBe('take');
    expect(by[child.id].decision).toBe('take');
    expect(JSON.stringify(polled)).not.toContain('parent step');

    // Take the parent (the orchestrator) and the child, each with its own broker.
    const tp = await runner(['take', parent.id]);
    expect(tp.prompt).toContain('parent step');
    expect(tp.broker?.socket).toBeTruthy();
    await runner(['handoff', parent.id, 'agent-parent']);
    const tc = await runner(['take', child.id]);
    await runner(['handoff', child.id, 'agent-child']);

    // The child's broker reaches Harbour with the item's own credential.
    const viaBroker = await new Promise((resolve, reject) => {
      execFile('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--unix-socket', tc.broker.socket, `http://harbour-runner.invalid/api/proxy/dispatch/${child.id}`], (e, out) => (e ? reject(e) : resolve(out)));
    });
    expect(viaBroker).toBe('200');

    // [done] on the child: terminal, and it wakes the subscribed parent.
    await runner(['feedback', child.id, 'status', '[done]']);
    const childWatch = await watch(request, child.id);
    expect(childWatch.feedback.map((f) => f.message)).toEqual(expect.arrayContaining([
      `[handoff] item ${child.id} → subagent agent-child (new)`,
      '[done]'
    ]));

    const afterDone = await runner(['poll']);
    const wake = afterDone.decisions.find((d) => d.kind === 'wake' && d.followUpTo === parent.id);
    expect(wake, 'a wake row was minted for the parent').toBeTruthy();
    expect(wake.decision).toBe('take');
    const tw = await runner(['take', wake.id]);
    expect(tw.handoff).toMatchObject({ mode: 'continue', agentId: 'agent-parent', rootItemId: parent.id });
    await runner(['handoff', wake.id, 'agent-parent']);
    await runner(['feedback', wake.id, 'status', '[done]']);
    const wakeWatch = await watch(request, wake.id);
    // NB1: the wake's feedback joins the parent's lineage.
    expect(wakeWatch.feedback.every((f) => f.rootItemId === parent.id)).toBe(true);
  });

  test('B1: a non-owner item with the owner\'s kickoff as sessionId is left queued, never taken, and mints no wake', async ({ request, playwright }) => {
    const kickoff = await enqueue(request, { prompt: 'owner kickoff' });
    await runner(['poll']);
    await runner(['take', kickoff.id]);
    await runner(['handoff', kickoff.id, 'agent-kickoff']);

    // A second account, in its own cookie jar.
    const other = await playwright.request.newContext({ baseURL: BASE });
    let foreign;
    try {
      // LIN-3136 (ledger A6): the stranger is a non-owner MEMBER of this urlKey
      // and enqueues through the session dispatch route; a non-owner cannot hold
      // an enqueue-capable proxy token any more.
      const features = encodeURIComponent(JSON.stringify({ dispatch: true }));
      expect((await other.get(`/test/set-session?urlKey=${urlKey}&features=${features}`)).ok()).toBe(true);
      const strangerId = (await (await other.get('/test/session-account')).json()).accountId;
      expect(strangerId).toBeTruthy();
      expect(strangerId).not.toBe(ownerAccountId);
      const res = await other.post(`/workspace/${urlKey}/api/dispatch`, {
        headers: { 'Content-Type': 'application/json' },
        data: { prompt: 'stranger work', promptName: 'Stranger', harness: 'claude-code', target: 'cli', sessionId: kickoff.id, subscription: 'terminal-only' }
      });
      expect(res.status(), await res.text()).toBe(201);
      foreign = (await res.json()).item;
      expect((await watch(request, foreign.id)).dispatchedBy).toBe(strangerId);
    } finally {
      await other.dispose();
    }

    const polled = await runner(['poll']);
    const d = polled.decisions.find((x) => x.id === foreign.id);
    expect(d.decision).toBe('leave');
    expect(d.reason).toBe('not-owner');
    await expect(runner(['take', foreign.id])).rejects.toThrow(/poll/);

    const stillQueued = await runner(['poll']);
    expect(stillQueued.decisions.some((x) => x.id === foreign.id)).toBe(true);
    expect(stillQueued.decisions.some((x) => x.kind === 'wake' && x.followUpTo === kickoff.id)).toBe(false);
    const foreignWatch = await watch(request, foreign.id);
    expect(foreignWatch.feedback).toEqual([]);
  });

  test('an abort row closes a live item: [aborted] on the abort row and on the target', async ({ request }) => {
    const target = await enqueue(request, { prompt: 'long step' });
    await runner(['poll']);
    await runner(['take', target.id]);
    await runner(['handoff', target.id, 'agent-long']);

    const abortRes = await request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      data: { abort: true, abortTo: target.id }
    });
    expect(abortRes.status()).toBe(201);
    const abortRow = await abortRes.json();

    await runner(['poll']);
    const r = await runner(['take', abortRow.id]);
    expect(r.abort.stopAgent).toBe('agent-long');
    const line = `[aborted] Cancelled running session ${target.id.slice(0, 8)} (running).`;
    expect((await watch(request, abortRow.id)).feedback.map((f) => f.message)).toContain(line);
    expect((await watch(request, target.id)).feedback.map((f) => f.message)).toContain(line);
  });

  test('a stop halt leaves fresh items queued', async ({ request }) => {
    const auth = { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' };
    const set = await request.post('/api/proxy/dispatch/halt', { headers: auth, data: { mode: 'stop' } });
    expect(set.status()).toBe(200);
    try {
      const fresh = await enqueue(request, { prompt: 'fresh under stop' });
      const polled = await runner(['poll']);
      const d = polled.decisions.find((x) => x.id === fresh.id);
      expect(d.decision).toBe('leave');
      expect(d.reason).toBe('halt:stop');
      await expect(runner(['take', fresh.id])).rejects.toThrow(/poll/);
      expect((await watch(request, fresh.id)).status).toBe('queued');
    } finally {
      await request.delete('/api/proxy/dispatch/halt', { headers: auth });
    }
  });
});

/**
 * LIN-3211 — the runtime witness for a runner-taken item with a token in prose.
 *
 * On HEAD the run-step rung enqueued through the SESSION route with
 * `attachProxy:true` and no harness. That route keeps the LIN-1111 null
 * passthrough (`applyDefaultHarness:false`), so `attachProxyContext` took the
 * prose branch: a live bootstrap in the prompt text and `bootstrapToken` null.
 * The runner then took it with `apiAccess:false` and would have handed the
 * token to a subagent verbatim. The fix: `poll` leaves it, reason
 * `credential-in-prose`, and it stays queued (B1).
 *
 * The workspace is pinned to NO `dispatchDefaults` harness, or the factory
 * fills `claude-code`, the item takes the MCP branch, and the witness passes on
 * HEAD for the wrong reason. The stored harness is asserted null first.
 */
const EXCHANGE_LINE_RE = /curl -X POST -H "Authorization: Bearer ([A-Za-z0-9_-]{43})" \S+\/api\/proxy\/token/;

async function enqueueViaSession(page, data) {
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    headers: { 'Content-Type': 'application/json' },
    data: { promptName: 'Implementation', target: 'cli', attachProxy: true, ...data }
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).item;
}

async function storedPrompt(request, id) {
  const res = await request.get(`/api/proxy/dispatch/${id}/prompt`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect(res.status()).toBe(200);
  return (await res.json()).prompt;
}

test.describe('LIN-3211: a runner never takes an item whose prompt carries a credential in prose', () => {
  test.beforeEach(async ({ request }) => {
    // Pin: this workspace has no dispatchDefaults, so a blank harness stays null.
    expect((await request.get(`/test/set-workspace-model?urlKey=${urlKey}`)).ok()).toBe(true);
  });

  test('the rung\'s harness-less session-route item is left with credential-in-prose, never taken, still queued', async ({ page, request }) => {
    // What the run-step rung sent on HEAD: attachProxy, no harness.
    const queued = await enqueueViaSession(page, { prompt: 'rung step' });

    // Precondition: the stored harness is null, so attachProxyContext took the
    // prose branch and the token is in the prompt text.
    const before = await watch(request, queued.id);
    expect(before.harness).toBeNull();
    const prompt = await storedPrompt(request, queued.id);
    const m = prompt.match(EXCHANGE_LINE_RE);
    expect(m, 'precondition: the stored prompt carries the prose exchange line').toBeTruthy();
    const token = m[1];

    const polled = await runner(['poll']);
    const d = polled.decisions.find((x) => x.id === queued.id);
    expect(d, 'poll decided the item').toBeTruthy();
    // HEAD: { decision: 'take', reason: 'confirmed', apiAccess: false }.
    expect(d).toMatchObject({ decision: 'leave', reason: 'credential-in-prose', harness: null, apiAccess: false });
    const raw = JSON.stringify(polled);
    expect(raw).not.toContain(token);
    expect(raw).not.toMatch(/api\/proxy\/token/);

    await expect(runner(['take', queued.id])).rejects.toThrow(/was not approved by the last poll/);
    const after = await watch(request, queued.id);
    expect(after.status).toBe('queued');
    expect(after.feedback).toEqual([]);
  });

  test('control: the same enqueue with harness claude-code is taken with a broker and no token in the prompt', async ({ page, request }) => {
    const queued = await enqueueViaSession(page, { prompt: 'rung step (claude-code)', harness: 'claude-code' });
    expect((await watch(request, queued.id)).harness).toBe('claude-code');

    const polled = await runner(['poll']);
    const d = polled.decisions.find((x) => x.id === queued.id);
    expect(d).toMatchObject({ decision: 'take', apiAccess: true });

    const taken = await runner(['take', queued.id]);
    expect(taken.broker?.socket).toBeTruthy();
    expect(taken.environment).toContain(`--unix-socket ${taken.broker.socket}`);
    expect(taken.environment).toContain('You never hold a token.');
    expect(taken.prompt).toContain('rung step (claude-code)');
    expect(taken.prompt).not.toMatch(EXCHANGE_LINE_RE);
    expect(taken.prompt).not.toMatch(/api\/proxy\/token/);
  });
});
