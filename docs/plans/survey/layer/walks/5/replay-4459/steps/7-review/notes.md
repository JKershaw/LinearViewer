# 7-review notes

**Written:** run-155 (ended done). decision-160 answers question-151: inside the bounded class. finding-161 → close-out: add a PR-body Retires bullet. Checks → close-out: check-156 (LIN-4448 renewed ask + runner-kickoff), check-157 (rebase / CI on the merged commit), check-158 (monitor + rollback), check-159 (post-deploy observation). verdict-162 approve-with-notes, `on` change-143@2, decision-145@1, decision-160@1.
**Ended:** question-151 answered. finding-147, finding-150, finding-152 done. finding-130, finding-132 and finding-138 done: review confirmed the fixes in the PR. finding-153 handed-on into check-157.

**Looked up:** `show --task`, `find --to review`, and `get` on change-143, finding-81, finding-28, question-148 and run-154. I wanted the current head, the open questions to LIN-4448, and anything already addressed to close-out (none).

**Refusals (verbatim):** `{"refused":"a decision takes no to"}`, `{"refused":"a verdict takes no to"}`, `{"refused":"link about must be an id"}`. The last one happened because the decision id was null. My script kept going after these, so I re-added all three without the bad fields. Then I re-ended question-151, finding-150 and run-155 because their first reasons said "null". The timestamps are therefore out of logical order (16:58:36–41).

**Relied on outside brief/queries:** the whole PR inspection. That covers the CI run id 43466823788, the 333-test reruns, origin/main 2aab32bf0, `runFact` lines 76-79, `dispatch-factory.js:724`, the four mutation results, Lessons at 5,389/3,950 B, `liveOnAnchor`, `_lineageOf`/`recomputeLineageRows`, and the comment ids 08c9c898/097a3442.

**Brief carried, not needed:** the parent's full asked text, decisions 115/116/117/120/121/122, most of decision-119's table, and lessons 8 and 11.

**Unplaced:** the `liveOnAnchor` "outside, no ticket" note. I left it as one line in the verdict reasoning.
