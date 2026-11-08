# LIN-4253: A stage's traits (offered as a next step, read-only) are declared once on its template (tidy first, before LIN-4251)

State: Todo
Labels: none

## Description

## As asked

## Goal

A stage's traits are declared once, on its template: whether it is offered as a next step, and whether it is read-only. Everything that asks reads that one declaration: the stage selector, the router's refusal, the task page's "Another step" list and the dispatch preamble. Then changing a trait is a one-line edit to the template.

## Context

* LIN-4248 (`29f14bf6e`) added two hand-only, read-only stages. "Hand-only" is now a name list (`EXCLUDED_FROM_AI_RECOMMENDATION`, `lib/prompt-templates.js`) beside the template's missing `route`. "Read-only" is a second name list (`SURVEY_KINDS`, `lib/proxy-preamble.js`), and the kind literals are copied in three test files.
* Two independent blind reads of that merge both scored it "mixed" for exactly this: it followed the per-kind pattern without reducing it.
* LIN-4251 is waiting to make four more stages read-only (look-into, context, retro, triage). Today that means extending a hand-kept list.

## This step

A tidy, done first as its own task, with **no behaviour change**: every kind's dispatched prompt stays byte-identical on every entry path. The traits live on the template definitions. The two name lists are derived from them or deleted, and the copied literals in tests read the traits. A template that doesn't declare its traits fails a test.

**Not this ticket:** changing what any stage is told (LIN-4251 does that next, on top of this); folding the other per-kind tables (leads, grounding, buckets, completion signals) into the template. Name in the report what folding those would take, without doing it.

## Done when

* Before and after, every kind's rendered dispatch prompt is byte-identical on every entry path, and the router's byte-pinned fixtures are unchanged.
* No hand-kept list of stage names remains for "offered" or "read-only".
* A missing trait fails a test.

## Report back

Where each trait now lives, who reads it, what was deleted, and what folding the remaining per-kind tables would take.

*End of what was asked. Steps write below this line; nothing above it changes.*

## Comments (oldest first)

### (Survey, survey-task, posted before work began)

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

### (Survey, survey-place, posted before work began)

## Survey global: LIN-4253 @ 29f14bf6e

**Where it lands.** `PROMPT_TEMPLATES` (`lib/prompt-template-defs.js`), its readers in `lib/prompt-templates.js`, `lib/action-kind.js`, `lib/task-page-loader.js` (`summary.excluded` → `public/prompt-section.js` `stepFits`), and the preamble gate in `lib/proxy-preamble.js`. The selector side is in good shape: LIN-3300 made `route` on the template the one source of options ("Nothing else lists the options"). LIN-4248 then went back to side tables. Two new kinds touched about ten per-kind maps (STAGE_LEADS, STAGE_INTENT, GROUNDING_BY_KIND, COMPLETION_SIGNALS, wall-clock buckets, run-view labels, llm-jobs, budgets, llms.txt). The saving grace is the completeness tests (for example, `Object.keys(STAGE_INTENT)` must equal the template keys). That pattern is where "a missing trait fails a test" belongs.

**"Offered" is already declared once.** `retro`, `survey-task` and `survey-place` are the only templates without `route`. `EXCLUDED_FROM_AI_RECOMMENDATION` is exactly the routeless set, in template order, so deriving it from `!t.route` keeps `summary.excluded`, the selector prompt and the router fixtures byte-identical. Adding a separate `offered` flag would be the second copy: `offered: true` without a `route` would render "When: undefined" into the selector. The cheaper single declaration is to make `route` required, with `route: null` meaning hand-only, and have a test that every template has an own `route`.

**"Read-only" has no single meaning today.** That is the deeper problem. It appears in four places:
- `SURVEY_KINDS`, which gates the preamble mandate.
- `STAGE_INTENT`'s `READING` line, on context, look-into, retro and both surveys.
- `formatReadOnlyWorkflow`, used by context, plan-review, review and retrospective-audit. Review approves and comments, so it is not read-only in the preamble's sense.
- `GROUNDING_BY_KIND`'s comment, which calls look-into, context and retro "read-only".

A `readOnly: true` trait would add a fifth meaning. LIN-4251's list (look-into, context, retro, triage) is nearly the `READING` set, so the two will drift unless one reads the other. The trait should be named for what it gates (the dispatch mandate). Its docstring should say how it differs from the prompt-body workflow helpers.

**The module boundary.** `proxy-preamble.js` deliberately avoids importing the registry ("the caller passes the resolved kind, the gate lives here"). The obvious way imports `PROMPT_TEMPLATES` there. Better: `dispatch-entrance.js`, which already imports `PROMPT_TEMPLATES` and has `resolvedKind`, resolves `readOnly` and passes a boolean. One gap to know about: `provisionResumeCredential` (the follow-up and resume path) never receives a kind. A follow-up that re-appends the block to a survey session gets the reversible-work mandate. Leave it under "no behaviour change", but LIN-4251 inherits it for four more stages.

**Tests.** The literals in `lin-4248-survey-preamble.test.js`, `-dispatch-paths.test.js` and `-stages.test.js` should derive the kinds from the trait and keep one pinned expected list. Otherwise the tests just restate the code. The `action-kind.js` header ("frozen `lib/prompt-templates.js`") and the defs docstring ("No route: never offered (retro)") need updating.

**Better, but not this task.** Folding the other tables into the template means moving STAGE_LEADS, STAGE_INTENT, GROUNDING_BY_KIND and COMPLETION_SIGNALS into the defs (they are upstream imports of it today). The non-prompt maps (run-view labels, wall-clock buckets, llm-jobs) have readers that shouldn't load the registry, so those would need a light traits-only module that both sides import.
