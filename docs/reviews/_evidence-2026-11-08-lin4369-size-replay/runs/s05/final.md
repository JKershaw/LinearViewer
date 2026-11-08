I wrote the Survey comment for LIN-4252 at 29f14bf6e to `/Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/s05/output/comment.md`. It's under 500 words. I didn't run either suite, because the clone has no `node_modules`. I changed nothing in `code/`.

**What it finds:**

- **Rebuilding the HTML string is the hard part.** lin-4242's fake already gives nodes an identity. But lin-4010 has about 30 regex assertions over `c.innerHTML`, and each reads back the exact string the client wrote. A fake that parses that string into a tree has to rebuild it byte for byte, or those assertions get rewritten. lin-4242's parser decodes entities and keeps no source text.
- **The innerHTML getter is also a trap.** `keepTypedQuestion` in `public/prompt-section.js:993` compares `oldQuestion.innerHTML === fresh.innerHTML`. lin-4242's getter always returns `''`, so if that fake is merged as it stands, every repaint keeps the old card and the fake passes without testing anything. That is exactly the claim LIN-4246 needs to witness.
- **The ticket's list of things to model is incomplete.**
  - It leaves out the `outerHTML` setter, which `paintState`, `paintRun` and `paintLastCopy` repaint with.
  - prompt-section uses selectors that lin-4242's compound-only matcher throws on: `:scope >` chains, descendant selectors, `:not(...)`, and comma lists through `closest`.
- **A real `querySelector` wakes code lin-4010 has never run.** Today it returns null, so every repaint falls back to a full `render()`. With a real tree, the slot repaints, focus restore and `paintFoldCount` run for the first time, and some tests may fail for real reasons. lin-4010's `click` helper also makes up its buttons without checking they are on the page.
- **There are four possible homes for the fake:** `tests/helpers/`, `tests/unit/helpers/`, `tests/unit/lib/` and `tests/fixtures/`. The fake's own tests must sit at `tests/unit/*.test.js`, or the runner won't pick them up.
- **Partly a symptom:** prompt-section repaints by replacing strings and then patches kept nodes back in. That is the split the ticket rules out. It doesn't block this work, but it is why the fake has to parse and serialize HTML.

**What I'd do first:** write the fake's round-trip test before moving either suite. Take every HTML string lin-4010 asserts on, parse and serialize it, and require identical bytes, plus an innerHTML-equality case. If that can't be done, the getter should return the last string written, and the Report should say so. Then add `outerHTML` and the selector forms, each with its own test, and move lin-4242 before lin-4010.

DONE: Survey comment for LIN-4252 @ 29f14bf6e written; the main risk is rebuilding lin-4010's HTML strings exactly, and the first step is a round-trip test.
