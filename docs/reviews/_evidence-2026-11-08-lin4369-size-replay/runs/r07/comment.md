## Scoping: LIN-4252 @ 29f14bf6

**Size: just the task, read by its goal sentence. Decided by the standing policy (err larger).** The `## Size of the move` section is now in the description. There are no cuts to the ask and no open questions, and the build has one stop condition, listed at the end.

**Re-grounding.** HEAD is `29f14bf6`, the same commit both Surveys read. Since the ticket was filed, two commits touched the referenced area. `2eb73ae0` (LIN-4143) changed how `public/question-cards.js` defaults `data-effect`, and `29f14bf6` (LIN-4248) touched a golden JSON. Neither changes anything the fake or either suite relies on. I checked the Surveys' claims at HEAD:
- `keepTypedQuestion` keeps the old card on `oldQuestion.innerHTML === fresh.innerHTML` (`public/prompt-section.js:993`). lin-4242's `innerHTML` getter returns `''`.
- `outerHTML =` repaints are at lines 1095, 1120, 1149, 1997 and 2009.
- `:scope > … > …` is at 845, `:not([disabled])` lists at 1809, `setSelectionRange` at 1158, and `document.activeElement` at 1144 and 1814.
- lin-4010's `makeContainer` (`tests/unit/lin-4010-home-opened-task.test.js:312`) returns `null` from `querySelector`, and `click` builds its own button.
- The runner globs `tests/unit/*.test.js` only. `tests/helpers/css-rules.js` with `tests/unit/css-rules-helper.test.js` is a working precedent for a helper with its own test.

**What the ticket is settled to deliver.** The goal sentence governs ("good enough to repaint a page and see which nodes survive"), and the "This step" list isn't complete enough to meet it. The fake therefore also has to:
- write markup out from its tree, with a test that every markup lin-4010 asserts on today round-trips unchanged;
- handle `outerHTML` assignment as a repaint;
- support the selector forms prompt-section uses, and throw on anything else;
- let lin-4010's clicks start from nodes that are really on the painted page.

Test names and counts stay the same. Assertions change only where an honest serialization differs from a hand-written string, and each such change is named in the report.

**Something neither Survey named.** The repo already has a shared fake DOM with a home: `tests/fixtures/observation-dom-shim.js` (LIN-3983, 113 lines, a `FakeElement` tree with no parser). Three Observation suites import it. After this ticket there will be two shared fake DOMs. Moving the Observation suites over is excluded by the ask ("moving other client tests onto it"), so it isn't in scope here. The new fake's header should name the shim as the older one to fold in later, so nobody picks the wrong fake.

**Why not larger.** Consolidating would mean moving all 19 `makeContainer` copies, the roughly 11 `FakeElement`/`FakeNode` copies and the Observation shim, then deleting prompt-section's feature-detect guards. That is the real cause, but it doesn't pay off for this task:
- every suite moved wakes up its own dormant code paths, and each failure needs a ruling;
- deleting the guards changes production code, which the ask rules out, and is only safe once every suite has moved;
- the ask excludes it, and both Surveys say to keep to two suites.

It is a good follow-up after LIN-4246 has used the fake. Splitting `prompt-section.js` was ruled out earlier.

**Symptom of something deeper:** partly. prompt-section repaints by replacing strings and then patches kept nodes back in. That is why the fake has to parse and serialize, and why 18 `querySelector ?` guards exist only for the fakes.

**Stop condition for the build.** Once `querySelector` returns real nodes, lin-4010 runs `keepTypedQuestion`, `paintRun`'s `outerHTML` path, focus restore and the proxy-toggle bind for the first time. If a test fails there, bring it back as a finding for a ruling. Don't patch the fake, loosen the regex, or change production code.
