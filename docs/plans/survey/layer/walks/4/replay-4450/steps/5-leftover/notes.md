# Notes: 5-leftover (task-60)

**Written / revised / ended** (14:14:10–14:14:21, 12 writes, no refusals)
- run-92 run: added, account revised, ended `done`.
- change-85: revised, head `f9fa4a80c…`, with CI green.
- finding-22 (area-2, the isHermeticTestToken entry): ended `done`, retired by the leftovers commit.
- finding-69 (to implementation, the "check no cache/guard compares the reads" item): ended `done`. The divergence itself stays with finding-79.
- finding-79 (to area-1): revised to name the two bulk reads and where the note is held. Revised rather than written again.
- lesson-93..96 (in area-1): the four providers.md Lessons.
- finding-97 (to review, about change-85): the leftovers commit's tidies and retirement, for review to check.

**Lookups**: `show --task task-60` and `get` on several records. I also read store.json directly with `node -e` to get a one-line list of every record, and that read is not in the query log. Purpose: to find the earlier records for the bulk-read divergence (69, 79), the isHermeticTestToken entry (22), any area-1 lessons (none) and change-85's head.

**Refusals**: none.

**Relied on, not given by brief or query**: PR 2421 itself and its head SHA. The text of the four stale comments in adf.js, index.js, fake-client.js and as-asked.js. The callers of the inline test-token checks in routes/ and server.js. The CI rerun. The content of docs/areas/llm-and-prompts.md. Brief §5 only gave counts for area-2's open records, so I had to look up finding-22 to find the retirement candidate.

**Carried but not needed**: all of plan-54's text and review notes, decisions 63/81/82/87/88, and lessons 5, 6, 16 and 47.

**Couldn't place**: "Survey open-0" in lesson 3 has no store id. The real output does not say whether the "no guard or cache" check covered more than index.js.
