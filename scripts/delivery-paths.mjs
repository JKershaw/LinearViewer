// Path predicates shared by scripts/delivery-composition.mjs, the LIN-4257
// size-and-cost analysis (docs/papers/harbour/task-size-and-cost-scripts/), and the
// golden-line fields of coherence-census.mjs prs (LIN-4426).
// Moved here unchanged from delivery-composition.mjs so that one rule is imported,
// not copied. Keep these byte-for-byte in step with the rule the weekly report uses.

export const isTest = (p) => /(^|\/)tests?\//i.test(p) || /\.(test|spec)\./i.test(p)
  || /(^|\/)(e2e|fixtures)\//i.test(p) || /playwright/i.test(p);
export const isDoc = (p) => /\.md$/i.test(p) || /(^|\/)docs\//i.test(p) || /claude\.md$/i.test(p);
// Golden test data (LIN-4426): a test path whose name carries "golden" (fixtures, goldens, *-golden.test.js). A subset of
// isTest, so golden lines are reported beside the test lines, never instead of them.
export const isGolden = (p) => isTest(p) && /golden/i.test(p);
