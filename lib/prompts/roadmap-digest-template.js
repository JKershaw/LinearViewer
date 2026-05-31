/**
 * Roadmap digest prompt template — the synthesis layer.
 *
 * The five narrative layers each emit a full-length, equal-weight section, in
 * pipeline order, with the most actionable finding (the gap) buried last. The
 * digest is the keystone fix for "not suitable for a high-level view": a short
 * lede that reads ALL the prior layers and distils the four things a high-level
 * reader needs —
 *
 *   1. SHIPPED        — what was actually delivered
 *   2. WHERE WE ARE   — the current state of the work
 *   3. THE RISK       — the one real risk, unifying delivery risk (blockers,
 *                       stale/unassigned critical-path work — from layer 1) and
 *                       alignment risk (drift — from layers 3b/4)
 *   4. THE DECISION   — the one open question the human must adjudicate
 *
 * It generates LAST (it needs the other layers as input) but RENDERS FIRST, at
 * the top of the reading. Unlike the other layers it emits NO reasoning block:
 * the reasoning already happened in layers 1-4, and a reasoning dump at the very
 * top of the page would defeat the "legible at a glance" purpose.
 *
 * Degrades cleanly: with no north star there is no north-star reading or gap, so
 * the risk slot draws on delivery risk only and the decision slot reports that
 * no alignment decision is forced. See docs/roadmap-narrative-pipeline.md.
 */

/**
 * Build messages array for the digest / at-a-glance summary.
 *
 * @param {Object} inputs
 * @param {string} [inputs.northStar]  - The workspace north star (verbatim; '' when none)
 * @param {string} inputs.technical    - Layer 1 output
 * @param {string} inputs.product      - Layer 2 output
 * @param {string} [inputs.trajectory] - Layer 3a output ('' if it failed)
 * @param {string} [inputs.nsReading]  - Layer 3b output ('' when no north star)
 * @param {string} [inputs.gap]        - Layer 4 output ('' when no north star)
 * @returns {Array<{role: string, content: string}>} Messages array for streamChat
 */
export function buildRoadmapDigestMessages(inputs = {}) {
  const {
    northStar = '',
    technical = '',
    product = '',
    trajectory = '',
    nsReading = '',
    gap = ''
  } = inputs;

  const hasNorthStar = !!(northStar && northStar.trim());

  const system = `You are writing the at-a-glance summary that sits at the very top of a multi-section project reading. Several detailed sections have already been written below you — a technical delivery narrative, a product synthesis, a forward-looking trajectory, and (when a north star is set) an alignment reading and a gap analysis. Your job is to distil all of them into a short lede a busy reader can absorb in fifteen seconds.

This is the most important text on the page. The reader may read only this. Lead with what matters; do not bury it.

OUTPUT: Plain text only. No markdown — no #, no **bold**, no bullet asterisks. The output renders in a monospace terminal interface. Emit EXACTLY the four labelled slots below, each starting on its own line with the label, in this order. No preamble, no reasoning section, no closing remarks, nothing else.

SHIPPED: One or two sentences on what was actually delivered recently — the headline of the delivery narrative, not a list. Name the most significant shipped work.

WHERE WE ARE: One or two sentences on the current state — what is in progress and the overall shape of the work right now.

THE RISK: The single most important risk, in one or two sentences. This must unify two kinds of risk that live in different sections below: delivery risk (blockers, stale or unassigned critical-path work, bottlenecks — from the technical narrative) AND alignment risk (drift away from the north star — from the north-star reading and the gap analysis). Pick the ONE that matters most across both kinds and name which kind it is. If a second kind is also serious, give it half a sentence. If there is genuinely no material risk, say so plainly — do not manufacture one.

THE DECISION: The single open decision the reader must make — typically the sharpest unresolved question from the gap analysis (the tension a human has to adjudicate). State it as one concrete question. Do not answer it. If nothing forces a decision right now, write "No decision is forced right now" and one short clause on why.

RULES:
- Use ONLY the layers provided. Do not invent shipped work, risks, or decisions.
- Use the original task and project names from the layers; you may shorten them to a short, recognizable form after first mention. Never invent names or alter identifiers like LIN-123.
- Pick the single most important item per slot. This is a digest, not a recap — resist listing.
- Cite specific work where it sharpens the point, but stay short.
- Do not editorialize. No "strong", "exciting", "concerning", "unfortunately". State it; let the reader judge.
- Keep the whole thing under ~150 words. Four tight slots. Brevity is the point.${hasNorthStar ? '' : '\n- No north star is set, so there is no alignment reading or gap analysis below. Draw THE RISK from delivery risk only, and for THE DECISION report that no alignment decision is forced (or surface a clear delivery decision if the work plainly poses one).'}`;

  const sections = [];
  sections.push(`TECHNICAL NARRATIVE (layer 1):\n${technical}`);
  sections.push(`PRODUCT PERSPECTIVE (layer 2):\n${product}`);
  if (trajectory && trajectory.trim()) {
    sections.push(`TRAJECTORY (layer 3a):\n${trajectory}`);
  }
  if (hasNorthStar) {
    sections.push(`NORTH STAR (fixed reference):\n${northStar}`);
  }
  if (nsReading && nsReading.trim()) {
    sections.push(`NORTH STAR READING (layer 3b):\n${nsReading}`);
  }
  if (gap && gap.trim()) {
    sections.push(`GAP ANALYSIS (layer 4):\n${gap}`);
  }

  const user = `Here are the sections written below you. Distil them into the four-slot summary.

${sections.join('\n\n')}

Write the at-a-glance summary: SHIPPED, WHERE WE ARE, THE RISK, THE DECISION. Under ~150 words. Nothing else.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

// Backward-compatible export (returns single prompt string for testing)
export function buildRoadmapDigestPrompt(inputs) {
  const messages = buildRoadmapDigestMessages(inputs);
  return messages.map(m => m.content).join('\n\n');
}
