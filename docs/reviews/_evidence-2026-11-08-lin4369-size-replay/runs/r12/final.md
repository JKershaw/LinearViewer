I scoped LIN-4252 and settled what it delivers and what done means. My choice is **a small tidy**, decided by the standing "err larger" policy. I made no cuts to the ask, so I don't need a ruling from you. I didn't run either test suite: the clone has no `node_modules`.

**What I settled** (in the `## Size of the move` section):
1. **What the fake models.** The ticket lists five things. The code also needs:
   - setting a node's outer markup, which the opened-task script does at five repaint sites;
   - reading markup back from the tree the way a browser writes it, not returning the last string written;
   - the query forms the code uses: descendant, child-of-scope, "not disabled", and comma lists;
   - a node's parent, and an input's caret position;
   - focus that works like a browser's: a focused node that leaves the page loses focus, and typed text lives on the node, not in its markup.

   Without those, the "repaint keeps the card" claim that LIN-4246 needs would pass silently.
2. **"Both suites pass on it".** Each suite's page really runs on the fake, and clicks land on controls that are actually on the page.
3. **"Same names and counts".** A test's markup check may change only where a browser writes the markup differently, each change is named in the Report, and none is loosened to pass.
4. **"A home others can find".** One of the existing helper folders, with the fake's own tests placed where the test runner picks them up.

**The extra, done first:** a findable list of shared test helpers that names this fake as the one to use. It is needed because both Surveys missed an existing shared fake (the Observation shim, used by four suites), and 19 suites now carry a string-based copy.

**Deeper problem, not this ticket:** the opened-task script repaints by replacing markup strings, and has about 18 checks that exist only because the fakes couldn't run queries.

**Open question:** once queries return real nodes, a real bug in the opened-task script may surface. The ticket rules out production changes but also requires both suites to pass. If that happens, my recommendation is to stop and ask for a ruling rather than change the fake or loosen a test.

I found no commits since the ticket was written: the Surveys were taken at HEAD (29f14bf6). The code clone is unchanged.

Files are in `/Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r12/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md` (status set to In Progress)

DONE: LIN-4252 scoped as a small tidy (standing policy), with the deliverable and done criteria settled from the code and no cuts to the ask
