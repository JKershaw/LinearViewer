/**
 * LIN-3329 — owner golden for the task page (`lib/render-task-page.js`).
 *
 * Byte-parity over fixed models built by the real `buildTaskPageModel` (so the
 * golden covers the model → HTML path, not a hand-written model): a running
 * task with a blocked row, a repeated review and a superseded run; a finished
 * task; and a task with no sessions. There is no stored-only page (John's
 * no-fallback decision): the loader refuses before anything renders. Regenerate deliberately
 * with `UPDATE_RENDER_TASK_PAGE_GOLDEN=1 node --test tests/unit/render-task-page-golden.test.js`
 * and say why in the commit — never by widening an assertion.
 *
 * Also pinned here:
 *   - the page order (answer → stages → pull request → brief/recap → docs → details → share);
 *   - `renderOwnerControls` is the ONLY owner/guest difference: owner HTML with
 *     its two fragments removed is byte-identical to the guest HTML;
 *   - every in-Harbour href goes through `harbourHref` (carries the source kind),
 *     the same for every viewer.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTaskPage, renderOwnerControls, renderTaskTrack, renderTaskStatus, harbourHref } from '../../lib/render-task-page.js';
import { renderCloseOutBox } from '../../lib/render-run-evidence.js';
import { buildTaskPageModel } from '../../lib/task-page-loader.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { CLOSE_OUT_STATUS } from '../../lib/run-closeout-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(__dirname, '../fixtures/render-task-page-golden.json');
const UPDATE = process.env.UPDATE_RENDER_TASK_PAGE_GOLDEN === '1';

const NOW = new Date('2026-10-06T15:00:00.000Z');
const PAGE_OPTIONS = { deployInfo: { version: 'golden', commit: 'golden' }, featureFlags: {}, workspaces: [] };
const BINDING = { source: 'linear' };
const UUID = '11111111-2222-3333-4444-555555555555';

function loop(over = {}) {
  return {
    loopId: 'loop-x',
    issueIdentifier: 'LIN-50',
    issueId: UUID,
    issueTitle: 'Build the task page',
    kind: 'implementation',
    iteration: 1,
    source: 'history',
    historyStatus: 'taken',
    agentState: 'running',
    dispatchedAt: '2026-10-06T10:00:00.000Z',
    takenAt: '2026-10-06T10:01:00.000Z',
    resolvedAt: '2026-10-06T10:01:00.000Z',
    terminalStatus: null,
    terminalCompletedAt: null,
    wakeMarker: null,
    waitingMessage: null,
    feedback: [],
    telemetry: { runtime: { ms: 60000 }, metrics: [{ toolCount: 2 }], producedArtifacts: [] },
    followUpTo: null,
    ...over,
  };
}

const done = (over) => loop({
  terminalStatus: 'done',
  terminalCompletedAt: '2026-10-06T11:00:00.000Z',
  feedback: [{ message: '[done] landed the change', timestamp: '2026-10-06T11:00:00.000Z' }],
  ...over,
});

function ctx({ stateType = 'started', stateName = 'In Progress' } = {}) {
  return {
    issue: {
      id: UUID,
      identifier: 'LIN-50',
      title: 'Build the task page',
      url: 'https://linear.app/x/issue/LIN-50',
      state: { name: stateName, type: stateType },
      labels: ['frontend'],
      description: 'A **markdown** description with a list:\n\n- one\n- two',
      blockedBy: [{ identifier: 'LIN-49', title: 'Lift helpers', state: { name: 'Done', type: 'completed' } }],
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-06T10:00:00.000Z',
    },
    parent: { id: 'p', identifier: 'LIN-40', title: 'A page for each task', state: { name: 'In Progress', type: 'started' } },
    children: [{ id: 'c', identifier: 'LIN-51', title: 'Share link', state: { name: 'Todo', type: 'unstarted' } }],
    comments: [
      { body: 'First comment', user: { name: 'Ada' }, createdAt: '2026-10-05T09:00:00.000Z' },
      { body: 'Second comment', user: 'Bob', createdAt: '2026-10-06T09:00:00.000Z' },
    ],
    stateTransitions: [{ createdAt: '2026-10-06T12:00:00.000Z', fromState: 'In Review', toState: stateName }],
  };
}

const EVIDENCE = {
  state: { status: 'ready', pr: { url: 'https://github.com/acme/app/pull/41', number: 41, headSha: 'abc1234' } },
  evidence: { asked: 'Build the task page', done: 'PR #41', checked: { review: null, now: { state: 'passing', checks: [], headSha: 'abc1234', prUrl: 'https://github.com/acme/app/pull/41', checksUrl: 'https://github.com/acme/app/pull/41/checks', headMoved: false } } },
  ledger: null,
  closeOut: { owner: true, status: 'ready', pr: { url: 'https://github.com/acme/app/pull/41', number: 41, headSha: 'abc1234' }, stopAt: 'pr', variant: 'standard', urlKey: 'acme', issueIdentifier: 'LIN-50' },
};

const RUNNING_LOOPS = [
  done({ loopId: 'plan-1', kind: 'plan', dispatchedAt: '2026-10-06T08:00:00.000Z', terminalCompletedAt: '2026-10-06T08:30:00.000Z' }),
  done({ loopId: 'impl-1', kind: 'implementation', dispatchedAt: '2026-10-06T09:00:00.000Z', telemetry: { runtime: { ms: 90000 }, metrics: [], producedArtifacts: [{ url: 'https://github.com/acme/app/pull/41', label: 'PR #41' }] } }),
  done({ loopId: 'rev-1', kind: 'review', dispatchedAt: '2026-10-06T11:10:00.000Z', terminalCompletedAt: '2026-10-06T11:40:00.000Z' }),
  loop({ loopId: 'impl-2', kind: 'implementation', dispatchedAt: '2026-10-06T12:00:00.000Z', wakeMarker: 'blocked', waitingMessage: '[blocked] which API key?', feedback: [{ message: '[blocked] which API key?' }] }),
  done({ loopId: 'impl-3', kind: 'implementation', followUpTo: 'impl-2', dispatchedAt: '2026-10-06T13:00:00.000Z', terminalCompletedAt: '2026-10-06T13:30:00.000Z' }),
  loop({ loopId: 'rev-2', kind: 'review', dispatchedAt: '2026-10-06T14:00:00.000Z', takenAt: '2026-10-06T14:02:00.000Z' }),
  loop({ loopId: 'wake-1', kind: 'wake', source: 'live', agentState: 'queued', dispatchedAt: '2026-10-06T14:55:00.000Z', takenAt: null }),
];

// LIN-3351's shape (the run John watched): a kick-off, check-ins, an abort row,
// Build x -> aborted -> ok, Review -> Build -> Review, and a trailing check-in.
const T = (hh, mm) => `2026-10-06T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`;
const orch = (loopId, kind, hh, mm) => done({ loopId, kind, dispatchedAt: T(hh, mm), takenAt: T(hh, mm), terminalCompletedAt: T(hh, mm + 1) });
const work = (loopId, kind, hh, mm, endH, endM, over = {}) => done({ loopId, kind, dispatchedAt: T(hh, mm), takenAt: T(hh, mm), terminalCompletedAt: T(endH, endM), ...over });
const LIN3351_LOOPS = [
  orch('kick', 'autopilot', 8, 0),
  work('design', 'design', 8, 1, 8, 9),
  orch('w1', 'wake', 8, 9),
  work('plan', 'plan', 8, 10, 8, 13),
  orch('w2', 'wake', 8, 13),
  work('b1', 'implementation', 8, 14, 8, 30, { terminalStatus: 'failed' }),
  orch('w3', 'wake', 8, 31),
  work('b2', 'implementation', 8, 32, 8, 40, { terminalStatus: 'aborted' }),
  orch('abort', 'custom', 8, 41),
  orch('w4', 'wake', 8, 41),
  work('b3', 'implementation', 8, 42, 9, 50),
  orch('w5', 'wake', 9, 50),
  work('r1', 'review', 9, 51, 9, 56),
  orch('w6', 'wake', 9, 56),
  work('b4', 'implementation', 9, 57, 10, 10),
  orch('w7', 'wake', 10, 10),
  work('r2', 'review', 10, 11, 10, 18),
  orch('w8', 'wake', 10, 18),
  loop({ loopId: 'co', kind: 'close-out', dispatchedAt: T(10, 54), takenAt: T(10, 54) }),
  loop({ loopId: 'w9', kind: 'wake', agentState: 'queued', dispatchedAt: T(10, 58), takenAt: null }),
];

function model(name) {
  const base = { identifier: 'LIN-50', enrichLoop, deriveSessionWaiting, now: NOW };
  switch (name) {
    case 'running-blocked-repeat':
      return buildTaskPageModel({ ...base, loops: RUNNING_LOOPS, ctx: ctx(), evidence: EVIDENCE,
        brief: { brief: '## Current\nThe **review** is running on `PR #41`; the build landed.\n\n## Constraints\n- keep it small', model: 'm', generatedAt: '2026-10-06T09:00:00.000Z' },
        recap: { recap: { done: [{ item: 'plan', evidence: 'comment' }], pending: [], deviations: [] }, model: 'm', generatedAt: '2026-10-06T09:00:00.000Z' } });
    case 'waiting':
      return buildTaskPageModel({ ...base, loops: [done({ loopId: 'plan-1', kind: 'plan' }), loop({ loopId: 'impl-2', wakeMarker: 'blocked', waitingMessage: '[blocked] which API key?', feedback: [{ message: '[blocked] which API key?' }] })], ctx: ctx() });
    case 'done':
      return buildTaskPageModel({ ...base, loops: [done({ loopId: 'impl-1' }), loop({ loopId: 'rev-stale', kind: 'review' })], ctx: ctx({ stateType: 'completed', stateName: 'Done' }), evidence: EVIDENCE });
    case 'lin-3351':
      return buildTaskPageModel({ ...base, loops: LIN3351_LOOPS, ctx: ctx(), evidence: EVIDENCE });
    case 'no-sessions':
      return buildTaskPageModel({ ...base, loops: [], ctx: ctx({ stateType: 'unstarted', stateName: 'Todo' }) });
    default:
      throw new Error(name);
  }
}

const CASES = ['running-blocked-repeat', 'waiting', 'done', 'no-sessions', 'lin-3351'];

function render(name, viewer = 'owner') {
  return renderTaskPage(model(name), {
    viewer,
    urlKey: 'acme',
    binding: BINDING,
    stateUrl: `/workspace/acme/api/task/LIN-50/state?issueId=${UUID}`,
    now: NOW,
    pageOptions: PAGE_OPTIONS,
  });
}

describe('task page owner golden (LIN-3329)', () => {
  const golden = existsSync(GOLDEN_PATH) ? JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) : {};
  const out = {};
  for (const name of CASES) {
    test(`byte-parity: ${name}`, () => {
      const html = render(name);
      out[name] = html;
      if (UPDATE) return;
      assert.ok(golden[name], `no golden for ${name} — run with UPDATE_RENDER_TASK_PAGE_GOLDEN=1`);
      assert.equal(html, golden[name]);
    });
  }
  test('write golden (update mode only)', () => {
    if (UPDATE) writeFileSync(GOLDEN_PATH, `${JSON.stringify(out, null, 2)}\n`);
  });
});

describe('task page structure', () => {
  test('page order: answer → stages → pull request → brief/recap → docs → details → share', () => {
    const html = render('running-blocked-repeat');
    const at = (testid) => html.indexOf(`data-testid="${testid}"`);
    const order = ['task-page-answer', 'task-page-track', 'task-page-pr-mount', 'task-page-context', 'task-page-docs', 'task-page-details', 'task-page-share-slot'].map(at);
    assert.ok(order.every(i => i > 0), JSON.stringify(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  test('stages, oldest-first: same-kind sessions fold into one stage; the running stage starts open', () => {
    const html = renderTaskTrack(model('running-blocked-repeat'), { now: NOW });
    const rows = [...html.matchAll(/<li class="([^"]*)" data-testid="task-page-stage" data-state="([^"]*)" data-tone="[^"]*" data-kind="([^"]*)" data-loop-id="([^"]*)"/g)]
      .map(m => ({ id: m[4], kind: m[3], state: m[2], open: m[1].includes('sess-run--expanded') }));
    assert.deepEqual(rows.map(r => r.id), ['plan-1', 'impl-1', 'rev-1', 'impl-2', 'rev-2'], 'a stage is keyed by its first session');
    assert.deepEqual(rows.map(r => r.state), ['done', 'done', 'done', 'done', 'running']);
    assert.deepEqual(rows.filter(r => r.open).map(r => r.id), ['rev-2'], 'only the running stage is open');
    assert.equal((html.match(/aria-expanded="true"/g) || []).length, 1, 'only the open stage says so');
    assert.match(html, /2 attempts/, 'the replied-to build and its follow-up are one stage');
    assert.doesNotMatch(html, /task-page-step"/, 'no session-by-session feed');
  });

  test('a queued check-in folds into the stage it waits on, closed, not a top-level row', () => {
    const html = renderTaskTrack(model('running-blocked-repeat'), { now: NOW });
    assert.doesNotMatch(html, /data-kind="wake" data-loop-id/, 'a check-in is never a stage row');
    const stage = html.slice(html.indexOf('data-loop-id="rev-2"'));
    assert.match(stage, /<details class="task-checkins" data-testid="task-page-checkins"><summary>1 check-in<\/summary>/, 'folded and closed');
  });

  test('LIN-3351 shape: 19 rows become 7 stages, with no orchestration row on top', () => {
    const m = model('lin-3351');
    const done = m.stages.filter(st => st.state !== 'ahead');
    assert.deepEqual(done.map(st => st.label), ['Design', 'Plan', 'Build', 'Review', 'Build', 'Review', 'Close-out']);
    assert.deepEqual(done.map(st => st.attempts), [1, 1, 3, 1, 1, 1, 1]);
    assert.deepEqual(done.map(st => st.checkIns.length), [1, 1, 4, 1, 1, 1, 2]);
    const html = renderTaskTrack(m, { now: NOW });
    assert.equal((html.match(/data-testid="task-page-stage"/g) || []).length, 7);
    assert.doesNotMatch(html, /data-kind="(wake|autopilot|custom|periodical)"[^>]*data-loop-id/);
    assert.match(html, /9 check-ins|2 check-ins/);
  });

  test('stages still ahead are drawn dashed, with no id and no toggle', () => {
    const html = renderTaskTrack(model('running-blocked-repeat'), { now: NOW });
    assert.match(html, /<li class="task-stage task-stage--ahead" data-testid="task-page-stage-ahead" data-state="ahead" data-tone="ahead" data-kind="close-out">/);
    assert.doesNotMatch(html.slice(html.indexOf('task-stage--ahead')), /<button/);
    assert.doesNotMatch(renderTaskTrack(model('done'), { now: NOW }), /task-page-stage-ahead/, 'none once the tracker says done');
    const none = renderTaskTrack(model('no-sessions'), { now: NOW });
    assert.equal((none.match(/data-testid="task-page-stage-ahead"/g) || []).length, 5);
    assert.match(none, /no sessions yet/);
  });

  test('the answer carries the brief\'s ## Current paragraph, plain; absent without a brief; no second strip', () => {
    const html = render('running-blocked-repeat');
    assert.match(html, /data-testid="task-page-summary">The review is running on PR #41; the build landed\.</);
    const summary = html.slice(html.indexOf('data-testid="task-page-summary"'), html.indexOf('</p>', html.indexOf('data-testid="task-page-summary"')));
    assert.doesNotMatch(summary, /keep it small|Constraints/, 'only the Current section');
    assert.doesNotMatch(renderTaskStatus(model('waiting')), /task-page-summary/);
    assert.doesNotMatch(html, /segment-bar|task-strip/, 'one progress picture: the stage bars');
  });

  test('the task evidence renders once, in the Pull request section, after the stages', () => {
    const html = render('running-blocked-repeat');
    assert.equal((html.match(/data-testid="run-evidence"/g) || []).length, 1, 'evidence once');
    assert.equal((html.match(/data-testid="task-page-pr-mount"/g) || []).length, 1, 'one PR section');
    assert.ok(html.indexOf('data-testid="task-page-pr-mount"') > html.indexOf('data-testid="task-page-track-mount"'));
    assert.match(html, /<details class="disclosure task-pr-raw"(?![^>]* open)/, 'the raw evidence is a closed disclosure');
  });

  test('an evidence model with no PR and no ledger renders no Pull request section', () => {
    const m = model('running-blocked-repeat');
    const bare = { ...m, evidence: { state: { status: 'no-pr', pr: null }, evidence: { asked: 'x', done: null, checked: { review: null, now: { state: 'unknown' } } }, ledger: null, closeOut: { owner: true, status: 'no-pr' } } };
    const html = renderTaskPage(bare, { viewer: 'owner', urlKey: 'acme', binding: BINDING, now: NOW, pageOptions: PAGE_OPTIONS });
    assert.doesNotMatch(html, /task-page-pr-mount/, 'no section');
    assert.doesNotMatch(html, /run-evidence/);
  });

  test('description and comments render as closed disclosures, outside the repainted mounts', () => {
    const html = render('running-blocked-repeat');
    assert.match(html, /data-testid="task-page-description"/);
    assert.match(html, /data-testid="task-page-comments"/);
    assert.match(html, /Comments \(2\)/);
    assert.match(html, /data-testid="task-page-comment-author">Ada</);
    assert.match(html, /data-testid="task-page-comment-author">Bob</);
    // After the context mount, before Task details.
    const docs = html.indexOf('data-testid="task-page-docs"');
    assert.ok(docs > html.indexOf('data-testid="task-page-context-mount"'));
    assert.ok(docs < html.indexOf('data-testid="task-page-details"'));
  });

  // LIN-3340 F3 (review `388f4246`): every close-out status must render a
  // sensible line on the task page, as it does on the run page. This iterates
  // the enum, so a status that renders nothing fails here.
  test('every close-out status renders a line on the task page (C5)', () => {
    const statuses = Object.values(CLOSE_OUT_STATUS);
    assert.equal(statuses.length, 8, 'the enum has all eight statuses');
    for (const status of statuses) {
      const m = model('running-blocked-repeat');
      const withBox = {
        ...m,
        evidence: {
          ...m.evidence,
          closeOut: {
            owner: true, status, variant: 'standard', urlKey: 'acme', issueIdentifier: 'LIN-50',
            pr: { url: 'https://github.com/acme/app/pull/41', number: 41, headSha: 'abc1234' },
          },
        },
      };
      const html = renderTaskPage(withBox, { viewer: 'owner', urlKey: 'acme', binding: BINDING, now: NOW, pageOptions: PAGE_OPTIONS });
      assert.match(html, /data-testid="run-evidence-closeout"/, `${status}: the box is present`);
      assert.match(html, /data-testid="run-evidence-closeout-(ready|merged|neutral|setup|withheld)"/, `${status}: the box renders a line`);
      assert.match(html, new RegExp(`data-state="${status}"`), `${status}: the box carries the status`);
      // The justification is plain words for every status: no SHA, no ISO time, no id.
      const from = html.indexOf('data-testid="task-page-pr-summary"');
      const says = html.slice(from, html.indexOf('</div>', from));
      assert.match(says, /task-page-pr-lead">[^<]{12,}</, `${status}: a plain-words lead`);
      assert.doesNotMatch(says, /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b|\d{4}-\d{2}-\d{2}T\d{2}:/, `${status}: no SHA or ISO time in the justification`);
      // One clear button, and only when the close-out is ready.
      const buttons = html.match(/data-action="closeout-press"/g) || [];
      assert.equal(buttons.length, status === 'ready' ? 1 : 0, `${status}: the merge button iff ready`);
      if (status === 'ready') assert.match(html, /data-action="closeout-press">Merge PR #41<\/button>/);
      const guestHtml = renderTaskPage(withBox, { viewer: 'guest', urlKey: 'acme', binding: BINDING, now: NOW, pageOptions: PAGE_OPTIONS });
      assert.doesNotMatch(guestHtml, /closeout-press/, `${status}: a guest never gets the button`);
      assert.match(guestHtml, /task-page-pr-lead/, `${status}: a guest still gets the justification`);
    }
  });

  test('header answers running / waiting / done', () => {
    assert.match(renderTaskStatus(model('running-blocked-repeat')), /data-status="running"[\s\S]*Review running since 6 Oct, 14:02 UTC\./);
    assert.match(renderTaskStatus(model('waiting')), /data-status="waiting"[\s\S]*task-page-sentence">which API key\?</, 'the [blocked] marker is not in the sentence');
    assert.match(renderTaskStatus(model('done')), /data-status="done"[\s\S]*Finished 6 Oct, 12:00 UTC\./);
    assert.doesNotMatch(render('running-blocked-repeat'), /Tracker details unavailable|data-tracker=/, 'no stored-only remnant');
  });
});

describe('viewer isolation', () => {
  for (const name of CASES) {
    test(`${name}: owner minus renderOwnerControls === guest`, () => {
      const owner = render(name, 'owner');
      const guest = render(name, 'guest');
      const fragments = renderOwnerControls(model(name), { urlKey: 'acme', binding: BINDING });
      let stripped = owner;
      for (const f of [fragments.context, fragments.pullRequest, fragments.share]) {
        if (!f) continue;
        assert.ok(stripped.includes(f), 'the owner page carries the fragment verbatim');
        stripped = stripped.replace(f, '');
      }
      assert.equal(stripped, guest);
    });
  }

  test('the owner widget marker and the close-out box are owner-only', () => {
    const owner = render('running-blocked-repeat', 'owner');
    const guest = render('running-blocked-repeat', 'guest');
    assert.match(owner, /data-testid="task-page-owner-widgets"/);
    assert.doesNotMatch(guest, /task-page-owner-widgets/);
    assert.match(owner, /data-testid="run-evidence-closeout"/);
    assert.match(owner, /data-issue-id="11111111-2222-3333-4444-555555555555"/);
    assert.match(owner, /data-source="linear"/);
    assert.doesNotMatch(guest, /run-evidence-closeout/, 'a guest gets the evidence but no box');
    assert.match(guest, /data-testid="run-evidence"/);
  });

  test('in-Harbour links carry the source through harbourHref, for every viewer', () => {
    const links = (html) => [...html.matchAll(/<a [^>]*href="(\/workspace\/[^"]*)"/g)].map(m => m[1]);
    const owner = render('running-blocked-repeat', 'owner');
    assert.ok(owner.includes(`href="${harbourHref('/workspace/acme/task/LIN-40', BINDING).replace(/&/g, '&amp;')}"`), 'parent link');
    assert.ok(owner.includes('href="/workspace/acme/task/LIN-51?source=linear"'), 'subtask link');
    assert.ok(owner.includes('href="/workspace/acme/"'), 'back link');
    assert.deepEqual(links(render('running-blocked-repeat', 'guest')), links(owner), 'a guest keeps every Harbour link');
    assert.equal(harbourHref('/x', { source: '' }), '/x', 'empty provenance is dropped');
    assert.throws(() => renderTaskPage(model('done'), { viewer: 'stranger' }), /unknown viewer/);
  });
});

describe('shared renderers stay as the run page has them (LIN-3356)', () => {
  const closeOut = { owner: true, status: 'ready', variant: 'standard', pr: { url: 'https://github.com/acme/app/pull/41', number: 41, headSha: 'abc1234' } };

  test('renderCloseOutBox keeps the run page text unless the task page passes pressLabel', () => {
    assert.match(renderCloseOutBox(closeOut), /data-action="closeout-press">\[ close out &amp; merge \]<\/button>/);
    assert.match(renderCloseOutBox(closeOut, { pressLabel: 'Merge PR #41' }), /data-action="closeout-press">Merge PR #41<\/button>/);
    assert.equal(
      renderCloseOutBox(closeOut, { pressLabel: null }),
      renderCloseOutBox(closeOut),
      'an absent label changes nothing',
    );
  });

  test('every close-out hook close-out.js drives survives on the task page', () => {
    const html = render('running-blocked-repeat', 'owner');
    for (const hook of ['data-testid="run-evidence-closeout"', 'data-action="closeout-press"', 'data-pr-url=', 'data-head-sha=', 'data-issue-id=', 'data-source=', 'data-url-key=', 'data-issue-identifier=']) {
      assert.ok(html.includes(hook), hook);
    }
  });
});
