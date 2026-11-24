/**
 * LIN-3373 — one finished-state story on the share page.
 *
 * The witness renders a guest page for a Done, merged task from LIN-3351's
 * comment shapes (conditional-approve review → `## Close-out` comment → merged PR
 * → a press/close-out event) and asserts on the page text that the page no longer
 * contradicts itself. The units pin each edge the plan named: the merger rule, the
 * close-out summary pick, the sessions line and the not-finished banner staying put.
 * LIN-4537 retired the model-written brief, so the freshness gate that withheld a
 * stale one, and the client keeping its summary across a poll, went with it.
 *
 * Run with: node --test tests/unit/task-page-finished-story.test.js
 */
import { FINDINGS_NONE } from '../../lib/close-out-findings.js';
import { test, describe, before, after } from 'node:test';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { seededRecordsStore, ev } from '../helpers/records-scenario.js';
import assert from 'node:assert/strict';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { renderTaskPage, renderTaskPullRequest, sessionsLine } from '../../lib/render-task-page.js';
import { renderEvidence } from '../../lib/render-run-evidence.js';
import { readRunEvidence, closeOutSummaryFor } from '../../lib/run-evidence.js';
import { deriveCloseOutState } from '../../lib/run-closeout-state.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-08T21:00:00.000Z');
const UUID = '11111111-2222-3333-4444-555555555555';
const PR_URL = 'https://github.com/acme/app/pull/41';
// LIN-4518 step 3: the default finished trail (the PR, its approve, the close-out that merged it) as the ticket's records.
const harness = createMangoTmpdir('lin-3379-task-page-finished-story-');
let RECORDS = null;
before(async () => {
  await harness.connect();
  // The records sit on the same clock as the comments this file was written against (LIN-4520). The close-out's summary is
  // its run's account, so the close-out run carries the text (finding-9d0c053a).
  RECORDS = await seededRecordsStore(harness, [
    ev.pr('2026-10-08T16:00:00.000Z', PR_URL, 'abc1234'),
    ev.review('2026-10-08T17:00:00.000Z', PR_URL, { heads: { [PR_URL]: 'abc1234' } }),
    ev.close('2026-10-08T18:11:00.000Z', undefined, CLOSE_OUT.body),
    ev.merged('2026-10-08T18:05:00.000Z', PR_URL),
  ], { urlKey: 'ws', tickets: ['LIN-51'] });
});
after(() => harness.close());
const OTHER_PR_URL = 'https://github.com/acme/app/pull/99';

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

function makeLoader({ ctx, events = [], loops = [loop()], stopAt = 'pr', recordsOverride = null } = {}) {
  const loader = createTaskPageLoader({
    recordsStore: recordsOverride ?? RECORDS,
    dispatchStore: {},
    agentStatusStore: {},
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
const body = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));

describe('the witness: a guest reads a finished, merged task', () => {
  async function guestPage(over = {}) {
    const ctx = over.ctx || ctxFor();
    const { loader, access } = makeLoader({
      ctx,
      events: [{ by: 'press', prUrl: PR_URL, merged: true, at: '2026-10-08T18:05:00.000Z' }],
      // 19 sessions' worth of states: the real producer vocabulary incl. closed/expired.
      loops: [
        loop({ kind: 'plan' }),
        loop({ kind: 'implementation' }),
        loop({ kind: 'implementation', terminalStatus: 'failed' }),
        loop({ kind: 'review', terminalStatus: 'aborted' }),
        loop({ kind: 'review', terminalStatus: null, historyStatus: 'expired', agentState: 'complete' }),
        loop({ kind: 'wake', terminalStatus: 'done' }),
      ],
      ...over,
    });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-51', access });
    return { model, html: renderTaskPage(model, { viewer: 'guest', urlKey: 'ws', now: NOW }) };
  }

  test('top paragraph, PR section and counts agree with the final state', async () => {
    const { model, html } = await guestPage();
    const text = pageText(body(html));

    // 1. nothing model-written at the top or below it: LIN-4537 retired the brief and recap, so nothing stale can show
    assert.equal(Object.hasOwn(model, 'summary'), false);
    assert.doesNotMatch(text, /\bbrief\b|\brecap\b/i);

    // 2. no count or stamp re-adjudicates the ledger on a finished task
    assert.doesNotMatch(text, /\d+ of \d+ checked/);
    assert.doesNotMatch(text, /open at merge/);
    assert.doesNotMatch(text, /open, no follow-up filed/);
    assert.doesNotMatch(text, /Review ledger — \d+ items?/);
    assert.match(text, /Review ledger — as the review wrote it/);

    // 3. nobody is "you" on a guest page
    assert.doesNotMatch(text, /\b(you|your)\b/i);
    // LIN-3975 (finding 3): the close-out's time is the tap piece, in relative words, not UTC prose.
    assert.match(text, /PR #41 was merged by Harbour's close-out, after the owner pressed merge, as reported in the close-out \d+ \w+ ago ?\./);
    // The moment itself is pinned in the markup, not only its relative words (LIN-3975, review finding 2): the close-out's
    // own time (CLOSE_OUT.createdAt), so a shift to the owner's press moment goes red.
    assert.match(html, /as reported in the close-out <time class="task-time"[^>]*datetime="2026-10-08T18:11:00\.000Z"/);

    // 4. the sessions line says what it counts, and the parts sum to the total
    const line = sessionsLine(model);
    const m = line.match(/^(\d+) across (\d+) stages? \((.+?)\)(?:, plus (\d+) check-ins?)?$/);
    assert.ok(m, `sessions line shape: ${line}`);
    const total = Number(m[1]);
    const stages = Number(m[2]);
    const parts = m[3];
    const checkIns = m[4];
    const sum = parts.split(', ').reduce((n, p) => n + Number(p.split(' ')[0]), 0);
    assert.equal(sum, total, `parts of "${line}" sum to the total`);
    const barSessions = model.stages.filter(s => s.state !== 'ahead').reduce((n, s) => n + s.sessions.length, 0);
    assert.equal(total, barSessions);
    assert.equal(stages, model.stages.filter(s => s.state !== 'ahead').length);
    assert.match(line, /1 expired/);
    assert.equal(Number(checkIns || 0), model.stages.reduce((n, s) => n + (s.checkIns || []).length, 0));
  });

  test('the close-out summary appears only inside the closed disclosure, as its own words', async () => {
    const { html } = await guestPage();
    const main = body(html);
    const lead = main.slice(main.indexOf('task-page-pr-lead'), main.indexOf('task-page-pr-raw'));
    assert.doesNotMatch(lead, /All five items are discharged/, 'not in the visible lead or detail');
    assert.doesNotMatch(lead, /abc1234|deadbeef/, 'no SHA in the visible PR text');
    const raw = main.slice(main.indexOf('task-page-pr-raw'));
    assert.match(raw, /Close-out summary, <time class="task-time"[^>]*datetime="2026-10-08T18:11:00\.000Z"[^>]*data-local-time="tap"[^>]*>[^<]+ ago<\/time> — its own words, not re-reviewed/);
    assert.match(raw, /All five items are discharged; merged at abc1234/);
    const pr = main.slice(main.indexOf('task-pr-section'), main.indexOf('task-docs'));
    assert.equal((pr.match(/All five items are discharged/g) || []).length, 1, 'once in the PR section (the tracker comments list is separate)');
    assert.match(main, /<details[^>]*task-pr-raw/);
    assert.doesNotMatch(main.match(/<details[^>]*task-pr-raw[^>]*>/)[0], /\bopen\b/, 'the disclosure is closed');
  });

  test('a canceled task does not claim it is done', async () => {
    const { html } = await guestPage({ ctx: ctxFor({ stateType: 'canceled' }) });
    const text = pageText(body(html));
    assert.match(text, /This task was cancelled\./);
    assert.doesNotMatch(text, /This task is done\./);
  });

  test('a duplicate task does not claim it is done (read as canceled, LIN-276)', async () => {
    const { html } = await guestPage({ ctx: ctxFor({ stateType: 'duplicate' }) });
    const text = pageText(body(html));
    assert.match(text, /This task was cancelled\./);
    assert.doesNotMatch(text, /This task is done\./);
  });
});

describe('the state read', () => {
  test('builds its model with no brief, recap or summary (LIN-4537: none exists), and never claims finished', async () => {
    const { loader } = makeLoader({ ctx: ctxFor() });
    const { model } = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-51', issueId: UUID });
    for (const key of ['brief', 'recap', 'summary', 'contextMiss']) assert.equal(Object.hasOwn(model, key), false, `no ${key}`);
    assert.equal(model.finished, false, 'no tracker read: never claims finished');
  });
});

describe('B4 merger rule', () => {
  async function leadFor(events, { comments, records } = {}) {
    const { loader, access } = makeLoader({ ctx: ctxFor(comments ? { comments } : {}), events, ...(records ? { recordsOverride: records } : {}) });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-51', access });
    return renderTaskPullRequest(model, '', NOW).match(/data-testid="task-page-pr-lead">([^<]*)</)[1];
  }

  test('a press, a close-out event, a person merge and nothing', async () => {
    assert.match(await leadFor([{ by: 'press', prUrl: PR_URL, merged: false }]), /merged by Harbour&#0?39;s close-out, after the owner pressed merge/);
    assert.match(await leadFor([{ by: 'close-out', prUrl: PR_URL, merged: true }]), /merged by Harbour&#0?39;s close-out/);
    assert.match(await leadFor([{ by: 'person', prUrl: PR_URL, merged: true }]), /^PR #41 was merged by hand/);
    assert.match(await leadFor([]), /^PR #41 is merged, as reported/);
  });

  test('a press for another PR is ignored; a person event that did not merge is ignored', async () => {
    assert.match(await leadFor([{ by: 'press', prUrl: OTHER_PR_URL, merged: true }]), /^PR #41 is merged/);
    assert.match(await leadFor([{ by: 'person', prUrl: PR_URL, merged: false }]), /^PR #41 is merged/);
  });

  test('no close-out run on record: no "when", no summary, same sentence otherwise', async () => {
    // LIN-4520: the close-out is a run record, so "no close-out" is a trail with no close-out run.
    const records = await seededRecordsStore(harness, [ev.pr(1, PR_URL, 'abc1234'), ev.review(2, PR_URL, { heads: { [PR_URL]: 'abc1234' } }), ev.merged(3, PR_URL)], { urlKey: 'ws', tickets: ['LIN-51'] });
    const lead = await leadFor([{ by: 'person', prUrl: PR_URL, merged: true }], { comments: [OPENED, REVIEW], records });
    assert.equal(lead, 'PR #41 was merged by hand.');
  });

  test('multiple PRs name no merger', async () => {
    // The ticket's landing is two PRs: the finished one, and another the trail cites (an open change on the task).
    const records = await seededRecordsStore(harness, [ev.pr(1, PR_URL, 'abc1234'), ev.pr(1, OTHER_PR_URL, 'abc1234'), ev.review(2, [PR_URL, OTHER_PR_URL], { heads: { [PR_URL]: 'abc1234', [OTHER_PR_URL]: 'abc1234' } }), ev.close(3), ev.merged(3, PR_URL)], { urlKey: 'ws', tickets: ['LIN-51'] });
    const lead = await leadFor([{ by: 'press', prUrl: PR_URL, merged: true }], { comments: [OPENED, REVIEW, { id: 'x', createdAt: '2026-10-08T16:30:00.000Z', body: `also ${OTHER_PR_URL}` }], records });
    assert.doesNotMatch(lead, /merged by/);
  });
});

describe('B4 owner load: a press merge reads as a close-out merge (review F1)', () => {
  const PRESS = [{ by: 'press', prUrl: PR_URL, merged: true, at: '2026-10-08T18:05:00.000Z' }];

  async function ownerPage({ stateType, events = PRESS, comments }) {
    const { loader, access } = makeLoader({ ctx: ctxFor({ stateType, ...(comments ? { comments } : {}) }), events });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-51', access, viewerIsOwner: true });
    return { model, html: renderTaskPage(model, { viewer: 'owner', urlKey: 'ws', now: NOW }) };
  }

  for (const stateType of ['completed', 'started']) {
    test(`owner, press event, task ${stateType}: the page text never says the owner merged`, async () => {
      const { model, html } = await ownerPage({ stateType });
      assert.equal(model.evidence.closeOut.mergedBy, 'close-out');
      assert.ok(!('mergedByYou' in model.evidence.closeOut));
      assert.doesNotMatch(pageText(body(html)), /You merged|merged by you/i);
      // finished: the third-person merger sentence; not finished: the neutral lead and the owner box's close-out wording
      assert.match(pageText(body(html)), stateType === 'completed' ? /merged by Harbour's close-out/ : /PR #41 is merged\..*the pull request was merged by close-out/);
    });
  }

  test('a press event for another PR leaves the merge unattributed, and the line neutral', async () => {
    const { model, html } = await ownerPage({ stateType: 'started', events: [{ by: 'press', prUrl: OTHER_PR_URL, merged: true }] });
    assert.equal(model.evidence.closeOut.mergedBy, null);
    assert.match(pageText(body(html)), /PR #41 is merged\./);
    assert.doesNotMatch(pageText(body(html)), /You merged|merged by you/i);
  });

  test('partial merge with a press event: the owner box does not claim it either', async () => {
    const partial = { status: 'partial', pr: { number: 41, url: PR_URL }, message: 'PR #41 merged · 1 more PR open' };
    const loader = createTaskPageLoader({
      dispatchStore: {}, agentStatusStore: {},
      closeOutEventsStore: { async listForIssue() { return PRESS; } },
      readRunEvidence: async () => ({ closeOut: partial, ledger: null, state: { pr: partial.pr } }),
      prStateStore: null, readTaskRunFacts: async () => ({ stopAt: 'pr', variant: 'standard' }),
      enrichLoop, deriveSessionWaiting, getLoopsForIssue: async () => [loop()], now: () => NOW,
    });
    const access = { provider: { async fetchRecommendationContext() { return ctxFor({ stateType: 'started' }); } }, callScope: 'tok' };
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-51', access, viewerIsOwner: true });
    assert.equal(model.evidence.closeOut.mergedBy, 'close-out');
    assert.ok(!('mergedByYou' in model.evidence.closeOut));
  });
});

describe('deriveCloseOutState: a merged PR reads the same for every viewer (LIN-3426)', () => {
  const merged = { readable: true, state: 'closed', merged: true, head: { sha: 'a' } };
  const run = (owner) => deriveCloseOutState({ openFindings: FINDINGS_NONE, prs: [{ url: PR_URL, repo: 'acme/app', number: 41 }], prStatuses: new Map([[PR_URL, merged]]), landingPrs: [PR_URL], review: null, owner, stopAt: 'pr' });
  test('owner and guest get the same merged message and no merger flag', () => {
    const { owner: _o1, ...asOwner } = run(true);
    const { owner: _o2, ...asGuest } = run(false);
    assert.deepEqual(asOwner, asGuest);
    assert.ok(!('mergedByYou' in asOwner));
    assert.doesNotMatch(JSON.stringify(asOwner), /you merged|merged by you/i);
  });
});

describe('closeOutSummaryFor (LIN-4520, finding-9d0c053a: the close-out run record\'s account, never a comment)', () => {
  // A close-out run record as the store reads it: its end instant in `at`, its final text in `fields.account`.
  const closeOutRun = (at, account) => ({ at, fields: { stage: 'close-out', account } });
  const REVIEW_TRAIL = { at: REVIEW.createdAt };
  test('latest close-out run after the review; its leading block only', () => {
    const later = closeOutRun('2026-10-08T19:00:00.000Z', '## Close-out (final)\n\nFinal summary line.\n\nSecond paragraph.\n\n## Ledger\n- x');
    const got = closeOutSummaryFor([closeOutRun('2026-10-08T18:11:00.000Z', 'Earlier.'), later], REVIEW_TRAIL);
    assert.deepEqual(got, { at: later.at, text: 'Final summary line.\n\nSecond paragraph.' });
  });
  test('a close-out run ended before the review belongs to an earlier round', () => {
    assert.equal(closeOutSummaryFor([closeOutRun('2026-10-08T10:00:00.000Z', 'Old.')], REVIEW_TRAIL), null);
  });
  test('no run, an account with nothing under its title, and no account are null', () => {
    assert.equal(closeOutSummaryFor([], REVIEW_TRAIL), null);
    assert.equal(closeOutSummaryFor([closeOutRun('2026-10-08T19:00:00.000Z', '## Close-out')], REVIEW_TRAIL), null);
    assert.equal(closeOutSummaryFor([closeOutRun('2026-10-08T19:00:00.000Z', null)], REVIEW_TRAIL), null);
  });
  test('a close-out title in a comment is not the quote: only the run record is read', () => {
    const titled = { createdAt: '2026-10-08T19:00:00.000Z', body: '## Close-out\n\nFrom a comment.' };
    assert.equal(closeOutSummaryFor([], REVIEW_TRAIL), null);
    assert.equal(closeOutSummaryFor([titled], REVIEW_TRAIL), null);
  });
});

describe('not finished stays on today\'s banner', () => {
  // LIN-3379: the merged-but-not-Done window used to keep the count and stamps
  // (pinned here by LIN-3373); it now says the close-out is still finishing.
  test('person-merge, no close-out: no count or stamps; says the close-out is still finishing', async () => {
    // LIN-4520: no close-out run on record (the close-out is a run record, not a comment).
    const records = await seededRecordsStore(harness, [ev.pr(1, PR_URL, 'abc1234'), ev.review(2, PR_URL, { heads: { [PR_URL]: 'abc1234' } }), ev.merged(3, PR_URL)], { urlKey: 'ws', tickets: ['LIN-51'] });
    const { loader, access } = makeLoader({ ctx: ctxFor({ stateType: 'started', comments: [OPENED, REVIEW] }), events: [], recordsOverride: records });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-51', access });
    assert.equal(model.finished, false);
    const html = renderTaskPullRequest(model, '', NOW);
    assert.doesNotMatch(html, /\d+ of \d+ checked/);
    assert.doesNotMatch(html, /open at merge/);
    assert.doesNotMatch(html, /Close-out summary|as reported in the close-out/);
  });

  test('renderEvidence without opts is unchanged: counts and stamps stay', () => {
    const evidenceModel = {
      evidence: { asked: 'a', done: 'd', checked: { review: null, now: { state: 'unknown' } } },
      ledger: { ledger: { present: false, empty: false, raw: null } },
      closeOut: { status: 'merged', openFindings: { state: 'read', count: 1, ids: ['finding-aaaaaaaa'] } },
    };
    const html = renderEvidence(evidenceModel);
    assert.match(html, /Review ledger — 1 open to close-out/);
    const fin = renderEvidence(evidenceModel, { finished: true });
    assert.doesNotMatch(fin, /1 open to close-out/);
  });
});

describe('B6 sessions line', () => {
  const mk = (state, extra = {}) => ({ state, sessions: [{ state }], checkIns: [], ...extra });
  test('every state the page can speak is counted; the parts sum to the total', () => {
    const states = ['done', 'continued', 'running', 'queued', 'waiting', 'failed', 'aborted', 'cancelled', 'expired', 'closed', 'something-new'];
    const line = sessionsLine({ stages: states.map(s => mk(s)) });
    assert.match(line, /^11 across 11 stages \(/);
    assert.match(line, /2 done/, 'continued reads as done');
    for (const w of ['1 running', '1 queued', '1 needs you', '1 failed', '1 aborted', '1 cancelled', '1 expired', '1 closed', '1 something-new']) assert.ok(line.includes(w), `${w} in "${line}"`);
  });
  test('zero stages omits the row (LIN-4103: no usual stage is ever a stage here)', () => {
    assert.equal(sessionsLine({ stages: [] }), null);
  });
  test('check-ins are named separately', () => {
    assert.match(sessionsLine({ stages: [mk('done', { checkIns: [{}, {}] })] }), /^1 across 1 stage \(1 done\), plus 2 check-ins$/);
  });
});
