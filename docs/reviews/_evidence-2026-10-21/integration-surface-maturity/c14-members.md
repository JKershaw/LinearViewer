# C14 members: surfaces rated done or High that a real finding hit (LIN-3766, scoring step)

Pin: LinearViewer `c5694b68`. Population: run 3's Trend Ledger parsed mechanically: 26 ids with a core/happy-path cell containing 4, plus 9 with High confidence and a lower score, = 35 of 41 (85%). The base rate is high, so the Self-Audit reports ids hit and fixed-versus-open, not yes/no.

## Arm 1: shipped-defect commits (regexes recorded; `rerun-outputs.md` Q34, Q35)

```
SUBJECT_RE = fix|leak|bypass|trust|dropped|silently|wrong|broken|regress|csrf|privacy   (case-insensitive, on subject)
EXCLUDE_RE = review|close-out|docs|test                                                  (case-insensitive, on subject)
BODY_RE    = class-\(a\)|behaviou?r fix|post-deploy|regression|\bbug\b                    (case-insensitive, subject + body)
```

Reconstructed regexes give 28 (subject minus exclusion) + 26 (body additions) = 54 candidates over 547 non-merge commits touching `lib routes server.js public`. The plan's 45 + 22 = 67 was not written down and does not reproduce; the **members are named commits and stand**. Kept rule: fixes behaviour already on `main` before its own PR; not a feature/copy/refactor/cleanup/in-PR review fix/window-new code; touches a file mapped to a population id via run-3 citations or C1; not already carried in that id's run-3 row.

| Commit | Ticket | Surface hit | Fixed or open |
| -- | -- | -- | -- |
| `4563046c` | LIN-3440 | `api-dispatch` (`lib/dispatch-validation.js` rejected GitHub issue ids) | fixed |
| `bf6f7507` | LIN-3561 | `api-jira-rest` (`lib/providers/jira/adf.js` href brackets) | fixed |
| `4ee0a2c7` | LIN-3578 | `mod-dispatch-queue`, `flow-operator-decisions` (lean build dropped an abort whose target had no digest) | fixed |
| `5bcd09be` | LIN-3163 | `api-mongodb-storage` (post-deploy index-key fix, `lib/db-indexes.js`) | fixed |
| `91fca7dd` | LIN-3591 | `mod-kpi-audit` (public `/kpis` free-tier count leak) | fixed |
| `d2d7d818` | LIN-3592 | `flow-autopilot-wake` (`waitForFollowUps` validated but never stamped) | fixed |
| `1f8010a0` | LIN-3579 | `mod-render-layer` (behaviour change inside the renderer rebuild) | fixed |
| `350242d5`, `0152606d`, `5c1e85ac` | LIN-3573, 3293, 3158 | `api-workspace-proxy` | fixed |
| `dbf3ecb8` | LIN-3378 | `mod-prompt-template-system` (four selector misroutes) | fixed |
| `ea6f0c37`, `1290ef75` | LIN-3323, 3278 | `flow-account-connection-workspace-credential` | fixed |

Four uncounted borderline commits (`ca5c902f` LIN-3677, `5388ce40` LIN-1892 S3, `c09e2d19` LIN-3241, `2469ac2b` LIN-3446); counting them adds `flow-followup-resume` and `flow-account-merge`.

## Arm 2: High-severity sibling / tracker findings in the editions fresh since run 3

Editions read (16 files dated after 2026-09-26, listing in `rerun-outputs.md` Q10): `security-review-2026-10-18`, `stability-review-2026-10-12` and `-10-21`, `code-quality-review-2026-10-12`, `-10-12-tests`, `-10-20`, `documentation-review-2026-10-21`, `drift-coherence-review-2026-10-11`, `-10-11-post-batch`, `-10-12`, `-10-18`, `-10-19`, `design-interface-review-2026-10-21`, `recent-headwinds-review-2026-10-21`, `seams-tangles-review-2026-10-13`, `-10-20`.

| Finding | Severity | Surface | State |
| -- | -- | -- | -- |
| LIN-3642 (OAuth `state` undefined) | High | `flow-oauth` | **Done, fixed** at `routes/auth.js:140` |
| LIN-3394 (no unique `urlKey` index) | High | `api-mongodb-storage` | **open** (Backlog) |
| LIN-1410 (bootstrap token inline in prompt text) | High | `flow-bootstrap-token-exchange` | **open** (Backlog) |
| Rulings feed `liveDispatchOnAnchor`, LIN-3281 | High (tracker; Security saw no cross-tenant read) | `flow-operator-decisions` | open, not re-verified by Security |
| Seams F1 (LLM & prompts ↔ Runs & dispatch 23/23) | High, structural | `mod-prompt-template-system` | open |
| Seams F2 (run/ordering logic in renderers) | High, structural | `mod-render-layer` | open |
| LIN-3404 (install callback trusted `installation_id`) | tracker defect | `api-github-app` | **Done, fixed** (`15c3b42c`) |
| Code Quality F-dashboard (`routes/dashboard.js` `createDashboardRoutes`, inclusive DP 467), LIN-3742 | High, structural | `mod-render-layer`, `flow-operator-decisions` (maps only to already-member ids) | open |
| Code Quality F-runner-kit (`runCommand` cyc 132), LIN-3741 | High | `api-runner-kit` (new id, outside the run-3 population) | open |

Removed as evidence by the plan: LIN-3745 (a docs-residue ticket) and Seams F3 (Medium, below the High bar).

## Members (14)

Core-4 ids (11 of 26): `api-dispatch`, `api-jira-rest`, `mod-dispatch-queue`, `api-mongodb-storage`, `mod-kpi-audit`, `flow-autopilot-wake`, `mod-render-layer`, `api-workspace-proxy`, `mod-prompt-template-system`, `flow-bootstrap-token-exchange`, `flow-operator-decisions`. High-only ids (3 of 9): `flow-account-connection-workspace-credential`, `flow-oauth`, `api-github-app`.

**Fixed (11):** every id whose only evidence is a fixed defect (recorded as a coverage caveat, run-3 precedent LIN-2993). **Open (3 findings on 3 ids), the only score-change candidates:** LIN-1410 (`flow-bootstrap-token-exchange`), LIN-3394 (`api-mongodb-storage`), the Rulings-feed item (`flow-operator-decisions`). A changed cell for any of the 14 needs its own path:line or stays unchanged.

Inventory gap, not C14: `brief-writer.js`, `workspace-token-cache.js`, `public/prompt-section.js` are cited nowhere in run 3.
