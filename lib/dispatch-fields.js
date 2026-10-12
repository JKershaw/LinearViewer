/**
 * Dispatch run-row fields, declared once (LIN-3486, part A of LIN-3471).
 *
 * The dispatch store used to hand-list the same 23 normalisers in four hops:
 * `addItem` (queue document), `_archiveItem` (queue -> history), and the two
 * projections `_formatHistoryItem` / `_formatItem`. A field added to one hop and
 * missed in another dropped silently on that hop. The file records six such
 * incidents (LIN-1698, LIN-1751, LIN-1825, LIN-1932, LIN-1948, LIN-2615). The
 * cause was the hand-listing, so the 23 always-present fields now live here and
 * all four hops read `normalizeRunFields`. To add a run-row field that is
 * always present with a default, add ONE entry to `RUN_FIELDS`; to remove one,
 * delete that entry.
 *
 * What does NOT belong here: SPARSE keys. A key that is written only when
 * present (the declared-mint record and its refusal code, `issueSource`, the
 * removed `ifParked`) must keep an undeclared row's key set byte-identical, so
 * it stays a conditional spread or assignment in the hops. Keys that differ by
 * hop on purpose (issue*, promptName, dispatchedBy, timestamps, bootstrapToken,
 * trimHistory, sessionGroupId, rootItemId, producingItem*) also stay in the
 * store. `RUN_FIELDS` is only for keys that are always present with a default
 * and are normalised identically in every hop.
 *
 * `RUN_FIELD_RULES` holds the seven value rules the entrances share (LIN-3487
 * reads them): `absent` says which values skip the check, `valid` accepts a
 * present value, `message` is the exact reject text. The "absent" rule is not
 * uniform: `maxTasks` skips `undefined` and `null`; the booleans and
 * `subscription` skip only `undefined`, so `null` is rejected for them.
 *
 * Store-safe: imports `./dispatch-wake.js` only (LIN-2388, no import cycle).
 */
import { DEFAULT_SUBSCRIPTION, SUBSCRIPTION_LEVELS, isValidSubscription } from './dispatch-wake.js';

/**
 * A positive integer (>= 1). `null`, strings and `NaN` are false.
 * @param {*} v
 * @returns {boolean}
 */
export function isPositiveInteger(v) {
  return Number.isInteger(v) && v >= 1;
}

/**
 * name -> (src) => normalised value, in the order the fields have in every hop.
 * Each expression is the one the hops carried, with the receiver renamed `src`.
 * `||` collapses every falsy value; `??` replaces only nullish (so `0`, `''`
 * and `false` survive); `=== true` coerces to a strict boolean.
 */
export const RUN_FIELDS = Object.freeze({
  // Stable task classification. The route layer resolves this (explicit `kind`
  // or derived from promptName); 'custom' is a defensive default for any caller
  // that doesn't supply one. See lib/prompt-templates.js.
  kind: (src) => src.kind || 'custom',
  target: (src) => src.target || 'cli',
  // Silent-drop class: LIN-1932 (see PERIODICAL_PROJECTION in the store).
  repo: (src) => src.repo || null,
  // Execution model (LIN-438): the model the consumer/runner passes to its own
  // CLI (e.g. claude --model) to RUN this prompt, NOT the OpenRouter generation
  // model that WRITES prompts (lib/openrouter.js AVAILABLE_MODELS; different
  // namespace, deliberately not validated here). Opaque OpenRouter-style
  // provider/model wire value; stored + forwarded blindly. null preserves the
  // consumer's current default (e.g. Opus). The load-bearing forward: without it
  // on every hop the field is stored but undetectable on poll/take.
  model: (src) => src.model || null,
  // Execution harness (LIN-1084): which harness (e.g. 'claude-code', 'opencode')
  // the consumer/runner should use to run this prompt. Opaque, not
  // registry-validated; stored + forwarded blindly. null preserves the
  // consumer's own default/precedence chain. Load-bearing forward on poll/take.
  harness: (src) => src.harness || null,
  // Terminal-emulator driver (LIN-2452): which terminal driver (e.g. 'terminal',
  // 'iterm', 'kitty', 'tmux') the runner should launch this session in. Opaque,
  // not registry-validated; stored + forwarded blindly. null preserves the
  // runner's own default; Harbour never interposes one. Load-bearing forward.
  terminal: (src) => src.terminal || null,
  // Effort (LIN-2615): the effort level for the consumer/runner to pass to its
  // own CLI (e.g. --effort). Opaque, not registry-validated; an out-of-set value
  // is warned about at write time, never rejected. Stored + forwarded blindly;
  // null preserves the consumer's own default/precedence chain.
  effort: (src) => src.effort || null,
  // Frozen preset snapshot + display name (LIN-1390). Stamped ONLY on
  // kind:'autopilot' rows carrying a selected or inherited dispatch preset
  // (lib/dispatch-factory.js); null otherwise. Unlike bootstrapToken these are
  // not credentials: they belong in history, on the poll/take wire and on the
  // watch echo, so a child-autopilot dispatched as a followUpTo can read this
  // row's presetConfig back (via getItemStatus) and inherit it transitively.
  // presetConfig is passed by reference, never copied.
  presetConfig: (src) => src.presetConfig || null,
  presetName: (src) => src.presetName || null,
  // Optional follow-up reference: the original dispatchId whose session the
  // downstream dispatcher should resume. Stored + forwarded blindly (no
  // liveness check here); cli/web only. See LIN-415.
  followUpTo: (src) => src.followUpTo || null,
  // Force-resume flag (LIN-559): when true a follow-up overrides the runner's
  // active-session liveness guard so a wedged/sleeping session can still be
  // resumed (the human asserts the prior process is dead, see LIN-546). Since
  // LIN-1656 it ALSO overrides the API-side duplicate-dispatch guard on an
  // issue-scoped fresh dispatch (consumed in `createDispatchItem`, not here).
  // So the route layer no longer requires a followUpTo/abort to accept it.
  // Stored + forwarded blindly; the runner reads item.force, so it is the
  // load-bearing forward: without it on every hop the runner never sees it.
  force: (src) => src.force === true,
  // Abort verb (LIN-743): when `abort` is true the consumer cancels/closes the
  // session named by `abortTo` instead of running a prompt. Stored + forwarded
  // blindly; the route layer enforces the contract (abortTo required + UUID, own
  // target poll-eligible, mutually exclusive with followUpTo). Load-bearing
  // forward: without it the consumer never sees the verb.
  abort: (src) => src.abort === true,
  abortTo: (src) => src.abortTo || null,
  // Cascade-close modifier (LIN-946): when true, abortTo names a subtree root
  // Harbour expands into one abort per descendant. Stored + forwarded blindly
  // for wire completeness; consumed by Harbour's expansion (which emits plain
  // aborts), not the runner. The route layer rejects cascade:true without abort.
  cascade: (src) => src.cascade === true,
  // Optional autopilot session reference: the dispatchId of the autopilot run
  // that spawned this worker. Stored + forwarded blindly (no liveness check);
  // any target, groups workers into one session. See LIN-591.
  sessionId: (src) => src.sessionId || null,
  // Periodical-template join key (LIN-1825): the periodicals-registry template
  // id this dispatch was minted from. Stamped once at dispatch time, never
  // maintained; null for every non-periodical dispatch. G1: the fold's only
  // queue read is listItems()/pollAvailable() -> the formatter, and the history
  // read is listHistory(), so a field missing from any hop drops the id there
  // (the LIN-1698/LIN-1751 silent-drop class). pollAvailable(urlKey) is a bare
  // listItems(urlKey) alias, so this field is additively visible on the runner's
  // poll/take wire too, deliberately.
  periodicalId: (src) => src.periodicalId || null,
  // Optional scope bound on a kickoff run (LIN-1751): this run covers up to
  // `maxTasks` distinct tasks, enforced at the dispatch-factory seam (step 1.5)
  // by `countDistinctTasksForSession`, keyed on THIS row's own `_id` as the
  // run's `sessionId`. null (the default) means unbounded. Load-bearing on every
  // hop, not a consistency nicety (LIN-1698 failure class): the budget guard
  // reads the anchor through getItemStatus, which resolves through the
  // formatter while the kickoff row is queued and through the archive hop (then
  // the history formatter) within seconds of a take. A hop that drops it makes
  // the guard read `undefined` and silently stop enforcing on every real run.
  maxTasks: (src) => src.maxTasks ?? null,
  // Run-boundary fact (LIN-3245/LIN-2949 P1a): `'pr'` means this run stops at
  // its PR and must not dispatch `close-out`; enforced at the dispatch-factory
  // seam and inherited by child autopilots. null (the default) is byte-identical
  // to before the field. Same every-hop rationale as maxTasks: the seam reads
  // the run row through the archive hop and the formatters.
  stopAt: (src) => src.stopAt ?? null,
  // Run variant (LIN-3248 N2): the authoritative standard/stepper fact the run
  // page reads for the seam-guard promise. Stored + forwarded blindly; null (the
  // default) is unknown and fails the promise closed. Same every-hop rationale
  // as stopAt.
  variant: (src) => src.variant ?? null,
  // Opt-in completion hold (LIN-795/LIN-797): when true the runner holds the
  // session open at completion to receive in-session follow-ups (beats) instead
  // of finalizing. Coerced to a strict boolean, default false; forwarded blindly,
  // the runner owns the behaviour.
  waitForFollowUps: (src) => src.waitForFollowUps === true,
  // Push-based inter-session comms (LIN-826), stored + forwarded blindly exactly
  // like waitForFollowUps/force; Harbour owns no semantics beyond the wake.
  //   queueIfBusy  - the runner leaves a busy-target follow-up unclaimed rather
  //                  than failing it (LIN-827 runner path).
  //   subscription - edge declaration (LIN-900 section 6): which of this child's
  //                  events wake the dispatching parent (section 5 matrix). Enum,
  //                  declared once on the edge; Harbour reads it when building
  //                  the wake follow-up. Undeclared -> 'terminal-only'.
  queueIfBusy: (src) => src.queueIfBusy === true,
  subscription: (src) => src.subscription || DEFAULT_SUBSCRIPTION,
  // Consumer poll-recency stamp (LIN-2885): computed once by dispatch-factory.js's
  // createDispatchItem at enqueue time. null means "never" (no consumer token has
  // ever polled/taken this workspace), distinct from a concrete stale ISO
  // timestamp. Same silent-drop risk as the other fields: it must be threaded
  // across the queue -> history archive hop and both projections.
  consumerLastSeenAt: (src) => src.consumerLastSeenAt || null,
});

// Computed once at load: the formatters run on the list/poll hot path.
const RUN_FIELD_ENTRIES = Object.freeze(Object.entries(RUN_FIELDS));

/**
 * The 23 normalised run-row fields of `src`, as a fresh plain object. Never
 * mutates `src`; a null/undefined `src` yields the defaults.
 * @param {Object|null|undefined} src - a queue doc, history doc or item-shaped object
 * @returns {Object}
 */
export function normalizeRunFields(src) {
  const from = src ?? {};
  const out = {};
  for (const [name, normalise] of RUN_FIELD_ENTRIES) out[name] = normalise(from);
  return out;
}

const SUBSCRIPTION_MESSAGE = `subscription must be one of: ${SUBSCRIPTION_LEVELS.join(', ')}`;
const isBoolean = (v) => typeof v === 'boolean';
const isUndefined = (v) => v === undefined;

/** name -> { absent, valid, message }; messages are the exact entrance texts. */
export const RUN_FIELD_RULES = Object.freeze({
  maxTasks: Object.freeze({
    absent: (v) => v == null,
    valid: isPositiveInteger,
    message: 'maxTasks must be an integer >= 1',
  }),
  // Run-boundary fact (LIN-3245): only 'pr' is accepted. null and undefined are absent.
  stopAt: Object.freeze({ absent: (v) => v == null, valid: (v) => v === 'pr', message: "stopAt must be 'pr'" }),
  force: Object.freeze({ absent: isUndefined, valid: isBoolean, message: 'force must be a boolean' }),
  cascade: Object.freeze({ absent: isUndefined, valid: isBoolean, message: 'cascade must be a boolean' }),
  waitForFollowUps: Object.freeze({
    absent: isUndefined,
    valid: isBoolean,
    message: 'waitForFollowUps must be a boolean',
  }),
  queueIfBusy: Object.freeze({ absent: isUndefined, valid: isBoolean, message: 'queueIfBusy must be a boolean' }),
  subscription: Object.freeze({
    absent: isUndefined,
    valid: isValidSubscription,
    message: SUBSCRIPTION_MESSAGE,
  }),
});

/**
 * Checks one value against its field's rule.
 * @param {string} name - one of the RUN_FIELD_RULES keys
 * @param {*} value
 * @returns {string|null} null when absent or valid, else the rule's message
 * @throws {TypeError} for a name with no rule (a typo must fail loudly)
 */
export function validateRunField(name, value) {
  if (!Object.hasOwn(RUN_FIELD_RULES, name)) {
    throw new TypeError(`validateRunField: no rule for "${name}"`);
  }
  const rule = RUN_FIELD_RULES[name];
  return rule.absent(value) || rule.valid(value) ? null : rule.message;
}
