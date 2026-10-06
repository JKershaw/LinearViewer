/**
 * Public share-link route (LIN-3243, Session A of LIN-3073).
 *
 * `GET /s/:token` serves an owner's task-collection snapshot as a read-only
 * public page (lib/render-share.js). The token is the only credential; the
 * route receives the `ShareStore`, `readOwnerIssues` and `workspaceOwnerCheck`
 * by injection, so it imports nothing from the owner-credential / connection
 * stores and `tests/unit/connection-access-guard.test.js` stays green.
 *
 * Run shares (LIN-3313, Phase 3 of LIN-2950) ride the SAME record, token,
 * matrix, TTL, backoff, single-flight and limiters. What differs is chosen by
 * `record.subject.type`:
 *   - refresh reads through the injected `readOwnerRun` (lib/share-run-reader.js)
 *     and stores the guest projection; a SETTLED snapshot is first checked with
 *     the Mongo-only `probeRun` and, when the run is still settled with the
 *     same `settledKey`, REVALIDATED (`saveSnapshot` of the same snapshot, zero
 *     provider reads) instead of re-read. There is no TTL exemption: a settled
 *     snapshot is still probed at most every MIN_REFRESH_INTERVAL_MS;
 *   - serve renders `renderGuestRunPage` (the run page in guest mode), never
 *     `renderSharePage`, and runs `scanGuestHtml` over the final HTML on EVERY
 *     serve: a hit returns 503 with no body (PROVISIONAL #2, fail closed). A
 *     hit at refresh keeps the last-good snapshot (row 6) and, on create,
 *     refuses the share.
 *
 * Every GET runs the owner/revocation matrix BEFORE any cached content:
 *   1. unknown token                                    → 404
 *   2. revoked (`revokedAt` set)                        → 410
 *   3. owner no longer owns the workspace / workspace gone → 410, no content
 *   4. ownership check cannot answer (throws)           → 503, no content
 *   5. snapshot present and fresh (< SNAPSHOT_TTL_MS)   → serve
 *   6. snapshot present, stale, refresh not ok / throws → serve last-good, "as of"
 *      (ruling `lin3073-owner-unresolvable`: serve-last-good)
 *   7. snapshot null and refresh not ok / unavailable   → 503, no content
 *
 * Refresh is GET-triggered only (no background refresher), single-flight per
 * token, and bounded by `MIN_REFRESH_INTERVAL_MS` after a success and
 * `FAILURE_BACKOFF_MS` after a failure. An in-process per-token attempt stamp
 * (`attempts`, below) also guards the throttle: when a store-write outage
 * prevents `lastRefreshAttemptAt` from persisting, that stamp still suppresses
 * repeated reads, so anonymous traffic cannot spend the owner's provider rate
 * limit without bound.
 *
 * Provider coverage carry-forward (approving verdict (b), Session B): a
 * `kind: 'parent'` share is REFUSED at create when the workspace's provider
 * declares `ui.subtasks: false` (`github`, `github-projects` always emit
 * `parent: null`) — such a share would otherwise always be empty. Label shares
 * work on every provider. The owner create/list/revoke routes live below the
 * public route (LIN-3244 / Session B): all three are owner-gated, create is
 * rate-limited and snapshots synchronously before persisting, and list never
 * returns the token.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash } from 'node:crypto';
import { badRequest, jsonError } from '../lib/errors.js';
import { buildShareSnapshot } from '../lib/share-snapshot.js';
import { isWellFormedShareToken, SUBJECT_KINDS, subjectTypeForKind } from '../lib/share-store.js';
import { renderSharePage, renderGuestRunPage } from '../lib/render-share.js';
import { scanGuestHtml } from '../lib/share-run-scan.js';
import { resolveOwnerMintRefusal } from '../lib/owner-mint-refusals.js';

export const SNAPSHOT_TTL_MS = 60_000;
export const MIN_REFRESH_INTERVAL_MS = 60_000;
export const FAILURE_BACKOFF_MS = 300_000;
export const SHARE_REFRESH_TIMEOUT_MS = 50_000;
export const READ_LIMIT_MAX = 120;
// Owner share creation: 5 per 15 minutes per IP, shaped like
// `tokenCreationLimiter` (routes/dispatch.js). A share mints a capability and
// spends a provider read, so it is rarer and more expensive than a read.
export const CREATE_LIMIT_MAX = 5;
export const CREATE_WINDOW_MS = 15 * 60 * 1000;

function defaultSkip() {
  return process.env.NODE_ENV === 'test';
}

/**
 * Build the share limiters. Exported as a factory (shaped like
 * `feedbackLimiter` in routes/dispatch.js) so the 429 tests can construct their
 * own isolated limiter instances with a small `max` and `skip: () => false`.
 *
 * `max` overrides BOTH limiters' ceiling (the test knob the plan's "same for
 * create" uses); `createMax` overrides only creation. With no override the
 * defaults are 120 reads/min and 5 creates/15 min.
 *
 * @param {{windowMs?: number, createWindowMs?: number, max?: number, createMax?: number, skip?: Function}} [opts]
 * @returns {{read: Function, create: Function}}
 */
export function createShareLimiters({
  windowMs = 60 * 1000,
  createWindowMs = CREATE_WINDOW_MS,
  max,
  createMax,
  skip = defaultSkip
} = {}) {
  const readMax = max ?? READ_LIMIT_MAX;
  const createLimit = createMax ?? max ?? CREATE_LIMIT_MAX;
  return {
    read: rateLimit({
      windowMs,
      max: readMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many share requests, please try again later' },
      skip
    }),
    create: rateLimit({
      windowMs: createWindowMs,
      max: createLimit,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many share creation requests, please try again later' },
      skip
    })
  };
}

// The default limiters: 120 reads/minute and 5 creates/15 minutes per IP,
// both skipped under NODE_ENV=test.
export const shareReadLimiter = createShareLimiters().read;
export const shareCreationLimiter = createShareLimiters().create;

// A run share's subject id is a sessionId; the pr-state route's bound.
const MAX_RUN_ID_LENGTH = 200;

/**
 * Validate the create body's subject. `id` is the provider-native collection
 * key: for a parent it is the parent issue's `id` (the SAME value
 * `fetchProjects` emits as `issue.parent.id` — L9), for a label it is the label
 * name, for a run (LIN-3313) the run's sessionId. It is stored verbatim, never
 * resolved or transformed (a parent identifier is mapped to its id below).
 *
 * @param {unknown} subject
 * @returns {boolean}
 */
function isValidSubjectInput(subject) {
  return Boolean(
    subject &&
    typeof subject === 'object' &&
    SUBJECT_KINDS.includes(subject.kind) &&
    typeof subject.id === 'string' &&
    subject.id.trim().length > 0 &&
    (subject.kind !== 'run' || subject.id.trim().length <= MAX_RUN_ID_LENGTH)
  );
}

/**
 * The opaque management id for a share, derived from its stored `_id` (the
 * token hash) with a domain-separated one-way function. The list and revoke
 * routes key on this so the stored token hash is NEVER returned or accepted
 * from a client (LIN-3244: "list never returns the token or hash"); it is
 * non-reversible and cannot be turned into a working `/s/` link.
 */
export function publicShareId(tokenHash) {
  return createHash('sha256').update(`share-management:${tokenHash}`).digest('hex');
}

/**
 * The list projection. Deliberately omits the raw token (never stored) and the
 * stored `tokenHash`; `id` is the derived opaque management id used by revoke.
 */
function shareListItem(record) {
  return {
    id: publicShareId(record._id),
    kind: record.subject.kind,
    subjectId: record.subject.id,
    includeDescriptions: record.includeDescriptions,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt
  };
}

function ownerRefusalResponse(res, refusal, workspace) {
  console.warn(`Share management refused: ${refusal.code} (urlKey=${workspace.urlKey}) — LIN-3244`);
  return jsonError(res, refusal.status, refusal.error, {
    code: refusal.code,
    category: refusal.category,
    retryable: refusal.retryable
  });
}

function isRunRecord(record) {
  return record?.subject?.type === 'run';
}

/**
 * Render a run snapshot as the guest run page and scan the final HTML
 * (S7b). Never throws: a render throw (a snapshot with no session or capture
 * time) or a scan hit/error is `{ ok: false }`.
 *
 * @returns {{ok: true, html: string}|{ok: false, reason: string}}
 */
function renderScannedRun(snapshot, snapshotAt, stale) {
  let html;
  try {
    html = renderGuestRunPage({ snapshot, snapshotAt, stale });
  } catch (err) {
    return { ok: false, reason: 'render_error' };
  }
  const scan = scanGuestHtml(html);
  if (!scan.ok) return { ok: false, reason: scan.reason || 'scan_failed' };
  return { ok: true, html };
}

/**
 * Serve a snapshot by subject type (S6b). A run is rendered with
 * `renderGuestRunPage` and re-scanned on EVERY serve; a scan hit (or a render
 * failure) answers 503 with no content, never the page (PROVISIONAL #2). The
 * route's security headers are already set on every response.
 */
function serveSnapshot(res, record, { snapshot, snapshotAt, stale }) {
  if (isRunRecord(record)) {
    const page = renderScannedRun(snapshot, snapshotAt, stale);
    if (!page.ok) {
      console.warn(`Run share serve refused: ${page.reason} — LIN-3313`);
      return res.status(503).end();
    }
    return res.status(200).type('html').send(page.html);
  }
  return res.status(200).type('html').send(renderSharePage({
    snapshot,
    includeDescriptions: record.includeDescriptions,
    snapshotAt,
    stale
  }));
}

function serve(res, record, stale) {
  return serveSnapshot(res, record, { snapshot: record.snapshot, snapshotAt: record.snapshotAt, stale });
}

/**
 * @param {Object} deps
 * @param {import('../lib/share-store.js').ShareStore} deps.shareStore
 * @param {(urlKey: string, ownerAccountId: string) => Promise<{reason: string, issues: Object[]|null}>} deps.readOwnerIssues
 * @param {(urlKey: string, ownerAccountId: string, sessionId: string) => Promise<{reason: string, run: Object|null}>} [deps.readOwnerRun]
 *   - the run reader (lib/share-run-reader.js); absent, run shares cannot refresh or be created
 * @param {(urlKey: string, sessionId: string) => Promise<{reason: string, settled: boolean, settledKey: (string|null)}>} [deps.probeRun]
 *   - the Mongo-only local probe for the settled revalidate
 * @param {(args: {workspaceId?: string, accountId?: string}) => Promise<{status: string}>} deps.workspaceOwnerCheck
 * @param {Function} [deps.workspaceFromUrl] - session/workspace middleware for the owner routes; when absent (Session A unit apps) the owner surface is not mounted
 * @param {(workspace: Object) => Object} [deps.getProviderForWorkspace] - resolves the workspace provider for the parent-share `ui.subtasks` check
 * @param {(promise: Promise, ms: number) => Promise} deps.withTimeout - injected from routes/proxy.js (LIN-3158 timer fix)
 * @param {Function} [deps.readLimiter]
 * @param {Function} [deps.createLimiter]
 * @returns {import('express').Router}
 */
export function createShareRoutes({
  shareStore,
  readOwnerIssues,
  readOwnerRun,
  probeRun,
  workspaceOwnerCheck,
  workspaceFromUrl,
  getProviderForWorkspace,
  withTimeout,
  readLimiter = shareReadLimiter,
  createLimiter = shareCreationLimiter
} = {}) {
  const router = Router();

  // Per-token single-flight for refreshes (closure state, one map per router).
  const inflight = new Map();
  // Per-token last-attempt stamp, in-process only. `lastRefreshAttemptAt` is
  // persisted by `saveSnapshot`, which is exactly what fails during a
  // store-write outage, so it cannot be the only guard (LIN-3255). Bounded by
  // pruning entries older than FAILURE_BACKOFF_MS on write and read.
  const attempts = new Map();

  /**
   * A collection refresh's read + build (the LIN-3243 path, unchanged).
   * Returns `{ok:false, reason}` for a read that produced nothing; throws on a
   * build failure (the caller's L4 catch).
   */
  async function readCollection(record) {
    let outcome;
    try {
      outcome = await withTimeout(
        readOwnerIssues(record.urlKey, record.ownerAccountId),
        SHARE_REFRESH_TIMEOUT_MS
      );
    } catch (err) {
      outcome = { reason: 'refresh_error', issues: null };
    }
    const ok = outcome != null && outcome.issues != null && outcome.reason === 'ok';
    if (!ok) return { ok: false, reason: outcome?.reason ?? 'refresh_error' };
    const snapshot = buildShareSnapshot({
      subject: record.subject,
      issues: outcome.issues,
      includeDescriptions: record.includeDescriptions
    });
    return { ok: true, snapshot, reason: outcome.reason };
  }

  /**
   * A run refresh's read (LIN-3313, S4): probe → revalidate, or full read →
   * projection → scan. Returns `{ok, snapshot, revalidated?}` or
   * `{ok:false, reason}`; a throw is the caller's L4 catch (row 6/7).
   *
   *   - REVALIDATE: the stored snapshot is settled, and the Mongo-only probe
   *     says the run is still settled with the same `settledKey` → the stored
   *     snapshot is re-saved as-is (zero tracker/GitHub reads). The key moves
   *     when a loop appears, flips terminal or a marker lands (R4), so a
   *     reopened run — a follow-up loop running, or one that started and
   *     ended between two probes, markerless or not — gets a full read.
   *   - FULL READ: the owner-credential reader builds a fresh projection; it
   *     is rendered and scanned BEFORE it is stored, so a scan hit keeps the
   *     last-good snapshot (row 6) instead of replacing it.
   */
  async function readRun(record) {
    if (typeof readOwnerRun !== 'function') return { ok: false, reason: 'run_reader_unavailable' };
    const sessionId = record.subject.id;
    const prior = record.snapshot;
    if (prior != null && prior.settled === true && typeof probeRun === 'function') {
      // A probe throw/timeout propagates: a failed probe is a failed refresh.
      const probe = await withTimeout(probeRun(record.urlKey, sessionId), SHARE_REFRESH_TIMEOUT_MS);
      if (probe && probe.reason === 'ok' && probe.settled === true && probe.settledKey === prior.settledKey) {
        return { ok: true, snapshot: prior, revalidated: true, reason: 'ok' };
      }
    }
    let outcome;
    try {
      outcome = await withTimeout(
        readOwnerRun(record.urlKey, record.ownerAccountId, sessionId),
        SHARE_REFRESH_TIMEOUT_MS
      );
    } catch (err) {
      outcome = { reason: 'refresh_error', run: null };
    }
    const ok = outcome != null && outcome.run != null && outcome.reason === 'ok';
    if (!ok) return { ok: false, reason: outcome?.reason ?? 'refresh_error' };
    // S7b: scan at refresh. The stamp the guest sees on a fresh serve is this
    // snapshot's own capture, so render it as served (not stale).
    const page = renderScannedRun(outcome.run, outcome.run.capturedAt, false);
    if (!page.ok) {
      console.warn(`Run share refresh refused: ${page.reason} — LIN-3313`);
      return { ok: false, reason: page.reason };
    }
    return { ok: true, snapshot: outcome.run, reason: outcome.reason };
  }

  async function refresh(record) {
    const key = record.tokenHash;
    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const at = new Date();
      // Stamp before any await so a timeout, build throw or save throw cannot
      // skip it, and sweep stale entries so the map stays bounded.
      for (const [k, ts] of attempts) {
        if (at.getTime() - ts >= FAILURE_BACKOFF_MS) attempts.delete(k);
      }
      attempts.set(key, at.getTime());
      // A read, probe, projection, scan, store write or snapshot build failure
      // is a REFRESH failure, not an unhandled rejection: the handler then
      // serves last-good (row 6) or 503 (row 7). Without this the rejection
      // escapes and production returns 500. The whole run path sits inside it
      // (LIN-3243 L4).
      try {
        const result = isRunRecord(record) ? await readRun(record) : await readCollection(record);
        if (!result.ok) {
          // A failed attempt still stamps `lastRefreshAttemptAt` (row 7 backoff)
          // but must never disturb the last good snapshot (row 6).
          await shareStore.saveSnapshot(key, null, { at });
          return { ok: false, reason: result.reason };
        }
        // A revalidate re-saves the SAME snapshot, which bumps `snapshotAt`.
        await shareStore.saveSnapshot(key, result.snapshot, { at });
        // Success persisted the stamp; a stale-record GET must not read this as a failure.
        attempts.delete(key);
        return { ok: true, snapshot: result.snapshot, snapshotAt: at, reason: result.reason, revalidated: result.revalidated === true };
      } catch (err) {
        return { ok: false, reason: 'refresh_error' };
      }
    })().finally(() => { inflight.delete(key); });

    inflight.set(key, promise);
    return promise;
  }

  router.get('/s/:token', readLimiter, async (req, res) => {
    // Security headers on EVERY response from this route (200 or error).
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Robots-Tag', 'noindex');

    const { token } = req.params;
    // Matrix row 1's cheap reject: a malformed token never reaches the store.
    if (!isWellFormedShareToken(token)) return res.status(404).send('Not found');

    let record;
    try {
      record = await shareStore.getByToken(token);
    } catch (err) {
      return res.status(503).end();
    }
    if (!record) return res.status(404).send('Not found');      // row 1
    if (record.revokedAt) return res.status(410).send('Gone');  // row 2

    let owner;
    try {
      owner = await workspaceOwnerCheck({ workspaceId: record.workspaceId, accountId: record.ownerAccountId });
    } catch (err) {
      return res.status(503).end();                             // row 4
    }
    if (!owner || owner.status !== 'owner') return res.status(410).end(); // row 3

    const now = Date.now();
    const snapshotAtMs = record.snapshotAt ? new Date(record.snapshotAt).getTime() : null;

    // Row 5: fresh snapshot, no provider read at all.
    if (record.snapshot != null && snapshotAtMs != null && now - snapshotAtMs < SNAPSHOT_TTL_MS) {
      return serve(res, record, false);
    }

    // A prior attempt NEWER than the last success must have failed → longer backoff.
    const recordedAttemptMs = record.lastRefreshAttemptAt ? new Date(record.lastRefreshAttemptAt).getTime() : null;
    // The in-process stamp is the fallback when a store-write outage prevents
    // `lastRefreshAttemptAt` from persisting (LIN-3255). Drop it once expired:
    // past FAILURE_BACKOFF_MS it cannot change any `due` result.
    let attemptMs = attempts.get(record.tokenHash);
    if (attemptMs != null && now - attemptMs >= FAILURE_BACKOFF_MS) {
      attempts.delete(record.tokenHash);
      attemptMs = null;
    }
    const lastAttemptMs = attemptMs == null ? recordedAttemptMs
      : recordedAttemptMs == null ? attemptMs
        : Math.max(recordedAttemptMs, attemptMs);
    const lastFailed = lastAttemptMs != null && (snapshotAtMs == null || lastAttemptMs > snapshotAtMs);
    const interval = lastFailed ? FAILURE_BACKOFF_MS : MIN_REFRESH_INTERVAL_MS;
    // `inflight.has` keeps concurrent GETs joining an in-flight refresh even
    // after the winner stamped an attempt (a null snapshot must not 503).
    const due = inflight.has(record.tokenHash) || lastAttemptMs == null || now - lastAttemptMs >= interval;

    if (due) {
      const result = await refresh(record);
      if (result.ok) {
        return serveSnapshot(res, record, { snapshot: result.snapshot, snapshotAt: result.snapshotAt, stale: false });
      }
      if (record.snapshot != null) {
        // A stale snapshot whose refresh failed serves last-good, marked
        // "as of <snapshotAt>" (ruling `lin3073-owner-unresolvable`:
        // serve-last-good). Rows 3, 4 and 7 are unaffected.
        return serve(res, record, true);
      }
      return res.status(503).end();                            // row 7
    }

    // Throttled/backing off: zero provider reads. Serve last-good if we have it.
    if (record.snapshot != null) return serve(res, record, true);
    return res.status(503).end();                              // row 7
  });

  // =========================================================================
  // Owner management surface (LIN-3244, Session B of LIN-3073)
  //
  // GET/POST /workspace/:urlKey/shares and POST .../shares/:id/revoke. All
  // three run behind `workspaceFromUrl` and the shared owner-mint refusal gate
  // FIRST, before any validation, provider read or mint (F7, mirroring
  // routes/dispatch.js's token mint). Create is additionally rate-limited.
  // =========================================================================
  if (typeof workspaceFromUrl === 'function') {
    const ownerRefusal = (req) => resolveOwnerMintRefusal({
      ownerCheck: workspaceOwnerCheck,
      workspaceId: req.workspace.id,
      accountId: req.session?.accountId,
      subject: 'a share link'
    });

    /**
     * Create a RUN share (LIN-3313): the run must exist in THIS workspace (the
     * Mongo-only probe is scoped by `urlKey`, so an unknown run and another
     * workspace's run are both refused 404 before any credential or provider
     * read); then the first snapshot is read on the owner's credential,
     * rendered and scanned synchronously — no first snapshot, or a first
     * snapshot the scan rejects, refuses the share and persists nothing.
     */
    async function createRunShare(req, res, normalized) {
      const { workspace } = req;
      if (typeof readOwnerRun !== 'function' || typeof probeRun !== 'function') {
        return jsonError(res, 503, 'Run share links are not available here.', { code: 'RUN_SHARES_UNAVAILABLE' });
      }
      let probe;
      try {
        probe = await probeRun(workspace.urlKey, normalized.id);
      } catch {
        return jsonError(res, 503, 'Could not read the run to share; nothing was created. Try again.',
          { code: 'SHARE_SNAPSHOT_UNAVAILABLE', reason: 'refresh_error' });
      }
      if (!probe || probe.reason !== 'ok') {
        return jsonError(res, 404, 'Run not found in this workspace; nothing was created.', { code: 'SHARE_RUN_NOT_FOUND' });
      }

      let outcome;
      try {
        outcome = await readOwnerRun(workspace.urlKey, req.session.accountId, normalized.id);
      } catch {
        outcome = { reason: 'refresh_error', run: null };
      }
      if (outcome == null || outcome.run == null || outcome.reason !== 'ok') {
        return jsonError(res, 503, 'Could not read the run to share; nothing was created. Try again.',
          { code: 'SHARE_SNAPSHOT_UNAVAILABLE', reason: outcome?.reason ?? 'refresh_error' });
      }
      // S7b: a first snapshot the secret scan rejects is never stored, so the
      // share is refused rather than minted with nothing servable.
      const page = renderScannedRun(outcome.run, outcome.run.capturedAt, false);
      if (!page.ok) {
        console.warn(`Run share create refused: ${page.reason} (urlKey=${workspace.urlKey}) — LIN-3313`);
        return jsonError(res, 422,
          'This run\'s page did not pass the secret scan, so it cannot be shared; nothing was created.',
          { code: 'SHARE_SCAN_REFUSED' });
      }

      let created;
      try {
        created = await shareStore.create({
          urlKey: workspace.urlKey,
          workspaceId: workspace.id,
          ownerAccountId: req.session.accountId,
          subject: normalized
        });
        await shareStore.saveSnapshot(created.record.tokenHash, outcome.run, { at: new Date() });
      } catch (err) {
        console.error('Share creation error:', err.message);
        return jsonError(res, 500, 'Failed to create share link');
      }
      return res.status(201).json({ token: created.token, url: `/s/${created.token}` });
    }

    // Create: refusal gate → subject validation → provider capability → first
    // snapshot synchronously → persist. A refused or unsupported request mints
    // nothing; a failed first read persists nothing.
    router.post('/workspace/:urlKey/shares', createLimiter, workspaceFromUrl, async (req, res) => {
      const { workspace } = req;
      const refusal = await ownerRefusal(req);
      if (refusal) return ownerRefusalResponse(res, refusal, workspace);

      const { subject, includeDescriptions } = req.body || {};
      if (!isValidSubjectInput(subject)) {
        return badRequest.json(res, 'subject must be { kind: "parent"|"label"|"run", id }');
      }
      // A run share takes its own path: none of the collection branches below
      // (the parent-only provider check and identifier mapping, descriptions)
      // apply to it.
      if (subject.kind === 'run') {
        return createRunShare(req, res, { type: subjectTypeForKind('run'), kind: 'run', id: subject.id.trim() });
      }
      // L9: `id` is the provider-native key. For a parent it is the parent
      // issue's `id`, the exact value `fetchProjects` emits as `issue.parent.id`
      // (Linear: the issue UUID), so the snapshot's `parent.id === subject.id`
      // membership test matches. The form lets the owner type the human
      // identifier (`LIN-3057`) OR the id; a parent input is resolved below
      // against the issue set this request already fetched, using the codebase's
      // existing id-or-identifier idiom (routes/proxy.js:163,
      // routes/workspace-api.js:2196). No new resolver route is added.
      const normalized = { type: subjectTypeForKind(subject.kind), kind: subject.kind, id: subject.id.trim() };

      // Approving verdict (b): refuse a parent share when the provider cannot
      // represent subtasks — `github`/`github-projects` declare `ui.subtasks:
      // false` and always emit `parent: null`, so such a share would be empty.
      // Label shares work on every provider.
      if (normalized.kind === 'parent') {
        let provider;
        try {
          provider = getProviderForWorkspace?.(workspace);
        } catch {
          provider = null;
        }
        if (provider?.ui?.subtasks === false) {
          return jsonError(res, 422,
            'This workspace\'s provider has no subtasks, so a parent share would always be empty. Share a label instead.',
            { code: 'PARENT_SHARES_UNSUPPORTED' });
        }
      }

      let outcome;
      try {
        outcome = await readOwnerIssues(workspace.urlKey, req.session.accountId);
      } catch {
        outcome = { reason: 'refresh_error', issues: null };
      }
      if (outcome == null || outcome.issues == null || outcome.reason !== 'ok') {
        return jsonError(res, 503, 'Could not read the collection to share; nothing was created. Try again.',
          { code: 'SHARE_SNAPSHOT_UNAVAILABLE', reason: outcome?.reason ?? 'refresh_error' });
      }

      // L9 (cont.): map a parent's human identifier to its provider-native id.
      // A value that matches no issue is kept verbatim — it may already be the
      // provider id of a parent that is not in this set (e.g. archived).
      if (normalized.kind === 'parent') {
        const needle = normalized.id.toLowerCase();
        const parent = outcome.issues.find(i =>
          i.id === normalized.id || (i.identifier || '').toLowerCase() === needle);
        if (parent) normalized.id = parent.id;
      }

      let created;
      try {
        const snapshot = buildShareSnapshot({
          subject: normalized,
          issues: outcome.issues,
          includeDescriptions: includeDescriptions === true
        });
        created = await shareStore.create({
          urlKey: workspace.urlKey,
          workspaceId: workspace.id,
          ownerAccountId: req.session.accountId,
          subject: normalized,
          includeDescriptions: includeDescriptions === true
        });
        await shareStore.saveSnapshot(created.record.tokenHash, snapshot, { at: new Date() });
      } catch (err) {
        console.error('Share creation error:', err.message);
        return jsonError(res, 500, 'Failed to create share link');
      }

      // The token is returned exactly once; the list never carries it.
      return res.status(201).json({ token: created.token, url: `/s/${created.token}` });
    });

    // List: refusal gate → metadata only. No raw token (never stored) and no
    // `tokenHash` field; `id` is the opaque record key used by revoke.
    router.get('/workspace/:urlKey/shares', workspaceFromUrl, async (req, res) => {
      const { workspace } = req;
      const refusal = await ownerRefusal(req);
      if (refusal) return ownerRefusalResponse(res, refusal, workspace);

      try {
        const rows = await shareStore.listByUrlKey(workspace.urlKey);
        return res.json({ shares: rows.map(shareListItem) });
      } catch (err) {
        console.error('Share list error:', err.message);
        return jsonError(res, 500, 'Failed to list share links');
      }
    });

    // Preview (LIN-3315, S8b of LIN-2950): the owner sees EXACTLY the guest
    // page a share link would serve, built from a FRESH projection each time.
    // Owner-gated (a non-owner is refused before any credential read) and
    // no-store/noindex: it is a private, always-current preview, not the
    // cached `/s/:token` path. The HTML rides the SAME render-then-scan path
    // (`renderScannedRun`) the share uses, so the two cannot drift.
    router.get('/workspace/:urlKey/observation/session/:sessionId/guest-preview', workspaceFromUrl, async (req, res) => {
      const { workspace } = req;
      const refusal = await ownerRefusal(req);
      if (refusal) return ownerRefusalResponse(res, refusal, workspace);

      res.set('Referrer-Policy', 'no-referrer');
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Robots-Tag', 'noindex');

      const { sessionId } = req.params;
      if (!sessionId) return res.status(404).end();
      if (typeof readOwnerRun !== 'function') {
        return jsonError(res, 503, 'Run share links are not available here.', { code: 'RUN_SHARES_UNAVAILABLE' });
      }

      let outcome;
      try {
        outcome = await readOwnerRun(workspace.urlKey, req.session.accountId, sessionId);
      } catch {
        outcome = { reason: 'refresh_error', run: null };
      }
      if (outcome == null || outcome.run == null || outcome.reason !== 'ok') {
        const reason = outcome?.reason ?? 'refresh_error';
        return jsonError(res, reason === 'run_not_found' ? 404 : 503,
          reason === 'run_not_found' ? 'No such run in this workspace.' : 'Could not build the guest preview for this run.',
          { code: 'RUN_PREVIEW_UNAVAILABLE', reason });
      }
      const page = renderScannedRun(outcome.run, outcome.run.capturedAt, false);
      if (!page.ok) {
        console.warn(`Run preview refused: ${page.reason} (urlKey=${workspace.urlKey}) — LIN-3315`);
        return res.status(503).end();
      }
      return res.status(200).type('html').send(page.html);
    });

    // Revoke: refusal gate → resolve the derived id WITHIN this workspace (a
    // share in another workspace is never even considered, so cross-workspace
    // revoke is refused) → revoke by record id.
    router.post('/workspace/:urlKey/shares/:id/revoke', workspaceFromUrl, async (req, res) => {
      const { workspace } = req;
      const refusal = await ownerRefusal(req);
      if (refusal) return ownerRefusalResponse(res, refusal, workspace);

      const { id } = req.params;
      let record;
      try {
        const rows = await shareStore.listByUrlKey(workspace.urlKey);
        record = rows.find(r => publicShareId(r._id) === id);
      } catch (err) {
        console.error('Share revoke read error:', err.message);
        return jsonError(res, 503, 'Share store unavailable');
      }
      if (!record) {
        return jsonError(res, 404, 'Share link not found');
      }

      try {
        const revoked = await shareStore.revokeById(record._id, workspace.urlKey);
        if (!revoked) return jsonError(res, 404, 'Share link not found');
        return res.json({ success: true, share: shareListItem(revoked) });
      } catch (err) {
        console.error('Share revoke error:', err.message);
        return jsonError(res, 500, 'Failed to revoke share link');
      }
    });
  }

  return router;
}
