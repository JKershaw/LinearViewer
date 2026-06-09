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
  formatScaleToTask
} from './prompt-formatters.js';

/**
 * Prompt template definitions
 * Each template has:
 * - name: Display name for the prompt
 * - category: When prompt is available (pre-work, work-issue, ready)
 * - generate: Function that takes (issue, context) and returns prompt string
 */
export const PROMPT_TEMPLATES = {
  [WORK_ISSUE_LABELS.BLOCKED]: {
    name: 'blocked',
    category: PROMPT_CATEGORIES.WORK_ISSUE,
    description: 'Analyze and resolve blockers preventing progress. Use when work is stalled due to dependencies, missing info, or technical issues.',
    completionSignals: COMPLETION_SIGNALS[WORK_ISSUE_LABELS.BLOCKED],
    aiHint: {
      situation: 'dependencies, missing info, or stalled',
      goal: 'Identify the blocker type and root cause, evaluate options to unblock.',
      workflow: 'Fetch details → Analyze blocker → Update labels and add comment in Linear'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Unblock', issue),
        '',
        formatWorkflow(PROMPT_CATEGORIES.WORK_ISSUE, issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Related Tasks', formatSiblings(context.siblings)),
        formatSection('Labels', formatLabels(issue.labels, [WORK_ISSUE_LABELS.BLOCKED])),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical analyst diagnosing work impediments. You have authority to identify blockers, evaluate options, and recommend solutions, but cannot unilaterally make decisions that require stakeholder input.',
        '',
        '**First**: Check the current status of all blocking dependencies. If the blocker is already resolved (e.g., blocking issue is Done, dependency is available, information has been provided), skip the full analysis — just confirm unblocked, remove the `blocked` label, and recommend the next action.',
        '',
        'If the blocker is still active, analyze:',
        '- **Blocker Type**: Dependency, missing info, technical issue, external, or other',
        '- **Root Cause**: What\'s actually preventing progress',
        '- **Options**: 2-3 ways to unblock with tradeoffs',
        '- **Recommendation**: Best path forward with rationale',
        '',
        '**When resolved**: Remove the `blocked` label in Linear'
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
        '2. Identify likely causes:',
        '   - Run `git log --oneline -15 -- <affected file(s)>` and read recent commits; if 3+ commits touch the same file, that signals tight coupling or fragile code',
        '   - Check `git log --all --grep="<keyword from bug description>"` to see if this was fixed before (if no results, widen the keyword or skip — absence of results doesn\'t mean no prior fix)',
        '   - Examine the affected code paths for tight coupling or unusual patterns',
        '3. Debug systematically (add logging, trace execution)',
        '4. Propose fix with minimal scope',
        '5. Verify fix doesn\'t introduce regressions',
        '',
        '**When fixed**: Remove the `bug` label in Linear'
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
      goal: 'Create a clear implementation plan, enumerate surfaces with any dependency arrows between them, and commit to a session-fit answer (fits one session / needs multiple sessions).',
      workflow: 'Set status to "In Progress" → Analyze requirements → Document plan in description → Enumerate surfaces and draw any dependency arrows → Answer the session-fit question → Ready for implementation or breakdown'
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
        // a prerequisite refactor must be sequenced as a separate blocking subtask,
        // never folded into implementation steps.
        'If a Surface Assessment in prior research comments identifies a prerequisite refactor, encode it as a separate blocking subtask using the assessment\'s description directly — do not absorb the refactor into implementation steps, as that loses the sequencing guarantee.',
        '',
        formatSubtaskSummary(context.children),
        // Scale-to-task (lower bound) — woven in BEFORE the heavy framing machinery so a
        // genuinely small task can skip it. Mirrors the meta-prompt "Scale To The Task"
        // rule (lib/prompts/meta-prompt-template.js); proven on the meta-prompt path via
        // scripts/eval-prompt-scaling.mjs. See lib/prompt-formatters.js formatScaleToTask.
        formatScaleToTask(),
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
        formatIfBlocked()
      ].filter(Boolean)

      return sections.join('\n')
    }
  },

  'code-review': {
    name: 'code review',
    category: PROMPT_CATEGORIES.READY,
    description: 'Review code changes for correctness, tests, and quality. Use when code is ready for review before merging.',
    completionSignals: COMPLETION_SIGNALS['code-review'],
    aiHint: {
      situation: 'code ready for review',
      goal: 'Review code changes for correctness, tests, style, security, and performance.',
      workflow: 'Fetch details → Review code → Add review findings as comment in Linear'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Review', issue),
        '',
        '## Workflow',
        '',
        `1. **Fetch details**: Get full issue details for ${issue.identifier} in Linear`,
        '2. **Review**: Examine the code changes against the task requirements',
        `3. **Document**: Add review findings as a comment on ${issue.identifier} in Linear`,
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['code-review'])),
        formatDiscussionReference(issue, { useLinear: featureFlags.linearMcp !== false }),
        '',
        '## Goal',
        '',
        '**Role**: Act as a code reviewer ensuring quality before merge. You have authority to approve, request changes, or flag concerns, but cannot override explicit project requirements.',
        '',
        'Start by reading the plan and any implementation notes in comments. Confirm the scope recorded there matches what has actually changed on disk or in Linear. If implementation overran the plan\'s surfaces or the plan is stale, flag this as a review finding rather than pressing on.',
        '',
        'Review code changes for correctness, tests, style, security, and performance.',
        '',
        'Review checklist:',
        '- [ ] Changes match task requirements',
        '- [ ] Tests cover new/changed behavior',
        '- [ ] No security vulnerabilities introduced',
        '- [ ] Code style consistent with codebase',
        '- [ ] No performance regressions',
        '- [ ] Error handling is appropriate',
        '',
        'Provide verdict: **Approve** / **Request Changes** / **Needs Discussion**'
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
      situation: 'missing metadata, unclear priority',
      goal: 'Review and apply updates to labels, priority, and state.',
      workflow: 'Fetch details → Analyze → Apply changes directly in Linear'
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
        '### Label Selection Guide',
        '',
        'Labels indicate **current state**, not future needs.',
        '',
        '**Available Labels:**',
        `- \`${WORK_ISSUE_LABELS.BLOCKED}\`: Work is stuck on external dependency, decision, or missing information`,
        `- \`${WORK_ISSUE_LABELS.BUG}\`: Unexpected behavior discovered that needs investigation and fix`,
        '',
        '**Label Rules:**',
        `- Add \`${WORK_ISSUE_LABELS.BLOCKED}\` when work is stuck; remove it when the blocker is resolved`,
        `- Add \`${WORK_ISSUE_LABELS.BUG}\` when unexpected behavior is found; remove it when the fix lands`,
        '',
        '### Other Metadata',
        '',
        '- **Priority**: Is the current priority appropriate given importance and urgency?',
        '- **State**: Is it in the right workflow state for its current progress?',
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
        '- Check how similar problems were solved here before — search the codebase and run `git log` on related areas',
        '- Validate feasibility: if an approach is unproven, confirm it actually works (a small spike) before recommending it',
        '',
        'Document your findings:',
        '- Key discoveries and insights',
        '- Options considered with pros/cons',
        '- Recommended approach for the plan that follows (so planning can score a validated option, not an assumption)',
        '',
        // Surface Assessment — mirrors the meta-prompt research quality rule in
        // lib/prompts/meta-prompt-template.js so both prompt paths surface
        // refactoring the same way. The plan step reads this from the comment and,
        // if a refactor is named, encodes it as a separate blocking subtask.
        '### Surface Assessment',
        '',
        'End your research with an explicit Surface Assessment: state whether the implementation can land cleanly on the current code, or whether a specific minimal refactor would make it land better. The answer must be explicit — not implied — so the plan step can act on it.',
        '',
        'Format: `Surface Assessment: [implementation can land cleanly]` OR `Surface Assessment: [refactor needed: <describe the minimal scoped change>]`',
        '',
        'Describe the specific scoped change (not a general tidy-up), or state clearly that no preparation is needed. A prerequisite refactor named here becomes a separate blocking subtask at the plan step — it is not absorbed into implementation.',
        '',
        '**Output:**',
        '- **Comment**: Full research notes, exploration process, sources consulted, and the Surface Assessment',
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
      workflow: 'Fetch details → Define scope → Update issue description with finalized scope in Linear'
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
      workflow: 'Fetch details → Design → Add full analysis as comment, update description with chosen design in Linear'
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
      workflow: 'Fetch details → Spike → Add findings as comment in Linear'
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

  'implementation': {
    name: 'implement',
    category: PROMPT_CATEGORIES.UNIVERSAL,
    description: 'Guide for active implementation phase. Use when research and planning are complete and coding is in progress.',
    completionSignals: COMPLETION_SIGNALS['implementation'],
    aiHint: {
      situation: 'ready to code, plan exists',
      goal: 'Implement the planned changes with test coverage.',
      workflow: 'Fetch details → Implement → Run tests → Commit → Add summary comment in Linear'
    },
    generate: (issue, context, featureFlags = {}) => {
      const sections = [
        formatHeader('Implement', issue),
        '',
        `## Workflow

1. **Start**: Set ${issue.identifier} status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for ${issue.identifier} in Linear
3. **Implement**: Complete the goal below
4. **Test**: Run tests to verify implementation
5. **Commit**: Push changes with commit message referencing ${issue.identifier}
6. **Update Linear**: Add summary comment in Linear`,
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
        '### Implementation Guidelines',
        '',
        '1. Follow the plan, including any history-sourced constraints it documented',
        '2. Each change should be self-contained: specify both the behavior **and** its cleanup/teardown contract (not just the happy path)',
        '3. For new dependencies being integrated for the first time, verify all required setup beyond just API calls',
        '4. Write tests for new/changed behavior — cover intended effects and any interactions the plan flagged',
        '5. Verify all tests pass before completing',
        '6. Keep changes minimal and focused on the task',
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
      goal: 'Verify implementation is complete and ready for merge.',
      workflow: 'Fetch details → Verify tests pass → Check CI status → Add review findings as comment in Linear'
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
        '- [ ] CI/CD pipeline passes',
        '- [ ] No regressions introduced',
        '- [ ] Code is ready for production',
        '',
        '### Manual Verification',
        '',
        'For visual or behavioral changes, verify the result directly where possible rather than relying solely on automated tests.',
        '',
        'If something cannot be verified by the agent (external service integration, cross-browser behavior, subjective UX), flag it for human testing with specific instructions on what to check.',
        '',
        '### Completion',
        '',
        'When review passes:',
        '1. Add a summary comment noting what was verified',
        '2. Update task status as appropriate'
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
