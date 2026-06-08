# LIN-177 — anthropic/claude-haiku-4.5

## BRIEF (sections=4/4 inOrder=true words=774 pass=true, 18981ms)

## Current

Phase 3 of the provider-abstraction epic: make the UI and prompts adapt to provider capabilities, and generalize the workspace model to support multiple providers. The ticket assumes a capability vocabulary (`write`, `comments`, `estimates`, `subtasks`, `displayName`) that does not yet exist — it must be designed first (surface S0). Work is decomposed into six surfaces with dependency arrows; all are unstarted.

**Remaining work:**
- **S0** (prerequisite): Add `displayName` and UI/prompt capability flags to the provider interface. Decide whether to use a dedicated `provider.ui` map or overload `supports()`. Define UI-`write` as "has `getCreateTaskUrl` affordance," not the unimplemented `createIssue` method — this distinction prevents hiding "+ Add task" for Linear.
- **S1** (root): Generalize `lib/workspace.js` to add `provider` field and generic `credentials` object; add a dual-read accessor so ~29 existing `workspace.accessToken` read sites work during transition without big-bang refactor.
- **S2**: Update `routes/auth.js` `updateWorkspaceTokens` to write workspaces in the new `{provider, credentials}` shape (blocked by S1).
- **S3**: Capability-aware rendering in `render.js`: swap hardcoded `'View in Linear →'` (lines 286, 713) to `'View in {displayName} →'`; un-pin `getProvider('linear').getCreateTaskUrl` to resolve from workspace; gate "+ Add task" on `write` capability; gate Comments toggle on `comments`; gate estimate display on `estimates`. Also update S3-adjacent display strings in `public/swipe.js:424` and `public/foreman.js:392/475/564` (blocked by S0 and S1).
- **S4**: Capability-aware prompts in `prompt-formatters.js`: drive the existing `useLinear` toggle from provider capability; gate `formatChildren`/`formatSubtaskSummary` on `subtasks`; gate workflow status-change steps on `write`; cover un-flagged `## Update Linear` headers (lines 222, 232, 265, 437) (blocked by S0).
- **S5**: Capability-aware prompts in templates and meta-prompt: parallel gating in `lib/prompt-templates.js`, `lib/prompt-template-defs.js` (~55 strings), and `lib/prompts/meta-prompt-template.js`. **Both handwritten and meta-prompt paths must change together** per CLAUDE.md two-paths rule (blocked by S0).

**Testing strategy:** S3 via render permutations with a stub provider; S4/S5 via prompt-output diffs (Linear vs. non-Linear stub) across both paths + structural tests from `docs/prompt-change-validation.md`; S1/S2 via workspace read/write round-trip including back-compat reading legacy `accessToken`-shaped workspaces; smoke test via existing E2E to confirm Linear flow is unchanged.

## Constraints

- Must not gate "+ Add task" on `supports('createIssue')` — Linear's writes are declared-but-unimplemented this phase, so that would hide the button for Linear. Gate on `write` capability, defined as "has `getCreateTaskUrl` affordance."
- Must not regress the existing Linear dashboard flow — smoke test via `dashboard.spec.js` must pass byte-unchanged.
- Must not restructure `render.js`, `prompt-formatters.js`, or `prompt-templates.js` — gate *around* existing structure to avoid breaking high-churn protections for prompt completeness and two-paths parity.
- Handwritten and meta-prompt prompt paths must change in lockstep (CLAUDE.md two-paths rule).
- The workspace credential shape is read at ~29 sites; use a dual-read back-compat accessor during transition so readers need not all change big-bang.
- `lib/linear.js` shim stays intact — it is still imported by `routes/proxy.js`; re-pointing is tracked under LIN-306, not this ticket.

## Open questions

- **S0 design decision:** explicit `provider.ui = {write, comments, estimates, subtasks, displayName}` object vs. overloading `supports()` with new abstract flags? The method-keyed `supports()` does not cover `estimates`/`subtasks` (no methods exist) or UI-`write` (must be tied to `getCreateTaskUrl`, not `createIssue`), so an explicit map is likely cleaner, but the choice is open.
- **S3-adjacent scope:** should `public/swipe.js:424` and `public/foreman.js:392/475/564` display strings be split to a follow-up subtask, or included in S3? Currently flagged as in-scope but may be deferred.
- **Credential migration path:** are there any external systems (e.g., analytics, audit logs) that read `workspace.accessToken` directly and would break if the dual-read accessor is not wired correctly? Not identified in the source, but worth confirming before S1 lands.

## Changelog

- **Phase 2 (LIN-176) dependency cleared** — LIN-176 is Done; `lib/providers/interface.js`, registry, and Linear provider are in place and usable. Phase 3 work is genuinely unstarted.
- **Capability vocabulary gap identified** — the ticket assumes `write`/`comments`/`estimates`/`subtasks`/`displayName` flags that do not exist in the Phase-2 interface. S0 must define them first; this is where the real design decision lives.
- **UI-`write` definition clarified** — must be tied to `getCreateTaskUrl` affordance, not `supports('createIssue')`, to avoid hiding "+ Add task" for Linear (whose writes are declared-but-unimplemented this phase).
- **Blast radius widened** — workspace credential shape is read at ~29 sites, not just the 4 files in the ticket. Mitigated by a dual-read accessor (S1) so readers migrate incrementally.
- **Strategy chosen: close the contract gap** — generalize the workspace model now rather than defer it, because deferring routes around an untracked gap with no inheritor ticket; every queued provider (LIN-178/179/275) would otherwise pay a per-provider workaround tax.
- **Decomposed into 6 surfaces with dependency arrows** — S0 and S1 are parallelizable roots; S2 ← S1; S3 ← S0 + S1; S4, S5 ← S0. All unstarted; ready for breakdown into subtasks.

## RECAP (done=0 pending=0 dev=0 pass=false, 15329ms)

```json
{
  "done": [],
  "pending": [],
  "deviations": []
}
```
