# Yap walk: notes

**Actors.** `john` merges every PR. There is one actor per Claude session, named by branch suffix (`claude-pgLc6`, `-fTjhR`, `-7xpoy`, `-2mB8v`, `-WiOoe`). PRs #17 and #19 have no session URL, so splitting them is a guess. `yap-docs` writes the standing text, whose author is unknown. `recorder` (me) writes the areas and the cross-PR links.

**Records (29).**
- area 4 (one per file touched)
- task 7 (todo.md items 5 and 9, plus one per PR)
- run 5, change 5 (head revised on the 2-commit PRs; each ends `merged` by john)
- decision 3, lesson 3, finding 1, check 1
- No plan, question or verdict appears in the material.

**Corrections.**
- PR #13's lesson "100dvh handles the keyboard" was revised by PR #17 (Chromium needs `interactive-widget`), then ended `superseded --into` PR #20's visualViewport lesson.
- PR #13's 44px touch-target decision was superseded into PR #19's padding decision.
- PR #19's textarea-padding fix is a finding (`about` change-9, `to` its task).
- Changes #19 and #20 `link about` the changes they redo.

**Refusals.** None in the real writes. I probed on a scratch copy:
- `{"error":"change-9 has already ended: merged"}`: a merged change can't also be superseded, so I linked instead.
- `{"error":"kind not declared: standing"}`
- `{"error":"a task's asked doesn't change once written"}`
- `{"error":"outcome merged is not in the set for merge"}`: a merge exists only as the change's end.

**Bad fits.**
- The todo items are stored as done tasks, because there is no standing kind.
- Philosophy, rejected-ideas and AGENTS.md (an agent-author guide, not coding conventions) are cited by no thread commit, so none of them is recorded.
- The finding is attributed to the session that fixed it; who found the problem is unknown.
- check-17 ("so the new UI can be eyeballed") is addressed `to john` as a guess. Whether he looked is unknown, so it stays open.

**Unknown, left out.** Each task's `asked`, its `done-when`, and who asked: no PR text was fetched. Task and run times are the first commit times. Tasks ending `done` at merge is inferred.
