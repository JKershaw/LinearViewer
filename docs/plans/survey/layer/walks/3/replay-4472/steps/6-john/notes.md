# Step 6: John

**Waiting:** one record, question-84 (task-28, v2, from scoping, to John, open, already `stale: true`). It asks whether to extract the served leaf even though decision-32 says no serving change.

**Wrote:** `add decision` `{"in":"task-28","answer":"Yes: extract the served leaf first, and the page drops both copies","why":"John ruled on the Harbour ruling lin4472-served-leaf: allow the served-leaf extraction ahead of decision-32 no-serving-change line.","links":{"answers":"question-84"}}` `--by John --at 2026-11-13T17:54:22Z`.

**Response (exit 0):** `{"id":"decision-103","kind":"decision","versions":[{"v":1,"op":"add","at":"2026-11-13T17:54:22.000Z","by":"John","in":"task-28","state":"stands","fields":{…as sent…},"links":{"answers":"question-84"}}]}`

**After:**
- question-84 is now v3, `answered`, ended `by: "layer"`, with reason "answered by decision-103". It is still `stale: true`.
- The staleness comes from the chain verdict-25 → plan-10@2 and is unchanged from 17:54:21 (as-of check).
- Nothing contradicts John's answer, but nothing records it either:
  - decision-32 ("no serving change") still `stands`.
  - decision-95 and decision-98 still pin question-84@2. Their text still says "if John answers leave…", and decision-98 still says it "left question-84 open".
  - finding-90's says text ("left alone") is at odds with its own closing reason ("Extract was taken").
- The only marker on these records is the staleness that was already there.
