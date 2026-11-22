/**
 * LIN-4518 step 3: a ticket's records, seeded directly at the instants a scenario names. The gates (close-out, the
 * blind-read route, the selector's trail facts) read records, so a trail a test wants is written as the records a stage
 * would write: a task, its changes (a PR and its head), reviews and blind reads (verdicts `on` the change versions they
 * judged), close-out and audit runs. Nothing here parses a comment: each event names the record it writes.
 *
 * Events, in order (`at` is an ISO instant; every record takes its instant from its event):
 *   { kind: 'pr', at, pr, head }                    a change for PR `pr` (its URL), open at `head`
 *   { kind: 'head', at, pr, head }                  the PR's head moves: its change is revised to `head`
 *   { kind: 'merged', at, pr }                      the PR merges: its change ends `merged`
 *   { kind: 'abandoned', at, pr }                   the PR closes unmerged: its change ends `abandoned`
 *   { kind: 'review', at, on, outcome?, heads? }    a review verdict on the PR URLs in `on`; `heads` pins each to the
 *                                                   head its judge read (default: the change's head at `at`)
 *   { kind: 'review', at, on: [], onPlan: true, outcome? }  a review of a task with no PR (LIN-4518 finding-d3b5b9de): its
 *                                                   verdict is on the task's plan, since a verdict needs an `on` but no
 *                                                   change; it reads as a review with an empty landing
 *   { kind: 'blindRead', at, on, outcome? }         a blind-read verdict on the PR URLs in `on` (default outcome 'same')
 *   { kind: 'closeOut', at, state?, account? }      a close-out run, ended `state` (default 'done') at `at`, its final text `account`
 *   { kind: 'audit', at, pr }                       an audit run that writes the notes change `pr` (its first version)
 *   { kind: 'run', at, stage, state? }              any other stage run, ended `state` (default 'done') at `at`; `null` leaves it running
 *   { kind: 'finding', at, says, how }              an open finding to close-out on the task
 *   { kind: 'planReview', at, outcome, findings? }  a plan-review run (LIN-4518 finding-55356e66): `findings` finding records
 *                                                   `to: plan` about the task's plan, then the verdict on that plan, all
 *                                                   under one run id; `outcome` is approve | request-changes | needs-discussion
 *
 * The task is made for `ticket` in `urlKey` at `T0`, so each scenario starts from the same task.
 */
import { BLIND_READ_KIND } from '../../lib/prompts/blind-read-words.js';
import { REVIEW_JUDGEMENT, CLOSE_OUT_STAGE, AUDIT_STAGE } from '../../lib/records/words.js';
import { canonicalChangeRef, changeKeyOf } from '../../lib/records/change-ref.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';

export const SEED_T0 = '2026-11-12T00:00:00.000Z';

/**
 * A records store on a fresh database of `harness` (a connected createMangoTmpdir harness), with the unique indexes the
 * records routes create, so each scenario starts from an empty store.
 */
export async function recordsStoreFor(harness) {
  const db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  return new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
}

const HARBOUR = 'harbour';

/**
 * Seed `events` for `ticket` into `store`, in event order.
 * @param {import('../../lib/records-store.js').RecordsStore} store
 * @param {string} urlKey
 * @param {string} ticket
 * @param {object[]} events
 * @returns {Promise<{taskId: string, changes: Map<string, string>}>} the task id, and each PR URL's change id
 */
export async function seedTicketRecords(store, urlKey, ticket, events) {
  const taskId = (await store.ensureTask(urlKey, { identifier: ticket, asked: `${ticket} asked`, closed: false, closedReason: null }, { by: HARBOUR, at: SEED_T0 })).id;
  const changes = new Map();
  let runSeq = 0;
  const openRunAt = async (stage, at, state, account = null) => {
    runSeq += 1;
    const id = `run-${stage}-${runSeq}`;
    await store.openRun(urlKey, { id, stage, taskId, lineage: id, at: minus(at, 1) });
    // A run ends in `state`; `undefined` or `null` leaves it open (running). `account` is its final text (LIN-4520).
    if (state) await store.endRun(urlKey, id, { state, at, account });
    return id;
  };
  const changeOf = (pr) => {
    const key = changeKeyOf(pr);
    const id = changes.get(key);
    if (!id) throw new Error(`the scenario names ${pr} before it has a change`);
    return id;
  };
  const onRefs = async (prs, heads = {}) => {
    const refs = [];
    for (const pr of prs) {
      const id = changeOf(pr);
      const pinned = heads[pr];
      const current = await store.current(urlKey, id);
      if (!pinned || current.fields?.head === pinned) { refs.push(`${id}@${current.v}`); continue; }
      const held = (await store.versionsOf(urlKey, [id])).filter((s) => s.fields?.head === pinned).sort((a, b) => b.v - a.v)[0];
      if (!held) throw new Error(`the scenario pins ${pr} to ${pinned}, a head it never had`);
      refs.push(`${id}@${held.v}`);
    }
    return refs;
  };
  const verdict = async (at, judgement, outcome, refs, reasoning) => store.add(urlKey, {
    kind: 'verdict', state: 'stands', in: taskId,
    fields: { judgement, outcome, reasoning },
    links: { on: refs },
  }, { by: HARBOUR, at, run: null });

  // The task's plan, made once when a plan-review event first needs it (a plan review judges a plan).
  let plan = null;
  const planOf = async (at) => {
    if (!plan) {
      const rec = await store.add(urlKey, { kind: 'plan', state: 'kept', in: taskId, to: 'implementation', fields: { says: 'the plan', order: 1 } }, { by: HARBOUR, at });
      plan = { id: rec.id, v: rec.v };
    }
    return plan;
  };
  for (const ev of events) {
    const at = ev.at;
    if (ev.kind === 'audit' && !ev.head) throw new Error('an audit event names the notes PR head it wrote');
    if (ev.kind === 'planReview') {
      const p = await planOf(at);
      const run = `run-plan-review-${at}`;
      for (let i = 0; i < (ev.findings || 0); i++) {
        await store.add(urlKey, { kind: 'finding', state: 'open', in: taskId, to: 'plan', links: { about: [p.id] }, fields: { says: `blocking finding ${i + 1}`, how: 'the check that settles it' } }, { by: 'plan-review', run, at });
      }
      await store.add(urlKey, { kind: 'verdict', state: 'stands', in: taskId, fields: { judgement: 'plan-review', outcome: ev.outcome, reasoning: 'plan review' }, links: { on: [`${p.id}@${p.v}`] } }, { by: 'plan-review', run, at });
      continue;
    }
    if (ev.kind === 'finding') {
      await store.add(urlKey, { kind: 'finding', state: 'open', in: taskId, to: 'close-out', fields: { says: ev.says, how: ev.how } }, { by: HARBOUR, at });
      continue;
    }
    switch (ev.kind) {
      case 'pr': {
        const key = changeKeyOf(ev.pr);
        const snap = await store.add(urlKey, {
          kind: 'change', state: 'open', in: taskId,
          fields: { ref: canonicalChangeRef(ev.pr), head: ev.head },
          links: {},
        }, { by: HARBOUR, at, run: null });
        changes.set(key, snap.id);
        break;
      }
      case 'head': {
        const id = changeOf(ev.pr);
        await store.revise(urlKey, id, { fields: { head: ev.head } }, { by: HARBOUR, at, reason: `head moved to ${ev.head}` });
        break;
      }
      case 'merged': {
        await store.end(urlKey, changeOf(ev.pr), { state: 'merged', reason: 'the PR merged' }, { by: HARBOUR, at });
        break;
      }
      case 'abandoned': {
        await store.end(urlKey, changeOf(ev.pr), { state: 'abandoned', reason: 'the PR closed unmerged' }, { by: HARBOUR, at });
        break;
      }
      case 'review': {
        if (ev.onPlan) {
          // A review of no change: its verdict is on the task's plan (LIN-4518 finding-d3b5b9de).
          const p = await planOf(at);
          await verdict(at, REVIEW_JUDGEMENT, ev.outcome ?? 'approve', [`${p.id}@${p.v}`], 'read at the plan: the task has no PR');
          break;
        }
        const refs = await onRefs(ev.on, ev.heads);
        await verdict(at, REVIEW_JUDGEMENT, ev.outcome ?? 'approve', refs, 'read at the head named');
        break;
      }
      case 'blindRead': {
        const refs = await onRefs(ev.on);
        await verdict(at, BLIND_READ_KIND, ev.outcome ?? 'same', refs, 'the blind read');
        break;
      }
      case 'closeOut': {
        await openRunAt(CLOSE_OUT_STAGE, at, ev.state ?? 'done', ev.account ?? null);
        break;
      }
      case 'audit': {
        const runId = await openRunAt(AUDIT_STAGE, at, undefined);
        const key = changeKeyOf(ev.pr);
        const snap = await store.add(urlKey, {
          kind: 'change', state: 'open', in: taskId,
          fields: { ref: canonicalChangeRef(ev.pr), head: ev.head },
          links: {},
        }, { by: HARBOUR, at, run: runId });
        changes.set(key, snap.id);
        break;
      }
      case 'run': {
        // `state: null` leaves the run running (open); no state at all means it ended done.
        await openRunAt(ev.stage, at, ev.state === undefined ? 'done' : ev.state);
        break;
      }
      default:
        throw new Error(`seedTicketRecords: no event kind ${ev.kind}`);
    }
  }
  return { taskId, changes };
}

/** The instant of scenario minute `n` (hours of 2026-11-12, as the lin-4438 table writes them). */
export const scenarioAt = (n) => (typeof n === 'string' ? n : `2026-11-12T${String(n).padStart(2, '0')}:00:00.000Z`);

/**
 * Event builders for scenarios, so a test writes its trail as the records it is (see seedTicketRecords). `on` and `pr`
 * take PR URLs; `head` is the sha the PR is at when the event is written.
 */
export const ev = {
  pr: (n, pr, head) => ({ kind: 'pr', at: scenarioAt(n), pr, head }),
  head: (n, pr, head) => ({ kind: 'head', at: scenarioAt(n), pr, head }),
  review: (n, on, { outcome = 'approve', heads } = {}) => ({ kind: 'review', at: scenarioAt(n), on: [].concat(on), outcome, heads }),
  read: (n, on, { outcome } = {}) => ({ kind: 'blindRead', at: scenarioAt(n), on: [].concat(on), ...(outcome ? { outcome } : {}) }),
  close: (n, state, account) => ({ kind: 'closeOut', at: scenarioAt(n), ...(state ? { state } : {}), ...(account ? { account } : {}) }),
  merged: (n, pr) => ({ kind: 'merged', at: scenarioAt(n), pr }),
  abandoned: (n, pr) => ({ kind: 'abandoned', at: scenarioAt(n), pr }),
  audit: (n, pr, head) => ({ kind: 'audit', at: scenarioAt(n), pr, head }),
  run: (n, stage, state) => ({ kind: 'run', at: scenarioAt(n), stage, state }),
  finding: (n, says, how = 'the fix') => ({ kind: 'finding', at: scenarioAt(n), says, how }),
};

/**
 * A ticket's records store seeded with `events` for `ticket` in `urlKey` (LIN-4518 step 3): the store the route and the
 * gates read. `harness` is a connected createMangoTmpdir harness.
 */
export async function seededRecordsStore(harness, events, { urlKey = 'ws', tickets = ['LIN-1'] } = {}) {
  const store = await recordsStoreFor(harness);
  for (const ticket of tickets) await seedTicketRecords(store, urlKey, ticket, events);
  return store;
}

/** An ISO instant `minutes` before `iso`. */
function minus(iso, minutes) {
  return new Date(Date.parse(iso) - minutes * 60_000).toISOString();
}

/**
 * A records store where each of `urlKeys` holds `ticket` with one open change for `prUrl` (no review): the landing a gate or
 * a PR read takes, for tests that read the PR and not the close-out's verdict. `harness` is a connected Mango harness.
 */
export async function landingRecordsStore(harness, { prUrl, ticket, urlKeys = ['ws-a'], head = 'deadbeef' }) {
  const store = await recordsStoreFor(harness);
  for (const urlKey of urlKeys) await seedTicketRecords(store, urlKey, ticket, [ev.pr(1, prUrl, head)]);
  return store;
}
