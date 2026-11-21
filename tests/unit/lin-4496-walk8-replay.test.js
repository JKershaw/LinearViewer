/**
 * LIN-4496 (piece 5 of LIN-4491): walk 8's three tasks (LIN-4450, LIN-4446, LIN-4469) replayed through the proxy routes on a
 * temporary store. The fixtures (tests/fixtures/walk-8/*.json) are the walk-8 store ported to today's kinds:
 *   - seeds: the store before the first step. They are written through the checked pipeline with their historical
 *     `by` and `at` (createRecordWrites().add({by, at})), since the proxy does not accept a historical `by`;
 *   - steps: each stage's writes in its window, replayed through POST /api/proxy/records (and its revise, end and link
 *     routes) under a dispatch credential minted for a dispatch row of that stage. Who wrote a record is filled from the
 *     run, so each step's `by` must come back as the stage's name. A person's step (John) writes under a person credential.
 *
 * Porting, applied in the fixtures and not here: a check becomes a finding (`what`, then `why-person` under it, as `says`;
 * `how` kept); a lesson drops `checked-at`; a review's approve-with-notes becomes approve (the notes are the findings
 * beside it). Historical ids are mapped to the fresh ids the store allocates, and every link follows the map.
 *
 * Witnesses (the piece's own list):
 *   1. every replayed write is accepted by the route it names (no refusal, nothing silently dropped);
 *   2. each replayed record ends in the walk's end state: kind, state, version count, addressee and task;
 *   3. at the start of every stage step, the stage's run brief (lib/records/run-brief.js, the composition behind
 *      GET /api/proxy/brief/:id?run=) carries every open hand-off addressed to that stage, to its task, or to the project;
 *   4. one ask to a parent is written by the agent-facing call, from LIN-4450's implementation run, and is read in the
 *      parent task's brief;
 *   5. no record addressed to a stage is open when the walk ends (a hand-off is ended by the task's last step).
 *
 * Credentials: tokens are minted by the real ProxyTokenStore and validated by it (tests/helpers/records-route-harness.js);
 * the request fields are copied as routes/proxy.js copies them. The route factory itself is not mounted here.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { composeRunBrief } from '../../lib/records/run-brief.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { askedOf } from '../../lib/asked-of.js';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';

const URL_KEY = 'lin-4496-walk-8-replay';
const STAGES = Object.keys(STAGE_KINDS);
const PERSON = { accountId: 'acc-john', name: 'John' };
const PEOPLE = [PERSON];
const HAND_OFF_KINDS = new Set(['finding', 'question']);
/** Link types that take one id (lib/records/kinds.json): `piece` and `answers`. Every other link type takes a list. */
const SINGLE_LINKS = ['piece', 'answers'];

const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/walk-8/${name}.json`, import.meta.url), 'utf8'));
const WALKS = ['lin-4450', 'lin-4446', 'lin-4469'].map(load);

/** The parent ask, written from LIN-4450's implementation run to its parent LIN-4445 (task-50 in the walk). */
const PARENT_ASK = {
  kind: 'question',
  asks: 'Should the held-run reading count runs that ended without a close-out?',
  options: ['count them as held', 'leave them out'],
  recommended: 'count them as held',
  'if-unanswered': 'the reading leaves them out, and says so'
};

/** The tracker's view of each walk's tickets: a task's ticket, and the ticket of the task it sits in. */
function ticketsOf(walks) {
  const tickets = new Map();
  for (const walk of walks) {
    for (const t of Object.values(walk.tasks)) {
      const parent = t.in ? walk.tasks[t.in]?.ref ?? null : null;
      tickets.set(t.ref, { identifier: t.ref, title: t.ref, description: t.asked || t.ref, state: { name: 'In Progress', type: 'started' }, parent: parent ? { identifier: parent } : null });
    }
  }
  return tickets;
}

const TICKETS = ticketsOf(WALKS);
const harness = createMangoTmpdir('lin-4496-walk8-');
before(() => harness.connect());
after(() => harness.close());

const strip = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
/** A decision's `scope` names a walk task (mapped like any id) or 'project'; other fields pass as they are. */
const scopedWith = (real, fields) => (fields && 'scope' in fields ? { ...fields, scope: real(fields.scope) } : fields);

/** A replay: the store, the routes, the pipeline, and the map from the walk's ids to the store's. */
async function replayWalk(walk) {
  const rh = await createRecordsRouteHarness({ harness, urlKey: URL_KEY, tickets: TICKETS, people: PEOPLE });
  try {
    return await replay(walk, rh);
  } catch (err) {
    await rh.close(); // a failed replay must not leave its server open, or the test process never exits
    throw err;
  }
}

async function replay(walk, rh) {
  const readTicket = async (_req, ref) => TICKETS.get(ref) ?? null;
  const writes = createRecordWrites({ recordsStore: rh.store, isTerminalState, readTicket, askedText: askedOf, stageKinds: STAGES, listPeople: async () => PEOPLE });
  const map = new Map();
  const real = (x) => {
    if (typeof x !== 'string') return x;
    const [id, v] = x.split('@');
    if (!map.has(id)) return x; // a ticket id, a stage, 'project', or a person's name: the store resolves these itself
    return v === undefined ? map.get(id) : `${map.get(id)}@${v}`;
  };
  // A link is a list (about, on) or one id (piece, answers): the store takes both shapes, the ids follow the map either way.
  const linksOf = (links = {}) => Object.fromEntries(Object.entries(links).map(([k, v]) => [k, Array.isArray(v) && !SINGLE_LINKS.includes(k) ? v.map(real) : real(Array.isArray(v) ? v[0] : v)]));
  const scoped = (fields) => scopedWith(real, fields);
  const taskOf = (walkTask) => map.get(walkTask);
  /** An addressee as the store holds it: a person by name is stored as person:<accountId>; the rest are ids or names the map covers. */
  const toOf = (x) => (x === PERSON.name ? `person:${PERSON.accountId}` : real(x));
  const fail = (what, extra) => { throw new Error(`${walk.ticket} ${what}: ${JSON.stringify(extra).slice(0, 600)}`); };

  // Seeds: the pipeline, historical by and at.
  for (const op of walk.seeds) {
    if (op.op === 'add') {
      const input = strip({ ...scoped(op.fields), in: op.in && real(op.in), to: op.to && real(op.to), links: op.links && linksOf(op.links) });
      const r = await writes.add({ urlKey: URL_KEY, kind: op.kind, input, by: op.by, at: op.at });
      if (r.problems) fail(`seed add ${op.id}`, r.problems);
      map.set(op.id, r.record.id);
    } else if (op.op === 'revise') {
      const input = strip({ ...scoped(op.fields), reason: op.reason, in: op.in && real(op.in), to: op.to && real(op.to), links: op.links && linksOf(op.links) });
      const r = await writes.revise({ urlKey: URL_KEY, id: map.get(op.id), input, by: op.by });
      if (r.problems) fail(`seed revise ${op.id}`, r.problems);
    } else if (op.op === 'end') {
      const r = await writes.end({ urlKey: URL_KEY, id: map.get(op.id), input: strip({ state: op.state, reason: op.reason, into: op.into && real(op.into) }), by: op.by });
      if (r.problems) fail(`seed end ${op.id}`, r.problems);
    } else if (op.op === 'link') {
      const r = await writes.link({ urlKey: URL_KEY, id: map.get(op.id), links: linksOf(op.links), by: op.by });
      if (r.problems) fail(`seed link ${op.id}`, r.problems);
    }
  }

  // Steps: each stage's writes through the routes, under a dispatch credential for that stage's run.
  const runs = new Map(); // stage -> { runId, token } for the latest run of that stage
  const runIds = [];
  let johnToken = null;
  const taskReal = taskOf(walk.task);
  const briefChecks = [];
  // The parent ask is one more write, made by the implementation step of LIN-4450 after its own writes.
  const parentAskAfter = walk.ticket === 'LIN-4450' ? 'implementation' : null;

  for (const step of walk.steps) {
    let runId = null;
    if (step.stage === 'John') {
      johnToken = johnToken ?? await rh.mintPersonToken(PERSON.accountId);
    } else {
      runId = `run-${walk.ticket}-${step.n}-${step.stage}`;
      await rh.store.openRun(URL_KEY, { id: runId, stage: step.stage, taskId: taskReal, lineage: `lineage-${walk.ticket}` });
      runIds.push(runId);
      runs.set(step.stage, { runId, token: await rh.mintRunToken(runId) });

      // Witness 3: the brief this run gets carries every open hand-off addressed to it, its task, or the project.
      // Addressed to the stage or the task: carried in full. Addressed to the project: counted, with the lookup (brief part 5).
      const open = await openHandOffs(rh.store, [step.stage, taskReal]);
      const toProject = (await openHandOffs(rh.store, ['project'])).length;
      const brief = await composeRunBrief({ store: rh.store, urlKey: URL_KEY, runId });
      if (brief.problem) fail(`brief for step ${step.n}`, brief.problem);
      const missing = open.filter((id) => !brief.carries.includes(id));
      const projectCounted = brief.text.includes(`${toProject} open addressed to project`);
      briefChecks.push({ step: step.n, stage: step.stage, expected: open.length, toProject, missing, projectCounted });
      if (missing.length) fail(`step ${step.n} ${step.stage}: open hand-offs missing from its brief`, missing);
      if (!projectCounted) fail(`step ${step.n} ${step.stage}: the brief does not count the ${toProject} open records to project`, brief.text.split('\n').find((l) => l.includes('addressed to project')) ?? null);
    }

    for (const op of step.ops) {
      const who = step.stage === 'John' ? { token: johnToken, runId: null } : runs.get(op.by);
      if (!who) fail(`step ${step.n}: no run for ${op.by}`, op.id);
      await applyOverRoutes(rh, map, real, linksOf, op, who);
    }
    if (parentAskAfter === step.stage) {
      await applyOverRoutes(rh, map, real, linksOf, { op: 'add', id: 'ask-LIN-4450', kind: PARENT_ASK.kind, fields: strip({ asks: PARENT_ASK.asks, options: PARENT_ASK.options, recommended: PARENT_ASK.recommended, 'if-unanswered': PARENT_ASK['if-unanswered'] }), to: 'LIN-4445', in: walk.task, by: step.stage }, runs.get(step.stage));
    }
  }

  // Witness 4: the parent's reader reads the ask in its own brief (a run on the parent task).
  let parentBrief = null;
  if (walk.ticket === 'LIN-4450') {
    const parentTask = map.get('task-50');
    const readerId = 'run-LIN-4445-reader';
    await rh.store.openRun(URL_KEY, { id: readerId, stage: 'scoping', taskId: parentTask, lineage: 'lineage-LIN-4445-reader' });
    runIds.push(readerId);
    parentBrief = await composeRunBrief({ store: rh.store, urlKey: URL_KEY, runId: readerId });
    const askId = map.get('ask-LIN-4450') ?? null;
    const found = [...(parentBrief.carries ?? [])];
    parentBrief.askId = askId;
    parentBrief.askInBrief = !!askId && found.includes(askId) && parentBrief.text.includes(PARENT_ASK.asks);
  }

  // The runs end when the walk ends: each stage's dispatch row is closed as done.
  for (const runId of runIds) await rh.store.endRun(URL_KEY, runId, { state: 'done' });

  return { rh, map, real, toOf, briefChecks, parentBrief, taskReal };
}

/** The one task the changes a verdict is on belong to, or null when it is on no change or on changes of more than one task. */
async function taskOfChanges(store, verdict) {
  const tasks = new Set();
  for (const ref of [].concat(verdict.links?.on ?? [])) {
    const snap = await store.current(URL_KEY, String(ref).split('@')[0]);
    if (snap?.kind === 'change' && snap.in) tasks.add(snap.in);
  }
  return tasks.size === 1 ? [...tasks][0] : null;
}

/** Open hand-offs (findings and questions) addressed to any of `targets`, as store ids. */
async function openHandOffs(store, targets) {
  const ids = new Set();
  for (const to of targets) {
    for (const snap of await store.find(URL_KEY, { to, state: 'open' })) if (HAND_OFF_KINDS.has(snap.kind)) ids.add(snap.id);
  }
  return [...ids];
}

/**
 * LIN-4516: a verdict's `on` through the route names a change by the head its judge read, never by `@v` (the route refuses a
 * pin the judge did not name, on `on` beside the fields and under `links` alike). The walk's stored verdicts name a change
 * version, `change@v`; the agent-facing call that wrote one says that version's head. So a historical `change@v` in a
 * verdict's links goes out as the bare change id plus `heads: {<id>: <the head version v holds>}`: the same pin, said as the
 * route takes it. A link to anything else is left as it was.
 * @returns {Promise<{links: object|undefined, heads?: object}>}
 */
async function verdictLinks(rh, links) {
  if (!links?.on) return { links };
  const heads = {};
  const on = [];
  for (const ref of [].concat(links.on)) {
    const [id, v] = String(ref).split('@');
    const snap = v !== undefined ? await rh.store.current(URL_KEY, id) : null;
    if (snap?.kind !== 'change') { on.push(ref); continue; }
    const held = (await rh.store.versionsOf(URL_KEY, [id])).find((x) => x.v === Number(v));
    if (!held?.fields?.head) throw new Error(`${ref}: the change version a verdict names holds no head to send`);
    heads[id] = held.fields.head;
    on.push(id);
  }
  return { links: { ...links, on }, ...(Object.keys(heads).length ? { heads } : {}) };
}

/** One historical op, as the agent-facing call: flat bodies, the run named, the writer filled from the credential. */
async function applyOverRoutes(rh, map, real, linksOf, op, who) {
  const run = who.runId ? { run: who.runId } : {};
  const token = who.token;
  if (op.op === 'add') {
    const verdict = op.kind === 'verdict' ? await verdictLinks(rh, op.links && linksOf(op.links)) : { links: op.links && linksOf(op.links) };
    const body = strip({ kind: op.kind, ...scopedWith(real, op.fields), in: op.in && real(op.in), to: op.to && real(op.to), links: verdict.links, heads: verdict.heads, ...run });
    const r = await rh.post('/api/proxy/records', token, body);
    if (r.status !== 201) throw new Error(`add ${op.id} (${op.kind}) refused ${r.status}: ${JSON.stringify(r.body).slice(0, 600)}`);
    if (op.by !== 'John' && r.body.by !== op.by) throw new Error(`add ${op.id} filed by ${r.body.by}, not ${op.by}`);
    map.set(op.id, r.body.id);
    return;
  }
  const id = map.get(op.id);
  if (!id) throw new Error(`${op.op} of ${op.id}: no record under that id`);
  const isVerdict = (await rh.store.current(URL_KEY, id))?.kind === 'verdict';
  if (op.op === 'revise') {
    const pinned = isVerdict ? await verdictLinks(rh, op.links && linksOf(op.links)) : { links: op.links && linksOf(op.links) };
    const body = strip({ ...scopedWith(real, op.fields), reason: op.reason, in: op.in && real(op.in), to: op.to && real(op.to), links: pinned.links, heads: pinned.heads, ...run });
    const r = await rh.post(`/api/proxy/records/${id}/revise`, token, body);
    if (r.status !== 200) throw new Error(`revise ${op.id} refused ${r.status}: ${JSON.stringify(r.body).slice(0, 600)}`);
  } else if (op.op === 'end') {
    const r = await rh.post(`/api/proxy/records/${id}/end`, token, strip({ state: op.state, reason: op.reason, into: op.into && real(op.into), ...run }));
    if (r.status !== 200) throw new Error(`end ${op.id} refused ${r.status}: ${JSON.stringify(r.body).slice(0, 600)}`);
  } else if (op.op === 'link') {
    const pinned = isVerdict ? await verdictLinks(rh, linksOf(op.links)) : { links: linksOf(op.links) };
    const r = await rh.post(`/api/proxy/records/${id}/link`, token, strip({ links: pinned.links, heads: pinned.heads, ...run }));
    if (r.status !== 200) throw new Error(`link ${op.id} refused ${r.status}: ${JSON.stringify(r.body).slice(0, 600)}`);
  } else {
    throw new Error(`unknown op ${op.op}`);
  }
}

describe('walk 8 replayed through the proxy (LIN-4496)', () => {
  for (const walk of WALKS) {
    test(`${walk.ticket}: every write is accepted, and the store ends in the walk's end state`, async () => {
      const { rh, map, real, toOf } = await replayWalk(walk);
      try {
        const mismatches = [];
        for (const [hist, exp] of Object.entries(walk.expect)) {
          if (exp.kind === 'run') continue; // a run is a dispatch row, not a record: it is opened and closed, not replayed
          const id = map.get(hist);
          if (!id) { mismatches.push(`${hist}: never made`); continue; }
          const { snap } = await rh.store.read(URL_KEY, id);
          // LIN-4516: a verdict on changes is filed `in` the one task its changes are on (the route does it; the stored walk's
          // verdicts, written before, name no task). That is the one difference from the stored end state, and it is checked
          // against the change records themselves, not assumed.
          const wantIn = exp.in ? real(exp.in) : (exp.kind === 'verdict' ? await taskOfChanges(rh.store, snap) : null);
          const want = { kind: exp.kind, state: exp.state, v: exp.v, to: exp.to ? toOf(exp.to) : null, in: wantIn };
          const got = { kind: snap.kind, state: snap.state, v: snap.v, to: snap.to ?? null, in: snap.in ?? null };
          if (JSON.stringify(got) !== JSON.stringify(want)) mismatches.push(`${hist} (${id}): got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
        }
        assert.deepEqual(mismatches, [], `${mismatches.length} record(s) differ from the walk's end state`);
      } finally {
        await rh.close();
      }
    });

    test(`${walk.ticket}: every stage's brief carries the open hand-offs addressed to it`, async () => {
      const { rh, briefChecks } = await replayWalk(walk);
      try {
        assert.ok(briefChecks.length > 0);
        for (const c of briefChecks) {
          assert.deepEqual(c.missing, [], `step ${c.step} ${c.stage}`);
          assert.equal(c.projectCounted, true, `step ${c.step} ${c.stage} counts the project records`);
        }
      } finally {
        await rh.close();
      }
    });

    test(`${walk.ticket}: no record addressed to a stage is open when the walk ends`, async () => {
      const { rh } = await replayWalk(walk);
      try {
        const open = [];
        for (const stage of STAGES) {
          for (const snap of await rh.store.find(URL_KEY, { to: stage, state: 'open' })) open.push(`${snap.id} to ${stage}`);
        }
        assert.deepEqual(open, []);
      } finally {
        await rh.close();
      }
    });
  }

  test('LIN-4450\'s implementation asks its parent through the proxy, and the parent\'s reader reads the ask in its brief', async () => {
    const walk = WALKS.find((w) => w.ticket === 'LIN-4450');
    const { rh, parentBrief, map } = await replayWalk(walk);
    try {
      assert.ok(parentBrief, 'the parent reader ran');
      assert.ok(parentBrief.askId, 'the ask was written and has an id');
      assert.equal(parentBrief.askInBrief, true, `the ask ${parentBrief.askId} reaches the parent's brief in full`);
      const { snap } = await rh.store.read(URL_KEY, parentBrief.askId);
      assert.equal(snap.kind, 'question');
      assert.equal(snap.to, map.get('task-50'), 'addressed to the parent task, by its ticket id');
      assert.equal(snap.by, 'implementation', 'filed as the implementation stage, from the run it was written under');
    } finally {
      await rh.close();
    }
  });
});
