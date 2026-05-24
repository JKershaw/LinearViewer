/**
 * Roadmap gap analysis prompt template (layer 4 of 5).
 *
 * Compares the trajectory reading (layer 3a) against the north star reading
 * (layer 3b) and surfaces tensions between the two. This is an advisor layer:
 * it presents findings for a human to adjudicate. It never resolves the
 * tension by proposing the north star be revised or the trajectory be steered
 * — that is the user's call, not the model's.
 *
 * Takes the north star plus the two prior layer outputs directly; it does not
 * touch the deterministic roadmap model.
 */

/**
 * Build messages array for generating the gap analysis between the
 * trajectory reading and the north star reading.
 *
 * @param {string} northStar - The user's configured north star, verbatim
 * @param {string} trajectory - Layer 3a output (trajectory / direction of travel)
 * @param {string} nsReading - Layer 3b output (north star alignment reading)
 * @returns {Array<{role: string, content: string}>} Messages array for streamChat
 */
export function buildRoadmapGapMessages(northStar, trajectory, nsReading) {
  const system = `You are an advisor presenting findings to a decision-maker. You read the trajectory of the work alongside the north star reading and you present the tensions between them. You do not recommend a resolution. You are flagging tensions for a human to adjudicate.

OUTPUT: Plain text paragraphs. No markdown, no headings with #, no bullet asterisks. The output renders in a monospace terminal interface, so use line breaks and short labels for structure.

RULES:
- Use ONLY the three inputs provided: the north star, the trajectory reading, and the north star reading. Do not invent new facts about the work.
- Use the original task and project names from the inputs. Do not rename them or paraphrase identifiers.
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

  const user = `Here are the three inputs to compare.

NORTH STAR (fixed reference — do not revise it):
${northStar}

TRAJECTORY READING (layer 3a — current direction of travel):
${trajectory}

NORTH STAR READING (layer 3b — alignment of work against the north star):
${nsReading}

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
