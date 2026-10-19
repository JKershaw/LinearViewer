import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEARTBEAT_FIELDS, parseHeartbeat, buildHeartbeatView, HEARTBEAT_STALE_FACTOR } from '../../lib/consumer-heartbeat.js';

// LIN-1952: the field set is pinned here AND in simple-dispatcher's builder
// test, so a rename on either side fails a test.
const FIELD_SET = [
  'schema', 'consumerKind', 'instanceId', 'sentAt', 'intervalMs',
  'uptimeSec', 'platform', 'version', 'lastPollOkAt', 'pollIntervalMs',
  'loadAvg1', 'loadAvg5', 'loadAvg15', 'cpuCount',
  'hostMemFreeBytes', 'hostMemTotalBytes',
  'activeSessionCount', 'heldSessionCount',
  'authStoppedWorkspaces'
];

const minimal = () => ({
  schema: 1,
  consumerKind: 'simple-dispatcher',
  instanceId: 'abc-123',
  sentAt: '2026-10-18T12:00:00.000Z',
  intervalMs: 60000
});

test('HEARTBEAT_FIELDS is the pinned, frozen field set', () => {
  assert.deepEqual([...HEARTBEAT_FIELDS], FIELD_SET);
  assert.ok(Object.isFrozen(HEARTBEAT_FIELDS));
});

test('parseHeartbeat accepts the minimal required body', () => {
  assert.deepEqual(parseHeartbeat(minimal()), minimal());
});

test('parseHeartbeat accepts every optional field', () => {
  const full = {
    ...minimal(), uptimeSec: 12.5, platform: 'darwin', version: 'abc1234',
    lastPollOkAt: '2026-10-18T11:59:58.000Z', pollIntervalMs: 5000,
    loadAvg1: 1.5, loadAvg5: 1, loadAvg15: 0.5, cpuCount: 8,
    hostMemFreeBytes: 1e9, hostMemTotalBytes: 16e9,
    activeSessionCount: 3, heldSessionCount: 0,
    authStoppedWorkspaces: ['acme', 'side.project_2']
  };
  assert.deepEqual(parseHeartbeat(full), full);
});

test('parseHeartbeat returns null for each missing or bad required field', () => {
  for (const key of ['schema', 'consumerKind', 'instanceId', 'sentAt', 'intervalMs']) {
    const body = minimal();
    delete body[key];
    assert.equal(parseHeartbeat(body), null, `missing ${key}`);
  }
  assert.equal(parseHeartbeat({ ...minimal(), schema: 2 }), null);
  assert.equal(parseHeartbeat({ ...minimal(), consumerKind: 'Bad Kind' }), null);
  assert.equal(parseHeartbeat({ ...minimal(), consumerKind: 'x'.repeat(33) }), null);
  assert.equal(parseHeartbeat({ ...minimal(), instanceId: 'has space' }), null);
  assert.equal(parseHeartbeat({ ...minimal(), instanceId: 'x'.repeat(65) }), null);
  assert.equal(parseHeartbeat({ ...minimal(), sentAt: 'yesterday' }), null);
  // Date.parse tolerates free text around a date; the privacy allowlist must not (LIN-1952 close-out).
  assert.equal(parseHeartbeat({ ...minimal(), sentAt: '/Users/jk/ 2020-01-01' }), null);
  assert.equal(parseHeartbeat({ ...minimal(), sentAt: 'john kershaw macbook 2020' }), null);
  assert.equal(parseHeartbeat({ ...minimal(), sentAt: '2026-10-18T12:00:00+01:00' }), null);
  assert.equal(parseHeartbeat({ ...minimal(), sentAt: '2026-10-18' }), null);
  assert.equal(parseHeartbeat({ ...minimal(), sentAt: '2026-13-45T99:99:99Z' }), null);
  assert.equal(parseHeartbeat({ ...minimal(), intervalMs: 999 }), null);
  assert.equal(parseHeartbeat({ ...minimal(), intervalMs: 3600001 }), null);
  assert.equal(parseHeartbeat({ ...minimal(), intervalMs: 1500.5 }), null);
  assert.equal(parseHeartbeat({ ...minimal(), intervalMs: '60000' }), null);
});

test('parseHeartbeat accepts another consumerKind of the allowed shape', () => {
  assert.equal(parseHeartbeat({ ...minimal(), consumerKind: 'runner-kit' }).consumerKind, 'runner-kit');
});

test('parseHeartbeat drops unknown keys, including hostnames, paths and users', () => {
  const parsed = parseHeartbeat({ ...minimal(), hostname: 'laptop', cwd: '/Users/x', user: 'x', content: 'secret' });
  assert.deepEqual(parsed, minimal());
});

test('parseHeartbeat drops non-finite, negative, wrong-typed and over-long optional values', () => {
  const parsed = parseHeartbeat({
    ...minimal(),
    loadAvg1: NaN, loadAvg5: Infinity, loadAvg15: -1,
    cpuCount: 2.5, uptimeSec: '10', hostMemFreeBytes: null,
    platform: 'x'.repeat(17), version: 'v'.repeat(41),
    lastPollOkAt: 'not a date', activeSessionCount: 2
  });
  assert.deepEqual(parsed, { ...minimal(), activeSessionCount: 2 });
});

test('parseHeartbeat drops a lastPollOkAt that is not a strict ISO UTC timestamp', () => {
  for (const bad of ['john kershaw macbook 2020', '/Users/jk/ 2020-01-01', '2026-10-18T12:00:00+01:00']) {
    assert.deepEqual(parseHeartbeat({ ...minimal(), lastPollOkAt: bad }), minimal(), bad);
  }
  const good = '2026-10-18T12:00:00.000Z';
  assert.equal(parseHeartbeat({ ...minimal(), lastPollOkAt: good }).lastPollOkAt, good);
});

test('parseHeartbeat never throws on garbage', () => {
  const cyclic = {}; cyclic.self = cyclic;
  const throwing = { get schema() { throw new Error('boom'); } };
  for (const body of [null, undefined, 0, 'str', [], cyclic, throwing, Object.create(null), new Proxy({}, { get() { throw new Error('x'); }, ownKeys() { throw new Error('x'); } })]) {
    assert.doesNotThrow(() => parseHeartbeat(body));
    assert.equal(parseHeartbeat(body), null);
  }
});

test('buildHeartbeatView reports ageMs and stale at 3 x intervalMs', () => {
  const now = new Date('2026-10-18T12:10:00.000Z');
  const doc = (receivedAt) => ({
    consumerKind: 'simple-dispatcher', instanceId: 'a', receivedAt: new Date(receivedAt),
    clockSkewMs: 12, fields: { schema: 1, sentAt: 'x', intervalMs: 60000, loadAvg1: 1 }
  });
  const fresh = buildHeartbeatView(doc('2026-10-18T12:07:00.000Z'), now); // 180000 = exactly 3x
  assert.equal(fresh.ageMs, 180000);
  assert.equal(fresh.stale, false);
  assert.equal(HEARTBEAT_STALE_FACTOR, 3);
  const stale = buildHeartbeatView(doc('2026-10-18T12:06:59.000Z'), now);
  assert.equal(stale.ageMs, 181000);
  assert.equal(stale.stale, true);
  assert.deepEqual(Object.keys(stale).sort(), ['ageMs', 'clockSkewMs', 'consumerKind', 'fields', 'instanceId', 'receivedAt', 'stale']);
  assert.equal(stale.receivedAt, '2026-10-18T12:06:59.000Z');
});

// LIN-3618: Harbour's half of LIN-3695. Bounded array of workspace-name strings;
// one bad element (or too many) drops the whole field, the rest of the beat stays.
test('authStoppedWorkspaces is kept when valid, including empty and exactly 16 x 64 chars', () => {
  assert.deepEqual(parseHeartbeat({ ...minimal(), authStoppedWorkspaces: ['acme', 'b-2'] }).authStoppedWorkspaces, ['acme', 'b-2']);
  assert.deepEqual(parseHeartbeat({ ...minimal(), authStoppedWorkspaces: [] }).authStoppedWorkspaces, []);
  const max = Array.from({ length: 16 }, () => 'w'.repeat(64));
  assert.deepEqual(parseHeartbeat({ ...minimal(), authStoppedWorkspaces: max }).authStoppedWorkspaces, max);
});

test('authStoppedWorkspaces is dropped whole for any bad shape, keeping the rest of the beat', () => {
  const bad = [
    'acme',                                  // not an array
    { 0: 'acme' },                           // array-like object
    Array.from({ length: 17 }, () => 'w'),   // over 16 items
    ['ok', 'w'.repeat(65)],                  // element over 64 characters
    ['ok', 'a/b'],                           // slash
    ['ok', 'has space'],                     // space
    ['ok', ''],                              // empty string
    ['ok', 5],                               // non-string element
    ['ok', null],
    ['/Users/jk/project']                    // a path must not ride in
  ];
  for (const value of bad) {
    assert.deepEqual(parseHeartbeat({ ...minimal(), activeSessionCount: 1, authStoppedWorkspaces: value }), { ...minimal(), activeSessionCount: 1 }, JSON.stringify(value));
  }
});

test('a beat without authStoppedWorkspaces is unchanged, and the view returns it in fields', () => {
  assert.ok(!('authStoppedWorkspaces' in parseHeartbeat(minimal())));
  const fields = parseHeartbeat({ ...minimal(), authStoppedWorkspaces: ['acme'] });
  const view = buildHeartbeatView(
    { consumerKind: 'simple-dispatcher', instanceId: 'a', receivedAt: new Date('2026-10-18T12:00:00.000Z'), clockSkewMs: 0, fields },
    new Date('2026-10-18T12:00:30.000Z')
  );
  assert.deepEqual(view.fields.authStoppedWorkspaces, ['acme']);
});
