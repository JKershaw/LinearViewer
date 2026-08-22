/**
 * Scan prompt + response handling (LIN-2197 Phase 4 — the third producer into
 * the operator decision queue, LIN-1721).
 *
 * A human-triggered, single-task triage read: does this task carry a decision
 * that genuinely requires the operator right now? Reuses `formatIssueContext`
 * from lib/openrouter.js (the same context recap/brief already feed the
 * model) and composes LIN-1732's Principle 0 rubric as the gate against
 * flooding the operator with "considerations" that aren't real blockers.
 *
 * Three distinguishable outcomes reach the caller:
 *   - 'decision'     — a real, validated ruling was found (persisted).
 *   - 'zero-finding' — the model looked and found nothing (persisted; this is
 *                       the common, non-failure case the whole feature exists
 *                       to make safe to report).
 *   - 'error'         — the response could not be trusted (persists nothing;
 *                       the operator is asked to retry).
 */

import { DEFAULT_MODEL, formatIssueContext, streamChat } from './openrouter.js';
import { extractPrincipleZeroSection } from './prompts/autopilot-manual.js';
import { parseDecision } from './session-telemetry.js';
import { TaskDecisionsStore } from './task-decisions-store.js';

const SCAN_SYSTEM_PROMPT_HEADER = `You triage a single task for the operator: read its description, comments and subtask state, and decide whether it carries a decision that genuinely requires the operator's judgement right now — not any open question, only one a competent agent driving this task could not resolve on its own.

Apply the following rubric (the same one Autopilot uses to decide when to hand back to a human) to judge whether this rises to that bar:`;

const SCAN_SYSTEM_PROMPT_FOOTER = `You must reply with a single JSON object and nothing else. Do not include markdown, explanation, or code fences. Return raw JSON.

Schema:
{
  "has_decision": boolean,
  "question":     string,                                  // required when has_decision is true
  "options":      [{ "id": string, "label": string }],      // a non-empty, well-formed array — required unless free_text is true
  "recommended":  string,                                   // optional: must be one of options[].id
  "free_text":    boolean,                                  // true when the answer isn't a fixed set of options
  "if_unanswered": { }                                      // optional
}

Rules:
- Finding nothing is the normal, common outcome. Most tasks do not need the operator — a first scan that floods the inbox with "considerations" destroys trust in it permanently. Only set has_decision: true for a decision that meets the rubric above.
- When has_decision is true, question is mandatory, and either free_text is true or options is a non-empty array of well-formed { id, label } entries.
- Do not invent a decision not grounded in the provided description, comments, or subtask state.`;

/**
 * Validate a claimed decision payload BEFORE any id is injected and before
 * `parseDecision` is called — the gate that stops a content-free claim
 * (e.g. `{ question: 42, options: "urgent" }`) from silently parsing as a
 * valid-looking, content-free ruling once a server-generated `decision_id`
 * is added on top of it. A non-empty `question` is mandatory; either
 * `free_text: true` or a non-empty, well-formed `options` array is mandatory.
 *
 * @param {*} payload - The raw parsed JSON payload (has_decision already true).
 * @returns {boolean}
 */
export function isClaimedDecisionValid(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const hasQuestion = typeof payload.question === 'string' && payload.question.trim().length > 0;
  const hasUsableOptions = Array.isArray(payload.options) && payload.options.length > 0 &&
    payload.options.every(o => o && typeof o === 'object' && typeof o.id === 'string' && typeof o.label === 'string');
  return hasQuestion && (payload.free_text === true || hasUsableOptions);
}

/**
 * Build the messages array for the scan LLM call. Fails closed: returns
 * `null` when the Principle 0 section can't be extracted, so a caller never
 * builds a scan prompt with the gate silently missing (`extractPrincipleZeroSection`
 * returns null only when the manual's anchor heading is unreadable — e.g. a
 * failed manual read falls back to text with no such heading).
 *
 * `principleZeroSection` is injectable (defaults to a fresh extraction) purely
 * so the fail-closed path is unit-testable without touching the real manual file.
 *
 * @param {Object} issue
 * @param {Object} context
 * @param {Object} [opts]
 * @param {string|null} [opts.principleZeroSection]
 * @returns {Array<{role: string, content: string}>|null}
 */
export function buildScanMessages(issue, context, { principleZeroSection = extractPrincipleZeroSection() } = {}) {
  if (!principleZeroSection) return null;

  const issueContext = formatIssueContext(issue, context);
  const systemPrompt = `${SCAN_SYSTEM_PROMPT_HEADER}\n\n${principleZeroSection}\n\n${SCAN_SYSTEM_PROMPT_FOOTER}`;
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: issueContext }
  ];
}

/**
 * Parse a scan response into one of the three outcomes. Extraction mirrors
 * `parseRecapResponse` exactly (`lib/recap.js`): trim, strip a fenced code
 * block if present, then — if the text doesn't already start with `{` —
 * slice from the first `{` to the LAST `}` (not to end-of-string) before
 * parsing. A parse failure after that is 'error', never 'zero-finding'.
 *
 * Once parsed: `has_decision !== true` (missing, `false`, or non-boolean) is
 * 'zero-finding' — fail-closed in the OTHER direction, so a malformed
 * truthy-but-not-`true` value never gets treated as a real ruling. When
 * `has_decision === true`, the claimed decision must pass
 * `isClaimedDecisionValid` BEFORE a `decision_id` is injected and
 * `parseDecision` (the landed shape/allow-list gate, not reimplemented here)
 * is called — see its docstring for why ordering matters.
 *
 * @param {string} raw - Raw text returned by the model.
 * @param {Object} ids
 * @param {string} ids.issueId - canonical issue UUID (for the injected decision_id)
 * @param {string} ids.inputHash - hashContext digest of the scanned content
 * @returns {{outcome: 'decision'|'zero-finding'|'error', decision: Object|null}}
 */
export function parseScanResponse(raw, { issueId, inputHash } = {}) {
  if (!raw || typeof raw !== 'string') return { outcome: 'error', decision: null };

  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  if (!text.startsWith('{')) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return { outcome: 'error', decision: null };
    }
    text = text.slice(firstBrace, lastBrace + 1);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { outcome: 'error', decision: null };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { outcome: 'error', decision: null };
  }

  if (payload.has_decision !== true) {
    return { outcome: 'zero-finding', decision: null };
  }

  if (!isClaimedDecisionValid(payload)) {
    return { outcome: 'error', decision: null };
  }

  // Same formula the store uses for its own document _id, so a persisted
  // (non-zero-finding) scan's decision_id and its store row id always agree.
  const decisionId = TaskDecisionsStore.buildId(issueId, inputHash);
  const decision = parseDecision(JSON.stringify({ ...payload, decision_id: decisionId }));
  // Defensive only: isClaimedDecisionValid already guarantees a non-empty
  // question and decisionId is a valid string, so parseDecision cannot
  // actually return null here — kept anyway per the "never throws, fail
  // safe" discipline elsewhere in this codebase, not the load-bearing gate.
  if (!decision) {
    return { outcome: 'error', decision: null };
  }

  return { outcome: 'decision', decision };
}

export { DEFAULT_MODEL as DEFAULT_SCAN_MODEL };

/**
 * Call the LLM to triage a single issue for an operator-worthy decision.
 *
 * @param {Object} issue - Issue object.
 * @param {Object} context - Recommendation context.
 * @param {Object} options
 * @param {string} options.issueId - canonical issue UUID
 * @param {string} options.inputHash - hashContext digest of the scanned content
 * @param {string} [options.apiKey]
 * @param {string} [options.model]
 * @param {Object} [options.callMeta]
 * @returns {Promise<{outcome: 'decision'|'zero-finding'|'error'|'fail-closed', decision: Object|null, model: string|null}>}
 */
export async function generateScan(issue, context, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const messages = buildScanMessages(issue, context);
  if (!messages) {
    // Fail closed: never call the model without the Principle 0 gate composed in.
    return { outcome: 'fail-closed', decision: null, model: null };
  }

  let buffer = '';
  await streamChat(
    messages,
    {
      apiKey: options.apiKey, model, maxTokens: 1000, temperature: 0,
      callMeta: { feature: 'scan', issueIdentifier: issue?.identifier || null, ...(options.callMeta || {}) }
    },
    (type, data) => {
      if (type === 'token' && data?.token) buffer += data.token;
    }
  );

  const result = parseScanResponse(buffer, { issueId: options.issueId, inputHash: options.inputHash });
  return { ...result, model };
}
