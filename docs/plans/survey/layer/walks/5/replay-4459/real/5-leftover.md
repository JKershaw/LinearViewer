# What this stage really wrote

*Dispatched as a follow-up of the implementation session (cost record: `leftover`, followUpTo 79692563). Not in the step list the prompt gave; placed as its own step.*

## Comment on LIN-4459 at 2026-11-13T16:57:24.177Z (497f439c)

### Leftovers
- `lib/recent-runs.js`: `PARKED_LINEAGE_ENDS` restated the terminal words beside `LINEAGE_TERMINAL_STATUSES` (`lib/dispatch-lineage-status.js`); it is now built from that set plus `blocked`. Tidied.
- `lib/recent-runs.js`: `stageRuns`' docblock did not name the parked case. Tidied.
- `lib/dispatch-store.js`: the `withLineage` comments said only the Dispatch page's history asks for it, but `loadRecentRuns` does too now. Tidied.
- `tests/unit/lin-4392-live-stage-wait.test.js`: the new witnesses reused the file's W1/W2 names, and the header did not list them. Tidied.
- `docs/areas/runs-and-dispatch.md` Lessons: the lineage lesson now says that over a ticket's runs you read it batched (`withLineage`), never with a walk per row. Noted in the Runs note.

Retires: `docs/areas/llm-and-prompts.md`, the entry opening "`lib/prompts/runner-kickoff.js`: imports `FEEDBACK_ENTRY_KINDS` from the store". The runner prompt now imports from the leaf `lib/dispatch-feedback-kinds.js`, the store drops its re-export, and tests import from the leaf. The kinds and their order are unchanged.

PR: https://github.com/JKershaw/LinearViewer/pull/2432, head `7424cfb8fa42f28b303138c76f20cbb6cb74b5f2`. CI is green on that head: Unit tests, Unit tests (proxy), E2E shards 1–4, Secret scan and CI success all pass.

Nothing on LIN-4447 or LIN-4448.

No change to the LIN-4459 description (snapshots unchanged across this step).
