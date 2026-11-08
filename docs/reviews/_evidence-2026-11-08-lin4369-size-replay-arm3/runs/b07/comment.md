## Scoping: LIN-4252 @ 29f14bf6e

**Size: just the task.** I applied the standing size policy (err larger, set 2026-11-07). Nobody has posted a size ruling on this ticket.

**Staleness check.** None of the files the ticket names has changed since it was written: `public/prompt-section.js`, the two suites, `tests/helpers/` and `tests/fixtures/client-common.js` were last touched on 2026-11-05 (LIN-4048, LIN-4242), and HEAD is 29f14bf6e. I re-read the code at HEAD and it matches both Surveys:
- `slot.outerHTML =` at 1095, 1120, 1149, 1997 and 2009
- the `innerHTML` equality check in `keepTypedQuestion` at 993
- the `:scope > … > …` selector at 845, the descendant selector at 1153 and the `:not([disabled])` list at 1809
- `container.parentElement` at 1108, `setSelectionRange` and `document.activeElement` at 1144 and 1814
- lin-4010's `querySelector() { return null; }`, its invented click targets, and lin-4242's `innerHTML` getter returning `''`

**What binds, and why it is still the task.** The goal is a fake that can repaint a page and show which nodes survive, and it is used by both suites. Each of these findings is needed for that goal or for "both suites pass on it", so each one is part of building the fake the ticket asks for. None is a separate piece of work:
- **Repaint by `outerHTML`.** prompt-section repaints its slots this way. A fake that only models `replaceWith` and `innerHTML` would not repaint anything in lin-4010.
- **Reading markup back as written.** Around 30 lin-4010 assertions are regexes over `c.innerHTML`. `keepTypedQuestion` keeps a card when the old and new `innerHTML` match. With a getter that returns `''`, every repaint would "keep" the card, and the fake would pass without testing anything. That is exactly the claim LIN-4246 needs to witness. This also means the fake needs ordered text nodes: lin-4242's single `_text` per node can't be serialized faithfully.
- **The selector forms prompt-section actually calls.** Once `querySelector` returns real nodes, lin-4242's matcher throws on these forms, so lin-4010 can't pass on that matcher. Unsupported forms should still throw.
- **Clicks and keys on real nodes.** If lin-4010 keeps the invented button objects, it keeps part of a second fake.

The ticket's own list says the fake "models what a repaint needs", so these are what that phrase covers. They are not extras. Each one gets its own small test, as the ticket's "Done when" asks.

**What doesn't bind, and stays in the Surveys:**
- moving the other 17 to 19 `makeContainer` suites
- `FakeElement` in `chat-append-options`
- removing the feature-detect guards in prompt-section (16 sites by my count; that would be a production change)
- splitting prompt-section

The ask works without any of them, and the ticket rules them out. **Is this a symptom of something deeper?** Yes, partly, as both Surveys say: prompt-section repaints by replacing strings and then putting kept nodes back, and the fakes have shaped its guards. That doesn't block this task. It only explains why the fake has to parse and serialize HTML.

**One thing neither Survey counted.** `tests/fixtures/observation-dom-shim.js` is already a shared fake DOM with a home (LIN-3983), used by three Observation suites. It doesn't bind here. But for "a home other client tests can find", the new file's header should say it is the fake to use for repaint claims and should name that shim. Otherwise readers will find two homes.

**A risk that would come back as a ruling, not a cut now.** With a working `querySelector`, lin-4010 runs repaint paths that have never run in it: `keepTypedQuestion`, the `outerHTML` paths, focus restore, the fold count and the proxy-toggle bind. If one of them fails for a real reason, "no production code changes" and "both suites pass with the same names and counts" can't both hold. In that case the build stage should bring the failure back as a finding. It shouldn't patch around it inside the fake or loosen a regex. Any assertion whose text changes should be named in the Report. I couldn't run the suites because this clone has no `node_modules`.
