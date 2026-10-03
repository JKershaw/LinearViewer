/**
 * The brief writer's prompt (LIN-3293) and each stage's ideal shape, distilled from
 * docs/prompt-pipeline/stage-descriptions/ and kept to the current rules. The bundle
 * carries the rules; code appends the contract and grounding after the brief.
 */

export const STAGE_IDEALS = {
  research: 'We don\'t yet know enough to do this well. Find out how this part of the system really works, what was tried before and what the right fix is, at its cause; come back with a recommendation the next person can build on without redoing the work. Lead with the question, then what the write-up must settle.',
  scoping: 'The ticket isn\'t clear about what we are trying to achieve. Read the code first, then pin down the outcome and what done looks like, what is in and out (this problem\'s cause is never out). Only product or intent questions go to the human.',
  design: 'There is more than one sensible way to solve this. Start from the problem and its cause, weigh the genuinely viable shapes, choose one and say what would change your mind.',
  spike: 'We don\'t know whether an approach can work here. Name the one question that decides the rest, build the smallest real thing that answers it against real dependencies, and report go or no-go first, then the evidence.',
  plan: 'Work out how this change should be made, where it reaches and in what order, so it can be built in one go or split along real seams, and a reviewer can check the reasoning before code is written. Lead with the problem and its cause, then the approach, surfaces and classes, then session fit and the gate.',
  'plan-review': 'A second developer reads the plan with fresh eyes before anyone builds it. Will it solve the problem at its cause without breaking anything, and do its claims hold when re-run? Verify rather than redesign: a different reasonable approach is not a finding, a plan aimed at a symptom is. Keep the checks in order.',
  breakdown: 'The plan needs more than one session. Split it into pieces that each land on their own and together finish the job, ordered by what truly depends on what. Each piece carries its slice of the approved plan as a reviewed starting point it may correct at the cause, saying so.',
  implementation: 'Build the plan properly, prove it works and put up a PR review can approve. The goal is the problem solved well, at its cause, not the plan\'s steps ticked off; refactor where it makes the code simpler. Lead with that, then how to prove it (tests watched failing), then how to land it.',
  bug: 'Something behaves wrong. Read the thread first, reproduce it with a signal that truly tracks the problem, find the cause for certain, check whether it is one of a class, and propose the fix at the cause. The write-up gives the repro, the cause, the experiment that confirmed it, and the fix.',
  blocked: 'Work has stalled. First check whether it is still stuck; if not, say what happens next. Otherwise find the real obstacle and clear it when it is yours to clear. Only something that genuinely needs a person now goes to the human, made answerable in one reply.',
  triage: 'The ticket needs filing so Harbour routes it correctly: the right project first (it decides the repository), then priority, state and labels. This is filing, not working the problem; leads go in the comment.',
  context: 'Someone is picking this ticket up cold. Read its whole history and the code it touches, and write one comment they can act on: what is done and how you know, what is left, what was decided and what was overturned, and what should happen next.',
  'look-into': 'Someone wants to understand this ticket before deciding what to do. Explain briefly what it is really asking and why, where it stands, and what you would do next; say so if it is unclear, already done, or aimed at a symptom.',
  review: 'Before the work lands, a second pair of eyes checks it solves the problem at its cause and that the evidence it works is real, then writes down what green CI did not prove. Lead with that, then the ledger and verdict. Review gives the verdict; it does not fix, merge or close.',
  'close-out': 'Review has approved the work; land it. Settle what review said CI could not prove, merge, check the change on what landed, mark it Done and leave the task tidy. This is the last pair of hands before the change is hard to undo, so settled has to mean settled. Lead with the gate.',
  'retrospective-audit': 'The work merged and closed. Take a fresh, independent look: does it do what it claims, and would its tests notice if it stopped? Start from the landed commit and audit the claims and tests, not what CI already covers.',
  retro: 'Look back at this work honestly: did it solve the problem it was for, what happened because of it, and what is still loose? Say what we should do about it.'
};

const WRITER_BRIEF = `You are writing the brief an AI coding agent will work from. Below is the rules bundle for one stage of a task: its facts, steps, and rules with their reasons. Rewrite it as the brief a skilled lead would hand a capable colleague: what the work is for, what good looks like, and where the real edges are, in plain language.

- Lead with purpose, then what matters most for this task, in the order the stage's shape below suggests.
- Keep every rule's substance and the reason behind it. Merge rules that say the same thing; drop repetition, ticket numbers and notes written for other rule authors. Drop a conditional that cannot apply to this task.
- Keep facts exact: identifiers, titles, paths, commands, endpoints, labels and quoted strings stay as written. Add no fact the bundle does not hold; where it tells the agent to find something out, say so.
- Keep the title line and the numbered workflow steps with their bold labels, in order; you may tighten their wording.
- Engineering choices, including fixing at the cause and refactoring, are the agent's; only a change the team would need to hear about first goes to the human.
- Do not add output formats, re-grounding notes or an attachments list: code appends those after your brief.

Reply with the brief only, in Markdown.`;

/** The writer's prompt for one stage: brief, shape, the router's reasoning, bundle. */
export function buildBriefWriterPrompt({ kind, bundle, reasoning = null }) {
  const ideal = Object.hasOwn(STAGE_IDEALS, kind) ? STAGE_IDEALS[kind] : null;
  return [
    WRITER_BRIEF,
    ideal ? `## The stage's shape (a guide, not text to copy)\n\n${ideal}` : '',
    reasoning ? `## Why this stage was chosen\n\n${reasoning}` : '',
    `## The rules bundle\n\n<bundle>\n${bundle}\n</bundle>`
  ].filter(Boolean).join('\n\n');
}
