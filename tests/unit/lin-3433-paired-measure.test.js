/**
 * LIN-3433 (slice I of LIN-3358): the paired measure in scripts/false-live-rows.js.
 * Real MangoDB tmpdir for history; sessions.json, loops and ticket state injected.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import {
  runFalseLiveRows, runnerMeasure, postsAfterEnd, withoutTicketClosedStamp, readRunnerSessions, RUNNER_ACTIVE_BOUND_MS
} from '../../scripts/false-live-rows.js';
import { closeTicketRows } from '../../lib/ticket-close-closer.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { getLoopsForWorkspace } from '../../lib/pipeline-loops.js';

const NOW = Date.UTC(2026, 9, 1);
const ago = (days, min = 0) => new Date(NOW - days * 86400000 + min * 60000);
const msAgo = (min) => NOW - min * 60000;

describe('paired measure (LIN-3433)', () => {
  let dbDir, client, store, history, counter = 0;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'paired-3433-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    const db = client.db(`p_${counter++}`);
    history = db.collection('dispatch-history');
    store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
    store._notifyWriteForDoc = () => {};
  });

  const seed = (id, o = {}) => history.insertOne({
    _id: id, urlKey: 'acme', issueIdentifier: 'LIN-1', rootItemId: id, kind: 'implementation', status: 'taken',
    dispatchedAt: ago(2, 1), resolvedAt: ago(2, 2), followUpTo: null, feedback: [], bookkeeping: null, ...o
  });
  const states = { 'LIN-DONE': { issueId: 'i1', stateType: 'completed' }, 'LIN-CXL': { issueId: 'i2', stateType: 'canceled' }, 'LIN-OPEN': { issueId: 'i3', stateType: 'started' } };
  const sess = (phase, ageMin, issue, extra = {}) => ({
    phase, updatedAt: msAgo(ageMin), itemMetadata: { ...(issue ? { issueIdentifier: issue } : {}), workspaceKey: 'acme' }, ...extra
  });
  const sessionsFile = (sessions) => {
    const p = join(dbDir, `sessions-${counter}.json`);
    writeFileSync(p, JSON.stringify({ sessions }));
    return p;
  };
  const run = (o = {}) => runFalseLiveRows({
    dispatchStore: store, urlKeys: ['acme'], now: NOW,
    readLoops: async () => [], readTicketState: async (_k, issue) => states[issue] ?? null, ...o
  });
  const w = (r) => r.perWorkspace[0];
  const head = (r) => r.report.split('\n')[0];
  const blockedLoop = (loopId, issueIdentifier, extra = {}) => ({ loopId, issueIdentifier, terminalStatus: null, wakeMarker: 'blocked', agentState: null, historyStatus: 'taken', source: 'history', bookkeeping: null, ...extra });

  describe('posts after the end', () => {
    test('F1: lineage-terminal-stamped and own-[done] rows that still receive [stalled?] are counted; a quiet ended row is not', async () => {
      await seed('P', { feedback: [{ message: '[done] ok', timestamp: ago(2, 30) }, { message: '[stalled?] no heartbeat', timestamp: ago(1) }] });
      await seed('S', { rootItemId: 'Q', bookkeeping: { at: ago(2, 40), by: 'x', reason: 'lineage-terminal' }, feedback: [{ message: '[stalled?] x', timestamp: ago(1) }, { message: '[stalled?] y', timestamp: ago(1, 10) }] });
      await seed('quiet', { rootItemId: 'R', feedback: [{ message: '[done] ok', timestamp: ago(2, 30) }] });
      await seed('live', { rootItemId: 'T', feedback: [{ message: 'hb', timestamp: ago(1) }] }); // never ended: not this measure
      const r = await run();
      assert.deepEqual(w(r).postsAfterEnd.rows.sort(), ['P', 'S']);
      assert.equal(w(r).postsAfterEnd.entries, 3);
      assert.match(r.report, /5 feedback posted after a row's own terminal\/stamp +2 +\[3 entries\]/);
    });

    test('decision-lifecycle stamp entries Harbour appends after the end are not a writer', () => {
      const rows = [{ _id: 'a', feedback: [
        { message: '[done] ok', timestamp: ago(2) },
        { kind: 'decision-withdrawn', message: '{}', timestamp: ago(1) },
        { kind: 'decision-withdrawal-reversed', message: '{}', timestamp: ago(1, 5) },
        { kind: 'decision-answer', message: '{}', timestamp: ago(1, 6) }] }];
      assert.deepEqual(postsAfterEnd(rows), { rows: [], entries: 0 });
      rows[0].feedback.push({ message: '[stalled?] still here', timestamp: ago(1, 7) });
      assert.deepEqual(postsAfterEnd(rows), { rows: ['a'], entries: 1 });
    });

    test('a second [done] after a follow-up is a session ending twice, not a writer; entries after the LATEST end are', () => {
      const fb = [{ message: '[done] first', timestamp: ago(3) }, { message: '[working] Session resumed', timestamp: ago(2) }, { message: '[done] second', timestamp: ago(1) }];
      assert.deepEqual(postsAfterEnd([{ _id: 'a', feedback: fb }]), { rows: [], entries: 0 });
      assert.deepEqual(postsAfterEnd([{ _id: 'a', feedback: [...fb, { message: '[stalled?] x', timestamp: ago(0, 5) }] }]), { rows: ['a'], entries: 1 });
    });

    test('a [skipped] marker is not an end (isLineageClosingTerminal)', () => {
      assert.deepEqual(postsAfterEnd([{ _id: 'a', feedback: [{ message: '[skipped] no', timestamp: ago(2) }, { message: 'hb', timestamp: ago(1) }] }]), { rows: [], entries: 0 });
    });
  });

  describe('c3 with C\'s row stamp disabled', () => {
    test('F2: a ticket-closed-stamped row on a terminal ticket with a live writer counts in the headline c3; the stamp-honoured reading is 0', async () => {
      const stamped = blockedLoop('s1', 'LIN-DONE', { bookkeeping: { reason: 'ticket-closed', at: ago(1), by: 'ticket-closer' } });
      const r = await run({ readLoops: async () => [stamped] });
      assert.equal(w(r).clause3, 0, 'honoured: the stamp hides it');
      assert.equal(w(r).clause3NoStamp, 1);
      assert.match(head(r), /\(c1 0, c2 0, c3 1, c4 0\)/);
      assert.match(head(r), /false-live: 1 /);
      assert.match(r.report, /^ {2}acme\s+0 0 1 0 0$/m, 'the By workspace line shows the stamp-disabled c3');
    });

    test('only the ticket-closed stamp is disabled: handed-on and lineage-terminal stamps still resolve a row', async () => {
      const loops = [
        blockedLoop('h', 'LIN-DONE', { bookkeeping: { reason: 'handed-on' } }),
        blockedLoop('t', 'LIN-DONE', { bookkeeping: { reason: 'lineage-terminal' } }),
        blockedLoop('c', 'LIN-DONE', { bookkeeping: { reason: 'ticket-closed' } })
      ];
      const out = withoutTicketClosedStamp(loops);
      assert.deepEqual(out.map(l => l.bookkeeping?.reason ?? null), ['handed-on', 'lineage-terminal', null]);
      assert.equal(loops[2].bookkeeping.reason, 'ticket-closed', 'input not mutated');
      const r = await run({ readLoops: async () => loops });
      assert.equal(w(r).clause3NoStamp, 1);
    });

    test('writer/measurer: closeTicketRows takes the stamp-honoured c3 to 0 but the stamp-disabled c3 stays 1 (the stamp hides, it does not end)', async () => {
      const agentStatusStore = new AgentStatusStore({ collection: client.db('p_status').collection('s') });
      const mins = (m) => new Date(Date.now() - m * 60000);
      await history.insertOne({ _id: 'b1', urlKey: 'acme', issueIdentifier: 'LIN-1', issueId: 'iid-1', rootItemId: 'b1', kind: 'implementation', status: 'taken', dispatchedAt: mins(300), resolvedAt: mins(299), bookkeeping: null, feedback: [{ message: '[blocked] waiting', timestamp: mins(280) }] });
      const readLoops = () => getLoopsForWorkspace('acme', { lean: true, dispatchStore: store, agentStatusStore });
      const readTicketState = async () => ({ issueId: 'iid-1', stateType: 'completed' });
      const now = Date.now();
      const before = await runFalseLiveRows({ dispatchStore: store, urlKeys: ['acme'], now, readLoops, readTicketState });
      assert.deepEqual([w(before).clause3, w(before).clause3NoStamp], [1, 1]);
      await closeTicketRows({ urlKey: 'acme', ticket: { issueId: 'iid-1', identifier: 'LIN-1', stateType: 'completed' }, dispatchStore: store, agentStatusStore, now, log: () => {} });
      const after = await runFalseLiveRows({ dispatchStore: store, urlKeys: ['acme'], now, readLoops, readTicketState });
      assert.deepEqual([w(after).clause3, w(after).clause3NoStamp], [0, 1]);
    });
  });

  describe('runner-side zombies', () => {
    test('F3: a session that parks after the seam (BLOCKED / AWAITING_*) on a terminal ticket is arm (b); a parked session on an open ticket is not', async () => {
      const p = sessionsFile({
        b1: sess('BLOCKED', 3000, 'LIN-DONE'), b2: sess('AWAITING_EXTERNAL', 10, 'LIN-CXL'), b3: sess('AWAITING_FOLLOWUP', 10, 'LIN-DONE'),
        open: sess('BLOCKED', 3000, 'LIN-OPEN')
      });
      const r = await run({ sessionsPath: p });
      assert.equal(r.runner.parkedOnTerminal, 3);
      assert.match(r.report, /7 runner: parked sessions on a terminal ticket +3/);
    });

    test('F4: an active-phase session silent past the bound is arm (a); inside the bound, and non-active phases, are not', async () => {
      const p = sessionsFile({
        old: sess('EXECUTING', 120, 'LIN-DONE'), oldResuming: sess('RESUMING', 5000, 'LIN-OPEN'), ticketless: sess('EXECUTING', 9000),
        fresh: sess('EXECUTING', 5, 'LIN-DONE'),
        heartbeating: sess('EXECUTING', 5000, 'LIN-DONE', { heartbeat: { lastActivityAt: msAgo(2) } }),
        done: sess('COMPLETED', 9000, 'LIN-DONE')
      });
      const r = await run({ sessionsPath: p });
      assert.equal(r.runner.activeZombies, 3, 'ticket state does not decide arm (a): a ticketless orchestrator is one');
      assert.equal(r.runner.activeOnTerminalTicket, 1);
      assert.equal(r.runner.parkedOnTerminal, 0);
    });

    test('the bound is the SD STALL_FAILSAFE_MS default and is a parameter', async () => {
      assert.equal(RUNNER_ACTIVE_BOUND_MS, 3600000);
      const read = { ok: true, sessions: [{ id: 'x', ...sess('EXECUTING', 30, 'LIN-DONE') }] };
      const readTicket = async () => states['LIN-DONE'];
      assert.equal((await runnerMeasure({ read, now: NOW, readTicket })).activeZombies, 0);
      assert.equal((await runnerMeasure({ read, now: NOW, readTicket, boundMs: 20 * 60000 })).activeZombies, 1);
    });

    test('F5: a ticketless parked session is on the report-only line (count, age) and adds nothing to line 7, c1 or the headline', async () => {
      const p = sessionsFile({ n1: sess('BLOCKED', 60 * 24 * 3), n2: sess('BLOCKED', 60 * 24 * 1), t1: sess('BLOCKED', 10, 'LIN-DONE') });
      const r = await run({ sessionsPath: p });
      assert.deepEqual(r.runner.ticketlessParked, { count: 2, oldestAgeMs: 3 * 86400000 });
      assert.equal(r.runner.parkedOnTerminal, 1, 'only the ticketed one');
      assert.equal(w(r).clause1, 0);
      assert.match(r.report, /Report-only, no target, not in 7: parked sessions with no ticket: 2 \(oldest 72h\)/);
      assert.match(head(r), /false-live: 0 /);
    });

    test('an unreadable ticket makes a parked session unknown, never counted', async () => {
      const p = sessionsFile({ u: sess('BLOCKED', 3000, 'LIN-GONE'), ok: sess('BLOCKED', 3000, 'LIN-DONE') });
      const r = await run({ sessionsPath: p });
      assert.deepEqual([r.runner.parkedOnTerminal, r.runner.unknown], [1, 1]);
    });

    test('F6: sessions.json missing, unreadable or malformed reads UNKNOWN in the headline and detail, not 0', async () => {
      const bad = join(dbDir, 'bad.json');
      writeFileSync(bad, '{not json');
      for (const sessionsPath of [join(dbDir, 'absent.json'), bad, null]) {
        const r = await run({ sessionsPath });
        assert.equal(r.runner.read, false);
        assert.match(r.report, /runner unknown: sessions\.json not read \| runner active zombies: unknown \| parked on terminal tickets: unknown/);
        assert.match(r.report, /6, 7 runner: UNKNOWN .* this is not a zero/);
        assert.doesNotMatch(r.report, /runner active zombies: 0/);
      }
      assert.equal(readRunnerSessions(join(dbDir, 'absent.json')).reason, 'ENOENT');
    });

    test('the report states that only this host\'s sessions.json is read', async () => {
      const r = await run({ sessionsPath: sessionsFile({}) });
      assert.match(r.report, /only THIS host's sessions\.json is read/);
    });
  });

  test('F7: clean board with a readable, empty sessions.json: every measure 0, false closes 0', async () => {
    const r = await run({ sessionsPath: sessionsFile({}) });
    assert.equal(head(r), '# False live rows — unknown: 0 | false-live: 0 (c1 0, c2 0, c3 0, c4 0) | false closes: 0');
    assert.match(r.report.split('\n')[1], /^Paired measure \(target 0 each\) — runner unknown: 0 \| runner active zombies: 0 \| parked on terminal tickets: 0 \| posts after the end: 0 rows$/);
    assert.deepEqual([w(r).postsAfterEnd.rows.length, w(r).clause3NoStamp], [0, 0]);
  });

  test('the measure writes nothing', async () => {
    await seed('P', { feedback: [{ message: '[done] ok', timestamp: ago(2, 30) }, { message: '[stalled?] x', timestamp: ago(1) }] });
    const snap = JSON.stringify(await history.find({}).sort({ _id: 1 }).toArray());
    await run({ sessionsPath: sessionsFile({ a: sess('BLOCKED', 99, 'LIN-DONE') }), readLoops: async () => [blockedLoop('s1', 'LIN-DONE', { bookkeeping: { reason: 'ticket-closed' } })] });
    assert.equal(JSON.stringify(await history.find({}).sort({ _id: 1 }).toArray()), snap);
  });
});
