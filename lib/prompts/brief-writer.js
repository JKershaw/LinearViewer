/** The brief writer's prompt and the scope lines code adds (LIN-3293); it writes the Goal's lead only (LIN-3299). */

/** Near-pure process: a written lead adds little, so the writer is not called and the template ships. */
export const PROCESS_ONLY = ['breakdown', 'close-out', 'context', 'look-into', 'triage'];

const CAUSE = 'When this task fixes something, its cause is part of the work, wherever it lives.';
const ASK = 'Only a change the team would need to hear about before it happens goes to the human, as one clear question with your recommendation.';
// Stages that choose or build; stages that judge or investigate, which change no code.
const DECIDE = `${CAUSE} Engineering choices, fixing at the cause and refactoring included, are yours; state each with its reason. ${ASK}`;
const JUDGE = `${CAUSE} Judge the work, or propose the fix, against that cause rather than the ticket's wording. ${ASK}`;

/** LIN-3291's scope and authority per written stage, plus the floors review rests on. */
export const STAGE_INTENT = {
  research: [DECIDE, 'A refactor that removes the cause of what this task fixes, or that this task calls, counts as necessary.'],
  scoping: [DECIDE],
  design: [DECIDE],
  spike: [DECIDE],
  plan: [DECIDE, 'Default to closing the gap at the cause: a ticket number records a trade-off, it does not pay for routing around it.'],
  'plan-review': [JUDGE, 'Verify, do not redesign: another reasonable approach is not a finding; a plan aimed at a symptom of a cause this task could fix is.'],
  implementation: [DECIDE],
  bug: [JUDGE, 'Propose the fix for every instance of its class; the next stage builds it.'],
  blocked: [DECIDE],
  review: [JUDGE,
    'Inside means part of this problem, its cause included, wherever it lives; outside, a genuinely different problem. You give the verdict and do not fix, merge, set Done or file follow-ups; close-out files the outside ones. A bigger problem the fix exposed goes back as Request Changes, not into a new ticket.',
    'Green CI never settles a ledger item: CI is why it is on the list. A non-empty ledger takes the conditional Approve, never a bare one.',
    'A claim takes the post-merge lane only with a named monitor and one line on why nothing short of production could prove it, or a named rollback. A ticket is not a monitor.',
    'Hand close-out an edit only by quoting it exactly; if you cannot, or it is not trivially small, the verdict is Request Changes.'],
  'retrospective-audit': [JUDGE],
  retro: ['This is a reading pass. If the ticket is aimed at a symptom of something deeper, say so.']
};

export function formatStageIntent(kind) {
  const lines = Object.hasOwn(STAGE_INTENT, kind) ? STAGE_INTENT[kind] : null;
  return lines ? `\n\n## Scope and Authority\n\n${lines.map(l => `- ${l}`).join('\n')}` : '';
}

const WRITER_BRIEF = `You are writing the brief an AI coding agent works from, its opening only: the lead of one stage's \`## Goal\`. Below is the stage's own lead. Rewrite it as one or two short paragraphs giving a capable agent the purpose, what good looks like and why, so it can use its judgement.

- Address the agent as "you", plainly. No "we", pleasantries, encouragement or "Act as …" role: say what the work is for instead.
- Keep the lead's substance, limits and reasons; prefer reasons to orders. Add no limit of your own, and no fact: you have not seen the ticket or the code, and the agent reads the live ticket itself.
- Code adds the sections below, the stage's process included; do not write, repeat or narrow them.

Reply with the lead only, in Markdown, starting \`## Goal\`.`;

/** The writer's prompt; writeBrief (lib/openrouter.js) documents its inputs. `bundle` is the stage's Goal section, its lead. */
export function buildBriefWriterPrompt({ kind, bundle, focus = null, sections = [] }) {
  const intent = formatStageIntent(kind).replace(/^\s*## [^\n]*\n\n/, '');
  return [
    WRITER_BRIEF,
    focus ? `## Where the router points (emphasis only: start from the problem, and pass on none of its specifics as fact, task or option, which would narrow the work to the ticket's framing)\n\n${focus}` : '',
    `## What code adds\n\nThe title and ${sections.map(h => `\`${h}\``).join(', ')}.${intent ? ` Scope and Authority says:\n\n${intent}` : ''}`,
    `## The stage's lead\n\n<lead>\n${bundle}\n</lead>`
  ].filter(Boolean).join('\n\n');
}
