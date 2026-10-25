/**
 * The one list of what each harness can run (LIN-3855, Models page).
 *
 * Before this module the list was written out by hand four times: the server and the client
 * each carried the harness suggestions, the Claude Code model presets, the OpenCode curated
 * list and the blank-model sentinel, and a page write could not be checked against any of them.
 * This file is the one copy. The server imports it; `renderPage` embeds `harnessModelsBlock()`
 * on every page that loads /common.js, and public/common.js reads `window.__HARNESS_MODELS__`.
 *
 * `isModelRunnableOn` mirrors Simple Dispatcher's launch guard (`isModelMappableForHarness` in
 * SD's executors.js, read at 955349d). SD refuses at launch anything this refuses here, so a
 * page write that passes this check cannot fail at launch for its model. SD stays the backstop.
 *
 * `SUBAGENT_MODEL_ALIASES` (lib/runner-kit/runner.mjs) is deliberately NOT in this list: it is
 * a different vocabulary (Task-tool aliases), the runner kit ships standalone, and `fable` is
 * unmapped there on purpose (LIN-3857).
 *
 * Pure apart from its one import of the dispatch default harness, so the client block and the
 * page check cannot disagree about what a null harness means.
 */
import { applyDefaultDispatchHarness } from './proxy-preamble.js';
import { AGENT_JOB_IDS, resolveAgentFromTable } from './model-routing.js';

/** The harnesses a dispatch can name in the UI (LIN-1282). */
export const DISPATCH_HARNESS_SUGGESTIONS = Object.freeze(['claude-code', 'opencode']);

/**
 * UI-only default (LIN-1111) for the workspace-wide harness select: it pre-selects this when no
 * harness is configured yet. Blank stays the meaningful "inherit" state on the per-kind and
 * preset rows. The dispatch's own null default is `DEFAULT_DISPATCH_HARNESS` (proxy-preamble.js).
 */
export const DEFAULT_HARNESS = 'claude-code';

/**
 * What each harness runs, in the words the decision panel shows beside its choice (LIN-3962). Says what it runs,
 * and makes no claim about who pays for it.
 */
export const DISPATCH_HARNESS_LABELS = Object.freeze({
  'claude-code': 'Claude Code',
  opencode: 'opencode through OpenRouter'
});

/**
 * Claude Code's model presets (LIN-1282, `fable` added LIN-1763). Claude Code only offers these
 * `--model` aliases, so they stay stable across model generations.
 */
export const DISPATCH_CLAUDE_MODEL_SUGGESTIONS = Object.freeze(['haiku', 'sonnet', 'opus', 'fable']);

/**
 * Recommended OpenRouter ids for OpenCode (LIN-1111). Merged with the live catalog by
 * `buildModelOptions` (lib/openrouter-catalog.js, LIN-2719). Separate from `AVAILABLE_MODELS`,
 * which feeds the Workspace AI Model selector (the model that writes prompts).
 */
export const DISPATCH_MODEL_SUGGESTIONS = Object.freeze([
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.8',
  'openai/gpt-5.4-mini',
  'openai/gpt-5.5',
  'openai/gpt-5.5-pro',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-opus-5',
  'anthropic/claude-fable-5',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-5.6-sol'
]);

/**
 * One line each for the suggested models the decision panel offers (LIN-3962). A suggestion has a reason; a
 * model without one is not suggested, only found by search.
 */
export const DISPATCH_MODEL_REASONS = Object.freeze({
  haiku: 'The smallest Claude model, for quick, narrow steps',
  sonnet: 'A mid-size Claude model, for most steps',
  opus: 'The largest Claude model, for the hardest steps',
  fable: 'The Fable family, as Claude Code offers it',
  'anthropic/claude-sonnet-5': 'Claude Sonnet 5 through OpenRouter',
  'anthropic/claude-opus-5': 'Claude Opus 5 through OpenRouter',
  'anthropic/claude-haiku-4.5': 'Claude Haiku 4.5 through OpenRouter',
  'openai/gpt-5.5': 'An OpenAI model through OpenRouter',
  'openai/gpt-5.4-mini': 'The smaller OpenAI model through OpenRouter'
});

/** The short list of suggested models per harness (LIN-3962). Every id here has a reason above. */
export const DISPATCH_SUGGESTED_MODELS = Object.freeze({
  'claude-code': Object.freeze(DISPATCH_CLAUDE_MODEL_SUGGESTIONS.filter((id) => DISPATCH_MODEL_REASONS[id])),
  opencode: Object.freeze(DISPATCH_MODEL_SUGGESTIONS.filter((id) => DISPATCH_MODEL_REASONS[id]))
});

/**
 * Sentinel `<option>` value for the model select's free-text escape hatch (LIN-2719, HARD RULE 3).
 * Simple Dispatcher accepts strictly more than the curated presets, so `other…` is a correctness
 * requirement.
 */
export const DISPATCH_MODEL_OTHER_VALUE = '__other__';

/** The model families SD's Claude Code guard recognises (`CLAUDE_MAPPABLE_MODEL_FAMILIES`, executors.js). */
const CLAUDE_MAPPABLE_MODEL_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable', 'default'];

/** The curated ids a harness's model select offers before the live catalog is merged in. */
export function curatedModelIds(harness) {
  return harness === 'claude-code' ? DISPATCH_CLAUDE_MODEL_SUGGESTIONS : DISPATCH_MODEL_SUGGESTIONS;
}

/**
 * Whether `harness` can run `model`, by SD's rule. A blank model is runnable (nothing is named).
 * Claude Code takes a recognised Claude family token anywhere in the id, or a bare `claude…` id
 * with no provider prefix. OpenCode takes any provider-prefixed id. Any other harness is
 * runnable, as SD has no rule for it.
 */
export function isModelRunnableOn(harness, model) {
  if (typeof model !== 'string' || !model.trim()) return true;
  const trimmed = model.trim();
  const lower = trimmed.toLowerCase();
  if (harness === 'claude-code') {
    return CLAUDE_MAPPABLE_MODEL_FAMILIES.some((alias) => lower.includes(alias))
      || (!trimmed.includes('/') && lower.startsWith('claude'));
  }
  if (harness === 'opencode') return trimmed.includes('/');
  return true;
}

/**
 * The harness a stored value is RUN on. A null or blank stored harness dispatches as claude-code
 * (applyDefaultDispatchHarness, lib/proxy-preamble.js), so the page check judges that, never the
 * stored null. Checking the stored value would accept an OpenRouter-only model for every follower
 * of a group whose harness is unset, and SD would then refuse each launch.
 */
export function harnessInForce(stored) {
  return applyDefaultDispatchHarness(stored);
}

/**
 * The runnability problems a write introduces, judged over the whole table.
 *
 * For the agent default and every agent-session job, the (harness in force, model) pair is
 * compared before and after. Only a pair that CHANGED and is now not runnable is reported, so a
 * write never fails on an incompatibility it did not create, and a change that repairs one passes.
 * Harbour-call jobs have no harness and are not judged here: their model is checked by
 * MODEL_ID_PATTERN at the route.
 *
 * Returns `[{ job, harness, model }]`, `job` null for the agent default row. Empty when none.
 */
export function runnabilityProblems(before, after) {
  const problems = [];
  const judge = (job, kind) => {
    const was = resolveAgentFromTable(before, kind);
    const now = resolveAgentFromTable(after, kind);
    const wasPair = `${harnessInForce(was.harness)}\u0000${was.model ?? ''}`;
    const nowPair = `${harnessInForce(now.harness)}\u0000${now.model ?? ''}`;
    if (wasPair === nowPair) return;
    if (isModelRunnableOn(harnessInForce(now.harness), now.model)) return;
    problems.push({ job, harness: harnessInForce(now.harness), model: now.model });
  };
  judge(null, null);
  for (const id of AGENT_JOB_IDS) judge(id, id);
  return problems;
}

/**
 * The block the client reads (`window.__HARNESS_MODELS__`). Plain data: the lists, the sentinel
 * and the default, never a function. `renderPage` embeds it once on every page that loads
 * /common.js.
 */
export function harnessModelsBlock() {
  return {
    harnesses: [...DISPATCH_HARNESS_SUGGESTIONS],
    defaultHarness: DEFAULT_HARNESS,
    otherValue: DISPATCH_MODEL_OTHER_VALUE,
    curated: {
      'claude-code': [...DISPATCH_CLAUDE_MODEL_SUGGESTIONS],
      opencode: [...DISPATCH_MODEL_SUGGESTIONS]
    }
  };
}

export { effortAppliesTo } from './model-routing.js';
