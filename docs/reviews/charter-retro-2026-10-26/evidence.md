# Evidence for the charter retro (LIN-4006)

Supports [README.md](README.md). Record reads were done 26 Oct 2026, about 09:00–09:25Z, against `origin/main` at `973d08eb`. Times are comment `createdAt` or commit times as the record gives them.

## 1. Inputs

Saved verbatim from the LIN-4006 comments. Each file is the comment body as the API returned it.

| File | Source comment | Written by |
|---|---|---|
| [inputs/input-1-code-review.md](inputs/input-1-code-review.md) | `03b37892` | fresh reader |
| [inputs/input-2-ticket-review.md](inputs/input-2-ticket-review.md) | `2a899b9f` | fresh reader |
| [../ui-design-gap-review-2026-10-26/README.md](../ui-design-gap-review-2026-10-26/README.md) | input 3, already on `main` (#2173), linked not copied | parties to the work |
| [inputs/input-4-operator-interventions.md](inputs/input-4-operator-interventions.md) | `7ac818bd` | operator |
| [inputs/input-5-open-items-at-close.md](inputs/input-5-open-items-at-close.md) | `ff4d3c58` | operator |
| [inputs/input-6-data-part-1.md](inputs/input-6-data-part-1.md) | `d3384a8a` | operator |
| [inputs/input-6-data-part-2.md](inputs/input-6-data-part-2.md) | `9c0da9bf` | operator |

The record's research comment (`50bc9f6d`, 09:07Z) is not an input. The README relies on it for citations the record gives, and each one is marked there as checked or not checked.

## 2. Claim check

**Checked against the record, and correct:**
- Input 2: P1 (with correction: round 2 on LIN-3977 blocked on history paging and a judge guard), P2, P4, P6, P7, and the Q7 contradictions.
- Input 4: §1, §3, §6.
- Input 5: the in-flight list and the rulings.
- Input 1: §1–§5, with the corrections below.

**Corrected by the record:**
- Input 2: LIN-3833 had 8 rulings (7 answered, 1 dismissed), not 7.
- Input 2: LIN-3977's round 2 blocked on history paging and a judge guard, not lanes.
- Input 2: dollar figures come from `/cost`, not ticket text. Spot-checked: LIN-3937 $52.33, LIN-3986 $4.56, LIN-3833 $50.86.
- Input 2: its page table says "six merged tickets" for Home, but lists LIN-3833 plus six others.
- Input 4 §2: the LIN-3952 ±100 was quoted by the implementer. No review held it. The 03:39 review says "+191, explained".
- Input 1: Next-run deleted lines at `2c836676` were 1,003, 569, 421, 223 and 146, not the base sizes.
- Input 1: `.btn` is emitted from about 11 files, not 13.
- Input 1: test-line growth is +27.6k to +28.5k, depending on scope.
- Operator time labels run 5–15 minutes after `createdAt` (e.g. "~18:40" was 18:24; "~19:50" was 19:35).

**Contradiction the record doesn't resolve:** input 2 says John never saw the briefs. The operator's 01:24Z comment on LIN-3952 says "the LIN-3978 brief John reviewed". Pre-launch comments on LIN-3975 to LIN-3983 are only "Open for John: answered" relays (19:11–19:35Z). Left as a question for John.

**Not checked:**
- Input 2 P8 (model and rounds; the Haiku trial reports at 14:30Z).
- Input 4 §5 and §8. The §8 claim is that the operator raised UI follow-ups to High so they would run.
- Input 4 §1: the ten-rule rules block, rule by rule.
- Input 6 durations, which come from another session's dashboard.
- Input 3's design judgements. Its code facts X1 and X2 were checked.
- The 80% and 91% meter readings. They appear only in LIN-4006 and the inputs.

## 3. Known before?

Recount: the research table has 13 rows. Six were known, six partly, and one not found. The research headline ("eleven of twelve") does not match its own table.

| Finding | Known? | Where | Why it didn't hold |
|---|---|---|---|
| Plan loops (S1) | Yes | Charter 25 Oct; `docs/papers/harbour/unwedge-or-breakdown.md` (LIN-2720) | Fired at the loop bound (`improvement-cycles.md:85`, 5 rounds). "Split after two" (LIN-3932, 03:03:24) is not in the runbook. |
| Several PRs (S2) | Partly | LIN-3891 item D; LIN-3906 (Done) | LIN-3906 covers one PR in ordered commits, not sequencing across PRs. The launch text contradicted the rules block. |
| Ticket growth (E2) | Yes | `docs/papers/harbour/tasks-generate-tasks.md:34`; `how-process-changes-land.md:57`; LIN-3548 | Follow-ups raised to High to pass the charter's filter. |
| Lanes and scope (E1) | Partly | `improvement-cycles.md:32` "Never two heavy at once"; `steady-base.md:173` | Your calls on record (24 Oct 08:33Z and 19:48Z, and the 25 Oct re-scope). |
| Amending running work (W1, R1) | Yes | `theseus-method-long.md:320` "Don't amend a running ticket" | The record gives no reason. The 25 Oct guidance (log 09:48Z) is looser. |
| Rules grow (R1) | Yes | `how-process-changes-land.md:20-23` | Adding outnumbers removing about six to one. Nothing on record retires a rule. |
| Predictions as inputs (O1) | **Not found** | Searched docs and tickets for prediction + visible/steer/blind/anchor | Predictions moved onto work tickets (cycle 1 kept them on LIN-3613) with no recorded reason. |
| Client copies server rules (O2) | Yes | `docs/papers/harbour/the-second-copy.md:29,131`; seams review 23 Oct F6; LIN-3546 (Backlog) | `public/` is outside the import graph the flank's done-test used. |
| Moves aren't reduction (T1, M1) | Partly | `theseus-method-long.md:330`, `:261`, `:448` | Success was measured by knots and decision points, not net lines. |
| Builders without prototypes (U1) | Partly, deliberate | LIN-3757 (23 Oct 20:40Z); LIN-3892 rules; `what-the-reviews-checked.md:15-16`; `the-hand-on-the-helm.md:14` | A chosen policy. Nothing checked builds against a prototype. The "design lessons" list (lesson 13) is in neither the repo nor the tracker. |
| Judge at rest (U2) | Partly | LIN-941 (Backlog since 3 Jul); LIN-3833 (25 Oct 12:25Z) | States were added one ticket at a time. |
| Production step (close-out) | Partly | LIN-3613 (19 Oct 06:44Z); `lib/prompt-template-defs.js:1048,1065` | Written up as a lesson the same day. |
| Stale charter | Yes | 12 Oct charter "Keep this charter current"; `improvement-cycles.md:91-93` | The bullet was dropped in the 23 Oct rewrite. |

## 4. Live ticket and PR state (26 Oct, ~09:00–09:25Z)

| Item | State |
|---|---|
| LIN-3975 | In Progress; PR 1 merged `2ab5e675` 06:34Z; #2169 open (PR 2–3, stacked, no CI) |
| LIN-3983 | In Progress; PR 1 #2171 merged 06:44Z (`d3f67854`); #2172 open |
| LIN-3952 | In Progress; #2165 open; ruling `lin3952-nojob-dispatch-audience` reads `gone` |
| LIN-3892 (parent) | Todo |
| LIN-3757 (parent) | Todo |
| LIN-3820 (parent) | Todo |
| LIN-3976 (run page) | Todo |
| LIN-3978 (Dispatch) | Todo |
| LIN-3982 (Swipe) | Todo |
| LIN-4002 (Live Console round 2) | Todo |
| LIN-3970 to LIN-3973 (Plain batches) | Backlog |
| LIN-3997 (Plain theme) | Backlog |
| LIN-3936 (Costs), LIN-3937 | Backlog; PR #2136 open |
| LIN-3758, LIN-3769, LIN-3770 | Todo, no outcome |
| LIN-3833, LIN-3962, LIN-3980, LIN-3995 | Done |
| LIN-3977, LIN-3986, LIN-4003 | Done |
| LIN-3912 (Next run deleted) | Done |

Eight rulings are unanswered, re-read from `GET /api/proxy/rulings` (count 8): `lin3983-default-feed-filter`, `lin3983-compact-row-rule`, `lin3983-breakdown-route`, `lin3983-pr1-scope`, `lin3975-pr-count`, `lin3975-stack-or-wait`, `lin3975-remainder-scope`, `lin3952-nojob-dispatch-audience`.

PR states, from `gh pr view`: #2165 OPEN; #2168 MERGED 06:34Z; #2169 OPEN; #2171 MERGED 06:44Z; #2172 OPEN; #2173 MERGED 08:21Z.

## 5. Code figures

| Figure | Value | Where |
|---|---|---|
| `public/prompt-section.js` | 2,302 lines (1,479 at base) | main |
| `routes/` total | 28,559 lines (26,955 at base) | main |
| `.row-state` colour | one colour | `public/style.css:1109` |
| `.opened-task-go` | blue | `public/run-control.css:137` |
| Production code growth | +9,725 lines (+4.8%) since `8e59ed62` | research, input 1 |
| CSS duplicate blocks | 35 → 29 | research, re-run |
| Knot pairs | 11 → 9 | research, re-run |
| `workspace-api.js` | 3,782 → 882 | research, input 2 |
| `dashboard.js` | 3,072 → 872 | research, input 2 |
| Settings consolidation | `ab481a49` (LIN-3889); decision-panel CSS `dfeabc20` copies `settings.css:741-773` | commit history |

## 6. Ticket searches

Title search across the team listing (3,947 tickets, all states), excluding Duplicate and Canceled. "None" means no title match. Titles only; descriptions were not searched.

- **Split after two, plan loops:** no open ticket. LIN-3651 (Done) set the loop bound at 5.
- **Amending running tickets:** no match.
- **Predictions on work tickets:** no match.
- **Several PRs, stacked bases or CI:** no match. LIN-3906 (Done), LIN-3075 (Backlog), LIN-4005 (Backlog) are adjacent.
- **Shared colour, state colour, title alignment:** no match. Adjacent: LIN-739, LIN-3123 (Backlog), LIN-3679 (Done).
- **Run rules client vs server:** LIN-3546 (Backlog) covers the `prompt-section.js` init decomposition only.
- **Judge coverage:** LIN-941 (Backlog) covers card-state snapshots. LIN-3996 (Backlog) covers judge tests not run in CI.

## 7. Counts

- Filed since 23 Oct (*not checked*: figures from input 6, not recounted): 234. Done 120, Canceled 5, In Progress 3, open 106. Of the open tickets, 104 have never run. Priced spend $1,478 (a floor, because implementation ran on the unpriced `claude-haiku-5-5` from about 24 Oct 21:00Z).
- Open tickets across the team listing: 1,346 (1,052 Backlog, 289 Todo, 5 In Progress), excluding 36 Duplicate.
- Meter readings, from input 5 and not re-read: 53% (24 Oct 19:45Z), 60% (25 Oct 07:00Z), 74% (17:07Z), 80% (19:40Z), 91% (26 Oct ~07:00Z).
