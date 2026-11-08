# LIN-4252: Client unit tests get one fake DOM that can repaint (tidy first, before LIN-4246)

State: Todo
Labels: none

## Description

## As asked

## Goal

The browser code's unit tests have one small fake DOM with a home, good enough to repaint a page and see which nodes survive. Then a claim about what a repaint keeps can be witnessed in a unit test, not only in a slow end-to-end spec.

## Context

* `tests/unit/lin-4010-home-opened-task.test.js` runs `public/prompt-section.js` in a vm against a string-based fake. `querySelector` returns null, and there's no node identity, `replaceWith`, input value or focus, so it can't see whether a repaint kept a card.
* `tests/unit/lin-4242-waiting-merge.test.js` has its own hand-written parser and fake DOM.
* Client tests elsewhere stub `querySelector` selector by selector.
* "Shared test fakes with a home" has been named by five tickets (LIN-4177, LIN-4178, LIN-4241, LIN-4242, LIN-4048). Both Surveys of LIN-4246 named this gap as the reason its call-site witness would need a 180 s E2E spec.

## This step

A tidy, done first as its own task: one fake DOM, in a shared test-helper home, used by the two suites above, with the second fake deleted in the same change. It models what a repaint needs: node identity, `replaceWith` and `innerHTML`, an input's value, focus and `document.activeElement`. No production code changes.

**Not this ticket:** LIN-4246's witness (it comes next, on this fake); moving other client tests onto it; splitting `prompt-section.js`.

## Done when

* One fake DOM, with a home that other client tests can find, and the second copy gone.
* Both suites pass on it with the same test names and counts as before.
* Each thing the fake models has its own small test, so the fake itself can't silently pass.

## Report back

What the fake models, and what it deliberately doesn't. What moved. What had to learn about it.

*End of what was asked. Steps write below this line; nothing above it changes.*

## Comments (oldest first)

### (Survey, survey-task, posted before work began)

## Survey open-0: LIN-4252 @ 29f14bf6e

**Why it will be hard: lin-4242's fake already has node identity. What it can't do is turn its tree back into a string, and the second suite depends on that.**

1. **lin-4010 asserts on strings.** About 30 assertions are regexes over `c.innerHTML`, such as `/class="btn btn--primary opened-task-write" data-testid=…/`, `data-question-slot>\s*<div class="sess-qcard"` and `[^>]*hidden`. A parsing fake must rebuild that exact string: attribute order, quoting, boolean attributes, entities. lin-4242's parser decodes `&#39;` and `&quot;` and keeps no source text. Otherwise the counts hold but the assertions get rewritten.

2. **prompt-section.js depends on that string too.** `keepTypedQuestion` keeps the old card when `oldQuestion.innerHTML === fresh.innerHTML` (public/prompt-section.js:993). lin-4242's getter returns `''`. Merged as is, every repaint "keeps" the card and the fake passes silently. That is the claim LIN-4246 needs to witness.

3. **The list of things to model leaves out the `outerHTML` setter.** `paintState`, `paintRun` and `paintLastCopy` repaint with `slot.outerHTML = …` (lines 1095, 1121, 1148). The selectors also go beyond lin-4242's matcher, which throws on anything but a compound selector:
   - `:scope > … > …` (845)
   - descendant selectors (1153)
   - `button:not([disabled]), …` (1809)
   - a comma list through `closest` (`MARKDOWN_SINK`, 2456)

   It also uses `parentElement`, the selection range and `.type`.

4. **A working `querySelector` turns on code that has never run in this suite.** Today lin-4010's `querySelector` returns null, so `paintRun` always falls back to a full `render()`. With a real tree, the slot repaints, `keepTypedQuestion`, focus restore and `paintFoldCount` (through `container.parentElement`) run for the first time. Some tests may fail for real reasons. The `click` helper also invents its buttons without checking the page. If it stays, lin-4010 is only half on the fake. If it clicks real nodes, expect failures that need a ruling.

5. **There are four homes:** `tests/helpers/` (about 40 importers), `tests/unit/helpers/`, `tests/unit/lib/`, and `tests/fixtures/` (which already holds `client-common.js`, a vm client harness). Pick one and say so in source-map. The fake's own tests must sit at `tests/unit/*.test.js`, or the runner's glob won't pick them up.

**Scope.** Up to 16 unit files have their own fake DOM. The 2026-10-12 review counted 9 `FakeElement`s, "not worth consolidating". LIN-4246 changes that, but keep this ticket to the two suites.

**Is this a symptom of something deeper?** Partly. A repaint claim needs a DOM only because prompt-section repaints by replacing strings, then patches the kept nodes back in. That is the ruled-out split. It doesn't block this work; it is why the fake has to parse and serialize HTML, not just build trees.

**What I'd do first.** Before moving either suite, write the fake's round-trip test: take every HTML string lin-4010 asserts on today, parse and serialize it, and require identical bytes, plus an innerHTML-equality case for (2). Failing that, the getter returns the last string written, and the Report says so. Then add `outerHTML` and the selector forms above to the list, each with its own test. Then move lin-4242, then lin-4010.

I didn't run the suites: this clone has no `node_modules`.

### (Survey, survey-place, posted before work began)

## Survey global: LIN-4252 @ 29f14bf6e

**Where it lands.** The client side of `tests/unit`: 117 files run a `public/` script in a `vm`. Nineteen define their own `makeContainer()`, and 16 of those were added since September, so the copies are still multiplying. There are three kinds of fake, not two: the string container (lin-4010 and its 18 siblings), the tree in lin-4242, and `FakeElement` in `chat-append-options.test.js`. The fakes have shaped production code too. `public/prompt-section.js` (2,885 lines, 62 commits since September) carries 18 guards like `container.querySelector ? … : null` that exist only for the fakes. In lin-4010 they mean `keepTypedQuestion` returns early and `paintRun` falls back to a full `render()`, so its repaint paths never run.

**Done the obvious way.**
- **The 4242 tree isn't enough for prompt-section.** It repaints through `slot.outerHTML =` at five sites, which the ticket doesn't list. It queries descendant selectors (`[data-run-slot] [data-testid=…]`), `:scope > a > b > c`, and selector lists with `:not([disabled])`, and it reads `setSelectionRange`. The 4242 `matches` throws on all of those, and its `innerHTML` getter returns `''`.
- **"Same names and counts" can hide a real change.** Once `querySelector` returns real nodes, lin-4010 runs code it skips today: the proxy-toggle bind, `keepTypedQuestion`, `paintRun`'s `outerHTML` path. Anything that fails there is a finding to record, not something to patch inside the fake.
- **lin-4010 reads markup back as a string** through about 40 regexes, and some depend on how the markup was written. `data-question-slot>\s*<div` expects a bare boolean attribute, which a browser serializes as `=""`. Keeping the raw last-set string as the getter, or loosening regexes until they pass, would hide a second model inside the fake. The serializer needs its own test, and any regex it changes should be named.
- **Second copies.** Don't move lin-4242's `world()` sandbox setup into the helper. The 17 other `makeContainer` copies stay, as they should. The new file's header should say it is the one to use, or a twentieth copy will still get written.

**What has to learn about it.** No list of test helpers exists, and `source-map.md` maps source only. `CLAUDE.md` is at its 110-line ceiling, so it can't take a pointer. Nothing would notice whether the home is findable. The runner globs `tests/unit/*.test.js` only, so the fake's own tests must sit flat in `tests/unit/`. A test placed under `tests/unit/helpers/` would never run, and nothing would report that.

**Better, at this task's cost.** Follow an existing precedent: `tests/helpers/css-rules.js` with `tests/unit/css-rules-helper.test.js` (LIN-4015). Use `tests/helpers/fake-dom.js` with `tests/unit/fake-dom-helper.test.js`, not a fifth helper home on top of `tests/helpers`, `tests/unit/helpers`, `tests/unit/lib` and `tests/fixtures`. Keep the selector engine throwing on anything it doesn't support, add the forms prompt-section uses, and treat `outerHTML` as a repaint primitive alongside `replaceWith`.

**Better still, not this task's.** Move the other 17 suites onto the fake. Then delete the 18 feature-detect guards in `prompt-section.js`, which only becomes safe once no suite needs them. The guards are the deeper symptom: the fakes have been bending the code they test. And split the file.
