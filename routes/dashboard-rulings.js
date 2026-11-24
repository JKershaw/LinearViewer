/**
 * The rulings feed (LIN-3742 split of routes/dashboard.js):
 *
 *   GET  /workspace/:urlKey/api/dashboard/rulings — the signed-in person's open questions (ambient count + Rulings tab)
 *
 * LIN-4541 (LIN-4529 P7b-2): a ruling is a question record and its answer a decision record. The feed lists the open
 * question records addressed to the signed-in person (LIN-4532), answered and dismissed through the questions route
 * (routes/question-answers.js). The old rows (loop decisions scraped from a DECISION: block, task-bound rows the retired
 * scan wrote, proposed dismissals) and their write routes (dismiss, reverse-withdrawal, answer, keep) are gone with the
 * predicate that stitched them; old feedback rows stay as history and are not rows here.
 *
 * The feed cache arrives in `ctx` from the composer: the GET fills the very `sessionsFeedCache` instance the feed and
 * the run page read, under its own `rulings` view namespace.
 */
import { Router } from 'express';
import { keepaliveError } from '../lib/errors.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { connectedWorkspaces } from './dashboard-session-state.js';
import { openQuestionsFor, titlesFromIssues } from '../lib/open-questions.js';
import { readRulingStanding } from '../lib/ruling-standing.js';
import { personAccountIdOf } from './task-records.js';

/**
 * LIN-4532 (P2b): the open question records addressed to the signed-in person, in each connected workspace, as rows of this feed
 * (`kind: 'question'`), so the page, the count and the badge read one list. The person is the canonical account
 * (personAccountIdOf), the id the answer route files its decision under. Null when there is no person to read for.
 */
async function openQuestionRowsFor({ accountId, workspaces, recordsStore, dispatchQueueStore, merged = [] }) {
  if (!recordsStore || !dispatchQueueStore || !accountId) return [];
  const rows = [];
  for (const w of workspaces) {
    // LIN-4549: each question's task title from the runs this feed already read (a run carries its task's title, resolved at the
    // read seam, LIN-962), so no tracker call is added to the 5s badge poll. A task with no run here shows its identifier alone.
    const titlesOf = titlesFromIssues(merged.filter((l) => l?.workspaceUrlKey === w.urlKey).map((l) => ({ identifier: l.issueIdentifier, title: l.issueTitle })));
    const questions = await openQuestionsFor({ recordsStore, dispatchStore: dispatchQueueStore, urlKey: w.urlKey, accountId, titlesOf });
    for (const q of questions) {
      rows.push({
        kind: 'question',
        questionId: q.questionId,
        // The card reads `asks` (lib/question-record-card.js, the openQuestionsFor row's own name); `question` stays for the
        // feed's other readers. Without `asks` the Rulings page drew the card with no question (LIN-4541).
        asks: q.asks,
        question: q.asks,
        options: q.options,
        recommended: q.recommended,
        // LIN-4549: the card draws its own task line from the row's `ticket` and `title`.
        ticket: q.ticket ?? null,
        title: q.title ?? null,
        ifUnanswered: q.ifUnanswered,
        interactive: q.interactive,
        state: q.state,
        reason: q.reason,
        askedAt: q.askedAt,
        // The task by its identifier (`ticket`, what a task page is keyed by), so the row heads like a run row (finding-9221fb7a).
        anchor: { workspaceUrlKey: w.urlKey, taskId: q.taskId, runId: q.runId, loopId: null, issueId: null, issueIdentifier: q.ticket ?? null, issueTitle: q.title ?? null, target: null },
      });
    }
  }
  return rows;
}

/**
 * LIN-3983, moved onto question records (LIN-4541): the loop ids whose question is open, over the cached loop set. A loop is
 * open when it is in the lineage of a run that asked one of this person's open questions (lib/ruling-standing.js, the reader
 * the task page and Home use), so the Observation waiting block gives a compact row only to a waiting run no question row
 * speaks for.
 */
async function openLoopIdsFor({ accountId, workspaces, merged, recordsStore }) {
  if (!recordsStore || !accountId) return [];
  const open = new Set();
  for (const w of workspaces) {
    const loops = merged.filter((l) => l.workspaceUrlKey === w.urlKey);
    const { openLoopIds } = await readRulingStanding({ urlKey: w.urlKey, loops, recordsStore, to: `person:${accountId}` });
    for (const id of openLoopIds) open.add(id);
  }
  return [...open];
}

// One cached loop read backs the waiting block's open-loop set — the same `sessionsFeedCache` instance as `/sessions`,
// under a separate `rulings` view namespace so the two payload shapes never collide on one cache entry. The ambient
// count stays scoped to `req.session.workspaces` like every other Observation read here, never fleet-wide.
function rulingsFeed({ sessionsFeedCache, mergeLoops, recordsStore, dispatchQueueStore, accountStore }) {
  return async (req, res) => {
    const workspaces = connectedWorkspaces(req.session);

    const keepalive = armKeepalive(res);
    try {
      const merged = await sessionsFeedCache.get(
        sessionsFeedCache.keyFor(workspaces, 'rulings'),
        () => mergeLoops(workspaces)
      );
      // A failed records or dispatch-store read costs only the questions, never the feed the 5s badge poll reads
      // (finding-ab3270e4).
      const accountId = req.session?.accountId ? await personAccountIdOf({ session: req.session }, accountStore).catch(() => null) : null;
      const rulings = await openQuestionRowsFor({ accountId, workspaces, recordsStore, dispatchQueueStore, merged }).catch(() => []);
      const openLoopIds = await openLoopIdsFor({ accountId, workspaces, merged, recordsStore }).catch(() => []);

      // LIN-4103 beat 3: the badge on a workspace page counts that workspace's rulings (the URL's workspace, by each row's
      // anchor). `count` stays the all-workspaces count the Rulings tab reads; the badge reads `workspaceCount`.
      const pageUrlKey = req.params?.urlKey || null;
      const workspaceCount = rulings.filter((r) => r.anchor?.workspaceUrlKey === pageUrlKey).length;
      keepalive.send(200, {
        workspaces,
        count: rulings.length,
        workspaceCount,
        rulings,
        openLoopIds,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Dashboard rulings error:', error);
      keepaliveError(keepalive, 500, 'Could not load rulings');
    }
  };
}

/**
 * @param {Object} ctx - the composer's resolved dependencies plus its shared closures
 * @returns {Router}
 */
export function createDashboardRulingsRoutes(ctx) {
  const { workspaceFromUrl } = ctx;
  const router = Router();
  router.get('/workspace/:urlKey/api/dashboard/rulings', workspaceFromUrl, rulingsFeed(ctx));
  return router;
}
