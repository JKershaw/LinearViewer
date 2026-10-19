/**
 * Account erasure by request (LIN-3423): one plan-then-apply tool the operator
 * drives from scripts/erase-account.mjs, with two levels.
 *
 *   - Standard: the person's account, email address, sign-in identities,
 *     sessions, and the tokens and credentials they own go. Workspace history
 *     stays as the workspace record.
 *   - Full wipe: Standard, plus the history of workspaces they own ALONE. In a
 *     workspace shared with other people the account id on history is replaced
 *     by `ERASED_ACCOUNT_ID`; the rows stay.
 *
 * `INVENTORY` is the one table of what every collection does at each level.
 * The sighting set (which fields can show a second person in a workspace) is
 * derived from it (`sightingFields`), never kept as a second list. The seed the
 * tests plant (tests/fixtures/erasure-seed.js) is generated from it too.
 *
 * The db handle is injected; importing opens nothing and writes nothing. The
 * module does not import from scripts/ (layering): the pieces it needs from the
 * dry-run scripts live in lib/urlkey-holders.js.
 *
 * Raw filters, on purpose. The stores' `clear(urlKey)` is single-key, and the
 * connection deleters refuse referenced rows (lib/connection-store.js:84-106),
 * so neither can erase a person. The one exception is cancelling queued runs,
 * which goes through `DispatchQueueStore#removeItem` so the row is archived to
 * `dispatch-history` as `cancelled` and not silently dropped (LIN-3486).
 *
 * Runbook: docs/runbooks/account-erasure.md. Nothing here is run against
 * production by the change that adds it.
 */

import { createHash } from 'node:crypto';
import { AccountStore } from './account-store.js';
import { normalizeEmail } from './email-auth.js';
import { holdersFromRows, sessionWorkspaceRefs } from './urlkey-holders.js';
import { DispatchQueueStore } from './dispatch-store.js';
import { noOwnTerminalMarkerFilter, harvestAbortedTargets } from './dispatch-terminal.js';
import { REFRESH_WORST_CASE_MS } from './workspace-token-cache.js';

/**
 * What the account id on a Shared workspace's history becomes at Full wipe. One
 * value for everyone, so erased rows cannot be linked to each other. Open
 * question for John (LIN-3423): another ruling changes this constant, the
 * inventory's `anonymise` rows and one sentence on the privacy page.
 */
export const ERASED_ACCOUNT_ID = 'erased';

/**
 * The one pause between step 3 and the pre-accounts gate. A Harbour proxy or
 * dispatch token is validated by a fresh `findOne({ tokenHash })` on every
 * request (lib/proxy-tokens.js, lib/dispatch-tokens.js), so a token deleted in
 * step 3 is refused on its very next request. The 30 s `workspaceTokenCache`
 * holds resolved TRACKER access tokens, not Harbour token validity, so it is
 * not the reason. What the pause covers is a request that passed validation
 * before step 3 and writes after it. `REFRESH_WORST_CASE_MS` is the repo's
 * derived bound for one in-flight resolve, and a dispatch request does work
 * after the resolve too, so this is a heuristic, not a bound: a write that
 * still lands after the gate is caught by the final recount as RESIDUAL.
 * (Its value matches `DEFAULT_BLOCK_WINDOW_MS` in lib/workspace-token-cache.js;
 * the two mean different things, so the name here stays separate.)
 */
export const IN_FLIGHT_SETTLE_MS = REFRESH_WORST_CASE_MS + 5000;

/** `--find-label` only looks at tokens minted in this window. */
export const FIND_LABEL_WINDOW_MS = 24 * 60 * 60 * 1000;

const MAX_SAMPLE_IDS = 5;
const SHORT = 8;

// ---------------------------------------------------------------------------
// INVENTORY
// ---------------------------------------------------------------------------

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `kind`:
 *   group     found by the person's account ids (G), removed at the level(s) shown
 *   history   names an account and carries workspace history: Standard keeps it;
 *             Full deletes it for an Alone workspace and anonymises it for the rest
 *   workspace no account field: Standard keeps it; Full deletes it for an Alone
 *             workspace, keeps it for the rest
 *   leave     not touched, with the reason (still listed)
 *
 * `find`   how group rows are found (group kind): field, `_id`, `_id` prefix.
 * `scope`  how a workspace's rows are addressed by urlKey: field, `_id`,
 *          anchored regex. A regex builder returns an ANCHORED source, so
 *          `acme` never matches `acme-eu`.
 * `accountFields` every field that names an account on a row that carries a
 *          urlKey. This is the only sighting set (`sightingFields`).
 *          kind: field | array (the last path part is read per element) |
 *          label-or-account (counts only when it is an existing account id, a
 *          token label is not a person) | prefsMap (the keys of the map are
 *          workspace keys, the row `_id` is the account).
 */
const field = (name) => ({ by: 'field', field: name });
const FIELD_URLKEY = [field('urlKey')];
const cacheScope = [{ by: 'idRegex', build: (k) => `^${escapeRegex(k)}:` }];
const historyOf = (accountFields, scope = FIELD_URLKEY, reason) => ({
  kind: 'history',
  find: accountFields.map((f) => field(f.path)),
  scope,
  accountFields,
  standard: 'keep',
  full: 'anonymise',
  ...(reason ? { reason } : {})
});
const workspaceOf = (scope = FIELD_URLKEY, reason) => ({
  kind: 'workspace', scope, accountFields: [], standard: 'keep', full: 'delete', ...(reason ? { reason } : {})
});
const groupOf = (find, accountFields = [], extra = {}) => ({
  kind: 'group', find, accountFields, standard: 'delete', full: 'delete', ...extra
});
const leave = (reason) => ({ kind: 'leave', accountFields: [], standard: 'leave', full: 'leave', reason });

const PREFS_MAPS = ['selectedTeamByWorkspace', 'northStarByWorkspace', 'northStarDocVersionByWorkspace'];

const DISPATCH_ACCOUNT_FIELDS = [
  { path: 'dispatchedBy', kind: 'field' },
  { path: 'grantDeclaration.ownerAccountId', kind: 'field' },
  // `bookkeeping.by` is free text and stays. trimHistory[].by is an account id (lib/dispatch-store.js trimHistory audit entry).
  { path: 'trimHistory.by', kind: 'array' }
];

export const INVENTORY = Object.freeze([
  // --- found by the person's accounts (G) ---------------------------------
  { collection: 'accounts', ...groupOf([{ by: 'id' }]), reason: 'deleted last (step 4): aliases deepest-first, the canonical account at the very end' },
  { collection: 'account-workspaces', ...groupOf([field('accountId')]), reason: 'the edges, including an owner edge that sits on an alias after a merge (lib/account-store.js mergeAccounts)' },
  { collection: 'sessions', ...groupOf([field('session.accountId')]), reason: 'string-encoded rows and rows without an account cannot be found; the dry run counts them' },
  { collection: 'owner-credentials', ...groupOf([field('accountId'), { by: 'idPrefix' }]), reason: 'composite ids start with the account id, and a connection-keyed record\'s id is the connection id, which does too (lib/owner-credential-store.js)' },
  { collection: 'connections', ...groupOf([field('accountId'), { by: 'idPrefix' }]) },
  { collection: 'user-preferences', ...groupOf([{ by: 'id' }], PREFS_MAPS.map((m) => ({ path: `preferences.${m}`, kind: 'prefsMap' }))) },
  { collection: 'saved-chats', ...groupOf([field('accountId')], [{ path: 'accountId', kind: 'field' }]), reason: 'open question (LIN-3423): deleted at both levels' },
  { collection: 'proxy-tokens', ...groupOf([field('createdBy')], [{ path: 'createdBy', kind: 'field' }]), reason: 'runner copies carry the owner\'s createdBy, so they go with it' },
  { collection: 'dispatch-tokens', ...groupOf([field('createdBy')], [{ path: 'createdBy', kind: 'field' }]), reason: 'ownerless rows (createdBy empty) belong to no account; LIN-3618 expires, never deletes, them' },
  { collection: 'task_share_links', ...groupOf([field('ownerAccountId')], [{ path: 'ownerAccountId', kind: 'field' }]) },
  { collection: 'email-magic-links', ...groupOf([field('linkToAccountId'), { by: 'emailNorm' }]) },
  { collection: 'account-merge-events', ...groupOf([field('canonicalId'), field('mergedId')], [], { standard: 'keep' }), reason: 'ids only; open question (LIN-3423): kept at Standard, deleted at Full' },

  // --- name an account, are workspace history -------------------------------
  { collection: 'dispatch-queue', ...historyOf(DISPATCH_ACCOUNT_FIELDS) },
  { collection: 'dispatch-history', ...historyOf(DISPATCH_ACCOUNT_FIELDS) },
  { collection: 'task-mode-events', ...historyOf([{ path: 'accountId', kind: 'field' }]) },
  { collection: 'close-out-events', ...historyOf([{ path: 'accountId', kind: 'field' }]) },
  { collection: 'credential-lifecycle-events', ...historyOf([{ path: 'accountId', kind: 'field' }]) },
  { collection: 'workspace-halt', ...historyOf([{ path: 'setBy', kind: 'field' }], [{ by: 'id' }]), keyBy: '_id' },
  { collection: 'dismissal-suggestions', ...historyOf([{ path: 'suggestedBy', kind: 'label-or-account' }]), reason: 'suggestedBy is an account id or a token label; only an account id is replaced' },

  // --- no account field -----------------------------------------------------
  ...[
    'foreman-status', 'observation-sessions', 'proxy-events', 'llm-call-log', 'prompt-traces', 'liveness-alarms',
    'custom-prompts', 'report-history', 'task-snapshots', 'task-decisions', 'run-paragraph', 'workspaces',
    'observer-shadow-log', 'dispatch-presets', 'run-proposals', 'ship-biscuit-editions', 'collective-characters',
    'collective-presets', 'harbour-feedback-tokens'
  ].map((collection) => ({ collection, ...workspaceOf() })),
  { collection: 'local-issues', ...workspaceOf([field('scope')], 'local workspaces: this is the only copy of the issues') },
  { collection: 'workspace-preferences', ...workspaceOf([{ by: 'id' }]) },
  { collection: 'harbour-comments', ...workspaceOf([field('urlKey'), { by: 'idRegex', build: (k) => `^${escapeRegex(k)}::` }]) },
  { collection: 'shelved-rulings', ...workspaceOf([field('urlKey'), { by: 'idRegex', build: (k) => `^${escapeRegex(k)}::` }]) },
  { collection: 'observer-state', ...workspaceOf([{ by: 'idRegex', build: (k) => `^sweep:v1:${escapeRegex(k)}$|^companion:v1:${escapeRegex(k)}(:proxy)?$` }]) },
  // `_id` is `<urlKey>:<id>`; a urlKey never holds ':' (classification refuses one that does).
  { collection: 'recap-cache', ...workspaceOf(cacheScope) },
  { collection: 'brief-cache', ...workspaceOf(cacheScope) },
  { collection: 'run-summary-cache', ...workspaceOf(cacheScope) },
  { collection: 'session-summary-cache', ...workspaceOf(cacheScope) },

  // --- left, with the reason (still listed) ---------------------------------
  { collection: 'scheduler-locks', ...leave('job locks, no person or workspace data') },
  { collection: 'free-tier-usage', ...leave('daily counters with a TTL; they age out on their own') },
  { collection: 'consumer-heartbeats', ...leave('replaced by the next heartbeat; an hourly cleanup deletes expired ones') },
  { collection: 'wake_shadow', ...leave('shadow classifier tally, no account field') },
  { collection: 'shares', ...leave('retired collection (lib/drop-shares-collection.js), shape unknown; reported if present') }
]);

const INVENTORY_BY_NAME = new Map(INVENTORY.map((r) => [r.collection, r]));

/**
 * The ONLY set classifyWorkspaces reads for actor evidence, derived from
 * INVENTORY. Every field counts the same: none is special-cased.
 * @returns {{collection: string, path: string, kind: string}[]}
 */
export function sightingFields(inventory = INVENTORY) {
  const out = [];
  for (const row of inventory) {
    for (const f of row.accountFields || []) out.push({ collection: row.collection, path: f.path, kind: f.kind });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Errors and small helpers
// ---------------------------------------------------------------------------

/**
 * Every failure carries a code, a step and at most a collection name. A driver
 * error is reduced to `{name, code, collection}` so no row content (and no
 * connection string) can reach output.
 */
export class ErasureError extends Error {
  constructor(code, details = {}) {
    const { step, collection, driver, urlKeyHash, counts, resume, detail } = details;
    const parts = [code];
    if (step) parts.push(`step ${step}`);
    if (collection) parts.push(`collection ${collection}`);
    if (driver) parts.push(`driver ${driver.name || 'Error'}${driver.code !== undefined ? ` ${driver.code}` : ''}`);
    if (urlKeyHash) parts.push(`workspace ${urlKeyHash}`);
    if (detail) parts.push(detail);
    if (counts) parts.push(Object.entries(counts).map(([c, n]) => `${c}=${n}`).join(' '));
    if (resume) parts.push(`resume with: ${resume}`);
    super(parts.join(': '));
    this.name = 'ErasureError';
    this.code = code;
    this.step = step;
    this.collection = collection;
    this.resume = resume;
  }
}

async function guard(collection, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ErasureError) throw err;
    throw new ErasureError('DRIVER_ERROR', { collection, driver: { name: err?.name, code: err?.code } });
  }
}

const short = (id) => String(id).slice(0, SHORT);
const hashKey = (urlKey) => createHash('sha256').update(String(urlKey)).digest('hex').slice(0, SHORT);
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function valuesAt(doc, path) {
  let current = [doc];
  for (const part of path.split('.')) {
    const next = [];
    for (const item of current) {
      const v = item?.[part];
      if (Array.isArray(v)) next.push(...v);
      else if (v !== undefined) next.push(v);
    }
    current = next;
  }
  return current;
}

/** Same walk as AccountStore#resolveCanonicalAccountId over a pre-read map; null on a corrupt chain. */
function canonicalOf(accountId, mergedInto) {
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

export function parseMapPair(raw) {
  if (raw && typeof raw === 'object' && raw.workspaceId && raw.urlKey) return { workspaceId: raw.workspaceId, urlKey: raw.urlKey };
  const text = String(raw);
  const at = text.indexOf('=');
  if (at <= 0 || at === text.length - 1) throw new ErasureError('MAP_INVALID', { detail: '--map takes <workspaceId>=<urlKey>' });
  return { workspaceId: text.slice(0, at), urlKey: text.slice(at + 1) };
}

// ---------------------------------------------------------------------------
// Filters built from INVENTORY
// ---------------------------------------------------------------------------

function groupFilter(row, ctx) {
  const ors = [];
  for (const spec of row.find) {
    if (spec.by === 'field') ors.push({ [spec.field]: { $in: ctx.groupIds } });
    else if (spec.by === 'id') ors.push({ _id: { $in: ctx.groupIds } });
    else if (spec.by === 'idPrefix') ors.push({ _id: { $regex: new RegExp(`^(?:${ctx.groupIds.map(escapeRegex).join('|')})::`) } });
    else if (spec.by === 'emailNorm') {
      if (ctx.emailNorms.length) ors.push({ emailNorm: { $in: ctx.emailNorms } });
    }
  }
  if (ors.length === 0) return null;
  return ors.length === 1 ? ors[0] : { $or: ors };
}

function scopeFilter(row, urlKeys) {
  if (!row.scope || urlKeys.length === 0) return null;
  const ors = [];
  for (const spec of row.scope) {
    if (spec.by === 'field') ors.push({ [spec.field]: { $in: urlKeys } });
    else if (spec.by === 'id') ors.push({ _id: { $in: urlKeys } });
    else if (spec.by === 'idRegex') ors.push({ _id: { $regex: new RegExp(urlKeys.map((k) => `(?:${spec.build(k)})`).join('|')) } });
  }
  return ors.length === 1 ? ors[0] : { $or: ors };
}

function and(a, b) {
  return a && b ? { $and: [a, b] } : (a || b);
}

// ---------------------------------------------------------------------------
// Root and group
// ---------------------------------------------------------------------------

async function resolveRoot(db, root = {}) {
  const hasEmail = typeof root.email === 'string' && root.email !== '';
  const hasId = typeof root.accountId === 'string' && root.accountId !== '';
  if (hasEmail === hasId) throw new ErasureError('ROOT_REQUIRED', { detail: 'exactly one of an email address or an account id' });
  const store = new AccountStore({ collection: db.collection('accounts') });
  return guard('accounts', async () => {
    let ids;
    if (hasEmail) {
      const emailNorm = normalizeEmail(root.email);
      if (!emailNorm) throw new ErasureError('ROOT_EMAIL_INVALID');
      // All matches: mergeAccounts leaves identities[] on the alias, so the address can sit on a merged-away account.
      const rows = await db.collection('accounts').find({ identities: { $elemMatch: { provider: 'email', scope: emailNorm } } }).toArray();
      ids = rows.map((r) => r._id);
      if (ids.length === 0) throw new ErasureError('ROOT_NOT_FOUND', { collection: 'accounts' });
    } else {
      if (!(await store.getAccount(root.accountId))) throw new ErasureError('ROOT_ACCOUNT_MISSING', { collection: 'accounts' });
      ids = [root.accountId];
    }
    let canonicals;
    try {
      canonicals = new Set(await Promise.all(ids.map((id) => store.resolveCanonicalAccountId(id))));
    } catch {
      throw new ErasureError('ROOT_CHAIN_CORRUPT', { collection: 'accounts' });
    }
    if (canonicals.size > 1) throw new ErasureError('ROOT_AMBIGUOUS', { detail: `${canonicals.size} distinct accounts` });
    const canonicalId = [...canonicals][0];
    const canonical = await store.getAccount(canonicalId);
    if (!canonical) throw new ErasureError('ROOT_ACCOUNT_MISSING', { collection: 'accounts' });
    const merged = await store.listMergedAccounts(canonicalId);
    const accounts = [canonical, ...merged];
    const emailNorms = [...new Set(accounts.flatMap((a) => a.identities || []).filter((i) => i.provider === 'email').map((i) => i.scope))].sort();
    return { canonicalId, groupIds: accounts.map((a) => a._id), emailNorms };
  });
}

// ---------------------------------------------------------------------------
// Evidence and classification
// ---------------------------------------------------------------------------

async function readAccounts(db) {
  const rows = await guard('accounts', () => db.collection('accounts').find({}, { projection: { _id: 1, mergedInto: 1 } }).toArray());
  const mergedInto = new Map();
  const exists = new Set();
  for (const r of rows) {
    exists.add(r._id);
    if (r.mergedInto) mergedInto.set(r._id, r.mergedInto);
  }
  return { mergedInto, exists };
}

/** Foreign actor values, per urlKey, from every `accountFields` entry of INVENTORY. */
async function readActorSightings(db, ctx, accounts) {
  const byKey = new Map(); // urlKey -> Set<label>
  const unresolvable = new Map(); // urlKey -> count
  const note = (urlKey, label, value) => {
    if (typeof urlKey !== 'string' || !urlKey) return;
    if (!byKey.has(urlKey)) byKey.set(urlKey, new Set());
    byKey.get(urlKey).add(label);
    if (!accounts.exists.has(value)) unresolvable.set(urlKey, (unresolvable.get(urlKey) || 0) + 1);
  };
  const excluded = [...ctx.groupIds, ERASED_ACCOUNT_ID, null];
  const foreign = (value, kind) => {
    if (typeof value !== 'string' || !value || value === ERASED_ACCOUNT_ID) return false;
    if (ctx.groupIds.includes(value)) return false;
    if (kind === 'label-or-account') return accounts.exists.has(value);
    const canon = canonicalOf(value, accounts.mergedInto);
    return !(canon && ctx.groupIds.includes(canon));
  };
  for (const row of INVENTORY) {
    const fieldsHere = (row.accountFields || []).filter((f) => f.kind !== 'prefsMap');
    for (const f of fieldsHere) {
      const [first, ...rest] = f.path.split('.');
      const filter = f.kind === 'array'
        ? { [f.path.split('.')[0]]: { $elemMatch: { [rest.join('.')]: { $nin: excluded } } } }
        : { [f.path]: { $nin: excluded } };
      const rows = await guard(row.collection, () => db.collection(row.collection).find(filter, { projection: { _id: 1, urlKey: 1, [first]: 1 } }).toArray());
      for (const doc of rows) {
        const urlKey = row.keyBy === '_id' ? doc._id : doc.urlKey;
        for (const value of valuesAt(doc, f.path)) {
          if (foreign(value, f.kind)) note(urlKey, `${row.collection}.${f.path}`, value);
        }
      }
    }
    if ((row.accountFields || []).some((f) => f.kind === 'prefsMap')) {
      const rows = await guard(row.collection, () => db.collection(row.collection).find({ _id: { $nin: ctx.groupIds } }).toArray());
      for (const doc of rows) {
        if (!foreign(doc._id, 'field')) continue;
        for (const f of row.accountFields) {
          const map = valuesAt(doc, f.path)[0];
          if (map && typeof map === 'object') for (const key of Object.keys(map)) note(key, `${row.collection}.${f.path}`, doc._id);
        }
      }
    }
  }
  return { byKey, unresolvable };
}

async function readEvidence(db, ctx, now, { withActors = true } = {}) {
  const accounts = await readAccounts(db);
  const find = (collection, filter = {}, projection) => guard(collection, () => db.collection(collection).find(filter, projection ? { projection } : {}).toArray());
  const [edges, ownerCredentials, connections, proxyTokens, dispatchTokens, sessionRows, shareLinks] = await Promise.all([
    find('account-workspaces', {}, { _id: 0, accountId: 1, workspaceId: 1, role: 1 }),
    find('owner-credentials', {}, { _id: 1, urlKey: 1, accountId: 1, connectionId: 1 }),
    find('connections', {}, { _id: 1, accountId: 1, referents: 1 }),
    find('proxy-tokens', {}, { _id: 0, urlKey: 1, createdBy: 1, createdAt: 1, workspaceId: 1 }),
    find('dispatch-tokens', {}, { _id: 0, urlKey: 1, createdBy: 1, createdAt: 1 }),
    find('sessions', {}, { _id: 0, expires: 1, 'session.workspaces': 1, 'session.accountId': 1 }),
    find('task_share_links', {}, { _id: 0, urlKey: 1, workspaceId: 1 })
  ]);
  const sessions = [];
  for (const row of sessionRows) {
    if (!row.session || typeof row.session !== 'object') continue;
    sessions.push({
      account: typeof row.session.accountId === 'string' ? canonicalOf(row.session.accountId, accounts.mergedInto) : null,
      live: row.expires ? new Date(row.expires).getTime() > now.getTime() : false,
      refs: sessionWorkspaceRefs(row)
    });
  }
  // The rows erasure cannot reach: a string-encoded session cannot be searched, and a session
  // with no account is not found by `session.accountId`. Counted by the engine, not in JS (a projection hides them).
  const unscannableSessions = await guard('sessions', () => db.collection('sessions').countDocuments({ session: { $type: 'string' } }));
  const accountlessSessions = await guard('sessions', () => db.collection('sessions').countDocuments({ session: { $type: 'object' }, 'session.accountId': { $exists: false } }));
  const actors = withActors ? await readActorSightings(db, ctx, accounts) : { byKey: new Map(), unresolvable: new Map() };
  return {
    accounts,
    edges,
    holderRows: { ownerCredentials, connectionReferents: connections, proxyTokens, dispatchTokens },
    sessions,
    shareLinks,
    actors,
    unscannableSessions,
    accountlessSessions,
    ownerlessTokens: proxyTokens.filter((t) => !t.createdBy).length + dispatchTokens.filter((t) => !t.createdBy).length
  };
}

const inGroup = (ctx, accountId, mergedInto) => {
  if (!accountId) return false;
  if (ctx.groupIds.includes(accountId)) return true;
  const canon = canonicalOf(accountId, mergedInto);
  return !!canon && ctx.groupIds.includes(canon);
};

/**
 * Pure. Every reason urlKey `urlKey` (linked to workspace ids `linked`) is
 * shared with someone outside the group, as source names only. Any ONE reason
 * makes it Shared: a wrong "shared" is harmless, a wrong "alone" deletes
 * someone else's history. This is deliberately NOT the pair-proof half: the
 * proofs (sessions among them) are computed once, in the verified plan, and
 * carried into apply (R1 of the plan review).
 */
function foreignReasons(evidence, ctx, urlKey, linked) {
  const reasons = [];
  const { mergedInto } = evidence.accounts;
  if (evidence.edges.some((e) => linked.has(e.workspaceId) && !inGroup(ctx, e.accountId, mergedInto))) reasons.push('edge');
  const canon = (id) => canonicalOf(id, mergedInto);
  const { holdersByKey, unresolvableHolders } = holdersFromRows(evidence.holderRows, canon, urlKey);
  if ((holdersByKey.get(urlKey) || []).some((h) => !ctx.groupIds.includes(h.accountId))) reasons.push('holder');
  // Same direction as an actor value: a holder we cannot resolve is a possible second person.
  if (unresolvableHolders > 0) reasons.push('unresolvable holder');
  if (evidence.sessions.some((s) => s.account && !ctx.groupIds.includes(s.account) && s.refs.some((r) => r.urlKey === urlKey))) reasons.push('session');
  for (const label of evidence.actors.byKey.get(urlKey) || []) reasons.push(`actor ${label}`);
  if ((evidence.actors.unresolvable.get(urlKey) || 0) > 0) reasons.push('unresolvable actor');
  return reasons;
}

function proveKeyPairs(evidence, ctx, now, mapPairs) {
  const pairs = new Map(); // workspaceId -> Set<urlKey>
  const add = (workspaceId, urlKey) => {
    if (typeof workspaceId !== 'string' || typeof urlKey !== 'string' || !workspaceId || !urlKey) return;
    if (!pairs.has(workspaceId)) pairs.set(workspaceId, new Set());
    pairs.get(workspaceId).add(urlKey);
  };
  const { mergedInto } = evidence.accounts;
  const { holdersByKey } = holdersFromRows(evidence.holderRows, (id) => canonicalOf(id, mergedInto));
  for (const [urlKey, holders] of holdersByKey) for (const h of holders) for (const ws of h.linkedWorkspaceIds) add(ws, urlKey);
  for (const link of evidence.shareLinks) add(link.workspaceId, link.urlKey);
  for (const s of evidence.sessions) if (s.live) for (const ref of s.refs) if (ref.urlKey) add(ref.id, ref.urlKey);
  for (const pair of mapPairs) {
    const proven = pairs.get(pair.workspaceId);
    if (proven && proven.size > 0 && !proven.has(pair.urlKey)) {
      throw new ErasureError('MAP_CONFLICTS_WITH_PROOF', { detail: `--map ${pair.workspaceId} disagrees with a proven pair` });
    }
    add(pair.workspaceId, pair.urlKey);
  }
  return pairs;
}

function classifyWorkspaces({ evidence, ctx, now, mapPairs }) {
  const { mergedInto } = evidence.accounts;
  const pairs = proveKeyPairs(evidence, ctx, now, mapPairs);
  const owned = [...new Set(evidence.edges
    .filter((e) => e.role === 'owner' && inGroup(ctx, e.accountId, mergedInto))
    .map((e) => e.workspaceId))].sort();
  const linkedTo = (urlKey) => new Set([...pairs].filter(([, keys]) => keys.has(urlKey)).map(([ws]) => ws));
  const workspaces = [];
  for (const workspaceId of owned) {
    const keys = [...(pairs.get(workspaceId) || [])].sort();
    if (keys.length === 0) { workspaces.push({ workspaceId, urlKey: null, status: 'unmapped', reasons: ['no proof of the urlKey'] }); continue; }
    if (keys.length > 1) { workspaces.push({ workspaceId, urlKey: null, status: 'unmapped', reasons: ['conflicting proofs of the urlKey'] }); continue; }
    const [urlKey] = keys;
    if (urlKey.includes(':')) { workspaces.push({ workspaceId, urlKey, status: 'unmapped', reasons: ['urlKey contains ":"'] }); continue; }
    const linked = linkedTo(urlKey);
    const reasons = foreignReasons(evidence, ctx, urlKey, linked);
    workspaces.push({ workspaceId, urlKey, status: reasons.length ? 'shared' : 'alone', reasons, linked: [...linked].sort() });
  }
  const alone = new Map();
  for (const w of workspaces) {
    if (w.status !== 'alone') continue;
    if (!alone.has(w.urlKey)) alone.set(w.urlKey, { urlKey: w.urlKey, workspaceIds: w.linked, pairs: w.linked.map((ws) => `${ws}=${w.urlKey}`) });
  }
  return { workspaces, alone: [...alone.values()].sort((a, b) => byString(a.urlKey, b.urlKey)), pairs };
}

// ---------------------------------------------------------------------------
// Cancelling queued runs
// ---------------------------------------------------------------------------

/**
 * The untaken `dispatch-queue` rows to cancel: (i) dispatched by the group, (ii)
 * wake rows that continue a group-dispatched run. R = `_id`s of queue and
 * history rows dispatched by the group; a wake continuing a teammate's
 * orchestrator is untouched. Wake rows are the one producer that stamps no
 * `dispatchedBy` (lib/dispatch-wake.js buildWakeFollowUp) and a runner's take is
 * scoped to the urlKey, not the account, so an untaken wake would stay takeable
 * by a teammate's runner after erasure.
 */
async function computeCancelSet(db, groupIds, carriedR) {
  const queue = db.collection('dispatch-queue');
  const direct = await guard('dispatch-queue', () => queue.find({ dispatchedBy: { $in: groupIds } }, { projection: { _id: 1, urlKey: 1, dispatchedBy: 1 } }).toArray());
  let R = carriedR;
  if (!R) {
    const history = await guard('dispatch-history', () => db.collection('dispatch-history').find({ dispatchedBy: { $in: groupIds } }, { projection: { _id: 1 } }).toArray());
    R = [...new Set([...direct.map((d) => d._id), ...history.map((h) => h._id)])].sort();
  }
  const wakes = R.length
    ? await guard('dispatch-queue', () => queue.find({ kind: 'wake', followUpTo: { $in: R } }, { projection: { _id: 1, urlKey: 1, dispatchedBy: 1, 'grantDeclaration.ownerAccountId': 1, 'trimHistory.by': 1 } }).toArray())
    : [];
  const seen = new Map();
  // `named`: the archived history row will carry a group account id (so Full anonymises it).
  const named = (row) => DISPATCH_ACCOUNT_FIELDS.some((f) => valuesAt(row, f.path).some((v) => groupIds.includes(v)));
  for (const row of [...direct, ...wakes]) seen.set(row._id, { _id: row._id, urlKey: row.urlKey, named: named(row) });
  return { R, rows: [...seen.values()].sort((a, b) => byString(a._id, b._id)) };
}

/**
 * Cancel per item through the store (archives to `dispatch-history` as
 * `cancelled`, LIN-3486). Not `deleteMany`, not a hand-copied history insert.
 * `removeItem` swallows its errors and `_archiveItem` swallows insert failures,
 * so each call is verified: the queue row is gone AND a history row with that
 * `_id` exists as `cancelled` (or `taken`: LIN-3622 makes a runner's take
 * atomic, so a cancel that loses that race archives nothing twice).
 */
async function cancelRows(db, rows, step) {
  if (rows.length === 0) return 0;
  const store = new DispatchQueueStore({
    collection: db.collection('dispatch-queue'),
    historyCollection: db.collection('dispatch-history')
  });
  let cancelled = 0;
  for (const row of rows) {
    if (!row.urlKey) continue;
    await store.removeItem(row.urlKey, row._id);
    const still = await guard('dispatch-queue', () => db.collection('dispatch-queue').findOne({ _id: row._id, urlKey: row.urlKey }));
    const archived = await guard('dispatch-history', () => db.collection('dispatch-history').findOne({ _id: row._id }));
    if (still || !archived || !['cancelled', 'taken'].includes(archived.status)) {
      throw new ErasureError('CANCEL_NOT_VERIFIED', { step, collection: 'dispatch-queue' });
    }
    cancelled++;
  }
  return cancelled;
}

/**
 * Group-dispatched runs that may still be running: `taken` history rows with no
 * bookkeeping and no terminal marker of their own, the filter the bulk closers
 * use (a finished run keeps `status: 'taken'`, so status alone would count the
 * person's whole history). An aborted target stays matching because the
 * `[aborted]` marker lands on the abort row, never the target
 * (harvestAbortedTargets); those are subtracted. Advisory: a worker that died
 * without a marker stays in the count and the runbook says to judge it by age.
 */
async function countInFlight(db, groupIds) {
  const filter = { dispatchedBy: { $in: groupIds }, status: 'taken', bookkeeping: null, ...noOwnTerminalMarkerFilter() };
  const rows = await guard('dispatch-history', () => db.collection('dispatch-history').find(filter, { projection: { _id: 1 } }).toArray());
  const ids = rows.map((r) => r._id);
  if (ids.length === 0) return 0;
  const abortFilter = { abort: true, abortTo: { $in: ids } };
  const aborts = [
    ...(await guard('dispatch-history', () => db.collection('dispatch-history').find(abortFilter).toArray())),
    ...(await guard('dispatch-queue', () => db.collection('dispatch-queue').find(abortFilter).toArray()))
  ];
  const harvested = harvestAbortedTargets(aborts);
  return ids.filter((id) => !harvested.has(id)).length;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

async function sampleAccounts(db, row, filter, ctx) {
  const first = row.find?.find((s) => s.by === 'field');
  if (first && row.kind === 'group') {
    const values = await guard(row.collection, () => db.collection(row.collection).distinct(first.field, filter));
    return values.filter((v) => ctx.groupIds.includes(v)).slice(0, MAX_SAMPLE_IDS).map(short);
  }
  if (row.kind === 'group') {
    const docs = await guard(row.collection, () => db.collection(row.collection).find(filter, { projection: { _id: 1 } }).toArray());
    const ids = new Set();
    for (const d of docs) {
      const id = ctx.groupIds.find((g) => String(d._id) === g || String(d._id).startsWith(`${g}::`));
      if (id) ids.add(short(id));
      if (ids.size >= MAX_SAMPLE_IDS) break;
    }
    return [...ids];
  }
  return [];
}

/**
 * The fields step 2c rewrites on a history row. A QUEUE row's `dispatchedBy` is
 * left alone on purpose: a row dispatched by the group that is still queued is
 * something to cancel (step 2a, and the gate for one minted later), never to
 * relabel and leave takeable by a teammate's runner.
 */
const anonymisableFields = (row) => (row.collection === 'dispatch-queue'
  ? row.accountFields.filter((f) => f.path !== 'dispatchedBy')
  : row.accountFields);

/**
 * Read-only. Resolves the root, builds the group, classifies workspaces, counts
 * every INVENTORY row and returns the plan (`planId` over level, group, counts,
 * classification, proven pairs of every Alone workspace, `--map` pairs, target;
 * no timestamps). The plan carries what apply needs by value: group order, the
 * run ids R, the Alone workspaces and their proven pairs.
 *
 * @param {Object} options
 * @param {Object} options.db
 * @param {'standard'|'full'} options.level
 * @param {{email?: string, accountId?: string}} options.root
 * @param {(string|{workspaceId: string, urlKey: string})[]} [options.map]
 * @param {string} [options.target] - Mongo host or data dir, in the header and in `planId`
 * @param {Date} [options.now]
 */
export async function planErasure({ db, level, root, map = [], target = '', now = new Date() } = {}) {
  if (level !== 'standard' && level !== 'full') throw new ErasureError('LEVEL_INVALID', { detail: 'standard or full' });
  const mapPairs = map.map(parseMapPair);
  const { canonicalId, groupIds, emailNorms } = await resolveRoot(db, root);
  const ctx = { groupIds, emailNorms };

  const evidence = await readEvidence(db, ctx, now);
  const classification = classifyWorkspaces({ evidence, ctx, now, mapPairs });
  const aloneKeys = level === 'full' ? classification.alone.map((a) => a.urlKey) : [];

  const cancel = await computeCancelSet(db, groupIds);
  const rows = [];
  for (const row of INVENTORY) {
    const entry = { collection: row.collection, kind: row.kind, standard: row.standard, full: row.full, remove: 0, anonymise: 0, kept: 0, accounts: [], reason: row.reason || null };
    if (row.kind === 'leave') {
      entry.kept = await guard(row.collection, () => db.collection(row.collection).countDocuments({}));
    } else if (row.kind === 'group') {
      const filter = groupFilter(row, ctx);
      const found = filter ? await guard(row.collection, () => db.collection(row.collection).countDocuments(filter)) : 0;
      const action = level === 'full' ? row.full : row.standard;
      if (action === 'delete') entry.remove = found; else entry.kept = found;
      if (found) entry.accounts = await sampleAccounts(db, row, filter, ctx);
    } else {
      const aloneFilter = scopeFilter(row, aloneKeys);
      if (level === 'full') {
        const count = (filter) => guard(row.collection, () => db.collection(row.collection).countDocuments(filter));
        if (aloneFilter) entry.remove = await count(aloneFilter);
        if (row.kind === 'history') {
          const fields = anonymisableFields(row);
          // Rows naming the group, minus those an Alone workspace deletes first.
          const named = { $or: fields.map((f) => ({ [f.path]: { $in: groupIds } })) };
          const all = await count(named);
          const gone = aloneFilter ? await count({ $and: [named, aloneFilter] }) : 0;
          entry.anonymise = all - gone;
          // Step 2a moves the cancelled queue rows into history before 2b and 2c run, so the counts follow them.
          const aloneSet = new Set(aloneKeys);
          const inAlone = cancel.rows.filter((r) => aloneSet.has(r.urlKey));
          if (row.collection === 'dispatch-queue') {
            entry.remove -= inAlone.length;
            // A cancelled row has left the queue: it is no longer there to anonymise.
            const cancelled = new Set(cancel.rows.map((r) => r._id));
            const stillQueued = await guard(row.collection, () => db.collection(row.collection).find(named, { projection: { _id: 1, urlKey: 1 } }).toArray());
            entry.anonymise = stillQueued.filter((d) => !cancelled.has(d._id) && !aloneSet.has(d.urlKey)).length;
          } else if (row.collection === 'dispatch-history') {
            entry.remove += inAlone.length;
            entry.anonymise += cancel.rows.filter((r) => !aloneSet.has(r.urlKey) && r.named).length;
          }
        }
      }
    }
    rows.push(entry);
  }

  // Collections in the database that INVENTORY does not name: reported, never fatal.
  const listed = await guard('(database)', () => db.listCollections().toArray());
  const unlisted = listed.map((c) => c.name).filter((n) => !n.startsWith('system.') && !INVENTORY_BY_NAME.has(n)).sort();

  const unmapped = classification.workspaces.filter((w) => w.status === 'unmapped');
  const flags = {
    ownedShared: classification.workspaces.filter((w) => w.status === 'shared').map((w) => hashKey(w.urlKey)),
    aloneUnderStandard: level === 'standard' ? classification.alone.map((a) => hashKey(a.urlKey)) : [],
    local: [],
    unmapped: unmapped.map((w) => ({ workspaceId: w.workspaceId, reason: w.reasons[0] })),
    unreachable: {
      stringEncodedSessions: evidence.unscannableSessions,
      accountlessSessions: evidence.accountlessSessions,
      ownerlessTokens: evidence.ownerlessTokens
    }
  };
  const localRows = INVENTORY_BY_NAME.get('local-issues');
  for (const w of classification.workspaces) {
    if (!w.urlKey || w.status === 'unmapped') continue;
    const filter = scopeFilter(localRows, [w.urlKey]);
    if (await guard('local-issues', () => db.collection('local-issues').countDocuments(filter)) > 0) flags.local.push(hashKey(w.urlKey));
  }

  const inFlight = await countInFlight(db, groupIds);
  const plan = {
    level,
    target,
    canonicalId,
    groupIds,
    emailNorms,
    inputs: { level, root: { ...root }, map: mapPairs, target },
    rows,
    cancel: cancel.rows.length,
    inFlight,
    workspaces: classification.workspaces.map((w) => ({
      workspaceId: w.workspaceId,
      urlKeyHash: w.urlKey ? hashKey(w.urlKey) : null,
      status: w.status,
      reasons: w.reasons
    })),
    alone: classification.alone,
    pairs: classification.workspaces.filter((w) => w.urlKey && w.status !== 'unmapped').map((w) => ({ workspaceId: w.workspaceId, urlKey: w.urlKey, status: w.status })),
    unmapped,
    flags,
    unlisted,
    R: cancel.R
  };
  plan.planId = createHash('sha256').update(stableStringify({
    level,
    group: [...groupIds].sort(),
    // `kept` is display only: it includes TTL and heartbeat collections that move between a dry run and the execute.
    rows: rows.map((r) => [r.collection, r.remove, r.anonymise]),
    cancel: plan.cancel,
    classification: classification.workspaces.map((w) => [w.workspaceId, w.urlKey ? hashKey(w.urlKey) : null, w.status]).sort(),
    alone: classification.alone.map((a) => [hashKey(a.urlKey), [...a.pairs].sort()]).sort(),
    map: mapPairs.map((p) => `${p.workspaceId}=${p.urlKey}`).sort(),
    target
  })).digest('hex').slice(0, 8);
  return plan;
}

// ---------------------------------------------------------------------------
// Recount
// ---------------------------------------------------------------------------

/**
 * Read-only. Counts only rows whose expected remainder is ZERO at this point:
 * every group-found row the level deletes, queue rows dispatched by the group
 * or continuing a group run, and at Full the Alone workspaces' rows and the
 * group's account fields on history. Group ids, R and the Alone set are the
 * ones carried from the verified plan (R cannot be re-derived afterwards: Full
 * removes or anonymises the rows it came from). Kept rows are not counted.
 * `stage: 'gate'` leaves `accounts` out; `'final'` includes it.
 *
 * @returns {Promise<{total: number, counts: Object<string, number>}>}
 */
export async function recountErasure({ db, plan, stage = 'final' }) {
  const ctx = { groupIds: plan.groupIds, emailNorms: plan.emailNorms };
  const counts = {};
  const count = async (collection, filter) => {
    if (!filter) return;
    const n = await guard(collection, () => db.collection(collection).countDocuments(filter));
    if (n > 0) counts[collection] = (counts[collection] || 0) + n;
  };
  for (const row of INVENTORY) {
    if (row.kind !== 'group') continue;
    if (row.collection === 'accounts' && stage !== 'final') continue;
    if ((plan.level === 'full' ? row.full : row.standard) !== 'delete') continue;
    await count(row.collection, groupFilter(row, ctx));
  }
  const queueOrs = [{ dispatchedBy: { $in: plan.groupIds } }];
  if (plan.R.length) queueOrs.push({ kind: 'wake', followUpTo: { $in: plan.R } });
  await count('dispatch-queue', { $or: queueOrs });
  if (plan.level === 'full') {
    const aloneKeys = plan.alone.map((a) => a.urlKey);
    for (const row of INVENTORY) {
      if (row.kind === 'history' || row.kind === 'workspace') {
        if (aloneKeys.length) await count(row.collection, scopeFilter(row, aloneKeys));
      }
      if (row.kind === 'history') {
        await count(row.collection, { $or: row.find.map((s) => ({ [s.field]: { $in: plan.groupIds } })) });
      }
    }
  }
  return { total: Object.values(counts).reduce((a, b) => a + b, 0), counts };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export function resumeForm(plan) {
  const maps = plan.inputs.map.map((p) => ` --map ${p.workspaceId}=${p.urlKey}`).join('');
  return `--account-id ${plan.canonicalId} --level ${plan.level}${maps}`;
}

/**
 * Apply a plan. Recomputes it with the same inputs and refuses on a `planId`
 * mismatch BEFORE the first write; refuses a Full wipe while any owned
 * workspace is `unmapped`. Order, so a re-run is safe:
 *
 *   1  sessions
 *   2a cancel untaken queue rows dispatched by the group (and wakes continuing them)
 *   2b per Alone workspace (Full): re-read FOREIGN evidence only, then delete its data
 *   2c Shared anonymisation (Full)
 *   3  every other group-found row, then the edges
 *      settle wait, then the pre-accounts gate (stops before step 4 if anything new turned up)
 *   4  accounts: aliases deepest-first, the canonical account LAST
 *   5  final recount (the receipt carries it; a second dry run is not the check)
 *
 * Evidence stays intact until it is used: cancelled rows land in history with
 * `dispatchedBy` untouched, and step 2b never re-derives a pair proof (step 1
 * has deleted the group's sessions, which can be the only proof). An error
 * stops the run and names the step plus the resume form.
 *
 * @param {Object} options
 * @param {Object} options.db
 * @param {Object} options.plan - from planErasure
 * @param {function(string, Object=): (Promise<void>|void)} [options.onStep] - called after each step; tests use it to insert a row between steps
 * @param {number} [options.settleMs] - defaults to IN_FLIGHT_SETTLE_MS
 * @param {Date} [options.now]
 */
export async function applyErasure({ db, plan, onStep, settleMs = IN_FLIGHT_SETTLE_MS, now = new Date() } = {}) {
  const fresh = await planErasure({ db, ...plan.inputs, now });
  if (fresh.planId !== plan.planId) throw new ErasureError('PLAN_MISMATCH', { detail: `confirmed ${plan.planId}, recomputed ${fresh.planId}` });
  if (plan.level === 'full' && plan.unmapped.length > 0) {
    throw new ErasureError('UNMAPPED_WORKSPACES', { detail: `${plan.unmapped.length} owned workspace(s) have no proven urlKey; pass --map <workspaceId>=<urlKey>` });
  }

  const ctx = { groupIds: plan.groupIds, emailNorms: plan.emailNorms };
  const receipt = { level: plan.level, planId: plan.planId, canonicalId: plan.canonicalId, accounts: plan.groupIds.map(short), removed: {}, anonymised: {}, cancelled: 0 };
  const bump = (bucket, collection, n) => { if (n) receipt[bucket][collection] = (receipt[bucket][collection] || 0) + n; };
  const done = async (name, detail) => { if (onStep) await onStep(name, detail); };
  let step = 'start';
  const deleteMany = async (collection, filter) => {
    if (!filter) return;
    const result = await guard(collection, () => db.collection(collection).deleteMany(filter));
    bump('removed', collection, result.deletedCount);
  };

  try {
    // 1: sessions
    step = 'sessions';
    await deleteMany('sessions', groupFilter(INVENTORY_BY_NAME.get('sessions'), ctx));
    await done('sessions');

    // 2a: cancel
    step = 'cancel';
    const cancel = await computeCancelSet(db, plan.groupIds, plan.R);
    receipt.cancelled += await cancelRows(db, cancel.rows, step);
    await done('cancel');

    // 2b: Alone workspaces (Full)
    step = 'workspace-data';
    if (plan.level === 'full') {
      for (const alone of plan.alone) {
        const evidence = await readEvidence(db, ctx, now);
        const reasons = foreignReasons(evidence, ctx, alone.urlKey, new Set(alone.workspaceIds));
        if (reasons.length) throw new ErasureError('FOREIGN_SIGHTING_APPEARED', { step, urlKeyHash: hashKey(alone.urlKey), detail: reasons.map((r) => r.split(' ')[0]).join(',') });
        for (const row of INVENTORY) {
          if (row.kind === 'history' || row.kind === 'workspace') await deleteMany(row.collection, scopeFilter(row, [alone.urlKey]));
        }
      }
    }
    await done('workspace-data');

    // 2c: Shared anonymisation (Full). Not scoped to a urlKey.
    step = 'anonymise';
    if (plan.level === 'full') {
      for (const row of INVENTORY) {
        if (row.kind !== 'history') continue;
        // Counted per document, once, before any field is rewritten (a row can name the group in several fields).
        const fields = anonymisableFields(row);
        const named = await guard(row.collection, () => db.collection(row.collection).countDocuments({ $or: fields.map((f) => ({ [f.path]: { $in: plan.groupIds } })) }));
        for (const f of fields) {
          const [head, ...rest] = f.path.split('.');
          const tail = rest.join('.');
          const filter = { [f.path]: { $in: plan.groupIds } };
          if (f.kind === 'array') {
            await guard(row.collection, () => db.collection(row.collection).updateMany(filter, { $set: { [`${head}.$[e].${tail}`]: ERASED_ACCOUNT_ID } }, { arrayFilters: [{ [`e.${tail}`]: { $in: plan.groupIds } }] }));
          } else {
            await guard(row.collection, () => db.collection(row.collection).updateMany(filter, { $set: { [f.path]: ERASED_ACCOUNT_ID } }));
          }
        }
        bump('anonymised', row.collection, named);
      }
    }
    await done('anonymise');

    // 3: every other group-found row, then the edges
    step = 'group-rows';
    const later = new Set(['accounts', 'sessions', 'account-workspaces']);
    for (const row of INVENTORY) {
      if (row.kind !== 'group' || later.has(row.collection)) continue;
      if ((plan.level === 'full' ? row.full : row.standard) === 'delete') await deleteMany(row.collection, groupFilter(row, ctx));
    }
    await deleteMany('account-workspaces', groupFilter(INVENTORY_BY_NAME.get('account-workspaces'), ctx));
    await done('group-rows');

    // Settle wait, once: covers requests that passed validation before step 3 and write after it.
    step = 'settle';
    if (settleMs > 0) await sleep(settleMs);
    await done('settle');

    // Pre-accounts gate: rows a still-live principal wrote after their delete step.
    step = 'gate';
    const gate = await recountErasure({ db, plan, stage: 'gate' });
    const lateQueue = await computeCancelSet(db, plan.groupIds, plan.R);
    if (lateQueue.rows.length) receipt.cancelled += await cancelRows(db, lateQueue.rows, step);
    await done('gate');
    if (gate.total > 0) {
      throw new ErasureError('NEW_ROWS_BEFORE_ACCOUNT_DELETE', { step, counts: gate.counts, resume: resumeForm(plan) });
    }

    // 4: accounts. Aliases deepest-first (reverse of listMergedAccounts' BFS order) so every alias still
    // present stays reachable downward from the canonical account at every crash point, then the canonical LAST.
    step = 'accounts';
    for (const id of [...plan.groupIds].reverse()) {
      const result = await guard('accounts', () => db.collection('accounts').deleteOne({ _id: id }));
      bump('removed', 'accounts', result.deletedCount);
      await done('account-deleted', { id: short(id) });
    }
  } catch (err) {
    const wrapped = err instanceof ErasureError ? err : new ErasureError('APPLY_FAILED', { driver: { name: err?.name, code: err?.code } });
    wrapped.step = wrapped.step || step;
    if (!wrapped.resume) {
      wrapped.resume = resumeForm(plan);
      wrapped.message = `${wrapped.message}: step ${wrapped.step}: resume with: ${wrapped.resume}`;
    }
    throw wrapped;
  }

  // 5: the closing recount rides in the receipt. Anything left is RESIDUAL: the account is gone, so the tool cannot remove it.
  const final = await recountErasure({ db, plan, stage: 'final' });
  receipt.after = final;
  receipt.residual = final.total > 0;
  return receipt;
}

// ---------------------------------------------------------------------------
// Identity: --find-label
// ---------------------------------------------------------------------------

/**
 * Verify identity for a person with no email identity: they mint a proxy token
 * labelled with a phrase the operator gave them by another channel. Read-only,
 * projection `{createdBy, createdAt}`, rows younger than 24 hours; refuses on
 * zero or several. Returns the account id (the one exception to 8-char ids,
 * besides the resume id) for `--account-id`.
 */
export async function findByLabel({ db, phrase, now = new Date() } = {}) {
  if (typeof phrase !== 'string' || phrase.trim() === '') throw new ErasureError('LABEL_REQUIRED');
  const since = new Date(now.getTime() - FIND_LABEL_WINDOW_MS);
  const rows = await guard('proxy-tokens', () => db.collection('proxy-tokens')
    .find({ label: phrase, createdAt: { $gte: since } }, { projection: { _id: 0, createdBy: 1, createdAt: 1 } }).toArray());
  if (rows.length === 0) throw new ErasureError('LABEL_NOT_FOUND', { collection: 'proxy-tokens', detail: 'no token with that label in the last 24 hours' });
  if (rows.length > 1) throw new ErasureError('LABEL_AMBIGUOUS', { collection: 'proxy-tokens', detail: `${rows.length} tokens carry that label` });
  const accountId = rows[0].createdBy;
  if (typeof accountId !== 'string' || !accountId) throw new ErasureError('LABEL_NO_ACCOUNT', { collection: 'proxy-tokens' });
  return { accountId };
}

// ---------------------------------------------------------------------------
// Output. No row content; account ids are cut to 8 characters, except the
// canonical id (once in the header, the receipt and the stop error, because the
// resume form needs it).
// ---------------------------------------------------------------------------

export function renderPlan(plan, { execute = false } = {}) {
  const lines = [];
  lines.push(`ACCOUNT ERASURE (LIN-3423) ${execute ? 'APPLY' : 'DRY RUN: nothing is changed'}`);
  lines.push(`target:     ${plan.target || '(unset)'}`);
  lines.push(`level:      ${plan.level}`);
  lines.push(`planId:     ${plan.planId}`);
  lines.push(`canonical:  ${plan.canonicalId}`);
  lines.push(`accounts:   ${plan.groupIds.map(short).join(' ')} (${plan.groupIds.length})`);
  lines.push('');
  lines.push('collection                      remove  anonymise  kept  accounts');
  for (const r of plan.rows) {
    const note = r.kind === 'leave' ? `left: ${r.reason}` : r.accounts.join(' ');
    lines.push(`${r.collection.padEnd(30)}  ${String(r.remove).padStart(6)}  ${String(r.anonymise).padStart(9)}  ${String(r.kept).padStart(4)}  ${note}`.trimEnd());
  }
  lines.push(`queued runs cancelled to history: ${plan.cancel}`);
  lines.push(`in-flight group runs (taken, no terminal marker): ${plan.inFlight}`);
  lines.push('');
  lines.push('owned workspaces:');
  if (plan.workspaces.length === 0) lines.push('  none');
  for (const w of plan.workspaces) lines.push(`  ${w.workspaceId}  ${w.urlKeyHash || '(no urlKey)'}  ${w.status}${w.reasons.length ? `  ${w.reasons.join('; ')}` : ''}`);
  lines.push('proven workspaceId=urlKey pairs (keep this block: a gate stop at Full needs it):');
  if (plan.pairs.length === 0) lines.push('  none');
  for (const p of plan.pairs) lines.push(`  ${p.workspaceId}=${p.urlKey}  ${p.status}`);
  lines.push('');
  const f = plan.flags;
  if (f.ownedShared.length) lines.push(`FLAG owned and shared, becomes ownerless (recovery: lib/owner-backfill.js): ${f.ownedShared.join(' ')}`);
  if (f.aloneUnderStandard.length) lines.push(`FLAG owned alone under Standard: its history stays visible to whoever next connects it; offer Full wipe: ${f.aloneUnderStandard.join(' ')}`);
  if (f.local.length) lines.push(`FLAG local, local-issues is the only copy: ${f.local.join(' ')}`);
  for (const u of f.unmapped) lines.push(`FLAG unmapped, left in place: ${u.workspaceId} (${u.reason}); a Full wipe execute refuses until --map ${u.workspaceId}=<urlKey>`);
  lines.push(`FLAG unreachable rows: string-encoded sessions ${f.unreachable.stringEncodedSessions}, sessions without an account ${f.unreachable.accountlessSessions}, tokens with no createdBy ${f.unreachable.ownerlessTokens}`);
  if (plan.unlisted.length) lines.push(`collections in the database that INVENTORY does not name: ${plan.unlisted.join(', ')}`);
  return lines.join('\n');
}

export function renderReceipt(receipt) {
  const lines = [];
  lines.push('ERASURE RECEIPT (LIN-3423)');
  lines.push(`level:     ${receipt.level}`);
  lines.push(`planId:    ${receipt.planId}`);
  lines.push(`canonical: ${receipt.canonicalId}`);
  lines.push(`accounts:  ${receipt.accounts.join(' ')}`);
  lines.push(`cancelled queued runs: ${receipt.cancelled}`);
  for (const [c, n] of Object.entries(receipt.removed)) lines.push(`removed    ${c}: ${n}`);
  for (const [c, n] of Object.entries(receipt.anonymised)) lines.push(`anonymised ${c}: ${n}`);
  lines.push(`after (final recount): ${receipt.after.total}`);
  for (const [c, n] of Object.entries(receipt.after.counts)) {
    lines.push(`RESIDUAL ${c}: ${n}`);
  }
  if (receipt.residual) lines.push('RESIDUAL rows remain that this tool cannot remove, because the account they key on is gone. The runbook\'s Known limits section has the manual step; a second run of this tool would refuse.');
  return lines.join('\n');
}
