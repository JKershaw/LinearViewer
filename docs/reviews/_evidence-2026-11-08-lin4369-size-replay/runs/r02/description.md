## Size of the move

**Size:** a small tidy
**Decided by:** the standing policy

**What this ticket delivers.** The ask names two goals but checks only one. "One fake DOM with a home, the second copy gone" is the means. The end is the Goal's second sentence: a claim about what a repaint keeps can be witnessed in a unit test. LIN-4246's claim is about the opened task's repaint: Home's component repaints its state and run slots, then puts a kept question card and the focus back. So the fake is done when that repaint actually runs on it in the opened-task suite (LIN-4010), not just when the suite passes. Today that suite's container answers every query with nothing. The repaint paths never run, and every repaint falls back to a full redraw. "Same names and counts" would hold whether or not that changed, so it can't be the test of done on its own.

**Done means.** The three Done-when bullets stand as written. These are added:
- In the opened-task suite, the component's container is a node of the fake. The suite shows, rather than assumes, that a state repaint takes the slot path and not the full-redraw fallback. Its clicks and key presses land on controls that are actually painted, so no test can press a button that isn't drawn.
- The fake covers every way the component repaints, not just the five things the ask lists. That includes replacing a slot by assigning its outer markup, beside `replaceWith` and `innerHTML`. It also covers the selector forms the component queries with (descendant, child-of-scope, lists, `:not`), parent lookup, caret selection and an input's type. Anything it doesn't model throws instead of answering wrongly.
- Reading markup back gives a browser's serialization of the tree as it is now, never the last string written. "Is this card's markup unchanged" then compares trees, and a card the repaint changed reads as changed. This has its own test both ways: unchanged markup keeps the card, changed markup replaces it. Text stays where it was among its sibling elements.
- Some of the opened-task suite's string assertions match the old fake's source form rather than what a browser gives back. Those change, and the Report names each one with the browser rule behind it. None is loosened just to pass. (The two Surveys differed here: byte-identical round trip, or the browser's form. It is settled on the browser's form, so that a claim witnessed on the fake also holds in a browser.)
- Focus follows the node. Focusing a control makes it the active element. A focused control that a repaint removes from the page stops being active. The merge suite's focus witness reads focus that way instead of setting it by hand.
- The fake lives in one of the existing helper homes, not a fifth one. Its own tests sit where the unit runner finds them. Its header, and the doc that maps where things live, name it as the one client tests use. (CLAUDE.md is at its line ceiling.)
- If a test fails on the fake because the fake is wrong, the fix goes in the fake. If it fails because the component is wrong, that is a finding. The build records it and stops for a ruling. It is not patched in the fake, not weakened, and not fixed in production code under this ticket.

**Why this size.** The standing policy applies: take the larger move when the look shows it pays. Here it does. The copies are still multiplying: 19 client suites carry their own container fake, 16 of them added since September. A shared fake DOM already has a home, with the Observation tests since 26 Oct, and neither Survey listed it. Five tickets still asked for "a shared fake with a home", so a homed file with a good header has not been enough. At this task's cost, the move that pays is making the next copy get noticed. Moving the other suites does not pay here.

Sizes weighed:
- **Just the task:** one fake, both suites on it, the second copy gone. LIN-4246 gets its fake. Nothing stops a twentieth copy.
- **A small tidy (chosen):** the task, plus a check that the number of client unit tests carrying their own fake DOM can only fall, which points the next would-be copy at the shared fake.
- **Consolidate the decision:** move every client suite onto the fake and remove the component's 18 feature-detect guards that exist only for the fakes. That ends the copies. But every suite moved runs code it has never run, the guards are production changes the ask rules out, and LIN-4246 gets nothing from it. The ask excludes it, and both Surveys agree.
- **Rebuild the area:** stop repainting by rewriting markup and then patching kept nodes back in, so a repaint claim needs no DOM to witness. That is splitting the component, which the ask rules out.
- **Wrong work:** no. LIN-4246's witness needs this, and the alternative is a 180 s end-to-end spec.

**The extra, done first.** A check that counts today's client unit tests with their own fake DOM and lets no new one in. The count drops by one when the merge suite's copy is deleted in this change. It may stop if a copy can't be told apart from a small one-off stub without false alarms. One shape finds 19, a looser one about 47, so this is a real risk. If it stops, the Report says why, and the ticket goes ahead as just the task.

**Is this a symptom of something deeper?** Partly. A repaint claim needs a DOM at all only because the component repaints by replacing markup and then puts the kept nodes back. And the fakes have bent the component: its feature-detect guards exist for them. This ticket fixes neither. Consolidate and rebuild, above, are where those live.

**Cuts to the ask:** none. Every sentence of the `## As asked` block is delivered in full. The additions above are what its Goal needs.

**Open questions:** none now. One may come up during the build. Suppose the opened-task suite runs its repaint for the first time and fails because the component is wrong. Then both suites can't pass without a production change, and the ask rules that out. The build stops and raises it then, with the finding.

**Who decided:** the size, by the standing policy (err larger, set 2026-11-07). The reading of the goal and of done is this scoping stage's, from the code at 29f14bf6e and both Surveys.
