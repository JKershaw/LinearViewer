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
