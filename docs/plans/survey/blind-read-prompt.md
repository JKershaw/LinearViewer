**Lifecycle (LIN-4436, LIN-4437):** piloted here in #2407; live since LIN-4437 as the `blind-read` template. This file is a pointer now, not a second copy of the prompt.

# The blind read: the reader's prompt (LIN-4396, piece 1)

The prompt piloted here ships as the `blind-read` stage, exactly as piloted but for its fill-ins:

- **Where it lives:** `lib/prompt-template-defs.js` (`blind-read`, built by `blindReadPrompt`), its lead in `STAGE_LEADS`. The heading, the verdict label and the three words are in `lib/prompts/blind-read-words.js`; the class lines and the unmapped-path sentence render from `lib/prompts/leftover-words.js`.
- **The piloted text, frozen:** `tests/fixtures/blind-read-piloted.txt`, the template block of this file at #2407 with its `[LEFTOVER_RULE]` / `[CONSEQUENCE_TEST]` marks removed. `tests/unit/lin-4437-blind-read.test.js` checks the render against it.
- **Fill-ins:** code fills `{PRS}` (`landingPrUrls`, `lib/run-ledger.js`) and `{DESTINATION}` (the piece-2 text: one comment on the ticket, which is where it goes, not something to read). `{HEAD}` and `{BASE}` are the session's to resolve, since `generatePrompt` makes no network call (the Surveys' `{BASE}` precedent): one added sentence, "Where to stand", says how (`git fetch origin pull/<number>/head`, then the merge-base with `origin/main`). The repository line names the PRs' repository. The pilot's second paragraph is the stage's Goal lead.
- **The comment's shape** is held by the proxy (`routes/proxy-writes.js`, `checkBlindRead` in `lib/run-ledger.js`), not by the prompt's words.

## Decisions the pilot settled

- **The change's area for a multi-area change** is every area a file in the diff maps to. `LEFTOVER_RULE` says "the change's area"; every pilot sample touched two to four areas, so a single area would have pushed most real finds outside.
- **Unmapped paths** take the area whose code they concern, by `CONSEQUENCE_TEST`'s own sentence, not a separate rule.
- **What the reader sees of the PR** is its URL as a name, and the SHAs it resolves. No body, no commit messages, no comments: those carry the ask and the plan. The diff excludes the area notes and `docs/plans/`, `docs/reviews/` and `docs/papers/`, which carry the pipeline's earlier judgement. These limits are instructions: a session with the repository and `gh` could still read them (the proxy half of that residual is a Waiting entry in `docs/areas/agent-api.md`).
