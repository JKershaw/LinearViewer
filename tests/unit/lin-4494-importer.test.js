/**
 * LIN-4494 (piece 3): the one-off importer and the parked-ticket manifest, proven on a temporary store.
 *
 * The notes are the committed baseline fixtures (tests/fixtures/records-import/baseline-bf2d1575f, the `## Waiting`
 * sections of bf2d1575f), so the test runs on a shallow checkout where that commit is not present (.github/workflows
 * checks out at depth 1).
 *
 * Witnesses: the counts come from the notes, not from a constant (117 bullets in 12 notes; 7 Security Review entries in
 * 5 notes at the baseline); each entry becomes a finding to the project, its note kept in `how`; the Security entries
 * become tasks under one parent and are not also findings; a malformed entry is reported and written nowhere; a
 * second apply adds nothing, including after an imported record has ended; the manifest's tasks are claimed for their
 * tickets and its findings hang under them.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { planImport as planWith, readWaiting, SECURITY_PARENT_ID } from '../../lib/records/waiting-import.js';
import { citedPaths } from '../../lib/prompts/area-note-format.js';
import { parseWaitingSection } from '../../lib/records/waiting-import.js';
import { applyWrites, waitingItems, applyManifest, manifestItems } from '../../lib/records/import-apply.js';
import { ticketTaskIdOf } from '../../lib/records/refs.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';

const URL_KEY = 'lin-4494-import';
const NOTE_READER = { parseNote: parseWaitingSection, citedPaths };
const planImport = (notes, opts = {}) => planWith(notes, { ...opts, ...NOTE_READER });
const FIXTURES = new URL('../fixtures/records-import/baseline-bf2d1575f/', import.meta.url);
const MANIFEST = new URL('../../scripts/records/parked-tickets.json', import.meta.url);
const harness = createMangoTmpdir('lin-4494-import-');
let store;
let writes;

before(() => harness.connect());
after(() => harness.close());

beforeEach(async () => {
  const db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  writes = createRecordWrites({
    recordsStore: store,
    isTerminalState,
    stageKinds: Object.keys(STAGE_KINDS),
    // The workspace person the manifest names by id (LIN-4496). The name is a placeholder: a manifest addressed to 'John' does not resolve.
    listPeople: async () => [{ accountId: 'e7e948a4-2951-4af4-b60e-572a473a491e', name: 'Placeholder Person' }],
  });
});

const baselineNotes = () => readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((f) => ({ note: f.replace(/\.md$/, ''), markdown: readFileSync(new URL(f, FIXTURES), 'utf8') }));

describe('the Waiting entries at the baseline', () => {
  test('the counts come from the notes: 117 bullets in 12 notes, 7 security entries in 5 notes, none malformed', () => {
    const plan = planImport(baselineNotes(), { ref: 'bf2d1575f' });
    assert.equal(plan.totals.notes, 12);
    assert.equal(plan.totals.notesWithWaiting, 12);
    assert.equal(plan.totals.bullets, 117);
    assert.equal(plan.totals.security, 7);
    assert.equal(plan.totals.securityNotes, 5);
    assert.equal(plan.totals.findings, 110);
    assert.equal(plan.totals.malformed, 0);
  });

  test('a wrapped attribution is read: the security entry on a second line is found', () => {
    const parsed = readWaiting('## Waiting\n\n- `lib/x.js` — a long entry that wraps\n  Security Review (LIN-1, 1 Nov.)\n\n## Next\n', NOTE_READER);
    assert.equal(parsed.entries.length, 1);
    assert.match(parsed.entries[0].text, /Security Review \(LIN-1, 1 Nov\.\)$/);
    assert.equal(planImport([{ note: 'x', markdown: '## Waiting\n\n- `lib/x.js` — wraps\n  Security Review\n' }]).totals.security, 1);
  });

  test('a malformed entry is reported with its place in the list and never written', () => {
    const plan = planImport([{ note: 'x', markdown: '## Waiting\n\n- no path here, just words\n- `lib/ok.js` — fine\n- \n' }]);
    assert.equal(plan.totals.malformed, 2);
    assert.equal(plan.totals.entries, 1);
    assert.equal(plan.perNote[0].malformed[0].entry, 1);
    assert.match(plan.perNote[0].malformed[0].why, /cites no file/);
  });

  test('a note with no Waiting section is present:false, and its absence is not an error', () => {
    assert.throws(() => planWith([], {}), /needs a parseNote function and citedPaths/, 'the cited-path predicate is never guessed');
    // The Waiting reader defaults to this module's own (LIN-4495): a caller passes only the cited-path predicate.
    const dflt = planWith([{ note: 'x', markdown: '## Waiting\n\n- `lib/ok.js` — fine\n' }], { citedPaths });
    assert.equal(dflt.totals.entries, 1);
    assert.equal(readWaiting('# Notes\n\n## Lessons\n- x\n', NOTE_READER).present, false);
  });
});

describe('applying the import to a temporary store', () => {
  test('a dry run writes nothing and reports what it would write', async () => {
    const plan = planImport(baselineNotes(), { ref: 'bf2d1575f' });
    const report = await applyWrites({ writes, recordsStore: store, urlKey: URL_KEY, apply: false, items: waitingItems(plan, { ref: 'bf2d1575f' }) });
    assert.equal(report.created, 0);
    assert.equal(report.wouldCreate, 118, '110 findings, 7 security tasks, 1 parent');
    assert.equal((await store.find(URL_KEY, {})).length, 0);
  });

  test('an apply makes each entry a finding to the project, its note kept in how; security entries are tasks under one parent', async () => {
    const plan = planImport(baselineNotes(), { ref: 'bf2d1575f' });
    const report = await applyWrites({ writes, recordsStore: store, urlKey: URL_KEY, apply: true, items: waitingItems(plan, { ref: 'bf2d1575f' }) });
    assert.equal(report.refused.length, 0, JSON.stringify(report.refused.slice(0, 2)));
    assert.equal(report.created, 118);
    const findings = await store.find(URL_KEY, { kind: 'finding' });
    assert.equal(findings.length, 110);
    assert.ok(findings.every((f) => f.to === 'project' && f.by === 'import' && f.via === 'import'));
    const sample = findings.find((f) => f.fields.how.startsWith('Waiting entry in agent-api'));
    assert.ok(sample, 'the note name is kept in how');
    const parent = await store.current(URL_KEY, SECURITY_PARENT_ID);
    assert.equal(parent.kind, 'task');
    const children = await store.find(URL_KEY, { kind: 'task', inRef: SECURITY_PARENT_ID });
    assert.equal(children.length, 7, 'seven security tasks under one parent');
    assert.ok(children.every((c) => c.to === 'project'));
    const securityAsFindings = findings.filter((f) => /security review/i.test(f.fields.says));
    assert.equal(securityAsFindings.length, 0, 'a security entry is a task, not also a finding');
  });

  test('a second apply adds nothing, and an imported record that has ended is still skipped', async () => {
    const plan = planImport(baselineNotes(), { ref: 'bf2d1575f' });
    const items = waitingItems(plan, { ref: 'bf2d1575f' });
    await applyWrites({ writes, recordsStore: store, urlKey: URL_KEY, apply: true, items });
    const one = items.find((i) => i.kind === 'finding');
    await writes.end({ urlKey: URL_KEY, id: one.id, input: { state: 'declined', reason: 'not needed' }, by: 'person:acc-john' });
    const again = await applyWrites({ writes, recordsStore: store, urlKey: URL_KEY, apply: true, items });
    assert.equal(again.created, 0);
    assert.equal(again.existing, 118);
    assert.equal((await store.find(URL_KEY, { kind: 'finding' })).length, 110);
  });

  test('the same notes read from a different ref with one reworded entry import that entry again, and no other', async () => {
    const first = planImport(baselineNotes(), { ref: 'a' });
    await applyWrites({ writes, recordsStore: store, urlKey: URL_KEY, apply: true, items: waitingItems(first, { ref: 'a' }) });
    const notes = baselineNotes();
    notes[0] = { ...notes[0], markdown: notes[0].markdown.replace(/\n## Waiting\n/, '\n## Waiting\n\n- `lib/extra.js` — a brand new entry\n') };
    const second = planImport(notes, { ref: 'b' });
    const report = await applyWrites({ writes, recordsStore: store, urlKey: URL_KEY, apply: true, items: waitingItems(second, { ref: 'b' }) });
    assert.equal(report.created, 1, 'the new entry only');
  });
});

describe('the parked-ticket manifest', () => {
  test('the committed manifest names the five parked tickets, and every finding is addressed to a reader the pipeline knows', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    assert.deepEqual(manifest.tickets.map((t) => t.ticket), ['LIN-4416', 'LIN-4210', 'LIN-4441', 'LIN-4445', 'LIN-4463']);
    for (const t of manifest.tickets) {
      for (const f of t.findings) {
        assert.ok(f.says && f.says.length <= 600, `${t.ticket}: says is a sentence`);
        // LIN-4496: a hand-off to a person names the workspace person by id (a display name is not a reader Harbour matches).
        assert.ok(f.to === 'project' || Object.keys(STAGE_KINDS).includes(f.to) || f.to.startsWith('person:'), `${t.ticket}: to ${f.to} is a reader`);
      }
    }
  });

  test('the dry run refuses what --apply refuses, before anything is written: a name the workspace does not show is refused', async () => {
    const manifest = { tickets: [{ ticket: 'LIN-4210', asked: 'The asked.', done_when: 'It is done.', findings: [{ says: 'Asks John.', to: 'John', how: 'read it' }] }] };
    const dry = await applyManifest({ writes, recordsStore: store, urlKey: URL_KEY, apply: false, manifest });
    assert.equal(dry.refused.length, 1, 'the finding addressed to a name the workspace does not show is refused in the dry run');
    assert.equal(dry.refused[0].problems[0].field, 'to');
    assert.equal(dry.wouldCreate, 1, 'the ticket\'s task is still creatable, and is counted');
    assert.equal((await store.find(URL_KEY, {})).length, 0, 'the dry run writes nothing');
    const applied = await applyManifest({ writes, recordsStore: store, urlKey: URL_KEY, apply: true, manifest });
    assert.equal(applied.created, dry.wouldCreate, 'apply creates what the dry run counted');
    assert.equal(applied.refused.length, dry.refused.length, 'and refuses what the dry run refused');
  });

  test('the committed manifest: the dry run reports the same counts as --apply on an empty store, with no refusals', async () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const dry = await applyManifest({ writes, recordsStore: store, urlKey: URL_KEY, apply: false, manifest });
    assert.deepEqual(dry.refused.map((r) => r.id), [], JSON.stringify(dry.refused.slice(0, 2)));
    const applied = await applyManifest({ writes, recordsStore: store, urlKey: URL_KEY, apply: true, manifest });
    assert.equal(applied.created, dry.wouldCreate);
    assert.equal(applied.refused.length, 0, JSON.stringify(applied.refused.slice(0, 2)));
  });

  test('applying it makes each ticket a task claimed for its ticket, with its findings under it; a retry adds nothing', async () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const report = await applyManifest({ writes, recordsStore: store, urlKey: URL_KEY, apply: true, manifest });
    assert.equal(report.refused.length, 0, JSON.stringify(report.refused.slice(0, 2)));
    for (const t of manifest.tickets) {
      const taskId = ticketTaskIdOf(t.ticket);
      assert.equal(await store.taskForTicket(URL_KEY, t.ticket), taskId, `${t.ticket} is claimed for its task`);
      const under = await store.find(URL_KEY, { inRef: taskId });
      assert.equal(under.length, t.findings.length, `${t.ticket}: its findings hang under its task`);
    }
    const retry = await applyManifest({ writes, recordsStore: store, urlKey: URL_KEY, apply: true, manifest });
    assert.equal(retry.created, 0);
    assert.equal(retry.existing, manifestItems(manifest).length);
  });

  test('a ticket already claimed keeps its task; the claim is not moved', async () => {
    await store.claimTicket(URL_KEY, 'LIN-4416', 'task-other0001');
    const manifest = { tickets: [{ ticket: 'LIN-4416', findings: [] }] };
    await applyManifest({ writes, recordsStore: store, urlKey: URL_KEY, apply: true, manifest });
    assert.equal(await store.taskForTicket(URL_KEY, 'LIN-4416'), null, 'no record under the other id, so no claim is read as held');
    assert.equal(await store.claimTicket(URL_KEY, 'LIN-4416', ticketTaskIdOf('LIN-4416')), 'task-other0001');
  });

  test('a ticket claimed for another task is named as a conflict and its items are skipped, with no orphan written; a dry run reports the same', async () => {
    // A task already holds LIN-4416's claim (LIN-4494 review: the manifest must not hang findings under an unreachable task).
    await store.claimTicket(URL_KEY, 'LIN-4416', 'task-other0001');
    const manifest = {
      tickets: [
        { ticket: 'LIN-4416', title: 'claimed elsewhere', findings: [{ says: 'a hand-off for 4416', to: 'project' }] },
        { ticket: 'LIN-4210', title: 'free', findings: [{ says: 'a hand-off for 4210', to: 'project' }] },
      ],
    };
    const dry = await applyManifest({ writes, recordsStore: store, urlKey: URL_KEY, apply: false, manifest });
    assert.deepEqual(dry.conflicts.map((c) => [c.ticket, c.claimedBy, c.skipped]), [['LIN-4416', 'task-other0001', 2]]);
    assert.equal((await store.find(URL_KEY, {})).length, 0, 'the dry run writes nothing');

    const report = await applyManifest({ writes, recordsStore: store, urlKey: URL_KEY, apply: true, manifest });
    assert.equal(report.conflicts.length, 1);
    assert.equal(report.refused.length, 0);
    assert.equal(await store.current(URL_KEY, ticketTaskIdOf('LIN-4416')), null, 'no task made for the claimed ticket');
    assert.equal((await store.find(URL_KEY, { inRef: ticketTaskIdOf('LIN-4416') })).length, 0, 'no orphan finding under it');
    assert.equal(await store.taskForTicket(URL_KEY, 'LIN-4210'), ticketTaskIdOf('LIN-4210'), 'the other ticket is written as usual');
    assert.equal((await store.find(URL_KEY, { inRef: ticketTaskIdOf('LIN-4210') })).length, 1);
  });
});
