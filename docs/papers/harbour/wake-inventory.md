---
title: What are all the paths that wake a Harbour supervisor, and what does each wake lead to?
kind: paper
version: 2
date: 2026-09-30
authors: [Claude, for John Kershaw; Claude (LIN-3173)]
model: frontier tier, Claude Code CLI dispatched by simple-dispatcher. Version 1 (dispatch 48bb3a17, kind custom, LIN-3172); effort not recorded in the dispatch item; one bounded session with no research, plan, review or close-out legs, by the brief's design; two read-only in-session subagents of the same tier listed each repo's code paths, and every line cited here was re-read by the session. Version 2 is the independent check survey-check-5.md (dispatch 803de3ea, kind custom, LIN-3173), whose in-session subagents re-ran the scripts, walked both repos, read the 25 failure tickets and blind-coded a fresh sample of wakes
grounded_at: e308b871 (LinearViewer), 3366748 (simple-dispatcher); version 2 re-read at 04dc586d (LinearViewer)
cites: [lib/dispatch-store.js@e308b871:2162, lib/dispatch-store.js@e308b871:2077, lib/dispatch-store.js@e308b871:2273, lib/dispatch-store.js@e308b871:2300, lib/dispatch-store.js@e308b871:2320, lib/dispatch-store.js@e308b871:2457-2461, lib/dispatch-store.js@e308b871:817, lib/dispatch-wake.js@e308b871:60-62, lib/dispatch-wake.js@e308b871:151, lib/dispatch-wake.js@e308b871:164, lib/dispatch-wake.js@e308b871:170, lib/dispatch-wake.js@e308b871:194, lib/dispatch-terminal.js@e308b871:53, lib/digest-feedback.js@e308b871:336, lib/dispatch-factory.js@e308b871:272, lib/prompts/autopilot-kickoff.js@e308b871:94-105, lib/prompts/autopilot-kickoff.js@e308b871:156, lib/prompts/autopilot-kickoff.js@e308b871:369-370, docs/autopilot-kickoff.md@e308b871:307, lib/runner-kit/runner.mjs@e308b871:154-163, lib/runner-kit/runner.mjs@e308b871:340-361, docs/runner-prompt.md@e308b871:152-158, routes/proxy-dispatch.js@e308b871:220, routes/proxy-kickoff.js@e308b871:404, docs/autopilot-operating-manual.md@e308b871:319, docs/passage-runner-prompt.md@e308b871:130-131, simple-dispatcher/hook.js@3366748:418, simple-dispatcher/hook.js@3366748:1062-1072, simple-dispatcher/hook.js@3366748:1185-1191, simple-dispatcher/hook.js@3366748:1254, simple-dispatcher/hook.js@3366748:1278, simple-dispatcher/hook.js@3366748:1427, simple-dispatcher/hook.js@3366748:1441, simple-dispatcher/followup.js@3366748:48-60, simple-dispatcher/followup.js@3366748:86, simple-dispatcher/followup.js@3366748:95, simple-dispatcher/dispatcher.js@3366748:50, simple-dispatcher/dispatcher.js@3366748:571-577, simple-dispatcher/dispatcher.js@3366748:1175, simple-dispatcher/dispatcher.js@3366748:1884-1893, simple-dispatcher/reapers.js@3366748:444-485, simple-dispatcher/reapers.js@3366748:622, simple-dispatcher/reapers.js@3366748:877, simple-dispatcher/reapers.js@3366748:1009-1021, simple-dispatcher/reapers.js@3366748:1207, simple-dispatcher/reapers.js@3366748:1221, simple-dispatcher/reapers.js@3366748:1226, simple-dispatcher/reapers.js@3366748:1888-1893, simple-dispatcher/reapers.js@3366748:2326-2327, simple-dispatcher/reapers.js@3366748:2369-2381, simple-dispatcher/opencode-runner.js@3366748:642-675, simple-dispatcher/opencode-runner.js@3366748:733, simple-dispatcher/config.js@3366748:50, simple-dispatcher/config.js@3366748:112, simple-dispatcher/config.js@3366748:1088, docs/papers/harbour/what-doubled-the-dispatches.md (version 2), docs/papers/harbour/survey-check-4.md, docs/papers/harbour/survey-check-5.md, docs/papers/harbour/what-supervisors-do.md@e308b871, docs/papers/harbour/survey-check-2.md@e308b871, docs/papers/harbour/where-the-effort-goes.md@e308b871, docs/papers/harbour/fleet-complexity-read.md@e308b871, simple-dispatcher ac55263 (LIN-1219, 2026-07-10), LinearViewer 170fa88f (LIN-1357, 2026-07-15), simple-dispatcher adc256c (LIN-1260, 2026-07-11), LinearViewer 8372d336 (LIN-2121, 2026-09-13), LinearViewer 816bf9b7 (LIN-3098, 2026-09-29), LIN-353, LIN-430, LIN-870, LIN-1280, LIN-1451 (read 2026-09-30), the 25 failure tickets (re-read 2026-09-30 for version 2), LIN-3172 (2026-09-30)]
---

# What are all the paths that wake a Harbour supervisor, and what does each wake lead to?

Harbour creates every wake in one function, `addFeedback`, when a child's feedback begins with
a wake marker. Several things post such feedback besides the child itself: an abort, a halt,
simple-dispatcher's fast-fail and stall watchdogs, and a newer runner's watchdog. Two runners
deliver the wakes. simple-dispatcher either unblocks a Stop hook that is holding the session
open, or resumes a closed session with a handshake. Since 29 September, LinearViewer's own
runner kit continues a subagent instead. simple-dispatcher also adds its own turns to the same
sessions (the completion gate at a Stop, and stall re-fires), and it re-delivers some wakes it
lost. September's traffic splits by what woke the session. Terminal wakes, where a child
finished, led to an action 89% of the time. Pause wakes, where a child paused or said it was
still waiting, changed nothing 83% of the time. Most pause wakes are relays: a supervisor
handles a wake of its own, re-arms and posts `[pending] Not done — waiting on …`, and that
post wakes its own parent. 1,614 wakes (35% of September's 4,602) were such relays, and 97% of
them changed nothing. That is why one event climbs the whole stack. A worker event under a
stepper sends 1.6 wakes up the chain outside a passage, and 3.0 inside one, where it reaches
the Runner 0.8 times. In September, the code changes that landed took 18.9 Harbour wakes per
correct change when each wake is charged to the child's ticket, and 14.9 when it is charged
to the session it entered. Wakes took 29% of the weighted tokens in dispatched sessions, and
wakes that changed nothing took 12%. Of the 25 supervisor failures on record, 18 are on a wake
path. Fifteen of the 18 lost a wake, and 11 of those 15 were lost on the runner's side (the
hold, the resume, the gate, the stall failsafe or a session's own poll), not where Harbour
creates the wake.

![Who wakes whom in September: each edge's wakes, wakes per correct code change and the share that changed nothing](figures/wake-inventory/who-wakes-whom.svg)

## Findings

**Harbour mints in one place; delivery has more paths than the runner's hold and resume.**
Line numbers are at `e308b871` (LinearViewer, "LV") and `3366748` (simple-dispatcher, "SD").
The H rows are what Harbour mints or relays, the S rows what simple-dispatcher delivers or adds,
and R1 is LV's runner kit.

| # | Path | Code | Trigger | Who is woken | What it carries |
|---|---|---|---|---|---|
| H1 | Terminal wake | LV `lib/dispatch-store.js:2162` (`addFeedback`), `:2077` (`_mintWake`), the row `:2273`; `lib/dispatch-wake.js:151`; markers `lib/dispatch-terminal.js:53` | A new feedback line on a child's row begins `[done]`, `[complete]`, `[failed]` or `[aborted]`, and its edge names a parent | The dispatching parent: stepper, ticket autopilot, leg, Runner or coordinator | "A child session reached a terminal outcome — resume your cross-check." plus `Child:` and `Outcome:` (the line verbatim). Once per producing item (`dispatch-store.js:2320`, LIN-1357) |
| H2 | Blocked wake | same seam, key `id#blocked` (`dispatch-store.js:2300`) | `[blocked]` | as H1 | as H1 |
| H3 | Pause wake | `dispatch-wake.js:194`; `dispatch-store.js:2457-2461`, enqueued directly by `addItem`, not through `_mintWake` | `[pending]` on an edge declared `subscription: 'everything'` | as H1 | "A child session reached a pause boundary — paused (pending), not done." No guard: every post mints a wake |
| H4 | Lines posted for a child by someone else | SD abort `dispatcher.js:560-584` (LIN-1471), and halt's stop sweep through the same effects (`:1884-1893`, `:571-577`), post `[aborted]`; the fast-fail watchdog posts `[failed] Session fast-failed…` (`reapers.js:622`); stall force-fails post `[failed] Session … wedged` (`reapers.js:444-485`). The abort row itself is excluded (`dispatch-wake.js:164`, LIN-2078) | An abort, a halt, a launch stuck at an interactive gate, a wedged session | as H1 | as H1 |
| H5 | Grant refusal | `dispatch-store.js:2416-2419` | A structural grant refusal during H1–H3 | as H1 | A prefix on H1–H3, not a separate wake |
| H6 | Beats and follow-ups from a supervisor | `routes/proxy-dispatch.js:220`, recommend-and-dispatch (`:811`); the kickoff's liveness nudges (`lib/prompts/autopilot-kickoff.js:156`, `:369-370`) | A supervisor POSTs with `followUpTo` | A held worker, or a child | `beat N/M: …`, or a corrective beat. The duplicate guard skips follow-ups (`lib/dispatch-factory.js:272`) |
| H7 | Relays from a person | reply box, ruling reply, Task Chat and Flight Companion, all ending in a follow-up dispatch (`routes/dispatch.js:235`, `public/observation.js:3332`, `lib/chat-tools.js:2032`, `routes/flight-companion.js:883`) | A person answers | The session that owns the loop | The person's text verbatim |
| S1 | Warm signal | SD `followup.js:86`; `dispatcher.js:768-777`; `hook.js:1027-1051` | A follow-up for a session parked in its hold (`AWAITING_FOLLOWUP`, up to 60 min, `config.js:1088`) | The held session, in-process | "Your task (dispatch item X) is ready. Fetch it now …" (`hook.js:1062`) to a broker-armed session; otherwise the full prompt (`:1069-1072`) |
| S2 | Cold resume | `followup.js:95`; `dispatcher.js:860-1020` | A follow-up for a session that is closed or parked | A `--resume` relaunch | First "This session is being resumed to handle a follow-up … reply 'ready'" (`dispatcher.js:50`), then S1's line. Since LIN-1219 a DONE session is never held, so a follow-up after DONE always comes this way |
| S3 | Busy target | `followup.js:48-72`, `:107-111`; `dispatcher.js:662-673` | A follow-up for a running session | Nobody yet: the item is left unclaimed if it carries `queueIfBusy` (every wake does, `dispatch-wake.js:199`). With `force: true`, as stepper beats carry (`docs/autopilot-kickoff.md:307`), the running session is closed and cold-resumed; otherwise the item is rejected | — |
| S4 | Completion gate | `hook.js:418`, `:1278`; for opencode, a second self-check turn (`opencode-runner.js:642-675`) | The first Stop in a working phase, with no background wait outstanding | The same session | "Before this task is marked complete, confirm its true state." A `PENDING-EXTERNAL:` answer parks the session (`:1427`) and posts `[pending] Not done — <detail>. Awaiting completion...` (`:1441`). **That post is H3's trigger** |
| S5 | Zero-tool challenge | `hook.js:467`, `:1324` | DONE with no tool calls | The same session | "You declared DONE, but no tool calls were recorded …" |
| S6 | Stall failsafe | seven `find*` selectors in `reapers.js:1626-1749`, two of which fail a session rather than re-fire it; silence clock `config.js:50` (60 min) | A session silent for 60 minutes in a non-terminal phase | A `--resume` relaunch | "This session is being resumed by a failsafe …" (`reapers.js:1226`), then the re-ask "This session went silent while its completion was still unconfirmed …" (`:1207`), with a withdraw option for Claude sessions (`:1221`, `:2381`). Capped at three PENDING-EXTERNAL re-fires (`config.js:112`, `reapers.js:877`) |
| S7 | Hold expiry | `hook.js:1007-1018`, `:1452` (LIN-1260) | A hold lapses with no follow-up | Nobody: the session is parked `AWAITING_EXTERNAL`, and its next follow-up comes by S2 | — |
| S8 | The session's own wake-ups | Claude Code's background command, Monitor and scheduled wake-up; the hook lets the Stop through while one is outstanding (`hook.js:1254`) | The session armed a wait itself | The same session | A task notification. **This is the only path CI and PR results take**: neither repo has a CI or PR webhook or a poller that wakes anyone |
| S9 | opencode holds | `reapers.js:1882-1905`; `opencode-runner.js:733` (`holdForOpenCodeFollowUp`) | as S1, S6 for opencode sessions | A native relaunch | The follow-up prompt, or the re-fire text |
| S10 | Re-delivery of a lost follow-up | `expired-hold-followup` (LIN-2468, `reapers.js:2369-2377`); `stalled-bootstrap` (LIN-2259, `reapers.js:2326-2327`, `hook.js:1185-1191`); for opencode `reapers.js:1888-1893` | A follow-up signalled into a hold whose hook died, or a resume that stalled before its follow-up was injected | A `--resume` relaunch | The follow-up itself, re-injected ("Re-delivering the task after a stall") |
| R1 | LV runner kit (LIN-3098, 29 September) | `lib/runner-kit/runner.mjs:154-163`; `docs/runner-prompt.md:152-158`; served at `/api/proxy/runner/prompt` | Any `followUpTo` item, every wake included | The same subagent, continued by `SendMessage`: no Stop-hook hold, gate or handshake | The item. Its watchdog posts `[blocked] stalled: …` and `[failed] stalled: …`, and its recovery `[failed] runner restarted: subagent lost` (`runner.mjs:340-361`), each of which mints an H1 or H2 wake to the parent |

Some things are not wakes. The heartbeat only reports (`heartbeat.js:335-441`), and so does
cleanup. The abort, halt and fast-fail paths are not in this list: they post a line on a child's
row, which mints a wake (H4). Scheduled check-ins exist only as periodicals. Nothing in code
fires a periodical yet (`periodical-runs.js` leaves the trigger to LIN-1629), and one is meant
to start a fresh session, though the dispatch routes would accept a `periodicalId` with a
`followUpTo`. Harbour's rescue sweep that would re-deliver lost wakes (LIN-1717) is referenced
but not built (`dispatch-wake.js:161`); simple-dispatcher's S10 already re-delivers some.

Two dated changes shape the traffic. LIN-1357 (LV `170fa88f`, 15 July) moved the once-only
guard from the edge to the producing item, so every beat now sends a terminal wake: 1,221
worker→stepper terminal wakes in September. LIN-1219 (SD `ac55263`, 10 July) stopped holding
a session after DONE, so any later follow-up to a finished session takes S2, with its
handshake. The runner's log records 5,098 warm signals, 684 cold resumes and 711 rejections
in September. R1 landed on 29 September, after the traffic window, so none of the figures
below includes it.

**Terminal wakes do work; pause wakes mostly do not.** Every path into a dispatched session,
1–28 September. The first four columns count the path's own deliveries. The outcome columns
give the most consequential thing the session did before its next delivery, counting the
completion gate its Stop triggered.

| Path | Inventory | Deliveries | Per correct code change (LV / SD) | Changed nothing | Acted | Dispatched | Share of tokens |
|---|---|--:|--:|--:|--:|--:|--:|
| Terminal wake | H1, H2, H4 via S1/S2 | 2,264 | 11.3 (11.1 / 14.8) | 11% | 27% | 62% | 16% |
| Pause wake | H3 via S1/S2 | 2,338 | 7.6 (7.6 / 6.9) | 83% | 9% | 8% | 13% |
| Beat or follow-up into a held worker | H6 | 664 | 3.8 (4.0 / 2.6) | 20% | 78% | 3% | 15% |
| The session's own wake-ups | S8 | 788 | 3.7 (4.2 / 2.0) | 62% | 35% | 3% | 4% |
| Relayed ruling or note | H7, H6 | 339 | 1.5 (1.4 / 2.3) | 26% | 44% | 31% | 5% |
| Stall failsafe (123 re-fires, 85 re-asks) | S6 | 208 | 1.0 (1.0 / 1.0) | 89% | 9% | 2% | 1% |

![What each path into a held session led to in September, per correct code change](figures/wake-inventory/what-wakes-lead-to.svg)

The completion gate (S4) is not a row of its own, because it follows other deliveries rather
than starting anything. It asked 7,429 times, and 62% of the answers were `PENDING-EXTERNAL`.
The Runner answered that way 619 times out of 623, stepper and ticket autopilots 86–87% of the
time, and workers mostly answered DONE. The gate is 9% of all tokens, and it is a third (32%)
of what a wake that changed nothing costs. Such a wake typically costs 149k weighted units:
fetch the item, say "still waiting", answer the gate.

In total, the Harbour wakes charged to September's correct code changes ran at 18.9 per
change (LV 18.7, SD 21.6) by the child's ticket, 6.9 of which changed nothing. Charged to the
session each wake entered, the rule `survey-check-4.md` set for follow-ups, they ran at 14.9
(LV 15.3, SD 19.9), 3.4 of which changed nothing. The difference is the supervisor edges:
a relay into an autopilot, a leg or the Runner is charged to the child change under the first
rule and to the supervisor's own ticket, or to none, under the second. Wakes took 29% of
September's weighted tokens in dispatched Claude sessions, and wakes that changed nothing 12%.

**Who wakes whom.** Harbour wakes, 1–28 September, by the layer of the child that caused
the wake and the layer it woke:

| Edge (child → woken) | Wakes | Terminal / pause | Per correct code change (LV / SD) | Changed nothing | Were relays of the child's own wake |
|---|--:|--:|--:|--:|--:|
| worker → stepper | 1,555 | 1,221 / 334 | 7.8 (8.0 / 5.7) | 6% | 0% |
| worker → ticket autopilot | 777 | 777 / 0 | 4.2 (3.7 / 10.2) | 12% | 0% |
| stepper → ticket autopilot | 593 | 57 / 536 | 3.0 (3.0 / 2.9) | 92% | 91% |
| stepper → leg | 567 | 37 / 530 | 1.2 (1.2 / 0.7) | 95% | 91% |
| leg → Runner | 455 | 3 / 452 | 0.1 (0.1 / 0) | 95% | 97% |
| stepper → stepper | 253 | 28 / 225 | 1.3 (1.3 / 1.5) | 87% | 84% |
| worker → leg | 54 | 43 / 11 | 0.2 (0.2 / 0) | 13% | 0% |
| leg → worker | 7 | 1 / 6 | 0.06 | 71% | 86% |
| worker → Runner | 4 | 4 / 0 | 0 | 25% | 0% |
| child not linked | 337 | 93 / 244 | 1.0 | 77% | — |

The Runner's edge is small per correct change because of how it is charged, not because its
legs fly few code changes: 409 of its 455 wakes came from four legs whose sessions carry no
ticket of their own, each of which dispatched 12–34 tickets, so they fall to the passage epic,
which is excluded. In all, 567 wakes (12%) land on the two excluded epics. 617 wakes reached the
two Runners in the month. The edges from workers carry news: a beat or a worker's session
ended, or a worker paused for a decision. The edges from supervisors carry progress. On those
edges, 84–97% of wakes were caused by the child's handling of a wake of its own: the child was
woken, judged or sent a beat, and re-armed. Its re-arm posted `[pending]`, and that post woke
the parent.

**One worker event climbs the whole stack.** Each wake a worker's event caused is followed
up the chain through every wake it in turn caused:

| Where the worker's parent sits | Worker events | Wakes per event | At the stepper | At the ticket autopilot | At the leg | At the Runner | Changed nothing |
|---|--:|--:|--:|--:|--:|--:|--:|
| Ticket autopilot, no stepper | 777 | 1.00 | — | 1.00 | — | — | 12% |
| Stepper, outside a passage | 1,057 | 1.59 | 1.13 | 0.46 | — | — | 39% |
| Stepper inside a passage | 498 | 2.97 | 1.11 | — | 1.08 | 0.78 | 63% |

Inside a passage, 317 of those 498 events reached the Runner, and 340 made chains three or more
wakes deep. The stepper figure is above one because steppers nest. 462 of the 1,057 steppers
outside a passage have no linked parent, so they are not all known to sit under a ticket
autopilot.

**Most of what the relays carry is state the code already holds.** A relayed re-arm tells a
parent that the child it dispatched is waiting on the grandchild that child dispatched.
Three records hold that fact before the wake is sent:

- Harbour holds each child's rows and latest wake marker: `listItems(urlKey, { sessionId,
  followUpTo, rootItemId })` (`lib/dispatch-store.js:817`), and `feedbackDigest` keeps `wake:
  {marker, waitingMessage}` for every row (`lib/digest-feedback.js:336`). Its own comment says
  a wake "carries the same text the dashboard would show — no new lookup"
  (`dispatch-wake.js:60-62`).
- The runner records each child's parent at launch (`parentSessionId: item.sessionId`,
  `dispatcher.js:1175`) and knows when a parent has live subscribed children:

  ```js
  const anchors = new Set([session.rootItemId, session.itemMetadata?.itemId].filter(Boolean));
  ...
  if (!isSubscribed(meta)) continue;
  if (!anchors.has(meta.parentSessionId)) continue;
  if (TERMINAL_PHASES.includes(child.phase)) continue;       // terminal child self-clears
  return true;
  ```
  (`reapers.js:1009-1021`). It uses this to keep the stall reaper off the parent, and does not
  pass it to the parent.
- The parent dispatched the child and holds its id.

There are 1,614 of these relays in September: 35% of all wakes and 69% of pause wakes. 97% of
them changed nothing, and they took 9% of all tokens. A further 135 pause wakes came from a
supervisor child that had not just handled a wake: mostly at the child's own launch. 211 pause
wakes (9%) repeated, digits aside, the last outcome the same session had heard from the same
child; all 211 changed nothing, and 195 of them went to a Runner. Terminal wakes also carry
text Harbour holds, since `Outcome:` is the child's own last line. But the parent acts on them
89% of the time, so they carry news to it even though they repeat a record.

**Where two paths wake the same session for one event.** From the code, and counted where the
transcripts can see it:

- **A child's result, pushed and polled.** H1 pushes it. A supervisor's own background task can
  also be waiting on the same thing: supervisors took 72 task notifications in September, about
  55 of them CI or PR waits, and none is shown here to have raced a push. LIN-1323 is the case
  where such a wait did: the Stop hook let the poll override `PENDING-EXTERNAL`, and the wake
  sat queued behind it.
- **A silent session, re-asked twice.** The runner re-fires after 60 minutes (S6, 123 times). The
  kickoff also tells supervisors to send their own liveness nudge after about 30 minutes (H6,
  `autopilot-kickoff.js:156`, `:369-370`). Only a handful of September's follow-ups are named as
  such.
- **A re-fire that mints a wake.** A stall re-fire makes a waiting child answer PENDING-EXTERNAL
  again. S4 posts `[pending]` again, and H3 mints a new pause wake, because it has no guard: 27
  in September.
- **Pause, then done.** 97 times a child's pause wake was followed within five minutes by its
  terminal wake into the same session.
- **An abort.** An abort posts on two rows, and before LIN-2078 both minted a wake. The abort row
  is now excluded (`dispatch-wake.js:164`).
- **A forced beat into a running worker.** A `force: true` follow-up closes a live session and
  resumes it cold (S3), so a beat can interrupt a worker mid-turn.

**Most failures on record lost a wake, and most of those losses were in delivery, not in
minting.** The 25 are `what-supervisors-do.md`'s list as corrected by `survey-check-2.md`,
placed on the inventory by hand in `wake-inventory-failures.json` and re-read for version 2:

| Path | Failures | Tickets | Effect |
|---|--:|---|---|
| H1 terminal wake | 4 | LIN-1059, LIN-1165, LIN-1355, LIN-1357 | 3 lost, 1 duplicated (a self-loop) |
| H3 pause wake | 1 | LIN-881 | lost (no `everything` edge) |
| H4 aborted child | 1 | LIN-2078 | duplicated |
| S1 warm signal | 1 | LIN-870 | lost (the woken session zombied, after a wake or its own monitor) |
| S2 cold resume | 1 | LIN-1698 | lost, never re-delivered; the fix was in LV's witness, so the side is arguable |
| S4 completion gate | 3 | LIN-1280, LIN-1323, LIN-2145 | 2 lost (sentinel swallowed; a poll overrode `PENDING-EXTERNAL` and the wake sat queued), 1 misdelivered (the gate's turn overwrote the report the wake carried; unconfirmed, still in Backlog) |
| S6 stall failsafe | 5 | LIN-1451, LIN-1697, LIN-1816, LIN-2511, LIN-2517 | lost: a hung child never reaped, or a waiting parent killed (LIN-1816's own research puts it here, not on the wake) |
| S8 the session's own wake-ups | 1 | LIN-2932 | lost (a worker held behind its own CI monitor) |
| S9 opencode hold | 1 | LIN-2720 | lost |
| Not a wake path | 7 | LIN-353, LIN-366, LIN-384, LIN-1656, LIN-2974, LIN-2975 (dispatch); LIN-430 (merge) | — |

Of the 18 on wake paths, 15 lost a wake, 2 duplicated one and 1 delivered the wrong content.
Eleven of the 15 lost wakes were lost on the runner's side, in S1, S2, S4, S6, S8 and S9 (ten
if LIN-1698 is counted where its fix landed); the other four where Harbour mints them (H1, H3).
Eleven of the 18 sit where two paths touch the same session or event: the stall failsafe acting
on a session that was waiting to be woken (5), the completion gate beside the Stop hook's guard,
a poll or the wake's payload (3), a session's own monitor beside a hold or a warm signal (2),
and the abort's two rows (1). Twelve if LIN-1698's mint and resume count as two paths.

## Method

- **Population.** Every main transcript under `~/.claude/projects/*simple-dispatcher-workspaces*`
  modified since 29 August: 2,009 dispatched sessions, both repos' tickets. Figures cover 1–28
  September.
- **Deliveries.** A delivery is any user-role turn that is not a tool result: a launch, a Stop-hook
  injection, a handshake, a task notification, a scheduled wake-up. Each is classed by the
  runner's or harness's fixed text (the S rows above). A dispatch item's kind, and a wake's
  `Child:` and `Outcome:` lines, are read from the session's own fetch of the item. There are
  17,778 deliveries on 1–28 September.
- **Episodes and outcomes.** An episode is a delivery, plus the resume handshake just before it
  and the completion gates after it. Its outcome is the highest of: nothing, arm a wait, read,
  act (a proxy write, push, PR action, file edit or subagent), dispatch (POST `/dispatch`,
  kickoff, recommend-and-dispatch). "Changed nothing" means read or less. The outcome is read
  from tool inputs. Version 1's pattern counted `-d`, `--data` and `--json` as a write anywhere,
  so read-only `gh pr view --json`, `gh pr checks --json` and similar made 383 deliveries "act";
  version 2 counts them as a write only inside a `curl` call.
- **Relays.** A relay is a pause wake whose child is a supervisor and whose cause, the child's
  latest episode before it, was the child's handling of a wake of its own.
- **Blind check.** A fresh random sample of 80 of the 4,602 wakes was coded from the transcripts
  alone by a reader who had not seen the labels (`survey-check-5.md`): 74 of 80 agreed on
  changed nothing against acted (κ 0.84) under version 1's pattern, and all six disagreements
  were the `--json` reads above.
- **Tokens.** Weighted units as `fleet-complexity-read.md`: input 1, output 5, cache read 0.1,
  1-hour cache write 2, 5-minute cache write 1.25, with the mid tier at 0.6. Only shares are
  reported. In-session subagents are not counted; adding them (2.6% of units) would move the
  wakes' 29% to about 28%.
- **Edges.** Each wake's child session is found first through the parent link in the child's own
  dispatch item (1,586 wakes). Failing that, it is the session whose gate reply carried the
  wake's PENDING detail, or a DONE on the `Child:` issue, in the 15 minutes before (2,415). A
  beat named as such, or an outcome ending "(opencode)", is a worker with no transcript (264);
  337 stay unlinked. Layers follow `survey-effort-fleet.mjs`, with one change: a leg is an
  autopilot whose linked parent is a Runner. A wake's *cause* is the child's latest episode
  before it; that gives the relay column and the chains.
- **Per correct change.** Two charging rules. By the child: a wake belongs to its child's ticket
  (for a Runner wake, the leg's ticket), else its own issue line, else the woken session's. By
  the session entered: a wake belongs to the woken session's ticket. The denominator is changes
  (`survey-scorecard.mjs`, same-day snapshot) whose last merge fell on 1–28 September and whose
  first runner dispatch was on or after 30 August, so their whole history is in the transcripts.
  Passage epics LIN-3099 and LIN-2888 are excluded. The code cohort is 185 changes, 127 of them
  correct and complete: 108 LV and 22 SD, and a change in both counts in both. The numerator
  counts wakes on all 185 changes. The all-changes cohort adds docs-only work: 168 correct.
- **Failures.** By hand, in `docs/papers/harbour/wake-inventory-failures.json`. Version 1 re-read
  LIN-353, LIN-430, LIN-870, LIN-1280 and LIN-1451 over the proxy; version 2 re-read all 25.
- **Scripts.** `scripts/survey-doubling-runner.mjs --out data/survey-wake/runner.json`, then
  `scripts/survey-wake-extract.mjs`, `scripts/survey-wake-analyse.mjs` and
  `scripts/survey-wake-figures.mjs`. Version 2's outcomes come from
  `scripts/survey-check-5-wake.mjs --reclass --write data/check5-wake-v2`, analysed by the same
  analyse script over that directory; the same script with `--dir data/check5-wake-v2` gives
  the session-entered charging and the relay splits. Snapshots go to the git-ignored `data/`.

## Limits

- **Charging.** Neither rule gives a change its full supervision. Charged by the child, relays
  into the epics' autopilots and the Runner fall on the change below them, and wakes whose leg
  has no ticket fall on an excluded epic (567, 12%). Charged by the session entered, supervision
  above a change is left out. *Bias:* 18.9 is high for a change's own wakes and 14.9 low for
  its whole cost. `what-doubled-the-dispatches.md` v2 counts every runner follow-up into an
  autopilot, charged to the session entered, over all changes merged in the window: its 16 and
  18 for the two halves of September are not the same measure as either figure here.
- **30-day retention.** Transcripts start on 29 August. The cohort keeps only tickets first
  dispatched on or after 30 August, which drops the longest-lived tickets, and those are the
  ones with the most wakes. *Bias:* per-change figures are understated. September changes are
  also young, and their verdicts may fall, which would raise the per-change figures further.
- **opencode sessions leave no Claude transcript, and R1 postdates the window.** Their own
  turns, and any wake into an opencode supervisor, are invisible. The transcripts see 5,605 of
  the 5,782 follow-ups the runner's log delivered in September (97%). *Bias:* counts are
  slightly low, most at the worker layer.
- **Sampling and linking.** The traffic is a census of the transcripts, not a sample. 7% of
  wakes are unlinked and left off the edges. 52% are linked by matching text, which can pick
  the wrong sibling when two children post the same wait within 15 minutes. *Bias:* edge counts
  are low by up to 7%. The direction of mis-linking is unknown, but it cannot change a wake's
  terminal or pause class or its outcome.
- **"Changed nothing" is read from tool inputs.** A supervisor that judged a report and then
  re-armed counts as quiet: the blind reader judged 46 of 48 sampled terminal wakes to have
  carried news the session used, against 40 that wrote. A failed POST or a rejected push still
  counts as acted, and a write made inside a script counts as a read.
  `what-supervisors-do.md` classed steps by hand and found 31% of supervisor cycles quiet.
  *Bias:* terminal wakes' 11% overstates the wakes that were of no use. Pause wakes' 83% may be
  high, since some judged without writing.
- **The failures are the filed ones.** Judgement failures are rarely filed against a
  supervisor, and a lost wake that nobody noticed is not filed at all. *Bias:* this overstates
  the share on delivery paths relative to judgement, and understates the total. The placement is
  two readers', who agreed fully on 20 of 25.
- **Dispatches are not effort, and deliveries are not dispatches.** A wake re-reads a long
  context, and the gate after it re-reads it again. The token shares weigh this, but only for
  Claude sessions.

## Next

- **Which edges were declared `everything` because a layer wanted progress, and which inherited
  it?** The stepper needs every beat (`autopilot-kickoff.js:94-105`). The coordinator→child
  autopilot edge (`autopilot-operating-manual.md:319`) and the Runner→leg edge
  (`passage-runner-prompt.md:130-131`) carry the same level. Relays on those two edges are
  92–95% quiet. A question for John: were they meant to report progress, or only results?
- **Does a parent ever use a relayed re-arm?** For each of the 1,614 relays, find the parent's
  next episode that acted and check whether it cites anything the relay alone carried.
- **Which path does each layer actually act on when two report the same event?** Compare the
  27 re-fire wakes, the 97 pause-then-done pairs and the CI waits beside a push with what the
  woken session did next.
- **What do wakes look like inside opencode supervisors and the LV runner kit?** They are
  invisible here. The runner's opencode logs and the kit's ledger might show them.

The first goes into `proposals.md`.
