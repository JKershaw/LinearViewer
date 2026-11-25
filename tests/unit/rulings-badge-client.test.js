/**
 * LIN-4103 beat 3 — the rulings badge paints the page's own workspace number, from the real route's JSON (LIN-4308).
 *
 * Moved here from tests/unit/dashboard-routes.test.js (LIN-4254 piece 2). No unit suite covered `updateRulingsBadge`
 * before, and the test is the client half of the badge contract:
 *   - the JSON comes from the real rulings handler (routes/dashboard-rulings.js) over a real records store;
 *   - the function is the real shipped one, sliced out of public/common.js and run in a loadWorld over the fake DOM;
 *   - the badge is the real markup the navbar draws (renderNavBar with `featureFlags.runControls: true`, lib/components/navbar.js).
 *
 * LIN-4541: a ruling is an open question record addressed to the person (the old decision rows retired with the ruling
 * predicate), so the workspaces' rulings are question records here.
 *
 * Run with: node --test tests/unit/rulings-badge-client.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderNavBar } from '../../lib/components/navbar.js';
import { renderRail } from '../../lib/components/frame.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { createDashboardRulingsRoutes } from '../../routes/dashboard-rulings.js';
import { loadWorld } from './helpers/client-world.js';

const COMMON_JS_SRC = readFileSync(new URL('../../public/common.js', import.meta.url), 'utf8');
const OWNER = 'acct-owner';
const harness = createMangoTmpdir('rulings-badge-');

before(() => harness.connect());
after(() => harness.close());

/** The shipped `updateRulingsBadge`, from its assignment to its closing brace in public/common.js. */
function updateRulingsBadgeSource() {
  // LIN-4552: from the badge's words (questionsWords, defined just above it) through updateRulingsBadge.
  const start = COMMON_JS_SRC.indexOf('window.questionsWords = function questionsWords(');
  const end = COMMON_JS_SRC.indexOf('\n};', COMMON_JS_SRC.indexOf('window.updateRulingsBadge = async function updateRulingsBadge('));
  assert.ok(start !== -1 && end !== -1, 'updateRulingsBadge not found in public/common.js');
  return COMMON_JS_SRC.slice(start, end + 3);
}

/** The route's GET handler, the way express calls it, over the given stores. */
function rulingsHandler({ recordsStore, dispatchQueueStore }) {
  const router = createDashboardRulingsRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    sessionsFeedCache: { keyFor: (_ws, ns) => ns, get: async (_k, fn) => fn(), clear() {} },
    mergeLoops: async () => [],
    recordsStore,
    dispatchQueueStore,
    accountStore: { resolveCanonicalAccountId: async (id) => id },
  });
  const layer = router.stack.find((l) => l.route?.path === '/workspace/:urlKey/api/dashboard/rulings');
  const handlers = layer.route.stack.map((s) => s.handle);
  return handlers[handlers.length - 1];
}

describe('LIN-4103 beat 3 — the rulings feed counts the page\'s own workspace for the badge', () => {
  // LIN-4103 review item 2: the number painted in the header badge is the page's own workspace, the number its Home count
  // line shows ("N questions" reads that workspace's questions only). Distinguishing precondition: a SECOND workspace on
  // the same session holds a ruling; with one workspace both numbers agree by accident. The client function is the real
  // shipped one, sliced out of public/common.js and run against the real route's JSON, so a badge that reads the
  // all-workspaces `count` paints 3 here and fails.
  test('the badge paints the page\'s own workspace number when a second workspace holds a ruling', async () => {
    const db = harness.freshDb();
    await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
    const recordsStore = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
    const dispatchQueueStore = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
    const writes = createRecordWrites({ recordsStore, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation'], listPeople: async () => [{ accountId: OWNER, name: 'Owner' }] });
    const ask = (urlKey, asks) => writes.add({
      urlKey, kind: 'question', by: 'implementation', run: null,
      input: { asks, options: ['yes', 'no'], recommended: 'yes', 'if-unanswered': 'wait', to: `person:${OWNER}` },
    });
    await ask('ws-a', 'A?');
    await ask('ws-b', 'B one?');
    await ask('ws-b', 'B two?');

    const handler = rulingsHandler({ recordsStore, dispatchQueueStore });
    const workspaces = [{ urlKey: 'ws-a', name: 'Alpha' }, { urlKey: 'ws-b', name: 'Beta' }];
    const session = { accountId: OWNER, workspaces };

    // One fresh world per paint: one page, one badge, with the route's JSON as this page's fetch answer.
    const paint = async (urlKey) => {
      let body = null;
      let status = 200;
      const res = {
        headersSent: false, writableEnded: false,
        status(code) { status = code; return this; },
        setHeader() {}, writeHead() { return this; }, write() {}, flushHeaders() {}, on() {},
        json(b) { body = b; this.headersSent = true; this.writableEnded = true; return this; },
        send(b) { body = typeof b === 'string' ? JSON.parse(b) : b; this.headersSent = true; this.writableEnded = true; return this; },
        end(b) { if (b) body = JSON.parse(b); this.writableEnded = true; },
      };
      await handler({ session, params: { urlKey }, on() {} }, res);
      assert.equal(status, 200);
      const world = loadWorld({
        scripts: [],
        globals: { fetch: async () => ({ ok: true, json: async () => body }) },
      });
      world.document.body.innerHTML = renderNavBar({ workspaces, urlKey, featureFlags: { runControls: true } });
      world.run(updateRulingsBadgeSource());
      await world.window.updateRulingsBadge(urlKey);
      const badge = world.document.querySelector(`[data-rulings-badge][data-url-key="${urlKey}"]`);
      assert.ok(badge, `the navbar draws the rulings badge for ${urlKey}`);
      return { text: badge.querySelector('.rulings-count').textContent, feedCount: body.count };
    };

    const a = await paint('ws-a');
    assert.equal(a.feedCount, 3, 'the all-workspaces count is 3 (this is the number a wrong badge would paint)');
    assert.equal(String(a.text), '1 question', 'workspace A\'s badge equals A\'s count line: one question (LIN-4552: "N questions")');
    const b = await paint('ws-b');
    assert.equal(String(b.text), '2 questions', 'workspace B\'s badge equals B\'s count line: two questions');
  });
});

describe('LIN-4562: the frame draws the count twice (Home\'s rail item and the phone band); the updater writes every copy', () => {
  test('both copies read the number and show; at zero both hide', async () => {
    let body = { workspaceCount: 2, count: 5 };
    const world = loadWorld({ scripts: [], globals: { fetch: async () => ({ ok: true, json: async () => body }) } });
    // The band's copy is the same markup with its own test id (lib/components/frame.js questionsCount).
    const rail = renderRail({ urlKey: 'ws-a', workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }], featureFlags: { runControls: true } });
    const bandCopy = rail.match(/<a class="frame-count[^>]*data-testid="rail-questions"[\s\S]*?<\/a>/)[0].replace('rail-questions', 'band-questions');
    world.document.body.innerHTML = `${rail}${bandCopy}`;
    world.run(updateRulingsBadgeSource());
    await world.window.updateRulingsBadge('ws-a');
    const copies = [...world.document.querySelectorAll('[data-rulings-badge][data-url-key="ws-a"]')];
    assert.equal(copies.length, 2);
    for (const copy of copies) {
      assert.equal(String(copy.querySelector('.rulings-count').textContent), '2 questions');
      assert.equal(copy.classList.contains('hidden'), false);
    }
    body = { workspaceCount: 0, count: 0 };
    await world.window.updateRulingsBadge('ws-a');
    for (const copy of copies) assert.equal(copy.classList.contains('hidden'), true, 'hidden at zero');
  });
});
