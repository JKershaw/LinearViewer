# Observation page mockups (LIN-608)

Reference mockups for the Observation page layout/information polish. Attached by John
for the "match the mockups" follow-up to LIN-608 (the functional bug fixes shipped in #567).

- **`observation-collapsed-list.jpg`** — the collapsed session-card feed. Each card shows:
  the issue identifier + a bordered `in progress` status pill, an `updated Nm ago` timestamp,
  a bold title, a one/two-line description, a `runtime … model …` meta line, and a segmented
  per-worker-run progress bar with an `N/M` count on the right.
- **`observation-expanded-drilldown.jpg`** — an expanded card (Level-3 drill-down). Below the
  same card header it shows a one-sentence in-progress summary, then a per-worker-run tree of
  child rows: each row has a phase tag (`RESEARCH`, `PLAN`, …), a bold title, a `done` state on
  the right, a recap sentence, and metric chips (e.g. `14 call sites`, `1,204 files`, `4m 12s`).

These are visual targets only — match layout, spacing, typography weight/colour, the status
pill and progress-bar treatment, and the metric-chip styling. They are not pixel specs.
