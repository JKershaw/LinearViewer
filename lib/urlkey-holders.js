/**
 * Who holds a `urlKey` (LIN-3381, slice S1.1 of LIN-2954).
 *
 * One definition, used by the read-only duplicate dry-run
 * (scripts/dry-run-urlkey-duplicates.mjs) and, later, the bind arms (LIN-3382).
 *
 * A HOLDER is a canonical account that a durable store pairs with the key:
 *
 *   - `owner-credentials`  records carrying a `urlKey` (3-part and legacy
 *                          2-part ids). The connection-keyed shape carries no
 *                          key on purpose (LIN-3278); its holder is found
 *                          through the connection's referent, below.
 *   - `connections`        the owning account of a connection with a
 *                          `referents[].urlKey` entry. A connection-keyed
 *                          `owner-credentials` record whose connection has that
 *                          referent counts as credential evidence.
 *   - `proxy-tokens`       `createdBy`.
 *   - `dispatch-tokens`    `createdBy`. Never expire, no cleanup, and the live
 *                          bearer for poll/take, so they are holders.
 *
 * Actor stores (dispatchedBy, saved chats, ...) are NOT holders; they are
 * labelled evidence in the script only.
 *
 * `owner-credentials` is unindexed: a per-key read is a collection scan.
 *
 * The connections read is injected (`readReferents`, built in
 * lib/connection-credential.js). This module opens no collection and imports
 * no connection store.
 */

/**
 * Pure: turn projected rows into holders. Defines holder, source and evidence
 * once.
 *
 * @param {Object} rows
 * @param {Object[]} [rows.ownerCredentials] - `OwnerCredentialStore#listUrlKeyRecords` (incl. connection-keyed)
 * @param {Object[]} [rows.connectionReferents] - `{_id, accountId, referents}` rows
 * @param {Object[]} [rows.proxyTokens] - `{urlKey, createdBy, createdAt, workspaceId}`
 * @param {Object[]} [rows.dispatchTokens] - `{urlKey, createdBy, createdAt}`
 * @param {function(string): (string|null)} canonicalise - account id to canonical id; null if unresolvable
 * @param {string} [onlyUrlKey] - restrict to one key
 * @returns {{holdersByKey: Map<string, Object[]>, ownerlessTokens: number, unresolvableHolders: number}}
 *   each holder: `{accountId, sources[], ownerCredential, earliestTokenAt:{proxy,dispatch}, linkedWorkspaceIds[]}`
 */
export function holdersFromRows(rows = {}, canonicalise, onlyUrlKey) {
  const byKey = new Map();
  let ownerlessTokens = 0;
  let unresolvableHolders = 0;

  const touch = (urlKey, rawAccountId, source) => {
    if (typeof urlKey !== 'string' || !urlKey) return null;
    if (onlyUrlKey && urlKey !== onlyUrlKey) return null;
    if (!rawAccountId) return null;
    const accountId = canonicalise(rawAccountId);
    if (accountId === null || accountId === undefined) {
      unresolvableHolders++;
      return null;
    }
    if (!byKey.has(urlKey)) byKey.set(urlKey, new Map());
    const holders = byKey.get(urlKey);
    if (!holders.has(accountId)) {
      holders.set(accountId, {
        accountId,
        sources: [],
        ownerCredential: false,
        earliestTokenAt: { proxy: null, dispatch: null },
        linkedWorkspaceIds: []
      });
    }
    const holder = holders.get(accountId);
    if (!holder.sources.includes(source)) holder.sources.push(source);
    return holder;
  };
  const earlier = (current, candidate) => {
    if (!candidate) return current;
    const t = new Date(candidate).toISOString();
    return current === null || t < current ? t : current;
  };

  for (const row of rows.ownerCredentials || []) {
    if (typeof row?.urlKey === 'string') {
      const holder = touch(row.urlKey, row.accountId, 'owner-credentials');
      if (holder) holder.ownerCredential = true;
    }
  }

  const connectionsById = new Map();
  for (const conn of rows.connectionReferents || []) connectionsById.set(conn._id, conn);
  for (const conn of rows.connectionReferents || []) {
    for (const referent of Array.isArray(conn.referents) ? conn.referents : []) {
      const holder = touch(referent?.urlKey, conn.accountId, 'connections');
      if (!holder) continue;
      // A Linear referent's scope is the org id, which is also the workspace id.
      if (referent.provider === 'linear' && typeof referent.scope === 'string'
        && !holder.linkedWorkspaceIds.includes(referent.scope)) {
        holder.linkedWorkspaceIds.push(referent.scope);
      }
    }
  }
  // A connection-keyed credential record carries no urlKey: it is evidence for
  // each key its connection references.
  for (const row of rows.ownerCredentials || []) {
    if (typeof row?.urlKey === 'string' || !row?.connectionId) continue;
    const conn = connectionsById.get(row.connectionId);
    if (!conn) continue;
    for (const referent of Array.isArray(conn.referents) ? conn.referents : []) {
      const holder = touch(referent?.urlKey, conn.accountId, 'connections');
      if (holder) holder.ownerCredential = true;
    }
  }

  for (const row of rows.proxyTokens || []) {
    if (!row?.createdBy) { ownerlessTokens++; continue; }
    const holder = touch(row.urlKey, row.createdBy, 'proxy-tokens');
    if (!holder) continue;
    holder.earliestTokenAt.proxy = earlier(holder.earliestTokenAt.proxy, row.createdAt);
    if (row.workspaceId && !holder.linkedWorkspaceIds.includes(row.workspaceId)) {
      holder.linkedWorkspaceIds.push(row.workspaceId);
    }
  }
  for (const row of rows.dispatchTokens || []) {
    if (!row?.createdBy) { ownerlessTokens++; continue; }
    const holder = touch(row.urlKey, row.createdBy, 'dispatch-tokens');
    if (holder) holder.earliestTokenAt.dispatch = earlier(holder.earliestTokenAt.dispatch, row.createdAt);
  }

  const holdersByKey = new Map();
  for (const [urlKey, holders] of byKey) {
    holdersByKey.set(urlKey, [...holders.values()].sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0)));
  }
  return { holdersByKey, ownerlessTokens, unresolvableHolders };
}

/**
 * Pure (LIN-3382): the same rows as {@link holdersFromRows}, kept per row
 * instead of folded per account, so the bind-time resolver can ask what a key
 * is TIED TO (`provider`, `scope`) and which workspace id a record names.
 *
 *   - referent               `{provider, scope}`; a Linear referent's scope is
 *                            the org id, which is also the workspace id.
 *   - key-bearing credential `provider` (always, 3-part) and `scope` (absent on
 *                            legacy Jira rows); a legacy 2-part row has neither.
 *   - proxy token            `workspaceId` on runner lineage only.
 *   - dispatch token         nothing.
 * A field a row does not carry is `null` ("neutral"): it ties the key to nothing.
 *
 * @param {Object} rows - same shape as holdersFromRows
 * @param {function(string): (string|null)} canonicalise
 * @param {string[]} [onlyUrlKeys] - restrict to these keys
 * @returns {Array<{urlKey: string, accountId: string, source: string, provider: (string|null), scope: (string|null), workspaceId: (string|null)}>}
 */
export function evidenceFromRows(rows = {}, canonicalise, onlyUrlKeys) {
  const wanted = onlyUrlKeys ? new Set(onlyUrlKeys) : null;
  const out = [];
  const push = (urlKey, rawAccountId, source, extra = {}) => {
    if (typeof urlKey !== 'string' || !urlKey) return;
    if (wanted && !wanted.has(urlKey)) return;
    if (!rawAccountId) return;
    const accountId = canonicalise(rawAccountId);
    if (accountId === null || accountId === undefined) return;
    out.push({
      urlKey, accountId, source,
      provider: typeof extra.provider === 'string' && extra.provider ? extra.provider : null,
      scope: typeof extra.scope === 'string' && extra.scope ? extra.scope : null,
      workspaceId: typeof extra.workspaceId === 'string' && extra.workspaceId ? extra.workspaceId : null
    });
  };
  for (const row of rows.ownerCredentials || []) {
    if (typeof row?.urlKey === 'string') push(row.urlKey, row.accountId, 'owner-credentials', row);
  }
  for (const conn of rows.connectionReferents || []) {
    for (const referent of Array.isArray(conn.referents) ? conn.referents : []) {
      push(referent?.urlKey, conn.accountId, 'connections', {
        provider: referent?.provider,
        scope: referent?.scope,
        workspaceId: referent?.provider === 'linear' ? referent?.scope : null
      });
    }
  }
  for (const row of rows.proxyTokens || []) push(row?.urlKey, row?.createdBy, 'proxy-tokens', { workspaceId: row?.workspaceId });
  for (const row of rows.dispatchTokens || []) push(row?.urlKey, row?.createdBy, 'dispatch-tokens');
  return out;
}

/**
 * @param {Object} deps
 * @param {function(string=): Promise<Object[]>} deps.readReferents - injected connection referent reader
 * @param {Object} deps.ownerCredentialStore - needs `listUrlKeyRecords`
 * @param {Object} deps.proxyTokenStore - needs `listHolderRows`
 * @param {Object} deps.dispatchTokenStore - needs `listHolderRows`
 * @param {function(string): Promise<(string|null)>} deps.resolveCanonicalAccountId
 * @param {boolean} [deps.strict=false] - bind-time (LIN-3382): the store reads rethrow. `readReferents` must be built strict by the caller.
 * @returns {{findUrlKeyHolders: function(string): Promise<Object[]>, loadAllHolders: function(): Promise<Object>, findEvidence: function(string[]): Promise<Object[]>}}
 */
export function createUrlKeyHolderFinder({
  readReferents, ownerCredentialStore, proxyTokenStore, dispatchTokenStore, resolveCanonicalAccountId, strict = false
} = {}) {
  const strictOption = strict ? { strict: true } : {};
  async function loadRows(urlKey, includeConnectionKeyed = true) {
    const rows = {
      ownerCredentials: await ownerCredentialStore.listUrlKeyRecords({ urlKey, includeConnectionKeyed, ...strictOption }),
      connectionReferents: await readReferents(urlKey),
      proxyTokens: await proxyTokenStore.listHolderRows(urlKey, strictOption),
      dispatchTokens: await dispatchTokenStore.listHolderRows(urlKey, strictOption)
    };
    return rows;
  }
  async function load(urlKey) {
    const rows = await loadRows(urlKey);
    // The connection-keyed records are not filterable by key; with a key, keep
    // only those whose connection was returned for it.
    if (urlKey) {
      const ids = new Set(rows.connectionReferents.map(c => c._id));
      rows.ownerCredentials = rows.ownerCredentials.filter(r => typeof r.urlKey === 'string' || ids.has(r.connectionId));
    }
    const accountIds = new Set();
    for (const r of rows.ownerCredentials) if (typeof r.urlKey === 'string' && r.accountId) accountIds.add(r.accountId);
    for (const c of rows.connectionReferents) if (c.accountId) accountIds.add(c.accountId);
    for (const r of [...rows.proxyTokens, ...rows.dispatchTokens]) if (r.createdBy) accountIds.add(r.createdBy);
    const canonical = new Map();
    for (const id of accountIds) canonical.set(id, await resolveCanonicalAccountId(id));
    return holdersFromRows(rows, id => (canonical.has(id) ? canonical.get(id) : id), urlKey);
  }

  return {
    /** Holders of one key (S1.2's check). @returns {Promise<Object[]>} */
    async findUrlKeyHolders(urlKey) {
      if (!urlKey) return [];
      return (await load(urlKey)).holdersByKey.get(urlKey) || [];
    },
    /** Every key's holders (the dry-run). Includes the ownerless/unresolvable counts. */
    async loadAllHolders() {
      return load(undefined);
    },
    /**
     * The resolver's read (LIN-3382): per-row evidence (canonical account,
     * source, provider/scope/workspace id where the row carries them) for a
     * SET of keys, in one read per store. `[]` for an empty set (never a full
     * scan).
     */
    async findEvidence(urlKeys) {
      const keys = [...new Set((urlKeys || []).filter(k => typeof k === 'string' && k))];
      if (keys.length === 0) return [];
      // Connection-keyed credential records carry no key and add no evidence
      // beyond their connection's referents, so they are not read at all here.
      const rows = await loadRows(keys, false);
      const accountIds = new Set();
      for (const r of rows.ownerCredentials) if (r.accountId) accountIds.add(r.accountId);
      for (const c of rows.connectionReferents) if (c.accountId) accountIds.add(c.accountId);
      for (const r of [...rows.proxyTokens, ...rows.dispatchTokens]) if (r.createdBy) accountIds.add(r.createdBy);
      const canonical = new Map();
      for (const id of accountIds) canonical.set(id, await resolveCanonicalAccountId(id));
      return evidenceFromRows(rows, id => (canonical.has(id) ? canonical.get(id) : id), keys);
    }
  };
}
