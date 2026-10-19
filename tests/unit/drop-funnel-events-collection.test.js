/**
 * LIN-3632: scripts/drop-funnel-events-collection.mjs, the count-first drop of
 * the retired `funnel-events` collection (LIN-3500). Real MangoDB tmpdir for the
 * behaviour, a recording fake for what the script is allowed to call.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { dropFunnelEventsCollection, parseArgs, exitCodeFor } from '../../scripts/drop-funnel-events-collection.mjs';

const SCRIPT_PATH = resolve('scripts/drop-funnel-events-collection.mjs');
const NAME = 'funnel-events';
const STEP_KEY = { step: 1, accountId: 1, at: 1 };
const silent = { log() {}, error() {} };

describe('dropFunnelEventsCollection on a real MangoDB', () => {
  const harness = createMangoTmpdir('lin-3632-');
  let db;
  before(() => harness.connect());
  after(() => harness.close());
  beforeEach(() => { db = harness.freshDb(); });

  const names = async () => (await db.listCollections().toArray()).map(c => c.name);

  async function seed(docs) {
    const col = db.collection(NAME);
    for (const doc of docs) await col.insertOne(doc);
    await col.createIndex(STEP_KEY);
    await db.collection('unrelated').insertOne({ keep: true });
  }

  test('a dry run on a seeded collection reports it and drops nothing', async () => {
    await seed([{ step: 'a', accountId: 'x', at: 1 }, { step: 'b', accountId: 'y', at: 2 }]);
    const report = await dropFunnelEventsCollection({ db, drop: false, logger: silent });
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.outcome, 'dry-run');
    assert.equal(report.existed, true);
    assert.equal(report.count, 2);
    assert.equal(report.backend, 'local-mangodb');
    assert.equal(report.collectionsInDatabase, 2);
    assert.ok(report.indexes.some(i => JSON.stringify(i.key) === JSON.stringify(STEP_KEY)));
    for (const i of report.indexes) assert.deepEqual(Object.keys(i).sort(), ['key', 'name']);
    assert.ok((await names()).includes(NAME));
    assert.equal(exitCodeFor(report), 0);
  });

  test('--drop with documents refuses and keeps them', async () => {
    await seed([{ step: 'a', accountId: 'x', at: 1 }, { step: 'b', accountId: 'y', at: 2 }]);
    const report = await dropFunnelEventsCollection({ db, drop: true, logger: silent });
    assert.equal(report.mode, 'drop');
    assert.equal(report.outcome, 'refused-not-empty');
    assert.equal(report.count, 2);
    assert.equal(exitCodeFor(report), 1);
    assert.equal(await db.collection(NAME).countDocuments({}), 2);
  });

  test('--drop on an empty collection with the index drops it and nothing else', async () => {
    // MangoDB lists a collection only once it has held a document, so empty it.
    await seed([{ step: 'a', accountId: 'x', at: 1 }]);
    await db.collection(NAME).deleteMany({});
    const report = await dropFunnelEventsCollection({ db, drop: true, logger: silent });
    assert.equal(report.outcome, 'dropped');
    assert.equal(report.existed, true);
    assert.equal(report.count, 0);
    assert.equal(exitCodeFor(report), 0);
    const after = await names();
    assert.ok(!after.includes(NAME));
    assert.ok(after.includes('unrelated'));
    assert.equal(await db.collection('unrelated').countDocuments({}), 1);
  });

  test('an absent collection is absent on a dry run and a no-op with --drop', async () => {
    await db.collection('unrelated').insertOne({ keep: true });
    const dry = await dropFunnelEventsCollection({ db, drop: false, logger: silent });
    assert.equal(dry.outcome, 'absent');
    assert.equal(dry.existed, false);
    assert.equal(dry.indexes, null);
    assert.equal(exitCodeFor(dry), 0);
    const drop = await dropFunnelEventsCollection({ db, drop: true, logger: silent });
    assert.equal(drop.outcome, 'absent');
    assert.equal(exitCodeFor(drop), 0);
    assert.deepEqual(await names(), ['unrelated']);
  });
});

describe('dropFunnelEventsCollection against a recording fake', () => {
  const SENTINEL = 'SENTINEL-doc-content-7f3a';

  function fakeDb({ existed = true, count = 0, countThrows = false, indexesThrow = false } = {}) {
    const calls = [];
    const col = {
      find() { throw new Error(`find read documents ${SENTINEL}`); },
      findOne() { throw new Error(`findOne read documents ${SENTINEL}`); },
      aggregate() { throw new Error(`aggregate read documents ${SENTINEL}`); },
      async countDocuments(query) {
        calls.push(['countDocuments', query]);
        if (countThrows) throw Object.assign(new Error(`boom ${SENTINEL} mongodb://u:p@h/db`), { code: 13 });
        return count;
      },
      listIndexes() {
        calls.push(['listIndexes']);
        if (indexesThrow) throw Object.assign(new Error(SENTINEL), { code: 26 });
        return { toArray: async () => [{ v: 2, name: 'step_1', key: { step: 1 }, secret: SENTINEL }] };
      },
      async drop() { calls.push(['drop']); return true; }
    };
    const db = {
      databaseName: 'linear-viewer',
      listCollections: () => ({ toArray: async () => [{ name: 'other' }, ...(existed ? [{ name: NAME }] : [])] }),
      collection: n => { calls.push(['collection', n]); return col; }
    };
    return { db, calls };
  }

  function recordingLogger() {
    const lines = [];
    return { lines, log: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(a.join(' ')) };
  }

  test('never reads documents, never logs stored content, counts with {}', async () => {
    const { db, calls } = fakeDb({ count: 3 });
    const logger = recordingLogger();
    const report = await dropFunnelEventsCollection({ db, drop: true, logger });
    assert.equal(report.outcome, 'refused-not-empty');
    assert.deepEqual(calls.find(c => c[0] === 'countDocuments'), ['countDocuments', {}]);
    assert.ok(!logger.lines.join('\n').includes(SENTINEL));
    assert.ok(!JSON.stringify(report).includes(SENTINEL));
  });

  test('drop is called exactly once, and only for count 0 with --drop', async () => {
    const zero = fakeDb({ count: 0 });
    await dropFunnelEventsCollection({ db: zero.db, drop: true, logger: silent });
    assert.equal(zero.calls.filter(c => c[0] === 'drop').length, 1);

    for (const opts of [{ count: 0, drop: false }, { count: 1, drop: true }, { existed: false, drop: true }]) {
      const { drop, ...dbOpts } = opts;
      const f = fakeDb(dbOpts);
      await dropFunnelEventsCollection({ db: f.db, drop, logger: silent });
      assert.equal(f.calls.filter(c => c[0] === 'drop').length, 0, JSON.stringify(opts));
    }
  });

  test('an unreadable count never drops: dry-run reports count null, --drop refuses, no message is logged', async () => {
    const dry = fakeDb({ countThrows: true });
    const logger = recordingLogger();
    const dryReport = await dropFunnelEventsCollection({ db: dry.db, drop: false, logger });
    assert.equal(dryReport.outcome, 'dry-run');
    assert.equal(dryReport.count, null);
    assert.equal(exitCodeFor(dryReport), 0);

    const wet = fakeDb({ countThrows: true });
    const wetReport = await dropFunnelEventsCollection({ db: wet.db, drop: true, logger });
    assert.equal(wetReport.outcome, 'refused-count-unreadable');
    assert.equal(exitCodeFor(wetReport), 1);
    assert.equal(wet.calls.filter(c => c[0] === 'drop').length, 0);
    const out = logger.lines.join('\n');
    assert.ok(!out.includes(SENTINEL) && !out.includes('mongodb://'), out);
    assert.ok(out.includes('13'), 'the error code is printed');
  });

  test('listIndexes is not called when the collection is absent, and its failure is survivable', async () => {
    const absent = fakeDb({ existed: false });
    const report = await dropFunnelEventsCollection({ db: absent.db, drop: false, logger: silent });
    assert.equal(report.indexes, null);
    assert.ok(!absent.calls.some(c => c[0] === 'listIndexes'));

    const failing = fakeDb({ indexesThrow: true });
    const r2 = await dropFunnelEventsCollection({ db: failing.db, drop: false, logger: silent });
    assert.equal(r2.outcome, 'dry-run');
    assert.equal(r2.indexes, null);
  });

  test('indexes report name and key only; database comes from the handle', async () => {
    const { db } = fakeDb({ count: 0 });
    const report = await dropFunnelEventsCollection({ db, drop: false, logger: silent });
    assert.deepEqual(report.indexes, [{ name: 'step_1', key: { step: 1 } }]);
    assert.equal(report.database, 'linear-viewer');
    assert.equal(report.collectionsInDatabase, 2);
  });
});

describe('parseArgs and exitCodeFor', () => {
  test('parseArgs: none is a dry run, --drop a drop, anything else a usage error', () => {
    assert.deepEqual(parseArgs([]), { drop: false });
    assert.deepEqual(parseArgs(['--drop']), { drop: true });
    for (const bad of [['--execute'], ['--dry-run'], ['--drop', '--force'], ['drop']]) {
      assert.throws(() => parseArgs(bad), /usage/i, bad.join(' '));
    }
  });

  test('exitCodeFor: 0 for ok outcomes, 1 for refusals, 2 for usage', () => {
    for (const outcome of ['dry-run', 'dropped', 'absent']) assert.equal(exitCodeFor({ outcome }), 0);
    for (const outcome of ['refused-not-empty', 'refused-count-unreadable']) assert.equal(exitCodeFor({ outcome }), 1);
    assert.equal(exitCodeFor({ outcome: 'usage' }), 2);
  });
});

describe('the script as a process', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'lin-3632-spawn-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));
  const run = args => spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    env: { ...process.env, MONGODB_URI: '', HARBOUR_DATA_DIR: dir },
    encoding: 'utf8'
  });

  test('an unknown flag exits 2 before opening anything', () => {
    for (const flag of ['--execute', '--nope']) {
      const r = run([flag]);
      assert.equal(r.status, 2, r.stderr);
      assert.equal(r.stdout, '');
    }
  });

  test('a dry run prints one JSON report and exits 0', () => {
    const r = run([]);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(report.backend, 'local-mangodb');
    assert.equal(report.outcome, 'absent');
  });

  test('a script path containing a space still runs (the main-guard compares file URLs)', () => {
    const spaced = join(dir, 'a b');
    mkdirSync(join(spaced, 'scripts'), { recursive: true });
    copyFileSync(SCRIPT_PATH, join(spaced, 'scripts', 'drop-funnel-events-collection.mjs'));
    symlinkSync(resolve('node_modules'), join(spaced, 'node_modules'));
    const r = spawnSync(process.execPath, [join(spaced, 'scripts', 'drop-funnel-events-collection.mjs')], {
      env: { ...process.env, MONGODB_URI: '', HARBOUR_DATA_DIR: dir },
      encoding: 'utf8'
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /"outcome": "absent"/);
  });
});
