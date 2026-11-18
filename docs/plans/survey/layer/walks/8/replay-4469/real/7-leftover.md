# What this stage really wrote

The leftover follow-up (6274bf6e) of this step's build c66a3141, dispatched 23:16:10.117, last request 23:24:53. Its comment landed at 23:24:42, during the blind read's window.

## Comment on LIN-4469 at 23:24:42 (id a2efc9a8)

### Leftovers
PR: https://github.com/JKershaw/LinearViewer/pull/2447, head `877f32cb4`. CI is green on that head (Unit tests, proxy unit tests, E2E shards 1–4, secret scan, `ci-success`).

- Tidied: the header of `lib/prompts/leftover-words.js` said "Three constants" and named three. It now names all of them: the heading and the retirement-line words, plus this PR's `areaLookup` and `NOTES_PR`.
- Tidied: the header of `tests/fixtures/lin-4467-witness.js` described the witness as a one-off check for the refactor. It now says the witness is kept as a ratchet (LIN-4469).
- Noted, already in a note: simple-dispatcher's README and its `docs/areas/README.md` still restate the retirement-line forms. That repo's owner decides; it stays named in the llm-and-prompts Waiting entry and is not edited here.
- Nothing else: `docs/plans/survey/*` and `docs/prompt-pipeline/stage-descriptions/*` still quote the old read-only and triage wording, but they are dated design records, like `docs/reviews/`, not descriptions of the current code.
- For close-out: none. No find breaks behaviour, blocks work or touches safety.

Retires: `lib/prompts/stage-kinds.js`: the one-record refactor's witness (`tests/fixtures/lin-4467-witness.js`) stays in the suite as a permanent test. Decided: keep it as a ratchet. It is the identity pin on real-context renders, which the budget's caps over a context-free fixture are not. Recorded as a Lesson in `docs/areas/llm-and-prompts.md`, and the entry is removed.
