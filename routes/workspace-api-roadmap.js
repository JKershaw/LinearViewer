/**
 * Roadmap API routes (LIN-2246: extracted from workspace-api.js).
 *
 * Handles /workspace/:urlKey/api/roadmap/* — saved north star, report
 * history, server-orchestrated multi-layer generation over SSE, per-task
 * orientation bearings, and roadmap Q&A chat.
 */
import { Router } from 'express';
import { createHash } from 'crypto';
import { badRequest, jsonError, notFound, unauthorized } from '../lib/errors.js';
import { getNorthStarDocVersion } from '../lib/north-star-resolver.js';
import { getProviderForWorkspace } from '../lib/providers/registry.js';
import { buildRoadmapModel } from '../lib/roadmap.js';
import { buildRoadmapNarrativeMessages } from '../lib/prompts/roadmap-narrative-template.js';
import { buildRoadmapProductMessages } from '../lib/prompts/roadmap-product-template.js';
import { buildRoadmapTrajectoryMessages } from '../lib/prompts/roadmap-trajectory-template.js';
import { buildRoadmapNorthStarMessages } from '../lib/prompts/roadmap-north-star-template.js';
import { buildRoadmapGapMessages } from '../lib/prompts/roadmap-gap-template.js';
import { buildRoadmapDigestMessages } from '../lib/prompts/roadmap-digest-template.js';
import { buildRoadmapOrientationMessages, serializeOrientationCandidates, countOrientationCandidates, parseOrientationLines, ORIENTATION_BEARINGS } from '../lib/prompts/roadmap-orientation-template.js';
import { resolveReasoningBudget, streamChat, AVAILABLE_MODELS, getPaidEnvKey, hasPaidEnvKey } from '../lib/openrouter.js';
import { resolveWorkspaceModel } from '../lib/workspace-preferences.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { getWorkspaceCallScope, matchTeamId } from '../lib/workspace.js';
import { testMockTeams, testMockData } from '../tests/fixtures/mock-data.js';

/**
 * Whether the AI layer should be mocked for this request (LIN-388). Mirrors
 * the identically-named/identically-defined helper in workspace-api.js (and
 * next-run.js, task-chat.js, ship-biscuit.js) — this codebase's established
 * convention is to duplicate this 3-line predicate per route module rather
 * than share it via import, so route modules stay independently movable.
 * @param {Object} workspace - req.workspace (carries provider + accessToken)
 * @returns {boolean}
 */
function shouldMockAi(workspace) {
  return process.env.NODE_ENV === 'test' &&
    (workspace?.accessToken === 'test-token' || workspace?.provider === 'local');
}

/**
 * Helper: write an SSE event to the response. Mirrors the identically-named
 * helper still in workspace-api.js (used by the recommend group) — kept as a
 * local duplicate rather than a shared import, per the same reasoning as
 * shouldMockAi above.
 * @param {Object} res - Express response
 * @param {string} type - Event type
 * @param {Object} data - Event data (will be JSON-stringified)
 */
function sendSSE(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Apply a per-request roadmap model override against the already-resolved
 * workspace default (LIN-819). The roadmap generate endpoint is the only site
 * that lets a user pick a stronger model for a single generation without
 * touching the workspace-wide default. Pure/synchronous; two gates only:
 *   - Free tier is clamped: a free-tier request ALWAYS keeps the workspace
 *     default (which resolveWorkspaceModel already forced to DEFAULT_MODEL), so
 *     a body-supplied model can't bill an expensive model against the shared
 *     free-tier key (LIN-513).
 *   - Allow-list: only a curated AVAILABLE_MODELS id is honored. An unknown,
 *     invalid, empty, or non-string value falls back to the workspace default,
 *     so nothing unchecked ever reaches OpenRouter. The curated select IS the
 *     validation here (stronger than a format regex; the roadmap selector offers
 *     no free-text custom id).
 *
 * @param {*} requested - Raw `req.body.model` (untrusted).
 * @param {string} workspaceModel - Model already resolved for this workspace.
 * @param {boolean} isFreeTier - Whether this request is on the free tier.
 * @returns {string} The model id to generate with.
 */
export function resolveRoadmapModelOverride(requested, workspaceModel, isFreeTier) {
  if (isFreeTier) return workspaceModel;
  const id = typeof requested === 'string' ? requested.trim() : '';
  if (id && AVAILABLE_MODELS.some(m => m.id === id)) return id;
  return workspaceModel;
}

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl - Middleware resolving req.workspace from :urlKey
 * @param {Object} deps.freeTierStore - Atomic free-tier usage counter (tryUse)
 * @param {Object} deps.userPreferencesStore - Cross-device north-star sync (best-effort)
 * @param {Object} deps.workspacePreferencesStore - Workspace-wide model preference
 * @param {Object} deps.reportHistoryStore - Durable saved-report storage (LIN-299)
 */
export function createRoadmapRoutes({ workspaceFromUrl, freeTierStore, userPreferencesStore, workspacePreferencesStore, reportHistoryStore }) {
  const router = Router();

  // ===========================================================================
  // Roadmap API Endpoints
  // ===========================================================================

  const NORTH_STAR_MAX_CHARS = 8000;

  /**
   * Get the saved north star for this workspace.
   * Reads from session; auth callback hydrates the session from user prefs.
   * @route GET /workspace/:urlKey/api/roadmap/north-star
   */
  router.get('/workspace/:urlKey/api/roadmap/north-star', workspaceFromUrl, (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      return jsonError(res, 403, 'Roadmap feature is not enabled');
    }
    const byWorkspace = req.session.northStarByWorkspace || {};
    const northStar = byWorkspace[req.workspace.urlKey] || '';
    res.json({ northStar });
  });

  /**
   * Set the north star for this workspace.
   * Writes to session (authoritative) and best-effort to user preferences for
   * cross-device sync, mirroring the modelId/features pattern.
   * @route PUT /workspace/:urlKey/api/roadmap/north-star
   */
  router.put('/workspace/:urlKey/api/roadmap/north-star', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      return jsonError(res, 403, 'Roadmap feature is not enabled');
    }

    const { northStar } = req.body || {};
    if (typeof northStar !== 'string') {
      return badRequest.json(res, 'northStar must be a string');
    }
    if (northStar.length > NORTH_STAR_MAX_CHARS) {
      return badRequest.json(res, `northStar must be ${NORTH_STAR_MAX_CHARS} characters or fewer`);
    }

    if (!req.session.northStarByWorkspace) {
      req.session.northStarByWorkspace = {};
    }
    req.session.northStarByWorkspace[req.workspace.urlKey] = northStar;

    // Doc-version stamping (LIN-2254): a stamp is recorded ONLY when the
    // pasted text byte-matches docs/north-star.md's current content — every
    // other (typical, unrelated) workspace value gets no stamp at all,
    // rather than a fabricated drift claim against arbitrary text. Always
    // overwritten (including to null) so an edit that breaks a prior match
    // doesn't leave a stale stamp behind.
    const currentDoc = getNorthStarDocVersion();
    const pastedHash = createHash('sha256').update(northStar).digest('hex');
    const stampedDocVersion = (currentDoc.hash && pastedHash === currentDoc.hash)
      ? { hash: currentDoc.hash, title: currentDoc.title }
      : null;

    if (!req.session.northStarDocVersionByWorkspace) {
      req.session.northStarDocVersionByWorkspace = {};
    }
    req.session.northStarDocVersionByWorkspace[req.workspace.urlKey] = stampedDocVersion;

    // Best-effort write-through to user preferences for cross-device sync.
    // Non-fatal: session is authoritative.
    if (userPreferencesStore && req.session.accountId) {
      try {
        const existing = await userPreferencesStore.getUserPreferences(req.session.accountId);
        const existingMap = existing.northStarByWorkspace || {};
        const existingDocVersionMap = existing.northStarDocVersionByWorkspace || {};
        await userPreferencesStore.saveUserPreferences(req.session.accountId, {
          ...existing,
          northStarByWorkspace: {
            ...existingMap,
            [req.workspace.urlKey]: northStar
          },
          northStarDocVersionByWorkspace: {
            ...existingDocVersionMap,
            [req.workspace.urlKey]: stampedDocVersion
          }
        });
      } catch (err) {
        console.error('Failed to persist north star to preferences store:', err);
      }
    }

    res.json({ ok: true });
  });

  // ===========================================================================
  // Roadmap Report History (LIN-299)
  //
  // Durable per-workspace storage for completed report runs so the roadmap
  // reading survives a page reload. These are plain DB read/writes — NOT LLM
  // calls — so they are gated on the roadmap feature flag only (no free-tier
  // check, no H12 keepalive). The save happens client-side after all five
  // narrative streams complete.
  // ===========================================================================

  /**
   * Persist a completed report run.
   * The resolved model and timestamp are stamped server-side so the record is
   * trustworthy and consistent with how the layer endpoints pick their model.
   * @route POST /workspace/:urlKey/api/roadmap/reports
   */
  router.post('/workspace/:urlKey/api/roadmap/reports', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      return jsonError(res, 403, 'Roadmap feature is not enabled');
    }
    if (!reportHistoryStore) {
      return jsonError(res, 503, 'Report history not configured');
    }

    const { northStar, narrative, orientation } = req.body || {};
    if (!narrative || typeof narrative !== 'object' || Array.isArray(narrative)) {
      return badRequest.json(res, 'narrative object is required');
    }
    if (northStar !== undefined && typeof northStar !== 'string') {
      return badRequest.json(res, 'northStar must be a string');
    }
    if (orientation !== undefined && !Array.isArray(orientation)) {
      return badRequest.json(res, 'orientation must be an array');
    }

    try {
      const model = await resolveWorkspaceModel({ urlKey: req.workspace.urlKey, workspacePreferencesStore });
      const report = await reportHistoryStore.save(req.workspace.urlKey, {
        model,
        northStar: typeof northStar === 'string' ? northStar : '',
        narrative,
        orientation
      });
      res.status(201).json({ report });
    } catch (error) {
      console.error('Report save error:', error);
      jsonError(res, 500, 'Failed to save report');
    }
  });

  /**
   * List saved reports for this workspace, newest-first.
   * @route GET /workspace/:urlKey/api/roadmap/reports?limit={n}
   */
  router.get('/workspace/:urlKey/api/roadmap/reports', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      return jsonError(res, 403, 'Roadmap feature is not enabled');
    }
    if (!reportHistoryStore) {
      return jsonError(res, 503, 'Report history not configured');
    }

    let limit;
    if (req.query.limit !== undefined) {
      const parsed = parseInt(req.query.limit, 10);
      if (!Number.isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 50);
    }

    try {
      const { items, total } = await reportHistoryStore.list(req.workspace.urlKey, { limit });
      res.json({ reports: items, total });
    } catch (error) {
      console.error('Report list error:', error);
      jsonError(res, 500, 'Failed to list reports');
    }
  });

  /**
   * Fetch a single saved report (full record) by id — backs the history UI's
   * view-on-click. The list endpoint returns summaries only, so this is the
   * way to retrieve a report's narrative bodies.
   * @route GET /workspace/:urlKey/api/roadmap/reports/:id
   */
  router.get('/workspace/:urlKey/api/roadmap/reports/:id', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      return jsonError(res, 403, 'Roadmap feature is not enabled');
    }
    if (!reportHistoryStore) {
      return jsonError(res, 503, 'Report history not configured');
    }

    try {
      const report = await reportHistoryStore.get(req.workspace.urlKey, req.params.id);
      if (!report) {
        return notFound.json(res, 'Report not found');
      }
      res.json({ report });
    } catch (error) {
      console.error('Report get error:', error);
      jsonError(res, 500, 'Failed to fetch report');
    }
  });

  /**
   * Resolve the LLM credentials + model for the roadmap generate endpoint.
   * Does feature-flag and API-key gating, but does NOT charge the free tier —
   * the generate endpoint charges per-layer so a full reading costs the same
   * number of free-tier units as the old per-call pipeline did (LIN-317).
   * Sends the appropriate error response and returns null on failure.
   * Returns { apiKey, model, isFreeTier } when ready to proceed.
   */
  async function resolveRoadmapLLM(req, res) {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      jsonError(res, 403, 'Roadmap feature is not enabled');
      return null;
    }

    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;
    const apiKey = sessionApiKey || getPaidEnvKey() || freeTierKey;
    if (!apiKey) {
      jsonError(res, 503, 'AI not configured. Connect OpenRouter or set OPENROUTER_API_KEY.');
      return null;
    }

    const workspaceModel = await resolveWorkspaceModel({ urlKey: req.workspace.urlKey, workspacePreferencesStore, forceDefault: isFreeTier });

    // Per-request roadmap model override (LIN-819). A user may pick a stronger
    // model for just this generation without changing the workspace-wide default
    // (which feeds ~15 other call sites). The override is ephemeral — never
    // persisted to workspacePreferencesStore. Two floors are load-bearing:
    //   1. Free tier stays clamped to the default (forceDefault won it above) so
    //      a body-supplied model can't bill an arbitrary expensive model against
    //      the operator's shared key.
    //   2. Only curated AVAILABLE_MODELS ids are honored — an unknown/invalid id
    //      is never passed unchecked to OpenRouter; it silently falls back to the
    //      workspace default, preserving existing behavior.
    const model = resolveRoadmapModelOverride(req.body?.model, workspaceModel, isFreeTier);
    return { apiKey, model, isFreeTier };
  }

  /**
   * Atomically charge one free-tier unit for a layer about to run. Returns the
   * store's check result ({ allowed, ... }). Non-free-tier callers are always
   * allowed without touching the store.
   */
  async function chargeRoadmapLayer(req, isFreeTier) {
    if (!isFreeTier) return { allowed: true };
    return freeTierStore.tryUse(req.workspace.urlKey);
  }

  /**
   * Stream one pipeline layer over the shared SSE connection (LIN-317). All
   * events are tagged with the layer id so the client can demultiplex many
   * layers from one connection. Never sets headers (the caller flushes once)
   * and never ends the response (the caller emits the terminal `done`). A layer
   * failure emits a `layer-error` event and resolves { ok: false } so the
   * pipeline can continue to the next layer per the design doc's failure modes.
   *
   * @returns {Promise<{ok: boolean, text: string, finishReason: ?string}>}
   */
  async function streamLayer(res, { messages, apiKey, model, maxTokens, layer, layerName, urlKey }) {
    sendSSE(res, 'layer-start', { layer });
    let text = '';
    let finishReason = null;
    // LIN-1000: split the layer budget so hidden reasoning can't starve the
    // narrative prose. `maxTokens` here is the prose budget; the helper reserves
    // reasoning headroom on top for reasoning models (a no-op otherwise).
    const { reasoning, maxTokens: budget } = resolveReasoningBudget({ model, proseTokens: maxTokens });
    try {
      await streamChat(
        messages,
        { apiKey, model, maxTokens: budget, reasoning, callMeta: { urlKey: urlKey || null, feature: 'roadmap', issueIdentifier: layer || null } },
        (type, data) => {
          if (type === 'token') {
            const token = (data && data.token) || '';
            text += token;
            sendSSE(res, 'token', { layer, token });
          } else if (type === 'done') {
            finishReason = data ? data.finishReason : null;
          }
        }
      );
      sendSSE(res, 'layer-done', { layer, finishReason });
      return { ok: true, text, finishReason };
    } catch (error) {
      console.error(`Roadmap ${layerName} stream error:`, error);
      sendSSE(res, 'layer-error', { layer, message: `Failed to generate ${layerName}` });
      return { ok: false, text: '', finishReason: null };
    }
  }

  /**
   * Test-mode mock for one layer: emits the same layer-tagged event sequence as
   * streamLayer, split into two token chunks so the client's accumulation path
   * is exercised. Returns the same shape as streamLayer.
   */
  function emitMockLayer(res, { layer, text }) {
    sendSSE(res, 'layer-start', { layer });
    const half = Math.max(1, Math.floor(text.length / 2));
    sendSSE(res, 'token', { layer, token: text.slice(0, half) });
    sendSSE(res, 'token', { layer, token: text.slice(half) });
    sendSSE(res, 'layer-done', { layer, finishReason: 'stop' });
    return { ok: true, text, finishReason: 'stop' };
  }

  // Gates the roadmap generate endpoint's mocks (the testMockData data branch at
  // the fetch, the per-layer emitMockLayer AI mock, and the orientation
  // short-circuit / __testOrientationRaw seam). LIN-409 widened this from the old
  // `test-token`-only predicate onto the shared `shouldMockAi` superset so a
  // GENUINE `provider: 'local'` session also reaches the AI mock — CI has no
  // OpenRouter key, so a migrated local roadmap spec still needs it to fire.
  // resolveRoadmapLLM runs BEFORE this and 503s on a missing apiKey, so the
  // test-token 503 cases (no openRouterConnected) never reach here; the migrated
  // happy paths provision openRouterConnected and do. The data branch reading
  // testMockData for local sessions is harmless — workspaceApiLocalSeed is the
  // same fixture byte-for-byte — and orphans no new deletion site beyond LIN-413.
  function isRoadmapTestMode(req) {
    return shouldMockAi(req.workspace);
  }

  // --- Orientation (LIN-300) ------------------------------------------------

  const ORIENTATION_BEARING_SET = new Set(ORIENTATION_BEARINGS);

  /**
   * Canned test-mode bearings. Deliberately exercises the normalizer end-to-end:
   * a clean bearing, a lowercase one (clamped to upper-case), an invalid one
   * (dropped because it is not archived), and an off-compass archived one (kept
   * with an empty bearing). References fixture identifiers from mock-data.js.
   */
  const ORIENTATION_TEST_BEARINGS = [
    { identifier: 'TEST-2', bearing: 'N', reason: 'Directly advances the stated intent.', archived: false },
    { identifier: 'TEST-13', bearing: 'se', reason: 'Partial support with some divergence.', archived: false },
    { identifier: 'TEST-99', bearing: 'NORTHWEST', reason: 'Invalid bearing — should be dropped.', archived: false },
    { identifier: 'TEST-14', bearing: '', reason: 'Off-compass: does not serve the north star.', archived: true }
  ];

  /**
   * Shared failure-notice copy for the orientation event (LIN-324). Used both
   * when the stream/parse throws and when the response parses to nothing usable
   * despite there being candidates to score — the two ways a reading can fail to
   * yield bearings. Either way the ship-view toggle stays off, but the operator
   * is told why instead of facing a silent, mysteriously-disabled control.
   */
  const ORIENTATION_FAILURE_NOTICE =
    'Orientation bearings could not be generated — the model response was incomplete or could not be parsed. The ship-view orientation toggle stays unavailable for this reading.';

  /**
   * Validate and normalize raw bearings to the 8-point vocabulary (LIN-300).
   * The store's normalizeOrientation enforces field *shape* only; the route owns
   * *vocabulary* enforcement so the persisted contract stays clean for LIN-301.
   *
   * - Drops entries with no identifier.
   * - Clamps bearings to upper-case and matches against the 8-point set.
   * - An un-archived task with an invalid/empty bearing is DROPPED (it cannot be
   *   placed on the compass and was not flagged off-compass).
   * - An archived (off-compass) task is KEPT; its bearing is the valid value if
   *   it is one, otherwise '' — it carries no placement weight either way.
   */
  function normalizeBearings(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const identifier = String(item.identifier || '').trim();
      if (!identifier) continue;
      const archived = item.archived === true;
      const bearing = String(item.bearing || '').trim().toUpperCase();
      const valid = ORIENTATION_BEARING_SET.has(bearing);
      if (!valid && !archived) continue;
      out.push({
        identifier,
        bearing: valid ? bearing : '',
        reason: String(item.reason || ''),
        archived
      });
    }
    return out;
  }

  /**
   * Token allowance for one orientation call, scaled to the candidate count
   * (LIN-324). The model must score EVERY candidate exactly once, so the JSON
   * grows linearly with the queue; a fixed ceiling truncates large workspaces
   * mid-array and the parse then fails. ~40-50 tok/entry plus headroom, floored
   * at the old 2000 and clamped to a generous ceiling.
   */
  function orientationMaxTokens(candidateCount) {
    return Math.min(16000, Math.max(2000, 1500 + candidateCount * 60));
  }

  /**
   * Per-layer output-token budget for the roadmap generation pipeline (LIN-999).
   *
   * Every roadmap prose layer streams through `streamChat`, which sends a bare
   * `max_tokens` with NO separate reasoning allocation (see lib/openrouter.js).
   * The roadmap model is a reasoning model in every case: the default
   * `openai/gpt-5.4-mini` AND the LIN-819 per-generation overrides (GPT-5.5 /
   * GPT-5.5 Pro) all spend hidden reasoning tokens against `max_tokens` BEFORE
   * emitting any visible prose. The old per-layer literals (digest 1200, gap
   * 3000, technical 5000, …) budgeted for prose only, so a full reasoning block
   * plus the layer's output overran the cap → `finish_reason: 'length'`, which
   * the client surfaces per-layer as `[output truncated — hit token limit]`
   * (public/roadmap.js). The smallest budgets (digest at 1200, gap at 3000)
   * truncated first — the reported symptom.
   *
   * The fix is reasoning-aware, not a guessed "much higher" number: every prose
   * layer is sized to match the floor the recommendation path already uses on
   * this model family — its `RECOMMENDATION_MAX_TOKENS` (8000, a non-exported
   * const in lib/openrouter.js), justified there as room for "a full reasoning
   * block plus a complete prompt". We keep this as an independent roadmap-local
   * value (not an import) so the two budgets don't silently move together, and
   * deliberately NOT a change to the shared `streamChat` default, which would
   * also move recap/brief/next-run/chat. Orientation keeps its own
   * candidate-count scaling (`orientationMaxTokens`) and is untouched.
   */
  const ROADMAP_LAYER_MAX_TOKENS = 8000;

  /**
   * Generate per-task orientation bearings and emit them as ONE structured
   * `orientation` SSE event over the shared generate connection (LIN-300).
   *
   * Unlike the narrative layers this does not stream prose into a panel — it
   * accumulates the full line-format output, parses it with parseOrientationLines
   * (Strategy B / LIN-324), and validates against the 8-point vocabulary.
   *
   * LIN-324: failures are no longer silent. The token allowance scales to the
   * candidate count (Strategy A) so a real-sized queue no longer truncates, the
   * line format degrades gracefully (a truncated trailing line costs one line,
   * not the whole response), and a `notice` field on the orientation event
   * surfaces the remaining failure-like conditions at generation time (Strategy
   * C / D2):
   *   - a stream/parse failure (the catch) emits `orientation: []` PLUS a notice
   *     so the disabled ship toggle is explained rather than mysterious;
   *   - a parse that yields NOTHING usable despite having candidates (genuine
   *     format drift — e.g. the model emits JSON instead of lines) likewise emits
   *     `orientation: []` PLUS the same notice, rather than a silent empty array;
   *   - a safety-cap tail-drop emits the (non-empty) bearings PLUS a notice
   *     naming how many lowest-priority candidates were omitted.
   * The notice is transient (SSE + a DOM note on the roadmap page) — it is NOT
   * persisted. The saved `orientation` value stays a plain array, keeping the
   * report-history store contract and the ship gate (`hasOrientationData`)
   * untouched. Charges one free-tier unit like every other layer.
   *
   * @param {?string} injectedRaw - Test-only raw streamed text (gated on
   *   testMode by the caller) that drives the real strip→parse→normalize chain
   *   without an LLM call, so a test can exercise the truncation path the
   *   ORIENTATION_TEST_BEARINGS short-circuit skips (Strategy E / LIN-324).
   */
  async function generateOrientation(res, { roadmapModel, northStar, llm, req, testMode, injectedRaw }) {
    const check = await chargeRoadmapLayer(req, llm.isFreeTier);
    if (!check.allowed) {
      sendSSE(res, 'orientation', {
        orientation: [],
        notice: 'Orientation skipped — the free-tier limit was reached. The ship-view orientation toggle stays unavailable for this reading.'
      });
      return;
    }

    // Post-cap candidate list and the pre-cap total share one filter, so the
    // prompt's candidates and the token-scaling count can never diverge.
    const candidates = serializeOrientationCandidates(roadmapModel);
    const dropped = countOrientationCandidates(roadmapModel) - candidates.length;
    const capNotice = dropped > 0
      ? `Orientation scored the top ${candidates.length} candidates; ${dropped} lower-priority task${dropped === 1 ? ' was' : 's were'} omitted to fit a single request.`
      : null;

    let parsed = [];
    try {
      if (injectedRaw != null) {
        parsed = parseOrientationLines(injectedRaw);
      } else if (testMode) {
        parsed = ORIENTATION_TEST_BEARINGS;
      } else {
        const messages = buildRoadmapOrientationMessages(roadmapModel, northStar);
        let text = '';
        // LIN-1000: reserve reasoning headroom on top of the orientation prose budget.
        const { reasoning, maxTokens } = resolveReasoningBudget({ model: llm.model, proseTokens: orientationMaxTokens(candidates.length) });
        await streamChat(
          messages,
          { apiKey: llm.apiKey, model: llm.model, maxTokens, reasoning,
            callMeta: { urlKey: req.workspace?.urlKey || null, feature: 'roadmap-orientation' } },
          (type, data) => { if (type === 'token') text += (data && data.token) || ''; }
        );
        parsed = parseOrientationLines(text);
      }
    } catch (error) {
      console.error('Roadmap orientation error:', error);
      sendSSE(res, 'orientation', { orientation: [], notice: ORIENTATION_FAILURE_NOTICE });
      return;
    }

    const orientation = normalizeBearings(parsed);

    // Parsed to nothing usable while candidates existed ⇒ genuine format drift
    // (e.g. the model ignored the line contract). Surface it, don't swallow it
    // (D2). An empty result with NO candidates is legitimately empty — no notice.
    if (orientation.length === 0 && candidates.length > 0) {
      sendSSE(res, 'orientation', { orientation: [], notice: ORIENTATION_FAILURE_NOTICE });
      return;
    }

    const payload = { orientation };
    if (capNotice) payload.notice = capNotice;
    sendSSE(res, 'orientation', payload);
  }

  /**
   * Server-orchestrated roadmap reading generation (LIN-317).
   *
   * Replaces the five client-driven per-layer calls (each of which sent the
   * whole roadmapModel back and tripped the 250kb body-parser cap on large
   * workspaces). Here the server fetches Linear ONCE, builds the model into a
   * request-local variable, and runs every layer in sequence streaming each
   * over a SINGLE SSE connection. The request body is tiny (north star +
   * optional team), so the 413 cliff is gone. No persistent server state.
   *
   * Layer order: technical → product → (trajectory, north-star) → gap → digest.
   * Each event is tagged with its layer id so the client demultiplexes one
   * connection into the right placeholders. A layer failure emits a
   * `layer-error` event and the pipeline continues where the design doc's
   * failure modes allow (technical/product are hard prerequisites; a failed
   * fork leg skips the gap; the digest still runs from layers 1/2/3a).
   *
   * Free tier: one unit is charged per layer that actually runs, matching the
   * old per-call accounting. The first unit is reserved before streaming starts
   * (clean 429); a mid-stream limit surfaces as a `layer-error` event since the
   * HTTP status is already committed to 200.
   *
   * @route POST /workspace/:urlKey/api/roadmap/generate
   */
  router.post('/workspace/:urlKey/api/roadmap/generate', workspaceFromUrl, async (req, res) => {
    const llm = await resolveRoadmapLLM(req, res);
    if (!llm) return;

    const testMode = isRoadmapTestMode(req);

    // North star comes from the body (tiny string — no 413 risk) and falls back
    // to the saved session value. Team filter mirrors the page route.
    const bodyNs = typeof req.body?.northStar === 'string' ? req.body.northStar : null;
    const sessionNs = req.session.northStarByWorkspace?.[req.workspace.urlKey] || '';
    const northStar = bodyNs != null ? bodyNs : sessionNs;
    const hasNorthStar = !!(northStar && northStar.trim());

    const rawTeam = req.body?.team;
    const teamId = rawTeam && rawTeam !== 'all' ? rawTeam : null;

    // Fetch Linear once and build the model into a local variable. Errors here
    // happen before any SSE headers are flushed, so they stay normal HTTP codes.
    let roadmapModel;
    try {
      const provider = getProviderForWorkspace(req.workspace);
      const scope = getWorkspaceCallScope(req.workspace);
      // LIN-2025: resolve teamId against the workspace's actual team list
      // (graceful drop-to-unscoped), replacing the UUID format gate. Guarded
      // on teamId being present (no extra round trip when unfiltered) AND
      // kept inside the same testMode arm as the projects fetch below, so a
      // test-token session never issues a real provider call ahead of it.
      const resolvedTeamId = teamId
        ? matchTeamId(testMode ? testMockTeams : await provider.fetchTeams(scope), teamId)
        : null;
      const { projects, issues } = testMode
        ? testMockData
        : await provider.fetchProjects(scope, resolvedTeamId);
      roadmapModel = buildRoadmapModel(projects, issues);
    } catch (error) {
      console.error('Roadmap generate fetch error:', error);
      if (error.response?.status === 401) {
        return unauthorized.json(res, 'Unauthorized');
      }
      return jsonError(res, 500, 'Failed to load roadmap data');
    }

    // Reserve the first free-tier unit before streaming so an already-exhausted
    // free user gets a clean 429 rather than a 200 stream that errors instantly.
    const firstCharge = await chargeRoadmapLayer(req, llm.isFreeTier);
    if (!firstCharge.allowed) {
      return jsonError(res, 429, firstCharge.reason, { freeTier: { used: true, remaining: firstCharge.remaining, limit: firstCharge.limit, resetsAt: firstCharge.resetsAt } });
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();

    /**
     * Run one layer over the shared connection. Charges a free-tier unit first
     * (unless pre-charged); on a build error or rate limit emits a layer-error
     * and resolves { ok: false } so the caller decides whether to continue.
     */
    async function runLayer({ layer, layerName, maxTokens, mockText, buildMessages, precharged }) {
      if (!precharged) {
        const check = await chargeRoadmapLayer(req, llm.isFreeTier);
        if (!check.allowed) {
          sendSSE(res, 'layer-error', { layer, message: check.reason || 'Free tier limit reached' });
          return { ok: false, text: '' };
        }
      }
      if (testMode) return emitMockLayer(res, { layer, text: mockText });
      let messages;
      try {
        messages = buildMessages();
      } catch (error) {
        console.error(`Roadmap ${layerName} build error:`, error);
        sendSSE(res, 'layer-error', { layer, message: `Failed to build ${layerName} prompt` });
        return { ok: false, text: '' };
      }
      return streamLayer(res, { messages, apiKey: llm.apiKey, model: llm.model, maxTokens, layer, layerName, urlKey: req.workspace?.urlKey });
    }

    try {
      // Layer 1 — Technical (hard prerequisite; first unit already reserved).
      const tech = await runLayer({
        layer: 'technical', layerName: 'technical narrative', maxTokens: ROADMAP_LAYER_MAX_TOKENS, precharged: true,
        mockText: 'Mock technical narrative covering recent delivery.',
        buildMessages: () => buildRoadmapNarrativeMessages(roadmapModel)
      });
      if (tech.ok) {
        // Layer 2 — Product (hard prerequisite; chains from technical).
        const product = await runLayer({
          layer: 'product', layerName: 'product perspective', maxTokens: ROADMAP_LAYER_MAX_TOKENS,
          mockText: 'Mock product perspective synthesizing themes from layer 1.',
          buildMessages: () => buildRoadmapProductMessages(roadmapModel, tech.text)
        });
        if (product.ok) {
          // Layer 3a — Trajectory (chains from product; failure is non-fatal).
          const trajectory = await runLayer({
            layer: 'trajectory', layerName: 'trajectory reading', maxTokens: ROADMAP_LAYER_MAX_TOKENS,
            mockText: 'Mock trajectory at this pace pointing toward simpler onboarding.',
            buildMessages: () => buildRoadmapTrajectoryMessages(roadmapModel, tech.text, product.text)
          });

          // Layer 3b — North star reading (only with a north star; source-grounded).
          let nsReading = { ok: false, text: '' };
          if (hasNorthStar) {
            nsReading = await runLayer({
              layer: 'north-star-reading', layerName: 'north-star reading', maxTokens: ROADMAP_LAYER_MAX_TOKENS,
              mockText: 'Mock north star reading: aligned to stated intent.',
              buildMessages: () => buildRoadmapNorthStarMessages(roadmapModel, northStar, {
                tech: tech.text, product: product.text
              })
            });
          }

          // Layer 4 — Gap (needs both fork legs to have succeeded).
          let gap = { ok: false, text: '' };
          if (hasNorthStar && trajectory.ok && nsReading.ok) {
            gap = await runLayer({
              layer: 'gap', layerName: 'gap analysis', maxTokens: ROADMAP_LAYER_MAX_TOKENS,
              mockText: 'Mock gap analysis: trajectory and intent largely agree.',
              buildMessages: () => buildRoadmapGapMessages(northStar, trajectory.text, nsReading.text, roadmapModel)
            });
          }

          // Digest — synthesises everything above (generates last, renders first).
          await runLayer({
            layer: 'digest', layerName: 'summary', maxTokens: ROADMAP_LAYER_MAX_TOKENS,
            mockText: 'Mock summary: recent work shipped and the work is on track; at this pace it points toward simpler onboarding. The main risk is delivery, and the open decision is for the human.',
            buildMessages: () => buildRoadmapDigestMessages({
              northStar: hasNorthStar ? northStar : '',
              technical: tech.text,
              product: product.text,
              trajectory: trajectory.text || '',
              nsReading: nsReading.text || '',
              gap: gap.text || '',
              // LIN-1110: the digest's deterministic position input. Serialized
              // to a whitelisted current-state slice inside the template, so
              // this stays one property and no derivation logic lands here.
              roadmapModel
            })
          });
        }
      }

      // Orientation (LIN-300) — per-task compass bearings adjudicated against
      // the north star. A purely additive follow-up call (Strategy B): it does
      // not stream prose into a panel; it emits one `orientation` event the
      // client stashes for persistence and the ship view (LIN-301). It only
      // needs the model and the north star — not the prose layers' output — so
      // it runs whenever a north star is set, independent of layer outcomes.
      if (hasNorthStar) {
        // Test-only seam (LIN-324 / Strategy E): in roadmap test mode a body
        // field can inject the raw streamed text so a test drives the real
        // serialize→parse→normalize→emit chain (which the
        // ORIENTATION_TEST_BEARINGS short-circuit otherwise skips). Ignored
        // entirely outside test mode.
        const injectedRaw = testMode && typeof req.body?.__testOrientationRaw === 'string'
          ? req.body.__testOrientationRaw
          : null;
        await generateOrientation(res, { roadmapModel, northStar, llm, req, testMode, injectedRaw });
      } else {
        // No north star ⇒ orientation cannot be adjudicated (it scores work
        // AGAINST the stated intent). Emit an explicit orientation event with a
        // notice rather than nothing, so the roadmap page can explain why the
        // ship-view toggle stays inert instead of leaving it silently disabled
        // (LIN-324 / D2). The persisted orientation stays [].
        sendSSE(res, 'orientation', {
          orientation: [],
          notice: 'Orientation needs a north star — set one above to generate per-task bearings. The ship-view orientation toggle stays unavailable until then.'
        });
      }
    } catch (error) {
      console.error('Roadmap generate stream error:', error);
    } finally {
      sendSSE(res, 'done', {});
      res.end();
    }
  });

  /**
   * Roadmap Q&A chat via SSE streaming.
   * Client POSTs the question, roadmap model, and conversation history.
   * @route POST /workspace/:urlKey/api/roadmap/chat
   */
  router.post('/workspace/:urlKey/api/roadmap/chat', workspaceFromUrl, async (req, res) => {
    const featureFlags = getFeatureFlags(req.session);
    if (!featureFlags.roadmap) {
      return jsonError(res, 403, 'Roadmap feature is not enabled');
    }

    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;
    const apiKeyToUse = sessionApiKey || getPaidEnvKey() || freeTierKey;
    if (!apiKeyToUse) {
      return jsonError(res, 503, 'AI not configured. Connect OpenRouter or set OPENROUTER_API_KEY.');
    }

    // Atomically check rate limits for free tier users
    if (isFreeTier) {
      const check = await freeTierStore.tryUse(req.workspace.urlKey);
      if (!check.allowed) {
        return jsonError(res, 429, check.reason, { freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt } });
      }
    }

    const { question, roadmapModel, history } = req.body;
    if (!question || typeof question !== 'string' || !question.trim()) {
      return badRequest.json(res, 'question is required and must be a non-empty string');
    }
    if (question.length > 2000) {
      return badRequest.json(res, 'question must be 2000 characters or fewer');
    }
    if (!roadmapModel) {
      return badRequest.json(res, 'question and roadmapModel are required');
    }

    // Sanitize history: only allow user/assistant roles with string content
    const safeHistory = Array.isArray(history)
      ? history.filter(h =>
          (h.role === 'user' || h.role === 'assistant') &&
          typeof h.content === 'string'
        )
      : [];

    // Build messages before starting SSE so errors return proper HTTP status codes
    let messages;
    try {
      const { buildRoadmapChatMessages } = await import('../lib/prompts/roadmap-chat-template.js');
      messages = buildRoadmapChatMessages(roadmapModel, question.trim(), safeHistory);
    } catch (error) {
      console.error('Roadmap chat build error:', error);
      return jsonError(res, 500, 'Failed to build chat prompt');
    }

    const selectedModel = await resolveWorkspaceModel({ urlKey: req.workspace.urlKey, workspacePreferencesStore, forceDefault: isFreeTier });

    // Start SSE
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();

    try {
      // LIN-1000: reserve reasoning headroom on top of the chat prose budget.
      // LIN-999 raised the chat prose cap to ROADMAP_LAYER_MAX_TOKENS; feed that
      // as the prose budget so the reasoning split sits on top of the new cap
      // (the documented composition — the split reframes it as the prose budget).
      const { reasoning, maxTokens } = resolveReasoningBudget({ model: selectedModel, proseTokens: ROADMAP_LAYER_MAX_TOKENS });
      await streamChat(
        messages,
        { apiKey: apiKeyToUse, model: selectedModel, maxTokens, reasoning,
          callMeta: { urlKey: req.workspace?.urlKey || null, feature: 'roadmap-chat' } },
        (type, data) => {
          sendSSE(res, type, data);
          if (type === 'done' || type === 'error') {
            res.end();
          }
        }
      );
    } catch (error) {
      console.error('Roadmap chat error:', error);
      sendSSE(res, 'error', { message: 'Failed to generate response' });
      res.end();
    }
  });


  return router;
}
