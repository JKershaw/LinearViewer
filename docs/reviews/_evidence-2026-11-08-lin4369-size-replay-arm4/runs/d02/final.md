I sized LIN-4252 as **just the task**, decided by the standing policy. There are no cuts and nothing needs a ruling.

**What I wrote**
- `output/description.md`: the `## Size of the move` record, four lines, to go below `## As asked`.
- `output/tracker-actions.md`: status Todo -> In Progress.
- No comment, as the prompt says.

**Is the ticket still accurate?** Yes. HEAD is 29f14bf6, the same commit both Surveys read, so nothing has changed since. I checked their claims against `public/prompt-section.js` and they hold:
- Slots are repainted by replacing the whole slot through `outerHTML` at lines 1095, 1120, 1149, 1997 and 2009.
- It uses selector forms the lin-4242 matcher throws on: `:scope >` chains, descendant selectors, `:not([disabled])` lists, and comma lists through `closest`.
- It also uses `parentElement`, `setSelectionRange` and `document.activeElement`.
- `keepTypedQuestion` compares `innerHTML` strings (line 993), but the lin-4242 fake's `innerHTML` getter always returns `''`. Left that way, every repaint would "keep" the card and the fake would pass without testing anything.

**Why just the task.** The Surveys' gaps (replacing a slot through `outerHTML`, the extra selector forms, an `innerHTML` getter that really serializes) are needed to deliver the ask itself. The ask says the fake "models what a repaint needs" and that "both suites pass on it", so these complete the ask's own list rather than adding a separate piece. Nothing else binds:
- Moving the other ~17 `makeContainer` suites is ruled out by "Not this ticket".
- The 18 `querySelector ?` guards that exist only for the fakes don't stop this work.
- Splitting the file was already ruled out.

Those stay in the Surveys as the deeper symptom: the fakes have been shaping production code. The standing policy says to err larger, but it can only weigh a finding that binds, and none does here. So it leaves the size unchanged.

**Notes for the build stage**
- **Risk:** on a real tree, lin-4010 runs code it has never run before: the proxy-toggle bind, `paintRun`'s `outerHTML` path, `keepTypedQuestion`, and focus restore. If that turns up a real bug, "No production code changes" and "same names and counts" will conflict. That is a ruling to raise when it happens, not a reason to resize now.
- **Placement:** the fake's own tests must sit flat at `tests/unit/*.test.js`, or the runner's glob won't pick them up. Following the precedent of `tests/helpers/css-rules.js` with `tests/unit/css-rules-helper.test.js` keeps it to the existing helper homes.
- **Regexes:** some lin-4010 regexes depend on how the markup was written, such as a bare `data-question-slot>`. Any regex the serializer forces to change should be named in the report.
- **Tests not run:** lin-4242 passes 13/13 at HEAD. I couldn't run lin-4010 because the clone has no `node_modules` (`graphql-request` is missing) and there is no network.

DONE: Sized LIN-4252 as just the task under the standing policy, with no cuts; the size record is in output/description.md and the status move in output/tracker-actions.md.
