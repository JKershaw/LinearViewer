# Change probe for experiment 1 (written before either arm ran)

The same change request is given to a fresh agent three times, once for each version of `adf.js`: the original, arm A and arm B. Each copy runs in an isolated copy of the tree, with that version in place.

**The request.**

> Support nested bullet lists, up to two levels, in both directions. An ADF `listItem` whose content is a paragraph followed by a `bulletList` should render to Markdown as an indented sub-list. That Markdown should read back to the same ADF. `adfHasUnrenderableContent` should stop refusing that shape, because the writer can now rebuild it. Every existing test must keep passing, except tests that assert a nested list is refused; update those, and say which. Add tests for the new behaviour in the codec test file.

**Why this request.**

- It touches all three functions.
- It touches the gate's rule that it "derives from what the writer can rebuild".
- Today, nested lists are explicitly refused.

So it shows how well each version's structure takes a real change.

**Recorded for each version:**

- lines added and removed in `adf.js`;
- how many separate places in the file changed;
- tests broken along the way;
- passes needed to get green;
- the agent's own account of what was hard to find or understand;
- wall time.

The same model and the same prompt are used each time.
