// Path predicates shared by scripts/delivery-composition.mjs and the LIN-4257
// size-and-cost analysis (docs/papers/harbour/task-size-and-cost-scripts/).
// Moved here unchanged from delivery-composition.mjs so that one rule is imported,
// not copied. Keep these byte-for-byte in step with the rule the weekly report uses.

export const isTest = (p) => /(^|\/)tests?\//i.test(p) || /\.(test|spec)\./i.test(p)
  || /(^|\/)(e2e|fixtures)\//i.test(p) || /playwright/i.test(p);
export const isDoc = (p) => /\.md$/i.test(p) || /(^|\/)docs\//i.test(p) || /claude\.md$/i.test(p);
