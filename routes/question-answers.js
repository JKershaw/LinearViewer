/**
 * LIN-4531 (LIN-4529 plan D2): a signed-in person answers or dismisses an agent's question, through one route each.
 *
 *   POST /workspace/:urlKey/questions/:id/answer    body {option?, words?}  — the option chosen and/or the person's own words
 *   POST /workspace/:urlKey/questions/:id/dismiss                          — no answer; the asking run takes its fallback
 *
 * The session is the person (`personWriterOf`, routes/task-records.js): `by` is `person:<account>`, read from the session,
 * never from the body. The answer and dismiss logic is lib/question-answers.js (the behaviour table is in its header).
 * This file only binds it to the request: the resume goes through lib/follow-up-dispatch.js enqueueFollowUp with the
 * workspace's owner gate and credential finalize, as the proposal-apply route does. Answers are JSON: the page reads the
 * status and the `notResumedBecause` note.
 */
import { Router, json } from 'express';
import { jsonError } from '../lib/errors.js';
import { createRecordWrites } from '../lib/records/writes.js';
import { askedOf } from '../lib/asked-of.js';
import { createQuestionAnswers } from '../lib/question-answers.js';
import { enqueueFollowUp } from '../lib/follow-up-dispatch.js';
import { isTerminalState } from '../lib/providers/state-map.js';
import { STAGE_KINDS } from '../lib/prompts/stage-kinds.js';
import { personWriterOf, readSessionTicket, sessionTrackerFor } from './task-records.js';
import { dispatchQueueLimiter } from './dispatch.js';
import { publicOrigin } from '../lib/public-origin.js';

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl - the workspace middleware (lib/workspace.js)
 * @param {import('../lib/records-store.js').RecordsStore} deps.recordsStore
 * @param {Object} deps.dispatchQueueStore - the dispatch store (isRunStopped, rowForRunRecords, followUpPromptsOf, enqueue)
 * @param {Object} [deps.workspacePreferencesStore]
 * @param {Object} [deps.proxyTokenStore]
 * @param {Function} deps.workspaceOwnerCheck - the hoisted owner seam (LIN-3383); absent means the resume is refused (fail closed)
 * @param {{resolveCanonicalAccountId: Function}} [deps.accountStore]
 * @param {(urlKey: string) => Promise<{accountId: string, name: string}[]>} [deps.listPeople]
 */
export function createQuestionAnswerRoutes({ workspaceFromUrl, recordsStore, dispatchQueueStore, workspacePreferencesStore = null, proxyTokenStore = null, workspaceOwnerCheck = null, accountStore = null, listPeople = async () => [] }) {
  if (!recordsStore || !dispatchQueueStore) throw new Error('question answer routes: recordsStore and dispatchQueueStore are required');
  const router = Router();

  /** The request's own service: its writes carry the request's tracker, its resume carries the request's owner gate and origin. */
  function serviceFor(req) {
    const writes = createRecordWrites({
      recordsStore,
      isTerminalState,
      readTicket: readSessionTicket,
      askedText: askedOf,
      stageKinds: Object.keys(STAGE_KINDS),
      listPeople,
      tracker: sessionTrackerFor,
    });
    const { urlKey, id: workspaceId } = req.workspace;
    const baseUrl = publicOrigin(req);
    return createQuestionAnswers({
      recordsStore,
      writes,
      dispatchStore: dispatchQueueStore,
      enqueueResume: ({ runId, prompt, target, force, dispatchedBy }) => enqueueFollowUp({
        dispatchQueueStore,
        workspacePreferencesStore,
        proxyTokenStore,
        urlKey,
        prompt,
        baseUrl,
        dispatchedBy,
        ownerCheck: workspaceOwnerCheck,
        workspaceId,
        followUpTo: runId,
        target,
        force,
        sessionId: runId,
      }),
    });
  }

  const trimmed = (x) => (typeof x === 'string' ? x : null);

  router.post('/workspace/:urlKey/questions/:id/answer', dispatchQueueLimiter, workspaceFromUrl, json(), async (req, res) => {
    const writer = await personWriterOf(req, accountStore);
    if (!writer) return jsonError(res, 403, 'Sign in to answer a question');
    const accountId = writer.by.slice('person:'.length);
    try {
      const out = await serviceFor(req).answer({
        urlKey: req.workspace.urlKey,
        questionId: req.params.id,
        option: trimmed(req.body?.option),
        words: trimmed(req.body?.words),
        by: writer.by,
        dispatchedBy: accountId,
      });
      return res.status(out.status).json(out.body);
    } catch (err) {
      console.error('Question answer error:', err?.message || err);
      return jsonError(res, 500, 'The answer could not be recorded; try again');
    }
  });

  router.post('/workspace/:urlKey/questions/:id/dismiss', dispatchQueueLimiter, workspaceFromUrl, json(), async (req, res) => {
    const writer = await personWriterOf(req, accountStore);
    if (!writer) return jsonError(res, 403, 'Sign in to dismiss a question');
    const accountId = writer.by.slice('person:'.length);
    try {
      const out = await serviceFor(req).dismiss({
        urlKey: req.workspace.urlKey,
        questionId: req.params.id,
        by: writer.by,
        dispatchedBy: accountId,
      });
      return res.status(out.status).json(out.body);
    } catch (err) {
      console.error('Question dismiss error:', err?.message || err);
      return jsonError(res, 500, 'The dismissal could not be recorded; try again');
    }
  });

  return router;
}
