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
 * Results are HTTP-free: `{problems}` for a refused write (the caller answers 422 with refusalOf), `{record}` or
 * `{record, changed}` for a written one. A missing record throws RecordsNotFound; a version race throws
 * RecordsVersionConflict (both from ./errors.js, which the caller maps to a status). tests/unit/lin-4493-records-boundary.test.js
 * fails if another source file calls the store's write methods.
 */
import { checkAdd, checkRevise, checkEnd, checkLink, splitRef, KINDS } from './check.js';
import { looksLikeTicket, MAX_TICKET_DEPTH } from './refs.js';
import { RecordsNotFound } from './errors.js';

const LINK_TYPES = Object.keys(KINDS.links);

/** A run record ends when its dispatch row does (Harbour writes that); an agent may not end or revise it. */
export const RUN_ENDS_ITSELF = { field: 'id', message: 'a run ends when its dispatch row ends; Harbour writes that, not an agent', works: [] };

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
 */
export function createRecordWrites({ recordsStore, isTerminalState, readTicket = null, askedText = () => '', stageKinds = [], listPeople = async () => [] }) {
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
    const idx = await recordsStore.lookup(urlKey, recordIdsIn(input));
    const refs = ticketRefsIn(input).filter((ref) => !idx.has(ref));
    const infos = new Map();
    const planned = await ensureTickets(ctx, urlKey, refs, writerBy, { dryRun: true, infos });
    const dry = check(idx, planned);
    if (dry.problems.length) return dry;
    const made = await ensureTickets(ctx, urlKey, refs, writerBy, { infos });
    return check(idx, made);
  }

  /** The check's context: a reference resolves to a task or record in this workspace, or to a made ticket task. */
  function contextFor(urlKey, idx, tickets, people) {
    return {
      addressees: { stages: stageKinds, people },
      resolve(ref) {
        if (typeof ref !== 'string') return null;
        if (tickets.has(ref)) {
          const t = tickets.get(ref);
          return t.problem ? { problem: t.problem } : { kind: 'task', id: t.id };
        }
        const snap = idx.at(ref);
        return snap ? { kind: snap.kind, id: snap.id } : null;
      },
      currentVersion: (id) => idx.currentVersion(id),
      versionExists: (id, v) => Boolean(idx.versionOf(id, v))
    };
  }

  const viewed = (urlKey, snap) => recordsStore.viewOfRecord(urlKey, snap);

  return {
    /**
     * Add a record of `kind`. `input` is the flat body without `kind` and `run`. `fixedId`, when given, is the id the
     * record is made under; a record already under that id is returned as it is (the store's version index), so a
     * caller that makes a record and then ends another with it can retry without making a second one.
     * @returns {Promise<{record: object}|{problems: object[]}>}
     */
    async add({ ctx = null, urlKey, kind, input, by, run = null, via = null, fixedId = null, at }) {
      const people = await listPeople(urlKey);
      const checked = await checkWrite(ctx, urlKey, input, by, (idx, tickets) => checkAdd(kind, input, contextFor(urlKey, idx, tickets, people)));
      if (checked.problems.length) return { problems: checked.problems };
      const snap = await recordsStore.add(urlKey, checked.record, { by, run, via, fixedId, ...(at ? { at } : {}) });
      return { record: await viewed(urlKey, snap) };
    },

    /**
     * Revise a record: fields, `in`, `to` and links as the check allows. `reason` is required (carried in `input`).
     * @returns {Promise<{record: object}|{problems: object[]}>}
     */
    async revise({ ctx = null, urlKey, id, input, by, run = null }) {
      const prev = await recordsStore.current(urlKey, id);
      if (!prev) throw new RecordsNotFound(id);
      if (prev.kind === 'run') return { problems: [RUN_ENDS_ITSELF] };
      const people = await listPeople(urlKey);
      const checked = await checkWrite(ctx, urlKey, input, by, (idx, tickets) => checkRevise(prev, input, contextFor(urlKey, idx, tickets, people)));
      if (checked.problems.length) return { problems: checked.problems };
      await recordsStore.revise(urlKey, prev.id, checked.changes, { by, run, reason: input.reason });
      return { record: await viewed(urlKey, await recordsStore.current(urlKey, prev.id)) };
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
