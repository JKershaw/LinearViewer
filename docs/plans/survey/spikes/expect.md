# Spikes: what I expect before looking (26 Nov)

Written before any spike starts. Plan agreed with John on 26 Nov:
1. runner fixes (simple-dispatcher);
2. one clean-up ticket (Harbour);
3. slice 5 (lessons);
4. slice 6 (wakes), taking A2 and A3;
5. UI tickets as tokens allow.

Spike 0, the ledger, checks the plan covers everything named since 2 Nov.

Every spike answers the same questions:
- Is the problem still real (evidence since 25 Nov)?
- What's the smallest change that solves it?
- What does it retire?
- Does it overlap another step?
- What would witness it working?
- What would change the plan?

## My predictions

0. **Ledger.** About 40 to 60 improvements were named since 2 Nov. I expect most to be done or retired by slices 3 and 4, about 10 to 15 still open, and several of the 21 Nov rough edges gone with slice 4. The seven safety findings are partly open (LIN-4416 was narrowed to theme 1).
1. **Runner.** Nothing has fixed LIN-4569's findings on main since 25 Nov, so they still hold. Leaked terminals have a small fix: kill the process id recorded at launch instead of reading the identity back. The failed re-fire retry is small too. The plan holds: two tickets.
2. **Clean-up.** Close-out's hand-back findings sent `to: review` still have no owner, and an edited piece plan still gets no fresh plan review. A1's rule exists only as decision-5dbdf161 and a note, not in the review prompt. The secrets backfill and the reaper fix are small. The plan holds: one ticket.
3. **Slice 5.** The notes are still growing. The integration design's slice 5 section still fits after areas and paths were removed. Lessons have no home but the notes. I expect slice 5 to be smaller than slice 4.
4. **Slice 6.** The evidence supports it, and A2 and A3 both fit "wake a reader when an open record it depends on changes". The risk: A2 might be a small engine fix better placed in the clean-up ticket, with slice 6 left for the rest.
5. **UI.** The held tickets are still relevant. LIN-4546 and LIN-4342 have partly done LIN-4017's stylesheet work, so LIN-4343 (walk every page) is the most useful next.

**One constraint found before starting:** the new token can't dispatch (403 `DISPATCH_GRANT_REQUIRED`). The runner spike can't be a Harbour run unless John dispatches it, so it starts as a code read plus LIN-4569's findings.
