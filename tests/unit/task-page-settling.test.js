/**
 * LIN-3379 — a merged task that isn't Done yet doesn't contradict its close-out.
 *
 * In that window the PR section drops the "x of y checked" count and the
 * per-row "open at merge" stamps, says the close-out is still finishing, and
 * quotes the close-out. Discharge is never read out of the close-out text. Any
 * status other than `merged` keeps today's behaviour, and the run page (which
 * calls renderEvidence without `settling`) keeps "open at merge".
 *
 * Run with: node --test tests/unit/task-page-settling.test.js
 */
import { FINDINGS_NONE } from '../../lib/close-out-findings.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { renderTaskPage, renderTaskPullRequest } from '../../lib/render-task-page.js';
import { renderEvidence } from '../../lib/render-run-evidence.js';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { seededRecordsStore, ev } from '../helpers/records-scenario.js';
import { before, after } from 'node:test';

const NOW = new Date('2026-10-08T21:00:00.000Z');
const UUID = '11111111-2222-3333-4444-555555555555';
const PR_URL = 'https://github.com/acme/app/pull/41';
// LIN-4518 step 3: the default trail (the PR, its approve, the close-out that merged it) as the ticket's records.
const harness = createMangoTmpdir('lin-3379-task-page-settling-');
let RECORDS = null;
before(async () => {
  await harness.connect();
  // The close-out's summary is its run's account (LIN-4520, finding-9d0c053a), so the close-out run carries the CLOSE_OUT text,
  // on the same clock as the comments this file was written against.
  RECORDS = await seededRecordsStore(harness, [
    ev.pr('2026-10-08T16:00:00.000Z', PR_URL, 'abc1234'),
    ev.review('2026-10-08T17:00:00.000Z', PR_URL, { heads: { [PR_URL]: 'abc1234' } }),
    ev.close('2026-10-08T18:11:00.000Z', undefined, CLOSE_OUT.body),
    ev.merged('2026-10-08T18:05:00.000Z', PR_URL),
  ], { urlKey: 'ws', tickets: ['LIN-51'] });
});
after(() => harness.close());

const REVIEW = {
  id: 'c-review',
  createdAt: '2026-10-08T17:00:00.000Z',
  body: '## Review\n\nPR #41\n\n### What CI Did Not Prove\n- F1: the first claim\n- F2: the second claim\n- F3: the third\n- F4: the fourth\n- F5: the fifth\n\n**Verdict: Approve — conditional on close-out discharging the ledger.**',
};
const CLOSE_OUT = {
  id: 'c-close',
  createdAt: '2026-10-08T18:11:00.000Z',
  body: `## Close-out\n\nAll five items are discharged; merged at abc1234 (\`deadbeef\`).\n\n### Ledger\n- F1: done\n\nSee ${PR_URL}`,
};
const OPENED = { id: 'c-open', createdAt: '2026-10-08T16:00:00.000Z', body: `Opened ${PR_URL}` };

function ctxFor({ stateType = 'completed', comments = [OPENED, REVIEW, CLOSE_OUT], children = [] } = {}) {
  return {
    issue: {
      id: UUID,
      identifier: 'LIN-51',
      title: 'A finished task',
      state: { name: stateType === 'completed' ? 'Done' : 'In Progress', type: stateType },
      labels: [],
      blockedBy: [],
      description: null,
    },
    parent: null,
    children,
    comments,
    stateTransitions: [{ createdAt: '2026-10-08T18:20:00.000Z', toState: 'Done' }],
  };
}

function loop(over = {}) {
  return {
    loopId: `loop-${Math.random().toString(36).slice(2, 8)}`,
    issueIdentifier: 'LIN-51',
    issueId: UUID,
    issueTitle: 't',
    kind: 'implementation',
    iteration: 1,
    source: 'history',
    historyStatus: 'taken',
    agentState: 'running',
    dispatchedAt: '2026-10-08T10:00:00.000Z',
    takenAt: '2026-10-08T10:01:00.000Z',
    resolvedAt: '2026-10-08T10:01:00.000Z',
    terminalStatus: 'done',
    terminalCompletedAt: '2026-10-08T11:00:00.000Z',
    wakeMarker: null,
    waitingMessage: null,
    feedback: [],
    telemetry: { producedArtifacts: [] },
    followUpTo: null,
    ...over,
  };
}

const MERGED_PR = { readable: true, state: 'closed', merged: true, head: { sha: 'abc1234' }, checks: [{ conclusion: 'success' }] };

function makeLoader({ ctx, brief = null, recap = null, events = [], loops = [loop()], stopAt = 'pr' } = {}) {
  const loader = createTaskPageLoader({
    recordsStore: RECORDS,
    dispatchStore: {},
    agentStatusStore: {},
    briefCacheStore: { async get() { return brief; } },
    recapCacheStore: { async get() { return recap; } },
    closeOutEventsStore: { async listForIssue() { return events; } },
    readRunEvidence: (args) => readRunEvidence({ openFindings: FINDINGS_NONE, ...args, readPrStatus: async () => MERGED_PR }),
    prStateStore: null,
    readTaskRunFacts: async () => ({ stopAt, variant: 'standard' }),
    enrichLoop,
    deriveSessionWaiting,
    getLoopsForIssue: async () => loops,
    now: () => NOW,
  });
  const access = { provider: { async fetchRecommendationContext() { return ctx; } }, callScope: 'tok' };
  return { loader, access };
}


const pageText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#0?39;|&apos;/g, "'").replace(/\s+/g, ' ');
const SETTLING_SENTENCE = /The pull request is merged and the close-out is still finishing; it settles these items\./;

async function page(stateType, comments) {
  const { loader, access } = makeLoader({ ctx: ctxFor({ stateType, comments }) });
  const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-51', access });
  return { model, html: renderTaskPage(model, { viewer: 'guest', urlKey: 'ws', now: NOW }) };
}

const EMPTY_REVIEW = {
  ...REVIEW,
  body: '## Review\n\nPR #41\n\n### What CI Did Not Prove\nNone. CI covers the deliverable.\n\n**Verdict: Approve.**',
};

describe('LIN-3379: merged, not Done yet', () => {

  test('a Done task keeps the finished view, without the settling sentence', async () => {
    const { html } = await page('completed');
    assert.doesNotMatch(pageText(html), SETTLING_SENTENCE);
    assert.match(pageText(html), /This task is done\./);
  });



});
