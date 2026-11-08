# Area notes

What has been learned about changing each area of the code, and what is waiting there,
kept with the code on main (LIN-4347, LIN-4371). The next ticket in an area reads its
notes before it changes anything there: the research, plan, bug, design, spike,
implementation and review prompts say so (`GROUNDING_BY_KIND` in `lib/prompt-formatters.js`).

## The registry

`areas.json` is the one area list. The product owns it; the code-shape tools
(`scripts/code-shape/`) read it too. Areas are in order, each with a `name`, a `slug`
and regex patterns over repo-relative code paths. **First match wins.** To find a
file's area, take the first area with a pattern that matches its path.

The registry covers code only: `lib/`, `routes/`, `public/`, `server.js` and a few
named scripts. It has no `docs/` or `scripts/` patterns, because one would change the
code-shape census and co-change counts (the LIN-3829 caution in
`tests/unit/area-map-placement.test.js`). So a note entry about a doc, a script or a
test cites the code that owns it first. For prompt text, that is usually
`lib/prompt-template-defs.js` or `lib/prompts/stage-intent.js`.

A new production file with no pattern falls through to the `^lib/` catch-all in
Other features. Give it a home in the same change. A placement that was once wrong is
pinned in `tests/unit/area-map-placement.test.js`.

## A note

An area's notes are `<slug>.md` in this directory, named by the area's `slug`. A note
is optional: no file means nothing is known yet, and that is fine. Each note has two
parts, under these two headings:

- `## Lessons`: what binds how you work in the area. A lesson is a rule a builder
  follows, learned from a change that went wrong or nearly did. Say why.
- `## Waiting`: work known in the area but not scheduled. One bullet per entry. Each
  entry **starts by citing the file it is about**, as a repo-relative path in
  backticks, and says what is waiting and where it came from (a ticket or comment).

Cite files, never line numbers: lines move, and the docs anchor sweep reads this
directory. A cited path is a backtick span holding a repo-relative path: it has a `/`
in it, or it ends in a file extension such as `.js` or `.md`. Symbols, such as function
names, have neither, so they are never read as paths.

## One home for each leftover

- A leftover inside the area of the change that found it is **tidied in that change,
  or noted here**. It is never filed as a ticket.
- A filed follow-up is scheduled work: it will be done. A note is known but not
  scheduled. The same item never lives in both. When a follow-up is filed for a note
  entry, remove the entry.
- A change that settles a waiting entry, or makes it untrue, removes it in the same
  change.
- Waiting entries are context, not scope. A ticket takes one on only when the size of
  its move does.

The Survey notebook's tally (`docs/plans/survey/broad-options.md`) moved here; the rest
of `docs/plans/survey/` stays as frozen research.

## The guard

`tests/unit/area-notes.test.js` fails CI when:

1. a note's file name is not an area's slug;
2. a path a note cites does not exist;
3. a waiting entry cites no path, or its first cited path maps to another area;
4. a note is over 6144 bytes. Keep a note short enough to read before every change:
   prune lessons that no longer bind, and settle or drop stale entries.
