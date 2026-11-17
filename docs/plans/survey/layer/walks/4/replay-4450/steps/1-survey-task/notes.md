# Notes: 1-survey-task (task-60 / LIN-4450)

**Written** (all `in` task-60, `to` implementation, `about` plan-54):
- question-66: node end-line rule vs `hasMarkerLine`/`splitAsAsked`; two options, no recommendation (the real comment gave none).
- finding-67: empty fence gives a `codeBlock` that D1 refuses; the `adf.js` header claim is false.
- check-68: 15-minute live Jira probe of digest stability, before any code.
- finding-69: bulk path vs `getIssue` divergence.
- finding-70: size limit should be measured on the serialized property.
- run-71: added, ended `done`.

Nothing ended or handed on. My work closed no records.

**Looked up:** `show --task task-60`, `find --in task-60`, `get task-53`, and text finds (`hasMarkerLine`, `codeBlock`, `D1`, `LIN-2019`, `adfHasUnrenderable`, `digest`, `32768`, `bulk`, `live` in task-53). I was checking for duplicates and for where the live check sits (task-62 / plan-56). Nothing duplicated my findings.

**Refusals:** none.

**What my real output relied on that neither the brief nor a query gave me:** the repository at 4b5001ddf: line numbers, `hasMarkerLine`, `sealForFiling`, `adfHasUnrenderableContent`, the `adf.js` header, how `fake-client.js` merges fields, and the results of actually running the codec (`false`/`false`, the `*em*`→`_em_` outputs). Also Atlassian's docs (bytes vs characters), LIN-2019's empty-paragraph behaviour, Jira's edit-endpoint `properties`, and the fact that LIN-4445 = task-53 (I inferred it).

**What the brief carried that I didn't need:** lessons 5, 6, 16 and 47; the area list and its counts; the empty `task-60:` words line. Lesson-8 was relevant.

**Couldn't place:** the comment's identity ("Survey open-0", 13:47:23). No field holds it, so I put it in the run account.
