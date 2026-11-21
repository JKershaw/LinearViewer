/**
 * LIN-4517 (slice 3 P4): the one-off verdict import (scripts/records/slice-3-verdict-import.mjs) on a real MangoDB
 * records store, through the real checked writer (lib/records/writes.js), P3's pin and P2's one refresh. The selection is
 * the cutover query's own (docs/reviews/slice-3-readings/cutover-query.mjs): the same dump, tickets and readers.
 *
 * Seeds, one ticket each (PRs are example/repo#<n>):
 *   LIN-1  review Approve at head A1 on PR 11; the PR has since moved to A2   → change, verdict on the A1 version, stale
 *   LIN-2  plan review "Request changes"; the plan record is slice 2's import → verdict on plan@1, no change
 *   LIN-3  review "Approve — conditional" with two itemised conditions, PR 13
 *          still at the head the judge read                                  → two condition findings first, then approve
 *   LIN-4  review whose verdict does not parse                               → skipped and listed, nothing written
 *   LIN-5  review on a two-PR landing whose ledger lists bold items that
 *          isEmptyStatement reads as empty                                   → ledger findings; the verdict is skipped
 *   LIN-6  review Approve on PR 16, merged at the head the judge read        → change ended merged, verdict not stale
 *   LIN-7  "Approve — conditional" with no itemised conditions, the task
 *          already holding an open finding to close-out                      → no new finding; noted
 *   LIN-8  review "Request changes" on PR 18, closed unmerged                → change ended abandoned
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { dumpFromStore } from '../../docs/reviews/slice-3-readings/cutover-query.mjs';
import {
  loadLib, loadReaders, writesFor, selectionOf, factsOf, resolveHeads, writesPlanOf, applyImport, applyGuard, conditionItemsOf, outcomeOf,
} from '../../scripts/records/slice-3-verdict-import.mjs';

const URL_KEY = 'lin-4517-import';
const SCRIPT = fileURLToPath(new URL('../../scripts/records/slice-3-verdict-import.mjs', import.meta.url));
const harness = createMangoTmpdir('lin-4517-import-');
const BASE = Date.UTC(2026, 10, 21, 12, 0);
const iso = (minutes) => new Date(BASE + minutes * 60000).toISOString();
const shape = (kind, fields = {}, extra = {}) => ({ kind, state: 'open', fields, links: {}, ...extra });
const pr = (n) => `https://github.com/example/repo/pull/${n}`;
const sha = (c) => c.repeat(40);

// The heads: what each judge read, and where each PR is now.
const A1 = sha('a'); const A2 = sha('b'); const C1 = sha('c'); const M1 = sha('d'); const X1 = sha('e');
const COMMITS = { 11: [A1, A2], 13: [C1], 16: [M1], 18: [X1] };
const LIVE = {
  11: { readable: true, state: 'open', merged: false, head: { sha: A2 } },
  13: { readable: true, state: 'open', merged: false, head: { sha: C1 } },
  16: { readable: true, state: 'closed', merged: true, head: { sha: M1 } },
  18: { readable: true, state: 'closed', merged: false, head: { sha: X1 } },
};
const readPrStatus = async ({ number }) => LIVE[number] ?? { readable: false };
const resolveHead = async ({ number, sha: short }) => {
  const hits = (COMMITS[number] || []).filter((s) => s.startsWith(short));
  return hits.length === 1 ? hits[0] : null;
};

const review = ({ verdict, head, prs = [], ledger = 'None.', after = '' }) => [
  '## Code Review: the change', '',
  `Reviewed at head \`${head}\`. ${prs.map(pr).join(' ')}`, '',
  verdict ? `**Verdict: ${verdict}**` : 'Read it all.', '',
  after,
  '### What CI Did Not Prove', '', ledger, '',
].join('\n');
const planReview = '## Plan Review Verdict\n\n**Verdict: Request changes**\n\nThe plan leaves out the migration.';
const CONDITIONS = '- Close-out reruns the migration on a copy of the store.\n- Close-out adds the rollback note to the runbook.\n';
const MISREAD = '**L1 — The import was checked by hand on staging; no open questions about its ids.**\n\n**L2 — The rollback was not exercised.**\n\n**Ledger status: no item is a close-out gate.**';
const comment = (id, body, minutes) => ({ id, body, createdAt: iso(minutes) });

const COMMENTS = {
  'LIN-1': [comment('c1', review({ verdict: 'Approve', head: A1.slice(0, 9), prs: [11] }), -100)],
  'LIN-2': [comment('c2', planReview, -100)],
  'LIN-3': [comment('c3', review({ verdict: 'Approve — conditional', head: C1.slice(0, 9), prs: [13], after: CONDITIONS }), -100)],
  'LIN-4': [comment('c4', review({ verdict: null, head: A1.slice(0, 9), prs: [14] }), -100)],
  'LIN-5': [comment('c5', review({ verdict: 'Approve', head: A1.slice(0, 9), prs: [15, 19], ledger: MISREAD }), -100)],
  'LIN-6': [comment('c6', review({ verdict: 'Approve', head: M1, prs: [16] }), -100)],
  'LIN-7': [comment('c7', review({ verdict: 'Approve — conditional on close-out settling the findings', head: C1.slice(0, 9), prs: [13] }), -100)],
  'LIN-8': [comment('c8', review({ verdict: 'Request changes', head: X1.slice(0, 9), prs: [18] }), -100)],
};

let store; let records; let lib; let readers; let writes;
let ids; let dump; let reading; let selection; let capture; let planned;
let dry; let first; let second;
let docsBeforeDry; let docsAfterDry; let docsAfterFirst; let docsAfterSecond;

const allDocs = () => records.find({ urlKey: URL_KEY }).toArray();

async function seed() {
  const db = harness.freshDb();
  records = db.collection(RECORDS_COLLECTION);
  store = new RecordsStore({ records, refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  const out = {};
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    out[n] = (await store.add(URL_KEY, shape('task', { ref: `LIN-${n}`, asked: `Task ${n}.` }), { by: 'import', at: iso(-1000) })).id;
  }
  // LIN-2: the plan slice 2 imported from the plan text, after the plan review read it.
  out.plan = (await store.add(URL_KEY, shape('plan', { says: 'The plan.' }, { state: 'kept', in: out[2], to: 'implementation' }), { by: 'import', via: 'import', at: iso(-10) })).id;
  // LIN-7: an open finding to close-out the conditional approval rests on.
  out.openFinding = (await store.add(URL_KEY, shape('finding', { says: 'Settle the backfill.' }, { to: 'close-out', in: out[7] }), { by: 'review', at: iso(-120) })).id;
  return out;
}

async function buildPlan() {
  dump = await dumpFromStore({ store, urlKey: URL_KEY, asOf: iso(0) });
  const tickets = new Map(Object.entries(COMMENTS).map(([ticket, comments]) => [ticket, { state: 'started', comments }]));
  reading = readers.cutoverReading({ dump, tickets, readers });
  selection = selectionOf(reading);
  const tasks = [];
  for (const selected of selection) {
    const facts = factsOf({ selected, comments: tickets.get(selected.ticket).comments, plans: dump.plans.filter((p) => p.in === selected.task), readers });
    tasks.push(await resolveHeads(facts, { resolveHead, prRefOf: lib.prRefOf }));
  }
  capture = { asOf: dump.asOf, tasks };
  planned = writesPlanOf(capture, lib);
}

const run = (write) => applyImport({ plan: planned, lib, writes, recordsStore: store, urlKey: URL_KEY, readPrStatus, write });
const rowOf = (result, ticket) => result.tasks.find((t) => t.ticket === ticket);
const current = (id) => store.current(URL_KEY, id);
// The view as it stands now: the apply writes at the wall clock, so a fixture instant would read before its writes
// (CI's clock-shift arm, LIN-3949).
const viewOfId = async (id) => store.viewOfRecord(URL_KEY, await current(id));
const versions = async (id) => (await store.versionsOf(URL_KEY, [id])).sort((a, b) => a.v - b.v);

before(async () => {
  await harness.connect();
  lib = await loadLib();
  readers = await loadReaders();
  ids = await seed();
  writes = writesFor(lib, store);
  await buildPlan();
  docsBeforeDry = (await allDocs()).length;
  dry = await run(false);
  docsAfterDry = (await allDocs()).length;
  first = await run(true);
  docsAfterFirst = (await allDocs()).length;
  second = await run(true);
  docsAfterSecond = (await allDocs()).length;
});
after(() => harness.close());

describe('LIN-4517 import: the selection is the cutover query\'s', () => {
  test('every task the reading lists as needing an import or a re-review, and no other', () => {
    assert.deepEqual(selection.map((s) => s.ticket), reading.needsImportOrReReview.tasks.map((t) => t.ticket));
    assert.deepEqual(selection.map((s) => s.ticket), ['LIN-1', 'LIN-2', 'LIN-3', 'LIN-4', 'LIN-5', 'LIN-6', 'LIN-7', 'LIN-8']);
    assert.deepEqual(selection.find((s) => s.ticket === 'LIN-5').ledger, true);
  });

  test('the readers: conditions are the verdict section\'s items; outcomes map, and an unknown verdict maps to none', () => {
    assert.deepEqual(conditionItemsOf(COMMENTS['LIN-3'][0].body).length, 2);
    assert.deepEqual(conditionItemsOf(COMMENTS['LIN-7'][0].body), []);
    assert.equal(outcomeOf('plan-review', 'request changes'), 'request-changes');
    assert.equal(outcomeOf('review', 'approve-conditional'), 'approve');
    assert.equal(outcomeOf('review', 'unknown'), null);
  });
});

describe('LIN-4517 import: the dry run', () => {
  test('writes nothing and plans by id', () => {
    assert.equal(dry.mode, 'dry-run');
    assert.equal(docsAfterDry, docsBeforeDry);
    assert.deepEqual(dry.counts.verdicts, { 'would-add': 6 });
    assert.deepEqual(dry.counts.changes, { 'would-add': 5 });
    assert.deepEqual(dry.counts.findings, { 'would-add': 4 });
  });

  test('prints counts and ids only: no PR URL and no comment text', () => {
    const out = JSON.stringify(dry);
    assert.ok(!out.includes('github.com'));
    assert.ok(!out.includes('rollback'));
  });
});

describe('LIN-4517 import: the apply', () => {
  test('changes first, then findings, then verdicts: each verdict\'s change was written before it', async () => {
    const docs = await allDocs();
    const firstIndex = (id) => docs.findIndex((d) => d.id === id);
    for (const t of first.tasks) {
      for (const v of t.verdicts.filter((x) => x.action === 'added')) {
        for (const c of t.changes) assert.ok(firstIndex(c.id) < firstIndex(v.id), `${t.ticket}: change ${c.id} before verdict ${v.id}`);
        for (const f of t.findings.filter((x) => x.action === 'added')) assert.ok(firstIndex(f.id) < firstIndex(v.id), `${t.ticket}: finding ${f.id} before verdict ${v.id}`);
      }
    }
  });

  test('verdicts are via: import, by import, filed in their task, with the judged outcome', async () => {
    assert.deepEqual(first.counts.verdicts, { added: 6 });
    for (const t of first.tasks) {
      for (const v of t.verdicts) {
        const [v1] = await versions(v.id);
        assert.equal(v1.via, 'import');
        assert.equal(v1.by, 'import');
        assert.equal(v1.in, t.task);
      }
    }
    const one = await current(rowOf(first, 'LIN-1').verdicts[0].id);
    assert.equal(one.fields.outcome, 'approve');
    assert.equal(one.fields.judgement, 'review');
    assert.match(one.fields.reasoning, /comment c1/);
  });

  test('the pin: the verdict rests on the change version holding the head the comment states, in full', async () => {
    const row = rowOf(first, 'LIN-1');
    const verdict = await current(row.verdicts[0].id);
    const [ref] = verdict.links.on;
    const [id, v] = ref.split('@');
    assert.equal(id, row.changes[0].id);
    const pinned = (await versions(id)).find((s) => s.v === Number(v));
    assert.equal(pinned.fields.head, A1);
  });

  test('a push the judge never saw shows stale (LIN-1); a PR still at the judged head does not (LIN-3)', async () => {
    assert.ok((await viewOfId(rowOf(first, 'LIN-1').verdicts[0].id)).flags?.stale?.length, 'LIN-1: PR 11 moved from A1 to A2');
    assert.equal((await viewOfId(rowOf(first, 'LIN-3').verdicts[0].id)).flags?.stale, undefined);
    assert.equal((await current(rowOf(first, 'LIN-1').changes[0].id)).fields.head, A2, 'the refresh set the live head');
  });

  test('a plan review rests on the plan slice 2 imported, with no change', async () => {
    const row = rowOf(first, 'LIN-2');
    assert.deepEqual(row.changes, []);
    const verdict = await current(row.verdicts[0].id);
    assert.deepEqual(verdict.links.on, [`${ids.plan}@1`]);
    assert.equal(verdict.fields.outcome, 'request-changes');
    assert.equal(verdict.fields.judgement, 'plan-review');
  });

  test('"Approve — conditional" is approve plus one finding to close-out per condition, about the change', async () => {
    const row = rowOf(first, 'LIN-3');
    assert.equal((await current(row.verdicts[0].id)).fields.outcome, 'approve');
    const conditions = row.findings.filter((f) => f.kind === 'condition');
    assert.equal(conditions.length, 2);
    for (const f of conditions) {
      const rec = await current(f.id);
      assert.equal(rec.to, 'close-out');
      assert.equal(rec.in, row.task);
      assert.equal(rec.state, 'open');
      assert.deepEqual(rec.links.about, [row.changes[0].id]);
      assert.equal((await versions(f.id))[0].via, 'import');
    }
  });

  test('a conditional approval with no itemised conditions rests on the task\'s open findings: none added (LIN-7)', async () => {
    const row = rowOf(first, 'LIN-7');
    assert.deepEqual(row.findings, []);
    assert.equal(row.notes.length, 1);
    assert.match(row.notes[0], /1 open finding/);
  });

  test('an unknown verdict is skipped and listed, never guessed (LIN-4)', async () => {
    const row = rowOf(first, 'LIN-4');
    assert.deepEqual(row.verdicts, []);
    assert.deepEqual(row.changes, []);
    assert.deepEqual(row.skipped.map((s) => [s.stage, s.why]), [['review', "its verdict does not parse ('unknown')"]]);
  });

  test('the ledger isEmptyStatement reads as empty: its items become findings to close-out, the status line does not (LIN-5)', async () => {
    const row = rowOf(first, 'LIN-5');
    const ledger = row.findings.filter((f) => f.kind === 'ledger');
    assert.equal(ledger.length, 2);
    for (const f of ledger) assert.equal((await current(f.id)).to, 'close-out');
    assert.deepEqual(row.skipped.map((s) => s.why), ['its landing holds 2 PRs and the comment states one head']);
    assert.deepEqual(row.verdicts, []);
  });

  test('a merged PR\'s change ends merged at the judged head, the verdict not stale; a closed one ends abandoned', async () => {
    const merged = rowOf(first, 'LIN-6');
    const change = await current(merged.changes[0].id);
    assert.equal(change.state, 'merged');
    assert.equal(change.fields.head, M1);
    assert.equal((await viewOfId(merged.verdicts[0].id)).flags?.stale, undefined);
    assert.deepEqual(merged.refreshed, [{ id: change.id, ended: 'merged' }]);
    const closed = rowOf(first, 'LIN-8');
    assert.equal((await current(closed.changes[0].id)).state, 'abandoned');
  });

  test('a change uses the backstop\'s own id rule, so the backstop and the import agree on one change per PR', () => {
    const row = rowOf(first, 'LIN-6');
    assert.equal(row.changes[0].id, lib.fixedIdOf('change', row.task, lib.changeKeyOf(pr(16))));
  });
});

describe('LIN-4517 import: idempotent by fixedIdOf', () => {
  test('a second run writes nothing: every record is found as the first run made it', () => {
    assert.equal(docsAfterSecond, docsAfterFirst);
    assert.deepEqual(second.counts.verdicts, { exists: 6 });
    assert.deepEqual(second.counts.findings, { exists: 4 });
    assert.deepEqual(second.counts.changes, { exists: 5 });
  });
});

describe('LIN-4517 import: --apply needs the explicit guard', () => {
  test('refused anywhere but harbour-cat in production or an explicit --store with its workspace', () => {
    assert.ok(applyGuard({ argv: ['apply', '--apply'], env: {} }).refused);
    assert.ok(applyGuard({ argv: ['apply'], env: {} }).refused, 'a dry run needs a store too');
    assert.ok(applyGuard({ argv: ['apply', '--apply'], env: { RAILWAY_SERVICE_NAME: 'harbour-cat', RAILWAY_ENVIRONMENT_NAME: 'staging', MONGODB_URI: 'x' }, exists: () => true }).refused);
    assert.ok(applyGuard({ argv: ['apply', '--apply', '--store', '/tmp/x'], env: {} }).refused, '--store needs --url-key');
    assert.deepEqual(applyGuard({ argv: ['apply', '--apply', '--store', '/tmp/x', '--url-key', 'k'], env: {} }), { write: true, store: '/tmp/x' });
    assert.deepEqual(applyGuard({ argv: ['apply'], env: { RAILWAY_SERVICE_NAME: 'harbour-cat', RAILWAY_ENVIRONMENT_NAME: 'production', MONGODB_URI: 'x' }, exists: () => true }), { write: false, production: true });
  });

  test('the command line refuses --apply without the guard, before reading anything', () => {
    const env = { PATH: process.env.PATH };
    const res = spawnSync(process.execPath, [SCRIPT, 'apply', '--apply'], { env, input: '{"tasks": []}', encoding: 'utf8' });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /^refused: apply runs only inside harbour-cat in production/);
    assert.equal(res.stdout, '');
  });
});
