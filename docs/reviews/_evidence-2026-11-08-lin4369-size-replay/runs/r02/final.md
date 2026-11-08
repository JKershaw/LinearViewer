I've scoped LIN-4252. The size is **a small tidy**, decided by the standing policy (err larger, set 2026-11-07).

**What the ticket is for.** The ticket names two goals: one fake DOM with a home, and being able to witness a repaint in a unit test. Its Done-when only checks the first. I've settled it on the second, reached through the first. The fake counts as done when the opened task's repaint really runs on it in the LIN-4010 suite: the state and run slots, the kept question card, and focus. Today that suite's fake answers every query with null, so every repaint falls back to a full redraw. "Same names and counts" would still hold if nothing changed.

**What I added to "done means":**
- The fake covers every way the component repaints, including assigning a slot's outer markup (five places), which the ask doesn't list.
- It reads markup back as a browser would, never as the last string written. The two Surveys disagreed on this; I chose the browser's form so a witness on the fake also holds in a browser. Any assertion that changes because of it is named.
- Focus moves with the node, so a repaint that removes the focused control drops focus.
- Clicks only land on controls that are actually drawn.
- If the component itself turns out to be wrong, the build stops for a ruling. It isn't patched in the fake.

**Why a small tidy.** It's the task plus one piece done first: a check that the number of client unit tests with their own fake DOM can only go down. If that check can't tell real copies from small stubs without false alarms, it stops and the ticket goes ahead as just the task. Moving the other suites and removing the 18 production guards that exist only for the fakes stays out of scope, as the ask says.

**Something the Surveys missed.** `tests/fixtures/observation-dom-shim.js` has been a shared fake DOM with a home since 26 Oct, and five tickets still asked for one. That's why I sized up to a check rather than trusting a file header to stop new copies.

There are no cuts to the ask and no open questions right now. I couldn't run the suites because the clone has no `node_modules`.

Files are in `/Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r02/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md` (status set to In Progress)

DONE: LIN-4252 scoped as a small tidy (standing policy): goal settled as the opened task's repaint running on one shared fake, plus a done-first check that fake DOM copies can only go down; no cuts.
