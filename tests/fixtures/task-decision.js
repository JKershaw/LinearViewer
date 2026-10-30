/**
 * LIN-4016: the server's decision, as a client test's fixture. The browser reads `sessions` (`sessionSummaryOf`) and the
 * per-row record (`rowRecordOf`); a fixture that feeds it must carry what the server would send, so these helpers build
 * those fields with the same server functions. A test then says what it runs (`running`, `offered`), and the helper
 * completes the rest the way `sessionSummaryOf` does.
 */
import { mainActionOf } from '../../lib/task-state.js';
import { POLLED_TARGETS } from '../../lib/dispatch-targets.js';
import { rowRecordOf } from '../../lib/task-board-view.js';

/**
 * A `sessions` block as `/state` sends it: `queued`, `busy`, `action` and `canStop` completed from `running` and
 * `offered` (a field the fixture already sets is kept).
 *
 * @param {Object} sessions
 * @param {{container?: boolean}} [opts]
 * @returns {Object}
 */
export function serverSessions(sessions, { container = false } = {}) {
  if (!sessions) return sessions;
  const running = sessions.running || null;
  const busy = sessions.busy ?? !!running;
  return {
    ...sessions,
    queued: sessions.queued !== undefined ? sessions.queued : (running && running.state === 'queued' ? running : null),
    busy,
    action: sessions.action !== undefined ? sessions.action : mainActionOf({ offered: sessions.offered || null, busy, container }),
    canStop: sessions.canStop !== undefined ? sessions.canStop : !!running && POLLED_TARGETS.includes(running.target),
  };
}

/**
 * A Home row's (or a task page's) decision record, as the server stamps it (`rowRecordOf`), with an optional subtask line.
 *
 * @param {{stateType?: string, container?: boolean, attention?: Object|null}} [args]
 * @returns {Object}
 */
export function serverRow({ stateType = 'started', container = false, attention = null } = {}) {
  return rowRecordOf({ stateType, container, attention });
}
