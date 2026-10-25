/**
 * Settings, one page per area (LIN-3846), moved out of server.js the way
 * routes/settings-model.js was (LIN-3853), following LIN-3742's flat routes and
 * LIN-3755's rule that a renderer takes the workspace it is given.
 *
 *   GET  /workspace/:urlKey/settings                         the index (the list of areas)
 *   GET  /workspace/:urlKey/settings/:area                   one area (lib/settings-areas.js)
 *   POST /workspace/:urlKey/settings/workspace-features      periodic reviews and agents-can-change-models; asks why, logs, Undo
 *   POST /workspace/:urlKey/settings/running/halt            pause / stop / resume; OWNER-ONLY
 *   POST /workspace/:urlKey/settings/change-log/:source/:id/undo
 *
 * Halt is a request the runner honours, so both halt writers here
 * (`running/halt` and the undo of a `halt` entry) call
 * `resolveRunnerOwnerRefusal` before the first store write (LIN-3398/3408),
 * and the LIN-3383 census (tests/unit/lin-3383-runner-enqueue-census.test.js)
 * pins that. Any member may still change periodic reviews (John, 24 Oct: "happy
 * with any member being able to change the settings").
 *
 * The other settings POSTs (features, theme, providers, proxy-default, the
 * model forms, OpenRouter) stay where they were; only their redirect target
 * moved to the area that holds them.
 */
import { Router } from 'express';
import { renderSettingsPage } from '../lib/render-settings.js';
import { renderErrorPage } from '../lib/render.js';
import { AREAS, getArea, settingsAreaUrl } from '../lib/settings-areas.js';
import { FEATURE_DEFAULTS, isValidWorkspaceFeatureKey } from '../lib/feature-defaults.js';
import { buildKeyList, latestRunnerPoll } from '../lib/settings-keys.js';
import { hasLiveRunnerKey, hasLiveQueueToken } from '../lib/run-controls.js';
import { readOwnerSeamStatus } from '../lib/workspace-owner.js';
import { resolveRunnerOwnerRefusal, sendRunnerRefusal } from '../lib/runner-owner-gate.js';
import { mergeChangeLog, ChangeLogError, UNKNOWN_VALUE } from '../lib/workspace-change-log.js';
import { HALT_MODES, HALT_MODE_ERROR } from '../lib/workspace-halt.js';
import { CREDENTIAL_DEAD_VERDICT } from '../lib/credential-state.js';
import { badRequest, serverError } from '../lib/errors.js';

/**
 * Provider-action notice from the redirect's query (LIN-634/LIN-2803).
 *
 * Moved verbatim from server.js. The `activate` affordance only ever ADDS to a
 * notice, and only when the one-shot post-bind flash's own provider matches
 * THIS notice's `provider_ok` (a stale or cross-tab flash must not attach to an
 * unrelated notice) and that provider's add genuinely binds onto this workspace
 * rather than creating a separate one (`createsWorkspace !== true`: Linear's add
 * still writes a flash but never earns `activate`).
 * @param {Object} query - req.query
 * @param {{provider: string, scope: string}|null} [flash] - the just-read-and-cleared session flash
 * @param {(name: string) => any} getProvider
 * @returns {{type: 'ok'|'fail'|'blocked', text: string, activate?: {provider: string, scope: string}}|null}
 */
export function providerNoticeFromQuery(query = {}, flash = null, getProvider = () => null) {
  if (query.provider_blocked) {
    return { type: 'blocked', text: `Adding ${query.provider_blocked} is not available yet.` };
  }
  if (query.provider_removed) {
    return { type: 'ok', text: `Removed ${query.provider_removed} binding.` };
  }
  if (query.provider_switched) {
    return { type: 'ok', text: `Switched active provider to ${query.provider_switched}.` };
  }
  if (query.provider_ok) {
    const notice = { type: 'ok', text: `${query.provider_ok} credentials are valid.` };
    if (flash && flash.provider === query.provider_ok && getProvider(flash.provider)?.addProvider?.createsWorkspace !== true) {
      notice.activate = { provider: flash.provider, scope: flash.scope };
    }
    return notice;
  }
  if (query.provider_fail) {
    return { type: 'fail', text: `${query.provider_fail} credentials failed validation.` };
  }
  if (query.provider_error) {
    return { type: 'fail', text: 'Provider action could not be completed.' };
  }
  return null;
}

const PROVIDER_QUERY_KEYS = ['provider_ok', 'provider_fail', 'provider_error', 'provider_removed', 'provider_switched', 'provider_blocked'];

/** Short messages for the `?error=` codes the change-log redirects carry (never a reflected string). */
const CHANGE_ERRORS = {
  reason: 'A reason is needed (up to 500 characters).',
  conflict: 'That setting has changed since, so undo would overwrite it. Nothing was changed.',
  not_found: 'That change is not in the log.',
  not_undoable: 'That change cannot be undone.',
  already_undone: 'That change was already undone.',
  log_failed: 'The change was saved but its log entry was not. Check the Change log.'
};

const DEFAULT_REASON_LIMIT = 500;

/**
 * The workspace feature switches that are changes for everyone, with the area each lives in.
 * A new workspace feature key must be added here (and to the change log's SETTINGS) before the
 * route accepts it: it would otherwise change for everyone with no reason and no log entry.
 */
const LOGGED_WORKSPACE_FEATURES = { periodicals: 'running', modelRoutingProxyWrites: 'agent-access' };

function cookieTheme(req) {
  if (req.session?.theme === 'dark' || req.session?.theme === 'light') return req.session.theme;
  const m = /(?:^|;\s*)theme=(dark|light)/.exec(req.headers?.cookie || '');
  return m ? m[1] : 'light';
}

function modelDisplayName(modelId, availableModels = []) {
  const known = availableModels.find(m => m.id === modelId);
  if (known?.name) return known.name;
  return String(modelId || '').split('/').pop() || 'Default';
}

export function createSettingsRouter(deps) {
  const {
    workspaceFromUrl, getOpenRouterSource, getDeployInfo, userPreferencesStore, workspacePreferencesStore,
    llmCallLogStore, promptTraceStore, accountStore, requestFeatureFlags, resolveWorkspaceModel,
    getWorkspaceFeatures, setWorkspaceFeature, projectLegacy, getModelCatalog, shouldMockAi, AVAILABLE_MODELS,
    getProvider, getProviderForWorkspace, getBindingsForWorkspace, getBindingCredentials, isActiveBinding,
    dispatchPresetsStore, proxyTokenStore, dispatchTokenStore, proxyEventStore, workspaceHaltStore,
    workspaceChangeLogStore, modelRoutingStore, workspaceOwnerCheck
  } = deps;
  const router = Router();

  const ownerOf = async (req) => {
    const accountId = req.session?.accountId;
    if (!accountId || !workspaceOwnerCheck) return false;
    const { status } = await readOwnerSeamStatus(() => workspaceOwnerCheck({ workspaceId: req.workspace.id, accountId }));
    return status === 'owner';
  };

  const actorOf = (req) => ({ via: 'page', ...(req.session?.accountId ? { id: req.session.accountId } : {}) });
  const reasonOf = (req) => (typeof req.body?.reason === 'string' ? req.body.reason.trim() : '');
  const reasonOk = (reason) => reason.length > 0 && reason.length <= DEFAULT_REASON_LIMIT;
  const backTo = (workspace, areaId, query) => settingsAreaUrl(workspace.urlKey, areaId, query);
  const wantsJson = (req) => req.headers['x-requested-with'] === 'XMLHttpRequest';

  // The owner gate for every session-side halt write (LIN-3398/3408). One call shape:
  // the refusal envelope, or null when the viewer owns the workspace. It uses the ONE
  // hoisted owner seam (`workspaceOwnerCheck`, server.js); fail-closed when it is absent.
  const haltRefusal = (req) => resolveRunnerOwnerRefusal({
    ownerCheck: workspaceOwnerCheck,
    workspaceId: req.workspace.id,
    accountId: req.session?.accountId
  });

  /**
   * The ONLY place this router touches the halt store, so the LIN-3383 census
   * (tests/unit/lin-3383-runner-enqueue-census.test.js) pins one gated site per sink.
   * It gates itself first and returns the refusal (or null once written): callers
   * also gate earlier where the order matters (a member must be refused before a
   * reason or a conflict is looked at), and that earlier call is not what the census
   * trusts. `value` is 'none' (resume), 'pause' or 'stop'.
   */
  async function writeHalt(req, value, { reason, quiet = false } = {}) {
    const refusal = await haltRefusal(req);
    if (refusal) return refusal;
    const urlKey = req.workspace.urlKey;
    const setBy = req.session?.accountId || null;
    // `quiet` (Undo): the change log writes its own single `undo` row, so the halt
    // store's hook must not add a "Changed outside Settings" one.
    if (value === 'none') {
      await workspaceHaltStore.clearWorkspaceHalt(urlKey, { via: 'page', setBy, reason, quiet });
    } else {
      await workspaceHaltStore.setWorkspaceHalt(urlKey, { mode: value, setBy, now: new Date(), via: 'page', reason, quiet });
    }
    return null;
  }

  async function readHaltMode(urlKey) {
    if (!workspaceHaltStore) return 'none';
    try {
      const doc = await workspaceHaltStore.getWorkspaceHalt(urlKey);
      return doc?.mode || 'none';
    } catch {
      return UNKNOWN_VALUE;
    }
  }

  async function readChangeRows(urlKey) {
    const [workspaceRows, modelRows] = await Promise.all([
      workspaceChangeLogStore ? workspaceChangeLogStore.getLog(urlKey, { limit: 50 }).catch(() => []) : [],
      modelRoutingStore ? modelRoutingStore.getLog(urlKey, { limit: 50 }).catch(() => []) : []
    ]);
    return mergeChangeLog(workspaceRows, modelRows);
  }

  /**
   * Render one area (or the index when `areaId` is null). Reads only what the
   * sidebar's state words and the shown area need.
   */
  async function sendSettingsPage(req, res, areaId) {
    const workspace = req.workspace;
    const bodyAreaId = areaId || AREAS[0].id;

    // One-shot session flash (LIN-2803): read and delete unconditionally, on
    // EVERY settings load (index and each area), even when this load carries no
    // matching `provider_ok` — a stale flash must never survive a second,
    // unrelated settings load. `resave: false` still persists the deletion.
    const providerAddedFlash = req.session.providerAdded || null;
    delete req.session.providerAdded;
    const providerNotice = providerNoticeFromQuery(req.query, providerAddedFlash, getProvider);

    // Determine OpenRouter connection status
    const openRouterSource = getOpenRouterSource(req);
    const deployInfo = getDeployInfo();

    // Durable unattended-use consent state (LIN-2412) — a FRESH read of the
    // current account's own durable preferences, never from req.session (the
    // interactive chain never reads this field, and this route must not start
    // mirroring it into the session either).
    const openRouterConsentedAt = req.session.accountId
      ? await userPreferencesStore.getOpenRouterConsent(req.session.accountId)
      : null;

    const currentModel = await resolveWorkspaceModel({ urlKey: workspace.urlKey, workspacePreferencesStore });
    const workspaceFeatures = await getWorkspaceFeatures({ urlKey: workspace.urlKey, store: workspacePreferencesStore });
    const featureFlags = await requestFeatureFlags(req);

    // Provider bindings (LIN-634): shape each with its provider's display name;
    // mark the binding matching the workspace's active pointer AND whose
    // credential is the one mirrored into the scalar fields.
    const providerBindings = getBindingsForWorkspace(workspace).map(b => ({
      provider: b.provider,
      scope: b.scope,
      displayName: getProvider(b.provider)?.ui?.displayName || b.provider,
      token: getBindingCredentials(b)?.token,
      active: isActiveBinding(workspace, b),
    }));

    // Keys, the runner's presence and the halt, for Running / Agent access / Health.
    const [proxyRows, dispatchRows, haltMode, isOwner, changeRows, credentialHealth] = await Promise.all([
      proxyTokenStore.listTokens(workspace.urlKey),
      dispatchTokenStore.listTokens(workspace.urlKey),
      readHaltMode(workspace.urlKey),
      ownerOf(req),
      readChangeRows(workspace.urlKey),
      proxyEventStore ? proxyEventStore.listCredentialHealth(workspace.urlKey) : { tokens: [] }
    ]);
    const hasRunner = hasLiveRunnerKey(proxyRows) || hasLiveQueueToken(dispatchRows);
    const keys = buildKeyList({ proxyRows, dispatchRows, isOwner, urlKey: workspace.urlKey });
    const lastPoll = latestRunnerPoll({ proxyRows, dispatchRows });
    const problems = (credentialHealth?.tokens || []).filter(t => t.verdict === CREDENTIAL_DEAD_VERDICT);
    const proxyDefault = req.session.proxyDefault !== false;

    const states = {};
    const stateCtx = {
      providerBindings,
      defaultModelName: modelDisplayName(currentModel, AVAILABLE_MODELS),
      haltMode, hasRunner,
      // Person-made live keys only: per-run keys are a separate row (LIN-3890).
      keyCount: keys.filter(k => !k.run).length,
      healthProblems: problems.length,
      changeLogCount: changeRows.length,
      featuresOn: Object.keys(FEATURE_DEFAULTS).filter(k => featureFlags[k] ?? FEATURE_DEFAULTS[k]).length + (proxyDefault ? 1 : 0),
      openRouterSource
    };
    for (const a of AREAS) states[a.id] = a.state(stateCtx);

    // Heavy reads only for the page that shows them.
    let llmStats = null;
    let providerContextSummary = null;
    if (bodyAreaId === 'health') {
      llmStats = await llmCallLogStore.summarize(workspace.urlKey);
      // Provider-context disclosure (LIN-2357): a null providerUi on a recorded
      // prompt trace as counts + a coverage basis.
      providerContextSummary = await promptTraceStore.summarizeProviderContext(
        workspace.urlKey,
        { expectedUi: getProviderForWorkspace(workspace)?.ui || null }
      );
    }

    let dispatchDefaults = {};
    let aiModelOverrides = {};
    let dispatchPresets = [];
    let dispatchModelCatalog = [];
    if (bodyAreaId === 'models') {
      // LIN-3853: the routing table, projected back to the shape the legacy forms render.
      const prefs = projectLegacy(await workspacePreferencesStore.getRoutingTable(workspace.urlKey));
      dispatchDefaults = prefs.dispatchDefaults || {};
      aiModelOverrides = prefs.aiModelOverrides || {};
      try {
        dispatchPresets = dispatchPresetsStore ? await dispatchPresetsStore.list(workspace.urlKey) : [];
      } catch (e) {
        // Non-fatal: the section renders empty.
      }
      // Live OpenRouter catalog, mocked by the same predicate as the AI mock so
      // automated runs never make a live network call.
      dispatchModelCatalog = await getModelCatalog({ mock: shouldMockAi(workspace) });
    }

    // The account's own email identity, read fresh (canonicalised) — never from req.session.
    const accountEmails = bodyAreaId === 'account' && req.session.accountId
      ? await accountStore.listEmailIdentities(req.session.accountId)
      : [];

    const errorCode = typeof req.query.error === 'string' ? req.query.error : null;
    const flash = {
      error: CHANGE_ERRORS[errorCode] || null,
      changed: req.query.changed ? 'Saved.' : null,
      undone: req.query.undone ? true : null,
      consentOff: req.query.consent_off === '1'
    };

    const html = renderSettingsPage(workspace.name || 'Workspace', {
      area: areaId,
      states,
      openRouterConnected: !!(openRouterSource === 'oauth' || openRouterSource === 'env'),
      openRouterSource,
      openRouterConsentedAt,
      deployInfo,
      currentModel,
      availableModels: AVAILABLE_MODELS,
      // The legacy model forms redirect back with `?error=<code>` (routes/settings-model.js).
      modelError: bodyAreaId === 'models' ? errorCode : null,
      urlKey: workspace.urlKey,
      workspaces: req.session.workspaces,
      featureFlags,
      workspaceFeatures,
      llmStats,
      providerContextSummary,
      providerBindings,
      providerNotice,
      dispatchDefaults,
      dispatchDefaultsError: req.query.dispatchDefaultsError || null,
      dispatchModelCatalog,
      aiModelOverrides,
      aiOverridesError: req.query.aiOverridesError || null,
      dispatchPresets,
      accountEmails,
      theme: cookieTheme(req),
      proxyDefault,
      flash,
      isOwner,
      running: { runSetup: isOwner && !hasRunner, hasRunner, lastPoll, haltMode },
      keys,
      health: { problems, lastPoll },
      changeLogRows: changeRows,
      viewerAccountId: req.session?.accountId || null,
      // Gate the GitHub add affordance on the SAME shared predicate the
      // /auth/github route guard and landing hero use (LIN-761).
      githubEnabled: getProvider('github').entryCta.isConfigured(),
      jiraOAuthEnabled: getProvider('jira').entryCta.isConfigured()
    });
    res.send(html);
  }

  router.get('/workspace/:urlKey/settings', workspaceFromUrl, async (req, res) => {
    // A provider return that reached the bare index (a bookmark, an old link)
    // goes to Sources with its query intact, before the flash is read: on a
    // phone the index shows only the list, so the notice would be lost and the
    // one-shot flash spent. The target GET spends the flash.
    if (PROVIDER_QUERY_KEYS.some(k => k in req.query)) {
      const qs = new URLSearchParams(Object.entries(req.query).filter(([, v]) => typeof v === 'string')).toString();
      return res.redirect(`${settingsAreaUrl(req.workspace.urlKey, 'sources')}${qs ? `?${qs}` : ''}`);
    }
    return sendSettingsPage(req, res, null);
  });

  router.get('/workspace/:urlKey/settings/:area', workspaceFromUrl, async (req, res, next) => {
    const area = getArea(req.params.area);
    if (!area) return next();
    return sendSettingsPage(req, res, area.id);
  });

  // -------------------------------------------------------------------------
  // Periodic reviews: for everyone, so it asks why and lands in the change log.
  // Persists to workspace preferences only — never session.features or the
  // per-user store. Any member may change it (John, 24 Oct), so no owner gate.
  // -------------------------------------------------------------------------
  router.post('/workspace/:urlKey/settings/workspace-features', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { feature, enabled } = req.body || {};

    if (!feature || !isValidWorkspaceFeatureKey(feature)) {
      return badRequest.json(res, 'Invalid workspace feature key');
    }
    const area = LOGGED_WORKSPACE_FEATURES[feature];
    if (!area) {
      return badRequest.json(res, 'Unsupported workspace feature key');
    }
    const reason = reasonOf(req);
    if (!reasonOk(reason)) {
      return badRequest.json(res, 'A reason is required (up to 500 characters)');
    }

    const isEnabled = enabled === 'true' || enabled === true;
    const before = !!(await getWorkspaceFeatures({ urlKey: workspace.urlKey, store: workspacePreferencesStore }))[feature];

    try {
      const ok = await setWorkspaceFeature({ urlKey: workspace.urlKey, featureKey: feature, enabled: isEnabled, store: workspacePreferencesStore });
      if (!ok) throw new Error('setWorkspaceFeature returned false');
    } catch (err) {
      console.error('Failed to save workspace feature toggle:', err);
      return res.status(500).send(renderErrorPage('Settings Error', 'Failed to save workspace feature. Please try again.', {
        action: 'Back to settings',
        actionUrl: backTo(workspace, area)
      }));
    }

    try {
      await workspaceChangeLogStore.record({ urlKey: workspace.urlKey, setting: feature, reason, actor: actorOf(req), from: before, to: isEnabled });
    } catch (err) {
      console.error('workspace-change-log: the setting changed but its log entry could not be written', err);
      return res.redirect(backTo(workspace, area, { error: 'log_failed' }));
    }

    if (wantsJson(req)) return res.json({ ok: true, feature, enabled: isEnabled });
    return res.redirect(backTo(workspace, area, { changed: '1' }));
  });

  // -------------------------------------------------------------------------
  // Pause / stop / resume. OWNER-ONLY, in the order the Dispatch route uses:
  // mode validated first (400), then the owner gate, then the write. The store's
  // change hook (server.js `setOnChange`) records it in the change log with this
  // typed reason; a hook failure never fails the halt.
  // -------------------------------------------------------------------------
  router.post('/workspace/:urlKey/settings/running/halt', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const mode = req.body?.mode;
    if (mode !== 'resume' && !HALT_MODES.includes(mode)) {
      return badRequest.json(res, `${HALT_MODE_ERROR} (or 'resume')`);
    }

    const early = await haltRefusal(req);
    if (early) return sendRunnerRefusal(res, early);

    const reason = reasonOf(req);
    if (!reasonOk(reason)) return res.redirect(backTo(workspace, 'running', { error: 'reason' }));
    if (!workspaceHaltStore) return serverError.json(res, 'Failed to set halt');

    try {
      const refusal = await writeHalt(req, mode === 'resume' ? 'none' : mode, { reason });
      if (refusal) return sendRunnerRefusal(res, refusal);
    } catch (err) {
      console.error('Workspace halt (Settings) error:', err.message);
      return serverError.json(res, 'Failed to set halt');
    }
    return res.redirect(backTo(workspace, 'running', { changed: '1' }));
  });

  // -------------------------------------------------------------------------
  // Undo, for either log. `source=model` goes to ModelRoutingStore.undo
  // unchanged (it refuses on a conflict). `source=workspace` undoes a
  // periodicals change (any member) or a halt change (OWNER-ONLY: undoing a
  // stop resumes runs, which would loosen LIN-3408; the gate runs before the
  // conflict check and before any write).
  // -------------------------------------------------------------------------
  router.post('/workspace/:urlKey/settings/change-log/:source/:id/undo', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { source, id } = req.params;
    const toLog = (code) => res.redirect(backTo(workspace, 'change-log', { error: code }));
    const reason = reasonOf(req);

    if (source === 'model') {
      if (!reasonOk(reason)) return toLog('reason');
      try {
        await modelRoutingStore.undo(id, { urlKey: workspace.urlKey, reason, actor: actorOf(req) });
      } catch (err) {
        const code = { CONFLICT: 'conflict', NOT_FOUND: 'not_found', NOT_UNDOABLE: 'not_undoable', REASON_REQUIRED: 'reason' }[err?.code];
        if (!code) throw err;
        return toLog(code);
      }
      return res.redirect(backTo(workspace, 'change-log', { undone: '1' }));
    }
    if (source !== 'workspace') return badRequest.json(res, 'Unknown log');

    const entry = await workspaceChangeLogStore.getEntry(workspace.urlKey, id);
    if (!entry) return toLog('not_found');

    if (entry.setting === 'halt') {
      const refusal = await haltRefusal(req);
      if (refusal) return sendRunnerRefusal(res, refusal);
    }
    if (!reasonOk(reason)) return toLog('reason');

    const applyValue = entry.setting === 'halt'
      ? async (value) => {
        const refusal = await writeHalt(req, value, { quiet: true });
        if (refusal) throw new ChangeLogError('NOT_UNDOABLE', refusal.error);
      }
      : async (value) => {
        const ok = await setWorkspaceFeature({ urlKey: workspace.urlKey, featureKey: entry.setting, enabled: value === true, store: workspacePreferencesStore });
        if (!ok) throw new Error('setWorkspaceFeature returned false');
      };
    const readCurrent = entry.setting === 'halt'
      ? () => readHaltMode(workspace.urlKey)
      : async () => !!(await getWorkspaceFeatures({ urlKey: workspace.urlKey, store: workspacePreferencesStore }))[entry.setting];

    try {
      await workspaceChangeLogStore.undo(id, { urlKey: workspace.urlKey, reason, actor: actorOf(req), readCurrent, apply: applyValue });
    } catch (err) {
      if (!(err instanceof ChangeLogError)) throw err;
      const code = { CONFLICT: 'conflict', NOT_FOUND: 'not_found', NOT_UNDOABLE: 'not_undoable', ALREADY_UNDONE: 'already_undone', REASON_REQUIRED: 'reason' }[err.code];
      if (!code) throw err;
      return toLog(code);
    }
    return res.redirect(backTo(workspace, 'change-log', { undone: '1' }));
  });

  return router;
}
