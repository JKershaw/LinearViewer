---
title: Can parallel lanes coordinate with each other, and what would helping them do it unlock?
kind: paper
version: 3
date: 2026-11-14
authors: [Claude (LIN-4480), for John Kershaw]
model: "claude-opus-5-5 (Opus 5.5), Claude Code CLI, dispatched by Harbour as custom prompts; effort not recorded in either session. Version 1: dispatch 1eb99179. Two in-session subagents of the same model did legwork there: one listed Harbour's inter-session channels from the code and tracker, and one found and checked the outside sources. Version 2: dispatch 5806367e, a separate session that revised the paper against the independent review relayed on LIN-4480 (comment c5605fc9). It re-read every finding the review touched at source, re-ran the census, and re-fetched the 2026 preprints and the 2021 congruence study. Version 3: three small corrections by claude-opus-5-5 (Opus 5.5), Claude Code CLI, dispatch a0e0c2e5 (LIN-4484), from the independent review of the essay notes-across-the-border.md relayed on LIN-4484 (comment 0d55a019), each re-read at source: the proposal d3ba7421 spells out a fallback for its first move only; three of the four later asks, not four, are default-consent notices (0510ffe0 asks for confirmation, and b564445b adds the go-ahead 24 minutes later); and finding 8's six-minute deadline is set against the hours no stage ran on LIN-4448, not against stage length. Checked: lanes-across-the-seam-check.md, of version 1. The version 2 and 3 changes have not been read by a second checker."
grounded_at: fb358dbda (LinearViewer origin/main, 14 Nov 2026 09:49Z), plus 06a7da871 (14 Nov 10:52Z) for LIN-4448's close-out only; 7d5fe7d (simple-dispatcher); tracker and dispatch rows re-read 14 Nov 2026 about 11:00Z through the workspace proxy
cites:
  - "LIN-4447 and LIN-4448, the ## As asked blocks (13 Nov 12:08Z): each names the other lane as owner of the far side of the seam"
  - "LIN-4447 comments dc7461eb (Unblock, 13 Nov 13:37Z), 08c9c898 (reply, 15:39Z), 097a3442 (correction, 15:55Z), 15a858eb (fallback used, 17:30Z), 15de14a7 (heads-up, 21:49Z), b555094d (seam notice, 21:58Z), 91473853 (after-read), 3300ab65 / 36a9d8e0 / 29848ba2 (LIN-4470's reads, 14 Nov 09:17Z), 87474316 (ruling) and f691817e (close-out, 14 Nov 09:01–09:02Z)"
  - "LIN-4448 comments d3ba7421 (proposal, 13 Nov 13:36Z), 643eef60 (John's ruling on the cuts, 15:33Z), 6bc02d3f (plan written, 15:39Z), 72406236 (plan review, 15:49Z, note 7), 1a2e7cba / 0510ffe0 (renewed asks, 16:42Z), b564445b (addition, 17:06Z), 882fc992 (review, 20:34Z), 0860f7b8 (DECISION, 21:57Z), 83e69cd5 (ruling applied, 22:03Z), a43a748d and d827aa8e (LIN-4470, 14 Nov 09:15–09:18Z), 1137e1e4 (ruling, 10:29Z), 7fcd63b2 (blind read, 10:44Z), 5cfdaa1e (close-out, 10:54Z); the description's Implementation Plan ('Moves to Runs (LIN-4447), agreed below')"
  - "LIN-4468 comments 732e3364 (engineering settlement, 13 Nov 21:58Z) and 24e376c1 (John's ruling, 22:00Z)"
  - "LIN-4463 comments 11814310 (unblock analysis, 13 Nov 18:58Z) and 6bd2401a (its correction, 19:05Z); LIN-4458 ed641bd8; LIN-4446 47fdad91"
  - "Dispatch rows for every Runs and LLM ticket (lanes-across-the-seam-evidence/dispatches.json); dispatch prompts 31d2a914 (blocked), 8e1f52c8 (plan) and 2d65d300 (breakdown)"
  - "PR #2432 (merged 13 Nov 17:12Z), PR #2433 (merge commit e666c4b60, 19:44Z; branch merge e102e095a, 19:12Z), PR #2435, PR #2438, PR #2439 (head 3bf1229c3), PR #2440, PR #2441 (merge commit dc12ca51b, 20:42Z), PR #2443 (merge commit b937237a4, 22:29Z), PR #2450 (14 Nov 09:49Z), PR #2457 (merge commit 06a7da871, 14 Nov 10:52Z)"
  - "docs/areas/areas.json@06a7da871:28,44 and docs/areas/runs-and-dispatch.md@06a7da871:182-186 (the close-out's two changes)"
  - "lib/prompts/stage-kinds.js@fb358dbda:48; lib/prompt-template-defs.js@fb358dbda:117; lib/prompt-formatters.js@fb358dbda:171; docs/autopilot-operating-manual.md@fb358dbda:439"
  - "lib/run-trail.js@fb358dbda:216-225; lib/stage-router.js@fb358dbda:29; lib/recommendation-blind-read.js@fb358dbda:58"
  - "lib/providers/linear/index.js@fb358dbda:915-925; lib/prompts/prompt-context.js@fb358dbda:12-14; lib/openrouter.js@fb358dbda:724-740,937-943"
  - "lib/dispatch-wake.js@fb358dbda:85-101,189-221; routes/proxy-dispatch.js@fb358dbda:252; docs/proxy-integration.md@fb358dbda:116-122,158-167; followup.js@7d5fe7d:35-60"
  - 'docs/architecture/dispatch-and-proxy.md@fb358dbda:103-106, where Harbour ("stores and forwards the id blindly")'
  - "routes/proxy-writes.js@fb358dbda:287-300; lib/stage-writes.js@fb358dbda:98-101; lib/run-live-wait.js@fb358dbda:26-30; lib/agent-status-store.js@fb358dbda:1-21"
  - "docs/worker-lane-prompt.md@fb358dbda:66-75; docs/runbooks/improvement-cycles.md@fb358dbda:80-81; docs/autopilot-operating-manual.md@fb358dbda:272-276"
  - "docs/areas/runs-and-dispatch.md@fb358dbda:175-181"
  - "docs/papers/harbour/what-hides-between-sessions.md@8495442ed:74,108,220-222; docs/papers/harbour/between-the-sessions.md@8495442ed:122-126; docs/papers/harbour/wake-inventory.md@fb358dbda:110-111 (version 2)"
  - "LIN-415 (follow-ups, June), LIN-826 and LIN-827 (push-based inter-session communication, 30 Jun), LIN-876 (messaging between autopilot layers, Canceled, description read 14 Nov), LIN-2258, LIN-2368"
  - "Outside sources, each linked where used: Malone & Crowston 1994; Thompson 1967; Herbsleb & Mockus 2003; Cataldo, Herbsleb & Carley 2008; Cataldo & Herbsleb 2013; Mauerer et al. 2021; Erman et al. 1980; Bolici, Howison & Crowston 2016; Durfee & Lesser 1991; Coffman, Elphick & Shoshani 1971; Skeen 1981; Gray & Cheriton 1989; Cemri et al. 2025; Hadfield et al. 2025; Yan 2025; Geng & Neubig 2026; Xu, Subramanian & Karthik 2026; Nygard 2011"
---

# Can parallel lanes coordinate with each other, and what would helping them do it unlock?

Yes. They already do. The channel is the one every session can write to and every next stage
reads first: the other lane's ticket thread. On 13 November the Runs & dispatch lane (LIN-4447)
proposed three moves across the seam it shares with LLM & prompts (LIN-4448), with a fallback
for the first. LLM & prompts agreed to all three, then corrected its own reply sixteen minutes
later. All three moves landed, and main stayed green. No person took part in that exchange. It
worked because three things lined up. Both asks named the other lane as owner of the far side.
The Unblock stage treats a question a sibling can answer as not John's. And a request posted on
a lane's own ticket is read by that lane's next stage.

It was not reliable, and it did not stay between the lanes. The one real question was answered.
Three of the four later asks were "unless you say otherwise" notices, and none of the four drew a
reply. Three of them
went to a parent ticket while the other lane worked its children. Later, the boundary moved from
one side only. LLM crossed into a Runs file it had said it would not touch, on John's ruling. It
recorded a move as "agreed" that Runs never agreed to. After Runs had closed, its close-out moved
an area file out of Runs and filed a Waiting entry in Runs' note. Harbour's classifier reads
unheaded agent notes as a person's word, within a lane as well as across one.

Harbour's channels carry messages up and down a lineage, not across it. Nothing pushes a comment
to a running session. Only `blocks` relations are read. A stage worker cannot address another
session, and the lanes' autopilot drivers, which could, do not know each other's ids. Most
crossings involved no message at all. Four lanes merged 29 PRs, and 48 of the 353 files they
changed were changed by more than one lane. Git, rebases and CI did that coordinating silently.
All 30 main CI runs in the window passed.

What would make it easy is mostly already built:

- a headed, typed seam message posted on the ticket that the other lane is actually working;
- a fallback and a deadline in every ask, which the lanes already wrote by habit;
- a wake through the follow-up path that the lanes' drivers already hold;
- a close-out check that every "agreed" cites the other side's comment.

The gain is that lanes on coupled areas could run side by side instead of one after another, as
the runbook now requires. The new failures are the ones the outside literature predicts. Waits
grow with the slowest party. Knots form when lanes hold work while waiting on each other.
Decisions get made in threads nobody watches.

## Findings

**1. What happened: a propose, agree, correct exchange across the seam, with no person in it, and
it held.** The four lanes were filed at 12:08Z on 13 November: Jira (LIN-4445), the front end
(LIN-4446, then LIN-4463), Runs & dispatch (LIN-4447) and LLM & prompts (LIN-4448). The last two
share what Seams & Tangles run 12 called the tightest tangle in Harbour. Each ask drew the line
explicitly: "The LLM & prompts side of the seam is A14's" (LIN-4447), and "The Runs & dispatch
side of the seam is A13's" (LIN-4448). The exchange, from the comments and dispatch rows
(`lanes-across-the-seam-evidence/census.json`, `dispatches.json`):

| Time (13 Nov, Z) | Where | What |
|---|---|---|
| 13:36 | on LIN-4448, d3ba7421 | Runs proposes three moves: one comment classifier in `lib/run-trail.js`, the live-stage wait to `lib/run-live-wait.js` with no shim, `blindReadStep` reading the shared close-out decision. The first has a fallback ("Fallback if you'd rather own it"). "Please reply on LIN-4447 with **agree**, or with the boundary you want instead." |
| 13:37 | on LIN-4447, dc7461eb | Runs' Unblock stage records `related` LIN-4448, starts the five pieces that do not wait, and holds pieces 2 and 4 for the reply. "A sibling's reply isn't a human hand-back." |
| 15:39 | on LIN-4447, 08c9c898 | LLM agrees to all three and adds a rule: "Whichever of us lands second changes only the import path." It says the only Runs file it edits is one literal in `lib/run-view.js`. |
| 15:55 | on LIN-4447, 097a3442 | LLM corrects itself. "That was wrong." A table lists four subtasks that edit Runs files and which Runs pieces each collides with. "We don't touch the runner or `lib/dispatch-store.js`." |
| 16:42, 17:06 | on LIN-4448, 1a2e7cba, 0510ffe0, b564445b | Runs renews two asks, one before building and one with its PR open, and adds to the second. "Unless you say otherwise on LIN-4459 before then, … proceeding to merge." |
| 17:12 | PR #2432 | The live-wait move merges. At 17:30 (15a858eb): no reply, "so the plan's FALLBACK was used". |
| 19:12 | branch merge e102e095a | LLM's piece 1 merges main into its branch ("live wait now in lib/run-live-wait.js") and changes its import, as the 15:39 rule said. The PR, #2433, merges at 19:44 as e666c4b60. |
| 21:49, 21:58 | on LIN-4447, 15de14a7, b555094d | LLM sends a heads-up (`COMPLETION_SIGNALS` becomes a view of its record) and a seam notice (one argument added in `releaseHeldWake`; "say so here and the later one rebases"). |

All three moves landed: the classifier in PR #2435, the live wait in #2432, and the blind-read
rule in #2438, where `blindReadStep` now reads `closeOutDecision().routesRead`
(`lib/recommendation-blind-read.js@fb358dbda:58`). All 30 `Tests` runs on main from 13 Nov
12:00Z to the time of reading passed (`gh run list --branch main`; main did not move after
`fb358dbda`). Every comment in this exchange is posted under John's account, as every agent
comment is. The record shows no person writing in it. A person did rule on the seam later, when
the boundary moved (finding 5).

**2. Why it happened: the asks named an owner, the Unblock stage put the question outside John's
edge, and the request sat where the next stage reads first.** No prompt tells a lane to negotiate
with a sibling. The proposal came from Runs' `blocked` stage (dispatch 31d2a914, 13:33Z). Its
lead is "Work has stalled. Find the real obstacle and clear it when it is yours to clear"
(`lib/prompts/stage-kinds.js@fb358dbda:48`). It is gated on Principle 0, "Does this genuinely
require the human, right now", which sends to John only what a person's preference alone can
settle (`docs/autopilot-operating-manual.md@fb358dbda:439`). Where an engineering boundary
crosses into an area the ask gives to someone else, that leaves exactly one party to ask: the
owner. The stage prompt also says to record the dependency as a `blocks` relation
(`lib/prompt-template-defs.js@fb358dbda:117`). The session recorded `related` instead. As
finding 7 shows, that made the dependency invisible to Harbour.

The reply came from LLM's `plan` stage (dispatch 8e1f52c8). It posted the agreement one second
before its own "Plan written" note (15:39:53Z and 15:39:54Z). The plan's section "The seam with
Runs (LIN-4447's three moves)" says why: "I agree to all three, as an engineering call; I post
that on LIN-4447 where its pieces 2 and 4 wait". Every stage prompt begins "read the current
description and comment thread … first, since they are the source of truth"
(`lib/prompt-formatters.js@fb358dbda:171`). The proposal was on LIN-4448's own thread, so the
first stage to run there read it.

The two-hour wait for a reply was not the message's doing. LIN-4448 had no stage running from
13:28Z, when its scoping handed back, until John's ruling on its cuts at 15:33:39Z (643eef60).
Its plan was dispatched at 15:35Z and the reply followed four minutes later. The slip in the
reply was caught by the next reader. Plan review (72406236, 15:49Z) approved the plan, and its
note 7 says: "Correct the seam reply on LIN-4447 before pieces 2–4 start. It says the only Runs
file this work edits is `STAGE_LABELS` in `lib/run-view.js`." The breakdown (dispatch 2d65d300)
posted the correction at 15:55Z. That is the same thing Harbour's stages do inside one lane.

**3. The one real question was answered; the notices that followed were not, and three of them
went to a ticket nobody on the other side was reading.** Five messages asked the other lane for
an answer: d3ba7421, 1a2e7cba, 0510ffe0, b564445b and b555094d. Only the first was answered. No
comment by the receiving lane cites any of the other four (`census.json`, `directed_messages`;
the hand-coded `answered_by` field is checked against each lane's comments).

The four are a weaker test than "one in five" suggests. The first was the one real question,
with no default. Three of the other four were default-consent notices: each said the sender
would go ahead unless told otherwise. The fourth, 0510ffe0, asked instead: "Please confirm …
that you still agree before the PR merges." Twenty-four minutes later b564445b added to it a
notice that did say the sender would go ahead. Silence was the expected answer to most of them. But two carried
new detail. 1a2e7cba drew a census boundary the first ask had not settled ("tell me on LIN-4458
if you want it drawn differently"). b564445b added a change in LLM's own file,
`lib/prompts/runner-kickoff.js`. Nobody on the receiving side is recorded as reading either.

The three Runs asks at 16:42Z and 17:06Z were posted on LIN-4448, the parent. LLM's stage
sessions in that hour ran on its children: LIN-4464 from 15:56Z and LIN-4465 from 16:49Z
(`dispatches.json`). Each was told to read its own ticket. No stage ran on LIN-4448 itself
between 15:58Z and 20:32Z. All three asks named a Runs child for the reply: LIN-4458 or
LIN-4459, with 0510ffe0 also offering LIN-4447. The LLM lane had no reason ever to open the
children.

Runs merged at 17:12Z, six minutes after its last ask, on its stated fallback: the 15:39
agreement stands. When LLM's parent review finally ran at 20:34Z (882fc992), it treated the merge
as the answer: "#2432 (the live-wait move) merged at 17:12Z, which answers that open question."
Silence was safe this time only because the fallback was the earlier agreement, and only an
import path changed. The seam notice at 21:58Z asked Runs to object "here" on LIN-4447. Runs'
remaining work was running on child tickets, and nothing answered. The heads-up at 21:49Z warned
that Runs' after-read would sample a moved file. The warning turned out not to matter, because
neither Runs report samples `lib/completion-signals.js` (checked by grep in both reports under
`docs/plans/survey/area-read-reports/`).

**4. Messages also went where nobody could read them, and Harbour reads unheaded agent notes as a
person's word.** LLM's piece 6 posted its three after-reads on LIN-4447 at 09:17Z on 14 November
(3300ab65, 36a9d8e0, 29848ba2). LIN-4447 had closed at 09:02Z on John's ruling, so no Runs
session was left to read them.

Harbour's comment classifier calls any unheaded comment that is not an agent note, landed work,
a verdict or a close-out "a person's comment". In the code's words: "Agents post under a person's
account, so the author cannot decide it" (`lib/run-trail.js@fb358dbda:216-225`). Run over the
four lanes' comments in the window, `isPersonComment` accepts eleven that are not rulings
(`lanes-across-the-seam-scripts/person-comments.mjs`). One, 47fdad91, relays words John approved.
The other ten are agent notes, and nine of those stay inside one lane: Runs' fallback note on its
own parent (15a858eb), the front end's correction (6bd2401a), LIN-4458's hold (ed641bd8), LLM's
`DECISION:` (0860f7b8) and its ruling-applied note (83e69cd5) among them. The flaw is general,
not a seam problem. One of the ten crosses the seam: the seam notice b555094d, posted by LLM on
Runs' ticket.

The stage selector's first rule gives a person's latest comment the power to decide the next
stage or hold the work, "unless the facts show an agent acted after it"
(`lib/stage-router.js@fb358dbda:29`). So a misread note steers only until the next agent action
on that ticket. In this case no stage was dispatched on LIN-4447 between the notice and John's
next ruling, so it steered nothing. What the seam adds is reach. Under that rule, one lane's
notice on another lane's ticket counts as John speaking on it.

**5. After the exchange, the boundary moved from one side only: once on John's ruling, once by
a claimed agreement, and once after the other lane had closed.** Each change was announced, or
claimed as agreed, on the record. None drew a reply from Runs.

*A crossing John allowed.* LLM's correction said "We don't touch the runner or
`lib/dispatch-store.js`" (097a3442). At 21:57Z LIN-4468 raised a `DECISION:` on LIN-4448
(0860f7b8). It asked to add one argument in `releaseHeldWake`, in that same Runs file, so that a
held wake carries its parent's write allowance. A minute later the lane's autopilot settled it,
on LIN-4468, as an engineering question (732e3364). It noted that "LIN-4447 (Runs) owns the file, and a notice
is posted there", which is b555094d. At 22:00Z John ruled "Allow the store change and add a
held-wake witness" (24e376c1). PR #2443 merged at 22:29Z as b937237a4. So a person did rule on a
seam crossing, and that crossing reversed what the two lanes had agreed. Runs did not reply
(finding 3).

*A file the list missed.* PR #2441 (LIN-4466, merged 20:42Z as dc12ca51b) edited
`lib/run-trail.js`, which is not on the correction's list. The edit swaps the literal
`'blind-read'` for an imported `BLIND_READ_KIND`. The list went stale because of the agreement
itself. Move 1 put the classifier table in `lib/run-trail.js` (PR #2435, 18:08Z), after the
15:55 list was written. LLM's blind-read identifier work then followed the table into Runs' file.

*An agreement claimed without the other side.* LLM's plan lists "Moves to Runs (LIN-4447),
agreed below" and names three items: the live-wait home, `COMPLETED` redeclared, and "the
dispatch record's `model`". The agreement "below" is LLM's own acceptance of Runs' three moves.
The `model` entry was in none of them. Runs never proposed it, and no Runs comment accepts it.
On 14 November, LIN-4470 (PR #2450, merged 09:49Z) moved that Waiting entry into the Runs note.
Both the PR body and the entry say "as agreed on LIN-4447"
(`docs/areas/runs-and-dispatch.md@fb358dbda:175-181`). The Runs lane had closed 47 minutes
earlier. Plan review approved the plan (72406236) without remarking on the claim. Nothing in
Harbour checks a claimed agreement against the other ticket's thread.

*Changes after Runs closed.* LLM's close-out landed at 10:52Z as PR #2457 (06a7da871), 110
minutes after Runs closed. It made two changes on Runs' side, both from LLM's own blind read
(7fcd63b2). It moved `completion-signals` from the runs-and-dispatch pattern to llm-and-prompts
in the area registry (`docs/areas/areas.json@06a7da871:28,44`). And it added a Waiting entry to
the Runs note: "Runs depends on LLM & prompts … Not scheduled; no ticket takes it"
(`docs/areas/runs-and-dispatch.md@06a7da871:182-186`). The first had been announced at 15:55Z
("the content belongs with us, but your after-read should know"). The close-out comment
(5cfdaa1e) records both changes on LIN-4448. Nothing was posted on LIN-4447, and no Runs session
was left to read it if there had been.

Each change is small, and probably right. The `model` entry cites a Runs file, and every
consumer of `COMPLETION_SIGNALS` is a prompt. But each is a decision about the other lane's
code, registry or backlog, made where only the deciding side looks.

**6. Most crossings carried no message: git and CI coordinated them, and once a third lane moved
something two lanes relied on.** In the window, 13 Nov 12:08Z to 14 Nov 10:00Z, the four lanes
merged 29 LinearViewer PRs: Runs 12, LLM 7, front end 6, Jira 4. They changed 353 files, and 48
were changed by more than one lane. Shared files by lane pair (`census.json`):

| Lane pair | Shared files | Messages between them |
|---|---|---|
| LLM & prompts + Runs & dispatch | 29 | 11 directed messages (findings 1, 3, 4) |
| Jira + LLM & prompts | 15 | none |
| Jira + Runs & dispatch | 13 | none |
| Front end + Runs & dispatch | 10 | none |
| Front end + LLM & prompts | 8 | none |
| Front end + Jira | 5 | none |

All four lanes edited `server.js` and `docs/architecture/source-map.md`. The runbook rule is
"Tickets touching `server.js` or the same prompt file go in sequence in one lane, not in
parallel" (`docs/runbooks/improvement-cycles.md@fb358dbda:80-81`). It was not applied across the
lanes, and nothing broke.

The one visible collision came with no message. Jira's close-out (PR #2440) added a Waiting entry
to `docs/areas/front-end-browser.md`, which put the front end's PR #2439 in conflict. The front
end's unblock analysis (11814310) first said main had not touched that note. Seven minutes later
it corrected itself and merged main, keeping both edits (6bd2401a, 3bf1229c3). PR #2443 (LLM)
resolved its conflicts the same way when it merged main (d0fc1dc65).

A less visible crossing hit the measurement itself. Both tidy lanes judged their areas against an
"untouched" control area, `front-end-pages`. The front-end lane (LIN-4471, LIN-4472) and Runs'
own piece 1 (LIN-4460) changed files in it. Both after-reads had to flag "control moved" (LIN-4447
91473853; LIN-4448 d827aa8e). Nobody had reserved it.

**7. What Harbour already has carries messages up and down a lineage, not across it.** The
channels in the code and tracker, and what each was built for:

| Channel | Built for | Who can send to whom | Reaches a running session? | Read by code? |
|---|---|---|---|---|
| Ticket comments via the proxy | the record of a ticket's work | any `readWrite` token to any ticket; restricted stages only to their own (`routes/proxy-writes.js@fb358dbda:287-300`) | no: read when a stage starts or re-reads | yes, through one classifier (`lib/run-trail.js`) |
| Issue relations | blocking dependencies, LIN-3309 | any ticket to any ticket | no | `blocks` only; "duplicate/related are ignored" (`lib/providers/linear/index.js@fb358dbda:915-925`) |
| Follow-up dispatch (`followUpTo`) | "communicate with sessions in progress", LIN-415 (June) | any `dispatch`-grant holder to any held session; Harbour "stores and forwards the id blindly" (`docs/architecture/dispatch-and-proxy.md@fb358dbda:103-106`) | yes, if the runner still holds it (`followup.js@7d5fe7d:35-60`) | runner delivers |
| `queueIfBusy` notes | operator notes to a busy autopilot, LIN-827 | grant holder to any session (`docs/proxy-integration.md@fb358dbda:158-161`) | yes, when it is free | runner delivers |
| Wakes and subscriptions | "push-based inter-session communication", LIN-826 (30 Jun) | child to the `sessionId` its dispatcher stamped, never sideways (`lib/dispatch-wake.js@fb358dbda:189-221`) | yes | yes |
| Runner markers, `[ticket]` lines | a session's own status | a session to its own row | n/a | status, display |
| Rulings, `DECISION:` | questions only a person settles | a session to John; anyone may suggest an answer | through John | yes |
| Agent status feed | a fleet bulletin (LIN-533) | anyone, no recipient (`lib/agent-status-store.js@fb358dbda:1-21`) | no | display only |
| Area notes, Waiting entries | what the next ticket in an area should know, LIN-4347 | any session to later sessions, once merged | no | partly (`### Leftovers` must retire one) |
| Live-stage wait, duplicate guard | one stage at a time per ticket, LIN-4392 | implicit, same ticket only; "a read, not a claim" (`lib/run-live-wait.js@fb358dbda:26-30`) | n/a | yes |
| Git, PRs, CI | landing work | everyone, at merge | no | CI only |

Three facts follow.

- **The stage sessions cannot address another session; the lanes' drivers can, but do not know
  whom to address.** Every session-addressed write needs the `dispatch` grant. Every worker an
  orchestrator dispatches is a leaf without it, and most messages here are headed as a stage's
  or a piece's work. The server does declare `dispatch` for an owner's Autopilot dispatch
  (`docs/proxy-integration.md@fb358dbda:116-122`), and each of the two lanes had one from 13:13Z
  (`dispatches.json`, kind `autopilot`). The seam notice b555094d says it came from LLM's
  autopilot, and it too posted on the ticket rather than addressing Runs' driver. So the barrier for these lanes
  is not the grant. It is that neither driver knows the other's session id, and nothing suggests
  it ask. The
  worker-lane prompt's "Letting lanes coordinate would need the deferred declared launch verb"
  (`docs/worker-lane-prompt.md@fb358dbda:66-69`) is about worker lanes, which lack the grant. It
  does not describe these two lanes.
- **No prompt context crosses tickets.** It holds the parent, the children, the ticket's own
  comments, and siblings' titles and states only
  (`lib/prompts/prompt-context.js@fb358dbda:12-14`, `lib/openrouter.js@fb358dbda:937-943`). A
  `related` link reaches no prompt.
- **Lane-to-lane messaging has never been proposed as such.** The nearest ticket, LIN-876
  ("cross-autopilot messaging (clarify/question/manage between AP layers)"), was about altitude,
  not lanes: "let autopilots at different altitudes converse: a child asks its parent for
  clarification". It was Canceled with no comment on record.

Harbour has coordinated parallel lanes before, by a different means. On 23 August, worker lanes
each declared a file carve in their first comment, "especially its forbidden half", and six lanes
"cross[ed] two repos with zero collisions" (`docs/worker-lane-prompt.md@fb358dbda:70-75`). That
was partition up front, not negotiation.

**8. What would make it easy and reliable, using what exists.** In order of cost:

1. **Give the seam message a heading the classifier knows.** "Seam: proposal", "Seam: reply" and
   "Seam: notice" would each be a kind in the one table in `lib/run-trail.js`. That stops a
   lane's note counting as John's word on another lane's ticket (finding 4). It also lets the
   trail say a proposal is open, the way it already knows a review is. This is a row in an
   existing table. The wider misreading of unheaded agent notes is a separate fix.
2. **Post where the reader is, and make the wait visible.** The ask should go on the ticket the
   other lane is working at that moment, which the asker can find from that lane's open children.
   If a piece truly waits, record it as `blocks`, not `related`. Then the asker's own piece shows
   "Blocked by (open): LIN-4448" in its prompt and selector
   (`lib/openrouter.js@fb358dbda:724-740`), so the wait is held by code rather than by a
   sentence in a plan. A `blocks` relation does not deliver anything to the other lane, whose
   context shows only the tickets blocking it. It makes the wait visible; it is not a message.
   Both halves exist today. The Unblock stage was told to record `blocks` and chose `related`.
3. **Every ask carries a fallback and a deadline, and silence means the fallback.** The lanes
   already did this by habit: "Fallback if you'd rather own it", "Unless you say otherwise …
   before then". This is a lease (Gray & Cheriton 1989,
   [doi:10.1145/74851.74870](https://doi.org/10.1145/74851.74870)): the other side's right to
   object expires, and the holder proceeds without needing a reply. The deadline was the part left
   loose. Runs merged six minutes after its last ask (17:06–17:12), while the ask sat on LIN-4448,
   where no stage ran from 15:58Z to 20:32Z (`dispatches.json`). A deadline of "after the
   receiving lane's next stage has run" would tie the lease to the reader, not to the clock.
4. **Wake the other lane through the path its driver already has.** Lane drivers hold the
   `dispatch` grant (finding 7). A driver could send a seam ask to the other lane's driver session
   as a `queueIfBusy` follow-up. That path was built for notes to a busy autopilot (LIN-827), and
   the runner delivers it when the target is free. This addresses findings 3 and 4 without a new
   channel. It needs the driver's session id, and lanes started separately do not know each
   other's ids today.
5. **Check claimed agreements, and changes on the other side, at close.** A comment or note that
   says "agreed on LIN-nnnn" should cite a comment id on that ticket written by the other lane.
   A close-out that edits another lane's registry entry or note should post on that lane's
   ticket, and say so if the lane has closed. Review or the leftover guard can check both
   mechanically. Finding 5 has a case of each.
6. **Reserve what two lanes measure against.** The control area for an area read is a shared
   resource. A lane that touches it should hear about it before merging, not afterwards in a flag.
   The file carve from 23 August, extended to "read-only for this window", would do it.

None of this needs a new message bus. The ticket thread is already a blackboard that everyone can
read (Erman et al. 1980, [doi:10.1145/356810.356816](https://doi.org/10.1145/356810.356816)). What
it lacks is the blackboard's focus of control, something that notices an open proposal nobody has
answered. Items 2 to 4 supply that from parts already built.

**9. What it could unlock, and what it would cost.** Malone and Crowston define coordination as
"managing dependencies among activities" (1994,
[doi:10.1145/174666.174668](https://doi.org/10.1145/174666.174668)). By Thompson's classes (1967,
*Organizations in Action*), the Runs–LLM seam is reciprocal interdependence. That kind needs
mutual adjustment, not a plan made in advance, and mutual adjustment is what the comments were.

*What becomes possible.* Coupled areas can run in parallel instead of in sequence. Today the
runbook puts tickets on the same shared file in one lane, one after another. On 13 November two
lanes rebuilt both sides of the tightest tangle at once: 19 PRs between 14:54Z on 13 November and
09:49Z the next day. The record does not show that the agreement made this possible. Runs' first
PR (#2422) merged at 14:54Z, before the agreement at 15:39Z, and git did most of the
coordinating (finding 6). What it shows is narrower. The one boundary both sides needed settled
was settled, and it held for the three moves it covered.

*What becomes cheaper.* A lane can settle a boundary with its neighbour in about four minutes
once the neighbour is reading (15:35 to 15:39Z). The alternative is a ruling, which costs John a
press and costs the lane a park. Partial global planning, where nodes exchange summaries of their
local plans (Durfee & Lesser 1991, [doi:10.1109/21.120067](https://doi.org/10.1109/21.120067)),
is the shape of LLM's correction table. The theory expects such plans to be partial and stale,
and the next stage to refine them. Finding 5's missed file is such a plan going stale.

*What becomes safer.* Socio-technical congruence studies of human teams found that requests were
resolved faster when coordination matched the dependencies (Cataldo, Herbsleb & Carley 2008,
[doi:10.1145/1414004.1414008](https://doi.org/10.1145/1414004.1414008)). They also found more
failures where the two diverged (Cataldo & Herbsleb 2013,
[doi:10.1109/TSE.2012.32](https://doi.org/10.1109/TSE.2012.32)). Those are correlations in human
teams. A 2021 longitudinal study of 25 open-source projects found its congruence measure "not
related to project quality measures — software bugs and churn — in any temporal scenario"
(Mauerer et al. 2021, [doi:10.1109/TSE.2021.3082074](https://doi.org/10.1109/TSE.2021.3082074)).
Agents give a baseline of their own. In replayed merges of concurrent agent PRs on GitHub, pairs
from different agents conflicted 41.7% of the time against 19.8% for pairs from the same agent
(Xu, Subramanian & Karthik 2026, [arXiv:2607.04697](https://arxiv.org/abs/2607.04697)). Only
0.5% of concurrent pairs there involved different agents. Harbour's four lanes had no recorded
merge failure, but that is one day, not a rate.

*What new failures come with it.*

- **Waits that grow with the slowest party.** Herbsleb and Mockus found that work spanning sites
  took about 2.5 times as long as work within one, mostly because it involved more people (2003,
  [doi:10.1109/TSE.2003.1205177](https://doi.org/10.1109/TSE.2003.1205177)). In a lane network,
  an ask waits for the other lane's next stage. That stage can wait on John, as on 13 November
  for two hours. Propose and agree is a two-phase agreement. A proposer that cannot act without
  the answer blocks, as two-phase commit does when its coordinator is down (Skeen 1981,
  [doi:10.1145/582318.582339](https://doi.org/10.1145/582318.582339)). The lanes' fallbacks are
  what kept that from happening.
- **Knots.** Deadlock needs four conditions together: mutual exclusion, hold and wait, no
  preemption, and circular wait (Coffman, Elphick & Shoshani 1971,
  [doi:10.1145/356586.356588](https://doi.org/10.1145/356586.356588)). Lanes that each hold an
  area while waiting for the other's agreement meet the middle two. Harbour has had the fourth
  already. On 1 October a supervisor, a second ticket and a passage leg waited in a circle for 35
  minutes until the Flight Companion broke it
  (`docs/papers/harbour/between-the-sessions.md@8495442ed:122-126`). The operating manual says the
  mutual-wait trap "doesn't apply under push"
  (`docs/autopilot-operating-manual.md@fb358dbda:272-276`). The incident papers record that as
  wrong, and they record that no rule asks for a wait-cycle check
  (`docs/papers/harbour/what-hides-between-sessions.md@8495442ed:74,220-222`). A fallback with a
  deadline is preemption, which breaks the cycle. The 30-minute detector those papers trialled
  caught the 1 October cycle (`:108`).
- **Decisions made where nobody sees them.** The LLM-agent literature names this. MAST, built from
  more than 1,600 annotated multi-agent traces, has inter-agent misalignment as one of its three
  failure categories (Cemri et al. 2025, [arXiv:2503.13657](https://arxiv.org/abs/2503.13657)).
  Cognition's argument against multi-agent designs is that "actions carry implicit decisions, and
  conflicting decisions carry bad results" (Yan 2025,
  [cognition.com](https://cognition.com/blog/dont-build-multi-agents)). That is an opinion piece,
  not evidence. Findings 4 and 5 are small cases of it: an agreement extended without the other
  side, registry and backlog changes made after the other side closed, a notice read as the
  owner's word, reports posted to a closed lane. Written proposals help because they turn an
  implicit decision into a record. Architecture decision records add a status, "superseded", for
  the case of LLM's 15:55 correction (Nygard 2011,
  [cognitect.com](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions)).
- **More traffic, more supervision.** Anthropic's research system runs subagents that "can't
  coordinate", and its multi-agent runs used about 15 times the tokens of chat (Hadfield et al.
  2025, [anthropic.com](https://www.anthropic.com/engineering/multi-agent-research-system)).
  In September, wakes took 29% of the weighted tokens in dispatched sessions
  (`docs/papers/harbour/wake-inventory.md@fb358dbda:110-111`, version 2). Sideways wakes would add
  to that unless they are as rare as real seam asks: five in a day here.

The centralised alternative is also known. CAID gives each worker an isolated worktree under a
manager with a dependency-aware plan, and merges by test. It gained 25.6 points on PaperBench and
14.7 on Commit0 over a single agent (Geng & Neubig 2026,
[arXiv:2603.21489](https://arxiv.org/abs/2603.21489)). The authors call branch-and-merge "a
central coordination mechanism". Harbour's 13 November day was a mix of the two. A peer
agreement settled who owned what. Merges and CI did the rest, the way open-source teams combine
explicit talk with coordination through the shared work product (Bolici, Howison & Crowston 2016,
[doi:10.1016/j.cogsys.2015.12.003](https://doi.org/10.1016/j.cogsys.2015.12.003)).

## Method

**Population.** The four lanes filed at 12:08Z on 13 November 2026 and every ticket under them:
Jira LIN-4445, 4450–4452 and 4473; front end LIN-4446, 4463, 4471 and 4472; Runs LIN-4447,
4453–4462 and 4474–4476; LLM LIN-4448 and 4464–4470. The census window runs from 13 Nov 12:08Z to
14 Nov 10:00Z. Lane membership is by parent and is written out in the script. One event after the
window is read in by hand: LIN-4448's close-out (PR #2457 and its comments, 14 Nov 10:29–10:54Z),
because it bears on findings 3 and 5. Nothing after the tracker read at about 11:00Z is seen.

**Classes.** A *mention* is a comment on one lane's ticket that names another lane's ticket id
(87 comments). A *directed message* is a comment written to the other lane: its heading names
its source and addresses the reader, or it is the other lane's work posted on this lane's ticket.
All 87 mentions were read and 11 met that test. Whether a message *asks for an answer*, and which
comment *answers* it, was coded by hand and is listed by id in the script, because a reply need
not quote the id it answers. Whether an ask is *default-consent* (finding 3) was read from its
text: it says the sender proceeds unless told otherwise. A *shared file* is a path changed by
merged PRs from more than one lane.

**Queries.** `lanes-across-the-seam-scripts/census.py` fetches every ticket through the workspace
proxy, the dispatch rows for every Runs and LLM ticket, then the merged PRs and their files with
`gh`. It writes `lanes-across-the-seam-evidence/` (issues, dispatches, PRs, `census.json`). Re-run
it with `python3 -I census.py <out-dir>`. Version 2 re-ran it at about 11:00Z on 14 November.
Every count in `census.json` and every row of `prs.json` came out the same as version 1's run.
The snapshot replaces a commit author's name written in brackets after a sha, because such names
can identify an employer. Two counts came from other commands:

- Person's-comment classification: `lanes-across-the-seam-scripts/person-comments.mjs` runs
  `isPersonComment` from `lib/run-trail.js` at `fb358dbda` over the snapshot's comments in the
  window. Who wrote each comment it returns was read by hand.
- Main CI: `gh run list --branch main` filtered to the window, 30 `Tests` runs, all success.

The channel inventory (finding 7) was read from the code at `fb358dbda` and `7d5fe7d` and from
each origin ticket. Every row the paper relies on was re-read at the cited line. The close-out's
two changes were read from `git show 06a7da871`.

## Limits

- **One day, one seam.** The exchange is a single case. That it held says it can work, not how
  often it does. The answer count is five asks, and four of them invited silence.
- **Comments are what the record shows.** A lane may have read a message and acted on it without
  citing it. The hand coding counts an answer only where one is written, so it can undercount
  delivery. The 20:34Z review shows a lane noticing an open question and answering it through the
  merge, not with a reply.
- **Authorship is inferred.** Every agent comment posts under John's account. A comment's lane is
  read from its heading and from which dispatch was running, not from an author field. The claim
  that no person took part in the first exchange rests on the headings, the dispatch rows, and
  John's comments being rulings recorded via Harbour. The same reading finds John's ruling on the
  later crossing (finding 5).
- **The file overlap counts paths, not lines.** Two lanes editing different paragraphs of
  `source-map.md` count as shared. This overstates conflict risk. It is a count of where
  coordination could have been needed, not of where it was.
- **The outside sources are mostly about people or about systems that are not LLMs.** They are
  mechanisms to consider, not estimates for Harbour. Two of the agent studies are 2026 preprints.
  Their figures were re-read from the arXiv abstracts on 14 November, not the full text. Thompson,
  the two Cataldo papers and Mauerer et al. were confirmed from abstracts and secondary sources,
  not full text.
- **The proposals in finding 8 are untested.** They are read off the failures and the parts that
  exist, and no trial has run.

## Next

- **Trial the seam heading and the reader-tied deadline on the next pair of coupled lanes.**
  Count the asks answered before their fallback fired, real questions and default-consent notices
  apart, and the time to answer. This line goes into `proposals.md`.
- **Audit claimed cross-lane agreements and cross-lane edits.** Across every "agreed on LIN-nnnn"
  in area notes and PR bodies since the lanes began, how many cite a comment by the other side?
  How many close-outs edited another lane's registry entry or note without posting on its
  ticket? This line goes into `proposals.md`.
- **Should a lane-to-lane wake exist, and who would send it?** No ticket has asked; LIN-876 asked
  only for messages between autopilot layers, and was cancelled. A `queueIfBusy` follow-up
  between two drivers is the cheapest version to try.
- The visual essay John asked for, drawn from this paper, is the next ticket under LIN-4480's ask.
