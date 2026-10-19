/**
 * The one mapping from a tagged dispatch-factory refusal to its HTTP reply
 * (LIN-3470, a child of the LIN-3449 coherence loop).
 *
 * `createDispatchItem` refuses by throwing an error carrying one tag:
 * `duplicateDispatch`, `runLimit`, `closeOutRefusal`, `taskSessionRunaway` or
 * `budgetExhausted`. Two entrances relay them — the proxy routes (via
 * `relayDispatchRefusal` in routes/proxy.js) and the session `/dispatch` route
 * (routes/dispatch.js). Both used to write the table out themselves, so a new
 * tag (LIN-3461's `taskSessionRunaway`) had to be added twice. This is the single
 * table; adding a refusal means adding it here. The one exception is the
 * run-limit status (429 or 503), which is read from `runLimitStatus` in
 * lib/plan-allowance.js (LIN-3706), beside the codes and bodies it belongs to.
 *
 * It is a pure mapper. Logging, keepalive and writing to `res` stay at each
 * entrance, because they differ per entrance (the session route is not
 * audit-logged and arms no keepalive). Grant refusals are NOT handled here —
 * `codedGrantRefusalResponse` already owns those.
 */
import {
  DUPLICATE_DISPATCH_CODE,
  BUDGET_EXHAUSTED_CODE,
  CLOSE_OUT_IS_THE_PERSONS_CODE,
  TASK_SESSION_RUNAWAY_CODE
} from './dispatch-factory.js';
import { runLimitStatus } from './plan-allowance.js';

/**
 * @param {*} err - a caught error; anything without a refusal tag yields null
 * @returns {null | {
 *   status: number,
 *   message: string,
 *   body: object,
 *   retryAfter: number|null,
 *   note: string
 * }} `body` is the JSON `extra` for `jsonError`/`keepaliveError`; `retryAfter`
 *   is non-null only where a `Retry-After` header is owed (duplicate, and the 429
 *   run limit — not the 503, not the 409 budget family); `note` is the
 *   audit-log note an audited entrance writes.
 */
export function mapDispatchRefusal(err) {
  if (!err) return null;
  if (err.duplicateDispatch) {
    const refusal = err.duplicateDispatch;
    return {
      status: 409,
      message: err.message,
      body: refusal,
      retryAfter: refusal.retryAfter,
      note: `${DUPLICATE_DISPATCH_CODE} ${refusal.id}`
    };
  }
  if (err.runLimit) {
    const refusal = err.runLimit;
    const status = runLimitStatus(refusal.code);
    return {
      status,
      message: refusal.error,
      body: { code: refusal.code, freeTier: refusal.freeTier, retryAfter: refusal.retryAfter },
      retryAfter: status === 429 ? refusal.retryAfter : null,
      note: refusal.code
    };
  }
  // Run-boundary refusal (LIN-3245 / LIN-2949 P1a).
  if (err.closeOutRefusal) {
    const refusal = err.closeOutRefusal;
    return {
      status: 409, message: err.message, body: refusal, retryAfter: null,
      note: `${CLOSE_OUT_IS_THE_PERSONS_CODE} ${refusal.sessionId}`
    };
  }
  // Per-task runaway failsafe (LIN-3461): an alarm to stop and report, never a
  // budget finish.
  if (err.taskSessionRunaway) {
    const refusal = err.taskSessionRunaway;
    return {
      status: 409, message: err.message, body: refusal, retryAfter: null,
      note: `${TASK_SESSION_RUNAWAY_CODE} ${refusal.sessionId}`
    };
  }
  if (err.budgetExhausted) {
    const refusal = err.budgetExhausted;
    return {
      status: 409, message: err.message, body: refusal, retryAfter: null,
      // Bound discriminator ('tasks') on the durable proxy-event note.
      note: `${BUDGET_EXHAUSTED_CODE} ${refusal.bound} ${refusal.sessionId}`
    };
  }
  return null;
}
