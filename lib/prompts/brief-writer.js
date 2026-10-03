/** The brief writer's prompt, stage shapes and code-added scope lines (LIN-3293). */

export const STAGE_IDEALS = {
  research: 'The right fix is not known yet. Find how this part really works, what was tried before and why, and recommend a fix the next stage can build on.',
  scoping: 'The ticket is unclear about its goal. Read the code first, then state the outcome, what done means, and what is in and out, with reasons.',
  design: 'Several shapes could work. Start from the problem and its cause, weigh the viable ones, choose one, and say why and what would change your mind.',
  spike: 'It is open whether this approach can work. Name the deciding question, build the smallest real test of it, and report go or no-go first, then the evidence.',
  plan: 'Work out how to make the change, where it reaches and in what order, so it can be built in one session or split at real seams. Lead with the problem and its cause.',
  'plan-review': 'You check the plan before it is built: do its claims hold when you re-run them? Keep the checks in order.',
  breakdown: 'Split the plan into pieces that each land alone and together finish the job, ordered by real dependencies, each with its slice of the approved plan.',
  implementation: 'Build it, prove it works, and open a PR review can approve: the problem solved, not steps ticked off. Then proof (tests seen failing), then landing.',
  bug: 'Something behaves wrong. Reproduce it with a signal that tracks it, find the cause for certain and whether it is one of a class; report repro, cause, confirming experiment and fix.',
  blocked: 'Work has stalled. Check whether it still is; if so, find the real obstacle and clear it when it is yours to clear.',
  triage: 'File the ticket so it routes correctly: project first (it picks the repository), then priority, state, labels.',
  context: 'Whoever picks this up next needs its state. Read its history and the code; write one comment: what is done and how you know, what is left, what next.',
  'look-into': 'Explain what this ticket really asks, where it stands, and what you would do next.',
  review: 'You check the work before it lands: is the evidence that it works real? Then record what green CI did not prove, and give the verdict.',
  'close-out': 'Land approved work: settle what CI could not prove, merge, check what landed, mark Done, tidy up. After this the change is hard to undo, so settled must mean settled.',
  'retrospective-audit': 'The work has merged. Does it do what it claims, and would its tests catch a regression? Start from the landed commit; audit claims and tests, not what CI covers.',
  retro: 'Look back: did the work solve its problem, what followed from it, what is loose, and what should be done next?'
};

const CAUSE = 'This task\'s problem includes its cause, wherever it lives. Engineering choices, fixing at the cause and refactoring included, are yours; state each with its reason. Only a change the team would need to hear about before it happens goes to the human, as one clear question with your recommendation.';
const READING = 'This is a reading pass. If the ticket is aimed at a symptom of something deeper, say so.';

/** LIN-3291's scope and authority, per stage. */
export const STAGE_INTENT = {
  research: [CAUSE, 'A refactor that removes this task\'s cause counts as necessary.'],
  scoping: [CAUSE, 'This problem\'s cause is never out of scope.'],
  design: [CAUSE],
  spike: [CAUSE],
  plan: [CAUSE, 'Default to closing the gap at the cause: a ticket number records a trade-off, it does not pay for routing around it.'],
  'plan-review': [CAUSE, 'Verify, do not redesign: another reasonable approach is not a finding; a plan aimed at a symptom of a cause this task could fix is.'],
  breakdown: [CAUSE, 'A subtask may change course at the cause where the code shows the plan is wrong, saying so.'],
  implementation: [CAUSE],
  bug: [CAUSE, 'Propose the fix at the cause, reaching every instance of its class.'],
  blocked: [CAUSE],
  triage: ['This is filing, not working the problem: leave the reporter\'s description as written.'],
  context: [READING],
  'look-into': [READING],
  review: [CAUSE, 'Inside means part of this problem, its cause included, wherever it lives; outside, a genuinely different problem. You give the verdict and do not fix, merge, set Done or file follow-ups. A bigger problem the fix exposed goes back as Request Changes, not into a new ticket.'],
  'close-out': [CAUSE, 'Only a review Approve authorizes the close. Part of this problem is settled by being done, or dropped only when finishing it needs telling the team first; filing a ticket never settles it. Write a fix yourself only when review quoted it exactly and it is trivially small.'],
  'retrospective-audit': [CAUSE],
  retro: [READING]
};

export function formatStageIntent(kind) {
  const lines = Object.hasOwn(STAGE_INTENT, kind) ? STAGE_INTENT[kind] : null;
  return lines ? `\n\n## Scope and Authority\n\n${lines.map(l => `- ${l}`).join('\n')}` : '';
}

const WRITER_BRIEF = `You are writing the brief an AI coding agent works from. Below is one stage's Goal: its rules and their reasons. Rewrite it as a brief giving a capable agent the purpose, context, what good looks like and the real edges, so it can use its judgement.

- Address the agent as "you", plainly. No "we", pleasantries or encouragement.
- Lead with purpose, then what matters most here, in the stage's shape; the router's reasoning says why this stage.
- Keep every rule's substance and reason; prefer reasons to commands, keeping "must" and "never" for what code or safety depends on. Merge repeats; drop ticket numbers, incident scars and conditionals that cannot apply.
- State its real limits: one session, its tools, when to stop and report.
- Keep identifiers, paths, commands and quoted strings exact. Add no fact; the agent reads the live ticket, so point at it, never restate it.
- Use prose; number only what has an order.
- Code adds what is shown below verbatim; do not write, repeat or narrow it.

Reply with the rewritten Goal only, in Markdown, starting \`## Goal\`.`;

export function buildBriefWriterPrompt({ kind, bundle, reasoning = null, added = null }) {
  const ideal = Object.hasOwn(STAGE_IDEALS, kind) ? STAGE_IDEALS[kind] : null;
  return [
    WRITER_BRIEF,
    ideal ? `## The stage's shape (a guide, not text to copy)\n\n${ideal}` : '',
    reasoning ? `## Why this stage was chosen\n\n${reasoning}` : '',
    added ? `## What code adds, verbatim\n\n<added>\n${added}\n</added>` : '',
    `## The rules bundle\n\n<bundle>\n${bundle}\n</bundle>`
  ].filter(Boolean).join('\n\n');
}
