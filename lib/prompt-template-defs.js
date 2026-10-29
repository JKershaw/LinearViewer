/**
 * Prompt Template Definitions
 *
 * Maps Linear labels to AI prompt generator functions.
 * Each template has a name, category, description, and generate() function
 * that produces a formatted prompt string from issue data and context.
 *
 * Template categories:
 * - 'work-issue': Issues that occur during active work (label-based)
 * - 'ready': Available when task is in Ready queue (state-based, no label needed)
 * - 'universal': Available for all issues
 */

import {
  PROMPT_CATEGORIES,
  COMPLETION_SIGNALS,
  WORK_ISSUE_LABELS,
  VIRTUAL_PROMPTS,
  formatHeader,
  formatWorkflow,
  formatReadOnlyWorkflow,
  formatInformOnlyWorkflow,
  formatSection,
  formatMultiLineSection,
  formatProject,
  formatParent,
  formatSiblings,
  formatChildren,
  formatSubtaskSummary,
  formatDiscussionReference,
  formatLabels,
  formatSuccessCriteria,
  formatIfBlocked,
  formatScaleToTask,
  formatPlanFidelityCheck,
  formatAttachmentPerceptionCheck,
  formatCiGateCheck
} from './prompt-formatters.js';
import { linearPriorityToCanonical, PRIORITY_UNKNOWN } from './providers/models.js';
import { extractPrincipleZeroTest } from './prompts/autopilot-manual.js';
import { isRequestChangesRound, buildImplementationWorkflow, buildRevisionSection } from './prompts/revision-brief.js';

/**
 * Render an issue's priority for the `triage` template without ever showing
 * a bare native (descending) integer — always annotated with the canonical
 * ascending `priorityLevel` scale, since triage's own reachable call site
 * (`enqueueFeedbackTriage`, routes/workspace-api-feedback.js) supplies only a raw
 * native `priority` int with no `priorityLabel` (LIN-2316). Canonical `0` is
 * the common fallback (`normalizeFeedbackPriority`, routes/workspace-api-feedback.js)
 * and reads as "already at the bottom" unless the scale note names it as
 * unknown/none rather than only explaining the top (LIN-2317).
 * @param {Object} issue
 * @returns {string}
 */
function formatTriagePriority(issue) {
  if (issue.priority === undefined || issue.priority === null) return 'Not set'
  const level = linearPriorityToCanonical(issue.priority)
  const label = issue.priorityLabel ? `${issue.priorityLabel} — ` : ''
  const scale = level === PRIORITY_UNKNOWN
    ? 'ascending, 0 = unknown/none, 4 = highest'
    : 'ascending, 4 = highest'
  return `${label}priorityLevel ${level} (${scale})`
}

// LIN-3279: how an agent shapes a ticket it files. Stated once; the filing
// prompts (close-out, retrospective-audit, periodicals) all use this string so
// later stages read a filed fix as a hypothesis, not finished research.
export const FOLLOW_UP_SHAPE = 'A filed ticket carries the problem, why it matters, acceptance, and file anchors. A fix idea is allowed but goes under an "Unvalidated idea" heading, so later stages treat it as a hypothesis.';

/**
 * Each stage's intent, the lead of its Goal (LIN-3299): what the work is for, what good
 * looks like, and the limits that define it. The one intent source per stage. Code adds
 * Scope and Authority after it (lib/prompts/stage-intent.js), so a lead does not repeat it.
 */
export const STAGE_LEADS = {
  blocked: 'Work has stalled. Find the real obstacle and clear it when it is yours to clear.',
  bug: 'Something behaves wrong. Find its cause for certain, with evidence, before anything is fixed; nothing ships without review.',
  plan: 'Decide how the change will be made, so it can be built without re-deciding anything. Lead with what the change is for, its cause when it fixes something, and what done looks like to the person who asked.',
  'look-into': 'Give a quick overview of this task and its context, so the reader can decide what to do next. Inform and summarize; make no changes or decisions.',
  triage: 'File the ticket so it routes correctly: its labels, priority, state and project (the project picks the repository). These updates are yours to make.',
  breakdown: 'Split the plan into pieces that each land alone and together finish the job. The subtasks and their dependencies are yours to define; keep the original task\'s intent and scope.',
  research: 'What this task needs is not known well enough to plan. Identify the key questions, find how this part really works, what was tried before and why, and recommend an approach the next stage can build on.',
  scoping: 'The ticket is unclear about its goal: settle what it should deliver and what done means. What is in and out of scope is yours to decide; read the code first, and flag for the human only product or intent questions.',
  design: 'Several shapes could work; choose the one that best serves what the task is for.',
  spike: 'It is open whether this approach can work here. Find out by trying, against the real code: the code is evidence, not the deliverable.',
  context: 'Whoever picks this up next needs its state: where it really stands and what should happen next. Inform and summarize; make no changes or decisions.',
  'plan-review': 'Before it is built, judge whether building this plan will solve the task\'s problem. Block only on what would make the build go wrong; everything else is a note for the builder.',
  implementation: 'Build it, prove it works, and open a PR that review can approve: the problem solved, not steps ticked off.',
  review: 'You check the work before it lands: is it complete, does it meet the requirements, and is the evidence that it works real? Verify against the requirements; adding new ones is not review\'s job.',
  'close-out': 'Land approved work. Finish it the way a skilled developer finishes their own: make the fixes review asked for, merge, see it land, do what the ticket needs after the deploy, and close the loop. A merge is hard to undo, so settled must mean settled.',
  'retrospective-audit': 'The work has merged. Does it do what it claims, and would its tests catch a regression? Audit that independently and report what you find; there is no need to re-litigate whether the change should have been made, or to re-verify overall correctness, which CI covers.',
  retro: 'Look back with the benefit of hindsight: did the work solve its problem, and what should be done next? Give an honest account and useful lessons, not blame or a re-litigation of decisions.'
}

/** The Goal (the stage's lead), then its process, which code prints as written. */
const goal = (kind) => ['## Goal', STAGE_LEADS[kind], '## Process']

/**
 * Prompt template definitions
 * Each template has:
 * - name: Display name for the prompt
 * - category: When prompt is available (pre-work, work-issue, ready)
 * - route: when the stage selector offers it (LIN-3300); its purpose is its
 *   STAGE_LEADS entry. No route: never offered (retro).
 * - generate: Function that takes (issue, context) and returns prompt string
 */
export const PROMPT_TEMPLATES = {
  'blocked': {
    name: 'blocked',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Analyze and resolve blockers preventing progress. Use when work is stalled due to dependencies, missing info, or technical issues.',
    completionSignals: COMPLETION_SIGNALS['blocked'],
    route: {
      when: 'The work cannot proceed: an open blocker relation, a person\'s hold that nothing later lifted, or a decision only a person can make.',
      whenNot: 'Every blocker is resolved, even if the description still says "blocked until".'
    },
    generate: (issue, context, featureFlags = {}) => {
      const principleZeroTest = extractPrincipleZeroTest()
      const sections = [
        formatHeader('Unblock', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.UNIVERSAL, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels)),
        formatDiscussionReference(issue),
        '',
        ...goal('blocked'),
        '**First**: Check the current status of all blocking dependencies. If the blocker is already resolved (e.g., the blocking issue is Done, the dependency is available, the information has been provided), skip the full analysis — just confirm the task is unblocked and recommend the next action.',
        '',
        'If the blocker is still active, analyze:',
        '- **Blocker Type**: Dependency, missing info, technical issue, external, or other',
        '- **Root Cause**: What\'s actually preventing progress',
        '- **Options**: 2-3 ways to unblock with tradeoffs',
        '- **Recommendation**: Best path forward with rationale',
        '',
        '**Record the blocker**: Capture the dependency as a `blocks`/`blocked-by` relationship between the tasks (not a label) and add a comment summarizing the analysis.',
        '',
        'Gate this analysis on Principle 0 and name the cost of doing nothing — apply the manual\'s **"The human\'s edge, and how to hand back"** (`docs/autopilot-operating-manual.md`, also served at `GET /api/proxy/autopilot/manual`) rather than re-deriving it here.',
        principleZeroTest
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  [WORK_ISSUE_LABELS.BUG]: {
    name: 'bug',
    category: PROMPT_CATEGORIES.WORK_ISSUE,
    description: 'Investigate and debug an issue. Use when you need to find root cause, reproduction steps, and potential fixes.',
    completionSignals: COMPLETION_SIGNALS[WORK_ISSUE_LABELS.BUG],
    route: {
      when: 'Unexpected behaviour whose cause is not yet confirmed, or whose cause a later comment refuted or relocated, or whose deciding experiment never ran.',
      whenNot: 'An investigation already names a root cause and fix direction that still stand at the end of the trail (`implementation`). The `bug` label alone does not mean investigation is owed.'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Investigate bug', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.WORK_ISSUE, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, [WORK_ISSUE_LABELS.BUG])),
        formatDiscussionReference(issue),
        '',
        ...goal('bug'),
        'Start by reading any prior investigation notes in comments. Confirm the reproduction steps and root-cause hypotheses still match what you can observe now. If the behavior has changed since investigation, note it and re-verify before proposing a fix.',
        '',
        'Investigation process:',
        '1. Reproduce the issue (document exact steps)',
        '2. Validate the acceptance witness: confirm the signal you will call "fixed" (the failing test, log line, assertion, or observable behavior) actually tracks the real outcome. A witness that can read green while the outcome is still wrong (or red while it is already right) must be validated or replaced before you optimize against it. A witness that genuinely tracks the outcome is a valid answer — state it explicitly.',
        '3. Identify likely causes:',
        '   - Run `git log --oneline -15 -- <affected file(s)>` and read recent commits; if 3+ commits touch the same file, that signals tight coupling or fragile code',
        '   - Check `git log --all --grep="<keyword from bug description>"` to see if this was fixed before (if no results, widen the keyword or skip — absence of results doesn\'t mean no prior fix)',
        '   - Search wider than nearby code: look for prior investigations or runs of the same subsystem, and prior diverging episodes — seed from both the technical lead and the meta-pattern ("this class of bug, last time the decisive experiment was X"), not only related fixes',
        '   - Examine the affected code paths for tight coupling or unusual patterns',
        '4. Debug systematically (add logging, trace execution)',
        '5. Confirm the cause before building the fix: name the single decisive experiment that disambiguates the leading hypothesis from its rivals, and run it. Evidence the cause is confirmed — not merely plausible — is required before you propose or hand off a fix. An investigation that proposes a fix while stating the decisive experiment was not run is NOT done; a genuinely confirmed cause is a valid answer and must be stated explicitly.',
        '6. Widen the model — isolated, or one of a class? Once the root cause is in hand, check whether the same pattern produces siblings: search for the pattern itself (the failure mode, a shared helper, a parallel code path), not only the symptom the ticket cites. A genuinely isolated issue is a valid answer — state it explicitly.',
        '7. Propose the fix at the cause: the change that removes it and reaches every instance step 6 found, refactoring where that simplifies the code. A change you would need to tell the team about first goes to the human as a ruling.',
        '8. Verify fix doesn\'t introduce regressions',
        '',
        '**When fixed**: Leave the `bug` label in place — moving the task to Done marks it resolved. The label is the lasting record that this was a bug (used by reports and prioritization), so do not remove it.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'plan': {
    name: 'plan',
    category: PROMPT_CATEGORIES.READY,
    description: 'Decide how a well-defined change will be made, so it can be built without re-deciding anything, and whether it fits one session. Use when the task is well-defined and you need to document the approach before coding.',
    completionSignals: COMPLETION_SIGNALS['plan'],
    route: {
      when: 'The knowledge is gathered and the shape decided, but there is no plan with a session-fit answer.',
      whenNot: 'A complete plan (surfaces, approach, session fit) is already in the description, a breakdown child\'s copied slice of an approved parent plan included: route on its session fit.',
      requires: 'Gathered knowledge and a decided shape.'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Plan', issue),
        '',
        '## Workflow',
        '',
        `1. **Start**: Set ${issue.identifier} status to "In Progress" in Linear (if not already)`,
        `2. **Fetch details**: Get full issue details for ${issue.identifier} in Linear, comments included`,
        `3. **Plan**: Write the plan (see Process below) into ${issue.identifier}'s description in Linear`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['plan'])),
        formatDiscussionReference(issue),
        '',
        ...goal('plan'),
        'Make no code changes here: the next session builds what this plan decides.',
        '',
        formatSubtaskSummary(context.children),
        '',
        // Attachment-perception discipline (LIN-872) — must be perceived before the
        // plan is drafted, since the plan itself is a grounding claim. Self-gates to
        // '' when there are no attachments. See lib/prompt-formatters.js formatAttachmentPerceptionCheck.
        formatAttachmentPerceptionCheck(context),
        '',
        '### If this pass is a revision',
        '',
        'If the comments hold a plan-review verdict (headed `### Plan Review Verdict`), this pass revises the plan already in the description. A finding is usually a sign about the plan, not just a point in it: a missed place means the behaviour was described too narrowly, and the revised description covers that place and whatever else the old one left out; a mechanism that failed review usually means the plan was deciding below its height. So a good revision is usually smaller: a test instead of a longer list, a narrower scope with the rest named as follow-up work, a behaviour and its witness instead of more prescribed code. Removing a step is a valid answer. The newest text has had the least scrutiny, so the revision is done when the whole plan reads true to its builder, not only the part that changed. Every finding is answered: fixed, or disagreed with and why. The description holds one current plan: replace the old block in place (for example through `POST .../description/replace`) and add a line saying what changed and which findings it answers. If the verdict put a question only the person who asked can settle, and no answer is in the comments yet, do not guess around it: park on that question (see If Blocked).',
        '',
        '### What a good plan is',
        '',
        'The plan\'s first reader is the person who builds it, starting fresh from it; after them come whoever checks the plan and whoever reviews the finished work against it. A good plan gives them its decisions and the reasons, in plain language, and leaves the code to the code. It is done when the builder could build it without re-deciding anything, and someone holding the finished work beside it could tell whether it was built.',
        '',
        'It opens with the problem in the asker\'s terms and what done will look like to them: the ticket\'s Done-when or, if it has none, one written from what they asked and marked as the plan\'s own. If what the ticket asks for has drifted from what it is for, it says so before building on it. It says which way the change goes and why, with the alternatives set aside, a line each. A route around the cause leaves a workaround that every later change here has to work around too, so a plan that takes one says what it leaves unsolved, why the cause cannot be fixed here, and which ticket tracks it.',
        '',
        'A change is finished when the behaviour is right everywhere it lives, not just where the ticket pointed. Say how you know you\'ve found every place. The same behaviour often lives under another name, on a parallel path, split between server and client, or in tests and docs that describe today\'s shape. The plan names the behaviour plainly enough that anyone who meets one of its places can tell it belongs, and puts each place it found in scope or out; a place left out says why, and which ticket will handle it. The strongest answer is a test of the behaviour that fails wherever it is still wrong; next, a search someone else can repeat. Where reading the code cannot tell you, because the places are code not yet written or data in production, say so and name what will catch the rest. A search that finds more than you planned for is a finding, not something to trim: "these are the places I found, and this will catch any others" serves the builder better than a list that looks complete and is not.',
        '',
        'Each fact the plan relies on is true at HEAD and read from the source that is authoritative for it, not a summary, a cache or an earlier account. Where research ran, the plan builds on it and cites what it relies on (a comment, file:line or sha) rather than restating it, but the claims are the plan\'s own: what it takes from research has been checked against the code, everything research found that the change must handle is in the plan or set aside with a reason, and where it disagrees with research it says why. Files that keep changing carry constraints their text does not show; the plan carries the ones that bear on this change, read from `git log --oneline -15 -- <files>`.',
        '',
        'The plan names the two or three likeliest ways the change breaks, and gives each behaviour it promises a witness: a test or observation that fails before the change and passes after. Where it loosens a validation, a contract or a guard (a widened input, a dropped check, a softened assertion, a gate made advisory), the witnesses include a test that tries what the guard was there to stop.',
        '',
        'It settles what is expensive to change once code exists: the shape, the boundaries and how parts that share a path or state interact, which data each part reads, the order of landing, what is left out. It leaves to the builder what a test settles in minutes, such as an exact regex, a comparison or a function body, stated as the behaviour required and its witness: code written as prose has nothing to run it, so its mistakes stay hidden until it is code. A small change to one place gets a short plan: the file, the change, its witness and a line on scope. A short ticket is not always a small change, though; renaming a shared identifier "everywhere" reaches many places.',
        '',
        'If research marked a refactor `refactor required` and named the cause it removes or the line here that uses it, that refactor is its own blocking subtask and lands first, so the change is built on it rather than beside it. One that removes no cause here, that nothing here uses, or that makes other callers pay for this feature\'s need is folded in, scoped down or noted. The plan says whether the work fits one focused session, meaning one pass at building and verifying it without losing track of its edges. If you can name specific things one session would lose track of, it needs more than one, split at seams where each piece lands and is verified on its own; if you are reaching for examples, it fits one. Some plans deserve a second reader before anything is built: those that need more than one session, route around a cause tracked elsewhere, loosen a validation, contract or guard, or touch credentials, merge rules or the dispatch contract. Mistakes in these are hard to undo, or easy to miss once built. The plan says whether it is one of them; most are not, and go straight to the builder.',
        formatIfBlocked()
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'look-into': {
    name: 'look into',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Get a quick overview and context for any task. Use when you want to understand what a task involves before deciding next steps.',
    completionSignals: COMPLETION_SIGNALS['look-into'],
    route: {
      when: 'Someone wants a quick overview before deciding anything.',
      whenNot: 'The trail already shows the next working stage.'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Look into', issue),
        '',
        formatInformOnlyWorkflow(issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, [VIRTUAL_PROMPTS.LOOK_INTO])),
        formatDiscussionReference(issue),
        '',
        ...goal('look-into'),
        'Summarize:',
        '- What the task is asking for',
        '- How it fits into the broader project',
        '- Current status and any blockers',
        '- Recommended next action (which prompt type to use next)'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'triage': {
    name: 'triage',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Review and update task metadata: labels, priority, assignee. Use when a task needs organizational cleanup before work begins.',
    completionSignals: COMPLETION_SIGNALS['triage'],
    route: {
      when: 'The ticket\'s labels, priority, state or project are wrong or missing.',
      whenNot: 'What to build is unclear (`scoping`).'
    },
    generate: (issue, context, featureFlags = {}) => {
      const currentLabels = formatLabels(issue.labels) || 'None'
      const sections = [
        formatHeader('Triage', issue),
        '',
        '## Workflow',
        '',
        `1. **Fetch details**: Get full issue details for ${issue.identifier} in Linear`,
        '2. **Analyze**: Review against the criteria below',
        '3. **Update Linear**: Apply recommended changes in Linear',
        '',
        '## Current State',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Status', issue.state?.name || 'Unknown'),
        formatSection('Priority', formatTriagePriority(issue)),
        formatSection('Assignee', issue.assignee?.name || 'Unassigned'),
        formatSection('Labels', currentLabels),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatDiscussionReference(issue),
        '',
        ...goal('triage'),
        'Triage is organization, not research: identify what the user is asking for and any evidence needed, but do not conduct or present analysis as completed research — the research step follows separately. Findings are observations and open questions, not conclusions.',
        '',
        'Triage preserves scope. You may change only labels, priority, state, and project — do not rewrite the task\'s description or otherwise change its scope, and do not create follow-up tasks or subtasks. Findings stay observations in a comment, never new work items; scope changes belong to the scoping, plan, and breakdown steps.',
        '',
        '### Label Selection Guide',
        '',
        'Labels indicate **current state**, not future needs.',
        '',
        '**Available Labels:**',
        `- \`${WORK_ISSUE_LABELS.BUG}\`: Unexpected behavior discovered that needs investigation and fix`,
        '',
        '**Label Rules:**',
        `- Add \`${WORK_ISSUE_LABELS.BUG}\` when unexpected behavior is found`,
        '- If work is stuck, record the blocker as a `blocks`/`blocked-by` relationship to the blocking task (there is no `blocked` label)',
        '',
        '### Other Metadata',
        '',
        '- **Priority**: Is the current priority appropriate given importance and urgency? Set it via the provider-neutral `priorityLevel` field (ascending, 4 = highest).',
        '- **State**: Is it in the right workflow state for its current progress?',
        '- **Project**: Is the task in the correct project? List the workspace projects, compare against the task\'s scope, and move or assign it when it is unassigned or mis-filed.',
        '',
        'For each change, provide reasoning. Apply changes directly in Linear.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'breakdown': {
    name: 'breakdown',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Break a large or vague task into smaller, actionable subtasks. Use when task scope is unclear or too big to start.',
    completionSignals: COMPLETION_SIGNALS['breakdown'],
    route: {
      when: 'The plan needs multiple sessions, or the description lays out phases that each land on their own, and no subtasks cover them yet.',
      whenNot: 'Steps that land together as one PR, or one PR in ordered commits (`implementation`); subtasks already cover the scope (`defer`).',
      requires: 'A plan or explicit phases, and an Approve from any plan-review that was due.'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Break down', issue),
        '',
        `## Workflow

1. **Start**: Set ${issue.identifier} status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for ${issue.identifier} in Linear
3. **Analyze**: Complete the goal below
4. **Update Linear**: Create subtasks, add blocked-by relations, then add summary comment`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Existing Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['breakdown'])),
        formatDiscussionReference(issue),
        '',
        ...goal('breakdown'),
        'Start by reading the plan in the description. Confirm the surfaces, any dependency arrows, and the approach/files each surface\'s plan section names still reflect the current codebase. If the plan has drifted, stop and recommend re-planning before decomposing.',
        '',
        'Read the surfaces the plan enumerated and any dependency arrows it drew between them. Create one subtask per surface (unless the plan groups several small surfaces together). Each subtask\'s `blocked-by` relations are exactly the surfaces the plan shows it depending on — copy the arrows directly. A surface with no incoming arrows has no `blocked-by` relations, which is correct: the resulting subtask graph matches the plan\'s shape because the arrows *are* the structure.',
        context.children?.length > 0 ? 'Review existing subtasks; if any already cover a surface, reuse them instead of creating new ones.' : '',
        '',
        '### Creating Subtasks',
        '',
        'Before writing the subtask descriptions below, check THIS TICKET\'S OWN comment trail — the ticket being decomposed, not the \'Parent Task\' section rendered above in Context (that names a different, grandparent ticket) — for a `### Plan Review Verdict` of **Approve** on the plan being decomposed. If no such Approve is on record on this ticket\'s own trail, create the subtask with only a plain acceptance-criteria description (today\'s existing wording): none of bullets (a)–(e) below apply, and the subtask is expected to route through `research`/`plan` normally.',
        '',
        'For each surface, create a subtask in Linear with:',
        '- A clear title naming that surface (e.g., "File browser: rename flow")',
        '- Description with acceptance criteria for this surface — the child sees its parent only as a title, so say where the parent\'s scope and design can be read',
        '- `parentId` linking to the parent issue',
        '- `projectId` inherited from parent',
        '- `stateId` set to "Todo"',
        '',
        'When this ticket\'s own plan was Approved, the subtask description carries this surface\'s slice of the approved plan instead of acceptance criteria alone:',
        '- (a) This surface\'s slice of the approved plan — the specific files, the approach, and the testing strategy the plan\'s own surface entry named, not acceptance criteria alone',
        '- (b) `Session fit: fits one session` (each breakdown-produced subtask is single-session by construction, since the plan already decomposed to that grain — if a surface genuinely does not fit one session, leave this line for a fresh `plan` pass to answer honestly rather than copying a false claim)',
        '- (c) `Plan-review due: no — covered by <parent identifier>\'s approving plan-review (comment <id>, rev <N>)`, with the actual comment id and revision number cited from this ticket\'s own approving verdict (the one the precondition found)',
        '- (d) The grounding commit SHA(s) the plan cited',
        '- (e) A line saying the parent\'s approved plan is this surface\'s starting point, and where to read it in full: follow it, and where the code shows it wrong, change course and say so on the parent',
        '',
        '### After Creating All Subtasks',
        '',
        '1. Create the `blocked-by` relations from the plan\'s arrows (see above)',
        '2. Add a summary comment to the parent listing the subtasks with the session-fit reason from the plan'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'research': {
    name: 'research',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Investigate unknowns, explore options, and gather information. Use when you need to understand a problem before implementing.',
    completionSignals: COMPLETION_SIGNALS['research'],
    route: {
      when: 'Doing the work well depends on knowledge not yet gathered: how the code behaves today, an unpinned external dependency, history or prior art, or every place a change must reach when the ticket names them only by description. Also when the ticket prescribes research as its method. In a close call, prefer research.',
      whenNot: 'The task is small and obvious, or the findings and a chosen approach are already on the trail as completed prep (a research or investigation write-up, or a plan an approving plan-review covers); a fix the filer wrote in the description is a hypothesis, not prep.'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Research', issue),
        '',
        `## Workflow

1. **Start**: Set ${issue.identifier} status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for ${issue.identifier} in Linear
3. **Analyze**: Complete the goal below
4. **Update Linear**: Add exploration notes as comment, then update description with key findings`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, ['research'])),
        formatDiscussionReference(issue),
        '',
        ...goal('research'),
        context.comments?.length > 0 ? 'Review the prior research recorded on the task and build on existing findings.' : '',
        '',
        // Scale-to-task (lower bound): a small, well-scoped question gets a short
        // investigation; don't over-research a one-file change (formatScaleToTask).
        formatScaleToTask(),
        '',
        'Research methods (use what the questions call for):',
        '- Read the relevant documentation for any library, API, or external system the approach depends on',
        '- Check how similar problems were solved here before — search the codebase and run `git log` on related areas, and widen beyond nearby code to prior investigations or runs of the same subsystem and prior diverging episodes (seed from both the technical lead and the meta-pattern, "this class of problem, last time the decisive experiment was X"), not only related fixes',
        '- Pin the measurement: if the work will be judged by a metric or signal, confirm it actually tracks the real outcome before optimizing against it — a measurement that can read green while the outcome is wrong (or red while it is right) must be validated or replaced first. A measurement that genuinely tracks the outcome is a valid answer and must be stated explicitly.',
        '- Validate feasibility: if an approach is unproven, confirm it actually works (a small spike) before recommending it',
        '',
        'Document your findings:',
        '- Key discoveries and insights',
        '- Options considered with pros/cons',
        '- Recommended approach for the plan that follows (so planning can score a validated option, not an assumption)',
        '',
        // Audit the Layers (LIN-740) — reframes the prior Horizontal Obligations +
        // Attack-Your-Own-Research pair into ONE exhaustive audit: enumerate every layer the
        // change touches, brief how each is done HERE (citing sources), then argue the set is
        // CLOSED. Deliberately generative, NOT a fixed category list — a list anchors the
        // agent on the named items and it skips the unnamed one, the exact gap that bit
        // LIN-735/LIN-295/LIN-579. The four obligation axes survive as per-layer SEED
        // reasoning, not a checklist. Sits under formatScaleToTask() above so small/
        // single-surface tasks pay no audit tax. Shares discovery ground with the plan
        // template's completeness standard (LIN-4021) but lives at a different step — cross-reference,
        // not a merge.
        '### Audit the Layers',
        '',
        'This applies when the change touches shared structure, more than one surface, or data the system already models. For a genuinely small, single-surface change — a typo, a constant or config edit, a one-file change — record the file and the fix and go straight to the Surface Assessment below.',
        '',
        'Otherwise, audit the whole landscape this change lands in before recommending an approach. Completion here is measured by *coverage*, not speed: take the time to be exhaustive — an extra pass that reads more source costs the same human attention, and a thorough brief of the layers you found is worthless if a layer you never looked for is the one that breaks.',
        '',
        '1. **Enumerate the layers.** List every part, seam, or module this change touches or must stay consistent with — not only the obvious one the ticket names. The same behaviour, rule, or concept is often represented in more than one place: under a different name, in a parallel code path, split across server and client, mirrored in a sibling provider or feature, or restated in a published contract. Search for the *concept* — what a caller or user observes — not only the symbol the ticket cites; a clean search for the cited symbol is not proof you have found them all.',
        '',
        '2. **Brief each layer, and cite your sources.** For every layer on the list, read the actual code, docs, and history, then write a short brief: how it is done here today, the patterns, conventions, and normalisations it follows, and what a change must keep consistent for it to land cleanly. **Cite a source for each claim** — `file:line`, a doc path, or a commit — so each statement is something you verified rather than assumed. An uncited claim is a guess; go and read it. As you brief each layer, characterise not just *what you are building* but *what it must hold true against* in the system it lands in. Axes worth deriving per layer (seed examples, not a fixed checklist):',
        '- Against existing structure — what it must reuse rather than duplicate (types, models, helpers, or state that already represent this).',
        '- Against parallel surfaces & sources of truth — what it must stay consistent with across sibling features that follow the same rule, and keep in sync across every representation of the same data (schema / contract / API / client & server copies).',
        '- Against failure & lifecycle states — what it must stay correct under: partial failure, delete, requeue, retry, and other non-happy-path transitions.',
        '- Against past behaviour — what it must preserve when it changes existing code (behavioural equivalence in a refactor).',
        '',
        'These four axes are seed examples, not the whole set — derive the axes the task at hand actually has (the decisive one may be concurrency, auth scoping, cache invalidation, rate limits, …). Aim for completeness of *reasoning*, not of a list: spend depth where the answer is uncertain, not on naming every axis to tick a box.',
        '',
        '3. **Close the set — attack your own audit.** Before writing your recommendation, turn on your own layer list: what existing structure, sibling surface, sync obligation, failure path, or prior behaviour did you NOT check? What did you assert without verifying? State the layer set as *complete* and back it: show the search that would have surfaced a missed sibling and what it returned, and name what would have to be true for the set to be wrong. A confident "that is everything" is not closure — the search that came back empty is. Resolve or explicitly record anything this turns up before recommending.',
        '',
        // Name the Classes (LIN-1871, revising LIN-1873; LIN-4021): research names the
        // behaviour's places, so the plan and plan-review can hold every place to the same standard.
        '### Name the Classes',
        '',
        'Where this task touches a **class** — every call site, every lane, every consumer, every shape — name it, say how you bounded it, and list every member you found. Bounding is reasoning: read the state machine, walk the callers, check what has landed since the grounding sha, or run a grep where a grep is the honest tool — a query is one way to bound a class, not the only way.',
        '',
        'A class you could not bound is a first-class answer: name it as such, and say why (the two recurring shapes: a destination that does not exist yet in the current source tree, or a population that is production data rather than source). Do not invent a bound to fill the slot.',
        '',
        'Record each class, its bound, and its members in the description alongside your findings. The plan builds on this list and re-checks what it relies on: every member you found ends up in or out of its scope, and your list is evidence for the plan, not a contract.',
        '',
        // Surface Assessment. Gated on necessity, not availability (LIN-397):
        // only a verdict passing the consumer and who-pays tests becomes a separate
        // blocking subtask at the plan step.
        '### Surface Assessment',
        '',
        'End your research with an explicit Surface Assessment. The question is not "would a refactor make this land better?" — on most code something could be cleaner — but "is the feature\'s shape demanding a structural change?": implementing cleanly would mean fighting the current structure, and not refactoring means accreting workarounds. The answer must be explicit — not implied — so the plan step can act on it.',
        '',
        // Symmetric duplicate-representation trigger (LIN-697): the gate above catches
        // "fighting the structure" but not "quietly adding a second representation of
        // something already modelled" — the Audit-the-Layers reuse-axis blind spot. This
        // makes that case an explicit refactor-required signal too. (Same axis as the plan
        // template's completeness standard, LIN-4021, different step — coherence cross-ref, not a merge.)
        'One shape always counts as demanding a structural change: if your approach would introduce a SECOND REPRESENTATION of something the system already models — a parallel type, table, state field, or source of truth for data that already exists — the verdict is `refactor required` (reuse or extend the existing model), not `lands cleanly`. A clean-looking local addition that duplicates an existing model is exactly the blind spot this catches.',
        '',
        'A `refactor required` verdict must pass two evidence tests, each answered by citing lines:',
        '- **Cause-or-consumer test:** show the refactor removes this task\'s confirmed cause, or cite the line in this task that calls the new seam. Neither means speculation — it belongs with its future consumer.',
        '- **Who-pays test:** for each consumer the refactor touches, state whether it is a beneficiary (comes out simpler, corrected, or unchanged) or a bystander paying a tax (more runtime cost, more complexity, or new obligations for a need that is not theirs). Cite what each bystander newly pays. An unjustified bystander tax means the refactor is mis-scoped — scope it down. If a small named tax buys a large simplification, argue it explicitly; an unnameable tax is the smell.',
        '',
        'Size is not a rejection criterion: a demanded refactor that does not fit the session is sequenced (separate blocking subtask, own sessions), not shrunk. Effort is cheap; speculation and bystander tax are not.',
        '',
        'Format: `Surface Assessment: [lands cleanly]` OR `Surface Assessment: [refactor required: <scoped change> — reason: <the cause it removes, or where this task calls it>]` OR `Surface Assessment: [improvement noticed, not required: <land it inline/scoped, or note it — no separate subtask>]`',
        '',
        'Describe the specific scoped change (not a general tidy-up), or state clearly that no preparation is needed. Only a `refactor required` verdict becomes a separate blocking subtask at the plan step — it is not absorbed into implementation. An improvement that fails either evidence test still gets named, under the third verdict, and is landed inline or recorded — never spun into blocking work.',
        '',
        // Attachment-perception discipline (LIN-872) — the recommendation above is a
        // grounding claim, so every attachment must be perceived before it is made.
        // Self-gates to '' when there are no attachments. See
        // lib/prompt-formatters.js formatAttachmentPerceptionCheck.
        formatAttachmentPerceptionCheck(context),
        '',
        '**Output:**',
        '- **Comment**: Full research notes including the per-layer audit (one brief per layer, with sources cited), the exploration process, and the Surface Assessment',
        '- **Description**: Key findings, the class list, conclusions, and recommended approach'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'scoping': {
    name: 'scoping',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Define clear boundaries, assumptions, and success criteria. Use when requirements are ambiguous or scope creep is a risk.',
    completionSignals: COMPLETION_SIGNALS['scoping'],
    route: {
      when: 'The goal or its boundaries are in dispute: what to build is a product or intent question that reading the code would not settle.',
      whenNot: 'The gap is knowledge to gather, such as how the code behaves, a platform or dependency, or history, even when the ticket is terse (`research`); only the solution shape is open (`design`); unexpected behaviour (`bug`).'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Define scope for', issue),
        '',
        `## Workflow

1. **Start**: Set ${issue.identifier} status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for ${issue.identifier} in Linear
3. **Analyze**: Complete the goal below
4. **Update Linear**: Update issue description with finalized scope`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Work', formatSiblings(context.siblings)),
        formatMultiLineSection('Existing Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['scoping'])),
        formatDiscussionReference(issue),
        '',
        ...goal('scoping'),
        'If the ticket is aimed at a symptom of something deeper, say so.',
        'Document in a structured format suitable for the issue description:',
        '- **In Scope**: What this task will deliver',
        '- **Out of Scope**: Different problems excluded; the cause of this one is never out of scope',
        '- **Assumptions**: What we\'re assuming to be true',
        '- **Success Criteria**: How we\'ll know when it\'s done',
        '- **Open Questions**: Unresolved items needing clarification'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'design': {
    name: 'design',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Create a technical design with multiple approaches and tradeoffs. Use for complex features needing architectural decisions.',
    completionSignals: COMPLETION_SIGNALS['design'],
    route: {
      when: 'Two or more materially different solution shapes are viable and nothing has committed to one.',
      whenNot: 'One obvious shape, an approach a research write-up or approved plan committed to, landed work, or knowledge still ungathered (`research`).'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Design', issue),
        '',
        `## Workflow

1. **Start**: Set ${issue.identifier} status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for ${issue.identifier} in Linear
3. **Analyze**: Complete the goal below
4. **Update Linear**: Add full design analysis as comment, then update description with chosen approach`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Existing Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['design'])),
        formatDiscussionReference(issue),
        '',
        ...goal('design'),
        'Start from the problem, not any solution the ticket proposes: what causes the need, and what would a good outcome be? Lay out the genuinely viable shapes, usually two or three; if only one, say so and hand on to planning. When fixing the underlying cause or a refactor is the real option, put it on the table. For each: how it works, its cost to build and to live with, its risks, and its fit with what exists (reuse beats a second way of doing the same thing).',
        '',
        'Recommend one, say why, and say what would change your mind.',
        '',
        '**Output:**',
        '- **Comment**: Full design analysis with all approaches evaluated',
        '- **Description**: Summary of chosen approach and key implementation details'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'spike': {
    name: 'spike',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Time-boxed exploration to answer specific technical questions. Use when you need proof-of-concept or feasibility assessment.',
    completionSignals: COMPLETION_SIGNALS['spike'],
    route: {
      when: 'One sharp feasibility question decides the approach, and a small proof against the real code can answer it.',
      whenNot: 'The gap is broader understanding (`research`), or the approach is known to work.'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Spike', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.UNIVERSAL, issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Labels', formatLabels(issue.labels, ['spike'])),
        formatDiscussionReference(issue),
        '',
        ...goal('spike'),
        'Write the question sharply, with the result that would mean yes and the one that would mean no. If it is really several, pick the one that decides the rest. Build just enough to answer it against the real code and dependencies: a proof of concept that stubs out the hard part proves nothing. Keep to one focused session; at the limit, stop and report what you learned and what is still unknown. If the problem sits somewhere other than the ticket assumed, say so.',
        '',
        'Report answer first: go, no-go, or go with conditions; then the evidence (what you ran, what happened), the risks, and what is still unknown. Leave the code visible (a branch, or the key snippet in your comment), not landed.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'context': {
    name: 'context',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Synthesize current state and history of a task. Use when joining a task mid-way or after a long gap.',
    completionSignals: COMPLETION_SIGNALS['context'],
    route: {
      when: 'Someone is picking the task up after a gap and needs to know where it stands.',
      whenNot: 'The trail already shows the next working stage.'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Get context for', issue),
        '',
        formatReadOnlyWorkflow(issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['context'])),
        formatDiscussionReference(issue),
        '',
        ...goal('context'),
        'Gather context from:',
        '- The task description and discussion history',
        '- Related code changes (git history)',
        '- Sibling and parent task status',
        '',
        'Summarize:',
        '- **Current State**: Where things stand now',
        '- **Completed**: What\'s already done, and how that is known',
        '- **Remaining**: What still needs to happen',
        '- **Key Decisions**: Important choices made, and any since overturned',
        '- **Next Steps**: Recommended actions to proceed'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  // Verifier of the `plan` template's grounding claims, one stage before
  // `implementation` (LIN-1602 / LIN-1600 Phase 1). Mirrors `review`'s
  // architecture in miniature: read-only, judging the plan against the four qualities
  // of a plan ready to build, then the same
  // Approve / Request Changes / Needs Discussion vocabulary. `name` MUST equal
  // the template key — `parseRecommendedAction` reads the emitted display name
  // and `_DISPATCH_KIND_BY_ALIAS` maps it back to the kind (the `close-out`
  // precedent). The body deliberately emits no literal tracker name of its own;
  // every such mention comes from the shared formatters, which keeps the
  // capability post-pass (applyPromptCapabilities) a no-op on the Linear path.
  'plan-review': {
    name: 'plan-review',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Judge a plan with fresh context before implementation starts: will building it solve the task\'s problem, with its premise, safeguards and shape checked against the code as it stands now, then issue a verdict. Use when a plan is documented but not yet implemented.',
    completionSignals: COMPLETION_SIGNALS['plan-review'],
    route: {
      when: 'No plan-review since the plan last changed, and the gate is met: the plan says "plan-review due: yes", or it needs multiple sessions, routes around a named contract gap, relaxes a validation, contract or guard, or touches credential, merge-rule or dispatch-contract surfaces.',
      whenNot: 'The plan says "plan-review due: no" and nothing in it contradicts that (a breakdown child covered by its parent\'s approving plan-review included), or the work has landed.',
      requires: 'A plan in the description.'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Plan-review', issue),
        '',
        formatReadOnlyWorkflow(issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        // Subtasks matter here: a prerequisite refactor is sequenced as a
        // separate blocking subtask, so the verifier must be able to see them.
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['plan-review'])),
        formatDiscussionReference(issue),
        '',
        ...goal('plan-review'),
        // The comment's header and verdict line are the stage contract's
        // (lib/prompt-contract.js, LIN-3292): the round-trip instrument reads the verdict
        // beside the word "Verdict", and the header tells this verdict from review's.
        'Read the task\'s goal and Done-when first, then the plan, then the research and comments it rests on. Judge the plan against what the person who asked needs; where the plan wrote its own Done-when, check it against what they asked before holding the plan to it. Read the code the plan depends on as it stands on main now, including what has landed since the plan was written and the recent history of the files it touches (`git log --oneline -15 -- <files>`): code that keeps changing carries constraints its text does not show. Take nothing the build stands on from the plan\'s word when you can check it yourself.',
        '',
        '### What a plan ready to build looks like',
        '',
        '**Its premise is true.** The cause it names is the cause, and each fact it inherits, from research, a parent plan, a summary, a cache or a house convention, is true for this use and read from the source that is authoritative for it. A wrong premise survives every later check, because everything after it is built on it.',
        '',
        '**It solves the whole problem.** Built as written, the plan leaves no part of the task\'s problem unsolved and breaks nothing that works today. A change is finished when the behaviour is right everywhere it lives, not just where the ticket pointed, and the plan says how it knows it has found every place. Judge that reasoning. If the plan describes the behaviour rightly, a place inside that description that it did not list is a note: the description already puts it in scope. If you find a place the description leaves out, the finding is the description: say how the behaviour should be described, and give every other place that description reaches that you can find, so the plan is corrected whole rather than one place at a time. Where the places cannot all be found by reading code, a plan that says so and names what will catch the rest has given a sound answer; ask for a search only when you can say what search.',
        '',
        '**Its safeguards hold.** A step that loosens a validation, contract or guard, or touches credentials, secrets or production, is ready only when the plan names what keeps it safe: a test that tries what the guard was there to stop, or what else limits the harm. These steps are hard to undo, and often sit where no test runs. Replacing a test that pins the code\'s text with one that pins its behaviour is not a loosening if the new test lands first and fails with the guard removed; on a ticket about security guards, every loosening is held to the full standard.',
        '',
        '**Its shape fits the work.** A refactor the change needs is sequenced first rather than buried among the steps, and a refactor sequenced first is one something here needs. A plan that needs more than one session says so.',
        '',
        '### Blocking findings, and notes',
        '',
        'Write down everything you find. Then, as a separate step, decide which findings block; everything found is still reported, and deciding is labelling, not dropping. A finding blocks when the builder, following the plan, would build the wrong thing, leave part of the problem unsolved, or do harm before anyone could see it. A wrong detail that the plan\'s own witnesses would catch when the builder runs them is a note, even when you are sure of it; so is any correction the builder can make without changing what the plan decides, its shape, scope or approach. Write each note so the builder can act on it without you: what to do differently, and where. For example:',
        '- a runbook step that would print a production secret blocks;',
        '- a predicate that compares a string with a date, where the plan\'s witness test exercises it, is a note;',
        '- one more stale comment of a kind the plan\'s description already covers is a note.',
        '',
        'Do not manufacture doubt about a well-grounded plan. A plan that would build the right thing is approved, and a clean verdict is a few lines: what you checked, and that it holds.',
        '',
        '### A revised plan',
        '',
        'Start from what the last verdict asked: was each point answered, and does the answer hold? Then read the revised text as new work, because it has had the least scrutiny. When what you find sits in text added to answer an earlier finding, the question is whether the plan should carry that mechanism at all. Name the shape of the problem, such as a rule copied instead of called, a concept with no single owner in the code, or a step deciding detail the builder\'s test would settle. Then propose the smallest change that settles it, which may be removing the step or moving that piece into its own prerequisite ticket.',
        '',
        '### When the question is what the task should deliver',
        '',
        'Sometimes the disagreement is not whether the plan works, but what the task should deliver, or how complete is complete enough. That is a question for the person who asked, not a defect in the plan: the verdict is Needs Discussion, with the question put plainly and your recommendation.',
        '',
        '### Hand off',
        '',
        'You are read-only: post the verdict, and do not edit the plan, build it or file tickets. On Approve, the plan goes to `implementation` with your notes. On Request Changes, say what must change and why it matters to the task; on Request Changes or Needs Discussion, it goes back to `plan`.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'implementation': {
    name: 'implement',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Guide for active implementation phase. Use when research and planning are complete and coding is in progress.',
    completionSignals: COMPLETION_SIGNALS['implementation'],
    route: {
      when: 'A plan that fits one session, approved by any plan-review that was due; a small task whose one surface and change are already named; or the fix round after a code review requested changes.',
      whenNot: 'No committed scope: a long or legible description is not a plan (`plan` or `research`). Landed work (`review`); a review Approve, plain or conditional: close-out makes its fixes. A bug cause that is refuted or unconfirmed (`bug`).',
      requires: 'Gathered knowledge, a decided shape and committed scope.'
    },
    generate: (issue, context, featureFlags = {}) => {
      // A fix round continues the reviewed PR (LIN-3309); code reads the review
      // verdict, so routed, pinned and fixed dispatches all get the revision brief.
      const fixRound = isRequestChangesRound(context?.comments || []);
      const sections = [
        formatHeader('Implement', issue),
        '',
        buildImplementationWorkflow(issue, fixRound),
        buildRevisionSection(context?.comments || [], fixRound),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['implementation'])),
        formatDiscussionReference(issue),
        '',
        ...goal('implementation'),
        'Start by reading the plan in the description (if present). Confirm the files it names still exist and the surfaces still map to the current code. If drift changes the approach, stop and recommend re-planning; smaller drift, adapt and say so.',
        '',
        formatPlanFidelityCheck(),
        '',
        '### Implementation Guidelines',
        '',
        '1. Follow the plan and the research it came from (see the fidelity check above)',
        '2. Each change should be self-contained: specify both the behavior **and** its cleanup/teardown contract (not just the happy path)',
        '3. For new dependencies being integrated for the first time, verify all required setup beyond just API calls',
        '4. Write tests for new/changed behavior — cover intended effects, unintended side effects, and any interactions the plan flagged',
        '5. Verify all tests pass before completing',
        // Acceptance-witness discipline, extending the bug template's witness rule.
        '6. Before trusting a test you authored or changed to guard this change as your acceptance witness, observe it fail: run it against the unfixed code or the un-implemented path and capture the actual failing output — not an assertion that it would fail. Where a genuine failure is impossible (e.g. a test pinning pre-existing behavior), do the mutation equivalent instead: break the behavior, watch the test fail, then restore it — and record what you saw. This extends the acceptance-witness discipline the bug/investigate template already requires for a fix\'s signal to the tests you write here; a test that truly cannot be made to fail is a valid witness only if you state that explicitly and say why.',
        '7. Fix at the cause; keep changes focused on this task\'s problem',
        '8. Do not trust a "behavior-preserving" or "refactor" label: enumerate the specific behaviors of the old code (checks, error strings, conditions, query shape) and verify each still holds — ideally via a characterization test written before the change. A silent behavioral change on a shared path is a defect even if the new behavior is arguably better; surface it.',
        '',
        '### Shared Boundaries',
        '',
        'Before changing a shared system, find its dependents in the codebase. When multiple behaviors converge on the same function, component, or state, ensure each behavior stays isolated and document any non-obvious interactions in code comments. If the plan identified cross-cutting concerns on shared surfaces, they must appear in the relevant implementation step — not deferred to review.',
        formatCiGateCheck(),
        formatIfBlocked()
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'review': {
    name: 'review',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Comprehensive review checklist for completed implementation. Use when code is ready for CI/CD and final review.',
    completionSignals: COMPLETION_SIGNALS['review'],
    route: {
      when: 'Work has landed (a PR or completion summary on the trail, or every subtask done) and no code review has run on it since.',
      whenNot: 'A code review already approved the unchanged work (`close-out`) or requested changes not yet addressed (`implementation`).',
      requires: 'Landed work.'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Review', issue),
        '',
        formatReadOnlyWorkflow(issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, ['review'])),
        formatDiscussionReference(issue),
        '',
        ...goal('review'),
        'Start by reading the plan and any implementation notes in comments. Confirm the scope recorded there matches what has actually changed on disk or in Linear. If implementation overran the plan\'s surfaces or the plan is stale, flag this as a review finding rather than pressing on.',
        '',
        // Attachment-perception discipline (LIN-872) — the verdict below is a
        // grounding claim, so every attachment must be perceived before it is made.
        // Self-gates to '' when there are no attachments. See
        // lib/prompt-formatters.js formatAttachmentPerceptionCheck.
        formatAttachmentPerceptionCheck(context),
        '',
        '### Regression Check',
        '',
        'Run `git log --oneline -30 -- <files modified in the implementation>`.',
        'For each file, verify:',
        '- This change does not re-introduce a bug that was previously fixed',
        '- If a recent commit message mentions fixing the same property/behaviour this implementation touches, read that commit and confirm the fix is still intact',
        '- If a recent commit reverted a change to this file, verify this implementation does not re-apply what was reverted',
        '',
        '### Gap Analysis',
        '',
        'Before running the checklist, cross-reference the implementation against the plan:',
        '- Compare each cross-cutting concern or acceptance criterion against the implementation steps that were actually followed',
        '- **High-priority items**: Requirements that appear in the plan or cross-cutting concerns but were NOT explicitly addressed in an implementation step — these are the most likely gaps',
        '- Focus review attention on these gaps rather than re-verifying work that was just completed',
        '',
        '### Isolated, or One of a Class?',
        '',
        'Before approving the close, check whether the verified work is one instance of a class: the same bug, gap, or behavior often has siblings under a different name, in a parallel code path, or split across server and client. Search for the pattern itself, not only the surface the ticket cites. If siblings exist, name the class, then mark each unhandled instance **inside** or **outside** the ticket\'s bounded classes per the section immediately below — an inside sibling becomes a ledger item there, not a plain review finding, so the remaining work is scoped deliberately — review itself does not fix it. A genuinely isolated change is a valid result; state it explicitly.',
        '',
        '### Inside or Outside the Ticket\'s Scope',
        '',
        'A finding inside a bounded class is scope; scope discharges by done or an explicit drop, never by filing (John Kershaw\'s ruling on LIN-2825). Mark every unhandled class instance above, and every What-CI-Did-Not-Prove ledger item below, **inside** or **outside** the ticket\'s bounded classes — the classes or behaviours research or the plan named, with their places, in its issue description (LIN-1871) — citing the specific one an inside item belongs to. **Inside**: part of solving this ticket\'s problem, its cause included wherever it lives, or the same defect or idiom as a class this ticket bounded, whether or not research\'s enumeration listed it — the list is evidence of the class, not its edge — or a claim this ticket\'s own change depends on. Record it as a ledger item below rather than a plain review finding, so `close-out` cannot discharge it merely by filing a ticket for it. **Outside**: a different problem — not this ticket\'s or its cause, and no bounded class covers it; close-out files it, after checking it does not already exist. If a ruling is raised on a finding, an inside item\'s options are "do it here" or "drop it, with the reason"; "file" is offered only for an outside item. This marking is separate from how each item is settled, below.',
        '',
        '**Before raising any `DECISION:`, check it is not already covered (LIN-2991/LIN-3022).** Query `GET /api/proxy/rulings?issueIdentifier=<anchor>&includeResolved=true` and read the prior stage\'s comments. Do not re-raise a question an open, answered, dismissed, or withdrawn row already covers for the same anchor — note that `includeResolved` covers loop-backed rulings only, never a task-bound one. Ask for every fact the question needs in the one ruling.',
        '',
        '### Test Quality Check',
        '',
        'Assess whether tests cover the right *level* — not just whether tests exist:',
        '- For behavior crossing module boundaries, user-facing flows, or integration surfaces, verify higher-level tests like e2e or integration exist *where appropriate* rather than only unit tests with mocks',
        '- Flag when a change adds only low-level tests for behavior that needs end-to-end coverage',
        '- Determine the appropriate test level from the change itself (UI/route/cross-module → e2e; pure function → unit); do not enforce a fixed rule',
        '- A test that reads source to show where code sits is no witness for a move; behaviour is (a replay, the seams import map)',
        '- **Mutation-check the load-bearing tests (LIN-2274).** For at least the new/changed tests that pin this deliverable\'s own claimed behavior, delete or comment out the code path each one claims to cover and confirm it goes red — do not accept "the test exists and asserts something" as proof it asserts the RIGHT thing. A test that stays green with its own claimed code path removed passes for a reason other than the one it names (e.g. a test built from Proxies/spies never actually wired into the call path under test, or a helper that silently slices the wrong block of a shared file) — this is a review finding, not a style nit; name the specific mutation you tried and what you observed. Revert every mutation after checking it.',
        '',
        '### Review Checklist',
        '',
        '- [ ] Tests cover new/changed behavior',
        '- [ ] Tests verify no unintended side effects (state left clean after each interaction)',
        '- [ ] Where multiple features share a code path or state, their interactions are tested',
        '- [ ] No security vulnerabilities introduced',
        '- [ ] Error handling is appropriate',
        '- [ ] Code style consistent with the codebase',
        '- [ ] No performance regressions',
        '',
        '### Manual Verification',
        '',
        'For visual or behavioral changes, verify the result directly where possible (run the app, take screenshots, check viewports) rather than relying solely on automated tests.',
        context.attachments?.length > 0 ? 'If a spec or mockup attachment exists for this task, view it and the actual result side-by-side before judging visual fidelity — never judge fidelity from the result alone.' : '',
        '',
        'If something cannot be verified by the agent (external service integration, cross-browser behavior, subjective UX), list it in the ledger as not run, with why.',
        '',
        '### What CI Did Not Prove',
        '',
        'Before the verdict, write the handoff ledger — the artifact the `close-out` step consumes. Enumerate every claim the deliverable depends on that the green CI run does NOT actually exercise. Common kinds (illustrative, not a checklist): an external contract or API behaviour CI cannot reach; a *producer* that must emit an input this change now *consumes*; a user-reachable entry path no automated test drives; a sibling on a parallel surface; or anything only a human can confirm. For each item, mark it **inside** or **outside** the ticket\'s bounded classes (see Inside or Outside the Ticket\'s Scope above) and state how it can be discharged: an **inside** item — this ticket\'s own unfinished scope — by a real-world check or a manual repro naming its **exact distinguishing precondition**; filing a ticket for it is never a discharge, since it belongs to this ticket, not a neighbour\'s. An **outside** item — a genuinely different kind of problem — by a routed follow-up ticket that states the problem on its own terms.',
        '',
        'A class sibling belongs here ONLY if this deliverable\'s correctness depends on it, or it is itself marked inside scope; otherwise it stays an outside-scope follow-up, not a ledger item.',
        '',
        '**Say how each item will be settled**, keeping each route to what the claim needs:',
        '',
        '- **Before the merge**: a check or a repro close-out can run, naming the exact condition that tells right from wrong.',
        '- **After the deploy**: a step that can only run once the change is live, such as a live check or a data clean-up. Record it as a post-deploy step close-out does after the merge, never as a condition on the merge.',
        '- **A named monitor**, for a claim only time in production can show: a log or oplog entry, a metric, or a path that fails loudly, with one line on why no check short of production could prove it. A monitor **fires**; a follow-up ticket does not, so it may sit *beside* a monitor, never *instead* of one. A claim a test could have proven is not unprovable but untested, and usually means **Request Changes**.',
        '- **A named rollback**, for a change that is genuinely reversible: the single commit to revert, or the exact env var / flag and its safe value. A migration, data already persisted in the new shape, or a third party already consuming the change makes it not reversible.',
        '',
        'An unnamed monitor or rollback settles nothing. Still enumerate every claim CI does not exercise; only the route changes.',
        '',
        '**Cheap when empty:** if green CI genuinely covers the whole deliverable, say so in one explicit line and do not manufacture doubt about a self-contained change. An explicitly empty ledger leaves close-out nothing to settle.',
        '',
        'When CI is genuinely absent and the two-branch substitute below stood in for it, its known limits belong here as ledger items too: it has no independent clean environment, no coverage of commits after the one you ran it on, and no flake/regression separation beyond what you observed — do not let a clean substitute run read as "CI covers the deliverable".',
        '',
        formatCiGateCheck({ rerun: true }),
        '',
        '### Verdict',
        '',
        'Conclude with an explicit verdict: **Approve** / **Request Changes** / **Needs Discussion**, with a one-line justification. The verdict is review\'s deliverable — it *authorizes* the close, it does not perform it. When the `### What CI Did Not Prove` ledger above is non-empty, or you name fixes for close-out to make, the verdict is `Approve — conditional on close-out discharging the ledger`, never a bare Approve; only an explicitly empty ledger with nothing to fix may carry a plain **Approve**. Close-out makes the fixes you name itself, however many files they touch, so name each precisely enough to make without guessing: where, and what it should become. When the work still needs a new design or new behaviour, the verdict is **Request Changes** back to `implementation`.',
        '',
        '### Hand Off to Close-Out',
        '',
        'Review is write-only: your deliverable is the ledger plus the verdict, recorded in the summary comment. You do NOT merge, mark the task Done, or file follow-ups — the `close-out` step does, from the ledger you wrote, after re-checking CI on the exact commit. Before issuing **Approve**, confirm **CI is green on the PR — or, if CI is genuinely absent, that the substitute above has been independently re-run and recorded**; a real CI failure because the work is unfinished is **Request Changes**, handed back to implementation, not a fix loop here.',
        '',
        '**Cannot-close branch — when the work has landed but CI is red for a real failure, or verifying it surfaced a bigger problem the fix exposed (a second bug, a prerequisite that must be fixed first):** that is still this task\'s work, its cause included. Do NOT loop back into another `review`, and do NOT hand to `close-out`. Instead:',
        '- Give **Request Changes** with what you found and where, and name the stage that does it on this task as the next action: `implementation`, `bug` to find the cause first, or `plan` if the approach needs rethinking. File no new ticket for it. If an open task already owns exactly this work, link it as `blocks` and name it next: a `blocks` relation does not make the engine descend.',
        '- Only a fix the team would need to hear about before it happens makes it **Needs Discussion**: one clear question for the human, with your recommendation.',
        '- The task stays open until it is fixed and CI is green (or, with no CI, the two-branch substitute re-run and recorded); then review re-runs, Approves, and `close-out` closes.',
        '',
        '### Completion',
        '',
        'Record it in one summary comment: the ledger, the verdict, and the CI state. On **Approve** (or **Approve — conditional**) the task is left ready for `close-out`; on **Request Changes** / **Needs Discussion** it stays open with the next action named (per the cannot-close branch when a blocker surfaced).'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'close-out': {
    name: 'close-out',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Finish approved work: make the fixes review asked for, merge, do the post-deploy steps once the deploy lands, set Done, post the summary, archive & prune, and file remaining follow-ups. Use when review has Approved and the PR is green (or, with no CI, the established-absence substitute was recorded).',
    completionSignals: COMPLETION_SIGNALS['close-out'],
    route: {
      when: 'The latest code review approved, plainly or conditionally, and the work is not yet merged and Done.',
      whenNot: 'CI is red, or verifying the work surfaced a blocker: that is `implementation` (or `bug`, or `blocked` if only a person can settle it) on this ticket first.',
      requires: 'An Approve from a code review; a plan-review Approve is not one.'
    },
    generate: (issue, context, featureFlags = {}) => {
      const isBug = (issue.labels || []).some(l => String(l).toLowerCase() === WORK_ISSUE_LABELS.BUG);
      const sections = [
        formatHeader('Close Out', issue),
        '',
        `## Workflow

1. **Read the review**: Get full issue details for ${issue.identifier}, including the most recent review summary comment: its verdict and the ledger of what CI did not prove.
2. **Finish the fixes**: Make the fixes review asked for, then re-establish CI on the new head.
3. **Merge**: Once the items that belong before the merge are settled, merge on a fresh read that CI is green on the exact commit (or, if CI is genuinely absent, that the substitute has been re-run and recorded).
4. **After the deploy**: Once the deploy has landed, do the post-deploy steps and verify the change on what landed.
5. **Close**: Set ${issue.identifier} to "Done", post the summary, archive & prune the description, tidy the related tickets, and file the outside follow-ups.`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, ['close-out'])),
        '',
        ...goal('close-out'),
        'Review has recorded its verdict and what green CI did not prove in its summary comment. A recorded review Approve is your authority to finish; no fresh "go ahead" is needed. With no review verdict on record, or an Approve with no ledger at all (an explicitly empty one is fine), the work is not ready: leave the task open and name `review` next.',
        '',
        '### Make the Fixes Review Asked For',
        '',
        'Make them yourself, however many files they touch, and resolve any conflict landing the PR needs. Keep each the size of a fix: one that turns out to need a new design or new behaviour is not a fix, so hold the merge and name `review` next with what you found. Nobody reviews what you change after the approval, so list each change in your summary with its commit and the review line it answers, and re-establish CI on the new head before merging. A citation or comment this change made stale is a fix even outside the ticket\'s files: list it with its commit, raise no ruling; an assertion or behaviour change is not one.',
        '',
        formatCiGateCheck(),
        '',
        '### Settle the Ledger',
        '',
        'Review marked each item **inside** (this task\'s own work, its cause included) or **outside** (a different problem). Settle each one:',
        '- **Inside**: done, shown by evidence you cite: a check you ran, a repro that exercised the **exact distinguishing precondition** review named, or the fix you made. Filing a ticket never settles inside work. Leave one undone only when finishing it is a change the team would need to hear about first, and say in your summary exactly what is left and why. A post-deploy check you cannot run: see Land It.',
        '- **Outside**: file it as a follow-up a reader with no access to this task can act on.',
        '- **An item that can only run once the change is live** (a live check, a data clean-up): do it after the merge, once the deploy has landed (see below). It is never a reason to hold the merge.',
        '- **A named monitor or rollback**: cite the name review wrote. You cannot supply one yourself; "we will notice" or "it can be reverted" with nothing named settles nothing, and a ticket is not a monitor, because it does not fire.',
        '- **Any item** may be accepted by a person, but only one who names the exact precondition they exercised.',
        '',
        '**Green CI is never evidence for a ledger item:** CI is why the item is on the list. An explicitly empty ledger has nothing to settle, so do not manufacture doubt about a self-contained change.',
        '',
        '### Land It and Close the Loop',
        '',
        'Merge pinned to the commit CI passed on (`--match-head-commit`); a merge or rebase with no conflict is ordinary mechanics. If the change deploys, wait until the deploy has landed (the deployed commit is your merge or later; Harbour shows its own in the page footer), then do the post-deploy steps with the access you have. Verify the change on what landed in this same session: do not leave the task open, or file a follow-up, only to "confirm the merged change works". A claim that needs real-world elapsed time belongs on a named monitor. The task stays open only if the deploy has not landed, a post-deploy step ran and failed, or a post-deploy step that is not a check (a data clean-up, a migration) is beyond your access: say what is left and name the next action. Once the deploy has landed, a post-deploy check you cannot run never holds the close, however the ticket or review names it: record it as not run (what, why, who can run it) on the ticket and in the PR, list it for the operator, then close; no monitor settles it, and raise no ruling. A product question is not a check and still goes to a ruling.',
        '',
        'Then set the task to Done.' + (isBug ? ' Leave the `bug` label in place: Done marks it resolved, and the label is the lasting bug-vs-feature record.' : '') + ' Post the summary comment: what merged, each change you made, how each ledger item was settled, and the final CI state. Close or cancel the related tickets this work settles, saying why; archive and prune the description; and file the outside follow-ups (see Follow-up Triage below).',
        '',
        '**Always name a next action** when something stops you: `review` for a missing verdict or a change that is more than a fix, or the `bug` / `plan` / `implementation` that resolves a blocking item.',
        '',
        '### Follow-up Triage',
        '',
        'Only outside items are filed here; inside work is done or left undone with its reason, never filed. Write each for a reader with no access to this task. If a ruling is raised on a finding during close-out, an inside item\'s options are "do it here" or "drop it, with the reason"; "file" is offered only for an outside item. Every follow-up ticket you file must carry a priority and a type label — never leave it at the provider default. ' + FOLLOW_UP_SHAPE,
        '- **Existing-ticket check (LIN-2991/LIN-3022)**: before filing an outside item, search the anchor\'s relations (`GET /api/proxy/issues/{id}/relations`) and `GET /api/proxy/search` for a ticket already naming the same file and finding. If one exists, link it (a `related` relation) and record it in the summary instead of filing a new one.',
        '- **No re-raise (LIN-2991/LIN-3022)**: before raising any `DECISION:`, check `GET /api/proxy/rulings?issueIdentifier=<anchor>&includeResolved=true` and the prior stage\'s comments. Do not re-raise a question an open, answered, dismissed, or withdrawn row already covers for the same anchor — `includeResolved` covers loop-backed rulings only, never a task-bound one. Ask for every fact the question needs in the one ruling.',
        '- **Priority**: derive it from the finding\'s own risk (how bad if unaddressed, how likely to recur) and state that reasoning in one line on the ticket. Set it via the provider-neutral `priorityLevel` (ascending, 4 = highest) — do not invent a numeric scale of your own.',
        '- **Label**: apply a type label drawn from the workspace\'s own label catalog (`GET /api/proxy/labels`), never a hardcoded vocabulary. If nothing in that catalog reasonably fits, say so explicitly on the ticket rather than inventing one.',
        '- **Best-effort, never blocking**: some providers silently drop priority on write, or offer no usable label catalog. When a field cannot be set for that reason, record a one-line note on the ticket saying so instead of retrying or failing the close.',
        '',
        '### Archive & Prune Superseded Stage Artifacts',
        '',
        'This step runs only here, after the merge and the Done transition, on the successful all-clear path — never on a cannot-close branch, and never on a task that stays open with Request Changes / Needs Discussion. A prune before merge would discard evidence a still-open task might still need.',
        '',
        `1. **Archive first**: call \`GET /api/proxy/issues/${issue.identifier}/brief?noRefresh=1\` immediately before editing the description — this hash-gates a full pre-prune snapshot into the task-history archive at no LLM spend (\`noRefresh=1\` skips generation; the snapshot capture runs before that short-circuit). Do not skip this because a brief already looks fresh — the call is what captures the snapshot, not a side effect you can assume already happened.`,
        `2. **Verify the archive landed**: call \`GET /api/proxy/issues/${issue.identifier}/snapshots\` and confirm a snapshot now exists carrying the pre-prune description (the archive call is fire-and-forget server-side and swallows its own errors, so a 200 from step 1 is not proof it captured anything). Do not prune until this is confirmed.`,
        '3. **If the snapshot cannot be verified**: do not prune. Record in the close-out summary that the archive could not be confirmed and the prune was skipped, and close the task anyway — the prune is hygiene, the merge and Done transition are already irreversible. Never hold open, re-route, or reopen a task whose merge and Done transition have landed.',
        '4. **Prune**: rewrite the description via `PATCH /api/proxy/issues/:id`, removing the embedded stage-artifact sections the landed work has discharged — implementation plan(s) and any plan revisions, research-findings sections, and scoping/design sections — and replacing them with a short stub recording: what was implemented, the PR link, that the plan was implemented as approved (or naming the deviations), and that the full history is preserved in the task snapshots and the comment trail.',
        '5. **Never prune**: the original problem statement, acceptance criteria, reproduction steps, scope (the scoping template\'s own "single source of truth" instruction stands — do not contradict it here), or any section a follow-up ticket references. When in doubt, keep it.',
        '',
        'Comments are untouched by policy — the prune is a description edit only, using the existing write surface.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  // LIN-2261: the verb the 2026-08-24 retrospective review sweep had to borrow
  // `review` for. `review` is pre-merge framed (it exists to authorize a merge
  // that has not happened yet) — a task that is already merged and closed out
  // needs a different verb, one that opens from that fact instead of expecting
  // unlanded work. Deliberately narrower than `retro`: this audits claims and
  // test integrity against the landed code, not lessons learned or downstream
  // effects (that's `retro`), and it never re-verifies overall correctness —
  // CI already covers that.
  'retrospective-audit': {
    name: 'retrospective-audit',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Independently audit a landed change: the claims its deliverable rests on, and the integrity of the tests that assert them. Use once work has already merged — never for work that has not landed yet (that\'s `review`).',
    completionSignals: COMPLETION_SIGNALS['retrospective-audit'],
    route: {
      when: 'The work is merged and Done, with a code review on record.',
      whenNot: 'The work has not merged (`review`), or has merged and been approved but the task is not Done (`close-out`).'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Retrospective audit', issue),
        '',
        formatReadOnlyWorkflow(issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, ['retrospective-audit'])),
        formatDiscussionReference(issue),
        '',
        ...goal('retrospective-audit'),
        `**Start from the fact that this is already merged.** ${issue.identifier} landed — this is not a review of pending work, and there is no merge to authorize. Locate the landed change first: \`git log --grep=${issue.identifier}\` (and, if the task or its comments name specific files, \`git log --since=<createdAt> -- <files>\`). Everything below audits what actually shipped there, not what was proposed or planned.`,
        '',
        '### Audit the Claims',
        '',
        'Collect every claim the deliverable rests on — in-code comments, the PR/commit description, the task\'s own description or summary/close-out comment — and check each one directly against the landed code at HEAD, not against the author\'s account of it. A claim is anything asserted as true about behavior: "this never touches disk", "the producer can only emit X", "this preserves the prior behavior". A claim that does not hold is a finding — cite the file and line that contradicts it.',
        '',
        '### Audit Test Integrity',
        '',
        'For each test that guards a claimed behavior, check whether it actually tests what it claims to — not just whether it exists or passes. Look specifically for: a test that passes for a reason unrelated to the behavior it names (a fixture that dodges the real code path, a name-based check that would pass on the wrong input); a negative/spy test that constructs a forbidden call and never asserts against it; a vacuous or trivially-true assertion. Read the test\'s actual assertions, and where feasible, reason about whether a real regression in the claimed behavior would actually make the test fail — a test that stays green either way is not testing what it claims to.',
        '',
        '### Ownership Orphans',
        '',
        'Check this task\'s comment/description trail and any sibling tickets it references for a hazard each side defers to the other — a caveat this task\'s own record leaves to a related ticket, while that ticket\'s record defers it back here (or to a third party). This class is invisible from inside either originating ticket alone: read the referenced sibling\'s current state directly, not just this task\'s account of it.',
        '',
        '### Reporting',
        '',
        'Report your findings as a comment on the task. Do not change status, labels, or any other task state; do not merge or mark anything Done — that already happened, and re-confirming it is not this audit\'s job; file a follow-up ticket, readable on its own, for each finding that still matters, and link it from your comment. ' + FOLLOW_UP_SHAPE + ' A finding-free audit is a valid, common result — state that plainly rather than manufacturing doubt.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'retro': {
    name: 'retro',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Run a retrospective: reconstruct what happened from Linear and git history, assess downstream effects, and surface honest lessons. Works on completed work (true look-back) and in-flight work (reorient, or when something feels off).',
    completionSignals: COMPLETION_SIGNALS['retro'],
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Retro', issue),
        '',
        formatInformOnlyWorkflow(issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['retro'])),
        formatDiscussionReference(issue),
        '',
        ...goal('retro'),
        'A retro works on completed and in-flight work alike. On a finished task it is a true look-back. On an in-progress task — often run to reorient, or when something feels like it may be going wrong — it is the same analysis, just without downstream effects that have not materialised yet. Read the current state first and adjust accordingly.',
        '',
        '### Reconstruct what happened',
        '',
        'Build the timeline from evidence, not memory:',
        '- **Linear history**: read the description, comments, status changes, subtasks, and relations (follow-ups, duplicates, reopened links) in Linear.',
        `- **Git history**: find the commits tied to this task — \`git log --grep=${issue.identifier}\` — and the work done since it began (\`git log --since=<createdAt> -- <files the task touched>\`; add \`--until=<completedAt>\` if the task is finished). Use the task's actual dates from Linear.`,
        '',
        '### Identify downstream effects (or risks)',
        '',
        'For work that has already shipped, this is the part hindsight makes visible — look for what happened *after* it completed:',
        '- Run `git log --since=<completedAt> -- <files this task changed>`. Later commits to the same files — especially ones whose messages mention "fix", "revert", "hotfix", or "regression" — signal the change caused problems or was incomplete.',
        '- Check Linear for follow-up issues, reopened tickets, or bugs that trace back to this work.',
        '',
        'For in-flight work there are no downstream effects yet — instead, flag **risks**: changes that look fragile, work that is likely to need rework, or decisions that later work will have to build around.',
        '',
        '### Scale to the task',
        '',
        'Match the depth to the work: a small leaf task gets a short, focused retro on its single change. For an epic with subtasks, aggregate across children — which shipped, which slipped or were dropped, and the cumulative downstream churn (or, mid-flight, where the epic is drifting) — rather than retro-ing each subtask in isolation.',
        '',
        'Present your findings to the user:',
        '- **What happened**: the actual arc of the work (not just the plan\'s intent)',
        '- **What went well**: decisions and approaches worth repeating',
        '- **What was missed or went wrong**: gaps, errors, or surprises — told honestly',
        '- **Downstream impact / risks**: follow-up fixes, regressions, reopened work for shipped work; risks to watch for in-flight work; or "none found"',
        '- **Lessons & suggestions**: concrete, actionable takeaways for similar future work',
        '',
        'These are findings for the user to act on — share them directly. Do not write them back to Linear or save them anywhere unless asked; the user decides what happens next (discuss, save to a file, post as a comment, open follow-up tasks, etc.).'
      ].filter(Boolean)

      return sections.join('\n')
    }
  }
}
