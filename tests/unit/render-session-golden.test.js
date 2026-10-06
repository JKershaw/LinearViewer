/**
 * LIN-3311 — owner golden pin for the run page.
 *
 * Byte-parity characterisation of `renderSessionPage` over the existing
 * render-session fixtures (plus every close-out-box state and the PR-line
 * branches). The golden file was captured at the PRE-change commit
 * (`b35d1d8c`), before any renderer parameter existed, so every later change
 * must keep the owner page identical to it. If a case legitimately changes,
 * regenerate deliberately with
 * `UPDATE_RENDER_SESSION_GOLDEN=1 node --test tests/unit/render-session-golden.test.js`
 * and say why in the commit — never by widening an assertion.
 *
 * Determinism: every case pins `options.now` (the only clock the renderer
 * reads, via `buildRunView`) and passes a fixed `deployInfo`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSessionPage, renderPrLine } from '../../lib/render-session.js';
import { prStateCopy } from '../../lib/pr-state-copy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(__dirname, '../fixtures/render-session-golden.json');
const UPDATE = process.env.UPDATE_RENDER_SESSION_GOLDEN === '1';

const NOW = '2026-07-04T10:10:00.000Z';
const OPTIONS = { now: NOW, deployInfo: { version: 'golden', commit: 'golden' }, featureFlags: {} };

// ── Fixtures (copied from tests/unit/render-session.test.js, test lines only) ─

function fixtureSession(overrides = {}) {
  return {
    sessionId: 'sess-abc',
    seedIssue: 'LIN-900',
    tasksTouched: ['LIN-900', 'LIN-901'],
    dispatchedAt: '2026-07-04T10:00:00.000Z',
    completedAt: '2026-07-04T10:05:00.000Z',
    telemetry: { runtime: { ms: 300000 }, metrics: [], producedArtifacts: [] },
    loops: [
      {
        loopId: 'loop-1',
        issueIdentifier: 'LIN-900',
        issueId: 'uuid-900',
        issueTitle: 'Seed task',
        iteration: 1,
        kind: 'autopilot',
        target: 'cli',
        dispatchedAt: '2026-07-04T10:00:00.000Z',
        terminalStatus: 'done',
        terminalCompletedAt: '2026-07-04T10:02:00.000Z',
        feedback: [
          { message: '[started] session', url: null, urlLabel: null, timestamp: '2026-07-04T10:00:01.000Z' },
          { message: '[evidence] opened PR', url: 'https://example.com/pr/1', urlLabel: 'PR #1', timestamp: '2026-07-04T10:01:00.000Z' }
        ],
        telemetry: { runtime: { ms: 120000 }, metrics: [{ toolCount: 3 }], producedArtifacts: [{ url: 'https://example.com/pr/1' }] }
      },
      {
        loopId: 'loop-2',
        issueIdentifier: 'LIN-901',
        issueId: 'uuid-901',
        issueTitle: 'Child task',
        iteration: 2,
        kind: 'implementation',
        target: 'cli',
        dispatchedAt: '2026-07-04T10:02:00.000Z',
        terminalStatus: 'done',
        terminalCompletedAt: '2026-07-04T10:05:00.000Z',
        feedback: [
          { message: '[done] landed', url: null, urlLabel: null, timestamp: '2026-07-04T10:05:00.000Z' }
        ],
        telemetry: { runtime: { ms: 180000 }, metrics: [], producedArtifacts: [] }
      }
    ],
    ...overrides
  };
}

function costLoop(overrides = {}) {
  const id = overrides.loopId || 'loop';
  return {
    loopId: id,
    lineageId: overrides.lineageId ?? id,
    kind: overrides.kind || 'implementation',
    issueIdentifier: 'LIN-900',
    issueId: 'uuid-900',
    issueTitle: 'Task title',
    iteration: overrides.iteration ?? 1,
    sessionId: 'sess-abc',
    dispatchedAt: '2026-07-04T10:00:00.000Z',
    terminalStatus: 'done',
    feedback: [],
    telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [] },
    ...overrides,
  };
}

const PR_URL = 'https://github.com/acme/widget/pull/12';

function runEvidenceFixture(overrides = {}) {
  return {
    state: { status: 'ready', pr: { url: PR_URL, repo: 'acme/widget', number: 12, headSha: 'deadbeef', checksUrl: `${PR_URL}/checks` }, message: null },
    evidence: {
      asked: 'Do the thing', done: 'PR #12',
      checked: {
        review: { verdict: 'approve-conditional', verdictText: 'Approve — conditional on close-out discharging the ledger.', ciLine: 'CI is green.', at: '2026-07-02T00:00:00.000Z', sha: 'abc1234' },
        now: { state: 'passing', checks: [], headSha: 'deadbeef', prUrl: PR_URL, checksUrl: `${PR_URL}/checks`, headMoved: false },
      },
    },
    ledger: {
      verdict: 'approve-conditional', verdictText: 'Approve — conditional on close-out discharging the ledger.', ciLine: 'CI is green.', at: '2026-07-02T00:00:00.000Z', sha: 'abc1234',
      ledger: {
        present: true, empty: false, unparsed: false,
        items: [
          { id: 'L1', claim: 'a claim', scope: 'inside', discharge: 'check it', dischargedBy: null, discharged: false, followUp: null, raw: '' },
          { id: 'L2', claim: 'b claim', scope: 'outside', discharge: 'file it', dischargedBy: null, discharged: false, followUp: 'LIN-999', raw: '' },
          { id: 'L3', claim: 'c claim', scope: 'inside', discharge: 'done it', dischargedBy: 'abc1234', discharged: true, followUp: null, raw: '' }
        ],
        raw: ''
      }
    },
    closeOut: { owner: true, status: 'ready', variant: 'standard', stopAt: 'pr', pr: { url: PR_URL, number: 12 }, message: null },
    ...overrides,
  };
}

function closeOut(status, extra = {}) {
  return { owner: true, status, variant: 'standard', stopAt: 'pr', pr: { url: PR_URL, number: 12 }, message: null, ...extra };
}

function decisionRow({ loopId = 'loop-1', decisionId = 'd-1', question = 'Proceed with the migration?', options = [], ifUnanswered = null, disposition = 'resumable', canReply = true, decisionCase = [], effect = 'resume' } = {}) {
  const decision = { decision_id: decisionId };
  if (question != null) decision.question = question;
  if (options.length) decision.options = options;
  if (ifUnanswered) decision.if_unanswered = ifUnanswered;
  return {
    decision, decisionCase,
    anchor: { loopId, issueId: 'uuid-900', issueIdentifier: 'LIN-900', workspaceUrlKey: 'ws-a', target: 'cli', followUpTo: null },
    stampLoopId: loopId, disposition, canReply, effect
  };
}

function waitingSession() {
  const session = fixtureSession({ completedAt: null });
  session.loops[1].terminalStatus = null;
  session.loops[1].terminalCompletedAt = null;
  session.loops[1].feedback = [
    { message: 'made some progress', url: null, urlLabel: null, timestamp: '2026-07-04T10:03:00.000Z' },
    { message: '[blocked] need a decision', url: null, urlLabel: null, timestamp: '2026-07-04T10:04:00.000Z' }
  ];
  return session;
}

const RECAP_OBJECT = {
  done: [{ item: 'Wired the auth callback', evidence: 'commit abc123' }],
  pending: [{ item: 'Add rate limiting', predicted: 'guard the token route' }],
  deviations: [{ item: 'Token TTL shortened', type: 'scope-change', evidence: 'per review comment' }]
};

// ── Cases ─────────────────────────────────────────────────────────────────────

const base = { urlKey: 'ws-a', issueContext: [] };

const CASES = {
  'not-found': () => ({ session: null, sessionId: 'nope', urlKey: 'ws-a' }),
  'plain-terminal': () => ({ ...base, session: fixtureSession(), sessionTerminal: true }),
  'can-reply-terminal': () => ({ ...base, session: fixtureSession(), canReply: true, sessionTerminal: true }),
  'anchor-title-and-context': () => ({
    ...base,
    session: fixtureSession(),
    anchorIssueTitle: 'A distinct <title> & more',
    sessionTerminal: true,
    issueContext: [
      { issueIdentifier: 'LIN-900', issueId: 'uuid-900', brief: '# Brief\n\nSome **markdown**.', briefModel: 'm', briefGeneratedAt: '2026-07-04T09:00:00.000Z', recap: RECAP_OBJECT, recapModel: 'm', recapGeneratedAt: '2026-07-04T09:30:00.000Z' },
      { issueIdentifier: 'LIN-901', issueId: 'uuid-901', brief: null, recap: null }
    ]
  }),
  'credential-dead-token': () => {
    const session = fixtureSession();
    session.loops[0].agentTokenId = 'tok-1';
    session.loops[0].agentTokenLabel = 'dispatch-<bootstrap>';
    return { ...base, session, sessionTerminal: true, credentialByToken: { 'tok-1': 'credential_dead' } };
  },
  'waiting-with-decision-card': () => {
    const session = waitingSession();
    return {
      ...base,
      session,
      canReply: true,
      waiting: true,
      waitingMessage: 'need a decision',
      producerLoopId: 'loop-2',
      decisions: [decisionRow({ loopId: 'loop-2', options: ['yes', 'no'], ifUnanswered: 'I will wait', decisionCase: ['(recap 1/2) context', 'more'] })],
      producer: { loopId: 'loop-2', target: 'cli', issueId: 'uuid-901', issueIdentifier: 'LIN-901', case: ['last words'] }
    };
  },
  'running-no-pr-state': () => ({ ...base, session: fixtureSession({ completedAt: null, loops: [costLoop({ loopId: 'r1', terminalStatus: null })] }) }),
  'pr-state-open': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, prState: { state: 'open', number: 12, checks: 'passing' } }),
  'pr-state-merged': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, prState: { state: 'merged', number: 12, checks: null } }),
  'pr-state-unknown': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, prState: { state: 'unknown', number: null, checks: null } }),
  'pr-state-none': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, prState: { state: 'none', number: null, checks: null } }),
  'pr-line-hostile-ids': () => ({ ...base, urlKey: 'ws "a"&<b>', session: fixtureSession({ sessionId: 'sess/<x>&"y"' }) }),
  'paragraph-and-evidence-ready': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, runParagraph: '  The run <did> a thing & finished.  ', runEvidence: runEvidenceFixture() }),
  'evidence-guest-closeout': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, runEvidence: runEvidenceFixture({ closeOut: { ...closeOut('ready'), owner: false } }) }),
  'closeout-not-ready': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, runEvidence: runEvidenceFixture({ closeOut: closeOut('not-ready', { message: 'no runner is set up for this workspace yet' }) }) }),
  'closeout-merged-by-you': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, runEvidence: runEvidenceFixture({ closeOut: closeOut('merged', { mergedByYou: true, message: 'PR #12 merged' }) }) }),
  'closeout-merged-elsewhere': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, runEvidence: runEvidenceFixture({ closeOut: closeOut('merged', { mergedByYou: false, message: 'the pull request is already merged' }) }) }),
  'closeout-partial': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, runEvidence: runEvidenceFixture({ closeOut: closeOut('partial', { mergedByYou: true, message: 'PR #12 merged · 1 more PR open' }) }) }),
  'closeout-closed': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, runEvidence: runEvidenceFixture({ closeOut: closeOut('closed', { message: 'the pull request was closed without merging' }) }) }),
  'closeout-unknown': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, runEvidence: runEvidenceFixture({ closeOut: closeOut('unknown', { message: 'the pull request could not be read — not checked' }) }) }),
  'closeout-multiple-prs': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, runEvidence: runEvidenceFixture({ closeOut: { owner: true, status: 'multiple-prs', pr: null, message: 'more than one PR: close each out on GitHub or with run this step' } }) }),
  'closeout-no-pr': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, runEvidence: runEvidenceFixture({ closeOut: { owner: true, status: 'no-pr', pr: null, message: null } }) }),
  'closeout-stepped-variant': () => ({ ...base, session: fixtureSession(), sessionTerminal: true, runEvidence: runEvidenceFixture({ closeOut: closeOut('ready', { variant: 'stepped', stopAt: null }) }) }),
  'priced-lineage': () => ({
    ...base,
    sessionTerminal: true,
    session: fixtureSession({
      loops: [
        costLoop({ loopId: 'r1', lineageId: 'R', iteration: 1, telemetry: { runtime: { ms: 1000 }, model: 'claude-opus-4-8', usage: { harness: 'claude-code', model: 'claude-opus-4-8', costUsd: 5 } } }),
        costLoop({ loopId: 'r2', lineageId: 'R', iteration: 2, followUpTo: 'r1', telemetry: { runtime: { ms: 1000 }, model: 'claude-opus-4-8', usage: { harness: 'claude-code', model: 'claude-opus-4-8', costUsd: 7 }, resources: { peakRssBytes: 512 * 1024 * 1024 } } }),
      ],
    })
  }),
  'stepped-with-proposals': () => ({
    ...base,
    canReply: true,
    session: fixtureSession({
      sessionId: 'stepped-1',
      completedAt: null,
      loops: [
        costLoop({ loopId: 'l1', lineageId: 'L', kind: 'plan', iteration: 1, target: 'cli' }),
        costLoop({ loopId: 'l2', lineageId: 'L', kind: 'implementation', iteration: 2, followUpTo: 'l1', target: 'cli', feedback: [{ message: '[ticket] LIN-901 Done — landed', url: null, urlLabel: null, timestamp: '2026-07-04T10:03:00.000Z' }] }),
        costLoop({ loopId: 'l3', lineageId: 'L', kind: 'close-out', iteration: 3, followUpTo: 'l2', target: 'cli', terminalStatus: null }),
      ],
    }),
    proposals: [
      { id: 'p1', runId: 'stepped-1', stepLoopId: 'l2', prompt: 'add a test', status: 'proposed' },
      { id: 'p2', runId: 'stepped-1', stepLoopId: 'no-such-loop', prompt: 'drop <it>', status: 'declined' }
    ]
  }),
};

function renderCase(name) {
  return renderSessionPage(CASES[name](), OPTIONS);
}

if (UPDATE) {
  const out = {};
  for (const name of Object.keys(CASES)) out[name] = renderCase(name);
  writeFileSync(GOLDEN_PATH, JSON.stringify(out, null, 2) + '\n');
}

describe('render-session golden pin (LIN-3311, owner page byte-identity)', () => {
  const golden = existsSync(GOLDEN_PATH) ? JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) : {};

  test('the case set matches the golden file exactly (no silent add/drop)', () => {
    assert.deepEqual(Object.keys(golden).sort(), Object.keys(CASES).sort());
  });

  for (const name of Object.keys(CASES)) {
    test(`owner render is byte-identical: ${name}`, () => {
      assert.ok(golden[name], `no golden entry for ${name}`);
      assert.equal(renderCase(name), golden[name]);
    });
  }

  test('rendering is deterministic (same input twice → same bytes)', () => {
    for (const name of Object.keys(CASES)) assert.equal(renderCase(name), renderCase(name), name);
  });
});

// The extracted `renderPrLine` must reproduce the PR line the pre-change page
// emitted inline, for every branch the golden cases cover: the neutral
// "checking" copy (live and ended), each known state's copy, and hostile ids.
describe('renderPrLine owner identity (LIN-3311)', () => {
  const golden = existsSync(GOLDEN_PATH) ? JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) : {};
  const prLineOf = html => {
    const m = /<div class="sess-pr-state"[\s\S]*?<\/div>/.exec(html);
    return m ? m[0] : null;
  };
  const pollUrl = (urlKey, sessionId) => `/workspace/${encodeURIComponent(urlKey)}/api/run/${encodeURIComponent(sessionId)}/pr-state`;

  const ROWS = [
    ['running-no-pr-state', { text: 'Checking for a pull request…', pollUrl: pollUrl('ws-a', 'sess-abc'), live: true }],
    ['plain-terminal', { text: 'Checking for a pull request…', pollUrl: pollUrl('ws-a', 'sess-abc'), live: false }],
    ['pr-state-open', { text: prStateCopy({ state: 'open', number: 12, checks: 'passing' }), pollUrl: pollUrl('ws-a', 'sess-abc'), live: false }],
    ['pr-state-merged', { text: prStateCopy({ state: 'merged', number: 12, checks: null }), pollUrl: pollUrl('ws-a', 'sess-abc'), live: false }],
    ['pr-state-unknown', { text: prStateCopy({ state: 'unknown', number: null, checks: null }), pollUrl: pollUrl('ws-a', 'sess-abc'), live: false }],
    ['pr-state-none', { text: prStateCopy({ state: 'none', number: null, checks: null }), pollUrl: pollUrl('ws-a', 'sess-abc'), live: false }],
    ['pr-line-hostile-ids', { text: 'Checking for a pull request…', pollUrl: pollUrl('ws "a"&<b>', 'sess/<x>&"y"'), live: true }],
  ];

  for (const [name, args] of ROWS) {
    test(`renderPrLine reproduces the golden PR line: ${name}`, () => {
      const expected = prLineOf(golden[name]);
      assert.ok(expected, `golden ${name} has a PR line`);
      assert.equal(renderPrLine(args), expected);
    });
  }

  test('the not-found body has no PR line', () => {
    assert.equal(prLineOf(golden['not-found']), null);
  });
});
