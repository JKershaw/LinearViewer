/**
 * LIN-3366: the ticket-closed sweep. Loops, candidates and the closer are
 * injected so the tick's own behaviour (reads, ordering, caps, isolation) is
 * what is under test; the closer itself is covered by ticket-close-closer.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTicketCloseSweepRun, SWEEP_TICKET_READS_PER_WORKSPACE } from '../../lib/ticket-close-sweep.js';

const CAP = SWEEP_TICKET_READS_PER_WORKSPACE;
const T0 = Date.UTC(2026, 9, 1);

function harness({ workspaces = { acme: [] }, states = {}, failRead = new Set(), failWorkspace = new Set(), extra = {} } = {}) {
  const reads = [];
  const closes = [];
  const logs = [];
  let clock = T0;
  const candidatesOf = (urlKey) => {
    const items = workspaces[urlKey];
    return {
      rows: items.filter(i => i.kind !== 'scan' && i.kind !== 'dec').map((i, n) => ({ loopId: `${i.id}-row`, issueIdentifier: i.id, issueId: `iid-${i.id}`, issueSource: null })),
      loopDecisions: items.filter(i => i.kind === 'dec').map(i => ({ loopId: `${i.id}-l`, decisionId: 'd', issueIdentifier: i.id, issueId: null, issueSource: null })),
      scanDecisions: items.filter(i => i.kind === 'scan').map(i => ({ id: `${i.id}-s`, issueIdentifier: i.id, issueId: `iid-${i.id}`, issueSource: null })),
      settled: [], unverified: []
    };
  };
  const run = createTicketCloseSweepRun({
    dispatchStore: { listObservedWorkspaceKeys: async () => Object.keys(workspaces) },
    taskDecisionsStore: { listUnansweredForWorkspaces: async () => [], listNewestScanPerTask: async () => ({}) },
    agentStatusStore: {},
    readTicketState: async (urlKey, identifier) => {
      reads.push(`${urlKey}/${identifier}`);
      if (failRead.has(identifier)) throw new Error('provider down');
      return states[identifier] === undefined ? { issueId: `iid-${identifier}`, stateType: 'started' } : states[identifier];
    },
    intervalMs: 600000,
    now: () => clock,
    getLoops: async (urlKey) => {
      if (failWorkspace.has(urlKey)) throw new Error('mongo down');
      return workspaces[urlKey].map((i, n) => ({ _ws: urlKey, loopId: `${i.id}-row`, dispatchedAt: new Date(T0 - 1e7 - n * 1000).toISOString() }));
    },
    prepare: async ({ loops }) => candidatesOf(loops[0]._ws),
    closeRows: async (a) => { closes.push(a.ticket); return { closedRows: 1, withdrawn: 0, resolved: 0, refused: 0, failures: 0 }; },
    log: (m) => logs.push(m),
    ...extra
  });
  return { run, reads, closes, logs, tick: (ms = 600000) => { clock += ms; } };
}
const tickets = (n, prefix = 'T') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

describe('ticket-close-sweep (LIN-3366)', () => {
  test('requires its deps and a positive interval', () => {
    assert.throws(() => createTicketCloseSweepRun({ intervalMs: 0 }), /positive intervalMs/);
    assert.throws(() => createTicketCloseSweepRun({ intervalMs: 1 }), /required/);
  });

  test('one read per ticket per tick (a ticket with a row, a loop decision and a scan decision is read once)', async () => {
    const h = harness({ workspaces: { acme: [{ id: 'A' }, { id: 'A', kind: 'dec' }, { id: 'A', kind: 'scan' }] }, states: { A: { issueId: 'iid-A', stateType: 'completed' } } });
    await h.run();
    assert.deepEqual(h.reads, ['acme/A']);
    assert.deepEqual(h.closes, [{ issueId: 'iid-A', identifier: 'A', stateType: 'completed' }]);
  });

  test('only a TERMINAL ticket reaches the closer', async () => {
    const h = harness({ workspaces: { acme: [{ id: 'OPEN' }, { id: 'DUP' }, { id: 'CXL' }] }, states: {
      OPEN: { issueId: 'i', stateType: 'started' }, DUP: { issueId: 'i2', stateType: 'duplicate' }, CXL: { issueId: 'i3', stateType: 'canceled' } } });
    await h.run();
    assert.deepEqual(h.closes.map(c => c.identifier).sort(), ['CXL', 'DUP']);
  });

  test('a failed or null ticket read closes nothing and does not stop other tickets', async () => {
    const h = harness({ workspaces: { acme: [{ id: 'BAD' }, { id: 'NULL' }, { id: 'GOOD' }] }, failRead: new Set(['BAD']), states: {
      NULL: null, GOOD: { issueId: 'iid-GOOD', stateType: 'completed' } } });
    await h.run();
    assert.deepEqual(h.closes.map(c => c.identifier), ['GOOD']);
    assert.ok(h.logs.some(l => /ticket read failure for BAD/.test(l)));
  });

  test('a failed workspace does not stop other workspaces', async () => {
    const h = harness({ workspaces: { bad: [{ id: 'X' }], good: [{ id: 'Y' }] }, failWorkspace: new Set(['bad']), states: { Y: { issueId: 'iid-Y', stateType: 'completed' } } });
    const totals = await h.run();
    assert.deepEqual(h.closes.map(c => c.identifier), ['Y']);
    assert.ok(h.logs.some(l => /workspace bad failed/.test(l)));
    assert.equal(totals.failures, 1);
  });

  test('a closer that throws is a failure for that ticket only', async () => {
    let n = 0;
    const h = harness({ workspaces: { acme: [{ id: 'A' }, { id: 'B' }] }, states: { A: { issueId: 'a', stateType: 'completed' }, B: { issueId: 'b', stateType: 'completed' } },
      extra: { closeRows: async () => { n += 1; if (n === 1) throw new Error('boom'); return { closedRows: 1 }; } } });
    const t = await h.run();
    assert.equal(t.failures, 1);
    assert.equal(t.closedRows, 1);
  });

  test('reads are capped per workspace per tick', async () => {
    const h = harness({ workspaces: { acme: tickets(CAP + 15) } });
    await h.run();
    assert.equal(h.reads.length, CAP);
  });

  test('ROTATION WITNESS: with 3x cap non-terminal candidates and one terminal ticket last in the old (oldest-first) order, it is read within 3 ticks', async () => {
    const items = [...tickets(CAP * 3 - 1), { id: 'TERMINAL' }]; // TERMINAL has the newest activity => last in oldest-first order
    const h = harness({ workspaces: { acme: items }, states: { TERMINAL: { issueId: 'iid-TERMINAL', stateType: 'completed' } } });
    for (let i = 0; i < 3; i += 1) { await h.run(); h.tick(); }
    assert.ok(h.reads.includes('acme/TERMINAL'), 'read within ceil(N/cap) ticks');
    assert.deepEqual(h.closes.map(c => c.identifier), ['TERMINAL']);
    // every candidate was read exactly once across the three ticks (least-recently-read, never-read first)
    assert.equal(new Set(h.reads).size, items.length);
  });

  test('settled items never occupy a read slot: N reversed decisions above the cap leave room for a newer terminal ticket on tick 1', async () => {
    // Settled items are removed in phase one, so the sweep sees only `rows` etc. Model that: prepare returns a settled pile plus one candidate.
    const h = harness({ workspaces: { acme: [{ id: 'NEW' }] }, states: { NEW: { issueId: 'iid-NEW', stateType: 'completed' } },
      extra: { prepare: async () => ({
        rows: [{ loopId: 'new-row', issueIdentifier: 'NEW', issueId: 'iid-NEW', issueSource: null }], loopDecisions: [], scanDecisions: [],
        settled: Array.from({ length: CAP * 2 }, (_, i) => ({ type: 'loopDecision', loopId: `r${i}`, issueIdentifier: `OLD${i}` })), unverified: []
      }) } });
    await h.run();
    assert.deepEqual(h.reads, ['acme/NEW'], 'no read spent on a settled item');
    assert.equal(h.closes.length, 1);
  });

  test('the loop-card source is passed to the ticket read (kind-only routing)', async () => {
    const seen = [];
    const h = harness({ workspaces: { acme: [{ id: 'A' }] }, extra: {
      readTicketState: async (k, id, opts) => { seen.push(opts); return null; },
      prepare: async () => ({ rows: [{ loopId: 'a', issueIdentifier: 'A', issueId: 'i', issueSource: 'jira' }], loopDecisions: [], scanDecisions: [], settled: [], unverified: [] })
    } });
    await h.run();
    assert.deepEqual(seen, [{ source: 'jira' }]);
  });

  test('the closer receives the already-prepared candidates (no second prepare), and an empty roster is a no-op', async () => {
    const seen = [];
    const h = harness({ workspaces: { acme: [{ id: 'A' }] }, states: { A: { issueId: 'iid-A', stateType: 'completed' } }, extra: {
      closeRows: async (a) => { seen.push(a.candidates); return {}; } } });
    await h.run();
    assert.equal(seen.length, 1);
    assert.ok(Array.isArray(seen[0].rows));
    const empty = harness({ workspaces: {} });
    assert.equal((await empty.run()).workspaces, 0);
  });
});
