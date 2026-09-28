/**
 * Proxy token storage module.
 * Stores API tokens for Linear API proxy authentication.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Schema:
 * {
 *   _id: string,           // Token ID (UUID, for management)
 *   urlKey: string,        // Associated workspace URL key
 *   tokenHash: string,     // SHA-256 hash of token (never store plain text)
 *   label: string,         // User-provided label
 *   scope: string,         // 'read' or 'readWrite'
 *   kind: string,          // 'standard' (default) or 'bootstrap' (single-use, exchange-only)
 *   singleUse: boolean,    // If true, token is consumed after first use
 *   createdBy: string,     // Account ID of token creator (for OAuth key scoping)
 *   grants: string[],      // LIN-3129: grant set. [] for every ordinary mint; only the owner-minted runner is non-empty
 *   parentTokenId: string, // LIN-3129 lineage: the bootstrap a working token was exchanged from (null for roots)
 *   workspaceId: string,   // LIN-3129: workspace the runner bootstrap was minted for (null otherwise)
 *   createdAt: Date,       // When token was created
 *   lastUsedAt: Date,      // Last time token was used
 *   expiresAt: Date,       // Token expiry (null = no expiry)
 *   consumed: boolean      // Whether single-use token has been used
 * }
 *
 * Security notes:
 * - Tokens are generated using crypto.randomBytes (256 bits of entropy)
 * - Only the SHA-256 hash is stored; the plain token is returned once at creation
 * - Validation uses hash lookup (timing attacks not applicable - hash is one-way)
 * - Single-use tokens are marked consumed after first validation
 * - Bootstrap tokens (LIN-376) are single-use credentials that authenticate ONLY
 *   the exchange (`exchangeBootstrapToken`); `validateToken` rejects them so they
 *   can never reach a data endpoint. The exchange consumes the bootstrap and mints
 *   a standard, multi-use working token. This is what lets a handoff (prompt, page,
 *   clipboard) carry a credential that is inert the instant the agent starts, rather
 *   than a standing working token.
 */

import crypto from 'crypto';
import { ownerlessCompatEnabled } from './ownerless-token-policy.js';
import {
  SCOPES,
  GRANTS,
  READ_WRITE,
  RUNNER_BOOTSTRAP_TTL_SECONDS
} from './proxy-scopes.js';

// Default token lifetime: 90 days. Applied when no explicit ttl is provided
// so tokens age out on their own and the list doesn't accumulate forever.
const DEFAULT_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

// LIN-376: TTLs for the two-token bootstrap handoff. The bootstrap TTL must
// OUTLIVE the dispatch queue — an item can sit up to 24h before a consumer
// takes it, so a shorter TTL would leave the embedded token dead on arrival.
// 48h bounds the un-exchanged window while covering that wait; the containment
// property is single-use, not a tight TTL. The exchanged working token gets the
// same 48h, which covers the run that consumes it. Exported so every mint site
// (proxy dispatch, feedback, collective) shares one source of truth.
export const BOOTSTRAP_TOKEN_TTL_SECONDS = 48 * 60 * 60;
export const WORKING_TOKEN_TTL_SECONDS = 48 * 60 * 60;

// Idle-token threshold for cleanup: tokens older than this with no recent use
// are pruned during the periodic cleanup pass.
const IDLE_TOKEN_PRUNE_SECONDS = 60 * 24 * 60 * 60;

/**
 * Build the tagged error the `mintGrantBootstrap` refusals throw (LIN-3129).
 *
 * The repo's idiom for a programmatic refusal from a store/factory is a thrown
 * Error tagged with the machine discriminator plus `err.status` as the HTTP
 * backstop the catch-all middleware honours (lib/dispatch-factory.js's
 * `err.duplicateDispatch`/`err.status = 409`; lib/providers/interface.js's
 * `this.code`). A route that later mounts the mint maps `code`/`status`/
 * `retryable` straight to the P5 table, and a route that forgets still degrades
 * to the tagged status rather than a 500. `message` carries the code so a bare
 * log line is still greppable; it never names the owning account.
 *
 * @param {string} code - stable machine discriminator (P5)
 * @param {number} status - HTTP status backstop
 * @param {boolean} retryable - whether a retry could succeed (P5)
 * @returns {Error}
 */
function grantRefusal(code, status, retryable) {
  const err = new Error(`Grant bootstrap mint refused: ${code}`);
  err.code = code;
  err.status = status;
  err.retryable = retryable;
  return err;
}

/**
 * Proxy token store for managing proxy API authentication.
 * Works with both MongoDB and MangoDB (file-based MongoDB-like storage).
 */
export class ProxyTokenStore {
  // LIN-3129 P1: the late-bound owner-check seam. Set by setOwnerCheck once the
  // account/workspace stores exist; null (unwired) fails the grant mint closed.
  #ownerCheck = null;

  /**
   * Creates a new proxy token store instance.
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection for storing tokens
   * @param {number} [options.defaultTtl] - Default TTL in seconds when caller does not specify one
   * @param {number} [options.idlePruneSeconds] - Idle threshold for cleanup pruning
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.defaultTtl = options.defaultTtl ?? DEFAULT_TOKEN_TTL_SECONDS;
    this.idlePruneSeconds = options.idlePruneSeconds ?? IDLE_TOKEN_PRUNE_SECONDS;
  }

  /**
   * Private mint — the ONLY method that writes a proxy-token document.
   *
   * LIN-3129 A3: a true ES private method, so no caller outside the class can
   * reach it. That is what makes the grant refusal on the public wrapper
   * structural rather than a convention, and it is why the LIN-1582
   * ownerless-bootstrap refusal below is inherited by every internal path.
   * Internal callers today: `createToken` (the grant-less public path) and
   * `mintGrantBootstrap`. `exchangeBootstrapToken` routes through `createToken`
   * until beat 3 redirects it here to copy grants.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options] - Token options (see createToken; plus `grants`,
   *   `parentTokenId` and `workspaceId` for the internal grant/lineage callers)
   * @returns {Promise<Object>} Object with tokenId, token (plain text), label, scope, kind
   */
  async #mint(urlKey, options = {}) {
    if (!urlKey) {
      throw new Error('urlKey is required');
    }

    // Opportunistic cleanup: remove expired/consumed tokens to prevent DB
    // bloat between hourly cleanup cycles. Fire-and-forget to avoid slowing
    // down token creation.
    this.cleanup().catch(err => {
      console.error('Opportunistic proxy token cleanup error:', err);
    });

    const {
      label = 'default',
      scope = 'read',
      kind = 'standard',
      createdBy = null,
      grants = [],
      parentTokenId = null,
      workspaceId = null
    } = options;

    // Validate kind
    if (!['standard', 'bootstrap'].includes(kind)) {
      throw new Error('kind must be "standard" or "bootstrap"');
    }

    // A bootstrap token is single-use by definition — it authenticates exactly one
    // operation (the exchange). Force it here so a caller can never mint a
    // multi-use bootstrap by omitting the flag.
    const singleUse = kind === 'bootstrap' ? true : (options.singleUse ?? false);

    // Fall back to the instance default only when the caller omitted ttl
    // entirely. Explicit `null` disables expiry (used for tests / special cases).
    const ttl = Object.prototype.hasOwnProperty.call(options, 'ttl')
      ? options.ttl
      : this.defaultTtl;

    // Validate scope
    if (!SCOPES.includes(scope)) {
      throw new Error('scope must be "read" or "readWrite"');
    }

    // LIN-1582 — the STRUCTURAL ownerless-bootstrap refusal, and the reason the
    // switch's guarantee is now a property of the store rather than a per-site
    // convention. LIN-1448 gated the two DISPATCHED mint sites
    // (lib/proxy-preamble.js's provisionBootstrapToken, routes/dispatch.js's
    // broker lane) and described the former as the choke point every bootstrap
    // mint passes through — but it was not: `routes/collective.js`'s prose branch,
    // the session-auth `POST .../api/proxy/tokens`, and the test-only
    // `/test/create-proxy-token` all called this method directly with
    // `kind: 'bootstrap'`, so with the lane off they could still mint an ownerless
    // bootstrap. Ownerlessness is INHERITED (exchangeBootstrapToken copies it, and
    // a worker holding the exchanged token mints its children ownerless too),
    // which is how two bad mints halted four autopilot trees on 2026-07-25
    // (LIN-1576). Refusing HERE covers every present site and every future one:
    // a new direct `createToken({ kind: 'bootstrap' })` anywhere cannot reopen
    // the gap by forgetting a gate.
    //
    // Deliberately scoped to `kind === 'bootstrap'`, which is load-bearing twice
    // over: non-bootstrap minting is untouched (LIN-1447's constraint), and
    // `exchangeBootstrapToken`'s internal mint is `kind: 'standard'`, so an
    // already-issued ownerless bootstrap stays exchangeable and the compat
    // population is never stranded mid-flight.
    //
    // Compat ON (the default) mints exactly as before — the warn lives at the
    // call sites that know who was asking, so this backstop stays silent rather
    // than double-logging. An OWNER-STAMPED mint never reaches this branch.
    if (kind === 'bootstrap' && !createdBy && !ownerlessCompatEnabled()) {
      throw new Error(
        'Ownerless bootstrap mint refused: a bootstrap with no createdBy cannot resolve ' +
        'a workspace credential, and the exchanged working token inherits the miss. ' +
        'DISPATCH_OWNERLESS_BROKER_COMPAT is off (LIN-1448/LIN-1582)'
      );
    }

    // Generate a secure random token (32 bytes = 256 bits)
    const tokenBytes = crypto.randomBytes(32);
    const token = tokenBytes.toString('base64url');

    // Hash the token for storage
    const tokenHash = this._hashToken(token);

    const now = new Date();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      tokenHash,
      label: label || 'default',
      scope,
      kind,
      singleUse: !!singleUse,
      createdBy: createdBy || null,
      // LIN-3129: the grant set rides the document. Ordinary mints are always
      // empty because the public wrapper refuses grants structurally; only
      // mintGrantBootstrap and (from beat 3) exchangeBootstrapToken write a
      // non-empty set. Copied, never aliased to a caller's array.
      grants: Array.isArray(grants) ? grants.slice() : [],
      // LIN-3129 lineage: the root bootstrap a working token was exchanged from.
      parentTokenId: parentTokenId || null,
      // LIN-3129: the workspace the runner bootstrap was minted for, so the
      // exchange-time owner re-check needs no urlKey→workspaceId lookup.
      workspaceId: workspaceId || null,
      createdAt: now,
      lastUsedAt: null,
      expiresAt: ttl ? new Date(now.getTime() + ttl * 1000) : null,
      consumed: false
    };

    await this.collection.insertOne(doc);

    return {
      tokenId: doc._id,
      token, // Plain text - only returned once!
      label: doc.label,
      scope: doc.scope,
      kind: doc.kind,
      singleUse: doc.singleUse,
      grants: doc.grants.slice(),
      expiresAt: doc.expiresAt?.toISOString?.() || doc.expiresAt
    };
  }

  /**
   * Generates and stores a new proxy token for a workspace.
   * The plain text token is returned only once and should be shown to the user immediately.
   *
   * LIN-3129 A3: now a thin, grant-less wrapper over the private `#mint`. It
   * REFUSES grants structurally — any non-empty `grants`, or a `grants` that is
   * not an array, throws for every kind — so no public caller can mint a
   * grant-bearing credential. Grant minting exists only on `mintGrantBootstrap`
   * (owner-checked) and, from beat 3, `exchangeBootstrapToken` (verbatim copy).
   * There is deliberately NO `DISPATCH_OWNERLESS_BROKER_COMPAT` lane for grants
   * (LIN-1448): the compat switch governs ownerless bootstraps, never grants.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options] - Token options
   * @param {string} [options.label='default'] - User-provided label
   * @param {string} [options.scope='read'] - 'read' or 'readWrite'
   * @param {string} [options.kind='standard'] - 'standard' or 'bootstrap' (single-use, exchange-only)
   * @param {boolean} [options.singleUse=false] - Whether token expires after one use
   * @param {string} [options.createdBy] - Account ID of token creator
   * @param {number} [options.ttl] - TTL in seconds (null = no expiry)
   * @param {Array} [options.grants] - MUST be absent or empty; anything else throws
   * @returns {Promise<Object>} Object with tokenId, token (plain text), label, scope, kind
   * @throws {Error} on invalid kind/scope, on any grant-bearing call, and — LIN-1582 —
   *   on a `kind: 'bootstrap'` mint with no `createdBy` while
   *   `DISPATCH_OWNERLESS_BROKER_COMPAT` is off. That refusal is the structural
   *   guarantee behind the switch: it applies to every bootstrap mint site, present
   *   and future. Nothing is inserted when either refusal fires.
   */
  async createToken(urlKey, options = {}) {
    const grants = options.grants;
    if (grants !== undefined && !Array.isArray(grants)) {
      throw new Error(
        'createToken refuses grants: grants must be an array; mint grant-bearing ' +
        'tokens through mintGrantBootstrap (LIN-3129)'
      );
    }
    if (Array.isArray(grants) && grants.length > 0) {
      throw new Error(
        'createToken refuses grants: grant-bearing proxy tokens may only be minted ' +
        'by mintGrantBootstrap (LIN-3129)'
      );
    }
    return this.#mint(urlKey, { ...options, grants: [] });
  }

  /**
   * Late-binds the owner-check seam used by `mintGrantBootstrap` (LIN-3129 P1).
   * `proxyTokenStore` is constructed (server.js:342) before the account and
   * workspace stores it composes, so the seam cannot be passed at construction;
   * it is injected once those exist. Unwired, or set to a non-function, the grant
   * mint fails closed with OWNER_CHECK_UNAVAILABLE.
   *
   * @param {Function} fn - `async ({ workspaceId, accountId }) =>
   *   { status: 'owner' | 'not-owner' | 'no-owner' }` (throws → unavailable)
   */
  setOwnerCheck(fn) {
    this.#ownerCheck = typeof fn === 'function' ? fn : null;
  }

  /**
   * Mint an owner-checked, grant-bearing runner bootstrap (LIN-3129 step 3;
   * decision lin3059-credential-boundary-j1-j4). INERT in S1: no production
   * caller. Fixed `scope: 'readWrite'`, `kind: 'bootstrap'` and the runner
   * bootstrap TTL (J3(b)); `createdBy` and `workspaceId` are the owner's.
   *
   * The grants are validated against GRANTS here and stamped verbatim. The
   * owner check runs through the `setOwnerCheck` seam and, when the seam is
   * unwired, throws, or answers anything unrecognised, the mint fails closed —
   * there is no path that mints a grant without a positive owner verdict.
   *
   * Refusals carry a stable `code`/`status`/`retryable` on the thrown error
   * (see grantRefusal) so a later route maps them per P5:
   *   - no `ownerAccountId`              → 503 GRANT_OWNERLESS (no compat lane)
   *   - grants empty / non-array / unknown → 400 INVALID_GRANTS
   *   - seam unwired / throws / corrupt  → 503 OWNER_CHECK_UNAVAILABLE (retryable)
   *   - workspace has no owner edge      → 409 WORKSPACE_OWNER_UNSET
   *   - another account owns it          → 403 GRANT_OWNER_ONLY (never names the owner)
   *
   * @param {Object} args
   * @param {string} args.urlKey
   * @param {string} args.workspaceId
   * @param {string} args.ownerAccountId
   * @param {Array} args.grants - non-empty subset of GRANTS
   * @param {string} [args.label]
   * @returns {Promise<Object>} the `#mint` result plus `grants` and `workspaceId`
   */
  async mintGrantBootstrap({ urlKey, workspaceId, ownerAccountId, grants, label } = {}) {
    if (!ownerAccountId) {
      throw grantRefusal('GRANT_OWNERLESS', 503, false);
    }

    if (!Array.isArray(grants) || grants.length === 0
      || grants.some(grant => !GRANTS.includes(grant))) {
      throw grantRefusal('INVALID_GRANTS', 400, false);
    }

    const ownerCheck = this.#ownerCheck;
    if (typeof ownerCheck !== 'function') {
      throw grantRefusal('OWNER_CHECK_UNAVAILABLE', 503, true);
    }

    let answer;
    try {
      answer = await ownerCheck({ workspaceId, accountId: ownerAccountId });
    } catch (err) {
      console.error('Owner check failed during grant mint:', err?.message || err);
      throw grantRefusal('OWNER_CHECK_UNAVAILABLE', 503, true);
    }

    const status = answer && typeof answer === 'object' ? answer.status : undefined;
    if (status === 'no-owner') {
      throw grantRefusal('WORKSPACE_OWNER_UNSET', 409, false);
    }
    if (status === 'not-owner') {
      // Deliberately never names the actual owner (P5): the caller learns only
      // that it is not them.
      throw grantRefusal('GRANT_OWNER_ONLY', 403, false);
    }
    if (status !== 'owner') {
      // Missing, corrupt or unknown answers all fail closed identically.
      throw grantRefusal('OWNER_CHECK_UNAVAILABLE', 503, true);
    }

    const minted = await this.#mint(urlKey, {
      kind: 'bootstrap',
      scope: READ_WRITE,
      ttl: RUNNER_BOOTSTRAP_TTL_SECONDS,
      createdBy: ownerAccountId,
      grants,
      label,
      workspaceId
    });

    return { ...minted, grants: grants.slice(), workspaceId };
  }

  /**
   * Exchanges a single-use bootstrap token for a fresh standard (multi-use)
   * working token in the same workspace and scope (LIN-376).
   *
   * The bootstrap is atomically consumed (reusing the single-use consume path), so
   * a leaked handoff that already ran leaves only a spent credential. The returned
   * working token is what the agent uses for every subsequent call; it exists only
   * in this response, never in the durable prompt/queue/log.
   *
   * Returns null when the presented token is missing, not a bootstrap, already
   * consumed, or expired — the caller maps that to a 401.
   *
   * @param {string} token - Plain text bootstrap token
   * @param {Object} [options] - Working-token options
   * @param {string} [options.label] - Label for the minted working token; defaults to the
   *   bootstrap's own label (`doc.label`, e.g. 'dispatch-bootstrap'/'refire-broker'/etc.) so the
   *   per-site lane survives the exchange, falling back to 'exchanged' only when the bootstrap
   *   itself carries no label (LIN-1587 R1)
   * @param {number} [options.ttl] - Working-token TTL in seconds (defaults to store default)
   * @returns {Promise<Object|null>} createToken result (+ urlKey) for the working token, or null
   */
  async exchangeBootstrapToken(token, options = {}) {
    if (!token) {
      return null;
    }

    try {
      const tokenHash = this._hashToken(token);
      const now = new Date();

      const doc = await this.collection.findOne({ tokenHash });
      if (!doc) return null;
      // Only bootstrap tokens are exchangeable.
      if (doc.kind !== 'bootstrap') return null;
      // Expiry + already-consumed guards.
      if (doc.expiresAt && now > new Date(doc.expiresAt)) return null;
      if (doc.consumed) return null;

      // Atomic consume: only the first concurrent exchange wins.
      const result = await this.collection.updateOne(
        { _id: doc._id, consumed: false },
        { $set: { consumed: true, lastUsedAt: now } }
      );
      if (!result.modifiedCount && !result.matchedCount) {
        return null;
      }

      // LIN-1448 — the inheritance step. `createdBy: doc.createdBy || null` below
      // is where an ownerless bootstrap becomes an ownerless WORKING token, which
      // is dead on arrival at every workspace-scoped verb (LIN-1366's null-owner
      // guard) while still returning 200 on the few that resolve no workspace.
      // That silent propagation is how two bad mints halted four autopilot trees
      // on 2026-07-25 (LIN-1576).
      //
      // The exchange still succeeds on purpose: while the LIN-1447 compat lane is
      // on, ownerless tokens are a supported population, and refusing here would
      // strand the host runner mid-flight rather than at a mint it could retry.
      // Prevention lives at the MINT (lib/proxy-preamble.js's provisionBootstrapToken
      // and the broker-token lane in routes/dispatch.js, both gated on
      // DISPATCH_OWNERLESS_BROKER_COMPAT); what belongs here is the breadcrumb.
      // Workspace slug only — never token bytes, never the owner id.
      if (!doc.createdBy) {
        console.warn(
          `Exchanging a bootstrap with no owner (urlKey=${doc.urlKey} label=${doc.label}): ` +
          `the working token inherits the missing owner and cannot resolve a workspace ` +
          `credential (LIN-1448)`
        );
      }

      // Mint the working token: same workspace + scope, multi-use, standard kind.
      const minted = await this.createToken(doc.urlKey, {
        label: options.label || doc.label || 'exchanged',
        scope: doc.scope,
        kind: 'standard',
        singleUse: false,
        createdBy: doc.createdBy || null,
        ...(Object.prototype.hasOwnProperty.call(options, 'ttl') ? { ttl: options.ttl } : {})
      });

      return { ...minted, urlKey: doc.urlKey };
    } catch (err) {
      console.error('Error exchanging bootstrap proxy token:', err);
      return null;
    }
  }

  /**
   * Validates a token and returns the associated workspace info.
   * Updates lastUsedAt timestamp on successful validation.
   * For single-use tokens, marks as consumed after first validation.
   *
   * @param {string} token - Plain text token to validate
   * @returns {Promise<Object|null>} Token info if valid, null otherwise
   */
  async validateToken(token) {
    if (!token) {
      return null;
    }

    try {
      const tokenHash = this._hashToken(token);
      const now = new Date();

      // For single-use tokens, use atomic findOneAndUpdate to prevent race conditions.
      // The query includes { consumed: false } so only the first concurrent request wins.
      const doc = await this.collection.findOne({ tokenHash });

      if (!doc) {
        return null;
      }

      // Bootstrap tokens authenticate ONLY the exchange (exchangeBootstrapToken),
      // never a data endpoint. Reject before the consume path so presenting a
      // bootstrap here does not burn it (LIN-376).
      if (doc.kind === 'bootstrap') {
        return null;
      }

      // Check expiry
      if (doc.expiresAt && now > new Date(doc.expiresAt)) {
        return null;
      }

      // Check if single-use token already consumed
      if (doc.singleUse && doc.consumed) {
        return null;
      }

      if (doc.singleUse) {
        // Atomic consume: only succeeds if consumed is still false.
        // This prevents race conditions where two concurrent requests
        // both pass the check above.
        const result = await this.collection.updateOne(
          { _id: doc._id, consumed: false },
          { $set: { consumed: true, lastUsedAt: now } }
        );
        // If no document was modified, another request consumed it first
        if (!result.modifiedCount && !result.matchedCount) {
          return null;
        }
      } else {
        // Non-single-use: fire-and-forget update of lastUsedAt
        this.collection.updateOne(
          { _id: doc._id },
          { $set: { lastUsedAt: now } }
        ).catch(err => {
          console.error('Error updating proxy token lastUsedAt:', err);
        });
      }

      return {
        tokenId: doc._id,
        urlKey: doc.urlKey,
        label: doc.label,
        scope: doc.scope,
        singleUse: doc.singleUse,
        createdBy: doc.createdBy || null,
        // LIN-3129: grants, additively. An OWNERLESS document NEVER carries
        // authority, even if the stored row somehow holds a non-empty grants
        // array — `createdBy: null` zeroes it so no reader can treat a
        // foreign/legacy row as holding a grant.
        grants: doc.createdBy && Array.isArray(doc.grants) ? doc.grants.slice() : []
      };
    } catch (err) {
      console.error('Error validating proxy token:', err);
      return null;
    }
  }

  /**
   * Read-only lookup of WHY a token would be rejected by `validateToken`, for a
   * caller that has already seen `validateToken` return null and wants to say
   * more than that (LIN-1938 S2). Never mutates: no `lastUsedAt`/`consumed`
   * write, unlike `validateToken`'s own consume path.
   *
   * Field names are deliberately distinct from `lib/credential-diagnostics.js`'s
   * `expiryKind`/`msUntilExpiry` — those model the PROVIDER credential; this
   * describes the caller's own proxy-token bearer, a different concept.
   *
   * @param {string} token - Plain text token to describe
   * @returns {Promise<{state: 'bootstrap_only'|'expired'|'consumed', expiresAt: (string|null), urlKey: string}|null>}
   *   `null` when the bearer is not a recognized token at all (nothing to describe).
   */
  async describeRejectionCause(token) {
    if (!token) {
      return null;
    }

    try {
      const tokenHash = this._hashToken(token);
      const doc = await this.collection.findOne({ tokenHash });
      if (!doc) {
        return null;
      }

      const now = new Date();
      const expiresAt = doc.expiresAt?.toISOString?.() || doc.expiresAt || null;

      // Mirrors validateToken's own rejection order: bootstrap-only, then
      // expiry, then single-use-consumed. A doc with no `kind` (legacy) is
      // `!== 'bootstrap'`, so it falls through to the standard checks below
      // rather than being misclassified.
      if (doc.kind === 'bootstrap') {
        return { state: 'bootstrap_only', expiresAt, urlKey: doc.urlKey };
      }

      if (doc.expiresAt && now > new Date(doc.expiresAt)) {
        return { state: 'expired', expiresAt, urlKey: doc.urlKey };
      }

      if (doc.singleUse && doc.consumed) {
        return { state: 'consumed', expiresAt, urlKey: doc.urlKey };
      }

      return null;
    } catch (err) {
      console.error('Error describing proxy token rejection cause:', err);
      return null;
    }
  }

  /**
   * Lists all tokens for a workspace.
   * Returns metadata only - never the token hash.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<Array>} Array of token metadata objects
   */
  async listTokens(urlKey) {
    if (!urlKey) {
      return [];
    }

    try {
      const docs = await this.collection.find({ urlKey }).toArray();

      docs.sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
        return bTime - aTime;
      });

      return docs.map(doc => ({
        tokenId: doc._id,
        label: doc.label,
        scope: doc.scope,
        kind: doc.kind || 'standard',
        singleUse: doc.singleUse,
        consumed: doc.consumed,
        createdAt: doc.createdAt?.toISOString?.() || doc.createdAt,
        lastUsedAt: doc.lastUsedAt?.toISOString?.() || doc.lastUsedAt,
        expiresAt: doc.expiresAt?.toISOString?.() || doc.expiresAt,
        // LIN-1586, byte-mirroring DispatchTokenStore.listTokens (LIN-1448): a
        // VERDICT, never the owning account id — listTokens is a metadata-only
        // surface. An ownerless token is what workspace-token selection reports
        // as `token_ownerless`, so "which of my tokens are ownerless?" has to be
        // answerable from the same list the operator is already looking at.
        hasOwner: !!doc.createdBy,
        // LIN-3129: the grant set and the lineage root, so Settings can show a
        // runner credential and revoke its whole lineage.
        grants: Array.isArray(doc.grants) ? doc.grants.slice() : [],
        parentTokenId: doc.parentTokenId || null
      }));
    } catch (err) {
      console.error('Error listing proxy tokens:', err);
      return [];
    }
  }

  /**
   * Revokes (deletes) a token.
   *
   * @param {string} urlKey - Workspace URL key (for verification)
   * @param {string} tokenId - Token ID to revoke
   * @returns {Promise<boolean>} True if token was revoked
   */
  async revokeToken(urlKey, tokenId) {
    if (!urlKey || !tokenId) {
      return false;
    }

    try {
      const result = await this.collection.deleteOne({
        _id: tokenId,
        urlKey
      });
      return result.deletedCount > 0;
    } catch (err) {
      console.error('Error revoking proxy token:', err);
      return false;
    }
  }

  /**
   * Counts tokens for a workspace.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Number of tokens
   */
  async countTokens(urlKey) {
    if (!urlKey) {
      return 0;
    }

    try {
      const docs = await this.collection.find({ urlKey }).toArray();
      return docs.length;
    } catch (err) {
      console.error('Error counting proxy tokens:', err);
      return 0;
    }
  }

  /**
   * Clears all tokens for a workspace (used in tests).
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Number of tokens removed
   */
  async clear(urlKey) {
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Error clearing proxy tokens:', err);
      return 0;
    }
  }

  /**
   * Removes expired and consumed single-use tokens.
   *
   * @returns {Promise<number>} Number of tokens removed
   */
  async cleanup() {
    try {
      const now = new Date();
      // Remove expired tokens
      const expiredResult = await this.collection.deleteMany({
        expiresAt: { $lt: now, $ne: null }
      });
      // Remove consumed single-use tokens older than 24 hours
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const consumedResult = await this.collection.deleteMany({
        singleUse: true,
        consumed: true,
        lastUsedAt: { $lt: oneDayAgo }
      });

      // Prune long-idle tokens: created a while ago AND never used (or unused
      // for just as long). Guards against accumulation when tokens were
      // created without an explicit TTL (legacy rows) or explicitly with none.
      // Filter entirely in JS so we don't depend on server-side operator
      // support, then delete by _id individually.
      let idleDeleted = 0;
      const idleCutoffMs = now.getTime() - this.idlePruneSeconds * 1000;
      const allDocs = await this.collection.find({}).toArray();
      for (const doc of allDocs) {
        const created = doc.createdAt ? new Date(doc.createdAt).getTime() : null;
        if (created === null || created >= idleCutoffMs) continue;
        const last = doc.lastUsedAt ? new Date(doc.lastUsedAt).getTime() : null;
        if (last !== null && last >= idleCutoffMs) continue;
        const r = await this.collection.deleteOne({ _id: doc._id });
        idleDeleted += r.deletedCount || 0;
      }

      return (expiredResult.deletedCount || 0)
        + (consumedResult.deletedCount || 0)
        + idleDeleted;
    } catch (err) {
      console.error('Error cleaning up proxy tokens:', err);
      return 0;
    }
  }

  /**
   * Hashes a token using SHA-256.
   *
   * @param {string} token - Plain text token
   * @returns {string} Hex-encoded hash
   * @private
   */
  _hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
