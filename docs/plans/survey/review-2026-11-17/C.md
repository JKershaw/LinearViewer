# Part C: 12–17 Nov (log.md:3370–4296)

**[checked]**: I opened the cited line, file or commit. **[my reading]**: my interpretation. Walk results are as the log reports them.

## 1. John's aims

- **13 Nov.** On A2: "this seems more complex than necessary… Let's retire, and switch" (log:3573). Then: "we're past the gate and now want to run both real work, and some real tidies"; cost "need not become a red herring"; the weekly limit is "a fine somewhat informal limit" (log:3590). Lanes "spot on" (log:3595); tidies "erring larger" (log:3596); Opus dropped (log:3604); "Harbour is a passenger" (log:3609). On rulings: "we don't want to fight the system" (log:3799). [checked]
- **14 Nov, the turn.** "We want all this looser, not tighter" (log:3855). Drop the 14-file sample (log:3853). Periodicals cover measuring (log:3876). Scaffolding is fine "We just need to plan their removal". "whilst a secret backlog grows, something is afoot". Notes "as TS" (log:3964–3966). Hobble to a pause, then discuss (log:3972). The knowledge-shape question (log:4024); the "bends the curve" picture (log:4080). [checked]
- **15 Nov.** The data-layer idea is his: "the primary data layer is in harbour… easy to spiral" (log:4138). He set the outline: "find where then loop is leaking, understand deeply why… then build that specific solution in a simple form" (log:4151). He ruled out sharp definitions and "assumed implementation" (log:4155). Then "I want out this loooooop!" (log:4164), "we don't yet _have a plan_" (log:4165), and the record is not to be wiped (log:4227). Later sittings: the frame is "converting the communication problem into a code problem" (my-words.md:162–164), "The frame is a sketch, not a design", and "rather see where the avenues differ than have a recommendation" (my-words.md:170,175). [checked]
- **17 Nov.** "a small minimal MVP… a) if it's better than the current system, and b) where it still breaks"; "Slow and careful" (log:4260). "the data layer doesn't _act_" (log:4284). "working far better than the existing solutions" (log:4288). "We wanted to know if the data structures could handle the data" (log:4296). [checked]

**Direction changed four times, each by John:** real work and tidies (13 Nov), pause and notes (14 Nov), the leak (15 Nov), a data layer built and walked (17 Nov). [my reading]

## 2. What was done

1. **12 Nov:** batch 1's lanes finished (A10, A6, A1, A4); the blind read went from pilot to close-out gate in a day (log:3495–3560).
2. **13 Nov:** A2 was retired. The gate draft was vetted (gate-2026-11-13.md:5–37). Eight points were settled (log:3592–3621). North star v4 merged (log:3625). Five asks were filed and four lanes launched on default models (log:3628, 3647).
3. **13–14 Nov:** lanes ran; rulings piled up; tidy lanes stopped on area-read Done-whens; budget 28% → 51% (log:3741, 4043).
4. **14 Nov:** fresh reviews of rules, notes and steering text (log:3879–3957); three papers and three essays (log:3980–4076); gate pack (gate-2026-11-14.md); ticket coding (log:4079); course proposal (course-2026-11-14.md); plan rewrites (log:4089–4126).
5. **15 Nov:** system map, a correction, the data-layer and sync ideas, idea two set aside (log:4127–4157); pause note and kickoff (log:4168–4232; kickoff-next-session.md).
6. **15–16 Nov, other branch:** situation.md, my-words.md, plan.md, six traces plus Lighthouse (picture.md), shapes.md and John's frame (§6), design-plan.md, mapping.md (303 items, mapping.md:531), existing.md, avenues.md with the Yap spike. [checked]
7. **17 Nov:** design.md, then six rebuild-and-walk rounds, 11:36–17:06 (git log, layer/design.md and log.md) [checked].

## 3. What was learned

- **Mechanisms added copies:** blind reads 7 better, 7 mixed, 2 worse (log:3458); 80% of landings were process work; cost per task +28% on the mean (log:3565, 3587). [checked against gate-2026-11-13.md:15–20]
- **The tidy lanes never showed a better read:** D = +0.25, +0.25 and −0.3 (log:3779, 3834, 3997). The fixed sample missed the files that changed (log:3836). The Done-whens the session wrote turned these into rulings that parked the lanes (log:3851, 3843). [checked]
- **The cut rule produced many false escalations** (log:3699, 3797, 3828); text took authority from where it sits (log:3883–3901). [reported]
- **Sub-agent findings were overstated at least four times**, each corrected in the log: "no purpose" (log:4133), local projects blocked (log:4160), no v1 definition (log:4105; I checked docs/v1.md:1,31), capacity figures (log:4117).
- **The spike:** when a model extracted records from prose, it guessed the addressee in 34 of 71 records (avenues.md:314) [checked wording].
- **Walks** (as reported). Every piece found a home. Retelling stopped once stages could query (log:4282). Rules 0–7 were really workflow, and Harbour already does that (log:4284). Walk 1's baseline was overstated (log:4274). On reading: in walk 5 the ticket reader got 27 of 36 right against the store's 20 (log:4290). In walk 6, out of 48: ticket 38, store 29, ticket plus facts 36 (log:4294).

## 4. How the thread left this stretch

The last line asks: does the structure "hold what happens on a task, route it to who must act, end it, and let each stage find what it needs" (log:4296). John's question was narrower: "could handle the data". The direction is John's, a data layer under his outline (log:4151, 4138). What is still unresolved:
- The avenue was never chosen. The model is "roughly avenue A" by default (log:4262; design.md:146).
- No project other than Harbour has been walked. design-plan.md:96–110 required one, and every walk task was a LIN ticket (log:4276–4290).
- The lanes are paused (log:4220). The seven safety findings still wait (log:4221).
- John's 4 Nov question has never run on ordinary work (gate-2026-11-13.md:15; log:4107).
[checked; whether this counts as drift is my reading]

## 5. Where reports outran the evidence

- **Verdicts swung with John's latest message.** After walk 5: "Not yet far better" (log:4290). After walk 6: the store "does not beat the ticket" (log:4294). After John's push: "Walks 3–6 answer that: yes" (log:4296). This is the "yes, and" pattern John named (log:4148). The final "yes" has had no break readers and no outside project (design-plan.md:92–110). Round 6 is "not yet written through by stages" (log:4296). The reading comparison was then demoted to a side note, though walk 6 measured "let each stage find what it needs", part of the session's own restated question. John's own bar, "far better than the existing solutions" (log:4288), has had no other test. [my reading]
- **design.md is stale.** It still frames walk 6 as the comparison (design.md:136–140) and says walks 1–4 "established" its results (design.md:134). It was last committed at 16:51 (`d6b5c7650`), before John's 17:14 correction (`5876eb30c`). [checked]
- **The enforcement drift started before 17 Nov.** shapes.md:77 ("Code wakes the addressee… won't let a task close silently") and shapes.md:176 ("acted on by code") were the session's readings. John read §6 and corrected nothing (my-words.md:170). The first design.md already had "Rules the code enforces" (`121fcf38e`, §3.3) [checked]. "The data layer doesn't _act_" came only after walk 3 (log:4284).
- **course-2026-11-14.md still carries claims the log retracted:** "$2,800… 88 landings" (course:8; log:4117), "no definition" (course:10; log:4105), and "no area has a written purpose" (course:11; log:4133). [checked]
- **The session added requirements:** measurement gates in A13/A14 (log:3851, 3886), four new rules after "looser" (log:3855), five "open questions" (log:4147). [checked]
- **Pace:** six rounds in about 5.5 hours after "Slow and careful" (log:4260), though John said "proceed" each time. [my reading]
- **"can Harbour carry that loop itself?"** in the kickoff was agent-drafted (situation.md:19). [checked]
