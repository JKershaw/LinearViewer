/**
 * LIN-4177: the fixture corpus the cost replay runs every surface over.
 *
 * Deterministic: `buildCorpus()` returns the same rows every call. Times are relative to
 * `NOW_MS`, which the replay freezes as the clock, so the 30-day horizon is fixed.
 *
 * The corpus holds the raw dispatch docs the stores keep (`_id`, `Date` timestamps). The replay's
 * fake store (harness.js) serves them in the two shapes the real store serves: the formatted list
 * rows (`listHistory` and friends) and the raw scalar docs (`lineageIdentityRows`).
 *
 * One case per behaviour (the plan's list): founder outside the sibling cap (W1), founder outside
 * the 30-day horizon (W2), wake, cross-issue follow-up, opencode deltas, a mixed-harness lineage,
 * unreadable, unpriced Haiku, complete $0, an all-unpriced day, unpriced calls, an issue-less
 * lineage, lane tickets, a done-anchored opencode straddler, a no-usage straddler, and a corpus
 * larger than S5's 2000-row cap.
 */

export const NOW_MS = Date.parse('2026-11-03T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

/** A timestamp `days` before NOW_MS (fractions allowed). */
export function ago(days) {
  return new Date(NOW_MS - days * DAY);
}

/** A `kind: 'usage'` feedback entry carrying `payload` as its `[usage]` JSON. */
function usage(payload, at) {
  return { kind: 'usage', timestamp: at.toISOString(), message: `[usage] ${JSON.stringify(payload)}` };
}

/** A `kind: 'usage'` entry whose payload does not parse. */
function unreadableUsage(at) {
  return { kind: 'usage', timestamp: at.toISOString(), message: '[usage] {not json' };
}

const SONNET = 'anthropic/claude-sonnet-5';
const OPENCODE_MODEL = 'openrouter/qwen-3';

/**
 * Build the corpus. Returns `{ history, queue, calls, effective }`:
 *  - `history`: raw dispatch docs with `status` taken, abort, or other terminal states
 *  - `queue`: raw dispatch docs still queued
 *  - `calls`: LLM call-log docs (`{ urlKey, issueIdentifier, feature, model, cost, timestamp }`)
 *  - `effective`: the effective-model table rows S8 credits spend to (`{ id, model }`)
 */
export function buildCorpus() {
  const history = [];
  const queue = [];
  let seq = 0;

  // A raw dispatch doc. `root` is the lineage anchor (rootItemId); a founder's root is its own id.
  const row = ({ root, id, issue = null, kind = 'implementation', at, resolvedAt, status = 'taken', abort = false, feedback = [], harness }) => {
    seq += 1;
    const _id = id ?? `d${String(seq).padStart(5, '0')}`;
    return {
      _id,
      urlKey: 'acme',
      rootItemId: root ?? _id,
      issueIdentifier: issue,
      kind,
      promptName: kind,
      status,
      abort,
      target: 'cli',
      harness: harness ?? null,
      dispatchedAt: at,
      resolvedAt: resolvedAt ?? at,
      feedback,
    };
  };

  // 1. plain claude-code lineage: founder + a follow-up, cumulative totals, the last counts.
  history.push(row({ root: 'plain', id: 'plain', issue: 'LIN-1', at: ago(12), feedback: [usage({ model: SONNET, costUsd: 1.5 }, ago(12))] }));
  history.push(row({ root: 'plain', id: 'plain-2', issue: 'LIN-1', at: ago(11), feedback: [usage({ model: SONNET, costUsd: 2.0 }, ago(11))] }));

  // 2. wake: a wake row inherits the lineage's issue but never founds it; its running total counts.
  history.push(row({ root: 'wakeroot', id: 'wakeroot', issue: 'LIN-2', at: ago(9), feedback: [usage({ model: SONNET, costUsd: 1.0 }, ago(9))] }));
  history.push(row({ root: 'wakeroot', id: 'wakeroot-w', issue: 'LIN-2', kind: 'wake', at: ago(8), feedback: [usage({ model: SONNET, costUsd: 1.4 }, ago(8))] }));

  // 3. cross-issue follow-up: founder on LIN-3, follow-up on LIN-4, both in the window.
  history.push(row({ root: 'xi', id: 'xi', issue: 'LIN-3', at: ago(10), feedback: [usage({ model: SONNET, costUsd: 0.5 }, ago(10))] }));
  history.push(row({ root: 'xi', id: 'xi-2', issue: 'LIN-4', at: ago(1), feedback: [usage({ model: SONNET, costUsd: 0.9 }, ago(1))] }));

  // 4. horizon straddler (W2): founder older than 30 days on LIN-42; in-window follow-up on LIN-99
  //    of kind `review`. The true base kind is `implementation`.
  history.push(row({ root: 'st', id: 'st', issue: 'LIN-42', at: ago(40), feedback: [usage({ model: SONNET, costUsd: 3.0 }, ago(40))] }));
  history.push(row({ root: 'st', id: 'st-2', issue: 'LIN-99', kind: 'review', at: ago(2), feedback: [usage({ model: SONNET, costUsd: 4.0 }, ago(2))] }));

  // 5. mixed-harness lineage: claude-code running total, an opencode delta, a later running total.
  history.push(row({ root: 'mx', id: 'mx', issue: 'LIN-6', at: ago(5), feedback: [usage({ model: SONNET, costUsd: 1.0 }, ago(5))] }));
  history.push(row({ root: 'mx', id: 'mx-2', issue: 'LIN-6', at: ago(4), feedback: [usage({ harness: 'opencode', model: OPENCODE_MODEL, costUsd: 0.25 }, ago(4))] }));
  history.push(row({ root: 'mx', id: 'mx-3', issue: 'LIN-6', at: ago(3), feedback: [usage({ model: SONNET, costUsd: 1.6 }, ago(3))] }));

  // 6. opencode-only lineage: two per-run deltas, both count.
  history.push(row({ root: 'od', id: 'od', issue: 'LIN-7', at: ago(2), feedback: [usage({ harness: 'opencode', model: OPENCODE_MODEL, costUsd: 0.1 }, ago(2))] }));
  history.push(row({ root: 'od', id: 'od-2', issue: 'LIN-7', at: ago(1), feedback: [usage({ harness: 'opencode', model: OPENCODE_MODEL, costUsd: 0.2 }, ago(1))] }));

  // 7. done, anchored opencode straddler: the founder (opencode delta) is older than the window; the
  //    in-window member is another opencode delta. Its missing founder can change the figure.
  history.push(row({ root: 'so', id: 'so', issue: 'LIN-8', at: ago(38), feedback: [usage({ harness: 'opencode', model: OPENCODE_MODEL, costUsd: 0.7 }, ago(38))] }));
  history.push(row({ root: 'so', id: 'so-2', issue: 'LIN-8', at: ago(3), feedback: [usage({ harness: 'opencode', model: OPENCODE_MODEL, costUsd: 0.4 }, ago(3))] }));

  // 8. unreadable: the last usage entry does not parse.
  history.push(row({ root: 'ur', id: 'ur', issue: 'LIN-9', at: ago(4), feedback: [unreadableUsage(ago(4))] }));

  // 9. unpriced Haiku: a cumulative Haiku session past its 100k long-context threshold prices to null.
  history.push(row({ root: 'hk', id: 'hk', issue: 'LIN-10', at: ago(4), feedback: [usage({ model: 'anthropic/claude-haiku-5-5', inputTokens: 250000, outputTokens: 1000 }, ago(4))] }));

  // 10. complete $0: a priced run whose cost is exactly zero.
  history.push(row({ root: 'zr', id: 'zr', issue: 'LIN-11', at: ago(3), feedback: [usage({ model: SONNET, costUsd: 0 }, ago(3))] }));

  // 11. an all-unpriced day: an unknown model with no cost on LIN-12.
  history.push(row({ root: 'au', id: 'au', issue: 'LIN-12', at: ago(6), feedback: [usage({ model: '<synthetic>' }, ago(6))] }));

  // 12. issue-less lineage: a ran row with no issue identifier counts under no issue.
  history.push(row({ root: 'ni', id: 'ni', issue: null, at: ago(7), feedback: [usage({ model: SONNET, costUsd: 0.3 }, ago(7))] }));

  // 13. no usage posted at all (no-telemetry).
  history.push(row({ root: 'nu', id: 'nu', issue: 'LIN-13', at: ago(2), feedback: [] }));

  // 14. lane ticket: a wake on LIN-15 inside LIN-14's lineage; the founder's issue wins.
  history.push(row({ root: 'ln', id: 'ln', issue: 'LIN-14', at: ago(5), feedback: [usage({ model: SONNET, costUsd: 0.6 }, ago(5))] }));
  history.push(row({ root: 'ln', id: 'ln-w', issue: 'LIN-15', kind: 'wake', at: ago(4), feedback: [usage({ model: SONNET, costUsd: 0.8 }, ago(4))] }));

  // 15. unpriced model with a cost key absent, on LIN-16.
  history.push(row({ root: 'um', id: 'um', issue: 'LIN-16', at: ago(2), feedback: [usage({ model: '<synthetic>', inputTokens: 10 }, ago(2))] }));

  // 16. no-usage straddler: older founder with no usage, in-window follow-up with no usage either.
  history.push(row({ root: 'nss', id: 'nss', issue: 'LIN-17', at: ago(45), feedback: [] }));
  history.push(row({ root: 'nss', id: 'nss-2', issue: 'LIN-17', at: ago(1), feedback: [] }));

  // 17. claude-code guard (W3): older members outside the window, the counted running total in it.
  history.push(row({ root: 'cg', id: 'cg', issue: 'LIN-18', at: ago(50), feedback: [usage({ model: SONNET, costUsd: 1.0 }, ago(50))] }));
  history.push(row({ root: 'cg', id: 'cg-2', issue: 'LIN-18', at: ago(3), feedback: [usage({ model: SONNET, costUsd: 1.2 }, ago(3))] }));

  // 18. a queued row (never ran; it is an own row for its issue but counts for nothing).
  queue.push(row({ root: 'qq', id: 'qq', issue: 'LIN-1', status: 'queued', at: ago(0.5) }));

  // 19. W1 cap (LIN-4148): lineage P, founder LIN-42, follow-up LIN-99, follow-up LIN-42. The LIN-99
  //     filler below pushes P's founder out of the sibling cap when the LIN-99 read asks for its
  //     lineages: the founder has the oldest resolved row among them.
  history.push(row({ root: 'P', id: 'P', issue: 'LIN-42', at: ago(29.99), resolvedAt: ago(29.99), feedback: [usage({ model: SONNET, costUsd: 5.0 }, ago(29.99))] }));
  history.push(row({ root: 'P', id: 'P-99', issue: 'LIN-99', at: ago(0.2), resolvedAt: ago(0.05), feedback: [usage({ model: SONNET, costUsd: 6.0 }, ago(0.2))] }));
  history.push(row({ root: 'P', id: 'P-42', issue: 'LIN-42', at: ago(0.1), resolvedAt: ago(0.04), feedback: [usage({ model: SONNET, costUsd: 7.0 }, ago(0.1))] }));

  // 20. the filler: 2001 single-row lineages on LIN-99, resolved 29.9 to 29.0 days ago, so they are
  //     older than every hand-built case (the S5 cap keeps the newest 2000 rows and must keep the cases)
  //     and newer than P's founder only by a little. A LIN-99 read has 2002 anchors, over the sibling
  //     cap, and drops the four oldest rows: P's founder and three fillers.
  for (let i = 0; i < 2001; i += 1) {
    const at = ago(29.9 - (i * 0.9) / 2001);
    history.push(row({ root: `f99-${i}`, id: `f99-${i}`, issue: 'LIN-99', at, feedback: [usage({ model: SONNET, costUsd: 0.01 }, at)] }));
  }

  // 21. filler on LIN-42 (2001 lineages), resolved 28.9 to 15 days ago: the same over-cap read for a
  //     LIN-42 query, and the corpus is over S5's 2000-row cap (4000+ rows) while every case stays in it.
  for (let i = 0; i < 2001; i += 1) {
    const at = ago(28.9 - (i * 13.9) / 2001);
    history.push(row({ root: `f42-${i}`, id: `f42-${i}`, issue: 'LIN-42', at, feedback: [usage({ model: SONNET, costUsd: 0.02 }, at)] }));
  }

  // Calls (the call log: `{ urlKey, issueIdentifier, feature, model, cost, timestamp }`).
  const calls = [
    { _id: 'c1', urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'proxy-x', model: SONNET, cost: 0.2, timestamp: ago(2) },
    { _id: 'c2', urlKey: 'acme', issueIdentifier: 'LIN-12', feature: 'review', model: '<synthetic>', cost: null, timestamp: ago(6) },
    { _id: 'c3', urlKey: 'acme', issueIdentifier: 'LIN-11', feature: 'review', model: SONNET, cost: 0, timestamp: ago(1) },
    { _id: 'c4', urlKey: null, issueIdentifier: null, feature: 'review', model: SONNET, cost: 1.1, timestamp: ago(1) },
    { _id: 'c5', urlKey: 'acme', issueIdentifier: 'LIN-42', feature: 'proxy-x', model: SONNET, cost: 0.9, timestamp: ago(60) },
    { _id: 'c6', urlKey: 'acme', issueIdentifier: 'LIN-2', feature: 'proxy-x', model: SONNET, cost: 0.05, timestamp: ago(4) },
  ];

  // The effective-model table S8 credits priced spend to (one row per job id).
  const effective = [
    { id: 'implementation', model: SONNET },
    { id: 'review', model: 'anthropic/claude-opus-5' },
    { id: 'wake', model: null },
    { id: 'proxy-x', model: SONNET },
  ];

  return { history, queue, calls, effective };
}

/** The issue identifiers the replay asks each issue-scoped surface about. */
export const REPLAY_ISSUES = ['LIN-1', 'LIN-2', 'LIN-3', 'LIN-4', 'LIN-6', 'LIN-7', 'LIN-8', 'LIN-9', 'LIN-10', 'LIN-11', 'LIN-12', 'LIN-13', 'LIN-14', 'LIN-15', 'LIN-16', 'LIN-17', 'LIN-18', 'LIN-42', 'LIN-99'];

/** The job kinds the replay groups spend by (S5, S6, S8, S9). */
export const REPLAY_JOBS = ['implementation', 'review', 'wake', 'custom', 'proxy-x'];
