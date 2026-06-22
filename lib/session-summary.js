/**
 * Session summary prompt + response handling (LIN-592).
 *
 * A "session" is an autopilot orchestrator dispatch plus every worker dispatch it
 * spawned across the tasks an epic descent / breakdown spin-off touches
 * (lib/pipeline-loops.js → getSessionsForWorkspace, LIN-591). This module rolls a
 * whole multi-task session into one line: a single-sentence outcome plus a
 * single-sentence, present-tense status line and a few highlights.
 *
 * It is the third artifact in the lineage recap → run-summary (LIN-509) →
 * session-summary, and mirrors lib/run-summary.js exactly in shape. Its input is
 * the session (tasksTouched + autopilot narration + the ordered child
 * run-summary outcomes), NOT a single Loop and NOT the Linear issue context.
 *
 * Cost contract (LIN-592): ONE session-level LLM call — never one call per child.
 * The child outcomes are the already-cached run-summary.outcome strings, passed
 * in by the caller; children without a cached summary fall back to a short
 * formatRunContext excerpt rather than forcing a fresh per-child generation.
 */

import { DEFAULT_MODEL, streamChat } from './openrouter.js';
import { formatRunContext } from './run-summary.js';

const SESSION_SUMMARY_SYSTEM_PROMPT = `You summarise a whole autopilot session (one orchestrator run plus the worker runs it spawned across one or more tasks) into a short, factual rollup. You must reply with a single JSON object and nothing else.

Schema:
{
  "outcome":    string,    // one sentence: what the session as a whole achieved or where it ended up
  "statusLine": string,    // one sentence, PRESENT TENSE: the session's current state in a single line
  "highlights": [string]   // 2-4 short bullets of the most significant things across the session
}

Rules:
- Be concrete and grounded ONLY in the provided session data (tasks touched, orchestrator narration, the ordered child-run outcomes). Never invent work that isn't evidenced.
- "outcome" is a single past/perfect-tense sentence under 160 characters describing the session as a whole, not any single task.
- "statusLine" is a single PRESENT-TENSE sentence under 140 characters (e.g. "Shipping the auth refactor across three tasks", "Blocked on a failing migration").
- "highlights" has at most 4 bullets, each under 140 characters. Prefer fewer, higher-signal bullets. Empty array when there is nothing notable.
- Do not include markdown, explanation, or code fences. Return raw JSON.`;

const EMPTY_SUMMARY = { outcome: '', statusLine: '', highlights: [] };

/**
 * Identify the anchor (orchestrator) loop of a session: the kind:'autopilot' loop
 * whose loopId is the sessionId. Null for anchorless/orphan sessions.
 *
 * @param {Object} session - A session record from getSessionsForWorkspace.
 * @returns {Object|null}
 */
export function findAnchorLoop(session) {
  if (!session || !Array.isArray(session.loops)) return null;
  return session.loops.find(
    l => l && l.kind === 'autopilot' && String(l.loopId) === String(session.sessionId)
  ) || null;
}

/**
 * The session's worker loops — every loop except the anchor orchestrator.
 *
 * @param {Object} session
 * @returns {Array<Object>}
 */
export function childLoops(session) {
  if (!session || !Array.isArray(session.loops)) return [];
  const anchor = findAnchorLoop(session);
  return session.loops.filter(l => l && l !== anchor);
}

/**
 * Format a session record into the plain-text context the model summarises.
 *
 * @param {Object} session - A session record from getSessionsForWorkspace.
 * @param {Object} [childOutcomes={}] - Map loopId → cached run-summary.outcome.
 *   Children present here contribute their cheap cached outcome; children absent
 *   fall back to a short formatRunContext excerpt (no extra generation).
 * @returns {string}
 */
export function formatSessionContext(session, childOutcomes = {}) {
  if (!session || typeof session !== 'object') return 'No session data available.';

  const lines = [];
  const tasks = Array.isArray(session.tasksTouched) ? session.tasksTouched : [];
  lines.push(`Session: ${session.sessionId || 'unknown'}`);
  if (session.seedIssue) lines.push(`Seed task: ${session.seedIssue}`);
  lines.push(`Tasks touched (${tasks.length}): ${tasks.length ? tasks.join(', ') : 'none recorded'}`);
  if (session.dispatchedAt) lines.push(`Dispatched: ${session.dispatchedAt}`);

  const anchor = findAnchorLoop(session);
  if (anchor && anchor.agentSummary) {
    lines.push('');
    lines.push('Orchestrator narration:');
    lines.push(String(anchor.agentSummary).slice(0, 2000));
  }

  const children = childLoops(session);
  if (children.length > 0) {
    lines.push('');
    lines.push('Child runs (in order):');
    for (const loop of children) {
      const cached = childOutcomes[loop.loopId];
      const label = `${loop.issueIdentifier || 'unknown'}${loop.stage ? ` @ ${loop.stage}` : ''}`;
      if (cached) {
        lines.push(`- ${label}: ${String(cached).slice(0, 300)}`);
      } else {
        // No cached run-summary for this child — fall back to its own agent
        // summary, else a short run-context excerpt, rather than forcing a fresh
        // per-child generation (the one-LLM-call cost contract).
        const excerpt = loop.agentSummary
          ? String(loop.agentSummary).slice(0, 300)
          : formatRunContext(loop).split('\n').slice(0, 4).join(' / ').slice(0, 300);
        lines.push(`- ${label}: ${excerpt}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Build the messages array for the session-summary LLM call.
 *
 * @param {Object} session - A session record.
 * @param {Object} [childOutcomes={}] - Map loopId → cached run-summary.outcome.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildSessionSummaryMessages(session, childOutcomes = {}) {
  return [
    { role: 'system', content: SESSION_SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: formatSessionContext(session, childOutcomes) }
  ];
}

/**
 * Parse a session-summary response from the model. Tolerates markdown code fences
 * and leading/trailing prose around the JSON payload.
 *
 * @param {string} raw - Raw text returned by the model.
 * @returns {{outcome: string, statusLine: string, highlights: Array<string>}}
 */
export function parseSessionSummaryResponse(raw) {
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
    statusLine: typeof parsed.statusLine === 'string' ? parsed.statusLine : '',
    highlights: sanitizeStringList(parsed.highlights).slice(0, 4)
  };
}

function sanitizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
}

export { DEFAULT_MODEL as DEFAULT_SESSION_SUMMARY_MODEL };

/**
 * Call the LLM to produce a short rollup summary for a whole session.
 *
 * @param {Object} session - A session record from getSessionsForWorkspace.
 * @param {Object} [options]
 * @param {string} [options.apiKey] - OpenRouter API key.
 * @param {string} [options.model] - Model ID (defaults to DEFAULT_MODEL).
 * @param {number} [options.maxTokens=400] - Output token budget (kept small to enforce brevity).
 * @param {Object} [options.childOutcomes={}] - Map loopId → cached run-summary.outcome.
 * @returns {Promise<{summary: Object, model: string}>}
 */
export async function generateSessionSummary(session, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const messages = buildSessionSummaryMessages(session, options.childOutcomes || {});

  let buffer = '';
  await streamChat(
    messages,
    { apiKey: options.apiKey, model, maxTokens: options.maxTokens || 400, temperature: 0 },
    (type, data) => {
      if (type === 'token' && data?.token) buffer += data.token;
    }
  );

  return { summary: parseSessionSummaryResponse(buffer), model };
}
