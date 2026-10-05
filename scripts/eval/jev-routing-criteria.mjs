/**
 * Direct Jev routing criteria for LIN-3107 — step one of the meta prompt only.
 *
 * The meta prompt does two things: it CHOOSES a task type, then CREATES that task.
 * This module builds the routing question for the FIRST half alone, written for
 * TypeSafe's Jev the way its published guidance asks: a direct, literal `choice`
 * over the live recommender vocabulary, with per-action criteria that are mutually
 * distinguishable — not the incumbent's reused `aiHint.situation` one-liners.
 *
 * Vocabulary source of truth: `getSelectableStages()` names (lib/prompt-templates.js)
 * — the exact set the live meta-prompt injects (17 names, `defer` last). Criteria are
 * derived from each stage's own self-description (LIN-3300: purpose + when + when not),
 * so the routing call can never silently drift from the live action set. Nothing here
 * is wired into production; this is standalone research infra under scripts/eval/.
 */
import { getSelectableStages } from '../../lib/prompt-templates.js';

/** The live recommender vocabulary, verbatim (17 names; `defer` last). */
export const LIVE_VOCABULARY = getSelectableStages().map((s) => s.name);

/** Same vocabulary with `defer` withheld — the leaf-time offer (arms 1/2 prompt-time filter). */
export const LEAF_VOCABULARY = LIVE_VOCABULARY.filter((name) => name !== 'defer');

/**
 * Fixture sidecars historically said `implementation` where the live vocabulary says
 * `implement`. Normalise BOTH the gold and every arm's answer through this single seam
 * (research finding: attribute the implementation→implement grading asymmetry).
 */
export function norm(action) {
  if (action == null) return null;
  const a = String(action).toLowerCase().trim();
  return a === 'implementation' ? 'implement' : a;
}

const stageByName = {};
for (const s of getSelectableStages()) stageByName[s.name] = s;

/** Compose the contrastive criterion string for one live action from its own self-description. */
function criterionFor(name) {
  const s = stageByName[name];
  if (!s) return null;
  return [`Purpose: ${s.purpose}`, `When: ${s.when}`, `When NOT: ${s.whenNot}`].join(' ');
}

/**
 * `defer` (LIN-327) has no PROMPT_TEMPLATES entry, so its criterion is written by hand.
 * It is a recommend-meta action: hand the next step to an existing non-terminal child
 * rather than doing node-level work. The eligibility rule is stated as an EVAL CHOICE
 * (see the harness README), not the live contract: the live meta-prompt injects the full
 * vocabulary into every prompt, leaves included.
 */
export const DEFER_CRITERION =
  'Situation: this is a parent task (it has real child tasks) and the honest next step is ' +
  'to descend into ONE existing non-terminal child rather than do work at this level. ' +
  'Goal: pick `defer` only when a real, non-terminal child exists to hand off to. ' +
  'When NOT: there is no non-terminal child (this is a leaf, or every child is already ' +
  'terminal) — then `defer` is never correct.';

/** Per-action criteria for the prompt-time vocabulary (defer included only when offered). */
export function buildCriteria({ offerDefer }) {
  const names = offerDefer ? LIVE_VOCABULARY : LEAF_VOCABULARY;
  const criteria = {};
  for (const name of names) {
    if (name === 'defer') { criteria[name] = DEFER_CRITERION; continue; }
    const c = criterionFor(name);
    if (c) criteria[name] = c;
  }
  return criteria;
}

export const ROUTING_INSTRUCTIONS =
  'This is a software task in an issue tracker, frozen at one moment in its life. The state ' +
  'below is a distilled, current snapshot — it is the authoritative state; do not assume there ' +
  'is more. Which kind of work session should be dispatched on it NEXT? Pick the one action ' +
  'whose situation matches that state. Answer with the single action name only.';

/** The `choice` question handed to Jev's decisions endpoint. */
export function buildRoutingQuestion({ offerDefer }) {
  return {
    routing: {
      type: 'choice',
      instructions: ROUTING_INSTRUCTIONS,
      criteria: buildCriteria({ offerDefer }),
    },
  };
}

/**
 * The like-for-like incumbent prompt over the SAME distilled state (arm 2). Harness-authored,
 * step one only — it asks for one action name, mirroring the question Jev is asked.
 */
export function buildIncumbentPrompt(state, { offerDefer }) {
  const criteria = buildCriteria({ offerDefer });
  const lines = [
    ROUTING_INSTRUCTIONS,
    '',
    'Allowed actions and their criteria:',
  ];
  for (const [name, desc] of Object.entries(criteria)) lines.push(`- ${name}: ${desc}`);
  lines.push('', 'Distilled current state (JSON):', JSON.stringify(state, null, 2));
  lines.push('', 'Reply with exactly one action name from the list above, nothing else.');
  return lines.join('\n');
}
