# Step 4-John: notes

**Written**
- decision-156 (to implementation, scope task-128): ruling lin-4469-cuts answered `fold`. Links: answers question-139, about change-138 and verdict-147.
- question-139 ended `answered`, into decision-156.
- finding-153 (to close-out) ended `declined`. It only applied if the answer was accept, and its own text says it isn't needed after fold.
- question-133 (task-105, to John) ended `answered`, into decision-134. It was already answered at 15:57 but never ended.

**Looked up**: `find --to John --state open` (what was waiting on John), `show --task task-128` (finding the record for ruling "lin-4469-cuts"), `get question-139/finding-153/question-133/decision-135`, and `find --kind decision --text fold` to check no fold decision already existed.

**Refusals**: `{"error":"field answers does not belong to decision"}`. I had put `answers`/`about` as top-level fields. Fixed by moving them into `"links":{...}`.

**What the output relied on that no query gave**: the mapping from the ruling slug `lin-4469-cuts` to question-139. I only found it because the slug appears in the question's text. The output also says nothing about triage line 268. John's words match option 2 of question-139 v1. Review's v2, stamped 22:59 in the store, added triage, but the review comment really landed at 23:03:57, after the answer. So whether triage is in scope is still unruled. I wrote that in decision-156's `why`.

**Brief carried, not needed**: none (no brief).

**Couldn't place**: verdict-147 (needs-discussion, to John) and findings 148–152 (to close-out) were left as they are. Who acts on them after fold isn't something John said. check-155 is post-deploy, so it stays open.
