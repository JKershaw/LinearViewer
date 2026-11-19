# Waiting fixture

Copied from docs/areas/providers.md at bf2d1575f (LIN-4494): the ## Waiting section only, for the importer test on a shallow checkout.

## Waiting
- `lib/providers/jira/index.js`: the bulk reads (`fetchProjects`, and `fetchIssueContext`'s
  children through `searchAllIssues`) do not ask for `harbour.asAsked`. A sealed block
  therefore shows its converted rendering on the dashboard and in a parent's children, while
  single-issue reads serve the exact words. `POST /rest/api/3/search/jql` accepts
  `properties`, so asking for it there would make the bulk path exact too. No guard or cache
  compares the two today. (LIN-4450 leftovers; Survey global, LIN-4450.)
- `lib/providers/jira/index.js`: a Jira `parentId` is refused 400 (LIN-4451, review note 5,
  disposition (b)), so subtask filing is not advertised. Accepting the issue key as the parent
  (disposition (a)) needs an end-to-end filing test through the lanes. (LIN-4451 Survey open-0.)
- `lib/providers/interface.js`: a "holds verbatim text" provider capability would replace the
  Markdown comparison that decides whether a provider can hold a block. Today
  `providerHoldsAsAsked` in `lib/as-asked-seal.js` asks the provider's own round trip and
  compares renderings through `checkAsAsked`, which normalises escapes, so it cannot tell a
  verbatim provider from a converting one. Waiting since LIN-4445's plan (item 13) and the
  LIN-4452 Survey global; the provider contract is the first home, the seal module second.
- `lib/providers/jira/adf.js`: the D1 write gate's rich-content vocabulary (@-mentions, emoji,
  tables, and the other constructs `adfHasUnrenderableContent` names) is not widened. A later
  below-the-line write to a Jira description holding one is refused 422, and a Jira-native ticket
  holding one fails its first-dispatch seal, logged, with dispatch continuing. Waiting since
  LIN-4445's plan ("what stays open") and the LIN-4451 Survey; the Jira live check (LIN-4452)
  does not exercise it.
- `lib/providers/jira/index.js`: `_periodicalGateComments` imports `extractPeriodicalGateId` from
  `lib/periodicals.js`, LLM & prompts' Periodical engine (about 1,400 lines), to decide whether to walk every
  comment for the Periodical gate's evidence (LIN-4451). A provider now depends on the engine, and on what it
  imports, for one marker regex; it is one of Providers → LLM & prompts' two new edges (4 → 6). The marker's other
  readers are `lib/periodical-report-gate.js` and `routes/proxy-writes.js`. A marker leaf that all three import (as
  `lib/prompts/blind-read-words.js` is for the blind read), or the gate asking the provider for a comment tail
  without naming the feature, would remove the edge. The other side is LLM & prompts' `lib/periodicals.js`.
  (Seams & Tangles, 14 Nov.; `docs/reviews/seams-tangles-review-2026-11-14-run13.md`.)
- `lib/providers/jira/as-asked-region.js`: for a block edited in Jira, the reader takes the first end paragraph after the
  heading, matched as plain text whatever its marks. If the person's words hold a plain copy of the end sentence, the
  words are cut short there. The Lesson that calls the looser reader safe rests on `descriptionRoundTrip` refusing such a
  block at filing, which does not cover an edit made in Jira afterwards. Matching `splitAsAsked`'s end-line rule (marks
  included), or taking the last end paragraph, would close it. (Drift & Coherence Review, 14 Nov.;
  `docs/reviews/drift-coherence-review-2026-11-14.md`.)
