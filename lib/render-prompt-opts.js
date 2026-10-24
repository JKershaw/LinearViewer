/**
 * Prompt vocabulary shared by Home (`__HOME_PROMPT_OPTS__`) and Swipe
 * (`__SWIPE_DATA__`) — LIN-2944 P1: both pages feed `PromptSection.init` the same
 * flags and prompt catalog, so the computation lives here once.
 *
 * Only the COMPUTATION is shared. Each page builds its own object literal in its
 * own key order from the fields returned here, because the embedded JSON is
 * compared byte-for-byte (key order included).
 */

import { getPromptLabels, getPromptDisplayName } from './prompt-templates.js';

// Prompts shown by default for every actionable issue; the rest sit behind "more".
const DEFAULT_PROMPT_KEYS = ['look-into', 'research', 'plan', 'implementation'];

/**
 * @param {Object} [opts]
 * @param {string|null} [opts.openRouterSource] - 'free' | 'byok' | ... | null (unconfigured)
 * @param {Object} [opts.featureFlags]
 * @param {Array<{id: string, name: string}>} [opts.customPrompts]
 * @param {boolean} [opts.isLocalhost]
 * @returns {{hasAI: boolean, aiState: 'unconfigured'|'ready', freeTier: boolean,
 *   dispatchEnabled: boolean, runSetup: boolean,
 *   isLocalhost: boolean, promptMeta: Object,
 *   defaultPromptKeys: string[], morePromptKeys: string[],
 *   customPrompts: Array<{id: string, name: string}>}}
 */
export function buildPromptOpts({ openRouterSource = null, featureFlags = {}, customPrompts = [], isLocalhost = false } = {}) {
  // F9 (LIN-2944): the ✦ action is always shown, disabled with a reason when
  // OpenRouter is unconfigured. LIN-3848 removed the `aiRecommendations` and
  // `promptButtons` switches: AI is always available and prompts always show.
  const morePromptKeys = getPromptLabels().filter((key) => !DEFAULT_PROMPT_KEYS.includes(key));
  const promptMeta = {};
  for (const key of [...DEFAULT_PROMPT_KEYS, ...morePromptKeys]) {
    promptMeta[key] = getPromptDisplayName(key);
  }
  return {
    hasAI: !!openRouterSource,
    aiState: !openRouterSource ? 'unconfigured' : 'ready',
    // LIN-3239: the component reads the caller's own run allowance at load.
    freeTier: openRouterSource === 'free',
    // LIN-3849: `dispatchEnabled` keeps its name as the opts key but is now the
    // derived `runControls` (owner AND a live runner key / queue token).
    // `runSetup` is the owner-only "set up ›" rung for an owner with no way to
    // run yet. The proxy switch (`hasAutopilot` / `proxyEnabled`) is gone: key
    // tools are always on.
    dispatchEnabled: featureFlags.runControls === true,
    runSetup: featureFlags.runSetup === true,
    isLocalhost,
    promptMeta,
    defaultPromptKeys: [...DEFAULT_PROMPT_KEYS],
    morePromptKeys,
    customPrompts: customPrompts.map((p) => ({ id: p.id, name: p.name }))
  };
}
