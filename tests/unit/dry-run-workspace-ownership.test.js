/**
 * Unit tests for scripts/dry-run-workspace-ownership.mjs (LIN-1892 S1).
 *
 * Run with: node --test tests/unit/dry-run-workspace-ownership.test.js
 *
 * Against a REAL MangoDB tmpdir seeded with every population the report
 * buckets, because the script's claims are about what the backend returns
 * (MangoDB 0.1.2's dotted projection into an array keeps only the first
 * element, which is why the sessions read projects `session.workspaces`
 * whole). mongo-smoke runs the same two-workspace session on real MongoDB.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MangoClient } from '@jkershaw/mangodb';
import {
  runDryRun, computeOwnershipReport, parseArgs, inferWorkspaceKind, SESSIONS_FIND_PROJECTION
} from '../../scripts/dry-run-workspace-ownership.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/dry-run-workspace-ownership.mjs', import.meta.url));

const CUTOFF = new Date('2026-09-20T00:00:00.000Z');
const PRE = new Date('2026-06-01T00:00:00.000Z');
const POST = new Date('2026-09-25T00:00:00.000Z');

const W_A1 = 'org-alpha';
const W_A2 = 'github:123';
const W_OWN = '11111111-1111-4111-8111-111111111111';
const W_B = 'jira:abc';
const W_E = '22222222-2222-4222-8222-222222222222';
const W_C1 = 'org-gamma';
const W_C2 = '33333333-3333-4333-8333-333333333333';
const W_STRING_ONLY = 'org-in-a-string-session';

const SECRETS = [
  'SECRET-AT-one', 'SECRET-RT-one', 'SECRET-OR-one', 'SECRET-AT-two', 'SECRET-RT-two',
  'SECRET-NAME-one', 'SECRET-CREDS-TOKEN-one'
];
const SIDS = ['sid-SECRET-1', 'sid-SECRET-2', 'sid-SECRET-3', 'sid-SECRET-4', 'sid-SECRET-5'];
const IDENTITY_CREDENTIALS = ['SECRET-CRED-L1', 'SECRET-CRED-L2', 'SECRET-CRED-X', 'SECRET-CRED-M', 'SECRET-CRED-S'];

async function seed(db) {
  await db.collection('accounts').insertMany([
    { _id: 'acct-L1', identities: [{ provider: 'local', scope: 'l1', credentials: { token: 'SECRET-CRED-L1' } }] },
    { _id: 'acct-L2', identities: [{ provider: 'local', scope: 'l2a' }, { provider: 'local', scope: 'l2b', credentials: { token: 'SECRET-CRED-L2' } }] },
    { _id: 'acct-X', identities: [{ provider: 'local', scope: 'x' }, { provider: 'linear', scope: 'x', credentials: { token: 'SECRET-CRED-X' } }] },
    { _id: 'acct-N', identities: [] },
    // Merged away: local-only, but an alias, so (d) doesn't count it.
    { _id: 'acct-M', mergedInto: 'acct-S', identities: [{ provider: 'local', scope: 'm', credentials: { token: 'SECRET-CRED-M' } }] },
    { _id: 'acct-S', identities: [{ provider: 'linear', scope: 's', credentials: { token: 'SECRET-CRED-S' } }] },
    { _id: 'acct-B1', identities: [{ provider: 'jira', scope: 'b1' }] },
    { _id: 'acct-B2', identities: [{ provider: 'jira', scope: 'b2' }] }
  ]);

  await db.collection('account-workspaces').insertMany([
    // (a) a pre-S1 workspace with one account
    { _id: 'e1', accountId: 'acct-A1', workspaceId: W_A1, createdAt: PRE },
    // (a) two edges, one canonical account after the merge
    { _id: 'e2', accountId: 'acct-M', workspaceId: W_A2, createdAt: PRE },
    { _id: 'e3', accountId: 'acct-S', workspaceId: W_A2, createdAt: new Date(PRE.getTime() + 1000) },
    // (a) a post-S1 workspace that got its owner edge
    { _id: 'e4', accountId: 'acct-O', workspaceId: W_OWN, createdAt: POST, role: 'owner' },
    // (b) two distinct accounts; B1 bound first
    { _id: 'e5', accountId: 'acct-B2', workspaceId: W_B, createdAt: new Date(PRE.getTime() + 5000) },
    { _id: 'e6', accountId: 'acct-B1', workspaceId: W_B, createdAt: PRE },
    // (a) and (e): a first edge after the cutoff with no owner (crash gap)
    { _id: 'e7', accountId: 'acct-E', workspaceId: W_E, createdAt: POST }
  ]);

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.collection('sessions').insertMany([
    {
      _id: SIDS[0],
      expires: future,
      session: {
        accountId: 'acct-A1',
        openRouterApiKey: 'SECRET-OR-one',
        workspaces: [
          { id: W_A1, urlKey: 'alpha', name: 'SECRET-NAME-one', accessToken: 'SECRET-AT-one', refreshToken: 'SECRET-RT-one' },
          { id: W_C1, urlKey: 'gamma', accessToken: 'SECRET-AT-two', refreshToken: 'SECRET-RT-two' },
          // Third element: the one MangoDB's dotted projection would drop.
          { id: W_C2, urlKey: 'container-c2', credentials: { token: 'SECRET-CREDS-TOKEN-one' } }
        ]
      }
    },
    { _id: SIDS[1], expires: future, session: { workspaces: [{ id: W_B, urlKey: 'jira-abc' }, { id: W_C1, urlKey: 'gamma' }] } },
    { _id: SIDS[2], expires: future, session: { workspaces: [] } },
    { _id: SIDS[3], expires: future, session: { accountId: 'acct-N' } },
    { _id: SIDS[4], expires: future, session: JSON.stringify({ workspaces: [{ id: W_STRING_ONLY, accessToken: 'SECRET-AT-one' }] }) }
  ]);
}

// Records every collection call and what each read returned.
function spyDb(db) {
  const calls = [];
  return {
    calls,
    collection(name) {
      const real = db.collection(name);
      return new Proxy(real, {
        get(target, prop) {
          const value = target[prop];
          if (typeof value !== 'function') return value;
          return (...args) => {
            const call = { collection: name, method: prop, filter: args[0], options: args[1], returned: [] };
            calls.push(call);
            const result = value.apply(target, args);
            if (prop !== 'find') return result;
            return {
              async toArray() {
                const docs = await result.toArray();
                call.returned = docs;
                return docs;
              }
            };
          };
        }
      });
    }
  };
}

function captureOut() {
  const chunks = [];
  return { write: chunk => chunks.push(chunk), text: () => chunks.join('') };
}

describe('dry-run-workspace-ownership (LIN-1892 S1)', () => {
  let dbDir;
  let client;
  let db;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'dry-run-ownership-'));
    client = new MangoClient(dbDir);
    await client.connect();
    db = client.db('linear-viewer');
    await seed(db);
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  test('exact counts for every bucket, with --s1-deployed-at', async () => {
    const report = await computeOwnershipReport({ db, s1DeployedAt: CUTOFF });

    assert.deepStrictEqual(report.totals, {
      edges: 7,
      workspacesWithEdges: 5,
      ownerEdges: 1,
      mergedAccounts: 1,
      unresolvableAccountEdges: 0,
      sessionRows: 5,
      sessionWorkspaceEntries: 5,
      unscannableSessionRows: 1
    });

    assert.strictEqual(report.a_derivableOwner.count, 4);
    assert.deepStrictEqual(
      report.a_derivableOwner.rows.map(r => [r.workspaceId, r.accountId, r.hasOwner]),
      [[W_OWN, 'acct-O', true], [W_E, 'acct-E', false], [W_A2, 'acct-S', false], [W_A1, 'acct-A1', false]]
    );

    assert.strictEqual(report.b_multiAccount.count, 1);
    assert.deepStrictEqual(report.b_multiAccount.rows, [{
      workspaceId: W_B,
      kind: 'jira',
      edgeCount: 2,
      distinctAccountCount: 2,
      firstBinderCandidate: 'acct-B1',
      firstEdgeCreatedAt: PRE.toISOString(),
      hasOwner: false
    }]);

    // W_C2 is the third workspace of a session: it is counted on MangoDB too.
    assert.strictEqual(report.c_sessionOnlyNoEdge.count, 2);
    assert.deepStrictEqual(report.c_sessionOnlyNoEdge.rows, [
      { workspaceId: W_C2, urlKey: 'container-c2', kind: 'container' },
      { workspaceId: W_C1, urlKey: 'gamma', kind: 'linear-org' }
    ]);

    assert.strictEqual(report.d_localOnlyAccounts.count, 2, 'acct-L1 and acct-L2; not acct-X (has linear), acct-N (none) or merged acct-M');

    assert.deepStrictEqual(report.e_crashGapCandidates, {
      computed: true,
      s1DeployedAt: CUTOFF.toISOString(),
      count: 1,
      rows: [{ workspaceId: W_E, kind: 'container', firstEdgeCreatedAt: POST.toISOString() }]
    });
  });

  test('(e) is reported as not computed without --s1-deployed-at', async () => {
    const out = captureOut();
    const report = await runDryRun({ db, out });

    assert.strictEqual(report.e_crashGapCandidates.computed, false);
    assert.ok(!('count' in report.e_crashGapCandidates));
    assert.match(out.text(), /\(e\) not computed: pass --s1-deployed-at <ISO>/);
  });

  test('bucket (c)\'s printed caveat states the 30-day session TTL, not 24h (S1-3)', async () => {
    const out = captureOut();
    await runDryRun({ db, out });

    assert.match(out.text(), /\(c\) seen in sessions, no edge: 2 — lower bound: .*30 days/);
    assert.doesNotMatch(out.text(), /24 ?h/i);
  });

  test('N9 / S1-1 / S1-2: the only sessions find projects session.workspaces whole; accounts reads return no identities; only find/countDocuments are called', async () => {
    const spy = spyDb(db);
    await runDryRun({ db: spy, out: captureOut(), s1DeployedAt: CUTOFF });

    assert.deepStrictEqual(
      [...new Set(spy.calls.map(c => c.method))].sort(),
      ['countDocuments', 'find'],
      'read-only: no other collection method is called'
    );

    const sessionCalls = spy.calls.filter(c => c.collection === 'sessions');
    const sessionFinds = sessionCalls.filter(c => c.method === 'find');
    assert.strictEqual(sessionFinds.length, 1, 'exactly one sessions find');
    assert.deepStrictEqual(sessionFinds[0].filter, {});
    assert.deepStrictEqual(sessionFinds[0].options, { projection: { _id: 0, 'session.workspaces': 1 } });
    assert.deepStrictEqual(SESSIONS_FIND_PROJECTION, { _id: 0, 'session.workspaces': 1 });
    assert.ok(sessionFinds[0].returned.every(doc => !('_id' in doc)), 'no sid comes back');
    assert.ok(
      sessionFinds[0].returned.every(doc => Object.keys(doc.session || {}).every(k => k === 'workspaces')),
      'no session field besides workspaces comes back'
    );
    assert.ok(sessionCalls.every(c => c.method === 'find' || c.method === 'countDocuments'));

    const accountFinds = spy.calls.filter(c => c.collection === 'accounts' && c.method === 'find');
    assert.ok(accountFinds.length > 0);
    for (const call of accountFinds) {
      assert.ok(
        Object.keys(call.options.projection).every(k => k === '_id' || k === 'mergedInto'),
        `accounts find projects only _id/mergedInto, got ${JSON.stringify(call.options.projection)}`
      );
      assert.ok(call.returned.every(doc => !('identities' in doc)), 'no identity comes back from an accounts read');
    }
  });

  test('no seeded secret, sid or identity credential reaches stdout or the JSON (N9, S1-1, S1-2)', async () => {
    const out = captureOut();
    const report = await runDryRun({ db, out, s1DeployedAt: CUTOFF });
    const json = JSON.stringify(report);

    for (const value of [...SECRETS, ...SIDS, ...IDENTITY_CREDENTIALS]) {
      assert.ok(!out.text().includes(value), `stdout must not contain ${value}`);
      assert.ok(!json.includes(value), `the JSON must not contain ${value}`);
    }
    assert.ok(!json.includes(W_STRING_ONLY), 'a string-encoded session is counted as unscannable, never parsed');
  });

  test('the CLI wrapper prints the summary and the JSON, and leaves the store unchanged', () => {
    const run = () => spawnSync(process.execPath, [SCRIPT_PATH, '--s1-deployed-at', CUTOFF.toISOString()], {
      env: { ...process.env, MONGODB_URI: '', HARBOUR_DATA_DIR: dbDir },
      encoding: 'utf8'
    });
    const before = readdirSnapshot(dbDir);
    const result = run();

    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /^\[dry-run\] LIN-1892 workspace ownership \(read-only\)/);
    const json = JSON.parse(result.stdout.slice(result.stdout.indexOf('\n{') + 1));
    assert.strictEqual(json.b_multiAccount.count, 1);
    assert.strictEqual(json.e_crashGapCandidates.count, 1);
    for (const value of [...SECRETS, ...SIDS, ...IDENTITY_CREDENTIALS]) {
      assert.ok(!result.stdout.includes(value), `CLI stdout must not contain ${value}`);
    }
    assert.deepStrictEqual(readdirSnapshot(dbDir), before, 'the data dir is byte-identical after the run');
  });

  test('the script source makes no write call', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    const writes = source.match(/\.(insert\w*|update\w*|delete\w*|replace\w*|drop\w*|findOneAnd\w*|bulkWrite|createIndex\w*|rename)\s*\(/g);
    assert.strictEqual(writes, null, `write call(s) found: ${writes}`);
  });

  test('parseArgs accepts an ISO instant and rejects a bad one', () => {
    assert.deepStrictEqual(parseArgs([]), {});
    assert.strictEqual(parseArgs(['--s1-deployed-at', CUTOFF.toISOString()]).s1DeployedAt.getTime(), CUTOFF.getTime());
    assert.throws(() => parseArgs(['--s1-deployed-at']), /needs an ISO timestamp/);
    assert.throws(() => parseArgs(['--s1-deployed-at', 'yesterday']), /needs an ISO timestamp/);
  });

  test('inferWorkspaceKind reads the id prefix; a UUID id is a container', () => {
    assert.strictEqual(inferWorkspaceKind('github:42'), 'github');
    assert.strictEqual(inferWorkspaceKind('jira:5b10'), 'jira');
    assert.strictEqual(inferWorkspaceKind(W_OWN), 'container');
    assert.strictEqual(inferWorkspaceKind('a1b2c3-org-id'), 'linear-org');
  });
});

// Every file under `dir` with its contents, for a before/after comparison.
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
