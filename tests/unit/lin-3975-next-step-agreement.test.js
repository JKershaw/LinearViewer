/**
 * LIN-3975 (finding 2, ledger item 3): the state endpoint and the task page name the same next step.
 *
 * The state endpoint's `sessions.offered` is what Home's opened task and the run control read on a poll. The page
 * model's `nextStep` is what the owner's page renders at load. They are two reads of one rule (`nextStepOf`), so for
 * the same stored attempts they must agree: the step the page offers is the step the poll repaints.
 *
 * Driven through the real loader: `loadTaskPage` (the tracker read, as the page route makes it) and `loadTaskState`
 * (the stored-data read the poll makes), over the same loops and one spy tracker.
 *
 * Run with: node --test tests/unit/lin-3975-next-step-agreement.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPageLoader, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
// Side-effect import: the shared nav resolves the legacy default provider.
import '../../lib/providers/linear/index.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const UUID = '11111111-2222-3333-4444-555555555555';

const ISSUE_CTX = {
  issue: { id: UUID, identifier: 'LIN-50', title: 'Build the task page', url: null, state: { name: 'In Progress', type: 'started' }, labels: [], blockedBy: [] },
  parent: null,
  children: [],
  comments: [],
};

/** A tracker that answers the task read and nothing else; the page's own reads are not under test here. */
function spyTracker() {
  return {
    name: 'fake-next-step',
    ui: { inlineEdit: false, inlineCreate: false },
    supports: () => true,
    fetchRecommendationContext: async () => ISSUE_CTX,
    fetchIssueComments: async () => [],
    fetchIssueFields: async () => null,
    fetchProjects: async () => ({ projects: [] }),
  };
}

/** A finished stage row, as the store hands it back: taken, then done (or failed). */
function stage(loopId, kind, terminalStatus, minutesAgo) {
  const at = new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
  return {
    loopId, issueIdentifier: 'LIN-50', issueId: UUID, issueTitle: 'Build the task page', kind, target: 'cli', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'done', dispatchedAt: at, takenAt: at, resolvedAt: at,
    terminalStatus, terminalCompletedAt: at, wakeMarker: null, waitingMessage: null, feedback: [],
    telemetry: { producedArtifacts: [] }, followUpTo: null,
  };
}

function loaderFor(loops) {
  return createTaskPageLoader({
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting,
    getLoopsForIssue: async () => loops, now: () => NOW,
  });
}

/** Both reads over the same loops: the owner's page (tracker read) and the poll's stored-data read. */
async function bothReads(loops) {
  const loader = loaderFor(loops);
  // The route hands the loader the resolved provider object (resolveIssueBinding), not its registry name.
  const access = { provider: spyTracker(), callScope: null };
  const page = await loader.loadTaskPage({ urlKey: 'acme', workspaceId: 'ws-1', identifier: 'LIN-50', access, viewerIsOwner: true, runnerReady: true });
  const state = await loader.loadTaskState({ urlKey: 'acme', identifier: 'LIN-50', issueId: UUID });
  assert.ok(!page.unavailable && !page.notFound, 'the page model loads');
  return { page: page.model, state: state.model };
}

describe('LIN-3975 — the poll and the page name the same next step', () => {
  test('Build done: both offer Review, and the poll\'s sessions.offered is the page\'s nextStep', async () => {
    const { page, state } = await bothReads([
      stage('l-plan', 'plan', 'done', 120),
      stage('l-build', 'implementation', 'done', 60),
    ]);
    assert.equal(page.nextStep.kind, 'review', 'the rule offers Review after Build');
    assert.equal(sessionSummaryOf(state).offered.kind, page.nextStep.kind, 'the poll names the same step');
    assert.deepEqual(sessionSummaryOf(state).offered, page.nextStep, 'the same step, reason and failed flag');
  });

  test('a failed Review: both say Review again (failed), so the poll never repaints "idle" beside a page that offers it', async () => {
    const { page, state } = await bothReads([
      stage('l-plan', 'plan', 'done', 180),
      stage('l-build', 'implementation', 'done', 120),
      stage('l-review', 'review', 'failed', 30),
    ]);
    assert.equal(page.nextStep.kind, 'review');
    assert.equal(page.nextStep.failed, true);
    assert.deepEqual(sessionSummaryOf(state).offered, page.nextStep);
  });

  test('a task with no attempts: both offer the first step, the same way', async () => {
    const { page, state } = await bothReads([]);
    assert.equal(sessionSummaryOf(state).offered?.kind ?? null, page.nextStep?.kind ?? null);
  });
});
