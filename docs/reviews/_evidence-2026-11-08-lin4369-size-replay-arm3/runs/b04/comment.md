## Scoping: size of the move

**Size: just the task.** Decided by the standing size policy (err larger only when the look shows it pays). Nobody has posted a size ruling on the trail.

**Re-grounding.** HEAD is `29f14bf6`, the same commit both Surveys read, so nothing they cite has changed since. Checked at HEAD:
- The templates without a `route` are exactly `retro`, `survey-task` and `survey-place`, which is `EXCLUDED_FROM_AI_RECOMMENDATION`, in the same order.
- `SURVEY_KINDS` is read only by the preamble gate and by the LIN-4248 tests.
- Only the launch arm of `dispatch-entrance.js` passes `kind` to the preamble.

**Why no Survey finding binds here:**
- **Offered.** The template already says this through `route`. This half deletes the second list and makes the template's own field the only declaration, with a test that every template states it. No extra piece.
- **What "read-only" means.** The Surveys are right that the code uses the phrase four ways: the preamble mandate, the "reading pass" scope line, `formatReadOnlyWorkflow` and `formatInformOnlyWorkflow`. Bringing those together would change what review, plan-review, context and others are told. This ticket forbids that (byte-identical prompts), and LIN-4251 owns it. The scope line and the trait are also different ideas: triage will become read-only in LIN-4251 but stays "filing", not "a reading pass". So that work would contradict the ask, not enable it. Inside the task, the engineering choice is to name and document the trait for what it gates, which is the dispatch mandate and its closing. The docstring should say how it differs from the prompt-body helpers. Then flipping it means one thing.
- **Entry paths.** The follow-up/resume path and the feedback-triage path never resolve a kind, so a Survey follow-up gets the reversible-work mandate today. "Byte-identical on every entry path" requires keeping that. It is a recorded gap that LIN-4251 inherits, not part of this ticket.

**Two things the build must keep, from the Surveys:**
- The preamble module stays independent of the template registry. Either the caller resolves the trait or a small traits lookup sits between them.
- One pinned expected set per trait, so tests that loop over the derived sets cannot pass on an empty loop.

**Symptom of something deeper.** Yes, and the ticket already says so. A stage's identity is spread over about ten per-kind tables: leads, scope lines, grounding, completion signals, wall-clock buckets, run-view labels, llm-jobs, budgets. This ticket fixes two of them. The others are explicitly out of scope, and the build's report names what folding them would take.
