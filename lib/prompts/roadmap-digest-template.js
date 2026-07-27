/**
 * Roadmap digest prompt template — the synthesis layer.
 *
 * The five narrative layers each emit a full-length, equal-weight section, in
 * pipeline order, with the most actionable finding (the gap) buried last. The
 * digest is the keystone fix for "not suitable for a high-level view": a short
 * lede that reads ALL the prior layers and tells the story of where the project
 * stands as connected narrative prose, weaving six beats into one throughline —
 *
 *   - what we shipped     — the headline of recent delivery
 *   - where we are along the roadmap — position against the plan, stated from
 *                           the deterministic model when one is supplied
 *   - where this is heading — the (hedged) direction of travel, from trajectory
 *   - what's pulling us sideways — alignment force: drift away from the north
 *                           star, competing pulls (from layers 3b/4)
 *   - what's slowing us down — delivery friction: blockers, stale or unassigned
 *                           critical-path work, bottlenecks (from layer 1)
 *   - the one decision    — the open question the human must adjudicate
 *
 * LIN-1110 made two changes here. It SPLIT the former single "the one risk"
 * beat — which compressed alignment risk and delivery risk into one sentence —
 * into the two force beats above, because a reader asking "what is pulling us
 * sideways and what is slowing us down" is asking two different questions. And
 * it added the position beat, fed by a new optional deterministic input,
 * `roadmapModel`. That input is serialized by summarizeRoadmapPosition() below,
 * which emits a WHITELIST of current-state fields only: the milestones it reads
 * carry projectedStart / projectedEnd / weeksRemaining / confidenceLow /
 * confidenceHigh, and standing house policy keeps every forecast out of this
 * layer. The length target moved with the beat count (~150 → ~250 words, hard
 * ceiling ~320); the governing intent — "absorbed in under a minute" — did not.
 *
 * It generates LAST (it needs the other layers as input) but RENDERS FIRST, at
 * the top of the reading. Earlier this was a rigid four-slot form (SHIPPED /
 * WHERE WE ARE / THE RISK / THE DECISION); LIN-416 loosened it to flowing prose
 * with a heading beat so the top read is a story, not a fill-in-the-blanks form.
 * It still emits NO visible reasoning block — it is told to reason internally,
 * over the layers below, but print only the lede: a reasoning dump at the very
 * top of the page would defeat the "legible at a glance" purpose.
 *
 * Degrades cleanly on both optional inputs, and the two degradations are
 * INDEPENDENT — neither nests inside the other:
 *   - No north star → no north-star reading and no gap analysis, so the
 *     "pulling us sideways" beat has no sources and is SUPPRESSED outright
 *     (a five-beat, delivery-only digest). It is deliberately NOT redrawn from
 *     delivery signals: sideways pull is a claim about intent, and inferring it
 *     from parallel activity is exactly the manufactured risk the escape
 *     clauses exist to prevent. The decision beat reports that no alignment
 *     decision is forced.
 *   - No position data → the position beat SOFTENS to prose-sourced (the layers
 *     below can still support a qualitative read) with no figures invented, and
 *     no empty labelled section is emitted.
 * See docs/roadmap-narrative-pipeline.md.
 */

/** Projects listed in the position block before it collapses to a tail line. */
const MAX_POSITION_PROJECTS = 5;

/**
 * Serialize the deterministic roadmap model into a compact POSITION block.
 *
 * The field list is a WHITELIST — never a blacklist, never a spread. Entries in
 * `model.milestones` come from projectTimeline() (lib/roadmap.js) and carry
 * `projectedStart`, `projectedEnd`, `weeksRemaining`, `confidenceLow` and
 * `confidenceHigh`. House policy forbids all five in this layer, and a blacklist
 * would leak the next projection field anyone adds. Velocity is excluded for the
 * same reason one step removed: a rate invites forecasting by arithmetic.
 *
 * This helper lives in this module rather than roadmap-narrative-template.js,
 * mirroring how summarizeRoadmapModel lives in the layer that consumes it (the
 * precedent is recorded at roadmap-orientation-template.js:87). It deliberately
 * COPIES three of that function's sub-shapes rather than importing them — the
 * in-progress predicate (roadmap-narrative-template.js:121-123), the
 * Map-or-object criticalPaths handling and the `length > 1` meaningfulness
 * filter (:146-155) — because the digest needs a different projection of the
 * same data. The copies must stay faithful: a second, subtly different
 * definition of "in progress" across two layers of one reading is a real
 * divergence risk.
 *
 * Total defensiveness is a requirement, not a nicety: this runs inside the
 * digest's buildMessages(), where a throw surfaces as a layer-error on the most
 * important text on the page. Every field is read with a default, and anything
 * with nothing to say returns ''.
 *
 * @param {Object} [model] - Deterministic roadmap model (buildRoadmapModel output)
 * @returns {string} Compact current-state position block, or '' when empty
 */
export function summarizeRoadmapPosition(model) {
  const m = model || {};
  const milestones = Array.isArray(m.milestones) ? m.milestones : [];

  const projects = milestones.map(entry => {
    const p = entry || {};
    const totalTasks = p.totalTasks ?? 0;
    const remainingTasks = p.remainingTasks ?? 0;
    const queue = Array.isArray(p.tasksInQueue) ? p.tasksInQueue : [];
    return {
      name: p.name || 'Untitled',
      progressPercent: p.progressPercent ?? 0,
      totalTasks,
      remainingTasks,
      completedTasks: p.completedTasks ?? Math.max(0, totalTasks - remainingTasks),
      inProgress: queue.filter(t =>
        t && (t.stateType === 'started' ||
          (Array.isArray(t.subtasks) && t.subtasks.some(s => s && s.stateType === 'started')))
      ).length
    };
  });

  // A total order, so the block is stable across runs and testable. Ranked by
  // ACTIVITY first, not size — a big dormant project should not lead the block.
  projects.sort((a, b) =>
    b.inProgress - a.inProgress ||
    b.remainingTasks - a.remainingTasks ||
    b.progressPercent - a.progressPercent ||
    a.name.localeCompare(b.name)
  );

  const lines = [];

  if (projects.length > 0) {
    lines.push('PROJECTS (ranked by current activity — the first is the one to lead with)');
    for (const p of projects.slice(0, MAX_POSITION_PROJECTS)) {
      lines.push(`  ${p.name}: ${p.progressPercent}% complete (${p.completedTasks}/${p.totalTasks} tasks done, ${p.remainingTasks} remaining, ${p.inProgress} in progress)`);
    }
    const overflow = projects.length - MAX_POSITION_PROJECTS;
    if (overflow > 0) {
      lines.push(`  +${overflow} more project${overflow === 1 ? '' : 's'} not listed`);
    }
  }

  const paths = m.criticalPaths || {};
  const pathEntries = paths instanceof Map ? [...paths.entries()] : Object.entries(paths);
  const meaningfulPaths = pathEntries.filter(([, v]) => v && v.length > 1);
  if (meaningfulPaths.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('CRITICAL PATHS (longest dependency chains)');
    for (const [project, cp] of meaningfulPaths) {
      lines.push(`  ${project}: ${cp.length} tasks deep, ${cp.blockers?.length || 0} blockers`);
    }
  }

  return lines.join('\n');
}

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
 * @param {Object} [inputs.roadmapModel] - Deterministic roadmap model (LIN-1110);
 *   position block omitted and the position beat softened when absent or empty
 * @returns {Array<{role: string, content: string}>} Messages array for streamChat
 */
export function buildRoadmapDigestMessages(inputs = {}) {
  const {
    northStar = '',
    technical = '',
    product = '',
    trajectory = '',
    nsReading = '',
    gap = '',
    roadmapModel = null
  } = inputs;

  const hasNorthStar = !!(northStar && northStar.trim());

  // Serialize once and reuse — the predicate and the section share one result.
  const position = summarizeRoadmapPosition(roadmapModel);
  const hasPosition = !!position;

  const positionBeat = hasPosition
    ? 'State it from the deterministic ROADMAP POSITION figures given below, citing at least one concrete number (a progress percent, or tasks done out of total). Lead with the first project named there and give the rest at most a clause — do not enumerate a percentage for every project. NEVER turn these figures into a date, an ETA, a number of weeks remaining, or any other projected number.'
    : 'No deterministic figures were supplied, so read position from the layers below and describe it qualitatively — how far along the work is against the plan, what is under way and what is still outstanding. Do not state figures you were not given.';

  const system = `You are writing the at-a-glance summary that sits at the very top of a multi-section project reading. Several detailed sections have already been written below you — a technical delivery narrative, a product synthesis, a forward-looking trajectory, and (when a north star is set) an alignment reading and a gap analysis. Your job is to read all of them and tell the story of where this project stands, in a short lede a busy reader can absorb in under a minute.

This is the most important text on the page. The reader may read only this. It should read as a connected narrative — the story of our progress — NOT as a form with labelled fields. Lead with what matters; do not bury it.

THINK FIRST, THEN WRITE: Work through the layers below before you write — what actually shipped, where the work stands along the roadmap, where it is heading, what is pulling it sideways, what is slowing it down, the one decision a human has to make — and find the single throughline that connects them. Lean on that reasoning to decide what leads and what is cut. But do NOT print the reasoning: no reasoning section, no preamble, no headings, no labelled slots, no closing remarks. Output only the lede itself.

OUTPUT: Plain text only. No markdown — no #, no **bold**, no bullet asterisks, and no field labels like "SHIPPED:" or "THE RISK:". Just a few short connected paragraphs. The output renders in a monospace terminal interface.

THE STORY TO TELL — weave these beats into flowing prose, in roughly this order, including only the ones the layers actually support:
- What we shipped: the headline of recent delivery — the most significant work that actually landed, not a list.
- Where we are along the roadmap: our position against the plan — how far through the work we are, what is in flight, and the overall shape of it right now. ${positionBeat}
- Where this is heading: the direction of travel the work points toward, drawn from the trajectory reading. Keep it hedged ("at this pace", "the work points toward") — describe the heading, do not forecast a date or a number. Where the trajectory genuinely supports it, you have permission to be optimistic about the far outlook.
- What's pulling us sideways: the alignment force — drift away from the north star, competing pulls, scope moving away from stated intent. Draw this ONLY from the north-star reading and the gap analysis. If those layers show no material drift, say so plainly — do not manufacture one.
- What's slowing us down: the delivery friction — blockers, stale or unassigned critical-path work, bottlenecks. Draw this from the technical narrative. If there is genuinely no material friction, say so plainly — do not manufacture one.
- The one decision: the single open question a human must adjudicate — typically the sharpest unresolved tension from the gap analysis. State it as one concrete question and do not answer it. If nothing forces a decision right now, say so in a clause and why.

RULES:
- Use ONLY the layers provided. Do not invent shipped work, risks, decisions, or direction.
- Use the original task and project names from the layers on first mention; after that a short, recognizable short-form is fine so the prose does not read like a list of database keys. Never invent names or alter identifiers like LIN-123.
- This is a synthesis, not a recap — resist listing. Draw the throughline the layers imply rather than restating each one.
- Cite specific work where it sharpens the point — vague claims are not claims — but stay short.
- Interpret, but do not over-claim or manufacture drama. Earn every adjective from the work; drop "exciting", "concerning", "unfortunately" when they are decoration rather than the honest read.
- Keep it to a few short connected paragraphs, targeting ~250 words and never running past ~320 — the budget a busy reader can absorb in under a minute. One throughline, told well.${hasNorthStar ? '' : `\n- No north star is set, so there is no alignment reading or gap analysis below. SKIP the "what's pulling us sideways" beat entirely — omit it rather than drawing it from delivery signals, which measure something else — and report that no alignment decision is forced (or surface a clear delivery decision if the work plainly poses one). The "what's slowing us down" beat still applies.`}`;

  const sections = [];
  // Deterministic ground truth leads, so the prose interpreting it follows it.
  if (hasPosition) {
    sections.push(`ROADMAP POSITION (deterministic — current state, not a forecast):\n${position}`);
  }
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

Write the at-a-glance lede: a few short connected paragraphs covering what shipped, where we are along the roadmap, where this is heading, what's pulling us sideways, what's slowing us down, and the one decision — as flowing prose, no labels. Target ~250 words; never past ~320. Nothing else.`;

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
