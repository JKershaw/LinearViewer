/**
 * Unit tests for scripts/dry-run-owner-backfill.mjs (LIN-3142 plan §G, G6d/G6e):
 * the read-only operator dry run of the owner backfill.
 *
 * Run with: node --test tests/unit/owner-backfill-script.test.js
 *
 * The script is spawned against a seeded MangoDB `HARBOUR_DATA_DIR` with
 * `MONGODB_URI` blanked (precedent: tests/unit/dry-run-workspace-ownership.test.js),
 * so it can never reach a real database. Its claims are: it prints what boot
 * would assign, it writes nothing (the data dir is byte-identical), and it
 * prints no secret, the pinned Linear viewer id included.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MangoClient } from '@jkershaw/mangodb';
import { ensureIndexes } from '../../lib/db-indexes.js';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/dry-run-owner-backfill.mjs', import.meta.url));

const PIN_ACCOUNT = 'e7e948a4-2951-4af4-b60e-572a473a491e';
const PIN_LINEAR_SCOPE = 'beb9398c-83b5-4d06-b65e-78d19bb0d2f7';
const PRE = new Date('2026-09-01T00:00:00.000Z');
const POST = new Date('2026-09-30T00:00:00.000Z');

const OTHER = 'acct-other';
const W_INSERT = 'ws-01';
const W_PROMOTE = 'ws-02';
const W_OWNED = 'ws-04';
const W_POST = 'ws-07';
// G6e: a synthetic org-id-shaped workspace id, deliberately not the viewer-id pin.
const SYNTH_ORG_WS = 'c0ffee00-1111-4222-8333-444455556666';

const CANARIES = [
  'john@example.test',
  'SECRET-CRED-JOHN',
  'SECRET-CRED-OTHER',
  'SECRET-AT-w05',
  'SECRET-RT-w05',
  'sid-SECRET-1',
  PIN_LINEAR_SCOPE
];

function runScript(dataDir) {
  return spawnSync(process.execPath, [SCRIPT_PATH], {
    env: { ...process.env, MONGODB_URI: '', HARBOUR_DATA_DIR: dataDir },
    encoding: 'utf8'
  });
}

function summaryLineOf(stdout) {
  const lines = stdout.split('\n').filter(l => /^\[owner-backfill\] owner=/.test(l));
  assert.strictEqual(lines.length, 1, `exactly one summary line, got ${lines.length}:\n${stdout}`);
  return lines[0];
}

// The JSON report follows the log lines (precedent: the LIN-1892 dry run).
function jsonOf(stdout) {
  const start = stdout.indexOf('\n{');
  assert.notStrictEqual(start, -1, `a JSON report on stdout:\n${stdout}`);
  return JSON.parse(stdout.slice(start + 1));
}

// Seeds a data dir under the db name server.js and the script use.
async function withDataDir(seed) {
  const dir = mkdtempSync(join(tmpdir(), 'owner-backfill-script-'));
  const client = new MangoClient(dir);
  await client.connect();
  try {
    await seed(client.db('linear-viewer'));
  } finally {
    if (client.close) await client.close();
  }
  return dir;
}

async function seedPopulation(db, { john = true } = {}) {
  const accounts = [
    { _id: OTHER, identities: [{ provider: 'linear', scope: 'other-viewer', credentials: { token: 'SECRET-CRED-OTHER' } }] }
  ];
  if (john) {
    accounts.push({
      _id: PIN_ACCOUNT,
      identities: [
        { provider: 'linear', scope: PIN_LINEAR_SCOPE, credentials: { token: 'SECRET-CRED-JOHN' } },
        { provider: 'email', scope: 'john@example.test' }
      ]
    });
  }
  await db.collection('accounts').insertMany(accounts);
  const edge = (accountId, workspaceId, extra = {}) => ({ _id: randomUUID(), accountId, workspaceId, createdAt: PRE, ...extra });
  await db.collection('account-workspaces').insertMany([
    edge(OTHER, W_INSERT),
    edge(PIN_ACCOUNT, W_PROMOTE),
    edge(OTHER, W_PROMOTE),
    edge(OTHER, W_OWNED, { role: 'owner' }),
    edge(OTHER, W_POST, { createdAt: POST }),
    edge(PIN_ACCOUNT, SYNTH_ORG_WS)
  ]);
  await db.collection('sessions').insertOne({
    _id: 'sid-SECRET-1',
    expires: new Date(Date.now() + 60_000),
    session: { workspaces: [{ id: 'ws-05', urlKey: 'w05', accessToken: 'SECRET-AT-w05', refreshToken: 'SECRET-RT-w05' }] }
  });
}

describe('dry-run-owner-backfill script (LIN-3142 G6d)', () => {
  const dirs = [];

  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  describe('over a seeded population with the owner index and John present', () => {
    let dataDir;
    let result;
    let beforeSnapshot;

    before(async () => {
      dataDir = await withDataDir(async db => {
        const { failed } = await ensureIndexes(db, { logger: { warn() {} } });
        assert.deepStrictEqual(failed.filter(f => f.collection === 'account-workspaces'), []);
        await seedPopulation(db);
      });
      dirs.push(dataDir);
      beforeSnapshot = readdirSnapshot(dataDir);
      result = runScript(dataDir);
    });

    test('exits 0 and prints one would-assign line per target plus the summary', () => {
      assert.strictEqual(result.status, 0, result.stderr);
      const targets = result.stdout.split('\n').filter(l => l.startsWith('[owner-backfill] target '));
      assert.deepStrictEqual(targets, [
        `[owner-backfill] target workspace=${SYNTH_ORG_WS} kind=container edges=1 johnAlreadyMember=yes outcome=would-assign`,
        `[owner-backfill] target workspace=${W_INSERT} kind=linear-org edges=1 johnAlreadyMember=no outcome=would-assign`,
        `[owner-backfill] target workspace=${W_PROMOTE} kind=linear-org edges=2 johnAlreadyMember=yes outcome=would-assign`
      ]);
      assert.strictEqual(
        summaryLineOf(result.stdout),
        `[owner-backfill] owner=${PIN_ACCOUNT} cutoff=2026-09-29T19:35:00.000Z targets=3 assigned=0 alreadyMember=0 raced=0 failed=0 undatable=0 mode=dry-run skipped=none`
      );
    });

    test('prints a JSON report { gates, targets, undatable, summary }', () => {
      const json = jsonOf(result.stdout);
      assert.deepStrictEqual(json.gates, { ownerIndex: true, identity: 'ok' });
      assert.deepStrictEqual(json.targets.map(t => [t.workspaceId, t.kind, t.edgeCount, t.johnAlreadyMember]), [
        [SYNTH_ORG_WS, 'container', 1, true],
        [W_INSERT, 'linear-org', 1, false],
        [W_PROMOTE, 'linear-org', 2, true]
      ]);
      assert.deepStrictEqual(json.undatable, []);
      assert.strictEqual(json.summary.ownerlessPreCutoff, 3);
      assert.strictEqual(json.summary.ownerless, 4, 'the post-cutoff workspace is ownerless but not a target');
    });

    // Each negative claim below first requires a clean run, so a script that
    // crashed before printing or writing anything can't pass them vacuously.
    test('writes nothing: the data dir is byte-identical after the run', () => {
      assert.strictEqual(result.status, 0, result.stderr);
      assert.deepStrictEqual(readdirSnapshot(dataDir), beforeSnapshot);
    });

    test('no canary, PIN_LINEAR_SCOPE included, on stdout or stderr', () => {
      assert.strictEqual(result.status, 0, result.stderr);
      for (const value of CANARIES) {
        assert.ok(!result.stdout.includes(value), `stdout must not contain ${value}`);
        assert.ok(!result.stderr.includes(value), `stderr must not contain ${value}`);
      }
    });

    test('G6e the synthetic org-id-shaped workspace id appears only as workspace= or a workspaceId field', () => {
      const out = result.stdout;
      const all = out.split(SYNTH_ORG_WS).length - 1;
      const allowed = (out.split(`workspace=${SYNTH_ORG_WS}`).length - 1) + (out.split(`"workspaceId": "${SYNTH_ORG_WS}"`).length - 1) + (out.split(`"workspaceId":"${SYNTH_ORG_WS}"`).length - 1);
      assert.ok(all >= 2, 'in the target line and the JSON');
      assert.strictEqual(all, allowed);
    });
  });

  test('an empty data dir (no indexes) exits 0 with skipped=owner-index-missing: gate 1 runs before gate 2', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'owner-backfill-script-empty-'));
    dirs.push(dataDir);

    const result = runScript(dataDir);

    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(summaryLineOf(result.stdout), / mode=dry-run skipped=owner-index-missing$/);
  });

  test('the owner index built and no John identity exits 0 with skipped=identity-no-match, still writing nothing', async () => {
    const dataDir = await withDataDir(async db => {
      await ensureIndexes(db, { logger: { warn() {} } });
      await seedPopulation(db, { john: false });
    });
    dirs.push(dataDir);
    const beforeSnapshot = readdirSnapshot(dataDir);

    const result = runScript(dataDir);

    assert.strictEqual(result.status, 0, result.stderr);
    const summary = summaryLineOf(result.stdout);
    assert.match(summary, /^\[owner-backfill\] owner=unresolved /);
    assert.match(summary, / mode=dry-run skipped=identity-no-match$/);
    assert.ok(result.stdout.includes('johnAlreadyMember=unknown outcome=would-assign'), 'it still plans');
    assert.deepStrictEqual(readdirSnapshot(dataDir), beforeSnapshot);
    for (const value of CANARIES) {
      assert.ok(!result.stdout.includes(value) && !result.stderr.includes(value), `no ${value}`);
    }
  });

  test('the script source makes no write call, never asks for write mode, and does not import the writer', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    const writes = source.match(/\.(insert\w*|update\w*|delete\w*|replace\w*|drop\w*|findOneAnd\w*|bulkWrite|createIndex\w*|rename)\s*\(/g);
    assert.strictEqual(writes, null, `write call(s) found: ${writes}`);
    assert.ok(!/\bwrite\s*:\s*true\b/.test(source), 'no write: true');
    assert.ok(!/\bexecuteOwnerBackfill\b/.test(source), 'does not import or call executeOwnerBackfill');
    assert.match(source, /runOwnerBackfill\(\{[^}]*\bwrite\s*:\s*false\b[^}]*\}\)/, 'calls the boot path with write: false');
    assert.match(source, /from\s*['"]\.\.\/lib\/owner-backfill\.js['"]/, 'the one code path is the lib module');
  });
});

// Every file under `dir` with its contents, for a before/after comparison
// (same helper as tests/unit/dry-run-workspace-ownership.test.js).
function readdirSnapshot(dir) {
  const out = {};
  const walk = (d, prefix) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else out[`${prefix}${entry.name}`] = readFileSync(path, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}
