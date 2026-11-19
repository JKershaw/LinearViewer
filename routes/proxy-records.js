/**
 * LIN-4493 (piece 2): the records routes, `/api/proxy/records` and `/api/proxy/tasks/:id/records`.
 *
 * Writes (integration §2, api-review): flat JSON bodies; links beside the fields or under `links`; a bare id in
 * `on` pinned to the current version; ending an ended record returns it unchanged; one 422 names every problem
 * with what would work. `by` is never read from a body: it is filled here from the credential and the run it
 * names, by lib/run-lineage.js `writerOf` (three outcomes, and a refusal never falls through to a person).
 *
 * A write's body is checked before anything is written. A ticket the body names is checked as a dry run first
 * (it reads the tracker and claims nothing), so a refused body makes no task (LIN-4493 review, gap 5); the real
 * tasks are made only once the dry run is clean.
 *
 * Mounts: POST /api/proxy/records (add), POST /api/proxy/records/:id/{revise,end,link}, each behind
 * `requireWriteScope('recordWrite')` (the readWrite scope and the stage's allowance; `recordWrite` is allowed to
 * every stamp, lib/stage-writes.js). Reads: GET /api/proxy/records/:id[@v], GET /api/proxy/records (find, with
 * `count`), GET /api/proxy/tasks/:id/records (show). A read is logged with who asked (decision 8). A blind-read
 * token (`blind-comment`) may not read records at all: enabling writes must not grant record reads.
 *
 * Reads and writes touch only the records they name, through the store's indexed readers: nothing here loads the
 * workspace's whole history (LIN-4493 review, gap 4).
 *
 * Injected, never imported from the tracker or the workspace (Records imports only Platform): `readTicket`
 * (the provider read: the ticket's identifier, title, description, state and parent), `askedText`
 * (lib/as-asked.js), `stageKinds` (STAGE_KINDS' keys) and `listPeople` (the workspace-person reader; a
 * caller with none passes an empty list, and a `to` that names a person is then refused with the names that work).
 */
import { Router } from 'express';
import { jsonError } from '../lib/errors.js';
import { writerOf, WRITER_REFUSAL } from '../lib/run-lineage.js';
import { TOKEN_ORIGIN } from '../lib/stage-writes.js';
import { RecordsVersionConflict, RecordsNotFound, looksLikeTicket } from '../lib/records-store.js';
import { checkAdd, checkRevise, checkEnd, checkLink, refusalOf, splitRef, KINDS } from '../lib/records/check.js';
import { isTerminalState } from '../lib/providers/state-map.js';

const LINK_TYPES = Object.keys(KINDS.links);

/** What a refused writer says, by reason. Every refusal is a 403 that names its cause. */
const REFUSAL_TEXT = {
  [WRITER_REFUSAL.NO_CREDENTIAL]: 'no credential',
  [WRITER_REFUSAL.PREDATES_RUN_IDENTITY]: 'this credential predates run identity; mint a new one',
  [WRITER_REFUSAL.UNKNOWN_ORIGIN]: 'this credential has an origin Harbour does not recognise',
  [WRITER_REFUSAL.PERSON_WITHOUT_OWNER]: 'this person credential has no owner to write as',
  [WRITER_REFUSAL.NO_RUN]: "this dispatch credential names no run; a write needs the run it was dispatched under, sent as \"run\": \"<id>\"",
  [WRITER_REFUSAL.TOKEN_RUN_UNKNOWN]: "this credential's run is not on record",
  [WRITER_REFUSAL.RUN_NOT_NAMED]: 'send "run": "<your run id>" with this write',
  [WRITER_REFUSAL.RUN_NOT_FOUND]: 'the run named is not on record',
  [WRITER_REFUSAL.RUN_ENDED]: 'the run named has ended; a write needs an open run',
  [WRITER_REFUSAL.OTHER_LINEAGE]: 'the run named is in another dispatch lineage than this credential'
};

/** A run record ends when its dispatch row does (Harbour writes that); an agent may not end or revise it. */
const RUN_ENDS_ITSELF = { field: 'id', message: 'a run ends when its dispatch row ends; Harbour writes that, not an agent', works: [] };

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** The check's input: the body without the routing keys (`run`), with its own link object merged in. */
function bodyWithout(body, keys) {
  const out = {};
  for (const [k, v] of Object.entries(body)) if (!keys.includes(k)) out[k] = v;
  return out;
}

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
 * Every reference a body names that may be a ticket (in, to, and the link values). A record id can have a ticket's
 * shape (`finding-12345678`, a run id such as `row-12345`), so checkWrite drops the references that name an existing
 * record before any is read as a ticket (LIN-4493 leftovers): a reference that exists never reaches the tracker.
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
 * @param {import('../lib/records-store.js').RecordsStore} deps.recordsStore
 * @param {Function} deps.proxyLimiter
 * @param {Function} deps.authenticateProxyToken
 * @param {Function} deps.requireWriteScope - `requireWriteScope(op)` (lib/stage-write-gate.js)
 * @param {Function} deps.logEvent
 * @param {(req: object, ref: string) => Promise<object|null>} deps.readTicket - the tracker read, by ticket identifier
 * @param {(description: string) => string} deps.askedText - lib/as-asked.js askedText
 * @param {string[]} deps.stageKinds - STAGE_KINDS' keys
 * @param {(urlKey: string) => Promise<{accountId: string, name: string}[]>} [deps.listPeople]
 */
export function createProxyRecordsRoutes({ recordsStore, proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent, readTicket, askedText, stageKinds, listPeople = async () => [] }) {
  const router = Router();

  /** The run a credential or a body names, as writerOf reads it: {id, kind (its stage), open, rootItemId}. */
  async function runRow(urlKey, id) {
    const run = await recordsStore.run(urlKey, id);
    return run ? { id: run.id, kind: run.by, open: run.state === 'open', rootItemId: run.lineage } : null;
  }

  /** Who a write is filed as, or the refusal. Dispatch credentials are read through their run; never a body field. */
  async function writerFor(req, body) {
    const urlKey = req.proxyUrlKey;
    const credential = { origin: req.proxyOrigin ?? null, runRecordId: req.proxyRunRecordId ?? null, createdBy: req.proxyCreatedBy ?? null };
    const tokenRun = credential.origin === TOKEN_ORIGIN.DISPATCH && credential.runRecordId ? await runRow(urlKey, credential.runRecordId) : null;
    const namedRunGiven = body.run !== undefined;
    const namedRun = namedRunGiven && typeof body.run === 'string' && body.run ? await runRow(urlKey, body.run) : null;
    return writerOf({ credential, tokenRun, namedRun, namedRunGiven });
  }

  /** The ids and refusal text of a writer's refusal. */
  const refusal = (res, writer) => jsonError(res, 403, REFUSAL_TEXT[writer.reason] || 'this write is refused', { reason: writer.reason });

  /** The tracker's view of a ticket, as the store's task needs it: its words, whether it is closed, its parent's. */
  async function ticketInfo(req, ref, depth = 0) {
    const issue = await readTicket(req, ref);
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
    if (parentRef && depth < 12) info.parent = await ticketInfo(req, parentRef, depth + 1);
    return info;
  }

  /** The tracker's view of a ticket, or why it has none: the read failed, or the ticket is not readable here. */
  async function readInfo(req, ref) {
    try {
      return (await ticketInfo(req, ref)) ?? { unreadable: `${ref} is not a ticket this workspace can read` };
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
  async function ensureTickets(req, refs, writerBy, { dryRun = false, infos = new Map() } = {}) {
    const urlKey = req.proxyUrlKey;
    const made = new Map();
    for (const ref of refs) {
      const existing = await recordsStore.taskForTicket(urlKey, ref);
      if (existing) { made.set(ref, { id: existing }); continue; }
      if (!infos.has(ref)) infos.set(ref, await readInfo(req, ref));
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
  async function checkWrite(req, input, writerBy, check) {
    const urlKey = req.proxyUrlKey;
    const idx = await recordsStore.lookup(urlKey, recordIdsIn(input));
    const refs = ticketRefsIn(input).filter((ref) => !idx.has(ref));
    const infos = new Map();
    const planned = await ensureTickets(req, refs, writerBy, { dryRun: true, infos });
    const dry = check(idx, planned);
    if (dry.problems.length) return dry;
    const made = await ensureTickets(req, refs, writerBy, { infos });
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

  const reply = (req, res, endpoint, status, body) => {
    logEvent(req, endpoint, status);
    return res.status(status).json(body);
  };

  /** Records the caller's refusal or failure as the route's answer: a version conflict is 409; anything else 500. */
  function failed(req, res, endpoint, err) {
    if (err instanceof RecordsVersionConflict) return reply(req, res, endpoint, 409, { error: err.message, code: err.code });
    if (err instanceof RecordsNotFound) return reply(req, res, endpoint, 404, { error: err.message, code: err.code });
    console.error('Records route failed:', err?.message || err);
    return reply(req, res, endpoint, 500, { error: 'The records store is unavailable', code: 'RECORDS_UNAVAILABLE' });
  }

  // ---- writes ------------------------------------------------------------

  router.post('/api/proxy/records', proxyLimiter, authenticateProxyToken, requireWriteScope('recordWrite'), async (req, res) => {
    const endpoint = '/api/proxy/records';
    const body = req.body;
    if (!isPlainObject(body)) return reply(req, res, endpoint, 400, { error: 'The body must be a JSON object: {"kind": ..., ...}' });
    try {
      const writer = await writerFor(req, body);
      if (!writer.ok) { logEvent(req, endpoint, 403); return refusal(res, writer); }
      const urlKey = req.proxyUrlKey;
      const input = bodyWithout(body, ['kind', 'run']);
      const people = await listPeople(urlKey);
      const checked = await checkWrite(req, input, writer.by, (idx, tickets) => checkAdd(body.kind, input, contextFor(urlKey, idx, tickets, people)));
      if (checked.problems.length) return reply(req, res, endpoint, 422, refusalOf(checked.problems));
      const snap = await recordsStore.add(urlKey, checked.record, { by: writer.by, run: writer.run ?? null });
      return reply(req, res, endpoint, 201, await recordsStore.viewOfRecord(urlKey, snap));
    } catch (err) {
      return failed(req, res, endpoint, err);
    }
  });

  router.post('/api/proxy/records/:id/revise', proxyLimiter, authenticateProxyToken, requireWriteScope('recordWrite'), async (req, res) => {
    const endpoint = '/api/proxy/records/:id/revise';
    const body = req.body;
    if (!isPlainObject(body)) return reply(req, res, endpoint, 400, { error: 'The body must be a JSON object' });
    try {
      const writer = await writerFor(req, body);
      if (!writer.ok) { logEvent(req, endpoint, 403); return refusal(res, writer); }
      const urlKey = req.proxyUrlKey;
      const prev = await recordsStore.current(urlKey, req.params.id);
      if (!prev) return reply(req, res, endpoint, 404, { error: `no record '${req.params.id}'` });
      if (prev.kind === 'run') return reply(req, res, endpoint, 422, refusalOf([RUN_ENDS_ITSELF]));
      const input = bodyWithout(body, ['run']);
      const people = await listPeople(urlKey);
      const checked = await checkWrite(req, input, writer.by, (idx, tickets) => checkRevise(prev, input, contextFor(urlKey, idx, tickets, people)));
      if (checked.problems.length) return reply(req, res, endpoint, 422, refusalOf(checked.problems));
      await recordsStore.revise(urlKey, prev.id, checked.changes, { by: writer.by, run: writer.run ?? null, reason: input.reason });
      return reply(req, res, endpoint, 200, await recordsStore.viewOfRecord(urlKey, await recordsStore.current(urlKey, prev.id)));
    } catch (err) {
      return failed(req, res, endpoint, err);
    }
  });

  router.post('/api/proxy/records/:id/end', proxyLimiter, authenticateProxyToken, requireWriteScope('recordWrite'), async (req, res) => {
    const endpoint = '/api/proxy/records/:id/end';
    const body = req.body;
    if (!isPlainObject(body)) return reply(req, res, endpoint, 400, { error: 'The body must be a JSON object: {"state": ..., "reason": ...}' });
    try {
      const writer = await writerFor(req, body);
      if (!writer.ok) { logEvent(req, endpoint, 403); return refusal(res, writer); }
      const urlKey = req.proxyUrlKey;
      const prev = await recordsStore.current(urlKey, req.params.id);
      if (!prev) return reply(req, res, endpoint, 404, { error: `no record '${req.params.id}'` });
      // Ending a record already in an end returns it unchanged (api-review 3), with who ended it.
      if (prev.ended) return reply(req, res, endpoint, 200, { ...(await recordsStore.viewOfRecord(urlKey, prev)), changed: false, endedBy: prev.by });
      if (prev.kind === 'run') return reply(req, res, endpoint, 422, refusalOf([RUN_ENDS_ITSELF]));
      const input = bodyWithout(body, ['run']);
      const idx = await recordsStore.lookup(urlKey, recordIdsIn(input));
      const { problems } = checkEnd(prev, input, contextFor(urlKey, idx, new Map(), await listPeople(urlKey)));
      if (problems.length) return reply(req, res, endpoint, 422, refusalOf(problems));
      const out = await recordsStore.end(urlKey, prev.id, { state: input.state, reason: input.reason, into: input.into ?? null }, { by: writer.by, run: writer.run ?? null });
      return reply(req, res, endpoint, 200, { ...(await recordsStore.viewOfRecord(urlKey, out.record)), changed: out.changed });
    } catch (err) {
      return failed(req, res, endpoint, err);
    }
  });

  router.post('/api/proxy/records/:id/link', proxyLimiter, authenticateProxyToken, requireWriteScope('recordWrite'), async (req, res) => {
    const endpoint = '/api/proxy/records/:id/link';
    const body = req.body;
    if (!isPlainObject(body)) return reply(req, res, endpoint, 400, { error: 'The body must be a JSON object' });
    try {
      const writer = await writerFor(req, body);
      if (!writer.ok) { logEvent(req, endpoint, 403); return refusal(res, writer); }
      const urlKey = req.proxyUrlKey;
      const prev = await recordsStore.current(urlKey, req.params.id);
      if (!prev) return reply(req, res, endpoint, 404, { error: `no record '${req.params.id}'` });
      const links = {};
      for (const type of LINK_TYPES) if (body[type] !== undefined) links[type] = body[type];
      Object.assign(links, isPlainObject(body.links) ? body.links : {});
      const people = await listPeople(urlKey);
      const checked = await checkWrite(req, { links }, writer.by, (idx, tickets) => checkLink(prev, links, contextFor(urlKey, idx, tickets, people)));
      if (checked.problems.length) return reply(req, res, endpoint, 422, refusalOf(checked.problems));
      await recordsStore.link(urlKey, prev.id, checked.links, { by: writer.by, run: writer.run ?? null });
      return reply(req, res, endpoint, 200, await recordsStore.viewOfRecord(urlKey, await recordsStore.current(urlKey, prev.id)));
    } catch (err) {
      return failed(req, res, endpoint, err);
    }
  });

  // ---- reads -------------------------------------------------------------

  /** Who a read is logged as, or null for a credential that cannot read records (no origin). */
  function askerOf(req) {
    if (req.proxyOrigin === TOKEN_ORIGIN.DISPATCH) return req.proxyRunRecordId ? `run:${req.proxyRunRecordId}` : 'dispatch:no-run';
    if (req.proxyOrigin === TOKEN_ORIGIN.PERSON && req.proxyCreatedBy) return `person:${req.proxyCreatedBy}`;
    return null;
  }

  /** The read gate: an identified credential, and not a blind read (its only read is its ticket, LIN-4437). */
  function readable(req, res, endpoint) {
    if (req.proxyWrites === 'blind-comment') {
      reply(req, res, endpoint, 403, { error: "a blind read may not read records: its only read is the change it judges, given by its prompt (LIN-4437)" });
      return false;
    }
    if (!askerOf(req)) {
      reply(req, res, endpoint, 403, { error: 'this credential predates run identity; mint a new one' });
      return false;
    }
    return true;
  }

  router.get('/api/proxy/records/:id', proxyLimiter, authenticateProxyToken, async (req, res) => {
    const endpoint = '/api/proxy/records/:id';
    if (!readable(req, res, endpoint)) return;
    try {
      const urlKey = req.proxyUrlKey;
      const [id, v] = String(req.params.id).split('@');
      const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
      const { snap, versions } = await recordsStore.read(urlKey, id, { v: v !== undefined ? Number(v) : undefined, asOf });
      await recordsStore.logQuery(urlKey, { by: askerOf(req), cmd: 'get', recordId: id, asOf: asOf ?? null });
      if (!snap) return reply(req, res, endpoint, 404, { error: `no record '${req.params.id}'` });
      const history = versions.filter((x) => x.id === snap.id && x.v <= snap.v).map((x) => ({ v: x.v, at: x.at, by: x.by, state: x.state, op: x.op, ...(x.reason ? { reason: x.reason } : {}) }));
      return reply(req, res, endpoint, 200, { ...(await recordsStore.viewOfRecord(urlKey, snap, asOf)), versions: history });
    } catch (err) {
      return failed(req, res, endpoint, err);
    }
  });

  router.get('/api/proxy/records', proxyLimiter, authenticateProxyToken, async (req, res) => {
    const endpoint = '/api/proxy/records';
    if (!readable(req, res, endpoint)) return;
    try {
      const urlKey = req.proxyUrlKey;
      const q = req.query;
      const asOf = typeof q.asOf === 'string' ? q.asOf : undefined;
      const inRef = typeof q.in === 'string' ? (q.in === KINDS.addressees.project ? null : q.in) : undefined;
      const matched = await recordsStore.find(urlKey, {
        kind: typeof q.kind === 'string' ? q.kind : undefined,
        state: typeof q.state === 'string' ? q.state : undefined,
        to: typeof q.to === 'string' ? q.to : undefined,
        inRef,
        asOf,
        text: typeof q.text === 'string' ? q.text : undefined
      });
      await recordsStore.logQuery(urlKey, { by: askerOf(req), cmd: 'find', taskId: typeof q.in === 'string' ? q.in : null, asOf: asOf ?? null });
      if (q.count !== undefined) return reply(req, res, endpoint, 200, { count: matched.length });
      return reply(req, res, endpoint, 200, { records: await recordsStore.viewsOf(urlKey, matched, asOf) });
    } catch (err) {
      return failed(req, res, endpoint, err);
    }
  });

  router.get('/api/proxy/tasks/:id/records', proxyLimiter, authenticateProxyToken, async (req, res) => {
    const endpoint = '/api/proxy/tasks/:id/records';
    if (!readable(req, res, endpoint)) return;
    try {
      const urlKey = req.proxyUrlKey;
      const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
      const { snap: task } = await recordsStore.read(urlKey, req.params.id, { asOf });
      await recordsStore.logQuery(urlKey, { by: askerOf(req), cmd: 'show', taskId: req.params.id, asOf: asOf ?? null });
      if (!task || task.kind !== 'task') return reply(req, res, endpoint, 404, { error: `'${req.params.id}' is not a task` });
      const records = await recordsStore.find(urlKey, { inRef: task.id, asOf });
      return reply(req, res, endpoint, 200, {
        task: await recordsStore.viewOfRecord(urlKey, task, asOf),
        records: await recordsStore.viewsOf(urlKey, records, asOf)
      });
    } catch (err) {
      return failed(req, res, endpoint, err);
    }
  });

  return router;
}
