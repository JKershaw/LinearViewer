/**
 * LIN-2389: one function decides "which workspace has this urlKey".
 *
 * Pins the leaf's semantics and the session-shaped delegate.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findWorkspaceByUrlKey, findWorkspaceIndexByUrlKey } from '../../lib/workspace-lookup.js';
import { getWorkspaceByUrlKey } from '../../lib/workspace.js';
import * as workspaceModule from '../../lib/workspace.js';
import { renderNavBar } from '../../lib/components/navbar.js';

describe('findWorkspaceByUrlKey / findWorkspaceIndexByUrlKey', () => {
  const a = { urlKey: 'a', id: 1 };
  const b = { urlKey: 'b', id: 2 };
  const dupB = { urlKey: 'b', id: 3 };

  test('hit and miss', () => {
    assert.equal(findWorkspaceByUrlKey([a, b], 'b'), b);
    assert.equal(findWorkspaceIndexByUrlKey([a, b], 'b'), 1);
    assert.equal(findWorkspaceByUrlKey([a, b], 'zzz'), null);
    assert.equal(findWorkspaceIndexByUrlKey([a, b], 'zzz'), -1);
  });

  test('first match wins on duplicate keys', () => {
    assert.equal(findWorkspaceByUrlKey([a, b, dupB], 'b'), b);
    assert.equal(findWorkspaceIndexByUrlKey([a, dupB, b], 'b'), 1);
  });

  test('non-array and empty input match nothing', () => {
    for (const bad of [undefined, null, {}, 'a', []]) {
      assert.equal(findWorkspaceByUrlKey(bad, 'a'), null);
      assert.equal(findWorkspaceIndexByUrlKey(bad, 'a'), -1);
    }
  });

  test('a falsy key never matches, including a keyless workspace (the one acknowledged change)', () => {
    const keyless = { id: 9 };
    for (const key of [undefined, null, '']) {
      assert.equal(findWorkspaceByUrlKey([keyless, { urlKey: '' }], key), null);
      assert.equal(findWorkspaceIndexByUrlKey([keyless], key), -1);
    }
  });

  test('null entries are tolerated', () => {
    assert.equal(findWorkspaceByUrlKey([null, undefined, b], 'b'), b);
    assert.equal(findWorkspaceIndexByUrlKey([null, b], 'b'), 1);
  });
});

describe('getWorkspaceByUrlKey delegates to the array finder', () => {
  const ws = { urlKey: 'acme' };
  test('session shape resolves identically', () => {
    assert.equal(getWorkspaceByUrlKey({ workspaces: [{ urlKey: 'x' }, ws] }, 'acme'), ws);
    assert.equal(getWorkspaceByUrlKey({ workspaces: [ws] }, 'nope'), null);
    assert.equal(getWorkspaceByUrlKey({ workspaces: [ws] }, ''), null);
  });
  test('a session with no workspaces gives null', () => {
    assert.equal(getWorkspaceByUrlKey({}, 'acme'), null);
    assert.equal(getWorkspaceByUrlKey({ workspaces: [] }, 'acme'), null);
    assert.equal(getWorkspaceByUrlKey(undefined, 'acme'), null);
  });
  test('workspace.js re-exports the array finders as the single entry point', () => {
    assert.equal(workspaceModule.findWorkspaceByUrlKey, findWorkspaceByUrlKey);
    assert.equal(workspaceModule.findWorkspaceIndexByUrlKey, findWorkspaceIndexByUrlKey);
  });
});

describe('navbar active workspace', () => {
  const workspaces = [
    { urlKey: 'one', name: 'One', provider: 'linear' },
    { urlKey: 'two', name: 'Two', provider: 'linear' },
  ];
  const selectedOptions = (html) => (html.match(/<a [^>]*aria-selected="true"[^>]*>/g) || []);

  test('marks only the workspace matching the urlKey', () => {
    const html = renderNavBar({ workspaces, urlKey: 'two' });
    const sel = selectedOptions(html);
    assert.equal(sel.length, 1);
    assert.match(sel[0], /\/workspace\/two/);
  });

  test('duplicate urlKeys mark exactly one option active (first match)', () => {
    const dup = [
      { urlKey: 'two', name: 'Two', provider: 'linear' },
      { urlKey: 'two', name: 'Two again', provider: 'linear' },
    ];
    assert.equal(selectedOptions(renderNavBar({ workspaces: dup, urlKey: 'two' })).length, 1);
  });

  test('a null urlKey marks no option active', () => {
    assert.equal(selectedOptions(renderNavBar({ workspaces, urlKey: null })).length, 0);
  });
});
