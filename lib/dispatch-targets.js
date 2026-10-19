/**
 * The one list of dispatch targets (LIN-3467). Which targets exist, and which
 * each entrance accepts, is decided here and nowhere else. No imports, so it
 * cannot create a cycle.
 *
 * Entrance -> subset:
 *   POST /api/dispatch (target validation)        DISPATCH_TARGETS
 *   proxy dispatch / kickoff / recommend + abort  POLLED_TARGETS
 *   follow-up, Collective, runner owner gate,
 *   runner poll / take (LIN-3622),
 *   session stitching                             SESSION_TARGETS
 *   "can this session be replied to" gates        NON_SESSION_TARGETS (complement)
 *   what target a follow-up goes to               followUpTarget (LIN-3672)
 *
 * Array order is behaviour: `target must be one of: ...` messages join it.
 */

/** Every target a dispatch row can carry. */
export const DISPATCH_TARGETS = Object.freeze(['cli', 'web', 'dash', 'local']);

/**
 * Poll-eligible targets (a consumer polls these). 'local' (Harbour OS) spawns server-side on the
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

/**
 * The one follow-up target rule (LIN-3672). `web` stays `web`; a missing
 * target (null, undefined, '') is an orphan loop and goes to `cli`; `cli`
 * stays `cli`. Everything else is refused with `null`: `dash` and `local`
 * cannot be followed up, and (LIN-3677) neither can an unknown string or a
 * non-string, matching the entrances that refuse a target outside
 * SESSION_TARGETS (fail closed). Never throws: each caller owns its
 * consequence for `null`. `deriveFollowUpDispatch` throws, but the CI-wake
 * sweep must not throw per row, so it records a miss instead.
 */
export const followUpTarget = (target) => {
  if (target == null || target === '') return 'cli';
  return isSessionTarget(target) ? target : null;
};
