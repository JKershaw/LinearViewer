/**
 * Refresh-on-resolve for the agent/proxy token path (LIN-1373; provider-aware
 * routing added LIN-1499 Phase 1; Linear moved to the durable store LIN-1524).
 *
 * Before LIN-1373, `resolveWorkspaceAccess` (server.js) only ever READ sessions
 * via the pure selector (lib/workspace-token-resolver.js) — a headless proxy
 * token stopped resolving the moment its creating human's access token lapsed,
 * because only human web activity (`ensureValidToken`, server.js) ever refreshed
 * it. This module is the caller-side refresh.
 *
 * Branches by `workspace.provider` (or, for the Linear arm, the durable
 * record's own `provider`), mirroring the arm-for-arm shape at `server.js`'s
 * `ensureValidToken`:
 *
 * - GitHub-family (`github`, `github-projects`) stays exactly as it was:
 *   session/binding-resident, found via the pure sibling selector
 *   `selectExpiredOwnerRow` (untouched — its GitHub-family arm needs no
 *   durable secret, LIN-1523/1524 scope boundary), re-minted from the App JWT
 *   + `installationId` via `remintActiveCredential`, persisted back to the
 *   session row.
 * - Linear (LIN-1524) no longer has a session row to find: `updateWorkspaceTokens`/
 *   `linkProvider` stopped writing `refreshToken` to the session entirely, so
 *   `selectExpiredOwnerRow`'s Linear arm (which requires `ws.refreshToken` on
 *   the row) is now structurally unreachable for it — a byte-identical,
 *   dead-in-practice branch, not a bug (its own A1-A8 tests still exercise the
 *   pure logic against hand-built fixtures that set the field directly). The
 *   REAL Linear arm here is a point-read against the durable store —
 *   `store.get(ownerAccountId, urlKey, provider)`, provider-partitioned since
 *   LIN-1887 N2 — the durable sibling of that session
 *   scan: same "is there something refreshable for this owner+workspace"
 *   question, asked of the other storage. Reached whenever the row isn't a
 *   GitHub-family one — covering BOTH a `session_expired` Linear row (which
 *   this arm ignores in favor of the durable record, now the sole source of
 *   truth) and `not_connected` (no session row at all, e.g. after logout).
 *   When the owner DOES still have a session row (the `session_expired`
 *   case), the fresh accessToken/tokenExpiresAt are mirrored into EVERY such
 *   row as a pure cache via the separate pure sibling `selectAllOwnerSessionRows`
 *   (LIN-2235; no refreshability filter — unlike `selectExpiredOwnerRow`, it
 *   only answers "which rows exist to mirror into") — never the refreshToken,
 *   and never required for the refresh itself to succeed. `selectOwnerSessionRow`
 *   is read separately, earlier, to choose which durable partition to refresh
 *   in the first place (see `headlessRefreshProvider` below) — not to mirror.
 *
 * The provider instance is supplied by an INJECTED `resolveProvider`
 * dependency (never imported directly here) so this module keeps its
 * all-IO-injected contract and never couples to the import-order-sensitive
 * provider registry (lib/providers/registry.js).
 *
 * All IO is injected (refreshAccessToken, persistSession, resolveProvider,
 * store) so this is unit-testable with fakes and integration-testable
 * without booting server.js.
 */
import { selectExpiredOwnerRow, selectOwnerSessionRow, selectAllOwnerSessionRows, TOKEN_REFRESH_BUFFER_MS } from './workspace-token-resolver.js';
import { remintActiveCredential, getWorkspaceCallScope, normalizeProvider, normalizeProviderName } from './workspace.js';
import { calculateExpiresAt, isDefinitiveRevocation, TokenRefreshError } from './token-refresh.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from './credential-lifecycle-events.js';

// Per-(ownerAccountId, urlKey, provider) single-flight for the OAuth-refresh +
// durable CAS core, mirroring lib/openrouter-catalog.js's inflight-promise
// coalescing precedent. Concurrent refreshes for the same owner's same
// workspace — across ALL THREE refresh entrants (proactive-human
// `ensureValidToken`, reactive-401-human `handleTokenRefreshAndRetry`, and the
// headless resolve path here), unified in LIN-1546 from the previously
// headless-only coalescing — share one round-trip and one durable write instead
// of racing to rotate the same refresh token (which would strand the loser with
// a spent, already-rotated one and, via LIN-1545's delete-on-EXPIRED guard,
// delete the winner's healthy credential). This closes the SAME-PROCESS race;
// cross-process (cross-dyno) races share no map and are the durable CAS +
// re-read's job below. The entry is removed once the refresh settles — success
// or failure — so a later, independent lapse still triggers its own refresh.
//
// LIN-1887 N1: the `::${provider}` component is NOT cosmetic symmetry with the
// store's partitioned `_id` — it is a defect introduced by that partition and
// fixed here in the same change. With two partitioned records live on one
// workspace (Linear + Jira, the only configuration this add-source-only phase
// produces), a two-part key coalesces a concurrent Linear and Jira refresh onto
// ONE promise, and the loser is handed the winner's credential: the Jira caller
// receives Linear's freshly-minted access token AND Linear's scope, which
// `applyAccessTokenToWorkspace` then mirrors onto the workspace and the headless
// arm threads into `getWorkspaceCallScope`.
const inflight = new Map(); // `${ownerAccountId}::${urlKey}::${provider}` -> Promise

// LIN-2236 (L5.1 of the LIN-2231 design): every logging call in this module
// goes through this one helper so the "optional, never throws, never blocks
// the refresh it rode in on" contract lives in exactly one place.
// `lifecycleEventStore` is OPTIONAL and additive (mirrors `mergeLogStore` on
// AccountStore.mergeAccounts, LIN-2233) — every existing caller that doesn't
// pass one keeps working byte-identically, with no event recorded.
async function recordLifecycleEvent(lifecycleEventStore, event) {
  if (!lifecycleEventStore) return;
  await lifecycleEventStore.recordEvent(event);
}

/**
 * Which durable partition does this workspace's headless refresh belong to?
 *
 * The headless lane has no `req.session.workspaces` to read an active provider
 * off, only the raw session rows it already loaded. When the owner still has a
 * row for this workspace (`session_expired`) that row names the provider; when
 * they have none (`not_connected`, e.g. after logout) there is nothing to read
 * and this falls back to `'linear'` — byte-identical to the pre-LIN-1887
 * behaviour, which read the single unpartitioned record unconditionally.
 *
 * The fallback is honest rather than complete: a Jira-OAuth workspace whose
 * owner has logged out resolves to the Linear partition, misses, and surfaces
 * "nothing refreshable" — the same non-destructive outcome a Jira workspace got
 * on this lane before this ticket. It is never destructive, and never reads
 * another provider's partition.
 */
function headlessRefreshProvider(sessions, urlKey, ownerAccountId) {
  const ownerRow = selectOwnerSessionRow(sessions, urlKey, ownerAccountId);
  if (!ownerRow) return 'linear';
  return normalizeProvider(ownerRow.session.workspaces[ownerRow.workspaceIndex]);
}

async function doRefresh({ sessions, urlKey, ownerAccountId, refreshAccessToken, resolveExchange, persistSession, resolveProvider, store, fetchImpl, now, lifecycleEventStore }) {
  const row = selectExpiredOwnerRow(sessions, urlKey, ownerAccountId);

  // GitHub-family: unchanged, session/binding-resident (LIN-1523/1524 scope
  // boundary — no durable secret for this family, so the durable arm below
  // never applies to it).
  if (row && (row.provider === 'github' || row.provider === 'github-projects')) {
    const { sid, session, workspaceIndex } = row;
    const workspace = session.workspaces[workspaceIndex];
    await remintActiveCredential(workspace, resolveProvider(workspace), { fetchImpl, now });
    await persistSession(sid, session);
    // LIN-1891: scope is additive alongside the scalar token/provider return —
    // the structured {token, repo}/{token, scope} call scope this GitHub-family
    // workspace's headless resolution needs, mirroring getWorkspaceCallScope's
    // use on the session lane.
    return { token: workspace.accessToken, expiresAt: workspace.tokenExpiresAt, provider: workspace.provider, scope: getWorkspaceCallScope(workspace) };
  }

  // Linear-durable arm (LIN-1524): the durable record is the ONLY place a
  // rotating Linear credential lives now. `ownerAccountId` is guaranteed
  // non-UNSCOPED by the caller (server.js's resolveWorkspaceAccess), but may
  // still be a falsy real value (e.g. a legacy bootstrap token's
  // `createdBy: null`, LIN-1376) or a legacy pre-LIN-1329 session's missing
  // `session.accountId` never even reaches here in the first place — either
  // way `store.get` fails closed (its own accountId/urlKey guard) rather than
  // throwing, so this returns null exactly like "nothing to refresh" below.
  // LIN-1546: the durable read + Linear round-trip + rotation write is the
  // shared, single-flighted, race-safe core (CAS + re-read) that all three
  // refresh entrants funnel through — see `refreshOwnerCredential`. Null
  // means "nothing refreshable" (no durable record with a refreshToken), which
  // this headless path surfaces exactly as before.
  // LIN-1887 Step 8: the durable arm is no longer Linear-only. It reads THIS
  // workspace's own partition and spends its own provider's exchange, so a Jira
  // headless refresh can never read or spend the Linear partition (and vice
  // versa) — the durable half of the F1 fix, on the lane no interactive test
  // reaches.
  const provider = headlessRefreshProvider(sessions, urlKey, ownerAccountId);
  const exchange = (resolveExchange || defaultResolveExchange(refreshAccessToken))(provider);
  if (!exchange) return null;

  const refreshed = await refreshOwnerCredential({ ownerAccountId, urlKey, provider, refreshAccessToken: exchange, store, lifecycleEventStore });
  // LIN-2097 (B1): the liveness check lives HERE, not inside refreshOwnerCredential's
  // shared return — refreshOwnerCredential is also called directly by the two human
  // refresh entrants (server.js's ensureValidToken, handleTokenRefreshAndRetry), which
  // research §3 L6 scoped OUT: a byte-identical exchange that freezes to an
  // already-past `record.tokenExpiresAt` (Step 1) is exactly the shape a proactive
  // refresh hits every time it fires, and nulling it out there throws a plain Error
  // that `ensureValidToken`'s destructiveOnFailure branch treats as a real failure —
  // removing the workspace and, when it was the account's only one, destroying the
  // session. This headless path is the ONLY entrant this ticket's production evidence
  // concerns, so the null belongs on ITS return only. Still covers all three of
  // doOwnerRefresh's success returns (F3) — doRefresh always resolves through this one
  // refreshOwnerCredential call, whichever internal path produced it.
  if (refreshed && !isRefreshResultLive(refreshed)) {
    // LIN-2236 (L5.1, refresh_skip branch 3/3): the third of the three
    // previously-silent branches — doOwnerRefresh succeeded (a durable
    // record WAS refreshable), but the result freezes onto an already-past
    // expiry (LIN-2097's byte-identical-exchange guard), so it is non-live
    // and this headless caller treats it as nothing-to-serve. The other two
    // branches (cooldown-gate, no-durable-record) are logged inside
    // doOwnerRefresh/its caller — this is the one boundary check that lives
    // ONLY here, one hop downstream of the shared core.
    await recordLifecycleEvent(lifecycleEventStore, {
      accountId: ownerAccountId, urlKey, provider,
      kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SKIP,
      detail: { branch: 'frozen-expiry-non-live', expiresAt: refreshed.expiresAt },
    });
  }
  if (!refreshed || !isRefreshResultLive(refreshed)) return null;

  // Mirror accessToken/tokenExpiresAt (pure cache, NEVER refreshToken) into
  // EVERY live session row the owner has for this workspace (LIN-2235, L4.2)
  // — not just the single latest-expiring one. Linear's rotation invalidates
  // every previously-issued access token for the grant at once, so a second
  // device/browser's mirror would otherwise 401 on its next use even though
  // ITS OWN recorded tokenExpiresAt still looked fine (comment `18f2f69d`'s
  // 173-line transient burst on an otherwise-healthy credential). Same
  // `sessions` array already loaded by the caller, same `persistSession`
  // seam, just looped. No row exists for a `not_connected` owner (e.g.
  // post-logout): nothing to mirror into, which is fine — the durable record
  // alone is authoritative.
  const ownerRows = selectAllOwnerSessionRows(sessions, urlKey, ownerAccountId);
  let ownerWorkspace = null;
  for (const ownerRow of ownerRows) {
    const workspace = ownerRow.session.workspaces[ownerRow.workspaceIndex];
    workspace.accessToken = refreshed.token;
    workspace.tokenExpiresAt = refreshed.expiresAt;
    await persistSession(ownerRow.sid, ownerRow.session);
    // Any one row's mirrored copy suffices below (getWorkspaceCallScope reads
    // the workspace's own `bindings`, identical across the owner's rows for
    // the same urlKey) — the loop above is what matters, not which row wins.
    ownerWorkspace = workspace;
  }

  // Linear's return stays exactly what it was — `{token, expiresAt, provider}`,
  // no `scope`. That is deliberate, not an omission: a Linear call scope IS the
  // bare token (`getWorkspaceCallScope` returns it unchanged), so attaching the
  // durable record's `scope` — the Linear ORG id — would hand `routes/proxy.js`'s
  // provider-lane substitution an org id where it expects a credential.
  // A structured-credential provider (Jira; the github family already does this
  // on its own arm above, LIN-1891) genuinely needs the pairing, and it can only
  // be built from a live session row — which is exactly where the binding lives.
  if (provider === 'linear' || !ownerWorkspace) {
    return { token: refreshed.token, expiresAt: refreshed.expiresAt, provider: refreshed.provider };
  }
  return { token: refreshed.token, expiresAt: refreshed.expiresAt, provider: refreshed.provider, scope: getWorkspaceCallScope(ownerWorkspace) };
}

/**
 * The back-compat exchange resolver: Linear (and legacy-providerless, which
 * normalizes to it) spends the injected `refreshAccessToken`; every other
 * provider has no exchange on this lane unless the caller injects one. Keeping
 * this as the default is what makes `resolveExchange` purely additive — a
 * caller that does not pass it gets exactly the pre-LIN-1887 routing.
 */
function defaultResolveExchange(refreshAccessToken) {
  return (provider) => (provider === 'linear' ? refreshAccessToken : null);
}

/**
 * The shared, single-flighted, race-safe OAuth refresh + durable-rotation core
 * (LIN-1546, S4; parameterised by provider in LIN-1887 Step 2a). ALL THREE
 * refresh entrants — proactive-human
 * `ensureValidToken`, reactive-401-human `handleTokenRefreshAndRetry` (both in
 * server.js), and the headless `doRefresh` above — funnel their rotation
 * through this ONE seam, keyed `${ownerAccountId}::${urlKey}::${provider}`. That
 * unifies the previously headless-only single-flight so a same-process
 * human×headless collision shares one refresh instead of racing to spend the
 * same token.
 *
 * LIN-1887 Step 2a: this function was `refreshLinearOwnerCredential` and only
 * the injected `refreshAccessToken` was ever Linear-specific — the algorithm
 * (single-flight, durable read, exchange, CAS write, re-read on
 * `invalid_grant`) is the general one. It now takes the provider explicitly,
 * which selects the durable partition, the in-flight key, and — via the caller's
 * choice of exchange — which OAuth endpoint the refresh token is spent at.
 *
 * The coalesced promise owns exactly the shared, idempotent core: (i) the
 * durable read, (ii) the `refreshAccessToken` round-trip, (iii) the durable
 * compare-and-set write (`store.putIfRefreshToken`, keyed on the refreshToken we
 * read), and (iv) the re-read-on-`invalid_grant`/CAS-miss recovery. Per-request
 * work each entrant must NOT share — the human paths' session mirror onto their
 * own `req.session` workspace, the headless path's `selectAllOwnerSessionRows`
 * mirror — stays OUTSIDE this promise, in the caller, because the three entrants
 * mirror into three different objects (and the headless path may have no session
 * row at all).
 *
 * Return contract:
 * - `null` — no durable record with a refreshToken for this provider's
 *   partition, OR a record whose own `provider` disagrees with the partition it
 *   was found in (see the gate below); the caller keeps its own
 *   missing-credential behaviour.
 * - `{ token, expiresAt, refreshToken, provider, scope }` — success, INCLUDING a
 *   race loser that converged on the winner's freshly-rotated durable token
 *   (a *spurious* `EXPIRED` turned into a success by the re-read).
 * - throws `TokenRefreshError('EXPIRED')` — a GENUINE revocation that survived
 *   the re-read (the stored refreshToken is still the spent one nobody rotated),
 *   OR a record that vanished under us; so the human catches' LIN-1545 delete
 *   guard still fires — and fires ONLY — on a genuinely dead credential.
 * - throws any other `TokenRefreshError` (NETWORK/INVALID/UNKNOWN) untouched —
 *   a transient blip is never a race artifact, so it is never re-read, and the
 *   caller's transient-503 branch handles it exactly as before.
 *
 * @param {Object} deps
 * @param {string} deps.ownerAccountId - the owner the durable record is keyed on
 * @param {string} [deps.provider] - the credential's provider; selects the durable partition and the in-flight key. Legacy-normalized to `'linear'`.
 * @param {string} deps.urlKey - workspace url key
 * @param {Function} deps.refreshAccessToken - (refreshToken) => Promise<{access_token, refresh_token, expires_in}> — THIS provider's exchange
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} deps.store - the durable owner-credential store (CAS-capable)
 * @returns {Promise<{token: string, expiresAt: number, refreshToken: string, provider: string, scope: string}|null>}
 */
export function refreshOwnerCredential({ ownerAccountId, urlKey, provider, refreshAccessToken, store, lifecycleEventStore }) {
  const partition = normalizeProviderName(provider);
  const key = `${ownerAccountId}::${urlKey}::${partition}`;
  let promise = inflight.get(key);
  if (!promise) {
    promise = doOwnerRefresh({ ownerAccountId, urlKey, provider: partition, refreshAccessToken, store, lifecycleEventStore });
    inflight.set(key, promise);
    // Two-branch .then (not .finally) so the cleanup itself never produces an
    // unhandled rejection when doOwnerRefresh throws — the caller's own
    // await/catch of `promise` (returned below) is what observes the failure.
    // Registered on the raw `promise`, NOT on the wrapped promise handed back
    // below, so cleanup still fires exactly once per doOwnerRefresh invocation
    // regardless of how many callers derive their own `.then()` off it.
    promise.then(
      () => { if (inflight.get(key) === promise) inflight.delete(key); },
      () => { if (inflight.get(key) === promise) inflight.delete(key); }
    );
  }
  // LIN-2097 (B1): deliberately raw. An earlier revision nulled out a non-live
  // result HERE, but this seam is shared by all three refresh entrants — the two
  // human ones (`server.js`'s `ensureValidToken`, `handleTokenRefreshAndRetry`)
  // as well as the headless `doRefresh` above — and a non-live result reaching
  // the human entrants is converted into a plain Error that tears the workspace
  // (and, when it was the account's last, the session) down. Research §3 L6
  // scoped the human entrants OUT of this ticket. The liveness check now lives
  // only on `doRefresh`'s call site above, the one caller this ticket's
  // production evidence actually concerns.
  return promise;
}

function isRefreshResultLive(result) {
  return Number.isFinite(result.expiresAt) && result.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS;
}

// LIN-2235 (L4.1 of the LIN-2231 design, amendment A3): Linear's documented
// reuse grace on a just-rotated refresh token (comment `cefacfe2`'s docs
// finding — "rotation with a 30-minute reuse grace"). Within this window,
// replaying the same spent token is safe (Linear still honours it, per its
// own grace semantics); past it, Linear's behaviour is undocumented and
// "plausibly chain revocation" — so a spend-intent marker older than this is
// never replayed, only reported dead.
const LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS = 30 * 60 * 1000; // 30 minutes

async function doOwnerRefresh({ ownerAccountId, urlKey, provider, refreshAccessToken, store, lifecycleEventStore }) {
  const record = await store.get(ownerAccountId, urlKey, provider);
  if (!record?.refreshToken) {
    // LIN-2236 (L5.1, refresh_skip branch 2/3): nothing durable to refresh at
    // all — no record, or a record with no refreshToken. Previously silent.
    await recordLifecycleEvent(lifecycleEventStore, {
      accountId: ownerAccountId, urlKey, provider,
      kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SKIP,
      detail: { branch: 'no-durable-record' },
    });
    return null;
  }

  // LIN-1887 F1: never spend a credential at the wrong provider's endpoint.
  //
  // The partitioned `_id` already makes this unreachable for records written
  // after LIN-1887, but this gate is independent of the key and is the ONLY
  // defence against a MISLABELLED legacy record — one written by the
  // pre-partition `persistOwnerCredential`, where a Jira add-source could
  // overwrite a Linear record's `refreshToken` while leaving `provider:
  // 'linear'` stamped on it. Spending that at `api.linear.app` returns
  // `invalid_grant`, which `isDefinitiveRevocation` reads as a real revocation:
  // durable delete → `removeWorkspace` → `session.destroy()`. One line, and it
  // would have contained the entire chain on its own.
  if (normalizeProviderName(record.provider) !== provider) {
    console.warn(`Durable owner credential for ${urlKey} is labelled ${record.provider} in the ${provider} partition — refusing to refresh it`);
    return null;
  }

  const attempted = record.refreshToken;

  // LIN-2235 (L4.1, amendment A3): a `pendingSpend` marker still attached to
  // THIS refreshToken means a PRIOR attempt spent it against Linear and then
  // the process died before it could resolve the marker (success or clean
  // failure) — see `OwnerCredentialStore.markSpendIntent`'s docstring for why
  // an unresolved marker is never an ordinary failure. Deploy-overlap
  // double-spend is a standing condition on Railway (45/46 consecutive
  // deploys observed dual-live, comment `cefacfe2`), so this is a real, not
  // hypothetical, gap.
  const pending = record.pendingSpend;
  if (pending?.refreshToken === attempted) {
    const ageMs = Date.now() - new Date(pending.attemptedAt).getTime();
    if (ageMs > LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS) {
      // Past Linear's reuse grace: replaying `attempted` is no longer safe
      // (undocumented behaviour, "plausibly chain revocation" per the
      // evidence trail) — never "retry a dead token forever". Report it
      // loudly and stop, exactly like a genuine EXPIRED revocation, which is
      // what every caller of this shared core already knows how to handle
      // (the human entrants' LIN-1545 delete guard; the headless path's
      // fall-through to the ordinary 503 classification).
      console.error(`[spend-intent] credential-dead: ${urlKey} (${provider}, owner ${ownerAccountId}) has an unresolved spend-intent marker ${Math.round(ageMs / 1000)}s old, past Linear's ${LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS / 60000}-minute reuse grace — a prior refresh attempt died mid-flight and its spent token can no longer be safely replayed`);
      await recordLifecycleEvent(lifecycleEventStore, {
        accountId: ownerAccountId, urlKey, provider,
        kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_FAIL,
        detail: { reason: 'spend-intent-past-grace', ageMs },
      });
      throw new TokenRefreshError('Owner credential rotation died mid-flight and its spend-intent marker is past Linear\'s reuse grace window', 'EXPIRED');
    }
    // Within grace: fall through and replay `attempted` below exactly as an
    // ordinary refresh would — Linear's own grace semantics make this safe,
    // and the CAS write below is what actually resolves the marker this time.
  }

  // LIN-2236 (L5.1, spend_intent kind): durably records the SAME marker
  // `markSpendIntent` (below) already wrote onto the owner-credentials
  // record, as its own event — so the journal's activity is visible in the
  // lifecycle-events timeline even after the marker itself is cleared.
  await recordLifecycleEvent(lifecycleEventStore, {
    accountId: ownerAccountId, urlKey, provider,
    kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.SPEND_INTENT,
    detail: { attempted: true },
  });
  await store.markSpendIntent(ownerAccountId, urlKey, provider, attempted);

  let tokenData;
  try {
    tokenData = await refreshAccessToken(attempted);
  } catch (err) {
    // This process observed a definite outcome (the exchange itself failed)
    // — not a crash — so the marker is resolved here, in this same catch,
    // before either re-read/converge or rethrow below.
    await store.clearSpendIntent(ownerAccountId, urlKey, provider);
    // Re-read-on-`invalid_grant` (LIN-1546, the actual race fix). A *spurious*
    // `EXPIRED` means THIS entrant lost a rotation race — a concurrent winner
    // already spent `attempted` and rotated the durable record to a fresh
    // token. Only a DEFINITIVE revocation (`invalid_grant` → `EXPIRED`) can be
    // spurious this way; a transient NETWORK/INVALID/UNKNOWN blip is never a
    // race artifact, so re-read ONLY for `EXPIRED` and rethrow everything else
    // untouched (the caller's transient-503 branch is unchanged).
    if (isDefinitiveRevocation(err)) {
      const fresh = await store.get(ownerAccountId, urlKey, provider);
      if (fresh?.refreshToken && fresh.refreshToken !== attempted) {
        await recordLifecycleEvent(lifecycleEventStore, {
          accountId: ownerAccountId, urlKey, provider,
          kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SUCCESS,
          detail: { via: 'converged-race-loser' },
        });
        return convergeOnStored(fresh);
      }
    }
    // Genuine revocation (nobody rotated — the stored token is still the spent
    // one) or a transient blip: surface it, so the human catches' LIN-1545
    // guard deletes ONLY a genuinely dead credential and 503s a transient.
    await recordLifecycleEvent(lifecycleEventStore, {
      accountId: ownerAccountId, urlKey, provider,
      kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_FAIL,
      detail: { reason: err?.code || 'unknown' },
    });
    throw err;
  }

  // LIN-2097: an exchange that hands back the SAME access-token bytes we
  // already had is not evidence the credential is accepted by the provider —
  // it is evidence only that the exchange itself succeeded (see LIN-1983's two
  // adopted-and-immediately-401'd fingerprints for a credential where those are
  // provably different claims). Extending the recorded expiry on the strength
  // of that alone is the defect this ticket exists to close: a rejected
  // credential's forced refresh re-stamps `now + 24h` every ~60s, so it wins
  // every max-expiry selection lane forever. Freeze the recorded expiry
  // instead of advancing it whenever the bytes are unchanged; the rotated
  // `refreshToken` is still written unconditionally below (Linear rotates it
  // on use — a non-persisting probe would strand a spent token and trigger
  // LIN-1545's delete guard on a healthy credential).
  // M3: `Number.isFinite` guards the freeze itself, not just the later liveness
  // read — a record whose stored `tokenExpiresAt` is missing/non-numeric (should
  // not happen, but fails closed rather than freezing onto a NaN/undefined that
  // would then compare falsely everywhere downstream) falls back to a fresh
  // `calculateExpiresAt`, exactly as a genuinely different credential would.
  const isSameCredential = tokenData.access_token === record.token && Number.isFinite(record.tokenExpiresAt);
  // LIN-2109 NOTE: gating this NEW-bytes branch on `isCredentialWitnessed`
  // was attempted and reverted — a real, non-401 provider-lane witness can
  // only be recorded AFTER a refreshed credential is actually used, but
  // Linear rotates access-token bytes on ORDINARY healthy refreshes too (not
  // only pathological ones — see LIN-2110's own recorded open question on
  // this), so a fingerprint minted by THIS exchange is essentially never the
  // SAME fingerprint a later exchange could find already witnessed: each
  // refresh mints fresh, distinct bytes, gets used once, and is superseded
  // before its own witness (if any) could ever apply to it. Gating here
  // freezes `tokenExpiresAt` on nearly every ordinary refresh, not just
  // rejected ones, forcing a fresh OAuth exchange on every subsequent
  // request — confirmed by an independent code-review pass tracing the
  // human AND headless entrants end-to-end (LIN-2109 close-out comment has
  // the full trace). `rejectedCredentialRegistry.witnessAccepted`/
  // `hasBeenWitnessed` still exist (lib/rejected-credentials.js) and
  // `routes/proxy.js` still records the witness on every non-401
  // provider-lane response — the positive-half instrumentation gap this
  // ticket named IS closed — but nothing consumes it to gate expiry
  // extension here. Consuming it safely needs the witness to apply BEFORE
  // the credential is spent (e.g. only refuse extension for a fingerprint
  // the registry has independently seen REJECTED, not merely "not yet
  // proven"), which is a different, larger design than this ticket's own
  // "Remedy shape" specified — left for a follow-up.
  const tokenExpiresAt = isSameCredential ? record.tokenExpiresAt : calculateExpiresAt(tokenData.expires_in);
  // Durable compare-and-set (LIN-1546, S3): write the rotated credential ONLY
  // if the stored refreshToken is still the one we spent. If it changed under
  // us — a concurrent rotation winner, or an OAuth re-login (the fourth writer,
  // out of scope for this seam) replaced the record — DON'T clobber the winner;
  // re-read and converge on whatever is durably stored now.
  // `provider` here is the normalized PARTITION, not `record.provider`: they are
  // equal by the gate above, and writing the partition means a rotation can
  // never re-stamp a stale label onto the record it is rewriting.
  const won = await store.putIfRefreshToken(ownerAccountId, urlKey, attempted, {
    provider,
    scope: record.scope,
    token: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenExpiresAt
  });
  if (won) {
    await recordLifecycleEvent(lifecycleEventStore, {
      accountId: ownerAccountId, urlKey, provider,
      kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SUCCESS,
      detail: { via: 'rotated' },
    });
    return { token: tokenData.access_token, expiresAt: tokenExpiresAt, refreshToken: tokenData.refresh_token, provider, scope: record.scope };
  }

  // CAS lost: the durable record changed between our read and our write. Re-read
  // and converge on the stored token (a concurrent rotation winner, or the
  // fourth writer's OAuth re-login, left a live credential to adopt).
  const fresh = await store.get(ownerAccountId, urlKey, provider);
  if (fresh?.refreshToken) {
    await recordLifecycleEvent(lifecycleEventStore, {
      accountId: ownerAccountId, urlKey, provider,
      kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SUCCESS,
      detail: { via: 'converged-cas-loser' },
    });
    return convergeOnStored(fresh);
  }
  // The CAS missed AND the re-read found nothing to converge on — a concurrent
  // disconnect deleted the record, or the store blipped on the write/re-read.
  // Crucially, we know the credential is NOT revoked: we just refreshed it
  // successfully against the provider. So this must NOT surface as `EXPIRED` — that
  // would let the human catches' LIN-1545 delete guard tear down a workspace
  // whose credential is actually alive (the pre-CAS unconditional `put` threw a
  // plain, non-definitive error here, and was correctly treated as such). Fail
  // this one request transiently instead: the credential and workspace survive,
  // and the next request re-reads and either finds the record gone (honest
  // disconnect) or refreshes cleanly.
  await recordLifecycleEvent(lifecycleEventStore, {
    accountId: ownerAccountId, urlKey, provider,
    kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_FAIL,
    detail: { reason: 'cas-lost-no-record' },
  });
  throw new TokenRefreshError('Owner credential rotation could not be persisted (record changed or unavailable)', 'UNKNOWN');
}

/** Shape a freshly re-read durable record as a successful refresh result. */
function convergeOnStored(record) {
  return { token: record.token, expiresAt: record.tokenExpiresAt, refreshToken: record.refreshToken, provider: record.provider, scope: record.scope };
}

/**
 * Refresh the owner's expired-or-disconnected credential — routed by provider
 * (see module docstring): GitHub-family from the session row, every
 * OAuth-refreshable provider from its own durable partition. Returns `null` when
 * there is nothing refreshable — no GitHub-family session row AND no durable
 * record with a `refreshToken` in this workspace's partition — so the caller
 * should keep its existing failure result.
 * Throws (never persists) when a refresh was attempted but failed — a
 * `TokenRefreshError` from `refreshAccessToken`, a mint failure from
 * `resolveProvider(...).refreshCredential`, a `persistSession` failure, or a
 * `store.put` failure — so the caller falls through to the existing 503
 * rather than surfacing a 500 or caching a stale token.
 *
 * @param {Object} deps
 * @param {Array} deps.sessions - raw session rows (sessionsCollection.find({}).toArray()); GitHub-family arm only
 * @param {string} deps.urlKey - workspace url key being resolved
 * @param {string} deps.ownerAccountId - the proxy token's owning account (never UNSCOPED)
 * @param {Function} deps.refreshAccessToken - (refreshToken) => Promise<{access_token, refresh_token, expires_in}>; the LINEAR exchange, and the default durable arm's only exchange when `resolveExchange` is absent
 * @param {Function} [deps.resolveExchange] - LIN-1887: (provider) => exchange|null, so the durable arm can spend a NON-Linear refresh token at its own provider's endpoint. Omitted → Linear-only, byte-identical to before.
 * @param {Function} deps.persistSession - (sid, session) => Promise<void>; must NOT roll the session's TTL (see server.js's persistSessionRow); GitHub-family arm only
 * @param {Function} deps.resolveProvider - (workspace) => Provider; resolves the provider instance for the GitHub-family minting arm (e.g. getProviderForWorkspace). Injected, never imported, so this module stays IO-free and decoupled from the import-order-sensitive provider registry.
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} deps.store - LIN-1524: the durable owner-credential store — every rotating credential's sole home, read AND written here (point-read + point-write, keyed on `(ownerAccountId, urlKey, provider)` since LIN-1887).
 * @param {Function} [deps.fetchImpl] - test seam forwarded to the provider's refreshCredential (deterministic network stub)
 * @param {number} [deps.now] - test seam forwarded to the provider's refreshCredential (deterministic clock, epoch ms)
 * @returns {Promise<{token: string, expiresAt: number, provider: string}|null>}
 */
export async function refreshOwnerWorkspaceToken({ sessions, urlKey, ownerAccountId, refreshAccessToken, resolveExchange, persistSession, resolveProvider, store, fetchImpl, now, lifecycleEventStore }) {
  // LIN-1546: single-flight coalescing moved DOWN into the shared refresh seam
  // (`refreshOwnerCredential`, invoked from doRefresh's durable arm) so the
  // two human entrants can share it too — coalescing here as well would
  // double-register on the same key and DEADLOCK
  // (the inner seam would await this outer promise, which is awaiting it). The
  // GitHub-family re-mint arm is idempotent (re-minted from installationId, no
  // spent-token hazard), so it does not need coalescing to be correct; this is
  // an accepted, low-risk behaviour change (previously the whole resolve was
  // coalesced, now only the Linear rotation core is).
  return doRefresh({ sessions, urlKey, ownerAccountId, refreshAccessToken, resolveExchange, persistSession, resolveProvider, store, fetchImpl, now, lifecycleEventStore });
}

/** Test-only: clear in-flight single-flight state between specs. */
export function _resetInflightForTests() {
  inflight.clear();
}
