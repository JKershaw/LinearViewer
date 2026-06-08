# LIN-177 — google/gemini-3.5-flash

## BRIEF (sections=4/4 inOrder=true words=354 pass=true, 14112ms)

## Current
Phase 3 of source tracking and multi-provider rendering is in progress. The prerequisite interface extension (S0) and workspace model generalization (S1) are complete. The remaining work consists of migrating auth, rendering, and prompts to use the new provider capabilities and generalized workspace credentials:

*   **S2 (Auth Routes)**: Update `routes/auth.js` (`updateWorkspaceTokens` at L155-163) to write workspaces in the new `{provider: 'linear', credentials: {...}}` shape.
*   **S3 (Rendering)**: Update `lib/render.js` to resolve the provider from the workspace, replace hardcoded `'View in Linear →'` with `'View in {displayName} →'`, gate "+ Add task" on the `write` capability (using `getCreateTaskUrl`), gate the Comments toggle on `comments`, and gate `${estimate} pts` on `estimates`. Also update S3-adjacent client display strings in `public/swipe.js` (L424) and `public/foreman.js` (L392/475/564).
*   **S4 (Prompt Formatters)**: Update `lib/prompt-formatters.js` to drive `useLinear` from provider capabilities, replace hardcoded `## Update Linear` headers, gate `formatChildren`/`formatSubtaskSummary` on `subtasks`, and gate workflow status-change steps on `write`.
*   **S5 (Prompt Templates)**: Update `lib/prompt-templates.js`, `lib/prompt-template-defs.js`, and `lib/prompts/meta-prompt-template.js` to gate on capabilities, ensuring both handwritten and meta-prompt paths are updated in lockstep.

## Constraints
*   Must not gate "+ Add task" on `createIssue` (which is unimplemented for Linear); gate it on the `write` capability defined as having a `getCreateTaskUrl` affordance.
*   Must update both handwritten and meta-prompt paths together in lockstep (CLAUDE.md two-paths rule) for prompt templates (S5).
*   Must not modify direct `getProvider('linear')` data-fetch calls in `routes/workspace-api.js`, `server.js`, or `lib/pipeline-state.js` (out of scope, tracked under LIN-306).
*   Must leave the `lib/linear.js` shim intact (out of scope, tracked under LIN-306).
*   Must respect the dual-read accessor in `lib/workspace.js` to support legacy `accessToken` workspaces during transition.

## Open questions
- _None._

## Changelog
*   `- **Phase 2 completed** — established the provider interface and registry foundation (LIN-176) to unblock Phase 3.`
*   `- **Re-grounded capability vocabulary** — realized method-keyed capabilities did not map to UI needs (e.g., gating "+ Add task" on `createIssue` would regress Linear), forcing the creation of S0 to define explicit UI/prompt capabilities.`
*   `- **S0 and S1 completed** — defined the capability surface/displayName and generalized the workspace model with a dual-read accessor to unblock rendering, auth, and prompt migrations.`

## RECAP (done=0 pending=0 dev=0 pass=false, 7354ms)

```json
{
  "done": [],
  "pending": [],
  "deviations": []
}
```
