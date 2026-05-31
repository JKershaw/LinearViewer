/**
 * Roadmap gap analysis prompt template (layer 4 of 5).
 *
 * Compares the trajectory reading (layer 3a) against the north star reading
 * (layer 3b) and surfaces tensions between the two. This is an advisor layer:
 * it presents findings for a human to adjudicate. It never resolves the
 * tension by proposing the north star be revised or the trajectory be steered
 * — that is the user's call, not the model's.
 *
 * Takes the north star plus the two prior layer outputs, and — when provided —
 * the deterministic roadmap model. The model is the re-grounding anchor: it lets
 * this layer check the prose readings against the actual work and cite specific
 * items, rather than reasoning prose-on-prose where any item an earlier layer
 * dropped is unrecoverable.
 */

import { summarizeRoadmapModel } from './roadmap-narrative-template.js';

/**
 * Build messages array for generating the gap analysis between the
 * trajectory reading and the north star reading.
 *
 * @param {string} northStar - The user's configured north star, verbatim
 * @param {string} trajectory - Layer 3a output (trajectory / direction of travel)
 * @param {string} nsReading - Layer 3b output (north star alignment reading)
 * @param {Object} [roadmapModel] - Deterministic roadmap model, for re-grounding
 * @returns {Array<{role: string, content: string}>} Messages array for streamChat
 */
export function buildRoadmapGapMessages(northStar, trajectory, nsReading, roadmapModel = null) {
  const system = `You are an advisor presenting findings to a decision-maker. You read the trajectory of the work alongside the north star reading and you present the tensions between them. You do not recommend a resolution. You are flagging tensions for a human to adjudicate.

OUTPUT: Plain text paragraphs. No markdown, no headings with #, no bullet asterisks. The output renders in a monospace terminal interface, so use line breaks and short labels for structure.

RULES:
- Work from the inputs provided: the north star, the trajectory reading, the north star reading, and (when present) the underlying roadmap data. Do not invent new facts about the work. When the data is present, prefer it as the source of truth — if a reading and the data disagree on a specific item, the data wins and you may note the discrepancy.
- Use the original task and project names from the inputs on first mention. After a task or project has been introduced by its full name, you may refer to it by a short, recognizable short-form (e.g. its first few distinctive words) so the prose does not read like a list of database keys. Do not invent new names, and never alter identifiers like LIN-123.
- Cite specific phrases from the north star and specific work items from the trajectory and north star reading. Vague claims are not claims.
- Do not propose updating the north star to match the trajectory. Do not propose changing the trajectory to match the north star. Surface tensions, never resolve them. The human reading this decides what to do.

FALSE-ALIGNMENT GUARD:
If the trajectory and the north star reading largely agree, say so plainly. Do not manufacture conflict to look insightful. An honest "these are aligned, and here is why" is the correct output when the inputs agree.

FALSE-DIVERGENCE GUARD:
If they disagree, name the specific phrases from the north star and the specific work from the trajectory that are in tension. No vague "some misalignment exists" — that is not a finding. Quote or paraphrase the exact words that diverge.

REASONING:
Before writing the gap analysis, output a REASONING section where you work through the inputs:
- Which parts of the north star does the trajectory clearly serve?
- Which parts of the north star does the trajectory clearly neglect or contradict?
- Where do the trajectory reading and the north star reading themselves diverge on the same project?
- Are any tensions actually artefacts of vague north star language rather than real conflict?

Then write the gap analysis below it, separated by a blank line.

GAP STRUCTURE — three short sections, in this order:

Where they agree: Name the specific projects and the specific north star phrases the trajectory clearly serves. Skip if nothing aligns.

Where they diverge: Name the specific projects, work items, and north star phrases that pull in different directions. Quote the inputs. Skip if nothing diverges.

Questions this raises: One to three concrete questions the decision-maker should answer. Do not answer them yourself.

LENGTH: Keep the gap analysis concise — around 200 to 300 words total. The gap is the punchline; a long gap analysis dilutes it. Be short.

TONE: Direct, factual, neutral. No "concerning," "exciting," "unfortunately," "strong." Present the tension, let the reader judge.`;

  const dataBlock = roadmapModel
    ? `

UNDERLYING ROADMAP DATA (re-ground here — this is the source of truth the readings above interpret):
${summarizeRoadmapModel(roadmapModel)}`
    : '';

  const user = `Here are the inputs to compare.

NORTH STAR (fixed reference — do not revise it):
${northStar}

TRAJECTORY READING (layer 3a — current direction of travel):
${trajectory}

NORTH STAR READING (layer 3b — alignment of work against the north star):
${nsReading}${dataBlock}

Write the gap analysis. Flag tensions; do not resolve them.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

// Backward-compatible export (returns single prompt string for testing)
export function buildRoadmapGapPrompt(northStar, trajectory, nsReading) {
  const messages = buildRoadmapGapMessages(northStar, trajectory, nsReading);
  return messages.map(m => m.content).join('\n\n');
}
