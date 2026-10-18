# The Theseus Method, version 3: requirements and design for the rewrite

Written before any of the essay's text, as the method asks of a rebuild. The "old code" is the long version
(`docs/theseus-method-long.md`), which keeps every rule, number, instrument and the runbook.

## Requirements: what a reader must come away with

1. Codebases grown by agents go wrong two ways, tangled inside and scattered between, and a rebuild fixes only the first.
2. The order: gather first, then rebuild; and the one piece of evidence for it (the entrance).
3. The five moves, each with the single rule it turns on:
   - find: places × change, from standing measures;
   - own: the area that would change if the rule changed;
   - free the seam: behaviour test first, shown failing without the guard;
   - consolidate: one authority, copies deleted, differences sorted;
   - rebuild: design-first, checked to be new.
4. The judge: an independent replay that checks itself, and why the suite cannot judge.
5. The price: agent time is cheap, attention is not, and people are touched at two points.
6. What is borrowed and what may be new, briefly and fairly.
7. What has been shown and what has not, including the trial.
8. Where to go to run it: the long version.

Out of scope, left to the long version: the ticket clause list, instrument build notes, definitions, probe mechanics, every
secondary number, the four-way sort's details, and the full reading list.

## Design

- **Voice:** plain, short paragraphs, one idea each; Harbour stories as illustrations; few numbers, each doing work.
- **Length:** about 4,500 words of body, plus a short reading list.
- **Order:**
  1. The argument (one paragraph).
  2. Two ways a codebase goes wrong (Figure 1).
  3. Gather first (Figure 2).
  4. Five moves (Figure 3), one short part each: the knot (Figure 4), tests (Figure 5), newness (Figure 6).
  5. The judge (Figure 7).
  6. The price, and people (Figure 8).
  7. Old ideas at a new price.
  8. What is known.
  9. Reading list.
  10. Next.
- **Figures:** eight of the nine. The sort of differences stays in the long version.
- **Rule:** write fresh. Don't copy paragraphs from the long version; quotations and figures are exempt. Measure the
  verbatim share afterwards.

## Result

- **Length:** about 4,100 words of body and 5,300 with the reading list, against 15,500 for the long version.
- **Newness:** 5 of its 164 body sentences (3%) appear word for word in the long version. They are a quotation of
  John and four figure captions. The count excludes figure alt text and sentences shorter than six words. By the
  method's own line this is a rebuild, not an edit.
- **Checks:** an in-session fresh reader read a draft for flow and accuracy (7 must-fix, 31 should-fix, 20 nits).
  Its findings are applied here and, where they also held for the long version, there too.


## Version 2 (18 October)

John read version 1 in the Library and asked for two things: links to further reading inside the text, not only in
the reading list, and an explanation of each Harbour term where a reader new to Harbour first meets it. He also asked
for a readability pass, since agents will mostly read the long version and people will mostly skim this one. Revised
on judgement, with no fresh reader.

- **Links:** each source is linked once where the text uses it, beside its marker. Harbour papers resolve to their
  Library pages (so this essay appears in their backlinks), records under `experiments/` and `scripts/` go to
  GitHub, and the reading list's Harbour entries are links too, here and in the long version. Seven Harbour papers
  joined the reading list for the new links: the growth atlas, `theseus.md`, `drawing-the-ship.md`,
  `one-job-many-paths.md`, `test-surplus.md`, `test-estate.md` and `review-loops.md`.
- **Terms:** what Harbour is and its pipeline (section 1); areas, the agent API and the providers (Find); the runner
  setup page and credential lifetimes (Figure 4); grants (Figure 5); rulings, workers, rounds, the data store,
  seeds, the operator and `proposals.md` where each first appears; and the outside terms strangler fig, shotgun
  surgery, DRY and hotspots.
- **Readability:** the method in brief, as five bullets, after the opening paragraph; long paragraphs in sections 2
  and 4 split; what may be new and what is not yet known set out as lists; the history of the name corrected,
  here and in the long version. Version 1 said John named the method. John's correction (18 October): the name
  arrived on 15 October in the session where he was visualising the codebase, where four experimental views led to
  the ship view (`drawing-the-ship.md`), so the idea was his but the name was not.
- **Length:** about 4,700 words of body, against 4,100 for version 1.
- **Standard:** `docs/papers/standard.md` now says an essay's body can link its sources and other archive documents
  where it uses them, and explains a Harbour term where it first appears.
