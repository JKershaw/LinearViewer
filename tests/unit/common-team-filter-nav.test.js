/**
 * Unit tests for public/common.js's team-filter client wiring (LIN-2520):
 *   - window.buildFilterUrl — the shared path-preserving filter-URL helper.
 *   - initNavBar's team option click handler (real navigation, path-preserving).
 *   - initNavBar's saved-team auto-restore, divergence-aware (R4): reads the
 *     server-applied team off the DOM's `.selected` marker and only
 *     replaceState's when it agrees with the saved (localStorage) team;
 *     otherwise falls back to a real navigation.
 *
 * public/common.js is a browser script (not an ES module), so it is
 * vm-sandboxed — the same seam tests/unit/lin-2370-browser-copy-prompt-provider-identity.test.js
 * uses to reach the real `window.ProxyToggle.buildBlock`. A top-level
 * `function` declaration in vm-executed code attaches directly to the
 * contextified sandbox object (verified: Node's vm treats the sandbox as the
 * script's global object), so `initNavBar`/`buildFilterUrl` are reachable as
 * `sandbox.initNavBar`/`sandbox.window.buildFilterUrl` without any source
 * change beyond mirroring `buildFilterUrl` onto `window` (matching the
 * existing `window.computeFitZoom`-style shared-helper convention).
 *
 * Run with: node --test tests/unit/common-team-filter-nav.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMON_SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');

// ─── Minimal DOM shim, scoped to exactly what initNavBar touches ──────────

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
    // Real elements support MULTIPLE listeners per event type (initNavBar
    // registers two separate 'click' listeners on #team-options: the option
    // handler and a later stopPropagation-only one) — a single-slot shim would
    // silently clobber the first with the second.
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
 * Build a fresh vm sandbox + call initNavBar() once, mirroring a specific
 * DOM/localStorage/URL state. Returns the sandbox for assertions.
 *
 * @param {Object} opts
 * @param {string} [opts.pathname] - window.location.pathname
 * @param {string} [opts.search] - window.location.search (raw query string, e.g. '?team=x')
 * @param {string|null} [opts.savedTeam] - value getTeamSelection() returns (localStorage)
 * @param {string|null} [opts.selectedOptionTeam] - dataset.team of the DOM's `.nav-option.selected`
 *   inside #team-options, or null for "no marked option" (mirrors an absent/markerless panel)
 * @param {string[]} [opts.teamIds] - team ids the rendered #team-options panel carries
 *   (drives the savedTeamExists check)
 */
function runInitNavBar({ pathname = '/workspace/acme/', search = '', savedTeam = null, selectedOptionTeam = null, teamIds = ['eng', 'design'] } = {}) {
  const optionEls = teamIds.map(id => makeElement({ dataset: { team: id } }));
  const selectedOptionEl = selectedOptionTeam !== null
    ? makeElement({ dataset: { team: selectedOptionTeam } })
    : null;

  const teamOptionsEl = makeElement({
    dataset: { urlKey: 'acme' },
    querySelector(sel) {
      if (sel === '.nav-option.selected') return selectedOptionEl;
      return null;
    },
  });
  const teamToggleEl = makeElement();
  const navBarEl = makeElement();

  const byId = {
    'workspace-toggle': null,
    'workspace-options': null,
    'team-toggle': teamToggleEl,
    'team-options': teamOptionsEl,
  };

  const historyCalls = [];
  const localStorageData = { 'linear-projects-selected-team:acme': savedTeam };

  // `window` aliases the sandbox itself (self-referential), exactly like a real
  // browser where `window === globalThis` — this codebase's convention is to
  // assign shared helpers as `window.foo = function foo() {...}` and then call
  // them BARE elsewhere in the same/other scripts (e.g. window.computeFitZoom,
  // called bare as `computeFitZoom(...)` in public/ship.js). A distinct fake
  // `window` object (as other vm-sandbox tests in this repo use, where the
  // tested code never relies on that bare/global duality) would make every
  // bare `buildFilterUrl(...)` call inside initNavBar throw ReferenceError.
  const sandbox = {
    location: { pathname, search, href: undefined },
    history: { replaceState: (...args) => historyCalls.push(args) },
    document: {
      querySelector(sel) {
        if (sel === '.nav-bar') return navBarEl;
        if (sel === '.nav-dropdown-overlay') return null;
        if (sel === '#team-options .nav-option.selected') return selectedOptionEl;
        return null;
      },
      querySelectorAll(sel) {
        if (sel === '#team-options .nav-option[data-team]') return optionEls;
        return [];
      },
      getElementById: (id) => byId[id] || null,
      createElement: () => makeElement(),
      body: { appendChild() {} },
      addEventListener() {},
    },
    localStorage: {
      getItem: (k) => (k in localStorageData ? localStorageData[k] : null),
      setItem: (k, v) => { localStorageData[k] = v; },
      removeItem: (k) => { delete localStorageData[k]; },
    },
    URLSearchParams,
    console,
    fetch() { throw new Error('fetch should not be called'); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(COMMON_SRC, sandbox, { filename: 'common.js' });

  sandbox.initNavBar();

  return { sandbox, teamOptionsEl, teamToggleEl, historyCalls };
}

// ─── window.buildFilterUrl ──────────────────────────────────────────────────

describe('LIN-2520 — window.buildFilterUrl (shared path-preserving filter URL helper)', () => {
  function build(pathname, search, paramName, value) {
    const sandbox = {
      location: { pathname, search },
      document: { addEventListener() {} },
      URLSearchParams,
      console,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(COMMON_SRC, sandbox, { filename: 'common.js' });
    return sandbox.window.buildFilterUrl(paramName, value);
  }

  test('stays on the current page (path-preserving), not a hard-coded dashboard redirect', () => {
    assert.equal(build('/workspace/acme/swim', '', 'team', 'eng-id'), '/workspace/acme/swim?team=eng-id');
    assert.equal(build('/workspace/acme/ship', '', 'team', 'eng-id'), '/workspace/acme/ship?team=eng-id');
    assert.equal(build('/workspace/acme/roadmap', '', 'team', 'eng-id'), '/workspace/acme/roadmap?team=eng-id');
    assert.equal(build('/workspace/acme/swipe', '', 'team', 'eng-id'), '/workspace/acme/swipe?team=eng-id');
    assert.equal(build('/workspace/acme/', '', 'team', 'eng-id'), '/workspace/acme/?team=eng-id');
  });

  test('preserves unrelated query params across the rebuild', () => {
    const url = build('/workspace/acme/swim', '?foo=bar&baz=qux', 'team', 'eng-id');
    const [path, qs] = url.split('?');
    assert.equal(path, '/workspace/acme/swim');
    const params = new URLSearchParams(qs);
    assert.equal(params.get('foo'), 'bar');
    assert.equal(params.get('baz'), 'qux');
    assert.equal(params.get('team'), 'eng-id');
  });

  test('overwrites an existing value for the same param rather than duplicating it', () => {
    const url = build('/workspace/acme/', '?team=old-id', 'team', 'new-id');
    const params = new URLSearchParams(url.split('?')[1]);
    assert.equal(params.get('team'), 'new-id');
    assert.equal([...params.getAll('team')].length, 1);
  });

  test('carries an explicit ?team=all rather than omitting the param (LIN-727)', () => {
    const url = build('/workspace/acme/swim', '', 'team', 'all');
    assert.equal(url, '/workspace/acme/swim?team=all');
  });
});

// ─── Team option click handler ──────────────────────────────────────────────

describe('LIN-2520 — team option click handler (real navigation, path-preserving)', () => {
  test('navigates to the current path with ?team=<id>, staying on non-dashboard pages', () => {
    const { teamOptionsEl, sandbox } = runInitNavBar({ pathname: '/workspace/acme/swim', search: '' });
    const optionEl = makeElement({ dataset: { team: 'eng-id' } });
    teamOptionsEl.fire('click', { stopPropagation() {}, target: { closest: () => optionEl } });

    assert.equal(sandbox.window.location.href, '/workspace/acme/swim?team=eng-id');
  });

  test('a click outside any .nav-option[data-team] is ignored', () => {
    const { teamOptionsEl, sandbox } = runInitNavBar({ pathname: '/workspace/acme/swim' });
    teamOptionsEl.fire('click', { stopPropagation() {}, target: { closest: () => null } });
    assert.equal(sandbox.window.location.href, undefined);
  });
});

// ─── Saved-team auto-restore (R4: divergence-aware) ─────────────────────────

describe("LIN-2520 R4 — auto-restore branches on server-applied vs saved team", () => {
  test('server-applied team matches saved team -> URL-only replaceState, no navigation', () => {
    const { sandbox, historyCalls } = runInitNavBar({
      pathname: '/workspace/acme/swim',
      search: '', // no ?team= in the URL
      savedTeam: 'eng-id',
      selectedOptionTeam: 'eng-id', // the server already rendered this team
      teamIds: ['eng-id', 'design-id'],
    });

    assert.equal(sandbox.window.location.href, undefined, 'must NOT trigger a real navigation');
    assert.equal(historyCalls.length, 1);
    assert.equal(historyCalls[0][2], '/workspace/acme/swim?team=eng-id');
  });

  test('server-applied team diverges from saved team -> real navigation, no replaceState', () => {
    const { sandbox, historyCalls } = runInitNavBar({
      pathname: '/workspace/acme/swim',
      search: '',
      savedTeam: 'eng-id',
      selectedOptionTeam: 'all', // server actually rendered unfiltered (e.g. no accountId this session)
      teamIds: ['eng-id', 'design-id'],
    });

    assert.equal(historyCalls.length, 0, 'must NOT silently correct the URL over a mismatched render');
    assert.equal(sandbox.window.location.href, '/workspace/acme/swim?team=eng-id');
  });

  test('no marked .selected option (panel/marker absent) defaults the server-applied read to "all" -> diverges from a real saved team -> real navigation', () => {
    const { sandbox, historyCalls } = runInitNavBar({
      pathname: '/workspace/acme/swim',
      search: '',
      savedTeam: 'eng-id',
      selectedOptionTeam: null,
      teamIds: ['eng-id', 'design-id'],
    });

    assert.equal(historyCalls.length, 0);
    assert.equal(sandbox.window.location.href, '/workspace/acme/swim?team=eng-id');
  });

  test('no saved team at all -> neither replaceState nor a real navigation fires', () => {
    const { sandbox, historyCalls } = runInitNavBar({
      pathname: '/workspace/acme/swim',
      search: '',
      savedTeam: null,
      selectedOptionTeam: null,
    });

    assert.equal(historyCalls.length, 0);
    assert.equal(sandbox.window.location.href, undefined);
  });

  test('URL already carries ?team= -> auto-restore does not fire at all (no double-handling)', () => {
    const { sandbox, historyCalls } = runInitNavBar({
      pathname: '/workspace/acme/swim',
      search: '?team=design-id',
      savedTeam: 'eng-id',
      selectedOptionTeam: 'eng-id',
      teamIds: ['eng-id', 'design-id'],
    });

    assert.equal(historyCalls.length, 0);
    assert.equal(sandbox.window.location.href, undefined);
  });

  test("saved team of 'all' never triggers the restore branch (already the default)", () => {
    const { sandbox, historyCalls } = runInitNavBar({
      pathname: '/workspace/acme/swim',
      search: '',
      savedTeam: 'all',
      selectedOptionTeam: 'all',
    });

    assert.equal(historyCalls.length, 0);
    assert.equal(sandbox.window.location.href, undefined);
  });
});

// ─── Soft-coupling comment (LIN-2520 AC4) ───────────────────────────────────

test('LIN-2520 AC4 — a comment at the auto-restore call site names the soft coupling to the .selected marker', () => {
  const idx = COMMON_SRC.indexOf('serverAppliedTeam');
  assert.notEqual(idx, -1);
  const nearby = COMMON_SRC.slice(Math.max(0, idx - 1400), idx);
  assert.match(nearby, /soft coupling/i);
  assert.match(nearby, /\.selected/);
});
