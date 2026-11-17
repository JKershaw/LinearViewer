# D: the data-layer walks (17 Nov)

*Paths are under `docs/plans/survey/`; `wN/` means `layer/walks/N/`. [checked] means I opened the record or re-ran the count (stores, `analyse.mjs`, grade totals); [reading] is my judgement.*

## 1. What the walks were meant to test, in John's words

- The idea: "a small minimal MVP, and we take it for a walk and see a) if it's better than the current system, and b) where it still breaks (and why)"; rebuild each time "to intentionally avoid patching" (log.md:4260).
- Walk 1: "retroactively filling in the data from a completed task, see how it fits, see how the information comes out … only once we're confident with those cheap checks shall we try it in motion" (log.md:4260).
- After walk 1: "does our proposal hold and use the right information"; next, "what a task looks like after each agent step … on a small range of tasks" (log.md:4272).
- After walk 2: run "a bunch of tests and tasks and situations to really see if we are now containing everything", and only then real work (log.md:4278).
- After walk 3: "the data layer doesn't _act_ … Where is the new data layer more than a well structured database?"; "I suspect we have drifted"; "it just needs to be correct for what Harbour needs" (log.md:4284).
- After walk 4: "try out a wider range of tasks"; settled only once "simple enough to use, and working far better than the existing solutions" (log.md:4288).
- After walk 5: "If it was a bad test, why didn't you just run a good test?" (log.md:4292).
- After walk 6: "We wanted to know if the data structures could handle the data … Have you lost track of the point?" (log.md:4296).

## 2. What each walk ran

1. LIN-4450 filled in after the fact: 45 records, 88 versions, no rule hits (w1/results.md:7-8) [checked, `w1/fill/store.json`].
2. LIN-4450's eight stages replayed, each by a fresh agent given its brief and its real output; `show.txt` after each step (w2/results-4450.md:38-44) [checked]. LIN-4472 and LIN-4455 were never run.
3. Three tasks (27 steps) with queries allowed, plus six scenes, each scene played by one agent acting as every actor (w3/expect.md:5; w3/results.md:7) [checked]. The model still enforced who-may-write rules (`git show 83db519b6:…/design.md`, §3.3) [checked].
4. Walk 3 re-run on a store that checks shape only (w4/results.md:3-7). Rounds 1–3 had a section "Rules the code enforces"; round 4 says "Nothing is refused for who wrote it or when" (`git show c2581c974`) [checked].
5. Six replays (LIN-4450 and five new shapes) and a quiz: at six stage starts, a ticket reader and a store reader answered six questions each (w5/results.md:7,13-23). There are 59 step folders, not the 57 stated [checked].
6. No stage wrote on the round-6 model. Walk 5's stores were copied over with each stage's posted words added to its run (`w6/carry.mjs`); then the quiz again at eight points with three readers (w6/results.md:11).

## 3. What each showed, and whether the design fixed it

- **Walk 1.** One bulk-path finding where the tickets retell it, and the live probe kept as checks [checked, store]. But 20 of 22 addressees had to be guessed (w1/fill/fill-log.md:66), so a retro fill cannot test routing (w1/results.md:54). Seven breaks (w1/results.md:46-52), all taken into the round-2 page; walk 2 confirmed verdict reasoning, hand-on and the parent's ask (w2/results-4450.md:63-68) [checked].
- **Walk 2.** All 28 hand-offs had an addressee; 3 went to `place`, which is no reader (w2/results-4450.md:43). Briefs grew to 16.9k–35.3k, larger than the ticket at seven of eight stages, and retelling returned (w2/results-4450.md:50-57,80) [checked, `brief.txt` sizes]. The task closed over approvals on a moved head (change-1@2, now v4) [checked, `steps/8-close-out/show.txt`].
- **Walk 3.** Retelling stopped and briefs held at 13.5k–21.4k [checked, `analyse.mjs`]. Stale over-fired: 22 records in LIN-4450 [checked, re-ran `show`]. The rules got in the way: the autopilot was refused even reads, and plan review could not revise pieces (w3/results.md:36,52). Round 4 removed the rules.
- **Walk 4.** Two refusals, both about shape [checked, step notes]; stale showed only the two verdicts on the moved head in each task [checked, `show.txt`]; survey-place's brief halved [checked]. John's ruling reached him only because he searched his own words (w4/replay-4472/steps/6-John/notes.md:30). Six shape breaks (w4/results.md:52-57); all but blindness in queries and same-task runs were shown fixed in walk 5 or 6 (layer/paths.md:59).
- **Walk 5.** Quiz totals: ticket 27/36 right, store 20/36 [checked, six `grade.md`]. There were 23 "takes no to" refusals [checked]. Stale over-fired again through chains (w5/results.md:41). Records stayed addressed to stages that had already run: at LIN-4446's end, three to review and three to implementation [checked, `analyse.mjs`].
- **Walk 6.** Ticket 38/48 right, store 29, ticket plus computed facts 36 [checked]; stale at most one flag per brief [checked]. The round-6 write-side fixes (a `to` on any record, verdicts superseded, area scope, blindness in queries) were never exercised (layer/paths.md:59; log.md:4296).

## 4. Did each walk test John's question?

- **Walk 1:** yes; John accepted it on his own terms (log.md:4272).
- **Walk 2:** yes for one task; the "small range" came in walk 3 [reading].
- **Walk 3:** the scope matched, but much of it tested enforcement rules John never asked for. The session admitted "the drift was mine" (log.md:4284).
- **Walk 4:** yes. It asked directly whether the store holds and routes the information [reading].
- **Walk 5:** the wider range, yes. The quiz was the session's reading of "far better", and John rejected it (log.md:4292).
- **Walk 6:** no. It wrote nothing through the new shape, and it tested reading rather than whether the structure holds the data, as John said (log.md:4296).

## 5. Claims the records do not support

- **"The store caught things the ticket hides (a blind read on the wrong base; an ask already answered)"** (w5/results.md:48-49,68; log.md:4290). In both cases the real stage had already said so on the ticket: w5/replay-4464/real/10-autopilot.md:11-13 and w5/replay-4459/real/9-close-out.md:12,41 [checked]. Replays copy the real outputs, so the store added nothing.
- **"Every store miss traces to what stages wrote"** (w5/results.md:27; log.md:4290). The same list blames the design refusing `to` and a replay timing artefact (w5/results.md:28,31).
- **"Three readers per point, each fresh"** (w6/results.md:11). At the six stage starts, `answers-T.md`, `key.md` and `ticket.md` are byte-identical to walk 5's [checked, `cmp`].
- **"This is not a test artefact any more"** (w6/results.md:39). The records are walk 5's, written when decisions and verdicts could not take a `to`. Walk 6's own expectations predicted misses for that reason (w6/expect.md:5).
- **"Stages writing live address their own records well"** (layer/design.md:134). No walk ran in motion; every stage was a replay of real output (layer/design.md:39).
- **"With only shape checked … stale shows only the real signal"** (layer/design.md:134). Walk 5 contradicts it (w5/results.md:41).
- **"S6 gave the … question a real cost: the newsletter went out with placeholders"** (log.md:4282). S6 was a scene played by one agent (w3/situations/S6/result.md:15); nothing went out.
- **"Yes, across six task shapes … faults found each round fixed in the page"** (log.md:4296). Routing and ending under round 6 are unshown. Walk 5's orphaned records and walk 6's "findings never ended" (w6/results.md:32) are evidence against "ends it" [reading].
- **`design.md` was not revised after John's last message.** It still frames walk 6 as asking whether a store reader "know[s] its situation better than one reading the ticket" (layer/design.md:140), and its sources stop at walk 5 (layer/design.md:153) [checked: last commit `d6b5c7650`].
- **Not checked by me:** the LIN-4452 runbook finding (w1/results.md:65-70), since LIN-4452 is not in the material.
