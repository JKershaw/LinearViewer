# survey-task notes (task-2, LIN-4450)

## Records written (13:47:23–13:47:29)
- run-1, run, in task-2, about plan-1; account plus claims (HEAD still 4b5001ddf, line numbers hold); ended `done`.
- question-1, to implementation, about plan-1: the end-line rule mismatch between the markdown and node readers, with two options.
- finding-32, to implementation: an empty fence breaks the D1 and fixed-point claims.
- check-1, to John, about decision-2: a live Jira probe of digest stability (needs a credential, see decision-3).
- finding-33, to implementation: bulk path vs getIssue divergence.
- finding-34, to implementation: measure the serialized property against the size limit.

Nothing else was closed. Nothing addressed to me was open.

## Refusals
None.

## What my real output relied on that the brief didn't carry
- That origin/main still equals 4b5001ddf, and the current line numbers (484, 863/873, 1049, 1064, 1267).
- Actually running the codec: the empty-fence `codeBlock` result, the `rt(rt(x))` fixed-point failure, and the observed rewrites (`*em*`→`_em_`, `* a`→`- a`, `***x***`).
- The code of `hasMarkerLine`/`splitAsAsked` (exact `*…*` match), `sealForFiling`, the `adf.js` header claim, and `fake-client.js` merging fields.
- LIN-2019 (it drops empty paragraphs), and Atlassian docs being unclear on bytes vs characters.

## What the brief carried that I didn't need
- Lessons 3, 4 and 14, with their long path lists (prompt or blind-reader topics).
- verdict-2 and verdict-3 (lanes, session 3).
- decisions 1, 4 and 5.
- The empty task-2 words.

## Unplaced
The "what I'd do first" ordering, i.e. probe before code. I put it inside check-1's text, because no kind carries a priority or sequence.
