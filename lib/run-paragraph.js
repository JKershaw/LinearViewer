/**
 * Run paragraph prompt + generation (LIN-3253, S3 of LIN-2948).
 *
 * One short, plain-language paragraph that says how a run is going: the current
 * state while it is still running, or the feature and how the run went once it
 * has finished. The paragraph is written ONLY from the `buildRunView` output
 * (steps, progress, next, and any outcome/evidence the view carries), so it can
 * never invent work that isn't evidenced.
 *
 * Cost contract: exactly ONE cheap-tier model call, the same `streamChat` +
 * default-tier path the session-summary generator uses. This module never makes
 * an upstream read of any kind — in particular it does not fetch PR state; if
 * the run view already carries a PR fact it may use it, otherwise it stays
 * silent about PRs.
 *
 * `inputHash` is the materializer hook's gate key: a deterministic digest over
 * the title and the set of ENDED loops (`terminalStatus != null`, failures
 * included) — and nothing else. A loop starting — including a retry or follow-up
 * on an already-ended step — a `progress.label`/`next` change or a
 * wait-for-answer toggle must not move it, so the hook regenerates once per loop
 * end (plus the terminal close-out), not on every materialization. The volatile
 * time fields are excluded for the same reason.
 */

import crypto from 'crypto';
import { DEFAULT_MODEL, streamChat } from './openrouter.js';
import { stableStringify } from './run-summary-cache.js';

const RUN_PARAGRAPH_SYSTEM_PROMPT = `You write ONE short, plain-language paragraph (2-4 sentences) describing how a software run is going. Reply with the paragraph text only — no markdown, no headings, no JSON, no code fences.

Rules:
- Use ONLY the facts in the run view below. Never invent work, tasks, files, pull requests or outcomes that are not present.
- If the run is still going, describe its current state: what has finished, what is under way, and what is next.
- If the run has finished, describe what the feature was and how the run went.
- If a fact is missing, say less. Do not guess or fill gaps. There is no obligation to mention a pull request unless the run view states one.
- Plain words a person would use. Never print a model identifier or a price.
- Keep it under 90 words.`;

/**
 * Project the run view down to exactly the facts the paragraph depends on.
 * Deliberately excludes `time` (its clock moves every call) and `cost` (the
 * paragraph does not spend money), so the hash changes only when the run's
 * actual progress/outcome does.
 *
 * @param {Object} runView - the `buildRunView` output.
 * @returns {Object}
 */
function paragraphFacts(runView) {
  const v = runView && typeof runView === 'object' ? runView : {};
  const steps = Array.isArray(v.steps) ? v.steps : [];
  return {
    runId: v.runId || null,
    title: v.title || null,
    progress: v.progress ? (v.progress.label || null) : null,
    next: v.next || null,
    waiting: !!(v.waiting && v.waiting.active),
    steps: steps.map(s => ({
      kind: s?.kind || null,
      status: s?.status || null,
      finished: !!s?.finished,
      tier: s?.tier || null,
      iteration: s?.iteration ?? null,
    })),
    outcome: typeof v.outcome === 'string' ? v.outcome : null,
    evidence: Array.isArray(v.evidence) ? v.evidence : null,
  };
}

/** Render one optional evidence item (a string, or a small object) as a line. */
function formatEvidence(item) {
  if (typeof item === 'string') return item.slice(0, 300);
  if (item && typeof item === 'object') return stableStringify(item).slice(0, 300);
  return String(item).slice(0, 300);
}

/**
 * Format the run view into the plain-text context the model writes from.
 *
 * @param {Object} runView - the `buildRunView` output.
 * @returns {string}
 */
export function formatRunViewContext(runView) {
  const facts = paragraphFacts(runView);
  const lines = [];

  lines.push(`Run: ${facts.runId || 'unknown'}`);
  if (facts.title) lines.push(`Task: ${facts.title}`);
  if (facts.progress) lines.push(`Progress: ${facts.progress}`);
  if (facts.next) lines.push(`Next: ${facts.next}`);
  if (facts.waiting) lines.push('Waiting on the person.');

  if (facts.steps.length > 0) {
    lines.push('');
    lines.push('Steps:');
    for (const s of facts.steps) {
      const status = s.finished ? 'done' : (s.status || 'running');
      const bits = [s.kind || 'run', status];
      if (s.tier && s.tier !== 'not reported') bits.push(`tier ${s.tier}`);
      if (s.iteration != null) bits.push(`attempt ${s.iteration}`);
      lines.push(`- ${bits.join(' · ')}`);
    }
  } else {
    lines.push('');
    lines.push('No steps recorded yet.');
  }

  if (facts.outcome) {
    lines.push('');
    lines.push('Outcome:');
    lines.push(facts.outcome.slice(0, 1000));
  }

  if (facts.evidence && facts.evidence.length > 0) {
    lines.push('');
    lines.push('Evidence:');
    for (const item of facts.evidence) lines.push(`- ${formatEvidence(item)}`);
  }

  return lines.join('\n');
}

/**
 * Build the messages array for the run-paragraph model call.
 *
 * @param {Object} runView - the `buildRunView` output.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildRunParagraphMessages(runView) {
  return [
    { role: 'system', content: RUN_PARAGRAPH_SYSTEM_PROMPT },
    { role: 'user', content: formatRunViewContext(runView) }
  ];
}

/**
 * The gate key's facts: the title and the set of ENDED loops only. A loop is
 * ended when `terminalStatus != null` (so a failure counts as a loop end);
 * in-flight loops, `progress.label`/`next`, and the waiting toggle are excluded
 * on purpose — see the module header.
 *
 * The gate reads the ended LOOPS of every step, not each step's lineage lead. A
 * lead is the active (latest non-superseded) loop, so a retry or follow-up that
 * starts on an already-ended step resets that lead's `terminalStatus` to null
 * and would move the hash on a mere start. An ended loop never leaves the set,
 * so the hash only moves when a loop actually ends.
 *
 * @param {Object} runView - the `buildRunView` output.
 * @returns {{title: string|null, loops: Array<{loopId: *, kind: string|null, terminalStatus: *}>}}
 */
function gateFacts(runView) {
  const v = runView && typeof runView === 'object' ? runView : {};
  const steps = Array.isArray(v.steps) ? v.steps : [];
  return {
    title: v.title || null,
    loops: steps.flatMap(step =>
      (Array.isArray(step?.loops) ? step.loops : [])
        .filter(loop => loop && loop.terminalStatus != null)
        .map(loop => ({
          loopId: loop.loopId ?? null,
          kind: loop.kind || null,
          terminalStatus: loop.terminalStatus,
        }))
    ),
  };
}

/**
 * Deterministic digest of the run's gate facts (title + ended steps only).
 *
 * @param {Object} runView - the `buildRunView` output.
 * @returns {string} SHA-256 hex digest.
 */
export function inputHash(runView) {
  return crypto.createHash('sha256').update(stableStringify(gateFacts(runView))).digest('hex');
}

/**
 * Clean a raw model response into a plain paragraph: drop code fences, collapse
 * whitespace, cap the length. Empty input yields an empty paragraph.
 *
 * @param {string} raw
 * @returns {string}
 */
export function cleanRunParagraph(raw) {
  if (typeof raw !== 'string') return '';
  let text = raw.trim();
  const fence = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  return text.replace(/\s+/g, ' ').trim().slice(0, 600);
}

/**
 * Generate the run paragraph with ONE cheap-tier model call.
 *
 * @param {Object} runView - the `buildRunView` output.
 * @param {Object} [options]
 * @param {string} [options.apiKey] - OpenRouter API key.
 * @param {Function} [options.chat=streamChat] - The model call seam (stubbed in
 *   tests); defaults to the shared `streamChat` cheap-tier path.
 * @returns {Promise<{paragraph: string, model: string}>}
 */
export async function generateRunParagraph(runView, { apiKey, chat = streamChat } = {}) {
  const messages = buildRunParagraphMessages(runView);

  let buffer = '';
  await chat(
    messages,
    { apiKey, model: DEFAULT_MODEL, maxTokens: 220, temperature: 0 },
    (type, data) => {
      if (type === 'token' && data?.token) buffer += data.token;
    }
  );

  return { paragraph: cleanRunParagraph(buffer), model: DEFAULT_MODEL };
}
