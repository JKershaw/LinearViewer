# Step 4 implementation: notes

## Records (14:07:00–14:07:15)

- `change-1`: PR #2421, head `a98d042c6`, in task-2, about plan-1.
- `plan-1` v3: revised with the departures (end line by digest, round trip throws, size limit in bytes, empty-fence fix that changes D1, every `getIssue` reads the property) and the retirements.
- `decision-12`: answers question-1 (digest, neither option offered), about plan-1. Revised to v2 to drop reasoning I had made up.
- `question-1` ended `answered`.
- Ended `done`: finding-44, -32, -34, -36, -37, -39, -40.
- To John, both about change-1: `finding-45` (live check not done; the digest might not survive an editor save) and `finding-46` (once merged, the seal will seal Jira-native tickets).
- `run-4`: about change-1, ended `done`.
- Left open: finding-33, -35, -38 (the real output doesn't say).

## Refusals

None. A stray malformed `end` of mine wrote nothing (seq is continuous, 99 to 114). The system accepted `revise decision-12` from implementation, though BUILD-NOTES says implementation only revises a piece.

## Relied on, not carried by the brief

- PR URL, branch and head.
- The Atlassian docs URL and its bytes-vs-characters wording.
- Test counts and CI results.
- The census fixture.
- The LIN numbers for siblings (4451, 4452) and how they map to tasks.
- "Review note 1" (in verdict-3, not in plan-1).

## Carried, not needed

- Lessons 3, 4 and 14 (about 3 KB of repeated paths).
- verdict-2 and verdict-3.
- decisions 1–4.
- Most of task-1's ask.
- The close-out findings, listed by id only.

## Couldn't place

- Whether `check-1` is the live check. The brief gives ids only, so I didn't link it.
- "D1 unchanged" appears only in finding-32, not in plan-1.
- The real departure comment went on the parent. Here it became a plan revision.
