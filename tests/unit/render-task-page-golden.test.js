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
 *   - the page order (answer → progress → brief/recap → details → share);
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
import { buildTaskPageModel } from '../../lib/task-page-loader.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

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

function model(name) {
  const base = { identifier: 'LIN-50', enrichLoop, deriveSessionWaiting, now: NOW };
  switch (name) {
    case 'running-blocked-repeat':
      return buildTaskPageModel({ ...base, loops: RUNNING_LOOPS, ctx: ctx(), evidence: EVIDENCE,
        brief: { brief: '## Brief\nBuild it.', model: 'm', generatedAt: '2026-10-06T09:00:00.000Z' },
        recap: { recap: { done: [{ item: 'plan', evidence: 'comment' }], pending: [], deviations: [] }, model: 'm', generatedAt: '2026-10-06T09:00:00.000Z' } });
    case 'waiting':
      return buildTaskPageModel({ ...base, loops: [done({ loopId: 'plan-1', kind: 'plan' }), loop({ loopId: 'impl-2', wakeMarker: 'blocked', waitingMessage: '[blocked] which API key?', feedback: [{ message: '[blocked] which API key?' }] })], ctx: ctx() });
    case 'done':
      return buildTaskPageModel({ ...base, loops: [done({ loopId: 'impl-1' }), loop({ loopId: 'rev-stale', kind: 'review' })], ctx: ctx({ stateType: 'completed', stateName: 'Done' }), evidence: EVIDENCE });
    case 'no-sessions':
      return buildTaskPageModel({ ...base, loops: [], ctx: ctx({ stateType: 'unstarted', stateName: 'Todo' }) });
    default:
      throw new Error(name);
  }
}

const CASES = ['running-blocked-repeat', 'waiting', 'done', 'no-sessions'];

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
  test('page order: answer → pull request → progress → brief/recap → docs → details → share', () => {
    const html = render('running-blocked-repeat');
    const at = (testid) => html.indexOf(`data-testid="${testid}"`);
    const order = ['task-page-answer', 'task-page-pr-mount', 'task-page-track', 'task-page-context', 'task-page-docs', 'task-page-details', 'task-page-share-slot'].map(at);
    assert.ok(order.every(i => i > 0), JSON.stringify(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  test('every session is its own row, oldest-first; running and blocked start open', () => {
    const html = renderTaskTrack(model('running-blocked-repeat'), { now: NOW });
    const rows = [...html.matchAll(/<li class="([^"]*)" data-testid="task-page-step" data-status="[^"]*" data-state="([^"]*)" data-kind="[^"]*" data-loop-id="([^"]*)"/g)]
      .map(m => ({ id: m[3], state: m[2], open: m[1].includes('sess-run--expanded') }));
    assert.deepEqual(rows.map(r => r.id), ['plan-1', 'impl-1', 'rev-1', 'impl-2', 'impl-3', 'rev-2', 'wake-1']);
    assert.deepEqual(rows.map(r => r.state), ['done', 'done', 'done', 'continued', 'done', 'running', 'queued']);
    assert.deepEqual(rows.filter(r => r.open).map(r => r.id), ['rev-2'], 'the replied-to block is closed; the running review is open');
    assert.equal((html.match(/aria-expanded="true"/g) || []).length, 1, 'only the open row says so');
  });

  test('a queued session reads queued on its face, not running', () => {
    const html = renderTaskTrack(model('running-blocked-repeat'), { now: NOW });
    const row = html.slice(html.indexOf('data-loop-id="wake-1"'));
    assert.match(html, /data-status="queued" data-state="queued" data-kind="wake"/);
    assert.match(row, /status-pill--queued" data-testid="session-run-status"><span class="status-pill__dot" aria-hidden="true"><\/span>queued</);
    assert.doesNotMatch(row, /status-pill--running/);
  });

  test('the task evidence renders once, in the Pull request section; the track has no slot', () => {
    const html = render('running-blocked-repeat');
    assert.equal((html.match(/data-testid="run-evidence"/g) || []).length, 1, 'evidence once');
    assert.equal((html.match(/data-evidence-slot/g) || []).length, 0, 'no evidence slot in any row');
    assert.equal((html.match(/data-testid="task-page-pr-mount"/g) || []).length, 1, 'one PR section');
    // The section sits before Progress, so it is outside every repainted mount.
    assert.ok(html.indexOf('data-testid="task-page-pr-mount"') < html.indexOf('data-testid="task-page-track-mount"'));
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

  test('guesses: after the furthest stage reached; none once done', () => {
    assert.match(renderTaskTrack(model('running-blocked-repeat'), { now: NOW }), /data-testid="task-page-guess" data-kind="close-out"/);
    assert.doesNotMatch(renderTaskTrack(model('done'), { now: NOW }), /task-page-guess/);
    const none = renderTaskTrack(model('no-sessions'), { now: NOW });
    assert.equal((none.match(/data-testid="task-page-guess"/g) || []).length, 5);
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
