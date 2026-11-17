# What this stage really wrote

## Comment on LIN-4450 at 15:40:37

## Close-out — LIN-4450

**Merged:** PR https://github.com/JKershaw/LinearViewer/pull/2421, squash commit `2bf788b6da71c82db6a1d84b361da98ef9cdedbb`, pinned to head `26299c9b0c6ecb57edd029f49578282224f6d31e` (the commit CI passed on). **Deployed:** harbour.cat's footer shows `2bf788b6d` (checked 15:39 UTC), and the Tests run on main for it completed green.

**How it meets what was asked:** review's gap analysis stands (every item of `## As asked` met; one declared departure, the empty-fence codec shape, which review judged consistent with "D1 unchanged"). A Jira description holds the words byte-exact in `harbour.asAsked`, through one reader and writer, and `descriptionRoundTrip` holds sealed words with no logic change to `lib/as-asked-seal.js`.

**Changes I made after the approval** (nobody re-reads these; commit `26299c9b0`):
- Review's named fix: `tests/unit/jira-as-asked-region.test.js`, the oversize test now captures `console.log` and asserts exactly one line, `[as-asked] seal skipped: provider jira cannot hold the block (test)`. I checked it bites: changing the logged wording turns it red; reverted.
- Blind read, inline check: `routes/workspace-api-audit.js` now reads `isHermeticTestToken(workspace.accessToken) || (NODE_ENV==='test' && workspace.provider==='local')`. Same predicate as before, local-provider alternative kept.
- Blind read, alias: removed `isTestToken` from `routes/workspace-api-steps.js`; `workspace-api.js`, `-prompts.js`, `-issue-read.js`, `-issue-write.js` and the steps file itself call `isHermeticTestToken(workspace.accessToken)` directly.
- Stale citation this change made: the `workspace-api-steps.js` header comments and `docs/architecture/source-map.md` line 42 still named `isTestToken` (now "seven steps"). Fixed, no ruling needed.
- Blind read, redundant test: deleted "no longer claim that Jira is skipped" (behaviour is covered by `as-asked-create-seal`).

**Ledger:**
- Inside, property semantics (live PUT/GET of `properties['harbour.asAsked']`): **not run.** It needs a real Jira site and no credential for John's exists in a build session. Who can run it: LIN-4452 (a sealed `updateIssue`, then check `properties['harbour.asAsked'].words` is byte-equal to the words written).
- Inside, digest survives a Jira editor save below the block: **not run**, same reason, LIN-4452 (file `* a`, `*em*`, trailing spaces, `3.`; edit one line below in Jira's editor; the words must be byte-equal and `digest(region) === property.rendered`).
- Inside, first dispatch of a never-dispatched Jira-native ticket: **not run**, same reason, LIN-4452 (the dispatch row is enqueued either way; either the formatted block with no "seal skipped" line, or the existing D1 refusal line for tickets with mentions/emoji/panels).
- These three are post-deploy checks I cannot run; per the close-out rules they do not hold the close. Listed for the operator, and recorded on PR #2421 too.
- Rollback (named by review): revert PR #2421's squash commit. Properties already written stay on issues but nothing reads them, and sealed descriptions fall back to the existing unsealed readers. No data loss.
- Outside (blind read's "inside the area, larger"): batch reads don't ask Jira for `harbour.asAsked`. Its home is the `## Waiting` entry in `docs/areas/providers.md` (already on main from this PR), so no ticket.

**CI on the final head:** `ci-success` green on `26299c9b0` (Unit tests, proxy clock +400d, E2E 1–4/4, secret scan). Locally the full unit suite passed 25,319/25,319 (25,320 less the deleted test).

**Housekeeping:** description archived (snapshot verified to carry the pre-prune text) and pruned below the block to the Size record plus an "Implemented" stub. Related tickets: LIN-4451 was blocked by this and is now unblocked, LIN-4452 is the live check and stays open, parent LIN-4445 stays In Progress. No follow-up tickets filed: the blind read had nothing outside the area.

## PR #2421 comment at 15:40:38

## The PR's one comment (2026-11-13T15:40:38Z, shown as JKershaw)

Post-deploy checks not run (LIN-4450 close-out): live Jira property PUT/GET, digest surviving a Jira editor save below the block, and first dispatch of a Jira-native ticket. They need a real Jira site and credentials that a build session does not have. LIN-4452 owns them; the exact right/wrong conditions are in review's ledger on LIN-4450. Merged at `2bf788b6d`, deployed (harbour.cat footer), CI green on head `26299c9b0`.

