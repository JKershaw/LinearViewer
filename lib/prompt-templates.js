/**
 * Prompt Templates for Label-Based AI Workflows
 *
 * Maps Linear labels to AI prompts that help process tasks.
 * Each template receives issue data and context (parent, siblings, project, children)
 * and generates a prompt for Claude Code with Linear MCP.
 */

/**
 * @typedef {Object} PromptContext
 * @property {Object|null} parent - Parent issue (id, title, identifier, state)
 * @property {Array} siblings - Sibling issues (up to 5 most relevant)
 * @property {Object|null} project - Project name and description
 * @property {Array} children - Existing child issues
 */

/**
 * Format sibling issues for display in prompt
 * @param {Array} siblings - Array of sibling issues
 * @returns {string} Formatted sibling list
 */
function formatSiblings(siblings) {
  if (!siblings || siblings.length === 0) {
    return 'None'
  }
  return siblings
    .map(s => {
      const status = s.state?.name || 'Unknown'
      return `- ${s.identifier}: "${s.title}" (${status})`
    })
    .join('\n')
}

/**
 * Format existing children for display in prompt
 * @param {Array} children - Array of child issues
 * @returns {string} Formatted children summary
 */
function formatChildren(children) {
  if (!children || children.length === 0) {
    return 'None'
  }
  return children
    .map(c => {
      const status = c.state?.name || 'Unknown'
      return `- ${c.identifier}: "${c.title}" (${status})`
    })
    .join('\n')
}

/**
 * Format description with truncation notice
 * @param {string|null} description - Issue description
 * @param {number} maxLength - Maximum length before truncation
 * @returns {string} Formatted description
 */
function formatDescription(description, maxLength = 500) {
  if (!description) {
    return 'No description provided'
  }
  const trimmed = description.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return `${trimmed.slice(0, maxLength)}...\n\n_(Description truncated. Use MCP to read full details.)_`
}

/**
 * Format project info consistently
 * @param {Object|null} project - Project object with name and description
 * @returns {string} Formatted project info
 */
function formatProject(project) {
  if (!project) return 'Unknown'
  let info = project.name
  if (project.description) {
    const desc = project.description.trim()
    info += desc.length > 100
      ? `\n  ${desc.slice(0, 100)}...`
      : `\n  ${desc}`
  }
  return info
}

/**
 * Format labels excluding specified ones
 * @param {Array} labels - Array of label names
 * @param {Array} exclude - Labels to exclude
 * @returns {string} Formatted labels or 'None'
 */
function formatLabels(labels, exclude = []) {
  const filtered = (labels || []).filter(l => !exclude.includes(l))
  return filtered.length > 0 ? filtered.join(', ') : 'None'
}

/**
 * Prompt template definitions
 * Each template has:
 * - name: Display name for the prompt
 * - generate: Function that takes (issue, context) and returns prompt string
 */
export const PROMPT_TEMPLATES = {
  'needs-breakdown': {
    name: 'Task Breakdown',
    generate: (issue, context) => {
      const parentInfo = context.parent
        ? `${context.parent.identifier}: "${context.parent.title}" (${context.parent.state?.name || 'Unknown'})`
        : 'None (this is a top-level task)'

      return `Using the Linear MCP, help me break down task ${issue.identifier}: "${issue.title}"

## Context

**Project:** ${formatProject(context.project)}

**Issue URL:** ${issue.url}

**Parent Task:** ${parentInfo}

**Sibling Tasks:**
${formatSiblings(context.siblings)}

**Existing Subtasks:**
${formatChildren(context.children)}

**Other Labels:** ${formatLabels(issue.labels, ['needs-breakdown'])}

**Current Description:**
${formatDescription(issue.description)}

## Instructions

1. Use \`mcp__linear__get_issue\` to read the full task details and any comments
2. Analyze what needs to be done to complete this task
3. Break the work into subtasks, aiming for 1-3 hour chunks each
4. Ensure subtasks are logically ordered (dependencies first)
5. Identify any blockers or unknowns that need resolution
6. Flag any ambiguities or missing requirements
${context.children?.length > 0 ? '7. Review existing subtasks above and avoid duplicating them\n' : ''}
## Output Format

Provide:
1. **Summary**: Your understanding of what this task accomplishes
2. **Subtasks**: A numbered list with:
   - Clear, actionable title
   - Brief description of what's involved
   - Estimated complexity (small/medium/large)
3. **Dependencies**: Any ordering constraints between subtasks
4. **Questions**: Anything that needs clarification before starting

After I approve the breakdown, use \`mcp__linear__create_issue\` to create the subtasks as children of ${issue.identifier}, then use \`mcp__linear__update_issue\` to remove the \`needs-breakdown\` label.`
    }
  },

  'needs-research': {
    name: 'Research Task',
    generate: (issue, context) => {
      const parentInfo = context.parent
        ? `${context.parent.identifier}: "${context.parent.title}" - provides context for why this research matters`
        : 'None (standalone research task)'

      return `Using the Linear MCP, help me research task ${issue.identifier}: "${issue.title}"

## Context

**Project:** ${formatProject(context.project)}

**Issue URL:** ${issue.url}

**Parent Task:** ${parentInfo}

**Related Tasks:**
${formatSiblings(context.siblings)}

**Other Labels:** ${formatLabels(issue.labels, ['needs-research'])}

**Research Topic:**
${formatDescription(issue.description, 800)}

## Instructions

1. Use \`mcp__linear__get_issue\` to read the full task details and any comments for additional context
2. Identify the key questions or unknowns that need to be answered
3. Research each question systematically - consider prior art, existing patterns, and tradeoffs
4. For technical topics, consider: feasibility, complexity, maintainability, and alternatives
5. Synthesize findings into actionable recommendations

## Output Format

Provide:
1. **Key Questions**: The specific unknowns this research addresses
2. **Findings**: What you discovered for each question
3. **Options**: If applicable, 2-3 approaches with pros/cons
4. **Recommendation**: Your suggested path forward with rationale
5. **Next Steps**: Concrete actions to take based on this research

After I review the findings, use \`mcp__linear__update_issue\` to:
- Add a comment with the research summary
- Remove the \`needs-research\` label
- Optionally add \`needs-breakdown\` or \`needs-design\` if follow-up work is identified`
    }
  },

  'needs-scoping': {
    name: 'Scope Definition',
    generate: (issue, context) => {
      const parentInfo = context.parent
        ? `${context.parent.identifier}: "${context.parent.title}" - the broader goal this contributes to`
        : 'None (top-level initiative)'

      return `Using the Linear MCP, help me define the scope of ${issue.identifier}: "${issue.title}"

## Context

**Project:** ${formatProject(context.project)}

**Issue URL:** ${issue.url}

**Parent Task:** ${parentInfo}

**Related Work:**
${formatSiblings(context.siblings)}

**Existing Subtasks:**
${formatChildren(context.children)}

**Other Labels:** ${formatLabels(issue.labels, ['needs-scoping'])}

**Current Description:**
${formatDescription(issue.description, 800)}

## Instructions

1. Use \`mcp__linear__get_issue\` to read the full task details and any discussion in comments
2. Identify what's explicitly requested vs. implied
3. Define clear boundaries - what IS and IS NOT included
4. List assumptions being made
5. Identify open questions that need answers before proceeding
6. Define measurable success criteria

## Output Format

Provide:
1. **Summary**: One paragraph explaining what this task will accomplish
2. **In Scope**: Bullet list of what this task covers
3. **Out of Scope**: Explicit exclusions (prevents scope creep)
4. **Assumptions**: What we're taking as given
5. **Open Questions**: Clarifications needed from stakeholders
6. **Success Criteria**: How we know this task is complete
7. **Risks**: Potential issues that could affect scope

After I approve the scope, use \`mcp__linear__update_issue\` to:
- Update the description with the scope definition
- Remove the \`needs-scoping\` label
- Add \`needs-breakdown\` if the task needs to be broken into subtasks`
    }
  },

  'needs-design': {
    name: 'Technical Design',
    generate: (issue, context) => {
      const parentInfo = context.parent
        ? `${context.parent.identifier}: "${context.parent.title}"`
        : 'None'

      return `Using the Linear MCP, help me create a technical design for ${issue.identifier}: "${issue.title}"

## Context

**Project:** ${formatProject(context.project)}

**Issue URL:** ${issue.url}

**Parent Task:** ${parentInfo}

**Related Tasks:**
${formatSiblings(context.siblings)}

**Existing Subtasks:**
${formatChildren(context.children)}

**Labels:** ${formatLabels(issue.labels, ['needs-design'])}

**Requirements:**
${formatDescription(issue.description, 1000)}

## Instructions

1. Use \`mcp__linear__get_issue\` to read the full requirements and any discussion
2. Identify technical constraints and requirements
3. Consider 2-3 design approaches and evaluate tradeoffs
4. Choose a recommended approach with clear rationale
5. Outline implementation considerations
6. Identify risks and mitigation strategies

## Output Format

Provide:
1. **Requirements Summary**: Key technical requirements extracted from the task
2. **Constraints**: Technical limitations, compatibility needs, performance requirements
3. **Design Options**: 2-3 approaches, each with:
   - Brief description
   - Pros and cons
   - Complexity estimate
4. **Recommended Approach**: Which option and why
5. **Implementation Notes**: Key technical considerations, patterns to use, gotchas
6. **API/Interface Changes**: If applicable, what interfaces change
7. **Risks**: Technical risks and how to mitigate them

After I approve the design, use \`mcp__linear__update_issue\` to:
- Add a comment with the design summary (or link to design doc)
- Remove the \`needs-design\` label
- Add \`needs-breakdown\` to create implementation subtasks`
    }
  },

  'needs-spike': {
    name: 'Technical Spike',
    generate: (issue, context) => {
      // Use estimate as timebox hint if available
      const timeboxHint = issue.estimate
        ? `Suggested timebox: ${issue.estimate} points worth of effort`
        : 'Suggest an appropriate timebox based on complexity'

      return `Using the Linear MCP, help me plan a technical spike for ${issue.identifier}: "${issue.title}"

## Context

**Project:** ${formatProject(context.project)}

**Issue URL:** ${issue.url}

**Labels:** ${formatLabels(issue.labels, ['needs-spike'])}

**${timeboxHint}**

**Spike Topic:**
${formatDescription(issue.description, 800)}

## Instructions

1. Use \`mcp__linear__get_issue\` to read the full details and understand what needs to be explored
2. Identify the specific technical unknowns to investigate
3. Define clear, answerable questions for the spike
4. Outline a focused exploration approach
5. Define what "done" looks like for this spike

## Output Format

Provide:
1. **Spike Goal**: One sentence describing what we're trying to learn
2. **Questions to Answer**: Specific, answerable questions (3-5 max)
3. **Exploration Approach**: Step-by-step investigation plan
4. **Timebox**: Recommended time limit (be strict - spikes should not drag on)
5. **Success Criteria**: How we know the spike answered our questions
6. **Deliverables**: What artifact comes out (proof of concept, findings doc, decision)
7. **If Successful**: What happens next
8. **If Unsuccessful**: Fallback plan or escalation path

After I complete the spike, use \`mcp__linear__update_issue\` to:
- Add a comment with the spike findings
- Remove the \`needs-spike\` label
- Create follow-up tasks based on findings`
    }
  },

  'blocked': {
    name: 'Blocker Analysis',
    generate: (issue, context) => {
      const parentInfo = context.parent
        ? `${context.parent.identifier}: "${context.parent.title}" (${context.parent.state?.name || 'Unknown'})`
        : 'None'

      const assigneeInfo = issue.assignee?.name || 'Unassigned'

      return `Using the Linear MCP, help me analyze and resolve the blocker on ${issue.identifier}: "${issue.title}"

## Context

**Project:** ${formatProject(context.project)}

**Issue URL:** ${issue.url}

**Assignee:** ${assigneeInfo}

**Parent Task:** ${parentInfo}

**Related Tasks:**
${formatSiblings(context.siblings)}

**Other Labels:** ${formatLabels(issue.labels, ['blocked'])}

**Task Description:**
${formatDescription(issue.description)}

## Instructions

1. Use \`mcp__linear__get_issue\` to read the full task details and comments to understand the blocker
2. Identify the root cause of the blockage
3. Determine if this is a dependency, resource, technical, or decision blocker
4. Explore workarounds or alternative approaches
5. Identify who can help resolve this

## Output Format

Provide:
1. **Blocker Summary**: What is preventing progress
2. **Blocker Type**: Dependency / Resource / Technical / Decision / External
3. **Root Cause**: Why this is blocking (not just what)
4. **Impact**: What's affected if this remains blocked
5. **Options to Unblock**:
   - Option A: [approach] - effort: [low/medium/high]
   - Option B: [approach] - effort: [low/medium/high]
6. **Recommended Action**: Best path forward
7. **Who Can Help**: People or teams to involve
8. **Escalation**: If needed, who to escalate to

After the blocker is resolved, use \`mcp__linear__update_issue\` to:
- Add a comment explaining how it was resolved
- Remove the \`blocked\` label
- Update the task status if work can resume`
    }
  },

  'needs-context': {
    name: 'Context Summary',
    generate: (issue, context) => {
      const parentInfo = context.parent
        ? `${context.parent.identifier}: "${context.parent.title}" (${context.parent.state?.name || 'Unknown'})`
        : 'None (top-level task)'

      const assigneeInfo = issue.assignee?.name || 'Unassigned'
      const stateInfo = issue.state?.name || 'Unknown'

      return `Using the Linear MCP, provide a comprehensive context summary for ${issue.identifier}: "${issue.title}"

## Current State

**Status:** ${stateInfo}
**Assignee:** ${assigneeInfo}
**Project:** ${formatProject(context.project)}
**Issue URL:** ${issue.url}

**Parent Task:** ${parentInfo}

**Sibling Tasks:**
${formatSiblings(context.siblings)}

**Subtasks:**
${formatChildren(context.children)}

**Labels:** ${formatLabels(issue.labels, ['needs-context'])}

**Description:**
${formatDescription(issue.description, 800)}

## Instructions

1. Use \`mcp__linear__get_issue\` to read the full task details, comments, and history
2. Synthesize the current state of this work
3. Identify what's been accomplished and what remains
4. Note any important decisions or context from comments
5. Highlight blockers or risks

## Output Format

Provide:
1. **Task Summary**: What this task accomplishes in the broader project
2. **Current State**: Where things stand right now
3. **What's Done**: Completed work or decisions made
4. **What Remains**: Outstanding work items
5. **Key Decisions**: Important choices that were made (from comments/history)
6. **Dependencies**: What this task depends on or blocks
7. **Risks/Blockers**: Current concerns
8. **Recommended Next Steps**: What to do next to make progress

After generating the summary, use \`mcp__linear__update_issue\` to:
- Add a context summary comment (useful for handoffs)
- Remove the \`needs-context\` label`
    }
  },

  'bug': {
    name: 'Bug Investigation',
    generate: (issue, context) => {
      const assigneeInfo = issue.assignee?.name || 'Unassigned'
      const stateInfo = issue.state?.name || 'Unknown'

      return `Using the Linear MCP, help me investigate bug ${issue.identifier}: "${issue.title}"

## Bug Report

**Status:** ${stateInfo}
**Assignee:** ${assigneeInfo}
**Project:** ${formatProject(context.project)}
**Issue URL:** ${issue.url}

**Labels:** ${formatLabels(issue.labels, ['bug'])}

**Bug Description:**
${formatDescription(issue.description, 1000)}

## Instructions

1. Use \`mcp__linear__get_issue\` to read the full bug report and any comments with additional details
2. Extract or infer reproduction steps
3. Analyze the symptoms to hypothesize likely causes
4. Prioritize investigation based on likelihood and ease of verification
5. Suggest a systematic debugging approach

## Output Format

Provide:
1. **Bug Summary**: Clear description of the incorrect behavior
2. **Expected Behavior**: What should happen
3. **Actual Behavior**: What is happening
4. **Reproduction Steps**: How to trigger the bug (or questions to get them)
5. **Environment**: If relevant, where this occurs (browser, OS, etc.)
6. **Likely Causes**: Ranked hypotheses with reasoning
   - Most likely: [cause] - because [reason]
   - Also possible: [cause] - because [reason]
7. **Investigation Plan**: Step-by-step debugging approach
8. **Quick Wins**: Obvious things to check first
9. **Related Code**: If identifiable, likely files/modules involved

After investigation, use \`mcp__linear__update_issue\` to:
- Add a comment with findings and root cause
- Update labels (e.g., add priority, add area label)
- If fixed, link the PR and update status`
    }
  }
}

/**
 * Check if a label has an associated prompt template
 * @param {string} labelName - The label name to check
 * @returns {boolean} True if the label has a prompt template
 */
export function hasPrompt(labelName) {
  return labelName in PROMPT_TEMPLATES
}

/**
 * Get all labels that have prompt templates
 * @returns {string[]} Array of label names with prompts
 */
export function getPromptLabels() {
  return Object.keys(PROMPT_TEMPLATES)
}

/**
 * Generate a prompt for a label
 * @param {string} labelName - The label name
 * @param {Object} issue - The issue object (must include identifier, title, description, url, labels)
 * @param {PromptContext} context - Context with parent, siblings, project, children
 * @returns {{name: string, prompt: string}|null} Generated prompt or null if no template
 */
export function generatePrompt(labelName, issue, context) {
  const template = PROMPT_TEMPLATES[labelName]
  if (!template) return null

  return {
    name: template.name,
    prompt: template.generate(issue, context)
  }
}
