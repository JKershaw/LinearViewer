/**
 * Suggested next autopilot run — goal-option generation (LIN-603).
 *
 * Turns the workspace's deterministic roadmap model + in-progress work + the top
 * of the execution queue into 1–N candidate *goal paragraphs* for the next
 * autopilot run, each with a one-line reasoning and a t-shirt size. Mirrors
 * lib/run-summary.js in shape (deterministic context → LLM → parsed JSON), but
 * its output is free-text goal directions, NOT an issue recommendation — so it is
 * deliberately exempt from the both-paths prompt-parity discipline that governs
 * generatePrompt()/the meta-prompt (it is not a recommendation seam).
 *
 * On accept, the chosen goal paragraph is handed to the EXISTING launch path (the
 * dispatch page goal field / buildAutopilotKickoff) — this module never launches
 * anything itself. "Continue until stopped" is not a new mode: it is an
 * always-present option whose goal is empty (the open-ended stack walk), and it
 * is appended deterministically here so it is guaranteed present regardless of
 * what the LLM returns.
 */

import { DEFAULT_MODEL, streamChat } from './openrouter.js';
import { buildRoadmapModel } from './roadmap.js';

/**
 * Valid t-shirt sizes, smallest → largest. Concrete (LLM-generated) goals use
 * S/M/L only; XL is reserved deterministically for the open-ended
 * continue-until-stopped option below (running the project with no specific
 * guide), so the scale and that option must move together (LIN-633).
 */
export const TSHIRT_SIZES = ['S', 'M', 'L', 'XL'];

/** Max LLM-generated options retained (the continue-until-stopped option is extra). */
export const MAX_GENERATED_OPTIONS = 6;

/** Concrete sizes the page guarantees at least one option for (XL is the open option). */
export const REQUIRED_SIZES = ['S', 'M', 'L'];

/** The always-present open-ended option (empty goal = walk the stack until stopped). */
export const CONTINUE_UNTIL_STOPPED_OPTION = Object.freeze({
  title: 'Continue until stopped',
  goal: '',
  reasoning: 'No specific goal — walk the stack under the precedence policy and keep making progress until you need the human.',
  size: 'XL',
  referencedTaskIds: Object.freeze([]),
  continueUntilStopped: true
});

const NEXT_RUN_SYSTEM_PROMPT = `You propose candidate goals for the next autonomous "autopilot" run over a software project's task tracker. Autopilot is given a single free-text goal and then drives the backlog toward it. You must reply with a single JSON object and nothing else.

Schema:
{
  "analysis": string,        // a short reasoning preamble: read the state below and think out loud about where the project most needs attention BEFORE committing to options. 2-4 sentences.
  "options": [
    {
      "title":             string,   // a headline that reads on its own without context, e.g. "Finish the proxy provider migration" — NOT a restatement of the goal prose
      "goal":              string,   // a 1-2 short-paragraph instruction the autopilot will be given verbatim — concrete direction, named focus areas, what "done" looks like
      "reasoning":         string,   // one line: why this is a sensible next direction, grounded in the provided state
      "size":              string,   // a t-shirt size estimate of the work: one of "S","M","L"
      "referencedTaskIds": [string]  // the identifiers (e.g. "LIN-123") of tasks from the provided state this option acts on; [] if none
    }
  ]
}

Rules:
- FIRST write "analysis": survey the provided state and reason about the project's most valuable next directions. Then derive the options from that reasoning. Keep it grounded — no invented work.
- Ground EVERY option ONLY in the provided project state (velocity, in-progress work, the top of the execution queue, projects). Never invent tasks or work that isn't evidenced.
- If a "North star (current intent)" section is present, treat it as the IMPORTANCE signal and rank/order your options by how much each advances that intent — not only by delivery state (finish WIP, clear blockers, sweep small tasks). Lead with the highest-alignment direction and let each option's "reasoning" say how it moves toward the north star. When no north star is present, fall back to delivery state as before. This governs ORDERING and emphasis only; it does NOT relax the size-coverage rule below — you must still return the full S/M/L spread.
- Provide AT LEAST ONE option for each size S, M, and L (three sizes, so three or more options). Make them genuinely different (e.g. finish in-progress work vs. clear a blocker vs. push a milestone vs. bundle many small queued tasks into one sweep), not rewordings of one idea.
- "title" is a standalone headline — understandable without reading the goal. Do NOT just copy the first line of the goal.
- "goal" is paragraph-style prose the autopilot reads as its instruction. Do NOT include the t-shirt size inside the goal text — the size is a separate field.
- "reasoning" is a single sentence under 160 characters.
- "referencedTaskIds" lists the exact identifiers (like "LIN-296") of the tasks this option touches, copied verbatim from the provided state. Use [] when the option references no specific task. These must be real identifiers from the state, never invented.
- "size" must be exactly one of S, M, L — never XL. Size reflects the AMOUNT of work in the run, NOT how hard it is: a goal that bundles many small, straightforward, independent tasks into one run is large even when no single task is complex. Breadth counts the same as depth.
  - S = an individual task or two.
  - M = a string of related tasks, a large task likely to become an epic, or an epic.
  - L = an ambitious target spanning several tasks or epics, OR a goal that sweeps up many small, straightforward tasks into a single run (e.g. "clear the ~20 queued feedback tweaks in one pass"). A long stack of easy, independent tasks is a perfectly valid L — don't reserve L for high-complexity work.
  - (XL — running the project open-endedly with no specific guide — is NOT yours to pick; that option is added automatically.)
- Do NOT include a "continue until stopped" / open-ended option — that one is added automatically. Every option you return must have a concrete goal.
- Do not include markdown, explanation, or code fences. Return raw JSON.`;

const PRIORITY_LABELS = { 0: 'none', 1: 'urgent', 2: 'high', 3: 'normal', 4: 'low' };

/**
 * Default freshness window (days) for folding a stored roadmap report into the
 * next-run context. The report store deliberately has NO TTL (a report is a
 * durable user artifact, not a cache — see lib/report-history-store.js), so this
 * is the gate that keeps a stale narrative out of fresh suggestions (LIN-742).
 */
export const ROADMAP_REPORT_MAX_AGE_DAYS = 14;

/** Cap on injected narrative length — narrative layers can run ~20k chars; keep the prompt lean. */
const MAX_ROADMAP_NARRATIVE_CHARS = 4000;

/**
 * Deterministic freshness gate + field selection over a durable roadmap report,
 * for injection into the next-run context (LIN-742). Returns a compact, dated
 * narrative payload, or null when there is nothing usable to inject — so the
 * caller degrades to silent omission.
 *
 * Returns null when: no report, no/invalid `generatedAt`, future-dated, older
 * than `maxAgeDays`, or no usable narrative prose. Prefers the `digest` (the
 * at-a-glance synthesis); falls back to `trajectory` when no digest exists. Only
 * narrative-only fields are used — velocity / cycle-time / delivery-health are
 * already in the deterministic context, so we don't restate them.
 *
 * @param {Object|null} report - A ReportRecord from reportHistoryStore.getLatest().
 * @param {Object} [opts]
 * @param {number} [opts.maxAgeDays=ROADMAP_REPORT_MAX_AGE_DAYS]
 * @param {number} [opts.now=Date.now()] - Injectable clock for deterministic tests.
 * @returns {{ text: string, ageDays: number }|null}
 */
export function resolveRoadmapNarrative(report, { maxAgeDays = ROADMAP_REPORT_MAX_AGE_DAYS, now = Date.now() } = {}) {
  if (!report || !report.generatedAt) return null;
  const generatedMs = new Date(report.generatedAt).getTime();
  if (!Number.isFinite(generatedMs)) return null;
  const ageMs = now - generatedMs;
  if (ageMs < 0) return null; // future-dated → treat as unusable rather than "0 days"
  const ageDays = Math.floor(ageMs / 86400000);
  if (ageDays > maxAgeDays) return null; // stale → omit silently

  const narrative = report.narrative && typeof report.narrative === 'object' ? report.narrative : {};
  const digest = typeof narrative.digest === 'string' ? narrative.digest.trim() : '';
  const trajectory = typeof narrative.trajectory === 'string' ? narrative.trajectory.trim() : '';
  const text = (digest || trajectory).slice(0, MAX_ROADMAP_NARRATIVE_CHARS);
  if (!text) return null; // a report with no narrative prose → nothing to inject

  return { text, ageDays };
}

/**
 * Deterministic north-star signal for the next-run context (LIN-779). The chooser
 * decides *what is important*, so it must see the importance signal — the workspace's
 * live north star — not just delivery state. Two sources, both already available to
 * the caller (nothing new is generated here):
 *
 *   1. The LIVE north-star text (the session preference set in workspace-api.js). It
 *      has NO age — it is always current — so it is returned unconditionally whenever
 *      non-empty. This is the intent signal the chooser is blind to today.
 *   2. The latest `northStarReading` (alignment classification) + `gap` from the
 *      already-fetched durable roadmap report. These ARE age-bearing (they were scored
 *      against the north star at report time), so they are folded in ONLY when the
 *      report is fresh, reusing the same `ROADMAP_REPORT_MAX_AGE_DAYS` gate as the
 *      roadmap narrative — a stale reading scored against possibly-changed intent must
 *      not be shown as current.
 *
 * Deliberately distinct from `resolveRoadmapNarrative`: that reads `digest`/`trajectory`
 * (delivery/trajectory colour) and EXCLUDES the north-star fields, which is exactly why
 * the LIN-742 digest echo cannot carry alignment. This resolver owns intent.
 *
 * @param {string} northStar - The live workspace north-star text ('' when none).
 * @param {Object|null} report - A ReportRecord from reportHistoryStore.getLatest().
 * @param {Object} [opts]
 * @param {number} [opts.maxAgeDays=ROADMAP_REPORT_MAX_AGE_DAYS]
 * @param {number} [opts.now=Date.now()] - Injectable clock for deterministic tests.
 * @returns {{ northStar: string, reading: string, gap: string, ageDays: number|null }|null}
 *   null when there is no live north star (the no-north-star path stays unchanged).
 *   `reading`/`gap` are '' and `ageDays` is null when there is no fresh report to fold in.
 */
export function resolveNorthStarSignal(northStar, report, { maxAgeDays = ROADMAP_REPORT_MAX_AGE_DAYS, now = Date.now() } = {}) {
  const text = typeof northStar === 'string' ? northStar.trim() : '';
  if (!text) return null; // no live north star → nothing to add, path unchanged

  let reading = '';
  let gap = '';
  let ageDays = null;

  // Fold in the latest alignment reading/gap ONLY when the report is fresh — same
  // freshness contract as resolveRoadmapNarrative so a stale reading can't masquerade
  // as current intent alignment.
  if (report && report.generatedAt) {
    const generatedMs = new Date(report.generatedAt).getTime();
    if (Number.isFinite(generatedMs)) {
      const ageMs = now - generatedMs;
      if (ageMs >= 0) {
        const age = Math.floor(ageMs / 86400000);
        if (age <= maxAgeDays) {
          const narrative = report.narrative && typeof report.narrative === 'object' ? report.narrative : {};
          const r = typeof narrative.northStarReading === 'string' ? narrative.northStarReading.trim() : '';
          const g = typeof narrative.gap === 'string' ? narrative.gap.trim() : '';
          if (r || g) {
            reading = r.slice(0, MAX_ROADMAP_NARRATIVE_CHARS);
            gap = g.slice(0, MAX_ROADMAP_NARRATIVE_CHARS);
            ageDays = age;
          }
        }
      }
    }
  }

  return { northStar: text, reading, gap, ageDays };
}

/**
 * Build the compact, deterministic grounding text the model reasons over. Reuses
 * the roadmap deterministic model (velocity, execution queue, milestones) so the
 * suggester rides existing context machinery rather than inventing data plumbing.
 *
 * @param {Object} model - Output of buildRoadmapModel (velocity, milestones, executionQueue, …).
 * @param {string} [organizationName] - Workspace/org name for orientation.
 * @param {{text: string, ageDays: number}|null} [roadmapNarrative] - Optional fresh
 *   roadmap-report narrative (from resolveRoadmapNarrative); appended as a dated
 *   section. Omitted entirely when null (no report, or stale/absent) — LIN-742.
 * @param {{northStar: string, reading: string, gap: string, ageDays: number|null}|null} [northStarSignal]
 *   Optional live north-star signal (from resolveNorthStarSignal); rendered as its own
 *   clearly-labelled "North star (current intent)" section, separate from the roadmap
 *   trajectory analysis so intent and trajectory don't blur. Omitted entirely when null
 *   (no live north star), keeping the no-north-star output byte-identical — LIN-779.
 * @returns {string}
 */
export function formatNextRunContext(model, organizationName = '', roadmapNarrative = null, northStarSignal = null) {
  if (!model || typeof model !== 'object') return 'No project data available.';

  const lines = [];
  if (organizationName) lines.push(`Workspace: ${organizationName}`);

  const v = model.velocity || {};
  lines.push(
    `Velocity: ${v.tasksPerWeek ?? 0} tasks/week, ${v.pointsPerWeek ?? 0} points/week (trend: ${v.trend || 'unknown'}).`
  );

  const queue = Array.isArray(model.executionQueue) ? model.executionQueue : [];
  // Relationship lookups, built once from the queue so cards can name the tasks
  // they block / are blocked by / are a subtask of (the data already rides on
  // each card as blocksIds/parentId — this just resolves ids → identifiers).
  const rel = buildRelationshipIndex(queue);

  const inProgress = queue.filter(c => c.stateType === 'started');
  if (inProgress.length > 0) {
    lines.push('');
    lines.push(`In progress now (${inProgress.length}):`);
    for (const c of inProgress.slice(0, 8)) lines.push(`- ${formatCard(c, rel)}`);
  } else {
    lines.push('');
    lines.push('In progress now: nothing is currently started.');
  }

  const upNext = queue.filter(c => c.stateType !== 'started').slice(0, 8);
  if (upNext.length > 0) {
    lines.push('');
    lines.push('Top of the execution queue (ranked, next up):');
    for (const c of upNext) lines.push(`- ${formatCard(c, rel)}`);
  }

  // Dependency chains — the deterministic critical paths the model already
  // computed. Each is a blocker→blocked ordering, so it tells the model where
  // unblocking work would have the most leverage.
  const cpEntries = model.criticalPaths instanceof Map
    ? [...model.criticalPaths.entries()]
    : Object.entries(model.criticalPaths || {});
  const chains = cpEntries.filter(([, cp]) => cp && Array.isArray(cp.path) && cp.path.length > 1);
  if (chains.length > 0) {
    lines.push('');
    lines.push('Dependency chains (critical paths — unblock the head to free the rest):');
    for (const [project, cp] of chains.slice(0, 6)) {
      const chain = cp.path.map(id => rel.byId.get(id)?.identifier || id).join(' → ');
      lines.push(`- ${project}: ${chain} (${cp.path.length} linked)`);
    }
  }

  // Risks the deterministic layer flagged (overdue, unestimated/unassigned
  // critical-path work, declining velocity).
  const risks = Array.isArray(model.risks) ? model.risks : [];
  if (risks.length > 0) {
    lines.push('');
    lines.push(`Risks flagged (${risks.length}):`);
    for (const r of risks.slice(0, 6)) {
      const where = r.milestone ? ` (${r.milestone})` : '';
      lines.push(`- [${r.severity || 'info'}] ${r.description}${where}`);
    }
  }

  // Delivery health from the pre-analysis (cycle time, velocity shift, stale WIP).
  const a = model.analysis || {};
  const health = [];
  if (a.cycleTime) {
    health.push(`Median cycle time: ${a.cycleTime.medianDays} days (avg ${a.cycleTime.avgDays}, n=${a.cycleTime.sampleSize}).`);
  }
  if (a.velocityShift) {
    const sign = a.velocityShift.pctChange >= 0 ? '+' : '';
    health.push(`Velocity shift: ${a.velocityShift.recentAvg}/wk recent vs ${a.velocityShift.priorAvg}/wk prior (${sign}${a.velocityShift.pctChange}%).`);
  }
  if (Array.isArray(a.staleTasks) && a.staleTasks.length > 0) {
    health.push(`Stale in progress: ${a.staleTasks.length} task(s) running unusually long.`);
  }
  if (health.length > 0) {
    lines.push('');
    lines.push('Delivery health:');
    for (const h of health) lines.push(`- ${h}`);
  }

  const milestones = Array.isArray(model.milestones) ? model.milestones : [];
  if (milestones.length > 0) {
    lines.push('');
    lines.push('Projects / milestones:');
    for (const m of milestones.slice(0, 8)) {
      const name = m.projectName || m.name || 'Unnamed';
      const done = m.subtaskDone ?? m.done ?? null;
      const total = m.subtaskTotal ?? m.total ?? null;
      const progress = done != null && total != null ? ` — ${done}/${total} done` : '';
      lines.push(`- ${name}${progress}`);
    }
  }

  // Live north star (LIN-779): the workspace's current intent — the importance
  // signal the chooser must rank against, kept as its own clearly-labelled section,
  // distinct from the roadmap trajectory analysis below so intent and trajectory
  // don't blur. The live text is always current (no age); the alignment reading/gap
  // ride in only when a fresh report supplied them (caller gates freshness).
  if (northStarSignal && northStarSignal.northStar) {
    lines.push('');
    lines.push('North star (current intent):');
    lines.push(northStarSignal.northStar);
    if (northStarSignal.reading || northStarSignal.gap) {
      const age = northStarSignal.ageDays;
      const when = age == null ? '' : age <= 0 ? ' (today)' : ` (${age} day${age === 1 ? '' : 's'} ago)`;
      if (northStarSignal.reading) lines.push(`Latest alignment reading${when}: ${northStarSignal.reading}`);
      if (northStarSignal.gap) lines.push(`Gap to the north star${when}: ${northStarSignal.gap}`);
    }
  }

  // Durable roadmap-report narrative (LIN-742): the one dimension the live
  // deterministic model lacks (north-star / trajectory prose). Dated so the model
  // can discount an older reading; only present when fresh (caller gates it).
  if (roadmapNarrative && roadmapNarrative.text) {
    const age = roadmapNarrative.ageDays;
    const when = age <= 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`;
    lines.push('');
    lines.push(`Roadmap analysis (generated ${when}):`);
    lines.push(roadmapNarrative.text);
  }

  return lines.join('\n');
}

/**
 * Build id→card and blocked→blockers lookups from the execution queue so a card
 * can be annotated with the *identifiers* of the tasks it relates to. Pure;
 * tolerates cards without ids (the relationship meta simply doesn't render).
 *
 * @param {Array} queue
 * @returns {{ byId: Map<string, Object>, blockedBy: Map<string, Object[]> }}
 */
function buildRelationshipIndex(queue) {
  const byId = new Map();
  for (const c of queue) if (c.id) byId.set(c.id, c);

  const blockedBy = new Map();
  for (const c of queue) {
    for (const blockedId of c.blocksIds || []) {
      if (!byId.has(blockedId)) continue; // only chains within the live queue
      if (!blockedBy.has(blockedId)) blockedBy.set(blockedId, []);
      blockedBy.get(blockedId).push(c);
    }
  }
  return { byId, blockedBy };
}

/**
 * Render the relationship clause for a card (blocks / blocked by / subtask of),
 * resolving ids to identifiers via the index. Returns '' when there is nothing
 * to say (or no index was supplied).
 */
function formatRelationships(c, rel) {
  if (!rel) return '';
  const out = [];
  const blocks = (c.blocksIds || [])
    .map(id => rel.byId.get(id)?.identifier)
    .filter(Boolean);
  if (blocks.length) out.push(`blocks ${blocks.join(', ')}`);

  const blockers = (rel.blockedBy.get(c.id) || [])
    .map(b => b.identifier)
    .filter(Boolean);
  if (blockers.length) out.push(`blocked by ${blockers.join(', ')}`);

  if (c.parentId && rel.byId.get(c.parentId)?.identifier) {
    out.push(`subtask of ${rel.byId.get(c.parentId).identifier}`);
  }
  return out.length ? ` (${out.join('; ')})` : '';
}

function formatCard(c, rel) {
  const parts = [];
  if (c.identifier) parts.push(c.identifier);
  parts.push(c.title || '(untitled)');
  const meta = [];
  if (c.projectName) meta.push(c.projectName);
  if (c.priority) meta.push(`priority: ${PRIORITY_LABELS[c.priority] || c.priority}`);
  if (Array.isArray(c.labels) && c.labels.length) meta.push(c.labels.join('/'));
  const metaStr = meta.length ? ` [${meta.join(', ')}]` : '';
  return `${parts.join(' — ')}${metaStr}${formatRelationships(c, rel)}`;
}

/**
 * Build a short deterministic intro paragraph shown above the generated options.
 * It orients the reader in the same grounded state the suggestions came from
 * (in-progress vs queued counts, velocity, the next ranked item, risk count) and
 * points at the full context panel. Pure; never calls an LLM (mirrors the page's
 * deterministic-grounding ethos — see formatNextRunContext). LIN-638.
 *
 * @param {Object} model - buildRoadmapModel output.
 * @param {string} [organizationName]
 * @returns {string}
 */
export function buildNextRunSummary(model, organizationName = '') {
  if (!model || typeof model !== 'object') return '';

  const queue = Array.isArray(model.executionQueue) ? model.executionQueue : [];
  const inProgress = queue.filter(c => c.stateType === 'started');
  const upNext = queue.filter(c => c.stateType !== 'started');
  const v = model.velocity || {};
  const who = organizationName || 'This workspace';

  const sentences = [];
  sentences.push(
    `${who} has ${inProgress.length} task${inProgress.length === 1 ? '' : 's'} in progress and ${upNext.length} queued.`
  );
  if (v.tasksPerWeek != null) {
    sentences.push(
      `Recent velocity is ${v.tasksPerWeek} task${v.tasksPerWeek === 1 ? '' : 's'}/week (${v.trend || 'unknown'} trend).`
    );
  }
  const next = upNext[0];
  if (next) {
    const id = next.identifier ? `${next.identifier} — ` : '';
    sentences.push(`Next up the queue: ${id}${next.title || '(untitled)'}.`);
  }
  const risks = Array.isArray(model.risks) ? model.risks : [];
  if (risks.length > 0) {
    const high = risks.filter(r => r.severity === 'high').length;
    sentences.push(`${risks.length} risk${risks.length === 1 ? '' : 's'} flagged${high ? ` (${high} high)` : ''}.`);
  }
  sentences.push(
    'Each option below is a candidate goal grounded in this state — expand the context panel to see exactly what informed them.'
  );
  return sentences.join(' ');
}

/**
 * Build the messages array for the goal-suggestion LLM call. Kept in signature-sync
 * with the inline message build in generateGoalSuggestions so the two can't drift:
 * both feed the same formatNextRunContext(...) (with the optional roadmap-narrative
 * and north-star signal) as the single user message.
 *
 * @param {Object} model - buildRoadmapModel output.
 * @param {string} [organizationName]
 * @param {{text: string, ageDays: number}|null} [roadmapNarrative] - LIN-742.
 * @param {{northStar: string, reading: string, gap: string, ageDays: number|null}|null} [northStarSignal] - LIN-779.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildNextRunMessages(model, organizationName = '', roadmapNarrative = null, northStarSignal = null) {
  return [
    { role: 'system', content: NEXT_RUN_SYSTEM_PROMPT },
    { role: 'user', content: formatNextRunContext(model, organizationName, roadmapNarrative, northStarSignal) }
  ];
}

/**
 * Coerce a raw size string to a valid t-shirt size, defaulting to 'M'.
 * @param {*} value
 * @returns {string}
 */
export function normalizeSize(value) {
  if (typeof value !== 'string') return 'M';
  const up = value.trim().toUpperCase();
  return TSHIRT_SIZES.includes(up) ? up : 'M';
}

/**
 * Pull a JSON object out of a raw model reply, tolerating code fences and prose
 * around it. Returns the parsed object, or null if nothing parseable was found.
 *
 * @param {string} raw
 * @returns {Object|null}
 */
function extractJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  if (!text.startsWith('{')) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    text = text.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Normalize a raw referenced-task-ids value to an array of trimmed identifier
 * strings (deduped, capped). Tolerates a single string or a mixed array.
 * @param {*} value
 * @returns {string[]}
 */
function normalizeReferencedTaskIds(value) {
  const arr = Array.isArray(value) ? value : (value == null ? [] : [value]);
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    if (typeof v !== 'string') continue;
    const id = v.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * Parse a full next-run response into its global `analysis` preamble plus the
 * sanitized concrete options. Tolerates code fences and prose around the JSON.
 * The continue-until-stopped option is NOT added here — that is the generator's
 * job. Referenced-task ids are kept as the model emitted them; validation against
 * the live state happens in the generator (which holds the roadmap model).
 *
 * @param {string} raw - Raw model text.
 * @returns {{ analysis: string, options: Array<{title: string, goal: string, reasoning: string, size: string, referencedTaskIds: string[]}> }}
 */
export function parseNextRunResponse(raw) {
  const parsed = extractJsonObject(raw);
  if (!parsed) return { analysis: '', options: [] };

  const analysis = typeof parsed.analysis === 'string' ? parsed.analysis.trim() : '';

  const rawOptions = Array.isArray(parsed.options) ? parsed.options : [];
  const options = rawOptions
    .map(o => {
      const goal = typeof o?.goal === 'string' ? o.goal.trim() : '';
      if (!goal) return null;
      // Title falls back to the goal's first line so an older/short model reply
      // still yields a usable headline rather than a blank one.
      const rawTitle = typeof o?.title === 'string' ? o.title.trim() : '';
      const title = (rawTitle || goal.split('\n')[0]).slice(0, 160);
      return {
        title,
        goal: goal.slice(0, 1000),
        reasoning: typeof o?.reasoning === 'string' ? o.reasoning.trim() : '',
        size: normalizeSize(o?.size),
        referencedTaskIds: normalizeReferencedTaskIds(o?.referencedTaskIds)
      };
    })
    .filter(Boolean)
    .slice(0, MAX_GENERATED_OPTIONS);

  return { analysis, options };
}

/**
 * Back-compat thin wrapper returning only the options array (the original
 * contract). New callers should prefer parseNextRunResponse for the analysis.
 *
 * @param {string} raw
 * @returns {Array<{title: string, goal: string, reasoning: string, size: string, referencedTaskIds: string[]}>}
 */
export function parseGoalSuggestions(raw) {
  return parseNextRunResponse(raw).options;
}

/**
 * Build a deterministic stand-in option of a given size from the roadmap model,
 * used to fill a size the LLM skipped. Picks a concrete queued/in-progress task
 * (preferring one not already referenced) so the synthesized goal is grounded;
 * falls back to a generic open-ended-but-sized direction when the queue is empty.
 *
 * @param {Object|null} card - An executionQueue card, or null.
 * @param {string} size
 * @returns {Object}
 */
function synthesizeSizedOption(card, size) {
  if (card && card.identifier) {
    const id = card.identifier;
    const title = card.title || '(untitled)';
    return {
      title: `Advance ${id}: ${title}`,
      goal: `Pick up ${id} (${title}) and drive it forward — research what it needs, do the work, and get it to a reviewable, verifiable state before pulling anything else off the stack.`,
      reasoning: `Deterministic fill to guarantee a size-${size} option; ${id} is on the execution queue.`,
      size,
      referencedTaskIds: [id],
      synthesized: true
    };
  }
  return {
    title: `Take on a size-${size} slice of the backlog`,
    goal: `Pick the most valuable size-${size} piece of work currently on the stack and make solid, verifiable progress on it.`,
    reasoning: `Deterministic fill to guarantee a size-${size} option.`,
    size,
    referencedTaskIds: [],
    synthesized: true
  };
}

/**
 * Guarantee at least one option for each of S, M, L (LIN-642). For every required
 * size missing from `options`, append a deterministic stand-in synthesized from
 * the roadmap model's execution queue. Pure; never re-prompts. Already-covered
 * sizes are untouched and the input order is preserved.
 *
 * @param {Array} options - Parsed concrete options (NOT including the open option).
 * @param {Object} model - buildRoadmapModel output (for the execution queue).
 * @returns {Array}
 */
export function ensureSizeCoverage(options, model) {
  const list = Array.isArray(options) ? [...options] : [];
  const present = new Set(list.map(o => o?.size));
  const missing = REQUIRED_SIZES.filter(s => !present.has(s));
  if (missing.length === 0) return list;

  const queue = Array.isArray(model?.executionQueue) ? model.executionQueue : [];
  // Prefer tasks not already referenced so fills don't duplicate a card the LLM
  // already used; started/queued first, then anything else with an identifier.
  const referenced = new Set(list.flatMap(o => o?.referencedTaskIds || []));
  const ranked = [
    ...queue.filter(c => c.identifier && c.stateType === 'started'),
    ...queue.filter(c => c.identifier && c.stateType !== 'started'),
  ];
  const pool = ranked.filter(c => !referenced.has(c.identifier));
  let i = 0;
  for (const size of missing) {
    const card = pool[i++] || ranked[0] || null;
    list.push(synthesizeSizedOption(card, size));
  }
  return list;
}

/**
 * Enrich each option's referenced tasks with their human-readable title (LIN-923).
 * The wire only carried `referencedTaskIds` (opaque identifiers like "LIN-296"),
 * so the page could name *which* tasks a goal touched but not *what* they are.
 * This resolves each id → title from the roadmap model's execution queue and
 * attaches a parallel `referencedTasks: [{ id, title }]` array, leaving
 * `referencedTaskIds` untouched (it is the machine-readable field the staleness
 * diff reads — LIN-644). An id with no matching card resolves to an empty title,
 * so the client still shows the identifier. Pure.
 *
 * @param {Array} options - Options carrying `referencedTaskIds`.
 * @param {Object} model - buildRoadmapModel output (source of id → title).
 * @returns {Array} The same options with `referencedTasks` attached.
 */
export function attachReferencedTaskTitles(options, model) {
  const list = Array.isArray(options) ? options : [];
  const queue = Array.isArray(model?.executionQueue) ? model.executionQueue : [];
  const titleById = new Map();
  for (const c of queue) {
    if (c.identifier) titleById.set(c.identifier, c.title || '');
  }
  return list.map(o => ({
    ...o,
    referencedTasks: (o.referencedTaskIds || []).map(id => ({
      id,
      title: titleById.get(id) || ''
    }))
  }));
}

export { DEFAULT_MODEL as DEFAULT_NEXT_RUN_MODEL };

/**
 * Generate goal options for the next autopilot run.
 *
 * @param {Object} input
 * @param {Array}  input.projects - Raw provider projects.
 * @param {Array}  input.issues   - Raw provider issues.
 * @param {string} [input.organizationName]
 * @param {Object|null} [input.roadmapReport] - Latest durable roadmap report (LIN-742);
 *   folded into context only when fresh, omitted silently otherwise.
 * @param {string} [input.northStar] - The live workspace north star (LIN-779); rendered
 *   as its own "North star (current intent)" context section so options can be ranked by
 *   alignment, not just delivery state. Optional; defaults to '' → the no-north-star path
 *   is byte-identical to today.
 * @param {Object} [options]
 * @param {string} [options.apiKey] - OpenRouter API key.
 * @param {string} [options.model]  - Model ID (defaults to DEFAULT_MODEL).
 * @param {number} [options.roadmapMaxAgeDays] - Override the roadmap-report freshness window.
 * @param {number} [options.maxTokens=1400]
 * @returns {Promise<{analysis: string, options: Array, model: string, summary: string, context: string}>}
 *   options always ends with the continue-until-stopped option (empty goal) and carries at
 *   least one option per size S/M/L (deterministically filled if the LLM skipped one); an LLM
 *   failure still yields the size-guaranteed set plus that open option rather than an error.
 *   `analysis` is the model's global think-first reasoning preamble (LIN-642; '' if absent).
 *   `summary` is a short deterministic intro paragraph (LIN-638). `context` is the exact
 *   deterministic grounding blob the model was given, returned verbatim so the page can show
 *   the user what the suggestions were grounded in (LIN-633).
 */
export async function generateGoalSuggestions({ projects = [], issues = [], organizationName = '', roadmapReport = null, northStar = '' } = {}, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const roadmapModel = buildRoadmapModel(projects, issues);
  // Optional durable roadmap-report narrative, gated for freshness here so the
  // window default lives in one place; null (absent/stale) → silently omitted (LIN-742).
  const roadmapNarrative = resolveRoadmapNarrative(roadmapReport, { maxAgeDays: options.roadmapMaxAgeDays });
  // Live north-star signal (LIN-779): the current-intent importance signal the chooser
  // ranks against. The live text is always shown when present; the reading/gap ride in
  // only when the same report is fresh. null (no live north star) → section omitted,
  // keeping the no-north-star path byte-identical to today.
  const northStarSignal = resolveNorthStarSignal(northStar, roadmapReport, { maxAgeDays: options.roadmapMaxAgeDays });
  // Compute the grounding blob once: it both feeds the prompt (via the user message)
  // and is returned to the client so the displayed context == the given context.
  const context = formatNextRunContext(roadmapModel, organizationName, roadmapNarrative, northStarSignal);
  // Deterministic intro paragraph shown above the options (LIN-638) — derived from
  // the same model, never from the LLM, so it stays factual and free.
  const summary = buildNextRunSummary(roadmapModel, organizationName);
  const messages = [
    { role: 'system', content: NEXT_RUN_SYSTEM_PROMPT },
    { role: 'user', content: context }
  ];

  let buffer = '';
  await streamChat(
    messages,
    { apiKey: options.apiKey, model, maxTokens: options.maxTokens || 1400, temperature: 0.4,
      callMeta: { urlKey: options.urlKey || null, feature: 'next-run' } },
    (type, data) => {
      if (type === 'token' && data?.token) buffer += data.token;
    }
  );

  const { analysis, options: parsed } = parseNextRunResponse(buffer);
  // Keep referencedTaskIds machine-readable AND trustworthy: drop any id the model
  // emitted that isn't a real task in the grounded state (LIN-644 diffs this field
  // for staleness, so it must not carry hallucinated identifiers).
  const validIds = new Set(
    (roadmapModel.executionQueue || []).map(c => c.identifier).filter(Boolean)
  );
  const grounded = parsed.map(o => ({
    ...o,
    referencedTaskIds: (o.referencedTaskIds || []).filter(id => validIds.has(id))
  }));
  // Real per-size guarantee (not prompt-only): fill any missing S/M/L from the model.
  const covered = ensureSizeCoverage(grounded, roadmapModel);
  // The open-ended option is ALWAYS present and is the deterministic mapping of
  // "continue until stopped" → empty goal. Appended last so concrete directions
  // lead. Resolve each option's referenced task ids → titles so the page can name
  // what the tasks actually are, not just their identifiers (LIN-923).
  const finalOptions = attachReferencedTaskTitles(
    [...covered, { ...CONTINUE_UNTIL_STOPPED_OPTION }],
    roadmapModel
  );
  return { analysis, options: finalOptions, model, summary, context };
}
