// =============================================================================
// AI-generated feedback ticket titles (LIN-643)
//
// When a user submits feedback without an explicit title, the route normally
// falls back to the message's first line truncated to 60 chars — which mangles
// real sentences mid-word. When AI is enabled for the user/workspace, we instead
// ask the LLM for a concise, whole-thought title generated from the feedback
// body. This mirrors the recap/brief pattern: a thin streamChat wrapper that
// buffers tokens and post-processes the result. Failures are the caller's
// concern — it keeps the deterministic fallback.
// =============================================================================

import { DEFAULT_MODEL, streamChat } from './openrouter.js';

// Generous ceiling — the whole point is to escape the 60-char first-line slice.
// We still clamp so a runaway model response can't produce an absurd title.
const MAX_TITLE_LENGTH = 120;

/**
 * Build the messages array for the title-generation LLM call.
 * @param {string} feedbackBody - The raw feedback message text.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildFeedbackTitleMessages(feedbackBody) {
  const body = String(feedbackBody || '').trim();
  return [
    {
      role: 'system',
      content:
        'You write concise, specific issue titles for a software feedback/bug tracker. ' +
        'Given a user feedback message, reply with a single short title (aim for under 80 characters) ' +
        'that captures the core request or problem as a complete thought. ' +
        'Use a plain noun phrase or imperative. Do not wrap it in quotes, do not use markdown, ' +
        'do not add a trailing period, and do not prefix it with "Title:" or "Feedback:". ' +
        'Reply with the title text only.'
    },
    { role: 'user', content: body }
  ];
}

/**
 * Normalise a raw LLM title response into a single clean title line.
 * Tolerates the model wrapping the title in quotes/backticks, adding a
 * "Title:" label, or emitting extra lines.
 * @param {string} raw - Raw text returned by the model.
 * @returns {string} A trimmed, clamped, single-line title (may be empty).
 */
export function parseFeedbackTitle(raw) {
  let title = String(raw || '').trim();
  // First non-empty line only.
  title = (title.split('\n').find(line => line.trim()) || '').trim();
  // Strip a leading "Title:"/"Feedback:" label the model might prepend.
  title = title.replace(/^(?:title|feedback)\s*:\s*/i, '').trim();
  // Strip surrounding quotes/backticks.
  title = title.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
  // Drop a single trailing period (but keep ellipses / "?" / "!").
  title = title.replace(/(?<!\.)\.$/, '').trim();
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH).trim();
  }
  return title;
}

/**
 * Call the LLM to produce a concise title for a feedback submission.
 *
 * @param {string} feedbackBody - The feedback message text.
 * @param {Object} [options]
 * @param {string} [options.apiKey] - OpenRouter API key.
 * @param {string} [options.model] - Model ID (defaults to DEFAULT_MODEL).
 * @param {AbortSignal} [options.signal] - Optional abort signal.
 * @param {Object} [options.callMeta] - Extra LLM-call telemetry metadata.
 * @returns {Promise<string>} The generated title (empty string if the model
 *   returns nothing usable). Throws if the underlying LLM call fails.
 */
export async function generateFeedbackTitle(feedbackBody, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const messages = buildFeedbackTitleMessages(feedbackBody);

  let buffer = '';
  await streamChat(
    messages,
    {
      apiKey: options.apiKey,
      model,
      maxTokens: 60,
      temperature: 0,
      signal: options.signal,
      callMeta: { feature: 'feedback-title', ...(options.callMeta || {}) }
    },
    (type, data) => {
      if (type === 'token' && data?.token) buffer += data.token;
    }
  );

  return parseFeedbackTitle(buffer);
}
