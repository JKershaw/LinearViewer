# Spike 0: the ledger of named items, 2 to 25 Nov

Checked 26 Nov 2026, read-only. Sources: `log.md` (searched by keyword and read around each hit; 22 to 25 Nov read in full), `journey.md`, `notes-review.md`, `horizon/`, `integration/slice-2-carry.md`, `integration/design.md`, `integration/checks/`, and older survey files only where an item was still open after 15 Nov. Status was checked against Harbour's proxy (tickets, records, dispatch rows; GET only) and against code at main `5c33e4415` (LinearViewer) and `d692ac7` (simple-dispatcher). Duplicates are merged. "In plan" means the agreed next plan: (1) runner fixes, (2) the Harbour clean-up ticket, (3) slice 5, (4) slice 6, (5) held UI tickets. Paths without a folder are under `docs/plans/survey/`. Code paths are on main.

| # | Item | First named | Status | Evidence |
|---|---|---|---|---|
| 1 | Seven safety findings from the 10 Nov Security Review | 14 Nov, gate-2026-11-14.md:25 | **open** | 7 task records under task-309c83df, all open (task-37347dd4 … b5166546). LIN-4416 built none of them. John, 23 Nov: "nice test tasks", "not too essential" (log.md:5277) |
| 2 | LIN-4416 theme 1: verdict authority (three rules) | 11 Nov, asks.md:221 | **done** | LIN-4416 Done 24 Nov |
| 3 | LIN-4416 theme 2 (Periodical gate on every Done route), plus the rest of the 134 backlog-pass tickets | 24 Nov, log.md:5289 | **set aside** | John dropped theme 2 (decision-78b36850, log.md:5293). The rest stay in the backlog (log.md:5285) |
| 4 | LIN-4441: less time waiting on tests | 17 Nov, journey.md:62 | **done** | LIN-4441 Done |
| 5 | LIN-4463: front-end pages as modules | 17 Nov, journey.md:62 | **done** | LIN-4463 Done |
| 6 | LIN-4445: the loop on Jira (with the LIN-4452 live check) | 17 Nov, journey.md:62 | **set aside** | John, 21 Nov (log.md:5041). Linear still shows both In Progress. Jira findings to John stay open (ec383bcf, 830d4d1d) |
| 7 | LIN-4210: halt poll on a cold cache | 17 Nov, journey.md:62 | **done** | Dropped 20 Nov (log.md:4838); ticket Canceled. Stale finding-24c8b24f is still open to John |
| 8 | LIN-4512: rotate and retire keys after the 20 Nov leak | 20 Nov, log.md:4886 | **open** | Backlog, High. John meant to do it at the end of the following week. Not in the plan. finding-968a75fc open |
| 9 | LIN-4523: stopping a run stops all of it | 21 Nov, journey.md:291 | **set aside** | John, 21 Nov (log.md:5133). Ticket Todo |
| 10 | LIN-4498: a sibling's quoted PR read as this ticket's own landing | 19 Nov, journey.md:191 | **retired** | Slice 3 (LIN-4518/4520): the landing comes from change records (`lib/run-trail.js:9`). Ticket is still Backlog and could be closed |
| 11 | Left after LIN-4497: quoted close-out heading, quoted PR joining the blind read's landing (the LIN-4399 lead), selector's "PRs linked" | 19 Nov, journey.md:164 | **retired** | Slices 3 and 4: comment kinds are gone. "PRs linked" reads the records landing (`lib/recommendation-facts.js:423`). The blind-read comment guard is gone (LIN-4543) |
| 12 | Look-first skipped for a piece with an open blocker | 19 Nov, journey.md:163 | **done** | Closed 19 Nov on evidence: the manual holds dependents (log.md:4426). The skip stays by design (`lib/recommendation-look-first.js:166`) |
| 13 | LIN-4509: Flight Companion polish (remade) | 20 Nov, log.md:4830 | **open** | Backlog. Not in the plan |
| 14 | LIN-4510: a model ruling ignored by routing (remade) | 20 Nov, log.md:4830 | **open** | Backlog. Not re-checked since rulings became records |
| 15 | LIN-4511: provisioning script for the dispatcher box (remade) | 20 Nov, log.md:4830 | **open** | Backlog. Seven host-check findings to John are open (14ebac74, 33684f1f …) |
| 16 | LIN-4508: watch agents work as it happens | 20 Nov, log.md:4807 | **done** | LIN-4508 Done 25 Nov |
| 17 | Ship Biscuit misses the big picture | 20 Nov, log.md:4740 | **open** | No ticket found. Horizon item 4 |
| 18 | The smoothing pass, as one pass | 20 Nov, horizon/README.md:10 | **open** | Nothing filed. Its contents are rows 45–53 here; the clean-up ticket takes some |
| 19 | A Theseus rebuild of rulings after slice 4 | 19 Nov, integration/design.md:225 | **retired** | Slice 4 (LIN-4529) removed the ruling stores, scan and shelving. What's left reads question records (`lib/ruling-standing.js`, 68 lines). No Theseus filed |
| 20 | Provider-sync design (Harbour holds the primary copy) | 15 Nov, log.md:4206 | **set aside** | John: a follow-up after the slices, likely with Jira (integration/design.md:158) |
| 21 | Slice 5: lessons as records, notes' Lessons imported | 19 Nov, integration/design.md:207 | **in plan** | (3). Lessons still in `docs/areas/*.md` |
| 22 | Slice 6: wakes | 19 Nov, integration/design.md:141 | **in plan** | (4). LIN-4490 Backlog, slice not filed |
| 23 | Final readings and report after slice 6 | 22 Nov, journey.md:319 | **open** | Named in notes-review.md:39. Not in the agreed plan as written |
| 24 | Time-to-answer reading, due about a week after slice 4 | 24 Nov, log.md:5281 | **open** | finding-581bfa0e open. Not due until about 1 Dec. Not in the plan |
| 25 | Held-run reading (records waiting on a held run) | 24 Nov, log.md:5281 | **set aside** | Skipped unless John asks (log.md:5297). finding-484b88f6 open. It bears on slice 6 (see finding-f4c0b65d) |
| 26 | Brief-size reading | 24 Nov, log.md:5281 | **done** | Taken (finding-d8179c5c). Record left open |
| 27 | Slice 4 witness | 24 Nov, log.md:5281 | **done** | Witnessed on LIN-4416 (log.md:5297). finding-3dae8fea is still open (stale) |
| 28 | Slice 3 counts the blind read's queries | 19 Nov, log.md:4384 | **done** | LIN-4519: 0 blind-read query rows since cutover (finding-c32c5b34) |
| 29 | Move the blind read before review | 5 Nov, per log.md:5246 | **set aside** | "Left for later" (notes-review.md:10, journey.md:355) |
| 30 | Project findings buffer: finds to `project` with no reader (backlog tidy-ups included) | 18 Nov, log.md:4364 | **set aside** | John: they'll fold into planned work (journey.md:355). Open to project: 371 now (259 on 23 Nov) |
| 31 | Production access and permissions sweep (machine-specific access) | 23 Nov, log.md:5240 | **set aside** | John: later, or keep as is (notes-review.md:31) |
| 32 | `isEmptyStatement`: a non-empty old ledger read as empty | 19 Nov, slice-2-carry.md:21 | **retired** | Slice 3 P7 (LIN-4520). Not in lib/routes. finding-76683071 done |
| 33 | Frozen Waiting-list reader kept "for the import" | 19 Nov, slice-2-carry.md:7 | **done** | No such reader on main (LIN-4527) |
| 34 | Re-review six legacy-held tasks | 19 Nov, slice-2-carry.md:17 | **done** | "The six legacy tasks have cleared" (log.md:5091). finding-5ddda62d left open |
| 35 | Signed-in task-page and log check for "findings not read" | 19 Nov, slice-2-carry.md:20 | **open** | finding-0cc5a636 open to John |
| 36 | Two review questions: the hold for old reviews; the Home badge count | 19 Nov, slice-2-carry.md:39 | **unknown** | No record or ticket found. LIN-4546 ("quiet on Home") may cover the badge. Not checked |
| 37 | The import must not dispatch the seven tasks it creates | 19 Nov, journey.md:170 | **done** | Import ran 20 Nov (log.md:4784). The seven tasks are open and were never dispatched |
| 38 | simple-dispatcher's own Waiting lists not imported | 20 Nov, log.md:4757 | **open** | `sd:docs/areas/*.md` still has `## Waiting` (13 entries in 5 files) |
| 39 | Is John's name stored on his writes (person addressing)? | 19 Nov, log.md:4455 | **done** | LIN-4548 witness: finding-7c66d811 by person:John (log.md:5313) |
| 40 | Stale "taken" and queued dispatch rows | 19 Nov, journey.md:150 | **open** | 23 rows still "taken" (1 Sep – 20 Nov, incl. LIN-4494, LIN-4501). None queued |
| 41 | Close LIN-4491 (slice 1) once import and readings are done | 20 Nov, slice-2-carry.md:48 | **open** | Both done, but LIN-4491 still reads In Progress |
| 42 | Stray change records from P2's backstop | 21 Nov, journey.md:283 | **done** | findings 1e53ebaf and 0f91d9be done. Own PR only (#2488) |
| 43 | `lib/records/check.js` lets a stored non-URL change ref through | 21 Nov, log.md:5078 | **open** | Still at `lib/records/check.js:122-128`. No ticket |
| 44 | Slices 1–3 leftovers (ANY_EXTENSION, openItems, legacyLedgerOf, translator) | 21 Nov, log.md:5072 | **done** | LIN-4527 (#2487) and slice 3. None found on main |
| 45 | The same question raised twice (plan and breakdown loops) | 12 Nov, log.md:3348 | **retired** | Slice 4: asks are question records, and the ask API says check open ones first. Not logged again 23–25 Nov |
| 46 | A second `DECISION:` in a run dropped | 21 Nov, log.md:4957 | **retired** | Slice 4 removed `DECISION:` scraping (LIN-4541; sd 7465ba5) |
| 47 | Runs build the contested part while a ruling waits | 21 Nov, log.md:5031 | **open** | No change made for it |
| 48 | Engineering questions raised as rulings | 21 Nov, log.md:5057 | **open** | No change made. Not logged again 23–25 Nov |
| 49 | Close-out and blind-read deadlock | 20 Nov, log.md:4928 | **done** | #2492 fixed the parked close-out deadlock (log.md:5217); LIN-4544 allows one blind read per change |
| 50 | Close-out commits after approval aren't re-reviewed | 20 Nov, journey.md:261 | **done** | Slice 3 P8 (#2496) |
| 51 | Rows read "closed" while the run is still posting | 21 Nov, journey.md:262 | **unknown** | Origin not found in the log. Not checked in code |
| 52 | Refused follow-ups show as "failed" | 21 Nov, log.md:5025 | **unknown** | Not checked in dispatcher or Harbour code |
| 53 | No mid-turn visibility | 21 Nov, journey.md:264 | **done** | LIN-4508. Words live since 24 Nov 23:30 (log.md:5333) |
| 54 | Close-out's hand-back findings `to: review` have no owner | 22 Nov, log.md:5219 | **in plan** | (2). finding-145b1665 open |
| 55 | Edited piece plans get no fresh plan review | 22 Nov, log.md:5218 | **in plan** | (2) |
| 56 | John's three signed-in checks | 22 Nov, log.md:5211 | **open** | findings 598a59f0, b89ac5a3, da5bc495 all open. "Whenever suits"; not in the plan |
| 57 | Brief record parts built only with `?run=` | 22 Nov, log.md:5225 | **done** | Slice 4: brief from the run's records |
| 58 | A person's decision lacks its question's task | 23 Nov, log.md:5261 | **done** | LIN-4545. Seen live (log.md:5289) |
| 59 | A person's proxy-token comment counted as Harbour's | 24 Nov, log.md:5305 | **done** | LIN-4548 Done, both halves witnessed |
| 60 | Gate loop: repeated blind reads | 23 Nov, log.md:5243 | **done** | LIN-4544 Done, witnessed twice (log.md:5267) |
| 61 | A1: a re-review adds a new condition each round | 24 Nov, log.md:5315 | **in plan** | (2). Workaround in decision-5dbdf161 |
| 62 | Close-out and review wait on each other | 24 Nov, log.md:5315 | **in plan** | (4). finding-34ab47ef open |
| 63 | Stale questions nobody re-checks | 25 Nov, log.md:5339 | **in plan** | (4). No open questions now |
| 64 | Dismiss button says "this wasn't worth asking" | 23 Nov, log.md:5252 | **set aside** | John: part of his UI rebuild. Still at `lib/question-record-card.js:136` |
| 65 | Dismissal stored as `withdrawn`; chosen option not highlighted | 23 Nov, log.md:5255 | **done** | `dismissed` end added (`lib/records/kinds.json`, LIN-4550); `public/style.css:4362` |
| 66 | UI retro: pages changed without design or CSS | 23 Nov, log.md:5250 | **set aside** | John: his own planned UI work, kept off these lists (log.md:5265) |
| 67 | Nav rebuild | 23 Nov, log.md:5277 | **set aside** | "Not now" (John) |
| 68 | Held UI tickets LIN-4343, LIN-3976, LIN-4017 | 24 Nov, log.md:5321 | **in plan** | (5). Backlog, Todo, Backlog |
| 69 | LIN-4508: the transcript on a real phone and in dark mode | 25 Nov, log.md:5335 | **open** | finding-554005cc open to John. Not in the plan |
| 70 | Old feedback rows still hold raw secrets (backfill) | 25 Nov, log.md:5335 | **in plan** | (2). finding-ce6e4602 open |
| 71 | Reaper can delete a record with words still queued | 25 Nov, log.md:5335 | **in plan** | (2). finding-c93ea0bb open |
| 72 | Resume race: follow-up lost until the 60-minute failsafe | 25 Nov, log.md:5350 | **in plan** | (1). LIN-4569 Backlog. No fix on sd main |
| 73 | Phantom "tool running" from `api-request-blob` lines | 25 Nov, log.md:5350 | **in plan** | (1). No handling on sd main |
| 74 | Leaked `claude --resume` windows; machine crash | 25 Nov, log.md:5352 | **in plan** | (1). Kill still refused (`sd:signal-guard.js:190`) |
| 75 | After a restart: a failed re-fire isn't retried; a reboot-killed background wait isn't re-fired | 25 Nov, log.md:5360 | **in plan** | (1) covers the retry. Startup recovery itself isn't asked for |
| 76 | Long Bash waits (CI) look like stalls | 24 Nov, log.md:5331 | **done** | LIN-4508's mid-turn words show the wait (notes-review.md:26). The stall watch is unchanged |
| 77 | Railway no retry after a flaky scheduler lease-timing test | 25 Nov, log.md:5335 | **open** | No ticket found. Not in the plan |
| 78 | Log comments on LIN-4008 become John's findings | 24 Nov, log.md:5323 | **open** | Ended by hand each time. Not in the plan |
| 79 | Open findings to John pile up (mostly post-deploy checks NOT RUN) | 23 Nov, log.md:5265 | **open** | 61 open to John now (37 on 23 Nov), about 46 of them checks not run |
| 80 | Prompts assume Git; to be made optional | 21 Nov, log.md:5190 | **set aside** | John will do it later |
| 81 | Live Console shows little of the work | 14 Nov, log.md:4050 | **set aside** | John: "one to look into later" |
| 82 | The site is slow | 15 Nov, log.md:4208 | **set aside** | "A separate matter" |
| 83 | Settings (size, err larger) for later discussion | 22 Nov, log.md:5228 | **set aside** | John's list for later |
| 84 | Review how intuitive the API is for agents | 18 Nov, log.md:4364 | **done** | API review done 19 Nov (journey.md:100) |
| 85 | How hosting services fit into Harbour | 4 Nov, log.md:1369 | **set aside** | "For later" (John) |

Counts: done 25, retired 6, in plan 14, open 21, set aside 16, unknown 3.

## Open items not in the plan

- Seven safety findings (1). John has never parked them, just called them non-essential.
- LIN-4512 key rotation (8): High priority, and John's own date has passed.
- Remade tickets LIN-4509, 4510, 4511 (13–15), and Ship Biscuit's big picture (17).
- No smoothing pass filed (18). Rows 47 and 48 have no home.
- Final readings and report (23). Time-to-answer reading due about 1 Dec (24).
- Checks waiting on John: findings 0cc5a636 (35), 598a59f0, b89ac5a3, da5bc495 (56), 554005cc (69). The pile of 61 findings to John (79).
- simple-dispatcher's Waiting lists, 13 entries (38).
- Tidies: 23 stale "taken" rows (40); LIN-4491 still In Progress (41); LIN-4498 still Backlog though retired (10); stale records 5ddda62d, 3dae8fea, d8179c5c, 24c8b24f.
- `check.js` legacy change-ref pass (43).
- Railway deploy not retried after a flaky test (77). Log comments filed as findings (78).

## Unknowns

- Row 36: the hold for old reviews, and the Home badge count. No record found, and LIN-4546 wasn't read for it.
- Row 51: rows reading "closed" while still posting. Not traced to a log entry or to code.
- Row 52: refused follow-ups showing as "failed". The dispatcher's and Harbour's status code wasn't read.
