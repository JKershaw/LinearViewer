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
  A claim about live behaviour needs a live check. (LIN-4450; the live check is LIN-4452.)

## Waiting

- `lib/providers/jira/index.js`: the bulk reads (`fetchProjects`, and `fetchIssueContext`'s
  children through `searchAllIssues`) do not ask for `harbour.asAsked`. A sealed block
  therefore shows its converted rendering on the dashboard and in a parent's children, while
  single-issue reads serve the exact words. `POST /rest/api/3/search/jql` accepts
  `properties`, so asking for it there would make the bulk path exact too. No guard or cache
  compares the two today. (LIN-4450 leftovers; Survey global, LIN-4450.)
