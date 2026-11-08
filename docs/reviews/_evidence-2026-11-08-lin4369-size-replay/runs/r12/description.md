## Size of the move

**Size:** a small tidy
**Decided by:** the standing policy

**The size, in plain words.** Do the task as asked: one fake page for the two named suites, the second hand-written copy gone, and a test for each thing the fake models. First, as its own piece, make the fake easy to find. Add a record of the shared test helpers that names this fake as the one to use for client DOM work, and lists the copies it doesn't replace yet. The standing policy is "err larger when the look shows it pays". The look shows it does pay: the string-container copy now exists in 19 suites, 16 of them added since September. Nothing points a test author at a shared helper. And neither the ticket nor either Survey noticed that a shared fake page already exists: the Observation shim in the fixtures home, used by four suites. Without that record, this fake becomes the second shared fake page, not the one, and a twentieth copy still gets written. It is a small piece, and it doesn't delay LIN-4246.

**Is this aimed at a symptom?** Partly, and that doesn't block the work. A claim about what a repaint keeps needs a parsing, serializing fake page only because the opened-task component repaints by replacing markup strings and then patching the kept nodes back in. The component also carries about 18 checks like "if this container can query…" that exist only because the fakes couldn't. In the suite under LIN-4010 those checks make the repaint and keep paths quietly fall back to a full redraw, so those paths have never run in a unit test. The fakes have been bending the code they test. Fixing that means moving every client suite onto the one fake, then removing those checks, then splitting the component. That is the area rebuild, and the ask rules it out ("Not this ticket").

### What it delivers, and what done means (settled from the code)

The ask is clear on why. Read against the code, it is loose in four places. Each is settled here, with the reason.

1. **"Models what a repaint needs" means what the two scripts under test call on their repaint, keep and merge paths, not only the five items listed.** The listed five stay: node identity, replacing one node with another, writing inner markup, an input's value, and focus with the document's focused element. The code needs more than those:
   - **Setting a node's outer markup.** The opened-task component repaints its slots this way at five sites. It is a repaint primitive alongside replace.
   - **Reading markup back as text, from the tree.** The keep path holds the old card only when the old and fresh markup read back equal. A fake that reads back empty would "keep" every card, so the very claim LIN-4246 has to witness would pass silently. Read-back must come from the tree, never from the last string written. It should follow a browser's rules, so a claim that holds in the fake holds on the page. The existing tree in the waiting-merge suite can't do this as it stands: it keeps no order between text and elements.
   - **The query forms the code uses:** descendant, child-of-scope, "not disabled", and comma lists, through query, query-all, closest and match. Any form the fake doesn't support still fails loudly, never matches nothing quietly.
   - **A node's parent element**, and an input's caret or selection range and its type.
   - **Focus, modeled as a browser does it.** Focusing a node makes it the document's focused element. A focused node that leaves the page stops being focused. An input's typed value lives on the node, not in its markup, so a repaint that replaces the node loses it. Without these rules, a repaint that drops the reader's place would still pass.
2. **"Both suites pass on it" means each suite's page actually runs on the fake.** Querying, events and the document's focus all go through it. A click lands on a control that is really on the painted page, not on a button the test made up. If a test helper bypasses the fake, the suite is only half on it, and that helper is the second model the ask wants gone.
3. **"The same test names and counts" means:** the same names, and the same number of tests per suite as a run at the start commit reports. An assertion over read-back markup may change only where a browser would write that markup differently, such as a bare boolean attribute or an entity. The Report names each such change. No assertion is loosened to make it pass.
4. **"A home that other client tests can find" means** one of the existing helper homes, not a fifth. The home with a precedent of a helper plus its own test is the natural one. The fake's own tests must sit where the unit runner already picks tests up, or they never run and nothing says so. The file's own header names it as the one to use.

### Sizes weighed

- **Just the task.** One fake for the two suites and LIN-4246 is unblocked. But the fake has nothing pointing to it, and it sits beside an existing shared fake nobody named, so the copies keep multiplying.
- **A small tidy (chosen).** The task, plus a findable record of the shared test helpers that makes this fake "the one" and lists the known copies still to fold. This stops the twentieth copy for little cost.
- **Consolidate the decision this task touches.** This puts every client suite on the one fake: the Observation shim's four suites and the 17 other string containers. That is the single answer to how client tests fake the page. The ask defers it ("moving other client tests onto it" is not this ticket). Each suite moved also turns on code paths that have never run, so each could surface failures that need rulings, and LIN-4246 would wait on all of them.
- **Rebuild the area.** Consolidation, plus removing the fake-only checks from the opened-task component, plus splitting it. This is the real fix for the symptom above. Splitting is ruled out, and it depends on consolidation first.
- **Wrong work.** No. This is the right next step: both Surveys of LIN-4246 named this gap as the reason its witness would otherwise need a slow end-to-end spec.

### The extra

Before the fake is built: a findable record of the shared test helpers. It names this fake as the one for client DOM work, names the existing Observation shim and the string-container copies as known copies still to fold, and states that the fake's own tests must sit where the runner finds them. It doesn't move any other suite. It may stop if the only places a test author reads are under a size ceiling (the agent guide is at its line ceiling) and no other fitting place exists. Then the fake's header alone carries the "use this one" note, and the Report says so.

### Cuts to the ask

None. Every clause of `## As asked` is delivered in full, including "No production code changes" and every item of "Report back".

### Open questions

- **A real defect may surface.** Once queries return real nodes, the suite under LIN-4010 runs repaint, keep, focus-restore and fold-count code for the first time, and a test may fail because the component is wrong, not the fake. The ask forbids production changes and also requires both suites to pass, so that case can't be settled inside this ticket. Recommendation: stop and raise it as a ruling, with the failing test and its cause. Don't bend the fake, skip the test or loosen the assertion. A failure that turns out to be the fake's fault is fixed in the fake and named in the Report.
- No others.

### Who decided

The standing size policy ("err larger", set 2026-11-07) chose a small tidy over just the task. No person's size ruling is on the trail. The four settlements above are engineering choices made in this scoping, each with its reason given.
