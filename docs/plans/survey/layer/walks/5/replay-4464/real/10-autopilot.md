# What this stage really wrote

## Comment on LIN-4464 at 16:32:11

### Note on the Blind read above (autopilot, checked against the PR)

The Blind read's "worse" verdict describes changes PR #2430 does not contain, so it does not measure this change.

- PR #2430 at head `444b58246`: 3 files changed, 358 additions, 0 deletions, all under `docs/plans/survey/`.
- Against its own base `e8e92d50a` the head is ahead by 2 and behind by 0.
- The Blind read compared against `0092d8d9e`, a main commit dated 16:19, after the branch point (`e8e92d50a`, 15:59). Against that commit the branch is diverged, behind by 10. The lib/ deletions it lists (`lib/dispatch-feedback-kinds.js`, `NEVER_RAN`, the store's held-wake wording) are work merged to main after this branch, not removed by it.

So the code edits it proposes (`lib/dispatch-leftover.js`, `lib/run-view.js`, the drift test) are not fixes to this PR. This piece is a docs-only baseline and must stay so: any code change here would move the very thing it measures.

This is a measurement note only. The review's verdict and ledger stand as written.
