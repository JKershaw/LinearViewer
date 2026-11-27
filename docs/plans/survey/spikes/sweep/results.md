# Sweep results (27 Nov)

Pass 1 found 320 loose ends in the log (`A.md`–`G.md`, merged in `merged.md`). Pass 2 checked each one against the tickets, findings, code on main and the log's later lines (`check-1.md`–`check-3.md`, one line of evidence per item):

| Verdict | Items |
|---|---|
| done | 65 |
| tracked (open ticket or finding) | 101 |
| gone (no longer applies) | 43 |
| can't tell | 13 |
| **open, untracked** | **98** |

Below, the 98 open items are grouped, with duplicates merged. The ids point into the check files.

## 1. The runner and laptop, today (8)
G55 pause still on · G53 three Periodicals not re-run · G56 LIN-4573 (kitty tabs) vs the tmux switch · G54 kitty relaunch bug (`terminal-driver.js:1052`) · G51 "Queue token (legacy)" label (`lib/settings-keys.js:96`, not in LIN-4576) · G50 23 stale "taken" rows · G57 Remote Login, Apple report · G58 unexplained SIGHUP

## 2. Calls left with John (16)
- F12: the blind read still gates close-out (`lib/run-closeout-state.js:81`), against "measures report, never gate". LIN-4577 doesn't remove it.
- G11: Home's badge counts questions only, not the findings open to John.
- F21: Collective, plus about 1,500 lines nothing imports (`lib/swim-lanes.js`, `lib/swim-graph.js`).
- F8: the Periodical second read's one-month sunset (LIN-2323) was never reviewed.
- E30: the 51 tickets in the Duplicate state, including LIN-1808 (Urgent).
- E45 / G19: the cut rule ends a run on any narrowing; runs building contested parts; engineering questions raised to John.
- D14 / D15: an approvable option that needs his hand or claims he acted; the same question asked once per task blocked by one event.
- B11: an answer naming a person as doer still goes to the agent.
- B28: closing a ticket silently withdraws its open questions.
- G36 / G35: 369 findings open to project, up from 259 on 23 Nov; no bulk way to clear them.
- G39: every comment his token posts becomes a finding to end by hand.
- D26: two Surveys on every code task (his choice; a cost idea).
- G49: run-page steering and member view, cut from LIN-3976, have no ticket. PR #2344 is still open.
- F20: v1's fresh-account rehearsal never ran (`docs/v1.md:130`).
- F22 / F23 / F35: no end-to-end test of the product path; no outside project run through the loop.
- G33 / B14: the production access sweep; builders not told the Railway CLI exists.

## 3. John's ideas, untracked (13)
C6 tidy-vs-planted-duplication experiment · F14 mapping the code for big tidies · F15 clearing outlived choices by ruling · F16 a V1 milestone, then run other projects · F17 open to large rebuilds and to cutting features · F24 / G1 provider sync · F25 site speed · F34 standing rules becoming configuration · G28 Git-free close-out · G32 size settings · F3 Live Console showing custom and Periodical work · D12 benchmark data in the model picker · D11 free-tier evidence for Luna (see the note below)

## 4. Defects with an effect on use (15)
A3 an autopilot starting before its prerequisite lands · A7 a quiet follow-up can silence a parked worker's ending · B27 the 4 Nov dispatcher stop never investigated · D17 the markdown recommend returns empty during a live wait · E35 workspace teardown written twice (a missed copy leaves credentials alive) · G7 a rework can launch on a branch an older session still holds · G41 a flaky scheduler test can fail a deploy · G59 the autopilot manual still describes review's ledger (`docs/autopilot-operating-manual.md:487`) · F33 the Jira runbook misses two of LIN-4450's live checks · D45 `seams.mjs` can't read simple-dispatcher · E20 the unit suite reads `docs/reviews/` · F1 `fable` maps to 5.1 · G23 a stored non-URL change ref passes unchecked · C25 a `ship.js` path the shared fake refuses · B42 the place Survey doesn't know the repo

## 5. Checks never run on production (5)
A22, A30, B23 (October–early November rebuild checks) · E23 two close-out gate paths never seen live · B15 LIN-4164's witness, seen only in the log, so the ticket still reads "NOT RUN"

## 6. Code tidies, no effect on use (about 35)
A5, A9, A14, A17, A18, A26, A29, B9, B18, B19, B22, B24, B30, B38, C1, C2, C5, C7, C8, C10, C11, C15, C23, C24, C27, C28, C31, D19, D51, E33, E34, E39, F9, G26 (stale branches on origin)

## Note on D11 and today's free-tier change
John set the free-tier model to `openai/gpt-6.1-terra` on 27 Nov. If that was through `OPENROUTER_FREE_TIER_MODEL`, Harbour ignores it: `resolveFreeTierModel()` (`lib/openrouter.js:415-420`) accepts only ids on `FREE_TIER_MODEL_IDS`, which doesn't list terra. It falls back to `openai/gpt-5.4-mini` and logs a warning at boot. Checked in the code on main, 27 Nov; where John made the change isn't recorded.
