# What this stage really wrote

## Comment on LIN-4450 at 13:51:36

## Survey global: LIN-4450 @ 4b5001ddf

(= the grounding commit.)

**Where it lands.** `lib/providers/jira/index.js` is 1,478 lines, mostly history comments. `adf.js` is the codec: rebuilt clean-room, quiet since LIN-3570. `lib/as-asked*.js` was just tidied toward one owner (LIN-4360/61/62). The area is getting better. I probed the witness shapes (`* a`, `*em*`, `***x***`, `3.` lists, a fence with a blank line, `a\n\n\n\nb`, trailing spaces). `markdownToAdf`'s output never trips D1, and `adfToMarkdown∘markdownToAdf` reaches a fixed point on all of them. So D1 won't block Harbour-written blocks.

**What the obvious way does**
- **Two stores of the words.** Shape B accepts this: the ADF region plus the property, with a digest deciding between them. It stays safe only while the region module is the one place that knows about both.
- **A second ADF walker.** The reader needs a paragraph's plain text. `adf.js` already has `plainText` (~340), but it is private. Export it rather than retype it. Render the region with `adfToMarkdown({type:'doc',content})`, not a new renderer.
- **The reader accepts more than the writer refuses.** "Whatever its marks" means a plain paragraph of the end sentence in the words ends the region early, and `hasMarkerLine` doesn't refuse that. This is safe only if `descriptionRoundTrip` runs through *the same reader*: then the filing reads non-kept and goes in unsealed. Worth one witness.
- **Scatter.** There are 8 `getIssue` sites. Four never read a description: 703, 1018, 1076, and the pre-read at 1099. `fetchIssueFields` (818) feeds `_toCanonicalIssue` but isn't in the plan's list. Write one read-with-words helper beside the reader, not `properties` threaded through each call.
- **What has to learn, beyond the three headers named:**
  - `dispatch-factory.js:1008`
  - `docs/proxy-integration.md:2070`: agent-facing, says Jira files unsealed
  - `docs/architecture/source-map.md:216` and `:82` (the new module needs a mention)
  - `as-asked-guard.test.js`, whose Jira block (345, 351) will fail, so it notices. The docs won't.
- **A branch left without a witness.** `as-asked-create-seal.test.js:207-227` uses Jira's round trip as *the* provider that cannot hold the block. After the flip, `sealForFiling`'s `reason: 'provider'` branch has no subject in production or in tests. Witness it with a synthetic lossy round trip, or retire it on purpose. `as-asked.js`'s "When the unsealed branches could go" drops "Jira today", but stays permanent because of older tickets.

**Better, at a cost this task can carry:** export `plainText`, add one read helper, put the size function in the region module, retire every claim listed above, and keep the provider branch witnessed.

**Better still, not this task's**
- **Live Jira-native tickets.** The first-dispatch seal writes back through `updateIssue`. D1 refuses any ticket that holds a mention, emoji or panel (common), and logs it once per first dispatch. Tickets that pass get their ADF normalised, and their "words" become the escaped rendering. That is the codec's lossiness showing, which is deeper than this task.
- **The bulk search path** could ask for `properties` (`search/jql` accepts it), so the dashboard would show exact words.
- **Comment weight.** `index.js`'s header and source-map's jira paragraph carry more history than guidance.

