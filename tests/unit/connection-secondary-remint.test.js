/**
 * LIN-3774 — lib/connection-secondary-remint.js: the freshness / re-mint seam for
 * a SECONDARY (non-active) connection-backed GitHub-family binding.
 *
 * Real createConnectionAccess + createConnectionRefresher over an in-memory
 * connection store; the provider's `refreshCredential` and the Linear exchange
 * are counting stubs. The expiry is always written through `setBindingCredential`
 * (the hydrated side-table), never onto the binding, so a wrong read cannot pass.
 *
 * Run: node --test tests/unit/connection-secondary-remint.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createConnectionAccess, createConnectionRefresher, rehydrateBindingAfterRefresh } from '../../lib/connection-credential.js';
import { createSecondaryBindingRemint } from '../../lib/connection-secondary-remint.js';
import { setBindingCredential, readBindingCredential } from '../../lib/connection-binding.js';
import { TOKEN_REFRESH_BUFFER_MS } from '../../lib/workspace-token-resolver.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

const NOW = 1_800_000_000_000;
const ACCT = 'acct-1';
const GH_CONN = `${ACCT}::github::142745078`;
const LIN_CONN = `${ACCT}::linear::org-1`;

function rig({ remintThrows = false, remintNull = false } = {}) {
  const counts = { githubRemint: 0, linearExchange: 0 };
  const rows = {
    [GH_CONN]: { _id: GH_CONN, provider: 'github', unitId: '142745078', credentials: { installationId: '142745078', token: 'stale-row' }, referents: [] },
    [LIN_CONN]: { _id: LIN_CONN, provider: 'linear', unitId: 'org-1', credentials: { token: 'lin' }, referents: [] },
  };
  const connectionStore = {
    readConnectionById: async (id) => rows[id] ?? null,
    updateCredentials: async (id, patch) => { rows[id].credentials = { ...rows[id].credentials, ...patch }; },
  };
  const resolveProvider = () => ({
    refreshCredential: async () => {
      counts.githubRemint++;
      if (remintThrows) throw new Error('GitHub App JWT rejected');
      if (remintNull) return null;
      return { token: `fresh-${counts.githubRemint}`, tokenExpiresAt: NOW + 3_600_000 };
    },
  });
  const refreshConnection = createConnectionRefresher({
    connectionStore,
    ownerCredentialStore: { getByConnection: async () => null },
    resolveProvider,
    refreshAccessToken: async () => { counts.linearExchange++; return {}; },
    now: () => NOW,
    evict: () => {},
    lifecycleEventStore: { recordEvent: async () => {} },
  });
  const access = createConnectionAccess({
    connectionStore,
    ownerCredentialStore: { getByConnection: async () => null },
    refreshConnection,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => null,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: TOKEN_REFRESH_BUFFER_MS,
    now: () => NOW,
  });
  const seam = createSecondaryBindingRemint({
    refreshConnectionForWorkspace: (...args) => access.refreshConnectionForWorkspace(...args),
    applyRefreshed: rehydrateBindingAfterRefresh,
    now: () => NOW,
    logger: { error: () => {} },
  });
  return { counts, rows, seam };
}

/** A Linear-primary workspace with a secondary GitHub binding, hydrated like a request. */
function workspace({ ghExpiry = NOW - 1000, hydrated = true, ghExtra = {}, bindingTokenExpiresAt } = {}) {
  const linear = { provider: 'linear', scope: 'org-1', connectionId: LIN_CONN };
  const github = { provider: 'github', scope: 'JKershaw/LinearViewer', connectionId: GH_CONN, ...ghExtra };
  if (bindingTokenExpiresAt !== undefined) github.tokenExpiresAt = bindingTokenExpiresAt;
  setBindingCredential(linear, { token: 'lin-token', tokenExpiresAt: NOW + 3_600_000 });
  if (hydrated) setBindingCredential(github, { token: 'stale-token', tokenExpiresAt: ghExpiry });
  return { id: 'org-1', urlKey: 'linearviewer', provider: 'linear', activeBinding: { provider: 'linear', scope: 'org-1' }, bindings: [linear, github] };
}

describe('LIN-3774 isSecondaryRemintable', () => {
  test('a hydrated, connection-backed GitHub binding that is not active is in scope', () => {
    const { seam } = rig();
    const ws = workspace();
    assert.equal(seam.isSecondaryRemintable(ws, ws.bindings[1]), true);
  });

  test('the active binding, a legacy binding, a refresh-token kind and an unhydrated binding are out', () => {
    const { seam } = rig();
    const ws = workspace();
    assert.equal(seam.isSecondaryRemintable(ws, ws.bindings[0]), false, 'active (and refresh-token kind)');
    assert.equal(seam.isSecondaryRemintable(ws, { provider: 'github', scope: 'o/r', credentials: { token: 't' } }), false, 'legacy');
    const jira = { provider: 'jira', scope: 'https://x.atlassian.net', connectionId: `${ACCT}::jira::x` };
    setBindingCredential(jira, { token: 't' });
    assert.equal(seam.isSecondaryRemintable(ws, jira), false, 'refresh-token kind');
    const unhydrated = workspace({ hydrated: false });
    assert.equal(seam.isSecondaryRemintable(unhydrated, unhydrated.bindings[1]), false, 'unhydrated');
    assert.equal(seam.isSecondaryRemintable(ws, null), false);
  });
});

describe('LIN-3774 ensureFresh (proactive)', () => {
  test('an expired secondary is re-minted once, its binding credential is updated, and Linear is never exchanged', async () => {
    const { seam, counts } = rig();
    const ws = workspace({ ghExpiry: NOW - 1000 });
    const github = ws.bindings[1];
    assert.equal(await seam.ensureFresh(ws, github, ACCT), true);
    assert.equal(counts.githubRemint, 1);
    assert.equal(counts.linearExchange, 0);
    assert.deepEqual(readBindingCredential(github), { token: 'fresh-1', tokenExpiresAt: NOW + 3_600_000 });
    assert.equal(readBindingCredential(ws.bindings[0]).token, 'lin-token', 'the active binding is untouched');
  });

  test('reads the hydrated side-table expiry, not binding.tokenExpiresAt: a stale field with a fresh side-table is not re-minted', async () => {
    const { seam, counts } = rig();
    const ws = workspace({ ghExpiry: NOW + 3_600_000, bindingTokenExpiresAt: NOW - 1000 });
    assert.equal(await seam.ensureFresh(ws, ws.bindings[1], ACCT), false);
    assert.equal(counts.githubRemint, 0);
  });

  test('...and the reverse: a fresh-looking binding field with an expired side-table IS re-minted', async () => {
    const { seam, counts } = rig();
    const ws = workspace({ ghExpiry: NOW - 1000, bindingTokenExpiresAt: NOW + 3_600_000 });
    assert.equal(await seam.ensureFresh(ws, ws.bindings[1], ACCT), true);
    assert.equal(counts.githubRemint, 1);
  });

  test('a missing, NaN or string expiry skips with zero re-mints', async () => {
    for (const ghExpiry of [undefined, NaN, String(NOW - 1000), null]) {
      const { seam, counts } = rig();
      const ws = workspace();
      setBindingCredential(ws.bindings[1], ghExpiry === undefined ? { token: 'stale-token' } : { token: 'stale-token', tokenExpiresAt: ghExpiry });
      assert.equal(await seam.ensureFresh(ws, ws.bindings[1], ACCT), false, `expiry ${String(ghExpiry)}`);
      assert.equal(counts.githubRemint, 0);
    }
  });

  test('a token with time to spare is not re-minted; the boundary is the buffer', async () => {
    const outside = rig();
    const wsOut = workspace({ ghExpiry: NOW + TOKEN_REFRESH_BUFFER_MS });
    assert.equal(await outside.seam.ensureFresh(wsOut, wsOut.bindings[1], ACCT), false, 'exactly bufferMs left: fresh');
    const inside = rig();
    const wsIn = workspace({ ghExpiry: NOW + TOKEN_REFRESH_BUFFER_MS - 1 });
    assert.equal(await inside.seam.ensureFresh(wsIn, wsIn.bindings[1], ACCT), true, 'one ms inside the buffer: re-mint');
  });

  test('a null or throwing re-mint does not throw and reports false', async () => {
    for (const opts of [{ remintNull: true }, { remintThrows: true }]) {
      const { seam, counts } = rig(opts);
      const ws = workspace();
      assert.equal(await seam.ensureFresh(ws, ws.bindings[1], ACCT), false);
      assert.equal(counts.githubRemint, 1);
      assert.equal(readBindingCredential(ws.bindings[1]).token, 'stale-token', 'the old token is left in place');
    }
  });

  test('an unhydrated binding is never re-minted, whatever its expiry', async () => {
    const { seam, counts } = rig();
    const ws = workspace({ hydrated: false });
    assert.equal(await seam.ensureFresh(ws, ws.bindings[1], ACCT), false);
    assert.equal(counts.githubRemint, 0);
  });

  test('ensureFreshAll re-mints every stale secondary and nothing else', async () => {
    const { seam, counts } = rig();
    const ws = workspace();
    const second = { provider: 'github-projects', scope: 'JKershaw/2', connectionId: GH_CONN };
    setBindingCredential(second, { token: 'stale-2', tokenExpiresAt: NOW - 5 });
    ws.bindings.push(second);
    await seam.ensureFreshAll(ws, ACCT);
    assert.equal(counts.githubRemint, 2);
    assert.equal(counts.linearExchange, 0);
    assert.equal(readBindingCredential(ws.bindings[0]).token, 'lin-token');
  });
});

describe('LIN-3774 remint (reactive) and the attempt cap', () => {
  test('remint is unconditional on expiry but still gated by the scope predicate', async () => {
    const { seam, counts } = rig();
    const ws = workspace({ ghExpiry: NOW + 3_600_000 });
    assert.equal(await seam.remint(ws, ws.bindings[1], ACCT), true);
    assert.equal(counts.githubRemint, 1);
    assert.equal(await seam.remint(ws, ws.bindings[0], ACCT), false, 'active binding');
    const unhydrated = workspace({ hydrated: false });
    assert.equal(await seam.remint(unhydrated, unhydrated.bindings[1], ACCT), false);
    assert.equal(counts.githubRemint, 1);
  });

  test('a failing re-mint costs exactly 2 attempts per page load: ensureFresh + remint + ensureFresh', async () => {
    const { seam, counts } = rig({ remintThrows: true });
    const ws = workspace();
    const github = ws.bindings[1];
    await seam.ensureFresh(ws, github, ACCT);
    await seam.remint(ws, github, ACCT);
    await seam.ensureFresh(ws, github, ACCT);
    assert.equal(counts.githubRemint, 2);
  });

  test('the retry pass does not repeat the proactive check for a binding just re-minted', async () => {
    const { seam, counts } = rig();
    const ws = workspace();
    await seam.remint(ws, ws.bindings[1], ACCT);
    // simulate a token that reads as stale again
    setBindingCredential(ws.bindings[1], { token: 'x', tokenExpiresAt: NOW - 1 });
    await seam.ensureFresh(ws, ws.bindings[1], ACCT);
    assert.equal(counts.githubRemint, 1);
  });
});

describe('LIN-3774 bindingForError', () => {
  test('maps a tag to the live in-scope binding object', () => {
    const { seam } = rig();
    const ws = workspace();
    const tag = { provider: 'github', scope: 'JKershaw/LinearViewer', connectionId: GH_CONN };
    assert.equal(seam.bindingForError(ws, { binding: tag }), ws.bindings[1]);
  });

  test('null for no tag, the active binding, a connectionId mismatch, and an unhydrated binding', () => {
    const { seam } = rig();
    const ws = workspace();
    assert.equal(seam.bindingForError(ws, new Error('x')), null);
    assert.equal(seam.bindingForError(ws, null), null);
    assert.equal(seam.bindingForError(ws, { binding: { provider: 'linear', scope: 'org-1', connectionId: LIN_CONN } }), null);
    assert.equal(seam.bindingForError(ws, { binding: { provider: 'github', scope: 'JKershaw/LinearViewer', connectionId: 'other' } }), null);
    const unhydrated = workspace({ hydrated: false });
    assert.equal(seam.bindingForError(unhydrated, { binding: { provider: 'github', scope: 'JKershaw/LinearViewer', connectionId: GH_CONN } }), null);
  });
});

describe('LIN-3774 rehydrateBindingAfterRefresh', () => {
  test('writes only the named binding and ignores a legacy binding or an empty result', () => {
    const ws = workspace();
    assert.equal(rehydrateBindingAfterRefresh(ws.bindings[1], { token: 'n', expiresAt: 5 }), true);
    assert.deepEqual(readBindingCredential(ws.bindings[1]), { token: 'n', tokenExpiresAt: 5 });
    assert.equal(rehydrateBindingAfterRefresh({ provider: 'github', credentials: {} }, { token: 'n' }), false);
    assert.equal(rehydrateBindingAfterRefresh(ws.bindings[1], null), false);
  });
});

test('LIN-3774 the module imports TOKEN_REFRESH_BUFFER_MS rather than redefining it', () => {
  const src = readFileSync(new URL('../../lib/connection-secondary-remint.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ TOKEN_REFRESH_BUFFER_MS \} from '\.\/workspace-token-resolver\.js'/);
  assert.doesNotMatch(src, /5 \* 60 \* 1000/);
});
