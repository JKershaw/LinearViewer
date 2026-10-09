/**
 * The stage selector (LIN-3300; the seam is LIN-3304's). `buildRouterPrompt` is the one
 * routing prompt every recommendation call sends: the ticket as the selector sees it,
 * the facts code computes from the whole trail, the stages as they describe themselves,
 * the rules written once with their reasons, and the reply contract. `routeStage` reads
 * the reply back into a stage decision; code then assembles that stage's prompt
 * (generatePrompt). A `**Reasoning**` header or a headerless reply still parses, and an
 * out-of-list kind such as `retro` is refused (LIN-3309).
 */
import { deriveDispatchKind, formatStageOptions, getSelectableStages } from './prompt-templates.js';
import { rejectExcludedKind } from './action-kind.js';
import { resolvePromptUi, applyPromptCapabilities } from './prompt-formatters.js';

/**
 * Each rule's origin (kept here, not in the prompt). 1: LIN-3309, LIN-2944, LIN-1892.
 * 2: LIN-811, LIN-823 and LIN-1603 (now a run-ledger fact), LIN-431, LIN-555, LIN-474,
 * LIN-2261. 3: LIN-357, LIN-3309. 4: LIN-327, LIN-433. 5: LIN-366, LIN-586.
 * 6: LIN-325, LIN-557, b977581d, LIN-3049. 7: LIN-878. 8: LIN-597, LIN-588, LIN-1603,
 * LIN-3309, LIN-830. The review loop's bound is not a rule here: code stops a plan that
 * keeps being sent back before the model is asked (lib/recommendation-facts.js). A rule
 * says only what relates the stages; when a stage applies is its own description's.
 */
const SELECTOR_RULES = `## How to choose

Take these in order; the first that applies decides. Each stage's own description says when it applies.

1. **A person's word.** The latest person's comment the trail facts name (a ruling recorded via Harbour is one) decides the stage it names, or holds the work, unless the facts show an agent acted after it. Why: a person's decision outranks older material.
2. **Landed work.** Read the trail facts against \`retrospective-audit\`, \`close-out\`, the \`implementation\` fix round (on the same PR) and \`review\`, in that order; a terminal state with no open subtask counts as landed work. Why: the specific stage precedes the general, and facts, not prose, say where landed work stands.
3. **Blocked.** Then \`blocked\`, when it applies. Why: nothing else moves blocked work.
4. **Subtasks.** Then \`defer\` to the frontier child, when it applies. Why: the work lives in the children, and only you can tell a healthy container from one that needs decomposing.
5. **A bug.** Then \`bug\`, when it applies; a cause that stands goes to its fix, \`plan\` if the fix spans surfaces. Why: never build on an unconfirmed cause, and never re-investigate a confirmed one.
6. **Knowledge.** Then \`research\`, \`spike\` or \`scoping\`, when one applies. Why: building on ungathered knowledge or an unsettled goal is expensive to unwind, and a needless research pass is cheap.
7. **Shape.** Then \`design\`, when it applies. Why: a plan should not pick the architecture silently.
8. **Plan.** Then \`plan\`, \`plan-review\` if one is due, and \`implementation\` or \`breakdown\` on the plan's session fit, in that order. The latest plan-review verdict asked for changes or discussion → \`plan\` for the revision, then \`plan-review\` once a revised plan is posted. Why: absent scope resolves down to \`plan\`, never up to \`implementation\`; a verdict is answered before the plan is built on; and a settled plan is never re-planned.`;

/**
 * Extract the chosen stage from a reply: the `→ **<name>**` line.
 * @param {string|null|undefined} reasoning
 * @returns {string|null}
 */
export function parseRecommendedAction(reasoning) {
  if (typeof reasoning !== 'string') return null;
  const match = reasoning.match(/→\s*\*\*(.+?)\*\*/);
  return match ? match[1].trim() : null;
}

/**
 * Extract the defer target from a reply. A `defer` reply emits `**DeferTo:** ABC-123`,
 * read structurally so prose drift can never break the descent. Accepts a Linear
 * identifier or a UUID.
 * @param {string|null|undefined} reasoning
 * @returns {string|null}
 */
export function parseDeferTo(reasoning) {
  if (typeof reasoning !== 'string') return null;
  const match = reasoning.match(/DeferTo:\s*\*{0,2}\s*([A-Za-z][A-Za-z0-9]*-\d+|[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,})/);
  return match ? match[1].trim() : null;
}

/** The selector's reason for its stage, from the `**Why now:**` line (LIN-3300). */
export function parseWhyNow(reasoning) {
  if (typeof reasoning !== 'string') return null;
  const match = reasoning.match(/\*\*Why now:?\*\*:?[ \t]*([^\n]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * The provider-capability pass (LIN-3304, review finding 1): it renames the tracker for
 * a non-Linear provider and strips the " in {tracker}" suffix. write/subtasks are forced
 * true, so it does nothing else.
 */
export function applyRouterCapabilities(prompt, featureFlags, providerUi) {
  const caps = resolvePromptUi(featureFlags, providerUi);
  return applyPromptCapabilities(prompt, { ...caps, write: true, subtasks: true });
}

/**
 * The stage selector's prompt. Pinned byte for byte by tests/fixtures/stage-router-prompts/.
 * @param {{view: string, identifier: string, facts: string, featureFlags?: Object, providerUi?: Object}} params -
 *   from lib/openrouter.js buildSelectorArgs
 * @returns {string}
 */
export function buildRouterPrompt({ view, identifier, facts, featureFlags, providerUi }) {
  const example = `${String(identifier || '').split('-')[0] || 'ABC'}-123`;
  const keys = getSelectableStages().map(s => s.key);
  const prompt = `You choose the next stage of work for one Linear ticket. You do not do the work or write its prompt: code assembles the chosen stage's prompt.

## The ticket

${view}

## Facts computed in code

${facts}

## Stages

${formatStageOptions()}

${SELECTOR_RULES}

## Reply

Reply with exactly these lines:

## Reasoning
→ **<stage>**
**Why now:** <one sentence: the fact that makes this the next step>

\`<stage>\` is one name from: ${keys.join(', ')}. Keep the bold markers. For \`defer\`, add \`**DeferTo:** <child id>\` (e.g. \`**DeferTo:** ${example}\`) right after the stage line.
`;
  return applyRouterCapabilities(prompt, featureFlags, providerUi);
}

/**
 * Parse a routing reply into the stage decision. `**Reasoning**` and headerless
 * replies both parse (LIN-3309), and a deliberately excluded kind is refused here, not
 * in the pure extractor, which other readers use.
 *
 * @param {string} content - the raw routing reply
 * @param {string} [finishReason]
 * @param {number} [completionTokens]
 * @returns {{action: string, kind: string, deferTo: string|null, whyNow: string|null, reasoning: string, truncated: boolean, completionTokens: number|null}}
 */
export function parseRouteDecision(content, finishReason, completionTokens) {
  const truncated = finishReason === 'length';
  const reasoningMatch = content.match(/## Reasoning\n([\s\S]*?)(?=\n## Prompt|$)/);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim()
    : (content || '').replace(/^\s*(?:#+\s*|\*\*)?Reasoning(?:\*\*)?:?[ \t]*\n/i, '').trim() || null;
  const action = parseRecommendedAction(reasoning);
  if (action) rejectExcludedKind(action);

  const deferTo = action === 'defer' ? parseDeferTo(reasoning) : null;
  if (action === 'defer' && (!reasoning || !deferTo)) {
    throw new Error('Invalid defer response: missing ## Reasoning or DeferTo target');
  }
  if (!reasoning || !action) {
    throw new Error('Invalid response: missing ## Reasoning or recommended action');
  }
  return { action, kind: deriveDispatchKind(action), deferTo, whyNow: parseWhyNow(reasoning), reasoning, truncated, completionTokens: completionTokens || null };
}

/**
 * The seam's one clear function: turn a routing reply into the next-stage choice.
 * @param {string} content
 * @param {string} [finishReason]
 * @param {number} [completionTokens]
 * @returns {ReturnType<typeof parseRouteDecision>}
 */
export function routeStage(content, finishReason, completionTokens) {
  return parseRouteDecision(content, finishReason, completionTokens);
}
