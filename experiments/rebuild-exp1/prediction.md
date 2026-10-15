# Experiment 1: prediction (written 15 Oct, before either arm launched)

These are honest guesses, to be scored afterwards. Base: the original `adf.js` at `2a07f3ea`.

- **Code shape:** 322 code lines, 457 comment lines, 60 functions, longest 43 code lines.
- **Decisions:** 153 decision points; 4 functions are over 10, the worst at 28. 29 regexes.
- **Tests:** they catch 87% of 645 planted faults (538 killed plus 23 timeouts); 84 survive. The provider tests add no catches.

## Arm A: informed, through Harbour

- **Merges:** about 80% likely, without needing John.
- **Sessions:** 5–10, taking 45–120 minutes; 1–2 review rounds.
- **Raises a `DECISION:`:** about 25% likely, most likely over a test that looks wrong, or comment loss flagged in review.
- **Adds new tests:** about 60% likely. If it does, 1–10 tests in the codec file.
- **Code lines:** 230–290, a cut of roughly 10–30%. Not dramatic: the original is already decent, and most of its size is decisions that must stay.
- **Comment lines:** 150–300.
- **Complexity:** the worst function falls from 28 to 15 or less; functions over 10 fall from 4 to 1–3.
- **Planted faults caught:** 82–92%, about the same.
- **Replay:**
  - no differences on inputs the tests use;
  - 0–5 groups of unpinned differences in the generated and real inputs, concentrated where survivors cluster today: the gate, the Markdown renderer and the inline parser.

## Arm B: clean room, one session here

- **All 133 codec tests pass:** about 90% likely, after several passes.
- **Passes the full suite as well:** about 75% likely. The provider and write-route tests are its main risk.
- **Code lines:** 220–400. Wider than A, because nothing anchors it.
- **Replay:** more unpinned differences than A, 3–20 groups, in the same regions.
- **Planted faults caught:** 78–92%.
- **Time:** 30–90 minutes.

## Change probe (nested bullet lists)

The rebuilt versions take the change with fewer separate edits than the original. The gap is modest.

## Overall

A comes out modestly cleaner, with the same utility. B is somewhat smaller or simpler in places, but drifts more in behaviour the tests don't pin.

The main lesson is expected to be about the tests, not the rebuild. Where they're strong (87% here), a rebuild is safe. The 84 gaps are where it can drift.
