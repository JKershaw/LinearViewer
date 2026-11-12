**Lifecycle (LIN-4436):** piloted here; goes live in piece 2 (LIN-4437) as the `blind-read` template, and this file then becomes a pointer, not a second maintained copy.

# The blind read: the reader's prompt (LIN-4396, piece 1)

One change is read cold before it merges, by a reader who didn't write it. It says whether the change's area is now better, the same or worse, and sorts what it finds into the three leftover classes. It starts from the hand-run place-scoring template (`docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06/prompts/blind-read-prompt.md`) with these changes: one change, not a batch; three verdict words, no "mixed" (earlier blind scoring said mixed on 14 of 28 rows, `place-ledger.md`); finds split three ways by area; full PR URLs only for the PR read; and a comment shape piece 2 parses.

## The template

Code fills four placeholders, and nothing else varies:

- `{PRS}`: the full URL of each PR of the current landing (piece 2: `landingPrUrls`);
- `{HEAD}`: the commit read (piece 2: the PR's head when the read is sent; in the pilot, the pre-close-out head);
- `{BASE}`: the merge-base of `{HEAD}` with `main`;
- `{DESTINATION}`: where the comment goes. Piloted text: `Post nothing anywhere. End your final report with the comment exactly as it would be posted, between a line BEGIN BLIND READ and a line END BLIND READ.` Piece 2 text: `Your only output is one comment on {TICKET}: the comment below. {TICKET} is where it goes, not something to read.`

**Shared wording, quoted, not retyped.** The three class lines are `LEFTOVER_RULE`'s three clauses, and the "An unmapped path" sentence is `CONSEQUENCE_TEST`'s, both verbatim from `lib/prompts/leftover-words.js`. Each is marked `[LEFTOVER_RULE]` or `[CONSEQUENCE_TEST]` below; the marks are not part of the text. Piece 2 renders those sentences from the constants (`tests/unit/lin-4374-review-leftover-read.test.js` fails a retyped copy under `lib/`), so what ships is the text piloted here.

```
Repository: JKershaw/LinearViewer (Harbour). Clone or fetch it as you need.

You are reading one change blind, before it merges. Not whether it does its job: whether the code it leaves behind in its area is in better, the same or worse shape for the next change. You didn't write it, you are not told why it was made, and you shouldn't try to find out.

**This is read-only.** Don't change code, branches, pull requests, tickets or tracker state. {DESTINATION}

**The change:** {PRS}, read at `{HEAD}` against its merge-base `{BASE}`.

**What you read, and nothing else:**
- the diff: `git diff {BASE} {HEAD} -- . ':(exclude)docs/areas/*.md' ':(exclude)docs/plans' ':(exclude)docs/reviews' ':(exclude)docs/papers'`;
- the code, tests and how-to docs at `{BASE}` and at `{HEAD}` (`git show <sha>:<path>`, or a worktree at each). You may run tests at either;
- `docs/areas/areas.json`, the area registry.

**Don't read** the pull request itself (its page, description, comments, reviews or commit messages: the URL is only the change's name, so don't run `gh` on it, `git log` with messages, or `git show <commit>`), any ticket, the area notes (`docs/areas/*.md`; only `areas.json`), or anything under `docs/plans/`, `docs/reviews/` or `docs/papers/`, at either commit. Form your view from the code.

**Areas.** A file's area is the first area in `docs/areas/areas.json` with a pattern that matches its repo-relative path. An unmapped path (`tests/`, `scripts/`) takes the area whose code it concerns, citing a file there first; no such file or no area notes, the summary comment. [CONSEQUENCE_TEST] For you, "the summary comment" means: list that find under Outside, citing its path as it is. The change's area is every area a file in the diff maps to; a change can have several.

**What to look for.** Did the change give a decision one owner, or add a second copy of something the codebase already has? Did it leave anything new without an obvious home? Did it tangle parts of the code that were apart, or untangle them? Did something that should have learned about it (a list, a registry, a guard, a test, a doc) not? Did it leave dead code, a stale comment, or a test that doesn't witness what it says? What did it delete or make simpler? A find is something concrete in the code at `{HEAD}` that the next change would want different, with the file that shows it. Taste, style and whether the change was worth making are not finds.

**Sort each find into exactly one class:**
- Inside the change's area and fix-sized: fixed on the PR branch. [LEFTOVER_RULE]
- Inside the area but larger: a `## Waiting` entry in that area's `docs/areas/<slug>.md`. [LEFTOVER_RULE]
- Outside the area: a `## Waiting` entry in its note, or a ticket the consequence test sends. [LEFTOVER_RULE]

You only sort; someone else acts on each class. Fix-sized means one sitting on this branch could fix it without changing the change's design: a few lines in one or two files, and no new decision. Anything that needs a decision, a new design or several areas is larger.

**The verdict** is exactly one of three words: `better`, `same` or `worse`. There is no fourth. `same` means what the change made better and what it made worse balance, or there is little of either. The reason weighs both sides: name the specific thing it made better and the specific thing it made worse (or say there is none), with their files, in one or two sentences.

**The comment**, in exactly this shape:

## Blind read
Verdict: <better|same|worse>. <the reason>

Read: {PRS} at `{HEAD}` against `{BASE}`.

### Inside the area, fix-sized
- `<file>` (<area slug>): what is wrong, and the fix.

### Inside the area, larger
- `<file>` (<area slug>): what is wrong, and why it is larger than a fix.

### Outside the area
- `<file>` (<area slug>, or unmapped): what is wrong.

Rules for the comment: its first line is exactly `## Blind read`. Exactly one line starts `Verdict:`, and the word right after it is the verdict. Write "None." under a class with no finds. Full PR URLs appear only on the `Read:` line, for the change read; cite any other pull request as `#N`. Be willing to say same or worse.
```

## Decisions the pilot settled

- **The change's area for a multi-area change** is every area a file in the diff maps to. `LEFTOVER_RULE` says "the change's area"; every pilot sample touched two to four areas, so a single area would have pushed most real finds outside.
- **Unmapped paths** take the area whose code they concern, by `CONSEQUENCE_TEST`'s own sentence, not a separate rule.
- **What the reader sees of the PR** is its URL as a name, and the SHAs code resolves. No body, no commit messages, no comments: those carry the ask and the plan. The diff excludes the area notes and `docs/plans/`, `docs/reviews/` and `docs/papers/`, which carry the pipeline's earlier judgement. These limits are instructions: a session with the repository and `gh` could still read them (piece 2 records the proxy half of that residual as a Waiting entry).
