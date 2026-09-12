---
version: 1
date: 2026-09-12
authors: [Claude, John Kershaw]
grounded_at: 33c524d9
cites: [docs/papers/archive-proposal.md, lib/plan-review-round-trips.js, lib/effort-readout.js, docs/autopilot-operating-manual.md]
---

# Why does a plan go round plan-review more than once?

Because the gate is not judging the design. Over 30 days it approved a plan on first
pass **11.7%** of the time (11 of 94), and every send-back below asks for one more
member in an enumeration the plan already built. Loops cost **31.2% of session time and
38.3% of dollars**; resuming the original session recovers about **1%**.

## Findings

**The split.** Over 329 window-closing tickets with dispatch lineage (1,994 sessions):
first pass 452.5 h / $5,863.83, gate 132.4 h / $2,822.91, re-pass 72.2 h / $818.36 —
**68.9 / 20.2 / 11.0** by time, **61.7 / 29.7 / 8.6** by cost. Session time totals 657.2
h against 2,455.3 h wall-clock (3.74×), and orchestration kinds add 950.6 h / $3,202.82
that is neither pass nor gate.

**The plan gate loops; review mostly does not.** Of 94 tickets reaching plan-review, 83
(88%) were sent back at least once and **33 (35%) went round twice or more**; one went
five. Of 247 reaching review, 53 (21%) were sent back, only 9 (4%) twice or more.
Send-backs per ticket, 1.34 vs 0.26.

**What the send-backs ask for.** Vocabulary, fixed before reading: `sweep-short` (its
enumeration misses a member), `sibling-unreconciled` (it ignores work landed under the
same ground SHA), `case-unhandled` (a reachable state its new branch never names),
`claim-unverified` (a load-bearing claim fails on re-derivation). Second axis: answered
in the research comment, absent from it, or unknowable before code? Sample: every
send-back on the proposal's three named tickets.

| Ticket · gate · round | Quoted verdict | Ask | Research |
|---|---|---|---|
| 2650 · plan · 1 | "defects in the plan's *stated enumeration*, not its design" | sweep-short | absent |
| 2650 · review · 1 | "does not carry the backstop-not-guarantee disclaimer" | sibling-unreconciled | absent |
| 2720 · plan · 1 | "closes one of **three** stale-sentinel seams" | sweep-short | absent |
| 2720 · plan · 2 | "sweeps the `EXECUTING` class from the producer side only" | sweep-short | absent |
| 2754 · plan · 1 | "never reconciles … the LIN-2759 declared-consequence contract" | sibling-unreconciled | in research |
| 2754 · plan · 2 | "enumerates only the rows it expected" | case-unhandled | absent |
| 2754 · plan · 3 | "cannot fire: it compares an ISO string to a `Date`" | claim-unverified | absent |
| 2754 · plan · 4 | "still **one call site short** on the `resumable` branch" | sweep-short | in research |

Four of eight are `sweep-short`. **None asked for a different design** — two verdicts
volunteer as much (LIN-2437: "nothing here asks for a redesign"; LIN-2641: "Neither
touches the architecture"). **None was unknowable before code.** The window's two worst
loops agree: LIN-2641 took five rounds, the last conceding "**J1 is a fourth same-class
finding**"; LIN-2437 took three, the third "not a repeat of RC#1/RC#2's class". All
three ended by ruling, not approval; LIN-2754 never reached implementation.

**What a resume would save.** The 108 implementation re-pass legs cost 49.2 h / $497.11.
Timing each from dispatch to its first mutating tool call (103 of 108) — a ceiling: part
of that prefix is real diagnosis — gives **6.1–10.9 h and $69–$134**, a median 12.7% of
a leg; 16 legs also paid an `[onboarding]` bootstrap step averaging 6.6 min (1.76 h)
that a resume removes outright. It could land: the median gap to the predecessor's end
is 19 min — **88% inside the 1 h in-session hold** (`FOLLOWUP_HOLD_MS`), 96% inside the
6 h record retention (`REAP_INACTIVITY_MS`). Retention does not bind; the brief's "about
an hour" is that hold, not the reap. The loop, not the re-grounding, is the expense.

**One instrument is refuted.** `lib/plan-review-round-trips.js` pins "the endpoint is
censored at one revision cycle by the templates themselves", so "the observable shape is
0-vs-1, not 0-vs-2". Measured: 33 of 94 went round twice or more. `/effort-readout`
reads 200 rows (`EFFORT_READOUT_HISTORY_LIMIT`) — half a day here, since 100 rows
spanned 6 h 42 m — so it cannot see this window; its `ORCHESTRATION_KINDS` drops the
950.6 h above and `research` is `NOT_INSTRUMENTED_KINDS`. Neither prices a loop leg nor
reads a verdict past its token, so neither can say *what* was asked.

## What could not be measured

The verdict reader is a heading-anchored regex, hand-checked against 137 comments on
five tickets read end-to-end: 26 verdicts, no disagreements. But the module's own limit
1 warns that a third of `/verdict/i` comments restate an earlier verdict, and a looser
anchor inflated plan-review send-backs from 126 to 160; treat counts as ±10%.

The research axis is weakest: three of the eight are internal defects in the plan's own
text, where "was it in the research" is not well formed; coding them `absent` flatters
the research pass, not the plan.

The population is a census of identifiers ≥ LIN-1700 plus a 1-in-5 sample below. 81 of
410 in-window tickets report `noLineage`, invisible to this join; 119 report a null
`totalUsd`, so dollars are the priceable subset; canceled tickets, lacking
`completedAt`, were dated by their last comment; 49 legs report no duration.

Nothing measures whether the loops are worth it: a gate that sends back 88% of plans and
finds a real missing member each time may be the cheapest part of this pipeline; these
queries cannot tell that from ceremony.

```sh
B="$HARBOUR_LOCAL_BASE/api/proxy"   # sleep 1.05 between calls; proxy caps at 60/min
# 1 Population: page every issue, keep Done/Canceled; census >= LIN-1700 + 1-in-5 below
A=; while :; do R=$(curl -sG "$B/issues?limit=250" ${A:+--data-urlencode "after=$A"}); \
  echo "$R" >>issues.ndjson; echo "$R" | grep -q '"hasNextPage":true' || break; \
  A=$(python3 -c 'import json,sys;print(json.load(sys.stdin)["pageInfo"]["endCursor"])' <<<"$R"); sleep 1.1; done
# 2 Per ticket: completedAt (window = cost.window.appCallsSince) + comments (verdicts)
for k in $KEYS;  do curl -s "$B/issues/$k"      >>detail.ndjson; sleep 1.05; done
# 3 Per in-window ticket: the dispatch lineage, one worker session per row
for k in $INWIN; do curl -s "$B/issues/$k/cost" >>cost.ndjson;   sleep 1.05; done
#   leg class: kind in {autopilot,wake,custom,periodical} -> orchestration;
#   {plan-review,review} -> gate (and arms its pair); a kind seen after its gate -> re-pass;
#   else first pass. Sum durationMs/costUsd per class; wall-clock = last end - first dispatch.
# 4 Round trips: a verdict DECLARATION is a heading line containing "Verdict", or a line
#   opening with it, with approve|request changes|needs discussion within 220 chars; the last
#   such anchor wins; the comment's own opening heading must name a review and not a reaction
#   (revision|autopilot|ruling|pull|note|summary|close-out|beat|...). Attribute each to the
#   gate leg whose [dispatchedAt, +durationMs] window contains it. Per gate: tickets reached,
#   first-verdict == approve, and the distribution of non-approve counts.
# 5 Re-grounding: every row of each implementation re-pass lineage, for its heartbeats
for k in $IMPL_LOOPED; do curl -s "$B/dispatch?issueIdentifier=$k&limit=100" >>rows.ndjson; sleep 1.05; done
for i in $ROW_IDS;     do curl -s "$B/dispatch/$i"                           >>fb.ndjson;   sleep 1.05; done
#   prefix = leg dispatchedAt -> first '[working...] N tools in ...: ...Edit|Write...' heartbeat
#   (lower bound: the preceding heartbeat). onboarding = '[onboarding]' markers.
#   feasibility = re-pass dispatchedAt minus the previous implementation leg's end.
# 6 The retention bounds and the read-out's row cap, from source at 33c524d9
grep -nE 'FOLLOWUP_HOLD_MS|REAP_INACTIVITY_MS' ../simple-dispatcher/config.js
grep -nE 'EFFORT_READOUT_HISTORY_LIMIT' routes/dashboard.js
grep -nE 'ORCHESTRATION_KINDS|NOT_INSTRUMENTED_KINDS' lib/effort-readout.js
# 7 What half a day of dispatch looks like, for the 200-row cap above
curl -s "$B/dispatch?limit=100" | python3 -c 'import json,sys;d=json.load(sys.stdin)["items"];\
t=[x["dispatchedAt"] for x in d];print(len(d),min(t),max(t))'
```
