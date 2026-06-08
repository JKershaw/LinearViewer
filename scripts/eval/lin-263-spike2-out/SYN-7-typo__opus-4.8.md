# SYN-7-typo — anthropic/claude-opus-4.8
expect={implement}  got=implement  hit=true  latency=13251ms  cost=$0.064605  body=325w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed - Task is a single obvious typo fix in a named file; intent and location are explicit.
- Blockers: ✓ None - No blocked or bug labels, no external dependencies.
- Ready: ✓ Yes - File path (`lib/components/footer.js`), the exact string ("Copyrght" → "Copyright"), and the change are all fully specified. No plan needed for a one-character spelling fix.

**Signal Status:** N/A — no prior work to assess.

→ **implement**
**Next:** After the fix lands and is verified, the task moves to review/done.

## Prompt
# Fix SYN-7: Fix typo in footer: "Copyrght" -> "Copyright"

## Workflow
1. **Start**: Set SYN-7 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-7 in Linear
3. **Locate**: Open `lib/components/footer.js` and find where the footer renders the string "Copyrght".
4. **Fix**: Change "Copyrght" to "Copyright".
5. **Verify**: Confirm the corrected string renders, and check the file for any other occurrences of the misspelling. Confirm no other footer text was unintentionally altered.
6. **Commit**: Commit the change with a clear message.
7. **Update Linear**: Add a brief summary comment on SYN-7 noting the fix, then set status as appropriate.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `lib/components/footer.js` and the string "Copyrght".
2. Check whether they have changed since the ticket was created: run `git log --since="2026-06-01T00:00:00Z" -- lib/components/footer.js`.
3. If it has changed, re-read `lib/components/footer.js` at HEAD (not your notes or the ticket prose) and reconcile any discrepancies — the typo may have moved, already been fixed, or the string may now differ — before applying the change.

## Context
Project: Product. This is a single-file spelling correction in the footer component.

## Goal
**Role**: Implementation engineer

Correct the misspelled word "Copyrght" to "Copyright" in the footer rendered by `lib/components/footer.js`.

- Scope is limited to this typo. Do not refactor surrounding code or alter other footer content.
- If you find the misspelling appears in more than one place (e.g., a duplicated string or a parallel code path), fix each occurrence and note them in the Linear comment.
- If the string is already correct at HEAD, do not make a change — report this in Linear and close out the task instead.
