# Evidence for "Can a task finish with the codebase cleaner than it started?"

Two frozen folders, one per version of the paper: `2026-11-06/` (version 1, LIN-4315) and `2026-11-06-v2/`
(version 2). Each is read as it was frozen; nothing in them is edited, and each carries its own `manifest.json`.

**12 Nov 2026 (LIN-4439):** From this merge, the balance is the pre-merge `## Blind read`, counted by measure 1 (`scripts/stability-measures.mjs`; its declaration is `docs/reviews/stability-measures/README.md`), and the hand-run pass stops. The hand-run
blind passes these folders froze (the "Blind place scoring" comments, coded by
`../cleaner-than-it-started-scripts/code-blind.mjs`) were the last; they stay the paper's evidence and are not
continued. A diff-scoped read does not replace the Periodicals: LIN-4253 read better in both blind passes here, while
Seams & Tangles run 8 rated the area it touched worse (the paper's Finding 3).
