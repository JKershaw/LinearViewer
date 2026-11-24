/**
 * lib/home-row-states.js — the one gather of a task's facts (LIN-4016 decision 7, widened by LIN-4068 D5).
 *
 * Every surface that states a task's state reads it from `gatherTaskStates`, over the same three inputs:
 *  - the workspace's issue set (after the hidden-state drop, before the assignee filter), as one children index at every
 *    depth (`buildSubtreeIndex`), so a parent sees every descendant with its tracker type, whichever view shows it;
 *  - the sessions, windowed to the read horizon HERE, before the build, so a whole-life read and a 30-day read give
 *    the same state (history displays still read the whole life; they do not come through here);
 *  - the ruling standing over those windowed sessions.
 * `lib/task-state.js` still decides; this module only gathers. The gather is pure over already-read inputs.
 *
 * `createHomeRowStates` returns `null` when the stores cannot be read (the row states are then unknown), so every
 * caller falls back to plain rows, as it always has (W7 pins this).
 */

import { buildRowStates } from './task-page-loader.js';
import { withInverseRelations } from './graph-features.js';
import { readRulingStanding } from './ruling-standing.js';
import { buildSubtreeIndex } from './subtree-index.js';
import { inReadWindow } from './read-horizon.js';
import { openQuestionsFor, openFindingsFor, titlesFromIssues } from './open-questions.js';

/** Group loops by task identifier. */
function byIdentifier(loops) {
  const map = new Map();
  for (const loop of loops || []) {
    if (!loop?.issueIdentifier) continue;
    if (!map.has(loop.issueIdentifier)) map.set(loop.issueIdentifier, []);
    map.get(loop.issueIdentifier).push(loop);
  }
  return map;
}

/**
 * The loops a state is decided from: those inside the read window (LIN-4068 D1). The stores already read the window
 * before the build (`_fetchWorkspaceData` `since`, `_admitRow`); this is the same test applied to the built loops, so
 * a caller that hands in a whole-life read still gets the windowed state.
 */
export const windowedLoops = (loops, at) => (loops || []).filter((loop) => inReadWindow(loop.dispatchedAt, at));

/**
 * The one gather (LIN-4068). Pure over already-read inputs.
 *
 * @param {Object} input
 * @param {Array<Object>} [input.issues] - the workspace's issue set, after the hidden-state drop, before the assignee
 *   filter; indexed here unless `roots` is given
 * @param {Array<{issue: Object, children: Array}>} [input.roots] - a prebuilt index over `issues` (the holder's, or Home's
 *   own, built once per request)
 * @param {Array<Object>} input.loops - any loops; windowed here
 * @param {Object|null} input.ruling - the ruling standing over the windowed loops; null derives it from `loops`
 * @param {Date} input.at
 * @param {boolean} [input.sessionsVisible=true] - false (a copy-first viewer) reads the tracker alone
 * @returns {{states: Map<string, Object>, roots: Array<Object>}} every task's state (`buildRowStates`'s shape, with
 *   `container`, `finished` and `action`), keyed by identifier, and the index it was built over
 */
export function gatherTaskStates({ issues = null, roots = null, loops = [], ruling = null, at, sessionsVisible = true, enrichLoop, deriveSessionWaiting }) {
  const index = roots || withInverseRelations([buildSubtreeIndex(issues || [])])[0];
  const states = buildRowStates({
    roots: index,
    loopsByIdentifier: byIdentifier(windowedLoops(loops, at)),
    enrichLoop, deriveSessionWaiting, now: at, sessionsVisible, ruling,
  });
  return { states, roots: index };
}

/**
 * LIN-4242: the Waiting on you reduction, read one way for Home's page and the live fragment (`GET .../api/home-waiting`).
 * The lean loops of the workspace, windowed to the read horizon, through the live-run guard (unconditional since LIN-4143) into the
 * ruling standing. Home's page (`createHomeRowStates`) and the fragment both call this, so the cards and the count
 * cannot be read from two inputs. Returns the windowed loops too, for the row states the page derives from them.
 *
 * @param {Object} deps
 * @param {Function} deps.getLoopsForWorkspace - `lib/pipeline-loops.js`'s lean workspace read
 * @param {Object} deps.dispatchStore
 * @param {Object} deps.agentStatusStore
 * @param {Function} deps.enrichLoop
 * @param {Function} [deps.now] - () → Date
 * @param {Object} [deps.recordsStore] - LIN-4494: the records store; without it `records` (LIN-4552: the person's open findings,
 *   lib/open-questions.js openFindingsFor rows) and `questions` are always empty
 * @param {Function} [deps.canonicalAccountId] - async (accountId) → the canonical account a person's records are addressed to
 * @returns {(args: {urlKey: string, at?: Date, accountId?: string|null}) => Promise<{loops: Array<Object>, ruling: Object, records: Array<Object>, questions: Array<Object>}>} a rejected read propagates
 *   to the caller, which decides (the page falls back to plain rows; the fragment answers with an error)
 */
export function createWaitingStanding({
  getLoopsForWorkspace, dispatchStore, agentStatusStore, enrichLoop, now = () => new Date(),
  recordsStore = null, canonicalAccountId = async (id) => id,
}) {
  // LIN-4549: `titlesOf` names each question's task (lib/open-questions.js): the page passes its issues, the live fragment the held
  // issue set when it is warm. Absent, a card shows its task's identifier alone.
  return async function waitingStanding({ urlKey, at = now(), accountId = null, titlesOf = null }) {
    const loops = windowedLoops(await getLoopsForWorkspace(urlKey, { dispatchStore, agentStatusStore, lean: true }).catch(() => []), at);
    // LIN-4538 (P7a): the standing is read from question records (lib/ruling-standing.js), scoped to the signed-in person, so
    // Home's count, its placement and the task states read the same open questions as the question cards below (`questions`,
    // the person's). Without a person (or when the account read fails) every person's open questions count.
    const viewer = accountId ? await canonicalAccountId(accountId).catch(() => null) : null;
    const ruling = await readRulingStanding({ urlKey, loops, at, recordsStore, to: viewer ? `person:${viewer}` : null });
    // LIN-4532 (P2b): the person's open QUESTION records are read as questions (lib/open-questions.js: the card, its asking run's
    // state), and counted: the count line, the badge and the fragment's `count` are the questions alone. A failed read costs only
    // the questions: the standing and the row states still come.
    // LIN-4552: the person's open FINDINGS are Home's "Notes for you" (`records`), below the questions and never counted
    // (finding-68be8578). They are read here, so the page and the live fragment both carry them (finding-d4767b81), in a fixed
    // number of store reads whatever their count (openFindingsFor). A failed read costs only the notes.
    const person = recordsStore ? viewer : null;
    const questions = recordsStore && dispatchStore && person
      ? await openQuestionsFor({ recordsStore, dispatchStore, urlKey, accountId: person, now: () => at, titlesOf }).catch(() => [])
      : [];
    const records = recordsStore && person
      ? await openFindingsFor({ recordsStore, urlKey, accountId: person, titlesOf }).catch(() => [])
      : [];
    return { loops, ruling, records, questions };
  };
}

/**
 * Build the Home row-state assembly over the server's stores.
 *
 * @param {Object} deps
 * @param {Function} deps.getLoopsForWorkspace - `lib/pipeline-loops.js`'s lean workspace read
 * @param {Object} deps.dispatchStore
 * @param {Object} deps.agentStatusStore
 * @param {Function} deps.enrichLoop
 * @param {Function} deps.deriveSessionWaiting
 * @param {Function} [deps.now] - () → Date
 * @param {Function} [deps.onError] - receives the error message when a store read fails
 * @param {Function} [deps.waitingStanding] - the shared Waiting on you reduction (`createWaitingStanding`); built from the
 *   same deps when omitted, so the page and the live fragment read it through one function
 * @returns {(args: {urlKey: string, issues: Array, runControls: boolean, accountId?: string|null}) => Promise<{states: Map<string, Object>, rulingCount: number, rulingRows: Array, records: Array, questions: Array, roots: Array}|null>}
 */
export function createHomeRowStates({
  getLoopsForWorkspace, dispatchStore, agentStatusStore,
  enrichLoop, deriveSessionWaiting, now = () => new Date(), onError = (message) => console.error('Home row states error:', message),
  waitingStanding = createWaitingStanding({ getLoopsForWorkspace, dispatchStore, agentStatusStore, enrichLoop, now }),
}) {
  return async function homeRowStates({ urlKey, issues, runControls, accountId = null }) {
    try {
      const at = now();
      let loops = [];
      let ruling = null;
      let records = [];
      let questions = [];
      if (runControls) {
        // LIN-4024 / LIN-4538: the open questions of this workspace (lib/ruling-standing.js), so a row and the count line
        // agree on what is open. LIN-4242: the read itself is `waitingStanding`, shared with the live fragment.
        ({ loops, ruling, records, questions } = await waitingStanding({ urlKey, at, accountId, titlesOf: titlesFromIssues(issues) }));
      }
      const { states, roots } = gatherTaskStates({ issues, loops, ruling, at, sessionsVisible: runControls, enrichLoop, deriveSessionWaiting });
      // LIN-4114: the rows the count is taken from, passed through beside it (count stays rows.length).
      // LIN-4494 / LIN-4552: the badge and the count line are the open questions (`rulingCount`); the person's notes (`records`, open
      // findings) ride beside them, uncounted.
      // LIN-4532 (P2b) / LIN-4538 (P7a): the count is the open person questions, read once in the standing (`ruling.rows`); the
      // cards are the signed-in person's (`questions`). The nav badge reads the Rulings feed, which also lists old rulings
      // until P7b retires them, so the two can differ while one is open.
      return {
        states, roots, rulingCount: ruling ? ruling.rows.length : 0, rulingRows: ruling ? ruling.rows : [], records, questions,
      };
    } catch (err) {
      onError(err.message);
      return null;
    }
  };
}
