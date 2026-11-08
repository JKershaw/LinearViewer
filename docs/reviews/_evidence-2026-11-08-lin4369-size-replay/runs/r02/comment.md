## Scoped: a small tidy (standing policy)

**What the ticket is for, settled.** The ticket names two goals: consolidating the fakes, and being able to witness a repaint in a unit test. Its Done-when only checks the first. I've settled it on the second, reached by way of the first. The fake is done when the opened task's repaint (the state and run slots, the kept question card, focus) actually runs on it in the LIN-4010 suite, and both suites keep their names and counts. The full "Done means" list is in the description under `## Size of the move`.

**Size: a small tidy.** It's the task plus one extra piece, done first: a check that the number of client unit tests carrying their own fake DOM can only fall. If that check can't tell real copies from small one-off stubs without false alarms, it stops and the ticket goes ahead as just the task. Moving the other suites and removing the prompt-section guards stays out of scope, as the ask says. Decided by the standing policy (err larger, 2026-11-07).

**Cuts to the ask:** none. **Open questions:** none now. If the newly-running repaint turns up a real component bug, that needs production code, so the build stops and asks.

**What I checked at HEAD 29f14bf6e.** No file the ticket names has changed since the Surveys:
- `tests/unit/lin-4010-home-opened-task.test.js:312` `makeContainer` has `querySelector() { return null; }`, a string `innerHTML`, and a `click` helper that invents its button. So `paintState`/`paintRun` in `public/prompt-section.js` always fall back to `render()`, and `keepTypedQuestion` (`:986`) returns before it does anything.
- `public/prompt-section.js` repaints with `slot.outerHTML =` at five sites (1095, 1120, 1149, 1997, 2009). `keepTypedQuestion` keeps the card on `oldQuestion.innerHTML === fresh.innerHTML` (993). Focus comes back through `document.activeElement` / `.focus()` / `setSelectionRange` (1144-1158). There are 18 feature-detect guards. Survey global's count is right. Survey open-0 listed three of the five `outerHTML` sites.
- `tests/unit/lin-4242-waiting-merge.test.js` fake: its `innerHTML` getter returns `''`. Its selector matcher accepts compound selectors only. `document.activeElement` is assigned by hand. Text is kept as one `_text` string ahead of the children, so text between elements loses its order and can't be serialized back faithfully.
- **Neither Survey named this:** `tests/fixtures/observation-dom-shim.js` is already a shared, homed fake DOM (LIN-3983, 26 Oct), used by three Observation suites. "A shared fake with a home" already existed and five tickets still asked for one, which is why the size adds a check rather than relying on a header. The shim stays as it is, since moving other client tests is excluded. The new fake's header should say which one is general.
- There are 19 `function makeContainer` copies in `tests/unit/`, and 23 suites load `prompt-section.js`. `CLAUDE.md` is at 110 lines, its ceiling. `tests/unit/helpers/` and `tests/unit/lib/` exist, but the runner globs `tests/unit/*.test.js` only.
- The Surveys disagreed on whether serialization round-trips byte for byte or in the browser's form. I settled on the browser's form so a witness on the fake holds in a browser. Any lin-4010 regex that changes because of it gets named in the Report.

I didn't run the suites, because this clone has no `node_modules`.
