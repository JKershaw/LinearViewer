/**
 * What a stage may write (LIN-4253, LIN-4251): the value every stage kind's record (lib/prompts/stage-kinds.js) declares as `writes`.
 * Since LIN-4492 it also owns who minted a token (`TOKEN_ORIGIN`, `personMint`, `dispatchMintOptions`, at the end):
 * the stamp and the origin travel together through every mint, so they have one owner.
 *
 * A dependency-free leaf, so the templates can import it to declare, the dispatch preamble can
 * import it to know the vocabulary, and the proxy (lib/stage-write-gate.js, lib/proxy-tokens.js,
 * routes/proxy-writes.js) can import it to enforce the allowance table below (LIN-4468). Neither imports the template registry: the preamble
 * stays registry-free (lib/proxy-preamble.js), and dispatch-entrance resolves a stage's value
 * from its template and passes it down (lib/prompt-templates.js `stageWrites`).
 *
 * - `work` (the default): reversible work: code, branches, PRs, comments, ticket updates; closed
 *   with PR evidence.
 * - `none`: a reading pass (look-into, retro). Changes no ticket; reports its findings in the session.
 * - `one-comment`: a read-only stage (context, and the LIN-4248 Surveys). Its only ticket write is one
 *   comment on the ticket named in its task.
 * - `blind-comment`: the blind read (LIN-4437). Its only ticket write is one comment on the ticket named in
 *   its task, like `one-comment`, and it is also a read limit: that ticket is where the comment goes,
 *   not something to read, so its endpoint hints carry no brief, issue-detail or relations line
 *   (lib/proxy-preamble.js).
 * - `ticket-fields`: triage. Changes this ticket's labels, priority, state and project and comments
 *   on it; no code, no branches, no PRs, no new tickets, no rewrite of its description.
 *
 * Every stamp, these included, may write records (`recordWrite`, LIN-4493: any actor may write any kind).
 * Until the prompts that write records land (LIN-4495), each stage's `intent` still describes its ticket
 * writes only.
 *
 * Named for what it controls, not `readOnly`: a boolean cannot say "ticket fields and a comment,
 * nothing else", which triage needs.
 *
 * Relation to the reading pass (STAGE_INTENT's reading-pass lines): a stage is a reading pass exactly
 * when its `writes` is `none`, `one-comment` or `blind-comment`. Each record in lib/prompts/stage-kinds.js
 * writes its own `intent` (`blind-comment` has its own line, which names no ticket), and
 * tests/unit/lin-4253-stage-traits.test.js checks that `intent` against `writes`: it is the witness of the relation. Since LIN-4437 the name
 * `writes` also covers a read limit (`blind-comment`). Grounding (GROUNDING_BY_KIND) is a separate
 * decision.
 */
export const WRITES = Object.freeze({
  WORK: 'work',
  NONE: 'none',
  ONE_COMMENT: 'one-comment',
  BLIND_COMMENT: 'blind-comment',
  TICKET_FIELDS: 'ticket-fields'
});

/** The accepted values, for the preamble's guard and the completeness test. */
export const WRITES_VALUES = Object.freeze(Object.values(WRITES));

/**
 * LIN-4468: the allowance a stamped token enforces, held in code (the proxy refuses; the prompt
 * only says). Each stage's `writes` is stamped on its proxy token at mint and carried through the
 * exchange onto `req` (lib/proxy-tokens.js, routes/proxy.js). The table is plain data, keyed by
 * operation names: the SPEC keys of routes/proxy-writes.js for ticket writes, and a name for each
 * other write route that a stage token could reach (the `requireWriteScope` / `requireStageWrite`
 * mounts in routes/proxy*.js). It names no second classification of SPEC.
 *
 * A stamp is one of:
 * - `null` (unstamped, a legacy or stage-less mint): unrestricted, as today.
 * - `work`: unrestricted, as today.
 * - any other `WRITES` value: only the operations listed for it below are allowed.
 *
 * Default deny: an operation a restricted stamp does not list is refused. A stamp outside
 * `WRITES_VALUES` fails closed to `none` (`normalizeWritesStamp`).
 */

/** Every operation the table can name. A route that enforces a write names one of these, and the mount fails loudly on any other. */
export const STAGE_WRITE_OPS = Object.freeze([
  // Ticket writes (routes/proxy-writes.js; the keys of its SPEC table).
  'createIssue', 'updateIssue', 'appendDescription', 'replaceDescription', 'belowDescription',
  'createComment', 'deleteComment', 'updateComment', 'attachment',
  'createRelation', 'deleteRelation', 'addLabel', 'removeLabel',
  // Other writes a stage token could reach.
  'dispatch', 'periodicalMint', 'kickoff', 'agentStatus', 'haltSet', 'haltClear', 'modelRouting',
  'rulingSuggestDismissal', 'rulingSuggestAnswer',
  'runnerHeartbeat', 'runnerTake', 'runnerFeedback', 'runnerUsage',
  // LIN-4493: the records routes (routes/proxy-records.js). Allowed to every stamp: any actor may write any kind
  // (layer §3.2). Its records reads are gated apart, by the blind-read refusal in that router.
  'recordWrite'
]);

/** The `updateIssue` body fields a `ticket-fields` stamp may set (triage: state, project and priority). */
export const TICKET_FIELDS_UPDATE = Object.freeze(['stateId', 'projectId', 'priority', 'priorityLevel']);

/** Every `updateIssue` body field the PATCH reads, so a field outside the allowance is named, not dropped. */
export const ISSUE_PATCH_FIELDS = Object.freeze(['title', 'description', 'stateId', 'assigneeId', 'priority', 'priorityLevel', 'projectId', 'parentId', 'cycleId']);

const ALLOWED_OPS = Object.freeze({
  [WRITES.NONE]: Object.freeze(['recordWrite']),
  [WRITES.ONE_COMMENT]: Object.freeze(['createComment', 'recordWrite']),
  [WRITES.BLIND_COMMENT]: Object.freeze(['createComment', 'recordWrite']),
  [WRITES.TICKET_FIELDS]: Object.freeze(['updateIssue', 'createComment', 'addLabel', 'removeLabel', 'recordWrite'])
});

/**
 * Normalise a stamp read from a token document or a caller. `undefined`/`null` stays `null`
 * (unstamped). A known value is returned as is. Anything else is `none`, so a corrupt stamp
 * refuses rather than widening.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeWritesStamp(value) {
  if (value === undefined || value === null) return null;
  return WRITES_VALUES.includes(value) ? value : WRITES.NONE;
}

/** True when the stamp narrows anything: every stamp except unstamped and `work`. */
export function isRestrictedStamp(stamp) {
  const value = normalizeWritesStamp(stamp);
  return value !== null && value !== WRITES.WORK;
}

/**
 * May a token carrying `stamp` perform operation `op`? The coarse, route-level check: it knows
 * no ticket. Ticket matching is the second enforcement point (routes/proxy-writes.js, after the
 * provider read).
 * @param {unknown} stamp
 * @param {string} op - one of STAGE_WRITE_OPS
 * @param {{fields?: string[]}} [options] - the `updateIssue` body fields present, for the triage field rule
 * @returns {boolean}
 */
export function stageWriteAllows(stamp, op, { fields = [] } = {}) {
  const value = normalizeWritesStamp(stamp);
  if (value === null || value === WRITES.WORK) return true;
  if (!ALLOWED_OPS[value].includes(op)) return false;
  if (op === 'updateIssue' && value === WRITES.TICKET_FIELDS) {
    return fields.every(field => TICKET_FIELDS_UPDATE.includes(field));
  }
  return true;
}

/**
 * Two issue references name the same ticket: equal once trimmed and case-folded. A literal
 * match is the cheap first check; a provider-resolved id match is the second.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function sameTicketKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = a.trim().toLowerCase();
  return left !== '' && left === b.trim().toLowerCase();
}

/**
 * The mint options a stage stamp adds. An unrestricted stamp (unstamped, or `work`) adds nothing:
 * it mints exactly as a token with no stamp does, so the unrestricted mint shapes are unchanged. A
 * restricted stamp adds its `writes` and its one ticket (`null` fails closed: no ticket is writable).
 * @param {unknown} writes
 * @param {string|null|undefined} writesTarget
 * @returns {{writes?: string, writesTarget?: string|null}}
 */
export function stampMintOptions(writes, writesTarget) {
  if (!isRestrictedStamp(writes)) return {};
  return { writes: normalizeWritesStamp(writes), writesTarget: writesTarget ?? null };
}

/**
 * LIN-4492: who minted a proxy token. `origin` is set at mint and never widened by a later hop:
 * - `person`: a credential a person holds (the tokens page, the `+proxy` toggle, owner-issued grants,
 *   test mints). It acts as that person, so a write it makes is filed as `person:<createdBy>`.
 * - `dispatch`: a credential Harbour minted for a dispatched session. It may write records only as the
 *   run it names (`runRecordId`), so an agent's hand-off is never filed as a person's.
 * A token with no `origin` predates run identity, or is a mint nobody classified; `writerOf` (lib/run-lineage.js)
 * refuses it in the records routes (routes/proxy-records.js, LIN-4493): such a write is answered 403
 * `predates-run-identity`.
 */
export const TOKEN_ORIGIN = Object.freeze({ PERSON: 'person', DISPATCH: 'dispatch' });

/**
 * The marker that proves a `person` origin came through the person-mint helper below. Module-private:
 * the two proxy-token mint methods read it, and nothing else can set it. The census
 * (tests/unit/lin-4492-mint-census.test.js) pins `personMint(` to the two person sites.
 */
const PERSON_MINT = Symbol('harbour.person-mint');

/**
 * The options a person's own mint carries: `origin: 'person'`, marked as the person-mint helper.
 * Spread into the proxy-token mint options by the routes where a person mints.
 * @param {Object} [options] - the mint's own options
 * @returns {Object} `options` with `origin: 'person'` and the marker
 */
export function personMint(options = {}) {
  return { ...options, origin: TOKEN_ORIGIN.PERSON, [PERSON_MINT]: true };
}

/** True when `options` came through `personMint`. */
export function isPersonMint(options) {
  return options?.[PERSON_MINT] === true;
}

/**
 * The origin and run a dispatch mint carries (LIN-4492). Every mint a dispatched session makes names
 * the origin `dispatch`; the run is sparse: a row with no run (an autopilot kickoff, a collective
 * participant, a kind-less `custom` row) carries origin without a run, and `writerOf` (lib/run-lineage.js)
 * refuses its records writes with that reason (routes/proxy-records.js, LIN-4493). The stage stamp (`writes`, `writesTarget`) rides along unchanged.
 * @param {{writes?: unknown, writesTarget?: string|null, runRecordId?: string|null}} [args]
 * @returns {{origin: 'dispatch', runRecordId?: string, writes?: string, writesTarget?: string|null}}
 */
export function dispatchMintOptions({ writes = null, writesTarget = null, runRecordId = null } = {}) {
  return {
    origin: TOKEN_ORIGIN.DISPATCH,
    ...(typeof runRecordId === 'string' && runRecordId ? { runRecordId } : {}),
    ...stampMintOptions(writes, writesTarget)
  };
}
