/**
 * Settings-route post-bind flash wiring census (LIN-2803).
 *
 * server.js boots a real app on import and is never imported directly by the
 * unit suite (see tests/unit/settings-route-consent-census.test.js for the
 * house pattern this follows) — so this reads the source text and asserts the
 * exact wiring shape rather than booting the app. The behavioral end of this
 * chain (a real flash producing a real notice with a working activate form)
 * is proven end-to-end by tests/e2e/settings-providers.spec.js's
 * notice->activate->drill-down scenario; this closes the gap that scenario
 * cannot reach on its own — the exact GATING conditions inside
 * `providerNoticeFromQuery`, which no render-settings.test.js call (it never
 * invokes the route handler) or e2e run (which only ever exercises one
 * concrete instantiation) can regress-proof by itself.
 *
 * Run with: node --test tests/unit/lin-2803-settings-flash-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../../server.js', import.meta.url)), 'utf8');

function providerNoticeFromQueryBody() {
  const start = src.indexOf('function providerNoticeFromQuery(');
  assert.notEqual(start, -1, 'providerNoticeFromQuery must exist');
  const end = src.indexOf('\n}\n', start);
  assert.notEqual(end, -1, 'providerNoticeFromQuery must have a closing brace');
  return src.slice(start, end);
}

function settingsRouteBody() {
  const start = src.indexOf("app.get('/workspace/:urlKey/settings', workspaceFromUrl, async (req, res) => {");
  assert.notEqual(start, -1, 'the settings route registration must exist');
  const tailMarker = 'res.send(html);\n});';
  const tailIdx = src.indexOf(tailMarker, start);
  assert.notEqual(tailIdx, -1, 'the settings route must end with the standard res.send(html) tail');
  return src.slice(start, tailIdx + tailMarker.length);
}

describe('server.js: post-bind session flash wiring (LIN-2803)', () => {
  test('the settings route reads req.session.providerAdded and deletes it UNCONDITIONALLY', () => {
    const body = settingsRouteBody();
    // The read must happen before the delete is provably unconditional (no
    // guard on query.provider_ok or anything else) — a stale flash must never
    // survive a second, unrelated load.
    assert.match(
      body,
      /const\s+providerAddedFlash\s*=\s*req\.session\.providerAdded\s*\|\|\s*null;\s*\n\s*delete\s+req\.session\.providerAdded;/,
      'must read then unconditionally delete req.session.providerAdded, in that order, with no conditional guarding the delete'
    );
  });

  test('the settings route threads the flash into providerNoticeFromQuery', () => {
    const body = settingsRouteBody();
    assert.match(
      body,
      /providerNoticeFromQuery\(req\.query,\s*providerAddedFlash\)/,
      'must pass the read flash as providerNoticeFromQuery\'s second argument'
    );
  });

  test('providerNoticeFromQuery only attaches `activate` when the flash provider matches THIS notice\'s provider_ok', () => {
    const body = providerNoticeFromQueryBody();
    assert.match(
      body,
      /flash\s*&&\s*flash\.provider\s*===\s*query\.provider_ok/,
      'a stale/cross-tab/unrelated flash must never attach `activate` to a different provider_ok notice'
    );
  });

  test('providerNoticeFromQuery never attaches `activate` for a provider whose add creates a separate workspace', () => {
    const body = providerNoticeFromQueryBody();
    assert.match(
      body,
      /getProvider\(flash\.provider\)\?\.addProvider\?\.createsWorkspace\s*!==\s*true/,
      'must gate on createsWorkspace !== true (never === false, so a provider declaring nothing defaults to the honest "binds" reading) before offering "make active"'
    );
  });

  test('providerNoticeFromQuery does not change any existing non-provider_ok branch\'s text', () => {
    const body = providerNoticeFromQueryBody();
    // Every other branch (provider_blocked/removed/switched/fail/error) must
    // stay byte-identical to its pre-LIN-2803 text — only provider_ok grew an
    // optional `activate` field.
    assert.match(body, /Adding \$\{query\.provider_blocked\} is not available yet\./);
    assert.match(body, /Removed \$\{query\.provider_removed\} binding\./);
    assert.match(body, /Switched active provider to \$\{query\.provider_switched\}\./);
    assert.match(body, /\$\{query\.provider_fail\} credentials failed validation\./);
    assert.match(body, /Provider action could not be completed\./);
  });
});
