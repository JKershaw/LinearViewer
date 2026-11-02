/**
 * "What is this row's usage?" (LIN-4134), the one answer every cost reader takes. The
 * usage is the row's LAST `kind: 'usage'` entry; if it does not parse, the row has none.
 * That entry is a running total (a cumulative snapshot a later row replaces) unless its
 * REPORTED harness is `opencode`, a per-run delta that sums. Unknown or absent counts as a
 * running total. The requested `harness` is never read: a null request falls back to the
 * workspace default, and a resume keeps its original harness. Leaf module: no imports.
 */

export function lastUsageEntry(feedback) {
  if (!Array.isArray(feedback)) return null;
  let last = null;
  for (const entry of feedback) if (entry?.kind === 'usage') last = entry;
  return last;
}

/** Whether a parsed usage is a running total. A null usage (none, or unparseable) is one too. */
export function isRunningTotal(usage) {
  return usage?.harness !== 'opencode';
}
