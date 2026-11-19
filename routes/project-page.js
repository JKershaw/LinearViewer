/**
 * LIN-4494 (piece 3): the project page and its two actions.
 *
 *   GET  /workspace/:urlKey/project                          the backlog: open records addressed to `project`, numbered oldest first
 *   POST /workspace/:urlKey/project/records/:id/make-task    hand the finding on into a new task record (to: project)
 *   POST /workspace/:urlKey/project/records/:id/decline      end the finding as declined, with a reason
 *
 * Reads touch only the store; the page never makes a task or a ticket. The actions go through the one checked
 * pipeline (lib/records/writes.js) with `by` = the signed-in person. Make-a-task is two writes (the task, then the
 * finding's end into it); the task's id derives from the finding's, so a retry after a failed end finds the task it
 * made and does not make a second one.
 */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { jsonError } from '../lib/errors.js';
import { requestFeatureFlags } from '../lib/run-controls.js';
import { createRecordWrites } from '../lib/records/writes.js';
import { renderProjectPage } from '../lib/render-project-page.js';
import { personWriterOf } from './task-records.js';
import { isTerminalState } from '../lib/providers/state-map.js';
import { STAGE_KINDS } from '../lib/prompts/stage-kinds.js';
import { KINDS } from '../lib/records/check.js';

const PROJECT = KINDS.addressees.project;

/** How many open records the backlog lists. A bound, never a silent drop: the page says when it is cut. */
export const BACKLOG_LIMIT = 500;

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl
 * @param {Function} deps.getDeployInfo
 * @param {Function} deps.getOpenRouterSource
 * @param {import('../lib/records-store.js').RecordsStore} deps.recordsStore
 * @param {{resolveCanonicalAccountId: Function}} [deps.accountStore]
 * @param {(urlKey: string) => Promise<{accountId: string, name: string}[]>} [deps.listPeople]
 */
export function createProjectPageRoutes({ workspaceFromUrl, getDeployInfo, getOpenRouterSource, recordsStore, accountStore = null, listPeople = async () => [] }) {
  if (!recordsStore) throw new Error('project page routes: recordsStore is required');
  const router = Router();
  const writes = createRecordWrites({ recordsStore, isTerminalState, askedText: () => '', stageKinds: Object.keys(STAGE_KINDS), listPeople });

  const backTo = (urlKey, query = '') => `/workspace/${encodeURIComponent(urlKey)}/project${query}`;
  const refusedTo = (urlKey, message) => backTo(urlKey, `?refused=${encodeURIComponent(String(message).slice(0, 300))}`);
  const derivedId = (base, suffix) => createHash('sha256').update(`${base}\n${suffix}`).digest('hex').slice(0, 8);

  router.get('/workspace/:urlKey/project', workspaceFromUrl, async (req, res) => {
    const { urlKey } = req.workspace;
    try {
      const open = await recordsStore.find(urlKey, { to: PROJECT, state: 'open' });
      const oldestFirst = [...open].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      const views = await recordsStore.viewsOf(urlKey, oldestFirst.slice(0, BACKLOG_LIMIT));
      const items = views.map((view, i) => ({ ...view, number: i + 1 }));
      const featureFlags = await requestFeatureFlags(req);
      const html = renderProjectPage({
        urlKey,
        items,
        canAct: Boolean(req.session?.accountId),
        refused: typeof req.query.refused === 'string' ? req.query.refused.slice(0, 300) : null,
      }, {
        deployInfo: getDeployInfo(),
        workspaces: req.session.workspaces,
        featureFlags,
        openRouterSource: getOpenRouterSource(req),
      });
      res.set('Cache-Control', 'no-store');
      return res.send(html);
    } catch (err) {
      console.error('Project page error:', err?.message || err);
      return jsonError(res, 500, 'Could not load the project backlog');
    }
  });

  router.post('/workspace/:urlKey/project/records/:id/make-task', workspaceFromUrl, async (req, res) => {
    const { urlKey } = req.workspace;
    const writer = await personWriterOf(req, accountStore);
    if (!writer) return jsonError(res, 403, 'Sign in to act on the backlog');
    try {
      const finding = await recordsStore.current(urlKey, req.params.id);
      if (!finding || finding.kind !== 'finding' || finding.state !== 'open' || finding.to !== PROJECT) {
        return res.redirect(303, refusedTo(urlKey, 'That is not an open finding on the backlog'));
      }
      const taskId = `task-${derivedId(finding.id, 'make-task')}`;
      const words = finding.fields?.says || finding.fields?.how || finding.id;
      const made = await writes.add({ urlKey, kind: 'task', input: { 'done-when': words, to: PROJECT }, by: writer.by, fixedId: taskId });
      if (made.problems) return res.redirect(303, refusedTo(urlKey, made.problems[0]?.message || 'refused'));
      const ended = await writes.end({ urlKey, id: finding.id, input: { state: 'handed-on', reason: 'made a task from the backlog', into: taskId }, by: writer.by });
      if (ended.problems) return res.redirect(303, refusedTo(urlKey, ended.problems[0]?.message || 'refused'));
      return res.redirect(303, backTo(urlKey));
    } catch (err) {
      console.error('Project make-task error:', err?.message || err);
      return res.redirect(303, refusedTo(urlKey, 'The records store is unavailable; try again'));
    }
  });

  router.post('/workspace/:urlKey/project/records/:id/decline', workspaceFromUrl, async (req, res) => {
    const { urlKey } = req.workspace;
    const writer = await personWriterOf(req, accountStore);
    if (!writer) return jsonError(res, 403, 'Sign in to act on the backlog');
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      const result = await writes.end({ urlKey, id: req.params.id, input: { state: 'declined', reason }, by: writer.by });
      if (result.problems) return res.redirect(303, refusedTo(urlKey, result.problems[0]?.message || 'refused'));
      return res.redirect(303, backTo(urlKey));
    } catch (err) {
      console.error('Project decline error:', err?.message || err);
      return res.redirect(303, refusedTo(urlKey, 'The records store is unavailable; try again'));
    }
  });

  return router;
}
