/**
 * LIN-4071 (piece C of LIN-4068) — `deriveHeader` writes the sentence only; the page's status, pill, poll stop and run box
 * read the gathered task state; the browser holds no copy of the finished or subtree rule.
 *
 * Witnesses, each run through the real readers and each observed failing on the unchanged code before the change:
 *
 *   1. deriveHeader and the page model carry no status (the ladder's word is not a state any reader takes), and the
 *      sentence is written from the live facts first, then the finished word;
 *   2. the page's status and the poll's stop follow the gathered state: a Done task whose own run is live loads and answers
 *      running (the poll keeps going), a Done task with nothing live stops; a Done task with open subtasks is unsettled until
 *      the held set says, and a leaf's own Done word is final;
 *   3. a parent whose subtask needs attention names it on `/state`, and a finished task's `/state` sentence says it finished;
 *   4. the source scans: no browser or route copy of `row.finished`, `row.stateWord`, `row.container` or `row.attention`,
 *      and no reader of the page model's `status` in lib, routes or public.
 *
 * Run with: node --test tests/unit/lin-4071-retire-derive-header.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskPageLoader, deriveHeader, buildTaskPageModel } from '../../lib/task-page-loader.js';
import { createTaskPageRoutes } from '../../routes/task-page.js';
import { enrichLoop, deriveSessionWaiting, deriveSessionDecisions } from '../../routes/dashboard.js';
import { registerProvider } from '../../lib/providers/registry.js';
import '../../lib/providers/linear/index.js';
import { stateBodyOf, stateIssue, failedStageLoop, STATE_NOW, STATE_URL_KEY } from '../fixtures/state-route.js';
import { heldTaskFacts, heldLoaderDeps } from '../fixtures/held-task-facts.js';
import * as taskState from '../../lib/task-state.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

// ── 1. deriveHeader writes the sentence only ─────────────────────────────────

describe('LIN-4071 — deriveHeader writes the sentence and nothing a reader takes as state', () => {
  test('deriveHeader returns the sentence and its moment, with no status (the ladder decides no state)', () => {
    const header = deriveHeader({
      sessions: [], tracker: { state: { type: 'completed' }, finishedAt: '2026-10-30T10:00:00.000Z' }, now: STATE_NOW,
    });
    assert.deepEqual(Object.keys(header).sort(), ['sentence', 'sentenceAt']);
    assert.equal(header.sentence, 'Finished 1 day ago.');
  });

  test('the page model carries no status: a reader that wants the task state takes taskState or a gathered fact', () => {
    const model = buildTaskPageModel({
      identifier: 'LIN-1', loops: [], ctx: null, enrichLoop, deriveSessionWaiting, now: STATE_NOW,
    });
    assert.equal('status' in model, false, 'the page model still carries the ladder word `status`');
  });
});

// ── 2. the poll follows the gathered state ───────────────────────────────────

describe('LIN-4071 — a Done task with a running run is running on /state, so the poll keeps going', () => {
  test('a completed task whose own run is running answers running (not done), and the poll does not stop', async () => {
    const running = failedStageLoop('LIN-100', { loopId: 'r1' });
    const body = (await stateBodyOf({
      issues: [stateIssue('LIN-100', 'completed')],
      loops: [{ ...running, agentState: 'running', terminalStatus: null, terminalCompletedAt: null, resolvedAt: null, historyStatus: 'taken' }],
      identifier: 'LIN-100',
    })).body;
    assert.equal(body.taskState.state, 'running', 'the gathered state is running');
    assert.equal(body.status, 'running', 'the poll status follows the gathered state, so a Done task with a live run keeps polling');
  });

  test('a Done task\'s state reply says it finished, as the page load does (not "No session running")', async () => {
    const body = (await stateBodyOf({
      issues: [{ ...stateIssue('LIN-102', 'completed'), completedAt: '2026-10-30T10:00:00.000Z' }],
      loops: [],
      identifier: 'LIN-102',
    })).body;
    assert.match(body.headerHtml, /Finished 1 day ago\./, 'the poll repaints the finished sentence');
    assert.doesNotMatch(body.headerHtml, /No session running/);
  });

  test('a Done task whose last run failed answers done, and its poll stops (history, not a live fact)', async () => {
    const body = (await stateBodyOf({
      issues: [stateIssue('LIN-101', 'completed')],
      loops: [failedStageLoop('LIN-101')],
      identifier: 'LIN-101',
    })).body;
    assert.equal(body.taskState.state, 'done');
    assert.equal(body.status, 'done');
  });
});

/** The private task page's HTML for `task` (page load: the tracker read, then the held set), warm holder over `issues`. */
async function privatePageOf({ issues, loops, task, writtenAt = STATE_NOW }) {
  const holder = heldTaskFacts({ urlKey: STATE_URL_KEY, issues, now: writtenAt, readAt: STATE_NOW });
  const ctxIssue = issues.find((i) => i.identifier === task);
  const ctx = {
    issue: { id: ctxIssue.id, identifier: ctxIssue.identifier, title: ctxIssue.title, state: ctxIssue.state, labels: [], blockedBy: [] },
    parent: null,
    children: issues.filter((i) => i.parent?.id === ctxIssue.id).map((i) => ({ id: i.id, identifier: i.identifier, title: i.title, state: i.state })),
    comments: [],
  };
  const name = `lin-4071-provider-${Math.random().toString(36).slice(2)}`;
  const provider = registerProvider({
    name, ui: { inlineEdit: false, inlineCreate: false }, supports: () => true,
    fetchRecommendationContext: async () => ctx,
    fetchIssueComments: async () => [], fetchIssueFields: async () => null, fetchProjects: async () => ({ projects: [] }),
  });
  const loader = createTaskPageLoader({
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, deriveSessionDecisions,
    getLoopsForIssue: async (_urlKey, id) => loops.filter((l) => l.issueIdentifier === id),
    getLoopsForIssues: async (_urlKey, ids) => loops.filter((l) => ids.includes(l.issueIdentifier)),
    now: () => STATE_NOW,
    ...heldLoaderDeps(holder),
  });
  const router = createTaskPageRoutes({
    workspaceFromUrl: (req, res, next) => next(), getOpenRouterSource: () => 'env', getDeployInfo: () => ({}),
    loader, workspaceOwnerCheck: async () => ({ status: 'owner' }), taskFacts: holder, refreshTaskFacts: null, now: () => STATE_NOW,
  });
  const layer = router.stack.find((l) => l.route?.path === '/workspace/:urlKey/task/:identifier' && l.route.methods.get);
  const req = {
    session: { workspaces: [], features: {}, accountId: 'acct-1' }, workspace: { urlKey: STATE_URL_KEY, id: 'ws-1', provider: provider.name, accessToken: 't' },
    params: { urlKey: STATE_URL_KEY, identifier: task }, query: {}, get: () => 'localhost',
  };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; }, set() { return this; } };
  await layer.route.stack[layer.route.stack.length - 1].handle(req, res, (err) => { if (err) throw err; });
  return res.body;
}

describe('LIN-4071 — a page with no complete held state is unsettled only while its subtasks are unknown', () => {
  const COLD = new Date(STATE_NOW.getTime() - 10 * 60 * 1000);

  test('a cold holder, a parent with a subtask: the page is unsettled, its Done word is not final, and the first poll comes soon', async () => {
    const html = await privatePageOf({
      issues: [stateIssue('LIN-130', 'completed'), stateIssue('LIN-132', 'started', { parent: 'LIN-130' })], loops: [], task: 'LIN-130',
      writtenAt: COLD,
    });
    assert.match(html, /data-testid="task-page"[^>]*data-settled="false"/, 'the page says it is unsettled');
    const status = String(html).match(/data-testid="task-page"[^>]*?data-status="([^"]*)"/)?.[1];
    assert.notEqual(status, 'done', 'a Done word over open subtasks is a guess, so it never stops the poll');
  });

  test('a cold holder, a leaf: the page\'s own read is the whole picture, so it is settled and reads done', async () => {
    const html = await privatePageOf({ issues: [stateIssue('LIN-131', 'completed')], loops: [], task: 'LIN-131', writtenAt: COLD });
    assert.doesNotMatch(html, /data-settled=/, 'a leaf carries no unsettled marker');
    assert.equal(String(html).match(/data-testid="task-page"[^>]*?data-status="([^"]*)"/)?.[1], 'done');
  });

  test('a complete holder: the page is settled, with no unsettled marker', async () => {
    const html = await privatePageOf({ issues: [stateIssue('LIN-133', 'completed')], loops: [], task: 'LIN-133' });
    assert.doesNotMatch(html, /data-settled=/, 'a settled page carries no marker');
  });
});

describe('LIN-4071 — the page load, not only /state, stops polling on the gathered state', () => {
  test('a Done task with a running run loads with the running status, so its page keeps polling', async () => {
    const html = await privatePageOf({
      issues: [stateIssue('LIN-120', 'completed')],
      loops: [{ ...failedStageLoop('LIN-120', { loopId: 'r2' }), agentState: 'running', terminalStatus: null, terminalCompletedAt: null, resolvedAt: null, historyStatus: 'taken' }],
      task: 'LIN-120',
    });
    const status = String(html).match(/data-testid="task-page"[^>]*?data-status="([^"]*)"/)?.[1];
    assert.equal(status, 'running', `the page loaded with ${status}, so its poll would stop on a live run`);
  });
});

// ── 3. the subtask line comes from /state ────────────────────────────────────

describe('LIN-4071 — a parent names its subtask that needs attention on /state', () => {
  test('a parent whose subtask failed carries the attention line on its state reply', async () => {
    const body = (await stateBodyOf({
      issues: [stateIssue('LIN-110', 'started'), stateIssue('LIN-111', 'started', { parent: 'LIN-110' })],
      loops: [failedStageLoop('LIN-111')],
      identifier: 'LIN-110',
    })).body;
    assert.equal(body.attention?.identifier, 'LIN-111', '/state names the failed subtask');
    assert.equal(body.attention?.state, 'failed');
    assert.equal(body.attention?.lead, 'A subtask failed');
  });
});

// ── 4. source scans ──────────────────────────────────────────────────────────

/** The source with its comments removed: the scans judge code, not the prose that explains it. */
function codeOf(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : filesUnder(full);
    return /\.(js|mjs)$/.test(name) ? [full] : [];
  });
}

describe('LIN-4071 source scans', () => {
  test('the browser and the routes hold no copy of the row record fields the gather replaced', () => {
    for (const dir of ['routes', 'public']) {
      for (const file of filesUnder(join(repo, dir))) {
        const source = codeOf(readFileSync(file, 'utf8'));
        assert.doesNotMatch(source, /\brow\.(finished|stateWord|container|attention)\b/, `${file} reads a retired row field`);
      }
    }
  });

  test('no reader takes the page model\'s status as a state in lib, routes or public', () => {
    for (const dir of ['lib', 'routes', 'public']) {
      for (const file of filesUnder(join(repo, dir))) {
        const source = codeOf(readFileSync(file, 'utf8'));
        assert.doesNotMatch(source, /\bmodel\.status\b/, `${file} reads model.status (the ladder's word)`);
      }
    }
  });

  test('deriveHeader is not read for a status anywhere in lib, routes or public', () => {
    for (const dir of ['lib', 'routes', 'public']) {
      for (const file of filesUnder(join(repo, dir))) {
        const source = codeOf(readFileSync(file, 'utf8'));
        assert.doesNotMatch(source, /deriveHeader\([^)]*\)\.status/, `${file} reads deriveHeader's status`);
        assert.doesNotMatch(source, /\{\s*status\b[^}]*\}\s*=\s*deriveHeader\(/, `${file} destructures deriveHeader's status`);
      }
    }
  });
});

// ── 5. the page status projection exists and is the one mapping ──────────────

describe('LIN-4071 — the page status is one projection of the gathered state', () => {
  test('pageStatusOf maps each gathered state to the status the page and the poll carry', () => {
    assert.equal(typeof taskState.pageStatusOf, 'function', 'pageStatusOf is exported from lib/task-state.js');
    const status = (state, extra = {}) => taskState.pageStatusOf({ state, ...extra });
    assert.equal(status('needs-you'), 'waiting');
    assert.equal(status('parked'), 'waiting', 'a parked wait keeps the waiting status the client keys on (LIN-4038)');
    assert.equal(status('failed'), 'failed');
    assert.equal(status('running'), 'running');
    assert.equal(status('queued'), 'running');
    assert.equal(status('done'), 'done');
    assert.equal(status('next'), 'idle');
    assert.equal(status('todo'), 'idle');
    assert.equal(status('backlog'), 'idle');
    assert.equal(status('done', { unsettled: true }), 'idle', 'a Done word over open subtasks is a guess, and never stops the poll');
    assert.equal(status('done', { provisional: true }), 'done', 'a leaf\'s provisional Done is its own read, the whole picture');
    assert.equal(taskState.pageStatusOf(null), 'idle');
  });
});
