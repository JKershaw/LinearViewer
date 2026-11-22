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
 * A verdict's head pin (LIN-4516, plan-4761b4db). A verdict names the head its judge read in `heads`, one sha per change in
 * `on`: `{"<change id>": "<sha>"}`. `heads` is a write-only request field, never stored (lib/records/kinds.json and the
 * three-place inventory are unchanged): the pinned change version already holds the sha. The route strips it, pins each
 * change in `on` to the newest version holding that sha (revising the change to it first when none does, through the
 * change writer), writes the verdict on those versions, and only then runs the one refresh (lib/change-records.js
 * refreshTaskChanges) to the live head. So a refresh that already made a newer version cannot move the pin, and a push the
 * judge never saw shows the verdict stale at once. A verdict on a change with no sha in `heads` is refused with 422 naming
 * `heads`; a non-change target (a plan-review verdict on a plan piece) needs no head.
 *
 * Conditions and the summary (LIN-4516). An approval with conditions is an approval plus one finding to close-out per
 * condition, `about` the change, written BEFORE the approval (the approval is the commit point: open findings hold close-out,
 * LIN-4495). There is no `conditions` field: a verdict body that names one is refused as a misplaced field, so a condition
 * cannot ride on the verdict as prose. What the route cannot enforce: that a review writes its conditions at all, or that it
 * writes them before the approval (it cannot know how many a review meant to write, and a caller can order its writes either
 * way). That order is the review stage's contract, held by its prompts when P5 flips the stage; until then the route holds
 * what it can. A verdict's write posts one marked summary through the tracker port (writes.js outwardAfterAdd, the plan path):
 * once per version, never on an import or a dry run, never retried. A summary is read by `isSummaryBody` (lib/records/summary.js),
 * the one mark predicate.
 *
 * Injected, never imported from the tracker or the workspace (Records imports only Platform): `readTicket`
 * (the provider read: the ticket's identifier, title, description, state and parent), `askedText`
 * (lib/asked-of.js askedOf), `stageKinds` (STAGE_KINDS' keys), `listPeople` (the workspace-person reader; a
 * caller with none passes an empty list, and a `to` that names a person is then refused with the names that work)
 * and `tracker` (LIN-4503: the outward port for a request, lib/records-tracker.js; a child task's ticket and a plan's
 * summary go through it after the record is written).
 */
import { Router } from 'express';
import { jsonError } from '../lib/errors.js';
import { writerOf, WRITER_REFUSAL } from '../lib/run-lineage.js';
import { TOKEN_ORIGIN, WRITES } from '../lib/stage-writes.js';
import { RecordsVersionConflict, RecordsNotFound } from '../lib/records-store.js';
import { refusalOf, KINDS, PLAN_ADDRESSEES, planAddresseeProblem } from '../lib/records/check.js';
import { createRecordWrites } from '../lib/records/writes.js';
import { pinVerdictToHeads, refreshTaskChanges, blindReadSetProblems, versionChangeWrite } from '../lib/change-records.js';
import { BLIND_READ_KIND } from '../lib/prompts/blind-read-words.js';
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
 * LIN-4516 (close-out, findings 356a11ca and 369e09dc): the `on` a body names, flat or under `links`, and where it sat, so
 * the pin and the blind-read check read it wherever it was written and the pinned refs go back to the same place. Naming
 * it in both places is refused, as the checked pipeline refuses it (lib/records/check.js).
 * @returns {{on: *, where: 'flat'|'links', problems?: object[]}}
 */
function onOf(body) {
  const nested = isPlainObject(body.links) ? body.links.on : undefined;
  if (body.on !== undefined && nested !== undefined) {
    return { on: undefined, where: 'flat', problems: [{ field: 'on', message: "'on' is given twice: beside the fields and under links" }] };
  }
  return nested !== undefined ? { on: nested, where: 'links' } : { on: body.on, where: 'flat' };
}

/** Writes `on` back to where it was read (see onOf) in the input the checked pipeline gets. */
function putOn(input, where, on) {
  if (where === 'links') input.links = { ...input.links, on };
  else input.on = on;
}

/**
 * @param {Object} deps
 * @param {import('../lib/records-store.js').RecordsStore} deps.recordsStore
 * @param {Function} deps.proxyLimiter
 * @param {Function} deps.authenticateProxyToken
 * @param {Function} deps.requireWriteScope - `requireWriteScope(op)` (lib/stage-write-gate.js)
 * @param {Function} deps.logEvent
 * @param {(req: object, ref: string) => Promise<object|null>} deps.readTicket - the tracker read, by ticket identifier
 * @param {(description: string) => string} deps.askedText - lib/asked-of.js askedOf (routes/proxy.js injects it)
 * @param {string[]} deps.stageKinds - STAGE_KINDS' keys
 * @param {(urlKey: string) => Promise<{accountId: string, name: string}[]>} [deps.listPeople]
 * @param {(req: object) => Promise<object|null>} [deps.tracker] - LIN-4503: the tracker port for a request (lib/records-tracker.js)
 * @param {(urlKey: string) => (args: {repo: string, number: number}) => Promise<object>} [deps.changePrReaderFor] - LIN-4516:
 *   the per-workspace PR reader P2's refresh uses after a verdict is pinned (createChangePrReaders in lib/change-records.js)
 */
export function createProxyRecordsRoutes({ recordsStore, proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent, readTicket, askedText, stageKinds, listPeople = async () => [], tracker = null, changePrReaderFor = null }) {
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

  /**
   * LIN-4516: the head pin for a VERDICT write that names `on` (flat or under links), on add, revise or link, so no route
   * can attach a change to a verdict by its current version. `heads` is write-only and is stripped by the caller. Returns
   * `{on, tasks}`, with `on` undefined when the write names no `on` and no heads, or the refusal. Only a verdict rests on a
   * head its judge read (close-out, finding 804994d8): any other kind that names `on` is left to the checked pipeline as it
   * was, and a `heads` on one is refused as misplaced, so a finding on a change is not asked for a head.
   */
  async function pinOnOf(urlKey, { isVerdict, on, heads, run }) {
    if (!isVerdict) {
      if (heads !== undefined) return { problems: [{ field: 'heads', message: "'heads' belongs to a verdict: it names the head its judge read, one sha per change in on" }] };
      return { on, tasks: [] };
    }
    if (on === undefined && heads === undefined) return { on: undefined, tasks: [] };
    return pinVerdictToHeads({ urlKey, on, heads, writes, recordsStore, run });
  }

  /**
   * LIN-4516: a blind read's `on` stays exactly the landing when a revise or link adds to it. The add checks its own
   * set; this checks the set the record would hold afterwards (the links it has, plus those added).
   */
  async function blindReadAfter(urlKey, prev, addedOn) {
    if (addedOn === undefined || prev?.kind !== 'verdict' || prev.fields?.judgement !== BLIND_READ_KIND) return [];
    return blindReadSetProblems({ urlKey, recordsStore, on: [].concat(prev.links?.on ?? [], addedOn).filter((x) => typeof x === 'string') });
  }

  /**
   * LIN-4516: after a verdict is written on its pinned versions, P2's one refresh runs for each task it rests on, so
   * a change whose PR has moved on gets a newer head version the verdict does not name (the verdict then shows stale).
   * Fail open is deliberate (plan-91aae6d8 item 2): a PR that cannot be read at verdict time leaves its change where it is, so
   * the verdict is not stale until a later read reads that PR. The verdict shows stale at once only when its PR is readable;
   * refusing a verdict on an unreadable PR would stall close-out on every GitHub blip. A refresh that cannot run is logged and
   * the verdict stands; the next gating read refreshes the change.
   */
  async function refreshAfterPin(urlKey, taskIds) {
    if (!changePrReaderFor) {
      console.warn(`[records] ${urlKey}: no PR reader, so no refresh ran after a verdict pinned ${taskIds.length} task(s)`);
      return;
    }
    const readPrStatus = changePrReaderFor(urlKey);
    for (const taskId of taskIds) {
      try {
        await refreshTaskChanges({ urlKey, taskId, writes, recordsStore, readPrStatus });
      } catch (err) {
        console.warn(`[records] ${urlKey} ${taskId}: refresh after a verdict failed: ${err?.message || err}`);
      }
    }
  }

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
      const named = onOf(body);
      if (named.problems) return reply(req, res, endpoint, 422, refusalOf(named.problems));
      const isVerdict = body.kind === 'verdict';
      if (isVerdict && body.judgement === BLIND_READ_KIND && named.on !== undefined) {
        // LIN-4516: a blind read names exactly the landing (subset and superset refused), checked before any pin.
        const exact = await blindReadSetProblems({ urlKey: req.proxyUrlKey, recordsStore, on: [].concat(named.on).filter((x) => typeof x === 'string') });
        if (exact.length) return reply(req, res, endpoint, 422, refusalOf(exact));
      }
      const pin = await pinOnOf(req.proxyUrlKey, { isVerdict, on: named.on, heads: body.heads, run: writer.run ?? null });
      if (pin.problems) return reply(req, res, endpoint, 422, refusalOf(pin.problems));
      const input = bodyWithout(body, ['kind', 'run', 'heads']);
      if (named.on !== undefined) putOn(input, named.where, pin.on);
      // LIN-4516: a verdict belongs to the task its changes are on, so the task's records and its round cut can find it.
      // `in` is any record's field, so no kind changes (lib/records/kinds.json).
      if (isVerdict && pin.tasks.length === 1 && input.in === undefined) input.in = pin.tasks[0];
      // LIN-4518 step 2 (finding 798836ce): a change for a PR the task already holds open is a new version of that change.
      const versioned = await versionChangeWrite({ urlKey: req.proxyUrlKey, body, writes, recordsStore, by: writer.by, run: writer.run ?? null });
      const result = versioned ?? await writes.add({ ctx: req, urlKey: req.proxyUrlKey, kind: body.kind, input, by: writer.by, run: writer.run ?? null });
      if (!result.problems) await refreshAfterPin(req.proxyUrlKey, pin.tasks);
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
      const named = onOf(body);
      if (named.problems) return reply(req, res, endpoint, 422, refusalOf(named.problems));
      const exact = await blindReadAfter(req.proxyUrlKey, prev, named.on);
      if (exact.length) return reply(req, res, endpoint, 422, refusalOf(exact));
      const pin = await pinOnOf(req.proxyUrlKey, { isVerdict: prev?.kind === 'verdict', on: named.on, heads: body.heads, run: writer.run ?? null });
      if (pin.problems) return reply(req, res, endpoint, 422, refusalOf(pin.problems));
      const input = bodyWithout(body, ['run', 'heads']);
      if (named.on !== undefined) putOn(input, named.where, pin.on);
      const result = await writes.revise({ ctx: req, urlKey: req.proxyUrlKey, id: req.params.id, input, by: writer.by, run: writer.run ?? null });
      if (!result.problems) await refreshAfterPin(req.proxyUrlKey, pin.tasks);
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
      const named = onOf(body);
      if (named.problems) return reply(req, res, endpoint, 422, refusalOf(named.problems));
      const links = {};
      for (const type of LINK_TYPES) if (body[type] !== undefined) links[type] = body[type];
      Object.assign(links, isPlainObject(body.links) ? body.links : {});
      const prev = await recordsStore.current(req.proxyUrlKey, req.params.id);
      if (!prev) throw new RecordsNotFound(req.params.id);
      const exact = await blindReadAfter(req.proxyUrlKey, prev, links.on);
      if (exact.length) return reply(req, res, endpoint, 422, refusalOf(exact));
      const pin = await pinOnOf(req.proxyUrlKey, { isVerdict: prev.kind === 'verdict', on: links.on, heads: body.heads, run: writer.run ?? null });
      if (pin.problems) return reply(req, res, endpoint, 422, refusalOf(pin.problems));
      if (links.on !== undefined) links.on = pin.on;
      const result = await writes.link({ ctx: req, urlKey: req.proxyUrlKey, id: req.params.id, links, by: writer.by, run: writer.run ?? null });
      if (!result.problems) await refreshAfterPin(req.proxyUrlKey, pin.tasks);
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
