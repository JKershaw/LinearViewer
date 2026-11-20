/**
 * LIN-4493 (piece 2): the records routes, `/api/proxy/records` and `/api/proxy/tasks/:id/records`.
 *
 * Writes (integration §2, api-review): flat JSON bodies; links beside the fields or under `links`; a bare id in
 * `on` pinned to the current version; ending an ended record returns it unchanged; one 422 names every problem
 * with what would work. `by` is never read from a body: it is filled here from the credential and the run it
 * names, by lib/run-lineage.js `writerOf` (three outcomes, and a refusal never falls through to a person).
 *
 * A write's body is checked before anything is written, by the one checked pipeline (lib/records/writes.js, LIN-4494):
 * a ticket the body names is checked as a dry run first (it reads the tracker and claims nothing), so a refused body
 * makes no task (LIN-4493 review, gap 5); the real tasks are made only once the dry run is clean. This router fills the
 * writer from the credential and maps the pipeline's results to statuses; the session routes and the importer call the
 * same pipeline.
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
import { TOKEN_ORIGIN, WRITES } from '../lib/stage-writes.js';
import { RecordsVersionConflict, RecordsNotFound } from '../lib/records-store.js';
import { refusalOf, KINDS, PLAN_ADDRESSEES, planAddresseeProblem } from '../lib/records/check.js';
import { createRecordWrites } from '../lib/records/writes.js';
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

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** The check's input: the body without the routing keys (`run`), with its own link object merged in. */
function bodyWithout(body, keys) {
  const out = {};
  for (const [k, v] of Object.entries(body)) if (!keys.includes(k)) out[k] = v;
  return out;
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
 * @param {(req: object) => Promise<object|null>} [deps.tracker] - LIN-4503: the tracker port for a request (lib/records-tracker.js)
 */
export function createProxyRecordsRoutes({ recordsStore, proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent, readTicket, askedText, stageKinds, listPeople = async () => [], tracker = null }) {
  const router = Router();
  // LIN-4494: the one checked write path (lib/records/writes.js), shared with the session routes and the project page.
  // A router with no store (a test or a partial wiring) makes no writes; a write then answers 500, as a store-less route always did.
  const writes = recordsStore ? createRecordWrites({ recordsStore, isTerminalState, readTicket, askedText, stageKinds, listPeople, tracker }) : null;

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

  /**
   * A pipeline result as the route's answer: refused is 422 naming every problem; written is `status`. LIN-4503: the outward
   * steps' answers come beside the record's fields: `ticket` (a child task's ticket, or `{error}` when none was made) and
   * `summary` (a plan's summary, posted, skipped, or `{error}`). Neither can change the record, which is already written.
   */
  const withOutward = (r) => ({ ...r.record, ...(r.ticket ? { ticket: r.ticket } : {}), ...(r.summary ? { summary: r.summary } : {}) });
  const answer = (req, res, endpoint, status, result, shape = withOutward) => (result.problems
    ? reply(req, res, endpoint, 422, refusalOf(result.problems))
    : reply(req, res, endpoint, status, shape(result)));

  // ---- writes ------------------------------------------------------------

  /**
   * LIN-4503: a stage's plan is addressed to `implementation` (one session) or `breakdown` (several). The route refuses any
   * other addressee, naming both; `to` is the body's, or on a revise the plan's current addressee when the body gives none.
   */
  const refusedPlanAddressee = (to) => (typeof to === 'string' && PLAN_ADDRESSEES.includes(to.trim()) ? null : refusalOf([planAddresseeProblem(to)]));

  router.post('/api/proxy/records', proxyLimiter, authenticateProxyToken, requireWriteScope('recordWrite'), async (req, res) => {
    const endpoint = '/api/proxy/records';
    const body = req.body;
    if (!isPlainObject(body)) return reply(req, res, endpoint, 400, { error: 'The body must be a JSON object: {"kind": ..., ...}' });
    try {
      const writer = await writerFor(req, body);
      if (!writer.ok) { logEvent(req, endpoint, 403); return refusal(res, writer); }
      if (body.kind === 'plan') {
        const refused = refusedPlanAddressee(body.to);
        if (refused) return reply(req, res, endpoint, 422, refused);
      }
      const result = await writes.add({ ctx: req, urlKey: req.proxyUrlKey, kind: body.kind, input: bodyWithout(body, ['kind', 'run']), by: writer.by, run: writer.run ?? null });
      return answer(req, res, endpoint, 201, result);
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
      const prev = await recordsStore.current(req.proxyUrlKey, req.params.id);
      if (prev?.kind === 'plan') {
        const refused = refusedPlanAddressee(body.to !== undefined ? body.to : prev.to);
        if (refused) return reply(req, res, endpoint, 422, refused);
      }
      const result = await writes.revise({ ctx: req, urlKey: req.proxyUrlKey, id: req.params.id, input: bodyWithout(body, ['run']), by: writer.by, run: writer.run ?? null });
      return answer(req, res, endpoint, 200, result);
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
      const result = await writes.end({ urlKey: req.proxyUrlKey, id: req.params.id, input: bodyWithout(body, ['run']), by: writer.by, run: writer.run ?? null });
      return answer(req, res, endpoint, 200, result, (r) => ({ ...r.record, changed: r.changed, ...(r.endedBy ? { endedBy: r.endedBy } : {}) }));
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
      const links = {};
      for (const type of LINK_TYPES) if (body[type] !== undefined) links[type] = body[type];
      Object.assign(links, isPlainObject(body.links) ? body.links : {});
      const result = await writes.link({ ctx: req, urlKey: req.proxyUrlKey, id: req.params.id, links, by: writer.by, run: writer.run ?? null });
      return answer(req, res, endpoint, 200, result);
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
    if (req.proxyWrites === WRITES.BLIND_COMMENT) {
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
