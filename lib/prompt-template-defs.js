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
  PREPARING_LABEL,
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
  formatComments,
  formatLabels,
  formatPreparingLabelRemoval,
  formatSuccessCriteria,
  formatIfBlocked
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
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
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
        formatMultiLineSection('Bug Reports & Discussion', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a software debugger investigating unexpected behavior. You have authority to reproduce issues, trace root causes, and propose fixes, but should not deploy changes without review.',
        '',
        'Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach.',
        '',
        'Investigation process:',
        '1. Reproduce the issue (document exact steps)',
        '2. Identify likely causes (code paths, recent changes)',
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
      goal: 'Create a clear implementation plan and assess whether the task needs breakdown into subtasks.',
      workflow: 'Set status to "In Progress" → Analyze requirements → Document plan in description → Assess scope for breakdown → Ready for implementation or breakdown'
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
        formatPreparingLabelRemoval(issue),
        '',
        '## Context',
        '',
        formatSection('Project', formatProject(context.project)),
        formatSection('Parent Task', formatParent(context.parent)),
        formatMultiLineSection('Sibling Tasks', formatSiblings(context.siblings)),
        formatMultiLineSection('Subtasks', formatChildren(context.children)),
        formatSection('Labels', formatLabels(issue.labels, ['plan', PREPARING_LABEL])),
        formatMultiLineSection('Prior Discussion', formatComments(context.comments)),
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
        '### Cross-Cutting Concerns',
        '',
        'After drafting the plan, check for **shared boundaries** — places where two or more requirements converge on the same function, component, state, or interface:',
        '- Do any acceptance criteria share the same code path, event handler, or state?',
        '- Could satisfying one requirement produce side effects that conflict with another?',
        '- Where interactions overlap, document the expected behavior explicitly',
        '',
        '**After planning**: Update the issue description with the implementation plan so the task overview reflects what will be done.',
        '',
        formatSubtaskSummary(context.children),
        '### Scope Assessment',
        '',
        'After creating the plan, evaluate whether this task should be broken into subtasks:',
        '',
        '**Appropriately sized (proceed to implementation):**',
        '- Describes a single coherent change, even if multiple files are touched',
        '- A developer could hold the full scope in their head at once',
        '- All steps are sequential parts of one feature',
        '',
        '**Needs breakdown:**',
        '- Plan reveals multiple *independent* features that could ship separately',
        '- Would require context-switching between unrelated systems',
        '- Scope is so large that meaningful progress requires splitting',
        '',
        'If breakdown is needed, note this in the description alongside the plan.',
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
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a code reviewer ensuring quality before merge. You have authority to approve, request changes, or flag concerns, but cannot override explicit project requirements.',
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
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
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
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
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
        `- \`${PREPARING_LABEL}\`: Task needs pre-implementation work (research, breakdown, design, etc.) before it\'s ready to implement`,
        `- \`${WORK_ISSUE_LABELS.BLOCKED}\`: Work is stuck on external dependency, decision, or missing information`,
        `- \`${WORK_ISSUE_LABELS.BUG}\`: Unexpected behavior discovered that needs investigation and fix`,
        '',
        '**Label Rules:**',
        `- Add \`${PREPARING_LABEL}\` if task needs research, breakdown, scoping, or design before implementation`,
        `- Remove \`${PREPARING_LABEL}\` when pre-work is complete and task is ready to implement`,
        `- \`${WORK_ISSUE_LABELS.BLOCKED}\` and \`${WORK_ISSUE_LABELS.BUG}\` can coexist with \`${PREPARING_LABEL}\``,
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
      situation: 'large, vague, or complex',
      goal: 'Break this task into smaller, actionable subtasks ordered by dependencies.',
      workflow: 'Fetch details → Analyze → Create subtasks → Add blocked-by relations → Add summary comment in Linear'
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
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical decomposer breaking complex work into actionable units. You have authority to create subtasks and define dependencies, but should preserve the original task\'s intent and scope.',
        '',
        'Break this task into smaller, actionable subtasks ordered by dependencies.',
        context.children?.length > 0 ? 'Review existing subtasks and avoid duplicating them.' : '',
        '',
        '### Creating Subtasks',
        '',
        'For each subtask, create it in Linear with:',
        '- Clear title and description with acceptance criteria',
        '- `parentId` to link to the parent issue',
        '- `projectId` inherited from parent',
        '- `stateId` set to "Todo"',
        '',
        '### After Creating All Subtasks',
        '',
        '1. Create `blocked-by` relations to establish execution order',
        '2. Add a summary comment to the parent grouping subtasks by phase'
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
      situation: 'unknowns, options to explore',
      goal: 'Identify key questions, research systematically, and provide actionable recommendations.',
      workflow: 'Fetch details → Research → Add exploration notes as comment, update description with key findings in Linear'
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
        formatMultiLineSection('Prior Research & Discussion', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a technical researcher investigating unknowns. Your role is to gather information and provide recommendations, not to make final decisions on direction.',
        '',
        'Identify key questions, research systematically, and provide actionable recommendations.',
        context.comments?.length > 0 ? 'Review the prior research above and build on existing findings.' : '',
        '',
        'Document your findings:',
        '- Key discoveries and insights',
        '- Options considered with pros/cons',
        '- Recommended next steps',
        '',
        '**Output:**',
        '- **Comment**: Full research notes, exploration process, sources consulted',
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
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
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
        formatMultiLineSection('Prior Discussion', formatComments(context.comments)),
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
        formatMultiLineSection('Prior Research', formatComments(context.comments)),
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
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a project historian synthesizing task state. Your role is to inform and summarize, not to make changes or decisions.',
        '',
        'Synthesize current state, what\'s done, what remains, key decisions, and recommended next steps.',
        '',
        'Gather context from:',
        '- The discussion history above',
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
        formatMultiLineSection('Prior Discussion', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a software engineer executing planned changes. You have authority to implement code and tests within the defined scope, but should flag scope expansion for approval.',
        '',
        'Implement the changes described in the issue with appropriate test coverage.',
        '',
        '### Implementation Guidelines',
        '',
        '1. Follow the implementation plan in the description (if present)',
        '2. Each step should be self-contained: specify both the behavior **and** its cleanup/teardown contract (not just the happy path)',
        '3. For new dependencies being integrated for the first time, verify all required setup beyond just API calls',
        '4. Write tests for new/changed behavior',
        '5. Verify all tests pass before completing',
        '6. Keep changes minimal and focused on the task',
        '',
        '### Shared Boundaries',
        '',
        'When multiple behaviors converge on the same function, component, or state:',
        '- Ensure each behavior is isolated so they don\'t interfere with each other',
        '- Document any non-obvious interaction between features in code comments',
        '- Requirements from cross-cutting concerns must also appear in the relevant implementation step — don\'t rely on them being caught only during review',
        '',
        '### Testing',
        '',
        'For each changed behavior, verify:',
        '- The intended effect occurs (happy path)',
        '- No unintended state changes or side effects are introduced',
        '- Edge cases where multiple features interact on the same path',
        '',
        '### Scope Control',
        '',
        '- Only implement what is explicitly requested',
        '- Avoid over-engineering or adding unrequested features',
        '- Keep changes minimal and focused on the task',
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
        formatMultiLineSection('Discussion History', formatComments(context.comments)),
        '',
        '## Goal',
        '',
        '**Role**: Act as a quality assurance reviewer verifying implementation completeness. Your role is to verify against requirements, not to add new requirements.',
        '',
        'Verify the implementation is complete and meets the requirements.',
        '',
        '### Gap Analysis',
        '',
        'Before running the checklist, cross-reference the implementation against the plan:',
        '- Compare each cross-cutting concern or acceptance criterion against the implementation steps that were actually followed',
        '- **High-priority items**: Requirements that appear in the plan or cross-cutting concerns but were NOT explicitly addressed in an implementation step — these are the most likely gaps',
        '- Focus review attention on these gaps rather than re-verifying work that was just completed',
        '',
        '### Review Checklist',
        '',
        '- [ ] Implementation matches task requirements',
        '- [ ] Tests cover new/changed behavior',
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
  }
}
