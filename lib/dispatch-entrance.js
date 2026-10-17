/**
 * The one authority for the dispatch entrances' decisions (LIN-3604; LIN-3592 rebuilt the
 * three entrance files and left each making these decisions itself, because a source-text
 * census pinned them by the route they sat in; LIN-3601 turned those pins into behaviour
 * sweeps and freed this seam).
 *
 * Four POST handlers enqueue work: session dispatch (S, routes/dispatch.js), proxy dispatch
 * (P) and recommend-and-dispatch (R, both in routes/proxy-dispatch.js), and autopilot kickoff
 * (K, routes/proxy-kickoff.js). Each is a thin forwarder that builds its lane context and
 * calls one `enter*` below. Everything the four have in common is decided here, once: the
 * order and text of the body checks, the issue's credential, the proxy-context policy, the
 * free-tier run gate, the one `createDispatchItem` call (the follow-up gate, the launch
 * attach, the row's fields), the 201 and the mapping of an enqueue failure.
 *
 * What stays with the callers, and is handed in:
 *   - the registrations, middleware chains (`requireGrant('dispatch')` among them), rate
 *     limiters and factory signatures: routes own where a request enters;
 *   - the Agent API closures (`logEvent`, `relayDispatchRefusal`, `resolveProviderAccess`,
 *     `workspaceUnavailable`, `denyIfUnsupported`, `graphqlErrorStatus`, the free-tier
 *     charge, the recommendation compute): they are owned by the proxy composer;
 *   - S's owner gate (`ctx.ownerGate`, required: an `enterSessionDispatch` call without it
 *     throws rather than skip the gate) and S's task-mode record and Harbour OS spawn
 *     (`ctx.afterEnqueue`).
 * This module imports nothing from routes/.
 *
 * Where the lanes differ on purpose the difference is a named lane value, with its reason
 * beside it. Where they differ and nothing says why, today's behaviour is kept and written up
 * in the PR (the "(d)" items), not decided here.
 */
import { badRequest, jsonError, keepaliveError, notFound, serviceUnavailable, classifyUpstreamError } from './errors.js';
import { MAX_NAME_LENGTH, MAX_DESCRIPTION_LENGTH } from './issue-write-validation.js';
import { armKeepalive, clientGoneSignal } from './http-keepalive.js';
import { DEFAULT_SUBSCRIPTION } from './dispatch-wake.js';
import { createDispatchItem } from './dispatch-factory.js';
import { mapDispatchRefusal } from './dispatch-refusal.js';
import {
  validateOpaqueDispatchField, validateSessionId, validateDispatchPayload, executionFieldError,
  abortFollowUpError, abortToError, cascadeAbortError, dispatchKindError, periodicalIdError,
  isValidAutopilotVariant, targetError, followUpToError
} from './dispatch-validation.js';
import { validateRunField } from './dispatch-fields.js';
import { isDanglingReferent, danglingReferentBody, ISSUE_NOT_FOUND_CODE } from './dispatch-referent-guard.js';
import {
  attachProxyContext, shouldUseMcpTokenField, provisionResumeCredential,
  isStructuralGrantRefusal, isCodedGrantRefusal, codedGrantRefusalResponse
} from './proxy-preamble.js';
import { declaredProviderDisplayName, resolvedProviderUi, graphqlErrorDetail, graphqlErrorExtra } from './proxy-graphql-errors.js';
import { buildConsumerPollWarning } from './consumer-poll-warning.js';
import { buildRunGate, resolveChatCredential, isAiUnavailable } from './chat-request.js';
import { describeDescent, resolveRecommendation } from './recommend-recurse.js';
import { generatePrompt, hasPrompt, deriveDispatchKind, getPromptDisplayName, PROMPT_TEMPLATES } from './prompt-templates.js';
import { PERIODICAL_AUTOPILOT_TAIL, resolvePeriodicalIdFromGateMarker } from './periodicals.js';
import {
  isValidIssueId, dispatchIssueSourceField, resolveIssueBinding, getWorkspaceCallScope, AMBIGUOUS_CALL_SCOPE
} from './workspace.js';
import { getProviderForWorkspace, getProvider } from './providers/registry.js';
import { DISPATCH_RUNGS, SURFACES } from './task-mode-store.js';
import { DISPATCH_TARGETS, POLLED_TARGETS } from './dispatch-targets.js';
import {
  buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT, AUTOPILOT_VARIANTS, AUTOPILOT_VARIANT_DEFAULT
} from './prompts/autopilot-kickoff.js';

/**
 * Run the checks in order and return the first failure message, or null.
 * A check returns a message (or a falsy value for "fine"), and may be async —
 * a check may read a store, as the preset lookup does. Later checks do not run
 * once one has failed, so an earlier failure never spends a later read.
 *
 * @param {Array<() => (string|null|undefined|false|Promise<string|null|undefined|false>)>} checks
 * @returns {Promise<string|null>}
 */
export async function firstFailure(checks) {
  for (const check of checks) {
    const message = await check();
    if (message) return message;
  }
  return null;
}

/**
 * The reject text for an opaque string field (model, harness, effort, repo, ...),
 * or null when the value is fine. `validateOpaqueDispatchField` answers
 * `{ error }`; every entrance wants only the text.
 *
 * @param {*} value
 * @param {string} name
 * @param {{maxLength?: number, reportReceivedLength?: boolean}} [options]
 * @returns {string|null}
 */
export function opaqueFieldError(value, name, options) {
  return validateOpaqueDispatchField(value, name, options)?.error ?? null;
}

// ─── The body checks (D3–D7) ──────────────────────────────────────────────────
//
// Every entrance answers the FIRST failure, so the order of its checks is part of its
// contract. The unit of order is the step: a table of named steps, and each lane lists its
// own steps in its own order below. A group is only a name for a run of steps that sit
// adjacent and in the same order in every lane that uses it, so a group cannot reorder a lane.

// Is this dispatch fresh: not an abort, a cascade or a follow-up. Only a fresh dispatch for a
// task can carry a ladder / run-boundary modifier; a modifier that could never be recorded is
// rejected rather than silently dropped (the cascade/abortTo precedent).
const isFreshDispatch = ({ isAbort, cascade, followUpTo }) => !(isAbort || cascade === true || (followUpTo !== undefined && followUpTo !== null));

// Ladder entry rung (LIN-2942): which rung of the opened task's ladder this dispatch was
// pressed from. Optional; absent/null ⇒ no mode event and the route behaves exactly as
// without it. Only a fresh dispatch for a task is a ladder press, so a modifier that could
// never be recorded is rejected rather than silently dropped.
function entryRungFailure({ entryRung, isAbort, cascade, followUpTo, issueIdentifier }) {
  if (entryRung === undefined || entryRung === null) return null;
  if (!DISPATCH_RUNGS.includes(entryRung)) return `entryRung must be one of: ${DISPATCH_RUNGS.join(', ')}`;
  if (!isFreshDispatch({ isAbort, cascade, followUpTo })) return 'entryRung is only valid on a fresh dispatch (not abort, cascade or followUpTo)';
  if (!issueIdentifier) return 'entryRung requires issueIdentifier';
  return null;
}

// Run-boundary fact (LIN-3245 / LIN-2949 P1a): `stopAt: 'pr'` on a fresh
// autopilot kickoff means this run stops at its PR — its close-out is the
// person's to send. A DEDICATED, validated body field, never derived from
// `entryRung` (a browser-sent measurement, not a gate). Only the value
// `'pr'` is accepted, and only on a fresh autopilot dispatch for a task;
// any modifier that could never carry the boundary is rejected rather than
// silently dropped (the entryRung/cascade/abortTo precedent above).
function stopAtFailure({ stopAt, kind, isAbort, cascade, followUpTo, issueIdentifier }) {
  if (stopAt === undefined || stopAt === null) return null;
  const stopAtMsg = validateRunField('stopAt', stopAt);
  if (stopAtMsg) return stopAtMsg;
  if (!isFreshDispatch({ isAbort, cascade, followUpTo })) return 'stopAt is only valid on a fresh dispatch (not abort, cascade or followUpTo)';
  if (kind !== 'autopilot') return "stopAt requires kind 'autopilot'";
  if (!issueIdentifier) return 'stopAt requires issueIdentifier';
  return null;
}

// Run variant (LIN-3248 N2): the authoritative standard/stepper fact the
// run page reads to decide whether the "Harbour stops this run at the PR"
// promise is backed. A DEDICATED, validated body field (never sniffed
// from promptName), only on a fresh autopilot dispatch for a task; absent
// stays null, which the page reads as unknown and fails the promise
// closed. Same freshness discipline as stopAt above.
function variantFailure({ variant, kind, isAbort, cascade, followUpTo }) {
  if (variant === undefined || variant === null) return null;
  if (!isValidAutopilotVariant(variant)) return "variant must be 'standard' or 'stepper'";
  if (!isFreshDispatch({ isAbort, cascade, followUpTo })) return 'variant is only valid on a fresh dispatch (not abort, cascade or followUpTo)';
  if (kind !== 'autopilot') return "variant requires kind 'autopilot'";
  return null;
}

// Selected dispatch preset (LIN-1390): an unknown/invalid id is rejected up front — the
// factory treats a presetId it can't resolve as "no preset" (a defensive fallback for the
// lookup below), not a validation gate, so this is the one place that contract is enforced.
const presetShapeFailure = ({ presetId }) => (presetId !== undefined && presetId !== null && (typeof presetId !== 'string' || !presetId.trim()) ? 'presetId must be a non-empty string' : null);

/**
 * The check steps. A step takes the input one lane builds (its body's fields, with the lane's
 * own values beside them: `isAbort`, `targets`, `rawBody`, the preset lookup, the resolved
 * kickoff mode and variant) and answers the failure text, or a falsy value.
 */
const STEPS = {
  // Abort verb (LIN-743): an abort item asks the consumer to cancel/close an existing session
  // (named by abortTo) instead of running a prompt, so it carries no prompt and skips the
  // prompt-required check. abort and followUpTo are mutually exclusive.
  abortFollowUp: ({ isAbort, followUpTo }) => abortFollowUpError({ isAbort, followUpTo }),
  promptRequired: ({ isAbort, prompt }) => (!isAbort && (!prompt || typeof prompt !== 'string') ? 'prompt is required and must be a string' : null),
  target: ({ target, targets }) => targetError(target, targets),
  abortTo: ({ isAbort, abortTo }) => abortToError({ isAbort, abortTo }),
  // Abort eligibility (LIN-743): the abort item's OWN target must be poll-eligible
  // (cli/web/dash) — eligibility is NOT derived from the aborted session's substrate. 'local'
  // (Harbour OS) spawns server-side and is never polled, so it cannot carry an abort. Default
  // 'cli'. (The proxy target set is already exactly the poll-eligible set, so the proxy lanes
  // have no separate step.)
  abortEligibility: ({ isAbort, target }) => (isAbort && !POLLED_TARGETS.includes(target || 'cli') ? 'abort target must be poll-eligible (cli, web, or dash)' : null),
  // Cascade close (LIN-946): a boolean modifier on an abort. When true the abort's `abortTo`
  // names the ROOT session of a subtree; Harbour expands the one call into an abort per
  // discovered descendant session. Like abortTo it is only meaningful alongside abort —
  // reject cascade:true without it rather than storing an inert flag.
  cascadeShape: ({ cascade }) => validateRunField('cascade', cascade),
  cascadeNeedsAbort: ({ isAbort, cascade }) => cascadeAbortError({ isAbort, cascade }),
  // Validate kind if provided; when omitted it is derived from promptName.
  kind: ({ kind }) => dispatchKindError(kind),
  // Optional verb override (LIN-573) on recommend-and-dispatch. Validate with hasPrompt()
  // (PROMPT_TEMPLATES keys only), NOT isValidDispatchKind(): the latter admits body-less
  // meta-kinds (defer/custom/autopilot/periodical) that have no generate() and would dispatch
  // an empty prompt. The caller never supplies prompt text — only the key.
  kindTemplateKey: ({ kind }) => (kind !== undefined && (typeof kind !== 'string' || !hasPrompt(kind))
    ? `kind must be a valid prompt template key: ${Object.keys(PROMPT_TEMPLATES).join(', ')}`
    : null),
  // Periodical-template join key (LIN-1825): registry-membership check, not format validation,
  // so it stays out of validateDispatchPayload (deliberately format-only, never against a
  // model registry). Optional; absent means a non-periodical dispatch.
  periodicalId: ({ periodicalId }) => periodicalIdError(periodicalId),
  // Opt-in completion hold (LIN-797): boolean, default false. Stored + forwarded blindly —
  // the runner owns the behaviour (see LIN-795).
  waitForFollowUps: ({ waitForFollowUps }) => validateRunField('waitForFollowUps', waitForFollowUps),
  // Push-based inter-session comms, stored + forwarded blindly like waitForFollowUps/force —
  // Harbour owns no semantics beyond wake: queueIfBusy (LIN-827) leaves a busy-target
  // follow-up unclaimed rather than failing it; subscription (LIN-900 §6) is the edge
  // declaration, enum 'everything'|'terminal-only', declared and never inferred.
  queueIfBusy: ({ queueIfBusy }) => validateRunField('queueIfBusy', queueIfBusy),
  subscription: ({ subscription }) => validateRunField('subscription', subscription),
  presetShape: presetShapeFailure,
  presetLookup: async ({ presetId, presets }) => {
    if (presetId === undefined || presetId === null || !presets.store) return null;
    const preset = await presets.store.get(presets.urlKey, presetId);
    return preset ? null : 'Invalid or unknown presetId';
  },
  // Task budget (LIN-1751/LIN-1737, LIN-2975): a SCOPE bound on the run — up to this many
  // distinct tasks — enforced deterministically at the dispatch-factory seam. Validated here,
  // up front, so a run declared through any entrance rejects an invalid budget identically.
  // Optional; absent/null ⇒ no budget.
  maxTasks: ({ maxTasks }) => validateRunField('maxTasks', maxTasks),
  attachProxy: ({ attachProxy }) => (attachProxy !== undefined && typeof attachProxy !== 'boolean' ? 'attachProxy must be a boolean' : null),
  entryRung: entryRungFailure,
  stopAt: stopAtFailure,
  variant: variantFailure,
  // LIN-2944 P1 (handover d610edd0): the opened-task surface a ladder press came from,
  // recorded on the mode event. Optional; out of vocabulary ⇒ 400.
  surface: ({ surface }) => ((surface !== undefined && surface !== null) && !SURFACES.includes(surface) ? `surface must be one of: ${SURFACES.join(', ')}` : null),
  // Reject local target from non-localhost requests
  localHost: ({ target, host }) => (target === 'local' && !['localhost', '127.0.0.1'].includes((host || '').split(':')[0])
    ? 'local target is only available on localhost'
    : null),
  // Shared payload validation for the two caller-supplied dispatch bodies (LIN-1139): length
  // caps, opaque model/harness/terminal/effort (LIN-438/1084), dangerous-character rejection,
  // and the issueId/followUpTo/force/ifParked/sessionId format + combination rules. ONE atomic
  // step: its inner order is the validator's own. It gets the RAW body, never a rebuilt one: it
  // reads fields no lane names (ifParked, the length caps).
  payload: ({ rawBody }) => validateDispatchPayload(rawBody)?.error,
  // Recommend-and-dispatch's own inputs. The server-generated prompt never reaches
  // validateDispatchPayload, so the rules it applies are mirrored here.
  issueRequired: ({ issueIdentifier }) => (!issueIdentifier || typeof issueIdentifier !== 'string' ? 'issueIdentifier is required and must be a string' : null),
  issueIdFormat: ({ issueIdentifier }) => (isValidIssueId(issueIdentifier) ? null : 'Invalid identifier format'),
  noDescend: ({ noDescend }) => (noDescend !== undefined && typeof noDescend !== 'boolean' ? 'noDescend must be a boolean' : null),
  repo: ({ repo }) => opaqueFieldError(repo, 'repo', { maxLength: MAX_NAME_LENGTH, reportReceivedLength: true }),
  // Execution model + harness + effort (LIN-438, LIN-1084, LIN-2615): opaque strings, validated by
  // the one rule in lib/dispatch-validation.js (length + dangerous-chars; NOT a generation-model
  // registry check — these are the consumer's execution fields), then the unknown-effort warning.
  // The lanes whose prompt is server-generated take these three and no terminal.
  execution: (f) => executionFieldError(f, ['model', 'harness', 'effort']),
  // Autopilot session reference (LIN-591): the autopilot dispatchId driving this run, stamped
  // onto the spawned worker. Optional opaque string (LIN-1118, was UUID-only); stored +
  // forwarded blindly, no target restriction (sessions span all targets).
  sessionId: ({ sessionId }) => validateSessionId(sessionId)?.error ?? null,
  // Follow-up reference (LIN-2869): the fused verb can express "resume the prior session" under
  // the SAME well-formed-UUID + cli/web-only rule validateDispatchPayload enforces.
  followUpTo: ({ followUpTo, target }) => followUpToError({ followUpTo, target }),
  // Force flag (LIN-2872): boolean only. On recommend-and-dispatch `force: true` is ALWAYS
  // meaningful — `issueIdentifier` is required, so the duplicate guard always has a key to
  // override (the operator rescue hatch).
  force: ({ force }) => validateRunField('force', force),
  // Kickoff's own inputs.
  mode: ({ resolvedMode }) => (AUTOPILOT_MODES.includes(resolvedMode) ? null : `mode must be one of: ${AUTOPILOT_MODES.join(', ')}`),
  variantEnum: ({ resolvedVariant }) => (isValidAutopilotVariant(resolvedVariant) ? null : `variant must be one of: ${AUTOPILOT_VARIANTS.join(', ')}`),
  // LIN-2818: `goal` is caller-authored prose, so its POST cap is the goal-specific
  // MAX_DESCRIPTION_LENGTH (100000), NOT the shared opaque-field default (MAX_NAME_LENGTH,
  // 1000). Raised at this step only — `repo`, `model`, `harness`, and `effort` keep the shared cap.
  goal: ({ goal }) => opaqueFieldError(goal, 'goal', { maxLength: MAX_DESCRIPTION_LENGTH, reportReceivedLength: true }),
  issueIdFormatIfPresent: ({ issueIdentifier }) => (issueIdentifier !== undefined && !isValidIssueId(issueIdentifier) ? 'Invalid identifier format' : null)
};

// Groups: runs of steps adjacent and identically ordered in every lane that names them.
const SHAPE = ['abortFollowUp', 'promptRequired', 'target'];
const CASCADE = ['cascadeShape', 'cascadeNeedsAbort'];
const RUN_FLAGS = ['waitForFollowUps', 'queueIfBusy', 'subscription'];
const PRESET = ['presetShape', 'presetLookup'];
const EXECUTION = ['execution'];

// Each lane's ordered list. S answers SHAPE, then its owner gate, then the rest.
const SESSION_AFTER_GATE = ['abortTo', 'abortEligibility', ...CASCADE, 'kind', 'periodicalId', ...RUN_FLAGS, ...PRESET, 'maxTasks', 'attachProxy', 'entryRung', 'stopAt', 'variant', 'surface', 'localHost', 'payload'];
const PROXY_DISPATCH_STEPS = [...SHAPE, 'abortTo', ...CASCADE, 'kind', 'periodicalId', ...RUN_FLAGS, 'maxTasks', 'payload'];
const RECOMMEND_STEPS = ['issueRequired', 'issueIdFormat', 'target', 'noDescend', ...RUN_FLAGS, 'repo', ...EXECUTION, 'kindTemplateKey', 'periodicalId', 'sessionId', 'followUpTo', 'force'];
// The kickoff's composed body is server-generated and trusted, so only these raw inputs are checked.
const KICKOFF_STEPS = ['mode', 'variantEnum', 'goal', 'target', 'repo', 'issueIdFormatIfPresent', 'sessionId', 'subscription', ...EXECUTION, ...PRESET, 'maxTasks'];

/** The first failure among the named steps, in the order given. */
const runSteps = (names, input) => firstFailure(names.map(name => () => STEPS[name](input)));

// D2: the proxy lanes (P, R, K) default a missing body to `{}`. The session route never made this
// decision: it reads the raw `req.body` (so without body-parser output it throws into its own
// 500), and keeps doing so.
const bodyOf = (req) => req.body || {};

// ─── The proxy-context policy (D17) ───────────────────────────────────────────

// The proxy-context decision the enqueue verbs make from the same two body fields.
//
// Follow-up beats (LIN-805): a followUpTo resumes a warm session that already
// received the proxy-context block on its FIRST beat, so re-appending it on
// every later beat is redundant and risks confusing the worker. The prose append
// defaults OFF when followUpTo is set; an explicit appendProxyContext:true still
// opts back in. Fresh dispatches keep the default-ON behaviour (opt out with
// appendProxyContext:false). This is the systemic fix — every follow-up
// consumer benefits, not just one orchestrator. (`/recommend-and-dispatch`
// applies the SAME suppression since LIN-2869 made it a follow-up-capable
// verb.)
//
// LIN-1429: this suppression governs the PROSE APPEND only. Whether a
// credential is PROVISIONED is a separate decision, keyed on the resolved
// harness (see finalizePrompt) — the follow-up default here means "don't
// repeat the prose", never "don't mint a credential". Conflating the two was
// the LIN-1429 bug: a broker-dependent (claude-code/MCP) follow-up needs a
// live credential even when the prose is (correctly) suppressed, because the
// original credential died with the window that held it (LIN-1375/1362).
//
// `explicitOptOut` is the caller's own explicit instruction. Distinct from
// isFollowUp: an opt-out means "I don't want proxy context"; a follow-up
// default means only "I already have it". Kickoff has no followUpTo, so its policy is the
// opt-out alone.
//
// `optIn` is the session lane's deliberate difference (LIN-1162): the dispatch UI used to mint a
// bootstrap token and append the "+proxy" access block IN THE BROWSER, then POST the finished
// prompt; the client now sends `attachProxy:true` (a boolean intent, derived from its +proxy
// toggle / force) and lets the server attach the block, so on that lane the append is OPT-IN, where
// the proxy lanes are default-on. Only meaningful for a real prompt — an abort carries none. The
// session reply box (public/session.js) never sets it: a follow-up from it takes the resume
// credential path with `attach: null`.
function proxyContextPolicy({ followUpTo, appendProxyContext, optIn = false, isAbort = false }) {
  const isFollowUp = followUpTo !== undefined && followUpTo !== null;
  const explicitOptOut = !optIn && appendProxyContext === false;
  const shouldAppendProxyContext = optIn
    ? appendProxyContext === true && !isAbort
    : (isFollowUp ? appendProxyContext === true : !explicitOptOut);
  return { isFollowUp, explicitOptOut, shouldAppendProxyContext };
}

// ─── The row (D10, D12, D16, D23) ─────────────────────────────────────────────

// How a row field is written, once. A lane carries only the keys its row has; the factory
// drops a key left `undefined`, so the argument `addItem` receives keeps each lane's own key set.
const ROW_FIELDS = {
  promptName: (r) => r.promptName || 'Prompt',
  issueId: (r) => r.issueId || null,
  issueIdentifier: (r) => r.issueIdentifier || null,
  issueTitle: (r) => r.issueTitle || null,
  issueUrl: (r) => r.issueUrl || null,
  dispatchedBy: (r) => r.dispatchedBy || null,
  target: (r) => r.target || 'cli',
  // LIN-3333: an explicit `repo` is stored verbatim. The Harbour-side workspace-repo guard
  // (LIN-2886/LIN-2974, the "validated/normalized repo (basename)" this comment used to cite)
  // was removed with the project `repo=` lines it validated against; the runner's own
  // admission check (simple-dispatcher's admission.js) stays the authority on resolving it.
  repo: (r) => r.repo || null,
  followUpTo: (r) => r.followUpTo || null,
  force: (r) => r.force === true,
  abort: (r) => r.isAbort,
  abortTo: (r) => (r.isAbort ? r.abortTo : null),
  cascade: (r) => r.cascade === true,
  sessionId: (r) => r.sessionId || null,
  periodicalId: (r) => r.periodicalId || null,
  waitForFollowUps: (r) => r.waitForFollowUps === true,
  queueIfBusy: (r) => r.queueIfBusy === true,
  // Subscription is DECLARED on the edge (LIN-900 §6), never reconstructed from incidental
  // fields. An undeclared edge is `terminal-only`. This deliberately removes the old LIN-881
  // `!!sessionId` default-on: §6 forbids inferring subscription from "has a sessionId". A
  // stepper beat that needs its PENDING to wake its head declares `subscription: 'everything'`
  // explicitly; a plain sessioned worker correctly defaults to `terminal-only`. The
  // `buildWakeFollowUp` self-skip `childId === sessionId` still prevents an orchestrator from
  // waking itself.
  subscription: (r) => r.subscription ?? DEFAULT_SUBSCRIPTION,
  // Scope bound (LIN-1751): null ⇒ unbounded.
  maxTasks: (r) => r.maxTasks ?? null,
  // Run-boundary fact (LIN-3245 / LIN-2949 P1a): stamped only when the validated `'pr'` value
  // was supplied; null (the default) is byte-identical to today.
  stopAt: (r) => r.stopAt ?? null,
  // Run variant (LIN-3248 N2): the standard/stepper fact the run page reads for the seam-guard
  // promise; stamped on the row so the page and the guard agree (the row, not the response, is
  // the source). Null when none was supplied.
  variant: (r) => r.variant ?? null,
  // LIN-3335 (reduced from LIN-3242): an issue-addressed dispatch may name its provider-kind
  // `issueSource` — a legitimate source-only routing hint (every issue row carries a source),
  // persisted as a kind-only stamp. An issueless / repo-only request stamps nothing, and so does
  // an abort on a lane that stamps none (session dispatch stamps an issue-naming abort too).
  // Selection-only provenance, never a credential. Written here as null when absent; the STORE
  // writes it SPARSELY — an unstamped persisted row adds no key.
  issueSource: (r) => ((r.issueIdentifier && (r.stampsOnAbort || !r.isAbort)) ? dispatchIssueSourceField(r.issueSource) : {}).issueSource ?? null
};

// The keys each lane's row carries.
const ROW_KEYS = {
  session: Object.keys(ROW_FIELDS),
  proxy: ['promptName', 'issueId', 'issueIdentifier', 'issueTitle', 'issueUrl', 'dispatchedBy', 'target', 'repo', 'followUpTo', 'force', 'abort', 'abortTo', 'cascade', 'sessionId', 'periodicalId', 'waitForFollowUps', 'queueIfBusy', 'subscription', 'maxTasks', 'issueSource'],
  recommend: ['promptName', 'issueId', 'issueIdentifier', 'issueTitle', 'issueUrl', 'dispatchedBy', 'target', 'repo', 'sessionId', 'followUpTo', 'force', 'periodicalId', 'waitForFollowUps', 'queueIfBusy', 'subscription', 'issueSource'],
  kickoff: ['promptName', 'issueIdentifier', 'dispatchedBy', 'target', 'repo', 'waitForFollowUps', 'sessionId', 'subscription', 'maxTasks', 'variant', 'issueSource']
};

const rowFor = (lane, input) => Object.fromEntries(ROW_KEYS[lane].map(key => [key, ROW_FIELDS[key](input)]));

// ─── The 201 (D25) ────────────────────────────────────────────────────────────

// The reply every enqueue answers with, in one of three layouts (named by `layout`, because
// their key order is part of the bytes a client sees): the session UI's `item` envelope, the
// proxy task header (POST /dispatch and both arms of /recommend-and-dispatch: the task header
// only, never the prompt; `extra` adds what one verb alone reports), and the kickoff's.
//
// Consumer poll-recency warning (LIN-2885): the SAME pure function derives it here (at
// enqueue) and on every later watch. Omitted entirely, never `warning: null`, when the
// workspace is being actively polled. `maxTasks` rides as `?? null` and `budgetPosition` only
// when the run is budgeted (LIN-2934 R3: the fused verb is the orchestrator's MAIN path, so it
// must see "n of N" too).
function receiptFor(layout, item, extra = {}) {
  const consumerPollWarning = buildConsumerPollWarning(item.consumerLastSeenAt);
  const warning = consumerPollWarning ? { warning: consumerPollWarning } : {};
  const budget = item.budgetPosition ? { budgetPosition: item.budgetPosition } : {};
  if (layout === 'session') {
    return {
      success: true,
      item: {
        id: item._id,
        promptName: item.promptName,
        kind: item.kind,
        issueIdentifier: item.issueIdentifier,
        target: item.target,
        dispatchedAt: item.dispatchedAt,
        consumerLastSeenAt: item.consumerLastSeenAt,
        ...budget
      },
      ...warning,
      ...(extra.spawn ? { spawn: extra.spawn } : {})
    };
  }
  if (layout === 'kickoff') {
    return {
      success: true,
      // The dispatch id IS the autopilot session id (LIN-591/LIN-599); surface it under both
      // names so callers can use whichever reads clearer.
      id: item._id,
      sessionId: item._id,
      status: 'queued',
      kind: item.kind,
      promptName: item.promptName,
      mode: extra.mode,
      variant: extra.variant,
      issueIdentifier: item.issueIdentifier,
      target: item.target,
      dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt,
      maxTasks: item.maxTasks,
      ...budget,
      consumerLastSeenAt: item.consumerLastSeenAt || null,
      ...warning
    };
  }
  return {
    success: true,
    id: item._id,
    status: 'queued',
    kind: item.kind,
    promptName: item.promptName,
    issueIdentifier: item.issueIdentifier,
    target: item.target,
    sessionId: item.sessionId || null,
    maxTasks: item.maxTasks ?? null,
    ...budget,
    dispatchedAt: item.dispatchedAt?.toISOString?.() || item.dispatchedAt,
    consumerLastSeenAt: item.consumerLastSeenAt || null,
    ...warning,
    ...extra
  };
}

// The plan block (D19, LIN-3200 P5): the file-pointer pilot's plan source. A lane hands in how it
// reads the issue (through the provider access it already holds, so no second resolution); a
// provider without `fetchIssueContext`, an ambiguous scope, or the hermetic test sentinel
// degrades to "no plan paths" (the lane's read answers undefined). Kickoff has no plan block (the
// pilot is implementation-only).
const planBlockOf = (read) => async () => {
  const issueContext = await read();
  const issue = issueContext?.issue || issueContext || {};
  return issue.description || null;
};

// ─── The answers every route of the proxy dispatch files shares (D1, D8) ──────

/**
 * D1: the store is optional in a proxy factory's dependencies; every route of those factories
 * (the enqueue lanes and the reads beside them) answers 503 without it, audited.
 *
 * @returns {boolean} true when it answered (the caller returns)
 */
export function refuseWithoutStore({ req, res, endpoint, logEvent, dispatchQueueStore }) {
  if (dispatchQueueStore) return false;
  logEvent(req, endpoint, 503);
  jsonError(res, 503, 'Dispatch is not available');
  return true;
}

/**
 * D8: a 400 for a body, query or path the caller got wrong: audited, then relayed in the same
 * envelope. The session dispatch route passes no `logEvent`: it is session-auth'd, with no proxy
 * audit log.
 */
export function rejectAudited({ req, res, endpoint, logEvent = null, message }) {
  if (logEvent) logEvent(req, endpoint, 400);
  return badRequest.json(res, message);
}

// ─── The kit: the steps a lane takes, bound to its request ────────────────────

const SESSION_ATTACH_FAILED_MESSAGE = 'Proxy context was requested but a proxy token could not be created — you may have hit the token rate limit; wait a minute and try again.';

/**
 * @param {Object} ctx - the lane context (see each `enter*`)
 * @param {'session'|'proxy'|'recommend'|'kickoff'} lane
 */
function createKit(ctx, lane) {
  const { req, res, endpoint = null, logEvent = null, dispatchQueueStore, freeTierStore, accountStore, proxyTokenStore } = ctx;
  const session = lane === 'session';
  // The credential sources per lane: the signed-in session account and workspace, or the
  // proxy token's creator and workspace.
  const who = session
    ? { urlKey: ctx.workspace.urlKey, accountId: req.session?.accountId || null }
    : { urlKey: req.proxyUrlKey, accountId: req.proxyCreatedBy || null };
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  return {
    who,
    baseUrl,

    storeMissing() {
      return refuseWithoutStore({ req, res, endpoint, logEvent, dispatchQueueStore });
    },

    rejectBody(message) {
      return rejectAudited({ req, res, endpoint, logEvent, message });
    },

    // D11: a cascade request is not a single abort — it is a command Harbour expands into one
    // plain abort per session in abortTo's whole descendant subtree (the recursive
    // sessionId-tree walk). The store owns the walk + emission; the runner still executes each
    // cancel and skips human-continued sessions (LIN-951). Handled before the prompt-context
    // work (a cascade carries no prompt). INERT: nothing issues a cascade at end-of-run yet.
    async expandCascade({ abortTo, target }) {
      const result = await dispatchQueueStore.expandCascadeAborts(who.urlKey, abortTo, {
        target: target || 'cli',
        dispatchedBy: who.accountId
      });
      if (logEvent) logEvent(req, endpoint, 201);
      return res.status(201).json({ success: true, cascade: true, ...result });
    },

    // D13: resolve the credential for the issue a lane names. Strict lanes (recommend-and-dispatch,
    // kickoff) answer 503 when no credential resolves and 422 when the provider cannot fetch the
    // issue; proxy dispatch is permissive (LIN-1948): its referent guard fails open on every
    // non-definitive outcome, so a Linear outage never becomes a dispatch outage.
    async issueCredential({ source, strict, alsoRequires = null }) {
      const { resolveProviderAccess, workspaceUnavailable, denyIfUnsupported } = ctx;
      const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req, { source });
      if (!strict) return { accessToken, reason, provider };
      // LIN-1980: stamp before any other logic (incl. the !accessToken early return below) so the
      // fingerprint is present even when this request later 401s from a shared credential
      // another site marked suspect.
      if (!accessToken) {
        workspaceUnavailable(req, res, endpoint, reason);
        return null;
      }
      if (denyIfUnsupported(provider, 'fetchIssueContext', req, res, endpoint)) return null;
      if (alsoRequires && denyIfUnsupported(provider, alsoRequires, req, res, endpoint)) return null;
      const isTestMode = process.env.NODE_ENV === 'test' && accessToken === 'test-token';
      return { accessToken, reason, provider, isTestMode };
    },

    // D14: the issue's context, or a 404 the lane answers in its own envelope.
    async issueContext({ provider, accessToken, issueIdentifier, isTestMode, answerNotFound }) {
      let issueContext;
      try {
        issueContext = await ctx.resolvePromptIssueContext(provider, accessToken, issueIdentifier, isTestMode);
      } catch (err) {
        if (err.message?.includes('not found')) {
          logEvent(req, endpoint, 404);
          answerNotFound();
          return null;
        }
        throw err;
      }
      if (!issueContext) {
        logEvent(req, endpoint, 404);
        answerNotFound();
        return null;
      }
      return issueContext;
    },

    // D15: the dangling-referent guard (LIN-1948). A dispatch that NAMES an `issueIdentifier`
    // which resolves to no issue is almost always a mistake; this refuses it (422) before
    // createDispatchItem, whose finalizePrompt mints a single-use bootstrap. It fails open on every
    // non-definitive outcome (lib/dispatch-referent-guard.js). Skipped for aborts and cascades so a
    // cancel can never be blocked by it. `referent` is `{ provider, token }`, resolved by the lane.
    async refuseDangling(referent, issueIdentifier) {
      if (!await isDanglingReferent({ provider: referent.provider, token: referent.token, issueIdentifier })) return false;
      if (logEvent) logEvent(req, endpoint, 422, `${ISSUE_NOT_FOUND_CODE} ${issueIdentifier}`);
      const { error, ...rest } = danglingReferentBody(issueIdentifier);
      jsonError(res, 422, error, rest);
      return true;
    },

    // D18: the free-tier run gate (LIN-3238). The key the lane's account decides free tier from:
    // the signed-in session's own, or the token creator's OpenRouter key; `buildRunGate` returns
    // null for a paid/own key and for a null account (null attribution is not gated). The factory
    // invokes the gate only on a fresh row (step 1.55). A lane reads the key where its own order
    // needs it; kickoff's reader is optional (the composer always passes it).
    async freeTierKey() {
      if (session) return req.session?.openRouterApiKey;
      if (ctx.getWorkspaceOpenRouterKey === null) return null;
      return ctx.getWorkspaceOpenRouterKey(req.proxyUrlKey, req.proxyCreatedBy);
    },
    runGateFor(isFreeTier) {
      return buildRunGate({ isFreeTier, freeTierStore, accountId: session ? req.session?.accountId : req.proxyCreatedBy, accountStore });
    },
    gateFor(sessionApiKey) {
      return this.runGateFor(resolveChatCredential({ sessionApiKey }).isFreeTier);
    },

    // D21–D23: the one place a dispatch row is built and enqueued. The factory resolves kind,
    // fills blank model/harness from workspace dispatchDefaults, and calls addItem; the
    // proxy-context ordering constraint (LIN-1155 — harness resolved BEFORE the append, because
    // attachProxyContext gates its MCP-token-vs-prose branch on the resolved harness) is kept by
    // the finalizePrompt(resolvedHarness) callback: the factory hands it the resolved harness, it
    // runs the follow-up gate or the launch arm, and returns { prompt, bootstrapToken } to carry
    // on the item. An abort item carries no prompt, so the append stays guarded on prompt
    // presence (LIN-743).
    //
    // `spec` is what one lane decides: `prompt` and `label`; the `policy` (D17); `provider`, a
    // thunk for the identity the proxy-context block names; `attachIssue`, the issue it names;
    // `declare`, null or the dispatch-grant site this launch declares; `row`, the lane's inputs to
    // the row; and the factory options only some lanes pass.
    async enqueue(spec) {
      const { prompt, label, policy: { isFollowUp, explicitOptOut, shouldAppendProxyContext }, followUpTo, declare } = spec;
      const row = rowFor(lane, { ...spec.row, dispatchedBy: who.accountId });
      const names = () => {
        const { displayName, ui } = spec.provider();
        return { providerDisplayName: displayName, providerUi: ui };
      };
      const item = await createDispatchItem({
        store: dispatchQueueStore,
        urlKey: who.urlKey,
        workspacePreferencesStore: ctx.workspacePreferencesStore,
        dispatchPresetsStore: spec.dispatchPresetsStore,
        presetId: spec.presetId,
        applyDefaultHarness: spec.applyDefaultHarness,
        kind: spec.kind,
        model: spec.model,
        harness: spec.harness,
        terminal: spec.terminal,
        effort: spec.effort,
        dispatchTokenStore: ctx.dispatchTokenStore,
        proxyTokenStore,
        runGate: spec.runGate,
        readPlanBlock: spec.readPlanBlock,
        // LIN-2775 Area 8: threaded straight through, unvalidated here — the marker's own
        // validation and the terminal-anchor guard it gates both live inside createDispatchItem
        // (the one reusable, testable chokepoint). LIN-3124 PR3 (D16): the session lane passes its
        // session so a connection-backed workspace's done-guard reads the session's own hydrated
        // credential.
        composedRunMarker: spec.composedRunMarker,
        getWorkspaceAccessToken: spec.getWorkspaceAccessToken,
        fetchIssueContext: spec.fetchIssueContext,
        finalizePrompt: async (resolvedHarness) => {
          // Follow-up credential provisioning (LIN-3134 T2-ii, Decisions 1 and 7): a follow-up's
          // credential comes from the persisted parent record via the one resume helper —
          // declared or plain, the RECORDED owner and workspace, never the poster. The old guards
          // are `mint` (LIN-1429: keyed on the RESOLVED harness, an explicit opt-out mints
          // nothing; the guard is load-bearing: a prose-harness token has no channel to reach the
          // worker, and keying on the resolved harness preserves LIN-1111 — a blank harness
          // resolves null on the session lane, so it never mints) and attach-mode selection
          // (LIN-805: the prose re-appends only when asked). A record never turns a non-minting
          // call into a mint. Fail-closed is inherited (LIN-1162/LIN-525): a failed mint throws
          // before addItem. Code below the gate is the launch arm only.
          if (isFollowUp) {
            return provisionResumeCredential({
              proxyTokenStore,
              dispatchStore: dispatchQueueStore,
              urlKey: who.urlKey,
              baseUrl,
              label,
              harness: resolvedHarness,
              followUpTo,
              // LIN-1376: stamp the launching account (ignored on a declared resume, where the
              // recorded owner is the authority).
              createdBy: who.accountId,
              prompt,
              mint: !!prompt && !explicitOptOut && shouldUseMcpTokenField(resolvedHarness),
              attach: prompt && shouldAppendProxyContext
                ? { issueIdentifier: spec.attachIssue || null, prompt, ...names() }
                : null
            }).then((resumed) => {
              // LIN-1162's "surface, don't silently drop" check (see the launch arm) applies to the
              // session lane's attach-mode result: same condition, same error.
              if (spec.unchangedPromptFails && shouldAppendProxyContext && resumed.prompt === prompt) throw attachFailed();
              return resumed;
            });
          }
          if (prompt && shouldAppendProxyContext) {
            let attached;
            try {
              // LIN-376: embed a fresh single-use bootstrap, never the caller's own token.
              // LIN-1155: claude-code harness -> token stripped from prose, returned here.
              attached = await attachProxyContext({
                proxyTokenStore,
                urlKey: who.urlKey,
                baseUrl,
                issueIdentifier: spec.attachIssue || null,
                prompt,
                label,
                harness: resolvedHarness,
                createdBy: who.accountId,
                ...names(),
                // LIN-3136: a launch the lane declares holds the dispatch grant, minted for the
                // owner it names and checked by the mint against the workspace owner. A non-owner
                // is refused (LIN-3085 owns delegation), never given a grant-less run. The session
                // launch (M2, incl. M2b — an autopilot, or a periodical "+ Autopilot" variant)
                // names its session's own account; the kickoff child (M1) names the caller
                // token's own owner in the workspace that token was owner-checked in (both read
                // from the token, never from the request; a caller token with no stored workspace
                // fails closed). The proxy dispatch arms stay undeclared.
                ...(declare === 'M1'
                  ? {
                      declaredGrants: ['dispatch'],
                      declaredSite: 'M1',
                      grantOwnerAccountId: req.proxyCreatedBy,
                      workspaceId: req.proxyWorkspaceId
                    }
                  : declare === 'M2'
                    ? {
                        declaredGrants: ['dispatch'],
                        declaredSite: 'M2',
                        grantOwnerAccountId: req.session?.accountId || null,
                        workspaceId: ctx.workspace.id
                      }
                    : {})
              });
            } catch (err) {
              // Mark a launch-arm refusal so the session lane answers it with human text; a
              // follow-up resume's refusal keeps its own relay.
              if (spec.tagLaunchRefusal && isCodedGrantRefusal(err)) err.launchRefusal = true;
              throw err;
            }
            // "Surface, don't silently drop" (LIN-525): the client dropped its own mint+append and
            // trusted the server to attach the block. If the block did not get appended (mint
            // failed / rate-limited, or no store/baseUrl), attachProxyContext returns the prompt
            // UNCHANGED — enqueuing that would ship a bare prompt while the UI still shows +proxy
            // active. Signal it instead of degrading silently (the buildProxyContextPreamble block
            // always changes the prompt on success, prose or MCP). Only the session lane asks.
            if (spec.unchangedPromptFails && attached.prompt === prompt) throw attachFailed();
            return attached;
          }
          // Launch with the append opted out (or an abort, which has no prompt): nothing to
          // attach and nothing to mint. The former launch-arm provision-without-append branch was
          // unreachable (its selector implied the attach above) and lives in the follow-up gate as
          // the helper's pbt mode (LIN-3134 Decision 7).
          return { prompt, bootstrapToken: null };
        },
        fields: {
          promptName: row.promptName,
          issueId: row.issueId,
          issueIdentifier: row.issueIdentifier,
          issueTitle: row.issueTitle,
          issueUrl: row.issueUrl,
          dispatchedBy: row.dispatchedBy,
          target: row.target,
          repo: row.repo,
          followUpTo: row.followUpTo,
          force: row.force,
          abort: row.abort,
          abortTo: row.abortTo,
          cascade: row.cascade,
          sessionId: row.sessionId,
          periodicalId: row.periodicalId,
          waitForFollowUps: row.waitForFollowUps,
          queueIfBusy: row.queueIfBusy,
          subscription: row.subscription,
          maxTasks: row.maxTasks,
          stopAt: row.stopAt,
          variant: row.variant,
          issueSource: row.issueSource
        }
      });
      return item;
    },

    // The 201 (D25) and its audit line. The proxy lanes log every exit; the session route is not
    // audit-logged. A keepalive-armed arm sends through its keepalive so the reply rides it.
    reply201(receipt, { tag = endpoint, keepalive = null } = {}) {
      if (logEvent) logEvent(req, tag, 201);
      return keepalive ? keepalive.send(201, receipt) : res.status(201).json(receipt);
    },

    // D26: map a failure to its reply. The failures every enqueue lane answers, in the order
    // they are told: a tagged factory refusal (duplicate, run limit, budget, close-out, runaway,
    // so an orchestrator can branch on `code` and adopt the `id`), a missing out-of-band token
    // (fail closed, LIN-1175: a claude-code dispatch whose bootstrap token could not be minted is
    // REFUSED, never launched credential-less), and a declared resume whose grant cannot be
    // re-issued (LIN-3134: relay the coded refusal's own status and code; a retry cannot help).
    // Then the lane's own tail. A keepalive-armed arm passes its keepalive so every reply rides it:
    // once the 25s flush has fired the 200 is committed, and the real status travels as
    // `statusCode` in the body. `relay: false` skips the shared failures (the outer catch of
    // recommend-and-dispatch answers only the upstream tail).
    failure(err, { keepalive = null, relay = true, upstreamLabel = 'Proxy recommend-and-dispatch error:' } = {}) {
      if (session) {
        // Tagged factory refusals (duplicate, run-limit 429/503, budget, close-out, per-task
        // runaway): `lib/dispatch-refusal.js` owns the status/body/`Retry-After` mapping, shared
        // with the proxy entrance. Ahead of the generic 500 — a 500 would be indistinguishable
        // from a real fault. This route is session-auth'd (no proxy audit log), so the mapper's log
        // note goes unused and there is no keepalive.
        const refusal = mapDispatchRefusal(err);
        if (refusal) {
          if (refusal.retryAfter != null) res.set('Retry-After', String(refusal.retryAfter));
          return jsonError(res, refusal.status, refusal.message, refusal.body);
        }
        // LIN-3136 M2: a declared launch the owner check refused (or could not run). Ahead of the
        // attach-failure branch, because a transient OWNER_CHECK_UNAVAILABLE also carries
        // `proxyAttachFailed` and would otherwise read as a token rate limit. Human text from the
        // shared vocabulary; nothing was enqueued.
        if (err && err.launchRefusal) {
          const coded = codedGrantRefusalResponse(err, 'an autopilot launch credential');
          return jsonError(res, coded.status, coded.error, { code: coded.code, retryable: coded.retryable });
        }
        // Proxy-context attach failure (LIN-1162): a requested `attachProxy:true` could not
        // mint/append its block. Surface it (503, transient — mirrors the client's old
        // token-rate-limit message) rather than the generic 500, and NEVER as a success: no item
        // was enqueued (the throw fired before addItem).
        if (err && err.proxyAttachFailed) return serviceUnavailable.json(res, SESSION_ATTACH_FAILED_MESSAGE);
        // A declared resume whose grant cannot be re-issued (LIN-3134): relay the coded refusal's
        // own status and code rather than the generic 500 below.
        if (isStructuralGrantRefusal(err)) return jsonError(res, err.status, err.message, { code: err.code, retryable: false });
        // Terminal-anchor refusal (LIN-2775 Area 8): same tagged-throw relay convention as the
        // duplicate/budget guards above — the body was already constructed once by
        // createDispatchItem, this is a relay, not a second construction site. Beat 5 correction:
        // this branch was MISSING entirely — a correct, deliberate safety refusal (409,
        // `code: 'ANCHOR_TERMINAL'`) was falling through to the generic 500 below, so the stable
        // code this guard's own unit tests assert on never actually reached the wire.
        if (err && err.anchorTerminalRefusal) return jsonError(res, 409, err.message, err.anchorTerminalRefusal);
        // An invalid `composedRunMarker` (LIN-2775 Area 8): a genuine caller validation error,
        // not a fault — same beat-5 correction, this was also falling through to the 500 below.
        if (err && err.composedRunMarkerInvalid) return badRequest.json(res, err.message);
        console.error('Dispatch error:', err.message);
        return jsonError(res, 500, 'Failed to dispatch prompt');
      }
      const reply = (status, message, extra) => (keepalive
        ? keepaliveError(keepalive, status, message, extra)
        : jsonError(res, status, message, extra));
      if (relay) {
        if (ctx.relayDispatchRefusal(err, req, res, endpoint, keepalive)) return;
        if (err && err.proxyAttachFailed) {
          logEvent(req, endpoint, 503);
          return reply(503, ctx.PROXY_ATTACH_FAILED_MESSAGE);
        }
        if (isStructuralGrantRefusal(err)) {
          if (lane === 'kickoff') {
            // LIN-3136 M1: the child's launch credential could not be declared (the ownership
            // changed, the workspace has no owner, the caller token carries no workspace, ...).
            // Relay the refusal's status and code with the shared human text; a retry cannot
            // help. Nothing was enqueued or minted.
            const refusal = codedGrantRefusalResponse(err, 'a child autopilot launch credential');
            logEvent(req, endpoint, refusal.status);
            return jsonError(res, refusal.status, refusal.error, { code: refusal.code, retryable: false });
          }
          logEvent(req, endpoint, err.status);
          return reply(err.status, err.message, { code: err.code, retryable: false });
        }
      }
      if (lane === 'proxy') {
        logEvent(req, endpoint, 500);
        console.error('Proxy dispatch error:', err.message);
        return jsonError(res, 500, 'Failed to dispatch prompt');
      }
      if (lane === 'recommend') {
        // LIN-2260: classify an upstream provider-auth failure (retryable 503/LINEAR_AUTH) the same
        // way GET /recommend's recommendErrorResponse already does, instead of collapsing every
        // non-classified throw into an opaque 500 — graphqlErrorStatus() falls back to 500 for
        // anything it doesn't recognize, so a genuinely internal failure is unchanged. A coded
        // refusal never reaches here: it is answered above, as graphqlErrorStatus would 500 it.
        const status = ctx.graphqlErrorStatus(err, req);
        logEvent(req, endpoint, status);
        console.error(upstreamLabel, err.message);
        return reply(status, 'Failed to dispatch prompt', { detail: graphqlErrorDetail(err, req), ...graphqlErrorExtra(err, status) });
      }
      // LIN-2216: an upstream provider-auth failure (Linear 401/403) — resolvePromptIssueContext's
      // own try/catch only catches a "not found" message and rethrows everything else, so this is
      // where it lands. Ahead of the generic 500: a bare 500 cannot be told apart from a real
      // fault, and the caller (often an autopilot at its own dispatch seam) needs to know whether
      // to retry or escalate. `graphqlErrorStatus` carries the SAME transient-vs-terminal
      // classification the data routes now use (LIN-2216: 503 when this router's own bookkeeping
      // believed the credential was still live when Linear rejected it; 401 otherwise) — reused
      // here rather than re-derived, so the two surfaces can never disagree about the same
      // rejection. `classifyUpstreamError` supplies the machine-matchable `code`/`category` — the
      // existing LINEAR_AUTH vocabulary render-pages.js's human-facing error page already uses for
      // this exact upstream shape, not a new taxonomy.
      const authStatus = ctx.graphqlErrorStatus(err, req);
      if (authStatus === 401 || authStatus === 503) {
        // LIN-2363: attribute the failure to the backend actually called. This branch built its
        // envelope inline rather than through `graphqlErrorDetail`, so it forwarded
        // `classifyUpstreamError`'s Linear-hardcoded `detail` verbatim — the one `detail` field
        // LIN-2351 did not reach.
        //
        // `req.resolvedProvider.displayName` (NOT `.declared`) is the right read here, and the
        // distinction is deliberate: this is ERROR ATTRIBUTION, not identity assertion. The
        // question is "which backend did we just call and get rejected by", so the post-fallback
        // name is correct — the same read `graphqlErrorDetail` uses, reused rather than re-derived
        // so the two can never disagree about one rejection. (LIN-2354's `.declared` gate is for
        // prose that CLAIMS what a workspace is backed by; that is a different question.) Nothing
        // stamped ⇒ null ⇒ provider-neutral wording, never a guessed "Linear".
        //
        // WHY NOW, given this is latent: `graphqlErrorStatus` above reads only
        // `err.response.status`, while all three non-Linear clients set `err.status` — so a real
        // GitHub/Jira 401 currently maps to 500 and never reaches here (re-verified at HEAD). The
        // moment anyone normalises that shape — the obvious fix, tracked separately — this branch
        // would start telling GitHub and Jira operators that *Linear* rejected their credentials,
        // in the exact field LIN-2351 just cleaned. Fixing the trap before it arms is the whole
        // point.
        //
        // `code`/`category`/`retryable` are untouched: the `LINEAR_*` codes are a published,
        // machine-matchable contract and renaming them is a breaking change needing a deprecation
        // path — LIN-2351's boundary, held here.
        const classification = classifyUpstreamError(err, req.resolvedProvider?.displayName ?? null);
        logEvent(req, endpoint, authStatus);
        console.error('Proxy autopilot kickoff error:', err.message);
        return jsonError(res, authStatus, 'Failed to dispatch autopilot kickoff', {
          code: classification.code,
          category: classification.category,
          retryable: authStatus === 503,
          detail: classification.detail
        });
      }
      logEvent(req, endpoint, 500);
      console.error('Proxy autopilot kickoff error:', err.message);
      return jsonError(res, 500, 'Failed to dispatch autopilot kickoff');
    }
  };
}

const attachFailed = () => Object.assign(new Error('proxy context requested but could not be attached'), { proxyAttachFailed: true });

// The identity the proxy-context block names, per lane (credential sources per lane): the session
// lane reads the workspace's declared provider (LIN-2354: fallback-free — `getProvider`, unlike
// `getProviderForWorkspace` used for capability shaping, never guesses Linear for an undeclared
// workspace; LIN-2804: the capability summary, same source); the proxy lanes read what
// `resolveProviderAccess` stamped on the request (the display name only when the workspace DECLARED
// its provider). A lane that resolved no provider stays neutral and correctly does not trigger a
// fresh resolve just to fill this sentence.
const proxyProviderIdentity = (req) => () => ({ displayName: declaredProviderDisplayName(req), ui: resolvedProviderUi(req) });

// ─── S: session dispatch ──────────────────────────────────────────────────────

/**
 * POST /workspace/:urlKey/api/dispatch (routes/dispatch.js). Add a prompt to the dispatch queue.
 *
 * @param {Object} ctx
 * @param {import('express').Request} ctx.req
 * @param {import('express').Response} ctx.res
 * @param {{urlKey: string, id: string, provider?: string}} ctx.workspace
 * @param {(target: string) => Promise<boolean>} ctx.ownerGate - REQUIRED. S's owner gate (D9, LIN-3383):
 *   answers the refusal itself and resolves true when the caller may not enqueue. Never skipped: a
 *   call without it throws.
 * @param {(arg: Object) => Promise<Object|undefined>} ctx.afterEnqueue - D24: the task-mode record and
 *   the Harbour OS spawn, which stay in the session route; resolves the `spawn` field of the 201.
 * @param {Object} ctx.dispatchQueueStore @param {Object} ctx.dispatchTokenStore
 * @param {Object} [ctx.workspacePreferencesStore] @param {Object} [ctx.dispatchPresetsStore]
 * @param {Object} [ctx.proxyTokenStore] @param {Object} [ctx.freeTierStore] @param {Object} [ctx.accountStore]
 * @param {Object} [ctx.injectedProvider] @param {Function} [ctx.getWorkspaceAccessToken] @param {Function} [ctx.fetchIssueContext]
 */
export async function enterSessionDispatch(ctx) {
  if (typeof ctx.ownerGate !== 'function') {
    throw new Error('enterSessionDispatch requires ctx.ownerGate: the owner gate is never skipped (LIN-3383)');
  }
  const { req, workspace } = ctx;
  const kit = createKit(ctx, 'session');

  try {
    // The session route reads the raw body: it never defaulted a missing one to `{}` (D2 is the proxy
    // lanes' rule), so without body-parser output this throws into the catch below and answers 500.
    const { prompt, promptName, kind, issueId, issueIdentifier, issueTitle, issueUrl, issueSource, target, repo, model, harness, terminal, effort, followUpTo, force, abort, abortTo, cascade, sessionId, periodicalId, waitForFollowUps, queueIfBusy, subscription, attachProxy, presetId, maxTasks, composedRunMarker, entryRung, surface, stopAt, variant } = req.body;
    const body = req.body;
    const isAbort = abort === true;
    const input = { ...body, isAbort, targets: DISPATCH_TARGETS, rawBody: body, host: req.get('host'), presets: { store: ctx.dispatchPresetsStore, urlKey: workspace.urlKey } };

    // The first checks, ahead of the owner gate: the verbs' own shape. prompt is required for a
    // normal dispatch; an abort carries none. Target comes from the session vocabulary (cli, web,
    // dash, local).
    const shapeFailure = await runSteps(SHAPE, input);
    if (shapeFailure) return kit.rejectBody(shapeFailure);

    // LIN-3383 owner-only runner enqueue. Every write below (fresh, followUpTo, abort and the
    // cascade expansion) is consumed by the owner's runner when target is cli/web (absent = cli),
    // so only the workspace owner may reach them. Ahead of every write, store read, provider call
    // and run gate: a refusal spends nothing. dash/local pass untouched; an abort to dash stays
    // ungated. (The gate is the route's; the authority only fixes WHERE it runs, and never skips it.)
    if (await ctx.ownerGate(target ?? 'cli')) return;

    // The rest of the body, in the order the caller is told about it.
    const bodyFailure = await runSteps(SESSION_AFTER_GATE, input);
    if (bodyFailure) return kit.rejectBody(bodyFailure);

    if (cascade === true) return await kit.expandCascade({ abortTo, target });

    // Dangling-referent guard (LIN-1948, surface 2d). The session-cookie twin of the proxy-token
    // check — same hole, different auth lane: `issueIdentifier` is destructured straight off
    // req.body and stored unresolved. MUST run before createDispatchItem, whose finalizePrompt
    // mints a single-use bootstrap.
    //
    // LIN-3335: resolve the referent through the issue's own provider-kind `issueSource` when
    // known, else the workspace's active binding. A legacy workspace whose active binding is
    // ambiguous still yields AMBIGUOUS_CALL_SCOPE, treated as "no credential" and skipped — the
    // same fail-open as every other non-definitive outcome.
    if (!isAbort && issueIdentifier) {
      const binding = resolveIssueBinding(workspace, issueSource);
      const referent = {
        provider: ctx.injectedProvider || binding.provider,
        token: binding.callScope === AMBIGUOUS_CALL_SCOPE ? null : binding.callScope
      };
      if (await kit.refuseDangling(referent, issueIdentifier)) return;
    }

    // LIN-3136 M2 / M2b: which launches declare the dispatch grant. An autopilot, or a periodical
    // "+ Autopilot" variant: kind 'periodical', a periodicalId validated above, and the
    // SERVER-OWNED handoff tail in the prompt (lib/periodicals.js). A plain Mint, or a prompt
    // edited to drop the tail, launches a grant-less leaf as before. The client sends no grant
    // intent at all; the owner check at the mint is the authority.
    const isPeriodicalAutopilot = kind === 'periodical'
      && periodicalId !== undefined
      && typeof prompt === 'string'
      && prompt.includes(PERIODICAL_AUTOPILOT_TAIL);
    const launchesOrchestrator = kind === 'autopilot' || isPeriodicalAutopilot;

    // Free-tier run gate (LIN-3238): only a free-tier session is gated.
    const runGate = kit.gateFor(await kit.freeTierKey());
    const item = await kit.enqueue({
      prompt,
      label: 'dispatch-bootstrap',
      policy: proxyContextPolicy({ followUpTo, appendProxyContext: attachProxy, optIn: true, isAbort }),
      followUpTo,
      declare: launchesOrchestrator ? 'M2' : null,
      attachIssue: issueIdentifier,
      provider: () => {
        const ui = getProvider(workspace.provider)?.ui;
        return { displayName: ui?.displayName ?? null, ui: ui ?? null };
      },
      // The session lane tells the client when the block it asked for did not land (LIN-525), and
      // answers a refused declared launch with human text (LIN-3136 M2).
      unchangedPromptFails: true,
      tagLaunchRefusal: true,
      // applyDefaultHarness:false — the session route deliberately does NOT interpose the
      // claude-code default (LIN-1159 scoped that to the proxy dispatch boundary). The
      // dispatch-page UI owns the harness default (its selector is pre-selected to claude-code,
      // LIN-1111) AND offers an explicit "blank" option whose contract is "send null"
      // (dispatch-page.spec.js's LIN-1111 escape-hatch test). A server-side interpose here would
      // silently override that blank choice, so the null passthrough is load-bearing.
      applyDefaultHarness: false,
      dispatchPresetsStore: ctx.dispatchPresetsStore,
      presetId: presetId || null,
      kind,
      model,
      harness,
      terminal,
      effort,
      runGate,
      // LIN-3200 P5: plan block for the file-pointer pilot on the session/UI dispatch path. Reads
      // through the ACTIVE provider (`getProviderForWorkspace`, with the call scope as the
      // credential fallback) and the injected fetchIssueContext — not through the issue's own
      // source, which the referent guard above resolves since LIN-3335; a provider without the
      // capability, an ambiguous call scope, or a test sentinel degrades to "no plan paths".
      readPlanBlock: planBlockOf(async () => {
        if (!issueIdentifier || typeof ctx.fetchIssueContext !== 'function') return undefined;
        const planProvider = ctx.injectedProvider || getProviderForWorkspace(workspace);
        if (!planProvider?.fetchIssueContext) return undefined;
        let planToken = null;
        if (typeof ctx.getWorkspaceAccessToken === 'function') {
          try { planToken = await ctx.getWorkspaceAccessToken(workspace.urlKey, req.session); } catch { planToken = null; }
        }
        if (!planToken) {
          const planScope = getWorkspaceCallScope(workspace);
          planToken = planScope === AMBIGUOUS_CALL_SCOPE ? null : planScope;
        }
        if (!planToken) return undefined;
        return ctx.fetchIssueContext(planToken, issueIdentifier);
      }),
      composedRunMarker,
      getWorkspaceAccessToken: (k) => ctx.getWorkspaceAccessToken(k, req.session),
      fetchIssueContext: ctx.fetchIssueContext,
      row: { promptName, issueId, issueIdentifier, issueTitle, issueUrl, target, repo, followUpTo, force, isAbort, abortTo, cascade, sessionId, periodicalId, waitForFollowUps, queueIfBusy, subscription, maxTasks, stopAt, variant, issueSource, stampsOnAbort: true }
    });

    const spawn = await ctx.afterEnqueue({ item, issueId, issueIdentifier, entryRung, surface, target });
    return kit.reply201(receiptFor('session', item, { spawn }));
  } catch (err) {
    return kit.failure(err);
  }
}

// ─── P: proxy dispatch ────────────────────────────────────────────────────────

/**
 * POST /api/proxy/dispatch (routes/proxy-dispatch.js). Queue a prompt for the workspace's
 * dispatch consumer (the runner): the proxy-token equivalent of the session route, scoped by the
 * token's workspace and requiring readWrite scope plus the `dispatch` grant (the route's chain).
 * Excludes target 'local' (Harbour OS spawns on the server's own tty, which a remote consumer
 * can't drive).
 *
 * @param {Object} ctx - req, res, endpoint, the stores, and the Agent API closures the factory takes
 */
export async function enterProxyDispatch(ctx) {
  const { req } = ctx;
  const kit = createKit(ctx, 'proxy');
  if (kit.storeMissing()) return;

  try {
    const body = bodyOf(req);
    const { prompt, promptName, kind, issueId, issueIdentifier, issueTitle, issueUrl, issueSource, target, repo, model, harness, terminal, effort, followUpTo, force, abort, abortTo, cascade, sessionId, periodicalId, waitForFollowUps, queueIfBusy, subscription, maxTasks } = body;
    const isAbort = abort === true;

    // The first thing wrong with the body, in the order the caller is told about it. The
    // proxy caller keeps its own audit line on reject.
    const failure = await runSteps(PROXY_DISPATCH_STEPS, { ...body, isAbort, targets: POLLED_TARGETS, rawBody: body });
    if (failure) return kit.rejectBody(failure);

    if (cascade === true) return await kit.expandCascade({ abortTo, target });

    // Dangling-referent guard (LIN-1948, surface 2a) shares one provider resolution with the plan
    // block below — resolving twice would be a redundant network round-trip. MUST run before
    // createDispatchItem: `finalizePrompt` mints a single-use bootstrap token inside the factory,
    // so refusing afterwards would leak a minted credential. Skipped for aborts/cascades so a
    // cancel can never be blocked by it.
    //
    // LIN-2886 resolved a provider for a repo-only dispatch too (the workspace-repo guard it served
    // was removed by LIN-3333; the resolution stayed). An issue-addressed dispatch still forwards the
    // body's kind-only `issueSource` (LIN-3335 R1) so the referent resolves against that kind's
    // binding, not the active one; a repo-only request passes no source and keeps the active binding.
    let providerAccess = null;
    if (!isAbort && (issueIdentifier || repo)) {
      providerAccess = await kit.issueCredential({ source: issueIdentifier ? issueSource : undefined, strict: false });
    }
    if (!isAbort && issueIdentifier) {
      const referent = { provider: providerAccess.provider, token: providerAccess.accessToken };
      if (await kit.refuseDangling(referent, issueIdentifier)) return;
    }

    // Auto-append the proxy context (workspace API access + reporting channel) by default, so the
    // worker can both read context and report its result. Opt out with appendProxyContext:false
    // (e.g. a self-contained prompt).
    const policy = proxyContextPolicy({ followUpTo, appendProxyContext: body.appendProxyContext });

    const runGate = kit.gateFor(await kit.freeTierKey());
    const item = await kit.enqueue({
      prompt,
      label: 'dispatch-bootstrap',
      policy,
      followUpTo,
      declare: null,
      attachIssue: issueIdentifier,
      provider: proxyProviderIdentity(req),
      kind,
      model,
      harness,
      terminal,
      effort,
      runGate,
      // LIN-3200 P5: plan block for the file-pointer pilot. The named issue's description is
      // resolved through the SAME provider access the dangling-referent guard already obtained
      // above (no second provider resolution); a provider without `fetchIssueContext`, or the
      // hermetic test sentinel, degrades to "no plan paths".
      readPlanBlock: planBlockOf(async () => {
        const referentProvider = providerAccess?.provider;
        const referentToken = providerAccess?.accessToken;
        if (!issueIdentifier || !referentProvider?.fetchIssueContext || !referentToken) return undefined;
        return referentProvider.fetchIssueContext(referentToken, issueIdentifier);
      }),
      row: { promptName, issueId, issueIdentifier, issueTitle, issueUrl, target, repo, followUpTo, force, isAbort, abortTo, cascade, sessionId, periodicalId, waitForFollowUps, queueIfBusy, subscription, maxTasks, issueSource }
    });

    return kit.reply201(receiptFor('proxy', item, {
      abort: item.abort === true,
      abortTo: item.abortTo || null,
      cascade: item.cascade === true
    }));
  } catch (err) {
    // Tagged factory refusals, a missing out-of-band token and an unissuable declared resume are
    // answered first, ahead of the generic 500.
    return kit.failure(err);
  }
}

// ─── R: recommend-and-dispatch ────────────────────────────────────────────────

/**
 * POST /api/proxy/recommend-and-dispatch (routes/proxy-dispatch.js). Fused verb (LIN-321): run
 * /recommend and forward the recommended prompt straight into a dispatch, SERVER-SIDE, returning
 * only the task header. Two arms: the verb override (`kind` set, LIN-573: no model call, the body
 * generated deterministically for the NAMED issue) and the LLM descent.
 *
 * @param {Object} ctx - as enterProxyDispatch, plus the recommendation closures
 *   (computeRecommendation, chargeFreeTierOrReject, recommendErrorResponse,
 *   logOpenRouterCredentialSource, RECOMMEND_DESCENT_BUDGET_MS) and getWorkspaceOpenRouterKey
 */
export async function enterRecommendDispatch(ctx) {
  const { req, res, endpoint, logEvent } = ctx;
  const kit = createKit(ctx, 'recommend');
  if (kit.storeMissing()) return;

  try {
    const body = bodyOf(req);
    const { issueIdentifier, issueSource, target, repo, model, harness, effort, appendProxyContext, noDescend, kind, sessionId, waitForFollowUps, queueIfBusy, subscription, periodicalId, followUpTo, force } = body;

    // Validate caller-supplied inputs. (Only the server-generated prompt skips the
    // dangerous-char/length checks.)
    const failure = await runSteps(RECOMMEND_STEPS, { ...body, targets: POLLED_TARGETS });
    if (failure) return kit.rejectBody(failure);

    // LIN-805 proxy-context suppression, mirrored from POST /dispatch: a fused follow-up
    // (`followUpTo` set) resumes a warm session that already received the proxy-context block on its
    // first beat, so the prose append defaults OFF; an explicit appendProxyContext:true opts back
    // in. The credential half is separate (LIN-1429) — see finalizePrompt.
    const policy = proxyContextPolicy({ followUpTo, appendProxyContext });

    // Recommendation preconditions — identical to GET /recommend. LIN-3335 R1: forward the body's
    // kind-only `issueSource` so the referent and the recommendation read resolve against that
    // kind's binding, not the active one (a non-primary-kind task on a mixed-kind workspace). Two
    // capability-gated fetchers can serve this route.
    const access = await kit.issueCredential({ source: issueSource, strict: true, alsoRequires: 'fetchRecommendationContext' });
    if (!access) return;
    const { accessToken, provider, isTestMode } = access;

    // The inputs both arms hand the one enqueue.
    const common = {
      label: 'dispatch-bootstrap',
      policy,
      followUpTo,
      declare: null,
      provider: proxyProviderIdentity(req),
      kind,
      model,
      harness,
      effort
    };
    const commonRow = { target, repo, sessionId, followUpTo, force, waitForFollowUps, queueIfBusy, subscription, issueSource };

    // ── Verb-override path (LIN-573) ──────────────────────────────────────
    // When the caller pins `kind`, skip the LLM recommendation + descent entirely: fetch the named
    // issue's context, generate the body deterministically with the chosen template key, and
    // dispatch with that override kind. The wobble this fixes is the *verb*, not the *target*, so the
    // override pins the named issue with NO descent. It is purely deterministic (no OpenRouter
    // call), so it bypasses the LLM-config gate and free-tier metering below. provider?.ui is
    // threaded through (LIN-2353); Linear output stays byte-identical to the /prompt endpoint since
    // its ui is the DEFAULT_PROMPT_UI floor.
    if (kind !== undefined) {
      // No model call on this arm; the token creator's key still decides free tier for the run gate
      // at the enqueue (LIN-3238). The keepalive and the hang-up check before the enqueue cover the
      // provider calls below.
      const overrideSessionApiKey = await kit.freeTierKey();
      const keepalive = armKeepalive(res);
      const gone = clientGoneSignal(res);
      // Every exit below answers through the keepalive, the catch included: once it has flushed, a
      // plain error status can no longer be sent.
      try {
        const issueContext = await kit.issueContext({
          provider,
          accessToken,
          issueIdentifier,
          isTestMode,
          answerNotFound: () => keepaliveError(keepalive, 404, 'Issue not found')
        });
        if (!issueContext) return;

        const { issue, parent, siblings, project, children, comments, attachments } = issueContext;
        // LIN-2575: a caller-supplied `periodicalId` always wins (it is the explicit join key); when
        // absent, derive it from the issue's own LIN-694 gate marker. This is the seam a lane/batch
        // dispatch of a minted periodical review task uses — the agent running the task need not know,
        // or remember to pass, the template id. A description with no marker (the ordinary case)
        // derives null.
        const overridePeriodicalId = (periodicalId !== undefined
          ? periodicalId
          : resolvePeriodicalIdFromGateMarker(issue.description)) || null;
        // Forward `attachments` (LIN-776): the verb-override dispatch path must surface the same
        // Attachments section as the LLM recommend-and-dispatch path, which already passes the full
        // context. provider?.ui is threaded through (LIN-2353) so a non-Linear provider renders
        // capability-appropriate text; Linear output stays byte-identical.
        const generated = generatePrompt(kind, issue, { parent, siblings, project, children, comments, attachments }, {}, provider?.ui || null);
        if (!generated) {
          logEvent(req, endpoint, 500);
          return keepaliveError(keepalive, 500, 'Failed to generate prompt');
        }

        // The body is server-generated/trusted, so it skips the dangerous-char / length checks the
        // caller-supplied POST /dispatch path runs, and is never returned to the caller — same
        // contract as the LLM-driven path.
        //
        // A caller that hung up before the enqueue gets nothing enqueued. Once createDispatchItem
        // starts it is never abandoned: no signal reaches it.
        if (gone.gone) {
          logEvent(req, `${endpoint} (override:${kind})`, 499, 'client closed before enqueue');
          return keepaliveError(keepalive, 499, 'Client closed the request before dispatch');
        }

        // Free-tier run gate (LIN-3238): token creator's key decides free tier (the key read above).
        const runGate = kit.gateFor(overrideSessionApiKey);
        const item = await kit.enqueue({
          ...common,
          prompt: generated.prompt,
          attachIssue: issueIdentifier,
          runGate,
          // LIN-3200 P5: the override branch already holds `issue` from resolvePromptIssueContext —
          // return its description with no refetch.
          readPlanBlock: planBlockOf(async () => ({ issue })),
          row: {
            ...commonRow,
            promptName: generated.name || getPromptDisplayName(kind),
            issueIdentifier,
            // LIN-2575: caller-supplied when validated above, otherwise derived from the issue's
            // LIN-694 gate marker — see `overridePeriodicalId` above.
            periodicalId: overridePeriodicalId
          }
        });

        // Record the override so it can feed heuristic improvement — the engine's verb was
        // demonstrably wrong here (LIN-573). The distinct endpoint tag keeps these auditable in the
        // proxy event log. The override pins the named issue with no descent — surface that
        // explicitly so callers can distinguish it from the LLM-driven path.
        return kit.reply201(receiptFor('proxy', item, { override: true }), { tag: `${endpoint} (override:${kind})`, keepalive });
      } catch (err) {
        // Tagged factory refusals, a missing out-of-band token and an unissuable declared resume
        // (LIN-3134) all ride `keepalive.send` here, as on the LLM arm below, and are answered
        // ahead of graphqlErrorStatus, which would 500 a coded refusal.
        return kit.failure(err, { keepalive, upstreamLabel: 'Proxy recommend-and-dispatch override error:' });
      } finally {
        gone.release();
      }
    }

    const sessionApiKey = await kit.freeTierKey();
    // A free-tier-only deployment is accepted via isFreeTier. computeRecommendation resolves the
    // effective key per hop; here we only gate and meter.
    const credential = resolveChatCredential({ sessionApiKey });
    const { isFreeTier } = credential;
    if (isAiUnavailable({ credential, mockAi: isTestMode })) {
      logEvent(req, endpoint, 503);
      return jsonError(res, 503, 'AI recommendations not configured. Connect OpenRouter via OAuth or set OPENROUTER_API_KEY on the server.');
    }

    // LIN-1458: witness which credential source served this request.
    if (!isTestMode) {
      ctx.logOpenRouterCredentialSource(req, endpoint, { sessionApiKey, isFreeTier });
    }

    // Charge one free-tier unit ONCE per request (not per descent hop). Charge before
    // resolveRecommendation so an exhausted user gets a clean 429.
    if (isFreeTier && !isTestMode) {
      const rejection = await ctx.chargeFreeTierOrReject(req, endpoint);
      if (rejection) {
        logEvent(req, endpoint, 429);
        return res.status(rejection.status).json(rejection.body);
      }
    }

    // /recommend is slow (Linear + OpenRouter) — arm keepalive before computing.
    const keepalive = armKeepalive(res);
    // A client hang-up aborts the model calls; the enqueue checks it before starting.
    const gone = clientGoneSignal(res);

    let rec, deferredVia, deferTruncated, deferStopReason;
    try {
      // Resolve `defer` to a terminal actionable node server-side (LIN-329) so Autopilot can fire
      // this verb on ANY task — node or leaf — and get the actionable descendant's prompt + kind,
      // never a `defer` to act on.
      const recommendDeadline = Date.now() + ctx.RECOMMEND_DESCENT_BUDGET_MS;
      ({ recommendation: rec, deferredVia, deferTruncated, deferStopReason } = await resolveRecommendation({
        startIdentifier: issueIdentifier,
        deadline: recommendDeadline,
        // noDescend (LIN-365): dispatch the named node's OWN work, never an open child.
        noDescend: noDescend === true,
        computeOne: (id) => ctx.computeRecommendation({
          urlKey: req.proxyUrlKey,
          createdBy: req.proxyCreatedBy,
          identifier: id,
          accessToken,
          provider,
          isTestMode,
          sessionApiKey,
          deadline: recommendDeadline,
          noDescend: noDescend === true,
          clientSignal: gone.signal
        })
      }));
    } catch (err) {
      gone.release();
      // A hang-up aborts the model call, which surfaces as a timeout: the client left, and that is
      // not an AI outage.
      if (gone.gone) {
        logEvent(req, endpoint, 499, 'client closed');
        return keepaliveError(keepalive, 499, 'Client closed the request');
      }
      const { status, body: errorBody } = ctx.recommendErrorResponse(err, req);
      logEvent(req, endpoint, status);
      return keepalive.send(status, errorBody);
    }

    // The descent should always terminate on a real action carrying a prompt. If it stopped
    // abnormally (depth cap / cycle / unresolved child / timeout) it may have halted on a `defer` with
    // no prompt — surface that anomaly rather than dispatching an empty prompt. `defer` must never
    // reach dispatch.
    if (rec.recommendedAction === 'defer' || !rec.prompt) {
      logEvent(req, endpoint, 422);
      return keepaliveError(keepalive, 422, 'Recommendation did not resolve to an actionable task', {
        deferredVia,
        deferTruncated,
        deferStopReason
      });
    }

    try {
      // The recommended prompt is server-generated/trusted, so we forward it verbatim and
      // intentionally SKIP the DANGEROUS_CHARS/length checks the caller-supplied POST /dispatch path
      // runs. The prompt body is never returned to the caller — that is the whole point of this verb.
      // The dispatched item references the TERMINAL actionable node (rec.identifier), not the parent
      // the caller named — the worker should inherit context for the task it is actually working on
      // (LIN-327). For a leaf these are identical.
      const terminalIdentifier = rec.identifier || issueIdentifier;

      // LIN-2575: caller-supplied `periodicalId` wins; otherwise use the one `computeRecommendation`
      // derived from the resolved issue's LIN-694 gate marker — the everyday autopilot/lane path,
      // which carries no `kind` and lands here. Null for any ordinary issue.
      const recommendedPeriodicalId = (periodicalId !== undefined
        ? periodicalId
        : rec.periodicalId) || null;

      // kind provenance: parseRecommendedAction (in computeRecommendation) → recommendedAction →
      // deriveDispatchKind → BOTH the stored item's kind and the response kind (same value); falls
      // back to 'custom' when the action can't be parsed.
      const effectiveKind = deriveDispatchKind(rec.recommendedAction);

      // A caller that hung up before the enqueue gets nothing enqueued. Once createDispatchItem
      // starts it is never abandoned: no signal reaches it. Defensive backstop: nothing is awaited
      // between the recommendation and here today, so a real hang-up ends in the routing catch
      // above; kept so a future await cannot silently reopen the window (LIN-3333). This branch is
      // keepalive-armed, so a hang-up rides `keepalive.send` like the deferred-action check above.
      gone.release();
      if (gone.gone) {
        logEvent(req, endpoint, 499, 'client closed before enqueue');
        return keepaliveError(keepalive, 499, 'Client closed the request before dispatch');
      }

      // Free-tier run gate (LIN-3238): same token-creator-derived isFreeTier the recommendation
      // credential gate above computed.
      const runGate = kit.runGateFor(isFreeTier);
      const item = await kit.enqueue({
        ...common,
        kind: effectiveKind,
        prompt: rec.prompt,
        attachIssue: terminalIdentifier,
        runGate,
        // LIN-3200 P5: plan block for the file-pointer pilot on the recommendation-derived arm. The
        // terminal issue's context was consumed inside computeRecommendation and is not carried on
        // `rec`, so this reads the description through the same provider access this route already
        // resolved (bounded by PLAN_READ_TIMEOUT_MS at the factory); a provider without
        // `fetchIssueContext` or the hermetic test sentinel degrades to "no plan paths".
        readPlanBlock: planBlockOf(async () => {
          if (!provider?.fetchIssueContext || !accessToken) return undefined;
          return provider.fetchIssueContext(accessToken, terminalIdentifier);
        }),
        row: {
          ...commonRow,
          promptName: rec.recommendedAction,
          issueIdentifier: terminalIdentifier,
          periodicalId: recommendedPeriodicalId
        }
      });

      // Task header ONLY — no prompt body. deferredVia + descent are additive (LIN-327): they let
      // Autopilot read the descent ("LIN-318 → LIN-297 (research) · dispatched") from the
      // structured header, never a prompt body.
      const descent = describeDescent(deferredVia, rec);
      return kit.reply201(receiptFor('proxy', item, {
        deferredVia,
        deferTruncated,
        ...(descent ? { descent: `${descent} · dispatched` } : {})
      }), { keepalive });
    } catch (err) {
      // Duplicate-dispatch refusal (LIN-1656). Keepalive is ARMED on this arm, so every refusal must
      // ride `keepalive.send` — if the 25s flush already fired, the 200 is committed and the real 409
      // travels as `statusCode` in the body. The responder also skips the `Retry-After` header once
      // headers are sent.
      return kit.failure(err, { keepalive });
    }
  } catch (err) {
    // LIN-2260: same classification as the inner catch arms above — this outer catch-all fronts
    // every non-classified throw the two arms didn't already handle (e.g. a failure before `kind`
    // is known which arm to run).
    return kit.failure(err, { relay: false });
  }
}

// ─── K: autopilot kickoff ─────────────────────────────────────────────────────

/**
 * POST /api/proxy/autopilot/kickoff (routes/proxy-kickoff.js). Fused launch verb (LIN-569): build
 * the Autopilot kickoff AND enqueue it in one call, returning the dispatch id — which IS the run's
 * session id. The prompt body is generated server-side and never returned to the caller.
 *
 * Body (all optional): { goal?, mode?, variant?, issueIdentifier?, target?, repo?,
 * appendProxyContext?, sessionId?, subscription?, model?, harness?, effort?, presetId?, maxTasks? }
 *   - issueIdentifier present → SCOPED run ("autopilot until THIS task is done"): the issue's title
 *     is resolved for the goal line, and a non-empty `goal` is appended as additional human context
 *     (LIN-2818). `repo` is the caller's runner-folder override, stored verbatim.
 *   - issueIdentifier absent  → GENERAL run; `goal` focuses the stack walk.
 *   - mode: 'write' (default) | 'readonly'.
 *   - variant: 'standard' (default) | 'stepper' (warm beat-stepping disposition, LIN-791);
 *     orthogonal to mode.
 *   - sessionId + subscription (LIN-813): the coordinator up-chain edge, a GUIDE capability
 *     available to any autopilot contextually (NOT a launch-time variant — see the operating
 *     manual's "Dispatching a child autopilot"). A top-level kickoff omits both (undeclared →
 *     'terminal-only').
 * Dispatches with kind:'autopilot', so addItem appends the session-id self-ref block and the
 * returned id is the session id (LIN-591/LIN-599).
 *
 * @param {Object} ctx - req, res, endpoint, the stores, and the Agent API closures the factory takes
 */
export async function enterKickoff(ctx) {
  const { req, res, endpoint } = ctx;
  const kit = createKit(ctx, 'kickoff');
  if (kit.storeMissing()) return;

  try {
    const body = bodyOf(req);
    const { goal, mode, variant, issueIdentifier, issueSource, target, repo, appendProxyContext, sessionId, subscription, model, harness, effort, presetId, maxTasks } = body;

    const resolvedMode = mode === undefined ? AUTOPILOT_MODE_DEFAULT : mode;
    const resolvedVariant = variant === undefined ? AUTOPILOT_VARIANT_DEFAULT : variant;
    // The first thing wrong with the body, in the order the caller is told about it. (The composed
    // body is server-generated and trusted, so only these raw inputs are checked — same split as the
    // recommend-and-dispatch override path.) The one async step is the preset lookup; it sits where
    // the presetId shape check ends, so a body that fails any earlier check never reads the store.
    const bodyFailure = await runSteps(KICKOFF_STEPS, {
      ...body,
      targets: POLLED_TARGETS,
      resolvedMode,
      resolvedVariant,
      presets: { store: ctx.dispatchPresetsStore, urlKey: req.proxyUrlKey }
    });
    if (bodyFailure) return kit.rejectBody(bodyFailure);

    // SCOPED run: resolve the named issue so the goal line can name it (mirrors /prompt +
    // recommend-and-dispatch). `repo` is the caller's runner-folder override, stored verbatim
    // (LIN-3333: the project `repo=` derivation is gone).
    let issue = null;
    if (issueIdentifier) {
      // LIN-3335 R1: forward the body's kind-only `issueSource` so a scoped run on a non-primary-kind
      // task resolves against that kind's binding.
      const access = await kit.issueCredential({ source: issueSource, strict: true });
      if (!access) return;
      const issueContext = await kit.issueContext({
        provider: access.provider,
        accessToken: access.accessToken,
        issueIdentifier,
        isTestMode: access.isTestMode,
        answerNotFound: () => notFound.json(res, 'Issue not found')
      });
      if (!issueContext) return;
      issue = { identifier: issueContext.issue.identifier, title: issueContext.issue.title };
    }

    // Child-autopilot prompt inheritance (LIN-3246 / LIN-2949 P1b): a fresh child autopilot launched
    // under a parent run that declared `stopAt: 'pr'` carries the SAME stop block in its PROMPT, so a
    // descendant of a stop-at-PR run stops too. The parent fact is read from the same run row
    // (`getItemStatus`, keyed on the body's `sessionId`) that the dispatch factory reads to stamp the
    // child ROW (lib/dispatch-factory.js's shared `run` read), so the prompt and the row can never
    // disagree. Fail-open to null on an absent/unreadable lookup — the factory's own shared read does
    // `.catch(() => null)`, so a kickoff that works today never gains a new failure mode. This verb has
    // NO body-level `stopAt`; it only inherits.
    const parentRun = (sessionId && typeof ctx.dispatchQueueStore.getItemStatus === 'function')
      ? await Promise.resolve(ctx.dispatchQueueStore.getItemStatus(req.proxyUrlKey, sessionId)).catch(() => null)
      : null;
    const inheritedStopAt = parentRun?.stopAt === 'pr' ? 'pr' : null;

    const kickoff = buildAutopilotKickoff({
      baseUrl: kit.baseUrl,
      issue,
      goal: typeof goal === 'string' ? goal : '',
      mode: resolvedMode,
      variant: resolvedVariant,
      stopAt: inheritedStopAt,
      maxTasks: maxTasks ?? null,
      // LIN-2804: only resolved when this was a SCOPED kickoff — a goal-only kickoff resolves no
      // provider and correctly stays neutral.
      //
      // LIN-2804 review Finding 2 (DELIBERATE, NAMED DEFERRAL, not a silent gap): a goal-only kickoff
      // has never called resolveProviderAccess — there is no issue to look up — so
      // `resolvedProviderUi(req)` is `null` here and the rendered hints fall back to
      // full-capability, same as every provider the `!== false` convention treats as fully-capable
      // by default. On a GitHub-Projects/Jira workspace this general (unscoped) stack-walk kickoff
      // therefore still advertises `/issues/{id}` and `/search` hints that 422 — the defect class
      // this ticket exists to remove is NOT closed on this one lane. Deliberately not fixed here:
      // doing so would mean calling resolveProviderAccess unconditionally on every general kickoff —
      // a real credential round-trip (Mongo/cache read, possibly a token-refresh HTTP call, a new
      // possible 503) that this request pays for NO OTHER reason today, the same cost/behavior
      // tradeoff the plan weighed and declined for the standalone GET preview route (see the sibling
      // note in routes/proxy-kickoff.js). Impact is bounded: a capable model (or the worker's own
      // retry-on-422 discipline) routes around the stale hint after one failed call. Tracked
      // explicitly (not silently inherited) — see
      // tests/unit/lin-2804-provider-ui-endpoint-hints.test.js's 'unscoped/goal-only kickoff'
      // describe block, which pins today's full-capability fallback on this lane so a future
      // accidental change (in either direction) is visible. The proxy-context block below makes the
      // same deliberate deferral.
      providerUi: resolvedProviderUi(req)
    });

    // Create the dispatch item through the shared factory (LIN-1139): it resolves model/harness from
    // workspace dispatchDefaults (LIN-1138 — `autopilot` is a meta-kind ∉ PROMPT_TEMPLATES, so only
    // the workspace-wide default applies), interposes the default harness (LIN-1159), and calls
    // addItem. The proxy-context append is the default ("+proxy block" the kickoff guide refers to);
    // it runs inside finalizePrompt AFTER the harness is resolved so it can gate its MCP-token-vs-prose
    // branch on it (LIN-1155), and hands back the bootstrapToken to carry as a structured field. Opt
    // out with appendProxyContext:false.
    //
    // Free-tier run gate (LIN-3238): the token creator's own OpenRouter key decides free tier;
    // `buildRunGate` returns null otherwise. Only a fresh kickoff row reaches step 1.55 (a child
    // kickoff carrying `sessionId` is a continuation and is never gated).
    const runGate = kit.gateFor(await kit.freeTierKey());
    const item = await kit.enqueue({
      // 'kickoff-bootstrap' labels the child orchestrator's token; LIN-3136 M1 launches it holding
      // the dispatch grant (the declared site in the launch arm).
      prompt: kickoff,
      label: 'kickoff-bootstrap',
      policy: proxyContextPolicy({ appendProxyContext }),
      followUpTo: undefined,
      declare: 'M1',
      attachIssue: issueIdentifier,
      provider: proxyProviderIdentity(req),
      dispatchPresetsStore: ctx.dispatchPresetsStore,
      presetId: presetId || null,
      kind: 'autopilot',
      model,
      harness,
      effort,
      runGate,
      row: {
        promptName: issue ? `Autopilot (${issue.identifier})` : 'Autopilot (stack walk)',
        issueIdentifier,
        target,
        repo,
        // Park the orchestrator holdable (LIN-826). Under push-based comms the subscribed children run
        // independently to terminal and then WAKE the parent with a follow-up (the LIN-826
        // auto-enqueue), so the orchestrator must stop at a holdable AWAITING_FOLLOWUP point to
        // receive those wakes instead of polling. This inverts the old "free the producer" rule only
        // for the subscribed case; Phase 2 retires that rule in the prose.
        waitForFollowUps: true,
        // Coordinator up-chain edge (LIN-813): when this kickoff is a CHILD autopilot dispatched by a
        // coordinator, `sessionId` targets the coordinator and a declared `subscription:
        // 'everything'` routes the child's reports back up to it. A top-level kickoff passes neither,
        // so subscription defaults to 'terminal-only' and the standard single-head behavior is
        // unchanged. Stored + forwarded blindly; note `sessionId` here is the PARENT edge — the
        // child's own `_id` is what addItem stamps into its prompt for its own sub-workers, so the two
        // ids stay distinct by construction.
        sessionId,
        subscription,
        maxTasks,
        // `resolvedVariant` is the same value the kickoff body is built from; stamped on the row so
        // the page and the guard agree (LIN-3248 N2).
        variant: resolvedVariant,
        issueSource
      }
    });

    return kit.reply201(receiptFor('kickoff', item, { mode: resolvedMode, variant: resolvedVariant }));
  } catch (err) {
    // Tagged factory refusals — duplicate (LIN-1656), budget (LIN-1751; a child-autopilot kickoff
    // under a coordinator's budgeted run can be refused), close-out, runaway, free-tier run limit
    // (LIN-3238). Ahead of the generic 500: a 500 here is worse than no guard, since a caller cannot
    // tell it from a real fault. A stack-walk kickoff carries no issueIdentifier and can never be a
    // duplicate. Then the fail-closed attach failure (LIN-1175), the refused M1 declaration, and an
    // upstream provider-auth failure.
    return kit.failure(err);
  }
}
