/**
 * The brief writer's switch and model (LIN-3293).
 *
 * The writing layer (writeStagePrompt / composeRoutedRecommendation in
 * lib/openrouter.js) runs only when this says so. Resolved in the route, where the
 * workspace and its store are in hand, and passed down as a plain option
 * (`briefWriter: { model }`), so lib/openrouter.js stays free of store I/O.
 *
 * HARBOUR_BRIEF_WRITER, read at call time like HARBOUR_FILE_POINTER_PILOT:
 *   unset, empty, 0/false/off/no   off everywhere (the default and the kill switch)
 *   1/true/on/yes                  on for every workspace
 *   anything else                  a comma-separated list of workspace urlKeys it is on for
 *
 * The writer's model: HARBOUR_BRIEF_WRITER_MODEL when set, else the workspace's
 * per-operation override for `recommend-write` (BRIEF_WRITER_OP_KIND), else whatever
 * the router itself runs on (`recommend`). Free tier always clamps to the free-tier
 * model, and is charged once per request whatever the writer does.
 */
import { resolveFreeTierModel } from './openrouter.js';
import { resolveAiOperationModel } from './workspace-preferences.js';

export const BRIEF_WRITER_ENV = 'HARBOUR_BRIEF_WRITER';
export const BRIEF_WRITER_MODEL_ENV = 'HARBOUR_BRIEF_WRITER_MODEL';
/** The AI operation kind the writer's model override is stored under. */
export const BRIEF_WRITER_OP_KIND = 'recommend-write';

const ON = new Set(['1', 'true', 'on', 'yes']);
const OFF = new Set(['', '0', 'false', 'off', 'no']);
const MODEL_ID = /^[a-z0-9-]+\/[a-z0-9.-]+(?::[a-z0-9-]+)?$/i;

/**
 * Is the writer on for this workspace? Pure; reads the env per call.
 * @param {string|null} urlKey
 * @param {Object} [env]
 * @returns {boolean}
 */
export function isBriefWriterEnabled(urlKey, env = process.env) {
  const raw = String(env[BRIEF_WRITER_ENV] ?? '').trim();
  const value = raw.toLowerCase();
  if (OFF.has(value)) return false;
  if (ON.has(value)) return true;
  return !!urlKey && raw.split(',').map(s => s.trim()).filter(Boolean).includes(urlKey);
}

/**
 * The writer option for a recommendation call, or null when the writer is off.
 * @param {Object} options
 * @param {string|null} options.urlKey
 * @param {Object|null} options.workspacePreferencesStore
 * @param {boolean} [options.isFreeTier]
 * @param {Object} [options.env]
 * @returns {Promise<{model: string}|null>}
 */
export async function resolveBriefWriter({ urlKey, workspacePreferencesStore, isFreeTier = false, env = process.env }) {
  if (!isBriefWriterEnabled(urlKey, env)) return null;
  if (isFreeTier) return { model: resolveFreeTierModel() };
  const envModel = String(env[BRIEF_WRITER_MODEL_ENV] ?? '').trim();
  if (MODEL_ID.test(envModel)) return { model: envModel };
  if (urlKey && workspacePreferencesStore) {
    const prefs = await workspacePreferencesStore.getWorkspacePreferences(urlKey);
    const own = prefs?.aiModelOverrides?.byKind?.[BRIEF_WRITER_OP_KIND]?.model;
    if (own) return { model: own };
  }
  return { model: await resolveAiOperationModel({ urlKey, workspacePreferencesStore, opKind: 'recommend' }) };
}
