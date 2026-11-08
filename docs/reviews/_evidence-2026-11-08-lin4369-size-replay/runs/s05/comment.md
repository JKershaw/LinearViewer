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
