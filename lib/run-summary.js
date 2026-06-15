/**
 * Run summary prompt + response handling (LIN-509).
 *
 * A "run" is a derived Loop record (lib/pipeline-loops.js) — one dispatch
 * iteration of an autopilot task. This module turns a single Loop into a short,
 * structured, on-demand summary ("click a button → quick overview"). It mirrors
 * lib/recap.js exactly in shape, but its input is the run (prompt/stage/state/
 * foremanSummary/feedback), NOT the Linear issue context.
 *
 * Deliberately short: a one-line outcome + 2-3 "what happened" bullets, plus
 * optional blockers/next. The small `max_tokens` budget enforces brevity.
 */

import { DEFAULT_MODEL, streamChat } from './openrouter.js';

const RUN_SUMMARY_SYSTEM_PROMPT = `You summarise a single autopilot run (one dispatched iteration of a software task) into a short, factual overview. You must reply with a single JSON object and nothing else.

Schema:
{
  "outcome":      string,          // one line: what this run achieved or where it ended up
  "whatHappened": [string],        // 2-3 short bullets of the key things that happened
  "blockers":     [string],        // optional: anything that blocked or stalled the run
  "next":         string           // optional: the natural next step, one line ("" if none)
}

Rules:
- Be concrete and grounded ONLY in the provided run data (prompt, stage, agent state, agent summary, consumer feedback). Never invent work that isn't evidenced.
- "outcome" is a single sentence under 140 characters.
- "whatHappened" has at most 3 bullets, each under 140 characters. Prefer fewer, higher-signal bullets.
- "blockers" is an empty array when nothing blocked the run.
- "next" is "" when there is no obvious next step.
- Do not include markdown, explanation, or code fences. Return raw JSON.`;

const EMPTY_SUMMARY = { outcome: '', whatHappened: [], blockers: [], next: '' };

/**
 * Format a Loop record into the plain-text context the model summarises.
 *
 * @param {Object} loop - A Loop record from getLoopsForWorkspace/getLoopsForIssue.
 * @returns {string}
 */
export function formatRunContext(loop) {
  if (!loop || typeof loop !== 'object') return 'No run data available.';

  const lines = [];
  lines.push(`Task: ${loop.issueIdentifier || 'unknown'}${loop.issueTitle ? ` — ${loop.issueTitle}` : ''}`);
  if (loop.iteration != null) lines.push(`Iteration: ${loop.iteration}`);
  if (loop.promptName) lines.push(`Prompt: ${loop.promptName}`);
  if (loop.stage) lines.push(`Stage: ${loop.stage}`);
  if (loop.agentState) lines.push(`Agent state: ${loop.agentState}`);
  if (loop.foremanAction) lines.push(`Foreman action: ${loop.foremanAction}`);
  if (loop.foremanStatus) lines.push(`Foreman status: ${loop.foremanStatus}`);
  if (loop.dispatchedAt) lines.push(`Dispatched: ${loop.dispatchedAt}`);
  if (loop.resolvedAt) lines.push(`Resolved: ${loop.resolvedAt}`);

  if (loop.foremanSummary) {
    lines.push('');
    lines.push('Agent summary:');
    lines.push(String(loop.foremanSummary).slice(0, 2000));
  }

  const feedback = Array.isArray(loop.feedback) ? loop.feedback : [];
  if (feedback.length > 0) {
    lines.push('');
    lines.push('Consumer feedback (most recent last):');
    for (const fb of feedback.slice(-8)) {
      const msg = typeof fb === 'string' ? fb : (fb?.message || '');
      if (msg) lines.push(`- ${String(msg).slice(0, 600)}`);
    }
  }

  if (loop.promptText) {
    lines.push('');
    lines.push('Prompt given to the agent (truncated):');
    lines.push(String(loop.promptText).slice(0, 1500));
  }

  return lines.join('\n');
}

/**
 * Build the messages array for the run-summary LLM call.
 *
 * @param {Object} loop - A Loop record.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildRunSummaryMessages(loop) {
  return [
    { role: 'system', content: RUN_SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: formatRunContext(loop) }
  ];
}

/**
 * Parse a run-summary response from the model. Tolerates markdown code fences and
 * leading/trailing prose around the JSON payload.
 *
 * @param {string} raw - Raw text returned by the model.
 * @returns {{outcome: string, whatHappened: Array<string>, blockers: Array<string>, next: string}}
 */
export function parseRunSummaryResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    return { ...EMPTY_SUMMARY };
  }

  let text = raw.trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  if (!text.startsWith('{')) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return { ...EMPTY_SUMMARY };
    }
    text = text.slice(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...EMPTY_SUMMARY };
  }

  return {
    outcome: typeof parsed.outcome === 'string' ? parsed.outcome : '',
    whatHappened: sanitizeStringList(parsed.whatHappened).slice(0, 3),
    blockers: sanitizeStringList(parsed.blockers),
    next: typeof parsed.next === 'string' ? parsed.next : ''
  };
}

function sanitizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
}

export { DEFAULT_MODEL as DEFAULT_RUN_SUMMARY_MODEL };

/**
 * Call the LLM to produce a short summary for a single run (Loop).
 *
 * @param {Object} loop - A Loop record.
 * @param {Object} [options]
 * @param {string} [options.apiKey] - OpenRouter API key.
 * @param {string} [options.model] - Model ID (defaults to DEFAULT_MODEL).
 * @param {number} [options.maxTokens=400] - Output token budget (kept small to enforce brevity).
 * @returns {Promise<{summary: Object, model: string}>}
 */
export async function generateRunSummary(loop, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const messages = buildRunSummaryMessages(loop);

  let buffer = '';
  await streamChat(
    messages,
    { apiKey: options.apiKey, model, maxTokens: options.maxTokens || 400, temperature: 0 },
    (type, data) => {
      if (type === 'token' && data?.token) buffer += data.token;
    }
  );

  return { summary: parseRunSummaryResponse(buffer), model };
}
