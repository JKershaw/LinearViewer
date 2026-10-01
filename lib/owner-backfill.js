/**
 * One-shot owner backfill (LIN-3142, John's ruling of 2026-09-29 settling
 * LIN-1892 Open decision 2): every workspace that has at least one
 * account↔workspace edge but no `role: 'owner'` edge gets an owner edge for
 * John's account. An existing owner is never overwritten, whoever it is, and a
 * workspace with no edge at all is out of scope.
 *
 * Runs as a non-fatal boot step straight after `ensureIndexes(db)` in
 * server.js, and read-only from scripts/dry-run-owner-backfill.mjs through the
 * same `runOwnerBackfill({ db, write: false })`, so a dry run equals the boot
 * plan. There is no migration framework (lib/db-indexes.js), no marker
 * collection, no flag and no env var.
 *
 * One-shot by construction: a workspace qualifies only when its earliest
 * datable edge `createdAt` is strictly before `CUTOFF`. `createdAt` is stamped
 * once on insert and never updated, so every workspace bound from now on is
 * post-cutoff, and once every pre-cutoff target is owned the set stays empty.
 * A future crash-gap workspace (see `bindAccountToWorkspace`) is not given to
 * John.
 *
 * Gates, each fail-closed (nothing written, boot continues):
 *   1. the `account_workspaces_one_owner` partial unique index exists with the
 *      production spec, read from `listIndexes` rather than trusted from
 *      `ensureIndexes`' result. It is the only thing keeping concurrent writers
 *      (another dyno, a first binder) to one owner;
 *   2. the account holding John's Linear identity canonicalises to the pinned
 *      account (`resolveJohn`).
 *
 * Writes go one workspace at a time. A workspace where John already has an
 * edge (directly or through a merged-away alias) has that edge promoted in
 * place; otherwise John's edge is inserted already carrying `role: 'owner'`.
 * A duplicate-key rejection (E11000) means another writer got there first and
 * counts as `raced`; any other error is `failed` and logged by code only. Each
 * workspace is independent, so a raced or failed one still matches next boot.
 *
 * Output secrecy: every line starts `[owner-backfill]`. Workspace ids, kind
 * labels, edge counts, the pinned account id and the cutoff are printed on
 * purpose. Credentials, tokens, emails, session data, the contents of
 * `identities[]` (so the pinned Linear viewer id) and error message text are
 * never printed, in either mode.
 */

import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { AccountStore } from './account-store.js';

// John's canonical account. The same id is `CANONICAL_ACCOUNT_ID` in
// scripts/repair-account-merge-lin2233.js:41, and Harbour's dispatch records
// carry it as `dispatchedBy`. A source constant, never an env var: a
// production env var would be host configuration.
export const PIN_ACCOUNT = 'e7e948a4-2951-4af4-b60e-572a473a491e';
// John's Linear VIEWER (user) id in the LinearViewer organisation: the
// `identities[].scope` every Linear sign-in records (routes/auth.js passes
// `String(viewer.id)`). Not an org or workspace id. LIN-1370 C1, LIN-1346 C0,
// LIN-2231 C10. Used only as the identity-gate lookup value and never printed.
// A source constant, never an env var: a production env var would be host
// configuration.
export const PIN_LINEAR_SCOPE = 'beb9398c-83b5-4d06-b65e-78d19bb0d2f7';
// The ruling instant (LIN-3142 R1): only workspaces whose earliest edge is
// strictly before this are backfilled.
export const CUTOFF = new Date('2026-09-29T19:35:00.000Z');
// lib/db-indexes.js, the one-owner-per-workspace partial unique index.
export const OWNER_INDEX_NAME = 'account_workspaces_one_owner';

const OWNER_INDEX_KEY = { workspaceId: 1, role: 1 };
const OWNER_INDEX_FILTER = { role: 'owner' };
const EDGE_PROJECTION = Object.freeze({ _id: 1, accountId: 1, workspaceId: 1, createdAt: 1, role: 1 });
const PREFIX = '[owner-backfill]';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The workspace kind a workspace id implies: a deliberate copy of
 * `inferWorkspaceKind` in scripts/dry-run-workspace-ownership.mjs, because
 * lib/ never imports scripts/ (a parity test keeps the two equal). Any UUID is
 * `container`, so every Linear workspace (its id is the org UUID) reports
 * `container` too: the label is a display hint, never evidence of a provider
 * or of an orphan row.
 * @param {string} workspaceId
 * @returns {'github'|'jira'|'container'|'linear-org'}
 */
export function inferWorkspaceKind(workspaceId) {
  if (workspaceId.startsWith('github:')) return 'github';
  if (workspaceId.startsWith('jira:')) return 'jira';
  if (UUID_RE.test(workspaceId)) return 'container';
  return 'linear-org';
}

/**
 * An edge's `createdAt` as epoch ms, or `null` when it is not datable. `null`
 * and an absent field are explicitly undatable: `new Date(null)` is the epoch,
 * which would read as pre-cutoff.
 * @param {*} value
 * @returns {number|null}
 */
function edgeTime(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

// Earliest first by (createdAt, _id); undatable edges sort last.
function byCreatedAtThenId(a, b) {
  const ta = edgeTime(a.createdAt) ?? Infinity;
  const tb = edgeTime(b.createdAt) ?? Infinity;
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ia = String(a._id);
  const ib = String(b._id);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

function byWorkspaceId(a, b) {
  return a.workspaceId < b.workspaceId ? -1 : a.workspaceId > b.workspaceId ? 1 : 0;
}

// Same walk as AccountStore.resolveCanonicalAccountId, over a pre-read
// `mergedInto` map (scripts/dry-run-workspace-ownership.mjs). A corrupt chain
// (cycle, or deeper than 8 hops) resolves to null, so that edge never counts
// as one of John's.
function canonicalise(accountId, mergedInto) {
  let current = accountId;
  const visited = new Set([current]);
  for (let hop = 0; hop < 8; hop++) {
    const next = mergedInto.get(current);
    if (!next) return current;
    if (visited.has(next)) return null;
    visited.add(next);
    current = next;
  }
  return null;
}

/**
 * Bucket edges per workspace. The ONE classification the boot step, the dry
 * run and their summary counts share.
 *
 * Owner presence is a raw `role === 'owner'` test: never "edges lack `role`"
 * (the test seam clears owners with `role: null`) and never a canonical
 * comparison, so an owner on a merged-away account still counts.
 *
 * @param {Object[]} edges - `{_id, accountId, workspaceId, createdAt, role?}`
 * @param {Object} [options]
 * @param {Date} [options.cutoff=CUTOFF]
 * @returns {Map<string, {edges: Object[], hasOwner: boolean, earliest: (Date|null), status: ('owned'|'target'|'post-cutoff'|'undatable')}>}
 */
export function classifyWorkspaces(edges, { cutoff = CUTOFF } = {}) {
  const byWorkspace = new Map();
  for (const edge of edges) {
    if (typeof edge?.workspaceId !== 'string') continue;
    let entry = byWorkspace.get(edge.workspaceId);
    if (!entry) {
      entry = { edges: [], hasOwner: false, earliestTime: null };
      byWorkspace.set(edge.workspaceId, entry);
    }
    entry.edges.push(edge);
    if (edge.role === 'owner') entry.hasOwner = true;
    const time = edgeTime(edge.createdAt);
    if (time !== null && (entry.earliestTime === null || time < entry.earliestTime)) entry.earliestTime = time;
  }

  const cutoffTime = cutoff.getTime();
  const classified = new Map();
  for (const [workspaceId, { edges: wsEdges, hasOwner, earliestTime }] of byWorkspace) {
    let status;
    if (hasOwner) status = 'owned';
    else if (earliestTime === null) status = 'undatable';
    else if (earliestTime >= cutoffTime) status = 'post-cutoff';
    else status = 'target';
    classified.set(workspaceId, {
      edges: wsEdges,
      hasOwner,
      earliest: earliestTime === null ? null : new Date(earliestTime),
      status
    });
  }
  return classified;
}

/**
 * Counts over a classification. `ownerless` can legitimately stay above 0
 * (post-cutoff crash-gap workspaces are never assigned), so the completion
 * evidence is `ownerlessPreCutoff: 0`, not `ownerless: 0`.
 * @param {Map} classified - from `classifyWorkspaces`
 * @returns {{workspacesWithEdges: number, ownerEdges: number, ownerless: number, ownerlessPreCutoff: number, undatable: number}}
 */
export function summariseOwnership(classified) {
  const summary = { workspacesWithEdges: 0, ownerEdges: 0, ownerless: 0, ownerlessPreCutoff: 0, undatable: 0 };
  for (const { edges, hasOwner, status } of classified.values()) {
    summary.workspacesWithEdges++;
    summary.ownerEdges += edges.filter(e => e.role === 'owner').length;
    if (!hasOwner) summary.ownerless++;
    if (status === 'target') summary.ownerlessPreCutoff++;
    if (status === 'undatable') summary.undatable++;
  }
  return summary;
}

/**
 * Plan the backfill from already-read data. Pure.
 *
 * For each target, John's existing edge (any edge whose account canonicalises
 * to `johnAccountId`) is promoted rather than adding a second one: an edge on
 * `johnAccountId` itself first, else the earliest by `(createdAt, _id)` with
 * undatable edges last. With none, `promoteEdgeId` is null and the write
 * inserts John's edge. Promoting keeps the new membership rows, and so their
 * side effects, to workspaces where John genuinely was not a member.
 *
 * @param {Object} options
 * @param {Object[]} options.edges
 * @param {Map<string, string>} [options.mergedInto] - accountId → mergedInto
 * @param {string|null} [options.johnAccountId] - canonical; null when unresolved
 * @param {Date} [options.cutoff=CUTOFF]
 * @returns {{targets: Object[], undatable: Object[], summary: Object}} targets and undatable sorted by workspaceId
 */
export function planOwnerBackfill({ edges, mergedInto = new Map(), johnAccountId = null, cutoff = CUTOFF }) {
  const classified = classifyWorkspaces(edges, { cutoff });
  const targets = [];
  const undatable = [];

  for (const [workspaceId, entry] of classified) {
    const kind = inferWorkspaceKind(workspaceId);
    const edgeCount = entry.edges.length;
    if (entry.status === 'undatable') {
      undatable.push({ workspaceId, kind, edgeCount });
      continue;
    }
    if (entry.status !== 'target') continue;

    let promoteEdgeId = null;
    let johnAlreadyMember = null;
    if (johnAccountId) {
      const johnEdges = entry.edges.filter(e => canonicalise(e.accountId, mergedInto) === johnAccountId);
      const direct = johnEdges.filter(e => e.accountId === johnAccountId).sort(byCreatedAtThenId);
      const chosen = direct[0] ?? johnEdges.sort(byCreatedAtThenId)[0] ?? null;
      promoteEdgeId = chosen ? chosen._id : null;
      johnAlreadyMember = chosen !== null;
    }
    targets.push({ workspaceId, kind, edgeCount, promoteEdgeId, johnAlreadyMember });
  }

  targets.sort(byWorkspaceId);
  undatable.sort(byWorkspaceId);
  return { targets, undatable, summary: summariseOwnership(classified) };
}

/**
 * Gate 1: the owner index exists with the production spec (lib/db-indexes.js):
 * named `account_workspaces_one_owner`, unique, key `{workspaceId:1, role:1}`
 * in that order, partial on `{role:'owner'}`. A same-named index with any other
 * spec would not enforce one owner. Never throws: an absent collection (real
 * MongoDB's NamespaceNotFound) or any read failure answers false.
 * @param {Object} db
 * @returns {Promise<boolean>}
 */
export async function hasOwnerIndex(db) {
  try {
    const indexes = await db.collection('account-workspaces').listIndexes().toArray();
    return indexes.some(ix =>
      ix.name === OWNER_INDEX_NAME &&
      ix.unique === true &&
      JSON.stringify(ix.key) === JSON.stringify(OWNER_INDEX_KEY) &&
      isDeepStrictEqual(ix.partialFilterExpression, OWNER_INDEX_FILTER)
    );
  } catch {
    return false;
  }
}

/**
 * Gate 2: identify John unambiguously, fail-closed. The account holding the
 * pinned Linear identity must be the only one, the pinned account must exist,
 * and both must canonicalise to the same account, which is the id the owner
 * edge is written for. Only `_id`s are read from account documents; nothing
 * from them is logged. Never throws.
 * @param {Object} options
 * @param {Object} options.accountsCollection
 * @param {AccountStore} options.accountStore
 * @returns {Promise<{ok: true, accountId: string} | {ok: false, reason: ('no-match'|'ambiguous'|'pinned-missing'|'mismatch'|'unavailable')}>}
 */
export async function resolveJohn({ accountsCollection, accountStore }) {
  try {
    // A server-side count: `findAccountByIdentity` is a findOne, which cannot
    // see a second holder.
    const holders = await accountsCollection.countDocuments({ identities: { $elemMatch: { provider: 'linear', scope: PIN_LINEAR_SCOPE } } });
    if (holders === 0) return { ok: false, reason: 'no-match' };
    if (holders > 1) return { ok: false, reason: 'ambiguous' };

    const match = await accountStore.findAccountByIdentity('linear', PIN_LINEAR_SCOPE);
    if (!match) return { ok: false, reason: 'no-match' };

    // `resolveCanonicalAccountId` returns an unknown id as itself, so it can't
    // be the existence check.
    if (!(await accountStore.getAccount(PIN_ACCOUNT))) return { ok: false, reason: 'pinned-missing' };

    const matchCanonical = await accountStore.resolveCanonicalAccountId(match._id);
    const pinnedCanonical = await accountStore.resolveCanonicalAccountId(PIN_ACCOUNT);
    if (!pinnedCanonical || matchCanonical !== pinnedCanonical) return { ok: false, reason: 'mismatch' };
    return { ok: true, accountId: pinnedCanonical };
  } catch {
    // A corrupt mergedInto chain, or a failing store.
    return { ok: false, reason: 'unavailable' };
  }
}

// Promote one edge to owner. `$ne: 'owner'`, not `$exists: false`: the latter
// never matches `role: null`, so a cleared John edge would silently never be
// promoted. Counted by modifiedCount, so a no-op is `raced`, never `assigned`.
async function promote(edgesCollection, edgeId) {
  const result = await edgesCollection.updateOne(
    { _id: edgeId, role: { $ne: 'owner' } },
    { $set: { role: 'owner' } }
  );
  return result.modifiedCount === 1 ? 'assigned' : 'raced';
}

function memberLabel(johnAlreadyMember) {
  if (johnAlreadyMember === true) return 'yes';
  if (johnAlreadyMember === false) return 'no';
  return 'unknown';
}

function targetLine(target, outcome, code) {
  const line = `${PREFIX} target workspace=${target.workspaceId} kind=${target.kind} edges=${target.edgeCount} johnAlreadyMember=${memberLabel(target.johnAlreadyMember)} outcome=${outcome}`;
  return code === undefined ? line : `${line} code=${code}`;
}

/**
 * The only writer. One workspace at a time; each is independent.
 *
 * - Promote path (`promoteEdgeId` set): promote that edge.
 * - Insert path: upsert John's edge on `{accountId, workspaceId}` with
 *   `role: 'owner'` inside `$setOnInsert`, so the edge is inserted already
 *   owning in one atomic step. If the upsert instead found John's own plain
 *   edge (a concurrent sign-in), promote that edge. If another owner won, the
 *   partial unique index rejects the insert and no stray John edge is left.
 * - E11000 (the owner index, or the `{accountId, workspaceId}` pair index on a
 *   concurrent upsert) → `raced`; anything else → `failed`, logged by code only.
 *
 * @param {Object} options
 * @param {Object} options.edgesCollection
 * @param {{targets: Object[]}} options.plan - from `planOwnerBackfill`
 * @param {string} options.johnAccountId - canonical
 * @param {Object} [options.logger=console]
 * @returns {Promise<{assigned: number, alreadyMember: number, raced: number, failed: number, outcomes: Object[]}>}
 */
export async function executeOwnerBackfill({ edgesCollection, plan, johnAccountId, logger = console }) {
  const result = { assigned: 0, alreadyMember: 0, raced: 0, failed: 0, outcomes: [] };

  for (const target of plan.targets) {
    let outcome;
    let code;
    try {
      if (target.promoteEdgeId) {
        outcome = await promote(edgesCollection, target.promoteEdgeId);
      } else {
        const newId = randomUUID();
        const edge = await edgesCollection.findOneAndUpdate(
          { accountId: johnAccountId, workspaceId: target.workspaceId },
          {
            $setOnInsert: {
              _id: newId,
              accountId: johnAccountId,
              workspaceId: target.workspaceId,
              createdAt: new Date(),
              role: 'owner'
            }
          },
          { upsert: true, returnDocument: 'after' }
        );
        if (edge && edge._id === newId) outcome = 'assigned';
        else if (edge) outcome = await promote(edgesCollection, edge._id);
        else outcome = 'raced';
      }
    } catch (err) {
      if (err?.code === 11000) {
        outcome = 'raced';
      } else {
        outcome = 'failed';
        code = String(err?.code ?? err?.name ?? 'unknown');
      }
    }

    result[outcome]++;
    if (outcome === 'assigned' && target.johnAlreadyMember) result.alreadyMember++;
    result.outcomes.push(code === undefined ? { workspaceId: target.workspaceId, outcome } : { workspaceId: target.workspaceId, outcome, code });
    if (outcome === 'failed') logger.error(targetLine(target, outcome, code));
    else logger.log(targetLine(target, outcome));
  }

  return result;
}

/**
 * The boot entry, and the dry run's (`write: false`). Composes gate 1 → gate 2
 * → read → plan → write, and NEVER throws: any unexpected error becomes
 * `skipped=unexpected-error` so startup is never wedged.
 *
 * In write mode a failed gate skips before the edge read (`targets=na`). In
 * dry-run mode the gate results are reported but planning continues, with
 * `johnAlreadyMember` unknown when John is unresolved; nothing is written.
 *
 * Always logs exactly one summary line:
 *   [owner-backfill] owner=<id|unresolved> cutoff=<iso> targets=<N|na> assigned=N
 *     alreadyMember=N raced=N failed=N undatable=<N|na> mode=<write|dry-run>
 *     skipped=<none|owner-index-missing|identity-<reason>|unexpected-error>
 * Its keys are the post-deploy evidence contract (read from the Railway log);
 * do not rename them.
 *
 * @param {Object} options
 * @param {Object} options.db
 * @param {boolean} [options.write=true]
 * @param {Object} [options.logger=console]
 * @returns {Promise<Object>} the report
 */
export async function runOwnerBackfill({ db, write = true, logger = console }) {
  const report = {
    mode: write ? 'write' : 'dry-run',
    skipped: null,
    gates: { ownerIndex: null, identity: null },
    targets: [],
    undatable: [],
    counts: { targets: null, assigned: 0, alreadyMember: 0, raced: 0, failed: 0, undatable: null },
    summary: null
  };
  let owner = null;

  try {
    const edgesCollection = db.collection('account-workspaces');
    const accountsCollection = db.collection('accounts');

    report.gates.ownerIndex = await hasOwnerIndex(db);
    if (!report.gates.ownerIndex) report.skipped = 'owner-index-missing';

    if (!(write && report.skipped)) {
      const accountStore = new AccountStore({ collection: accountsCollection });
      const john = await resolveJohn({ accountsCollection, accountStore });
      report.gates.identity = john.ok ? 'ok' : john.reason;
      if (john.ok) owner = john.accountId;
      else report.skipped ??= `identity-${john.reason}`;
    }

    if (!(write && report.skipped)) {
      const edges = await edgesCollection.find({}, { projection: EDGE_PROJECTION }).toArray();
      let mergedInto = new Map();
      if ([...classifyWorkspaces(edges).values()].some(entry => entry.status === 'target')) {
        const mergedRows = await accountsCollection
          .find({ mergedInto: { $exists: true } }, { projection: { _id: 1, mergedInto: 1 } })
          .toArray();
        mergedInto = new Map(mergedRows.map(row => [row._id, row.mergedInto]));
      }
      const plan = planOwnerBackfill({ edges, mergedInto, johnAccountId: owner });
      report.targets = plan.targets;
      report.undatable = plan.undatable;
      report.summary = plan.summary;
      report.counts.targets = plan.targets.length;
      report.counts.undatable = plan.undatable.length;

      for (const entry of plan.undatable) {
        logger.log(`${PREFIX} undatable workspace=${entry.workspaceId} kind=${entry.kind} edges=${entry.edgeCount}`);
      }

      if (write) {
        const result = await executeOwnerBackfill({ edgesCollection, plan, johnAccountId: owner, logger });
        report.counts.assigned = result.assigned;
        report.counts.alreadyMember = result.alreadyMember;
        report.counts.raced = result.raced;
        report.counts.failed = result.failed;
        const outcomes = new Map(result.outcomes.map(o => [o.workspaceId, o]));
        report.targets = plan.targets.map(t => ({ ...t, ...outcomes.get(t.workspaceId) }));
      } else {
        for (const target of plan.targets) logger.log(targetLine(target, 'would-assign'));
      }
    }
  } catch {
    // Never the message: it could carry document contents.
    report.skipped = 'unexpected-error';
  }

  const { counts } = report;
  try {
    logger.log(
      `${PREFIX} owner=${owner ?? 'unresolved'} cutoff=${CUTOFF.toISOString()}` +
      ` targets=${counts.targets ?? 'na'} assigned=${counts.assigned} alreadyMember=${counts.alreadyMember}` +
      ` raced=${counts.raced} failed=${counts.failed} undatable=${counts.undatable ?? 'na'}` +
      ` mode=${report.mode} skipped=${report.skipped ?? 'none'}`
    );
  } catch {
    // A throwing logger must not wedge boot either.
  }
  return report;
}
