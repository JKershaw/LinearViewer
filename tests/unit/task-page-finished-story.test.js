/**
 * LIN-3373 — one finished-state story on the share page.
 *
 * The witness renders a guest page for a Done, merged task from LIN-3351's
 * comment shapes (conditional-approve review → `## Close-out` comment → merged PR
 * → a press/close-out event → a brief written before the close-out) and asserts
 * on the page text that the page no longer contradicts itself. The units pin
 * each edge the plan named: the freshness gate, the merger rule, the close-out
 * summary pick, the sessions line, the not-finished banner staying put, and the
 * client keeping the load-time summary across a poll.
 *
 * Run with: node --test tests/unit/task-page-finished-story.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { renderTaskPage, renderTaskPullRequest, sessionsLine } from '../../lib/render-task-page.js';
import { renderEvidence } from '../../lib/render-run-evidence.js';
import { readRunEvidence, closeOutSummaryFor } from '../../lib/run-evidence.js';
import { deriveCloseOutState } from '../../lib/run-closeout-state.js';
import { hashContext } from '../../lib/brief-cache.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-08T21:00:00.000Z');
const UUID = '11111111-2222-3333-4444-555555555555';
const PR_URL = 'https://github.com/acme/app/pull/41';
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

function makeLoader({ ctx, brief = null, recap = null, events = [], loops = [loop()], stopAt = 'pr' } = {}) {
  const loader = createTaskPageLoader({
    dispatchStore: {},
    agentStatusStore: {},
    briefCacheStore: { async get() { return brief; } },
    recapCacheStore: { async get() { return recap; } },
    closeOutEventsStore: { async listForIssue() { return events; } },
    readRunEvidence: (args) => readRunEvidence({ ...args, readPrStatus: async () => MERGED_PR }),
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

const STALE_BRIEF = {
  brief: '## Current\n\nWork remaining is the final correctness pass on F1–F4.\n\n## Next\n- F1 pending',
  inputHash: 'written-before-the-close-out',
  model: 'm',
  generatedAt: '2026-10-08T12:00:00.000Z',
};

const pageText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#0?39;|&apos;/g, "'").replace(/\s+/g, ' ');
const body = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));

describe('the witness: a guest reads a finished, merged task', () => {
  async function guestPage(over = {}) {
    const ctx = over.ctx || ctxFor();
    const { loader, access } = makeLoader({
      ctx,
      brief: STALE_BRIEF,
      recap: { recap: { done: [{ item: 'x' }] }, inputHash: 'old', model: 'm', generatedAt: '2026-10-08T12:00:00.000Z' },
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

    // 1. nothing stale at the top: the unhashed brief is withheld, not shown as current
    assert.equal(model.summary, null);
    assert.doesNotMatch(text, /Work remaining is the final correctness pass/);
    assert.doesNotMatch(text, /F1 pending/);
    assert.match(text, /brief out of date: written before the latest changes/);
    assert.match(text, /recap out of date/);

    // 2. no count or stamp re-adjudicates the ledger on a finished task
    assert.doesNotMatch(text, /\d+ of \d+ checked/);
    assert.doesNotMatch(text, /open at merge/);
    assert.doesNotMatch(text, /open, no follow-up filed/);
    assert.doesNotMatch(text, /Review ledger — \d+ items?/);
    assert.match(text, /Review ledger — as the review wrote it/);

    // 3. nobody is "you" on a guest page
    assert.doesNotMatch(text, /\b(you|your)\b/i);
    assert.match(text, /PR #41 was merged by Harbour's close-out, after the owner pressed merge, as reported in the close-out on 8 Oct, 18:11 UTC\./);

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
    assert.match(raw, /Close-out summary, 8 Oct, 18:11 UTC — its own words, not re-reviewed/);
    assert.match(raw, /All five items are discharged; merged at abc1234/);
    const pr = main.slice(main.indexOf('task-pr-section'), main.indexOf('task-context-section'));
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
});

describe('B1 freshness gate', () => {
  const fresh = (ctx) => ({ brief: '## Current\n\nAll shipped.', inputHash: hashContext(ctx), model: 'm', generatedAt: '2026-10-08T19:00:00.000Z' });
  const load = async (ctx, brief) => {
    const { loader, access } = makeLoader({ ctx, brief });
    return (await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-51', access })).model;
  };

  test('a matching hash is shown; a mismatch is a stale miss with no summary', async () => {
    const ctx = ctxFor();
    const ok = await load(ctx, fresh(ctx));
    assert.equal(ok.summary, 'All shipped.');
    assert.equal(ok.brief.body, '## Current\n\nAll shipped.');
    const stale = await load(ctx, STALE_BRIEF);
    assert.equal(stale.summary, null);
    assert.equal(stale.brief, null);
    assert.equal(stale.contextMiss.brief, 'stale');
  });

  test('all children terminal (incl. canceled) is exact and gated', async () => {
    const kids = [{ id: 'k1', identifier: 'LIN-52', title: 'k', state: { name: 'Canceled', type: 'canceled' } }];
    const ctx = ctxFor({ children: kids });
    assert.equal((await load(ctx, STALE_BRIEF)).contextMiss.brief, 'stale');
    assert.equal((await load(ctx, fresh(ctx))).summary, 'All shipped.');
  });

  test('an open child on a task still in progress keeps today\'s behaviour (named residual)', async () => {
    const kids = [{ id: 'k1', identifier: 'LIN-52', title: 'k', state: { name: 'Todo', type: 'unstarted' } }];
    const model = await load(ctxFor({ stateType: 'started', children: kids }), STALE_BRIEF);
    assert.equal(model.summary, 'Work remaining is the final correctness pass on F1–F4.');
    assert.equal(model.contextMiss.brief, null);
  });

  test('a Done parent with an open child is unverifiable: no summary, and it says so', async () => {
    const kids = [{ id: 'k1', identifier: 'LIN-52', title: 'k', state: { name: 'Todo', type: 'unstarted' } }];
    const ctx = ctxFor({ children: kids });
    const model = await load(ctx, fresh(ctx));
    assert.equal(model.summary, null);
    assert.equal(model.contextMiss.brief, 'unverifiable');
    const html = renderTaskPage(model, { viewer: 'guest', urlKey: 'ws', now: NOW });
    assert.match(pageText(body(html)), /brief can't be checked against the latest changes/);
  });

  test('the state read builds its model with no brief, recap or summary', async () => {
    const { loader } = makeLoader({ ctx: ctxFor(), brief: fresh(ctxFor()) });
    const { model } = await loader.loadTaskState({ urlKey: 'ws', identifier: 'LIN-51', issueId: UUID });
    assert.equal(model.brief, null);
    assert.equal(model.recap, null);
    assert.equal(model.summary, null);
    assert.equal(model.finished, false, 'no tracker read: never claims finished');
  });
});

describe('B4 merger rule', () => {
  async function leadFor(events, { comments } = {}) {
    const { loader, access } = makeLoader({ ctx: ctxFor(comments ? { comments } : {}), events });
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

  test('no close-out comment: no "when", no summary, same sentence otherwise', async () => {
    const lead = await leadFor([{ by: 'person', prUrl: PR_URL, merged: true }], { comments: [OPENED, REVIEW] });
    assert.equal(lead, 'PR #41 was merged by hand.');
  });

  test('multiple PRs name no merger', async () => {
    const lead = await leadFor([{ by: 'press', prUrl: PR_URL, merged: true }], { comments: [OPENED, REVIEW, { id: 'x', createdAt: '2026-10-08T16:30:00.000Z', body: `also ${OTHER_PR_URL}` }] });
    assert.doesNotMatch(lead, /merged by/);
  });
});

describe('deriveCloseOutState: "merged by you" belongs to the owner only', () => {
  const merged = { readable: true, state: 'closed', merged: true, head: { sha: 'a' } };
  const run = (owner) => deriveCloseOutState({ prs: [{ url: PR_URL, repo: 'acme/app', number: 41 }], prStatuses: [merged], review: null, owner, stopAt: 'pr' });
  test('owner keeps it, a guest never gets it', () => {
    assert.equal(run(true).mergedByYou, true);
    assert.equal(run(false).mergedByYou, false);
  });
});

describe('closeOutSummaryFor', () => {
  test('latest close-out after the review; its leading block only', () => {
    const later = { createdAt: '2026-10-08T19:00:00.000Z', body: '## Close-out (final)\n\nFinal summary line.\n\nSecond paragraph.\n\n## Ledger\n- x' };
    const got = closeOutSummaryFor([REVIEW, CLOSE_OUT, later], REVIEW);
    assert.deepEqual(got, { at: later.createdAt, text: 'Final summary line.\n\nSecond paragraph.' });
  });
  test('a close-out dated before the review belongs to an earlier round', () => {
    assert.equal(closeOutSummaryFor([{ createdAt: '2026-10-08T10:00:00.000Z', body: '## Close-out\n\nOld.' }, REVIEW], REVIEW), null);
  });
  test('none, a title with nothing under it, and a non-close-out heading are null', () => {
    assert.equal(closeOutSummaryFor([REVIEW], REVIEW), null);
    assert.equal(closeOutSummaryFor([{ createdAt: '2026-10-08T19:00:00.000Z', body: '## Close-out' }], REVIEW), null);
    assert.equal(closeOutSummaryFor([{ createdAt: '2026-10-08T19:00:00.000Z', body: '## Autopilot close-out\n\nnot it' }], REVIEW), null);
  });
});

describe('not finished stays on today\'s banner', () => {
  test('person-merge, no close-out: still the "N of M checked" sentence and "open at merge" stamps', async () => {
    const { loader, access } = makeLoader({ ctx: ctxFor({ stateType: 'started', comments: [OPENED, REVIEW] }), events: [] });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-51', access });
    assert.equal(model.finished, false);
    const html = renderTaskPullRequest(model, '', NOW);
    assert.match(html, /5 things CI couldn&#0?39;t prove: 0 of 5 checked\./);
    assert.match(html, /open at merge/);
    assert.match(html, /Review ledger — 5 items/);
    assert.doesNotMatch(html, /Close-out summary|as reported in the close-out/);
  });

  test('renderEvidence without opts is unchanged: counts and stamps stay', () => {
    const evidenceModel = {
      evidence: { asked: 'a', done: 'd', checked: { review: null, now: { state: 'unknown' } } },
      ledger: { ledger: { present: true, items: [{ id: 'F1', claim: 'c', scope: 'inside', discharged: false }] } },
      closeOut: { status: 'merged' },
    };
    const html = renderEvidence(evidenceModel);
    assert.match(html, /Review ledger — 1 item/);
    assert.match(html, /open at merge/);
    const fin = renderEvidence(evidenceModel, { finished: true });
    assert.doesNotMatch(fin, /open at merge|1 item/);
  });
});

describe('B6 sessions line', () => {
  const mk = (state, extra = {}) => ({ state, sessions: [{ state }], checkIns: [], ...extra });
  test('every state the page can speak is counted; the parts sum to the total', () => {
    const states = ['done', 'continued', 'running', 'queued', 'waiting', 'failed', 'aborted', 'cancelled', 'expired', 'closed', 'something-new'];
    const line = sessionsLine({ stages: states.map(s => mk(s)) });
    assert.match(line, /^11 across 11 stages \(/);
    assert.match(line, /2 done/, 'continued reads as done');
    for (const w of ['1 running', '1 queued', '1 waiting for an answer', '1 failed', '1 aborted', '1 cancelled', '1 expired', '1 closed', '1 something-new']) assert.ok(line.includes(w), `${w} in "${line}"`);
  });
  test('zero stages (ahead guesses only) omits the row', () => {
    assert.equal(sessionsLine({ stages: [] }), null);
    assert.equal(sessionsLine({ stages: [{ state: 'ahead' }] }), null);
  });
  test('check-ins are named separately', () => {
    assert.match(sessionsLine({ stages: [mk('done', { checkIns: [{}, {}] })] }), /^1 across 1 stage \(1 done\), plus 2 check-ins$/);
  });
});
