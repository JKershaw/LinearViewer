/**
 * LIN-2389: one function decides "which workspace has this urlKey".
 *
 * Part 1 pins the leaf's semantics and the session-shaped delegate.
 * Part 2 is the guard that replaced the old `urlkey-lookups` count pin: it keys
 * on the comparison itself (any construct, any variable name, either operand
 * order), not on `.find(w => ...)` predicates, so renaming the variable or
 * writing a loop cannot evade it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findWorkspaceByUrlKey, findWorkspaceIndexByUrlKey } from '../../lib/workspace-lookup.js';
import { getWorkspaceByUrlKey } from '../../lib/workspace.js';
import * as workspaceModule from '../../lib/workspace.js';
import { renderNavBar } from '../../lib/components/navbar.js';
import { loadStrippedSources } from '../fixtures/connection-access-guards.js';

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

  test('a null urlKey marks no option active', () => {
    assert.equal(selectedOptions(renderNavBar({ workspaces, urlKey: null })).length, 0);
  });
});

describe('no hand-rolled workspace-by-urlKey comparison (replaces the urlkey-lookups count pin)', () => {
  const FORWARD = /[\w$\])]\??\.urlKey\s*===?\s*urlKey\b/g;
  const REVERSED = /(?<![\w$.])urlKey\s*===?\s*[\w$]+\??\.urlKey\b/g;
  const LEAF = 'lib/workspace-lookup.js';
  // lib/connection-credential.js: membership over *referents*, not workspaces (ticket-excluded).
  const REFERENT_EXEMPT = { file: 'lib/connection-credential.js', line: /r && r\.urlKey === urlKey && r\.provider/ };

  const REAL = loadStrippedSources();

  function hits(sources) {
    const out = [];
    for (const [rel, src] of sources) {
      if (!/^(lib\/|routes\/|server\.js$)/.test(rel)) continue;
      if (rel === LEAF) continue;
      src.split('\n').forEach((line, i) => {
        if (!(line.match(FORWARD) || line.match(REVERSED))) return;
        if (rel === REFERENT_EXEMPT.file && REFERENT_EXEMPT.line.test(line)) return;
        out.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    return out;
  }

  const withLine = (sources, rel, line) => new Map(sources).set(rel, `${sources.get(rel)}\n${line}\n`);

  test('the corpus is scanned (guard is not vacuous)', () => {
    assert.ok(REAL.has('lib/workspace.js'));
    assert.ok(REAL.has(REFERENT_EXEMPT.file));
    assert.ok(REAL.has('server.js'));
    assert.ok([...REAL.keys()].some(k => k.startsWith('routes/')));
    assert.match(REAL.get(REFERENT_EXEMPT.file), REFERENT_EXEMPT.line, 'the named exemption still exists');
  });

  test('zero remaining outside the leaf and the referents exemption', () => {
    assert.deepEqual(hits(REAL), []);
  });

  const PLANTS = {
    'renamed variable in a find': 'const e = xs.find(candidate => candidate.urlKey === urlKey);',
    'bare if (the old pin plant)': 'if (w.urlKey === urlKey) {}',
    'for-of loop': 'for (const x of xs) { if (x.urlKey === urlKey) return x; }',
    'reversed operand order': 'const m = xs.filter(w => urlKey === w.urlKey);',
    'optional chaining': 'const m = xs.find(w => w?.urlKey === urlKey);',
    'a second hit in the exempted file': 'const z = list.find(r => r.urlKey === urlKey);',
  };
  for (const [name, line] of Object.entries(PLANTS)) {
    test(`plant fails the guard: ${name}`, () => {
      const rel = name.startsWith('a second hit') ? REFERENT_EXEMPT.file : 'lib/workspace.js';
      assert.equal(hits(withLine(REAL, rel, line)).length, 1);
    });
  }

  test('a referent-style comparison elsewhere does not trip it', () => {
    assert.deepEqual(hits(withLine(REAL, 'lib/workspace.js', 'const k = r.urlKey === referent.urlKey;')), []);
    assert.deepEqual(hits(withLine(REAL, 'routes/live-console.js', 'x = w.urlKey === workspace.urlKey;')), []);
  });
});
