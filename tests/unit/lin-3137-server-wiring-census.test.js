/**
 * LIN-3137 J5 — server.js owner-mint wiring census (plan test item 6, house
 * pattern: tests/unit/observer-pass-server-wiring-census.test.js).
 *
 * server.js boots a real app on import (DB connections, scheduler timers) and
 * is never imported directly by the unit suite, so this reads the source text
 * and pins the exact wiring the plan requires:
 *   - exactly ONE `createWorkspaceOwnerCheck(` construction;
 *   - it is hoisted into a `workspaceOwnerCheck` const;
 *   - the proxy token store's owner setter receives that same const;
 *   - `workspaceOwnerCheck` is passed into the `createDispatchRoutes({ ... })`
 *     mount (the pass-through a unit harness injecting the dep directly cannot
 *     prove).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../../server.js', import.meta.url)), 'utf8');

describe('server.js: LIN-3137 owner-check hoist + dispatch mint wiring', () => {
  test('exactly one createWorkspaceOwnerCheck( construction', () => {
    const count = (src.match(/createWorkspaceOwnerCheck\s*\(/g) || []).length;
    assert.equal(count, 1, `expected exactly one owner-check construction, found ${count}`);
  });

  test('the construction is hoisted into `workspaceOwnerCheck`', () => {
    assert.match(
      src,
      /const\s+workspaceOwnerCheck\s*=\s*createWorkspaceOwnerCheck\s*\(\s*\{\s*accountWorkspaceStore\s*,\s*accountStore\s*\}\s*\)/,
      'server.js must hoist the composed owner check into a named const'
    );
  });

  test('the proxy token store owner setter receives that same const', () => {
    assert.match(src, /setOwnerCheck\s*\(\s*workspaceOwnerCheck\s*\)/,
      'the existing late binding must pass the hoisted const, not an inline construction');
  });

  test('workspaceOwnerCheck is passed into createDispatchRoutes({ ... })', () => {
    const start = src.indexOf('createDispatchRoutes({');
    assert.notEqual(start, -1, 'createDispatchRoutes mount literal must exist');
    const end = src.indexOf('})', start);
    assert.notEqual(end, -1, 'the mount literal must close');
    const args = src.slice(start, end);
    assert.match(args, /\bworkspaceOwnerCheck\b/,
      'the dispatch router must receive the owner check, or the gate fails closed in production');
  });
});
