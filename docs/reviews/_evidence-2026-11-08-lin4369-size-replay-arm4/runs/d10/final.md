Scoped LIN-4252. Size: **just the task**, decided by the standing policy. There are no cuts and nothing needs a ruling.

**What I wrote**
- The `## Size of the move` record, to go below `## As asked`: /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/d10/output/description.md
- Status Todo -> In Progress: /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/d10/output/tracker-actions.md
- No comment, as the prompt says.

**Is the ticket still accurate?** Yes. Both Surveys were taken at 29f14bf6, which is HEAD, and I checked their claims against the code:
- In lin-4010, `makeContainer` keeps innerHTML as a string, and `querySelector` returns null.
- lin-4242's `FakeNode` innerHTML getter returns `''`, and its matcher accepts compound selectors only.
- `keepTypedQuestion` keeps the old card when the two innerHTML strings are equal (prompt-section.js:993).
- There are five `slot.outerHTML =` repaint sites (lines 1095, 1120, 1149, 1997, 2009).

**Why "just the task"**
The Surveys found several things the fake has to handle. All of them are already part of what the ticket asks, so none makes the move bigger:
- **innerHTML has to work both ways.** About 40 regexes in lin-4010 read the markup back as a string, and `keepTypedQuestion` compares innerHTML. So reading innerHTML back has to give real markup. A getter that returns `''` would make every repaint look like it kept the card.
- **outerHTML and more selector forms.** The repaints in prompt-section go through outerHTML, and it uses selectors lin-4242's matcher can't handle. They belong under the ticket's "what a repaint needs".
- **Where the fake lives.** Engineering choice: `tests/helpers/fake-dom.js`, with its own test at `tests/unit/fake-dom-helper.test.js`. This copies the css-rules / LIN-4015 setup, and the test must sit directly in `tests/unit/` or the test runner never picks it up.

None of this is a separate piece of work.

These were named but don't bind, so the standing policy doesn't make the move larger:
- moving the other ~17 `makeContainer` suites onto the fake;
- removing the feature-detect guards in prompt-section.js that exist only because of the fakes;
- splitting the file.

The ask works without any of them, and the ticket rules them out by name. LIN-4246 needs only lin-4010 on the fake. Once the fake has a real `querySelector`, those guards do nothing in that suite. The 2026-10-12 review said "not worth consolidating", and the Survey notes from 2026-11-05 call this a pull candidate. Both agree with keeping it to the two suites.

**Is this a symptom of something deeper?** Partly. A repaint claim only needs a DOM that reads and writes markup because prompt-section repaints by replacing strings and then puts the kept nodes back. Over time the fakes have also shaped that production code: it carries guards that exist only for them. That deeper fix is for later work, not this ticket.

**Risk for the build stage**
- **Code that has never run in this suite will start running.** With a real tree, lin-4010 will run code it skips today: `keepTypedQuestion`, `paintRun`'s outerHTML path, focus restore, `paintFoldCount`, and the real targets of its `click` helper.
- **A real bug would clash with two of the ticket's rules.** The ticket says no production code changes, and that both suites keep the same test names and counts. A real bug found there would break one or the other. Record it as a finding and ask for a ruling. Don't patch around it inside the fake.
- **Regex changes.** If the fake writes boolean attributes back the way a browser does (`attr=""`), some regexes, such as `data-question-slot>`, will need changing. Name each one in the Report.

I didn't run the suites, because this clone has no `node_modules`. I left the repository unchanged.

DONE: LIN-4252 sized "just the task" (standing policy, no cuts); size record written, status set to In Progress
