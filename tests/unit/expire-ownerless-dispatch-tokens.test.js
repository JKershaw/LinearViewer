/**
 * LIN-3618 — lib/expire-ownerless-dispatch-tokens.js and its .mjs wrapper.
 *
 * Real MangoDB tmpdir (not the hand-rolled mock collection of
 * lin-3137-dispatch-token-mint-gate.test.js, which treats unknown operators as
 * matching everything) with an injected clock.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { expireOwnerlessDispatchTokens } from '../../lib/expire-ownerless-dispatch-tokens.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(NOW.getTime() - days * DAY);
const ahead = (days) => new Date(NOW.getTime() + days * DAY);
const HEX64 = /[0-9a-f]{64}/i;
const SECRET_LABEL = 'super-secret-label';
const ACCOUNT = 'acct-secret-owner-id';

function row(id, extra = {}) {
  // `createdBy` / `expiresAt` are written only when given, so "absent" is real.
  return { _id: id, urlKey: `ws-${id.slice(0, 4)}`, tokenHash: 'a'.repeat(64), label: SECRET_LABEL, createdAt: ago(200), lastUsedAt: null, ...extra };
}

const ROWS = () => [
  row('11111111-null', { createdBy: null, expiresAt: null }),
  row('22222222-absent'),
  row('33333333-empty', { createdBy: '', expiresAt: null }),
  row('44444444-owned', { createdBy: ACCOUNT, expiresAt: null }),
  row('55555555-ownedfuture', { createdBy: ACCOUNT, expiresAt: ahead(30) }),
  row('66666666-ownerlessexpired', { createdBy: null, expiresAt: ago(10) }),
  row('77777777-ownerlessfuture', { createdBy: null, expiresAt: ahead(5) })
];
const EXPECT_EXPIRED = ['11111111', '22222222', '33333333', '77777777'];

function capture() {
  const lines = [];
  return { lines, log: (l) => lines.push(l) };
}

describe('expire-ownerless-dispatch-tokens (real MangoDB tmpdir)', () => {
  let harness;
  before(async () => { harness = createMangoTmpdir('lin-3618-expire-'); await harness.connect(); });
  after(async () => { await harness.close(); });

  async function seed(rows = ROWS()) {
    const collection = harness.freshDb().collection('dispatch-tokens');
    for (const r of rows) await collection.insertOne(r);
    return collection;
  }
  const dump = async (collection) => JSON.stringify((await collection.find({}).toArray()).sort((a, b) => a._id.localeCompare(b._id)));
  const run = (collection, opts = {}) => {
    const logger = capture();
    return expireOwnerlessDispatchTokens({ collection, backend: 'mongodb', now: NOW, logger, ...opts })
      .then(report => ({ report, lines: logger.lines }));
  };

  test('default mode writes nothing, prints the backend line first and every row, and leaks nothing', async () => {
    const collection = await seed();
    const snapshot = await dump(collection);

    const { report, lines } = await run(collection);

    assert.equal(await dump(collection), snapshot);
    assert.equal(lines[0], 'backend=mongodb db=linear-viewer collection=dispatch-tokens');
    assert.equal(report.mode, 'dry-run');
    assert.deepEqual(report.counts, { total: 7, ownerless: 5, ownerlessActive: 4, ownerlessRecent: 0, owned: 2 });
    for (const id of ['11111111', '22222222', '33333333', '44444444', '55555555', '66666666', '77777777']) {
      assert.equal(lines.filter(l => l.endsWith(`id=${id}`)).length, 1, `row ${id} listed once`);
    }
    assert.match(lines.at(-1), /^total=7 ownerless=5 ownerless-active=4 ownerless-recent=0 owned=2$/);
    const text = lines.join('\n');
    assert.doesNotMatch(text, HEX64);
    assert.ok(!text.includes(SECRET_LABEL) && !text.includes(ACCOUNT) && !text.includes('tokenHash'));
    assert.ok(lines.some(l => l.includes('id=44444444') && l.includes('owner=yes')));
    assert.ok(lines.some(l => l.includes('id=66666666') && l.includes('status=expired')));
  });

  test('--execute expires only ownerless not-yet-expired rows, plan lines before the first write', async () => {
    const collection = await seed();
    const before = await collection.find({}).toArray();
    const events = [];
    const spied = new Proxy(collection, {
      get(target, prop) {
        if (prop === 'updateOne') return (...a) => { events.push('write'); return target.updateOne(...a); };
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      }
    });
    const logger = { log: (l) => events.push(l.startsWith('would expire') ? 'plan' : l.startsWith('expired ') ? 'done' : 'other') };

    const report = await expireOwnerlessDispatchTokens({ collection: spied, backend: 'mongodb', now: NOW, dryRun: false, logger });

    assert.deepEqual(report.expired.sort(), EXPECT_EXPIRED);
    const firstWrite = events.indexOf('write');
    assert.equal(events.filter(e => e === 'plan').length, 4);
    assert.ok(events.lastIndexOf('plan') < firstWrite, 'every plan line prints before the first write');

    const after = await collection.find({}).toArray();
    assert.equal(after.length, before.length, 'no row deleted');
    for (const b of before) {
      const a = after.find(r => r._id === b._id);
      if (EXPECT_EXPIRED.includes(b._id.slice(0, 8))) {
        assert.equal(a.expiresAt.getTime(), NOW.getTime());
        assert.deepEqual({ ...a, expiresAt: null }, { ...b, expiresAt: null }, 'only expiresAt changed');
      } else {
        assert.deepEqual(a, b, `${b._id} byte-identical`);
      }
    }
    const holders = await new DispatchTokenStore({ collection }).listHolderRows();
    assert.equal(holders.length, 7, 'listHolderRows still returns every row');
  });

  test('a second --execute is a no-op', async () => {
    const collection = await seed();
    await run(collection, { dryRun: false });
    const snapshot = await dump(collection);
    const { report } = await run(collection, { dryRun: false, now: new Date(NOW.getTime() + 1000) });
    assert.deepEqual(report.expired, []);
    assert.equal(report.refused, null);
    assert.equal(await dump(collection), snapshot);
  });

  test('a row that gains an owner between listing and write is skipped', async () => {
    const collection = await seed([row('88888888-race', { createdBy: null, expiresAt: null })]);
    const racing = new Proxy(collection, {
      get(target, prop) {
        if (prop === 'find') {
          return (...a) => {
            const cursor = target.find(...a);
            return { toArray: async () => { const rows = await cursor.toArray(); await target.updateOne({ _id: '88888888-race' }, { $set: { createdBy: ACCOUNT } }); return rows; } };
          };
        }
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      }
    });
    const report = await expireOwnerlessDispatchTokens({ collection: racing, backend: 'mongodb', now: NOW, dryRun: false, logger: capture() });
    assert.deepEqual(report.expired, []);
    assert.equal((await collection.findOne({ _id: '88888888-race' })).expiresAt, null);
  });

  describe('the 30-day gate', () => {
    test('an ownerless row used 29 days ago refuses --execute, writes nothing, names its id8', async () => {
      const collection = await seed([...ROWS(), row('99999999-recent', { createdBy: null, lastUsedAt: ago(29) })]);
      const snapshot = await dump(collection);
      const { report, lines } = await run(collection, { dryRun: false });
      assert.equal(report.refused, 'recent-use');
      assert.deepEqual(report.recentIds, ['99999999']);
      assert.ok(lines.some(l => l.startsWith('refused:') && l.includes('99999999')));
      assert.ok(!lines.some(l => l.startsWith('would expire')), 'no plan line suggests a pending write');
      assert.equal(await dump(collection), snapshot);
    });

    test('31 days ago, or never used, does not refuse', async () => {
      const collection = await seed([...ROWS(), row('99999999-old', { createdBy: null, lastUsedAt: ago(31) })]);
      const { report } = await run(collection, { dryRun: false });
      assert.equal(report.refused, null);
      assert.ok(report.expired.includes('99999999'));
    });

    test('an owned row used a minute ago does not refuse', async () => {
      const collection = await seed([...ROWS(), row('aaaaaaaa-owned', { createdBy: ACCOUNT, lastUsedAt: new Date(NOW.getTime() - 60_000) })]);
      const { report } = await run(collection, { dryRun: false });
      assert.equal(report.refused, null);
      assert.ok(!report.expired.includes('aaaaaaaa'));
    });

    test('an unparseable lastUsedAt fails closed (counts as recent)', async () => {
      const collection = await seed([row('bbbbbbbb-junk', { createdBy: null, lastUsedAt: 'not-a-date' })]);
      const { report } = await run(collection, { dryRun: false });
      assert.equal(report.refused, 'recent-use');
    });
  });

  test('--execute on the mangodb backend without an explicit HARBOUR_DATA_DIR refuses; a dry run does not', async () => {
    const collection = await seed();
    const snapshot = await dump(collection);
    const refused = await run(collection, { backend: 'mangodb', dataDirExplicit: false, dryRun: false });
    assert.equal(refused.report.refused, 'mangodb-no-data-dir');
    assert.equal(await dump(collection), snapshot);
    assert.equal(refused.lines[0], 'backend=mangodb db=linear-viewer collection=dispatch-tokens');

    assert.equal((await run(collection, { backend: 'mangodb', dataDirExplicit: false })).report.refused, null);
    assert.equal((await run(collection, { backend: 'mangodb', dataDirExplicit: true, dryRun: false })).report.refused, null);
  });
});

describe('scripts/expire-ownerless-dispatch-tokens.mjs (child process)', () => {
  const script = new URL('../../scripts/expire-ownerless-dispatch-tokens.mjs', import.meta.url).pathname;
  let dir;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lin-3618-child-'));
    const client = new MangoClient(dir);
    await client.connect();
    const c = client.db('linear-viewer').collection('dispatch-tokens');
    await c.insertOne(row('cccccccc-recent', { createdBy: null, expiresAt: null, lastUsedAt: new Date() }));
    await c.insertOne(row('dddddddd-owned', { createdBy: ACCOUNT, expiresAt: null }));
    await client.close();
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const exec = (args, env) => {
    const clean = { ...process.env, ...env };
    delete clean.MONGODB_URI;
    return spawnSync(process.execPath, [script, ...args], { env: clean, encoding: 'utf8' });
  };
  const readRows = async () => {
    const client = new MangoClient(dir);
    await client.connect();
    const rows = await client.db('linear-viewer').collection('dispatch-tokens').find({}).toArray();
    await client.close();
    return JSON.stringify(rows.sort((a, b) => a._id.localeCompare(b._id)));
  };

  test('--execute with a recently used ownerless row exits 2 and leaves the data unchanged', async () => {
    const snapshot = await readRows();
    const res = exec(['--execute'], { HARBOUR_DATA_DIR: dir });
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stdout, /^backend=mangodb db=linear-viewer collection=dispatch-tokens\n/);
    assert.match(res.stdout, /refused:.*cccccccc/);
    assert.equal(await readRows(), snapshot);
  });

  test('--execute with no HARBOUR_DATA_DIR on the mangodb backend exits 2', () => {
    const env = { ...process.env }; delete env.HARBOUR_DATA_DIR;
    const res = spawnSync(process.execPath, [script, '--execute'], { env: (() => { delete env.MONGODB_URI; return env; })(), encoding: 'utf8', cwd: tmpdir() });
    assert.equal(res.status, 2, res.stdout + res.stderr);
  });

  test('the default run exits 0', () => {
    const res = exec([], { HARBOUR_DATA_DIR: dir });
    assert.equal(res.status, 0, res.stdout + res.stderr);
  });
});
