/**
 * LIN-4531 (LIN-4529 plan D2): a signed-in person answers or dismisses an agent's question, through one route each.
 *
 *   POST /workspace/:urlKey/questions/:id/answer    body {option?, words?}  — the option chosen and/or the person's own words
 *   POST /workspace/:urlKey/questions/:id/dismiss                          — no answer; the asking run takes its fallback
 *
 * The session is the person (`personWriterOf`, routes/task-records.js): `by` is `person:<account>`, read from the session,
 * never from the body. The answer and dismiss logic is lib/question-answers.js (the behaviour table is in its header).
 * This file only binds it to the request: the resume goes through lib/follow-up-dispatch.js enqueueFollowUp with the
 * workspace's owner gate and credential finalize, as the proposal-apply route does. Answers are JSON: the status and the
 * `notResumedBecause` note are for a page to read. Every rulings surface calls them through one browser handler,
 * public/question-records.js (LIN-4532, P2b): the Rulings page, Home, the run page, the task page and Flight Companion.
 *
 * Not a proxy route: a proxy bearer never reaches it, so it has no STAGE_WRITE_OPS entry and no census row
 * (tests/unit/lin-4468-stage-write-allowance.test.js walks the proxy router only), as routes/task-records.js has none.
 * The owner gate is checked before the service writes anything (`refuseResume`), so a non-owner's answer changes nothing.
 */
import { Router, json } from 'express';
import { jsonError } from '../lib/errors.js';
import { createQuestionAnswers } from '../lib/question-answers.js';
import { enqueueFollowUp, ownerRefusalReply } from '../lib/follow-up-dispatch.js';
import { resolveRunnerOwnerRefusal } from '../lib/runner-owner-gate.js';
import { personWriterOf, sessionRecordWrites } from './task-records.js';
import { dispatchQueueLimiter } from './dispatch.js';
import { publicOrigin } from '../lib/public-origin.js';

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl - the workspace middleware (lib/workspace.js)
 * @param {import('../lib/records-store.js').RecordsStore} deps.recordsStore
 * @param {Object} deps.dispatchQueueStore - the dispatch store (isRunStopped, runTailOf, followUpPromptsOf, and the rows enqueueFollowUp reads and writes)
 * @param {Object} [deps.workspacePreferencesStore]
 * @param {Object} [deps.proxyTokenStore]
 * @param {Function} deps.workspaceOwnerCheck - the hoisted owner seam (LIN-3383); absent means the resume is refused (fail closed)
 * @param {{resolveCanonicalAccountId: Function}} [deps.accountStore]
 * @param {(urlKey: string) => Promise<{accountId: string, name: string}[]>} [deps.listPeople]
 */
export function createQuestionAnswerRoutes({ workspaceFromUrl, recordsStore, dispatchQueueStore, workspacePreferencesStore = null, proxyTokenStore = null, workspaceOwnerCheck = null, accountStore = null, listPeople = async () => [] }) {
  if (!recordsStore || !dispatchQueueStore) throw new Error('question answer routes: recordsStore and dispatchQueueStore are required');
  const router = Router();

  // Nothing the record writer is built from depends on the request (the tracker and ticket reads take a per-call ctx, which a decision write never passes), so it is built once, as routes/task-records.js does.
  const writes = sessionRecordWrites({ recordsStore, listPeople });

  /** The request's own service: its resume carries the request's owner gate and origin. */
  function serviceFor(req) {
    const { urlKey, id: workspaceId } = req.workspace;
    const baseUrl = publicOrigin(req);
    return createQuestionAnswers({
      recordsStore,
      writes,
      dispatchStore: dispatchQueueStore,
      enqueueResume: ({ runId, followUpTo, prompt, target, force, dispatchedBy }) => enqueueFollowUp({
        dispatchQueueStore,
        workspacePreferencesStore,
        proxyTokenStore,
        urlKey,
        prompt,
        baseUrl,
        dispatchedBy,
        ownerCheck: workspaceOwnerCheck,
        workspaceId,
        followUpTo,
        target,
        force,
        sessionId: runId,
      }),
      // The refusal enqueueFollowUp makes (LIN-3383), read before any write.
      refuseResume: async ({ target, dispatchedBy }) => {
        const refusal = await resolveRunnerOwnerRefusal({ ownerCheck: workspaceOwnerCheck, workspaceId, accountId: dispatchedBy, target });
        return refusal ? ownerRefusalReply(refusal) : null;
      },
    });
  }

  const stringOrNull = (x) => (typeof x === 'string' ? x : null);

  router.post('/workspace/:urlKey/questions/:id/answer', dispatchQueueLimiter, workspaceFromUrl, json(), async (req, res) => {
    const writer = await personWriterOf(req, accountStore);
    if (!writer) return jsonError(res, 403, 'Sign in to answer a question');
    const accountId = writer.by.slice('person:'.length);
    try {
      const out = await serviceFor(req).answer({
        urlKey: req.workspace.urlKey,
        questionId: req.params.id,
        option: stringOrNull(req.body?.option),
        words: stringOrNull(req.body?.words),
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
