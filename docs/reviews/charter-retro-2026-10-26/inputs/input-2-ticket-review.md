**Input 2: ticket review.** Written on 26 Oct by a fresh reader not involved in the work, from the ticket record (input 6) and git history.

**Known errors:**
- Its question 9 says the operator's proxy token expires 26 Oct 08:25Z. It runs to 27 Oct 18:34Z.
- On who answered the overnight rulings (question 5): John pressed `lin-3962-390px-clip`. The operator passed the others on to the tickets while John slept; see input 4, §4.

---

# Ticket review: charter LIN-3490, 23 Oct to 26 Oct 2026 (morning)

Sources: `tickets-index.csv`, `tickets/LIN-*.json`, and `git log 8e59ed62..origin/main` (133 PRs merged: 41 on 23 Oct, 37 on 24 Oct, 45 on 25 Oct, 10 by 06:44Z on 26 Oct; main HEAD is `d3f67854`).

Caveats to keep in mind:
- **Authorship.** Every comment carries John's account. Below, "John" means words the record quotes as his. Comments ending "Ruling recorded via Harbour" are rulings, but the record doesn't say who pressed each one (see Q5).
- **Cost is a floor.** From about 24 Oct 21:00Z (LIN-3888 onward), implementation workers ran on `claude-haiku-5-5`, which is unpriced. So `priced_usd` leaves out most implementation spend after that point, and costs from before and after it can't be compared. John, 25 Oct: "Haiku was intentional".
- **The charter is stale.** Its description's "Running now" is "as of 25 Oct, about 11:30Z". Its comment log ends at 25 Oct 18:31Z, so nothing from the night of 25–26 Oct is logged there. The 80% and 91% meter readings come from the brief, not from the record.

---

## 1. The story

**23 Oct: periodicals and an incident.** At 09:40Z the companion rewrote the charter (LIN-3490) around John's frame: "periodicals first, then the Theseus loop alongside the other tidy-up tasks". The Theseus loop was aimed at the UI, after a "flank" that tidies the seams of the page layer. A production 503 came first: LIN-3773 investigated it, LIN-3774 fixed it, LIN-3775 improved the error pages, and LIN-3790 followed up. All nine planned periodicals ran that day (LIN-3765 to LIN-3825), plus Drift & Coherence (LIN-3831) and Seams & Tangles (LIN-3832) as the loop's baseline. Their follow-ups run from LIN-3777 to LIN-3836: High ones ran, and about 30 went to Backlog. One close-out, LIN-3771, re-enabled email sign-in in production because it read the operator's ticket comment as an instruction. The operator logged the lesson at 10:40Z.

**24 Oct: refactoring and the start of the UI.** The flank landed:
- LIN-3554, LIN-3755, LIN-3837 and LIN-3840 with LIN-3742 (the dashboard router);
- LIN-2246, split into eight byte-identical route moves (LIN-3842 to LIN-3894);
- LIN-3917 closed it at about 21:35Z.

The replay judged every move at 0 differences. Knots went 11 → 10 (9 after LIN-3921), and the workspace-API router went from 3,782 to 879 lines.

Model routing (LIN-3820) shipped as LIN-3852 to LIN-3858 plus LIN-3882. The UI began from prototypes John chose (LIN-3757). Settings (LIN-3846) went live at 17:50Z. John called it "greatly improved", but said "the CSS is a tangle", and that became LIN-3886 (four moves, LIN-3887 to LIN-3890, judged by a new visual replay). LIN-3891 measured pipeline churn (121 extra runs, 73 of them avoidable) and led to LIN-3903 to LIN-3906.

John then folded "complete the UI" into the charter, which became LIN-3892, with an inventory and his calls on each view. At 19:50Z he lifted the hold on Home and moved the budget pause from 70% to 90%.

**25 Oct: Settings, Home and the re-scope.**
- **Overnight:** the Settings untangle finished (LIN-3890, 08:24Z), and Next run and `prototypes/` were deleted (LIN-3912, −7,681 lines).
- **Merged in the day:** Settings › Models (LIN-3855) at 12:32Z, and Home (LIN-3833) at 17:39Z. Home took a 9-hour run with 6 plan revisions, 5 plan-reviews, 4 code reviews and 7 rulings.
- **Plain layout:** built and proven on Legal and Account home (LIN-3950, LIN-3958, LIN-3956).
- **Costs:** filed at 10:59Z (LIN-3936 to LIN-3945), with LIN-3937 running.
- **Re-scope at about 18:40Z.** John paused Costs: LIN-3937 was aborted after $52 priced, and PR #2136 was left open. The remaining effort went to "a good-looking UI" that he will test on an external project next week. John agreed the operator's plan: seven Full pages "in the order an outside user meets them" (task page, run page, Live Console, Dispatch, Landing, Swipe, Observation), each from a design brief by the UI design session, then Plain pages in batches, then the stylesheet review and a re-run of the Design & Interface Review. Seven views were taken out of the charter.
- **Briefs:** filed between 18:30 and 19:34Z (LIN-3970 to LIN-3983). John's answers to their open questions were recorded by about 19:50Z.

**Night of 25–26 Oct: the Full pages.**
- **Home:** five more tickets (LIN-3962, LIN-3968, LIN-3987, LIN-3991, LIN-3992) and a fix for the CI flake its specs caused (LIN-3969).
- **Live Console:** plan-review rejected the plan six times, until the lane rule was split out as LIN-3986. It merged at 02:51Z (LIN-3977).
- **Landing:** merged in two rounds (LIN-3980, LIN-3995).
- **Task page and Observation:** each merged its PR 1 between 06:34 and 06:44Z (LIN-3975; LIN-4003 then LIN-3983). Both had another implementation running at 06:52Z.
- **Models polish (LIN-3952):** conditional Approve at 05:15Z, not merged, and its autopilot wake is `blocked`.
- **Not started:** the run page, Dispatch, Swipe, Live Console round two and the four Plain batches.

The meter read 53% (24 Oct 19:45Z), 60% (25 Oct 07:00Z), 74% (17:07Z), 80% (19:40Z) and 91% (26 Oct 07:00Z). That is past the charter's 90% pause point.

**How the plan changed.**
- **The UI goal grew three times:** "flank done, prototypes ready" (23 Oct), then "UI complete" (24 Oct), then "a good-looking UI for an outside test" (25 Oct).
- **Costs** was added at 10:59Z on 25 Oct and paused at 18:40Z.
- **Lanes:** one heavy plus two light, then three light lanes (24 Oct), then three heavy plus a light lane for High and Urgent only (25 Oct).
- **The pause point** moved from 70% to 90%.
- **Page order:** the plan said "Live Console first, then the task page and Dispatch", then the outside-user order. In practice Live Console, Landing, the task page and Observation ran first, while the run page, Dispatch and Swipe wait (the run page and Swipe wait on LIN-3975).

---

## 2. Charter tickets and their state

Rounds are counted as plan / plan-review / implementation / code review, then rulings (R). "$" is priced USD, a floor (see the caveats). The ↳ arrow marks a follow-up or child.

### UI (from 24 Oct)

| Ticket | Asked to do | State | Rounds (p/pr/i/r, R) | $ | Left undone |
|---|---|---|---|---|---|
| LIN-3757 | UI overhaul step 1: prototypes, then file pages | **Todo** | – | 0 | Both children are Done; the record doesn't say whether this ticket is finished |
| ↳ LIN-3846 | Settings: one page per area, three row kinds | Done 24 Oct 17:59 | 2/2/2/1, R1; aborted duplicate runs | 47.6 (implementation on Sonnet, 33.3) | – |
| ↳↳ LIN-3848 | Remove nine dead switches | Done | 1/0/1/1 | 8.2 | – |
| ↳↳ LIN-3849 | Run controls follow rules, not switches | Done | 4/4/1/1 | 38.1 | – |
| ↳↳ LIN-3886 | CSS untangle (from John's live review) | Done 25 Oct 08:32 | parent | 0 | ↳ Backlog: LIN-3919, LIN-3920, LIN-3924, LIN-3925 (one log entry per move; was in scope), LIN-3927 |
| ↳↳↳ LIN-3887 | 1/4 Own: ui-pieces note and visual judge | Done | 1/0/1/1 | 11.6 | – |
| ↳↳↳ LIN-3888 | 2/4 Free the seam (tests only) | Done | 3/3/2/2 | 21.9 | – |
| ↳↳↳ LIN-3889 | 3/4 Consolidate | Done | 2/2/2/2 | 19.0 | – |
| ↳↳↳ LIN-3890 | 4/4 Rebuild Sources, Health, Account | Done | 4/4/3/3, R1 | 37.6 | The Models `action-btn` alias and `confirm()` were handed to LIN-3855 |
| LIN-3855 (child of LIN-3820) | Settings › Models: every job, spend, model | Done 25 Oct 12:42 | 3/3/3/2, R2 | 22.5 | – |
| ↳ LIN-3952 | Models polish plus Settings leftovers | **In Progress** | 2/2/2/2 | 17.4 | PR #2165 has a conditional Approve (05:15Z): close-out ledger, PR body sections, judge mask. Not merged; the wake is `blocked`. Also moves the "No job" row onto Dispatch |
| ↳↳ LIN-3962 | One decision panel for Models and Home (split from LIN-3952) | Done 25 Oct 21:47 | 1/0/3/3, R1 | 14.0 | – |
| ↳↳↳ LIN-3987 | Panel round 2: prices, words, styled | Done | 1/0/2/2 | 7.4 | Open for John: how to show price on Claude Code |
| ↳↳↳↳ LIN-3992 | Panel round 3 | Done 26 Oct 02:40 | 1/0/1/1 | 3.2 | Items 2 and 5 (Models side) moved to LIN-3952; the blue Go button moved to LIN-3982 |
| LIN-3833 (child of LIN-3757) | Home: opened task leads with its state, one run control, copy-first view | Done 25 Oct 17:51 | 5/5/5/4, R7 (6 plan revisions in all: two were written inside `blocked` runs) | 50.9 | ↳ Backlog: LIN-3930 ("says your agent"), LIN-3964 (ask Harbour), LIN-3965 (Scan and Context have no home) |
| ↳ LIN-3966 | Crossed harness and model left over from LIN-3833 | Done | 2/2/1/1 | 13.1 | ↳ LIN-3974 Backlog |
| ↳ LIN-3969 | LIN-3833 e2e flake turned main red | Done (2 PRs) | bug/2 reviews, R1 | 17.5 | ↳ LIN-3993 Backlog |
| ↳ LIN-3968 | Home polish, round 2 | Done 25 Oct 22:52 | 1/0/4/4, R2 | 22.8 | ↳ LIN-3988, LIN-3989 Backlog |
| ↳↳ LIN-3991 | Home, round 3 | Done 26 Oct 01:44 | 2/2/1/1 | 13.2 | Two items (duration format, orphaned link) moved to LIN-3975 |
| LIN-3892 | UI sweep, parent | **Todo** | – | – | The stylesheet review, the D&I re-run and the hard-coded colour and spacing measures are not filed |
| ↳ LIN-3912 | Delete Next run and `prototypes/` | Done 25 Oct 02:40 | 0/0/2/1 | 3.3 | – |
| ↳ LIN-3950 | Plain layout, proven on Legal; repair ui-pieces.md | Done | 1/0/1/1 | 10.6 | ↳ LIN-3957 Backlog |
| ↳↳ LIN-3958 | Plain polish | Done | 1/0/2/2 | 6.3 | ↳ LIN-3960 Backlog |
| ↳ LIN-3956 | Plain rows and forms on Account home | Done 25 Oct 20:44 | 1/0/1/1, R1 | 12.9 | Close-out waited from 19:39 to 20:44 for a deploy that hadn't followed main |
| ↳ LIN-3970 to LIN-3973 | Plain batches: KPIs; Templates and prompts; task forms, Runner and Proxy; system and email pages | **Backlog**, no priority | – | 0 | Not started, although LIN-3956 (their blocker) has been Done since 20:44 |
| ↳ LIN-3975 | Task page (with task chat fold) | **In Progress** | 5/5/4/3, plus a close-out for PR 1 only | 36.9 | PR 1 merged (`2ab5e675`). PR 2 and 3 are stacked as #2169 with no CI; reviewed at 06:51Z, implementation running at 06:52Z |
| ↳ LIN-3976 | Run page | **Todo** | – | 0 | Not started; waits on LIN-3975 |
| ↳ LIN-3986 | Live Console lane rule (the unwedge) | Done | 1/0/1/1 | 4.6 | ↳ LIN-3990 Backlog |
| ↳ LIN-3977 | Live Console | Done 26 Oct 02:59 | 7/8/2/2, R2 | 44.4 | ↳ LIN-4002 round 2 Todo; LIN-3998 to LIN-4001 Backlog |
| ↳ LIN-3978 | Dispatch | **Todo** | – | 0 | Not started; LIN-3979 (merge preset systems) Backlog |
| ↳ LIN-3980 | Landing | Done 26 Oct 01:21 | 1/0/3/2 | 13.0 | Email pages handed to LIN-3973; ↳ LIN-3981 demo workspace Backlog |
| ↳↳ LIN-3995 | Landing round 2 | Done 26 Oct 02:22 | 1/0/1/1 | 3.9 | ↳ LIN-3997 (Plain pages ignore the dark system theme) Backlog |
| ↳ LIN-3982 | Swipe | **Todo** | – | 0 | Not started; Home's blue Go button routed here |
| ↳ LIN-4003 | One "is this question open?" reader (the unwedge) | Done | 1/0/1/1 | 3.1 | ↳ LIN-4004 Backlog |
| ↳ LIN-3983 | Observation | **In Progress** | 6/6/3/3 plus a breakdown | 35.0 | PR 1 merged (`d3f67854`). PR 2 (words and pieces, judge entries, workspace-scope default, selector migration) has implementation running at 06:52Z. ↳ LIN-4005 |
| LIN-3895, LIN-3896 | Chat end goal; Ship Biscuit narrative | Backlog | – | 0 | Design targets, not scheduled |

### Flank, refactors, model routing and process (23–25 Oct)

| Ticket | Asked to do | State | Rounds | $ | Left undone |
|---|---|---|---|---|---|
| LIN-3754 | UI flank: tidy the seams before the UI | Done 24 Oct 21:30 | parent | 0 | Its last comment lists: the Pages ⇄ Runs knot (5/6), a re-export, a name clash |
| ↳ LIN-3554, LIN-3755, LIN-3837, LIN-3840, LIN-3917, LIN-3921 | Seam moves | All Done | 0–2 plan-reviews each | 3.0–16.0 each | ↳ LIN-3922, LIN-3923 Backlog |
| LIN-2246 | Split the workspace-API router | Done 24 Oct | parent | 0 | ↳ LIN-3961 Backlog |
| ↳ LIN-3842, LIN-3861 (→ LIN-3871), LIN-3872, LIN-3876, LIN-3877, LIN-3883, LIN-3893, LIN-3894 | Byte-identical moves | All Done | 0–2 plan-reviews; LIN-3861 2/2 | 4.4–21.9 each | ↳ about 12 light-lane test and comment follow-ups (LIN-3873, LIN-3879, LIN-3885, LIN-3907 to LIN-3913, LIN-3926 …), mostly Done |
| LIN-3820 | Model routing, parent | **Todo** | – | 2.8 | ↳ LIN-3859 (D5) Todo; LIN-3874, LIN-3914, LIN-3915 Backlog |
| ↳ LIN-3852 to LIN-3858, LIN-3882, LIN-3916 | Registry, store, proxy, D2 to D4, catalog, prices | All Done | LIN-3853 3/3; LIN-3882 2/2 with R4 | 2.9–24.1 each | John's production checks for LIN-3882 (the six model pins) |
| LIN-3891 | Pipeline churn research | Done | – | 14.3 | ↳ LIN-3903, LIN-3904, LIN-3905, LIN-3906 Done (LIN-3906 was held, then released); LIN-3897 to LIN-3901 Canceled as duplicates; LIN-3902 Backlog |
| LIN-3959, LIN-3932, LIN-3847, LIN-3851, LIN-3860 | Rulings join; unwedge paper; method; replay pump; change coupling | All Done | ≤ 1 plan each | 2.3–6.6 | LIN-3932 says the record "cannot tell yet" |
| LIN-3936 | Costs, parent | **Backlog (paused)** | – | – | ↳ LIN-3937 Backlog after an abort (52.3, of which Opus implementation 43.5; PR #2136 open); LIN-3944 paper Done (10.0); LIN-3938 to LIN-3943, LIN-3945, LIN-3948 Backlog |

### Periodicals, incident and tidy-ups (23 Oct)

| Ticket | Asked to do | State | Rounds | $ | Left undone |
|---|---|---|---|---|---|
| LIN-3765 (+ LIN-3766 to LIN-3768) | Integration & Surface Maturity, run 4 | Done 23 Oct 10:18 | LIN-3766: 4/7/4/1, 32 wakes | 64.7 together | It started on 21 Oct and was held through 22 Oct |
| LIN-3776 | Security Review | Done | – | 6.4 | ↳ LIN-3779, LIN-3780 Done; LIN-3778 Backlog (waits on ruling `lin3098-same-user-boundary`) |
| LIN-3786, LIN-3791, LIN-3797, LIN-3801, LIN-3810, LIN-3814, LIN-3825, LIN-3831, LIN-3832 | The other periodicals | All Done 23 Oct | 0–1 plan, no plan-review | 6.3–13.7 each | ↳ High ones Done: LIN-3787, LIN-3788, LIN-3798, LIN-3805 (3/3, 23.3), LIN-3811 (3/3, 19.9) → LIN-3865, LIN-3812 (3/3, 34.1), LIN-3827 (4/4, 17.2), LIN-3829. Backlog: LIN-3799, LIN-3806, LIN-3807, LIN-3813, LIN-3815 to LIN-3817, LIN-3828, LIN-3834 to LIN-3836 … |
| LIN-3773 → LIN-3774 → LIN-3790 | Dashboard 503: investigate, fix, follow-up | Done | LIN-3774 3/3 | 2.3; 17.9; 16.4 | ↳ LIN-3822, LIN-3826 Backlog |
| ↳ LIN-3775 | Error pages say what failed | Done | 2/2 | 14.6 | ↳ LIN-3792, LIN-3793 Backlog |
| LIN-3759 | SD: a child's PENDING-EXTERNAL report reaches its parent | Done | 3/4 | 21.1 | ↳ LIN-3781 to LIN-3784 Backlog |
| LIN-3771 → LIN-3789 | Email sign-in: rate limit, then remove the site-wide ceiling | Done | – | 10.5; 5.6 | ↳ LIN-3777 Backlog |
| LIN-3772 | harbour-cat's own MongoDB user | Done (design note and runbook) | 4/5/2/2, R3 | 32.5 | The cutover (LIN-3845) is parked by John |
| LIN-3795 → LIN-3796 → LIN-3818 | Masking on public /t/ pages | Done | 3/3; 1/0; 4/4 | 14.7; 9.0; 18.9 | ↳ LIN-3819, LIN-3824 Backlog |
| LIN-3761 to LIN-3763, LIN-3279, LIN-3804, LIN-3808, LIN-3809, LIN-3830 | Tidy-ups | Done | 0–2 plan-reviews | 3.0–8.8 | ↳ LIN-3802, LIN-3803, LIN-3823 Backlog |
| LIN-3758, LIN-3769, LIN-3770 | RCA of the 21 Oct stall; Railway incident triage; maintenance mode | **Todo** | custom runs only | 1.9; 6.2; 0 | Carried from the LIN-3613 cycle; no outcome recorded |

Totals by group (priced, a floor):

| Group | Priced |
|---|---|
| Periodicals | about $149 |
| 23 Oct incident and tidy-ups | about $330 |
| Flank and router | about $106 |
| Model routing | about $103 |
| Settings (incl. LIN-3855 and LIN-3952) | about $224 |
| Home chain | about $142 |
| Plain layout | about $30 |
| Full pages after the re-scope | about $141 |
| Costs | about $62 |

---

## 3. Each UI page, by the tickets' own record

| Page | State | What's known to be left |
|---|---|---|
| **Settings** (areas, Sources, Health, Account, Running, Features) | **Done** (LIN-3846, LIN-3848, LIN-3849, LIN-3887 to LIN-3890); John reviewed it live | The leftovers sit in LIN-3952 (not merged). Backlog: LIN-3919 (aria-checked), LIN-3925 (one log entry per move), LIN-3927 (Disconnect confirm). The LIN-3952 review asked close-out to file one more ticket: Health latency rows print raw model ids |
| **Settings › Models** | **Mostly done** (LIN-3855; panel LIN-3962, LIN-3987, LIN-3992) | LIN-3952: spend on every row, pending bar, sidebar, log, presets restyle, 390px labels. It's approved but unmerged. LIN-3979 (one preset system) Backlog |
| **Home** | **Done**, after six merged tickets (LIN-3833, LIN-3962, LIN-3966, LIN-3968, LIN-3987, LIN-3991, LIN-3992) | Backlog: LIN-3930, LIN-3964, LIN-3965, LIN-3988, LIN-3989. The Go button renders blue (routed to LIN-3982). The duration format and the orphaned "watch on the task page" link were routed to LIN-3975. "Most-used ordering" was dropped by the 13:40Z ruling on 25 Oct |
| **Task page** (with task chat fold) | **Partly done**: PR 1 of 3 merged 26 Oct 06:34Z (LIN-3975) | PR 2 and 3 (#2169: attempt links, times, summary, PR line, Merge restyle, chat fold) have no CI because they're stacked; implementation was running at 06:52Z. The judge replay and the `/styleguide` pill anatomy are due before the last PR. LIN-3955 and LIN-3965 Backlog |
| **Run page** | **Not started** (LIN-3976 Todo) | John has answered the brief's questions (the task is home; Stop cancels only this run). It waits on LIN-3975 |
| **Live Console** | **Done, round one** (LIN-3986, LIN-3977, merged 02:51Z; promoted out of experimental) | Round 2, LIN-4002, is Todo. LIN-3990 and LIN-3998 to LIN-4001 Backlog. John's production checks are listed on LIN-3977 |
| **Dispatch** | **Not started** (LIN-3978 Todo) | Answers recorded (keep it a nav page; preset merge is LIN-3979). LIN-3952 also edits Dispatch (the "No job" row) |
| **Landing** (and sign-in doors) | **Done** (LIN-3980, LIN-3995) | The email pages' look belongs to LIN-3973 (not started). The cross-check of `/auth/email` against `/` falls to whichever ticket merges second. LIN-3981 demo workspace and LIN-3997 Backlog |
| **Swipe** | **Not started** (LIN-3982 Todo) | Waits on LIN-3975. The blue Go button override in `swipe.css` was added to it |
| **Observation** | **Partly done**: PR 1 of 2 merged 06:44Z (LIN-4003, then LIN-3983) | PR 2 is running. LIN-4005 (the brief misreads PR state) Backlog |
| **Plain layout** | **Built** (LIN-3950, LIN-3958, LIN-3956) | LIN-3957 (styleguide samples) and LIN-3997 (dark system theme ignored on /privacy and /terms) Backlog |
| Plain: Privacy, Terms, Account home | **Done** | LIN-3997 |
| Plain: Workspace KPIs (+ Escalation, Effort folds), Public KPIs | **Not started** (LIN-3970) | Open scope question in the brief: workspace or session |
| Plain: Templates (+ Prompts catalog fold), Custom prompts | **Not started** (LIN-3971) | A privacy constraint on the fold is written into the brief |
| Plain: Task edit and create, Runner setup, Proxy | **Not started** (LIN-3972) | – |
| Plain: system pages, email sign-in | **Not started** (LIN-3973) | Two operator items added before launch |
| Next run, `prototypes/` | **Deleted** (LIN-3912) | – |
| Audit → Settings › Health fold | **No ticket** | Listed under the charter's "Then" |
| Swim, feedback widget (37 hex colours), `/styleguide` final pass | **No ticket** | Swim was "Full" in the 24 Oct table but appears in neither the 25 Oct in-scope list nor the out-of-scope list |
| Whole-stylesheet review; Design & Interface re-run | **No ticket** | The charter's last two steps |
| Roadmap, Library, Flight Companion, Collective, Ship Biscuit, Ship, Ship Journey; Passage Planner | **Out of this charter** (25 Oct); Passage Planner "left as is" | – |

---

## 4. What made work fast or slow, cheap or costly

**P1. Plan-review loops come from plans that re-derive a rule the code already has. A small prerequisite ticket ends them quickly.**
- **LIN-3977.** Rounds 2 to 6 blocked on the same thing each time: how runs become lanes, and which runs count as "waiting". The session banner already had that rule (`loopIsWaiting`), and the plan's copy kept disagreeing with it. Once the lane rule was split out as LIN-3986, it took one plan round and 54 minutes ($4.6), and LIN-3977 approved two rounds later.
- **LIN-3983.** Findings F1, F5, F6 and F7 were all a per-loop copy of the rulings builder's per-cluster "is this question open?" rule. LIN-4003 exported the real rule in 40 minutes ($3.1), and the next plan approved.
- **Lesson already recorded.** The operator's lesson on LIN-3932 (26 Oct 03:03Z) is to split when two plan-reviews in a row block on the same class. It would have saved about an hour on LIN-3977.
- **The same thing in the churn data.** LIN-3891 counted LIN-3849's rounds 3 and 4, which re-bounded the same docs-prose class, as avoidable.
- **A different kind of loop.** LIN-3975's five rounds (02:37 to 03:19Z) each found a different defect class: a class bound, a wiring rule, a 30-day window, an ISO-string-versus-Date comparison. That loop came from correctness gaps, not a copied rule.

**P2. Questions answered before launch go smoothly. Rulings and items added during a run make the next round.**
- **Smooth.** Briefs whose open questions John answered at filing, with no rulings during the run, went through with one plan and no plan-review: LIN-3980 (Landing), LIN-3986, LIN-4003, LIN-3992, LIN-3995.
- **LIN-3833.** It took 7 rulings during the run:
  - The Q1 harness ruling (09:16Z) added a commit. That commit failed the next two plan-reviews (09:47Z, and 10:26Z with three blockers, one of which reopened the LIN-1694 crossed pair), and it later needed LIN-3966.
  - A "Q3 your-agent reader" was built into the plan, then dropped by ruling at 09:39Z (now LIN-3930).
  - The fit rule for "Another step" was ruled twice (13:40Z, then 17:04Z, which reversed it to "every step fits"), and each ruling meant a build round.
  - Per-step numbers were dropped at 12:44Z and rebuilt in LIN-3962.
- **LIN-3968.** A cancelled-stage ruling (20:12Z), then a failed-row ruling (21:17Z), came with 4 implementation and 4 review rounds.
- **Items added during runs.** The charter says "a running ticket is not amended", yet operator items were added while tickets ran:
  - LIN-3952 at 00:50Z, after research had finished (an item moved over from LIN-3992);
  - LIN-3975 at 02:49Z;
  - LIN-3956 at 17:10Z, one minute after launch.

**P3. The first pass on a page is expensive. The rounds after it are cheap, but there are many of them.**
- **First passes:** LIN-3833 ($51, 9.3 h), LIN-3846 ($48), LIN-3977 ($44, 7.1 h to merge), LIN-3975 ($37 so far, open), LIN-3983 ($35 so far, open), LIN-3890 ($38).
- **Rounds after:** LIN-3987 $7.4 (1.7 h), LIN-3992 $3.2 (0.9 h), LIN-3995 $3.9 (0.9 h), LIN-3958 $6.3, LIN-3991 $13.2.
- **Where the rounds come from.** Each one is the UI design session's review of a merged page. Home has had five tickets since LIN-3833 merged, and every close-out files more Backlog items (LIN-3998 to LIN-4001 came from LIN-3977's close-out alone).
- **The cheapest work.** Light-lane follow-ups ran one plan with no plan-review, in 20 to 40 minutes for $1.5 to $3 (LIN-3850, LIN-3867 to LIN-3869, LIN-3885, LIN-3908, LIN-3910, LIN-3913).
- **A long brief isn't the cost driver.** The router moves had 20,000 to 37,000-character briefs and went through with at most one plan-review (LIN-3872 $4.4, LIN-3876 $6.0). They specified byte-identical output.

**P4. Running several PRs on one ticket confuses the pipeline.**
- **Conflicting instructions.** The UI briefs open with "One PR per move; more than one PR is fine." Their operator rules say "This is one PR. Don't split it into child tickets." Both are in LIN-3975, LIN-3977, LIN-3980 and LIN-3952. On LIN-3983 a breakdown pass ran and created nothing, quoting the rules.
- **No CI on stacked PRs.** `test.yml` runs only on PRs into main, so LIN-3975's stacked #2169 has no CI and the reviewer ran a substitute.
- **The stage engine misroutes.** The autopilot had to override the engine on:
  - LIN-3846 (15:52Z, a duplicate implementation);
  - LIN-3912 (review while CI was red);
  - LIN-3956 (`blocked` after the deploy had landed);
  - LIN-3969 (a second PR on a Done ticket);
  - LIN-3975 (twice, 06:26 and 06:30Z: the engine can't see PR-level sequencing);
  - LIN-3983 (05:31Z: it routed review to LIN-3977's merged PR).
- **What the churn research counted.** LIN-3891 counted 12 runs aborted for misroutes or duplicates on 24 Oct alone.

**P5. Parallel lanes and rounds collide.**
- **LIN-3855.** The judge's findings were posted at 10:30Z, after the fix round had been dispatched, which "never saw them", so one more round was needed.
- **LIN-3833.** Two fix rounds built the same "Another step" feature, and the branch collision was resolved at 14:42Z.
- **The second panel.** LIN-3833 built its own run panel while LIN-3855 was building one. The second copy was a miss in its own prediction score, and LIN-3962 exists to remove it.
- **Cross-page CSS.** Home's Go button renders blue because a rule in `swipe.css` overrides it (LIN-3992, now routed to LIN-3982).

**P6. The visual judge only sees pages at rest.**
- **Where it reached, it caught real defects:** LIN-3833's raw "Got it" button, and LIN-3855's "Reviewno runs".
- **Where it couldn't reach, it said so.** On LIN-3962 the panels are closed in its seeded pages (19:49Z). On LIN-3991 its seed has no failed or running sessions: "That isn't a pass on those states" (00:44Z). So the open-panel, failed and running states rest on each PR's own tests.

**P7. Close-outs stall on things outside the code.**
- A deploy that didn't follow main held LIN-3956 from 19:39 to 20:44Z.
- A conflicted PR started no CI (LIN-3980, 00:33Z).
- Recurring flakes: `db-indexes.test.js:771` (LIN-3985, seen on LIN-3956 and LIN-3962), and the LIN-3833 e2e specs, which turned main red (LIN-3969).
- Close-outs also push commits after the approval, which by their own note "nobody reviews" (LIN-3962, LIN-3855, LIN-3890).

**P8. Spend.** Opus plan-reviews and reviews make up most of the priced cost after 24 Oct, because Haiku implementation is unpriced. The largest single sessions were Sonnet implementations: LIN-3846 ($33.3), LIN-3849 ($21.0), and Opus on LIN-3937 ($43.5, which the pause then aborted). The record can't say whether Haiku raised the number of implementation rounds. UI tickets after the switch took 3 to 5 implementation rounds (LIN-3833, LIN-3968, LIN-3962, LIN-3980, LIN-3975), against 1 to 2 for UI tickets on Sonnet (LIN-3846, LIN-3849, LIN-3887), but their scope also differs.

---

## 5. Questions for John

1. **Budget.** The meter read 91% at 07:00Z, past the charter's 90% pause. Two implementations were running at 06:52Z (LIN-3975 PR 2/3 and LIN-3983 PR 2), and the queue behind them is long. The meter resets Thursday, and the external test is "next week". Do you want them stopped, finished, or the cap raised?
2. **What the external test needs.** Not started: the run page (LIN-3976), Dispatch (LIN-3978), Swipe (LIN-3982), Live Console round 2 (LIN-4002), the four Plain batches (LIN-3970 to LIN-3973, Backlog with no priority even though their blocker is done), the Audit fold, the stylesheet review and the D&I re-run. Which of these must land before the test?
3. **Pages with no ticket.** Swim was "Full" on 24 Oct and is in neither 25 Oct list. The feedback widget (37 hard-coded colours) and the Audit → Health fold have no ticket. In, or out?
4. **LIN-3952.** It has a conditional Approve at 05:15Z, its wake is `blocked`, and it isn't merged. Should it be closed out? It also moves the "No job" row onto Dispatch before the Dispatch brief (LIN-3978) runs.
5. **Who answered the overnight rulings?** The record calls some of them the operator's:
   - `lin3977-plan-after-r5` was answered "revise-again" while you were asleep;
   - `lin3983-pr1-scope` was answered "accept";
   - LIN-3962's 390px ruling is called "the operator's ruling", but LIN-3992 refers to it as "the blank option John ruled on";
   - LIN-3975's `wait_merge`.

   Which did you press, and which should you still confirm or clear?
6. **Open questions kept at today's behaviour.**
   - LIN-3987: how to show price on Claude Code.
   - LIN-3992: "From Models" or "As Settings › Models sets it".
   - LIN-3952: who may set "No job" (any member, or owner only); the stage renames (implementation → Build, autopilot → Kick-off); the fold cutoff.
   - LIN-3970: KPI scope.
   - LIN-3927, LIN-3998.
7. **Contradictions in the charter.**
   - The description still lists the LIN-3790 production checks, which a 24 Oct 09:25Z comment says you dropped.
   - Periodical 9 still reads "close-out", though it was Done on 23 Oct.
   - "Running now" is from 25 Oct 11:30Z.
   - LIN-3906 reads both "Held (John: Hold D for now)" and "released".
   - There is no log entry after 25 Oct 18:31Z.
8. **Items that moved between tickets. Please confirm none were dropped.**
   - Per-step numbers: LIN-3833 → LIN-3855 and LIN-3962.
   - "Says your agent": LIN-3833 → LIN-3930.
   - Ask Harbour: → LIN-3964.
   - Scan and Context: → LIN-3965 (they have no home on any page now).
   - The panel: LIN-3952 → LIN-3962.
   - LIN-3992 items 2 and 5 → LIN-3952.
   - Email pages: LIN-3980 → LIN-3973.
   - Blue Go button: → LIN-3982.
   - LIN-3991 items → LIN-3975.
   - "One move, one log entry" was in LIN-3886's scope on 24 Oct and is now LIN-3925, Backlog with no priority.
   - "Most-used ordering" for Another step was dropped by ruling.
9. **Waiting on you in production.**
   - The LIN-3719 backfill (dry run, then `--write`).
   - LIN-3882: the six model pins.
   - LIN-3977's checks.
   - Ruling `lin3098-same-user-boundary` (LIN-3778).
   - The LIN-3772/LIN-3845 cutover, parked.
   - The companion's proxy token expires 26 Oct 08:25Z.
10. **Loose ends.**
    - LIN-3758 (RCA) and LIN-3769 (Railway triage) are Todo with no outcome.
    - LIN-3757 and LIN-3820 are Todo, though their main children are Done.
    - LIN-3937's PR #2136 is open, and the run was aborted after $52. Keep it for the Costs charter, or close it?
    - LIN-3548 (design) still waits on you.
