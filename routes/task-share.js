/**
 * Task share routes (LIN-3330, Subtask C of LIN-3324).
 *
 * OWNER (session, behind `workspaceFromUrl`, gated by the shared owner-mint
 * refusal — the same seam the runner/dispatch mints use):
 *   POST /workspace/:urlKey/api/task/:identifier/share          — mint a link
 *   GET  /workspace/:urlKey/api/task/:identifier/shares         — list (no token)
 *   POST /workspace/:urlKey/api/task/:identifier/shares/:id/revoke — revoke
 *
 * PUBLIC (no session; `/t/` is exempt from PAT auto-login and token refresh):
 *   GET /t/:token        — the guest task page (owner page, controls hidden)
 *   GET /t/:token/state  — stored-data repaint, same JSON as the owner endpoint
 *
 * Refusal contract (the plan's request matrix): a malformed token 404s BEFORE
 * any store read; unknown, revoked, owner-changed and (for the page) a
 * tracker-not-found all answer the SAME 404; a store/owner-check throw, a
 * credential that cannot be used, and a tracker outage all answer the SAME 503.
 * Revoked is deliberately indistinguishable from never-issued. There is no
 * stored-only fallback and no rate limit (John's rulings, LIN-3261 owns
 * public-page secret review).
 *
 * The 5-second cache holds ONLY the loader's `{model}` result, per
 * `(urlKey, issueIdentifier, source)`, with single-flight so concurrent guests
 * share one tracker read. Failures are never cached, and it sits after every
 * auth check, so a revoke or an owner change takes effect on the next request.
 */

import { Router } from 'express';
import { renderErrorPage } from '../lib/render.js';
import { jsonError } from '../lib/errors.js';
import { isValidIssueId } from '../lib/workspace.js';
import { isWellFormedTaskShareToken } from '../lib/task-share-store.js';
import { resolveOwnerMintRefusal } from '../lib/owner-mint-refusals.js';
import {
  renderTaskPage,
  renderTaskStatus,
  renderTaskTrack,
  renderTaskContext,
} from '../lib/render-task-page.js';

/** The loader-result cache window. A revoke/owner change still lands next request. */
export const TASK_SHARE_CACHE_MS = 5000;

/** The one guest refusal sentence, shared by the page and the state endpoint. */
const UNAVAILABLE_MESSAGE = "This page isn't available right now. Please try again shortly.";

/** A non-empty query/body string value, else undefined. */
function stringValue(value) {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * The list projection (a share's public shape): never a token, never a hash.
 */
function shareItem(record) {
  return { id: record._id, createdAt: record.createdAt, revokedAt: record.revokedAt || null };
}

function ownerRefusalResponse(res, refusal, workspace) {
  console.warn(`Task share refused: ${refusal.code} (urlKey=${workspace.urlKey}) — LIN-3330`);
  return jsonError(res, refusal.status, refusal.error, {
    code: refusal.code,
    category: refusal.category,
    retryable: refusal.retryable,
  });
}

/** The 404 body, byte-identical for malformed, unknown, revoked and owner-changed. */
function notFound(res) {
  return res.status(404).send('Not found');
}

/** The 503 body, byte-identical for store/owner-check throws and unusable credentials. */
function unavailablePage(res) {
  return res.status(503).send(renderErrorPage('Task unavailable', UNAVAILABLE_MESSAGE));
}

/**
 * @param {Object} deps
 * @param {import('../lib/task-share-store.js').TaskShareStore} deps.taskShareStore
 * @param {{loadTaskPage: Function, loadTaskState: Function}} deps.loader
 * @param {Function} deps.workspaceFromUrl
 * @param {(args: {workspaceId?: string, accountId?: string}) => Promise<{status: string}>} deps.workspaceOwnerCheck
 * @param {(record: Object) => Promise<{provider: Object, callScope: *}|null>} deps.guestAccess
 * @param {Function} [deps.getDeployInfo]
 * @param {Function} [deps.now]
 * @returns {import('express').Router}
 */
export function createTaskShareRoutes({
  taskShareStore,
  loader,
  workspaceFromUrl,
  workspaceOwnerCheck,
  guestAccess,
  getDeployInfo = () => ({}),
  now = () => new Date(),
} = {}) {
  if (!taskShareStore) throw new Error('task-share routes: taskShareStore is required');
  if (!loader) throw new Error('task-share routes: loader is required');
  const router = Router();

  // ── Loader-result cache (model only, single-flight, failures never cached) ──
  const cache = new Map();
  const inflight = new Map();

  function cachedLoadPage(key, run) {
    const hit = cache.get(key);
    if (hit && now().getTime() - hit.at < TASK_SHARE_CACHE_MS) return Promise.resolve(hit.result);
    const pending = inflight.get(key);
    if (pending) return pending;
    const promise = Promise.resolve()
      .then(run)
      .then((result) => {
        // Only a rendered model is cached; notFound/unavailable/throws never are.
        if (result && result.model) cache.set(key, { at: now().getTime(), result });
        return result;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  /**
   * Resolve a token to a servable record. Never throws; the caller maps the
   * `kind` to a status. Rows 1-4 of the request matrix.
   */
  async function resolveScopedRecord(token) {
    if (!isWellFormedTaskShareToken(token)) return { kind: 'malformed' };
    let record;
    try {
      record = await taskShareStore.getByToken(token);
    } catch {
      return { kind: 'unavailable' };
    }
    if (!record || record.revokedAt) return { kind: 'notfound' };
    let owner;
    try {
      owner = await workspaceOwnerCheck({ workspaceId: record.workspaceId, accountId: record.ownerAccountId });
    } catch {
      return { kind: 'unavailable' };
    }
    if (!owner || owner.status !== 'owner') return { kind: 'notfound' };
    return { kind: 'ok', record };
  }

  // ── Public guest surface ───────────────────────────────────────────────────
  // Headers on EVERY response under /t/ (200, 404 and 503 alike).
  router.use('/t', (req, res, next) => {
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Robots-Tag', 'noindex');
    next();
  });

  router.get('/t/:token', async (req, res) => {
    const { token } = req.params;
    const scoped = await resolveScopedRecord(token);
    if (scoped.kind === 'malformed' || scoped.kind === 'notfound') return notFound(res);
    if (scoped.kind === 'unavailable') return unavailablePage(res);
    const { record } = scoped;

    let access;
    try {
      access = await guestAccess(record);
    } catch {
      access = null;
    }
    // Row 5: no usable owner credential. No stored-only fallback.
    if (!access) return unavailablePage(res);

    let result;
    try {
      const key = `${record.urlKey}\u0000${record.issueIdentifier}\u0000${record.source || ''}`;
      result = await cachedLoadPage(key, () => loader.loadTaskPage({
        urlKey: record.urlKey,
        identifier: record.issueIdentifier,
        access,
      }));
    } catch (error) {
      console.error('Task share page error:', error.message);
      return unavailablePage(res);
    }
    if (result.notFound) return notFound(res);
    if (result.unavailable) return unavailablePage(res);

    const { model } = result;
    return res.send(renderTaskPage(model, {
      viewer: 'guest',
      urlKey: record.urlKey,
      binding: { source: record.source },
      stateUrl: `/t/${encodeURIComponent(token)}/state`,
      now: now(),
      pageOptions: { deployInfo: getDeployInfo(), workspaces: [], featureFlags: {}, openRouterSource: null },
    }));
  });

  router.get('/t/:token/state', async (req, res) => {
    const { token } = req.params;
    const scoped = await resolveScopedRecord(token);
    if (scoped.kind === 'malformed' || scoped.kind === 'notfound') return jsonError(res, 404, 'Not found');
    if (scoped.kind === 'unavailable') return jsonError(res, 503, UNAVAILABLE_MESSAGE);
    const { record } = scoped;

    try {
      // Stored data only: no provider read, no credential resolve. Nothing new is read.
      const { model } = await loader.loadTaskState({
        urlKey: record.urlKey,
        identifier: record.issueIdentifier,
        issueId: record.issueId,
      });
      res.set('Cache-Control', 'no-store');
      return res.json({
        status: model.status,
        live: model.live,
        headerHtml: renderTaskStatus(model),
        trackHtml: renderTaskTrack(model, { now: now() }),
        contextHtml: renderTaskContext(model, { urlKey: record.urlKey }),
      });
    } catch (error) {
      console.error('Task share state error:', error.message);
      return jsonError(res, 503, UNAVAILABLE_MESSAGE);
    }
  });

  // ── Owner management surface ───────────────────────────────────────────────
  const ownerRefusal = (req) => resolveOwnerMintRefusal({
    ownerCheck: workspaceOwnerCheck,
    workspaceId: req.workspace.id,
    accountId: req.session?.accountId,
    subject: 'a share link',
  });

  router.post('/workspace/:urlKey/api/task/:identifier/share', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;
    const refusal = await ownerRefusal(req);
    if (refusal) return ownerRefusalResponse(res, refusal, workspace);

    const { identifier } = req.params;
    if (!isValidIssueId(identifier)) return jsonError(res, 404, 'Task not found');

    const body = req.body || {};
    const issueId = stringValue(body.issueId);
    // The page's create URL carries `?source=` (harbourHref); accept it either
    // way so the client can post a body or just use the rendered URL.
    const source = stringValue(body.source) || stringValue(req.query.source);
    try {
      const { token, record } = await taskShareStore.create({
        urlKey: workspace.urlKey,
        workspaceId: workspace.id,
        ownerAccountId: req.session.accountId,
        issueIdentifier: identifier,
        issueId: issueId && isValidIssueId(issueId) ? issueId : null,
        source: source || null,
      });
      return res.status(201).json({ id: record._id, path: `/t/${token}`, createdAt: record.createdAt });
    } catch (error) {
      console.error('Task share create error:', error.message);
      return jsonError(res, 500, 'Failed to create share link');
    }
  });

  router.get('/workspace/:urlKey/api/task/:identifier/shares', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;
    const refusal = await ownerRefusal(req);
    if (refusal) return ownerRefusalResponse(res, refusal, workspace);

    const { identifier } = req.params;
    if (!isValidIssueId(identifier)) return jsonError(res, 404, 'Task not found');
    try {
      const shares = await taskShareStore.listForTask(workspace.urlKey, identifier);
      return res.json({ shares });
    } catch (error) {
      console.error('Task share list error:', error.message);
      return jsonError(res, 500, 'Failed to list share links');
    }
  });

  router.post('/workspace/:urlKey/api/task/:identifier/shares/:id/revoke', workspaceFromUrl, async (req, res) => {
    const { workspace } = req;
    const refusal = await ownerRefusal(req);
    if (refusal) return ownerRefusalResponse(res, refusal, workspace);

    const { identifier, id } = req.params;
    if (!isValidIssueId(identifier)) return jsonError(res, 404, 'Task not found');
    try {
      const record = await taskShareStore.revoke(id, { urlKey: workspace.urlKey, issueIdentifier: identifier });
      if (!record) return jsonError(res, 404, 'Share link not found');
      return res.json({ success: true, share: shareItem(record) });
    } catch (error) {
      console.error('Task share revoke error:', error.message);
      return jsonError(res, 500, 'Failed to revoke share link');
    }
  });

  return router;
}
