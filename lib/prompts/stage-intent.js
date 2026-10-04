/** The scope lines code adds to every stage prompt (LIN-3291, LIN-3299): `## Scope and Authority`. */

const CAUSE = 'When this task fixes something, its cause is part of the work, wherever it lives.';
const ASK = 'Only a change the team would need to hear about before it happens goes to the human, as one clear question with your recommendation.';
// Stages that choose or build; stages that judge or investigate, which change no code.
const DECIDE = `${CAUSE} Engineering choices, fixing at the cause and refactoring included, are yours; state each with its reason. ${ASK}`;
const JUDGE = `${CAUSE} Judge the work, or propose the fix, against that cause rather than the ticket's wording. ${ASK}`;
const READING = 'This is a reading pass. If the ticket is aimed at a symptom of something deeper, say so.';

/**
 * LIN-3291's scope and authority per stage. A floor the stage's process already states is
 * said there once (LIN-3299).
 */
export const STAGE_INTENT = {
  research: [DECIDE, 'A refactor that removes the cause of what this task fixes, or that this task calls, counts as necessary.'],
  scoping: [DECIDE],
  design: [DECIDE],
  spike: [DECIDE],
  plan: [DECIDE, 'Default to closing the gap at the cause: a ticket number records a trade-off, it does not pay for routing around it.'],
  'plan-review': [JUDGE, 'Verify, do not redesign: another reasonable approach is not a finding; a plan aimed at a symptom of a cause this task could fix is.'],
  breakdown: [DECIDE, 'A subtask may change course at the cause where the code shows the plan is wrong, saying so.'],
  implementation: [DECIDE],
  bug: [JUDGE, 'Propose the fix for every instance of its class; the next stage builds it.'],
  blocked: [DECIDE],
  triage: ['This is filing, not working the problem: leave the reporter\'s description as written.'],
  context: [READING],
  'look-into': [READING],
  review: [JUDGE, 'Green CI never settles a ledger item: CI is why it is on the list.'],
  'close-out': [JUDGE],
  'retrospective-audit': [JUDGE],
  retro: [READING]
};

export function formatStageIntent(kind) {
  const lines = Object.hasOwn(STAGE_INTENT, kind) ? STAGE_INTENT[kind] : null;
  return lines ? `\n\n## Scope and Authority\n\n${lines.map(l => `- ${l}`).join('\n')}` : '';
}

/**
 * `text` with the stage's Scope and Authority at the end of its `## Goal` (after the lead,
 * before the process), or at its end when it has none. finishStagePrompt adds it here, once.
 */
export function withStageIntent(text, kind) {
  const block = formatStageIntent(kind);
  if (!block) return text;
  const goal = /^## Goal\b[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/m.exec(text);
  if (!goal) return text + block;
  const at = goal.index + goal[0].length;
  const tail = text.slice(at);
  return `${text.slice(0, at).trimEnd()}${block}${tail ? `\n\n${tail}` : ''}`;
}
