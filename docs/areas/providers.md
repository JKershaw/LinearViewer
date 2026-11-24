## Lessons

- A Jira description is read with `adfToMarkdown` and written with `markdownToAdf`, one codec each
  way (`lib/providers/jira/index.js`). It reads back as the codec's rendering, not the bytes sent
  (`*this*` comes back `_this_`), so never treat a Jira description as byte-exact words: the person's
  words are the task's `asked`. LIN-4502 retired the As-asked region that kept exact words in the
  `harbour.asAsked` entity property; that property stays on older issues, and nothing reads or
  removes it. (LIN-4450, LIN-4502.)
- Compare renderings, never ADF. Jira stamps `localId` and similar attributes on ordinary saves,
  and `adfToMarkdown` ignores them, so a hash of the ADF reads every human save as an edit. (LIN-4450.)
- The Jira fake proves only the provider's own logic. It stores whatever it is handed and
  never normalises ADF, so it cannot show what live Jira keeps. A claim about live behaviour
  needs a live check. (LIN-4450.)
- A Jira create chooses the epic field from its own project's create screen, never from the
  tenant's field list. `parent` if the screen lists it, else Epic Link if it does; a screen with
  neither is refused 422 before the create. A field that exists on the tenant can still be absent
  from this screen, and writing it there is a 400 after the issue is half-filed. (LIN-4451,
  `lib/providers/jira/index.js` `_epicCreateField`.)
- The create metadata is read fresh on every create, with no cache. It is filtered by the
  caller's own permissions, and a cache keyed on the site cannot tell two callers apart. Creates
  are infrequent, so the round trips cost little. (LIN-4451, `createIssue` in the same file.)
- A create that fails after the issue exists is a PartialWriteError telling the caller not to
  retry. A retry would file a duplicate. A failed confirmation re-read is where this applies (the
  `harbour.asAsked` property check that was a second place went with LIN-4502). Every create lane (proxy, session, feedback) maps it through
  `lib/partial-write-error.js` `partialWriteEnvelope`: `retryable:false`, answered 500. A lane
  that does not map it answers a bare 500 that hides the landed issue. (LIN-4451, LIN-4452.)
- A comment's author is the provider's tracker user id, mapped onto the comment as `authorId` on list and create (Linear
  `user.id`, GitHub `user.id`, Jira `author.accountId`); for a comment typed in the tracker, lib/comment-ingest.js
  matches it to a person's `trackerUserId`. A comment Harbour posts is settled at the post, from the credential that
  sent it, never from this id (LIN-4548). A provider with no author id leaves it null, and its comments are never a
  person's. (LIN-4535.)
- A provider whose comment create takes a client-chosen id declares `clientCommentIds` (Linear, checked by introspecting
  `CommentCreateInput`). Harbour then records the id in the ledger before it posts, so a lost record can never let the
  ingest re-decide its author from the tracker (lib/harbour-comment-post.js, which settles it at the post from the
  sending credential, LIN-4548). Check the tracker's schema before declaring it. (LIN-4535.)
- The dispatch seat reads the ticket's comments through the provider (lib/dispatch-factory.js). A test that dispatches
  with a Linear token other than the hermetic one must install the transport (`setLinearFetchImpl`, lib/linear-fetch.js),
  or the read reaches api.linear.app and the hermetic watcher fails CI. (LIN-4535.)
