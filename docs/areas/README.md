# Area notes

What has been learned about changing each area of the code, and what is waiting there,
kept with the code on main (LIN-4347, LIN-4371). The next ticket in an area reads its
notes before it changes anything there: the research, plan, bug, design, spike,
implementation and review prompts say so, and scoping's in its own words (`GROUNDING_BY_KIND`
in `lib/prompt-formatters.js`).

## The registry

`areas.json` is the one area list. The product owns it; the code-shape tools
(`scripts/code-shape/`) read it too. Areas are in order, each with a `name`, a `slug`
and regex patterns over repo-relative code paths. **First match wins.** To find a
file's area, take the first area with a pattern that matches its path.

The registry covers code only: `lib/`, `routes/`, `public/`, `server.js` and only a
few named scripts, each by exact pattern. It has no `docs/` patterns and no
directory-wide `scripts/` one, because that would re-file the scripts already there and
move the code-shape census and co-change counts (the LIN-3829 caution in
`tests/unit/area-map-placement.test.js`, which pins each named script). So a note entry
about a doc, a test or an unnamed script cites the code that owns it first. For prompt
text, that is usually `lib/prompt-template-defs.js` or `lib/prompts/stage-intent.js`.

A new production file with no pattern falls through to the `^lib/` catch-all in
Other features. Give it a home in the same change. A placement that was once wrong is
pinned in `tests/unit/area-map-placement.test.js`.

## A note

An area's notes are `<slug>.md` in this directory, named by the area's `slug`. A note
is optional: no file means nothing is known yet, and that is fine. Each note has two
parts, under these two headings:

- `## Lessons`: what binds how you work in the area. A lesson is a rule a builder
  follows, learned from a change that went wrong or nearly did, or from a Periodical
  reading. Say why. Lessons are read before every change, so they stay within 6144
  bytes (the guard's check 4).
- `## Waiting`: work known in the area but not scheduled. One bullet per entry. Each
  entry **starts by citing the file it is about**, as a repo-relative path in
  backticks, and says what is waiting and where it came from (a ticket, a comment or
  a reading). Waiting has no size limit: an entry keeps its detail, and is never cut
  or shortened to make room.

An entry from a Periodical reading names its source as the Periodical's title and the
reading's date, for example "(Seams & Tangles, 8 Nov.)". It cites the area's file first
and the reading's report second, so the guard checks the first path against the area
and the report path must exist in the same change.

Cite files, never line numbers: lines move, and the docs anchor sweep reads this
directory. A cited path is a backtick span holding a repo-relative path: it has a `/`
in it, or it ends in a file extension such as `.js` or `.md`. Symbols, such as function
names, have neither, so they are never read as paths.

## One home for each leftover

Where a leftover goes, and why an item never lives both here and in a ticket, is written
once in `lib/prompts/leftover-words.js`: `LEFTOVER_RULE` (LIN-4376) and `CONSEQUENCE_TEST`
(LIN-4401), which says where an outside find goes. An outside find becomes a ticket only
if it breaks something, blocks work, or touches safety; otherwise it is a `## Waiting`
entry in the note of the area its first cited file maps to. Never both. The leftover
step, review and close-out render both word for word. For the notes:

- A waiting entry leaves in only three ways: a change settles it, a change makes it
  untrue (either removes it in the same change), or the consequence test sends it to a ticket. It
  never leaves, and is never shortened, to make room.
- Waiting entries are context, not scope. A ticket takes one on only when the size of
  its move does.
- The one exception is the builder's leftover step (LIN-4414). Every stage build that
  reaches it settles one fix-sized waiting entry on its PR branch, before it pushes:
  in the area its change touched with the most waiting entries, or, if none there is
  fix-sized, in another area it touched. It removes the entry and names it on the one
  retirement line of its leftover answer. That line has three forms, spelled in
  `lib/prompts/leftover-words.js` (`RETIRES_LABEL`, `RETIRES_NONE`): the settled
  entry's cited file and opening words; none, because no touched area has a waiting
  entry or there are no notes; or none, because no touched area has a fix-sized entry,
  naming the smallest entry in the busiest touched area and why it is larger than a
  fix. The proxy refuses an answer without a valid line (`lib/dispatch-leftover-answer.js`).
  A ticket never counts as the retirement. The build itself still treats
  Waiting as context.

Who writes here: the builder's leftover step tidies or notes what its change left,
writing an outside find into its own area's note (`lib/dispatch-leftover.js`, LIN-4401),
review names any edge it left untouched, close-out
writes review's note entries, in any area, on the PR branch before the merge (LIN-4374,
LIN-4401), and Stage 2 of a Periodical writes its reading's entries in the same docs-only
PR as its report (`lib/periodicals.js`, LIN-4379). Close-out is the only one that files
a ticket, and only one the consequence test sends to a ticket; every other outside find
is a note entry in its area. A Periodical that writes here files none.

The Survey notebook's tally (`docs/plans/survey/broad-options.md`) moved here; the rest
of `docs/plans/survey/` stays as frozen research.

## The guard

`tests/unit/area-notes.test.js` fails CI when:

1. a note's file name is not an area's slug;
2. a path a note cites does not exist;
3. a waiting entry cites no path, or its first cited path maps to another area;
4. a note's `## Lessons` section is over 6144 bytes. Waiting is not counted. Keep
   Lessons short enough to read before every change: prune lessons that no longer
   bind, and remove waiting entries that are settled or no longer true;
5. this README does not state that 6144-byte Lessons cap (the guard reads its own
   constant, so the two cannot drift).

The guard also prints each note's Waiting count, so whether the lists are shrinking
can be read in CI.
