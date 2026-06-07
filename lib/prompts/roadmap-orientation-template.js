/**
 * Roadmap orientation prompt template (LIN-300, Step 1 of LIN-298).
 *
 * Produces per-task COMPASS BEARINGS adjudicating each not-yet-started
 * candidate task against a fixed north star. The output is a flat LINE FORMAT,
 * not JSON and not prose: one line per candidate, `IDENTIFIER | BEARING | reason`.
 *
 * Why line format (LIN-324). The earlier JSON contract failed silently on
 * real-sized workspaces: a token-cap overrun truncated the array mid-element and
 * `JSON.parse` then threw on the WHOLE response, discarding every bearing the
 * model had already produced. The line format degrades gracefully — a truncated
 * final line costs at most that one line; every complete line above it survives.
 * This is "forgiving" only in the recovery sense: the parser commits to this one
 * shape and parses ONLY it. It does not accept JSON, wrapper objects, full-word
 * bearings, or list/markdown decoration. Genuine format drift therefore parses
 * to nothing usable, and the route SURFACES that as a notice rather than
 * absorbing it (D2) — novel drift stays a human-visible signal, not a silent [].
 *
 * This is a follow-up data call (Strategy B from LIN-300's pinned decision):
 * it is deliberately SEPARATE from the five plain-text narrative layers in the
 * generate pipeline. The generate route accumulates the full output (it does not
 * stream it into a panel), parses it with parseOrientationLines, validates the
 * bearings against the 8-point vocabulary (normalizeBearings), and the client
 * persists them into the Step 0 store's `orientation` field for the ship view
 * (LIN-301) and renders them on the roadmap page as a visible result (LIN-324/D).
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

OUTPUT FORMAT — read this exactly. Emit ONE LINE PER CANDIDATE, nothing else. Each line is three fields separated by a vertical bar:

  IDENTIFIER | BEARING | reason

  IDENTIFIER — the task identifier verbatim (e.g. LIN-123). Never alter it.
  BEARING    — one token from this set ONLY: ${ORIENTATION_BEARINGS.join(', ')}, OFF.
               N points straight at the north star (directly serves the stated intent);
               alignment weakens as you rotate away, and S points directly away (works against it).
               Use OFF for an OFF-COMPASS task: one that neither serves the north star nor
               counts as necessary maintenance (an archive candidate).
  reason     — one short sentence grounding the bearing in a specific north-star phrase and this task.

Example line:
  LIN-123 | NE | Advances the "self-serve onboarding" goal but adds optional config first.

This is NOT JSON. Do not output JSON, arrays, objects, braces, brackets, quotes-as-syntax, code fences, markdown, bullets, numbering, or any header. Do not write full-word bearings (write N, not NORTH). Output the lines and nothing else.

RULES:
- Use ONLY the candidate tasks and the north star provided. Do not invent tasks, dates, or intent. Score every candidate exactly once, one line each.
- The north star is FIXED. Adjudicate how each task aligns to it; never describe how the north star might be revised, reinterpreted, softened, or stretched to make the work look better aligned. Bearings are adjudication items, never suggested north-star edits.
- Cite specifics in each reason: name what the task does and the specific north-star phrase it serves or diverges from. Vague reasons are not reasons.
- DELIVERY, NOT PROJECTIONS: reasons describe alignment as it stands right now. Do not use ETA, deadline, velocity, or projection language ("will ship", "on track for", "by Q3"). No forecasting.
- Keep every reason to one sentence. Output one line per candidate and nothing else.`;

  const user = `Here is the north star:

${northStar}

Here are the not-yet-started candidate tasks to adjudicate (in-progress work is excluded — it already sits on the ship):

${candidateLines}

Output the bearing lines now — one per candidate, IDENTIFIER | BEARING | reason, and nothing else.`;

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

/**
 * Parse the line-format orientation output into raw bearing records (LIN-324).
 *
 * Contract: ONE format, parsed strictly — `IDENTIFIER | BEARING | reason` per
 * line. This is the deliberate counterpart to the dropped JSON contract; the
 * goal is resilient RECOVERY, not permissive multi-format acceptance:
 *
 *   - splits each line on the first two pipes only (so a reason may itself
 *     contain pipes);
 *   - a line with no pipe, or with an empty identifier, is skipped — never fatal,
 *     so one stray/prose line cannot discard the whole response;
 *   - a truncated trailing line costs at most that one line (the JSON failure
 *     mode this replaces threw away everything);
 *   - the `OFF` token marks an off-compass task → { archived: true, bearing: '' };
 *     any other token is passed through verbatim (upper-cased) as the bearing and
 *     left for normalizeBearings to validate against the 8-point vocabulary.
 *
 * It does NOT coerce: full-word bearings, JSON, wrapper objects, and markdown
 * decoration are not understood, so genuine format drift parses to nothing
 * usable. The route turns that empty result into a visible notice rather than a
 * silent [] (D2), keeping novel drift a human-visible signal.
 *
 * Returns records in the shape normalizeBearings expects
 * ({ identifier, bearing, reason, archived }); vocabulary enforcement is the
 * route's job, not the parser's.
 *
 * @param {string} text - Raw accumulated model output.
 * @returns {Array<{identifier: string, bearing: string, reason: string, archived: boolean}>}
 */
export function parseOrientationLines(text) {
  const out = [];
  const lines = String(text == null ? '' : text).split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue; // blank-line tolerance

    const firstPipe = line.indexOf('|');
    if (firstPipe === -1) continue; // not our format — skip, never fatal

    const identifier = line.slice(0, firstPipe).trim();
    if (!identifier) continue;

    const rest = line.slice(firstPipe + 1);
    const secondPipe = rest.indexOf('|');
    const bearingRaw = (secondPipe === -1 ? rest : rest.slice(0, secondPipe)).trim().toUpperCase();
    const reason = secondPipe === -1 ? '' : rest.slice(secondPipe + 1).trim();

    if (bearingRaw === 'OFF') {
      out.push({ identifier, bearing: '', reason, archived: true });
    } else {
      out.push({ identifier, bearing: bearingRaw, reason, archived: false });
    }
  }
  return out;
}
