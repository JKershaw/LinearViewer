# What this stage really wrote

## Comment on LIN-4455 at 16:02:31

### Leftovers

Retires: `lib/dispatch-leftover.js`: restates the follow-up target, halt modes and `NEVER_RAN` (also in `_releaseIfHeld`) beside their homes

Settled and removed from `docs/areas/runs-and-dispatch.md` by PR #2427: Waiting 2 (the restated constants above), Waiting 4 (`lib/dispatch-store.js`: `releaseHeldWake` prepends `formatHeldWakeNote`) and Waiting 11 (`lib/dispatch-feedback-validation.js`: feedback kinds lack one declaration with their role).

Left on purpose, each written into an area note on the PR branch:
- `lib/dispatch-feedback-kinds.js`: `mayCarryWake` is true on every row while `lastWakeEntry` in `lib/run-view.js` skips decision stamps. A new Waiting entry in `docs/areas/runs-and-dispatch.md`; resolving it changes wake minting.
- The store takes held-wake policy two ways (request hook and the late-bound `setHeldWakeReleaseNote`). Already the Waiting entry "`addFeedback` takes one `wakeHook`" (Waiting 5 at filing); the setter's docblock names it.
- `lib/prompts/runner-kickoff.js` still imports `FEEDBACK_ENTRY_KINDS` through the store's re-export. Outside the area and breaks nothing, so a Waiting entry in `docs/areas/llm-and-prompts.md`.
- Browser copies of the stamp kinds in `public/dispatch.js` and `public/session.js` stay (browser scripts cannot import `lib/`); the drift test pins them to the table.

