# LIN-177 — anthropic/claude-opus-4.8

## BRIEF (sections=4/4 inOrder=true words=539 pass=true, 19514ms)

## Current
Phase 3 of the provider-abstraction epic: make projects/issues carry source metadata and adapt the UI to provider capabilities. The work is broken into 6 surfaces (S0–S5), tracked as subtasks LIN-332 through LIN-337, with `blocked-by` relations already encoded.

**Done:**
- **S0 (LIN-332)** — UI/prompt capability surface + `displayName` defined on the provider interface.
- **S1 (LIN-333)** — Workspace model generalized: `provider` field + generic `credentials` object, with a dual-read accessor (reads new `credentials.token` and legacy `accessToken`).

**Remaining:**
- **S2 (LIN-334)** [blocked-by S1, now unblocked] — In `routes/auth.js` (`updateWorkspaceTokens`, ~L163), write workspaces in the new `{provider:'linear', credentials:{…}}` shape.
- **S3 (LIN-335)** [blocked-by S0+S1, now unblocked] — Capability-aware rendering in `lib/render.js`: replace `'View in Linear →'` (L286 project, L713 issue) with `View in {displayName} →`; un-pin `getProvider('linear').getCreateTaskUrl` (L313) to resolve the provider from `workspace.provider`, and `write`-gate "+ Add task"; `comments`-gate the Comments toggle (~L632); `estimates`-gate `${issue.estimate} pts` (~L609). Also covers S3-adjacent client display strings: `public/swipe.js:424`, `public/foreman.js:392/475/564` (may split to a follow-up but must not be dropped).
- **S4 (LIN-336)** [blocked-by S0] — Capability-aware prompts in `lib/prompt-formatters.js`: drive the existing `useLinear` toggle from provider capability; cover un-flagged `## Update Linear` headers (L222/232/265/437); `subtasks`-gate `formatChildren`/`formatSubtaskSummary`; `write`-gate workflow status-change steps.
- **S5 (LIN-337)** [blocked-by S0] — Parallel capability gating in `lib/prompt-templates.js`, `lib/prompt-template-defs.js` (~55 strings), and `lib/prompts/meta-prompt-template.js`. Handwritten and meta-prompt paths must change together.
- **S-readers** (part of S1's scope) — ~29 `workspace.accessToken` read sites in `workspace-api.js`, pipeline.js, proxy.js test-mode migrate incrementally onto S1's dual-read accessor; not a big-bang change.

## Constraints
- "Write" for UI must mean "has a create/`getCreateTaskUrl` affordance," NOT `supports('createIssue')` — Linear's writes are declared-but-unimplemented this phase, so descriptor-gating "+ Add task" on `createIssue` would hide it for Linear (a regression).
- The Phase-2 `capabilities` descriptor is method-keyed (`fetchProjects`/`createIssue`/…); it has no `write`/`comments`/`estimates`/`subtasks` flags or display name. Prefer an explicit `provider.ui` capability map over overloading `supports()`.
- S5 must change the handwritten prompt path AND the meta-prompt path in lockstep (CLAUDE.md two-paths rule); add structural tests per `docs/prompt-change-validation.md`.
- Gate around existing prompt/render structure — do not restructure; these are high-churn files and restructuring risks regressing prompt completeness/scaling (LIN-260, LIN-284).
- Existing E2E (`dashboard.spec.js`) must confirm the Linear dashboard flow is byte-unchanged.
- Out of scope: `getProvider('linear')` data-fetch re-pointing (`workspace-api.js` ~13×, `server.js` 5×, `lib/pipeline-state.js` 1×) — owned by LIN-306. LIN-177 owns display/credential coupling only.
- Leave `lib/linear.js` shim intact — settled in Phase 2; `routes/proxy.js` still imports it; re-point tracked under LIN-306.
- Workspace credential shape lives in `lib/workspace.js` + `routes/auth.js`, NOT `routes/workspace.js` (which only does remove/redirect).

## Open questions
- _None._

## Changelog
- **Strategy: close the contract gap (generalize workspace model now) rather than defer (strategies C/D)** — deferring routes around an untracked gap with no inheritor ticket; every queued provider (LIN-178/179/275) would otherwise pay a per-provider workaround tax.
- **Re-grounding found the ticket's capability vocabulary (`write`/`comments`/`estimates`/`subtasks`/`displayName`) does not exist yet** — forced prerequisite surface S0 to define it before rendering/prompt surfaces; this is where the real design decision lives.
- **Blast radius is wider than the ticket's 4 files (~29 `workspace.accessToken` read sites)** — mitigated by S1's dual-read accessor so readers migrate incrementally instead of big-bang.
- **S0 and S1 landed (Done)** — both roots complete; S2/S3 now unblocked, S4/S5 depend only on S0 which is done.

## RECAP (done=6 pending=4 dev=6 pass=true, 14935ms)

```json
{
  "done": [
    {
      "item": "Verified blocking dependency LIN-176 (Phase 2) resolved in Linear and codebase",
      "evidence": "LIN-176 Done; subtasks LIN-330/LIN-331 merged to main (PRs #351/#352); main CI green"
    },
    {
      "item": "Moved issue Todo → In Progress and updated 'Blocked by' note to 'Dependency — satisfied'",
      "evidence": "Comment: 'moved Todo → In Progress and updated the description's Blocked by note'"
    },
    {
      "item": "Produced re-grounded plan at HEAD caf1031 decomposing into 6 surfaces with dependency arrows",
      "evidence": "Comment: 'Plan ready. → Next action: breakdown'"
    },
    {
      "item": "Created 6 subtasks S0–S5 with blocked-by relations copied 1:1 from plan",
      "evidence": "LIN-332..337 created; arrows S1→S2, S1→S3, S0→S3, S0→S4, S0→S5 verified by reading relations back"
    },
    {
      "item": "S0 (LIN-332): Define UI/prompt capability surface + displayName on provider interface",
      "evidence": "Subtask LIN-332 state: Done"
    },
    {
      "item": "S1 (LIN-333): Generalize workspace model — provider + credentials with dual-read accessor",
      "evidence": "Subtask LIN-333 state: Done"
    }
  ],
  "pending": [
    {
      "item": "S2 (LIN-334): Auth routes write provider-aware workspace objects",
      "predicted": "Now unblocked (S1 done); implement updateWorkspaceTokens to write {provider:'linear', credentials:{…}}"
    },
    {
      "item": "S3 (LIN-335): Capability-aware rendering in render.js + client display strings",
      "predicted": "Now unblocked (S0+S1 done); gate Add task on write, dynamic displayName, gate Comments/estimates"
    },
    {
      "item": "S4 (LIN-336): Capability-aware prompts in prompt-formatters.js",
      "predicted": "Now unblocked (S0 done); drive useLinear from capability, gate subtasks/write, cover ungated headers"
    },
    {
      "item": "S5 (LIN-337): Capability-aware prompts in templates + meta-prompt (two-paths parity)",
      "predicted": "Now unblocked (S0 done); parallel gating across handwritten + meta-prompt paths with structural tests"
    }
  ],
  "deviations": [
    {
      "item": "Capability vocabulary the ticket assumes (write/comments/estimates/subtasks/displayName) does not exist",
      "type": "finding",
      "evidence": "Phase-2 capabilities descriptor is method-keyed (fetchProjects/createIssue); no abstract flags or displayName — forced prerequisite S0"
    },
    {
      "item": "Gating + Add task on descriptor-derived write would hide it for Linear",
      "type": "bug",
      "evidence": "Linear writes declared-but-unimplemented; supports('createIssue')===false; Add task depends on getCreateTaskUrl not createIssue"
    },
    {
      "item": "Blast radius wider than ticket's 4 files — ~29 workspace.accessToken read sites",
      "type": "scope-change",
      "evidence": "Credential shape read at ~29 sites in workspace-api.js etc.; mitigated by S1 dual-read accessor"
    },
    {
      "item": "Credential shape lives in lib/workspace.js + routes/auth.js, not routes/workspace.js as ticket stated",
      "type": "finding",
      "evidence": "routes/workspace.js only does remove/redirect; updateWorkspaceTokens at routes/auth.js L163"
    },
    {
      "item": "getProvider('linear') data-fetch re-pointing routed out of scope to LIN-306",
      "type": "scope-change",
      "evidence": "workspace-api.js ~13x, server.js 5x, pipeline-state.js 1x belong to LIN-306; lib/linear.js shim left intact"
    },
    {
      "item": "S3-adjacent client display strings (swipe.js, foreman.js) added to scope",
      "type": "scope-change",
      "evidence": "public/swipe.js:424, public/foreman.js:392/475/564 'View in Linear' strings in scope under S3"
    }
  ]
}
```
