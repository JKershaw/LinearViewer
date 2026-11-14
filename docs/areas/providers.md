## Lessons

- A Jira description has one reader and one writer: `readDescription` and `holdAsAsked` in
  `lib/providers/jira/as-asked-region.js`. They are the only code that knows the ADF region
  and the `harbour.asAsked` entity property, and every provider-side `getIssue` passes
  `AS_ASKED_READ`. Shape B keeps the words in two places, the region and the property, and
  that is safe only while one module knows both. A new description read that calls
  `adfToMarkdown` directly serves converted words and breaks the seal without anyone being
  told. `tests/unit/jira-as-asked-region.test.js` fails on it. (LIN-4450.)
- Decide whether the words are kept by comparing renderings, never ADF. Jira stamps
  `localId` and similar attributes on ordinary saves, and `adfToMarkdown` ignores them.
  A hash of the ADF would read every human save as an edit. (LIN-4450.)
- The region reader accepts an end line whatever its marks, which is looser than
  `splitAsAsked`. It stays safe because `descriptionRoundTrip` runs the same reader the
  reads do, so a block the reader would misplace is refused at filing. Keep the seal's check
  and the reads on one reader. (LIN-4450, Survey open-0.)
- The Jira fake proves only the provider's own logic. It stores whatever it is handed and
  never normalises ADF, so it cannot show whether live Jira keeps a region's rendering.
  A claim about live behaviour needs a live check. (LIN-4450.) The live check is LIN-4452.
  It is not yet run: the build session has no access to John's Jira, so it is a handoff
  (the commands and evidence list are in the LIN-4445 comment), and no live outcome is
  recorded here.
- A Jira create chooses the epic field from its own project's create screen, never from the
  tenant's field list. `parent` if the screen lists it, else Epic Link if it does; a screen with
  neither is refused 422 before the create. A field that exists on the tenant can still be absent
  from this screen, and writing it there is a 400 after the issue is half-filed. (LIN-4451,
  `lib/providers/jira/index.js` `_epicCreateField`.)
- The create metadata is read fresh on every create, with no cache. It is filtered by the
  caller's own permissions, and a cache keyed on the site cannot tell two callers apart. Creates
  are infrequent, so the round trips cost little. (LIN-4451, `createIssue` in the same file.)
- A create that fails after the issue exists is a PartialWriteError telling the caller not to
  retry. A retry would file a duplicate. The re-read and the property check (below) are the two
  places this applies. Every create lane (proxy, session, feedback) maps it through
  `lib/partial-write-error.js` `partialWriteEnvelope`: `retryable:false`, answered 500. A lane
  that does not map it answers a bare 500 that hides the landed issue. (LIN-4451, LIN-4452.)
- A write's success status does not prove Jira kept the `harbour.asAsked` property: a site can
  answer 200 and drop it, and the words would then be served as converted text, marked kept.
  `createIssue` and `updateIssue` therefore compare the property on the confirmation re-read with
  the one they sent, and a difference is a PartialWriteError naming `property`. The fake's
  `dropProperties` seed is the witness; without it the fake keeps every property. (LIN-4452.)

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
