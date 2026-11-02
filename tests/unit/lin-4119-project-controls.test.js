/**
 * LIN-4119 (S3a-2, beat 2): one control line per project, and Add task in the project header.
 *
 * Renderer half (lib/render.js, renderProject, shared by Home and /backlog):
 *   - ONE element `data-testid="project-controls"` holds the Up next fold, the Backlog fold and the done count.
 *     The "·" separators are drawn by CSS between siblings, never written as text.
 *   - The Add task link sits in the project header, beside an element that holds the arrow and the name, so
 *     `setArrow` (which rewrites textContent) cannot delete it. It is not at the tail of the project.
 *   - A synthetic project (no real id) gets no Add task.
 *
 * Client half (public/app.js): a browser script, so there is no DOM harness here. Its behaviour is pinned as source
 * text (the precedent of tests/unit/lin-4024-home-folds-*.test.js): the rows go before the control line, the hide and
 * show lists name the control line and not the Add task link, the header click returns on the link, and setArrow
 * targets the name element. The browser behaviour is proved by the E2E witnesses in beat 3.
 *
 * Run with: node --test tests/unit/lin-4119-project-controls.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPage } from '../../lib/render.js';
import '../../lib/providers/linear/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_SRC = readFileSync(join(__dirname, '../../public/app.js'), 'utf8');
const CSS_SRC = readFileSync(join(__dirname, '../../public/style.css'), 'utf8');

const WORKSPACE = { id: 'w1', name: 'WS', urlKey: 'ws', provider: 'linear' };

function issue(id, state = 'started') {
  return { id, identifier: id.toUpperCase(), title: `Task ${id}`, state: { type: state, name: state }, labels: { nodes: [] } };
}

// A real project with an open task, an Up next overflow of 2, a Backlog of 3 and 4 done tasks.
function projectWithFolds(overrides = {}) {
  return {
    project: { id: 'real-project', name: 'Real', content: null, url: null },
    incomplete: [{ issue: issue('a-1'), children: [], depth: 0 }],
    completed: [],
    completedCount: 0,
    upNextMore: 2,
    backlogCount: 3,
    doneCount: 4,
    ...overrides,
  };
}

function render(trees, options = {}) {
  return renderPage(trees, [], [], 'WS', { isLanding: false, urlKey: 'ws', workspaces: [WORKSPACE], workspace: WORKSPACE, featureFlags: {}, ...options });
}

// The control line's direct children are non-nested `<div>`s (folds and the done count), so the line ends at the
// first position where no further `<div>...</div>` child follows. Returns the markup between its tags, or null.
function controlLineOf(html) {
  const open = '<div class="project-controls" data-testid="project-controls">';
  const start = html.indexOf(open);
  if (start === -1) return null;
  let rest = html.slice(start + open.length);
  let inner = '';
  for (;;) {
    const child = rest.match(/^\s*<div[^>]*>[^<]*<\/div>/);
    if (!child) break;
    inner += child[0];
    rest = rest.slice(child[0].length);
  }
  return { inner, after: rest };
}

describe('LIN-4119 — one control line per project', () => {
  test('a project with folds and a done count renders exactly one project-controls, holding Up next, Backlog and done in order', () => {
    const html = render([projectWithFolds()]);
    assert.equal(html.split('data-testid="project-controls"').length - 1, 1, 'exactly one control line in the project');
    const line = controlLineOf(html);
    assert.ok(line, 'the control line is the one element that holds the folds');
    const order = [...line.inner.matchAll(/data-testid="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(order, ['home-fold-up-next', 'home-fold-backlog', 'home-done-count']);
  });

  test('the control line is one element: it is closed before the tree and the Add task link are not in it', () => {
    const html = render([projectWithFolds()]);
    const line = controlLineOf(html);
    assert.ok(!line.inner.includes('create-task'), 'the Add task link is in the header, not the control line');
    assert.ok(!line.inner.includes('add-task-link'));
  });

  test('the separators are CSS, never text: the control line carries no literal "·"', () => {
    const html = render([projectWithFolds()]);
    const line = controlLineOf(html);
    assert.ok(!line.inner.includes('·'), 'no "·" written into the control line');
    assert.ok(!line.after.startsWith('·'));
  });

  test('the fold and count wording: "show N more", "N backlog", "N done" (feedback item 24)', () => {
    const html = render([projectWithFolds()]);
    const line = controlLineOf(html);
    assert.match(line.inner, />show 2 more ▶</, 'Up next reads "show 2 more"');
    assert.match(line.inner, />3 backlog ▶</, 'Backlog reads "3 backlog"');
    assert.match(line.inner, /data-testid="home-done-count"[^>]*>4 done</, 'done reads "4 done"');
  });

  test('a project with no folds and no done tasks has no control line (nothing to put on it)', () => {
    const html = render([projectWithFolds({ upNextMore: 0, backlogCount: 0, doneCount: 0 })]);
    assert.equal(html.split('data-testid="project-controls"').length - 1, 0);
  });

  test('the control line sits where the folds were: after the open tree, before the completed section', () => {
    const html = render([projectWithFolds({ completed: [{ issue: issue('d-1', 'completed'), children: [], depth: 0 }], completedCount: 1 })]);
    const tree = html.indexOf('<div class="tree">');
    const line = html.indexOf('data-testid="project-controls"');
    const completed = html.indexOf('data-completed-for=');
    assert.ok(tree !== -1 && line > tree, 'the control line follows the open tree');
    assert.ok(completed === -1 || line < completed, 'and precedes the completed section');
  });
});

describe('LIN-4119 — Add task in the project header', () => {
  test('the arrow and name share one element, and the Add task link is its sibling inside the header', () => {
    const html = render([projectWithFolds()]);
    const header = html.match(/<div class="project-header" data-testid="project-header">([\s\S]*?)<\/div>\n/);
    assert.ok(header, 'the header is present');
    assert.match(header[1], /^<span class="project-name"[^>]*>▼ Real<\/span>/, 'the arrow and name are in their own element first');
    assert.match(header[1], /<div class="add-task-link" data-testid="create-task">/, 'the Add task link is a sibling after the name');
  });

  test('exactly one Add task per real project, and it is in the header (not at the old tail position)', () => {
    const html = render([projectWithFolds()]);
    assert.equal(html.split('data-testid="create-task"').length - 1, 1, 'one Add task');
    const addAt = html.indexOf('data-testid="create-task"');
    const headerAt = html.indexOf('data-testid="project-header"');
    const treeAt = html.indexOf('<div class="tree">');
    assert.ok(addAt > headerAt && addAt < treeAt, 'the Add task link is inside the header, before the tree');
  });

  test('a synthetic project (no real id) gets no Add task in its header', () => {
    const html = render([projectWithFolds({ project: { id: '__no_project__', name: 'No project', content: null, url: null } })]);
    assert.ok(!html.includes('data-testid="create-task"'), 'no create affordance for a synthetic project');
    assert.ok(!html.includes('add-task-link'));
  });

  test('the external deep-link provider (ui.write) also takes its Add task in the header', () => {
    const jira = { id: 'w2', name: 'JS', urlKey: 'ws', provider: 'jira' };
    const html = render([projectWithFolds()], { workspaces: [jira], workspace: jira });
    const header = html.match(/<div class="project-header" data-testid="project-header">([\s\S]*?)<\/div>\n/);
    assert.ok(header && header[1].includes('data-action="create-task"'), 'the external deep-link sits in the header');
  });

});

describe('LIN-4119 — client source pins (public/app.js)', () => {
  test('fetched rows go before the control line, not before the fold', () => {
    assert.match(APP_SRC, /const anchor = fold\.closest\('\.project-controls'\) \|\| fold/, 'the insertion anchor is the control line');
    assert.match(APP_SRC, /anchor\.before\(mountRoot\)/);
    assert.doesNotMatch(APP_SRC, /fold\.before\(mountRoot\)/, 'no insert before the fold');
  });

  test('the hide lists name the control line, and no longer the Add task link or the folds', () => {
    const hideList = '.node, .project-description, .project-meta, .completed-toggle, [data-completed-for], .project-controls';
    assert.equal(APP_SRC.split(hideList).length - 1, 2, 'the restore and the header-click collapse both hide the whole line');
    assert.doesNotMatch(APP_SRC, /\[data-completed-for\], \.add-task-link/, 'Add task is not in a hide list');
    assert.doesNotMatch(APP_SRC, /show\(project\.querySelector\('\.add-task-link'\)\)/, 'Add task is not in a show path');
  });

  test('both expand paths show the control line, and no longer show the folds one by one', () => {
    assert.doesNotMatch(APP_SRC, /project\.querySelectorAll\(':scope > \.home-fold'\)/, 'the folds are shown with their line, not one by one');
    assert.equal(APP_SRC.split('showControlLine(project)').length - 1, 2, 'expand-all and the header expand show the line');
  });

  test('the header click returns on a click on the Add task link, before the header branch', () => {
    const guard = APP_SRC.indexOf("if (e.target.closest('.add-task-link')) return");
    const branch = APP_SRC.indexOf("const header = e.target.closest('.project-header')");
    assert.notEqual(guard, -1, 'the link guard exists');
    assert.ok(guard !== -1 && branch !== -1 && guard < branch, 'the guard comes before the header branch');
  });

  test('setArrow targets the name element at each project-header call site, never the header (which holds the link)', () => {
    // Expand-all, restore and the header click: two through projectNameOf, one through the name it already holds.
    assert.equal(APP_SRC.split('setArrow(projectNameOf(').length - 1, 2, 'restore and the header click');
    assert.equal(APP_SRC.split('setArrow(name, true)').length - 1, 1, 'expand-all');
    // The in-progress header keeps its own setArrow call; no project site calls it with the header.
    assert.equal(APP_SRC.split('setArrow(header, ').length - 1, 1, 'only the in-progress section calls setArrow with a header');
  });

  test('a fetched project row is shown again on expand (the rows the fold fetched are not lost by a collapse)', () => {
    assert.match(APP_SRC, /\[\.\.\.project\.querySelectorAll\(':scope > \.tree:not\(\[data-completed-for\]\)'\)\]\s*\.flatMap/, 'every incomplete tree, not only the first');
  });

  test('the fold text on a paged fetch keeps its kind\'s wording', () => {
    assert.match(APP_SRC, /foldLabel\(fold\.dataset\.homeFetch, data\.remaining\)/);
  });
});

describe('LIN-4119 — CSS draws the separators and styles the header link', () => {
  test('the control line draws "·" between siblings with a sibling selector, not text', () => {
    assert.match(CSS_SRC, /\.project-controls > \* \+ \*::before \{[^}]*content: "·"/);
  });

  test('the Add task link is inline beside the name inside the header', () => {
    assert.match(CSS_SRC, /\.project-header \.add-task-link \{[^}]*display: inline/);
  });
});
