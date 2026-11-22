/**
 * LIN-4493 (layer design §3.1, integration design §1): the records store. The one file that touches the
 * database for Records; everything under lib/records/ is pure and reads the snapshots this store returns.
 *
 * Storage: one collection, `records`, one document per VERSION. A write never updates a document: it adds
 * the next version of a record (`v + 1`), so every version is kept. The document id is
 * `${urlKey}::${id}::${v}`, and the unique index on `{urlKey, id, v}` (lib/db-indexes.js) makes two writers of
 * the same version collide: the second gets a RecordsVersionConflict and the route answers 409, so the
 * version order is the database's, not the arrival order's.
 *
 * The current version of a record is its highest `v`. Every read (views, briefs, find, show) reads the
 * workspace's snapshots once and reduces them with lib/records/views.js, so an ended record is never
 * served from a stale copy: there is no cache.
 *
 * Ids: a record's id is store-generated, `${kind}-${8 hex}`. A run's id is its dispatch row's `_id`, the
 * caller's (lib/run-identity.js), so the two spaces do not meet.
 *
 * Tickets and tasks (integration §2): `ensureTask` makes the task record for a ticket once, and a task written with
 * the ticket as its `ref` claims it the same way (lib/records/writes.js, LIN-4496). The claim is a
 * document in `records-refs`, `{urlKey, ticket, taskId}`, under a unique index on `{urlKey, ticket}`: inserting it
 * is the atomic step, so concurrent references to the same new ticket get one task. (MangoDB does not enforce `_id`
 * uniqueness without an index, so the claim does not rely on it.) The task's first version is then written
 * idempotently, under the version index.
 *
 * Runs (decision 2c): a run record opens when its dispatch row is taken and ends when that row stops being live
 * (lib/run-records.js). Taking a resume or a wake row writes a new `open` version of its run; every version is kept.
 *
 * The query log (`records-query-log`) keeps who asked what, for piece 5's readings. It has no TTL index
 * (lib/db-indexes.js bans them): each row carries `expiresAt`, and the hourly cleanup removes the expired ones.
 *
 * Imports only Platform (lib/records/* and the database handle). Callers inject the tracker read and the
 * askedText reader (lib/asked-of.js askedOf); this module never reaches for them.
 */
import { randomBytes } from 'node:crypto';
import { index as buildIndex, viewOf } from './records/views.js';
import { KINDS, splitRef } from './records/check.js';
import { RecordsVersionConflict, RecordsNotFound } from './records/errors.js';
import { looksLikeTicket, ticketTaskIdOf, MAX_TICKET_DEPTH } from './records/refs.js';
import { planFactsOf, currentPieceOf, PLAN_REVIEW } from './records/plan-facts.js';
import { planReviewRunOf, PLAN_FINDING_TO, PLAN_REVIEW_JUDGEMENT } from './records/plan-review-run.js';
import { CLOSE_OUT_STAGE } from './records/words.js';
import { verdictFactsFromRecords } from './records/verdict-facts.js';

export { RecordsVersionConflict, RecordsNotFound, looksLikeTicket, MAX_TICKET_DEPTH };

export const RECORDS_COLLECTION = 'records';
export const REFS_COLLECTION = 'records-refs';
export const QUERY_LOG_COLLECTION = 'records-query-log';

/** How long a query-log row lives. Piece 5's "how long each sat" reading needs at least this window. */
export const QUERY_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Links only add: a list type appends, a single-id type is replaced (integration §2, api-review 7). */
export function mergeLinks(current = {}, incoming = {}) {
  const merged = { ...current };
  for (const [type, value] of Object.entries(incoming)) {
    if (value === null || value === undefined) { delete merged[type]; continue; }
    merged[type] = KINDS.links[type]?.list ? [...new Set([...(merged[type] || []), ...[].concat(value)])] : value;
  }
  return merged;
}

const isDuplicateKey = (err) => err?.code === 11000 || /duplicate key/i.test(String(err?.message || ''));
const docOf = (urlKey, snap) => ({ _id: `${urlKey}::${snap.id}::${snap.v}`, urlKey, ...snap });
const snapOf = (doc) => {
  const { _id, urlKey, ...snap } = doc;
  void _id; void urlKey;
  return snap;
};

/** The task a ticket is planned to have, in a dry run that writes nothing (see ensureTask). Never stored. */
export const PLANNED_TASK = 'task-planned';


/** The record ids a snapshot names: its `in`, `to`, a close's `into`, and every link target (an id, or id@v). */
export function refIdsOf(snap) {
  const ids = [];
  const take = (ref) => { if (typeof ref === 'string' && ref) ids.push(splitRef(ref).id); };
  take(snap.in);
  take(snap.to);
  take(snap.ended?.into);
  for (const value of Object.values(snap.links || {})) for (const x of [].concat(value)) take(x);
  return ids;
}

export class RecordsStore {
  /**
   * @param {Object} deps
   * @param {Object} deps.records - the `records` collection
   * @param {Object} deps.refs - the `records-refs` collection (ticket claims)
   * @param {Object} deps.queryLog - the `records-query-log` collection
   * @param {() => Date} [deps.now]
   */
  constructor({ records, refs, queryLog, now = () => new Date() }) {
    if (!records || !refs || !queryLog) throw new Error('RecordsStore needs the records, refs and queryLog collections');
    this.records = records;
    this.refs = refs;
    this.queryLog = queryLog;
    this.now = now;
  }

  /**
   * Every version of every record in one workspace, as snapshots. Reads the whole workspace: only the brief's
   * composition (which needs every record) calls it. Writes and the proxy's reads go through the targeted
   * readers below, so their cost does not grow with the workspace's history.
   */
  async snapshots(urlKey) {
    const docs = await this.records.find({ urlKey }).toArray();
    return docs.map(snapOf).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.v - b.v));
  }

  /** The views index over one workspace (lib/records/views.js). Whole-workspace: see snapshots. */
  async index(urlKey) {
    return buildIndex(await this.snapshots(urlKey));
  }

  /** Every version of the named records in one workspace: one read, through the {urlKey, id, v} index. */
  async versionsOf(urlKey, ids) {
    const wanted = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
    if (!wanted.length) return [];
    const docs = await this.records.find({ urlKey, id: { $in: wanted } }).toArray();
    return docs.map(snapOf);
  }

  /**
   * One record's versions (ascending) and the one asked for: version `v`, or the version current at `asOf`, or the
   * current one. `snap` is null when no such version exists.
   */
  async read(urlKey, id, { v, asOf } = {}) {
    const versions = (await this.versionsOf(urlKey, [id])).sort((a, b) => a.v - b.v);
    const idx = buildIndex(versions);
    const snap = v !== undefined ? idx.versionOf(id, v) : idx.at(id, asOf);
    return { snap, versions };
  }

  /**
   * A views index over the named records (every version of each), for a write's checks and a view's flags. With
   * `decisions`, every decision is included too, so a question's standing answer can be found (lib/records/views.js).
   */
  async lookup(urlKey, ids, { decisions = false } = {}) {
    const wanted = new Set(ids.filter((id) => typeof id === 'string' && id));
    if (decisions) {
      const docs = await this.records.find({ urlKey, kind: 'decision' }, { projection: { id: 1 } }).toArray();
      for (const d of docs) wanted.add(d.id);
    }
    return buildIndex(await this.versionsOf(urlKey, [...wanted]));
  }

  /** The view of one snapshot (lib/records/views.js viewOf), with the records it names read alongside it. */
  async viewOfRecord(urlKey, snap, asOf) {
    const idx = await this.lookup(urlKey, [snap.id, ...refIdsOf(snap)], { decisions: snap.kind === 'question' });
    return viewOf(snap, idx, asOf);
  }

  /** The views of many snapshots, reading their referenced records once between them. */
  async viewsOf(urlKey, snaps, asOf) {
    if (!snaps.length) return [];
    const ids = snaps.flatMap((s) => [s.id, ...refIdsOf(s)]);
    const idx = await this.lookup(urlKey, ids, { decisions: snaps.some((s) => s.kind === 'question') });
    return snaps.map((s) => viewOf(s, idx, asOf));
  }

  /**
   * The current versions (or those current at `asOf`) matching a filter, read through the declared indexes
   * (lib/db-indexes.js: {urlKey, kind, state, to} and {urlKey, in}). The indexed fields of EVERY version of a
   * record can select it as a candidate; its versions are then read and reduced, so it matches only on the
   * version that is current. `inRef` null means "no task" (the project); a string is one task; an array (LIN-4504) is
   * any of those tasks, read in one query (`$in`, as versionsOf reads ids), and an empty array matches nothing.
   */
  async find(urlKey, { kind, state, to, inRef, asOf, text } = {}) {
    const inList = Array.isArray(inRef) ? [...new Set(inRef.filter((t) => typeof t === 'string' && t))] : null;
    if (inList && !inList.length) return [];
    const query = { urlKey };
    if (kind) query.kind = kind;
    if (state) query.state = state;
    if (to) query.to = to;
    if (inList) query.in = { $in: inList };
    else if (inRef !== undefined) query.in = inRef;
    const candidates = await this.records.find(query, { projection: { id: 1 } }).toArray();
    const idx = buildIndex(await this.versionsOf(urlKey, [...new Set(candidates.map((d) => d.id))]));
    const needle = typeof text === 'string' ? text.toLowerCase() : null;
    return idx.all(asOf).filter((r) => (!kind || r.kind === kind)
      && (!state || r.state === state)
      && (!to || r.to === to)
      && (inRef === undefined || (inList ? inList.includes(r.in) : inRef === null ? !r.in : r.in === inRef))
      && (!needle || Object.values(r.fields || {}).join('\n').toLowerCase().includes(needle)));
  }

  async #append(urlKey, snap) {
    try {
      await this.records.insertOne(docOf(urlKey, snap));
    } catch (err) {
      if (isDuplicateKey(err)) throw new RecordsVersionConflict(snap.id);
      throw err;
    }
    return snap;
  }

  /** A new store-generated id, not yet used in the workspace. */
  async #freshId(urlKey, kind) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = `${kind}-${randomBytes(4).toString('hex')}`;
      const taken = await this.records.findOne({ urlKey, id });
      if (!taken) return id;
    }
    throw new Error(`could not allocate a ${kind} id`);
  }

  /**
   * Add a record. `shape` is the checked record from lib/records/check.js: kind, fields, state, in?, to?, links.
   * @returns {Promise<object>} the new version (snapshot)
   */
  async add(urlKey, shape, { by, via = null, run = null, at = this.now().toISOString(), fixedId = null }) {
    if (fixedId) {
      // LIN-4494: a record made under a known id (a finding's task, an imported entry). The version index makes a
      // second make of v1 a conflict, and that conflict means the record is already there: it is returned as it is.
      try {
        await this.#append(urlKey, this.#snap({ id: fixedId, v: 1, op: 'add', shape, by, via, run, at }));
      } catch (err) {
        if (!(err instanceof RecordsVersionConflict)) throw err;
      }
      return this.#current(urlKey, fixedId);
    }
    let id = null;
    for (let attempt = 0; attempt < 3 && !id; attempt++) {
      const candidate = await this.#freshId(urlKey, shape.kind);
      try {
        await this.#append(urlKey, this.#snap({ id: candidate, v: 1, op: 'add', shape, by, via, run, at }));
        id = candidate;
      } catch (err) {
        if (!(err instanceof RecordsVersionConflict)) throw err;
      }
    }
    if (!id) throw new Error('could not allocate a record id');
    return this.#current(urlKey, id);
  }

  #snap({ id, v, op, shape, by, via, at, run = null, base = null, reason = null }) {
    const snap = {
      id,
      v,
      op,
      kind: shape.kind ?? base?.kind,
      at,
      by,
      state: shape.state ?? base?.state,
      // A shape's links are the record's links as they stand after the write (callers merge; see revise and link).
      links: shape.links ?? base?.links ?? {},
      fields: { ...(base?.fields || {}), ...(shape.fields || {}) }
    };
    if (shape.in !== undefined) snap.in = shape.in;
    else if (base?.in !== undefined) snap.in = base.in;
    if (shape.to !== undefined) snap.to = shape.to;
    else if (base?.to !== undefined) snap.to = base.to;
    if (via) snap.via = via;
    if (run) snap.run = run;
    if (reason) snap.reason = reason;
    if (base?.ended) snap.ended = base.ended;
    if (base?.lineage) snap.lineage = base.lineage;
    for (const k of Object.keys(snap.fields)) if (snap.fields[k] === null) delete snap.fields[k];
    return snap;
  }

  async #current(urlKey, id) {
    const docs = await this.records.find({ urlKey, id }).toArray();
    if (!docs.length) return null;
    return docs.map(snapOf).sort((a, b) => b.v - a.v)[0];
  }

  /** The current version of a record, or null. */
  async current(urlKey, id) {
    return this.#current(urlKey, id);
  }

  /** The version of `id` that was current at `asOf`, or null. */
  async currentAt(urlKey, id, asOf) {
    const idx = await this.index(urlKey);
    return idx.at(id, asOf);
  }

  /**
   * Revise a record: new version, its fields and links merged, `reason` kept on the version. `changes` is the
   * checked change set from checkRevise: {fields, in?, to?, links}. A null field removes it.
   */
  async revise(urlKey, id, changes, { by, via = null, run = null, at = this.now().toISOString(), reason }) {
    const base = await this.#current(urlKey, id);
    if (!base) throw new RecordsNotFound(id);
    const shape = { fields: changes.fields || {}, links: mergeLinks(base.links, changes.links || {}) };
    if (changes.in !== undefined) shape.in = changes.in;
    if (changes.to !== undefined) shape.to = changes.to === null ? undefined : changes.to;
    const snap = this.#snap({ id, v: base.v + 1, op: 'revise', shape, by, via, run, at, base, reason });
    if (changes.to === null) delete snap.to;
    await this.#append(urlKey, snap);
    return this.#current(urlKey, id);
  }

  /**
   * End a record. Ending a record already in an end returns it unchanged (api-review 3), so the caller can
   * answer it as it is.
   * @returns {Promise<{record: object, changed: boolean}>}
   */
  async end(urlKey, id, { state, reason, into = null }, { by, via = null, run = null, at = this.now().toISOString() }) {
    const base = await this.#current(urlKey, id);
    if (!base) throw new RecordsNotFound(id);
    if (base.ended) return { record: base, changed: false };
    const snap = this.#snap({ id, v: base.v + 1, op: 'end', shape: {}, by, via, run, at, base });
    snap.state = state;
    snap.ended = into ? { reason, into } : { reason };
    await this.#append(urlKey, snap);
    return { record: await this.#current(urlKey, id), changed: true };
  }

  /** Add links to a record (a list type adds; a single-id type replaces). */
  async link(urlKey, id, links, { by, via = null, run = null, at = this.now().toISOString() }) {
    const base = await this.#current(urlKey, id);
    if (!base) throw new RecordsNotFound(id);
    const snap = this.#snap({ id, v: base.v + 1, op: 'link', shape: { links: mergeLinks(base.links, links) }, by, via, run, at, base });
    await this.#append(urlKey, snap);
    return this.#current(urlKey, id);
  }

  /**
   * The task record for a ticket, made once (integration §2, decision 5). `info` comes from the tracker read:
   * {identifier, asked, closed, closedReason?, parent?: {identifier, ...}}, where `parent` is the parent ticket's
   * info (recursively, the same shape). A closed ticket is refused: `{problem}`.
   *
   * LIN-4501 (John's ruling, 20 Nov): a closed ANCESTOR is not refused. Its task is made first, then ended as its
   * ticket is (`info.closedEnd`: `done` for a completed ticket, `declined` for a canceled, duplicate or trashed one), and
   * the child's task is made `in` it. Before this, an open ticket under a closed parent with no task got no task at all,
   * so its runs opened task-less. Only the ticket the write names (depth 0) is refused when closed.
   *
   * `dryRun` answers the same question and writes nothing: no claim, no task. A write whose body is refused is
   * checked this way first, so a refusal leaves no task behind (the route makes the real tasks only after its
   * checks pass). A dry run answers with PLANNED_TASK for a ticket with no task yet.
   * @returns {Promise<{id: string} | {problem: string}>}
   */
  async ensureTask(urlKey, info, { by, at = this.now().toISOString(), dryRun = false }, depth = 0) {
    if (depth > MAX_TICKET_DEPTH) return { problem: `${info.identifier}: the parent chain is deeper than ${MAX_TICKET_DEPTH}` };
    const ticket = info.identifier;
    const id = dryRun ? ((await this.refs.findOne({ urlKey, ticket }))?.taskId ?? PLANNED_TASK) : await this.#claim(urlKey, ticket);
    if (id !== PLANNED_TASK && await this.#current(urlKey, id)) return { id };
    if (info.closed && depth === 0) return { problem: `${ticket} is closed${info.closedReason ? ` (${info.closedReason})` : ''}; no task can be made for it` };
    let parentId;
    if (info.parent) {
      const parent = await this.ensureTask(urlKey, info.parent, { by, at, dryRun }, depth + 1);
      if (parent.problem) return parent;
      parentId = parent.id;
    }
    if (dryRun) return { id };
    const fields = { ref: ticket };
    if (info.asked) fields.asked = info.asked;
    const snap = this.#snap({ id, v: 1, op: 'add', shape: { kind: 'task', state: KINDS.kinds.task.start, fields, ...(parentId ? { in: parentId } : {}), links: {} }, by, at });
    try {
      await this.#append(urlKey, snap);
    } catch (err) {
      if (!(err instanceof RecordsVersionConflict)) throw err;
      // Another request made the same version first: the task exists, as it should.
    }
    if (info.closed) await this.#endAsClosed(urlKey, id, info, { by, at });
    return { id };
  }

  /**
   * LIN-4501: end a closed ancestor's task as its ticket ended (see ensureTask). A task already ended is left alone, and
   * a concurrent end of the same version is the same end, so a version conflict is not an error.
   */
  async #endAsClosed(urlKey, id, info, { by, at }) {
    const base = await this.#current(urlKey, id);
    if (!base || base.ended) return;
    const snap = this.#snap({ id, v: base.v + 1, op: 'end', shape: {}, by, at, base });
    snap.state = info.closedEnd === 'declined' ? 'declined' : 'done';
    snap.ended = { reason: `its ticket is closed${info.closedReason ? ` (${info.closedReason})` : ''}` };
    try {
      await this.#append(urlKey, snap);
    } catch (err) {
      if (!(err instanceof RecordsVersionConflict)) throw err;
    }
  }

  /**
   * The task id a ticket claims, claiming a new one when no claim exists. A ticket's task id is ticketTaskIdOf(ticket)
   * (lib/records/refs.js), the one id rule, and the claim goes through claimTicket, the one claim method.
   */
  async #claim(urlKey, ticket) {
    const existing = await this.refs.findOne({ urlKey, ticket });
    if (existing) return existing.taskId;
    return this.claimTicket(urlKey, ticket, ticketTaskIdOf(ticket));
  }

  /**
   * Claim a ticket for a task. The checked write path (lib/records/writes.js claimTaskTicket) makes the claim before the
   * task is written (add) or before its `ref` is revised (revise). The claim is insert-only: a ticket already claimed
   * keeps its task.
   * @returns {Promise<string>} the task id that holds the ticket (the caller's, or the earlier claim's)
   */
  async claimTicket(urlKey, ticket, taskId) {
    try {
      await this.refs.insertOne({ urlKey, ticket, taskId, claimedAt: this.now() });
      return taskId;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      return (await this.refs.findOne({ urlKey, ticket })).taskId;
    }
  }

  /** The task id a ticket's claim names, whether or not that task is a current record yet; null when unclaimed. */
  async claimOf(urlKey, ticket) {
    const claim = await this.refs.findOne({ urlKey, ticket });
    return claim ? claim.taskId : null;
  }

  /**
   * LIN-4501: the person's words for many tickets at once, from each ticket's task (`asked`). One claims read and one
   * records read, whatever the count, so a list renderer never makes a lookup per ticket. A ticket with no task, or a
   * task with no `asked`, is absent from the map: the caller says what it shows then, and never falls back to the
   * description.
   * @param {string} urlKey
   * @param {string[]} tickets
   * @returns {Promise<Map<string, string>>} ticket -> asked
   */
  async askedForTickets(urlKey, tickets) {
    const wanted = [...new Set((tickets || []).filter((t) => typeof t === 'string' && t))];
    const out = new Map();
    if (!wanted.length) return out;
    const claims = await this.refs.find({ urlKey, ticket: { $in: wanted } }).toArray();
    if (!claims.length) return out;
    const idx = await this.lookup(urlKey, claims.map((c) => c.taskId));
    for (const claim of claims) {
      const task = idx.at(claim.taskId);
      const asked = task && task.kind === 'task' ? task.fields?.asked : undefined;
      if (typeof asked === 'string') out.set(claim.ticket, asked);
    }
    return out;
  }

  /**
   * LIN-4504: the plan facts of many tickets at once (lib/records/plan-facts.js planFactsOf), in a fixed number of
   * reads whatever the count: the claims (`$in`), the tasks' versions, the records `in` those tasks (find's array
   * form), the versions of the plans the tasks name as their `piece` (and, one read per hop and only when one was superseded,
   * the plans that took over), and the findings `to: plan-review`. The last read returns every such finding in the workspace, ended
   * ones included, so its size grows with history while the number of reads stays fixed (plan-review note 10).
   * A ticket with no task maps to facts with no plan (the store was read); a read that throws propagates, and the
   * caller says "not measured".
   * @param {string} urlKey
   * @param {string[]} tickets
   * @returns {Promise<Map<string, object>>} ticket -> plan facts
   */
  async planFactsForTickets(urlKey, tickets) {
    const wanted = [...new Set((tickets || []).filter((t) => typeof t === 'string' && t))];
    const out = new Map();
    if (!wanted.length) return out;
    const claims = await this.refs.find({ urlKey, ticket: { $in: wanted } }).toArray();
    const taskIds = [...new Set(claims.map((c) => c.taskId))];
    const tasks = buildIndex(await this.versionsOf(urlKey, taskIds));
    const inside = await this.find(urlKey, { inRef: taskIds });
    const pieceIds = taskIds.map((id) => tasks.at(id)?.links?.piece).filter((p) => typeof p === 'string' && p).map((p) => splitRef(p).id);
    // Follow the takeovers a hop at a time until none names a plan not yet read, so a piece superseded twice
    // (p1 -> p2 -> p3) resolves as the pure fold does (finding-7f21bd88). One read per hop; `read` stops a cycle.
    const pieceVersions = [];
    const read = new Set();
    for (let want = pieceIds; ; ) {
      const fresh = want.filter((id) => !read.has(id));
      if (!fresh.length) break;
      fresh.forEach((id) => read.add(id));
      const got = await this.versionsOf(urlKey, fresh);
      pieceVersions.push(...got);
      want = buildIndex(got).all().filter((p) => p.state === 'superseded' && p.ended?.into).map((p) => p.ended.into);
    }
    const pieces = buildIndex(pieceVersions);
    const findings = await this.find(urlKey, { kind: 'finding', to: PLAN_REVIEW });
    const byTask = new Map();
    for (const r of inside) {
      if (!byTask.has(r.in)) byTask.set(r.in, []);
      byTask.get(r.in).push(r);
    }
    const claimOf = new Map(claims.map((c) => [c.ticket, c.taskId]));
    for (const ticket of wanted) {
      const task = claimOf.has(ticket) ? tasks.at(claimOf.get(ticket)) : null;
      const theTask = task && task.kind === 'task' ? task : null;
      const pieceRef = theTask?.links?.piece;
      const piece = typeof pieceRef === 'string' ? currentPieceOf(pieces.at(splitRef(pieceRef).id), (id) => pieces.at(id)) : null;
      out.set(ticket, planFactsOf({ task: theTask, inside: theTask ? byTask.get(theTask.id) || [] : [], piece, findings }));
    }
    return out;
  }

  /**
   * LIN-4519 (P6): the verdict facts of many tickets, read from records (lib/records/verdict-facts.js): each ticket's
   * verdicts, with the time each was first written. One claim read, one task-scoped verdict read and one version read
   * for the verdicts, whatever the count. A ticket with no task reads as measured with no verdicts.
   * @param {string} urlKey
   * @param {string[]} tickets
   * @returns {Promise<Map<string, object>>} ticket → verdict facts
   */
  async verdictFactsForTickets(urlKey, tickets) {
    const wanted = [...new Set((tickets || []).filter((t) => typeof t === 'string' && t))];
    const out = new Map();
    if (!wanted.length) return out;
    const claims = await this.refs.find({ urlKey, ticket: { $in: wanted } }).toArray();
    const taskIds = [...new Set(claims.map((c) => c.taskId))];
    const verdicts = await this.find(urlKey, { kind: 'verdict', inRef: taskIds });
    const versions = verdicts.length ? await this.versionsOf(urlKey, verdicts.map((v) => v.id)) : [];
    const firstAt = new Map();
    for (const snap of versions) {
      const prior = firstAt.get(snap.id);
      if (!prior || snap.at < prior) firstAt.set(snap.id, snap.at);
    }
    const tasks = claims.map((c) => ({ id: c.taskId, kind: 'task', fields: { ref: c.ticket } }));
    return verdictFactsFromRecords({ tasks, verdicts, firstAt }, wanted);
  }

  /**
   * LIN-4518 (finding-55356e66): the plan-review run of one ticket, from its task's records (lib/records/plan-review-run.js):
   * the plan-review verdicts and the `to: plan` findings. A ticket with no task has no run (measured, zero verdicts).
   * @param {string} urlKey
   * @param {string} ticket
   * @returns {Promise<ReturnType<typeof planReviewRunOf>>}
   */
  async planReviewRunForTicket(urlKey, ticket) {
    const taskId = await this.taskForTicket(urlKey, ticket);
    if (!taskId) return planReviewRunOf({});
    const verdicts = (await this.find(urlKey, { kind: 'verdict', inRef: taskId })).filter((v) => v.fields?.judgement === PLAN_REVIEW_JUDGEMENT);
    const findings = await this.find(urlKey, { kind: 'finding', to: PLAN_FINDING_TO, inRef: taskId });
    const changes = await this.#changesWithFirstWrites(urlKey, taskId);
    return planReviewRunOf({ verdicts, findings, changes });
  }

  /**
   * LIN-4520 (finding-ca44ecba): the task's change records, each with the instant its record was first written (`at`).
   * Landed work is dated by that write, so a change written after a verdict is work done since it.
   * @param {string} urlKey
   * @param {string} taskId
   * @returns {Promise<Array<{id: string, at: string|null, fields: Object}>>}
   */
  async #changesWithFirstWrites(urlKey, taskId) {
    const changes = await this.find(urlKey, { kind: 'change', inRef: taskId });
    if (!changes.length) return [];
    const versions = await this.versionsOf(urlKey, changes.map((c) => c.id));
    const firstAt = new Map();
    for (const snap of versions) {
      const prior = firstAt.get(snap.id);
      if (!prior || snap.at < prior) firstAt.set(snap.id, snap.at);
    }
    return changes.map((c) => ({ ...c, at: firstAt.get(c.id) ?? c.at ?? null }));
  }

  /**
   * LIN-4520 (finding-9d0c053a): the close-out run records of one ticket's task (their current versions; a run's
   * `account` is its final text). [] with no task.
   * @param {string} urlKey
   * @param {string} ticket
   * @returns {Promise<Array<Object>>}
   */
  async closeOutRunsForTicket(urlKey, ticket) {
    const taskId = await this.taskForTicket(urlKey, ticket);
    if (!taskId) return [];
    return (await this.find(urlKey, { kind: 'run', inRef: taskId })).filter((r) => r.fields?.stage === CLOSE_OUT_STAGE);
  }

  /** The person's words for one ticket, from its task (`asked`); null with no task or no `asked`. */
  async askedForTicket(urlKey, ticket) {
    return (await this.askedForTickets(urlKey, [ticket])).get(ticket) ?? null;
  }

  /** The task a ticket already has, without making one: its id, or null. */
  async taskForTicket(urlKey, ticket) {
    const claim = await this.refs.findOne({ urlKey, ticket });
    if (!claim) return null;
    return (await this.#current(urlKey, claim.taskId)) ? claim.taskId : null;
  }

  /**
   * Open a run for a dispatch row that starts one (decision 2b, 2c). Opening a run that is open returns it.
   * Opening an ended one (a resume row taken into a finished run) writes a new `open` version.
   * @param {{id: string, stage?: string|null, taskId?: string|null, lineage: string, at?: string}} run
   */
  async openRun(urlKey, { id, stage = null, taskId = null, lineage, at = this.now().toISOString() }) {
    const base = await this.#current(urlKey, id);
    if (base && base.state === 'open') return base;
    // A custom resume names no stage of its own: it reopens its run under the stage the run already has.
    const runStage = stage ?? base?.fields?.stage ?? null;
    if (!runStage) return null;
    const shape = { kind: 'run', state: 'open', fields: { stage: runStage }, links: {}, ...(taskId ? { in: taskId } : {}) };
    const snap = this.#snap({ id, v: (base?.v || 0) + 1, op: base ? 'reopen' : 'add', shape, by: runStage, at, base });
    snap.kind = 'run';
    snap.state = 'open';
    snap.lineage = lineage || base?.lineage || id;
    snap.fields = { stage: runStage };
    delete snap.ended;
    await this.#append(urlKey, snap);
    return this.#current(urlKey, id);
  }

  /**
   * End a run on its terminal (done, failed or aborted). A run already ended returns unchanged.
   * @returns {Promise<object|null>} the run, or null when no run has that id
   */
  async endRun(urlKey, id, { state, account = null, at = this.now().toISOString() }) {
    const base = await this.#current(urlKey, id);
    if (!base || base.kind !== 'run') return null;
    if (base.state !== 'open') return base;
    const snap = this.#snap({ id, v: base.v + 1, op: 'end', shape: {}, by: base.by, at, base });
    snap.state = state;
    snap.ended = { reason: state };
    if (account !== null) snap.fields = { ...snap.fields, account };
    await this.#append(urlKey, snap);
    return this.#current(urlKey, id);
  }

  /** The run record `id`, or null. */
  async run(urlKey, id) {
    const snap = await this.#current(urlKey, id);
    return snap && snap.kind === 'run' ? snap : null;
  }

  /** Record who asked what, with its expiry. Written on every query and brief read (decision 8). */
  async logQuery(urlKey, { by, cmd, taskId = null, recordId = null, asOf = null }, at = this.now()) {
    await this.queryLog.insertOne({ urlKey, at, by, cmd, taskId, recordId, asOf, expiresAt: new Date(at.getTime() + QUERY_LOG_RETENTION_MS) });
  }

  /** Remove the query-log rows past their expiry (the hourly cleanup calls this). */
  async cleanupQueryLog(now = this.now()) {
    const result = await this.queryLog.deleteMany({ expiresAt: { $lt: now } });
    return result?.deletedCount ?? 0;
  }
}
