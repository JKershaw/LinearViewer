/**
 * LIN-3098 S4b — "run on my machine ›" wherever a task opens.
 *
 * Pins the link's presence and href on each surface where a signed-in person
 * opens a task, in EVERY proxy/dispatch flag state (/runner explains what to
 * turn on), and that it sits outside every collapsed section:
 *
 *   - the tree view's task detail (lib/render.js renderDetailsContent, which
 *     both the inline render and the lazy /api/detail fragment use);
 *   - the Swipe card (public/swipe.js renderCard, client-side);
 *   - the Swim popover (lib/render-swim.js).
 *
 * The server twin (lib/components/runner-link.js) and the client twin
 * (PromptSection.runnerLinkHtml) emit the same markup. Landing (signed out)
 * renders no link anywhere.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { renderDetailsContent } from '../../lib/render.js';
import { renderSwimPage } from '../../lib/render-swim.js';
import { renderRunnerLink, runnerSetupHref } from '../../lib/components/runner-link.js';
// Side-effect import: registers the Linear provider so the render fallbacks resolve.
import '../../lib/providers/linear/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_SECTION_SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');
const SWIPE_SRC = readFileSync(join(__dirname, '../../public/swipe.js'), 'utf8');

const LINK = '<a class="opened-task-runner-link" href="/workspace/ws/runner" data-testid="opened-task-runner-link">run on my machine ›</a>';
const TESTID = 'data-testid="opened-task-runner-link"';

const FLAG_STATES = [
  { proxy: false, dispatch: false },
  { proxy: true, dispatch: false },
  { proxy: false, dispatch: true },
  { proxy: true, dispatch: true },
];
const flagName = (f) => `proxy ${f.proxy ? 'on' : 'off'}, dispatch ${f.dispatch ? 'on' : 'off'}`;

const count = (html, needle) => html.split(needle).length - 1;

// Remove every element whose opening tag has a `hidden` class (balanced on
// same-name tags): what is left is what shows without expanding anything.
function stripHidden(html) {
  const open = /<([a-z][a-z0-9]*)\b[^>]*\bclass="(?:[^"]*\s)?hidden(?:\s[^"]*)?"[^>]*>/i;
  let out = html;
  let m;
  while ((m = open.exec(out))) {
    const re = new RegExp(`<(/?)${m[1]}\\b[^>]*>`, 'gi');
    re.lastIndex = m.index + m[0].length;
    let depth = 1;
    let t;
    let end = out.length;
    while ((t = re.exec(out))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) { end = t.index + t[0].length; break; }
    }
    out = out.slice(0, m.index) + out.slice(end);
  }
  return out;
}

const ISSUE = {
  id: 'issue-1',
  identifier: 'LIN-1',
  title: 'Say hello',
  description: 'A short description.',
  url: 'https://linear.app/x/issue/LIN-1',
  labels: { nodes: [] },
};

describe('the shared markup', () => {
  test('server twin: href and markup', () => {
    assert.equal(runnerSetupHref('ws'), '/workspace/ws/runner');
    assert.equal(renderRunnerLink('ws'), LINK);
  });

  test('server twin encodes the urlKey', () => {
    assert.ok(renderRunnerLink('a"b c').includes('href="/workspace/a%22b%20c/runner"'));
  });

  test('client twin (PromptSection.runnerLinkHtml) emits the same markup', () => {
    const window = { escapeHtml: escapeLikeCommon };
    const sandbox = { window };
    vm.createContext(sandbox);
    vm.runInContext(PROMPT_SECTION_SRC, sandbox);
    assert.equal(window.PromptSection.runnerLinkHtml('ws'), renderRunnerLink('ws'));
  });
});

describe('tree view task detail (renderDetailsContent)', () => {
  for (const flags of FLAG_STATES) {
    test(`shown without expanding anything (${flagName(flags)})`, () => {
      const html = renderDetailsContent(ISSUE, { urlKey: 'ws', featureFlags: flags, openRouterSource: 'env' });
      assert.equal(count(html, TESTID), 1, 'exactly one link');
      assert.ok(html.includes(LINK));
      assert.ok(stripHidden(html).includes(LINK), 'outside the collapsed Details/Prompts sections');
    });
  }

  test('also with prompt buttons off', () => {
    const html = renderDetailsContent(ISSUE, { urlKey: 'ws', featureFlags: { promptButtons: false } });
    assert.ok(stripHidden(html).includes(LINK));
  });

  test('not on the landing page', () => {
    const html = renderDetailsContent(ISSUE, { isLanding: true, urlKey: 'ws' });
    assert.ok(!html.includes(TESTID));
  });

  test('not without a workspace', () => {
    const html = renderDetailsContent(ISSUE, { urlKey: null });
    assert.ok(!html.includes(TESTID));
  });
});

describe('Swim popover (renderSwimPage)', () => {
  const emptyData = { projectTrees: [], inProgressTrees: [], recentActivityTrees: [] };
  const popoverOf = (html) => {
    const start = html.indexOf('id="swim-popover"');
    return html.slice(start, html.indexOf('</main>', start));
  };

  for (const flags of FLAG_STATES) {
    test(`in the popover, beside the title (${flagName(flags)})`, () => {
      const html = renderSwimPage(emptyData, { urlKey: 'ws', workspaces: [{ id: 'w1', urlKey: 'ws' }], featureFlags: flags });
      const popover = popoverOf(html);
      assert.equal(count(html, TESTID), 1);
      assert.ok(popover.includes(LINK));
      assert.ok(popover.indexOf(LINK) > popover.indexOf('id="swim-popover-title"'));
    });
  }

  test('not on the landing page', () => {
    const html = renderSwimPage(emptyData, { isLanding: true });
    assert.ok(!html.includes(TESTID));
  });
});

// ---------------------------------------------------------------------------
// Swipe: run public/swipe.js (with the real prompt-section.js) against a
// minimal DOM and read the card it renders.
// ---------------------------------------------------------------------------

function escapeLikeCommon(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function makeEl() {
  return {
    innerHTML: '',
    disabled: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function renderSwipeCard(swipeData) {
  const els = new Map();
  const el = (key) => { if (!els.has(key)) els.set(key, makeEl()); return els.get(key); };
  // In a browser `window` is the global: swipe.js calls some window.* helpers
  // as bare globals (renderMarkdown).
  const sandbox = {
    __SWIPE_DATA__: swipeData,
    escapeHtml: escapeLikeCommon,
    renderMarkdown: (s) => escapeLikeCommon(s),
    stripCodeBlockWrapper: (s) => s,
    location: { search: '', href: '' },
    document: {
      title: '',
      getElementById: (id) => el(`#${id}`),
      querySelector: (sel) => el(sel),
      addEventListener() {},
    },
    history: { replaceState() {} },
    setTimeout: () => 0,
    clearTimeout() {},
    requestAnimationFrame: () => 0,
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PROMPT_SECTION_SRC, sandbox);
  vm.runInContext(SWIPE_SRC, sandbox);
  return el('#swipe-card').innerHTML;
}

function swipeData(extra = {}) {
  return {
    issues: [{ id: 'issue-1', identifier: 'LIN-1', title: 'Say hello', stateType: 'unstarted', description: 'Hi.', url: 'https://linear.app/x/issue/LIN-1' }],
    filters: [{ key: 'all', label: 'All' }],
    urlKey: 'ws',
    ...extra,
  };
}

describe('Swipe card (public/swipe.js)', () => {
  for (const flags of FLAG_STATES) {
    test(`under the title, outside every accordion (${flagName(flags)})`, () => {
      const html = renderSwipeCard(swipeData({ proxyEnabled: flags.proxy, dispatchEnabled: flags.dispatch }));
      assert.equal(count(html, TESTID), 1, 'exactly one link');
      assert.ok(html.includes(`<div class="swipe-card-runner">${LINK}</div>`));
      const linkAt = html.indexOf(LINK);
      assert.ok(linkAt > html.indexOf('swipe-card-title'), 'after the title');
      assert.ok(linkAt < html.indexOf('swipe-card-accordion'), 'before the first accordion');
    });
  }

  test('not on the landing card (no workspace)', () => {
    const html = renderSwipeCard(swipeData({ urlKey: '' }));
    assert.ok(html.includes('swipe-card-title'), 'the card rendered');
    assert.ok(!html.includes(TESTID));
  });
});
