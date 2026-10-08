/**
 * Unit tests for scripts/dry-run-urlkey-duplicates.mjs (LIN-3381, S1.1).
 *
 * Run with: node --test tests/unit/dry-run-urlkey-duplicates.test.js
 *
 * Against a REAL MangoDB tmpdir seeded with every population the report
 * classifies (collision, shared, clean, actor-only, the four no-holder buckets),
 * mirroring dry-run-workspace-ownership.test.js.
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
  runDryRun, computeUrlKeyDuplicateReport, parseArgs, URLKEY_SOURCES, ACTOR_SOURCES, READ_COLLECTIONS,
  SESSIONS_URLKEY_PROJECTION
} from '../../scripts/dry-run-urlkey-duplicates.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/dry-run-urlkey-duplicates.mjs', import.meta.url));
const NOW = new Date('2026-10-08T12:00:00.000Z');
const T1 = new Date('2026-08-01T00:00:00.000Z');
const T2 = new Date('2026-09-01T00:00:00.000Z');
const T3 = new Date('2026-09-15T00:00:00.000Z');
const FUTURE = new Date(NOW.getTime() + 86400000);
const PAST = new Date(NOW.getTime() - 86400000);

// Account ids are longer than 8 chars so truncation is observable.
const A = 'account-alpha-0001';
const B = 'account-bravo-0002';
const C = 'account-charlie-0003';
const D = 'account-delta-0004';
const OLD = 'account-merged-away-0005';
const J1 = 'account-jira-one-0006';
const J2 = 'account-jira-two-0007';
const K1 = 'account-conn-one-0008';
const K2 = 'account-conn-two-0009';
const X = 'account-actor-0010';
const L1 = 'account-live-0011';

const SECRETS = [
  'SECRET-TOKENHASH', 'SECRET-OC-TOKEN', 'SECRET-OC-REFRESH', 'SECRET-CONN-CRED', 'SECRET-SID', 'SECRET-SESSION-AT',
  'SECRET-STRING-SESSION', 'SECRET-GRANTS', 'SECRET-SITE'
];
const FULL_IDS = [A, B, C, D, OLD, J1, J2, K1, K2, X, L1];
const CONN_ID = `${K1}::jira::unit-1`;

async function seed(db) {
  await db.collection('accounts').insertMany([
    { _id: OLD, mergedInto: C, identities: [] },
    ...[A, B, C, D, J1, J2, K1, K2, X, L1].map(_id => ({ _id, identities: [] }))
  ]);
  await db.collection('account-workspaces').insertMany([
    // shared: A and B both reach W-shared (linked via A's proxy token)
    { _id: 'e1', accountId: A, workspaceId: 'W-shared', role: 'owner' },
    { _id: 'e2', accountId: B, workspaceId: 'W-shared' },
    // collision: own workspaces
    { _id: 'e3', accountId: A, workspaceId: 'W-coll-a', role: 'owner' },
    { _id: 'e4', accountId: B, workspaceId: 'W-coll-b' },
    // unlinked common edge: C and D share W-other, which is not linked to k-unlinked
    { _id: 'e5', accountId: C, workspaceId: 'W-other' },
    { _id: 'e6', accountId: D, workspaceId: 'W-other' },
    // declared-mint link
    { _id: 'e7', accountId: A, workspaceId: 'W-decl' },
    { _id: 'e8', accountId: C, workspaceId: 'W-decl' },
    { _id: 'e9', accountId: J1, workspaceId: 'jira:person-one-xxxxxxxx' },
    { _id: 'e10', accountId: J2, workspaceId: 'jira:person-two-xxxxxxxx' },
    // one account, one key, two workspace ids (informational)
    { _id: 'e11', accountId: D, workspaceId: 'W-multi-1' },
    { _id: 'e12', accountId: D, workspaceId: 'W-multi-2' },
    // owner evidence: A is owner of W-owned (linked to k-owner-evidence); B belongs to another workspace
    { _id: 'e13', accountId: A, workspaceId: 'W-owned', role: 'owner' }
  ]);

  await db.collection('proxy-tokens').insertMany([
    { _id: 'p1', urlKey: 'k-clean', createdBy: A, createdAt: T2, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p2', urlKey: 'k-shared', createdBy: A, createdAt: T1, workspaceId: 'W-shared', tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p3', urlKey: 'k-shared', createdBy: B, createdAt: T2, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p4', urlKey: 'k-collision', createdBy: A, createdAt: T1, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p5', urlKey: 'k-collision', createdBy: B, createdAt: T2, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p6', urlKey: 'k-unlinked', createdBy: C, createdAt: T1, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p7', urlKey: 'k-unlinked', createdBy: D, createdAt: T1, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p8', urlKey: 'k-merged', createdBy: D, createdAt: T2, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p9', urlKey: 'k-connkey', createdBy: K2, createdAt: T2, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p10', urlKey: 'k-ownerless', createdBy: null, createdAt: T2, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p11', urlKey: 'k-multi', createdBy: D, createdAt: T2, workspaceId: 'W-multi-1', tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p12', urlKey: 'k-multi', createdBy: D, createdAt: T2, workspaceId: 'W-multi-2', tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p13', urlKey: 'k-actor', createdBy: A, createdAt: T2, tokenHash: 'SECRET-TOKENHASH' },
    // per-collision evidence: A owns the workspace this key links, B is a plain member of another
    { _id: 'p14', urlKey: 'k-owner-evidence', createdBy: A, createdAt: T1, workspaceId: 'W-owned', tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p15', urlKey: 'k-owner-evidence', createdBy: B, createdAt: T2, tokenHash: 'SECRET-TOKENHASH' },
    // earliest token: three tokens for one holder, inserted T2, T1, T3
    { _id: 'p16', urlKey: 'k-earliest', createdBy: A, createdAt: T2, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p17', urlKey: 'k-earliest', createdBy: A, createdAt: T1, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p18', urlKey: 'k-earliest', createdBy: A, createdAt: T3, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'p19', urlKey: 'k-earliest', createdBy: B, createdAt: T3, tokenHash: 'SECRET-TOKENHASH' }
  ]);
  await db.collection('dispatch-tokens').insertMany([
    // held only through dispatch-tokens, under an id that was merged away
    { _id: 'd1', urlKey: 'k-merged', createdBy: OLD, createdAt: T1, tokenHash: 'SECRET-TOKENHASH' },
    // lifetime link: no proxy-tokens row, the declaration names the workspace
    { _id: 'd2', urlKey: 'k-decl', createdBy: A, createdAt: T1, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'd3', urlKey: 'k-decl-other', createdBy: A, createdAt: T1, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'd4', urlKey: 'k-earliest', createdBy: A, createdAt: T3, tokenHash: 'SECRET-TOKENHASH' },
    { _id: 'd5', urlKey: 'k-earliest', createdBy: A, createdAt: T2, tokenHash: 'SECRET-TOKENHASH' }
  ]);
  await db.collection('owner-credentials').insertMany([
    { _id: `${A}::k-collision::linear`, accountId: A, urlKey: 'k-collision', provider: 'linear', token: 'SECRET-OC-TOKEN', refreshToken: 'SECRET-OC-REFRESH', createdAt: T1 },
    { _id: `${C}::k-decl::linear`, accountId: C, urlKey: 'k-decl', provider: 'linear', token: 'SECRET-OC-TOKEN', createdAt: T1 },
    { _id: `${C}::k-decl-other`, accountId: C, urlKey: 'k-decl-other', token: 'SECRET-OC-TOKEN', createdAt: T1 },
    // connection-keyed: no urlKey; found through the connection's referent
    { _id: CONN_ID, connectionId: CONN_ID, accountId: K1, provider: 'jira', token: 'SECRET-OC-TOKEN', refreshToken: 'SECRET-OC-REFRESH', createdAt: T1 }
  ]);
  await db.collection('connections').insertMany([
    { _id: CONN_ID, accountId: K1, provider: 'jira', unitId: 'unit-1', credentials: { accessToken: 'SECRET-CONN-CRED' }, referents: [{ urlKey: 'k-connkey', provider: 'jira', scope: 'site' }], createdAt: T1 },
    { _id: `${J1}::jira::site-1`, accountId: J1, provider: 'jira', unitId: 'site-1', credentials: { accessToken: 'SECRET-CONN-CRED' }, referents: [{ urlKey: 'k-jira', provider: 'jira', scope: 'site' }], createdAt: T1 },
    { _id: `${J2}::jira::site-1`, accountId: J2, provider: 'jira', unitId: 'site-1', credentials: { accessToken: 'SECRET-CONN-CRED' }, referents: [{ urlKey: 'k-jira', provider: 'jira', scope: 'site' }], createdAt: T2 },
    // LIN-3127-born row: no referents field, never a holder
    { _id: `${X}::jira::legacy`, accountId: X, provider: 'jira', unitId: 'legacy', credentials: { accessToken: 'SECRET-CONN-CRED' } }
  ]);

  const declaration = (workspaceId, ownerAccountId) => ({ grants: ['SECRET-GRANTS'], ownerAccountId, workspaceId, profile: 'worker', site: 'https://SECRET-SITE.example', declaredAt: T1 });
  await db.collection('dispatch-history').insertMany([
    { _id: 'h1', urlKey: 'k-decl', dispatchedBy: A, grantDeclaration: declaration('W-decl', A), grants: 'SECRET-GRANTS' },
    { _id: 'h2', urlKey: 'k-decl-other', dispatchedBy: A, grantDeclaration: declaration('W-elsewhere', A) },
    { _id: 'h3', urlKey: 'k-actor', dispatchedBy: X },
    { _id: 'h4', urlKey: 'k-actor-only', dispatchedBy: X }
  ]);
  await db.collection('task_share_links').insertOne({ _id: 'ts1', urlKey: 'k-jira', workspaceId: 'jira:person-one-xxxxxxxx', ownerAccountId: J1 });
  await db.collection('saved-chats').insertOne({ _id: 'sc1', urlKey: 'k-actor', accountId: X });
  await db.collection('custom-prompts').insertMany([
    { _id: 'cp1', urlKey: 'k-data-only' },
    { _id: 'cp2', urlKey: 'slug-0a1b2c3d' },
    { _id: 'cp3', urlKey: 'k-live-only' },
    { _id: 'cp4', urlKey: 'k-stale-only' },
    { _id: 'cp5', urlKey: 'k-actor-prefs' }
  ]);
  // LIN-3381 review: every class-C shape the no-holder count must reach.
  await db.collection('run-proposals').insertOne({ _id: 'rp1', urlKey: 'k-src-field' });
  await db.collection('local-issues').insertOne({ _id: 'li1', scope: 'k-src-scope' });
  await db.collection('workspace-preferences').insertOne({ _id: 'k-src-id', preferences: {} });
  await db.collection('harbour-comments').insertOne({ _id: 'k-src-comment::c1' });
  await db.collection('observer-state').insertMany([{ _id: 'sweep:v1:k-src-observer' }, { _id: 'companion:v1:k-src-companion:proxy' }, { _id: 'unrelated-instance' }]);
  await db.collection('brief-cache').insertOne({ _id: 'k-src-brief:issue-uuid' });
  await db.collection('recap-cache').insertOne({ _id: 'github:k-src-recap:issue-uuid' });
  // class-B actors: close-out-events and the user-preferences maps
  await db.collection('close-out-events').insertOne({ _id: 'co1', urlKey: 'k-actor-closeout', accountId: X });
  await db.collection('user-preferences').insertOne({ _id: X, preferences: { selectedTeamByWorkspace: { 'k-actor-prefs': 'team-1' } } });
  await db.collection('workspace-halt').insertOne({ _id: 'k-halt-only' });
  // parse witnesses: composite ids whose key is HELD (k-collision) must not add a no-holder key
  await db.collection('harbour-comments').insertOne({ _id: 'k-collision::c2' });
  await db.collection('brief-cache').insertOne({ _id: 'k-collision:issue-2' });
  await db.collection('recap-cache').insertMany([{ _id: 'k-collision:issue-3' }, { _id: 'github:k-src-recap-2:issue-uuid' }]);
  await db.collection('observer-state').insertMany([{ _id: 'sweep:v1:k-collision' }, { _id: 'companion:v1:k-collision:proxy' }]);

  await db.collection('sessions').insertMany([
    { _id: 'SECRET-SID-1', expires: FUTURE, session: { accountId: L1, workspaces: [{ id: 'W-live', urlKey: 'k-live-only', accessToken: 'SECRET-SESSION-AT' }, { id: 'W-shared', urlKey: 'k-shared' }] } },
    { _id: 'SECRET-SID-2', expires: PAST, session: { accountId: L1, workspaces: [{ id: 'W-stale', urlKey: 'k-stale-only', accessToken: 'SECRET-SESSION-AT' }] } },
    { _id: 'SECRET-SID-3', expires: FUTURE, session: JSON.stringify({ workspaces: [{ id: 'W-string', urlKey: 'k-string-session', accessToken: 'SECRET-STRING-SESSION' }] }) }
  ]);
}

function captureOut() {
  const chunks = [];
  return { write: chunk => chunks.push(chunk), text: () => chunks.join('') };
}

// Rejects any method but the read-only four and records every call.
function readOnlySpyDb(db) {
  const calls = [];
  const ALLOWED = new Set(['find', 'countDocuments', 'distinct', 'aggregate']);
  return {
    calls,
    collection(name) {
      const real = db.collection(name);
      return new Proxy(real, {
        get(target, prop) {
          const value = target[prop];
          if (typeof value !== 'function') return value;
          return (...args) => {
            calls.push({ collection: name, method: String(prop), args });
            if (!ALLOWED.has(String(prop))) throw new Error(`write-capable call ${String(prop)} on ${name}`);
            return value.apply(target, args);
          };
        }
      });
    }
  };
}

const row = (rows, urlKey) => rows.find(r => r.urlKey === urlKey);

describe('dry-run-urlkey-duplicates (LIN-3381 S1.1)', () => {
  let dbDir;
  let client;
  let db;
  let report;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'dry-run-urlkey-'));
    client = new MangoClient(dbDir);
    await client.connect();
    db = client.db('linear-viewer');
    await seed(db);
    report = await computeUrlKeyDuplicateReport({ db, now: NOW });
  });

  after(async () => {
    await client.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  test('a collision is reported with per-key evidence', () => {
    const collision = row(report.collisions.rows, 'k-collision');
    assert.ok(collision, 'k-collision is a collision');
    assert.strictEqual(collision.groups, 2);
    assert.strictEqual(collision.commonWorkspaceUnlinked, true, 'A and B reach W-shared, which k-collision does not link');
    assert.ok(collision.holders.every(h => h.account === 'account-…'), 'ids are cut to 8 characters');
    const byAccount = Object.fromEntries(collision.holders.map(h => [h.sources.join('+'), h]));
    const withCred = byAccount['owner-credentials+proxy-tokens'];
    assert.ok(withCred, 'A holds through an owner-credentials record and a token');
    assert.strictEqual(withCred.ownerCredential, true);
    assert.strictEqual(withCred.ownerOfLinkedWorkspace, false, 'k-collision links no workspace, so no linked owner edge');
    assert.strictEqual(byAccount['proxy-tokens'].ownerOfLinkedWorkspace, false);
    assert.strictEqual(withCred.earliestTokenAt.proxy, T1.toISOString());
    assert.strictEqual(byAccount['proxy-tokens'].earliestTokenAt.proxy, T2.toISOString());
  });

  test('ownerOfLinkedWorkspace is true only for a holder with a role:owner edge to a workspace linked to the key', () => {
    const collision = row(report.collisions.rows, 'k-owner-evidence');
    assert.ok(collision, 'A (owner of W-owned) and B (member only) share no linked workspace');
    const a = collision.holders.find(h => h.sources.includes('proxy-tokens') && h.ownerOfLinkedWorkspace);
    assert.ok(a, 'the owner edge to the linked workspace is recorded');
    assert.strictEqual(collision.holders.filter(h => h.ownerOfLinkedWorkspace).length, 1, 'the member-only edge is not an owner edge');
  });

  test('earliestTokenAt picks the earliest createdAt, not the latest or the first inserted', () => {
    const collision = row(report.collisions.rows, 'k-earliest');
    assert.ok(collision);
    const holder = collision.holders.find(h => h.earliestTokenAt.proxy);
    assert.strictEqual(holder.earliestTokenAt.proxy, T1.toISOString(), 'T2 was inserted first, T3 last, T1 is earliest');
    assert.strictEqual(holder.earliestTokenAt.dispatch, T2.toISOString());
  });

  test('a shared membership is reported separately and is not a collision', () => {
    assert.ok(row(report.sharedMemberships.rows, 'k-shared'));
    assert.ok(!row(report.collisions.rows, 'k-shared'));
    assert.deepStrictEqual(row(report.sharedMemberships.rows, 'k-shared').sharedWorkspaces, ['W-shared…']);
  });

  test('a clean key (one holder, no actor) reports no duplicate', () => {
    for (const bucket of [report.collisions, report.sharedMemberships, report.suspectedCollisionsActorOnly]) {
      assert.ok(!row(bucket.rows, 'k-clean'));
    }
  });

  test('a collision found only through dispatch-tokens under a merged-away id', () => {
    const collision = row(report.collisions.rows, 'k-merged');
    assert.ok(collision);
    assert.ok(collision.holders.some(h => h.sources.includes('dispatch-tokens')));
    assert.strictEqual(collision.holders.length, 2, 'the merged-away id resolves to its canonical account');
  });

  test('Jira teammates on one site are counted as a collision', () => {
    assert.strictEqual(row(report.collisions.rows, 'k-jira')?.commonWorkspaceUnlinked, false, 'no common edge at all');
  });

  test('a connection-keyed credential counts as evidence through its referent', () => {
    const collision = row(report.collisions.rows, 'k-connkey');
    assert.ok(collision);
    const viaConnection = collision.holders.find(h => h.sources.includes('connections'));
    assert.strictEqual(viaConnection.ownerCredential, true);
    assert.strictEqual(collision.holders.find(h => h.sources.includes('proxy-tokens')).ownerCredential, false);
  });

  test('an unlinked common edge is still a collision, flagged', () => {
    const collision = row(report.collisions.rows, 'k-unlinked');
    assert.ok(collision);
    assert.strictEqual(collision.commonWorkspaceUnlinked, true);
  });

  test('a dispatch declaration workspace links holders after the token rows are gone (R3)', () => {
    assert.ok(row(report.sharedMemberships.rows, 'k-decl'), 'declaration workspace W-decl links the key, A and C reach it');
    const other = row(report.collisions.rows, 'k-decl-other');
    assert.ok(other, 'a declaration naming a different workspace leaves the collision');
    assert.strictEqual(other.commonWorkspaceUnlinked, true, 'A and C both reach W-decl, which this key does not link');
  });

  test('actor evidence yields a labelled suspected collision and never a holder', () => {
    const suspected = row(report.suspectedCollisionsActorOnly.rows, 'k-actor');
    assert.ok(suspected);
    assert.deepStrictEqual(suspected.actorAccounts, ['account-…']);
    assert.ok(!row(report.collisions.rows, 'k-actor'));
    assert.ok(!row(report.suspectedCollisionsActorOnly.rows, 'k-decl'), 'grantDeclaration.ownerAccountId equal to a holder is not suspected');
  });

  test('no-holder keys are bucketed disjointly, with the S1.2 residual separate', () => {
    const { buckets, s1_2Residual, total } = report.keysWithNoHolder;
    // actorOnly: k-actor-only (dispatch-history), k-actor-closeout (close-out-events.accountId), k-actor-prefs (user-preferences map key)
    assert.deepStrictEqual(buckets, { liveSession: 1, staleSession: 1, actorOnly: 3, dataOnly: 13 });
    assert.strictEqual(total, 18);
    // data-only: k-data-only, slug-0a1b2c3d, k-halt-only, k-ownerless (token with no owner), plus one key seeded ONLY in each of
    // run-proposals (field), local-issues (scope), workspace-preferences (_id), harbour-comments (_id prefix),
    // observer-state (sweep and companion ids), brief-cache and recap-cache (workspace id prefix of the _id),
    // plus github:k-src-recap-2 (a second recap-cache key whose workspace id itself contains a colon). The parse-witness rows
    // seeded on k-collision are held, so a correct parse adds nothing for them and a wrong parse adds a bogus key each.
    assert.strictEqual(s1_2Residual.count, 13);
    assert.deepStrictEqual(report.keysWithNoHolder.unenumeratedSources.map(u => u.collection), ['run-summary-cache', 'session-summary-cache']);
    assert.strictEqual(s1_2Residual.localShapeSubCount, 1);
  });

  test('sessions: lower bound, stale counted apart, string rows unscannable', () => {
    const s = report.liveSessionHolders;
    assert.strictEqual(s.liveKeys, 2);
    assert.strictEqual(s.staleKeys, 1);
    assert.strictEqual(s.unscannableSessionRows, 1);
    assert.match(s.caveat, /lower bound/);
    assert.ok(s.liveNotInHolderSet.rows.some(r => r.urlKey === 'k-live-only'));
  });

  test('ownerless tokens are counted, not holders; informational multi-workspace keys', () => {
    assert.strictEqual(report.totals.ownerlessTokens, 1);
    assert.ok(row(report.keysOnMultipleWorkspaceIds.rows, 'k-multi'));
  });

  test('a clean seed reports zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dry-run-urlkey-clean-'));
    const cleanClient = new MangoClient(dir);
    await cleanClient.connect();
    try {
      const cleanDb = cleanClient.db('linear-viewer');
      await cleanDb.collection('proxy-tokens').insertOne({ _id: 'p', urlKey: 'only', createdBy: A, createdAt: T1, tokenHash: 'SECRET-TOKENHASH' });
      await cleanDb.collection('account-workspaces').insertOne({ _id: 'e', accountId: A, workspaceId: 'W', role: 'owner' });
      const clean = await computeUrlKeyDuplicateReport({ db: cleanDb, now: NOW });
      assert.strictEqual(clean.collisions.count, 0);
      assert.strictEqual(clean.sharedMemberships.count, 0);
      assert.strictEqual(clean.suspectedCollisionsActorOnly.count, 0);
      assert.strictEqual(clean.keysWithNoHolder.total, 0);
    } finally {
      await cleanClient.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('read-only: only find/countDocuments/distinct/aggregate, never $out/$merge, only declared collections', async () => {
    const spy = readOnlySpyDb(db);
    await computeUrlKeyDuplicateReport({ db: spy, now: NOW });
    assert.ok(spy.calls.length > 0);
    for (const call of spy.calls) {
      assert.ok(['find', 'countDocuments', 'distinct', 'aggregate'].includes(call.method), `${call.method} on ${call.collection}`);
      assert.ok(!/\$out|\$merge/.test(JSON.stringify(call.args)), 'no $out/$merge stage');
      assert.ok(READ_COLLECTIONS.includes(call.collection), `${call.collection} is a declared read`);
    }
    const sessionFinds = spy.calls.filter(c => c.collection === 'sessions' && c.method === 'find');
    assert.strictEqual(sessionFinds.length, 1, 'exactly one sessions find');
    assert.deepStrictEqual(sessionFinds[0].args[1], { projection: SESSIONS_URLKEY_PROJECTION });
  });

  test('every declared source and actor collection is a real, classified read', () => {
    for (const s of URLKEY_SOURCES) assert.ok(READ_COLLECTIONS.includes(s.collection));
    for (const s of ACTOR_SOURCES) assert.ok(READ_COLLECTIONS.includes(s.collection));
  });

  test('no secret, string-session content or untruncated account id reaches stdout or the JSON', async () => {
    const out = captureOut();
    const result = await runDryRun({ db, out, now: NOW });
    const json = JSON.stringify(result);
    for (const value of SECRETS) {
      assert.ok(!out.text().includes(value), `stdout must not contain ${value}`);
      assert.ok(!json.includes(value), `the JSON must not contain ${value}`);
    }
    for (const id of FULL_IDS) assert.ok(!out.text().includes(id), `stdout must not contain full id ${id}`);
    assert.ok(!out.text().includes(CONN_ID), 'connection ids are never printed');
    assert.ok(!json.includes('k-string-session'), 'a string-encoded session is never parsed');
    assert.ok(out.text().includes('k-collision'), 'urlKeys print in full');
    assert.ok(out.text().includes('jira:person-o…'), 'workspace ids keep their kind prefix and are cut');
  });

  test('the CLI prints the summary and JSON and leaves the store byte-identical', () => {
    const before = snapshot(dbDir);
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      env: { ...process.env, MONGODB_URI: '', HARBOUR_DATA_DIR: dbDir },
      encoding: 'utf8'
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /^\[dry-run\] LIN-3381 urlKey holders \(read-only\)/);
    const json = JSON.parse(result.stdout.slice(result.stdout.indexOf('\n{') + 1));
    assert.ok(json.collisions.count >= 5);
    for (const value of SECRETS) assert.ok(!result.stdout.includes(value), `CLI stdout must not contain ${value}`);
    assert.deepStrictEqual(snapshot(dbDir), before);
  });

  test('the script source makes no write call and no $out/$merge', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    assert.strictEqual(source.match(/\.(insert\w*|update\w*|delete\w*|replace\w*|drop\w*|findOneAnd\w*|bulkWrite|createIndex\w*|rename)\s*\(/g), null);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\$out|\$merge/.test(code), 'no $out/$merge in code');
  });

  test('parseArgs takes no arguments', () => {
    assert.deepStrictEqual(parseArgs([]), {});
    assert.throws(() => parseArgs(['--x']), /unexpected argument/);
  });
});

function snapshot(dir) {
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
