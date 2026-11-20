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
