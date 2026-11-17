# Yap walk: notes

**Actors.** `john` (merges every PR). One actor per Claude session, named by branch suffix (`claude-pgLc6`, `-fTjhR`, `-7xpoy`, `-2mB8v`, `-WiOoe`), since the branch is the only identifier every PR has. PRs #17 and #19 carry no session URL, so treating them as separate sessions is a guess. `yap-docs` writes the standing text, because the material does not say who wrote it. `recorder` (this session) writes the areas and the cross-PR `about` links, which are my structure, not anyone's act at the time.

**Records (29).** area 4 (one per touched file); task 7 (todo.md items 5 and 9, both shown done, plus one task per PR); run 5; change 5 (the head is revised for the 2-commit PRs, and every change ends `merged` by john at the merge time); decision 3; lesson 3; finding 1; check 1. No plan, question or verdict appears in the material.

**Corrections.**
- PR #13's lesson "100dvh handles the keyboard" was revised by PR #17 (Chromium needs `interactive-widget=resizes-content`), then ended `superseded --into` PR #20's visualViewport lesson.
- PR #13's 44px touch-target decision was ended `superseded --into` PR #19's padding decision.
- PR #19's textarea-padding fix is a finding (`about` change-9, `to` its own task, ended done).
- Changes #19 and #20 `link about` the changes they redo.

**Refusals.** None in the real writes. I probed a scratch copy:
- `{"error":"change-9 has already ended: merged"}`: a merged change can't also be marked superseded, so I used a link instead.
- `{"error":"kind not declared: standing"}`: standing text has no kind of its own.
- `{"error":"a task's asked doesn't change once written"}`
- `{"error":"outcome merged is not in the set for merge"}`: a merge is not a verdict, so it is recorded only as the change's end.

**Bad fits.**
- I stored the todo items as done tasks, because there is no kind for standing text.
- Philosophy, rejected-ideas and AGENTS.md (an agent-author guide added outside the thread) are not cited by any thread commit, so nothing from them was recorded.
- The finding's discoverer is unknown. I attributed it to the session that fixed it.
- check-17 ("so the new UI can be eyeballed") is addressed `to john` as a guess. Whether he looked is unknown, so it stays open forever.

**Unknown, left out.** Each task's `asked` (no PR text was fetched), `done-when`, and who asked. Task and run times are the first commit times, since the real start times are unknown. Tasks end `done` at merge, which is an inference.
