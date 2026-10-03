/** The brief writer's prompt (LIN-3293): its brief, each stage's shape, and the scope lines code adds verbatim. */

export const STAGE_IDEALS = {
  research: 'We don\'t know enough yet. Find how this part really works, what was tried before and the right fix; recommend what the next person can build on.',
  scoping: 'The ticket is unclear about the goal. Read the code, then pin down the outcome, what done looks like, and what is in and out.',
  design: 'Several shapes could work. Start from the problem and its cause, weigh the viable ones, choose, and say what would change your mind.',
  spike: 'Can this approach work? Name the deciding question, build the smallest real test of it, and report go or no-go first, then the evidence.',
  plan: 'Work out how to make the change, where it reaches and in what order, so it can be built in one go or split at real seams. Lead with the problem and its cause.',
  'plan-review': 'Fresh eyes on the plan before anyone builds it: will it solve the problem at its cause, and do its claims hold when re-run? Keep the checks in order.',
  breakdown: 'Split the plan into pieces that each land alone and together finish the job, ordered by real dependencies, each carrying its slice of the approved plan.',
  implementation: 'Build it properly, prove it works and put up a PR review can approve: the problem solved well, not steps ticked off. Then proof (tests watched failing), then landing.',
  bug: 'Something behaves wrong. Reproduce it with a signal that tracks the problem, find the cause for certain and whether it is one of a class; report repro, cause, the confirming experiment and the fix.',
  blocked: 'Work has stalled. Check whether it still is; if so, find the real obstacle and clear it when it is yours to clear.',
  triage: 'File the ticket so Harbour routes it right: project first (it picks the repository), then priority, state, labels.',
  context: 'Someone picks this up cold. Read its history and the code; write one comment saying what is done and how you know, what is left, what changed, what next.',
  'look-into': 'Explain what this ticket really asks and why, where it stands, and what you would do next.',
  review: 'Before it lands, check the work solves the problem at its cause and the evidence is real, then write down what green CI did not prove. Lead with that, then the ledger and verdict.',
  'close-out': 'Land approved work: settle what CI could not prove, merge, check what landed, mark Done, tidy up. Last hands before it is hard to undo, so settled must mean settled.',
  'retrospective-audit': 'It merged. Does it do what it claims, and would its tests notice if it stopped? Start from the landed commit; audit claims and tests, not what CI covers.',
  retro: 'Look back honestly: did it solve its problem, what followed, what is loose, what should we do?'
};

const CAUSE = 'This task\'s problem includes its cause, wherever it lives. Engineering choices, fixing at the cause and refactoring included, are yours; only a change the team would need to hear about before it happens goes to the human.';
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
  review: [CAUSE, 'Inside means part of solving this problem, its cause included, wherever it lives; outside means a genuinely different problem. You give the verdict and do not fix, merge, set Done or file follow-ups. A bigger problem the fix exposed goes back as Request Changes, not into a new ticket.'],
  'close-out': [CAUSE, 'Only a review Approve authorizes the close. Part of this problem is settled by being done, or dropped only when finishing it needs telling the team first; filing a ticket never settles it. Write a fix yourself only when review quoted it exactly and it is trivially small.'],
  'retrospective-audit': [CAUSE],
  retro: [READING]
};

export function formatStageIntent(kind) {
  const lines = Object.hasOwn(STAGE_INTENT, kind) ? STAGE_INTENT[kind] : null;
  return lines ? `\n\n## Scope and Authority\n\n${lines.map(l => `- ${l}`).join('\n')}` : '';
}

const WRITER_BRIEF = `You are writing the brief an AI coding agent will work from. Below is the Goal section of one stage of a task: its rules, with their reasons. Rewrite it as the brief a skilled lead would hand a capable colleague: what this work is for, what good looks like, and where the real edges are, in plain language.

- Lead with what this work is for, then what matters most here, in the order the stage's shape suggests. Use the router's reasoning for why this stage.
- Keep every rule's substance and its reason. Merge repeats; drop ticket numbers, notes for rule authors, and conditionals that cannot apply.
- Keep facts exact: identifiers, paths, commands, endpoints, labels and quoted strings stay as written. Add no fact the bundle lacks; the agent reads the live ticket itself, so point at it, never restate it.
- Code adds what is shown below (title, workflow, facts, scope and authority, output formats) verbatim. Do not write it, repeat its literals, or narrow it.

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
