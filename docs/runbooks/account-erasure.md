# Runbook: erase a person's account on request (LIN-3423)

Deletion is **by request to the operator**. There is no button; a self-service
version is a separate backlog ticket that depends on this one. This runbook is
the whole procedure: verify who is asking, agree a level in writing, run the
tool as a dry run, get John's recorded yes, execute, confirm, record.

The tool is `scripts/erase-account.mjs`, a thin CLI over `lib/account-erasure.js`.
The `INVENTORY` table in that file is the one list of what every collection does
at each level; if this runbook and the table ever disagree, the table is right.

Nothing in this runbook is run against production by the change that added it.

## The two levels

| Level | Removed | Kept |
| --- | --- | --- |
| **Standard** | The account (and any merged-in aliases), the email address, sign-in identities, sessions, the tokens and credentials they own (proxy and dispatch tokens including runner copies, owner credentials, connections, share links, sign-in links), saved chats, preferences, account-workspace edges. Queued runs they dispatched are cancelled into history. | Workspace history: tasks, prompts, replies, run records, caches. History keeps an internal id that no longer belongs to any account. |
| **Full wipe** | Standard, **plus** the history (and the data keyed by the workspace) of every workspace they own **alone**. In a workspace shared with other people the account id on history is replaced by the constant `erased` (one value for everyone, so rows cannot be linked). | Text they wrote and names they gave tokens in shared workspaces. Rows of other people. |

A workspace is **owned alone** only if the person's accounts hold its owner edge,
its `urlKey` is proven, and no other account appears for that `urlKey` in any
evidence source (edges on every linked workspace id, credential/connection/token
holders, sessions live or stale, any account-naming field in the inventory). One
foreign sighting makes it **shared**. An unproven `urlKey` makes it **unmapped**:
it is left in place and listed, and a Full wipe `--execute` refuses while any
exist, until the operator passes `--map <workspaceId>=<urlKey>`. There is no
allow flag.

## (a) Verify identity

A message **from** an address proves nothing. Prove control of the mailbox or of
a live session.

1. **The person has an email identity.** Look the account up by address (a dry
   run with `--email` does this and refuses on no match). Send that address a
   challenge phrase; the person replies with it.
2. **No email identity, but a workspace session.** The person mints a proxy token
   labelled with a phrase you give them **by another channel** (this is refused if
   they have switched `proxy` off). Then:

   ```
   node scripts/erase-account.mjs --find-label '<phrase>'
   ```

   Read-only. It looks at `proxy-tokens` with the projection `{createdBy, createdAt}`,
   only rows younger than 24 hours, and refuses on zero or several. It prints the
   account id (the one exception to 8-character ids, with the resume id below);
   pass it as `--account-id`. The label token can then be deleted.
3. **Neither (no account, or a PAT session).** Outside this procedure. Go to John.

Keep the full canonical account id from the lookup: a resume after a crash needs
`--account-id`, and an `--email` re-run may refuse (see Resuming).

## (b) Confirm the level in writing, with the consequences

Send the person this, and keep their reply:

- **Full wipe is final.** Nothing in the deleted workspaces can be recovered.
- A workspace shared with other people **loses its owner** (it becomes ownerless;
  recovery is `lib/owner-backfill.js`, John's call).
- Under **Standard**, the history of a workspace they own alone stays and is
  visible to **whoever next connects the same tracker workspace**. Offer Full
  wipe. (Open question for John: marking such a workspace so a new binder does not
  inherit the history. Default: not built; the dry run flags it, this step offers
  Full wipe, the privacy page says it.)
- They revoke Harbour's access at **their tracker** themselves (Linear, GitHub,
  Atlassian). Removing data here does not do that.
- Outside both levels: tracker copies, server logs, **host backups** (not verified
  to be purged; imply nothing), and the confirmation email (Resend keeps it).

## (c) Before you run

1. Production needs **John's recorded yes**.
2. Confirm the mailbox at `lib/render-legal.js:31` (`PRIVACY_CONTACT_EMAIL`) is watched.
3. **(c0) Shrink the race window.** Ask the person to sign out everywhere, delete
   their proxy and dispatch tokens in Settings, and stop their runners and
   consumers. Check the dry run's **in-flight count** (group-dispatched `taken` runs
   with no `bookkeeping` and no terminal marker of their own) is zero, or wait for
   those runs to finish. A worker that died without posting a marker stays in the
   count; judge such a row by its age and proceed past one that is plainly dead.
   An aborted run's target also stays counted unless the tool has subtracted it;
   the same age judgement applies. This only shrinks the window; the tool does not
   depend on it. If the person cannot be reached, proceed: the gate and the Known
   limits below cover it.

## (d) Dry run

```
node scripts/erase-account.mjs --email <address> --level standard|full [--map <workspaceId>=<urlKey>]...
ERASE_EMAIL=<address> node scripts/erase-account.mjs --level full      # argv lands in shell history
node scripts/erase-account.mjs --account-id <id> --level standard
```

The default is a dry run: it changes nothing. Read it:

- `target:` is the database the run will touch (the Mongo host, or the data dir).
  **An empty data dir makes a dry run look clean**: check this line first. The
  `./data` fallback is easy to hit by accident.
- `planId` is 8 hex over the level, the accounts, the per-collection counts, the
  workspace classification (including the proven `workspaceId=urlKey` pairs of every
  Alone workspace), any `--map` pairs and the target.
- Per collection: rows it would **remove**, **anonymise**, **keep**, and up to five
  8-character account ids. No content is printed; a driver error prints only a
  name, a code and a collection.
- Flags: owned and shared (they become ownerless); owned alone under Standard
  (offer Full wipe); local (`local-issues` is the only copy); `unmapped`; and rows
  the tool cannot reach (string-encoded sessions, sessions with no account, tokens
  with no `createdBy`).
- "collections in the database that INVENTORY does not name": report them. A
  collection retired by LIN-3632 (`funnel-events`) will show here in any database
  that still has it; its drop script is `scripts/drop-funnel-events-collection.mjs`.
- Keep the **proven pairs** block. If a Full wipe stops at the gate (below) you need
  it.

## (e) Execute

```
node scripts/erase-account.mjs --email <address> --level full --execute --confirm <planId>
```

`--execute` without `--confirm` exits non-zero before any database is opened. The
tool recomputes the plan and refuses on any difference, before its first write.

Order, so a re-run is safe:

1. sessions (the person is signed out of Harbour at once);
2. cancel queued `dispatch-queue` runs they dispatched (and wakes continuing them)
   into `dispatch-history` as `cancelled`; at Full, delete each Alone workspace's
   data and anonymise the rest;
3. every other group row (tokens, credentials, connections, share links, chats,
   preferences, sign-in links), then the edges. **Harbour proxy and dispatch tokens
   stop working on their next request**: each is validated by a fresh read, with no
   cache. (The 30-second cache in the server holds tracker access tokens, not
   Harbour token validity; do not describe it as the reason access ends.)
4. a settle wait of about 35 seconds (`IN_FLIGHT_SETTLE_MS`), once, for requests
   that passed validation before step 3 and write after it; then the **pre-accounts
   gate**, which recounts and stops before any account is deleted if anything new
   turned up;
5. accounts: aliases deepest-first, the canonical account last; then the **final
   recount**.

Read the receipt: level, `planId`, the full canonical id once, 8-character ids,
counts, and the after-counts. **Do not use a second dry run as the check**: after a
completed run it refuses ("account not found"), which is expected and is no
evidence either way. The receipt's after-counts are the evidence.

- **`NEW_ROWS_BEFORE_ACCOUNT_DELETE`**: something was written after its delete step
  (a session from a sign-in, a late queued run). Nothing in `accounts` was touched.
  Run the resume form it printed (a dry run, which prints a **new** `planId`), then
  execute with that one. If it stops a **second** time a live writer exists (a runner
  or consumer of theirs): find and stop it before a third pass. **At Full**, the
  resume run has an empty Alone set (step 3 deleted the edges), so rows written into
  a formerly-Alone workspace fall to the shared rules: a row the gate cancelled is
  anonymised instead of deleted and server-written rows are kept. That is the safe
  direction but silent: take the former-Alone urlKeys from the first plan's pairs
  block, check each for remaining rows, delete what remains by `urlKey`, and record
  the counts in (g).
- **`RESIDUAL`** in the receipt (exit code 1): go to Known limits. Do not re-run
  the tool; it will refuse.
- **`FOREIGN_SIGHTING_APPEARED`**: someone else showed up in a workspace between the
  dry run and the delete. Nothing was deleted for it. Re-run the dry run.
- **`UNMAPPED_WORKSPACES`**: pass `--map <workspaceId>=<urlKey>` (see below).

### Resuming

A run that crashed after step 1 may find a pair that was proven only by the person's
(now deleted) session as `unmapped`: pass the `--map` it prints. A run that crashed
in step 4 resumes with `--account-id <canonical> --level <level>`; its `--email`
form may refuse, because the alias carrying the address can already be gone. The
stop error prints the exact resume form.

## (f) Confirm to the user, by email

Say the level, what was removed and what was left (the list in (b)). Promise no
response time and nothing about backups being purged.

## (g) Record

Date, level, `planId`, the 8-character account id, and the counts of both runs
(dry run and receipt). **No personal data**: not the address, not the full id. On
the first request, move the self-delete ticket out of Backlog.

## Known limits

Rows that can appear only **after completion** cannot be removed by the tool,
because the account they key on is gone and the run ids are not re-derivable:

- a wake row minted by a worker that was already taken when the person's
  orchestrator was cancelled;
- any group-dispatched row minted during step 4;
- a row written after the gate by a request in flight at step 3 (the settle wait is
  a heuristic, not a bound);
- a `sessions` row minted by a sign-in during step 4.

The receipt's `RESIDUAL` line names the collection and count. Later same-class race
findings are added here, not to the tool.

**Manual step, `dispatch-queue`.** List untaken rows with `kind: 'wake'` (or any
`dispatchedBy` equal to the erased id) in the affected workspaces, and remove each
through the store, which archives it to `dispatch-history` as `cancelled`, then
verify. `removeItem` swallows archive failures, so the verify is required. Judge
which wakes continue the erased person's run: a wake whose `followUpTo` run is
attributed to the erased id (Full) or to an id no longer in `accounts` (Standard) is
theirs; one continuing a teammate's run is not touched.

```js
// node --input-type=module, from the repo root, with HARBOUR_DATA_DIR or MONGODB_URI set
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from './lib/dispatch-store.js';

const client = new MangoClient(process.env.HARBOUR_DATA_DIR);
await client.connect();
const db = client.db('linear-viewer');
const store = new DispatchQueueStore({
  collection: db.collection('dispatch-queue'),
  historyCollection: db.collection('dispatch-history')
});
const rows = [/* { _id, urlKey } for each row you judged to be theirs */];
for (const { _id, urlKey } of rows) {
  await store.removeItem(urlKey, _id);
  const queued = await db.collection('dispatch-queue').findOne({ _id, urlKey });
  const archived = await db.collection('dispatch-history').findOne({ _id });
  if (queued || !archived || !['cancelled', 'taken'].includes(archived.status)) throw new Error(`not verified: ${_id}`);
}
await client.close();
```

A raw delete by `_id` + `urlKey` is allowed **only** in a workspace wiped by Full
(Alone), where `dispatch-history` is deleted anyway. Under Standard and in a Full
shared workspace the history row is kept, so the store path is required. A teammate
who owns the workspace can instead cancel the row through
`DELETE /workspace/:urlKey/api/dispatch/:itemId` (`routes/dispatch.js:821`); the
operator cannot call that route, because the workspace must be in the caller's own
session and the caller must own it for runner targets.

**Manual step, `sessions`.** Delete the rows by `session.accountId` (the erased ids
printed in the receipt). Sessions have no archive.

Count the rows removed in the log entry (g).

## Open questions (defaults kept; for John)

- Standard on a workspace owned alone: its kept history is visible to whoever next
  connects the same tracker workspace. Default: flag it, offer Full wipe.
- Shared-workspace anonymisation: the constant `ERASED_ACCOUNT_ID = 'erased'`, one
  value for everyone. Another ruling changes one inventory rule and one page sentence.
- Saved chats are deleted at both levels.
- Merge logs (`account-merge-events`) are kept at Standard, deleted at Full.
- Host backups outliving a deletion: not verified.

## Sentence-to-source table (privacy page)

`lib/render-legal.js` says every privacy sentence is traced to code or
infrastructure. For the deletion changes of LIN-3423:

| Sentence on `/privacy` | Source |
| --- | --- |
| "...kept for the life of the service, except what a deletion request removes (see Getting your data deleted)" | `INVENTORY` rows of kind `history` and `workspace`: Standard `keep`, Full removes the Alone workspaces' rows |
| "Sign-in tokens are kept until you remove the workspace, unlink the provider or ask for deletion" | `INVENTORY` `owner-credentials`, `connections`, `proxy-tokens`, `dispatch-tokens`: `delete` at both levels |
| "Deletion is by request, not a button: write to <contact> and choose a level" | This runbook, (a) to (b); the contact is `PRIVACY_CONTACT_EMAIL`; no self-serve control exists |
| "Standard removes your account, your email address, your sign-in identities and sessions, and the tokens and credentials you own" | `INVENTORY` kind `group` rows (`accounts`, `account-workspaces`, `sessions`, `owner-credentials`, `connections`, `user-preferences`, `saved-chats`, `proxy-tokens`, `dispatch-tokens`, `task_share_links`, `email-magic-links`) |
| "The history of your workspaces stays as the workspace's record" | `INVENTORY` kind `history` and `workspace`, `standard: keep` |
| "That history keeps an internal id that no longer belongs to an account" | Account fields on history rows are not touched at Standard (`accountFields`) |
| "the history of a workspace you owned alone stays visible to anyone who later connects the same tracker workspace" | `lib/account-workspace-store.js` ownership by first binder; open question above; dry-run flag "owned alone under Standard" |
| "Full wipe ... also deletes the history of workspaces you own alone" | `full: delete` for Alone workspaces; Alone rule in "The two levels" |
| "In workspaces shared with other people, the account id on your history is replaced" | `ERASED_ACCOUNT_ID` and the Shared rule (`full: anonymise`) |
| "text you wrote and names you gave tokens stay" | Anonymisation rewrites account fields only; `bookkeeping.by`, prompts and token labels are not touched |
| "your tracker's own copies, the services under Who processes it, server logs, host backups, the confirmation email" | (b) above; host backups unverified |
| "revoke Harbour's access in Linear, GitHub or Atlassian" | Unchanged from LIN-3390; the tool deletes Harbour's tokens, not the tracker's grant |
