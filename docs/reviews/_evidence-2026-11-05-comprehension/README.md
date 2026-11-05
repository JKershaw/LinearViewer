# Evidence — Comprehension-Debt Review run 5 (LIN-4300), 2026-11-05

Grounding: LinearViewer `af55cb73`, simple-dispatcher `07c88f7`. Report: `docs/reviews/comprehension-debt-review-2026-11-05.md`.

| File | What it is |
|---|---|
| `comprehension-debt-c1-grep.txt` | The widened C1 (landing-status) grep over both repos, every hit with a verdict. |
| `comprehension-debt-retention-per-rebuild.txt` | `scripts/code-shape/retention.mjs` run by hand per rebuild/move commit in the window, plus the whole window, with a verdict per dropped ref. |
| `comprehension-debt-heartbeat-spike.mjs` / `.out.txt` | The N3 spike, now driving SD's real `buildHeartbeatMessage` instead of hand-typed strings; run 4's spike re-run beneath it. Run: `node docs/reviews/_evidence-2026-11-05-comprehension/comprehension-debt-heartbeat-spike.mjs <path-to-simple-dispatcher>` |
| `comprehension-debt-forward-ref-spike.txt` | Spike: forward-tense comments naming a ticket, resolved against the tracker. Tests whether a cheap check would catch the class. |
| `comprehension-debt-deleted-file-orphans.txt` | Orphan references to the window's deleted files (F7 class). |

Area walks were done by four fresh-context readers (one per area) and the author; every finding the report promotes was re-checked by the author at HEAD. Lines the author did not re-read are marked *reader* in the report.
