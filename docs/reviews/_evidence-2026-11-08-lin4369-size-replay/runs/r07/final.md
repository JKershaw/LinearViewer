I scoped LIN-4252. The size is **just the task, read by its goal sentence**, decided by the standing policy (err larger). Nothing in the ask is cut and there are no open questions.

**Re-grounding:** the repo is at `29f14bf6`, the same commit both Surveys read. Nothing that changed since the ticket was filed touches the fake or either suite. I checked the Surveys' main claims in `public/prompt-section.js` and they hold:
- It keeps the question card when the old and new markup are equal (line 993), but lin-4242's fake returns empty markup, so every repaint would count as a keep.
- It repaints by replacing an element's whole markup at five places, and the ticket's list leaves that out.
- It uses lookup forms that lin-4242's fake throws on.

**What the ticket now delivers:** the goal ("good enough to repaint a page and see which nodes survive") takes priority over the "This step" list. So the fake also has to:
- write its tree back out as markup, with a test that every piece of markup lin-4010 checks comes back unchanged;
- handle whole-markup repaints;
- support the lookup forms the component uses and fail loudly on any other;
- let lin-4010's clicks start from controls that are really on the page.

Test names and counts stay the same. Any assertion changed because the markup is written out differently gets named in the report. If a test fails because code is running in the suite for the first time, the build stops and asks for a ruling. It must not patch the fake, loosen the test, or change production code.

**Something neither Survey named:** the repo already has a shared fake page, `tests/fixtures/observation-dom-shim.js`, used by three Observation suites. Moving those suites over is outside this ticket. The new fake's header should name it as the older one to fold in later.

**Why not larger:** moving the other client suites over and removing the component's checks that exist only for the fakes would fix the deeper cause. It doesn't pay off here: each suite moved brings its own failures to rule on, removing the checks changes production code, and the ask rules both out. It is the follow-up to do after LIN-4246.

Files are in `/Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r07/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md`: status to In Progress, the description section, the comment

The code clone is unchanged.

DONE: LIN-4252 is sized as just the task, read by its goal, under the standing policy. The fake must write its tree back out as markup, handle whole-markup repaints and the component's lookups, and lin-4010's clicks must use real controls. No cuts, and a test that fails on newly running code stops the build for a ruling.
