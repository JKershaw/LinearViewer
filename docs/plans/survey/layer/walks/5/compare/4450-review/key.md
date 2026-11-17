# Key: LIN-4450, review stage, as of 2026-11-13T15:12:24Z

At this moment LIN-4450 is In Progress. Its description is `## As asked` plus "Size of the move". It has four comments: Survey open-0 (13:47), Survey global (13:51), the summary (14:13) and Leftovers (15:11). PR #2421 is open and not merged. Nothing from review, blind read or close-out exists yet.

## 1. What is addressed to this stage to act on?

**Answer:** Review PR #2421 at its current head `f9fa4a80c` against LIN-4450's `## As asked` (items 1–6, the testing strategy, Done when). The summary says "Merge is for review and the orchestrator." Two things are also handed over for checking:
- the five departures recorded on LIN-4445;
- the out-of-plan extra on the Leftovers' `Retires:` line, which moves the inline test-token checks onto `isHermeticTestToken`.

**Shown in:** LIN-4450 summary comment (14:13:35, "Next: … Merge is for review and the orchestrator"); Leftovers comment (15:11:36, the PR head and the `Retires:` line); LIN-4445 comment "Session 1 (LIN-4450): where the code moved the plan" (14:08:01).

## 2. What is still open on the task, and whose is each item?

**Answer:**
- Reviewing and merging PR #2421: review and the orchestrator.
- The live check on John's Jira, which needs a real site and a credential: LIN-4452. Two things wait on it: the property PUT/GET, and whether the digest survives an editor save below the block.
- Piece 2 is blocked on this PR merging: LIN-4451. Calling the shared size guard from `createIssue` is also LIN-4451's job.
- Bulk reads don't ask for `harbour.asAsked`, so they serve converted words. This is noted as a Waiting entry in `docs/areas/providers.md`, with no ticket.

**Shown in:** summary comment (14:13:35, "Not verified" and "Next"); LIN-4445 departure comment (14:08:01, "Not done, and the main open risk"); Leftovers comment (15:11:36, the last bullet); LIN-4450 `## As asked` item 5 ("and (in piece 2) `createIssue`").

## 3. Plan review set the property size limit at 32,768 characters. Is that still the rule?

**Answer:** No. The builder changed it. The limit is still 32,768, but it is now measured in UTF-8 bytes of the serialized property, JSON escaping included. This is the stricter reading, because Atlassian's docs say bytes on some pages and characters on others. It is recorded as departure 2.

**Shown in:** LIN-4445 Plan Review Verdict, note 3 (13:40:55, "32768 characters"); LIN-4450 `## As asked` item 5; LIN-4445 departure comment (14:08:01, item 2, "Size limit in bytes"); PR #2421 body, "Size guard".

## 4. Does any approval or verdict cover the work as it now stands (the PR's current head)? Name the head.

**Answer:** No. No verdict on the code exists yet. The only approval is LIN-4445's Plan Review Verdict (Approve, rev 1), and it covers the plan, not the PR. CI is green on the current head `f9fa4a80c`; the proxy-clock job was rerun once after a runner fault, and no test failed. The summary's "CI green" was for an older commit, `a98d042c6`.

**Shown in:** LIN-4445 Plan Review Verdict (13:40:55) and LIN-4450's "Plan-review due: no … rev 1" line; summary comment (14:13:35, commit `a98d042c6`); Leftovers comment (15:11:36, head `f9fa4a80c`, CI green, the rerun).

## 5. How many departures from the approved plan did the builder record on LIN-4445?

**Answer:** 5. They are:
1. the end line is chosen by digest;
2. the size limit is measured in bytes;
3. the round trip throws on a block it cannot hold;
4. the empty-fence codec fix;
5. every provider-side `getIssue` asks for the property.

**Shown in:** LIN-4445 comment "Session 1 (LIN-4450): where the code moved the plan" (14:08:01), items 1–5.

## 6. Plan review and Survey global say Harbour-written bodies never trip D1. Does that hold?

**Answer:** No. Survey open-0 item 2 showed that an empty fence (```` ``` ```` then ```` ``` ```` on the next line) makes `markdownToAdf` emit an empty `codeBlock`. D1 refuses it, and the codec's fixed point fails. The earlier probes didn't include that input. This PR fixes it: an empty fence now renders as the bare fence, and the gate accepts it. "Size of the move" declares this as the one tidy done first. A reviewer must judge it against Done-when's "D1's rich-content guard is unchanged".

**Shown in:** LIN-4445 Plan Review Verdict ("The D1 premise holds", 13 bodies); LIN-4450 Survey global (13:51:36, "never trips D1"); LIN-4450 Survey open-0 (13:47:23, item 2); LIN-4450 description "Size of the move" ("Why:"); summary comment ("Also fixed"); LIN-4445 departure item 4.
