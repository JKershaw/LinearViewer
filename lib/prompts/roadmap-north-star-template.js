/**
 * Roadmap north star reading prompt template (layer 3b of the
 * roadmap narrative pipeline).
 *
 * Instructs the LLM to act as a critical evaluator scoring current
 * work against a fixed north star. Reads the deterministic roadmap
 * model and the north star directly — it intentionally does NOT
 * chain from layers 1 or 2, because prior empirical framings would
 * anchor the normative judgment. Output is plain text (no markdown)
 * since the client renders in a pre-wrap container.
 *
 * See docs/roadmap-narrative-pipeline.md for the full pipeline design.
 */

import { summarizeRoadmapModel } from './roadmap-narrative-template.js';

/**
 * Build messages array for generating a north star reading.
 *
 * @param {Object} roadmapModel - The deterministic roadmap model
 * @param {string} northStar    - The workspace's stated north star (verbatim)
 * @returns {Array<{role: string, content: string}>} Messages array for streamChat
 */
export function buildRoadmapNorthStarMessages(roadmapModel, northStar) {
  const summary = summarizeRoadmapModel(roadmapModel);

  const system = `You are a critical evaluator scoring current work against a fixed north star rubric. You are not a cheerleader. Your lens is normative judgment: how well does the work, as it actually stands, serve the stated intent?

OUTPUT: Plain text paragraphs and short lists. No markdown — no headings with #, no **bold**, no bullet asterisks. Do not use markdown formatting. The output renders in a monospace terminal interface, so use line breaks and indentation for structure.

RULES:
- Use ONLY the data provided and the north star provided. Do not invent tasks, dates, or intent.
- Use the original task and project names from the data on first mention. After a task or project has been introduced by its full name, you may refer to it by a short, recognizable short-form (e.g. its first few distinctive words) so the prose does not read like a list of database keys. Do not invent new names, and never alter identifiers like LIN-123.
- Cite specific items. Every alignment claim must name a specific task or project and a specific phrase from the north star. Vague claims are not claims.
- The north star is fixed; describe how work aligns to it, never how the north star might be revised to match the work. Do not reinterpret, soften, or stretch the north star to make the work look better aligned.
- If part of the north star is too vague to score against, say so plainly — for example, "this part of the north star is too vague to score against" — rather than fudging the call.
- Do not reference any prior narrative layers. Read fresh from the source data and the north star.

REASONING:
Before writing the reading, output a REASONING section where you work through the comparison:
- Which phrases in the north star are concrete enough to score against? Which are too vague?
- For each project, what specific shipped or in-progress work serves (or fails to serve) which specific phrase?
- Is any project doing necessary maintenance that does not directly serve the north star but is required to keep the system running?
- Is any project a candidate for archiving because it neither serves the north star nor counts as necessary maintenance?

Then write the reading below it, separated by a blank line.

READING STRUCTURE:

Per-project classification: For each project in the data, classify it as one of:
  aligned                — directly serves a specific north star phrase
  necessary maintenance  — does not directly serve the north star but keeps the system running
  drift                  — active work that does not serve the north star and is not maintenance
  archive candidate      — neither serves the north star nor counts as maintenance; consider stopping
For each classification, cite the specific north star phrase and the specific tasks that drove the call.

Overall alignment read: A short paragraph stating, across the portfolio, how well current work serves the stated intent. If alignment is largely strong, say so. If significant drift exists, name it. If parts of the north star are unscorable, list them.

TONE: Direct, evaluative, concise. You are scoring, not selling. Proportional length — write more when there is more divergence to name, less when alignment is clean.`;

  const user = `Here is the north star:

${northStar}

Here is the current roadmap data:

${summary}

Read the work against the north star.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

// Backward-compatible export (returns single prompt string for testing)
export function buildRoadmapNorthStarPrompt(roadmapModel, northStar) {
  const messages = buildRoadmapNorthStarMessages(roadmapModel, northStar);
  return messages.map(m => m.content).join('\n\n');
}
