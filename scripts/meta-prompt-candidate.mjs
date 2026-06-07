/**
 * Candidate meta-prompt under evaluation — Arm B in the A/B routing harness
 * (scripts/eval-research-routing.mjs).
 *
 * It starts as a straight re-export of the LIVE template, so Arm A and Arm B are
 * identical and the harness measures only its own noise floor (provider
 * nondeterminism at temperature 0). That calibration proves the rig is unbiased
 * before we change a word.
 *
 * Workflow for a proven change:
 *   1. Copy the live buildMetaPromptTemplate body in here and iterate the Step 1
 *      research-routing wording (the "strong research-first" rebalance).
 *   2. Run the harness in A/B mode (AB=1) until Arm B lifts research recall on the
 *      LIN-325-shaped gold case WITHOUT raising over-fire on the guard cases.
 *   3. Port the proven wording into BOTH paths — lib/prompts/meta-prompt-template.js
 *      and the lib/prompt-template-defs.js research aiHint (per CLAUDE.md) — and ship.
 *
 * Keeping the candidate OUT of lib/ until it is proven means main never carries an
 * unvalidated prompt change.
 */
export { buildMetaPromptTemplate as buildMetaPromptCandidate } from '../lib/prompts/meta-prompt-template.js';
