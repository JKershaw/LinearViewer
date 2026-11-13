/**
 * Thrown when a multi-step provider write partially lands — some sub-writes
 * (or the post-write confirmation re-read) succeed while a later one fails.
 * The only tree-wide multi-write `updateIssue` is Jira's (LIN-2012): a
 * field PUT and a status transition are necessarily two calls, so a failure
 * between them must not be reported as a total failure ("nothing changed")
 * when something already landed.
 *
 * `applied`/`failed` use the REQUEST's own vocabulary (title/description/
 * stateId — matching the PATCH body) so a caller can directly diff `applied`
 * against what it sent, rather than internal terms (fields/transition).
 * `status` mirrors the upstream failure's HTTP status (fallback 500) —
 * mirrors RefResolutionError's default-status convention.
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
