/**
 * The task's recent runs, as the stage selector reads them (LIN-3300).
 *
 * Harbour records every dispatch: its stage (`kind`), when it finished and how it
 * ended. The selector gets the last few as plain facts, so "the plan was revised
 * after the verdict" or "an agent acted since your comment" is visible directly,
 * whatever the ticket's prose says. No runs, no list: the selector then decides from
 * the ticket alone.
 */
import { PROMPT_TEMPLATES } from './prompt-templates.js';
import { deriveLifecycleStatus, deriveCompletedAt } from './dispatch-terminal.js';

/** How many runs the selector sees, newest kept. */
export const RECENT_RUNS = 5;

const iso = (t) => (t instanceof Date ? t.toISOString() : t || null);

/**
 * Dispatch rows → run facts, oldest first. Only stage runs count: a `custom`,
 * `autopilot`, wake or abort row is not a stage, and a cancelled or expired row never
 * ran. A row still in the queue is `queued`; a taken one is `running` until it posts
 * a terminal marker, or `waiting on a person` while it reports blocked.
 * @param {Array<Object>} rows - formatted queue and history rows (lib/dispatch-store.js)
 * @param {number} [limit]
 * @returns {Array<{stage: string, at: string|null, outcome: string}>}
 */
export function recentRuns(rows = [], limit = RECENT_RUNS) {
  return rows
    .filter(r => r && PROMPT_TEMPLATES[r.kind] && !r.abort && (r.status === 'pending' || r.status === 'taken' || !r.status))
    .map(r => {
      if (r.status === 'pending') return { stage: r.kind, at: iso(r.dispatchedAt), outcome: 'queued' };
      const status = deriveLifecycleStatus(r.feedback);
      if (status === 'blocked') return { stage: r.kind, at: iso(r.feedback.at(-1)?.timestamp), outcome: 'waiting on a person' };
      if (status) return { stage: r.kind, at: deriveCompletedAt(r.feedback), outcome: status };
      return { stage: r.kind, at: iso(r.dispatchedAt), outcome: 'running' };
    })
    .sort((a, b) => Date.parse(a.at || '') - Date.parse(b.at || ''))
    .slice(-limit);
}

/**
 * Read an issue's recent runs from the dispatch store: live rows and finished ones.
 * Never throws; a missing store or a failed read is no runs.
 * @returns {Promise<ReturnType<typeof recentRuns>>}
 */
export async function loadRecentRuns(store, urlKey, issueIdentifier) {
  if (!store || !urlKey || !issueIdentifier) return [];
  try {
    const live = await store.listItems(urlKey, { issueIdentifier, projection: { prompt: 0 } });
    const history = await store.listHistory(urlKey, { issueIdentifier, limit: 4 * RECENT_RUNS });
    return recentRuns([...(live || []).map(r => ({ ...r, status: 'pending' })), ...(history?.items || [])]);
  } catch {
    return [];
  }
}

/**
 * The selector's run lines, or '' when there are none.
 * @param {ReturnType<typeof recentRuns>} [runs]
 * @returns {string}
 */
export function formatRecentRuns(runs) {
  if (!runs?.length) return '';
  const when = (at) => (at ? String(at).slice(0, 16).replace('T', ' ') : 'undated');
  return [`- Recent runs on this task, from Harbour's dispatch record (oldest first):`,
    ...runs.map(r => `  - ${r.stage}: ${r.outcome}${r.outcome === 'running' || r.outcome === 'queued' ? ', started' : ','} ${when(r.at)}`)
  ].join('\n');
}
