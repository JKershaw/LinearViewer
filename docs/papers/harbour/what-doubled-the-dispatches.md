---
title: What doubled dispatches per correct change at 12 July, and what keeps them climbing?
kind: paper
version: 2
date: 2026-09-30
authors: [Claude (version 1, LIN-3170), Claude (version 2 corrections, LIN-3171), for John Kershaw]
model: "Version 1: frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 9712e6ce, kind custom, LIN-3170); effort not recorded in the dispatch item; one bounded session with no research, plan, review or close-out legs, by the brief's design. Version 2: frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 2d541647, kind custom, LIN-3171), effort not recorded in the dispatch item; the independent check survey-check-4.md"
revision: "Version 2 corrects, per docs/papers/harbour/survey-check-4.md (LIN-3171): version 1's count charged a follow-up to its own Issue line when it had one, and from 13 September (LIN-2121) a wake carries the Issue line of the child that triggered it, so late September's wakes into epics' and Runners' sessions were charged to the child change while earlier periods' were not. Counted one way throughout, late September is 36.3 dispatches per correct change, not 47.1; wakes 18.0, not 28.8; wakes per worker event 1.40, not 2.24, so the passage layer did not double them. LIN-1219 routes a follow-up to a finished session through a cold resume, not a new session: it lines up with the first rise in follow-ups (cold resumes 0.2 to 2.6 per correct change), not with fresh sessions, and LIN-1260 accounts for 5 of 222 follow-ups in 12-15 July. The held share's rise in 16-26 July fell back in August. The run logs also miss 13 July 15:23 to 14 July 16:50. The Issue-line count missed 29% before 13 July and 40-47% after. The September split is given both ways, with its order dependence, and the 'not in any row' share is characterised."
grounded_at: af372aba (LinearViewer), 3b1e734b (simple-dispatcher); version 2 at 25421c7c (LinearViewer)
cites: [docs/papers/harbour/survey-check-4.md (LIN-3171), docs/papers/harbour/model-choice.md@af372aba:25, docs/papers/harbour/model-choice.md@af372aba:144, docs/papers/harbour/model-choice.md@af372aba:170, docs/papers/harbour/where-the-effort-goes.md@af372aba:25, docs/papers/harbour/where-the-effort-goes.md@af372aba:135, docs/papers/harbour/survey-check-3.md@af372aba:248-249, docs/papers/harbour/what-supervisors-do.md@af372aba:23, docs/papers/harbour/what-supervisors-do.md@af372aba:81, docs/papers/harbour/survey-check.md@af372aba:146, docs/steady-base.md@af372aba:116-123, simple-dispatcher/dispatcher.js@3b1e734b:1250-1266, LinearViewer 5fc2bdd7 (LIN-826, 2026-06-30), simple-dispatcher f261380 (LIN-886, 2026-07-01), LinearViewer 1850aa91 (LIN-1059, 2026-07-05), simple-dispatcher ac55263 (LIN-1219, 2026-07-10), LinearViewer 3d883c97 (LIN-1206, 2026-07-10), simple-dispatcher adc256c (LIN-1260, 2026-07-11), simple-dispatcher 534b0a6 (LIN-1285, 2026-07-12), simple-dispatcher d0d003d (LIN-1266, 2026-07-12), LinearViewer 2c9eec3d (LIN-1292, 2026-07-12), LinearViewer 6ec69970 (LIN-1343, 2026-07-15), LinearViewer 170fa88f (LIN-1357, 2026-07-16), LinearViewer 2568272c (LIN-1390, 2026-07-17), LinearViewer a88c2cf7 (LIN-1602, 2026-07-26), LinearViewer 8372d336 (LIN-2121, 2026-09-13), LinearViewer 4ba5f9a0 (LIN-2872, 2026-09-13), LIN-3170 (2026-09-30), LIN-3171 (2026-09-30)]
---

# What doubled dispatches per correct change at 12 July, and what keeps them climbing?

Mostly wakes: follow-ups that wake a held autopilot when one of its children reaches a
boundary. Fresh sessions per correct change rose once, in July, and have been flat since
August. Counting every dispatch rather than only those whose log line names the ticket, a
correct code change took 7.6 dispatches in the fortnight before 12 July and 20.0 in the
fortnight after (both repos). Of that rise, +3.0 is fresh sessions and +9.4 is follow-ups;
8.0 of the later fortnight's follow-ups are wakes. The step came in two stages. Between 5 and
12 July (the logs have nothing in between) fresh sessions rose, and follow-ups rose as cold
resumes of sessions that had already finished. From 10 July a finished session is closed
rather than held (LIN-1219), so a follow-up to it resumes it cold; why fresh sessions rose is
not found. Follow-ups per held session rose from 15–16 July, when every stepper beat began to
wake its parent rather than only the first (LIN-1357). Since then the climb is mostly
wakes (10.0 of the 16.3 added since late July): 8.0 per correct change in late July, 9.5 in August, 16.1 in early September and 18.0
in late September. Fresh sessions stayed at 10.6–11.5. Every figure here charges a follow-up
to the ticket of the session it entered. From 13 September a wake also names the ticket of
the child that woke it (LIN-2121). Charged that way, late September's wakes into epics' and
Runners' sessions land on the child change too, and the figure is 28.8. Part of the climb that
`model-choice.md` reported is an artefact of its count: from mid-July until 13 September it
left out 40–47% of each ticket's dispatches. For September, the steady-base map's supervision
rows cover 53–59% of the dispatches, depending on the count. The remaining 32–36% is mostly
planning, review and close-out legs, the stepper beats inside plan and implementation
sessions, and cheap-tier sessions whose kind cannot be read. No candidate row names it.

![Dispatches per correct change by merge week, stacked by component, with every dated process change numbered](figures/what-doubled-the-dispatches/dispatches-by-week.svg)

## Findings

**The count `model-choice.md` used sees only part of each ticket, and the part it sees changed
twice.** That paper counted a dispatch only when its own block in the runner's log names the
ticket (`model-choice.md:170`). The runner prints `Issue:` only when the dispatch item carries an
issue id. Follow-ups began inheriting one from their anchor on the evening of 12 July
(LIN-1292, `2c9eec3d`). Wakes began carrying one on 13 September (LIN-2121, `8372d336`), and
it is the id of the child whose boundary triggered the wake, not of the session it enters. The
share of follow-up items with their own `Issue:` line was 9% in early July, 16–24% from mid-July
to mid-September, and 82% from 16 September. This paper's count charges a fresh session to its
own `Issue:` line and a follow-up to the ticket of the session it enters (the root of its
`followUpTo` chain):

| Merge period (code changes, both repos) | Changes | Correct | model-choice.md count | All dispatches | Fresh sessions | Follow-ups |
|---|--:|--:|--:|--:|--:|--:|
| 29 Jun–12 Jul | 80 | 63 | 5.4 | 7.6 | 5.1 | 2.5 |
| 13–26 Jul | 118 | 84 | 11.5 | 20.0 | 8.1 | 11.9 |
| 27 Jul–31 Aug | 251 | 165 | 13.3 | 22.4 | 10.6 | 11.8 |
| 1–13 Sep | 125 | 74 | 17.2 | 32.6 | 11.5 | 21.1 |
| 14–28 Sep | 85 | 66 | 47.0 | 36.3 | 11.5 | 24.8 |

All figures are per correct, complete change. The first column of figures reproduces
`model-choice.md`'s own all-tier count, 5.4 → 11.5 at the step, which it splits into 5.3 → 10.4
(frontier) and 7.1 → 12.9 (mid) (`model-choice.md:144`). By the full count, the step was
2.6-fold, not two-fold. The model-choice count left out 29% of the dispatches before the step
and 40–47% from the step to mid-September. In the last fortnight it is higher than the full
count. Wakes now name the child's ticket, so it charges the change with wakes that entered an
epic's or a Runner's session. There were 12.5 such wakes per correct change in the last
fortnight. Counted that way, the last fortnight is 47.1, not 36.3. Wakes into sessions of
tickets that are not code changes (epics, docs and open tickets, Runners) were a quarter to
half of all wakes in each week from mid-July to mid-September, and two-thirds or more after.
Before 13 September no count charged them to a change.

**At the step, the new dispatches came in two stages.** Only tickets whose runner history and
last merge both fall inside one logged window are counted here. That keeps out the thin June
logs and the 6–11 July gap:

| Cohort (first dispatch and last merge inside the window) | Correct | Per correct change | Fresh | Follow-ups | Of which cold resumes | Median per ticket |
|---|--:|--:|--:|--:|--:|--:|
| 1–5 Jul | 51 | 6.8 | 4.5 | 2.4 | 0.2 | 4 |
| 12–15 Jul | 18 | 12.9 | 7.9 | 5.0 | 2.6 | 8 |
| 16–26 Jul | 73 | 20.2 | 7.8 | 12.4 | 2.6 | 13 |

Every ticket in the first two cohorts, and 94 of the 103 in the third, went from first dispatch
to last merge in under a day, so the short first window is not what makes the first cohort
cheaper. The 12–15 July cohort is not fully observed: the run logs also have nothing from
13 July 15:23 to 14 July 16:50, and the oplog shows 103 items in 12–14 July that no run log
holds. Its figure is a floor. The first stage added fresh sessions and cold resumes. Warm
follow-ups stayed at 2.2–2.4 per correct change. In 1–5 July, 3 of 321 follow-ups resumed a
session that had already finished. In 12–15 July, 67 of 222 did. Among all fresh sessions, the
share later held open for follow-ups was 19% in 1–5 July and 20% in 12–15 July, then 33% in
16–26 July and 18% in August. Each held session took 4.8, then 4.7, then 7.4 follow-ups, and 8.4
in August. So follow-ups per held session did not change on 12 July itself. They changed from
15–16 July and stayed changed. Wakes and held autopilots were not new then: both began on
30 June–2 July (LIN-826 `5fc2bdd7`, LIN-886 `f261380`, LIN-906), before the first cohort.

**What lines up with each stage, and what is only coincidence.** Dates are first-parent commits
on `origin/main` (`scripts/survey-doubling-git.mjs`).

| Date | Repo | Change | What it did to the count |
|---|---|---|---|
| 30 Jun–2 Jul | both | Wakes into subscribed parents; held-and-woken autopilots; steppers; hold on by default (LIN-826, LIN-886, LIN-791, LIN-906) | Present in both cohorts, so they cannot explain the step. They are the machinery the later rise runs on |
| 5 Jul | LV | A terminal wake at most once per subscription edge, in place of one wake ever per item (LIN-1059) | Lands at the end of the first cohort. The 12–15 July cohort's held sessions behave like 1–5 July's, so no visible effect |
| 10 Jul | SD, LV | A DONE session is no longer held: it finalizes and its window closes (LIN-1219, LIN-1100). The autopilot stops closing windows itself (LIN-1206) | LIN-1219 sends a follow-up to a finished session through a cold resume on its own item, not a new session. It lines up with cold resumes of finished sessions rising from 0.2 to 2.6 per correct change. The warm follow-ups did not fall, so these resumes are extra follow-ups, and this data does not say what sent them |
| 11 Jul | SD | AWAITING_EXTERNAL: follow-ups to a session waiting on another party land instead of being rejected (LIN-1260) | Small: 5 of 222 follow-ups in 12–15 July resumed an AWAITING_EXTERNAL session |
| 6–12 Jul | both | Parallel child fan-out (LIN-874), the opencode harness (LIN-1077), dispatch defaults (LIN-1094–1099), and others | Fresh sessions rose from 4.5 to 7.9 in this window. No commit read here explains it, and kinds before 16 July cannot be read |
| 12 Jul | SD | Sessions run at the dispatch's tier (LIN-1285); Stop-hook cap 9 → 1000 and a re-fire for silent sessions (LIN-1266, LIN-1280); the oplog starts | The tier switch is coincidence for this question. `model-choice.md` found both tiers doubled. Stall re-fires stay near one per correct change throughout |
| 12 Jul | LV | Follow-ups inherit the anchor's issue id (LIN-1292) | Log only: the step in the model-choice count |
| 15–16 Jul | LV | A terminal wake for every distinct stepper beat, not only the first on each edge (LIN-1343, LIN-1357) | Lines up with the second stage: follow-ups per held session 4.7 → 7.4, follow-ups 5.0 → 12.4 per correct change. The held share's rise to 33% in the same days did not last |
| 17 Jul | LV | Dispatch presets per kind (LIN-1390) | Same fortnight. It sets models, not legs; no count mechanism found |
| 26 Jul | LV | Plan-review leg (LIN-1602) | Arrives as a new component: plan-review 0 → 1.1 fresh sessions per correct change in August |
| 13 Sep | LV | Wakes carry the triggering child's issue id (LIN-2121) | Log only for the model-choice count. For any count that follows the `Issue:` line, it moves wakes into epics' and Runners' sessions onto the child change |
| 13–17 Sep | LV | Passage Runner and legs live; single-anchor legs run as steppers (LIN-2872) | Lines up with wakes 16.1 → 18.0 per correct change, all of it on tickets a passage flew (below) |

**Which components stepped, which ramped, and which arrived later.** In the stacked series,
wakes stepped in mid-July, at about 8 per correct change. They held near 10 through August,
ramped to 16 in early September, and reached 18 in late September. Fresh worker legs ramped
through late July and early August: research, plan, plan-review, implementation, review and
close-out together went from 5.8 to 9.3. They have since stayed between 8.1 and 9.3. Within
them, review sessions held at 1.8–2.5. Review rounds per ticket rose from 0.86 in June to 1.82
in July (`survey-check-3.md:248-249`); review sessions cannot be counted before 16 July, so this
data cannot show that rise itself. Plan-review arrived on 26 July and has run at 1.0–1.2 since.
Autopilot launches ran at 0.9 per correct change until September and 1.3–1.4 after. Beats into
worker sessions ran at 2–3, then 4.5–4.8 in September. Of the 595 such beats a transcript read
(29 August on), 544 (91%) are stepper beats ("beat N/M"). Before 16 July no kind can be read,
because the bootstrap header that names it did not exist yet.

![Fresh sessions and follow-ups per correct change by period, and follow-ups per autopilot session](figures/what-doubled-the-dispatches/steps-and-beats.svg)

**Tickets did not need more steps after August. Each step was cut into more beats, and more
supervisors were woken by each beat.** Fresh sessions per correct change went 8.1, 10.6,
11.5 and 11.5 by period, and the per-ticket median went 5, 7, 6, 8. Follow-ups went 11.9, 11.8,
21.1 and 24.8, with a median of 6, 3, 9 and 14. That is `where-the-effort-goes.md`'s finding
(`:25`, `:135`), now split by kind. The follow-ups each autopilot session took went 8.6, 10.2, 11.9
and 14.3. Worker phases took few: after July a plan session took 0.4–0.9 beats, an
implementation session 0.4–1.2, and review and close-out under 0.3. The number of wakes per
worker event (a fresh worker session or a beat) is the clearest single measure:

| Period | Wakes per worker event | Wakes into a passage leg or Runner | Wakes into a stepper | Quiet share of wakes read |
|---|--:|--:|--:|--:|
| 13–26 Jul | 0.93 | – | – | not readable |
| 27 Jul–31 Aug | 0.83 | – | – | not readable |
| 1–13 Sep | 1.19 | 0 | 673 of 1,191 | 22% |
| 14–28 Sep | 1.40 | 371 of 1,190 | 406 | 12% |

Every layer above a worker wakes once per boundary it is subscribed to. The late-September
rise sits on the tickets a passage flew. The 12 changes with any dispatch in a Runner's or leg's
lineage (9 correct) took 81.8 dispatches and 41.2 wakes per correct change, at 1.62 wakes per
worker event. The other 73 (57 correct) took 29.1 and 14.4, at 1.32, below early September's
16.1 wakes. Above the changes, the passage layer also adds wakes into the Runner's session,
which is the passage epic's. Charged to the child change, as the log names them, those and the
epic autopilots' wakes raise late September to 2.24 wakes per worker event. They were not
charged to changes before 13 September, so that figure cannot be set against earlier periods.

**Re-beats inside a dispatch follow the wakes, not the gates.** These are Stop-hook turns that
are not dispatch items, counted per correct change from the oplog:

| Period | Stop-hook turns | "Not done yet" verdicts | PENDING-EXTERNAL pauses | Stall re-fires |
|---|--:|--:|--:|--:|
| 13–26 Jul | 56 | 5.1 | 8.4 | 1.2 |
| 27 Jul–31 Aug | 60 | 4.0 | 9.4 | 0.6 |
| 1–13 Sep | 76 | 2.7 | 14.4 | 0.8 |
| 14–28 Sep | 81 | 4.0 | 19.2 | 0.9 |

PENDING-EXTERNAL pauses track the wakes almost one for one: a woken supervisor that has
nothing to do says it is still waiting and parks again. The completion gate ("not done yet")
and the stall machinery are flat or falling. Compaction is negligible: 15 compaction
markers in the 2,012 transcripts kept since 29 August.

**Holding size fixed, the rise holds at every production-size band, and it is steepest for the
largest changes.** Dispatches per correct change, both repos:

| Production lines | 29 Jun–12 Jul | 13–26 Jul | 27 Jul–31 Aug | 1–13 Sep | 14–28 Sep |
|---|--:|--:|--:|--:|--:|
| 0 (docs or tests only) | 2 (2 correct) | 19 (6) | 10.8 (28) | 5.8 (18) | 39.6 (24) |
| 1–49 | 8.8 (18) | 16.5 (27) | 14.1 (68) | 20.8 (16) | 20.6 (19) |
| 50–299 | 6.3 (32) | 21.2 (45) | 26.9 (72) | 31.9 (36) | 32.3 (27) |
| 300 and over | 9.5 (13) | 23.2 (12) | 32.0 (25) | 42.2 (22) | 56.5 (20) |

![Dispatches per correct change by production-size band and period](figures/what-doubled-the-dispatches/by-size.svg)

Every band with more than a handful of changes nearly doubled or more at the step (1–49 lines
1.9-fold, 50–299 3.4-fold, 300 and over 2.4-fold). From August to late September the 300-line
band rose by three-quarters, the 1–49 band by about half and the 50–299 band by a fifth.
Docs-only work fell back in August and early September. In late September it rose to 40.
The passage epics themselves (LIN-3099 and LIN-2888,
whose own dispatches are the Runner's) are left out of every figure.

**Both repos show it.** LinearViewer went 8.5 → 22.1 → 23.0 → 30.7 → 38.8 dispatches per
correct change over the five periods. simple-dispatcher went 4.1 → 15.6 → 19.3 → 45.8 → 40.0,
on 10–29 correct changes a period. In both, wakes carry the rise: 19.6 and 22.5 wakes per
correct change in the last fortnight. A change that touched both repos counts in both.

**September by the steady-base map.** Code changes merged 1–28 September, both repos, 140
correct. Each dispatch goes to one bucket, in this order. The first column charges follow-ups
as the rest of this paper does: 4,803 dispatches, 34.3 per correct change. The second charges
them as the log names them from 13 September: 5,520 dispatches, 39.4 each.

| Bucket (`docs/steady-base.md` map row) | Per correct change (share), session entered | Per correct change (share), as the log names them |
|---|--:|--:|
| 2. Passage layer: every dispatch in a Runner's or leg's lineage | 2.8 (8%) | 6.0 (15%) |
| 1. Quiet wakes: the supervisor wrote nothing before its next wake | 2.5 (7%) | 4.0 (10%) |
| 3. Supervision that acted: autopilot launches and wakes followed by a write, dispatch, push or PR action (a ceiling for row 3) | 13.0 (38%) | 13.4 (34%) |
| 8. Review rounds after the first, and the re-implementation between them (a ceiling) | 2.4 (7%) | 2.4 (6%) |
| Test or CI beats: stepper beats named for tests, CI, push or PR | 1.1 (3%) | 1.1 (3%) |
| Not in any row: plan, plan-review, research, implementation, review and close-out sessions not counted above | 7.0 (20%) | 7.0 (18%) |
| Not in any row: other stepper beats | 2.8 (8%) | 2.8 (7%) |
| Not in any row: kind unread and other | 2.6 (8%) | 2.7 (7%) |

![September's dispatches per correct change split by steady-base candidate row, follow-ups charged to the session they entered](figures/what-doubled-the-dispatches/september-attribution.svg)

The order matters only among rows 1–3, whose total does not change. The passage bucket is
almost all wakes, and 56% of the passage wakes read were quiet. Taking quiet wakes first moves
them to row 1: by the log's naming, row 1 becomes 18% and row 2 7%. Taking the passage layer
last leaves it nearly empty and row 3 at 41%. Row 7 (size the process to the change) is a lens
across these buckets, not a bucket. Changes of 1–49 production lines outside the high-risk
paths took 15% of September's code dispatches, at 20.7 per correct change against 34.3 for all
code (23.8 against 39.4 by the log's naming). Docs-only changes took 25.1 per correct change.
Row 3's share is a ceiling. "Acted" here means any outward write, and `what-supervisors-do.md`
found most of a supervisor's actions mechanical (`:23`, `:81`). Of all September wakes read,
charged as the log names them, 33% had no outward action before the next task. That matches
that paper's 31% of wakes that change nothing. The quiet share is much lower in the wakes into
the change's own sessions (18% outside the passage layer) and much higher in the passage layer
and in epics' sessions. Row 8 is also a ceiling, because this data cannot tell a round that
changed only tests from one that changed code.

**What the share in no row holds.** By the log's naming it is 1,787 dispatches, 12.8 per
correct change. Two-thirds are fresh sessions and one-third follow-ups.

- *Legs, 979.* Close-out 199, review 197 (each ticket's first review; later ones are row 8),
  plan 191, implementation 160 (before the first review), plan-review 153 and research 79. Not
  all are first rounds: 215 are a second or later session of the same kind on the ticket. That
  is 84 plans, 84 plan-reviews, 40 close-outs and 7 others. Plan-review repeats outnumber first
  plan-reviews, 84 to 69.
- *Beats, 430.* They go into plan sessions (152), implementation sessions before review (136),
  research (73) and plan-review (54). Of those with a name, 299 are numbered stepper beats,
  mostly middle beats (210) and last beats (84). By their titles, 130 are planning work (framing,
  decisions, writing the plan), 76 verification or adversarial review, 28 building, 10 posting
  and 8 re-grounding. For the other 65, the title names none of these.
- *Kind unread and other, 378.* About 280 are cheap-tier sessions on the opencode harness and
  the follow-ups into them. They leave no Claude Code transcript, and their prompt length does
  not decode to a kind. The rest are custom (39), blocked (18), triage (9) and a few design,
  bug, scoping and spike sessions.

The share is the same in the two halves of September (897 and 890 dispatches). A fifth of it
(336) is on tickets a passage flew.

## Method

- **Population.** A change is `survey-model-git.mjs`'s: a ticket whose id names a first-parent
  commit on `origin/main` in either repo, dated by its last merge. *Correct* and *complete* come
  from the same-day scorecard snapshot (`survey-scorecard.mjs`). A change counts only if the
  runner logged at least one dispatch for it, as in `model-choice.md`. Code changes (production
  lines above zero) are the main series. Docs-only changes are shown by size. Passage epics are
  left out.
- **Dispatches.** Every item in `simple-dispatcher/state/dispatcher*.log` (20 June on; nothing for
  27 June 21:24 to 1 July 22:03, 4 July 16:24 to 5 July 15:43, 5 July 20:27 to 11 July 21:19,
  or 13 July 15:23 to 14 July 16:50; the oplog shows the runner was working in the last) that opened a fresh
  session, was resumed cold, or was signalled warm into a held one. Aborts, rejects and busy
  re-queues are not counted. A fresh session belongs to the ticket on its own `Issue:` line. A
  follow-up belongs to the ticket of the session it enters: the `Issue:` line of the root of its
  `followUpTo` chain. Version 1 used the follow-up's own `Issue:` line where it had one, which
  from 13 September names the triggering child's ticket; that reading is given where it differs.
  A dispatch is dated by its first oplog event (12 July on) or by its position in its log file.
  There are 19,450 dispatches, and no proxy calls were made.
- **Kind.** It is exact where a local transcript fetched the item: 29 August on, 3,408 items. Before
  that, a fresh session's kind is decoded from the logged length of its bootstrap prompt. The
  `# LIN-n · kind` header (16 July on, LIN-1361) adds the kind's length to one of three fixed
  bases (`dispatcher.js:1250-1266`). On September's exact launches the decoder is right 172 of 188
  times for autopilot, 151 of 155 for close-out, and 282 of 319 for review (the rest are custom,
  triage or design, which are also six letters). It is right every time for plan, plan-review,
  research and implementation. Autopilot and close-out share a length; a session that later
  took a follow-up is read as an autopilot. A follow-up takes the kind of the session it
  enters: a wake if that is an autopilot, a beat if it is a worker. The follow-up routes (warm
  signal, cold resume and the target session's phase) come from the run logs' `[follow-up]` lines.
- **Passage layer, quiet wakes.** A Runner is an autopilot session carrying the passage prompt. A
  leg is an autopilot on an issue a Runner dispatched, from 17 September. A wake is *quiet* when
  the supervisor's transcript shows no proxy write, dispatch, kickoff, push or PR action before
  its next task arrives. Wakes whose transcript is missing are split by the measured quiet share,
  and beats whose name is unread by the measured test/CI share.
- **Re-beats.** Stop-hook entries, "not done yet" verdicts and PENDING-EXTERNAL posts come from the
  oplog; stall re-fires come from the run logs; compactions come from the transcripts.
- **Scripts.** `scripts/survey-doubling-runner.mjs`, `survey-doubling-transcripts.mjs`,
  `survey-model-git.mjs --since 2026-05-01 --out data/survey-doubling/git.json`,
  `survey-doubling-git.mjs`, `survey-doubling-analyse.mjs` and `survey-doubling-figures.mjs`.
  Snapshots go to the git-ignored `data/survey-doubling/`; the scorecard is the same-day
  `data/survey/scorecard.json`. `survey-doubling-analyse.mjs` prints the log's-naming figures.
  `scripts/survey-check-4-doubling.mjs rekey` writes the runner snapshot charged to the session
  entered; `survey-doubling-analyse.mjs` and `survey-doubling-figures.mjs` run on it unchanged
  print this paper's main figures and draw its charts. The same script's other subcommands print
  the cohort shapes, the follow-up routes, the passage split, the bucket orders and the
  breakdown of the share in no row.

## Limits

- **July's run-log undercount (`survey-check.md:146`).** The logs have nothing from 6–11 July or
  from 13 July 15:23 to 14 July 16:50, and are thin before 1 July, so tickets merged in those
  weeks lose part of their history. *Bias:* the early-July gap lowers the pre-step figure and so
  overstates the step; the mid-July gap lowers the 12–15 July cohort. The 1–5 July window has no run log from 4 July
  16:24 to 5 July 15:43; whether the runner was stopped then cannot be told. The 1–5 and 16–26 July
  cohorts avoid both and still show 6.8 → 20.2, so the direction holds. The size of the step
  rests on 51 and 73 correct changes, and the first stage on 18.
- **Kinds before 16 July cannot be read.** The pre-step fresh sessions and follow-ups have no
  kind. *Bias:* none on the totals. It does prevent a kind-by-kind account of the step's fresh
  sessions, which is why no mechanism for them is found.
- **Two ways to charge a wake.** A wake is caused by the child's boundary but runs in the
  supervisor's session. Only the session is recorded before 13 September, so only that reading
  runs through every period. *Bias:* it leaves out the supervision above a change (epics'
  autopilots, the Runner) in every period alike, so it understates each ticket's full cost but
  not the trend. The log's reading overstates the late-September rise.
- **The decoder mislabels a few launches.** Twelve per cent of decoded "review" launches are
  other six-letter kinds, and 6% of autopilot/close-out calls are swapped. *Bias:* review and
  autopilot are slightly high before 29 August. The totals and the fresh/follow-up split are
  unaffected.
- **30-day retention.** Transcripts, and so exact kinds, quiet wakes and the passage layer, exist
  only from 29 August. *Bias:* direction unknown for the period split. September's attribution
  measures what August's cannot, so this paper cannot say whether August's wakes were as quiet.
- **September is immature.** Late-September changes are young, and their correct and complete
  verdicts may fall as faults are found, which would raise the per-correct-change figures. Tickets
  still open on 30 September are missing entirely, and their dispatches are the long-running ones.
  *Bias:* September's figures are understated. The passage split rests on 9 correct changes.
- **Quiet is read from actions, not outcomes.** A supervisor that only re-armed a wait, or wrote
  a note, counts as acted if it posted anything. *Bias:* row 1 is understated and row 3
  overstated.
- **Row 8 is a ceiling, and the test/CI match is loose.** Row 8 counts every review round after
  the first, and every implementation launched after the first review, whether or not the round
  changed only tests. The test/CI pattern also matches some planning titles ("test plan", words
  ending in "red"); a stricter pattern gives 2.6% instead of 2.8%. *Bias:* row 8 is overstated.
- **Dispatches are not effort.** A wake re-reads a long context. A beat is short. `where-the-effort-goes.md`
  weighs them in tokens. *Bias:* none on the count, but a share of dispatches is not a share
  of cost.

## Next

- **How many wakes could the runner have held back without changing what any supervisor did?**
  By late September each worker event sends 1.4 wakes up to a change's own supervisors, and more
  to epics and Runners, and PENDING-EXTERNAL pauses track them one for one. A question for John:
  is one wake per layer per boundary the design, or an artefact of subscribing every layer?
- **What raised fresh sessions between 5 and 12 July, and what sent follow-ups to finished
  sessions?** Read Harbour's dispatch reasons for July's launches and resumes, if any record
  survives, against the tickets' earlier sessions.
- **Is the quiet share in August what it is in September?** Only if some wake-level record from
  before 29 August can be recovered. Otherwise the answer waits for LIN-3157's longer retention.

The first goes into `proposals.md`.
