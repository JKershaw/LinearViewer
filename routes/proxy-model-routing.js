/**
 * Proxy model-routing routes (LIN-3854, step 3 of LIN-3820): an agent reads the routing
 * table and, only when the workspace has switched it on, changes it.
 *
 *   Reads (any token):
 *     GET  /api/proxy/model-routing                      — every job's effective setting, groups, defaults
 *     GET  /api/proxy/model-routing/presets
 *     GET  /api/proxy/model-routing/log?limit=
 *   Writes (readWrite token AND the workspace setting `modelRoutingProxyWrites`):
 *     POST /api/proxy/model-routing/jobs/:jobId          { reason, harness?, model?, effort? }
 *     POST /api/proxy/model-routing/groups/:group        { reason, surface, harness?, model?, effort? }
 *     POST /api/proxy/model-routing/presets/:presetId/apply   { reason }
 *     POST /api/proxy/model-routing/log/:entryId/undo    { reason }
 *
 * Gate order on a write: auth -> write scope -> workspace setting -> body validation ->
 * store. The setting is checked before the body so an off workspace neither validates
 * nor writes anything, and a read token gets the scope 403 first. Off is
 * `403 MODEL_ROUTING_WRITES_DISABLED` naming the setting.
 *
 * The setting is changed ONLY by the session-authed POST /settings/workspace-features.
 * This file reads it (`isWorkspaceFeatureEnabled` on `req.proxyUrlKey`, never
 * client-supplied) and never writes it; no read response reports its value, so the 403
 * is the only signal. Any readWrite token may write while it is on (no owner-only gate,
 * by ruling on LIN-3820).
 *
 * Attribution: actor = { via: 'proxy', id: token creator, tokenId }. `id` is the field
 * account erasure rewrites and the read-time name lookup resolves; the token label is
 * free text and is deliberately not stored.
 *
 * The store checks shape only (string, 1,000 chars), so the route validates the values
 * an agent may set: agent-session fields as the dispatch routes do, Harbour-call models
 * against the provider/model pattern. Never 503 here (a 503 trips logCredentialRejection,
 * as in routes/proxy-halt.js).
 *
 * `modelRoutingStore` and `workspacePreferencesStore` are undefaulted so the DI census
 * counts them as required; null at runtime is handled with a JSON 500.
 */
import { Router } from 'express';
import { jsonError } from '../lib/errors.js';
import { WORKSPACE_FEATURES } from '../lib/feature-defaults.js';
import { isWorkspaceFeatureEnabled } from '../lib/workspace-preferences.js';
import { GROUPS, SURFACES, getJob } from '../lib/llm-jobs.js';
import { FIELDS, MAX_REASON_LENGTH, MODEL_ID_PATTERN, RoutingError, effortNotAppliedForChanges } from '../lib/model-routing.js';
import { validateOpaqueDispatchField, MAX_NAME_LENGTH } from '../lib/dispatch-validation.js';
import { DEFAULT_MODEL } from '../lib/openrouter.js';

const BASE = '/api/proxy/model-routing';
export const MODEL_ROUTING_WRITES_DISABLED = 'MODEL_ROUTING_WRITES_DISABLED';
const SETTING = WORKSPACE_FEATURES.MODEL_ROUTING_PROXY_WRITES;
const DEFAULT_LOG_LIMIT = 50;
const MAX_LOG_LIMIT = 200;
const MAX_HARBOUR_MODEL_LENGTH = 100;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Validate the settings in a body for one surface. Returns { patch } or { error }. */
function readPatch(body, surface) {
  const allowed = FIELDS[surface];
  const patch = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'reason' || key === 'surface') continue;
    if (!allowed.includes(key)) return { error: `${surface} settings have no "${key}" field; allowed: ${allowed.join(', ')}` };
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') return { error: `${key} must be a string, or null to clear it` };
    if (value !== null) {
      if (surface === SURFACES.HARBOUR_CALL) {
        if (value.length > MAX_HARBOUR_MODEL_LENGTH || value.includes('..') || !MODEL_ID_PATTERN.test(value)) {
          return { error: 'model must look like provider/model (for example anthropic/claude-sonnet-4)' };
        }
      } else {
        if (value.trim() === '') return { error: `${key} must not be blank; send null to clear it` };
        const bad = validateOpaqueDispatchField(value, key, { maxLength: MAX_NAME_LENGTH });
        if (bad) return { error: bad.error };
      }
    }
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) return { error: `nothing to change: send at least one of ${allowed.join(', ')}` };
  return { patch };
}

function readReason(body) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return { error: 'reason is required: say why the model is changing' };
  if (reason.length > MAX_REASON_LENGTH) return { error: `reason is at most ${MAX_REASON_LENGTH} characters` };
  return { reason };
}

/** A log row as the proxy shows it: the actor's name and token id, never the account id. */
function publicEntry(row) {
  const { actor = {}, urlKey, ...rest } = row;
  return { ...rest, actor: { via: actor.via, ...(actor.name !== undefined ? { name: actor.name } : {}), ...(actor.tokenId ? { tokenId: actor.tokenId } : {}) } };
}

/**
 * @param {Object} deps
 * @param {Object} deps.modelRoutingStore - lib/model-routing-store.js
 * @param {Object} deps.workspacePreferencesStore - read for the workspace setting only
 * @param {Function} deps.proxyLimiter
 * @param {Function} deps.authenticateProxyToken
 * @param {Function} deps.requireWriteScope
 * @param {Function} deps.logEvent
 */
export function createProxyModelRoutingRoutes({ modelRoutingStore, workspacePreferencesStore, proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent }) {
  const router = Router();

  const done = (req, res, route, status, payload) => {
    logEvent(req, route, status);
    return res.status(status).json(payload);
  };
  const fail = (req, res, route, status, message, extra) => {
    logEvent(req, route, status);
    return jsonError(res, status, message, extra);
  };

  async function readRoute(req, res, route, load) {
    if (!modelRoutingStore) return fail(req, res, route, 500, 'Failed to read the model routing table');
    try {
      return done(req, res, route, 200, await load());
    } catch (err) {
      console.error('Model routing read error:', err.message);
      return fail(req, res, route, 500, 'Failed to read the model routing table');
    }
  }

  router.get(BASE, proxyLimiter, authenticateProxyToken, (req, res) => readRoute(req, res, BASE, async () => {
    const table = await modelRoutingStore.getEffectiveTable(req.proxyUrlKey, { defaultModel: DEFAULT_MODEL });
    return { ...table, defaults: { ...table.defaults, harbourFallbackModel: DEFAULT_MODEL } };
  }));

  router.get(`${BASE}/presets`, proxyLimiter, authenticateProxyToken, (req, res) => readRoute(req, res, `${BASE}/presets`, async () => {
    const presets = await modelRoutingStore.listPresets(req.proxyUrlKey);
    return { presets: presets.map(({ _id, name, createdAt }) => ({ id: _id, name, createdAt })) };
  }));

  router.get(`${BASE}/log`, proxyLimiter, authenticateProxyToken, (req, res) => readRoute(req, res, `${BASE}/log`, async () => {
    const asked = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LOG_LIMIT) : DEFAULT_LOG_LIMIT;
    const entries = await modelRoutingStore.getLog(req.proxyUrlKey, { limit });
    return { entries: entries.map(publicEntry) };
  }));

  /**
   * Resolves true when the write was REFUSED (response sent). Runs after the scope check
   * and before any body validation or store call.
   */
  async function refuseUnlessEnabled(req, res, route) {
    if (!modelRoutingStore || !workspacePreferencesStore) {
      fail(req, res, route, 500, 'Failed to change the model routing table');
      return true;
    }
    let enabled;
    try {
      enabled = await isWorkspaceFeatureEnabled({ urlKey: req.proxyUrlKey, featureKey: SETTING, store: workspacePreferencesStore });
    } catch (err) {
      console.error('Model routing setting read error:', err.message);
      fail(req, res, route, 500, 'Failed to change the model routing table');
      return true;
    }
    if (enabled) return false;
    fail(req, res, route, 403, 'Agents cannot change model routing in this workspace. A member can switch it on in Settings (setting: modelRoutingProxyWrites).', {
      code: MODEL_ROUTING_WRITES_DISABLED,
      setting: SETTING
    });
    return true;
  }

  function mapError(req, res, route, err) {
    if (err instanceof RoutingError) {
      const status = { REASON_REQUIRED: 400, INVALID: 400, NOT_FOUND: 404, CONFLICT: 409, NOT_UNDOABLE: 422 }[err.code];
      if (status) return fail(req, res, route, status, err.message, { code: err.code, ...(err.details ? { details: err.details } : {}) });
      if (err.code === 'LOG_WRITE_FAILED') {
        return fail(req, res, route, 500, `${err.message}. Do not retry blindly: read the table and the log first.`, { code: err.code });
      }
    }
    console.error('Model routing write error:', err.message);
    return fail(req, res, route, 500, 'Failed to change the model routing table');
  }

  /**
   * The handler for one write: gate, reason, validate (`prepare`), then the store call.
   * Each route is registered with its own literal POST registration below so the proxy endpoint
   * inventory census (which counts registrations in source) sees every one.
   */
  function writeHandler(path, prepare) {
    return async (req, res) => {
      const route = `${BASE}${path}`;
      if (await refuseUnlessEnabled(req, res, route)) return;
      const body = isObject(req.body) ? req.body : {};
      const { reason, error } = readReason(body);
      if (error) return fail(req, res, route, 400, error, { code: 'REASON_REQUIRED' });
      const prepared = await prepare(req, body);
      if (prepared.error) return fail(req, res, route, prepared.status || 400, prepared.error);
      const ctx = {
        urlKey: req.proxyUrlKey,
        reason,
        actor: { via: 'proxy', ...(req.proxyCreatedBy ? { id: req.proxyCreatedBy } : {}), ...(req.proxyTokenId ? { tokenId: req.proxyTokenId } : {}) }
      };
      try {
        const entry = await prepared.run(ctx);
        // LIN-3857 (D3): the write is accepted (refusing it would break the legitimate order "set
        // effort, then change harness"); where a touched job now stores an effort its harness
        // ignores, the response says so instead of letting the mismatch pass unremarked. The store
        // is unchanged and the stored value is not rewritten. Sparse: absent when nothing applies.
        const effortNotApplied = effortNotAppliedForChanges(await modelRoutingStore.getTable(ctx.urlKey), entry.changes);
        return done(req, res, route, 200, {
          success: true,
          entry: publicEntry({ ...entry, actor: { ...entry.actor } }),
          ...(effortNotApplied.length ? { effortNotApplied } : {})
        });
      } catch (err) {
        return mapError(req, res, route, err);
      }
    };
  }
  const writeChain = [proxyLimiter, authenticateProxyToken, requireWriteScope];

  router.post(`${BASE}/jobs/:jobId`, ...writeChain, writeHandler('/jobs/:jobId', (req, body) => {
    const job = getJob(req.params.jobId);
    if (!job) return { status: 404, error: `no job "${req.params.jobId}"` };
    const { patch, error } = readPatch(body, job.surface);
    if (error) return { error };
    return { run: (ctx) => modelRoutingStore.changeJob(job.id, patch, ctx) };
  }));

  router.post(`${BASE}/groups/:group`, ...writeChain, writeHandler('/groups/:group', (req, body) => {
    const group = req.params.group;
    if (!Object.hasOwn(GROUPS, group)) return { status: 404, error: `no group "${group}"` };
    const surface = body.surface;
    if (surface !== SURFACES.AGENT_SESSION && surface !== SURFACES.HARBOUR_CALL) {
      return { error: `surface is required: "${SURFACES.AGENT_SESSION}" or "${SURFACES.HARBOUR_CALL}"` };
    }
    const { patch, error } = readPatch(body, surface);
    if (error) return { error };
    return { run: (ctx) => modelRoutingStore.changeGroup(surface, group, patch, ctx) };
  }));

  router.post(`${BASE}/presets/:presetId/apply`, ...writeChain, writeHandler('/presets/:presetId/apply', (req) => ({ run: (ctx) => modelRoutingStore.applyPreset(req.params.presetId, ctx) })));

  router.post(`${BASE}/log/:entryId/undo`, ...writeChain, writeHandler('/log/:entryId/undo', (req) => ({ run: (ctx) => modelRoutingStore.undo(req.params.entryId, ctx) })));

  return router;
}
