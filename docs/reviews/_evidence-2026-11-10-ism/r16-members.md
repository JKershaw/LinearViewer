# R16 members: done/High ids hit by a real finding in the window (run 4's C14 rule)

Pin: LinearViewer `9cf51ef72`; window `c5694b68..9cf51ef72`. Rule: run 4's C14, unchanged.
**Population:** ids whose run-4 core/happy-path score is 4 (split scores lead with 4) **or** whose run-4 confidence is
exactly High: **34 of 51** (run 4: 35 of 41 carried; run 4 counted Medium/High rows as High where the score was 4,
which this count also does). **Arm 1:** run 4's subject/body regexes, verbatim (`rerun-outputs.md` Q11): 260 non-merge
commits touching `lib routes server.js public`; subject regex minus exclusion 8, body-marker additions 17, union 25. Each
of the 25 was read; kept only where the body states a shipped defect. **Arm 2:** High-severity rows in sibling editions
that landed after run 4's listing (2026-10-23T09:41Z): API Quality, Test Coverage Gap, Security, Performance/Scale,
Data & Fetch Architecture (all 2026-10-23), Code Quality 2026-11-04, Stability 2026-11-04/11-08, Comprehension-Debt
2026-11-05, Design & Interface 2026-11-08, Dependency & Supply-Chain and Onboarding (2026-10-23). Structural/complexity
rows (Code Quality F-*) are not defects and are not counted, as in run 4.

## Hit, since fixed (6 ids; coverage caveats, no score change)

| id | Run-4 rating | Fix | What was wrong |
| -- | -- | -- | -- |
| `mod-effort-readout` | CHP 4 | `eb97e9968` (LIN-3857); `c3031ccc5` (LIN-1653) | effort dropped when the harness in force was opencode; `bug` bucketed as orchestration overhead in wall-clock and effort readouts |
| `api-runner-kit` | High | `0e6cd32e1` (LIN-3857) | the kit dropped a subagent's model/effort instead of posting it |
| `mod-task-create` | CHP 4 | `d0b6aa007` (LIN-3907) | the feedback route's 413 arm was unreachable over HTTP (a 12 MB parser refused first); attributed through this run's fold of `routes/workspace-api-feedback.js` |
| `mod-prompt-template-system` | CHP 4 | `8cca0193b` (LIN-3906) | the stage selector misread an Approve and a one-PR ordered-commit plan |
| `flow-run-evidence-closeout` | High | `f6e6a0233` (LIN-3903) | a post-deploy check close-out could not run held the close |
| `mod-dispatch-queue` | CHP 4, High | `ec9eed17e` (LIN-3805); `f4289aa64` (LIN-3811); `fcab9f712` (LIN-3812) | API Quality H1 (a store fault answered 404/401/empty 200); Data & Fetch H1 (30-day window unindexed); Data & Fetch H2 / Performance H2 (full rows by default) — all filed 2026-10-23, all fixed within days |

## Hit, open finding (6 ids; confidence cut where it was High)

| id | Run-4 rating | Finding | Ticket |
| -- | -- | -- | -- |
| `api-dispatch` | CHP 4, High | Test Coverage C1 (dispatch-token cross-workspace revoke and `tokenHash` exclusion unasserted); its API Quality H1 share was fixed by LIN-3805 | LIN-690 reads **Done** (2026-10-30), but a bounded search finds no such test: `tests/unit/dispatch-tokens.test.js` changed only by LIN-3795 in the window, and the wrong-workspace revoke test at `tests/unit/proxy-tokens.test.js:674` is the proxy store's |
| `flow-agent-grants` | CHP 4 | Test Coverage C1 (as above) | LIN-690 (as above) |
| `api-mongodb-storage` | CHP 4 | Security #2 (no unique `urlKey` index, carried); its Data & Fetch H1/H2 share was fixed by LIN-3811/3812 | LIN-3394 |
| `api-linear-graphql` | CHP 4, High | Performance H1 `stack-provider-fetch-linear-in-issues` (8.33 s median) | LIN-446 (Backlog) |
| `mod-provider-abstraction` | CHP 4, High | Data & Fetch H3 `tracker-reads-no-read-through` | LIN-446 (Backlog) |
| `flow-bootstrap-token-exchange` | CHP 4 | Security #3 (bootstrap token inline in prompt text, carried) | LIN-1410 |

**12 of 34 (35%)**; run 4: 14 of 35 (40%). Six fixed + six open (run 4: 11 + 3). Two open findings (LIN-3394,
LIN-1410) were already counted in run 4. The new hits come from editions run 4 could not read (the first Performance
and Data & Fetch reports, refreshed API Quality and Test Coverage). **The dispatch-store Highs are the clearest
evidence this window that a corrective sibling's finding becomes work quickly** (filed 2026-10-23, fixed by 2026-10-24):
the contrast with R7 is R21.

## Read, not counted

| Commit / row | Why |
| -- | -- |
| `cada192e0` (LIN-3798) | a test-environment defect (the referent guard sent the e2e session's fake token to api.linear.app); borderline on `api-dispatch`, already a hit |
| `9aa68bb82` (LIN-3795) | hardening (prefix and mask tokens on `/t/` pages); `flow-task-share` is outside the population (CHP 3, Medium/High) |
| `6ff38cf5c` (LIN-4263) | a real cost-read defect on `flow-cost-telemetry`, outside the population (CHP 3, Medium) |
| `300c811fa`, `722579ac0`, `400d7890e`, `48ae8d1dc`, `2a26c7b14`, `00c6261b5` and the other body-marker matches | presentation, test seeds, area-note bookkeeping or words matching the regex (`bug` as a task kind), no shipped defect |
| Area-note Waiting entries | 61 LinearViewer + 10 simple-dispatcher entries; mostly builder leftovers ("Survey tally") and structural tidies, not defects; none is counted |
| The brief's seed LIN-3642 (`flow-oauth`) | fixed before run 4's pin (`bc875ddc`) and counted in run 4 |
