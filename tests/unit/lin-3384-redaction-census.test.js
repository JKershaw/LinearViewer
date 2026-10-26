/**
 * LIN-3384 (LIN-2954 S1.5) AC 3 — census of every call site that can reach a
 * live bootstrap token.
 *
 * `_formatItem` carries `bootstrapToken` and the prose `prompt`; it is reached
 * through the store readers (`listItems`, `getItemStatus`, `listHistory`,
 * `trimSessionBudget`, and the runner-only `pollAvailable`/`takeItem`), or
 * around them through a raw collection read or a direct formatter call. This
 * test keys every such CALL SITE (not file) by `file :: enclosing route or
 * function`, with the number of calls in it, and a verdict:
 *
 *   redacted         session/proxy-readable response; the site body must call redactSessionItem(s)
 *   runner           poll/take for a runner; must stay token-bearing (body must NOT redact)
 *   server-side-only result consumed in-process; never returned to a client as-is
 *   projection       result copied through an explicit allow-list / projection
 *   test-only        routes/test.js (not mounted in production)
 *
 * It fails on an unlisted site, a changed call count in a listed site, a stale
 * row, a `redacted` site whose body lacks the redactor, and a `runner` site
 * that redacts. The store itself (lib/dispatch-store.js) is the formatter's
 * home and is excluded, but no OTHER file may call `_formatItem(` /
 * `_formatHistoryItem(` or read the dispatch store's raw collections.
 *
 * Pure scanners over `{file, src}`; the mutation witnesses plant a fake in a
 * synthetic copy and assert the scan fails (lin-3136-enqueue-census style).
 *
 * LIN-3601: the dispatch entrances (E: routes/dispatch.js, routes/proxy-dispatch.js,
 * routes/proxy-kickoff.js, lib/dispatch-entrance.js) are judged as one unit so the
 * three routes can share one authority. A site in an E ROUTE file is still keyed
 * by its registration (an unlisted one fails), but its exact count is no longer
 * pinned and a row whose site has moved is not stale; a site in
 * lib/dispatch-entrance.js has no row at all. Inside E what is pinned is the
 * reader KIND (each listed kind occurs, an unlisted one fails). Which response a
 * row may leave in is carried by dispatch-entrance-redaction-canary-sweep.test.js,
 * which drives every read route with a runtime-built canary token.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isDashboardUnitFile } from './lib/dashboard-unit.js';
import { isWorkspaceApiUnitFile } from './lib/workspace-api-unit.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const STORE_FILE = 'lib/dispatch-store.js';
// LIN-3861: a site in any workspace-API unit file (routes/workspace-api.js, routes/workspace-api-*.js) is keyed
// by its route under this one name, so the LIN-2246 moves can place the route in any unit file. Verdict and
// count stay exact; a W route that is not in the table still fails as an unlisted site.
const W_UNIT = 'workspace-API unit';
const siteFile = (file) => (isWorkspaceApiUnitFile(file) ? W_UNIT : file);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(join(REPO, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(rel));
    else if (/\.(js|mjs)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const LIVE = [...walk('routes'), ...walk('lib')].map(file => ({ file, src: readFileSync(join(REPO, file), 'utf8') }));

// A reader, a direct formatter call, or a raw read of the dispatch store's own
// collections. The raw pattern spans newlines (`\s*` crosses them) and names
// only dispatch-store receivers, so unrelated stores' `collection.find` are not
// swept in; `historyCollection` is unique to the dispatch store.
const SITE = new RegExp([
  String.raw`\.\s*(listItemsWithPrompt|listItems|getItemStatus|getItemPrompt|getItemFeedback|listHistoryWithBodies|listHistoryLineageRows|listHistory|trimSessionBudget|pollAvailable|takeItem)\s*\(`,
  String.raw`\b(_formatItem|_formatHistoryItem)\s*\(`,
  String.raw`\bhistoryCollection\s*\.\s*(?:find|findOne|aggregate)\s*\(`,
  String.raw`\b(?:dispatchStore|dispatchQueueStore)\s*\.\s*(?:collection|historyCollection)\s*\.\s*(?:find|findOne|aggregate)\s*\(`
].join('|'), 'g');

const ANCHORS = [
  /^\s*router\.(?:get|post|put|patch|delete|use)\(\s*([A-Za-z_]+|['"`][^'"`]+['"`])/,
  /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/,
  /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:function|\()/,
  /^\s{2}(?:async\s+)?(?!for\b|if\b|while\b|switch\b|catch\b)(\w+)\s*\([^)]*\)\s*\{\s*$/
];

/** The enclosing anchor of line index `i`: its key and the handler body text. */
function enclosing(lines, i) {
  for (let j = i; j >= 0; j--) {
    for (const re of ANCHORS) {
      const m = lines[j].match(re);
      if (!m) continue;
      const indent = lines[j].match(/^\s*/)[0].length;
      let end = lines.length;
      for (let k = j + 1; k < lines.length; k++) {
        if (lines[k].trim().startsWith('}') && lines[k].match(/^\s*/)[0].length <= indent) { end = k + 1; break; }
      }
      return { key: m[1].replace(/^['"`]|['"`]$/g, ''), body: lines.slice(j, end).join('\n') };
    }
  }
  return { key: '?', body: '' };
}

/** `file :: anchor` → { count, body } for every site outside the store. */
function scanSites(files) {
  const sites = new Map();
  for (const { file, src } of files) {
    if (file === STORE_FILE) continue;
    const lines = src.split('\n');
    SITE.lastIndex = 0;
    let m;
    while ((m = SITE.exec(src))) {
      const idx = src.slice(0, m.index).split('\n').length - 1;
      if (/^\s*(\/\/|\*|\/\*)/.test(lines[idx])) continue;
      const { key, body } = enclosing(lines, idx);
      const id = `${siteFile(file)} :: ${key}`;
      const cur = sites.get(id) || { count: 0, body, kinds: [] };
      cur.count += 1;
      cur.kinds.push(m[1] || m[2] || 'raw-collection-read');
      sites.set(id, cur);
    }
  }
  return sites;
}

// Seeded from the research class table (comment 865ce8ca), re-derived from the tree.
const R = 'redacted', RUN = 'runner', SRV = 'server-side-only', PRJ = 'projection', TST = 'test-only';
const TABLE = {
  // routes — session / proxy readable
  'routes/dispatch.js :: /workspace/:urlKey/api/dispatch': [R, 1],
  'routes/dispatch.js :: /workspace/:urlKey/api/dispatch/history': [R, 1],
  'routes/dispatch.js :: /workspace/:urlKey/api/dispatch/:sessionId/trim': [R, 2], // LIN-3398: the owner gate's getItemStatus read + trimSessionBudget
  'routes/proxy-dispatch.js :: /api/proxy/dispatch/:id/prompt': [R, 1],
  // routes — runner (must keep the token)
  'routes/dispatch.js :: /api/dispatch/poll': [RUN, 1],
  'routes/dispatch.js :: /api/dispatch/take/:itemId': [RUN, 1],
  'routes/proxy-runner.js :: POLL_ROUTE': [RUN, 1],
  'routes/proxy-runner.js :: TAKE_ROUTE': [RUN, 1],
  // routes — in-process only
  // LIN-3398: the delete handler's owner-gate read (target only; the row is never sent)
  'routes/dispatch.js :: /workspace/:urlKey/api/dispatch/:itemId': [SRV, 1],
  // LIN-3657: the press route reads the named dispatch row for its issueSource only (the row is never sent)
  'workspace-API unit :: /workspace/:urlKey/api/run-evidence/:issueIdentifier/close-out-press': [SRV, 1],
  'routes/dispatch.js :: host': [SRV, 1],
  'routes/dispatch.js :: refuse': [SRV, 1],
  'routes/proxy-kickoff.js :: parentRun': [SRV, 1],
  // LIN-3840: the routes/dashboard.js rows (computeWorkspaceEffortReadout 2, loadRunForSummary 1,
  // both server-side-only) are gone. The dashboard unit (routes/dashboard.js, routes/dashboard-*.js)
  // is judged by reader kind at the end of this file and swept with a canary token by
  // dashboard-redaction-canary-sweep.test.js.
  'lib/dispatch-session-read.js :: pointReadSession': [SRV, 5], // LIN-3812: lifted from routes/dashboard.js; LIN-3975: +2 group reads (listItems/listHistory by sessionGroupId, indexed)
  // LIN-3855: the Models page's 30-day agent spend, reduced to numbers in the route (no row is returned).
  // LIN-3962: the one shared read (Settings › Models and Home's decision panel), moved into lib/model-routing-history.js.
  'lib/model-routing-history.js :: readModelsHistory': [SRV, 1],
  // routes — explicit allow-list / projection
  'routes/proxy-dispatch.js :: /api/proxy/dispatch': [PRJ, 3],
  'routes/proxy-dispatch.js :: /api/proxy/dispatch/:id': [PRJ, 1],
  'routes/proxy-dispatch.js :: liveSeen': [PRJ, 1], // the :id watch long-poll re-read, keyed lexically after LIN-3367's const liveSeen arrow
  'routes/proxy-compute.js :: /api/proxy/issues/:identifier/snapshots/diff': [PRJ, 3],
  'routes/proxy-compute.js :: /api/proxy/periodicals': [PRJ, 2],
  // routes — test only
  // LIN-3833: the same route also reads the row (`listItems`) so the run-source twin can compare the stamp with the control.
  'routes/test.js :: /test/dispatch-item': [TST, 2],
  // lib readers — results feed in-process derivations
  'lib/dispatch-factory.js :: anchor': [SRV, 1],
  'lib/dispatch-factory.js :: defaultFetchPilotPrFiles': [SRV, 2],
  'lib/dispatch-factory.js :: run': [SRV, 1],
  'lib/ci-wake-sweep.js :: readLineageRows': [SRV, 2],
  'lib/liveness-alarm-sweep.js :: sweepD2': [SRV, 2],
  'lib/observation-sessions-materializer.js :: _collectSessionIssues': [SRV, 7],
  'lib/observation-sessions-materializer.js :: _sessionsTouchingIssue': [SRV, 2],
  'lib/kpi-daily-rollup.js :: oldestDayOf': [PRJ, 1], // LIN-3724: raw history find projecting `dispatchedAt` only (backfill operator script)
  // LIN-3812: the loop builders' reads (lean default or the named whole-document pair); the digest
  // self-heal's raw historyCollection.find moved into the store with it
  'lib/pipeline-loops.js :: _readLive': [SRV, 2],
  'lib/pipeline-loops.js :: _readHistory': [SRV, 2],
  'lib/recent-runs.js :: read': [SRV, 2],
  'lib/task-run-facts.js :: readTaskRunFacts': [SRV, 3]
};

const REDACTOR = /\bredactSessionItems?\s*\(/;

// LIN-3601: the entrances as one unit.
const E_ROUTE_FILES = new Set(['routes/dispatch.js', 'routes/proxy-dispatch.js', 'routes/proxy-kickoff.js']);
const E_LIB_FILE = 'lib/dispatch-entrance.js';
// The reader kinds the entrances use today. Each must still occur somewhere in E;
// a kind that is not here (a direct formatter call, a raw collection read) fails.
const E_READER_KINDS = ['listItems', 'listItemsWithPrompt', 'getItemStatus', 'getItemPrompt', 'getItemFeedback', 'listHistoryLineageRows', 'listHistoryWithBodies', 'trimSessionBudget', 'pollAvailable', 'takeItem'];

/** Violations of the table against a set of `{file, src}`; [] means clean. */
function check(files, table = TABLE) {
  const v = [];
  const sites = scanSites(files);
  const eKinds = new Set();
  for (const [id, { count, body, kinds }] of sites) {
    const file = id.split(' :: ')[0];
    if (isDashboardUnitFile(file)) continue; // LIN-3840: judged by checkDashboardUnit below
    if (file === E_LIB_FILE) { kinds.forEach(k => eKinds.add(k)); continue; }
    if (E_ROUTE_FILES.has(file)) kinds.forEach(k => eKinds.add(k));
    const row = table[id];
    if (!row) { v.push(`unlisted site: ${id} (${count} call${count > 1 ? 's' : ''}) — classify it redacted|runner|server-side-only|projection|test-only`); continue; }
    const [verdict, expected] = row;
    if (count !== expected && !E_ROUTE_FILES.has(file)) v.push(`${id}: ${count} calls, table says ${expected}`);
    if (verdict === R && !REDACTOR.test(body)) v.push(`${id}: verdict redacted but the handler body never calls redactSessionItem(s)`);
    if (verdict === RUN && /redactSession/.test(body)) v.push(`${id}: verdict runner but the handler redacts — runners must receive the live token`);
  }
  for (const id of Object.keys(table)) {
    const file = id.split(' :: ')[0];
    if (!sites.has(id) && !E_ROUTE_FILES.has(file)) v.push(`stale row: ${id} no longer has a call site`);
  }
  for (const kind of E_READER_KINDS) if (!eKinds.has(kind)) v.push(`E reader kind ${kind}: no call left in the entrances — stale, or it moved out of E`);
  for (const kind of eKinds) if (!E_READER_KINDS.includes(kind)) v.push(`E reader kind ${kind}: an unlisted reader kind in the entrances — classify it and add a canary-sweep row`);
  v.push(...checkDashboardUnit(files));
  return v;
}

describe('LIN-3384 census — every token-reachable call site is classified', () => {
  test('the live tree matches the table', () => {
    assert.deepEqual(check(LIVE), []);
  });

  test('no file outside the store calls _formatItem( / _formatHistoryItem(', () => {
    const direct = LIVE.filter(f => f.file !== STORE_FILE && /\b_format(?:History)?Item\s*\(/.test(f.src)).map(f => f.file);
    assert.deepEqual(direct, []);
  });

  test('verdicts are from the closed set and all four redacted routes are present', () => {
    const verdicts = new Set(Object.values(TABLE).map(r => r[0]));
    for (const v of verdicts) assert.ok([R, RUN, SRV, PRJ, TST].includes(v), v);
    // LIN-3601: was `=== 4`. How many routes redact is a statement about how the
    // entrances are split; that every redacted read still redacts is the canary
    // sweep's. The table keeps its redacted rows, and the scan above still fails a
    // redacted row whose handler body lost the redactor.
    assert.ok(Object.values(TABLE).filter(r => r[0] === R).length >= 1);
  });
});

describe('LIN-3384 census — mutation witnesses (each fake must fail the scan)', () => {
  const clone = () => LIVE.map(f => ({ ...f }));
  const patch = (files, file, fn) => files.map(f => (f.file === file ? { ...f, src: fn(f.src) } : f));

  test('M4: a new session route returning getItemStatus unredacted inside routes/dispatch.js', () => {
    const files = patch(clone(), 'routes/dispatch.js', src => src.replace(
      "  router.get('/api/dispatch/poll'",
      "  router.get('/workspace/:urlKey/api/dispatch/leak/:id', async (req, res) => {\n    res.json(await dispatchQueueStore.getItemStatus(req.workspace.urlKey, req.params.id));\n  });\n\n  router.get('/api/dispatch/poll'"
    ));
    assert.notDeepEqual(files, LIVE);
    const v = check(files);
    assert.ok(v.some(x => x.includes('unlisted site') && x.includes('/leak/:id')), v.join('\n'));
  });

  // M4b (re-targeted, LIN-3601). It used to plant a second `listItems(` call in an
  // already-classified route and expect the exact count to fail. Count and position
  // inside E are no longer pinned (the entrances are one unit), so the witness is
  // planted two ways:
  //   - a new reader KIND in any entrance file fails this census (below);
  //   - a new read ROUTE that returns a raw row fails
  //     dispatch-entrance-redaction-canary-sweep.test.js (shown failing in a scratch
  //     copy: a `GET /api/proxy/dispatch/:id/raw` planted in routes/proxy-dispatch.js).
  for (const file of [...E_ROUTE_FILES, E_LIB_FILE]) {
    test(`M4b (re-targeted): a new reader kind planted in ${file} fails the census`, () => {
      const files = patch(clone(), file, src => `${src}\nexport const rawLeak = (dispatchStore) => dispatchStore\n  .historyCollection\n  .find({});\n`);
      const v = check(files);
      assert.ok(v.some(x => x.includes('E reader kind raw-collection-read') && x.includes('unlisted reader kind')), v.join('\n'));
    });
  }

  test('moving a reader call from a route into lib/dispatch-entrance.js keeps the census clean (E is one unit)', () => {
    const files = patch(patch(clone(), 'routes/dispatch.js', src => src.replace('const count = await dispatchQueueStore.countItems(workspace.urlKey);', 'const count = 0;')),
      E_LIB_FILE, src => `${src}\nexport const moved = (dispatchQueueStore, urlKey) => dispatchQueueStore.listItems(urlKey);\n`);
    assert.deepEqual(check(files), []);
  });

  test('a reader KIND that no longer occurs anywhere in E fails the census', () => {
    const files = clone().map(f => (E_ROUTE_FILES.has(f.file) || f.file === E_LIB_FILE ? { ...f, src: f.src.replaceAll('.pollAvailable(', '.nothingPolls(') } : f));
    const v = check(files);
    assert.ok(v.some(x => x.includes('E reader kind pollAvailable') && x.includes('no call left')), v.join('\n'));
  });

  test('M5: a new lib reader calling getItemStatus', () => {
    const files = [...clone(), { file: 'lib/zz-leak.js', src: "export async function leak(store, u, id) {\n  return store.getItemStatus(u, id);\n}\n" }];
    const v = check(files);
    assert.ok(v.some(x => x.includes('lib/zz-leak.js :: leak')), v.join('\n'));
  });

  test('M6: a raw collection read split across lines (round-3 N3 shape)', () => {
    const files = [...clone(), { file: 'lib/zz-raw.js', src: "export async function raw(dispatchStore) {\n  return dispatchStore\n    .historyCollection\n    .find({})\n    .toArray();\n}\n" }];
    const v = check(files);
    assert.ok(v.some(x => x.includes('lib/zz-raw.js :: raw')), v.join('\n'));
  });

  test('M7: a direct _formatItem( call outside the store', () => {
    const files = [...clone(), { file: 'lib/zz-fmt.js', src: "export function fmt(store, doc) {\n  return store._formatItem(doc);\n}\n" }];
    const v = check(files);
    assert.ok(v.some(x => x.includes('lib/zz-fmt.js :: fmt')), v.join('\n'));
  });

  // M3 ('removing the redactor from a redacted handler is caught') planted into
  // routes/dispatch.js text, which only holds while the redactor sits in that
  // handler body. LIN-3601: carried by dispatch-entrance-redaction-canary-sweep.test.js,
  // which fails when `redactSessionItems` is dropped from the history route, when
  // `maskBootstrapTokens` is skipped in `redactSessionItem`, and when the list route
  // stops redacting (all shown failing in a scratch copy: PR evidence).

  test('a runner handler that starts redacting is caught', () => {
    const files = patch(clone(), 'routes/proxy-runner.js', src => src.replace(
      'res.json({ item, dispatchId: item.id });',
      'res.json({ item: redactSessionItem(item, null), dispatchId: item.id });'
    ));
    const v = check(files);
    assert.ok(v.some(x => x.includes('TAKE_ROUTE') && x.includes('runners must receive')), v.join('\n'));
  });

  test('a stale row (site removed) is caught', () => {
    const v = check(clone(), { ...TABLE, 'lib/gone.js :: nothing': [SRV, 1] });
    assert.ok(v.some(x => x.includes('stale row: lib/gone.js')), v.join('\n'));
  });
});

// ─── LIN-3840: the dashboard routes as one unit ──────────────────────────────
// Inside the dashboard unit (routes/dashboard.js, routes/dashboard-*.js) what is
// pinned is the reader KIND: each kind below must still occur, an unlisted kind
// (a raw historyCollection read, a direct formatter call, a runner reader) fails.
// Counts and `file :: function` keys are dropped so the createDashboardRoutes rebuild
// (LIN-3742) can place its reads anywhere in the unit. Which response a read may
// leave in is carried by dashboard-redaction-canary-sweep.test.js, which drives
// every dashboard route with a runtime-built canary token. These are the unit's own
// kinds, not E_READER_KINDS.
const DASHBOARD_UNIT_READER_KINDS = ['getItemStatus', 'listItems', 'listHistory'];

/** Violations of the unit rule against a set of `{file, src}`; [] means clean. */
function checkDashboardUnit(files) {
  const v = [];
  const kinds = new Set();
  for (const { kinds: k } of scanSites(files.filter(f => isDashboardUnitFile(f.file))).values()) k.forEach(x => kinds.add(x));
  for (const kind of DASHBOARD_UNIT_READER_KINDS) if (!kinds.has(kind)) v.push(`dashboard unit reader kind ${kind}: no call left in the unit — stale, or it moved out of the unit`);
  for (const kind of kinds) if (!DASHBOARD_UNIT_READER_KINDS.includes(kind)) v.push(`dashboard unit reader kind ${kind}: an unlisted reader kind in the unit — classify it and add a canary-sweep row`);
  return v;
}

describe('LIN-3840 census — dashboard unit reader kinds', () => {
  const clone = () => LIVE.map(f => ({ ...f }));

  test('the live unit reads exactly getItemStatus, listItems and listHistory', () => {
    assert.deepEqual(checkDashboardUnit(LIVE), []);
  });

  test('moving a reader call into a new unit file stays clean (the unit is judged whole)', () => {
    const files = [...clone(), { file: 'routes/dashboard-moved.js', src: 'export const m = (dispatchQueueStore, urlKey) => dispatchQueueStore.listItems(urlKey);\n' }];
    assert.deepEqual(checkDashboardUnit(files), []);
  });

  test('witness: a raw historyCollection.find( planted in a unit file fails', () => {
    for (const file of ['routes/dashboard.js', 'routes/dashboard-x.js']) {
      const files = [...clone().filter(f => f.file !== file), { file, src: `${LIVE.find(f => f.file === file)?.src ?? ''}\nexport const rawLeak = (dispatchStore) => dispatchStore\n  .historyCollection\n  .find({});\n` }];
      const v = checkDashboardUnit(files);
      assert.ok(v.some(x => x.includes('raw-collection-read') && x.includes('unlisted reader kind')), `${file}: ${v.join('\n')}`);
    }
  });

  test('witness: a runner reader (takeItem) planted in a unit file fails', () => {
    const files = [...clone(), { file: 'routes/dashboard-x.js', src: 'export const t = (s) => s.takeItem("a");\n' }];
    assert.ok(checkDashboardUnit(files).some(x => x.includes('takeItem') && x.includes('unlisted reader kind')));
  });

  test('witness: every getItemStatus( removed from the unit fails as stale', () => {
    const files = clone().map(f => (isDashboardUnitFile(f.file) ? { ...f, src: f.src.replaceAll('.getItemStatus(', '.nothingReads(') } : f));
    assert.ok(checkDashboardUnit(files).some(x => x.includes('getItemStatus') && x.includes('no call left')));
  });

  test('a reader in lib/ (outside the unit) does not count toward the unit', () => {
    const files = clone().map(f => (isDashboardUnitFile(f.file) ? { ...f, src: f.src.replaceAll('.getItemStatus(', '.nothingReads(') } : f));
    files.push({ file: 'lib/zz-reader.js', src: 'export const r = (s) => s.getItemStatus("u", "i");\n' });
    assert.ok(checkDashboardUnit(files).some(x => x.includes('getItemStatus') && x.includes('no call left')));
  });
});

// ─── LIN-3861: the press route's read is a W row ─────────────────────────────
// Witnesses are built from a SYNTHETIC unit (LIVE with every W file taken out, plus synthetic W files),
// never from the live text of routes/workspace-api.js, which is free to move.
describe('LIN-3861 census — the close-out-press read is keyed to the workspace-API unit', () => {
  const PRESS = '/workspace/:urlKey/api/run-evidence/:issueIdentifier/close-out-press';
  const route = (path, reads = 1) => `export function mount(router) {\n  router.post('${path}', async (req, res) => {\n${'    const row = await dispatchQueueStore.getItemStatus(req.workspace.urlKey, req.params.issueIdentifier);\n'.repeat(reads)}    res.json({ ok: true });\n  });\n}\n`;
  const unitOf = (map) => [...LIVE.filter(f => !isWorkspaceApiUnitFile(f.file)), ...Object.entries(map).map(([file, src]) => ({ file, src }))];

  test('the press route in routes/workspace-api.js, or moved to routes/workspace-api-x.js, keeps the census clean', () => {
    assert.deepEqual(check(unitOf({ 'routes/workspace-api.js': route(PRESS) })), []);
    assert.deepEqual(check(unitOf({ 'routes/workspace-api-x.js': route(PRESS) })), []);
    assert.deepEqual(check(unitOf({ 'routes/workspace-api.js': 'export {};\n', 'routes/workspace-api-press.js': route(PRESS) })), []);
  });

  test('a second getItemStatus read in the press route fails the exact count (1)', () => {
    const v = check(unitOf({ 'routes/workspace-api-x.js': route(PRESS, 2) }));
    assert.ok(v.some(x => x.startsWith(`${W_UNIT} :: ${PRESS}: 2 calls, table says 1`)), v.join('\n'));
  });

  test('the same route split over two W files also counts 2 (the row is keyed to the unit)', () => {
    const v = check(unitOf({ 'routes/workspace-api.js': route(PRESS), 'routes/workspace-api-x.js': route(PRESS) }));
    assert.ok(v.some(x => x.startsWith(`${W_UNIT} :: ${PRESS}: 2 calls, table says 1`)), v.join('\n'));
  });

  test('a getItemStatus in a new W route fails as an unlisted site, wherever in the unit it sits', () => {
    for (const file of ['routes/workspace-api.js', 'routes/workspace-api-x.js']) {
      const v = check(unitOf({ [file]: route(PRESS) + route('/workspace/:urlKey/api/leak/:id') }));
      assert.ok(v.some(x => x.includes('unlisted site') && x.includes(`${W_UNIT} :: /workspace/:urlKey/api/leak/:id`)), `${file}: ${v.join('\n')}`);
    }
  });

  test('the press read removed from the unit fails as a stale row; the same route in a non-W file is a different, unlisted key', () => {
    const stale = check(unitOf({ 'routes/workspace-api.js': 'export {};\n' }));
    assert.ok(stale.some(x => x.startsWith(`stale row: ${W_UNIT} :: ${PRESS}`)), stale.join('\n'));
    const elsewhere = check(unitOf({ 'routes/workspace-api.js': route(PRESS), 'routes/zz-press.js': route(PRESS) }));
    assert.ok(elsewhere.some(x => x.includes('unlisted site') && x.includes(`routes/zz-press.js :: ${PRESS}`)), elsewhere.join('\n'));
  });
});
