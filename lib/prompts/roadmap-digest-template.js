/**
 * Roadmap digest prompt template — the synthesis layer.
 *
 * The five narrative layers each emit a full-length, equal-weight section, in
 * pipeline order, with the most actionable finding (the gap) buried last. The
 * digest is the keystone fix for "not suitable for a high-level view": a short
 * lede that reads ALL the prior layers and tells the story of where the project
 * stands as connected narrative prose, weaving five beats into one throughline —
 *
 *   - what we shipped     — the headline of recent delivery
 *   - where we are now    — the current state of the work
 *   - where this is heading — the (hedged) direction of travel, from trajectory
 *   - the one risk        — unifying delivery risk (blockers, stale/unassigned
 *                           critical-path work — from layer 1) and alignment
 *                           risk (drift — from layers 3b/4)
 *   - the one decision    — the open question the human must adjudicate
 *
 * It generates LAST (it needs the other layers as input) but RENDERS FIRST, at
 * the top of the reading. Earlier this was a rigid four-slot form (SHIPPED /
 * WHERE WE ARE / THE RISK / THE DECISION); LIN-416 loosened it to flowing prose
 * with a heading beat so the top read is a story, not a fill-in-the-blanks form.
 * It still emits NO visible reasoning block — it is told to reason internally,
 * over the layers below, but print only the lede: a reasoning dump at the very
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

  const system = `You are writing the at-a-glance summary that sits at the very top of a multi-section project reading. Several detailed sections have already been written below you — a technical delivery narrative, a product synthesis, a forward-looking trajectory, and (when a north star is set) an alignment reading and a gap analysis. Your job is to read all of them and tell the story of where this project stands, in a short lede a busy reader can absorb in under a minute.

This is the most important text on the page. The reader may read only this. It should read as a connected narrative — the story of our progress — NOT as a form with labelled fields. Lead with what matters; do not bury it.

THINK FIRST, THEN WRITE: Work through the layers below before you write — what actually shipped, where the work stands, where it is heading, the one risk that matters, the one decision a human has to make — and find the single throughline that connects them. Lean on that reasoning to decide what leads and what is cut. But do NOT print the reasoning: no reasoning section, no preamble, no headings, no labelled slots, no closing remarks. Output only the lede itself.

OUTPUT: Plain text only. No markdown — no #, no **bold**, no bullet asterisks, and no field labels like "SHIPPED:" or "THE RISK:". Just a few short connected paragraphs. The output renders in a monospace terminal interface.

THE STORY TO TELL — weave these beats into flowing prose, in roughly this order, including only the ones the layers actually support:
- What we shipped: the headline of recent delivery — the most significant work that actually landed, not a list.
- Where we are now: the current state — what is in progress and the overall shape of the work right now.
- Where this is heading: the direction of travel the work points toward, drawn from the trajectory reading. Keep it hedged ("at this pace", "the work points toward") — describe the heading, do not forecast a date or a number. Where the trajectory genuinely supports it, you have permission to be optimistic about the far outlook.
- The one risk: the single most important risk. Unify the two kinds that live in different sections below — delivery risk (blockers, stale or unassigned critical-path work, bottlenecks — from the technical narrative) and alignment risk (drift away from the north star — from the north-star reading and the gap analysis). Pick the ONE that matters most across both kinds and name which kind it is. If there is genuinely no material risk, say so plainly — do not manufacture one.
- The one decision: the single open question a human must adjudicate — typically the sharpest unresolved tension from the gap analysis. State it as one concrete question and do not answer it. If nothing forces a decision right now, say so in a clause and why.

RULES:
- Use ONLY the layers provided. Do not invent shipped work, risks, decisions, or direction.
- Use the original task and project names from the layers on first mention; after that a short, recognizable short-form is fine so the prose does not read like a list of database keys. Never invent names or alter identifiers like LIN-123.
- This is a synthesis, not a recap — resist listing. Draw the throughline the layers imply rather than restating each one.
- Cite specific work where it sharpens the point — vague claims are not claims — but stay short.
- Interpret, but do not over-claim or manufacture drama. Earn every adjective from the work; drop "exciting", "concerning", "unfortunately" when they are decoration rather than the honest read.
- Keep it to a few short paragraphs, ideally under ~150 words — brevity is the point. One throughline, told well.${hasNorthStar ? '' : '\n- No north star is set, so there is no alignment reading or gap analysis below. Draw the risk from delivery risk only, and report that no alignment decision is forced (or surface a clear delivery decision if the work plainly poses one).'}`;

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

  const user = `Here are the sections written below you. Read them and tell the story of where the project stands.

${sections.join('\n\n')}

Write the at-a-glance lede: a few short connected paragraphs covering what shipped, where we are, where this is heading, the one risk, and the one decision — as flowing prose, no labels. Under ~150 words. Nothing else.`;

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
