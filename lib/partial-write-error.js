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
