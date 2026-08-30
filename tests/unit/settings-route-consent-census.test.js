/**
 * Settings-route consent-read census (LIN-2412 F2 correction / plan §E.3).
 *
 * server.js boots a real app on import (DB connections, scheduler timers) and
 * is never imported directly by the unit suite — every server.js-wiring check
 * in this repo is a source census instead (tests/unit/observer-pass-server-wiring-census.test.js,
 * tests/unit/interactive-openrouter-chain-byte-identity.test.js), so this
 * follows the same house pattern: read the source text and assert the exact
 * wiring shape, rather than booting the app.
 *
 * The implementation review (comment 1199ca28) mutation-verified that BOTH of
 * these claims were previously UNPROVEN — the full 8635-test unit suite passed
 * unchanged with the settings route's consent read hard-coded to `null` (M1),
 * and separately with the read's result also assigned into `req.session` (M8).
 * `tests/unit/render-settings.test.js`'s renderer-prop coverage does not touch
 * this — it never invokes the route handler, so a route-level regression here
 * is invisible to it. This file closes that hole with the two required
 * assertions, matching M1/M8 to make sure a regression that reproduces either
 * mutation fails HERE.
 *
 * Run with: node --test tests/unit/settings-route-consent-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../../server.js', import.meta.url)), 'utf8');

function settingsRouteBody() {
  const start = src.indexOf("app.get('/workspace/:urlKey/settings', workspaceFromUrl, async (req, res) => {");
  assert.notEqual(start, -1, 'the settings route registration must exist');
  // Bounded by the route's own closing res.send(html);\n});  — the next
  // top-level app.get/app.post registration is well past this, so anchor on
  // the route's own known tail rather than a generic brace-matcher.
  const tailMarker = 'res.send(html);\n});';
  const tailIdx = src.indexOf(tailMarker, start);
  assert.notEqual(tailIdx, -1, 'the settings route must end with the standard res.send(html) tail');
  return src.slice(start, tailIdx + tailMarker.length);
}

describe('server.js: GET /workspace/:urlKey/settings consent read wiring (LIN-2412 F2)', () => {
  test('performs a FRESH per-request read of the current account\'s durable consent (not a session read)', () => {
    const body = settingsRouteBody();
    assert.match(
      body,
      /const\s+openRouterConsentedAt\s*=\s*req\.session\.accountId\s*\?\s*await\s+userPreferencesStore\.getOpenRouterConsent\(req\.session\.accountId\)\s*:\s*null/,
      'must call userPreferencesStore.getOpenRouterConsent(accountId) fresh on every render — mutation M1 (hard-coding this to null) must fail here, since it passed the full unit suite otherwise'
    );
  });

  test('threads the fresh read into renderSettingsPage as openRouterConsentedAt', () => {
    const body = settingsRouteBody();
    const renderCallStart = body.indexOf('renderSettingsPage(');
    assert.notEqual(renderCallStart, -1, 'must call renderSettingsPage');
    const renderCallEnd = body.indexOf('res.send(html);', renderCallStart);
    const renderCallBody = body.slice(renderCallStart, renderCallEnd);
    assert.match(renderCallBody, /\bopenRouterConsentedAt\b/, 'the renderSettingsPage call must thread the openRouterConsentedAt prop');
  });

  test('does NOT assign the consent read into req.session anywhere in the route', () => {
    const body = settingsRouteBody();
    assert.doesNotMatch(
      body,
      /req\.session\.openRouterDurableConsentAt\s*=/,
      'the settings route must never mirror durable consent into req.session — mutation M8 (adding this assignment) must fail here, since it passed the full unit suite otherwise'
    );
    // Broader net: no assignment of openRouterConsentedAt itself onto req.session
    // under any spelling, in case a future edit renames the mirrored field.
    assert.doesNotMatch(
      body,
      /req\.session\.\w*[Cc]onsent\w*\s*=/,
      'the settings route must never assign ANY consent-named field onto req.session'
    );
  });
});
