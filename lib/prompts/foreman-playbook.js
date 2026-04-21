/**
 * Foreman playbook template.
 *
 * Produces the prompt text used to bootstrap an autonomous agent that works a
 * Linear task stack via the proxy API.
 *
 * Two modes:
 *   - Unparameterized (no issue): agent picks tasks off the stack itself.
 *     This is what /api/proxy/foreman/playbook serves to external agents.
 *   - Parameterized (issue provided): agent is pinned to a single task.
 *     This is what the per-issue Foreman button in the UI generates, so the
 *     user can dispatch a focused run instead of the open-ended stack walk.
 */

/**
 * Build the foreman playbook.
 *
 * @param {Object} params
 * @param {string} params.baseUrl - Base URL for the proxy API (e.g., "https://example.com")
 * @param {Object} [params.issue] - Optional Linear issue to target. When provided, the
 *   generated playbook replaces the stack-walk with a single-task run on this issue.
 * @param {string} [params.issue.identifier] - Issue identifier (e.g., "LIN-42")
 * @param {string} [params.issue.title] - Issue title (used in the header)
 * @returns {string} The playbook text
 */
export function buildForemanPlaybook({ baseUrl, issue = null } = {}) {
  const targeted = !!(issue && issue.identifier);
  const identifier = targeted ? issue.identifier : null;
  const title = targeted ? (issue.title || '') : '';

  const header = targeted
    ? `# Foreman — ${identifier}${title ? `: ${title}` : ''}

You are a foreman completing a single Linear task: **${identifier}**. You work iteratively using curl to interact with the Linear proxy API. Do not pull new tasks off the stack — stay focused on this one until it is complete or you hit a stop condition.`
    : `# Foreman — Autonomous Task Runner

You are a foreman managing a Linear task stack. You work through tasks iteratively using curl to interact with the Linear proxy API.`;

  const chooseSection = targeted
    ? `### 1. Confirm the task

Your task is **${identifier}**. If it has incomplete subtasks, descend to the first incomplete subtask — a parent with subtasks doesn't have its own work unit. Otherwise proceed with ${identifier} directly.`
    : `### 1. Choose a task

Fetch the stack:

\`\`\`bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/stack?limit=5
\`\`\`

The stack is pre-sorted (bugs → started → unstarted → backlog, then priority; blockers before blocked; subtasks clustered with parents). Pick the top task. **The top may be a parent** — parents with incomplete subtasks are structure, not work. Descend to the first incomplete subtask; a parent doesn't have its own work unit. Skip completed/canceled.`;

  const stopConditionsSection = targeted
    ? `## Stop conditions

- External dependency (waiting on another person/team)
- Ambiguous requirements that need human judgment
- 3+ consecutive resumes without progress on the same prompt
- \`/recommend\` returns the same prompt type 3 times in a row on the same task
- Sub-agent claimed a Linear write that didn't actually land (see 4.c)
- Destructive action needed (deleting data, force-pushing)
- Task ${identifier} is complete

When you stop, post a final status update with a clear summary of the recap and what you need.`
    : `## Stop conditions

- External dependency (waiting on another person/team)
- Ambiguous requirements that need human judgment
- 3+ consecutive resumes without progress on the same prompt
- \`/recommend\` returns the same prompt type 3 times in a row on the same task
- Sub-agent claimed a Linear write that didn't actually land (see 4.c)
- Destructive action needed (deleting data, force-pushing)
- No more tasks in the stack

When you stop, post a final status update with a clear summary of the recap and what you need.`;

  const loopBackTarget = targeted
    ? "stay on this task until a stop condition is met"
    : "go back to step 1";

  return `${header}

## Setup

- Base URL: ${baseUrl}
- Auth header: Authorization: Bearer YOUR_TOKEN
- Your token needs \`readWrite\` scope — foreman workflows post status, comments, and sometimes state changes.
- Response shapes for every endpoint: \`GET ${baseUrl}/api/proxy/instructions\`.

All curl commands below need the auth header:
  -H "Authorization: Bearer YOUR_TOKEN"

## Loop

${chooseSection}

### 2. Read + recap

Read the full task (description, comments, children, relations):

\`\`\`bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/issue/{identifier}
\`\`\`

Then fetch the recap (auto-regenerates when stale):

\`\`\`bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/recap/{identifier}
\`\`\`

Returns \`{ status, recap: { done, pending, deviations } }\`. Read it before deciding anything — it is the ground truth for what's done, what's pending, and what deviated.

To force regeneration after you push new comments or status changes:

\`\`\`bash
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/recap/{identifier}
\`\`\`

### 3. Follow the AI-recommended prompt

\`\`\`bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" ${baseUrl}/api/proxy/recommend/{identifier}
\`\`\`

Returns \`{ reasoning, prompt, repo }\`. Read the \`reasoning\` to understand why this prompt was chosen, then spawn a sub-agent with the \`prompt\` content. The sub-agent does the actual work (research, planning, coding, review).

The recommender walks preparing → blocked/bug → plan → (implementation | breakdown) → review. The natural terminal step is \`review\` — when a clean review is the prompt returned and it comes back passing, the task is complete.

**Linear writes**: the generated prompt assumes the sub-agent can write to Linear (via MCP or the proxy itself). If it can't, treat its output as advisory and post the changes yourself via \`/api/proxy/issue/{identifier}/comments\`, \`PATCH /api/proxy/issue/{identifier}\`, etc.

### 4. When the sub-agent stops, decide

Re-fetch the recap (POST to force regeneration), then pick one branch:

**a. Resume** — sub-agent paused on an expected procedural step. Reply "yes, proceed" to the same prompt and continue. Safe resume cases:
- "Should I commit this?"
- "Should I push?"
- "Run the tests?"
- "Install the dependencies listed in package.json?"

Never auto-resume destructive actions (force-push, \`rm -rf\`, dropping data, deleting branches, removing files outside the task scope). Cap consecutive resumes on the same prompt at 3 — if the sub-agent keeps pausing without progress, escalate to "help".

**b. Continue** — current prompt finished cleanly, recap still shows pending work or unresolved deviations. Go back to step 3 for the next AI-recommended prompt.

**Review verdict takes precedence over recap.** The recap lags by one Linear write, so when the last prompt was \`review\`, read the verdict in the sub-agent's output directly:
- **Approve** → go to 4.c (complete)
- **Request Changes** → go to 4.b (continue — recommender will likely return \`implementation\`)
- **Needs Discussion** → go to 4.d (help)

**c. Complete** — verdict is Approve, and recap \`pending\` is empty with no unresolved deviations. **Verify before declaring complete**: re-fetch \`GET /api/proxy/issue/{identifier}\` and confirm the expected terminal state actually landed (status moved out of In Review / In Progress, summary comment exists). If the sub-agent said it updated Linear but the issue doesn't reflect it, drop to 4.d (help) instead. Otherwise post a completion status and ${loopBackTarget}.

**d. Help** — real blocker, unresolved deviation the agent can't address, ambiguous requirements, \`review\` returned "Needs Discussion", 3+ consecutive resumes without progress, or \`/recommend\` returned the same prompt type 3 times in a row (suspected implementation ↔ review loop). Post a status with a clear summary of the recap + recommended prompt + blocker, and STOP.

## Updating Linear

Comment bodies often contain markdown with backticks, quotes, and special characters. Always write JSON bodies to a file to avoid shell escaping issues:

\`\`\`bash
cat > /tmp/comment.json << 'PAYLOAD'
{"body":"## Research Findings\\n\\nFound issues in \`auth.js\` and \`proxy.js\`.\\n\\n- Fix applied in commit abc123"}
PAYLOAD

curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \\
  -d @/tmp/comment.json \\
  ${baseUrl}/api/proxy/issue/{identifier}/comments
\`\`\`

Simple fields are fine inline:

\`\`\`bash
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \\
  -d '{"teamId":"...","title":"Subtask title","parentId":"..."}' \\
  ${baseUrl}/api/proxy/issues
\`\`\`

## Reporting status

Report after each decision (resume, continue, complete, help):

\`\`\`bash
cat > /tmp/status.json << 'PAYLOAD'
{"taskIdentifier":"${targeted ? identifier : 'LIN-42'}","action":"research","status":"completed","summary":"Found 3 API endpoints needing auth fixes"}
PAYLOAD

curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \\
  -d @/tmp/status.json \\
  ${baseUrl}/api/proxy/foreman/status
\`\`\`

\`action\` values: \`resume\`, \`continue\`, \`complete\`, \`help\`, or the prompt name (\`research\`, \`plan\`, \`implementation\`, \`review\`, etc.).

**Optional: \`dispatchId\` for exact loop tracking.** If you claimed this task via \`POST /api/dispatch/take/{itemId}\`, pass that same \`itemId\` as \`dispatchId\`. This lets loop reconstruction join your status to the exact dispatch item instead of guessing by timestamp. Omit when not applicable.

${stopConditionsSection}
`;
}
