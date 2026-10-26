/**
 * LIN-3983 PR 2: a card says one thing once, in words.
 *
 * Each card is built from the real `buildSessionPayload` (the feed's own payload) and painted by the real
 * `fillSessionHead` into a fake head node, so these checks read what a person sees:
 *   - the state is the pill, and the summary line never repeats the pill's words;
 *   - no visible text carries a runner marker ([blocked] / [done] / [working]) or a bracketed option list;
 *   - an untitled run is named "Untitled run", never by its id;
 *   - the workspace name shows only when more than one workspace is showing;
 *   - the answer choices show only while the producer's question is open.
 *
 * Run with: node --test tests/unit/observation-card-words.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSessionPayload } from '../../routes/dashboard-feed.js';
import { stageLabel } from '../../lib/run-view.js';
import { loadCommonWindow } from '../fixtures/client-common.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBSERVATION_JS_SRC = readFileSync(join(__dirname, '../../public/observation.js'), 'utf8');
const escapeHtml = (str) => (str == null ? '' : String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

function makeSandbox(workspaces) {
  const common = loadCommonWindow();
  const sandbox = {
    module: { exports: {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }), renderStatusPill: common.renderStatusPill, renderSegmentBar: common.renderSegmentBar, ChatUI: { appendOptions() {}, resolveCaption: () => '' }, sourceQuery: () => '' },
    document: { addEventListener() {}, createElement: () => ({}), getElementById: () => null },
    escapeHtml,
    relativeTime: (ts) => (ts ? `rel(${ts})` : ''),
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(OBSERVATION_JS_SRC, sandbox, { filename: 'observation.js' });
  vm.runInContext(`observationData = { urlKey: "acme", workspaces: ${JSON.stringify(workspaces)} };`, sandbox);
  return sandbox;
}

const WS = { urlKey: 'acme', name: 'Acme' };
const RECENT = new Date(Date.now() - 60 * 1000).toISOString();
const EARLIER = new Date(Date.now() - 20 * 60 * 1000).toISOString();
const LONG_AGO = '2020-01-01T00:00:00.000Z';

function loop(over = {}) {
  return {
    loopId: 'w', lineageId: null, kind: 'implementation', followUpTo: null, sessionId: 'S',
    issueIdentifier: 'LIN-900', issueTitle: 'Remove the old route', workspaceUrlKey: 'acme', dispatchedAt: RECENT, resolvedAt: null,
    decision: null, decisionCase: [], answeredDecisions: [], withdrawal: null,
    wakeMarker: null, waitingMessage: null,
    ...over
  };
}
const anchor = (over = {}) => loop({ loopId: 'ap', lineageId: 'ap', kind: 'autopilot', sessionId: 'ap', issueIdentifier: null, issueTitle: null, ...over });
const blocked = (over = {}) => loop({ wakeMarker: 'blocked', waitingMessage: '[blocked] Which sign-in method should I build?', ...over });
const decision = { decision_id: 'd-1', question: 'Which sign-in method?', options: [{ id: 'a', label: 'Email link' }, { id: 'b', label: 'Linear OAuth' }] };

// The fixtures: every state a card can be in, each as the feed sends it.
const CARDS = {
  running: () => ({ sessionId: 'S', loops: [anchor(), loop({ loopId: 'w', kind: 'implementation', dispatchedAt: EARLIER })] }),
  waitingWithChoices: () => ({ sessionId: 'S', loops: [anchor(), blocked({ loopId: 'w', decision })] }),
  waitingPlain: () => ({ sessionId: 'S', loops: [anchor(), blocked({ loopId: 'w' })] }),
  waitingNoMessage: () => ({ sessionId: 'S', loops: [anchor(), blocked({ loopId: 'w', waitingMessage: null, wakeMarker: null, decision })] }),
  done: () => ({ sessionId: 'S', loops: [anchor({ agentState: 'complete', resolvedAt: RECENT, wakeMarker: 'done', waitingMessage: '[done] shipped' }), loop({ loopId: 'w', agentState: 'complete', resolvedAt: RECENT })] }),
  failed: () => ({ sessionId: 'S', loops: [anchor({ agentState: 'error', resolvedAt: RECENT }), loop({ loopId: 'w', agentState: 'error', resolvedAt: RECENT })] }),
  idle: () => ({ sessionId: 'S', loops: [anchor({ dispatchedAt: LONG_AGO }), loop({ loopId: 'w', dispatchedAt: LONG_AGO })] }),
  untitled: () => ({ sessionId: 'S', loops: [anchor(), loop({ loopId: 'w', issueIdentifier: null, issueTitle: null, kind: 'implementation' })] }),
};

// Paints a payload's card head with the real fillSessionHead, and returns the painted HTML.
function paint(sandbox, payload) {
  const head = { innerHTML: '' };
  const li = { querySelector: (sel) => (sel === '.obs-session-head' ? head : null) };
  sandbox.__payload = payload;
  vm.runInContext('fillSessionHead(__li, __payload)', Object.assign(sandbox, { __li: li }));
  return head.innerHTML;
}

const visibleText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const pillWord = (html) => /<span class="status-pill__label">([^<]*)<\/span>/.exec(html)?.[1] ?? null;
const summaryText = (html) => visibleText(/<span class="obs-session-summary">([\s\S]*?)<\/span>\s*(?:<span class="obs-session-meta-line"|<div class="obs-progress-row")/.exec(html)?.[1] ?? '');

describe('a card says its state once (LIN-3983 PR 2)', () => {
  for (const [name, make] of Object.entries(CARDS)) {
    test(`${name}: the summary line does not repeat the pill's word`, () => {
      const sandbox = makeSandbox([WS]);
      sandbox.__openForTest = true;
      const html = paint(sandbox, buildSessionPayload(make(), WS, false));
      const word = pillWord(html);
      assert.ok(word, `${name} has a pill`);
      const summary = summaryText(html);
      assert.ok(summary.length > 0, `${name} has a summary line`);
      assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(summary), `"${summary}" repeats the pill's word "${word}"`);
    });

    test(`${name}: no visible text carries a runner marker or a bracketed option list`, () => {
      const sandbox = makeSandbox([WS]);
      const html = paint(sandbox, buildSessionPayload(make(), WS, false));
      const text = visibleText(html);
      assert.ok(!/\[(blocked|done|working)\]/.test(text), `marker in "${text}"`);
      assert.ok(!/\[[^\]]+ \/ [^\]]+\]/.test(text), `bracketed option list in "${text}"`);
    });
  }
});

describe('the pill words are the task page\'s own (LIN-3983 PR 2)', () => {
  test('a running, waiting, finished, failed and idle card read running, waiting, done, failed, idle', () => {
    const sandbox = makeSandbox([WS]);
    const word = (name) => pillWord(paint(sandbox, buildSessionPayload(CARDS[name](), WS, false)));
    assert.equal(word('running'), 'running');
    assert.equal(word('waitingPlain'), 'waiting');
    assert.equal(word('done'), 'done');
    assert.equal(word('failed'), 'failed');
    assert.equal(word('idle'), 'idle');
  });
});

describe('the answer choices and the question (LIN-3983 PR 2)', () => {
  test('the choices show while the producer question is open, and are dropped once it is not', () => {
    const sandbox = makeSandbox([WS]);
    const payload = buildSessionPayload(CARDS.waitingWithChoices(), WS, false);
    vm.runInContext('openLoopIds = new Set(["w"])', sandbox);
    assert.match(paint(sandbox, payload), /Answer with Email link · Linear OAuth/);
    vm.runInContext('openLoopIds = new Set()', sandbox);
    const closed = paint(sandbox, payload);
    assert.ok(!closed.includes('Email link'), 'a question that is no longer open is not offered as a choice');
    assert.match(visibleText(closed), /Which sign-in method should I build\?/, 'the question itself still reads');
  });

  test('the sentence is the question with its marker taken out, not the marker', () => {
    const sandbox = makeSandbox([WS]);
    const html = paint(sandbox, buildSessionPayload(CARDS.waitingPlain(), WS, false));
    assert.equal(summaryText(html).split(' reply')[0], 'Which sign-in method should I build?');
  });
});

describe('names and places (LIN-3983 PR 2)', () => {
  test('an untitled run is named "Untitled run", never by its id', () => {
    const sandbox = makeSandbox([WS]);
    const payload = buildSessionPayload(CARDS.untitled(), WS, false);
    const text = visibleText(paint(sandbox, payload));
    assert.match(text, /Untitled run/);
    assert.ok(!text.includes(`run ${payload.sessionId.slice(0, 8)}`), 'no id-based name');
    assert.ok(!/\brun S\b/.test(text), 'the session id is not used as a name');
  });

  test('the workspace name shows only when more than one workspace is showing', () => {
    const one = makeSandbox([WS]);
    assert.ok(!paint(one, buildSessionPayload(CARDS.running(), WS, false)).includes('obs-meta-ws'));
    const two = makeSandbox([WS, { urlKey: 'other', name: 'Other' }]);
    assert.match(paint(two, buildSessionPayload(CARDS.running(), WS, false)), /obs-meta-ws/);
  });

  test('a running card names its stage in words and how long it has run, not in capitals', () => {
    const sandbox = makeSandbox([WS]);
    const html = paint(sandbox, buildSessionPayload(CARDS.running(), WS, false));
    assert.ok(summaryText(html).startsWith(stageLabel('implementation')), `summary "${summaryText(html)}"`);
    assert.ok(!/REVIEW|IMPLEMENTATION/.test(html), 'the stage is a plain word');
  });
});
