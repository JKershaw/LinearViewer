LIN-4252 scoping is done. The size I recommend is **just the task**, and the standing policy ("err larger") decides it.

**What I wrote**
- `output/description.md`: the four-line `## Size of the move` record. Size: just the task. Cuts: none. Decided by: the standing policy.
- `output/tracker-actions.md`: one line that sets the status from Todo to In Progress.
- No comment, as the prompt asks.

**What I checked in the code (HEAD 29f14bf6, the same commit both Surveys read)**
- Since the ticket was written, the files it names (the two suites and `public/prompt-section.js`) were last changed by LIN-4242 and LIN-4048 on 11-05. What the ticket says still matches HEAD.
- lin-4242's fake (`tests/unit/lin-4242-waiting-merge.test.js`) already has node identity. But its `innerHTML` getter returns `''`, and its `matches` throws on anything that isn't a single compound selector.
- lin-4010's container (`tests/unit/lin-4010-home-opened-task.test.js:312`) is a plain string. Its `querySelector` returns null and its `click` makes up buttons, so the repaint paths in prompt-section never run in that suite.
- prompt-section repaints with `slot.outerHTML =` at 5 sites (1095, 1120, 1149, 1997, 2009). It also uses `:scope > a > b > c` (845), selector lists with `:not([disabled])` (1809), `document.activeElement` and `setSelectionRange`. `keepTypedQuestion` keeps the old card when the two `innerHTML` strings are equal (993). If the fake's getter returned `''`, every repaint would "keep" the card and the fake would pass without testing anything.

**Why the size is just the task**
- Some Survey findings do bind, but they fall inside what this ticket delivers, not beside it. The fake has to:
  - turn its tree back into the `innerHTML` string;
  - support `outerHTML` as a way to repaint;
  - match the selector forms prompt-section uses.

  Without these, lin-4010 can't move onto the fake, and LIN-4246 couldn't use it to check what a repaint keeps. The ticket's list of what to model is a starting point, so finishing that list is part of the task, not a bigger size.
- No finding binds beyond that. These are all worth doing but not needed here:
  - moving the other 17 or so suites that each build their own fake container;
  - deleting the checks in prompt-section that exist only for the fakes;
  - splitting the file.

  The ask works without any of them, and the ticket rules them out. The standing policy weighs only sizes that a binding finding opens, so it doesn't make any of these bind.

**Is this a symptom of something deeper?** Partly. A repaint claim needs a DOM that parses and serializes only because prompt-section repaints by swapping in new HTML strings and then putting kept nodes back. The 19 copied fakes, and the checks in production code that exist for them, show the fakes have been shaping the code they test. That belongs to later work, not this ticket.

**Risks for the build stage**
- **lin-4010 may turn up real failures.** Once `querySelector` returns real nodes, lin-4010 runs repaint code it has never run before. If a real failure shows up, fixing it would clash with "No production code changes". That would need a ruling, not a workaround inside the fake.
- **Some regexes may need to change.** For example, `data-question-slot>\s*<div` depends on how the serializer writes attributes with no value. Any regex that has to change should be named.
- **Where things go.** Put the fake at `tests/helpers/fake-dom.js` and its own tests at `tests/unit/fake-dom-helper.test.js`. The test runner only picks up `tests/unit/*.test.js`, so tests anywhere else would never run. The existing `css-rules` helper and its test follow the same pattern.
- **Baseline.** lin-4242 ran here: 13 tests across 3 suites, all passing. I couldn't run lin-4010 (43 tests) because there's no `node_modules`; it stops on a missing `graphql-request`.

The clone is unchanged.

DONE: LIN-4252 sized as just the task (standing policy), no cuts; size record and the In Progress status change written to the output files
