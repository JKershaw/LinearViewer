# Why LIN-4493 skipped survey-task, survey-place and scoping

Read-only check, 19 Nov 2026. Code read at `origin/main` `079f0b6ff`, the commit deployed at 13:52 (the close-out run reports the footer showing `079f0b6`). Live data comes from proxy reads only.

## Finding

The answer is (b). The 13:52 implementation row `8385df16-d58a-40bf-8ada-936d8dfec9ef` was sent through the recommend descent, not through a `kind` override. Look-first stood aside with the reason **`has a PR`**. The PR it saw was in a comment. At 13:37 the LIN-4492 close-out worker (`255d2009`) posted "## Rule from LIN-4492 close-out: which run a follow-up belongs to" on LIN-4493. That comment contains `https://github.com/JKershaw/LinearViewer/pull/2464`, which is LIN-4492's PR. `assembleTrailFacts` counts every full PR URL in any comment as "PRs linked on the trail", without checking which ticket the PR belongs to. A link to another ticket's PR therefore turned off the look-first route on a fresh ticket that had no PR of its own. With every code route standing aside, the selector chose `implementation`.

## Evidence

**The row was not an override.**
- The override arm stores `promptName: generated.name || getPromptDisplayName(kind)` (`lib/dispatch-entrance.js:1620`). For implementation that name is `'implement'` (`lib/prompts/stage-kinds.js:370`).
- The descent arm stores `promptName: rec.recommendedAction` (`lib/dispatch-entrance.js:1790`).
- `8385df16` has `promptName: "implementation"`, `kind: "implementation"`. LIN-4492's selector-chosen build `8b8f0c39` (12:48) has the same pair.
- Past override rows carry `"implement"`: LIN-4179 at 2026-11-04T00:15:40Z and LIN-4406 at 2026-11-10T12:21:28Z, both in earlier dispatch dumps.
- `override: true` is returned only on the response (`:1632`). It is not stored on the row, so it cannot be read back.

**The state at 13:52.**
- Snapshot `23c0fce5` of LIN-4493 was captured at 13:52:35, 17 seconds after the dispatch. It shows state Todo, a description identical to today's (6180 chars, with an `## As asked` block), no children, and one comment: the 13:37 rule comment with the PR URL.
- No dispatch row existed on LIN-4493 before `8385df16`, so `allRuns` was `[]`.

**What the code does with that state.** I ran origin/main `lookFirstOff` and all of `CODE_ROUTES` on that state (`lib/recommendation-look-first.js:141-157`, `lib/code-routes.js:27-70`):
- With the comment, every route returns null and `lookFirstOff` gives `'has a PR'` (line 152). That comes from `prUrlsIn` over every comment (`lib/recommendation-facts.js:467-472`, `lib/run-ledger.js:363`).
- Without the comment, look-first returns `survey-task`.
- No code route can emit `implementation`, so implementation had to come from the selector.

**A model call is on record.** LIN-4493's `/cost` shows exactly one `recommend` app call. A code route makes no model call, and neither does an override.
- LIN-4492 is consistent with this: 3 recommend calls for its 3 selector-chosen stages (implementation, review, close-out), and none for its 4 code-routed ones (the two surveys, scoping and blind-read).
- The ledger has no timestamps, so this call could in principle be a task-page view instead of the dispatch.

**Comparison with LIN-4492.** At 12:36 LIN-4492 had no comments. Its survey-task `71017170` came from a descent from LIN-4491; the autopilot wrote "The engine descended into the first subtask, LIN-4492." Look-first then ran normally.

**Who posted the comment.** The close-out row `255d2009` ended with this DONE line: "...the follow-up rule is posted on LIN-4491 and LIN-4493." The autopilot then wrote "Moving on to piece 2, LIN-4493" and dispatched at 13:52:18.

## Ruled out

- **(a) A `kind` override.** Ruled out by the promptName signature above.
- **(b) "open blocker".** LIN-4492's `completedAt` is 13:51:19, before 13:52:18. The 'has a PR' check also runs before the blocker check.
- **(b) "has a plan", "size recorded", "no As-asked block", "not a leaf", "holding comment".** None holds on the snapshot. The holding-comment check needs a sequence start, and with no runs and no Survey comment there is none.

## Unknown

- **A plain `POST /dispatch` with a hand-supplied prompt.** Not strictly excluded. It is implausible: the caller would have had to set `promptName: "implementation"` (the default is `'Prompt'`, `dispatch-entrance.js:377`) and send an 11.7k-character body identical to the template's output for LIN-4493, including its `createdAt` 12:35:55.515Z.
- **"runs unknown".** If the run-store read had failed, `lookFirstOff` would have answered 'runs unknown' before reaching 'has a PR', and the outcome would be the same. I can't distinguish the two from here.
- **Which issue the autopilot named.** It could have called recommend-and-dispatch on LIN-4491 (and descended) or on LIN-4493 directly.
- **The prompt trace.** The trace for this recommendation (`codeRoute`, reasoning) is the direct witness. It is readable only with a signed-in session (`/workspace/:urlKey/api/prompt-traces`, `lib/prompt-trace-store.js:17-19`), not through the proxy.
- **Whether the close-out prompt asked for the forward note.** Not established.

## LIN-4494..4496

The same thing will happen if a comment carrying any full PR URL lands on a piece before its first dispatch. That is exactly what piece N's close-out did for piece N+1. LIN-4494 has no comments today. A piece dispatched while its blocker is still open also skips look-first, with the reason 'open blocker'.
