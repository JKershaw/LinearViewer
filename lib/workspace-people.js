/**
 * LIN-4493 (decision 4, John's ruling "link-account"): the people a record can be addressed to in one workspace.
 *
 * One reader. A person is a canonical account that is a member of the workspace (lib/account-workspace-store.js) and
 * carries an identity on the workspace's tracker provider with the name that tracker shows (`identity.name`, stored at
 * sign-in by establishAccount). The id is the account's own: `person:<accountId>`, the same identity `writerOf` files a
 * person's own writes under. A merged account's identities are read with its canonical account's, and the person is
 * listed once. An account that has no name on its tracker identity (signed in before the name was stored, or with an
 * email identity only) is left out until its next sign-in.
 *
 * Callers: the records proxy routes (`listRecordPeople`), the task-page and project-page record routes (both through
 * server.js), and the `?assignee=me` name (server.js
 * `resolveAssigneeSelection`, via `storedNameOf`), which reads the signed-in person's name from here before the provider's viewer.
 *
 * Platform-level: it reads the account, workspace and membership stores it is given and imports nothing of Records.
 */
/**
 * @param {Object} deps
 * @param {{getWorkspaceByUrlKey: Function}} deps.workspaceStore
 * @param {{resolveCanonicalAccountIds: Function, getAccounts: Function, listMergedAccountsFor: Function}} deps.accountStore
 * @param {{listAccountsForWorkspace: Function}} deps.accountWorkspaceStore
 * @returns {(urlKey: string) => Promise<Array<{accountId: string, name: string, trackerUserId: string}>>}
 */
export function createListWorkspacePeople({ workspaceStore, accountStore, accountWorkspaceStore }) {
  return async function listWorkspacePeople(urlKey) {
    const workspace = await workspaceStore.getWorkspaceByUrlKey(urlKey);
    if (!workspace) return [];
    const provider = workspace.provider || 'linear';
    // Batched (LIN-4494 review): the members' canonical ids, then the canonical accounts and everything merged into them,
    // in a fixed number of reads however many members there are.
    const memberIds = await accountWorkspaceStore.listAccountsForWorkspace(workspace.id);
    const canonicalOf = await accountStore.resolveCanonicalAccountIds(memberIds);
    const canonicalIds = [...new Set(canonicalOf.values())];
    const [canonicals, mergedOf] = await Promise.all([accountStore.getAccounts(canonicalIds), accountStore.listMergedAccountsFor(canonicalIds)]);
    const byId = new Map(canonicals.map((a) => [a._id, a]));
    const people = [];
    for (const accountId of canonicalIds) {
      const group = [byId.get(accountId), ...(mergedOf.get(accountId) || [])].filter(Boolean);
      const identity = group.flatMap((account) => account.identities || []).find((i) => i.provider === provider && i.name);
      if (!identity) continue;
      people.push({ accountId, name: identity.name, trackerUserId: identity.scope });
    }
    return people;
  };
}

/**
 * The name the workspace shows for one signed-in account: its canonical person's name from `listPeople` (LIN-4494: the
 * `?assignee=me` name reads it before the provider's viewer). Null when the account is not a named person here.
 * @param {{accountId: string, urlKey: string}} who
 * @param {{listPeople: (urlKey: string) => Promise<Array<{accountId: string, name: string}>>, canonicalAccountId: (accountId: string) => Promise<string>}} deps
 * @returns {Promise<string|null>}
 */
export async function storedNameOf({ accountId, urlKey }, { listPeople, canonicalAccountId }) {
  if (!accountId) return null;
  const canonical = await canonicalAccountId(accountId);
  const me = (await listPeople(urlKey)).find((person) => person.accountId === canonical);
  return me?.name || null;
}
