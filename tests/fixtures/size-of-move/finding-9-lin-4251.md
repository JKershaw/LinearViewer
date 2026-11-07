## How to go about it (from a Survey before work began)

Both Surveys (on this ticket, 11:00–11:01, at `d9c0f1cae`, after LIN-4253) found that the ticket describes code that's gone. `SURVEY_KINDS` is now a `writes` trait on each template (`lib/stage-writes.js`, `WRITES_BLOCK` in `lib/proxy-preamble.js`). They also found that the obvious move, `writes: 'one-comment'` on all four, is wrong for each:

* look-into and retro write nothing (inform-only bodies; retro says "Do not write them back");
* context posts one comment but isn't a forecast;
* triage changes labels, priority, state and project, so a read-only mandate would forbid its job.

The person's scope call, in order, each item its own piece:

1. **The vocabulary first. It is the only real decision, so write it down before code.** For each of the four, record what it actually writes, read from its template body and completion signals rather than this ticket's list. Then name each `writes` value for what the stage may write. A likely set:
   * `none`: look-into and retro, report in the session;
   * `one-comment`: context and the Surveys, with its sentences generalised away from "a forecast" and "the surveyed ticket" (this changes the Surveys' rendered text slightly; record it);
   * a tracker mode for triage: ticket fields and a comment, no code and no PRs.

   Each value gets its mandate and closing row in `WRITES_BLOCK`. Fix triage's pin reason ("Files and updates tickets"; its body forbids filing).
2. **Every entrance passes** `writes`**,** not only `dispatch-entrance`. Feedback-filed triage (`routes/workspace-api-feedback.js` `enqueueFeedbackTriage`) calls `attachProxyContext` with no `writes`, so it would keep the PR block. Resolve it there from the template; the preamble stays kind-blind. Test both triage entrances.
3. **The resume path, its own piece, with a stop rule:** `provisionResumeCredential` → `attachProxyContext` passes no `writes`, so a follow-up on a non-`work` stage gets the work mandate. Both blind reads of LIN-4253 named this. Stop and say so if it doesn't pay.
4. **The deeper copy of the same symptom, its own piece, with a stop rule:** `contextLines` (`proxy-preamble.js`) tells every worker to "update the workspace as you work (status, comments, labels)" whatever `writes` is. The Surveys' own prompts carry both that line and the read-only mandate. Gate it on `writes`.
5. **Witnesses without a new list of stages:** extend `lin-4248-survey-preamble.test.js` to loop over every `writes` value (it already finds kinds with `writesOf`). Pin the `work` block's bytes, so every other kind is shown byte-identical. Flip the "converse is false today" test, and keep the pin table's reason per kind.
