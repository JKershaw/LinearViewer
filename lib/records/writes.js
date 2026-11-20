/**
 * LIN-4494 (piece 3): the one checked write path for records. Every writer goes through here: the proxy's routes
 * (routes/proxy-records.js, filed by a run), the signed-in session routes (routes/task-records.js, filed by a person's
 * account), the project page's actions (routes/project-page.js) and the one-off importer (scripts/records-import.mjs).
 * Nothing else calls RecordsStore.add/revise/end/link, since those check nothing (LIN-4493 review).
 *
 * This is the pipeline the proxy route ran in piece 2, moved out unchanged in behaviour: check the body, dry-run the
 * tickets it names (a dry run claims nothing and makes no task), make the tasks only when the dry run is clean, then
 * check again on the real tasks and write what that check returns. A refused body leaves no task behind.
 *
 * Callers pass `by` (the writer: `person:<accountId>`, a stage kind, `leftover`, or `import`) and `run` (a run id or
 * null). `by` is never read from a body here: the caller fills it from its credential (lib/run-lineage.js for a
 * dispatch credential, the session for a person). `ctx` is opaque to this module: it is handed to `readTicket` (the
 * proxy passes its request, so the tracker read stays in the caller's credential). A caller with no tracker passes no
 * `readTicket`, and a body that names a ticket is then refused with a problem, never guessed at.
 *
 * LIN-4503 (P3): after a record persists, the writer's outward steps run through the injected `tracker` port (see TrackerPort):
 * a child task gets its ticket (ensureChildTicket), a plan version its summary. Neither runs on a dry run or an import, and neither
 * can refuse the record: a failure is named in the answer (`ticket.error`, `summary.error`) and retried only by the next dispatch
 * of the parent (a ticket) or never (a summary).
 *
 * Results are HTTP-free: `{problems}` for a refused write (the caller answers 422 with refusalOf), `{record}` or
 * `{record, changed}` for a written one. A missing record throws RecordsNotFound; a version race throws
 * RecordsVersionConflict (both from ./errors.js, which the caller maps to a status). tests/unit/lin-4493-records-boundary.test.js
 * fails if another source file calls the store's write methods.
 */
import { checkAdd, checkRevise, checkEnd, checkLink, splitRef, KINDS } from './check.js';
import { looksLikeTicket, ticketTaskIdOf, MAX_TICKET_DEPTH } from './refs.js';
import { RecordsNotFound } from './errors.js';
import { summaryBodyOf } from './summary.js';
import { markedTaskOf, childTicketDescriptionOf, childTicketTitleOf } from './ticket-stub.js';

const LINK_TYPES = Object.keys(KINDS.links);

/** A run record ends when its dispatch row does (Harbour writes that); an agent may not end or revise it. */
export const RUN_ENDS_ITSELF = { field: 'id', message: 'a run ends when its dispatch row ends; Harbour writes that, not an agent', works: [] };

/**
 * LIN-4503 (P3): the writer Harbour's own outward steps file under (a child ticket's `ref`, which Harbour revises). A stage
 * kind or a person never has this name, so a record's `by` says which writes Harbour made.
 */
export const HARBOUR_WRITER = 'harbour';
const CHILD_TICKET_REASON = 'child ticket made by Harbour (ensureChildTicket)';

/**
 * One ticket step at a time per task, in this process: two steps for one task would both find no mark and both create.
 * Module scope, not per createRecordWrites: the proxy route, the session route and the dispatch retry each build their own
 * writer, and a session child-add racing a dispatch retry for one task must share one line (keyed by workspace and task).
 * (Across processes the claim is the guard: a second ref write for a claimed ticket is refused.)
 */
const inLine = new Map();
function serially(key, fn) {
  const prev = inLine.get(key) ?? Promise.resolve();
  const run = prev.then(() => fn());
  const tail = run.catch(() => {});
  inLine.set(key, tail);
  return run.finally(() => { if (inLine.get(key) === tail) inLine.delete(key); });
}

/**
 * LIN-4503: the tracker port the after-persist steps use. Injected once per writer as `tracker(ctx)`, which answers the
 * port for a request (or a dispatch's access): lib/records-tracker.js builds it over a provider. A writer with no tracker
 * passes none, and then no outward step runs (the importer and the project page: neither makes a child task).
 * @typedef {Object} TrackerPort
 * @property {(parentRef: string) => boolean} canParentLink - whether the tracker links a new ticket to a parent
 * @property {(parentRef: string) => Promise<{children: string[], capped: boolean|null}>} childrenOf - the parent's
 *   children (identifiers); `capped` is true or false when the tracker says, null when it does not (never a complete read)
 * @property {(parentRef: string, input: {title: string, description: string}) => Promise<{identifier: string}|{error: string, retryable: boolean}>} createChild
 * @property {(ref: string, body: string) => Promise<void>} comment - posts a comment on a ticket; throws on failure
 */

/** Every link value a body names, flat or under `links`. */
function linkValuesIn(input) {
  const values = [];
  for (const type of LINK_TYPES) {
    if (input[type] !== undefined) values.push(input[type]);
    if (input.links && input.links[type] !== undefined) values.push(input.links[type]);
  }
  return values;
}

/**
 * Every reference a body names that may be a ticket (in, to, and the link values). `looksLikeTicket` takes an
 * upper-case team key and a number only, so a lower-case record id is never one. checkWrite drops the references that
 * name an existing record before any is read as a ticket (LIN-4493 leftovers).
 */
function ticketRefsIn(input) {
  const refs = new Set();
  const take = (v) => { if (typeof v === 'string' && looksLikeTicket(v)) refs.add(v.trim()); };
  take(input.in);
  take(input.to);
  for (const v of linkValuesIn(input)) for (const x of [].concat(v)) take(typeof x === 'string' ? splitRef(x).id : x);
  return [...refs];
}

/** The record ids a body names (in, to, into, link targets), so the store reads just those. */
function recordIdsIn(input) {
  const raw = [input.in, input.to, input.into];
  for (const v of linkValuesIn(input)) raw.push(...[].concat(v));
  return raw.filter((x) => typeof x === 'string').map((x) => splitRef(x).id);
}

/** The refusal for a task whose ticket already has its task: the existing task is the one to reference. */
function taskRefTaken(ticket, taskId) {
  return { field: 'ref', message: `${ticket} already has its task (${taskId}); reference the ticket by in or to, not as a new task`, works: [taskId] };
}

/**
 * LIN-4496 (finding 58119935): a task that holds its ticket's claim keeps that ticket. Changing its `ref` would leave the
 * old claim on this task, so the old ticket's hand-offs (`in` or `to` naming it) would route into the new ticket's task.
 * A task moves to another ticket only by a new task for it, so the refusal names the held ticket and nothing is written.
 */
function refRebindRefused(ticket, taskId) {
  return { field: 'ref', message: `this task holds ${ticket} (${taskId}) and keeps it; to work on another ticket, make a new task for it`, works: [] };
}

/**
 * @param {Object} deps
 * @param {import('../records-store.js').RecordsStore} deps.recordsStore
 * @param {(stateType: string|null) => boolean} deps.isTerminalState - the provider state map's closed-state word (injected:
 *   this leaf imports only Platform, lib/providers/state-map.js is read by the caller)
 * @param {((ctx: any, ref: string) => Promise<object|null>)|null} [deps.readTicket] - the tracker read, by ticket
 *   identifier: the ticket's identifier, title, description, state and parent. Null when the caller has no tracker.
 * @param {(description: string) => string} [deps.askedText] - lib/as-asked.js askedText
 * @param {string[]} [deps.stageKinds] - STAGE_KINDS' keys
 * @param {(urlKey: string) => Promise<{accountId: string, name: string}[]>} [deps.listPeople] - the workspace-person reader
 * @param {((ctx: any) => Promise<TrackerPort|null>|TrackerPort|null)} [deps.tracker] - LIN-4503: the outward port, for ctx
 *   (null when the caller has none). Its steps run only after a record persists, and never on a dry run or an import.
 */
export function createRecordWrites({ recordsStore, isTerminalState, readTicket = null, askedText = () => '', stageKinds = [], listPeople = async () => [], tracker = null }) {
  if (typeof isTerminalState !== 'function') throw new Error('createRecordWrites needs isTerminalState (lib/providers/state-map.js)');

  /** The tracker's view of a ticket, as the store's task needs it: its words, whether it is closed, its parent's. */
  async function ticketInfo(ctx, ref, depth = 0) {
    const issue = await readTicket(ctx, ref);
    if (!issue) return null;
    const state = issue.state || {};
    // Closed is the provider state map's word (completed, canceled, duplicate), or a trashed ticket.
    const closed = isTerminalState(state.type) || issue.trashed === true;
    const info = {
      identifier: issue.identifier || ref,
      asked: askedText(issue.description || '') || '',
      closed,
      closedReason: closed ? (state.name || (issue.trashed ? 'Trashed' : null)) : null
    };
    const parentRef = issue.parent?.identifier;
    if (parentRef && depth < MAX_TICKET_DEPTH) info.parent = await ticketInfo(ctx, parentRef, depth + 1);
    return info;
  }

  /** The tracker's view of a ticket, or why it has none: no tracker here, the read failed, or the ticket is unreadable. */
  async function readInfo(ctx, ref) {
    if (!readTicket) return { unreadable: `${ref} cannot be read from a tracker by this writer` };
    try {
      return (await ticketInfo(ctx, ref)) ?? { unreadable: `${ref} is not a ticket this workspace can read` };
    } catch (err) {
      // The tracker is unreachable: the ticket is named as unreadable, never guessed at.
      return { unreadable: `${ref} could not be read from the tracker (${err?.message || 'unavailable'})` };
    }
  }

  /**
   * Make (or, with `dryRun`, plan) the task for every ticket a body names. Returns Map ref -> {id} | {problem}. A
   * ticket Harbour cannot read is named as such; a closed one is refused with its reason (decision 5). `infos`
   * caches the tracker reads between a dry run and the real one.
   */
  async function ensureTickets(ctx, urlKey, refs, writerBy, { dryRun = false, infos = new Map() } = {}) {
    const made = new Map();
    for (const ref of refs) {
      const existing = await recordsStore.taskForTicket(urlKey, ref);
      if (existing) { made.set(ref, { id: existing }); continue; }
      if (!infos.has(ref)) infos.set(ref, await readInfo(ctx, ref));
      const info = infos.get(ref);
      if (info.unreadable) { made.set(ref, { problem: info.unreadable }); continue; }
      made.set(ref, await recordsStore.ensureTask(urlKey, info, { by: writerBy, dryRun }));
    }
    return made;
  }

  /**
   * Check a write, then make the tasks its tickets name. The check runs first on a dry run of the tickets, which
   * writes nothing, so a refused body leaves no task behind. Only a clean dry run makes the real tasks, and the
   * check runs again on those: its result is the one written.
   * @returns {Promise<object>} the check's result (`problems`, and `record`/`changes`/`links` when clean)
   */
  async function checkWrite(ctx, urlKey, input, writerBy, check) {
    const { idx, refs, infos, dry } = await dryCheckWrite(ctx, urlKey, input, writerBy, check);
    if (dry.problems.length) return dry;
    const made = await ensureTickets(ctx, urlKey, refs, writerBy, { infos });
    return check(idx, made);
  }

  /**
   * The dry half of checkWrite, which writes nothing: read the records the body names, plan the tasks its tickets would
   * get, and run the check on that plan. `check()` (the import's dry run) stops here; checkWrite goes on to make the tasks.
   * @returns {Promise<{idx: object, refs: string[], infos: Map, dry: object}>} `infos` is the tracker reads, kept for the real run
   */
  async function dryCheckWrite(ctx, urlKey, input, writerBy, check) {
    const idx = await recordsStore.lookup(urlKey, recordIdsIn(input));
    const refs = ticketRefsIn(input).filter((ref) => !idx.has(ref));
    const infos = new Map();
    const planned = await ensureTickets(ctx, urlKey, refs, writerBy, { dryRun: true, infos });
    return { idx, refs, infos, dry: check(idx, planned) };
  }

  /**
   * The check's context: a reference resolves to a task or record in this workspace, or to a made ticket task. `planned`
   * (LIN-4496, the import's dry run) maps the ids an earlier write of the same dry run would have made to their kinds, so a
   * record that names one of them resolves as it would after that write. Nothing is stored for it.
   */
  function contextFor(urlKey, idx, tickets, people, planned = new Map()) {
    return {
      addressees: { stages: stageKinds, people },
      resolve(ref) {
        if (typeof ref !== 'string') return null;
        if (tickets.has(ref)) {
          const t = tickets.get(ref);
          return t.problem ? { problem: t.problem } : { kind: 'task', id: t.id };
        }
        if (planned.has(ref)) return { kind: planned.get(ref), id: ref };
        const snap = idx.at(ref);
        return snap ? { kind: snap.kind, id: snap.id } : null;
      },
      currentVersion: (id) => idx.currentVersion(id),
      versionExists: (id, v) => Boolean(idx.versionOf(id, v))
    };
  }

  const viewed = (urlKey, snap) => recordsStore.viewOfRecord(urlKey, snap);

  /** A task written with a ticket as its `ref` is that ticket's one task: the one predicate `check` and `add` share. */
  const isTicketTask = (kind, input) => kind === 'task' && typeof input.ref === 'string' && looksLikeTicket(input.ref);

  /**
   * The one home of the "ticket already has its task" check: a ticket claimed for a task other than `taskId` that exists
   * as a record is refused, naming that task. Null when the ticket is unclaimed, claimed for `taskId`, or claimed for a
   * task not yet written (a claim left by a write that failed after it).
   */
  async function ticketTaskRefusal(urlKey, ticket, taskId = null) {
    const claimed = await recordsStore.claimOf(urlKey, ticket);
    return claimed && claimed !== taskId && await recordsStore.taskForTicket(urlKey, ticket) ? taskRefTaken(ticket, claimed) : null;
  }

  /**
   * LIN-4496: a task whose `ref` is a ticket holds that ticket's claim (the one task per ticket). `taskId` is the task
   * the claim is for: a new task's id from add, or the revised task's own id. Returns the refusal, or null when the
   * claim is the task's. A ticket claimed for another task that already exists is refused, naming it.
   */
  async function claimTaskTicket(urlKey, ticket, taskId) {
    const taken = await ticketTaskRefusal(urlKey, ticket, taskId);
    if (taken) return taken;
    const holder = await recordsStore.claimTicket(urlKey, ticket, taskId);
    return holder === taskId ? null : taskRefTaken(ticket, holder);
  }

  // ---- LIN-4503: the outward half, after a record persists ----------------------------------------------------
  // Records persist first; these steps run after, and never on a dry run (`check`) or an import (`via: import`).

  /** The tracker port for ctx, or null when the writer has none. */
  const portOf = async (ctx) => (tracker ? await tracker(ctx) : null);

  /** A tracker read that is absent (no read here) or fails throws; a ticket the tracker does not know is null. */
  async function readOrNull(ctx, ref) {
    if (!readTicket) throw new Error('this writer cannot read tickets');
    return readTicket(ctx, ref);
  }

  /** Revise a task to take `identifier` as its ref (which claims it). A refusal or a throw names the ticket, never hides it. */
  async function adoptTicket(ctx, urlKey, taskId, identifier) {
    try {
      const out = await reviseRecord({ ctx, urlKey, id: taskId, input: { ref: identifier, reason: CHILD_TICKET_REASON }, by: HARBOUR_WRITER });
      if (out.problems) return { identifier, error: `${identifier} is made but the task's ref did not write: ${out.problems[0].message}`, retryable: true };
      return { identifier };
    } catch (err) {
      return { identifier, error: `${identifier} is made but the task's ref did not write (${err?.message || 'failed'}); the next dispatch finds it by its mark`, retryable: true };
    }
  }

  /**
   * ensureChildTicket (LIN-4503): give an open child task its ticket, once. A child is a task with a parent task (`in`) and no
   * `ref`. In order, and creating nothing unless every check holds: the parent task has a ticket; the tracker links a child to
   * it; its children are read whole (`capped === false`, never null); and no child carries this task's mark. Every child is
   * checked, claimed or not, so a ticket made by an earlier step whose ref write failed is found, not made again. A child with
   * the mark that another task holds is refused and named, never taken. A child with the mark that this task holds (or none
   * holds) is adopted as the task's ref. Otherwise the ticket is created under the parent and then taken as the ref.
   * @returns {Promise<null|{identifier?: string, error?: string, retryable?: boolean, existing?: boolean}>} null when the task needs
   *   no ticket (not a child, ended, or already has a ref)
   */
  function ensureChildTicket(ctx, urlKey, taskId, port) {
    return serially(`${urlKey}::${taskId}`, () => ensureChildTicketNow(ctx, urlKey, taskId, port));
  }

  async function ensureChildTicketNow(ctx, urlKey, taskId, port) {
    const task = await recordsStore.current(urlKey, taskId);
    if (!task || task.kind !== 'task' || task.ended || !task.in) return null;
    if (task.fields?.ref) return { identifier: task.fields.ref, existing: true };
    const parentRef = (await recordsStore.current(urlKey, task.in))?.fields?.ref ?? null;
    if (!parentRef) return { error: `the parent task ${task.in} has no ticket, so a child ticket has nothing to link to; none made` };
    if (!port) return { error: 'this writer has no tracker, so no child ticket is made' };
    if (!(await port.canParentLink(parentRef))) return { error: `the tracker cannot link a child ticket to ${parentRef}; none made, since an unlinked ticket could not be found again` };
    let listed;
    try {
      listed = await port.childrenOf(parentRef);
    } catch (err) {
      return { error: `the children of ${parentRef} could not be read (${err?.message || 'unavailable'}); none made` };
    }
    if (listed?.capped !== false) return { error: `the children of ${parentRef} are capped, or the tracker does not say whether they are all read; none made` };
    for (const child of listed.children) {
      let issue;
      try {
        issue = await readOrNull(ctx, child);
      } catch (err) {
        return { identifier: child, error: `${child} could not be read to check its mark (${err?.message || 'unavailable'}); none made` };
      }
      if (markedTaskOf(issue?.description) !== taskId) continue;
      const holder = await recordsStore.claimOf(urlKey, child);
      if (holder && holder !== taskId) return { identifier: child, error: `${child} carries this task's mark but belongs to ${holder}; no ticket is made and ownership is not taken` };
      return adoptTicket(ctx, urlKey, taskId, child);
    }
    const piece = typeof task.links?.piece === 'string' ? task.links.piece : null;
    const doneWhen = task.fields?.['done-when'] || '';
    let made;
    try {
      made = await port.createChild(parentRef, {
        title: childTicketTitleOf({ parentRef, taskId, doneWhen }),
        description: childTicketDescriptionOf({ parentRef, taskId, piece, doneWhen })
      });
    } catch (err) {
      return { error: `the child ticket was not made (${err?.message || 'unavailable'})`, retryable: true };
    }
    if (made?.error) return { error: made.error, retryable: made.retryable !== false };
    return adoptTicket(ctx, urlKey, taskId, made.identifier);
  }

  /** ensureChildTicket for one task, answering every failure as `{error}` (a tracker that cannot be reached is not a write failure). */
  async function ensureChildTicketFor(ctx, urlKey, taskId) {
    let port;
    try {
      port = await portOf(ctx);
    } catch (err) {
      return { error: `the tracker could not be reached (${err?.message || 'unavailable'}); none made`, retryable: true };
    }
    try {
      return await ensureChildTicket(ctx, urlKey, taskId, port);
    } catch (err) {
      return { error: `the child ticket step failed (${err?.message || 'failed'})`, retryable: true };
    }
  }

  /**
   * The marked summary of a plan version (LIN-4503), posted on the ticket of the plan's task. Best effort: a failure is named
   * in the answer and logged, and never retried, since a retry could post the same version twice.
   */
  async function postSummary(ctx, urlKey, plan, change) {
    if (!plan.in) return { skipped: `${plan.id} names no task, so it has no ticket to post on` };
    const ticket = (await recordsStore.current(urlKey, plan.in))?.fields?.ref ?? null;
    if (!ticket) return { skipped: `${plan.in} has no ticket to post on` };
    let port;
    try {
      port = await portOf(ctx);
    } catch (err) {
      return { ticket, error: `the tracker could not be reached (${err?.message || 'unavailable'}); the summary is not posted and not retried` };
    }
    if (!port) return { skipped: 'this writer has no tracker to post with' };
    try {
      await port.comment(ticket, summaryBodyOf(plan, change));
      return { ticket, posted: true, v: plan.v };
    } catch (err) {
      console.warn(`[records] summary of ${plan.id} v${plan.v} on ${ticket} was not posted: ${err?.message || err}`);
      return { ticket, error: `the summary of ${plan.id} v${plan.v} was not posted (${err?.message || 'failed'}); it is not retried` };
    }
  }

  /** The outward steps after an add: a child task's ticket, a plan's summary. An import makes neither. */
  async function outwardAfterAdd(ctx, urlKey, snap, via) {
    if (via === 'import') return {};
    if (snap.kind === 'task' && snap.in && !snap.fields?.ref) {
      const ticket = await ensureChildTicketFor(ctx, urlKey, snap.id);
      return ticket ? { ticket } : {};
    }
    if (snap.kind === 'plan') return { summary: await postSummary(ctx, urlKey, snap, null) };
    return {};
  }

  /**
   * The checked add, persisted, with no outward step. `add` runs the steps after it. Returns `{problems}` or `{snap}`.
   */
  async function addRecord({ ctx = null, urlKey, kind, input, by, run = null, via = null, fixedId = null, at }) {
    const people = await listPeople(urlKey);
    const checked = await checkWrite(ctx, urlKey, input, by, (idx, tickets) => checkAdd(kind, input, contextFor(urlKey, idx, tickets, people)));
    if (checked.problems.length) return { problems: checked.problems };
    let id = fixedId;
    if (isTicketTask(kind, input)) {
      // LIN-4496: a task made with a ticket `ref` is the ticket's one task. It claims the ticket as ensureTask does, so a
      // later `in` or `to` naming the ticket finds this task and makes no second one; a ticket that already has its task
      // is refused, naming it (the same check as `check`). The task's id is the claim's (or ticketTaskIdOf for a new claim),
      // not a caller's fixedId. The refusal runs once, here; the claim after it is the store's insert-only claimTicket, whose
      // holder answers a race (a claim made by another request between the check and the insert).
      const taken = await ticketTaskRefusal(urlKey, input.ref);
      if (taken) return { problems: [taken] };
      const taskId = (await recordsStore.claimOf(urlKey, input.ref)) ?? ticketTaskIdOf(input.ref);
      const holder = await recordsStore.claimTicket(urlKey, input.ref, taskId);
      if (holder !== taskId) return { problems: [taskRefTaken(input.ref, holder)] };
      id = taskId;
    }
    const snap = await recordsStore.add(urlKey, checked.record, { by, run, via, fixedId: id, ...(at ? { at } : {}) });
    return { snap };
  }

  /** The checked revise, persisted, with no outward step. Returns `{problems}` or `{record, prev}`. */
  async function reviseRecord({ ctx = null, urlKey, id, input, by, run = null }) {
    const prev = await recordsStore.current(urlKey, id);
    if (!prev) throw new RecordsNotFound(id);
    if (prev.kind === 'run') return { problems: [RUN_ENDS_ITSELF] };
    const people = await listPeople(urlKey);
    const checked = await checkWrite(ctx, urlKey, input, by, (idx, tickets) => checkRevise(prev, input, contextFor(urlKey, idx, tickets, people)));
    if (checked.problems.length) return { problems: checked.problems };
    // LIN-4496 (finding 58119935): a task that holds its ticket's claim may not change its `ref` (see refRebindRefused).
    if (prev.kind === 'task' && input.ref !== undefined && input.ref !== prev.fields?.ref && looksLikeTicket(prev.fields?.ref)
      && await recordsStore.claimOf(urlKey, prev.fields.ref) === prev.id) {
      return { problems: [refRebindRefused(prev.fields.ref, prev.id)] };
    }
    // LIN-4496 (finding 869357bd): a task revised to a ticket `ref` claims that ticket, as add does. Without it a later
    // `in`/`to` naming the ticket made a second task. Only a changed ref claims; the claim is for this task.
    if (prev.kind === 'task' && typeof input.ref === 'string' && looksLikeTicket(input.ref) && input.ref !== prev.fields?.ref) {
      const refused = await claimTaskTicket(urlKey, input.ref, prev.id);
      if (refused) return { problems: [refused] };
    }
    await recordsStore.revise(urlKey, prev.id, checked.changes, { by, run, reason: input.reason });
    return { record: await viewed(urlKey, await recordsStore.current(urlKey, prev.id)) };
  }

  return {
    /**
     * LIN-4496 (finding 9c9caeb5): the answer `add` would give, with nothing written: the same check, the same tickets
     * read as a dry run, and the same task-ref claim refusal. A dry run calls this so a refusal shows before `--apply`.
     * `planned` maps the ids of earlier records in the same dry run to their kinds (see contextFor).
     * @returns {Promise<{problems: object[]}>}
     */
    async check({ ctx = null, urlKey, kind, input, by, planned = new Map() }) {
      const people = await listPeople(urlKey);
      const { dry } = await dryCheckWrite(ctx, urlKey, input, by, (idx, tickets) => checkAdd(kind, input, contextFor(urlKey, idx, tickets, people, planned)));
      if (dry.problems.length) return { problems: dry.problems };
      if (isTicketTask(kind, input)) {
        const taken = await ticketTaskRefusal(urlKey, input.ref);
        if (taken) return { problems: [taken] };
      }
      return { problems: [] };
    },

    /**
     * Add a record of `kind`. `input` is the flat body without `kind` and `run`. `fixedId`, when given, is the id the
     * record is made under; a record already under that id is returned as it is (the store's version index), so a
     * caller that makes a record and then ends another with it can retry without making a second one.
     * A persisted child task gets its ticket (`ticket` in the answer); a persisted plan gets its summary (`summary`).
     * Neither runs for `via: 'import'`, and neither can refuse the record: a failure is named in the answer.
     * @returns {Promise<{record: object, ticket?: object, summary?: object}|{problems: object[]}>}
     */
    async add({ ctx = null, urlKey, kind, input, by, run = null, via = null, fixedId = null, at }) {
      const written = await addRecord({ ctx, urlKey, kind, input, by, run, via, fixedId, at });
      if (written.problems) return { problems: written.problems };
      const record = await viewed(urlKey, written.snap);
      return { record, ...(await outwardAfterAdd(ctx, urlKey, written.snap, via)) };
    },

    /**
     * Revise a record: fields, `in`, `to` and links as the check allows. `reason` is required (carried in `input`).
     * A revised plan posts its new version's summary (`summary`).
     * @returns {Promise<{record: object, summary?: object}|{problems: object[]}>}
     */
    async revise({ ctx = null, urlKey, id, input, by, run = null }) {
      const out = await reviseRecord({ ctx, urlKey, id, input, by, run });
      if (out.problems) return { problems: out.problems };
      if (out.record.kind !== 'plan') return { record: out.record };
      const summary = await postSummary(ctx, urlKey, await recordsStore.current(urlKey, id), { reason: input.reason });
      return { record: out.record, summary };
    },

    /**
     * LIN-4503: the retry on each parent dispatch. Every open child task of the parent ticket's task that has no ticket gets
     * the ticket step, the same one a write runs. Returns one answer per task tried (none when the parent has no task yet).
     * `ctx` is whatever the tracker port is built from (a request, or a dispatch's access).
     */
    async retryChildTickets({ ctx = null, urlKey, parentRef }) {
      const parent = await recordsStore.taskForTicket(urlKey, parentRef);
      if (!parent) return [];
      const open = await recordsStore.find(urlKey, { kind: 'task', state: 'open', inRef: parent });
      const out = [];
      for (const child of open) {
        if (child.fields?.ref) continue;
        out.push({ task: child.id, ...(await ensureChildTicketFor(ctx, urlKey, child.id)) });
      }
      return out;
    },

    /**
     * End a record. Ending a record already in an end returns it unchanged, with who ended it (api-review 3).
     * @returns {Promise<{record: object, changed: boolean, endedBy?: string}|{problems: object[]}>}
     */
    async end({ urlKey, id, input, by, run = null }) {
      const prev = await recordsStore.current(urlKey, id);
      if (!prev) throw new RecordsNotFound(id);
      if (prev.ended) return { record: await viewed(urlKey, prev), changed: false, endedBy: prev.by };
      if (prev.kind === 'run') return { problems: [RUN_ENDS_ITSELF] };
      const idx = await recordsStore.lookup(urlKey, recordIdsIn(input));
      const { problems } = checkEnd(prev, input, contextFor(urlKey, idx, new Map(), await listPeople(urlKey)));
      if (problems.length) return { problems };
      const out = await recordsStore.end(urlKey, prev.id, { state: input.state, reason: input.reason, into: input.into ?? null }, { by, run });
      return { record: await viewed(urlKey, out.record), changed: out.changed };
    },

    /**
     * Add links to a record. `links` is the link object (`{type: id | id[]}`), as the proxy's link route reads it.
     * @returns {Promise<{record: object}|{problems: object[]}>}
     */
    async link({ ctx = null, urlKey, id, links, by, run = null }) {
      const prev = await recordsStore.current(urlKey, id);
      if (!prev) throw new RecordsNotFound(id);
      const people = await listPeople(urlKey);
      const checked = await checkWrite(ctx, urlKey, { links }, by, (idx, tickets) => checkLink(prev, links, contextFor(urlKey, idx, tickets, people)));
      if (checked.problems.length) return { problems: checked.problems };
      await recordsStore.link(urlKey, prev.id, checked.links, { by, run });
      return { record: await viewed(urlKey, await recordsStore.current(urlKey, prev.id)) };
    },

    /**
     * Ticket references a body names that need a tracker read (the rest are records, or no ticket at all). Exposed so a
     * caller that answers before writing (the importer's dry run) can report them.
     */
    ticketRefsIn,
    recordIdsIn
  };
}
