/**
 * Recap prompt + response handling.
 *
 * Reuses `formatIssueContext` from lib/openrouter.js to feed the same
 * Linear context the prompt generator uses, and asks the model (Haiku by
 * default) to return a structured JSON recap of what is done, what is
 * pending, and what has deviated.
 */

import { DEFAULT_MODEL, formatIssueContext, streamChat } from './openrouter.js';

const RECAP_SYSTEM_PROMPT = `You analyse a Linear task and produce a short, factual recap of progress so far. You must reply with a single JSON object and nothing else.

Schema:
{
  "done":       [{ "item": string, "evidence": string }],
  "pending":    [{ "item": string, "predicted": string }],
  "deviations": [{ "item": string, "type": string, "evidence": string }]
}

Rules:
- "done" entries describe work that has actually been completed, with one-line evidence quoted or paraphrased from the description, comments, or subtask states.
- "pending" entries describe work that still needs to happen, with a short predicted next step.
- "deviations" capture scope changes, new blockers, surfaced bugs, or unexpected findings discovered during the work. "type" is a short tag such as "blocker", "scope-change", "bug", or "finding".
- Keep each "item" under 120 characters. Keep each "evidence" or "predicted" under 200 characters.
- Return an empty array for any section with no entries. Never invent items not grounded in the provided context.
- Do not include markdown, explanation, or code fences. Return raw JSON.`;

/**
 * Build the messages array for the recap LLM call.
 *
 * @param {Object} issue - The issue object (identifier, title, description, state, labels).
 * @param {Object} context - Context with parent, siblings, project, children, comments, focusedChild.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildRecapMessages(issue, context) {
  const issueContext = formatIssueContext(issue, context);
  return [
    { role: 'system', content: RECAP_SYSTEM_PROMPT },
    { role: 'user', content: issueContext }
  ];
}

const EMPTY_RECAP = { done: [], pending: [], deviations: [] };

/**
 * Parse a recap response from the model. Tolerates markdown code fences and
 * leading/trailing prose around the JSON payload.
 *
 * @param {string} raw - Raw text returned by the model.
 * @returns {{done: Array, pending: Array, deviations: Array}}
 */
export function parseRecapResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    return { ...EMPTY_RECAP };
  }

  let text = raw.trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  if (!text.startsWith('{')) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return { ...EMPTY_RECAP };
    }
    text = text.slice(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...EMPTY_RECAP };
  }

  return {
    done: sanitizeList(parsed.done, ['item', 'evidence']),
    pending: sanitizeList(parsed.pending, ['item', 'predicted']),
    deviations: sanitizeList(parsed.deviations, ['item', 'type', 'evidence'])
  };
}

function sanitizeList(value, fields) {
  if (!Array.isArray(value)) return [];
  return value
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const out = {};
      for (const f of fields) {
        const v = entry[f];
        out[f] = typeof v === 'string' ? v : '';
      }
      if (!out.item) return null;
      return out;
    })
    .filter(Boolean);
}

export { DEFAULT_MODEL as DEFAULT_RECAP_MODEL };

/**
 * Call the LLM to produce a recap for the given issue + context.
 *
 * @param {Object} issue - Issue object.
 * @param {Object} context - Recommendation context.
 * @param {Object} [options]
 * @param {string} [options.apiKey] - OpenRouter API key.
 * @param {string} [options.model] - Model ID (defaults to Haiku).
 * @returns {Promise<{recap: Object, model: string}>}
 */
export async function generateRecap(issue, context, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const messages = buildRecapMessages(issue, context);

  let buffer = '';
  await streamChat(
    messages,
    { apiKey: options.apiKey, model, maxTokens: 1500, temperature: 0 },
    (type, data) => {
      if (type === 'token' && data?.token) buffer += data.token;
    }
  );

  return { recap: parseRecapResponse(buffer), model };
}
