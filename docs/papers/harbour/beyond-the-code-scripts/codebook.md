# Codebook: what kind of knowledge an area-note entry holds (LIN-4479)

The unit is one entry: one top-level bullet under `## Lessons` or `## Waiting` in an area note
(`docs/areas/<slug>.md`), as listed in `beyond-the-code-entries-lv.json` and
`beyond-the-code-entries-sd.json`. Code each entry on five fields. Read the entry, and read the code
it cites when a field needs it (for `held` above all). Code what the entry says, not what you think
the area needs.

## 1. `kind`: the entry's main job (pick one)

| Code | The entry mainly... | Test |
|---|---|---|
| `trap` | warns of a non-obvious way a change here goes wrong (an order that matters, a race, a check that passes falsely, a seam a test must pass), usually learned from an incident | Would a competent reader of the code alone miss it? |
| `home` | says where one rule, fact, word or reader lives, and that new uses go through it ("one owner, import it, never respell") | Is its point "this is the one place"? |
| `recipe` | lists what else a certain kind of change must update, regenerate or re-pin | Is it a checklist for a change? |
| `ruling` | records a decision someone made, an accepted limit, or a "why not now", with its reason or a condition to revisit | Would removing it lose *why* something is the way it is? |
| `copy` | names a second copy: one rule, fact or word written in two or more places (code, prompts, docs, another repo) that are not joined | Is the fix "give it one home, derive it, or link the copies by a test"? |
| `defect` | names behaviour that is wrong or missing today for a user, a caller or an agent (a bug, an accessibility or layout fault, a missing guard, a security gap, docs that tell an agent something false) | Is the fix "change what happens"? |
| `cleanup` | names dead code, a misleading name or comment, a misplaced helper, or a file too large, with no wrong behaviour | Is the fix a tidy with no behaviour change? |
| `question` | is mainly an open design or product question waiting for someone's decision | Is the entry's content the question itself? |
| `measure` | reports an observation or a figure with no stated defect | — |

When two fit, pick the one the entry's proposed fix points at. A copy that has already drifted into
a wrong answer is `defect` only if the entry's fix is to change behaviour; if the fix is to join the
copies, it is `copy`.

## 2. `held`: does a mechanical check already hold it?

- `yes`: a test, census, guard, type or lint named in the entry (or plainly the one the entry is
  about) fails if what the entry says stops being true. Check the cited test exists and does that.
- `partly`: a check holds part of it (for example, the check pins markers but not the rule).
- `no`: nothing mechanical holds it; it is true only because the prose is.

## 3. `volatile`: does it state a fact that goes stale without anyone editing the entry?

`yes` if it states a number about the current code (sites, lines, files, bytes, entries, imports,
renders) or an exclusivity claim about the current code ("only X calls Y", "nothing reads", "every
caller", "the one place"). `no` otherwise. Citing a file path alone is `no` (the guard checks paths).

## 4. `needs`: what acting on it takes

- `none`: nothing to act on; it is guidance (most Lessons, and rulings).
- `fix`: fix-sized; one builder could settle it in passing.
- `larger`: an engineering move larger than a fix, decidable without a person.
- `person`: needs a person's ruling, a product call, or a live check only a person can run.

## 5. `home`: where it could live so it stays true, has no second copy, and is easy for an agent to find

Pick the best one.

- `check`: it can be turned into a test, census, type or lint, so the build fails when it is untrue;
  the check's failure message can carry the why. (An entry already `held: yes` whose prose adds
  only a pointer is `check`.)
- `site`: it is about one place in the code and belongs beside it, as a comment or doc comment at
  that site, where the next reader of that code will meet it.
- `tracker`: it is work to be done or a question to be answered, and belongs where work is
  scheduled and ruled on.
- `decision`: it is a dated decision with its reason, and belongs in an append-only decision record.
- `note`: it is area-wide or cross-cutting knowledge with no single site, that only prose can hold.

## Output

One JSON array, one object per entry, in the input order:
`{ "id": "...", "kind": "...", "held": "...", "volatile": "...", "needs": "...", "home": "...", "why": "≤20 words" }`.
