## Scope: LIN-4252 @ 29f14bf6

**Size: just the task.** Decided by the standing policy ("err larger", 2026-11-07). Every finding that binds is already covered by the ask's own words, so the policy has no larger size to weigh. The policy says a small, clear ticket stays just the task. No cuts.

**Staleness check.** HEAD is 29f14bf6, the commit both Surveys read. Nothing has landed since on `public/prompt-section.js`, `public/question-cards.js`, either suite, `tests/helpers/` or `tests/fixtures/client-common.js`. I re-read the source at HEAD and it matches both Surveys:
- `slot.outerHTML =` repaints at lines 1095, 1120, 1149, 1997 and 2009.
- `keepTypedQuestion` compares `innerHTML` strings (line 993).
- The selector forms used are `:scope > … > …` (845), a descendant selector, `:not([disabled])` lists (1809) and `closest` with a list.
- `parentElement` (1108) and `setSelectionRange` (1158) are read.
- lin-4242's `innerHTML` getter returns `''`, and its `matches` throws on anything but a compound selector.
- lin-4010's `querySelector` returns `null`.
- There are 19 `makeContainer` copies in `tests/unit`.

**What binds, and why it stays inside the ask**
- **Whole-slot replacement (the `outerHTML` setter) and the selector forms above.** The Goal is a fake "good enough to repaint a page". prompt-section repaints through these, so a fake without them would throw, or would never run the repaint. The ask's list is introduced as "what a repaint needs", so these belong to it. They are not extra.
- **Markup read back as text (the `innerHTML` getter).** lin-4010 makes about 30 to 40 regex assertions over `c.innerHTML`. With a getter that returns `''`, the card-keeping check passes no matter what. "innerHTML" is in the ask, and so is "the fake itself can't silently pass". Both Surveys' first step, a round-trip test over every string lin-4010 asserts on, is how that line in Done when gets met.
- **A home others can find.** This is in Done when. The `tests/helpers/` and `tests/unit/*-helper.test.js` precedent (css-rules, LIN-4015) fits. The test must sit flat in `tests/unit/`, or the runner's glob skips it. How the home is found is an engineering choice, not a size.

**What does not bind (it stays in the Surveys)**
- Moving the other 17 `makeContainer` suites onto the fake. The ticket names this as not its work, and the two suites work without it.
- Deleting the feature-detect guards in prompt-section (`container.querySelector ? … : null`). They are the deeper symptom: the fakes have been bending the code under test. Once a fake has `querySelector`, they are inert, and they can only go once no suite needs them.
- Splitting prompt-section. That was ruled out, and the ticket names it as not its work.

**Is this a symptom?** Partly, as both Surveys say. A repaint claim needs a fake that parses and serializes HTML only because prompt-section repaints by replacing strings and then patches kept nodes back in. That doesn't block this tidy, and it isn't this ticket's.

**For the build stage (risk, not scope).** Once `querySelector` returns real nodes, lin-4010 runs paths it has never run: the slot repaint, `keepTypedQuestion`, focus restore, `paintFoldCount` through `parentElement`, and the proxy-toggle bind. The `click` helper also invents buttons rather than clicking real ones. Any of these could fail for a real reason. The ask says "no production code changes" and "same test names and counts". If a failure turns out to be a production bug, treat it as a finding and bring it back for a ruling. Don't patch it inside the fake or loosen a regex. Any regex the serializer forces to change should be named in the Report. I couldn't run the suites: this clone has no `node_modules`.
