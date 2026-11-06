/**
 * LIN-4103 beat 3 — the rulings badge paints the page's own workspace number, from the real route's JSON (LIN-4308).
 *
 * Moved here from tests/unit/dashboard-routes.test.js (LIN-4254 piece 2). No unit suite covered `updateRulingsBadge`
 * before, and the test is the client half of the badge contract:
 *   - the JSON comes from the real rulings handler (the shared route fixture, tests/fixtures/dashboard-router.js);
 *   - the function is the real shipped one, sliced out of public/common.js and run in a loadWorld over the fake DOM;
 *   - the badge is the real markup the navbar draws (renderNavBar with `featureFlags.runControls: true`, lib/components/navbar.js).
 *
 * Run with: node --test tests/unit/rulings-badge-client.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderNavBar } from '../../lib/components/navbar.js';
import { getHandler, makeReqRes, makeRouter, decisionItem } from '../fixtures/dashboard-router.js';
import { loadWorld } from './helpers/client-world.js';

const COMMON_JS_SRC = readFileSync(new URL('../../public/common.js', import.meta.url), 'utf8');

/** The shipped `updateRulingsBadge`, from its assignment to its closing brace in public/common.js. */
function updateRulingsBadgeSource() {
  const start = COMMON_JS_SRC.indexOf('window.updateRulingsBadge = async function updateRulingsBadge(');
  const end = COMMON_JS_SRC.indexOf('\n};', start);
  assert.ok(start !== -1 && end !== -1, 'updateRulingsBadge not found in public/common.js');
  return COMMON_JS_SRC.slice(start, end + 3);
}

describe('LIN-4103 beat 3 — the rulings feed counts the page\'s own workspace for the badge', () => {
  // LIN-4103 review item 2: the number painted in the header badge is the page's own workspace, the number its Home count
  // line shows ("N waiting on you" reads that workspace's rulings only). Distinguishing precondition: a SECOND workspace on
  // the same session holds a ruling; with one workspace both numbers agree by accident. The client function is the real
  // shipped one, sliced out of public/common.js and run against the real route's JSON, so a badge that reads the
  // all-workspaces `count` paints 2 here and fails.
  test('the badge paints the page\'s own workspace number when a second workspace holds a ruling', async () => {
    const router = makeRouter({
      'ws-a': { live: [], history: [decisionItem('a-dec', 'LIN-24', 'd-a')], agentStatus: [] },
      'ws-b': { live: [], history: [decisionItem('b-dec', 'LIN-25', 'd-b'), decisionItem('b-dec2', 'LIN-28', 'd-b2')], agentStatus: [] },
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/rulings');
    const workspaces = [{ urlKey: 'ws-a', name: 'Alpha' }, { urlKey: 'ws-b', name: 'Beta' }];
    const session = { workspaces };

    // One fresh world per paint: one page, one badge, with the route's JSON as this page's fetch answer.
    const paint = async (urlKey) => {
      const { req, res } = makeReqRes({ session, params: { urlKey } });
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      const world = loadWorld({
        scripts: [],
        globals: { fetch: async () => ({ ok: true, json: async () => res.jsonBody }) },
      });
      world.document.body.innerHTML = renderNavBar({ workspaces, urlKey, featureFlags: { runControls: true } });
      world.run(updateRulingsBadgeSource());
      await world.window.updateRulingsBadge(urlKey);
      const badge = world.document.querySelector(`[data-rulings-badge][data-url-key="${urlKey}"]`);
      assert.ok(badge, `the navbar draws the rulings badge for ${urlKey}`);
      return { text: badge.querySelector('.rulings-count').textContent, feedCount: res.jsonBody.count };
    };

    const a = await paint('ws-a');
    assert.equal(a.feedCount, 3, 'the all-workspaces count is 3 (this is the number a wrong badge would paint)');
    assert.equal(String(a.text), '1', 'workspace A\'s badge equals A\'s count line: one ruling');
    const b = await paint('ws-b');
    assert.equal(String(b.text), '2', 'workspace B\'s badge equals B\'s count line: two rulings');
  });
});
