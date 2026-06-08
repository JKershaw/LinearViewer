// =============================================================================
// Periodicals registry (LIN-341 / parent LIN-315)
// =============================================================================
//
// Periodicals are recurring, workspace-scoped maintenance tasks rendered as a
// synthetic "Periodicals" group on the main workspace view (behind the
// `periodicals` workspace flag from LIN-340). Each entry is a template:
//
//   { id, title, mode: 'corrective'|'advisory', cadence?, lastRunAt?, generatePrompt() }
//
// v1 ships exactly one corrective template (Documentation Review). The `mode`,
// `cadence`, and `lastRunAt` fields are carried on every template even though
// only `corrective` is wired and nothing consumes cadence/lastRunAt yet
// (advisory mode + autopilot scheduling are deliberately deferred — see the
// out-of-scope notes on LIN-341).
//
// IMPORTANT: templates live in app storage only. They are NEVER written to
// Linear. A periodical's dispatch flow self-creates the real Linear task at
// run time (the prompt's first step), so the template itself stays ephemeral.
// =============================================================================

import { PERIODICALS_PROJECT_ID } from './tree.js'

/**
 * @typedef {Object} PeriodicalTemplate
 * @property {string} id - Stable template id (also used as the synthetic node id)
 * @property {string} title - Display title for the row
 * @property {'corrective'|'advisory'} mode - Corrective self-creates+fixes a task;
 *   advisory (deferred) would post a comment. Only `corrective` is wired in v1.
 * @property {string} [cadence] - Suggested run cadence (carried, not yet consumed)
 * @property {string|null} [lastRunAt] - ISO timestamp of last run (carried, not yet consumed)
 * @property {() => string} generatePrompt - Produce the dispatchable prompt text
 */

/**
 * Build the Documentation Review prompt.
 *
 * The prompt is deliberately self-grounding: it tells the worker to re-read the
 * source at HEAD rather than trusting any summary (the same discipline as the
 * ticket staleness check). Its FIRST step self-creates the real Linear task via
 * the proxy (`POST /api/proxy/issues`, which UUID-gates `projectId`), so the
 * periodical template never has to be persisted to Linear.
 *
 * @returns {string} Prompt text
 */
function generateDocumentationReviewPrompt() {
  return `# Periodical: Documentation Review

You are running the **Documentation Review** periodical for the Linear Projects
Viewer codebase. The goal is to find and fix places where the documentation has
drifted out of sync with the actual code. Treat every doc claim as a hypothesis:
re-read the real source at HEAD before trusting it.

## Step 1 — Create the tracking task (do this first)

Self-create the real Linear task for this run via the proxy (the proxy context
block appended to this prompt carries your workspace token and base URL):

1. Resolve the team id: \`GET /api/proxy/teams\` → use the LinearViewer team's id.
2. Create the task:
   \`\`\`
   POST /api/proxy/issues
   { "teamId": "<team-id>", "title": "Documentation Review — <today's date>",
     "description": "Automated documentation-review periodical. Findings and fixes below." }
   \`\`\`
   Do NOT pass a \`projectId\` (the endpoint UUID-gates it; the synthetic
   \`${PERIODICALS_PROJECT_ID}\` group is app-only and is not a real Linear project).
3. Note the returned identifier (e.g. LIN-NNN) and move it to "In Progress".

## Step 2 — Diff the docs against the code (re-read each file at HEAD)

Check these three drift surfaces. For each, list concrete discrepancies (file +
line) and propose the minimal fix:

1. **AI-agent selectors** — \`public/llms.txt\` vs. the real markup emitted by
   \`lib/render.js\`. Confirm every documented selector still exists, including the
   data-attributes on the issue row and project container
   (\`.node[data-id]\`, \`.line[data-id]\`, \`.line[data-identifier]\`,
   \`[data-status]\`, \`[data-section]\`, \`[data-parent]\`, \`[data-depth]\`,
   \`.project[data-id]\`, \`.project-header\`). Flag any selector llms.txt names
   that render.js no longer emits, and any new structural attribute render.js now
   emits that llms.txt fails to document.

2. **The both-paths rule** — the handwritten staleness block
   (\`formatStalenessCheck()\` in \`lib/prompt-formatters.js\`) vs. the
   "Re-ground the Ticket (staleness check)" block in the meta-prompt
   (\`lib/prompts/meta-prompt-template.js\`). CLAUDE.md requires prompt-behaviour
   changes to update BOTH paths. Confirm the two staleness instructions still say
   the same thing (list referenced files/symbols, \`git log --since=<createdAt>\`,
   re-read source at HEAD). Flag any divergence where one path was updated and the
   other was not.

3. **Architecture file-list** — the \`lib/\` inventory in the Architecture section
   of \`CLAUDE.md\` vs. the actual contents of \`lib/\`. Run \`ls lib/\` (and
   \`lib/components/\`, \`lib/prompts/\`, \`lib/providers/\`) and reconcile: list files
   present on disk but missing from CLAUDE.md, and files documented in CLAUDE.md
   that no longer exist.

## Step 3 — Apply fixes and report

- Apply the minimal documentation fixes for the discrepancies you found (edit
  \`public/llms.txt\`, the meta-prompt / formatters, and/or \`CLAUDE.md\`). Do not
  rewrite docs wholesale — only correct genuine drift.
- If a surface is already in sync, say so explicitly rather than inventing work.
- Comment your findings on the task you created in Step 1, push the changes on a
  branch, and open a PR. End with the PR link, commit SHA, and test/CI result.`
}

/**
 * The registry of periodical templates. v1 seeds exactly one entry.
 * @type {PeriodicalTemplate[]}
 */
export const PERIODICALS = [
  {
    id: 'documentation-review',
    title: 'Documentation Review',
    mode: 'corrective',
    cadence: 'weekly',
    lastRunAt: null,
    generatePrompt: generateDocumentationReviewPrompt
  }
]

/**
 * Get all periodical templates (returns the live registry array).
 * @returns {PeriodicalTemplate[]}
 */
export function getPeriodicals() {
  return PERIODICALS
}

/**
 * Build forest-shaped tree nodes for the synthetic Periodicals group, suitable
 * for `forest.set(PERIODICALS_PROJECT_ID, { roots: buildPeriodicalNodes() })`.
 *
 * Each node mirrors the tree-node shape consumed by the renderer: a synthetic
 * issue-like object (no Linear url/identifier — these are app-only rows) plus
 * the rendered dispatch prompt and the periodical's mode, which the renderer
 * uses to draw a dispatch affordance instead of issue prompt buttons.
 *
 * @returns {Array<{issue: Object, children: [], depth: number, periodical: Object}>}
 */
export function buildPeriodicalNodes() {
  return PERIODICALS.map(template => ({
    issue: {
      id: template.id,
      identifier: null,
      title: template.title,
      // No url/description/assignee/labels: a periodical is not a Linear issue.
      state: { name: 'Periodical', type: 'unstarted' }
    },
    children: [],
    depth: 0,
    // Carried for the renderer (see lib/render.js renderProject periodicals branch).
    periodical: {
      id: template.id,
      title: template.title,
      mode: template.mode,
      prompt: template.generatePrompt()
    }
  }))
}
