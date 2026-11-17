# What this stage really wrote

## Comment on LIN-4450 at 13:47:23

## Survey open-0: LIN-4450 @ 4b5001ddf

`origin/main` is still the grounding commit, so the plan's line numbers hold: `_toCanonicalIssue` is at 484, `fetchIssueContext` at 863/873, `issueDescription` at 1049, `descriptionRoundTrip` at 1064, and the `updateIssue` re-read at 1267. I ran the codec at this commit against the plan's own witness inputs (sealed, then `markdownToAdf` → `adfToMarkdown`). Three things I found:

**1. The node rule and the markdown rule disagree about what counts as an end line.** `hasMarkerLine` and `splitAsAsked` only match the end sentence with its `*…*` exactly. The planned ADF reader matches "a paragraph whose plain text is the end sentence, whatever its marks". Suppose a person's words contain that sentence in plain text, or as `_…_`. `sealForFiling` seals them, because to it that isn't a marker. Then the node reader closes the region early, the digest misses, and the tail of the words is served as if it were below the line. Nobody is told. The pure `descriptionRoundTrip` will only catch this if it runs the **same** node reader. A markdown-level `checkAsAsked` alone won't. Either make `hasMarkerLine` catch the plain-text form too, or have the node rule take the **last** matching paragraph before non-region content. Decide which up front.

**2. The codec's "the D1 gate never flags what the writer emits" claim is false.** The `adf.js` header says it, but an empty fence (words containing "```" then "```" on the next line) makes `markdownToAdf` emit an empty `codeBlock`. `adfHasUnrenderableContent` refuses that, and `rt(rt(x)) !== rt(x)` for it (I got `false` on both checks). Today that only affects that one ticket. Once Harbour writes the block itself, it becomes Harbour making a ticket whose description can never be written again: every later `description/below` hits 422 on D1. The planned fixed-point test will fail on this input unless the codec is fixed or the input is excluded. Pick one deliberately. The plan says "D1 unchanged", but D1 sees the whole document, the block included.

**3. "Done when" only proves things on `fake-client.js`, and the real risk is live Jira.** Shape B relies on a SHA-256 of `adfToMarkdown(region)` staying stable across Jira's ordinary saves. The plan names one change Jira makes (`localId`), and `adfToMarkdown` ignores attrs, so that one is handled. Nothing shows that Jira's editor leaves alone the content that can change the rendering: trailing spaces before a hardBreak (a planned witness), how adjacent text nodes are split, or empty paragraphs (LIN-2019 already drops these). If any of those shift when someone edits *below* the line, every sealed issue reads as "human-edited". The words then quietly turn into the rendering (`*em*` → `_em_`, `* a` → `- a`, `***x***` → `\***x**\*`, all observed here). That is the exact reformatting the seal exists to prevent. The fake client just merges `fields` and stores whatever it's given, so it can't show this.

Smaller points:
- The bulk search path stays display-only. That means one issue reads differently through search than through `getIssue`, so check that no cache or guard compares the two.
- Atlassian's property limit is in bytes or characters depending on which page you read. JSON escaping inflates `words`, so measure the serialized string.

**What I'd do first:** a 15-minute live probe on a real Jira site, before writing any code:
1. PUT a sealed description holding the witness inputs, with `properties: [{key:'harbour.asAsked', …}]` in the same body. This confirms the edit endpoint accepts `properties`.
2. GET it with `?properties=harbour.asAsked`.
3. Edit a line *below* the block in Jira's own editor and save.
4. GET again and diff `adfToMarkdown(region)`.

If the rendering holds, the plan stands as written and items 1 and 2 above are a few lines and two tests. If it doesn't hold, the digest has to be taken over a normalised rendering. That is a design change, and the ticket says it should be recorded on LIN-4445.

