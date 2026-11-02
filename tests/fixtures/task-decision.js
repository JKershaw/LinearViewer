/**
 * LIN-4016: the server's decision, as a client test's fixture. The browser reads `sessions` (`sessionSummaryOf`) and the
 * per-row record (`rowRecordOf`); a fixture that feeds it must carry what the server would send, so these helpers build
 * those fields with the same server functions. A test then says what it runs (`running`, `offered`), and the helper
 * completes the rest the way `sessionSummaryOf` does.
 */
import { runOfferOf, NO_RUN_ACTION } from '../../lib/task-state.js';
import { POLLED_TARGETS } from '../../lib/dispatch-targets.js';
import { rowRecordOf } from '../../lib/task-board-view.js';
import { isTerminalState } from '../../lib/providers/state-map.js';

/**
 * A `sessions` block as `/state` sends it: `queued`, `busy`, `action` and `canStop` completed from `running` and
 * `offered` (a field the fixture already sets is kept).
 *
 * @param {Object} sessions
 * @param {{container?: boolean, noRun?: boolean}} [opts] - `noRun`: the task is finished, so its action is the no-run decision
 * @returns {Object}
 */
export function serverSessions(sessions, { container = false, noRun = false } = {}) {
  if (!sessions) return sessions;
  const running = sessions.running || null;
  const busy = sessions.busy ?? !!running;
  return {
    ...sessions,
    queued: sessions.queued !== undefined ? sessions.queued : (running && running.state === 'queued' ? running : null),
    busy,
    action: sessions.action !== undefined ? sessions.action : (noRun ? NO_RUN_ACTION : runOfferOf({ busyOn: busy ? { identifier: null, words: null } : null, container, step: sessions.offered || null })),
    canStop: sessions.canStop !== undefined ? sessions.canStop : !!running && POLLED_TARGETS.includes(running.target),
  };
}

/**
 * A Home row's (or a task page's) decision record, as the server stamps it (`rowRecordOf`): the gatherer's action for the
 * state it is given. A finished task decides the no-run action; a container decides Run to PR as a container (LIN-4071).
 * The subtask line is not in the record (it is `/state`'s `attention`).
 *
 * @param {{stateType?: string, container?: boolean, action?: Object|null}} [args] - `action` overrides the decided action
 * @returns {Object}
 */
export function serverRow({ stateType = 'started', container = false, action } = {}) {
  let decided = null;
  if (action !== undefined) decided = { action };
  else if (isTerminalState(stateType)) decided = { action: NO_RUN_ACTION };
  else if (container) decided = { action: runOfferOf({ container: true }) };
  return rowRecordOf({ stateType, decided });
}
