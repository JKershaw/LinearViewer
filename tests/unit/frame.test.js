/**
 * LIN-4562 (LIN-4342 piece 1): the frame's markup contract (lib/components/frame.js). The walk
 * (tests/e2e/frame-rules.spec.js) checks the same rules in a browser; these pin them per render, fast:
 *  - the skip link is first in <body> and points at <main id="main">;
 *  - one h1, the page's name, and the tab title `<Page> · <Workspace>` (public: `<Page> · Harbour`);
 *  - exactly one rail item carries aria-current: the page itself, else the place it was reached from, which is also
 *    the "← <parent>" way back;
 *  - the footer is byte-identical across pages, viewers and the public frame;
 *  - the rail's items are what lib/places.js admits for the person;
 *  - the workspace menu switches and adds, and never removes;
 *  - the counts carry the hooks public/common.js updates (every copy), and only with run controls;
 *  - the search field and ☰ are named; the filter slot draws the bar's selectors.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/frame.test.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFrame, renderPublicFrame, renderFrameFooter, frameViewer } from '../../lib/components/frame.js';
import { renderFilterLine } from '../../lib/components/navbar.js';
import { railFor } from '../../lib/places.js';
import { renderProxyPage } from '../../lib/render-proxy.js';
import { renderSearchPage } from '../../lib/render-search.js';

const WS = [{ urlKey: 'acme', name: 'Acme' }, { urlKey: 'beta', name: 'Beta' }];
const OWNER = { runControls: true, liveConsole: true, feedbackWidget: true };
const NEW_USER = { runControls: false, runSetup: true };
const DEPLOY = { version: 'v9', commit: 'abcdef1234567', createdAt: '2026-11-20T10:00:00Z' };

const page = (o = {}) => renderFrame({ place: 'connect', urlKey: 'acme', workspaces: WS, featureFlags: OWNER, deployInfo: DEPLOY, content: '<p>body</p>', ...o });
const all = (html, re) => [...html.matchAll(re)];
const railItems = (html) => all(html, /<a [^>]*class="frame-rail__item[^"]*"[^>]*>/g).map(m => m[0]);
const marked = (html) => railItems(html).filter(tag => tag.includes('aria-current'));
const footerOf = (html) => html.match(/<footer class="frame-footer"[\s\S]*?<\/footer>/)[0];
const bodyOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>'));

describe('the frame for a signed-in page', () => {
  test('the skip link is the first thing in <body> and lands in <main id="main">', () => {
    const body = bodyOf(page());
    const first = body.slice(body.indexOf('>') + 1).trim();
    assert.match(first, /^<a class="frame-skip" href="#main"/);
    assert.equal(all(body, /<main id="main"/g).length, 1);
  });

  test('one h1, the page name, and the tab title starts with it', () => {
    const html = page();
    const h1s = all(html, /<h1>([^<]*)<\/h1>/g);
    assert.equal(h1s.length, 1);
    assert.equal(h1s[0][1], 'Connect an agent');
    assert.match(html, /<title>Connect an agent · Acme<\/title>/);
    assert.equal(all(html, /class="wordmark[^"]*"/g).length >= 1, true);
    assert.ok(!/<h1[^>]*>\s*<[^>]*wordmark/.test(html), 'the wordmark is never the h1');
  });

  test('a given title wins, and is escaped in the h1, the band and the tab', () => {
    const html = page({ place: 'task', title: 'Fix <b>it</b>' });
    assert.match(html, /<h1>Fix &lt;b&gt;it&lt;\/b&gt;<\/h1>/);
    assert.match(html, /<title>Fix &lt;b&gt;it&lt;\/b&gt; · Acme<\/title>/);
    assert.match(html, /data-testid="frame-band-name">Fix &lt;b&gt;it&lt;\/b&gt;</);
  });

  test('the owner on Connect an agent: it is the one marked item, as the page, and there is no way back', () => {
    const html = page();
    assert.deepEqual(marked(html).map(t => t.match(/data-place="([^"]+)"/)[1]), ['connect']);
    assert.match(marked(html)[0], /aria-current="page"/);
    assert.ok(!html.includes('data-testid="frame-back"'));
  });

  test('a new user on Connect an agent: Settings is marked (they came from Agent access) and is the way back', () => {
    const html = page({ featureFlags: NEW_USER });
    assert.deepEqual(marked(html).map(t => t.match(/data-place="([^"]+)"/)[1]), ['settings']);
    assert.match(marked(html)[0], /aria-current="true"/);
    assert.match(html, /<a class="frame-back" href="\/workspace\/acme\/settings" data-testid="frame-back">← Settings<\/a>/);
  });

  test('a drilled-in page marks its parent once and links back to it', () => {
    for (const [place, from, parent, label] of [['run', undefined, 'runs', 'Runs'], ['task', 'backlog', 'backlog', 'Backlog'], ['task', undefined, 'home', 'Home'], ['search', undefined, 'home', 'Home'], ['escalation', undefined, 'kpis', 'KPIs']]) {
      const html = page({ place, from });
      assert.deepEqual(marked(html).map(t => t.match(/data-place="([^"]+)"/)[1]), [parent], `${place} marks ${parent}`);
      assert.match(html, new RegExp(`data-testid="frame-back">← ${label}</a>`), `${place} goes back to ${label}`);
    }
  });

  test('the rail lists what lib/places.js admits for the person, in order', () => {
    for (const flags of [OWNER, NEW_USER, { ...OWNER, roadmap: true, shipBiscuit: true }]) {
      const html = page({ featureFlags: flags });
      assert.deepEqual(railItems(html).map(t => t.match(/data-place="([^"]+)"/)[1]), railFor(flags).flatMap(g => g.places.map(p => p.key)));
    }
  });

  test('an unknown place, or a signed-in page with no workspace, throws rather than draw a frame with nothing lit', () => {
    assert.throws(() => page({ place: 'nowhere' }), /not in lib\/places\.js/);
    assert.throws(() => page({ urlKey: null }), /urlKey/);
  });
});

describe('the rail top and foot', () => {
  test('the workspace menu switches and adds, and never removes', () => {
    const html = page();
    const menu = html.match(/<div class="frame-menu"[\s\S]*?<\/div>\s*<\/div>/)[0];
    assert.match(menu, /href="\/workspace\/beta\/"/, 'switching from a gated place lands on Home');
    assert.match(menu, /data-testid="rail-workspace-add-local"/);
    assert.ok(!/remove/i.test(menu), 'removing a workspace lives in Settings');
    const fromSwim = page({ place: 'swim' }).match(/<div class="frame-menu"[\s\S]*?<\/div>\s*<\/div>/)[0];
    assert.match(fromSwim, /href="\/workspace\/beta\/swim"/, 'a place everyone reaches keeps its path on switch');
    const adds = all(menu, /class="frame-menu__row frame-menu__add"/g).length;
    assert.equal(adds, all(menu, /frame-menu__add/g).length, 'every add row shares one class');
  });

  test('the search field and ☰ have names; search goes to the search page', () => {
    const html = page();
    assert.match(html, /<form class="frame-search" role="search" action="\/workspace\/acme\/search" method="get"/);
    assert.match(html, /<input type="search" name="q"[^>]*aria-label="Search tasks"/);
    assert.match(html, /<button type="button" class="frame-band__menu" aria-label="Open the menu" aria-controls="frame-rail" aria-expanded="false"/);
    assert.match(html, /<a class="frame-band__search" href="\/workspace\/acme\/search"/);
  });

  test('the AI status and the feedback trigger sit at the rail foot, the trigger on its own gate', () => {
    const html = page();
    const foot = html.match(/<div class="frame-rail__foot">[\s\S]*?<\/nav>/)[0];
    assert.match(foot, /data-testid="footer-ai-status"/);
    assert.match(foot, /data-testid="nav-feedback-trigger"[^>]*disabled/);
    assert.ok(!page({ featureFlags: { runControls: true } }).includes('nav-feedback-trigger'), 'no trigger without the flag');
    assert.match(html, /id="feedback-widget-root"[^>]*data-enabled="true"/, 'the panel mount rides along, as with the old footer');
  });
});

describe('the counts', () => {
  test('with run controls: "N questions" beside Home and in the band, linking to the questions on Home; "N queued" on Dispatch', () => {
    const html = page();
    const questions = all(html, /<a class="frame-count frame-count--needs-you rulings-badge hidden" data-rulings-badge data-url-key="acme" data-testid="(rail|band)-questions" href="\/workspace\/acme\/#waiting-on-you"/g);
    assert.deepEqual(questions.map(m => m[1]).sort(), ['band', 'rail']);
    const dispatch = railItems(html).find(t => t.includes('data-place="dispatch"'));
    assert.ok(dispatch);
    assert.match(html, /data-place="dispatch"><span class="frame-rail__label">Dispatch<\/span> <span class="frame-count queue-count-badge hidden" data-queue-badge data-url-key="acme" data-testid="rail-queued"><span class="queue-count">0<\/span> queued<\/span><\/a>/);
  });

  test('without run controls, no count is drawn at all', () => {
    const html = page({ featureFlags: NEW_USER });
    assert.ok(!html.includes('data-rulings-badge'));
    assert.ok(!html.includes('data-queue-badge'));
  });
});

describe('the footer is the same on every page', () => {
  test('Library, Templates, Privacy, Terms, Source, then the deploy stamp', () => {
    const footer = renderFrameFooter(DEPLOY);
    assert.deepEqual(all(footer, />([A-Za-z]+)<\/a>/g).slice(0, 5).map(m => m[1]), ['Library', 'Templates', 'Privacy', 'Terms', 'Source']);
    assert.match(footer, /data-testid="frame-footer-stamp">v9 · <span class="deploy-time"/);
    assert.ok(!renderFrameFooter({}).includes('frame-footer-stamp'), 'no stamp without a deploy');
  });

  test('byte-identical across places, viewers and the public frame', () => {
    const footers = new Set([
      footerOf(page()),
      footerOf(page({ place: 'search', featureFlags: NEW_USER })),
      footerOf(page({ place: 'run', workspaces: [WS[1]], urlKey: 'beta' })),
      footerOf(renderPublicFrame({ title: 'Library', deployInfo: DEPLOY })),
      footerOf(renderPublicFrame({ title: 'Library', deployInfo: DEPLOY, viewer: { signedIn: true, homeHref: '/workspace/acme/' } })),
    ]);
    assert.equal(footers.size, 1);
  });
});

describe('the public frame', () => {
  test('signed out: no rail, the wordmark to /, a way back, Sign in, and `<Page> · Harbour`', () => {
    const html = renderPublicFrame({ title: 'Library', content: '<p>docs</p>' });
    assert.ok(!html.includes('frame-rail'));
    assert.match(html, /<title>Library · Harbour<\/title>/);
    assert.match(html, /<a href="\/" class="wordmark wordmark-rail"/);
    assert.match(html, /data-testid="frame-back">← Harbour<\/a>/);
    assert.match(html, /data-testid="frame-sign-in">Sign in<\/a>/);
    assert.equal(all(html, /<h1>/g).length, 1);
    assert.match(bodyOf(html).slice(bodyOf(html).indexOf('>') + 1).trim(), /^<a class="frame-skip" href="#main"/);
  });

  test('signed in: the wordmark and "Open your workspace" lead to the viewer\'s Home', () => {
    const viewer = frameViewer({ workspaces: [{ id: 'w1', urlKey: 'acme', name: 'Acme' }, { id: 'w2', urlKey: 'beta' }], activeWorkspaceId: 'w2' });
    assert.deepEqual(viewer, { signedIn: true, homeHref: '/workspace/beta/', workspaceName: null });
    const html = renderPublicFrame({ title: 'Library', viewer });
    assert.match(html, /<a href="\/workspace\/beta\/" class="wordmark wordmark-rail"/);
    assert.match(html, /<a class="frame-public__action" href="\/workspace\/beta\/" data-testid="frame-open-workspace">Open your workspace<\/a>/);
    assert.ok(!html.includes('frame-sign-in'));
  });

  test('frameViewer: no workspaces is signed out', () => {
    assert.equal(frameViewer(undefined).signedIn, false);
    assert.equal(frameViewer({ workspaces: [] }).signedIn, false);
  });
});

describe('the filter slot', () => {
  const teams = [{ id: 't1', name: 'Core', key: 'COR' }];
  test('a filtered page draws the bar\'s own selectors (same ids) in the frame\'s filter line', () => {
    const line = renderFilterLine({ currentPage: 'projects', urlKey: 'acme', teams, assignees: ['Ann'], selectedAssignee: 'all' });
    assert.match(line, /^<div class="frame-filters" data-frame-filters data-testid="frame-filters">/);
    for (const id of ['team-toggle', 'team-options', 'assignee-toggle', 'assignee-options']) assert.ok(line.includes(`id="${id}"`), id);
    const html = page({ place: 'home', filters: line });
    assert.ok(html.indexOf('data-frame-filters') > html.indexOf('<h1>'), 'below the heading, inside <main>');
    assert.ok(html.indexOf('data-frame-filters') < html.indexOf('<p>body</p>'));
  });

  test('swim gets the team selector only; a page with no filter gets nothing', () => {
    const swim = renderFilterLine({ currentPage: 'swim', urlKey: 'acme', teams, assignees: ['Ann'] });
    assert.ok(swim.includes('team-toggle') && !swim.includes('assignee-toggle'));
    assert.equal(renderFilterLine({ currentPage: 'proxy', teams }), '');
  });
});

describe('the first pages on the frame', () => {
  test('Connect an agent keeps its body, sheets and scripts, in the frame', () => {
    const html = renderProxyPage('Acme', { urlKey: 'acme', workspaces: WS, featureFlags: OWNER });
    assert.match(html, /<title>Connect an agent · Acme<\/title>/);
    assert.ok(html.includes('id="proxy-create-token-form"'));
    for (const sheet of ['/style.css', '/common-actions.css', '/proxy.css', '/frame.css']) assert.ok(html.includes(`href="${sheet}"`), sheet);
    assert.ok(html.indexOf('href="/style.css"') < html.indexOf('href="/proxy.css"') && html.indexOf('href="/proxy.css"') < html.indexOf('href="/frame.css"'));
    assert.match(html, /<script src="\/common.js"><\/script>[\s\S]*<script type="module" src="\/app.js"><\/script>[\s\S]*<script src="\/proxy.js"><\/script>[\s\S]*<script type="module" src="\/frame.js"><\/script>/);
    assert.equal(all(html, /src="\/common.js"/g).length, 1);
  });

  test('Search names what it found and is in the frame', () => {
    const html = renderSearchPage({ q: 'Finished', urlKey: 'acme', workspaces: WS, featureFlags: OWNER, result: { matches: [], open: 0, done: 0, remaining: 0 } });
    assert.match(html, /<title>Search · Acme<\/title>/);
    assert.match(html, /<h1>Search<\/h1>/);
    assert.match(html, /Nothing matches “Finished”/);
    assert.match(html, /name="q"[^>]*value="Finished"/, 'the rail field echoes the search');
  });
});
