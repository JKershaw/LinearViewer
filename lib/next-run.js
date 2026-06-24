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

/** Valid t-shirt sizes, smallest → largest. */
export const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL'];

/** Max LLM-generated options retained (the continue-until-stopped option is extra). */
export const MAX_GENERATED_OPTIONS = 5;

/** The always-present open-ended option (empty goal = walk the stack until stopped). */
export const CONTINUE_UNTIL_STOPPED_OPTION = Object.freeze({
  goal: '',
  reasoning: 'No specific goal — walk the stack under the precedence policy and keep making progress until you need the human.',
  size: 'L',
  continueUntilStopped: true
});

const NEXT_RUN_SYSTEM_PROMPT = `You propose candidate goals for the next autonomous "autopilot" run over a software project's task tracker. Autopilot is given a single free-text goal and then drives the backlog toward it. You must reply with a single JSON object and nothing else.

Schema:
{
  "options": [
    {
      "goal":      string,   // a 1-2 short-paragraph instruction the autopilot will be given verbatim — concrete direction, named focus areas, what "done" looks like
      "reasoning": string,   // one line: why this is a sensible next direction, grounded in the provided state
      "size":      string    // a t-shirt size estimate of the work: one of "XS","S","M","L","XL"
    }
  ]
}

Rules:
- Ground EVERY option ONLY in the provided project state (velocity, in-progress work, the top of the execution queue, projects). Never invent tasks or work that isn't evidenced.
- Propose 2 to 4 distinct directions. Make them genuinely different (e.g. finish in-progress work vs. clear a blocker vs. push a milestone), not rewordings of one idea.
- "goal" is paragraph-style prose the autopilot reads as its instruction. Do NOT include the t-shirt size inside the goal text — the size is a separate field.
- "reasoning" is a single sentence under 160 characters.
- "size" must be exactly one of XS, S, M, L, XL.
- Do NOT include a "continue until stopped" / open-ended option — that one is added automatically. Every option you return must have a concrete goal.
- Do not include markdown, explanation, or code fences. Return raw JSON.`;

const PRIORITY_LABELS = { 0: 'none', 1: 'urgent', 2: 'high', 3: 'normal', 4: 'low' };

/**
 * Build the compact, deterministic grounding text the model reasons over. Reuses
 * the roadmap deterministic model (velocity, execution queue, milestones) so the
 * suggester rides existing context machinery rather than inventing data plumbing.
 *
 * @param {Object} model - Output of buildRoadmapModel (velocity, milestones, executionQueue, …).
 * @param {string} [organizationName] - Workspace/org name for orientation.
 * @returns {string}
 */
export function formatNextRunContext(model, organizationName = '') {
  if (!model || typeof model !== 'object') return 'No project data available.';

  const lines = [];
  if (organizationName) lines.push(`Workspace: ${organizationName}`);

  const v = model.velocity || {};
  lines.push(
    `Velocity: ${v.tasksPerWeek ?? 0} tasks/week, ${v.pointsPerWeek ?? 0} points/week (trend: ${v.trend || 'unknown'}).`
  );

  const queue = Array.isArray(model.executionQueue) ? model.executionQueue : [];
  const inProgress = queue.filter(c => c.stateType === 'started');
  if (inProgress.length > 0) {
    lines.push('');
    lines.push(`In progress now (${inProgress.length}):`);
    for (const c of inProgress.slice(0, 8)) lines.push(`- ${formatCard(c)}`);
  } else {
    lines.push('');
    lines.push('In progress now: nothing is currently started.');
  }

  const upNext = queue.filter(c => c.stateType !== 'started').slice(0, 8);
  if (upNext.length > 0) {
    lines.push('');
    lines.push('Top of the execution queue (ranked, next up):');
    for (const c of upNext) lines.push(`- ${formatCard(c)}`);
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

  return lines.join('\n');
}

function formatCard(c) {
  const parts = [];
  if (c.identifier) parts.push(c.identifier);
  parts.push(c.title || '(untitled)');
  const meta = [];
  if (c.projectName) meta.push(c.projectName);
  if (c.priority) meta.push(`priority: ${PRIORITY_LABELS[c.priority] || c.priority}`);
  if (Array.isArray(c.labels) && c.labels.length) meta.push(c.labels.join('/'));
  const metaStr = meta.length ? ` [${meta.join(', ')}]` : '';
  return `${parts.join(' — ')}${metaStr}`;
}

/**
 * Build the messages array for the goal-suggestion LLM call.
 *
 * @param {Object} model - buildRoadmapModel output.
 * @param {string} [organizationName]
 * @returns {Array<{role: string, content: string}>}
 */
export function buildNextRunMessages(model, organizationName = '') {
  return [
    { role: 'system', content: NEXT_RUN_SYSTEM_PROMPT },
    { role: 'user', content: formatNextRunContext(model, organizationName) }
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
 * Parse a goal-suggestion response. Tolerates code fences and prose around the
 * JSON. Returns sanitized concrete options (the continue-until-stopped option is
 * NOT added here — that is the generator's job).
 *
 * @param {string} raw - Raw model text.
 * @returns {Array<{goal: string, reasoning: string, size: string}>}
 */
export function parseGoalSuggestions(raw) {
  if (!raw || typeof raw !== 'string') return [];

  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  if (!text.startsWith('{')) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return [];
    text = text.slice(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  const rawOptions = Array.isArray(parsed.options) ? parsed.options : [];
  return rawOptions
    .map(o => {
      const goal = typeof o?.goal === 'string' ? o.goal.trim() : '';
      if (!goal) return null;
      return {
        goal: goal.slice(0, 1000),
        reasoning: typeof o?.reasoning === 'string' ? o.reasoning.trim() : '',
        size: normalizeSize(o?.size)
      };
    })
    .filter(Boolean)
    .slice(0, MAX_GENERATED_OPTIONS);
}

export { DEFAULT_MODEL as DEFAULT_NEXT_RUN_MODEL };

/**
 * Generate goal options for the next autopilot run.
 *
 * @param {Object} input
 * @param {Array}  input.projects - Raw provider projects.
 * @param {Array}  input.issues   - Raw provider issues.
 * @param {string} [input.organizationName]
 * @param {Object} [options]
 * @param {string} [options.apiKey] - OpenRouter API key.
 * @param {string} [options.model]  - Model ID (defaults to DEFAULT_MODEL).
 * @param {number} [options.maxTokens=900]
 * @returns {Promise<{options: Array, model: string}>} options always ends with the
 *   continue-until-stopped option (empty goal); an LLM failure still yields that
 *   single guaranteed option rather than an error.
 */
export async function generateGoalSuggestions({ projects = [], issues = [], organizationName = '' } = {}, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const roadmapModel = buildRoadmapModel(projects, issues);
  const messages = buildNextRunMessages(roadmapModel, organizationName);

  let buffer = '';
  await streamChat(
    messages,
    { apiKey: options.apiKey, model, maxTokens: options.maxTokens || 900, temperature: 0.4,
      callMeta: { urlKey: options.urlKey || null, feature: 'next-run' } },
    (type, data) => {
      if (type === 'token' && data?.token) buffer += data.token;
    }
  );

  const generated = parseGoalSuggestions(buffer);
  // The open-ended option is ALWAYS present and is the deterministic mapping of
  // "continue until stopped" → empty goal. Appended last so concrete directions
  // lead.
  return { options: [...generated, { ...CONTINUE_UNTIL_STOPPED_OPTION }], model };
}
