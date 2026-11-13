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
 * public/observation.js is a native ES module (LIN-4463 piece 4), imported fresh through `importWorld` over the fake
 * DOM. Its workspace data and URL scope come from `init()`, which runs on DOMContentLoaded as it does on a page, so the
 * workspace list, the scope and the chips are the page's own.
 *
 * Run with: node --test tests/unit/observation-card-words.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionPayload } from '../../routes/dashboard-feed.js';
import { stageLabel } from '../../lib/run-view.js';
import { loadCommonWindow } from '../fixtures/client-common.js';
import { importWorld } from './helpers/import-world.js';
import { clickOn, fireDOMContentLoaded } from './helpers/client-world.js';

const escapeHtml = (str) => (str == null ? '' : String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

/**
 * observation.js imported into a world and initialised as a page initialises it: the workspace data is the page's own
 * (`window.__OBSERVATION_DATA__`), the URL scope is `search` (a query string without its `?`), and DOMContentLoaded runs
 * init(). `chipUrlKeys` draws the workspace chips that init() wires. The pollers never settle (their fetch and api never
 * resolve), so no timer or request outlives a test. The caller restores the world: `t.after(() => world.restore())`.
 */
async function loadPage({ workspaces, search = '', chipUrlKeys = [] }) {
  const common = loadCommonWindow();
  const world = await importWorld({
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      renderStatusPill: common.renderStatusPill,
      renderSegmentBar: common.renderSegmentBar,
      ChatUI: { appendOptions() {}, resolveCaption: () => '' },
      sourceQuery: () => '',
      __OBSERVATION_DATA__: { urlKey: 'acme', workspaces },
      location: { search: search ? `?${search}` : '' },
      api: () => new Promise(() => {}),
    },
    globals: {
      fetch: () => new Promise(() => {}),
      escapeHtml,
      relativeTime: (ts) => (ts ? `rel(${ts})` : ''),
      console: { warn() {}, error() {}, log() {} },
    },
  });
  const page = await world.importPage('observation.js');
  if (chipUrlKeys.length) {
    const chips = world.document.createElement('div');
    chips.id = 'obs-chips';
    for (const urlKey of chipUrlKeys) {
      const chip = world.document.createElement('button');
      chip.setAttribute('class', 'obs-chip is-on');
      chip.setAttribute('data-ws', urlKey);
      chips.appendChild(chip);
    }
    world.document.body.appendChild(chips);
  }
  await fireDOMContentLoaded(world.document);
  return { world, page };
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
function paint(page, payload) {
  const head = { innerHTML: '' };
  const li = { querySelector: (sel) => (sel === '.obs-session-head' ? head : null) };
  page.fillSessionHead(li, payload);
  return head.innerHTML;
}

const visibleText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const pillWord = (html) => /<span class="status-pill__label">([^<]*)<\/span>/.exec(html)?.[1] ?? null;
const summaryText = (html) => visibleText(/<span class="obs-session-summary">([\s\S]*?)<\/span>\s*(?:<span class="obs-session-meta-line"|<div class="obs-progress-row")/.exec(html)?.[1] ?? '');

describe('a card says its state once (LIN-3983 PR 2)', () => {
  for (const [name, make] of Object.entries(CARDS)) {
    test(`${name}: the summary line does not repeat the pill's word`, async (t) => {
      const { world, page } = await loadPage({ workspaces: [WS] });
      t.after(() => world.restore());
      const html = paint(page, buildSessionPayload(make(), WS, false));
      const word = pillWord(html);
      assert.ok(word, `${name} has a pill`);
      const summary = summaryText(html);
      assert.ok(summary.length > 0, `${name} has a summary line`);
      assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(summary), `"${summary}" repeats the pill's word "${word}"`);
    });

    test(`${name}: no visible text carries a runner marker or a bracketed option list`, async (t) => {
      const { world, page } = await loadPage({ workspaces: [WS] });
      t.after(() => world.restore());
      const html = paint(page, buildSessionPayload(make(), WS, false));
      const text = visibleText(html);
      assert.ok(!/\[(blocked|done|working)\]/.test(text), `marker in "${text}"`);
      assert.ok(!/\[[^\]]+ \/ [^\]]+\]/.test(text), `bracketed option list in "${text}"`);
    });
  }
});

describe('the pill words are the task page\'s own (LIN-3983 PR 2)', () => {
  test('a running, waiting, finished, failed and idle card read running, waiting, done, failed, idle', async (t) => {
    const { world, page } = await loadPage({ workspaces: [WS] });
    t.after(() => world.restore());
    const word = (name) => pillWord(paint(page, buildSessionPayload(CARDS[name](), WS, false)));
    assert.equal(word('running'), 'running');
    assert.equal(word('waitingPlain'), 'waiting');
    assert.equal(word('done'), 'done');
    assert.equal(word('failed'), 'failed');
    assert.equal(word('idle'), 'idle');
  });
});

describe('the answer choices and the question (LIN-3983 PR 2)', () => {
  test('the choices show while the producer question is open, and are dropped once it is not', async (t) => {
    const { world, page } = await loadPage({ workspaces: [WS] });
    t.after(() => world.restore());
    const payload = buildSessionPayload(CARDS.waitingWithChoices(), WS, false);
    page.setOpenLoopIds(new Set(['w']));
    assert.match(paint(page, payload), /Answer with Email link · Linear OAuth/);
    page.setOpenLoopIds(new Set());
    const closed = paint(page, payload);
    assert.ok(!closed.includes('Email link'), 'a question that is no longer open is not offered as a choice');
    assert.match(visibleText(closed), /Which sign-in method should I build\?/, 'the question itself still reads');
  });

  test('the sentence is the question with its marker taken out, not the marker', async (t) => {
    const { world, page } = await loadPage({ workspaces: [WS] });
    t.after(() => world.restore());
    const html = paint(page, buildSessionPayload(CARDS.waitingPlain(), WS, false));
    assert.equal(summaryText(html).split(' reply')[0], 'Which sign-in method should I build?');
  });
});

describe('names and places (LIN-3983 PR 2)', () => {
  test('an untitled run is named "Untitled run", never by its id', async (t) => {
    const { world, page } = await loadPage({ workspaces: [WS] });
    t.after(() => world.restore());
    const payload = buildSessionPayload(CARDS.untitled(), WS, false);
    const text = visibleText(paint(page, payload));
    assert.match(text, /Untitled run/);
    assert.ok(!text.includes(`run ${payload.sessionId.slice(0, 8)}`), 'no id-based name');
    assert.ok(!/\brun S\b/.test(text), 'the session id is not used as a name');
  });

  test('the workspace name shows only when more than one workspace is showing', async (t) => {
    // Two pages in turn, each restored before the next loads: one page's globals must not be live under the other.
    const one = await loadPage({ workspaces: [WS], search: 'scope=all' });
    try {
      assert.ok(!paint(one.page, buildSessionPayload(CARDS.running(), WS, false)).includes('obs-meta-ws'));
    } finally {
      one.world.restore();
    }
    const two = await loadPage({ workspaces: [WS, { urlKey: 'other', name: 'Other' }], search: 'scope=all' });
    t.after(() => two.world.restore());
    assert.match(paint(two.page, buildSessionPayload(CARDS.running(), WS, false)), /obs-meta-ws/);
  });

  test('two connected workspaces under This workspace show one, so no card names its workspace', async (t) => {
    const { world, page } = await loadPage({ workspaces: [WS, { urlKey: 'other', name: 'Other' }] });
    t.after(() => world.restore());
    assert.ok(!paint(page, buildSessionPayload(CARDS.running(), WS, false)).includes('obs-meta-ws'), 'connected is not showing');
  });

  test('All workspaces with the other workspace chipped off shows one, so no card names its workspace', async (t) => {
    const { world, page } = await loadPage({ workspaces: [WS, { urlKey: 'other', name: 'Other' }], search: 'scope=all', chipUrlKeys: ['other'] });
    t.after(() => world.restore());
    // The chip is the page's own control: its click hides the workspace, as a person's press does.
    // The control is checked first: with both workspaces showing, the name is there to be hidden.
    assert.match(paint(page, buildSessionPayload(CARDS.running(), WS, false)), /obs-meta-ws/, 'both workspaces show before the chip is pressed');
    const chips = world.document.getElementById('obs-chips');
    await clickOn(chips, chips.querySelector('[data-ws="other"]'));
    assert.ok(!paint(page, buildSessionPayload(CARDS.running(), WS, false)).includes('obs-meta-ws'));
  });

  test('a running card names its stage in words and how long it has run, not in capitals', async (t) => {
    const { world, page } = await loadPage({ workspaces: [WS] });
    t.after(() => world.restore());
    const html = paint(page, buildSessionPayload(CARDS.running(), WS, false));
    assert.ok(summaryText(html).startsWith(stageLabel('implementation')), `summary "${summaryText(html)}"`);
    assert.ok(!/REVIEW|IMPLEMENTATION/.test(html), 'the stage is a plain word');
  });
});

describe('a failed card keeps its summarise control (LIN-3983 PR 2)', () => {
  test('a failed run says where it stopped, and still offers to summarise it', async (t) => {
    const { world, page } = await loadPage({ workspaces: [WS] });
    t.after(() => world.restore());
    const html = paint(page, buildSessionPayload(CARDS.failed(), WS, false));
    assert.equal(pillWord(html), 'failed');
    assert.match(html, /obs-summary-gen/, 'the explicit summarise control is still there');
    assert.match(visibleText(html), /last activity/);
  });
});
