**Scoped: a small tidy, decided by the standing policy ("err larger", 2026-11-07).** The size record is in the description under `## Size of the move`.

The ask is clear on why. Against the code it was loose in four places, and the size record settles each one:

1. **What the fake has to model.** The five listed items are not enough. It also needs: setting a node's outer markup (five repaint sites), reading markup back from the tree the way a browser writes it, the query forms the code uses, a node's parent, an input's caret, and focus modeled as a browser does it. A focused node that leaves the page stops being focused, and a typed value lives on the node. Without those, the keep claim LIN-4246 needs would pass silently.
2. **"Both suites pass on it".** Each page really runs on the fake, and clicks land on real nodes.
3. **"Same names and counts".** Assertions over read-back markup may change only where a browser writes the markup differently. Each change is named, and none is loosened.
4. **"A home others can find".** One of the existing homes, with the fake's own tests where the runner picks them up.

**The extra, done first:** a findable record of the shared test helpers that names this fake as the one to use. Both Surveys missed that a shared fake page already exists: the Observation shim, used by four suites. Without the record, this becomes the second shared fake, not the one.

**Cuts to the ask:** none.

**Open:** once queries return real nodes, a real component defect may surface. The ask forbids production changes and also requires both suites to pass, so if that happens, my recommendation is to stop and raise it as a ruling, not to bend the fake or loosen a test.

**Deeper symptom (not this ticket):** the opened-task component repaints by replacing strings, and it carries about 18 checks that exist only because the fakes couldn't query. Moving every client suite onto this fake is what makes removing those checks safe later.
