/**
 * The brief writer's switch and model (LIN-3293).
 *
 * The writing layer (writeStagePrompt / composeRoutedRecommendation in
 * lib/openrouter.js) runs only when this says so. Resolved in the route, where the
 * workspace and its store are in hand, and passed down as a plain option
 * (`briefWriter: { model }`), so lib/openrouter.js stays free of store I/O.
 *
 * The switch is the experimental workspace feature `briefWriter`
 * (WORKSPACE_FEATURES.BRIEF_WRITER, lib/feature-defaults.js), off by default and
 * toggled in Settings. It is a workspace feature, not a per-user one, because the
 * paths it changes (autopilot, worker lanes, recommend-and-dispatch) run on a proxy
 * token with no user session, so a per-user flag would never reach them.
 *
 * The writer's model: the workspace's per-operation override for `recommend-write`
 * (BRIEF_WRITER_OP_KIND, one of AI_OPERATION_KINDS, so it is chosen in Settings like
 * the others), else HARBOUR_BRIEF_WRITER_MODEL as the instance default, else
 * whatever the router itself runs on (`recommend`). Settings wins, as it does for
 * every other operation. Free tier always clamps to the free-tier model, and is
 * charged once per request whatever the writer does.
 *
 * Every surface that hands out a stage prompt goes through one of the two functions
 * at the bottom: resolveRecommendModels for the routed ones (a routing call picks the
 * stage) and generateStagePrompt for the pinned ones (the stage is chosen up front).
 */
import { resolveFreeTierModel, writeStagePrompt } from './openrouter.js';
import { resolveAiOperationModel, isWorkspaceFeatureEnabled } from './workspace-preferences.js';
import { WORKSPACE_FEATURES } from './feature-defaults.js';

export const BRIEF_WRITER_MODEL_ENV = 'HARBOUR_BRIEF_WRITER_MODEL';
/** The AI operation kind the writer's model override is stored under. */
export const BRIEF_WRITER_OP_KIND = 'recommend-write';

const MODEL_ID = /^[a-z0-9-]+\/[a-z0-9.-]+(?::[a-z0-9-]+)?$/i;

/**
 * Is the writer on for this workspace? Off without a workspace or a store.
 * @param {{urlKey: string|null, workspacePreferencesStore: Object|null}} options
 * @returns {Promise<boolean>}
 */
export async function isBriefWriterEnabled({ urlKey, workspacePreferencesStore }) {
  if (!urlKey || !workspacePreferencesStore) return false;
  return isWorkspaceFeatureEnabled({ urlKey, featureKey: WORKSPACE_FEATURES.BRIEF_WRITER, store: workspacePreferencesStore });
}

/**
 * The writer option for a recommendation call, or null when the writer is off.
 * @param {Object} options
 * @param {string|null} options.urlKey
 * @param {Object|null} options.workspacePreferencesStore
 * @param {boolean} [options.isFreeTier]
 * @param {Object} [options.env] - Read for HARBOUR_BRIEF_WRITER_MODEL (the instance default) only
 * @returns {Promise<{model: string}|null>}
 */
export async function resolveBriefWriter({ urlKey, workspacePreferencesStore, isFreeTier = false, env = process.env }) {
  if (!(await isBriefWriterEnabled({ urlKey, workspacePreferencesStore }))) return null;
  if (isFreeTier) return { model: resolveFreeTierModel() };
  const prefs = await workspacePreferencesStore.getWorkspacePreferences(urlKey);
  const own = prefs?.aiModelOverrides?.byKind?.[BRIEF_WRITER_OP_KIND]?.model;
  if (own) return { model: own };
  const envModel = String(env[BRIEF_WRITER_MODEL_ENV] ?? '').trim();
  if (MODEL_ID.test(envModel)) return { model: envModel };
  return { model: await resolveAiOperationModel({ urlKey, workspacePreferencesStore, opKind: 'recommend' }) };
}

/**
 * The models for a routed recommendation: the router's (`recommend`, clamped on free
 * tier) and the writer option. Shared by every routed surface, so the switch reads the
 * same everywhere.
 * @param {Object} options
 * @param {string|null} options.urlKey
 * @param {Object|null} options.workspacePreferencesStore
 * @param {boolean} [options.isFreeTier]
 * @param {Object} [options.env]
 * @returns {Promise<{model: string, briefWriter: {model: string}|null}>}
 */
export async function resolveRecommendModels({ urlKey, workspacePreferencesStore, isFreeTier = false, env = process.env }) {
  const model = await resolveAiOperationModel({ urlKey, workspacePreferencesStore, opKind: 'recommend', forceDefault: isFreeTier });
  const briefWriter = await resolveBriefWriter({ urlKey, workspacePreferencesStore, isFreeTier, env });
  return { model, briefWriter };
}

/**
 * A pinned stage's prompt: the stage's body with its lead through the writer when
 * `briefWriter` is set, else exactly generatePrompt. Never throws on a writer failure
 * (the unwritten bundle ships). Null for an unknown kind.
 * @param {string} kind - PROMPT_TEMPLATES key
 * @param {Object} issue
 * @param {Object} context
 * @param {Object} [options]
 * @param {Object} [options.featureFlags]
 * @param {Object|null} [options.providerUi]
 * @param {{model: string}|null} [options.briefWriter] - resolveBriefWriter's result
 * @param {string|null} [options.apiKey] - The key the writer bills; none ships the bundle
 * @param {AbortSignal|null} [options.signal] - Client hang-up
 * @param {number|null} [options.deadline]
 * @param {Object|null} [options.callMeta]
 * @returns {Promise<{name: string, prompt: string, written: boolean, writerReason: string|null}|null>}
 */
export async function generateStagePrompt(kind, issue, context, { featureFlags = {}, providerUi = null, briefWriter = null, apiKey = null, signal = null, deadline = null, callMeta = null } = {}) {
  const writer = briefWriter ? { apiKey, model: briefWriter.model, signal, deadline, callMeta } : null;
  return writeStagePrompt(kind, issue, context, featureFlags, providerUi, writer);
}
