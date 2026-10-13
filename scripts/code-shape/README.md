# Code shape (prototype)

Prototype instruments from the 12–13 Oct coherence-loop session (LIN-3449), kept here as input for the Seams & Tangles periodical. They are not wired into anything yet.

- `measure.mjs <repoDir> <sha> <lv|sd>`: reads one git snapshot straight from the object store (no checkout) and prints JSON:
  - function sizes, parsed with acorn; route factories and file wrappers are marked as containers;
  - copied code: normalised 8-line windows that occur more than once;
  - per-file lines, giant functions, copied lines and resolved relative imports.

  Needs `acorn@8.12.1` and `acorn-walk@8.3.4`, which are not in package.json yet.
- `areas.py`: sorts production files into areas by path (a guide, not a rule), and aggregates size, giants, copies and imports between areas for each snapshot in `snaps.json`.
- `build_datasets.py`: builds the JSON datasets behind the "Harbour Code Bubbles" dashboard, including a hand-curated reading of the Drift & Coherence ledger.

Checks run when these were written:
- Function sizes match the Code Quality review (LIN-3543) on the 10 functions compared.
- The import count (1,478 links) matches the Drift review's Tarjan walk (1,476 links, two commits earlier).
