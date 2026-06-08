# SYN-7-typo — anthropic/claude-sonnet-4.6
expect={implement}  got=implement  hit=true  latency=13580ms  cost=$0.02565  body=240w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed — the ticket names the exact file (`lib/components/footer.js`) and the exact change ("Copyrght" → "Copyright"). No ungathered knowledge required.
- Blockers: ✓ None — no blockers mentioned.
- Ready: ✓ Yes — single-file typo fix, clear intent, no plan phase needed for a change this small.

**Signal Status:** N/A — no prior work to assess.

→ **implement** — straightforward single-character fix in a named file.
**Next:** After implementation, move to review to confirm the fix is correct and no other instances remain.

## Prompt

# Fix SYN-7: Fix typo in footer: "Copyrght" -> "Copyright"

## Workflow
1. **Start**: Set SYN-7 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-7 in Linear
3. Apply the fix in `lib/components/footer.js`
4. **Update Linear**: Mark SYN-7 as "Done" and add a brief comment confirming the fix

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `lib/components/footer.js`.
2. Check whether any have changed since the ticket was created: run `git log --since="2026-06-01" -- lib/components/footer.js`.
3. If any have changed, re-read that source at HEAD (not your notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Goal
**Role**: Implementation engineer

Correct the misspelling "Copyrght" to "Copyright" in `lib/components/footer.js`, and confirm no other instances of the misspelling exist in the codebase.

### Steps
1. Open `lib/components/footer.js` and locate the string "Copyrght".
2. Fix the spelling to "Copyright".
3. Search the rest of the codebase for any other occurrences of "Copyrght" to ensure none are missed.
4. Verify the file renders correctly (e.g., run any existing tests or dev server check if available).
5. Commit the change with a clear message referencing SYN-7.
