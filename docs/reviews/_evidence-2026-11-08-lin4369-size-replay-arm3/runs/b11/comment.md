## Scoping: size of the move, LIN-4252 @ 29f14bf6e

**Size: just the task, decided by the standing policy (err larger, 2026-11-07).** No cuts. No one has commented on the size, so there's no ruling to record.

**Staleness.** HEAD is 29f14bf6e, the commit both Surveys read. Nothing under the referenced paths has changed since 2026-11-06: both suites, `public/prompt-section.js`, `public/question-cards.js`, `tests/helpers/` and the runner. I re-read the code at HEAD, and every code claim in both Surveys holds:
- `keepTypedQuestion` compares `oldQuestion.innerHTML === fresh.innerHTML` (line 993).
- lin-4242's `innerHTML` getter returns `''`.
- `slot.outerHTML =` appears at 1095, 1120, 1149, 1997 and 2009.
- The code uses `:scope > … > …` (845), `:not([disabled])` lists (1809), `document.activeElement` (1144, 1814) and `setSelectionRange` (1158).
- lin-4010's `makeContainer` returns null from `querySelector`, and its `click` makes up its buttons.
- 17 `querySelector ?` / `.querySelector &&` guards (the Survey said 18).
- 19 unit files define their own `makeContainer`.

**Findings that bind, and why they stay inside the task.** The ticket's list of what the fake models (node identity, `replaceWith`, `innerHTML`, input value, focus, `activeElement`) is necessary but not enough. Without the following, lin-4010 can't run on the fake, or it passes without testing anything:
- **An `outerHTML` setter.** prompt-section repaints through it at five places.
- **An `innerHTML` getter that serializes the tree.** `keepTypedQuestion` compares the two strings, so a `''` getter keeps the card on every repaint. That's the silent pass LIN-4246 would inherit. lin-4010 also checks about 30 regexes against the markup.
- **The selector forms prompt-section actually uses:** descendant, `:scope >` child chains, `:not(...)`, and comma lists through `closest`. Anything else should still throw.
- **`parentElement`, `.type`, and `setSelectionRange` on inputs.**

These correct the ticket's own list ("what a repaint needs"). They're part of building the asked fake, not a separate piece to do first, so they don't open a bigger size. Each one gets its own small test under "each thing the fake models has its own test". That includes a serialize round-trip over the markup lin-4010 checks today, and a case where the `innerHTML` strings differ.

**Weighed and not taken:**
- *A small tidy first.* I found no separate piece the task can't work without. Making the home findable is part of the ask: a header saying "use this one", an entry where helpers are looked up, and its own test flat under `tests/unit/` so the runner's glob finds it.
- *Consolidate the decision* (all client suites on one fake, then drop prompt-section's fake-only guards). This pays later, but nothing here depends on it, and the ticket rules it out ("moving other client tests onto it"). The policy weighs sizes that a binding finding opens. It doesn't create them. This stays in Survey global.
- *Rebuild the area* (split prompt-section). Ruled out, and nothing here depends on it.

**Is this a symptom of something deeper? Yes, partly.** Client tests need a fake that parses and serializes because prompt-section repaints by replacing strings and then puts the kept nodes back. Years of single-purpose fakes have also pushed feature-detect guards into production code. Neither blocks this ticket. Both are the "better still" items in Survey global.

**For the build to know:**
- **This is a third shared DOM fake, not the second.** `tests/fixtures/observation-dom-shim.js` (a `FakeElement`, used by three Observation suites) already lives in a shared home, and neither Survey counts it. It stays under this ticket's scope. The new fake's header should say it's the one to use for new client tests, and the Report should name the shim as the next suite to fold in.
- **lin-4010 will run repaint paths it has never run.** Once `querySelector` returns real nodes, it reaches the slot repaints, `keepTypedQuestion`, focus restore and `paintFoldCount`. If one fails for a real reason, that's a finding about production code, which this ticket doesn't change. Report it; don't patch around it inside the fake.
- **Some regexes depend on how the markup was written.** For example, `data-question-slot>\s*<div` expects a bare boolean attribute. Whether the serializer keeps the source form or writes it the way a browser would is a build choice. Name any regex it changes.
- **I couldn't run lin-4010 here.** This clone has no `node_modules` (`graphql-request` is missing), so it fails at import. lin-4242 runs on its own and passes: 13 tests in 3 suites.
