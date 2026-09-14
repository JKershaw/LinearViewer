---
title: Pre-ramp harness run, 14 September 2026
date: 2026-09-14
authors: [Claude, John Kershaw]
model: an Opus 5 autopilot driver (claude-code) launched from LIN-2875's brief; Flash 0731 on opencode for research, implementation and close-out; Opus 5 for review and one research; the conning session read ledgers and answered gates on the tickets and wrote this by hand
grounded_at: fcd0a71 (LinearViewer), 7617b731 (simple-dispatcher)
cites: [LIN-2875 (brief and the driver's two summary comments), LIN-2873 and simple-dispatcher PR #234, LIN-2872 with LIN-2869 and PR #1493, LIN-2837 and simple-dispatcher PR #235, LIN-2874 and LIN-2835 (research comments), LIN-2876 to LIN-2881, docs/papers/harbour/capability-ledger.md (edition 3), docs/papers/harbour/cheap-implementer.md (v6)]
---

# Pre-ramp harness run, 14 September 2026

Six tickets from the cheap-implementer bake-off's list of harness faults, run under an Opus
autopilot driver from a brief on LIN-2875 with the routing the capability ledger's second
edition gave: research, implementation and close-out on DeepSeek V4 Flash 0731 through
opencode, review and any plan on Opus. The conning session launched the driver at 06:56Z,
read each review ledger and posted the acceptance a cheap close-out waits for, answered
the driver's gates on the tickets, and after the driver finished at 10:43Z dispatched one
last leg and its review by hand.

## What landed

| Ticket | Outcome |
| -- | -- |
| LIN-2873, the runner's stalled note printed a placeholder id | Merged, Done. One Flash leg, one Opus review, two Flash close-outs (the first wedged). |
| LIN-2835, the usage relay reports the final turn only | Research done on Flash against four live opencode servers. Lane closed; the fix is a one-fetch runner change. |
| LIN-2874, two silent terminations | Research done on Opus after two Flash workers wedged. Case A was a Harbour 502 burst; case B is unprovable because the reaper deleted the log. |
| LIN-2872 with LIN-2869, the duplicate guard and the fused verb's dropped fields | Stopped after three Flash legs and two Opus send-backs. PR #1493 open; the fused-verb half is twice reviewed correct. Needs an Opus plan. |
| LIN-2837, a bare exit 1 hides the provider's refusal | «2837-OUTCOME» |

## What it cost

At Harbour's Opus 5 table, from the sessions' cumulative usage rows: the driver about $32
across seventeen wakes, fifty million cache-read tokens; five Opus reviews about $19; one
Opus research about $6; Flash two cents relayed, true figure under LIN-2835's reading
perhaps a dollar or two. About $57 API-equivalent, or 1.4 points of the weekly window,
against the $60 to $65 estimated before the run. The conning session's own usage is not
counted and was the larger line on 13 September.

## What was learned

- Flash shipped six implementation legs on harness code, five green with mutation
  witnesses, four wrong against the real feedback rows. Every defect was found by executing
  the shipped code against stored rows or against base, twice by the Opus reviewer and
  twice by the driver, never by CI. The tests carried the same assumption as the code.
- Each leg fixed the instance it was shown and left the next member of the class. Given an
  explicit criterion, Flash fixed the named thing first time and missed the unnamed one.
  The driver read this as under-specification; the conning session agrees and adds that
  research would have enumerated the class before the first leg in all three cases.
- Flash research cleared the Opus gate three of three across the two days for under a
  cent each. Research goes first on every cheap-worker ticket from here.
- The driver's discipline was the best yet seen on Harbour and its cost was the same as
  hand conning, because every wake re-reads its history. The saving is attention, not
  tokens, until context is compacted between wakes.
- Four opencode hangs across two days were one cause: a worker reading outside its clone
  raises an opencode permission prompt that a headless run cannot answer, and the runner
  reports it healthy throughout. One prompt line prevents it. LIN-2876 is the fix.
- The conning session's watcher missed the first review gate for fifty minutes because the
  lean list endpoint omits the session id it filtered on. The driver blocked twice on gates
  a human had already answered. Both are the observer's cost, not the driver's.

## Not proven

- Whether green-and-wrong on harness code is a Flash trait or a shape trait. No other model
  has been given one of these tickets.
- Whether research first actually cuts the round count. It is an inference from three
  cases, not a measurement.
- Whether the permission fix alone makes host state readable to a cheap worker, or the
  prompt line is still needed.
- What the driver would cost with beat-boundary compaction, or from the cloud Flight
  Companion.
- The true OpenRouter spend, until LIN-2835 lands.

## Filed

LIN-2876 (the permission wedge), LIN-2877 (the reaper deletes the only opencode log),
LIN-2878 (the heartbeat's elapsed clock resets each poll), LIN-2879 (a 502 burst ate a
finalize tail and the dispatcher does not retry a terminal post), LIN-2880 (decision blocks
from six sessions never reached the rulings feed), LIN-2881 (tag zero-token failures as
provider refusals in the readout).
