# LIN-177 — openai/gpt-5.4-mini

## BRIEF (sections=4/4 inOrder=true words=442 pass=true, 4948ms)

## Current
Phase 3 is still in progress and none of its subtasks are done. The work now is to finish the capability-aware multi-provider migration in five remaining areas: define a provider UI/prompt capability surface plus `displayName`; generalize workspace storage from Linear-token-shaped fields to `{provider, credentials}` with backward-compatible reads; update auth writes to the new workspace shape; make rendering conditional on provider capabilities and swap hardcoded Linear text for provider display names; and gate prompt formatting/templates on provider capabilities, including both handwritten and meta-prompt paths.

## Constraints
- Must not gate “Add task” on `supports('createIssue')` or equivalent method-derived write detection, because Linear’s createIssue is declared but not implemented in this phase and that would hide the button for Linear.
- Must define `write` for UI as “has create/getCreateTaskUrl affordance,” not as “createIssue implemented.”
- Must not assume the existing provider capability descriptor already has `write`, `comments`, `estimates`, `subtasks`, or `displayName`; those have to be introduced.
- Must keep a back-compat read path for legacy `accessToken` while migrating to `credentials.token`.
- Must update both prompt paths together: handwritten templates and meta-prompt templates.
- Must keep `lib/linear.js` intact; re-pointing data-fetch consumers is out of scope for this issue.
- Must include the S3-adjacent hardcoded Linear strings in `public/swipe.js` and `public/foreman.js` as part of the display-string cleanup so “don’t hardcode Linear” is not only fixed in `render.js`.

## Open questions
- Whether the new provider UI capability surface should be a dedicated `provider.ui` object or be overlaid onto `supports()` remains unresolved.
- The exact source of `displayName` on providers is not yet defined.
- It is unknown whether any auth/workspace write path besides `routes/auth.js` mutates workspace credentials and would also need the new `{provider, credentials}` shape.
- The scope boundary for the S3-adjacent client display strings is still a little ambiguous: they are marked in-scope, but may need a follow-up subtask split.

## Changelog
- **Phase 2 dependency was confirmed resolved** — unblocked the whole phase and made this work safe to start.
- **The task was re-grounded as a capability-surface migration, not a simple render tweak** — the existing provider descriptor is method-keyed and does not supply the UI flags the ticket assumes.
- **Workspace migration scope expanded beyond the original ticket files** — the real storage shape lives in `lib/workspace.js` and auth writes, with many legacy readers needing back-compat access.
- **Data-fetch consumer re-pointing was explicitly excluded** — prevents duplicating work owned by the separate consumer migration issue.
- **The ticket was broken into six subtasks with dependency arrows** — establishes the execution order: S0 and S1 are roots; S2 depends on S1; S3 depends on S0 and S1; S4/S5 depend on S0.

## RECAP (done=2 pending=4 dev=3 pass=true, 2366ms)

```json
{
  "done": [
    {
      "item": "S0 defined capability surface + displayName",
      "evidence": "LIN-332 is Done; provider interface now has capability surface and displayName foundation."
    },
    {
      "item": "S1 generalized workspace model",
      "evidence": "LIN-333 is Done; workspace model adds provider + credentials with dual-read accessor."
    }
  ],
  "pending": [
    {
      "item": "S2 update auth routes to provider-aware workspace",
      "predicted": "Write new workspace shape in auth route storage after S1 is in place."
    },
    {
      "item": "S3 capability-aware rendering",
      "predicted": "Gate Add task, View link text, Comments, and estimates in render.js using S0/S1."
    },
    {
      "item": "S4 capability-aware prompt-formatters",
      "predicted": "Wire prompt formatting to provider capabilities and gate subtasks/write behavior."
    },
    {
      "item": "S5 capability-aware prompt templates",
      "predicted": "Apply parity changes across templates and meta-prompt in lockstep."
    }
  ],
  "deviations": [
    {
      "item": "Capability flags differ from ticket",
      "type": "finding",
      "evidence": "Current interface is method-keyed; write/comments/estimates/subtasks and displayName had to be introduced."
    },
    {
      "item": "Workspace shape migration has wider blast radius",
      "type": "scope-change",
      "evidence": "~29 accessToken read sites were identified; dual-read accessor was chosen to avoid a big-bang rewrite."
    },
    {
      "item": "Client display strings are in scope",
      "type": "scope-change",
      "evidence": "'View in Linear' strings in public/swipe.js and public/foreman.js were flagged as S3-adjacent."
    }
  ]
}
```
