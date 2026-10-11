/**
 * The one list of dispatch targets (LIN-3467). Which targets exist, and which
 * each entrance accepts, is decided here and nowhere else. No imports, so it
 * cannot create a cycle.
 *
 * Entrance -> subset:
 *   POST /api/dispatch (target validation)        DISPATCH_TARGETS
 *   proxy dispatch / kickoff / recommend + abort  POLLED_TARGETS
 *   follow-up, Collective, runner owner gate,
 *   session stitching                             SESSION_TARGETS
 *   "can this session be replied to" gates        NON_SESSION_TARGETS (complement)
 *
 * Array order is behaviour: `target must be one of: ...` messages join it.
 */

/** Every target a dispatch row can carry. */
export const DISPATCH_TARGETS = Object.freeze(['cli', 'web', 'dash', 'local']);

/**
 * Targets a runner polls. 'local' (Harbour OS) spawns server-side on the
 * server's own /dev/tty and is never polled, so remote proxy consumers cannot
 * set it and an abort cannot ride it.
 */
export const POLLED_TARGETS = Object.freeze(['cli', 'web', 'dash']);

/** Full Claude Code sessions: follow-up, Collective, owner gate, stitching. */
export const SESSION_TARGETS = Object.freeze(['cli', 'web']);

/**
 * Complement of SESSION_TARGETS. Gates that must stay open for null/unknown
 * targets test membership here instead of negating isSessionTarget.
 */
export const NON_SESSION_TARGETS = Object.freeze(
  DISPATCH_TARGETS.filter((t) => !SESSION_TARGETS.includes(t))
);

export const isSessionTarget = (target) => SESSION_TARGETS.includes(target);
