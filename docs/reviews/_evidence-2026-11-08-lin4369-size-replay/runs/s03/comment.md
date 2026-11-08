## Survey open-0: LIN-4253 @ 29f14bf6e

**"Offered" is already declared. It is just declared twice.** At 29f14bf6e, the templates without a `route` are exactly `retro`, `survey-task` and `survey-place`, and that is exactly what `EXCLUDED_FROM_AI_RECOMMENDATION` holds (`lib/prompt-templates.js:418`). The selector filters on both (`:430`). The router's refusal (`lib/action-kind.js:18`) and the task page (`lib/task-page-loader.js:1022` → `public/prompt-section.js:1341`) read only the set. So this half is a deletion, not a new field: offered means "has a `route`", or an explicit `offered` with a test that it agrees with `route`. Two things to watch: `defer` is offered with no template (`RECOMMEND_META_ROUTES`), and non-template kinds (`custom`, `periodical`) must stay unrefused. `summary.excluded`'s order already matches template order.

**"Read-only" is the hard half, because the name doesn't match what the code does.** `SURVEY_KINDS` (`lib/proxy-preamble.js:186`) doesn't gate "read-only". It gates Survey wording: "a read-only *forecast* … your only write is the one comment on the *surveyed ticket*" (`:189`), and the closing "the one comment you posted on the surveyed ticket" (`:378`). The repo already says read-only in three other ways:
- `STAGE_INTENT`'s `READING` scope (`lib/prompts/stage-intent.js`): context, look-into, retro and both Surveys.
- `formatReadOnlyWorkflow`: context, plan-review, review, retrospective-audit.
- `formatInformOnlyWorkflow`: look-into, retro.

Suppose this ticket adds `readOnly: true|false` to all 19 templates. Review and plan-review get `readOnly: false` although their bodies say "You are read-only". Then LIN-4251 flips triage, a filing stage that changes Linear state, to `true` and sends it "do not change … tickets or Linear state". **First, settle what the trait means**, probably the preamble's mandate variant (e.g. `mandate: 'reversible' | 'forecast'`), or decide that read-only and the wording are separate things. Then name it.

**Entry paths.** Only the launch arm of `lib/dispatch-entrance.js:1083` threads `kind`. These don't:
- the follow-up resume (`provisionResumeCredential`, `lib/proxy-preamble.js:808/834`);
- the feedback triage dispatch (`routes/workspace-api-feedback.js:266`);
- collective (`kind: 'custom'`).

So a Survey follow-up gets the PR-evidence block today. This ticket must keep that and say so. LIN-4251 inherits it, since triage mostly enters by the feedback route.

**Layering.** `proxy-preamble.js` deliberately doesn't import the template registry. Either the caller resolves the trait and passes a boolean (the signature changes, and the preamble tests that pass `kind:` change), or a small trait lookup module sits between them. Choose one before editing.

**Tests that read the traits can turn into tautologies.** If the three LIN-4248 tests iterate the derived set, dropping a Survey's trait empties the loop and they stay green. One pin is still needed (the derived set equals a named expectation), and that pin is the only hand-kept list allowed.

**What I'd do first:** a throwaway capture at 29f14bf6e. Render `generatePrompt` × `buildProxyContextPreamble` for every kind, in prose and mcp mode, plus the three LIN-4248 entry paths and a follow-up. Save the bytes and diff them after the change. No existing test covers every kind on every path.

For the report: folding the other kind-keyed tables (`STAGE_LEADS`, `GROUNDING_BY_KIND`, `COMPLETION_SIGNALS`, run-view labels, wall-clock buckets, `llm-jobs`) is mostly mechanical. `STAGE_INTENT` and the formatter choice are not, because they overlap the read-only trait.
