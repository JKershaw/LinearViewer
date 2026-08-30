/**
 * Server wiring census for observer-pass's unattended OpenRouter resolver
 * (LIN-2412, plan test item 6). server.js boots a real app on import (DB
 * connections, scheduler timers) and is never imported directly by the unit
 * suite — every other server.js-wiring check in this repo is a source
 * census instead (see tests/unit/interactive-openrouter-chain-byte-identity.test.js),
 * so this follows the same house pattern: read the source text and assert
 * the exact wiring shape, rather than booting the app.
 *
 * Asserts:
 *   - the observer-pass scheduler registration's `getPaidEnvKey` deps key is
 *     bound to the NEW resolver wrapper, not the raw `getPaidEnvKey` import
 *     from lib/openrouter.js (the old env-reading implementation);
 *   - that wrapper is built from `getUnattendedOpenRouterKey` (lib/openrouter-key-resolver.js)
 *     with `userPreferencesStore`, `sessionsCollection`, `accountWorkspaceStore`,
 *     and `accountStore` all threaded through to its construction.
 *
 * Run with: node --test tests/unit/observer-pass-server-wiring-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../../server.js', import.meta.url)), 'utf8');

describe('server.js: observer-pass unattended OpenRouter resolver wiring (LIN-2412)', () => {
  test('getUnattendedOpenRouterKey is imported from lib/openrouter-key-resolver.js', () => {
    assert.match(src, /import\s*\{[^}]*\bgetUnattendedOpenRouterKey\b[^}]*\}\s*from\s*['"]\.\/lib\/openrouter-key-resolver\.js['"]/);
  });

  test('resolveUnattendedOpenRouterKey wraps getUnattendedOpenRouterKey with all four required stores', () => {
    const fnStart = src.indexOf('async function resolveUnattendedOpenRouterKey(urlKey) {');
    assert.notEqual(fnStart, -1, 'resolveUnattendedOpenRouterKey must be defined');
    const fnEnd = src.indexOf('\n}', fnStart);
    const fnBody = src.slice(fnStart, fnEnd);

    assert.match(fnBody, /getUnattendedOpenRouterKey\(/, 'must call the new resolver export');
    for (const dep of ['userPreferencesStore', 'sessionsCollection', 'accountWorkspaceStore', 'accountStore']) {
      assert.match(fnBody, new RegExp(`\\b${dep}\\b`), `resolveUnattendedOpenRouterKey must thread ${dep} through to the resolver`);
    }
    // Same server/test-env short-circuit convention as getWorkspaceOpenRouterKey
    // (server.js:2397) — replicated here per the plan's constraint, not pushed
    // into the injectable seam.
    assert.match(fnBody, /NODE_ENV === 'test' && urlKey === 'test-workspace'/);
  });

  test('the observer-pass scheduler registration binds getPaidEnvKey to resolveUnattendedOpenRouterKey, NOT the raw env-reading import', () => {
    const regStart = src.indexOf("name: 'observer-pass'");
    assert.notEqual(regStart, -1, 'observer-pass scheduler.register call must exist');
    const regEnd = src.indexOf('}).catch(', regStart);
    const regBody = src.slice(regStart, regEnd);

    assert.match(regBody, /getPaidEnvKey:\s*resolveUnattendedOpenRouterKey/, 'the deps-object KEY stays "getPaidEnvKey" (createObserverPassRun\'s destructuring is untouched), but its VALUE must be the new resolver wrapper');
    assert.doesNotMatch(regBody, /getPaidEnvKey,(?!\s*intervalMs)/, 'must not still be passing the bare imported getPaidEnvKey shorthand');
  });

  test('the raw lib/openrouter.js getPaidEnvKey import is still used elsewhere (the startup warning), so this is a deliberate re-point, not an accidental duplicate binding', () => {
    // server.js:167ish — `if (process.env.OPENROUTER_API_KEY !== undefined && !getPaidEnvKey())`
    assert.match(src, /!getPaidEnvKey\(\)/, 'the original getPaidEnvKey import must still be used at its own startup-warning call site');
  });
});
