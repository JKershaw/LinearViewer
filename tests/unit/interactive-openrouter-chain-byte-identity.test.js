/**
 * Non-opt-in byte-identical assertion (LIN-2412, plan §A.10/§E.7).
 *
 * LIN-2412 adds consent-gated, env-free unattended resolution — it must NOT
 * change the interactive `OAuth > env > free` chain for users who never opt
 * in. This is a scoped source census (same house pattern as
 * tests/unit/observer-pass.test.js's static-import assertion and
 * tests/unit/owner-credential-durable-delete-census.test.js's call-site
 * count): it pins the EXACT six interactive route families' control-flow
 * shape, plus server.js's getOpenRouterSource, so an accidental edit to any
 * of them — not just a deletion — fails loudly here rather than silently
 * shipping alongside this ticket's real (additive) changes.
 *
 * The six families (research §L5 / plan §A.10, corrected to six by F3):
 * routes/task-chat.js, routes/next-run.js, routes/ship-biscuit.js,
 * routes/workspace-api-roadmap.js (two call sites), routes/workspace-api.js,
 * and routes/dashboard.js (two call sites, a distinct shape from the other
 * five — no explicit apiKeyToUse, relies on streamChat's own env default).
 * None of these files, nor server.js's getOpenRouterSource, are touched by
 * this ticket's implementation.
 *
 * routes/workspace-api.js correction (LIN-2412 review finding F3): the
 * original version of this file claimed ONE occurrence of the shared
 * `sessionApiKey || getPaidEnvKey() || freeTierKey` expression in
 * routes/workspace-api.js and stopped there, describing that as the whole
 * family's presence in the file. In fact routes/workspace-api.js carries SIX
 * interactive resolution sites, not one: the pinned occurrence (the
 * feedback-title path) plus FIVE more using a distinct shape,
 * `apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined)`
 * (recommend, recommend-stream, recap, brief, scan). The constraint held as a
 * matter of fact either way (the file was untouched by this ticket's diff),
 * but the claim over-stated what was pinned. This revision pins all six, per
 * the review's "extend the census" resolution rather than merely narrowing
 * the claim's wording.
 *
 * Run with: node --test tests/unit/interactive-openrouter-chain-byte-identity.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function read(relPath) {
  return readFileSync(fileURLToPath(new URL(`../../${relPath}`, import.meta.url)), 'utf8');
}

// The exact shared chain expression the five `apiKeyToUse`/`apiKey`-shaped
// families use. Counting occurrences (not just presence) catches both a
// removed site and an accidental duplicate/new site.
const SHARED_CHAIN_EXPR = 'sessionApiKey || getPaidEnvKey() || freeTierKey';

describe('Interactive OpenRouter chain: byte-identity census (LIN-2412)', () => {
  test('the shared "sessionApiKey || getPaidEnvKey() || freeTierKey" chain appears in EXACTLY the five expected families, once each except workspace-api-roadmap.js (two)', () => {
    const expectedCounts = {
      'routes/task-chat.js': 1,
      'routes/next-run.js': 1,
      'routes/ship-biscuit.js': 1,
      'routes/workspace-api-roadmap.js': 2,
      'routes/workspace-api.js': 1,
    };
    for (const [relPath, expectedCount] of Object.entries(expectedCounts)) {
      const src = read(relPath);
      const actualCount = src.split(SHARED_CHAIN_EXPR).length - 1;
      assert.equal(actualCount, expectedCount, `${relPath}: expected ${expectedCount} occurrence(s) of the shared chain expression, found ${actualCount}`);
    }
  });

  test('routes/workspace-api.js: the remaining FIVE interactive sites carry the "apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined)" shape (LIN-2412 F3 correction)', () => {
    const src = read('routes/workspace-api.js');
    const SITE_SHAPE = 'apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined)';
    const actualCount = src.split(SITE_SHAPE).length - 1;
    assert.equal(actualCount, 5, `expected exactly 5 occurrence(s) of the apiKeyToUse shape (recommend/recommend-stream/recap/brief/scan), found ${actualCount} — routes/workspace-api.js therefore carries 6 total interactive resolution sites (1 pinned above + these 5), not the 1 this census originally over-claimed as the whole file`);
  });

  test('routes/dashboard.js carries its own distinct shape at BOTH call sites (run-summary + session-summary), untouched', () => {
    const src = read('routes/dashboard.js');
    const dashboardShape = [
      "const sessionApiKey = req.session.openRouterApiKey;",
      "const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;",
      "const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;",
    ].join('\n    ');
    const occurrences = src.split(dashboardShape).length - 1;
    assert.equal(occurrences, 2, 'expected exactly two call sites (run-summary, session-summary) carrying this exact shape');

    const guardShape = 'if (!sessionApiKey && !hasPaidEnvKey() && !freeTierKey) {';
    const guardOccurrences = src.split(guardShape).length - 1;
    assert.equal(guardOccurrences, 2, 'expected exactly two matching degrade guards');
  });

  test('server.js getOpenRouterSource (the priority predicate behind the footer/settings status) is byte-identical to its pinned shape', () => {
    const src = read('server.js');
    const expected = `function getOpenRouterSource(req) {
  if (req.session.openRouterApiKey) return 'oauth';
  // hasPaidEnvKey() trims, so a blank/whitespace OPENROUTER_API_KEY is NOT
  // classified as a paid \`env\` source (LIN-961). This keeps the operator-facing
  // status honest: the footer can no longer read a blank key as \`env\` while the
  // token-authed proxy path silently runs on the free tier — the exact
  // divergence that hid this bug.
  if (hasPaidEnvKey()) return 'env';
  if (process.env.OPENROUTER_FREE_TIER_KEY || req.session.freeTierEnabled) return 'free';
  return null;
}`;
    assert.ok(src.includes(expected), 'getOpenRouterSource must remain byte-identical — LIN-2412 must never read consent here');
  });

  test('getOpenRouterSource itself never references the new durable consent field', () => {
    const src = read('server.js');
    const fnStart = src.indexOf('function getOpenRouterSource(req) {');
    const fnEnd = src.indexOf('\n}', fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    assert.doesNotMatch(fnBody, /openRouterDurableConsentAt|getOpenRouterConsent/, 'the interactive source predicate must never read the unattended-use consent field');
  });
});
