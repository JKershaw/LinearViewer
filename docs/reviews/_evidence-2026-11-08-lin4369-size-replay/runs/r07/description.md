## Size of the move

**Size:** just the task
**Decided by:** the standing policy

**Chosen size: just the task, read by its goal sentence rather than by its list of things to model.** The goal settles what the ticket delivers: one shared fake page that is good enough to repaint and to tell which parts survived. A fake built only from the list in "This step" would not meet that goal. The opened-task component repaints by swapping out an element's whole markup, which the list leaves out. It also decides whether to keep a question card by comparing the old markup with the new, so a fake that cannot turn its tree back into markup would report every repaint as a keep and pass without testing anything. Covering those gaps is the task itself, not an extra.

**What done means, settled:**
- **The fake turns its tree back into markup.** It writes the markup out from the tree itself. It does not echo the last string it was given, and it does not return nothing. A test proves this: every piece of markup the opened-task suite checks today comes back unchanged after a read and a write-out. Two cards with equal markup compare equal, and two with different markup do not.
- **It models every repaint the two suites' code performs.** That covers replacing a node, rewriting an element's contents, rewriting an element's whole markup, an input's typed value and cursor position, focus, and which element is active. Each of these has its own small test.
- **It answers only the lookups that code makes, and fails loudly on any other.** A lookup the fake cannot answer must fail with an error, never come back empty. The lookups the opened-task component uses go beyond the simple forms the merge suite's fake supports: child chains, descendant lookups, lists of alternatives, exclusions, and nearest-ancestor lookups. Each form has its own test.
- **Both suites run on it, end to end.** The opened-task suite paints into a node of the fake, and its clicks and key presses start from controls that are really on the painted page, not from invented ones. The merge suite's own parser and fake are deleted in the same change. Each suite's own sandbox setup stays where it is.
- **Test names and counts stay the same, and so do the assertions,** except where the fake writes markup out in a different but valid form than a hand-written string did. Every assertion changed for that reason is named in the report. No assertion is loosened just to make it pass.
- **Code that wakes up is a finding, not something to patch around.** With real lookups, parts of the opened-task component run in this suite for the first time: the in-place repaints, the card keep, and focus restore. If a test fails there, the build stops and brings the failure back for a ruling. It does not patch the fake, loosen the test, or change production code, which the ask rules out.
- **The fake lives in a home other tests can find.** That means one of the existing test-helper homes, not a fifth. The fake's own tests sit where the test runner actually picks them up, because a test that never runs does not count. The fake says it is the one to use. It also names the older shared fake page already in the repo (the Observation one) as one to fold in later, so the next person doesn't write another copy.

**Sizes weighed:**
- **Just the task (chosen):** one faithful fake and two suites on it. That is everything LIN-4246's witness needs, and nothing it doesn't.
- **A small tidy:** no extra earns its place. Making the home findable and saying which fake to use are already part of "Done when".
- **Consolidate the decision:** move the other client suites onto the fake: about seventeen hand-copied containers, the scattered fake-element copies and the Observation fake. Then remove the component's checks for whether a lookup exists, which are there only because of the fakes. This would fix the deeper cause, but it doesn't pay off here. Each suite moved wakes up its own dormant code, which multiplies the findings that need rulings. Removing the checks changes production code, which the ask rules out, and it is only safe once every suite has moved. The ask excludes this, and both Surveys say to keep to two suites.
- **Rebuild the area:** split the opened-task component so it stops repainting by swapping strings. That split was ruled out earlier, and it is far larger than this tidy.
- **Wrong work:** no. Five tickets named this gap, and it is the reason LIN-4246 would otherwise need a slow end-to-end spec.

**Symptom of something deeper:** partly. The component repaints by replacing strings and then patches the kept nodes back in. That is why the fake has to read and write markup, and why the fakes have bent production code (the checks above). This ticket fixes the cause for the repaint fake: one honest fake with a home. The checks and the other suites are follow-up work, best done after LIN-4246 has used the fake.

**Extra beyond the task:** none.

**Cuts to the ask:** none. Every sentence above the line is delivered. The additions (writing markup out, whole-markup repaints, the extra lookup forms, real clicks) all serve the ticket's own goal.

**Open questions:** none now. One stop condition: a test that fails because code now runs for the first time comes back for a ruling before the work merges.

**Decided by:** the standing policy (err larger). The look shows that the larger move, consolidation, does not pay off for this task, so the policy keeps it at just the task.
