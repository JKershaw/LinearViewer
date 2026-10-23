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
const JIRA_CONN = `${ACCT}::jira::x`;

function rig({ remintThrows = false, remintNull = false } = {}) {
  const counts = { githubRemint: 0, linearExchange: 0, jiraExchange: 0 };
  // LIN-3790: every call into the injected refreshConnectionForWorkspace.
  const calls = [];
  const rows = {
    [GH_CONN]: { _id: GH_CONN, provider: 'github', unitId: '142745078', credentials: { installationId: '142745078', token: 'stale-row' }, referents: [] },
    [LIN_CONN]: { _id: LIN_CONN, provider: 'linear', unitId: 'org-1', credentials: { token: 'lin' }, referents: [] },
    [JIRA_CONN]: { _id: JIRA_CONN, provider: 'jira', unitId: 'x', credentials: { token: 'jira' }, referents: [] },
  };
  const connectionStore = {
    readConnectionById: async (id) => rows[id] ?? null,
    updateCredentials: async (id, patch) => { rows[id].credentials = { ...rows[id].credentials, ...patch }; },
  };
  // LIN-3790: a durable owner record for the Jira Connection, so a refresh-token-kind
  // secondary renews through the real runConnectionRefresh.
  const owner = { [JIRA_CONN]: { provider: 'jira', scope: 'x', token: 'jira', refreshToken: 'rt-1', tokenExpiresAt: NOW - 1000 } };
  const ownerCredentialStore = {
    getByConnection: async (id) => owner[id] ?? null,
    markSpendIntentByConnection: async () => {},
    clearSpendIntentByConnection: async () => {},
    putIfRefreshTokenByConnection: async (id, attempted, record) => {
      if (owner[id]?.refreshToken !== attempted) return false;
      owner[id] = record;
      return true;
    },
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
    ownerCredentialStore,
    resolveProvider,
    refreshAccessToken: async () => { counts.linearExchange++; return {}; },
    resolveExchange: (provider) => (provider === 'jira'
      ? async () => { counts.jiraExchange++; return { access_token: 'fresh-jira', refresh_token: 'rt-2', expires_in: 3600 }; }
      : null),
    now: () => NOW,
    evict: () => {},
    lifecycleEventStore: { recordEvent: async () => {} },
  });
  const access = createConnectionAccess({
    connectionStore,
    ownerCredentialStore,
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
    refreshConnectionForWorkspace: (connection, ...rest) => {
      calls.push({ connection });
      return access.refreshConnectionForWorkspace(connection, ...rest);
    },
    applyRefreshed: rehydrateBindingAfterRefresh,
    now: () => NOW,
    logger: { error: () => {} },
  });
  return { counts, rows, seam, calls };
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

describe('LIN-3774 / LIN-3790 isSecondaryRenewable', () => {
  test('a hydrated, connection-backed GitHub binding that is not active is renewable', () => {
    const { seam } = rig();
    const ws = workspace();
    assert.equal(seam.isSecondaryRenewable(ws, ws.bindings[1]), true);
  });

  test('LIN-3790: a hydrated connection-backed refresh-token kind (Jira, Linear) that is not active is renewable', () => {
    const { seam } = rig();
    const ws = workspace();
    const jira = { provider: 'jira', scope: 'https://x.atlassian.net', connectionId: `${ACCT}::jira::x` };
    setBindingCredential(jira, { token: 't', tokenExpiresAt: NOW - 1 });
    assert.equal(seam.isSecondaryRenewable(ws, jira), true, 'jira');
    const gh = { provider: 'github', scope: 'o/r', connectionId: GH_CONN };
    setBindingCredential(gh, { token: 't' });
    const lin = { provider: 'linear', scope: 'org-2', connectionId: `${ACCT}::linear::org-2` };
    setBindingCredential(lin, { token: 't' });
    const ghPrimary = { id: 'w', provider: 'github', activeBinding: { provider: 'github', scope: 'o/r' }, bindings: [gh, lin] };
    assert.equal(seam.isSecondaryRenewable(ghPrimary, lin), true, 'linear under a github primary');
  });

  test('the active binding, a legacy binding and an unhydrated binding are not renewable', () => {
    const { seam } = rig();
    const ws = workspace();
    assert.equal(seam.isSecondaryRenewable(ws, ws.bindings[0]), false, 'active');
    assert.equal(seam.isSecondaryRenewable(ws, { provider: 'github', scope: 'o/r', credentials: { token: 't' } }), false, 'legacy');
    assert.equal(seam.isSecondaryRenewable(ws, { provider: 'jira', scope: 'https://x', credentials: { token: 't' } }), false, 'legacy jira');
    const unhydrated = workspace({ hydrated: false });
    assert.equal(seam.isSecondaryRenewable(unhydrated, unhydrated.bindings[1]), false, 'unhydrated');
    assert.equal(seam.isSecondaryRenewable(ws, null), false);
  });
});

describe('LIN-3790 isSecondaryBinding', () => {
  test('any connection-backed non-active binding is a secondary, hydrated or not; the active one is not', () => {
    const { seam } = rig();
    const ws = workspace();
    assert.equal(seam.isSecondaryBinding(ws, ws.bindings[1]), true);
    assert.equal(seam.isSecondaryBinding(ws, ws.bindings[0]), false, 'active');
    const unhydrated = workspace({ hydrated: false });
    assert.equal(seam.isSecondaryBinding(unhydrated, unhydrated.bindings[1]), true, 'unhydrated');
  });

  test('a legacy binding of another kind than the primary is a secondary', () => {
    const { seam } = rig();
    const ws = { id: 'w', provider: 'linear', bindings: [] };
    for (const provider of ['github', 'github-projects', 'jira']) {
      assert.equal(seam.isSecondaryBinding(ws, { provider, scope: 's', credentials: { token: 't' } }), true, provider);
    }
  });

  test('a legacy binding of the PRIMARY kind is not a secondary, including when workspace.provider is undefined', () => {
    const { seam } = rig();
    const legacyLinear = { provider: 'linear', scope: 'org-1', credentials: { token: 'lin' } };
    assert.equal(seam.isSecondaryBinding({ id: 'w', provider: 'linear', bindings: [legacyLinear] }, legacyLinear), false);
    // isActiveBinding would call this binding "not active" (un-normalised provider compare).
    assert.equal(seam.isSecondaryBinding({ id: 'w', bindings: [legacyLinear] }, legacyLinear), false, 'undefined provider normalises to linear');
    assert.equal(seam.isSecondaryBinding({ id: 'w' }, null), false);
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

  test('LIN-3790: an expired connection-backed Jira OAuth secondary is renewed once via refreshConnectionForWorkspace, not re-minted as GitHub', async () => {
    const { seam, counts, calls } = rig();
    const ws = workspace();
    const jira = { provider: 'jira', scope: 'https://x.atlassian.net', connectionId: `${ACCT}::jira::x` };
    setBindingCredential(jira, { token: 'stale-jira', tokenExpiresAt: NOW - 1000 });
    ws.bindings.push(jira);
    assert.equal(await seam.ensureFresh(ws, jira, ACCT), true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].connection, { _id: JIRA_CONN, provider: 'jira' });
    assert.equal(counts.jiraExchange, 1);
    assert.equal(counts.githubRemint, 0);
    assert.equal(counts.linearExchange, 0);
    assert.equal(readBindingCredential(jira).token, 'fresh-jira');
    assert.equal(readBindingCredential(ws.bindings[0]).token, 'lin-token', 'the active binding is untouched');
  });

  test('LIN-3790: an expired legacy secondary is never touched by ensureFresh', async () => {
    const { seam, calls } = rig();
    const ws = workspace();
    const legacy = { provider: 'github', scope: 'o/r', credentials: { token: 'stale', tokenExpiresAt: NOW - 1000 } };
    ws.bindings.push(legacy);
    assert.equal(await seam.ensureFresh(ws, legacy, ACCT), false);
    assert.equal(await seam.remint(ws, legacy, ACCT), false);
    assert.equal(calls.length, 0);
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

  test('null for no tag, the active binding and a connectionId mismatch; an unhydrated secondary resolves (LIN-3790)', () => {
    const { seam } = rig();
    const ws = workspace();
    assert.equal(seam.bindingForError(ws, new Error('x')), null);
    assert.equal(seam.bindingForError(ws, null), null);
    assert.equal(seam.bindingForError(ws, { binding: { provider: 'linear', scope: 'org-1', connectionId: LIN_CONN } }), null);
    assert.equal(seam.bindingForError(ws, { binding: { provider: 'github', scope: 'JKershaw/LinearViewer', connectionId: 'other' } }), null);
    // LIN-3790: an unhydrated secondary is still a SECONDARY (it degrades, renewal
    // is a no-op), so it resolves; it used to be null and took the active ladder.
    const unhydrated = workspace({ hydrated: false });
    assert.equal(seam.bindingForError(unhydrated, { binding: { provider: 'github', scope: 'JKershaw/LinearViewer', connectionId: GH_CONN } }), unhydrated.bindings[1]);
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
