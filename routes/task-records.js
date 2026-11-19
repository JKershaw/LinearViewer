/**
 * LIN-4494 (piece 3): a signed-in person's record writes from the task page, through the session (no token).
 *
 *   POST /workspace/:urlKey/task/:identifier/records        add a finding or question on this task (kind, text, to)
 *   POST /workspace/:urlKey/task/:identifier/records/child  add a child task under this task (done-when)
 *   POST /workspace/:urlKey/records/:id/end                 end an open record (state, reason, into)
 *   POST /workspace/:urlKey/records/:id/supersede           supersede an open finding or question with new words
 *
 * Every write goes through the one checked pipeline (lib/records/writes.js) with `by` = `person:<canonical account>`,
 * read from the session, never from the body. Forms post plainly (no script needed): a written or refused write
 * answers 303 back to the task page's Records section, and a refusal carries its first problem in `records_refused`.
 * A guest has no session account and gets no route (the guest route is /t/:token, which never reaches here).
 *
 * Supersede is two writes: the new record, then the end of the old one into it. The new record's id is derived from the
 * old one's, so a retry after a failed end finds the record it already made and does not make a second.
 */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { isValidIssueId } from '../lib/workspace.js';
import { jsonError } from '../lib/errors.js';
import { createRecordWrites } from '../lib/records/writes.js';
import { ADDABLE, SUPERSEDABLE } from '../lib/render-task-records.js';
import { RecordsNotFound, RecordsVersionConflict } from '../lib/records-store.js';
import { isTerminalState } from '../lib/providers/state-map.js';
import { STAGE_KINDS } from '../lib/prompts/stage-kinds.js';

/** The person a session writes as: `person:<canonical account id>` (a merged account writes as its canonical one). */
export async function personWriterOf(req, accountStore) {
  const accountId = req.session?.accountId;
  if (!accountId) return null;
  let canonical = accountId;
  try {
    canonical = (accountStore && (await accountStore.resolveCanonicalAccountId(accountId))) || accountId;
  } catch {
    // An account the store cannot resolve writes as itself: it is the person's own session, not a guess at another.
  }
  return { by: `person:${canonical}`, run: null };
}

/** A short, stable id fragment for a record derived from another (supersede). */
const derivedId = (base, suffix) => createHash('sha256').update(`${base}\n${suffix}`).digest('hex').slice(0, 8);

const trimmed = (x) => (typeof x === 'string' ? x.trim() : '');

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl - the workspace middleware (lib/workspace.js)
 * @param {import('../lib/records-store.js').RecordsStore} deps.recordsStore
 * @param {{resolveCanonicalAccountId: Function}} [deps.accountStore]
 * @param {(urlKey: string) => Promise<{accountId: string, name: string}[]>} [deps.listPeople]
 */
export function createTaskRecordsRoutes({ workspaceFromUrl, recordsStore, accountStore = null, listPeople = async () => [] }) {
  if (!recordsStore) throw new Error('task records routes: recordsStore is required');
  const router = Router();
  const writes = createRecordWrites({
    recordsStore,
    isTerminalState,
    askedText: () => '',
    stageKinds: Object.keys(STAGE_KINDS),
    listPeople,
  });

  const backTo = (urlKey, identifier, query = '') => `/workspace/${encodeURIComponent(urlKey)}/task/${encodeURIComponent(identifier)}${query}#task-records`;
  const refusedTo = (urlKey, identifier, problems) => backTo(urlKey, identifier, `?records_refused=${encodeURIComponent(problems[0]?.message || 'refused').slice(0, 300)}`);

  /** Owner or member only: a signed-in session with a person to write as. Anything else is a 403, never a write. */
  async function writerOrRefuse(req, res) {
    const writer = await personWriterOf(req, accountStore);
    if (!writer) { jsonError(res, 403, 'Sign in to add or end records'); return null; }
    return writer;
  }

  router.post('/workspace/:urlKey/task/:identifier/records', workspaceFromUrl, async (req, res) => {
    const { urlKey } = req.workspace;
    const { identifier } = req.params;
    if (!isValidIssueId(identifier)) return jsonError(res, 404, 'Task not found');
    const writer = await writerOrRefuse(req, res);
    if (!writer) return undefined;
    try {
      const taskId = await recordsStore.taskForTicket(urlKey, identifier);
      if (!taskId) return res.redirect(303, backTo(urlKey, identifier, '?records_refused=This+task+has+no+records+yet'));
      const kind = trimmed(req.body?.kind);
      const field = ADDABLE[kind];
      if (!field) return res.redirect(303, refusedTo(urlKey, identifier, [{ message: 'a record on a task is a finding or a question' }]));
      const input = { in: taskId, [field]: trimmed(req.body?.text), ...(trimmed(req.body?.to) ? { to: trimmed(req.body.to) } : {}) };
      const result = await writes.add({ urlKey, kind, input, by: writer.by, run: writer.run });
      if (result.problems) return res.redirect(303, refusedTo(urlKey, identifier, result.problems));
      return res.redirect(303, backTo(urlKey, identifier));
    } catch (err) {
      console.error('Task records add error:', err?.message || err);
      return res.redirect(303, refusedTo(urlKey, identifier, [{ message: 'The records store is unavailable; try again' }]));
    }
  });

  router.post('/workspace/:urlKey/task/:identifier/records/child', workspaceFromUrl, async (req, res) => {
    const { urlKey } = req.workspace;
    const { identifier } = req.params;
    if (!isValidIssueId(identifier)) return jsonError(res, 404, 'Task not found');
    const writer = await writerOrRefuse(req, res);
    if (!writer) return undefined;
    try {
      const taskId = await recordsStore.taskForTicket(urlKey, identifier);
      if (!taskId) return res.redirect(303, backTo(urlKey, identifier, '?records_refused=This+task+has+no+records+yet'));
      const doneWhen = trimmed(req.body?.['done-when']);
      const result = await writes.add({ urlKey, kind: 'task', input: { in: taskId, 'done-when': doneWhen }, by: writer.by, run: writer.run });
      if (result.problems) return res.redirect(303, refusedTo(urlKey, identifier, result.problems));
      return res.redirect(303, backTo(urlKey, identifier));
    } catch (err) {
      console.error('Task records child error:', err?.message || err);
      return res.redirect(303, refusedTo(urlKey, identifier, [{ message: 'The records store is unavailable; try again' }]));
    }
  });

  router.post('/workspace/:urlKey/records/:id/end', workspaceFromUrl, async (req, res) => {
    const { urlKey } = req.workspace;
    const identifier = trimmed(req.body?.identifier);
    if (!isValidIssueId(identifier)) return jsonError(res, 404, 'Task not found');
    const writer = await writerOrRefuse(req, res);
    if (!writer) return undefined;
    try {
      const input = { state: trimmed(req.body?.state), reason: trimmed(req.body?.reason), ...(trimmed(req.body?.into) ? { into: trimmed(req.body.into) } : {}) };
      const result = await writes.end({ urlKey, id: req.params.id, input, by: writer.by, run: writer.run });
      if (result.problems) return res.redirect(303, refusedTo(urlKey, identifier, result.problems));
      return res.redirect(303, backTo(urlKey, identifier));
    } catch (err) {
      if (err instanceof RecordsNotFound) return res.redirect(303, refusedTo(urlKey, identifier, [{ message: 'That record is not in this workspace' }]));
      if (err instanceof RecordsVersionConflict) return res.redirect(303, refusedTo(urlKey, identifier, [{ message: 'That record changed while you were writing; reload and try again' }]));
      console.error('Task records end error:', err?.message || err);
      return res.redirect(303, refusedTo(urlKey, identifier, [{ message: 'The records store is unavailable; try again' }]));
    }
  });

  router.post('/workspace/:urlKey/records/:id/supersede', workspaceFromUrl, async (req, res) => {
    const { urlKey } = req.workspace;
    const identifier = trimmed(req.body?.identifier);
    if (!isValidIssueId(identifier)) return jsonError(res, 404, 'Task not found');
    const writer = await writerOrRefuse(req, res);
    if (!writer) return undefined;
    try {
      const prev = await recordsStore.current(urlKey, req.params.id);
      if (!prev) return res.redirect(303, refusedTo(urlKey, identifier, [{ message: 'That record is not in this workspace' }]));
      if (prev.ended) return res.redirect(303, refusedTo(urlKey, identifier, [{ message: 'That record has already ended' }]));
      const field = SUPERSEDABLE[prev.kind];
      if (!field) return res.redirect(303, refusedTo(urlKey, identifier, [{ message: `a ${prev.kind} cannot be superseded from the task page; a lesson or a decision can` }]));
      const newId = `${prev.kind}-${derivedId(prev.id, 'supersede')}`;
      const to = trimmed(req.body?.to) || prev.to;
      const input = { [field]: trimmed(req.body?.[field]), ...(prev.in ? { in: prev.in } : {}), ...(to ? { to } : {}) };
      const made = await writes.add({ urlKey, kind: prev.kind, input, by: writer.by, run: writer.run, fixedId: newId });
      if (made.problems) return res.redirect(303, refusedTo(urlKey, identifier, made.problems));
      const ended = await writes.end({ urlKey, id: prev.id, input: { state: 'superseded', reason: 'superseded from the task page', into: newId }, by: writer.by, run: writer.run });
      if (ended.problems) return res.redirect(303, refusedTo(urlKey, identifier, ended.problems));
      return res.redirect(303, backTo(urlKey, identifier));
    } catch (err) {
      console.error('Task records supersede error:', err?.message || err);
      return res.redirect(303, refusedTo(urlKey, identifier, [{ message: 'The records store is unavailable; try again' }]));
    }
  });

  return router;
}
