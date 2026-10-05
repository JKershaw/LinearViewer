/**
 * Shared fixtures for the guest run tests (LIN-3312, Phase 2 of LIN-2950):
 * `guest-run.test.js`, `render-session-guest.test.js`, `render-share.test.js`
 * and `share-run-scan.test.js`.
 *
 * `liveSession()` is a non-lean session shaped like `loadRunLocal().session`
 * with EVERY field the guest must never store or render planted on it, each
 * carrying a distinctive sentinel value, so a test can prove absence by value
 * as well as by key. `evidenceModel()` is a real `buildRunEvidence` model
 * built from a real-shaped review comment, not a hand-written model.
 */

import { buildRunEvidence } from '../../lib/run-evidence.js';

export const URL_KEY = 'acme';
export const SESSION_ID = 'sess-g1';
export const T0 = '2026-07-04T10:00:00.000Z';
export const CAPTURED_AT = '2026-07-04T11:00:00.000Z';
export const FETCHED_AT_MS = Date.parse('2026-07-04T10:30:00.000Z');

/** The keys the guest must never store or render (LIN-2950 S3). */
export const FORBIDDEN_KEYS = [
  'feedback', 'usage', 'metrics', 'producedArtifacts', 'resources', 'parkedWait',
  'wakeMarker', 'agentTokenId', 'agentTokenLabel', 'outcomeLine', 'target',
  'issueId', 'proposals', 'urlKey',
];

/** Sentinel values planted in the forbidden fields; none may survive. */
export const SENTINELS = {
  feedback: 'SENTINEL-FEEDBACK-TEXT',
  usage: 'SENTINEL-USAGE-HARNESS',
  metric: 'SENTINEL-METRIC',
  artifact: 'https://sentinel.example/artifact',
  resources: 'SENTINEL-RESOURCES-HOST',
  parkedWait: 'SENTINEL-PARKED-SINCE',
  wakeMarker: 'SENTINEL-WAKE',
  agentTokenId: 'SENTINEL-TOKEN-ID',
  agentTokenLabel: 'SENTINEL-TOKEN-LABEL',
  outcomeLine: 'SENTINEL-OUTCOME-PROSE',
  target: 'SENTINEL-TARGET',
  issueId: 'SENTINEL-ISSUE-UUID',
  proposal: 'SENTINEL-PROPOSAL-PROMPT',
  sessionTelemetry: 'SENTINEL-SESSION-TELEMETRY',
  closeOutMessage: 'SENTINEL-CLOSEOUT-MESSAGE',
};

const at = minutes => new Date(Date.parse(T0) + minutes * 60 * 1000).toISOString();

/** One loop with every forbidden per-loop field planted. */
export function plantedLoop(fields = {}) {
  return {
    loopId: 'loop',
    issueIdentifier: 'LIN-900',
    issueTitle: 'Seed task',
    iteration: 1,
    kind: 'implementation',
    dispatchedAt: at(0),
    agentState: 'complete',
    terminalStatus: 'done',
    terminalCompletedAt: at(2),
    resolvedAt: at(2),
    target: SENTINELS.target,
    issueId: SENTINELS.issueId,
    agentTokenId: SENTINELS.agentTokenId,
    agentTokenLabel: SENTINELS.agentTokenLabel,
    wakeMarker: SENTINELS.wakeMarker,
    feedback: [
      { message: `[blocked] ${SENTINELS.feedback}`, url: null, urlLabel: null, timestamp: at(1) },
      { message: `[done] ${SENTINELS.feedback}`, url: null, urlLabel: null, timestamp: at(2) },
    ],
    telemetry: {
      runtime: { ms: 120000, sentinel: SENTINELS.metric },
      model: 'claude-opus-4-8',
      metrics: [{ toolCount: 3, note: SENTINELS.metric }],
      producedArtifacts: [{ url: SENTINELS.artifact }],
      resources: { peakRssBytes: 512 * 1024 * 1024, host: SENTINELS.resources },
      usage: { costUsd: 1.25, harness: 'claude-code', note: SENTINELS.usage },
      parkedWait: { since: SENTINELS.parkedWait },
      ticketWalk: [{ identifier: 'LIN-901', state: 'done', outcomeLine: SENTINELS.outcomeLine }],
    },
    ...fields,
  };
}

/**
 * An anchored, settled session: the autopilot anchor, a worker and its
 * follow-up (a two-run lineage, so `renderLineageGroup` renders a container).
 */
export function liveSession(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    seedIssue: 'LIN-900',
    tasksTouched: ['LIN-900', 'LIN-901'],
    dispatchedAt: at(0),
    completedAt: at(9),
    urlKey: URL_KEY,
    proposals: [{ id: 'p1', prompt: SENTINELS.proposal }],
    telemetry: { note: SENTINELS.sessionTelemetry },
    loops: [
      plantedLoop({ loopId: SESSION_ID, kind: 'autopilot', issueTitle: 'Ship the share link', terminalCompletedAt: at(9), resolvedAt: at(9) }),
      plantedLoop({ loopId: 'w1', sessionId: SESSION_ID, iteration: 2, dispatchedAt: at(1), terminalCompletedAt: at(4), resolvedAt: at(4) }),
      plantedLoop({ loopId: 'w2', sessionId: SESSION_ID, lineageId: 'w1', followUpTo: 'w1', iteration: 3, dispatchedAt: at(5), terminalCompletedAt: at(8), resolvedAt: at(8) }),
    ],
    ...overrides,
  };
}

/** A review comment whose ledger has an open inside item (no follow-up), an open outside item and a discharged one. */
export function reviewBody({ claim = 'the share route is exempt from auth', followUp = 'https://github.com/o/r/issues/7' } = {}) {
  return `## Review summary

### What CI Did Not Prove
| # | Claim | Scope | Discharge |
|---|---|---|---|
| L1 | ${claim} | inside | run the e2e against a signed-out context |
| L2 | the scan covers ledger prose | outside | follow-up ${followUp} |
| L3 | the golden is unchanged | inside | discharged by the golden test |

**Verdict: Approve**`;
}

/**
 * A real `buildRunEvidence` model. `pr`: 'one' | 'none' | 'multiple'.
 * `prStatus`: the reader result for the one PR (null = unread).
 */
export function evidenceModel({
  pr = 'one',
  prStatus = { readable: true, state: 'closed', merged: true, number: 12, head: { sha: 'abc1234' }, checks: [{ status: 'completed', conclusion: 'success' }] },
  body = reviewBody(),
  asked = null,
  done = null,
  urlKey = URL_KEY,
} = {}) {
  const comments = [{ id: 'c-review', body, createdAt: at(8) }];
  if (pr === 'one' || pr === 'multiple') comments.push({ id: 'c-pr1', body: 'PR https://github.com/o/r/pull/12', createdAt: at(3) });
  if (pr === 'multiple') comments.push({ id: 'c-pr2', body: 'PR https://github.com/o/r/pull/13', createdAt: at(4) });
  return buildRunEvidence({
    issueIdentifier: 'LIN-900',
    comments,
    allowlist: new Set(['o/r']),
    prStatus: pr === 'one' ? prStatus : null,
    asked,
    done,
    owner: true,
    urlKey,
    stopAt: 'pr',
    variant: 'standard',
    runnerReady: true,
  });
}

/** The shared store's `readResult` for the one PR. */
export function prRead({ result = { readable: true, state: 'closed', merged: true, number: 12, checks: [] }, fetchedAt = FETCHED_AT_MS, via = 'fresh' } = {}) {
  return { result, fetchedAt, via };
}
