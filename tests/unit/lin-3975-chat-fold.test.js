/**
 * LIN-3975 (PR 3): the task page's chat fold, and the proposals it stages.
 *
 *   - the fold is the owner's, behind the per-user `taskChat` flag; a member and a guest get none;
 *   - it sits under the answer and the run control, as a direct child of the page (so ticket text is never it);
 *   - its turns are propose-only on the wire (`propose: true`), and the route reads the flag as a boolean;
 *   - the client finds its controls by hook at init, before any transcript renders (LIN-3385);
 *   - a chat proposal for the task's runs reaches the run control, with its reason (the prompt's first line).
 *
 * Run with: node --test tests/unit/lin-3975-chat-fold.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderTaskPage } from '../../lib/render-task-page.js';
import { renderTaskChatFold } from '../../lib/render-task-chat.js';
import { buildPromptOpts } from '../../lib/render-prompt-opts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, '../..', rel), 'utf8');
const NOW = new Date('2026-10-26T12:00:00.000Z');
const UUID = '11111111-2222-3333-4444-555555555555';
const PROMPT_OPTS = buildPromptOpts({ openRouterSource: 'env', featureFlags: { runControls: true }, isLocalhost: false });

function model(over = {}) {
  return {
    identifier: 'LIN-50',
    title: 'Build the task page',
    issueId: UUID,
    tracker: { state: { name: 'In Progress', type: 'started' }, url: null, parent: null, subtasks: [], blockedBy: [] },
    status: 'idle',
    sentence: 'Nothing has run yet.',
    sentenceAt: null,
    readyHeader: null,
    live: false,
    finished: false,
    question: null,
    sessions: [],
    guesses: ['plan'],
    nextStep: { kind: 'plan', label: 'Plan', why: 'usual', failed: false },
    stages: [],
    summary: null,
    brief: null,
    recap: null,
    contextMiss: null,
    evidence: null,
    description: null,
    comments: [],
    details: null,
    ...over,
  };
}

function page(m, viewer, { taskChat = false, promptOpts = PROMPT_OPTS } = {}) {
  return renderTaskPage(m, {
    viewer,
    urlKey: 'acme',
    binding: { source: 'linear' },
    stateUrl: `/workspace/acme/api/task/LIN-50/state?issueId=${UUID}`,
    now: NOW,
    pageOptions: { deployInfo: {}, featureFlags: { taskChat }, workspaces: [] },
    promptOpts: viewer === 'owner' ? promptOpts : null,
  });
}

/** The page's `data-run-opts`, decoded (as the run control reads it). */
function runOptsOf(html) {
  const raw = /data-testid="task-page-run-control" data-run-opts="([^"]*)"/.exec(html);
  if (!raw) return null;
  const decoded = raw[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(decoded);
}

/** The fold's own `data-task-chat-opts`, decoded. */
function foldOptsOf(html) {
  const raw = /data-testid="task-page-chat-fold" data-task-chat-root data-task-chat-opts="([^"]*)"/.exec(html)
    || /data-task-chat-root data-task-chat-opts="([^"]*)" data-testid="task-page-chat-fold"/.exec(html);
  if (!raw) return null;
  const decoded = raw[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(decoded);
}

// ─── who gets the fold ───────────────────────────────────────────────────────

describe('LIN-3975 — the chat fold is the owner\'s, behind the taskChat flag', () => {
  test('the owner with the flag gets the fold, propose-only, for this task', () => {
    const html = page(model(), 'owner', { taskChat: true });
    assert.match(html, /data-testid="task-page-chat-fold"/);
    const opts = foldOptsOf(html);
    assert.equal(opts.propose, true, 'every turn proposes');
    assert.equal(opts.defaultTask, 'LIN-50', 'the task is the page\'s own');
    assert.equal(opts.urlKey, 'acme');
    assert.equal(opts.savedChatsAvailable, false, 'no saved-chat list on the fold');
  });

  test('the owner without the flag gets no fold', () => {
    assert.doesNotMatch(page(model(), 'owner', { taskChat: false }), /task-page-chat-fold/);
  });

  test('a member and a guest get no fold, even with the flag on', () => {
    assert.doesNotMatch(page(model(), 'member', { taskChat: true }), /task-page-chat-fold/);
    assert.doesNotMatch(page(model(), 'guest', { taskChat: true }), /task-page-chat-fold/);
  });

  test('the fold sits under the answer and the run control, as a direct child of the page, before the question card', () => {
    const html = page(model(), 'owner', { taskChat: true });
    const answer = html.indexOf('data-testid="task-page-answer"');
    const run = html.indexOf('data-testid="task-page-run"');
    const fold = html.indexOf('data-testid="task-page-chat-fold"');
    const stages = html.indexOf('data-testid="task-page-track-mount"');
    assert.ok(answer > 0 && run > answer && fold > run && stages > fold, 'answer, then run control, then the fold, then the stages');
    assert.match(html, /<\/section>\s*<details class="task-chat-fold" data-testid="task-page-chat-fold"/, 'a direct child of main, after the run section');
  });

  test('the fold\'s hooks are the shared client\'s, and it is not auto-mounted (only the standalone page is)', () => {
    const fold = renderTaskChatFold({ urlKey: 'acme', identifier: 'LIN-50', source: null });
    assert.match(fold, /data-task-chat-root/);
    assert.doesNotMatch(fold, /data-task-chat-auto/);
    for (const hook of ['id', 'question', 'send', 'transcript', 'empty']) {
      assert.match(fold, new RegExp(`data-task-chat="${hook}"`), hook);
    }
  });

  test('both viewers load the chat client and its sheets, so the head stays byte-identical', () => {
    for (const viewer of ['owner', 'guest']) {
      const html = page(model(), viewer, { taskChat: true });
      assert.match(html, /<script src="\/task-chat\.js"/, viewer);
      assert.match(html, /<link rel="stylesheet" href="\/task-chat\.css">/, viewer);
    }
  });
});

// ─── the wire: propose-only, and the boolean ─────────────────────────────────

describe('LIN-3975 — the fold\'s turns are propose-only on the wire', () => {
  test('the client sends propose from the fold, and only then', () => {
    const src = read('public/task-chat.js');
    assert.match(src, /var propose = data\.propose === true;/);
    assert.match(src, /if \(propose\) turnBody\.propose = true;/);
  });

  test('the route reads the flag as a boolean, and a propose turn needs the proposal stores', () => {
    const src = read('routes/task-chat.js');
    assert.match(src, /const propose = req\.body\?\.propose === true;/);
    assert.match(src, /if \(runScoped \|\| propose\) \{\n\s+if \(!dispatchQueueStore \|\| !agentStatusStore \|\| !runProposalsStore\)/);
    assert.match(src, /\.\.\.\(runScoped \|\| propose \? \{ followUpMode: 'propose', onProposal: persistProposal \} : \{\}\)/);
  });
});

// ─── mounting and wiring order ───────────────────────────────────────────────

describe('LIN-3975 — the fold is wired before the first Markdown render, and its hooks are read once', () => {
  test('task-page.js mounts the fold, from its direct child, before the first Markdown render in init', () => {
    const src = read('public/task-page.js');
    const init = src.slice(src.indexOf('  function init(doc) {'), src.indexOf('    function toggle(row) {'));
    const mount = init.indexOf('window.TaskChat.init(chatFold, foldOpts)');
    const markdown = init.search(/enhanceContextMarkdown\(|enhanceMarkdown\(/);
    assert.ok(mount > 0, 'the fold is mounted in init');
    assert.match(init, /doc\.querySelector\('\[data-testid="task-page"\] > \[data-testid="task-page-chat-fold"\]'\)/);
    assert.ok(markdown > mount, 'and that is before the first Markdown render');
  });

  test('TaskChat finds every hook in init, before any transcript render, and never queries the page again', () => {
    const src = read('public/task-chat.js');
    const init = src.slice(src.indexOf('  function init(root, opts) {'), src.indexOf('  function mountStandalone() {'));
    const lastHook = init.lastIndexOf("= hook('");
    const firstRender = init.search(/window\.ChatUI\.(appendMessage|renderMarkdownText)\(|appendBubble\(/);
    assert.ok(lastHook > 0 && firstRender > lastHook, 'every hook is read before the first render');
    assert.doesNotMatch(init.replace(/li\.querySelector|pill\.querySelector/g, ''), /\bdocument\.(getElementById|querySelector)/, 'no page-wide lookup inside init');
  });

  test('the standalone page is the only auto-mounted root', () => {
    const src = read('public/task-chat.js');
    assert.match(src, /document\.querySelectorAll\('\[data-task-chat-auto\]'\)/);
    assert.match(read('lib/render-task-chat.js'), /data-task-chat-auto/);
  });
});

// ─── the proposals the run control stages ────────────────────────────────────

describe('LIN-3975 — a chat proposal for the task\'s runs is staged in the run control', () => {
  test('the owner\'s run control carries the pending proposals, with the reason (the first line)', () => {
    const html = page(model({ proposals: [{ id: 'prop-1', runId: 'run-9', reason: 'Please post a status update.' }] }), 'owner', { taskChat: true });
    const opts = runOptsOf(html);
    assert.deepEqual(opts.proposals, [{ id: 'prop-1', runId: 'run-9', reason: 'Please post a status update.' }]);
  });

  test('with no pending proposals the run control carries none', () => {
    assert.deepEqual(runOptsOf(page(model(), 'owner', { taskChat: true })).proposals, []);
  });

  test('a member or guest has no run control, so no proposals reach them', () => {
    assert.equal(runOptsOf(page(model({ proposals: [{ id: 'p', runId: 'r', reason: 'x' }] }), 'member', { taskChat: true })), null);
  });

  test('the route stages only pending proposals, for the owner, from the runs the page links', () => {
    const src = read('routes/task-page.js');
    assert.match(src, /runProposalsStore\.list\(urlKey, runId\)/);
    assert.match(src, /filter\(p => p && p\.status === 'proposed'\)/);
    assert.match(src, /const model = owner \? \{ \.\.\.result\.model, proposals: await pendingProposalsOf\(workspace\.urlKey, result\.model\) \} : result\.model;/);
  });

  test('the run control names what Apply does, and Apply and Decline post to the run page\'s own endpoints', () => {
    const src = read('public/prompt-section.js');
    assert.match(src, /Apply resumes that session on its own harness and model\. Change does not apply to it\./);
    assert.match(src, /\/api\/run\/\$\{encodeURIComponent\(runId\)\}\/proposals\/\$\{encodeURIComponent\(id\)\}/);
    assert.match(src, /case 'apply-proposal':/);
    assert.match(src, /case 'decline-proposal':/);
  });
});
