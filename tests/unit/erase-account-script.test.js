/**
 * LIN-3423: scripts/erase-account.mjs, the thin CLI over lib/account-erasure.js.
 * Dry run is the default, `--execute` needs `--confirm <planId>`, importing the
 * script has no side effect. Real MangoDB engine over a tmpdir; no network.
 *
 * Run with: node --test tests/unit/erase-account-script.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { buildErasureSeed, seedDb, snapshotDb, PERSON, BYSTANDER } from '../fixtures/erasure-seed.js';
import { INVENTORY, planErasure } from '../../lib/account-erasure.js';
import { parseArgs, describeTarget, run } from '../../scripts/erase-account.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'erase-account.mjs');
const harness = createMangoTmpdir('lin-3423-cli-');
before(() => harness.connect());
after(() => harness.close());
const ALL = INVENTORY.map((r) => r.collection);

async function fresh() {
  const db = harness.freshDb();
  await seedDb(db, buildErasureSeed(INVENTORY));
  return db;
}

async function drive(db, argv, { env = {}, apply = { settleMs: 0 } } = {}) {
  const out = [];
  const err = [];
  const args = parseArgs(argv, env);
  const code = await run({ db, args, target: 'test target', out: (l) => out.push(l), err: (l) => err.push(l), apply });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('parseArgs', () => {
  test('a plain invocation is a dry run: no execute, no confirm', () => {
    const args = parseArgs(['--email', 'a@b.test', '--level', 'standard']);
    assert.strictEqual(args.mode, 'plan');
    assert.strictEqual(args.execute, false);
    assert.strictEqual(args.confirm, null);
  });

  test('--execute without --confirm is refused, and so is --confirm without --execute', () => {
    assert.throws(() => parseArgs(['--email', 'a@b.test', '--level', 'full', '--execute']), /--execute needs --confirm/);
    assert.throws(() => parseArgs(['--email', 'a@b.test', '--level', 'full', '--confirm', 'abcd1234']), /--confirm only applies with --execute/);
    assert.strictEqual(parseArgs(['--email', 'a@b.test', '--level', 'full', '--execute', '--confirm', 'abcd1234']).execute, true);
  });

  test('exactly one root: --email, ERASE_EMAIL or --account-id; both --email and ERASE_EMAIL refuse', () => {
    assert.throws(() => parseArgs(['--level', 'standard']), /exactly one of/);
    assert.throws(() => parseArgs(['--email', 'a@b.test', '--account-id', 'x', '--level', 'standard']), /exactly one of/);
    assert.throws(() => parseArgs(['--email', 'a@b.test', '--level', 'standard'], { ERASE_EMAIL: 'c@d.test' }), /both --email and ERASE_EMAIL/);
    assert.strictEqual(parseArgs(['--level', 'standard'], { ERASE_EMAIL: 'c@d.test' }).email, 'c@d.test');
    assert.strictEqual(parseArgs(['--account-id', 'x', '--level', 'full']).accountId, 'x');
  });

  test('the level is required and must be standard or full', () => {
    assert.throws(() => parseArgs(['--email', 'a@b.test']), /--level standard\|full is required/);
    assert.throws(() => parseArgs(['--email', 'a@b.test', '--level', 'half']), /--level standard\|full is required/);
  });

  test('--map is repeatable; unknown flags and flags with no value are refused', () => {
    assert.deepStrictEqual(parseArgs(['--email', 'a@b.test', '--level', 'full', '--map', 'w1=k1', '--map', 'w2=k2']).map, ['w1=k1', 'w2=k2']);
    assert.throws(() => parseArgs(['--email', 'a@b.test', '--level', 'full', '--allow-unmapped']), /unknown argument --allow-unmapped/);
    assert.throws(() => parseArgs(['--email']), /--email needs a value/);
    assert.throws(() => parseArgs(['--email', '--level', 'full']), /--email needs a value/);
    assert.throws(() => parseArgs(['positional']), /unknown argument \(positional\)/);
  });

  test('--find-label is a read-only mode that takes no other flag', () => {
    assert.strictEqual(parseArgs(['--find-label', 'phrase one']).mode, 'find-label');
    assert.throws(() => parseArgs(['--find-label', 'p', '--execute']), /read-only mode/);
    assert.throws(() => parseArgs(['--find-label', 'p', '--level', 'full']), /read-only mode/);
  });
});

describe('describeTarget', () => {
  test('a Mongo URI reduces to its hostname: no credentials, no database path', () => {
    const target = describeTarget({ MONGODB_URI: 'mongodb://admin:hunter2@db.example.test:27017/linear-viewer?authSource=admin' });
    assert.strictEqual(target, 'mongo db.example.test');
    assert.ok(!target.includes('hunter2') && !target.includes('admin'));
  });

  test('an unparseable URI never echoes back', () => {
    assert.ok(!describeTarget({ MONGODB_URI: 'not a url hunter2' }).includes('hunter2'));
  });

  test('without a URI it names the resolved data dir, the ./data fallback included', () => {
    assert.strictEqual(describeTarget({ HARBOUR_DATA_DIR: '/var/data' }), 'data dir /var/data');
    assert.match(describeTarget({}), /^data dir \/.*\/data$/);
  });
});

describe('run: dry run is the default', () => {
  test('prints the plan and the confirm command, exits 0, changes nothing', async () => {
    const db = await fresh();
    const before_ = await snapshotDb(db, ALL);
    const { code, out } = await drive(db, ['--email', PERSON.email, '--level', 'full']);
    assert.strictEqual(code, 0);
    assert.match(out, /DRY RUN: nothing is changed/);
    assert.match(out, /target:\s+test target/);
    const plan = await planErasure({ db, level: 'full', root: { email: PERSON.email }, target: 'test target' });
    assert.match(out, new RegExp(`--execute --confirm ${plan.planId}`));
    assert.deepStrictEqual(await snapshotDb(db, ALL), before_);
  });

  test('a wrong --confirm applies nothing and exits non-zero', async () => {
    const db = await fresh();
    const before_ = await snapshotDb(db, ALL);
    const { code, err } = await drive(db, ['--email', PERSON.email, '--level', 'standard', '--execute', '--confirm', 'deadbeef']);
    assert.notStrictEqual(code, 0);
    assert.match(err, /does not match this plan/);
    assert.deepStrictEqual(await snapshotDb(db, ALL), before_);
  });

  test('the right --confirm applies the plan, prints the receipt and exits 0', async () => {
    const db = await fresh();
    const plan = await planErasure({ db, level: 'standard', root: { email: PERSON.email }, target: 'test target' });
    const { code, out } = await drive(db, ['--email', PERSON.email, '--level', 'standard', '--execute', '--confirm', plan.planId]);
    assert.strictEqual(code, 0);
    assert.match(out, /ERASURE RECEIPT/);
    assert.match(out, new RegExp(`planId:\\s+${plan.planId}`));
    assert.match(out, /after \(final recount\): 0/);
    assert.strictEqual(await db.collection('accounts').findOne({ _id: PERSON.accountId }), null);
    assert.ok(await db.collection('accounts').findOne({ _id: BYSTANDER.accountId }));
  });

  test('a Full wipe execute with an unmapped workspace exits non-zero and writes nothing', async () => {
    const db = await fresh();
    await db.collection('account-workspaces').insertOne({ _id: 'orphan', accountId: PERSON.accountId, workspaceId: 'ws-orphan', role: 'owner' });
    const plan = await planErasure({ db, level: 'full', root: { email: PERSON.email }, target: 'test target' });
    const before_ = await snapshotDb(db, ALL);
    const { code, err } = await drive(db, ['--email', PERSON.email, '--level', 'full', '--execute', '--confirm', plan.planId]);
    assert.notStrictEqual(code, 0);
    assert.match(err, /UNMAPPED_WORKSPACES/);
    assert.deepStrictEqual(await snapshotDb(db, ALL), before_);
  });

  test('a RESIDUAL row after completion exits non-zero', async () => {
    const db = await fresh();
    const plan = await planErasure({ db, level: 'standard', root: { email: PERSON.email }, target: 'test target' });
    const orchestrator = (await db.collection('dispatch-queue').findOne({ dispatchedBy: PERSON.accountId }))._id;
    const { code, out } = await drive(db, ['--email', PERSON.email, '--level', 'standard', '--execute', '--confirm', plan.planId], {
      apply: {
        settleMs: 0,
        onStep: async (name, detail) => {
          if (name === 'account-deleted' && detail.id === PERSON.accountId.slice(0, 8)) {
            await db.collection('dispatch-queue').insertOne({ _id: 'late', urlKey: 'shared-ws', kind: 'wake', followUpTo: orchestrator });
          }
        }
      }
    });
    assert.strictEqual(code, 1);
    assert.match(out, /RESIDUAL dispatch-queue: 1/);
  });

  test('a refusal prints a coded message and no row content', async () => {
    const db = await fresh();
    const { code, err } = await drive(db, ['--email', 'nobody@example.test', '--level', 'standard']);
    assert.strictEqual(code, 1);
    assert.match(err, /REFUSED: ROOT_NOT_FOUND/);
    assert.ok(!err.includes('nobody@example.test'));
  });

  test('--find-label prints the account id and is read-only', async () => {
    const db = await fresh();
    await db.collection('proxy-tokens').insertOne({ _id: 'lbl', label: 'phrase-123', createdBy: PERSON.accountId, createdAt: new Date(), urlKey: 'acme', tokenHash: 'h' });
    const before_ = await snapshotDb(db, ALL);
    const { code, out } = await drive(db, ['--find-label', 'phrase-123']);
    assert.strictEqual(code, 0);
    assert.match(out, new RegExp(`account id: ${PERSON.accountId}`));
    assert.deepStrictEqual(await snapshotDb(db, ALL), before_);
    const none = await drive(db, ['--find-label', 'no-such-phrase']);
    assert.strictEqual(none.code, 1);
    assert.match(none.err, /LABEL_NOT_FOUND/);
  });
});

describe('the script as a process', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'lin-3423-proc-'));
  after(() => rmSync(sandbox, { recursive: true, force: true }));

  test('--execute without --confirm exits non-zero before any database is opened', () => {
    const dataDir = join(sandbox, 'never-created');
    const result = spawnSync(process.execPath, [SCRIPT, '--email', 'a@b.test', '--level', 'full', '--execute'], {
      cwd: ROOT, env: { PATH: process.env.PATH, HARBOUR_DATA_DIR: dataDir }, encoding: 'utf8'
    });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /--execute needs --confirm/);
    assert.ok(!existsSync(dataDir), 'the data dir was never opened');
  });

  test('importing the script has no side effect: nothing is opened, nothing is written, no exit code is set', () => {
    const dataDir = join(sandbox, 'import-only');
    const result = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(SCRIPT)}).then(() => { console.log('imported', process.exitCode ?? 0); })`], {
      cwd: ROOT, env: { PATH: process.env.PATH, HARBOUR_DATA_DIR: dataDir, MONGODB_URI: 'mongodb://127.0.0.1:1/never' }, encoding: 'utf8', timeout: 20000
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /imported 0/);
    assert.ok(!existsSync(dataDir));
  });

  test('a dry run as a process reads a data dir and changes nothing', async () => {
    const dataDir = join(sandbox, 'seeded');
    const { MangoClient } = await import('@jkershaw/mangodb');
    const client = new MangoClient(dataDir);
    await client.connect();
    const db = client.db('linear-viewer');
    await seedDb(db, buildErasureSeed(INVENTORY));
    await client.close();
    const result = spawnSync(process.execPath, [SCRIPT, '--email', PERSON.email, '--level', 'standard'], {
      cwd: ROOT, env: { PATH: process.env.PATH, HARBOUR_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 60000
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /DRY RUN: nothing is changed/);
    assert.match(result.stdout, new RegExp(`target:\\s+data dir ${dataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    const check = new MangoClient(dataDir);
    await check.connect();
    assert.ok(await check.db('linear-viewer').collection('accounts').findOne({ _id: PERSON.accountId }), 'the account is still there');
    await check.close();
  });
});
