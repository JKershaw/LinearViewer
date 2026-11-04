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
    // A ran row ends with a terminal marker (`[done]`), so the effort population (S10) settles it.
    const end = resolvedAt ?? at;
    const terminal = status === 'taken' && !abort ? [{ kind: 'terminal', timestamp: end.toISOString(), message: '[done] fixture' }] : [];
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
      resolvedAt: end,
      feedback: [...feedback, ...terminal],
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
    // Observation's scan estimate (S4): two priced scans and one unpriced in the horizon (mean of the priced
    // is 0.04 over 2), and one scan outside it.
    { _id: 'c7', urlKey: 'acme', issueIdentifier: null, feature: 'scan', model: SONNET, cost: 0.03, timestamp: ago(1) },
    { _id: 'c8', urlKey: 'acme', issueIdentifier: null, feature: 'scan', model: SONNET, cost: 0.05, timestamp: ago(5) },
    { _id: 'c9', urlKey: 'acme', issueIdentifier: null, feature: 'scan', model: SONNET, cost: null, timestamp: ago(6) },
    { _id: 'c10', urlKey: 'acme', issueIdentifier: null, feature: 'scan', model: SONNET, cost: 0.9, timestamp: ago(45) },
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

/**
 * LIN-4197 (beat 3): the transcript corpus of the runner's piece-0 fixtures, in this replay's two shapes.
 *
 * COPY, not a link. The data below is copied from simple-dispatcher's
 * test/fixtures/transcript-corpus/request-records.json (`records`, and `oracle.costUsd` as `oracleUsd`) and from
 * its walkusage-goldens.json (`snapshot`: the production walkUsage fold of the stage's main transcript, in the
 * claude-code snapshot payload shape hook.js postUsageSnapshot sends today; `lane` is this host's value), at
 * simple-dispatcher commit LIN4197_SOURCE_COMMIT (PR #312, head 7a2d83c).
 * Oracle: each record priced alone with computeUsageCostUsd (the LIN-4126 measure.mjs method, LinearViewer 72305215);
 * a shared message id is one request. tests/unit/cost-lin4197-corpus.test.js re-prices every record and checks the sum.
 *
 * Kept OUT of buildCorpus(): the replay goldens (tests/fixtures/cost-replay/goldens.json) are recorded over
 * buildCorpus(), so adding these rows there would move every existing golden.
 */
export const LIN4197_SOURCE_COMMIT = '7a2d83c00485add17e0e15e00be8d3e609a537e6';

export const LIN4197_CASES = {
  'haiku-over-100k/final': {
    snapshot: { schema: 1, harness: 'claude-code', model: 'claude-haiku-5-5', effort: 'low', inputTokens: 44200, outputTokens: 2900, cacheCreationInputTokens: 7000, cacheCreation1hInputTokens: 1000, cacheReadInputTokens: 260000, costUsd: null, lane: 'subscription' },
    records: [
      { requestId: 'msg_hk_1', agent: 'main', model: 'claude-haiku-5-5', effort: 'low', at: '2026-11-02T09:01:00.000Z', inputTokens: 40000, outputTokens: 800, cacheCreationInputTokens: 5000, cacheCreation1hInputTokens: 1000, cacheReadInputTokens: 30000 },
      { requestId: 'msg_hk_2', agent: 'main', model: 'claude-haiku-5-5', effort: 'low', at: '2026-11-02T09:03:00.000Z', inputTokens: 3000, outputTokens: 1500, cacheCreationInputTokens: 2000, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 120000 },
      { requestId: 'msg_hk_3', agent: 'main', model: 'claude-haiku-5-5', effort: 'low', at: '2026-11-02T09:05:00.000Z', inputTokens: 1200, outputTokens: 600, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 110000 },
    ],
    oracleUsd: 0.0255,
  },
  'killed-before-stop/final': {
    snapshot: { schema: 1, harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high', inputTokens: 7500, outputTokens: 660, cacheCreationInputTokens: 3000, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 45000, costUsd: null, lane: 'subscription' },
    records: [
      { requestId: 'msg_kl_1', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:01:00.000Z', inputTokens: 5000, outputTokens: 400, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 20000 },
      { requestId: 'msg_kl_2', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:03:00.000Z', inputTokens: 2500, outputTokens: 260, cacheCreationInputTokens: 3000, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 25000 },
    ],
    oracleUsd: 0.0381,
  },
  'mixed-model/final': {
    snapshot: { schema: 1, harness: 'claude-code', model: 'claude-haiku-5-5', effort: 'low', inputTokens: 31500, outputTokens: 4200, cacheCreationInputTokens: 4000, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 241000, costUsd: null, lane: 'subscription' },
    records: [
      { requestId: 'msg_mx_1', agent: 'main', model: 'claude-opus-5', effort: 'max', at: '2026-11-02T09:01:00.000Z', inputTokens: 20000, outputTokens: 2000, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 50000 },
      { requestId: 'msg_mx_2', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:03:00.000Z', inputTokens: 9000, outputTokens: 1200, cacheCreationInputTokens: 4000, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 60000 },
      { requestId: 'msg_mx_3', agent: 'main', model: 'claude-opus-5', effort: 'max', at: '2026-11-02T09:05:00.000Z', inputTokens: 500, outputTokens: 900, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 130000 },
      { requestId: 'msg_mx_4', agent: 'main', model: 'claude-haiku-5-5', effort: 'low', at: '2026-11-02T09:07:00.000Z', inputTokens: 2000, outputTokens: 100, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 1000 },
    ],
    oracleUsd: 0.31726,
  },
  'reap-tail/atReap': {
    snapshot: { schema: 1, harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high', inputTokens: 7700, outputTokens: 850, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 39000, costUsd: null, lane: 'subscription' },
    records: [
      { requestId: 'msg_rt_1', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:01:00.000Z', inputTokens: 4000, outputTokens: 500, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 10000 },
      { requestId: 'msg_rt_2', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:03:00.000Z', inputTokens: 1800, outputTokens: 220, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 14000 },
      { requestId: 'msg_rt_3', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:05:00.000Z', inputTokens: 1900, outputTokens: 130, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 15000 },
    ],
    oracleUsd: 0.0317,
  },
  'reap-tail/atStop': {
    snapshot: { schema: 1, harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high', inputTokens: 5800, outputTokens: 720, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 24000, costUsd: null, lane: 'subscription' },
    records: [
      { requestId: 'msg_rt_1', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:01:00.000Z', inputTokens: 4000, outputTokens: 500, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 10000 },
      { requestId: 'msg_rt_2', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:03:00.000Z', inputTokens: 1800, outputTokens: 220, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 14000 },
    ],
    oracleUsd: 0.0236,
  },
  'resumed-across-deploy/earlier': {
    snapshot: { schema: 1, harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high', inputTokens: 5200, outputTokens: 590, cacheCreationInputTokens: 1500, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 14000, costUsd: null, lane: 'subscription' },
    records: [
      { requestId: 'msg_rd_1', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:01:00.000Z', inputTokens: 3000, outputTokens: 350, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 6000 },
      { requestId: 'msg_rd_2', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:03:00.000Z', inputTokens: 2200, outputTokens: 240, cacheCreationInputTokens: 1500, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 8000 },
    ],
    oracleUsd: 0.02285,
  },
  'resumed-across-deploy/later': {
    snapshot: { schema: 1, harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high', inputTokens: 7300, outputTokens: 1210, cacheCreationInputTokens: 1500, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 45000, costUsd: null, lane: 'subscription' },
    records: [
      { requestId: 'msg_rd_1', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:01:00.000Z', inputTokens: 3000, outputTokens: 350, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 6000 },
      { requestId: 'msg_rd_2', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:03:00.000Z', inputTokens: 2200, outputTokens: 240, cacheCreationInputTokens: 1500, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 8000 },
      { requestId: 'msg_rd_3', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:11:00.000Z', inputTokens: 1200, outputTokens: 420, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 15000 },
      { requestId: 'msg_rd_4', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:13:00.000Z', inputTokens: 900, outputTokens: 200, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 16000 },
    ],
    oracleUsd: 0.03945,
  },
  'subagent-shared-message/final': {
    snapshot: { schema: 1, harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high', inputTokens: 20000, outputTokens: 660, cacheCreationInputTokens: 1500, cacheCreation1hInputTokens: 500, cacheReadInputTokens: 26000, costUsd: null, lane: 'subscription' },
    records: [
      { requestId: 'msg_sm_1', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:01:00.000Z', inputTokens: 12000, outputTokens: 400, cacheCreationInputTokens: 1500, cacheCreation1hInputTokens: 500, cacheReadInputTokens: 8000 },
      { requestId: 'msg_sm_shared', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:03:00.000Z', inputTokens: 6000, outputTokens: 120, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 9000 },
      { requestId: 'msg_sm_2', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:05:00.000Z', inputTokens: 2000, outputTokens: 210, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 9000 },
      { requestId: 'msg_sm_s1', agent: 'agent-a1b2c3d4', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:03:00.000Z', inputTokens: 4000, outputTokens: 700, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 2000 },
      { requestId: 'msg_sm_s2', agent: 'agent-a1b2c3d4', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:04:00.000Z', inputTokens: 1000, outputTokens: 80, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 0 },
    ],
    oracleUsd: 0.0752,
  },
  'synthetic-tail/final': {
    snapshot: { schema: 1, harness: 'claude-code', model: '<synthetic>', effort: 'high', inputTokens: 4500, outputTokens: 550, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 31000, costUsd: null, lane: 'subscription' },
    records: [
      { requestId: 'msg_sy_1', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:01:00.000Z', inputTokens: 3000, outputTokens: 300, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 15000 },
      { requestId: 'msg_sy_2', agent: 'main', model: 'claude-sonnet-5', effort: 'high', at: '2026-11-02T09:05:00.000Z', inputTokens: 1500, outputTokens: 250, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 16000 },
    ],
    oracleUsd: 0.0207,
  },
};

/**
 * The seven LIN-4197 cases as dispatch docs: one taken row per stage, carrying its `[usage]` snapshot (the
 * shape the runner posts today) and a terminal marker. `records` maps each row id to that stage's per-request
 * records, so both shapes are available by one key.
 */
export function buildLin4197Corpus() {
  const rows = [];
  const records = {};
  Object.keys(LIN4197_CASES).forEach((key, i) => {
    const id = `l4197:${key}`;
    const at = new Date(NOW_MS - (i + 1) * 60 * 1000);
    rows.push({
      _id: id,
      urlKey: 'acme',
      rootItemId: id,
      issueIdentifier: null,
      kind: 'implementation',
      promptName: 'implementation',
      status: 'taken',
      abort: false,
      target: 'cli',
      harness: 'claude-code',
      dispatchedAt: at,
      resolvedAt: at,
      feedback: [
        { kind: 'usage', timestamp: at.toISOString(), message: `[usage] ${JSON.stringify(LIN4197_CASES[key].snapshot)}` },
        { kind: 'terminal', timestamp: at.toISOString(), message: '[done] fixture' },
      ],
    });
    records[id] = LIN4197_CASES[key].records;
  });
  return { rows, records };
}
