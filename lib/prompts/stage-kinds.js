/**
 * The stage kinds, one record each (LIN-4467, piece 3 of LIN-4448). Each fact about a kind that the prompts,
 * the stage selector, the run page, the public catalogue and the proxy's verb list read is written here once.
 * These are views of this record: PROMPT_TEMPLATES and STAGE_LEADS (lib/prompt-template-defs.js),
 * COMPLETION_SIGNALS (lib/completion-signals.js), STAGE_INTENT (lib/prompts/stage-intent.js), GROUNDING_BY_KIND
 * (lib/prompt-formatters.js), STAGE_LABELS (lib/run-view.js), the contract (lib/prompt-contract.js), the
 * catalogue (lib/prompts/stage-catalogue.js) and the verb list (lib/proxy-instructions.js).
 *
 * Imports leaves only (the words it reads, and stage-writes), never the template registry, the signals or the
 * run views, so it cannot form a cycle. tests/unit/lin-4467-stage-kind-record.test.js checks the rule and that
 * every kind gives every field.
 *
 * Fields: name, category, description, route ({ when, whenNot, requires? } or null: only a person or a code route
 * sends it), writes, lead (the Goal's opening), label (the run-page label), grounding (a name in
 * GROUNDING_LISTS), signals, intent (Scope and Authority lines, or null; a reading pass writes its own line, which tests/unit/lin-4253-stage-traits.test.js ties to `writes`), contract ((identifier) => lines, or null),
 * catalogue ({ group: 'default' | 'more', line }, the public bullet).
 */
import { WRITES } from '../stage-writes.js';
import { AS_ASKED_HEADING } from '../as-asked.js';
import { SIZE_OF_MOVE_HEADING, DECIDED_BY } from '../size-of-move.js';
import { BLIND_READ_KIND, BLIND_READ_HEADING, BLIND_READ_VERDICT_PROSE, BLIND_READ_VERDICT_LIST } from './blind-read-words.js';

// The Scope and Authority texts (was lib/prompts/stage-intent.js). Each is one line code adds to a stage prompt.
const CAUSE = 'When this task fixes something, its cause is part of the work, wherever it lives.';
const ASK = 'Only a change the team would need to hear about before it happens goes to the human, as one clear question with your recommendation.';
// LIN-4345: a cut to the ask is the person's call, not the stage's.
export const CUT = 'Cutting the `' + AS_ASKED_HEADING + '` block is not yours: any sentence or clause not delivered in full, by scope, assumption, design, size limit or another ticket, is a cut. Quote each where you write and raise them as one ruling, a `DECISION:` before `BLOCKED:`; unanswered, a cut is not agreed.';
// Stages that choose or build; stages that judge or investigate, which change no code.
export const DECIDE = `${CAUSE} Engineering choices, fixing at the cause and refactoring included, are yours; state each with its reason. ${CUT} ${ASK}`;
const JUDGE = `${CAUSE} Judge the work, or propose the fix, against that cause rather than the ticket's wording. ${ASK}`;
const READING = 'This is a reading pass. If the ticket is aimed at a symptom of something deeper, say so.';
// LIN-4437: the blind read's own line. A reading pass that names no ticket: READING and JUDGE both point at it.
const BLIND = 'This is a reading pass. Your verdict is your own, formed from the code you are pointed at; why the change was made is not yours to find out.';
// A stage is a reading pass exactly when its `writes` is none, one-comment or blind-comment (lib/stage-writes.js); its record
// carries READING (or BLIND) as its intent, and tests/unit/lin-4253-stage-traits.test.js fails a record that disagrees with `writes`.

/** The kind-keyed records. Key order is the template registry's order. */
export const STAGE_KINDS = {
  blocked: {
    name: 'blocked',
    category: 'universal',
    description: 'Analyze and resolve blockers preventing progress. Use when work is stalled due to dependencies, missing info, or technical issues.',
    route: {
      when: 'The work cannot proceed: an open blocker relation, a person\'s hold that nothing later lifted, or a decision only a person can make.',
      whenNot: 'Every blocker is resolved, even if the description still says "blocked until".'
    },
    writes: WRITES.WORK,
    lead: 'Work has stalled. Find the real obstacle and clear it when it is yours to clear.',
    label: 'Blocked',
    grounding: 'work',
    signals: {
      coreOutcome: 'Path forward identified and unblocking can proceed',
      signals: [
        'Blocker type identified (dependency, info, technical, external)',
        'Root cause understood',
        'Options to unblock evaluated',
        'Recommended action determined'
      ],
      readinessCheck: 'Can work resume based on this analysis?'
    },
    intent: [DECIDE],
    contract: null,
    catalogue: { group: 'more', line: 'blocked: Analyze and resolve blockers' }
  },
  bug: {
    name: 'bug',
    category: 'work-issue',
    description: 'Investigate and debug an issue. Use when you need to find root cause, reproduction steps, and potential fixes.',
    route: {
      when: 'Unexpected behaviour whose cause is not yet confirmed, or whose cause a later comment refuted or relocated, or whose deciding experiment never ran.',
      whenNot: 'An investigation already names a root cause and fix direction that still stand at the end of the trail (`implementation`). The `bug` label alone does not mean investigation is owed.'
    },
    writes: WRITES.WORK,
    lead: 'Something behaves wrong. Find its cause for certain, with evidence, before anything is fixed; nothing ships without review.',
    label: 'Bug fix',
    grounding: 'work-in-area',
    signals: {
      coreOutcome: 'Issue understood well enough to fix',
      signals: [
        'Reproduction steps identified',
        'Root cause hypothesized or confirmed',
        'Fix approach determined',
        'Scope of impact understood'
      ],
      readinessCheck: 'Could someone implement a fix based on this?'
    },
    intent: [JUDGE, 'Propose the fix for every instance of its class; the next stage builds it.'],
    contract: null,
    catalogue: { group: 'more', line: 'bug: Find root cause and potential fixes' }
  },
  plan: {
    name: 'plan',
    category: 'ready',
    description: 'Decide how a well-defined change will be made, so it can be built without re-deciding anything, and whether it fits one session. Use when the task is well-defined and you need to document the approach before coding.',
    route: {
      when: 'The knowledge is gathered and the shape decided, but there is no plan with a session-fit answer.',
      whenNot: 'A complete plan (approach, places, session fit) is already in the description, a breakdown child\'s copied slice of an approved parent plan included: route on its session fit.',
      requires: 'Gathered knowledge and a decided shape.'
    },
    writes: WRITES.WORK,
    lead: 'Decide how the change will be made, so it can be built without re-deciding anything. Lead with what the change is for, its cause when it fixes something, and what done looks like to the person who asked.',
    label: 'Plan',
    grounding: 'work-in-area',
    signals: {
      coreOutcome: 'Implementation plan documented with session-fit decision made',
      signals: [
        'Implementation steps clearly documented in description',
        'Files and functions to modify identified',
        'Dependencies and order of operations defined',
        'Test strategy outlined',
        'Cuts to the `' + AS_ASKED_HEADING + '` block listed, or none',
        'The behaviour is named, each place it lives is in or out of scope, and the plan says how it knows it found every place',
        'Session-fit answer recorded in the description (fits one session / needs multiple sessions)'
      ],
      readinessCheck: 'Does the plan document files, approach, and testing, and does it commit to a session-fit answer?'
    },
    intent: [DECIDE, 'Default to closing the gap at the cause: a ticket number records a trade-off, it does not pay for routing around it.'],
    contract: () => [
      'Put the plan in the description, below any `' + AS_ASKED_HEADING + '` block, under a `## Implementation Plan` heading.',
        'State session fit there as exactly `fits one session` or `needs multiple sessions`, and use neither phrase elsewhere.',
        'Add one line: `plan-review due: yes` or `plan-review due: no`.'
    ],
    catalogue: { group: 'default', line: 'plan: Step-by-step implementation with test coverage' }
  },
  'look-into': {
    name: 'look into',
    category: 'universal',
    description: 'Get a quick overview and context for any task. Use when you want to understand what a task involves before deciding next steps.',
    route: {
      when: 'Someone wants a quick overview before deciding anything.',
      whenNot: 'The trail already shows the next working stage.'
    },
    writes: WRITES.NONE,
    lead: 'Give a quick overview of this task and its context, so the reader can decide what to do next. Inform and summarize; make no changes or decisions.',
    label: 'Look into',
    grounding: 'stale',
    signals: {
      coreOutcome: 'Task context understood with recommended next action',
      signals: [
        'Task purpose and requirements summarized',
        'Project context identified',
        'Current status and blockers assessed',
        'Recommended next prompt type identified'
      ],
      readinessCheck: 'Can someone decide what to do next based on this overview?'
    },
    intent: [READING],
    contract: null,
    catalogue: { group: 'default', line: 'look into: Quick overview and context for any task' }
  },
  triage: {
    name: 'triage',
    category: 'universal',
    description: 'Review and update task metadata: labels, priority, state, project. Use when a task needs organizational cleanup before work begins.',
    route: {
      when: 'The ticket\'s labels, priority, state or project are wrong or missing.',
      whenNot: 'What to build is unclear (`scoping`).'
    },
    writes: WRITES.TICKET_FIELDS,
    lead: 'File the ticket so it routes correctly: its labels, priority, state and project (the project picks the repository). These updates are yours to make.',
    label: 'Triage',
    grounding: 'none',
    signals: {
      coreOutcome: 'Task metadata reflects its actual status',
      signals: [
        'Labels appropriate for current state',
        'Priority matches importance and urgency',
        'State accurate for current progress',
        'Task is in the correct project (assigned, not mis-filed)',
        'Changes applied in Linear'
      ],
      readinessCheck: 'Is the task properly organized — including the right project — for the next workflow stage?'
    },
    intent: ['This is filing, not working the problem: leave the reporter\'s description as written.'],
    contract: null,
    catalogue: { group: 'more', line: 'triage: Review and update metadata (labels, priority)' }
  },
  breakdown: {
    name: 'breakdown',
    category: 'universal',
    description: 'Break a large or vague task into smaller, actionable subtasks. Use when task scope is unclear or too big to start.',
    route: {
      when: 'The plan needs multiple sessions, or the description lays out phases that each land on their own, and no subtasks cover them yet.',
      whenNot: 'Steps that land together as one PR, or one PR in ordered commits (`implementation`); subtasks already cover the scope (`defer`).',
      requires: 'A plan or explicit phases, and an Approve from any plan-review that was due.'
    },
    writes: WRITES.WORK,
    lead: 'Split the plan into pieces that each land alone and together finish the job. The subtasks and their dependencies are yours to define; keep the original task\'s intent and scope.',
    label: 'Breakdown',
    grounding: 'work',
    signals: {
      coreOutcome: 'Task decomposed into actionable subtasks with clear ordering',
      signals: [
        'Subtasks created with clear titles and descriptions',
        'Each subtask has acceptance criteria',
        'Blocked-by relations establish execution order',
        'Summary comment added to parent task'
      ],
      readinessCheck: 'Can someone start working through the subtasks in order?'
    },
    intent: [DECIDE, 'A subtask may change course at the cause where the code shows the plan is wrong, saying so.'],
    contract: null,
    catalogue: { group: 'more', line: 'breakdown: Break large tasks into actionable subtasks' }
  },
  research: {
    name: 'research',
    category: 'universal',
    description: 'Investigate unknowns, explore options, and gather information. Use when you need to understand a problem before implementing.',
    route: {
      when: 'Doing the work well depends on knowledge not yet gathered: how the code behaves today, an unpinned external dependency, history or prior art, or every place a change must reach when the ticket names them only by description. Also when the ticket prescribes research as its method. In a close call, prefer research.',
      whenNot: 'The task is small and obvious, or the findings and a chosen approach are already on the trail as completed prep (a research or investigation write-up, or a plan an approving plan-review covers); a fix the filer wrote in the description is a hypothesis, not prep.'
    },
    writes: WRITES.WORK,
    lead: 'What this task needs is not known well enough to plan. Identify the key questions, find how this part really works, what was tried before and why, and recommend an approach the next stage can build on.',
    label: 'Research',
    grounding: 'work-in-area',
    signals: {
      coreOutcome: 'Key questions answered with actionable recommendations',
      signals: [
        'Key discoveries and insights documented',
        'Options evaluated with pros/cons',
        'Recommended next steps provided',
        'Description updated with key findings'
      ],
      readinessCheck: 'Can someone proceed based on these findings?'
    },
    intent: [DECIDE, 'A refactor that removes the cause of what this task fixes, or that this task calls, counts as necessary.'],
    contract: null,
    catalogue: { group: 'default', line: 'research: Investigate unknowns and gather information' }
  },
  scoping: {
    name: 'scoping',
    category: 'universal',
    description: 'Settle the size of the move, and why. Use when requirements are ambiguous or scope creep is a risk.',
    route: {
      when: 'The goal or its boundaries are in dispute: what to build is a product or intent question that reading the code would not settle; or a person has answered the size ruling and the size of the move still reads ' + DECIDED_BY.pending + '.',
      whenNot: 'The gap is knowledge to gather, such as how the code behaves, a platform or dependency, or history, even when the ticket is terse (`research`); only the solution shape is open (`design`); unexpected behaviour (`bug`).'
    },
    writes: WRITES.WORK,
    lead: 'Settle how big a move this ticket makes, and why: what, never how. Read the code first.',
    label: 'Scoping',
    grounding: 'scoping-in-area',
    signals: {
      coreOutcome: 'The size of the move, and why, recorded in the description',
      signals: [
        'Survey comments, filing comments and any person\'s size comment read',
        'Sizes weighed from just the task to wrong work, one recommended',
        'One `' + SIZE_OF_MOVE_HEADING + '` section below the `' + AS_ASKED_HEADING + '` block, holding only the record\'s 4 lines',
        'Cuts to the `' + AS_ASKED_HEADING + '` block listed in the record, or none',
        'Decided by a ruling or the standing policy; pending, with a `DECISION:`, only for a size the policy may not decide'
      ],
      readinessCheck: 'Does the ticket say plainly what size of move this is and why, with nothing about how?'
    },
    intent: [DECIDE],
    contract: null,
    catalogue: { group: 'more', line: 'scoping: Settle the size of the move, and why' }
  },
  design: {
    name: 'design',
    category: 'universal',
    description: 'Create a technical design with multiple approaches and tradeoffs. Use for complex features needing architectural decisions.',
    route: {
      when: 'Two or more materially different solution shapes are viable and nothing has committed to one.',
      whenNot: 'One obvious shape, an approach a research write-up or approved plan committed to, landed work, or knowledge still ungathered (`research`).'
    },
    writes: WRITES.WORK,
    lead: 'Several shapes could work; choose the one that best serves what the task is for.',
    label: 'Design',
    grounding: 'work-in-area',
    signals: {
      coreOutcome: 'Design approach chosen with clear rationale',
      signals: [
        'Multiple approaches evaluated (2-3)',
        'Tradeoffs documented for each',
        'Recommendation made with rationale',
        'Implementation considerations outlined'
      ],
      readinessCheck: 'Can implementation proceed based on this design?'
    },
    intent: [DECIDE],
    contract: null,
    catalogue: { group: 'more', line: 'design: Evaluate approaches and recommend architecture' }
  },
  spike: {
    name: 'spike',
    category: 'universal',
    description: 'Time-boxed exploration to answer specific technical questions. Use when you need proof-of-concept or feasibility assessment.',
    route: {
      when: 'One sharp feasibility question decides the approach, and a small proof against the real code can answer it.',
      whenNot: 'The gap is broader understanding (`research`), or the approach is known to work.'
    },
    writes: WRITES.WORK,
    lead: 'It is open whether this approach can work here. Find out by trying, against the real code: the code is evidence, not the deliverable.',
    label: 'Spike',
    grounding: 'work-in-area',
    signals: {
      coreOutcome: 'The deciding question answered go/no-go, with evidence',
      signals: [
        'One deciding question, with what would mean yes and no',
        'Kept to one focused session',
        'Proof run against real dependencies, left visible, not landed',
        'Answer first: verdict, evidence, risks, unknowns'
      ],
      readinessCheck: 'Is there enough information to make a technical decision?'
    },
    intent: [DECIDE],
    contract: null,
    catalogue: { group: 'more', line: 'spike: Time-boxed exploration for proof-of-concept' }
  },
  context: {
    name: 'context',
    category: 'universal',
    description: 'Synthesize current state and history of a task. Use when joining a task mid-way or after a long gap.',
    route: {
      when: 'Someone is picking the task up after a gap and needs to know where it stands.',
      whenNot: 'The trail already shows the next working stage.'
    },
    writes: WRITES.ONE_COMMENT,
    lead: 'Whoever picks this up next needs its state: where it really stands and what should happen next. Inform and summarize; make no changes or decisions.',
    label: 'Context',
    grounding: 'stale',
    signals: {
      coreOutcome: 'Current state and history clearly summarized',
      signals: [
        'Current state documented',
        'Completed work identified',
        'Remaining work listed',
        'Key decisions noted',
        'Next steps recommended'
      ],
      readinessCheck: 'Can someone pick up this task based on this summary?'
    },
    intent: [READING],
    contract: null,
    catalogue: { group: 'more', line: 'context: Synthesize current state when joining mid-task' }
  },
  'plan-review': {
    name: 'plan-review',
    category: 'universal',
    description: 'Judge a plan with fresh context before implementation starts: will building it solve the task\'s problem, with its premise, safeguards and shape checked against the code as it stands now, then issue a verdict. Use when a plan is documented but not yet implemented.',
    route: {
      when: 'No plan-review since the plan last changed, and the gate is met: the plan says "plan-review due: yes", or it needs multiple sessions, routes around a named contract gap, relaxes a validation, contract or guard, or touches credential, merge-rule or dispatch-contract surfaces.',
      whenNot: 'The plan says "plan-review due: no" and nothing in it contradicts that (a breakdown child covered by its parent\'s approving plan-review included), or the work has landed.',
      requires: 'A plan in the description.'
    },
    writes: WRITES.WORK,
    lead: 'Before it is built, judge whether building this plan will solve the task\'s problem. Block only on what would make the build go wrong; everything else is a note for the builder.',
    label: 'Plan review',
    grounding: 'work',
    signals: {
      coreOutcome: 'Plan judged against what a plan ready to build looks like, and an explicit verdict (Approve / Request Changes / Needs Discussion) issued that hands the plan on to implementation — or names what it must fix',
      signals: [
        'Premise checked: the cause the plan names, and each fact it inherits, confirmed true against its authoritative source',
        'Whole problem checked: the plan says how it knows it found every place the behaviour lives, and each place it leaves out says why and names its ticket',
        'Safeguards checked: a loosened validation, contract, or guard has a named test that tries what it stopped',
        'Shape checked: a prerequisite refactor is sequenced first only where something here needs it, and the plan says whether it fits one session',
        'Each finding labelled block or note, with each note written so the builder can act on it',
        'Explicit verdict issued (Approve / Request Changes / Needs Discussion), saying in one line how the plan meets what was asked (the `' + AS_ASKED_HEADING + '` block) and naming any cut'
      ],
      readinessCheck: 'Plan-review judges, it does not redesign — will building this plan solve the task\'s problem, and is an explicit verdict recorded that either hands off to implementation or names what the plan must fix?'
    },
    intent: [JUDGE, 'Judge, do not redesign: another reasonable approach is not a finding; a plan aimed at a symptom of a cause this task could fix is.'],
    contract: () => [
      'Post one comment that starts with `### Plan Review Verdict`, then `**Verdict:**` and one of Approve, Request Changes or Needs Discussion with a one-line reason, then the findings.',
        'On Request Changes, also write `Blocking findings: <n>` on its own line: the number of findings the plan must fix before approval.'
    ],
    catalogue: { group: 'more', line: 'plan-review: Verify a plan\'s grounding claims with fresh context before implementation starts' }
  },
  implementation: {
    name: 'implement',
    category: 'universal',
    description: 'Guide for active implementation phase. Use when research and planning are complete and coding is in progress.',
    route: {
      when: 'A plan that fits one session, approved by any plan-review that was due; a small task whose one surface and change are already named; or the fix round after a code review requested changes.',
      whenNot: 'No committed scope: a long or legible description is not a plan (`plan` or `research`). Landed work (`review`); a review Approve, plain or conditional: close-out makes its fixes. A bug cause that is refuted or unconfirmed (`bug`).',
      requires: 'Gathered knowledge, a decided shape and committed scope.'
    },
    writes: WRITES.WORK,
    lead: 'Build it, prove it works, and open a PR that review can approve: the problem solved, not steps ticked off.',
    label: 'Build',
    grounding: 'build-in-area',
    signals: {
      coreOutcome: 'Code changes complete with tests passing',
      signals: [
        'Implementation follows plan (if present)',
        'Code changes committed',
        'Tests written and passing',
        'Summary comment added'
      ],
      readinessCheck: 'Is the implementation complete and tested?'
    },
    intent: [DECIDE],
    contract: (identifier) => [
      `Put the PR's full URL (\`https://github.com/<owner>/<repo>/pull/<n>\`) in your summary comment on ${identifier}. One PR carries this task.`
    ],
    catalogue: { group: 'default', line: 'implement: Active coding phase guidance' }
  },
  review: {
    name: 'review',
    category: 'universal',
    description: 'Comprehensive review checklist for completed implementation. Use when code is ready for CI/CD and final review.',
    route: {
      when: 'Work has landed (a PR or completion summary on the trail, or every subtask done) and no code review has run on it since.',
      whenNot: 'A code review already approved the unchanged work (`close-out`) or requested changes not yet addressed (`implementation`).',
      requires: 'Landed work.'
    },
    writes: WRITES.WORK,
    lead: 'You check the work before it lands: is it complete, does it meet the requirements, and is the evidence that it works real? Verify against the requirements; adding new ones is not review\'s job.',
    label: 'Review',
    grounding: 'work-in-area',
    signals: {
      coreOutcome: 'Implementation verified and an explicit verdict (Approve / Request Changes / Needs Discussion) issued that authorizes the merge — or Request Changes naming the stage that fixes it',
      signals: [
        'Requirements matched',
        'Tests pass',
        'Tests exist at appropriate level (e2e/integration where needed)',
        'CI/CD pipeline green on the PR, or CI genuinely absent and the two-branch substitute recorded',
        'No regressions identified',
        'Explicit verdict issued (Approve / Request Changes / Needs Discussion), saying where the work meets each sentence of what was asked (the `' + AS_ASKED_HEADING + '` block), in order, and naming any cut; one nobody agreed to is Needs Discussion',
        'If CI red, or CI genuinely absent with no substitute recorded, or a bigger problem surfaced: Request Changes, naming the stage that fixes it here (no new ticket)'
      ],
      readinessCheck: 'Review does not merge or mark Done (close-out does that) — is an explicit verdict issued with CI green on the PR, or, when CI is genuinely absent, with the two-branch substitute independently re-run and recorded (either discharges this precondition and authorizes Approve, conditional when the ledger is non-empty — CI absence is not itself a closure-blocker route), and is the `### What CI Did Not Prove` ledger written into the summary comment — or, if not, is Request Changes issued, naming the fixing stage?'
    },
    intent: [JUDGE, 'Green CI never settles a ledger item: CI is why it is on the list.'],
    contract: (identifier) => [
      `Title the summary comment \`## Review — ${identifier}\`, and name the head you reviewed as head \`<sha>\`.`,
        'State CI on one line starting `CI:` (green, red, or absent plus the substitute run).',
        'Put the ledger under `### What CI Did Not Prove`, one list item per claim, each saying inside or outside. Write "discharged" only for an item already settled. If nothing is left, write `CI covers the deliverable; ledger empty`.',
        'End with `### Verdict` and one of: `Approve`, `Approve — conditional on close-out discharging the ledger`, `Request Changes`, `Needs Discussion`.'
    ],
    catalogue: { group: 'more', line: 'review: Verify implementation before merge' }
  },
  'close-out': {
    name: 'close-out',
    category: 'universal',
    description: 'Finish approved work: make the fixes review asked for, merge, do the post-deploy steps once the deploy lands, set Done, post the summary, archive & prune, and file the gate\'s tickets. Use when review has Approved and the PR is green (or, with no CI, the established-absence substitute was recorded).',
    route: {
      when: 'The latest code review approved, plainly or conditionally, and the work is not yet merged and Done, or an audit\'s notes PR is approved and unmerged on a Done ticket.',
      whenNot: 'CI is red, or verifying the work surfaced a blocker: that is `implementation` (or `bug`, or `blocked` if only a person can settle it) on this ticket first.',
      requires: 'An Approve from a code review; a plan-review Approve is not one.'
    },
    writes: WRITES.WORK,
    lead: 'Land approved work. Finish it the way a skilled developer finishes their own: make the fixes review asked for, merge, see it land, do what the ticket needs after the deploy, and close the loop. A merge is hard to undo, so settled must mean settled.',
    label: 'Close-out',
    grounding: 'work',
    signals: {
      coreOutcome: 'Approved work finished: the fixes review asked for made, the ledger settled, the PR merged, the post-deploy steps done once the deploy landed, the task Done, the summary posted, the description archived and pruned of superseded stage artifacts (or the skipped prune recorded), and related tickets tidied and each outside find written to its home',
      signals: [
        'Review verdict read from the latest summary comment; any gaps it flagged as unproven by CI settled, an explicitly empty ledger passing through, and a missing one sent back to review to confirm',
        'The fixes review asked for made by close-out itself, each the size of a fix (new design or new behaviour handed back to review), listed in the summary with its commit, and CI green on the new head',
        'Every ledger item settled: inside work done with cited evidence, an outside item written to its home (a note commit, or a gate ticket filed on its own terms), a monitor or rollback review named cited by that name (an unnamed one settles nothing), or an item accepted by a human naming the exact precondition exercised; once the deploy landed, a post-deploy check close-out cannot run is recorded as not run (what, why, follow-up) and does not hold the close',
        'Green CI confirmed on the exact merged commit, or CI genuinely absent with the substitute re-run and recorded on it (green CI alone never discharges a ledger item)',
        'PR merged; once the deploy landed, the post-deploy steps done and the change verified on what landed in the same session, then the task set to Done — not held open for a separate verification pass',
        'Summary comment posted, saying how the merged work meets what was asked, related tickets this work settles closed or cancelled, outside finds written to their home, any gate ticket linked',
        'A pre-prune snapshot archived and its capture verified before the description was rewritten; below the `' + AS_ASKED_HEADING + '` block, through `description/below`, superseded stage-artifact sections (plan(s), plan revisions, research findings, discharged scoping/design) replaced with a short stub, keeping any section a follow-up references and the session-fit phrase / `Implementation Plan` heading verbatim; with no block, no prune — or, where the archive could not be verified, the prune skipped and that recorded in the summary'
      ],
      readinessCheck: 'Did the review record an Approve, and is the work then finished: the fixes review asked for made, every ledger item settled (an explicitly empty ledger under an Approve is a cheap no-op; a missing one goes back to review), merged, the post-deploy steps done once the deploy landed, set Done, summarized (with how the work meets what was asked), archived-and-pruned (or the skip recorded) below the `' + AS_ASKED_HEADING + '` block only, and each outside find written to its home?'
    },
    intent: [`Engineering calls in finishing the work are yours; state each with its reason. ${ASK}`],
    contract: (identifier) => [
      `Title your summary comment \`## Close-out — ${identifier}\`.`,
        'When you prune the description, keep word for word any `Implementation Plan` heading, the session-fit phrase (`fits one session` / `needs multiple sessions`) and any `plan-review due:` line: code reads them there. The `' + AS_ASKED_HEADING + '` block is never pruned.'
    ],
    catalogue: { group: 'more', line: 'close-out: Discharge the review ledger, then merge, set Done, post the summary, and file the gate\'s tickets (other outside finds go to area notes)' }
  },
  'retrospective-audit': {
    name: 'retrospective-audit',
    category: 'universal',
    description: 'Independently audit a landed change: the claims its deliverable rests on, and the integrity of the tests that assert them. Use once work has already merged — never for work that has not landed yet (that\'s `review`).',
    route: {
      when: 'The work is merged and Done, with a code review on record.',
      whenNot: 'The work has not merged (`review`), or has merged and been approved but the task is not Done (`close-out`), or an audit already ran on this landing (TRAIL FACTS: audit reported after the landing close-out); then its unmerged notes PR is `review`, then `close-out`.'
    },
    writes: WRITES.WORK,
    lead: 'The work has merged. Does it do what it claims, and would its tests catch a regression? Audit that independently and report what you find; there is no need to re-litigate whether the change should have been made, or to re-verify overall correctness, which CI covers.',
    label: 'Retrospective audit',
    grounding: 'stale',
    signals: {
      coreOutcome: 'Claims the deliverable rests on, and the integrity of the tests asserting them, independently checked against the landed code, with findings reported',
      signals: [
        'Opens from the fact the change is already merged — the landed commit(s)/PR located before auditing anything',
        'Claims (in-code comments, PR/task description, summary comment) checked directly against the code at HEAD, not against the author\'s account of them',
        'Tests checked for integrity, not just presence — a test passing for a reason unrelated to the behavior it names, a vacuous assertion, or a negative/spy test that never asserts is surfaced',
        'Ownership orphans checked — a hazard deferred between this ticket and a sibling it references, unowned by either at HEAD',
        'Findings reported as a comment: each one the consequence test sends to a ticket filed as one, the rest as Waiting entries in one docs-only notes pull request linked from the comment (none when no finding is note-bound); no status/label/Done change, no merge'
      ],
      readinessCheck: 'Were the deliverable\'s claims and its tests\' integrity independently checked against the landed code (not the overall correctness CI already covers), with findings reported and no state changed?'
    },
    intent: [JUDGE],
    contract: null,
    catalogue: { group: 'more', line: 'retrospective audit: Audit a merged change\'s claims and test integrity after the fact; file the gate\'s tickets and open one docs-only notes PR for the other findings' }
  },
  retro: {
    name: 'retro',
    category: 'universal',
    description: 'Run a retrospective: reconstruct what happened from Linear and git history, assess downstream effects, and surface honest lessons. Works on completed work (true look-back) and in-flight work (reorient, or when something feels off).',
    route: null,
    writes: WRITES.NONE,
    lead: 'Look back with the benefit of hindsight: did the work solve its problem, and what should be done next? Give an honest account and useful lessons, not blame or a re-litigation of decisions.',
    label: 'Retro',
    grounding: 'stale',
    signals: {
      coreOutcome: 'Honest retrospective delivered to the user with downstream effects (or in-flight risks) assessed and actionable lessons surfaced',
      signals: [
        'What actually happened reconstructed from Linear and git history',
        'Downstream effects assessed for shipped work (follow-up fixes, reverts, regressions, reopened work), or risks flagged for in-flight work — or confirmed none',
        'What went well and what was missed or went wrong told honestly',
        'Concrete, actionable lessons for similar future work',
        'Depth matched to scale (light for a leaf task, aggregated across subtasks for an epic)'
      ],
      readinessCheck: 'Could the team learn something concrete and act on it next time?'
    },
    intent: [READING],
    contract: null,
    catalogue: { group: 'more', line: 'retro: Retrospective look-back (or in-flight reorient) — reconstruct what happened, assess downstream effects/risks, surface lessons; presents findings without writing back' }
  },
  // LIN-4248: the Survey, never offered by the selector; the look-first route sends it (LIN-4370). Its lead is the
  // opening paragraph of the hand-tuned prompt it came from (notebook: docs/plans/survey/prompt.md, "Survey open-0").
  'survey-task': {
    name: 'survey-task',
    category: 'universal',
    description: 'Sent by the look-first route or by hand, never by the selector. A read-only forecast, before work starts: why this task will be difficult and what you would do first, from a fresh session at origin/main. Posts one comment on the surveyed ticket and changes nothing else.',
    route: null,
    writes: WRITES.ONE_COMMENT,
    lead: 'You are looking at the ground before a task starts. You are not doing the task, and you are not reviewing anyone\'s work.',
    label: 'Survey (task)',
    grounding: 'none',
    signals: {
      coreOutcome: 'A read-only forecast of why this task will be difficult, and what would be done first, posted as one comment on the surveyed ticket at the named base',
      signals: [
        'Read at the base the heading names, with nothing after it: no later commits, tickets, comments or reports',
        'Answers why the change will be difficult, or says plainly that it will not, from the code found',
        'Says what would be done first, if anything, and why',
        'One comment on the surveyed ticket, headed with the base; no code, branch, pull request, ticket or Linear state changed',
        'Under 500 words'
      ],
      readinessCheck: 'Is the comment read-only, at the named base, under its word limit, and on the surveyed ticket?'
    },
    intent: [READING],
    contract: null,
    catalogue: { group: 'more', line: 'survey-task: Sent by the look-first route (first on a fresh, unsized ticket) or by hand, never by the selector. Read-only forecast before work starts: why this task will be difficult and what would be done first; posts one comment on the surveyed ticket and changes nothing else' }
  },
  'survey-place': {
    name: 'survey-place',
    category: 'universal',
    description: 'Sent by the look-first route or by hand, never by the selector. A read-only forecast of the codebase as a place, before work starts: where this task lands, what the obvious way would add, move, tangle or leave in two places, and what would leave the place better. Posts one comment on the surveyed ticket and changes nothing else.',
    route: null,
    writes: WRITES.ONE_COMMENT,
    lead: 'You are looking at a codebase as a place, before a task starts. The task below is not your job, and you are not reviewing anyone\'s work. Your job is the codebase\'s side of the question: what this task will do to the place it lands in.',
    label: 'Survey (place)',
    grounding: 'none',
    signals: {
      coreOutcome: 'A read-only forecast of what this task will do to the codebase as a place, posted as one comment on the surveyed ticket at the named base',
      signals: [
        'Read at the base the heading names, with nothing after it: no later commits, tickets, comments or reports, and no reviews or maps of the codebase\'s shape',
        'Says where the task lands and whether that part of the place is getting better or worse, from what is visible',
        'Names what the obvious way would add, move, tangle, leave without a home or leave in two places, and what else would have to learn about it',
        'Names what would leave the place better at a cost this task could carry, and what is not this task\'s to carry',
        'One comment on the surveyed ticket, headed with the base; no code, branch, pull request, ticket or Linear state changed',
        'Under 500 words'
      ],
      readinessCheck: 'Is the comment read-only, at the named base, under its word limit, and on the surveyed ticket?'
    },
    intent: [READING],
    contract: null,
    catalogue: { group: 'more', line: 'survey-place: Sent by the look-first route (after survey-task) or by hand, never by the selector. Read-only forecast of the codebase as a place: where the task lands, what the obvious way would add, move or tangle, and what would leave the place better; posts one comment on the surveyed ticket and changes nothing else' }
  },
  // LIN-4437: sent by code after an approving review, never by the selector. Its lead is the second paragraph of the
  // piloted blind-read prompt (docs/plans/survey/blind-read-prompt.md at #2407); its first, the repository line, opens the process.
  'blind-read': {
    name: BLIND_READ_KIND,
    category: 'universal',
    description: 'Sent by code after an approving review, never by the selector. A blind read of the current landing\'s pull request(s) before merge: whether the change left its area ' + BLIND_READ_VERDICT_PROSE + ', and its finds sorted three ways. Reads only the diff, the code at its merge-base and head, and the area registry; posts one comment on the ticket and changes nothing else.',
    route: null,
    writes: WRITES.BLIND_COMMENT,
    lead: 'You are reading one change blind, before it merges. Not whether it does its job: whether the code it leaves behind in its area is in ' + BLIND_READ_VERDICT_PROSE + ' shape for the next change. You didn\'t write it, you are not told why it was made, and you shouldn\'t try to find out.',
    label: 'Blind read',
    grounding: 'none',
    signals: {
      coreOutcome: 'The current landing read cold at its head against its merge-base: whether the change left its area ' + BLIND_READ_VERDICT_PROSE + ', with its finds sorted three ways, posted as one `' + BLIND_READ_HEADING + '` comment',
      signals: [
        'Read only the diff, the code at the merge-base and at the head, and the area registry: no pull request text, commit messages, ticket, area notes or plans',
        'One verdict word, ' + BLIND_READ_VERDICT_LIST + ', with a reason naming what the change made better and what it made worse, with their files',
        'Each find sorted into exactly one class: inside the area and fix-sized, inside but larger, or outside the area',
        'One comment on the named ticket, its first line exactly `' + BLIND_READ_HEADING + '`, naming every PR of the landing by full URL and no other; nothing else changed',
        'With no PR on the landing, nothing read or posted, and the run ended `[skipped]`'
      ],
      readinessCheck: 'Is there one `' + BLIND_READ_HEADING + '` comment with one verdict word and a two-sided reason, naming exactly the landing\'s PRs, read from the code alone?'
    },
    intent: [BLIND],
    contract: null,
    catalogue: { group: 'more', line: 'blind-read: Code sends it after an approving review, never the selector. Reads the ticket\'s current landing PR(s) cold, before merge (only the diff, the code at its merge-base and head, and the area registry): whether the change left its area ' + BLIND_READ_VERDICT_PROSE + ', with its finds sorted three ways; posts one `' + BLIND_READ_HEADING + '` comment, whose shape the proxy checks' }
  }
};
