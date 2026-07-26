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
  formatAttachmentPerceptionCheck
} from './prompt-formatters.js';

/**
 * Prompt template definitions
 * Each template has:
 * - name: Display name for the prompt
 * - category: When prompt is available (pre-work, work-issue, ready)
 * - generate: Function that takes (issue, context) and returns prompt string
 */
export const PROMPT_TEMPLATES = {
  'blocked': {
    name: 'blocked',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Analyze and resolve blockers preventing progress. Use when work is stalled due to dependencies, missing info, or technical issues.',
    completionSignals: COMPLETION_SIGNALS['blocked'],
    aiHint: {
      situation: 'dependencies, missing info, or stalled',
      goal: 'Identify the blocker type and root cause, evaluate options to unblock.',
      workflow: 'Fetch details → Analyze blocker → Add comment in Linear'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Unblock', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.UNIVERSAL, issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels)),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical analyst diagnosing work impediments. You have authority to identify blockers, evaluate options, and recommend solutions, but cannot unilaterally make decisions that require stakeholder input.',
        '',
        '**First**: Check the current status of all blocking dependencies. If the blocker is already resolved (e.g., the blocking issue is Done, the dependency is available, the information has been provided), skip the full analysis — just confirm the task is unblocked and recommend the next action.',
        '',
        'If the blocker is still active, analyze:',
        '- **Blocker Type**: Dependency, missing info, technical issue, external, or other',
        '- **Root Cause**: What\'s actually preventing progress',
        '- **Options**: 2-3 ways to unblock with tradeoffs',
        '- **Recommendation**: Best path forward with rationale',
        '',
        '**Record the blocker**: Capture the dependency as a `blocks`/`blocked-by` relationship between the tasks (not a label) and add a comment summarizing the analysis.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  [WORK_ISSUE_LABELS.BUG]: {
    name: 'bug',
    category: PROMPT_CATEGORIES.WORK_ISSUE,
    description: 'Investigate and debug an issue. Use when you need to find root cause, reproduction steps, and potential fixes.',
    completionSignals: COMPLETION_SIGNALS[WORK_ISSUE_LABELS.BUG],
    aiHint: {
      situation: 'needs investigation, debugging',
      goal: 'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.',
      workflow: 'Fetch details → Investigate → Add findings as comment in Linear'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Investigate bug', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.WORK_ISSUE, issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, [WORK_ISSUE_LABELS.BUG])),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a software debugger investigating unexpected behavior. You have authority to reproduce issues, trace root causes, and propose fixes, but should not deploy changes without review.',
        '',
        'Start by reading any prior investigation notes in comments. Confirm the reproduction steps and root-cause hypotheses still match what you can observe now. If the behavior has changed since investigation, note it and re-verify before proposing a fix.',
        '',
        'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.',
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
        '7. Propose fix with minimal scope. If step 6 found a class, the fix stays minimal — name the class and list the unhandled instances in your findings comment instead of silently widening the fix.',
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
    description: 'Create a step-by-step implementation plan and assess task scope. Use when task is well-defined and you need to document the approach before coding.',
    completionSignals: COMPLETION_SIGNALS['plan'],
    aiHint: {
      situation: 'clear requirements, needs documented approach',
      goal: 'Create a clear implementation plan, enumerate surfaces with any dependency arrows between them, commit to a session-fit answer (fits one session / needs multiple sessions), and state whether a plan-review pass is due before implementation.',
      workflow: 'Set status to "In Progress" → Analyze requirements → Revise against any prior plan-review verdict → Document plan in description → Enumerate surfaces and draw any dependency arrows → Answer the session-fit question → State whether plan-review is due → Ready for implementation, plan-review, or breakdown'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Plan', issue),
        '',
        '## Workflow',
        '',
        `1. **Start**: Set ${issue.identifier} status to "In Progress" in Linear (if not already)`,
        `2. **Fetch details**: Get full issue details for ${issue.identifier} in Linear`,
        '3. **Plan**: Create an implementation plan (see Goal below)',
        `4. **Update description**: Add the implementation plan to ${issue.identifier} in Linear`,
        '5. **Assess scope**: Evaluate whether the task needs breakdown into subtasks',
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['plan'])),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical planner analyzing requirements and designing the implementation approach. You have authority to design the approach and assess scope, but do not implement code changes in this step.',
        '',
        'Create an implementation plan that includes:',
        '- Files to modify or create',
        '- Key changes in each file',
        '- Potential risks or edge cases',
        '- Testing approach',
        '',
        '**After planning**: Update the issue description with the implementation plan so the task overview reflects what will be done.',
        '',
        // Consumes the research Surface Assessment (see the research template). Mirrors
        // the meta-prompt plan quality rule in lib/prompts/meta-prompt-template.js:
        // a necessary prerequisite refactor is sequenced as a separate blocking subtask,
        // never folded into implementation steps — but only a verdict naming its
        // in-task consumer qualifies (LIN-397: necessity, not availability).
        'If a Surface Assessment in prior research comments declares `refactor required` and names the line in this task that consumes it, encode it as a separate blocking subtask using the assessment\'s description directly — do not absorb the refactor into implementation steps, as that loses the sequencing guarantee. A refactor with no consumer in this task, or one that taxes bystander consumers for this feature\'s need, does not become a subtask: fold it inline, scope it down, or record it as a note.',
        '',
        formatSubtaskSummary(context.children),
        // Scale-to-task (lower bound) — woven in BEFORE the heavy framing machinery so a
        // genuinely small task can skip it. Mirrors the meta-prompt "Scale To The Task"
        // rule (lib/prompts/meta-prompt-template.js); proven on the meta-prompt path via
        // scripts/eval-prompt-scaling.mjs. See lib/prompt-formatters.js formatScaleToTask.
        formatScaleToTask(),
        '',
        // Attachment-perception discipline (LIN-872) — must be perceived before the
        // plan is drafted, since the plan itself is a grounding claim. Self-gates to
        // '' when there are no attachments. See lib/prompt-formatters.js
        // formatAttachmentPerceptionCheck.
        formatAttachmentPerceptionCheck(context),
        '',
        // The revision half of the plan-review loop (LIN-1603 item 2.2). Sited BEFORE
        // Strategy Framing because a revising planner must read the verdict before it
        // re-derives the framing and session-fit answers the verdict is about. Without
        // this, the second `plan` is generated blind to the findings and the one-cycle
        // bound (plan → plan-review → revised plan → plan-review, then escalate) can
        // never be satisfied. The `### Plan Review Verdict` header is a DISAMBIGUATOR
        // between the two verdict kinds, never a required format to key on — the prior
        // verdict is recognised by substance, exactly as the close-out gate recognises
        // a `review` verdict.
        '### Revising After a Plan Review',
        '',
        'Before drafting, check the comments for a prior plan-review verdict — a `plan-review` comment recording an explicit **Approve** / **Request Changes** / **Needs Discussion**, headed `### Plan Review Verdict` where one is used. If there is none, plan as normal and skip the rest of this section.',
        '',
        'If there is one, this pass is a **revision**, not a fresh plan: start from the plan already in the description and work through the verdict\'s findings. Address every finding it cites — fold in a missed surface or mark it out-of-scope with a named ticket identifier, name the routed-around gap\'s ticket identifier, carry the constraints the history signal surfaced, correct a session-fit answer that contradicts the catches it names, name the adversarial follow-up that re-tightens any relaxation, and re-site a prerequisite refactor that named no in-task consumer. Where you disagree with a finding, answer it explicitly with your reasoning — an unaddressed finding reads as an overlooked one, and cannot be checked later.',
        '',
        '**Record what changed**: state in the description which findings this revision addresses and how, so the next plan-review can check the revision against the verdict instead of re-deriving it from scratch. One revision cycle is the bound — a plan that comes back a second time still carrying the same findings escalates to a human rather than round-tripping again, so this pass has to count.',
        '',
        // Strategy Framing — must precede Scope Assessment so session-fit answers
        // against the chosen strategy, not against the cheapest default.
        // The meta-prompt quality rule in lib/prompts/meta-prompt-template.js mirrors this ordering.
        '### Strategy Framing',
        '',
        'Before assessing scope, frame the strategy choice. Score viable strategies on two axes:',
        '',
        '- *Cost of doing:* current-ticket session size, blast radius, risk to high-churn files.',
        '- *Cost of not doing:* if a strategy routes around a root contract gap already tracked as a future ticket, name the ticket (identifier or "none identified") and what stays unsolved. Workarounds compound — a dialect-island, a per-runtime branch, a duplicated abstraction — each pays tax on every future change.',
        '',
        'If one strategy is clearly cheaper on cost-of-doing but routes around a tracked contract gap, state the trade-off explicitly: cheaper-now vs. closes-the-gap. **NAME the routed-around contract gap** with a ticket identifier (or "none identified") — a bare description is not enough; the identifier is what makes the trade-off auditable.',
        '',
        'For migration / convergence / pre-launch parent epics, default to closing the contract gap unless cost-of-doing is prohibitively higher.',
        '',
        'When only one strategy is viable, state this explicitly ("single viable strategy, no framing trade-off") so the absence of comparison is visible rather than silently skipped.',
        '',
        'The chosen strategy is the input to Scope Assessment below; session-fit answers against the chosen strategy, not against the cheapest default.',
        '',
        '### Scope Assessment',
        '',
        'After drafting the plan, decide whether the work fits one focused session. A focused session is one pass at design, implementation, and verification without losing track of edges.',
        '',
        '**History signal:** Run `git log --oneline -15 -- <files in your plan>`. If any file has 3+ recent commits touching the same code paths, read those commits — repeated changes signal hidden coupling or constraints not visible in the current code. Document what those commits were protecting against and any constraints this surfaces in the plan.',
        '',
        '**List the surfaces your plan touches.** A surface is the smallest unit that has its own distinct dependencies or edge cases. If two candidate surfaces share the same dependencies and the same failure modes, merge them into one surface. If they diverge on either, keep them separate. Typical surfaces: one CRUD operation, one API endpoint, one component, one migration step, one state transition.',
        '',
        '**Completeness check.** Before locking the surface list, verify it is *complete*, not just *correct*. The same behavior, rule, or concept is often implemented in more than one place — under a different name, in a parallel code path, or split across server and client. Search for the concept itself (the behavior, a shared identifier, what a caller or user observes), not only the symbol the ticket cites — a clean search for the cited symbol is not proof of completeness. List every instance you find and mark each in- or out-of-scope. A genuinely single-surface change is a valid result; the goal is to make scope a decision, not an accident.',
        '',
        'For each surface, note:',
        '- Which other surfaces it reads from or writes to — draw the dependency arrows between them explicitly, or note "no dependencies" if the surface stands alone. These arrows (where they exist) are the shared-boundary information, so one list serves both the cross-cutting analysis and the scope decision.',
        '- Two or three edges that are easiest to miss',
        '',
        '**After enumerating surfaces and any arrows between them, answer one question: does this fit one focused session?**',
        '',
        'To anchor your answer, name 2–3 concrete catches that would be easier to see in separate sessions than in one — specific edges, specific failure modes, specific surfaces you would lose focus on. If you can name them specifically, the answer is "needs multiple sessions." If you are reaching for catches, the answer is "fits one session."',
        '',
        '**Document the answer in the issue description alongside the plan, phrased as either "fits one session" or "needs multiple sessions."** The surfaces and any arrows between them are the structure; the session-fit answer is the routing decision.',
        '',
        // The plan-review gate (LIN-1603 item 2.1). Sited AFTER Scope Assessment because
        // criterion (a) reads the session-fit answer. The decision is written down so a
        // later review can check whether the gate was skipped — objective and
        // checkable-later, not a judgement call re-made downstream. Mirrored in the
        // meta-prompt Plan-prompts quality rule (lib/prompts/meta-prompt-template.js),
        // which routes on it. Gated, never universal (LIN-1600): the step exists to
        // protect throughput, so it must not tax the plans that do not need it.
        '### Plan-review Gate',
        '',
        'With the session-fit answer settled, state whether a `plan-review` pass is due before implementation. It is due when **any** of these hold:',
        '',
        '- **(a)** The session-fit answer above is "needs multiple sessions".',
        '- **(b)** Strategy Framing names a routed-around contract gap — a ticket identifier, as opposed to an explicit "none identified".',
        '- **(c)** Any step in the plan relaxes a validation, a contract, or a guard: a widened input, a dropped check, a softened assertion, a gate turned advisory.',
        '- **(d)** The plan touches credential, merge-rule, or dispatch-contract surfaces.',
        '',
        '**Record the decision in the issue description as either "plan-review due: yes" or "plan-review due: no", naming which of (a)–(d) fired (or "none of (a)–(d)").** Answer each criterion against what the plan actually says, so the decision can be checked against the plan later rather than taken on trust — a "no" that sits next to a plan naming a routed-around gap is a contradiction a reviewer will flag, the same way a "fits one session" answer alongside specific named catches is.',
        '',
        'None of (a)–(d) firing is the common result: that plan hands directly to implementation, exactly as today. Plan-review is a gated step, not a universal one — it exists to protect the throughput of the work that needs it, so do not volunteer it for a plan that meets none of the criteria.',
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
    aiHint: {
      situation: 'understanding what\'s involved',
      goal: 'Summarize what this task involves and how it fits into the broader project context.',
      workflow: 'Fetch details → Analyze → Summarize findings for user'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Look into', issue),
        '',
        formatInformOnlyWorkflow(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, [VIRTUAL_PROMPTS.LOOK_INTO])),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a project analyst providing quick orientation. Your role is to summarize and inform, not to make decisions or changes.',
        '',
        'Provide a quick overview of this task and its context.',
        '',
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
    aiHint: {
      situation: 'missing metadata, unclear priority, wrong or missing project',
      goal: 'Review and apply updates to labels, priority, state, and project (confirm the task is in the correct project; move or assign it when unassigned or mis-filed).',
      workflow: 'Fetch details → Analyze (including project fit) → Apply changes directly in Linear'
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
        formatSection('Priority', issue.priority !== undefined ? `${issue.priority}` : 'Not set'),
        formatSection('Assignee', issue.assignee?.name || 'Unassigned'),
        formatSection('Labels', currentLabels),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a project coordinator with authority to update task metadata. You can modify labels, priority, and state based on assessment, but should explain your reasoning for significant changes.',
        '',
        'Review this task and apply appropriate updates in Linear.',
        '',
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
        '- **Priority**: Is the current priority appropriate given importance and urgency?',
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
    aiHint: {
      situation: 'plan has answered "needs multiple sessions"',
      goal: 'Create one subtask per surface the plan enumerated, and copy any dependency arrows directly into blocked-by relations.',
      workflow: 'Fetch details → Read surfaces and any arrows from the plan → Create one subtask per surface → Copy arrows into blocked-by relations → Add summary comment'
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
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical decomposer breaking complex work into actionable units. You have authority to create subtasks and define dependencies, but should preserve the original task\'s intent and scope.',
        '',
        'Start by reading the plan in the description. Confirm the surfaces and any dependency arrows between them still reflect the current codebase. If the plan has drifted, stop and recommend re-planning before decomposing.',
        '',
        'Read the surfaces the plan enumerated and any dependency arrows it drew between them. Create one subtask per surface (unless the plan groups several small surfaces together). Each subtask\'s `blocked-by` relations are exactly the surfaces the plan shows it depending on — copy the arrows directly. A surface with no incoming arrows has no `blocked-by` relations, which is correct: the resulting subtask graph matches the plan\'s shape because the arrows *are* the structure.',
        context.children?.length > 0 ? 'Review existing subtasks; if any already cover a surface, reuse them instead of creating new ones.' : '',
        '',
        '### Creating Subtasks',
        '',
        'For each surface, create a subtask in Linear with:',
        '- A clear title naming that surface (e.g., "File browser: rename flow")',
        '- Description with acceptance criteria for just this surface — the parent task carries the full scope and sibling context flows in at runtime, so keep the description focused on this surface alone',
        '- `parentId` linking to the parent issue',
        '- `projectId` inherited from parent',
        '- `stateId` set to "Todo"',
        '',
        '### After Creating All Subtasks',
        '',
        '1. Create `blocked-by` relations by copying the plan\'s arrows directly — each subtask is blocked-by every surface the plan shows pointing into it',
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
    aiHint: {
      situation: 'unknowns, unfamiliar dependency/API, or an unvalidated assumption to de-risk before planning',
      goal: 'Identify key questions, read the relevant docs and prior art, check history, validate feasibility, and provide an actionable recommended approach for the plan that follows.',
      workflow: 'Fetch details → Read docs/prior art, check history, validate feasibility → Add exploration notes as comment, update description with key findings and recommended approach in Linear'
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
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical researcher investigating unknowns. Your role is to gather information and provide recommendations, not to make final decisions on direction.',
        '',
        'Identify key questions, research systematically, and provide actionable recommendations.',
        context.comments?.length > 0 ? 'Review the prior research recorded on the task and build on existing findings.' : '',
        '',
        // Scale-to-task (lower bound) — mirrors the meta-prompt "Scale To The Task" rule.
        // A small, well-scoped question gets a short investigation; don't over-research a
        // one-file change. See lib/prompt-formatters.js formatScaleToTask + CLAUDE.md both-paths.
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
        // template's Completeness check but lives at a different step — cross-reference, not a
        // merge. Mirrors the meta-prompt Research-prompts rule (both-paths rule).
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
        // Surface Assessment — mirrors the meta-prompt research quality rule in
        // lib/prompts/meta-prompt-template.js so both prompt paths surface
        // refactoring the same way. Gated on necessity, not availability (LIN-397):
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
        // template's Completeness check, different step — coherence cross-ref, not a merge.)
        'One shape always counts as demanding a structural change: if your approach would introduce a SECOND REPRESENTATION of something the system already models — a parallel type, table, state field, or source of truth for data that already exists — the verdict is `refactor required` (reuse or extend the existing model), not `lands cleanly`. A clean-looking local addition that duplicates an existing model is exactly the blind spot this catches.',
        '',
        'A `refactor required` verdict must pass two evidence tests, each answered by citing lines:',
        '- **Consumer test:** cite the line in THIS task\'s implementation that calls the new seam. If you cannot, the refactor is speculation — it belongs with its future consumer, not ahead of it.',
        '- **Who-pays test:** for each consumer the refactor touches, state whether it is a beneficiary (comes out simpler, corrected, or unchanged) or a bystander paying a tax (more runtime cost, more complexity, or new obligations for a need that is not theirs). Cite what each bystander newly pays. An unjustified bystander tax means the refactor is mis-scoped — scope it down. If a small named tax buys a large simplification, argue it explicitly; an unnameable tax is the smell.',
        '',
        'Size is not a rejection criterion: a demanded refactor that does not fit the session is sequenced (separate blocking subtask, own sessions), not shrunk. Effort is cheap; speculation and bystander tax are not.',
        '',
        'Format: `Surface Assessment: [lands cleanly]` OR `Surface Assessment: [refactor required: <minimal scoped change> — consumer: <where this task calls it>]` OR `Surface Assessment: [improvement noticed, not required: <land it inline/scoped, or note it — no separate subtask>]`',
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
        '- **Description**: Key findings, conclusions, and recommended approach (makes task overview accurate)'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'scoping': {
    name: 'scoping',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Define clear boundaries, assumptions, and success criteria. Use when requirements are ambiguous or scope creep is a risk.',
    completionSignals: COMPLETION_SIGNALS['scoping'],
    aiHint: {
      situation: 'ambiguous requirements',
      goal: 'Define clear boundaries (in scope vs out), assumptions, success criteria, and open questions.',
      workflow: 'Fetch details → Define scope → Update issue description with finalized scope in Linear',
      whenNot: 'the requirements are already clear and only the solution SHAPE is contested (that is `design`), or the intent is clear enough to plan/implement directly — do not scope a task whose boundaries are already known.',
      chooseOver: 'choose `scoping` over `research`/`plan` when the ambiguity is in WHAT to build (boundaries, success criteria, in/out of scope) rather than HOW to build it or how the code behaves today.'
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
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a scope analyst defining clear boundaries. You have authority to propose what\'s in and out of scope, but open questions should be flagged for stakeholder resolution.',
        '',
        'Define clear boundaries (in scope vs out of scope), assumptions, success criteria, and open questions.',
        '',
        'Document in a structured format suitable for the issue description:',
        '- **In Scope**: What this task will deliver',
        '- **Out of Scope**: What is explicitly excluded',
        '- **Assumptions**: What we\'re assuming to be true',
        '- **Success Criteria**: How we\'ll know when it\'s done',
        '- **Open Questions**: Unresolved items needing clarification',
        '',
        'Note: Update the description (not a comment) so scope is the single source of truth.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'design': {
    name: 'design',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Create a technical design with multiple approaches and tradeoffs. Use for complex features needing architectural decisions.',
    completionSignals: COMPLETION_SIGNALS['design'],
    aiHint: {
      situation: 'architectural decisions needed',
      goal: 'Evaluate 2-3 design approaches with tradeoffs, recommend one, and outline implementation.',
      workflow: 'Fetch details → Design → Add full analysis as comment, update description with chosen design in Linear',
      whenNot: 'the shape is already decided (a committed approach in the ticket/comments, one obvious shape, or a familiar single-surface change) — that is `plan`; or the knowledge to weigh the shapes against is still ungathered — that is `research` first; or the work has already landed — that is `review`.',
      chooseOver: 'choose `design` over `plan` when ≥2 genuinely viable, materially-different solution shapes exist AND the fork is still undecided (do not let the plan pick the architecture silently); choose `plan` once the shape is settled and only sequencing the surfaces remains.'
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
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical architect evaluating design options. You have authority to analyze tradeoffs and recommend approaches, but major architectural decisions may require stakeholder sign-off.',
        '',
        'Evaluate 2-3 design approaches with tradeoffs, recommend one, and outline implementation considerations.',
        '',
        'For each approach, document:',
        '- High-level architecture',
        '- Pros and cons',
        '- Implementation complexity',
        '- Risk factors',
        '',
        'Conclude with a clear recommendation and rationale.',
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
    aiHint: {
      situation: 'needs proof-of-concept or feasibility check',
      goal: 'Define specific questions, explore with a timebox, and provide go/no-go recommendation.',
      workflow: 'Fetch details → Spike → Add findings as comment in Linear',
      whenNot: 'the approach is already known to be feasible, or the unknown is broad understanding / track-record rather than one sharp technical question (that is `research`), or the solution shape is contested between viable approaches (that is `design`).',
      chooseOver: 'choose `spike` over `research` when a single, decisive feasibility question can be answered by a small time-boxed proof-of-concept; choose `research` when the knowledge gap is broader than one go/no-go probe.'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Spike', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.UNIVERSAL, issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Labels', formatLabels(issue.labels, ['spike'])),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical explorer validating feasibility. Your role is to answer specific questions through focused experimentation, not to implement production solutions.',
        '',
        'Define 3-5 specific questions to answer, a focused exploration approach, and clear success criteria.',
        '',
        'Spike deliverables:',
        '- Specific questions to answer',
        '- Proof-of-concept code (if applicable)',
        '- Findings summary with go/no-go recommendation',
        '- Identified risks or unknowns remaining'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'context': {
    name: 'context',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Synthesize current state and history of a task. Use when joining a task mid-way or after a long gap.',
    completionSignals: COMPLETION_SIGNALS['context'],
    aiHint: {
      situation: 'joining mid-way, returning after gap',
      goal: 'Synthesize current state, what\'s done, what remains, key decisions, and next steps.',
      workflow: 'Fetch details and comments → Analyze → Add summary as comment in Linear'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Get context for', issue),
        '',
        formatReadOnlyWorkflow(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['context'])),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a project historian synthesizing task state. Your role is to inform and summarize, not to make changes or decisions.',
        '',
        'Synthesize current state, what\'s done, what remains, key decisions, and recommended next steps.',
        '',
        'Gather context from:',
        '- The task description and discussion history',
        '- Related code changes (git history)',
        '- Sibling and parent task status',
        '',
        'Summarize:',
        '- **Current State**: Where things stand now',
        '- **Completed**: What\'s already done',
        '- **Remaining**: What still needs to happen',
        '- **Key Decisions**: Important choices made',
        '- **Next Steps**: Recommended actions to proceed'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  // Verifier of the `plan` template's grounding claims, one stage before
  // `implementation` (LIN-1602 / LIN-1600 Phase 1). Mirrors `review`'s
  // architecture in miniature: read-only, six anchored checks, then the same
  // Approve / Request Changes / Needs Discussion vocabulary. `name` MUST equal
  // the template key — `parseRecommendedAction` reads the emitted display name
  // and `_DISPATCH_KIND_BY_ALIAS` maps it back to the kind (the `close-out`
  // precedent). The body deliberately emits no literal tracker name of its own;
  // every such mention comes from the shared formatters, which keeps the
  // capability post-pass (applyPromptCapabilities) a no-op on the Linear path.
  'plan-review': {
    name: 'plan-review',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Verify a plan\'s grounding claims with fresh context before implementation starts: re-run its completeness search, strategy framing, history signal, session-fit, relaxation guard, and prerequisite-refactor necessity, then issue a verdict. Use when a plan is documented but not yet implemented.',
    completionSignals: COMPLETION_SIGNALS['plan-review'],
    aiHint: {
      situation: 'plan documented, not yet implemented',
      goal: 'Independently re-run the plan\'s grounding claims and issue a verdict (Approve / Request Changes / Needs Discussion) before implementation starts. Plan-review verifies the plan; it does not edit or implement it.',
      workflow: 'Fetch details → Re-run the six grounding claims → Issue verdict → Add findings + verdict as a comment'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Plan-review', issue),
        '',
        formatReadOnlyWorkflow(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        // Subtasks matter to check 6: a prerequisite refactor is sequenced as a
        // separate blocking subtask, so the verifier must be able to see them.
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['plan-review'])),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a fresh-context verifier of the plan\'s grounding claims. You have authority to verify, **not** to redesign: check the plan against its own claims and do not add requirements of your own. Plan-review must not become a second planner — a different-but-also-reasonable approach is not a finding.',
        '',
        'Start by reading the plan in the description, plus any research or comments it was distilled from. Every check below re-runs a claim the plan already makes; where the plan makes no such claim, that absence is itself the finding.',
        '',
        '### The Six Checks',
        '',
        'Work through all six, in order. Each re-runs a claim independently — do not accept the plan\'s word for a result you can reproduce yourself.',
        '',
        '1. **Completeness check — re-run the search.** Search independently for the concept the plan is about (the behavior, a shared identifier, what a caller or user observes), not only the symbol the ticket cites. Diff the surface list you find against the plan\'s. Missed siblings are **Request Changes**: each must be folded in, or explicitly marked out-of-scope with a named ticket identifier.',
        '2. **Strategy Framing — confirm the routed-around gap is named.** Where the chosen strategy routes around a root contract gap, the plan must name it with a ticket identifier, or state an explicit "none identified". A bare description of the gap is not enough — the identifier is what makes the trade-off auditable.',
        '3. **History signal — re-run it.** Run `git log --oneline -15 -- <files in the plan>` yourself. Confirm the constraints those commits surface actually appear in the plan; a file with repeated recent commits over the same code paths, whose constraints the plan never mentions, is an unverified claim.',
        '4. **Session-fit — test it against the named catches.** The plan should name two or three concrete catches that would be easier to see in separate sessions. If it names specific ones, "needs multiple sessions" should have been the answer — a "fits one session" verdict sitting alongside specific, nameable catches is a contradiction to flag.',
        '5. **Relaxation guard.** Flag any step that loosens a validation, a contract, or a guard — a widened input, a dropped check, a softened assertion, a gate turned advisory. A loosening is acceptable only where the plan names the adversarial follow-up that re-tightens or bounds it; an unnamed one is **Request Changes**.',
        '6. **Prerequisite refactor — necessity, not availability.** A refactor the plan sequences as a separate blocking subtask must name the line in *this* task that consumes it; one with no in-task consumer does not earn a subtask. Check the converse too: a genuinely necessary refactor absorbed into the implementation steps loses the sequencing guarantee, and is equally a finding.',
        '',
        '### Verdict',
        '',
        'Conclude with an explicit verdict: **Approve** / **Request Changes** / **Needs Discussion**, with a one-line justification — the same vocabulary `review` uses at the other end of the pipeline. The verdict is this step\'s deliverable; cite the check that produced each finding so the plan\'s author can act on it.',
        '',
        '**Cheap when clean.** A plan that survives all six checks gets one explicit line — "claims verified; proceed to implementation" — and an immediate handoff. Do not manufacture doubt about a well-grounded plan: a clean pass is a valid and common result.',
        '',
        '### Hand Off to Implementation',
        '',
        'Plan-review is write-only: your deliverable is the findings plus the verdict, recorded as a comment. You do NOT edit the plan, do NOT implement any part of it, and do NOT file follow-up tickets. On **Approve**, hand off to `implementation`. On **Request Changes** or **Needs Discussion**, name what the plan must fix and hand it back to `plan` — the planner owns the edit, not you.',
        '',
        '### Completion',
        '',
        // The header is emitted here so the disambiguator has a producer (LIN-1603
        // item 2.5): `plan-review` reuses `review`'s verdict vocabulary, and the
        // close-out evidence rules in lib/prompts/meta-prompt-template.js must be able
        // to tell the two verdict kinds apart. It is a DISAMBIGUATING HEADER ON THE
        // COMMENT, never a required format anything keys on (LIN-810) — those rules
        // exclude a verdict about the plan whether or not the header is present, and
        // the plan template's revision half likewise recognises the verdict by
        // substance. So a missing header degrades nothing; it only makes the trail
        // easier to read.
        'Whatever the verdict, record it: add a comment headed `### Plan Review Verdict`, containing the per-check findings and the verdict with its one-line justification. That header exists to keep this verdict distinguishable from a `review` verdict at the other end of the pipeline — both use the same Approve / Request Changes / Needs Discussion vocabulary, but only `review` speaks to a built deliverable, and an Approve here must never be mistaken for authorization to close the task out. Leave the plan itself untouched — on an Approve the implementer acts on what you found; otherwise the planner does.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'implementation': {
    name: 'implement',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Guide for active implementation phase. Use when research and planning are complete and coding is in progress.',
    completionSignals: COMPLETION_SIGNALS['implementation'],
    aiHint: {
      situation: 'ready to code, plan exists',
      goal: 'Implement the planned changes with test coverage, then land them on a feature-branch PR with CI green.',
      workflow: 'Fetch details → Branch → Implement → Test → Commit & push → Open PR → Confirm CI green → Add summary comment with PR link in Linear'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Implement', issue),
        '',
        `## Workflow

1. **Start**: Set ${issue.identifier} status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for ${issue.identifier} in Linear
3. **Branch**: Work on a feature branch (e.g. \`feat/${issue.identifier.toLowerCase()}-short-description\`) — never commit straight to main
4. **Implement**: Complete the goal below
5. **Test**: Run tests to verify implementation
6. **Commit & push**: Commit with a message referencing ${issue.identifier}, then push the branch
7. **Open a PR**: Open a pull request targeting main and referencing ${issue.identifier} — the PR is this step's deliverable, the evidence the work landed
8. **Confirm CI**: Wait for CI to run on the PR. If it is red, fix the failures and push again until it is green. This step is done only when the PR is open AND CI is green — if CI cannot be made green here, say so explicitly with the reason rather than reporting success. (Merging is NOT yours: the merge happens after review approves, performed by the orchestrator or a human.)
9. **Update Linear**: Add a summary comment in Linear with the PR link`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['implementation'])),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a software engineer executing planned changes. You have authority to implement code and tests within the defined scope; flag scope expansion for approval rather than absorbing it.',
        '',
        'Start by reading the plan in the description (if present). Confirm the files it names still exist and the surfaces still map to the current code. If something has drifted, stop and recommend re-planning before implementing.',
        '',
        formatPlanFidelityCheck(),
        '',
        '### Implementation Guidelines',
        '',
        '1. Follow the plan and the research it was derived from; where they disagree, the research\'s reasoning wins — flag the conflict rather than silently picking one',
        '2. Each change should be self-contained: specify both the behavior **and** its cleanup/teardown contract (not just the happy path)',
        '3. For new dependencies being integrated for the first time, verify all required setup beyond just API calls',
        '4. Write tests for new/changed behavior — cover intended effects and any interactions the plan flagged',
        '5. Verify all tests pass before completing',
        '6. Keep changes minimal and focused on the task',
        '7. Do not trust a "behavior-preserving" or "refactor" label: enumerate the specific behaviors of the old code (checks, error strings, conditions, query shape) and verify each still holds — ideally via a characterization test written before the change. A silent behavioral change on a shared path is a defect even if the new behavior is arguably better; surface it.',
        '',
        '### Shared Boundaries',
        '',
        'When multiple behaviors converge on the same function, component, or state, ensure each behavior stays isolated and document any non-obvious interactions in code comments. If the plan identified cross-cutting concerns on shared surfaces, they must appear in the relevant implementation step — not deferred to review.',
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
    aiHint: {
      situation: 'implementation complete, awaiting review',
      goal: 'Verify the implementation is complete and correct, then issue a verdict (Approve / Request Changes / Needs Discussion) that authorizes the merge. Review does not merge or mark Done.',
      workflow: 'Fetch details → Verify requirements/tests/CI green on the PR → Issue verdict → Add review findings + verdict as comment in Linear'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Review', issue),
        '',
        formatReadOnlyWorkflow(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, ['review'])),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a quality assurance reviewer verifying implementation completeness. Your role is to verify against requirements, not to add new requirements.',
        '',
        'Start by reading the plan and any implementation notes in comments. Confirm the scope recorded there matches what has actually changed on disk or in Linear. If implementation overran the plan\'s surfaces or the plan is stale, flag this as a review finding rather than pressing on.',
        '',
        'Verify the implementation is complete and meets the requirements.',
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
        'Before approving the close, check whether the verified work is one instance of a class: the same bug, gap, or behavior often has siblings under a different name, in a parallel code path, or split across server and client. Search for the pattern itself, not only the surface the ticket cites. If siblings exist, name the class and list the unhandled instances as a review finding so follow-up work can be scoped deliberately — do not expand this task to fix them. A genuinely isolated change is a valid result; state it explicitly.',
        '',
        '### Test Quality Check',
        '',
        'Assess whether tests cover the right *level* — not just whether tests exist:',
        '- For behavior crossing module boundaries, user-facing flows, or integration surfaces, verify higher-level tests like e2e or integration exist *where appropriate* rather than only unit tests with mocks',
        '- Flag when a change adds only low-level tests for behavior that needs end-to-end coverage',
        '- Determine the appropriate test level from the change itself (UI/route/cross-module → e2e; pure function → unit); do not enforce a fixed rule',
        '',
        '### Review Checklist',
        '',
        '- [ ] Implementation matches task requirements',
        '- [ ] Tests cover new/changed behavior',
        '- [ ] Tests exist at the appropriate level (e2e/integration for cross-module or user-facing behavior, not only unit tests)',
        '- [ ] Tests verify no unintended side effects (state left clean after each interaction)',
        '- [ ] Where multiple features share a code path or state, their interactions are tested',
        '- [ ] No security vulnerabilities introduced',
        '- [ ] Error handling is appropriate',
        '- [ ] Code style consistent with the codebase',
        '- [ ] No performance regressions',
        '- [ ] CI/CD pipeline passes (green on the PR)',
        '- [ ] No regressions introduced',
        '- [ ] Class check answered: isolated, or class named with unhandled instances listed',
        '- [ ] Code is ready for production',
        '',
        '### Manual Verification',
        '',
        'For visual or behavioral changes, verify the result directly where possible rather than relying solely on automated tests.',
        context.attachments?.length > 0 ? 'If a spec or mockup attachment exists for this task, view it and the actual result side-by-side before judging visual fidelity — never judge fidelity from the result alone.' : '',
        '',
        'If something cannot be verified by the agent (external service integration, cross-browser behavior, subjective UX), flag it for human testing with specific instructions on what to check.',
        '',
        '### What CI Did Not Prove',
        '',
        'Before the verdict, write the handoff ledger — the artifact the `close-out` step consumes. Enumerate every claim the deliverable depends on that the green CI run does NOT actually exercise. Common kinds (illustrative, not a checklist): an external contract or API behaviour CI cannot reach; a *producer* that must emit an input this change now *consumes*; a user-reachable entry path no automated test drives; a sibling on a parallel surface; or anything only a human can confirm. For each item, state how it can be discharged — a real-world check, a manual repro naming its **exact distinguishing precondition**, or a routed follow-up ticket.',
        '',
        'Keep this ledger distinct from the class check above: the class check is about *breadth* (unhandled siblings → follow-up tickets); this ledger is about *verification depth* (what the deliverable rests on that CI cannot prove → close-out gate items). A class sibling belongs here ONLY if this deliverable\'s correctness depends on it; otherwise it stays a follow-up, not a ledger item.',
        '',
        '**Proportional to risk class.** An inherently-unprovable-before-merge claim — model/behavioural compliance with a new directive, real-world recurrence of an incident — becomes a hard close-out *gate item* (one needing cited evidence or explicit human acceptance before merge) only when the change carries real risk: it touches runtime logic, a data path, security, or an external contract. Two lanes take such a claim out of the hard-gate class, and **naming is the price of both** — an unnamed monitor or an unnamed rollback does NOT get the lane:',
        '',
        '- **Unprovable in principle → name the monitor.** A claim that cannot be proven before merge *at all* — not merely one this CI run happens not to cover — is recorded as a **post-merge observation** and discharges through normal post-merge observation **regardless of risk surface**, provided you name the specific monitor that would surface it going wrong: a log or oplog entry, a metric, a path that fails loudly, or a routed follow-up ticket that owns the watch. If no monitor can be named, it stays a hard gate item. *Misfire guard:* a claim a test COULD have proven is not unprovable-in-principle — it is an untested claim, it stays a gate item, and it usually means **Request Changes**. Naming the monitor is the price of the lane, not a formality.',
        '- **Low-risk and reversible → name the rollback.** The low-risk lane spans prompt-text, docs, or comment-only changes, and also a **runtime-logic** change that is genuinely reversible — which means all three hold: (a) you name the rollback, either the single commit to revert or the exact env var / flag and its safe value; (b) the rollback is complete — no migration, no data already persisted in the new shape, no third party has already consumed the new behaviour; (c) it needs no coordinated release. "Everything is revertable in git" fails (b) the moment the change writes data or is externally observed. **Data-path, security, and external-contract surfaces are NOT widened into this lane** — they fail (b) or (c) by construction.',
        '',
        'Key the lane on the *risk surface* and on what you can name, never on lines-of-code, t-shirt size, or literal file type — a docs-only change qualifies, and a prompt change that also edits routing logic does NOT qualify on file type alone (it takes the lane only if its rollback can be named). This never lowers the floor for risky claims: a claim that neither lane covers — one a check or a test could have proven, or one on a data-path, security, or external-contract surface whose rollback is not complete — stays a hard gate item, discharged only by cited evidence or a human naming the exact precondition (a reviewer\'s own "no action needed" self-assessment is never that sign-off). Widening the lane never widens the *ledger*: still enumerate every claim CI does not exercise — only the discharge route changes.',
        '',
        '**Cheap when empty:** if green CI genuinely covers the whole deliverable, say so in one explicit line — "CI covers the deliverable; ledger empty" — and do not manufacture doubt about a self-contained change. An explicitly empty ledger makes close-out a no-op pass-through.',
        '',
        '### Verdict',
        '',
        'Conclude with an explicit verdict: **Approve** / **Request Changes** / **Needs Discussion**, with a one-line justification. The verdict is review\'s deliverable — it *authorizes* the close, it does not perform it. **Make the approval conditional on the ledger:** when the `### What CI Did Not Prove` ledger above is non-empty, the verdict must be `Approve — conditional on close-out discharging the ledger`, never a bare Approve; only an explicitly empty ledger may carry a plain **Approve**. Review does NOT merge, does NOT mark the task Done, and does NOT file the close-out follow-ups itself.',
        '',
        '### Hand Off to Close-Out',
        '',
        'Review is write-only: your deliverable is the ledger plus the (conditional) verdict, recorded in the summary comment. You do NOT merge, mark the task Done, or file close-out follow-ups — those irreversible actions belong to the `close-out` step, which reads the ledger you wrote and gates on it. Do NOT try to confirm a merge that has not happened yet (your Approve is its precondition). Before issuing **Approve**, confirm **CI is green on the PR** — the change is not approvable while CI is red, however complete the code looks (a real CI failure because the work is unfinished is **Request Changes**, handed back to implementation, not a fix loop here), and confirm the checklist, gap analysis, regression, and class checks above are satisfied.',
        '',
        'On **Approve** (or **Approve — conditional**), hand off to `close-out`: it re-checks CI on a fresh read of the exact commit, discharges or explicitly accepts every ledger item, then merges, sets the task Done, posts the summary, and files any remaining follow-ups. Your job ends at the verdict plus the ledger-bearing summary comment.',
        '',
        '**Cannot-close branch — when the work has landed but CI is red for a real failure, or verifying it surfaced a hidden blocker (a second, larger bug the fix exposed; a prerequisite that must be fixed first):** do NOT loop back into another `review`, and do NOT hand to `close-out`. Instead:',
        '- Create a new Linear ticket for the surfaced work, or link an existing open task if one already covers it, as a `blocks` relation on the current task.',
        '- Make this prompt\'s final handoff name that blocker as the next action (`bug`, `plan`, or `implementation` as fits the work) — NOT another `review`. A `blocks` relation does not make the engine descend on its own, so the next action must be named explicitly.',
        '- Leave the current task open with a **Request Changes** / **Needs Discussion** verdict. It closes only once the blocker is resolved and CI is green — review re-runs then, Approves, and `close-out` performs the final close (review → file blocker → resolve blocker → re-review → close-out → merge → close).',
        '',
        'Keep this closure blocker distinct from a plan-phase prerequisite-refactor subtask: that one sequences a refactor *before* implementation; this one captures work that surfaced *at review time* and prevents close-out.',
        '',
        '### Completion',
        '',
        'Whatever the verdict, record it: add a summary comment containing the `### What CI Did Not Prove` ledger, the verdict, and the CI state. Do NOT mark the task Done and do NOT merge — `close-out` owns the merge, the Done transition, and the follow-up filing. On **Approve** (or **Approve — conditional**) the task is left ready for `close-out` with the ledger in its summary comment; on **Request Changes** / **Needs Discussion** it stays open with the next action named (per the cannot-close branch when a blocker surfaced).'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'close-out': {
    name: 'close-out',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Final close-out after an approved review: discharge the Not-Proven-by-CI ledger, then merge, set Done, post the summary, and file remaining follow-ups. Use when review has Approved and the PR is green.',
    completionSignals: COMPLETION_SIGNALS['close-out'],
    aiHint: {
      situation: 'review approved, PR green, ready to land',
      goal: 'Consume the review\'s Not-Proven-by-CI ledger and gate the irreversible finish: block merge/Done until every ledger item is discharged or explicitly accepted, then merge, set Done, post the summary, and file remaining follow-ups.',
      workflow: 'Fetch details + latest review comment → Read the ledger → Gate (discharge or accept each item) → Merge → Set Done → Post summary → File follow-ups'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Close Out', issue),
        '',
        `## Workflow

1. **Fetch details**: Get full issue details for ${issue.identifier}, including the most recent review summary comment.
2. **Read the review**: From that review comment, read the verdict and any gaps it flagged as not covered by CI.
3. **Gate**: Do not proceed past this step until the ledger is satisfied (see the Ledger Gate below). This is the load-bearing step — everything after it is irreversible.
4. **Merge**: Only once the gate passes, merge the approved PR — re-check that CI is green on a fresh read of the exact commit first.
5. **Complete**: Verify the change on the **landed commit** as this session's last step, then set ${issue.identifier} status to "Done" — do not leave the task open for a separate verification pass, and do not file a follow-up whose entire content is "confirm the merged change works".
6. **Summarize**: Add a summary comment on ${issue.identifier} recording what was merged, how each ledger item was discharged or accepted, and the final CI state.
7. **File follow-ups**: Create any remaining follow-up tickets the review named, routed to the right project and linked to the source task.`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, ['close-out'])),
        '',
        '## Goal',
        '',
        '**Role**: Act as the release gate that owns the irreversible finish. Review judged the deliverable; your job is to discharge what review could not prove, then land it. You do NOT re-review code quality — you enforce the ledger and perform the merge, the Done transition, the summary, and the follow-up filing.',
        '',
        'Review is write-only and has already recorded its verdict, along with any gaps it judged CI does not cover, in its summary comment. You consume those and decide whether the work may become irreversible.',
        '',
        '### Not-Proven-by-CI Ledger Gate',
        '',
        'Do NOT merge or set the task Done while any ledger item is undischarged. Each item must be either:',
        '- **(a) discharged** — with evidence you cite: a real-world check you performed, a manual repro that named and exercised its **exact distinguishing precondition**, or a routed follow-up ticket that fully owns it; or',
        '- **(b) explicitly accepted** — by a human who names the exact precondition they exercised.',
        '',
        '**Green CI is never evidence for a ledger item.** A ledger item exists precisely because CI cannot reach it, so a green run satisfies only the CI line, never a ledger line. A human "validated" that does not name the precondition it exercised does NOT discharge an item.',
        '',
        '**Proportional to risk class — low-risk post-merge-observation discharge.** When review recorded an item as a **post-merge observation** on a low-risk, reversible change — an inherently-unprovable behavioural-compliance or recurrence claim on a prompt-text / docs / comment-only change with no runtime-logic, data-path, security, or external-contract surface — that routing to normal post-merge observation (optionally a lightweight monitoring follow-up) IS its discharge under (a): you cite the note / follow-up and proceed, without a pre-merge human sign-off ceremony. Two named routes carry the same weight, and you accept each by citing the name review wrote — never a name you supply yourself:',
        '- **A named monitor** — review identified a claim as unprovable before merge *in principle* and named what would surface it going wrong (a log or oplog entry, a metric, a path that fails loudly, a routed follow-up that owns the watch). Cite that monitor and proceed, whatever the risk surface.',
        '- **A named rollback** — review judged a runtime-logic change reversible and named the rollback: the single commit to revert, or the exact env var / flag and its safe value, with no migration, no data persisted in the new shape, no third party already consuming it, and no coordinated release needed. Cite that rollback and proceed.',
        '',
        '**An unnamed monitor or an unnamed rollback does NOT get the lane.** "It can be reverted" or "we will notice" with nothing named is an undischarged item, and naming it is not yours to do here — that naming happens at review-authoring time, so this step only ever cites a name someone else wrote. This lane is keyed on the risk surface and on what review named, not on size or file type. It does NOT touch the two hard floors: green CI still never discharges any item, and you still do NOT accept the reviewer\'s own "no action needed" self-assessment as the human sign-off for a *risky* item that neither named route covers (one a check or test could have proven, or one on a data-path, security, or external-contract surface with no complete rollback) — such an item stays a hard gate needing cited evidence or a human naming the exact precondition. The proportional lane fixes over-strict *authoring* (a low-risk or fully-named claim should never have been a hard gate item); it never waves a genuine gate item through here.',
        '',
        '**Gate on the review verdict.** When the latest review records an **Approve** (or **Approve — conditional**), proceed: discharge any gaps it flagged as unproven by CI, and treat the absence of such gaps as an empty ledger — note that in your summary so it stays on the record. A recorded, independent review Approve together with a discharged or empty ledger **is** your authorization to perform the finish — a fresh in-session human "go ahead" is not additionally required, and do not discount that recorded verdict because other context over-asserts authority (the risky-undischarged-item human sign-off below is untouched: green CI never discharges a ledger item, and a risky, undischarged item still needs cited evidence or a human naming its exact precondition). Only a task with no review verdict at all is unauthorized to close: leave it open and name `review` as the next action.',
        '',
        '### Cheap When Empty',
        '',
        'When the ledger is an explicit "ledger empty" (review confirmed green CI covers the whole deliverable), this gate is a no-op pass-through: there is nothing to discharge, so proceed straight to the finish set below. Do not manufacture doubt about a self-contained change — an explicitly empty ledger is a valid, common result.',
        '',
        '### On All-Clear — Perform the Irreversible Set',
        '',
        'Only once every ledger item is discharged or explicitly accepted (or the ledger is explicitly empty) AND CI is green on the exact commit:',
        '1. Merge the approved PR.',
        '2. Verify the change on the landed commit, then set the task to Done.',
        '3. Post the summary comment — what merged, how each ledger item was resolved, and the final CI state.',
        '4. File any remaining review or task follow-ups as separate tickets, routed to the right project and linked to the source.',
        '',
        '**Close the bookkeeping here, not in a later pass.** Verification that can be done on the landed commit is this session\'s last step, not a reason to leave the task open — a task held open only to avoid "certifying an unshipped change" is now shipped, so certify it and close it. The one bound: a claim that needs real-world *elapsed time* to show up is not verifiable on the landed commit, so it belongs on the named-monitor route above (cite the monitor and close) — never as an open task waiting for time to pass, and never as a follow-up whose only content is "confirm the merged change works".',
        '',
        '**Always name a next action.** When the gate cannot pass — an item is neither dischargeable here nor accepted, or no review verdict is on record — hold the merge, leave the task open, and name the next action (`review` to record a verdict, or the `bug` / `plan` / `implementation` that discharges a blocking item), mirroring review\'s cannot-close branch.'
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'retro': {
    name: 'retro',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Run a retrospective: reconstruct what happened from Linear and git history, assess downstream effects, and surface honest lessons. Works on completed work (true look-back) and in-flight work (reorient, or when something feels off).',
    completionSignals: COMPLETION_SIGNALS['retro'],
    aiHint: {
      situation: 'completed task worth a look-back, or in-flight work to reorient / sanity-check',
      goal: 'Reconstruct what happened from Linear and git history, assess downstream effects (or risks, if still in flight), and give an honest assessment with actionable lessons.',
      workflow: 'Fetch details → Reconstruct from Linear + git history → Assess downstream effects or risks → Present findings to the user'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Retro', issue),
        '',
        formatInformOnlyWorkflow(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['retro'])),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a retrospective analyst reviewing work with the benefit of hindsight. Your role is to give an honest account and surface useful lessons, not to assign blame or re-litigate decisions.',
        '',
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
