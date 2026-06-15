/**
 * Brief prompt + response handling (current-state task brief).
 *
 * A "brief" is the smallest artifact that lets an agent start and finish a
 * task correctly without reading the raw history. As tasks age their
 * description grows, drifts, and accumulates spikes, pivots, and follow-on
 * work; the brief distils that into a present-tense spec plus a short
 * changelog of the load-bearing turns.
 *
 * Reuses `formatIssueContext` from lib/openrouter.js to feed the same Linear
 * context the prompt generator and recap use. Unlike recap (structured JSON),
 * the brief is Markdown with four fixed sections — the structure forces
 * content decisions while staying robust for long, possibly-truncated prose,
 * and the sections can be split back out deterministically later.
 */

import { DEFAULT_MODEL, formatIssueContext, streamChat } from './openrouter.js';

const BRIEF_SYSTEM_PROMPT = `You compress a Linear task's accumulated description, comments, and subtask state into a brief: the smallest artifact that lets an agent start and finish the task correctly without reading the raw history.

Decision rule: include something only if leaving it out would make a competent agent err — repeat a discarded approach, break a constraint, or misjudge scope. Anything that fails that test is noise; cut it.

Output: GitHub-flavoured Markdown with exactly these four sections, in this order, each introduced by its heading exactly as written and used nowhere else in the text:

## Current
The live spec in the present tense: what the task is now and what work remains. Supersede stale original wording rather than layering on top of it — write it as if framed fresh today. Be self-sufficient: a competent agent executes from this alone, with no "see the thread above" and no jargon left unexplained. State completion honestly: treat work as remaining unless the source clearly shows it done; never assert completion the source does not support.

## Constraints
Durable rules the agent must respect — including the rule a rejected approach revealed ("must not use X because Y"). One per line as a \`- \` bullet. State each constraint once, here; the changelog points at it rather than restating it.

## Open questions
Unresolved items, contradictions in the source (surface them — do not smooth them into false tidiness), and any step whose completion is unknown AND consequential — it has side effects such as migrations, sent mail, or external calls, where silently redoing it would be destructive. One per line as a \`- \` bullet.

## Changelog
The meaningful turns that got the task here — changes in direction or understanding, not edits. A handful of lines, not a transcript. One per line, exactly: \`- **<the turn>** — <why it mattered>\`. The reason is required and should bias toward "don't redo this / don't break that"; if a turn has no load-bearing reason, omit it. Cut status pings, restatements, and corrections-of-corrections.

Sources and precedence:
- The description is the seed; comments and subtask states are amendments. On conflict, the most recent and specific signal wins — a comment saying the approach changed overrides the original description. Do not faithfully reproduce stale description text that later signals contradict.
- Mine comments and subtask states for decisions, constraints, and open questions; do not narrate them.

Faithfulness:
- Derive only from the provided source. Where it is ambiguous or self-contradictory, name the gap as an open question rather than inventing an answer — a confidently wrong brief is worse than one that flags what it does not know.

Form:
- Be denser and shorter than the history it replaces; that compression is the point. Do not pad.
- If a section has no content, write a single line \`- _None._\` so all four sections are always present.
- Respond with only the Markdown, beginning with \`## Current\`. No preamble, no closing remarks, no code fences.`;

/**
 * Build the messages array for the brief LLM call.
 *
 * @param {Object} issue - The issue object (identifier, title, description, state, labels).
 * @param {Object} context - Context with parent, siblings, project, children, comments, focusedChild.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildBriefMessages(issue, context) {
  const issueContext = formatIssueContext(issue, context);
  return [
    { role: 'system', content: BRIEF_SYSTEM_PROMPT },
    { role: 'user', content: issueContext }
  ];
}

/**
 * Clean a brief response from the model into bare Markdown.
 *
 * Tolerates an outer code fence wrapping the whole response and a short
 * preamble before the first heading. Does not attempt to parse the body —
 * the four sections are recovered (when needed) by splitting on their fixed
 * headings, not here.
 *
 * @param {string} raw - Raw text returned by the model.
 * @returns {string} Cleaned Markdown, or '' when there is nothing usable.
 */
export function cleanBriefResponse(raw) {
  if (!raw || typeof raw !== 'string') return '';

  let text = raw.trim();

  // Strip an outer code fence only when the whole response is fenced.
  if (text.startsWith('```')) {
    const fenced = text.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
    if (fenced) text = fenced[1].trim();
  }

  // Drop any preamble before the first Markdown heading so the section
  // contract holds and header-splitting stays robust.
  const headingIdx = text.search(/^##\s/m);
  if (headingIdx > 0) text = text.slice(headingIdx).trim();

  return text;
}

export { DEFAULT_MODEL as DEFAULT_BRIEF_MODEL };

/**
 * Call the LLM to produce a brief for the given issue + context.
 *
 * @param {Object} issue - Issue object.
 * @param {Object} context - Recommendation context.
 * @param {Object} [options]
 * @param {string} [options.apiKey] - OpenRouter API key.
 * @param {string} [options.model] - Model ID (defaults to Haiku).
 * @returns {Promise<{brief: string, model: string}>}
 */
export async function generateBrief(issue, context, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const messages = buildBriefMessages(issue, context);

  let buffer = '';
  await streamChat(
    messages,
    {
      apiKey: options.apiKey, model, maxTokens: 3000, temperature: 0,
      callMeta: { feature: 'brief', issueIdentifier: issue?.identifier || null, ...(options.callMeta || {}) }
    },
    (type, data) => {
      if (type === 'token' && data?.token) buffer += data.token;
    }
  );

  return { brief: cleanBriefResponse(buffer), model };
}
