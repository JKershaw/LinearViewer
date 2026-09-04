/**
 * Unit tests for public/common.js's assignee-filter client wiring (LIN-2528):
 *   - initNavBar's assignee option click handler (real navigation,
 *     path-preserving via the shared window.buildFilterUrl, LIN-2520/2526).
 *   - No localStorage write and no auto-restore counterpart — assignee lives
 *     in the URL only, unlike team (LIN-2526's boundary).
 *
 * Same vm-sandbox seam as tests/unit/common-team-filter-nav.test.js (see that
 * file's header for the full rationale): public/common.js is a browser
 * script, not an ES module, so it's vm-sandboxed with a minimal DOM shim.
 *
 * Run with: node --test tests/unit/common-assignee-filter-nav.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMON_SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');

function makeClassList() {
  const set = new Set();
  return {
    add: (...names) => names.forEach(n => n && set.add(n)),
    remove: (...names) => names.forEach(n => set.delete(n)),
    toggle(name, force) {
      const on = force === undefined ? !set.has(name) : force;
      on ? set.add(name) : set.delete(name);
      return on;
    },
    contains: (name) => set.has(name),
  };
}

function makeElement(overrides = {}) {
  const attrs = {};
  const listeners = {};
  return {
    dataset: {},
    classList: makeClassList(),
    _listeners: listeners,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, event) { (listeners[type] || []).forEach(fn => fn(event)); },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    ...overrides,
  };
}

/**
 * Build a fresh vm sandbox + call initNavBar() once, with a rendered
 * #assignee-options panel (and no team panel — mirrors a real dashboard load
 * where localStorage never held a team key touching this test's assertions).
 */
function runInitNavBar({ pathname = '/workspace/acme/', search = '' } = {}) {
  const assigneeToggleEl = makeElement();
  const assigneeOptionsEl = makeElement({ dataset: { urlKey: 'acme' } });
  const navBarEl = makeElement();

  const byId = {
    'assignee-toggle': assigneeToggleEl,
    'assignee-options': assigneeOptionsEl,
  };

  const localStorageCalls = { setItem: [], removeItem: [] };

  const sandbox = {
    location: { pathname, search, href: undefined },
    history: { replaceState: () => { throw new Error('replaceState must not be called — assignee has no auto-restore'); } },
    document: {
      querySelector(sel) {
        if (sel === '.nav-bar') return navBarEl;
        if (sel === '.nav-dropdown-overlay') return null;
        return null;
      },
      querySelectorAll: () => [],
      getElementById: (id) => byId[id] || null,
      createElement: () => makeElement(),
      body: { appendChild() {} },
      addEventListener() {},
    },
    localStorage: {
      getItem: () => null,
      setItem: (k, v) => { localStorageCalls.setItem.push([k, v]); },
      removeItem: (k) => { localStorageCalls.removeItem.push(k); },
    },
    URLSearchParams,
    console,
    fetch() { throw new Error('fetch should not be called'); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(COMMON_SRC, sandbox, { filename: 'common.js' });

  sandbox.initNavBar();

  return { sandbox, assigneeOptionsEl, assigneeToggleEl, localStorageCalls };
}

describe('LIN-2528 — assignee option click handler (real navigation, path-preserving)', () => {
  test('navigates to the current path with ?assignee=<name>, staying on the dashboard', () => {
    const { assigneeOptionsEl, sandbox } = runInitNavBar({ pathname: '/workspace/acme/', search: '' });
    const optionEl = makeElement({ dataset: { assignee: 'Alice' } });
    assigneeOptionsEl.fire('click', { stopPropagation() {}, target: { closest: () => optionEl } });

    assert.equal(sandbox.window.location.href, '/workspace/acme/?assignee=Alice');
  });

  test('preserves every other query param, ?team= included (LIN-2520 reuse)', () => {
    const { assigneeOptionsEl, sandbox } = runInitNavBar({ pathname: '/workspace/acme/', search: '?team=eng-id&foo=bar' });
    const optionEl = makeElement({ dataset: { assignee: 'Alice' } });
    assigneeOptionsEl.fire('click', { stopPropagation() {}, target: { closest: () => optionEl } });

    const [path, qs] = sandbox.window.location.href.split('?');
    assert.equal(path, '/workspace/acme/');
    const params = new URLSearchParams(qs);
    assert.equal(params.get('team'), 'eng-id');
    assert.equal(params.get('foo'), 'bar');
    assert.equal(params.get('assignee'), 'Alice');
  });

  test('carries an explicit ?assignee=all rather than omitting the param (matches the team handler convention)', () => {
    const { assigneeOptionsEl, sandbox } = runInitNavBar({ pathname: '/workspace/acme/', search: '' });
    const optionEl = makeElement({ dataset: { assignee: 'all' } });
    assigneeOptionsEl.fire('click', { stopPropagation() {}, target: { closest: () => optionEl } });

    assert.equal(sandbox.window.location.href, '/workspace/acme/?assignee=all');
  });

  test('picking `me` carries ?assignee=me literally (server-side resolution, not client-side)', () => {
    const { assigneeOptionsEl, sandbox } = runInitNavBar({ pathname: '/workspace/acme/', search: '' });
    const optionEl = makeElement({ dataset: { assignee: 'me' } });
    assigneeOptionsEl.fire('click', { stopPropagation() {}, target: { closest: () => optionEl } });

    assert.equal(sandbox.window.location.href, '/workspace/acme/?assignee=me');
  });

  test('a click outside any .nav-option[data-assignee] is ignored', () => {
    const { assigneeOptionsEl, sandbox } = runInitNavBar();
    assigneeOptionsEl.fire('click', { stopPropagation() {}, target: { closest: () => null } });
    assert.equal(sandbox.window.location.href, undefined);
  });

  test('no localStorage write happens on an assignee pick (unlike team, assignee is URL-only)', () => {
    const { assigneeOptionsEl, localStorageCalls } = runInitNavBar();
    const optionEl = makeElement({ dataset: { assignee: 'Alice' } });
    assigneeOptionsEl.fire('click', { stopPropagation() {}, target: { closest: () => optionEl } });

    assert.deepEqual(localStorageCalls.setItem, []);
    assert.deepEqual(localStorageCalls.removeItem, []);
  });
});

describe('LIN-2528 — no auto-restore counterpart for assignee', () => {
  test('initNavBar never calls history.replaceState for assignee (no saved-selection restore branch exists)', () => {
    // runInitNavBar's `history.replaceState` stub throws if ever invoked;
    // simply completing initNavBar() without throwing proves this.
    assert.doesNotThrow(() => runInitNavBar());
  });
});
