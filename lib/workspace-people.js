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
 * Callers: the records routes, through server.js (`listRecordPeople`). Home's assignee lookup is the next caller, in
 * piece 3 (LIN-4491); it moves onto this reader then, and is not changed here.
 *
 * Platform-level: it reads the account, workspace and membership stores it is given and imports nothing of Records.
 */
/**
 * @param {Object} deps
 * @param {{getWorkspaceByUrlKey: Function}} deps.workspaceStore
 * @param {{resolveCanonicalAccountId: Function, getAccount: Function, listMergedAccounts: Function}} deps.accountStore
 * @param {{listAccountsForWorkspace: Function}} deps.accountWorkspaceStore
 * @returns {(urlKey: string) => Promise<Array<{accountId: string, name: string, trackerUserId: string}>>}
 */
export function createListWorkspacePeople({ workspaceStore, accountStore, accountWorkspaceStore }) {
  return async function listWorkspacePeople(urlKey) {
    const workspace = await workspaceStore.getWorkspaceByUrlKey(urlKey);
    if (!workspace) return [];
    const provider = workspace.provider || 'linear';
    const memberIds = await accountWorkspaceStore.listAccountsForWorkspace(workspace.id);
    const canonicalIds = new Set();
    for (const accountId of memberIds) canonicalIds.add(await accountStore.resolveCanonicalAccountId(accountId));
    const people = [];
    for (const accountId of canonicalIds) {
      const merged = await accountStore.listMergedAccounts(accountId);
      const group = [await accountStore.getAccount(accountId), ...merged].filter(Boolean);
      const identity = group.flatMap((account) => account.identities || []).find((i) => i.provider === provider && i.name);
      if (!identity) continue;
      people.push({ accountId, name: identity.name, trackerUserId: identity.scope });
    }
    return people;
  };
}
