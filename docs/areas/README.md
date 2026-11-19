# Area notes

What has been learned about changing each area of the code,
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
text, that is usually `lib/prompts/stage-kinds.js` or `lib/prompt-template-defs.js`.

A new production file with no pattern falls through to the `^lib/` catch-all in
Other features. Give it a home in the same change. A placement that was once wrong is
pinned in `tests/unit/area-map-placement.test.js`.

## A note

An area's notes are `<slug>.md` in this directory, named by the area's `slug`. A note is optional: no file means
nothing is known yet, and that is fine. A note has one part, `## Lessons`: what binds how you work in the area. A lesson
is a rule a builder follows, learned from a change that went wrong or nearly did, or from a Periodical reading. Say why.
Lessons are read before every change, so they stay within 6144 bytes (the guard's check 4). Lessons move to records in
slice 5 of the layer (LIN-4491).

Cite files, never line numbers: lines move, and the docs anchor sweep reads this directory. A cited path is a backtick
span holding a repo-relative path: it has a `/` in it, or it ends in a file extension such as `.js` or `.md`. Symbols,
such as function names, have neither, so they are never read as paths. In code this is one predicate, `isCitedPath` in
`lib/prompts/area-note-format.js`.

## Where a hand-off goes

LIN-4495 retired the Waiting lists. An outside find, a leftover, a check that needs a person, and an ask to a parent
or a sibling are now **records**, written through the proxy (`POST /api/proxy/records`) and read in the brief of the
task or the project they name. The rule is written once, in `lib/prompts/handoff-words.js` (the hand-off protocol), and
`lib/prompts/leftover-words.js` says where a leftover goes. A note is never where a find waits: a Lesson is the only
thing a note holds. The backlog is the project's records, which the person orders on the project page.

The Survey notebook's tally (`docs/plans/survey/broad-options.md`) moved here; the rest
of `docs/plans/survey/` stays as frozen research.

## The guard

`tests/unit/area-notes.test.js` fails CI when:

1. a note's file name is not an area's slug;
2. a path a note cites does not exist;
3. a note has a Waiting section (retired by LIN-4495; a find is a record);
4. a note's `## Lessons` section is over 6144 bytes. Keep Lessons short enough to read
   before every change: prune lessons that no longer bind;
5. this README does not state that 6144-byte Lessons cap (the guard reads its own
   constant, so the two cannot drift).

The Survey notebook's tally (`docs/plans/survey/broad-options.md`) moved here; the rest
of `docs/plans/survey/` stays as frozen research.
