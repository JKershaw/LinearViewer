I sized LIN-4253 as **just the task**, under the standing size policy, with no cuts. Nothing in the ask was dropped, so no decision is needed.

- **Code is current:** HEAD is `29f14bf6`, the same commit both Surveys read. I checked the key claims at HEAD:
  - The templates with no `route` are exactly the `EXCLUDED_FROM_AI_RECOMMENDATION` set, in the same order.
  - `SURVEY_KINDS` is read only by the preamble gate and the LIN-4248 tests.
  - Only the launch path passes `kind` to the preamble.
- **"Offered" needs no extra piece.** The template already declares it through `route`, so this half deletes the second list and adds a test that every template states it.
- **The "read-only" finding does not bind.** The Surveys show the phrase means four different things in the code. Bringing those together would change what several stages are told, which this ticket forbids (prompts must stay byte-identical) and LIN-4251 owns. The engineering choice inside the task is to name and document the trait for what it actually controls: the wording the dispatch preamble gives the stage.
- **Entry paths stay as they are.** The follow-up and feedback-triage paths never pass a kind, so a Survey follow-up gets the normal mandate today. "Byte-identical on every path" means keeping that. I recorded it as a gap LIN-4251 inherits.
- **Symptom of something deeper:** yes. A stage's details are spread over about ten per-kind tables, and this ticket fixes two. The ticket already rules the rest out of scope and asks the build's report to say what folding them would take.

Outputs are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b04/output/`:
- `description.md`: the four-line `## Size of the move` section
- `comment.md`: the reasoning
- `tracker-actions.md`: status Todo -> In Progress

The repository was not changed.

DONE: LIN-4253 sized as just the task (standing policy), no cuts; size record, comment and status change written.
