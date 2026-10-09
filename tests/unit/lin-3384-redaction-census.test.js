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
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const STORE_FILE = 'lib/dispatch-store.js';

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
  String.raw`\.\s*(listItems|getItemStatus|listHistory|trimSessionBudget|pollAvailable|takeItem)\s*\(`,
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
      const id = `${file} :: ${key}`;
      const cur = sites.get(id) || { count: 0, body };
      cur.count += 1;
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
  'routes/dispatch.js :: host': [SRV, 1],
  'routes/dispatch.js :: refuse': [SRV, 1],
  'routes/proxy-kickoff.js :: parentRun': [SRV, 1],
  'routes/dashboard.js :: computeWorkspaceEffortReadout': [SRV, 2],
  'routes/dashboard.js :: loadRunForSummary': [SRV, 1],
  'routes/dashboard.js :: pointReadSession': [SRV, 3],
  'routes/dashboard.js :: readRunFacts': [SRV, 2],
  // routes — explicit allow-list / projection
  'routes/proxy-dispatch.js :: /api/proxy/dispatch': [PRJ, 3],
  'routes/proxy-dispatch.js :: /api/proxy/dispatch/:id': [PRJ, 1],
  'routes/proxy-dispatch.js :: liveSeen': [PRJ, 1], // the :id watch long-poll re-read, keyed lexically after LIN-3367's const liveSeen arrow
  'routes/proxy-compute.js :: /api/proxy/issues/:identifier/snapshots/diff': [PRJ, 3],
  'routes/proxy-compute.js :: /api/proxy/periodicals': [PRJ, 2],
  // routes — test only
  'routes/test.js :: /test/dispatch-item': [TST, 1],
  // lib readers — results feed in-process derivations
  'lib/dispatch-factory.js :: anchor': [SRV, 1],
  'lib/dispatch-factory.js :: defaultFetchPilotPrFiles': [SRV, 2],
  'lib/dispatch-factory.js :: run': [SRV, 1],
  'lib/liveness-alarm-sweep.js :: sweepD2': [SRV, 2],
  'lib/observation-sessions-materializer.js :: _collectSessionIssues': [SRV, 7],
  'lib/observation-sessions-materializer.js :: _sessionsTouchingIssue': [SRV, 2],
  'lib/pipeline-loops.js :: timed': [SRV, 2],
  'lib/pipeline-loops.js :: redigestHistoryRows': [SRV, 1], // raw historyCollection.find (round-3 N3)
  'lib/recent-runs.js :: read': [SRV, 2],
  'lib/task-run-facts.js :: readTaskRunFacts': [SRV, 3]
};

const REDACTOR = /\bredactSessionItems?\s*\(/;

/** Violations of the table against a set of `{file, src}`; [] means clean. */
function check(files, table = TABLE) {
  const v = [];
  const sites = scanSites(files);
  for (const [id, { count, body }] of sites) {
    const row = table[id];
    if (!row) { v.push(`unlisted site: ${id} (${count} call${count > 1 ? 's' : ''}) — classify it redacted|runner|server-side-only|projection|test-only`); continue; }
    const [verdict, expected] = row;
    if (count !== expected) v.push(`${id}: ${count} calls, table says ${expected}`);
    if (verdict === R && !REDACTOR.test(body)) v.push(`${id}: verdict redacted but the handler body never calls redactSessionItem(s)`);
    if (verdict === RUN && /redactSession/.test(body)) v.push(`${id}: verdict runner but the handler redacts — runners must receive the live token`);
  }
  for (const id of Object.keys(table)) if (!sites.has(id)) v.push(`stale row: ${id} no longer has a call site`);
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
    assert.equal(Object.values(TABLE).filter(r => r[0] === R).length, 4);
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

  test('M4b: an extra call inside an already-classified handler changes its count', () => {
    const files = patch(clone(), 'routes/dispatch.js', src => src.replace(
      'const items = await dispatchQueueStore.listItems(workspace.urlKey);',
      'const items = await dispatchQueueStore.listItems(workspace.urlKey);\n      const leak = await dispatchQueueStore.listItems(workspace.urlKey);'
    ));
    const v = check(files);
    assert.ok(v.some(x => x.includes('/workspace/:urlKey/api/dispatch:') && x.includes('2 calls')), v.join('\n'));
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

  test('M3: removing the redactor from a redacted handler is caught', () => {
    const files = patch(clone(), 'routes/dispatch.js', src => src.replace(
      'res.json({ ...result, items: redactSessionItems(result.items, req.session?.accountId || null) });',
      'res.json(result);'
    ));
    const v = check(files);
    assert.ok(v.some(x => x.includes('dispatch/history') && x.includes('never calls redactSessionItem')), v.join('\n'));
  });

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
