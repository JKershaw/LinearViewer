/**
 * Roadmap orientation prompt template (LIN-300, Step 1 of LIN-298).
 *
 * Produces per-task COMPASS BEARINGS adjudicating each not-yet-started
 * candidate task against a fixed north star. The output is JSON, not prose.
 *
 * This is a follow-up data call (Strategy B from LIN-300's pinned decision):
 * it is deliberately SEPARATE from the five plain-text narrative layers in the
 * generate pipeline, so those layers keep their plain-text rendering contract
 * intact and the bearings live in a clean JSON-native call. The generate route
 * accumulates the full output (it does not stream it into a panel), validates
 * the bearings against the 8-point vocabulary, and the client persists them
 * into the Step 0 store's `orientation` field for the ship view (LIN-301).
 *
 * Mirrors lib/prompts/roadmap-north-star-template.js for dialect, and carries
 * its drift-as-rationalization guard verbatim: the north star is FIXED;
 * bearings adjudicate the work against it, never the reverse. It also carries
 * the delivery-not-projections discipline — reasons describe alignment as it
 * stands, with no ETA/projection language.
 *
 * See docs/roadmap-narrative-pipeline.md and LIN-298.
 */

/**
 * The 8-point compass vocabulary. Shared three ways (LIN-300):
 *   - emitted here (the template instructs the model to use only these),
 *   - validated/normalized by the generate route (vocabulary enforcement),
 *   - mapped bearing→angle by the ship view (LIN-301).
 * The store's normalizeOrientation enforces field *shape* only, not this set.
 */
export const ORIENTATION_BEARINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * High safety cap on the candidate list fed into a single orientation call
 * (LIN-324). The execution queue is already priority-ordered, so capping drops
 * only the lowest-priority tail. Set high enough to bite ONLY pathological
 * sizes — a normal workspace (tens of candidates) never reaches it. Any actual
 * tail-drop is surfaced to the operator at generation time (Strategy C), never
 * silently. The token allowance (Strategy A) scales to the post-cap count.
 */
export const ORIENTATION_CANDIDATE_CAP = 200;

/**
 * Shared filter: the not-yet-started candidate projection, uncapped.
 *
 * Reads roadmapModel.executionQueue, which buildExecutionQueue has already
 * filtered to non-terminal issues (completed/canceled/DUPLICATE excluded —
 * LIN-276 treats `duplicate` as terminal, inherited here for free) and ordered.
 * In-progress (`started`) work is then excluded too: it already sits on the
 * ship per LIN-298, and orientation only governs what gets CHOSEN INTO progress.
 *
 * Both serializeOrientationCandidates and countOrientationCandidates go through
 * this single predicate so the route's token-scaling count and the prompt's
 * candidate list can never diverge (LIN-324).
 *
 * @param {Object} roadmapModel - The deterministic roadmap model.
 * @returns {Array<{identifier: string, title: string, project: string}>}
 */
function filterOrientationCandidates(roadmapModel) {
  const queue = (roadmapModel && roadmapModel.executionQueue) || [];
  return queue
    .filter(c => c && c.stateType !== 'started')
    .map(c => ({
      identifier: c.identifier || '',
      title: c.title || '',
      project: c.projectName || 'Unassigned'
    }));
}

/**
 * Serialize the not-yet-started candidate queue for orientation, capped to a
 * high safety ceiling (LIN-324). The queue is priority-ordered, so any tail-drop
 * removes the lowest-priority candidates; callers surface a drop via Strategy C.
 *
 * This helper lives in this module — mirroring how summarizeRoadmapModel lives
 * in the narrative template — so lib/roadmap.js stays untouched (it is a
 * high-churn file and this ticket makes no functional change to it).
 *
 * @param {Object} roadmapModel - The deterministic roadmap model.
 * @param {Object} [options]
 * @param {number} [options.cap=ORIENTATION_CANDIDATE_CAP] - Max candidates; a
 *   non-positive value disables the cap (used by tests).
 * @returns {Array<{identifier: string, title: string, project: string}>}
 */
export function serializeOrientationCandidates(roadmapModel, options = {}) {
  const all = filterOrientationCandidates(roadmapModel);
  const cap = options.cap == null ? ORIENTATION_CANDIDATE_CAP : options.cap;
  return cap > 0 ? all.slice(0, cap) : all;
}

/**
 * Total not-yet-started candidates BEFORE the safety cap (LIN-324). The route
 * uses this against the post-cap serialized length to detect a tail-drop and to
 * scale the token allowance to the real workload.
 *
 * @param {Object} roadmapModel - The deterministic roadmap model.
 * @returns {number}
 */
export function countOrientationCandidates(roadmapModel) {
  return filterOrientationCandidates(roadmapModel).length;
}

/**
 * Build messages array for generating per-task orientation bearings.
 *
 * @param {Object} roadmapModel - The deterministic roadmap model.
 * @param {string} northStar    - The workspace's stated north star (verbatim).
 *   Must be the SAME snapshot the north-star-reading layer and saveReport use
 *   (the single `northStar` variable in the generate orchestration).
 * @returns {Array<{role: string, content: string}>} Messages array for streamChat.
 */
export function buildRoadmapOrientationMessages(roadmapModel, northStar) {
  const candidates = serializeOrientationCandidates(roadmapModel);

  const candidateLines = candidates.length
    ? candidates.map(c => `  ${c.identifier} — ${c.title} [${c.project}]`).join('\n')
    : '  (no not-yet-started candidate tasks)';

  const system = `You are a critical evaluator assigning each candidate task a COMPASS BEARING against a fixed north star. You are not a cheerleader. Your lens is normative judgment: how directly does each task, as it stands, serve the stated intent?

OUTPUT: Return JSON ONLY. No prose, no commentary, no markdown, no code fences. Output a single JSON array and nothing else. Each element is an object with exactly these keys:
  "identifier" — the task identifier verbatim (e.g. "LIN-123"). Never alter it.
  "bearing"    — one of the 8-point compass set: N, NE, E, SE, S, SW, W, NW.
                 N points straight at the north star (directly serves the stated intent);
                 alignment weakens as you rotate away, and S points directly away (works against it).
  "reason"     — one short sentence grounding the bearing in a specific north-star phrase and this task.
  "archived"   — boolean. true ONLY when the task is OFF-COMPASS: it neither serves the north star
                 nor counts as necessary maintenance (an archive candidate). Otherwise false.

RULES:
- Use ONLY the candidate tasks and the north star provided. Do not invent tasks, dates, or intent. Score every candidate exactly once.
- The north star is FIXED. Adjudicate how each task aligns to it; never describe how the north star might be revised, reinterpreted, softened, or stretched to make the work look better aligned. Bearings are adjudication items, never suggested north-star edits.
- Cite specifics in each reason: name what the task does and the specific north-star phrase it serves or diverges from. Vague reasons are not reasons.
- DELIVERY, NOT PROJECTIONS: reasons describe alignment as it stands right now. Do not use ETA, deadline, velocity, or projection language ("will ship", "on track for", "by Q3"). No forecasting.
- If a task is genuinely off-compass (neither serving the north star nor necessary maintenance), set "archived": true; its bearing then carries no placement weight, but still emit a best-effort bearing.
- Keep every reason to one sentence. Return the JSON array and nothing else.`;

  const user = `Here is the north star:

${northStar}

Here are the not-yet-started candidate tasks to adjudicate (in-progress work is excluded — it already sits on the ship):

${candidateLines}

Return the JSON array of bearings now.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

// Backward-compatible export (returns single prompt string for testing).
export function buildRoadmapOrientationPrompt(roadmapModel, northStar) {
  return buildRoadmapOrientationMessages(roadmapModel, northStar)
    .map(m => m.content)
    .join('\n\n');
}
