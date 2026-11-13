import { jsonError } from './errors.js';

/**
 * Thrown when a multi-step provider write partially lands — some sub-writes
 * succeed while a later step (another write, the post-write confirmation
 * re-read, or its check) fails. Only Jira throws it, from two methods:
 *  - `updateIssue` (LIN-2012): a field PUT and a status transition are
 *    necessarily two calls, so a failure between them must not be reported as
 *    a total failure ("nothing changed") when something already landed;
 *  - `createIssue` (LIN-4451, LIN-4452): the issue exists once Jira answers, so
 *    a failed re-read, or a `harbour.asAsked` property the site did not keep,
 *    is a partial write.
 *
 * `applied`/`failed` use the REQUEST's own vocabulary so a caller can diff
 * `applied` against what it sent, rather than internal terms: `applied` is
 * title/description/stateId (the PATCH body) or `created`; `failed` is stateId,
 * `re-read` or `property`. `status` mirrors the upstream failure's HTTP status
 * (fallback 500), as RefResolutionError's default does; what a caller is told
 * is `partialWriteEnvelope` below.
 */
export class PartialWriteError extends Error {
  constructor(message, { applied, failed, status = 500, cause } = {}) {
    super(message);
    this.name = 'PartialWriteError';
    this.applied = applied;
    this.failed = failed;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

/**
 * The caller-facing envelope for a PartialWriteError: the one place the retry rule is
 * decided, shared by every lane that maps it (routes/proxy.js, routes/workspace-api-issue-write.js,
 * routes/workspace-api-feedback.js), so the lanes cannot drift apart (LIN-4452 review, finding 1).
 *
 * A create that landed (`applied` includes 'created') is `retryable: false`: the issue exists,
 * and a retry files a duplicate. It answers 500 whatever status its confirmation re-read failed
 * with, since a 429 or 503 would tell a client to retry the create. Any other partial write is
 * an edit (both Jira edits are idempotent), so it stays `retryable: true` and keeps the upstream
 * status, so a retryable 429 is not flattened.
 *
 * @param {PartialWriteError} err
 * @returns {{ status: number, message: string, extra: object }} `extra` is the body fields beside `error`
 */
export function partialWriteEnvelope(err) {
  const created = Boolean(err.applied?.includes('created'));
  return {
    status: created ? 500 : (err.status || 500),
    message: err.message,
    extra: {
      code: 'PARTIAL_WRITE',
      category: 'upstream',
      retryable: !created,
      detail: err.cause?.message || null,
      context: { applied: err.applied, failed: err.failed },
    },
  };
}

/**
 * Answer a PartialWriteError with its envelope; false for any other error, so a catch can
 * `if (answerPartialWrite(res, err)) return;`. The session and feedback lanes call this.
 * The proxy lane sends the same `partialWriteEnvelope` itself, so it can log the status
 * (routes/proxy.js `partialWriteFailed`).
 * @param {import('express').Response} res
 * @param {*} err
 * @returns {boolean} true once it has answered
 */
export function answerPartialWrite(res, err) {
  if (!(err instanceof PartialWriteError)) return false;
  const { status, message, extra } = partialWriteEnvelope(err);
  jsonError(res, status, message, extra);
  return true;
}
