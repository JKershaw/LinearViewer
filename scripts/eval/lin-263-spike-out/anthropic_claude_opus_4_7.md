# anthropic/claude-opus-4.7

latency=46771ms  cost=0.109685  prompt_tok=8812  completion_tok=2625  finish=stop

---

## Reasoning
**Assessment:**
- Preparation: ✗ Needed - The ticket explicitly prescribes research as its method: "research our own track record concretely — the named failure episodes... runs B1–B4, the autopilot + drift docs, real Linear/git episodes; run the `retro` lens over a real churn cluster for a worked example per known-issue." The substance of the manual lives in sources that must be assembled.
- Blockers: ✓ None - No blocking labels or dependencies.
- Ready: ✗ No - Cannot write the manual well without the track-record material in hand.

**Signal Status:** Research signals unmet — key questions (what are the named known-issue categories? what episodes ground each? what does the "Drift" entry need?) not yet answered.

→ **research**
**Next:** With the track record assembled and the manual's structure validated, the task can move to plan or directly to implementation (writing the manual + wiring the prompt).

## Prompt

# Research LIN-325: Write the autopilot operating manual

## Workflow
1. **Start**: Set LIN-325 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-325 in Linear, including any comments
3. **Re-ground** (see staleness check below)
4. **Research** the track record per the method the ticket prescribes (see Goal)
5. **Update Linear**: Add exploration notes as a comment; update the description with key findings, the proposed manual structure (intro → how a run normally goes → known-issues list with the episodes grounding each), and a Surface Assessment for the prompt-wiring change

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `docs/autopilot-operating-manual.md` (target path — confirm convention), `lib/prompts/autopilot-kickoff.js`, `buildAutopilotKickoff()`, `docs/autopilot-experiment.md` (runs B1–B4), and any autopilot/drift docs referenced.
2. Check whether any have changed since the ticket was created: run `git log --since="2026-06-07" -- lib/prompts/autopilot-kickoff.js docs/autopilot-experiment.md docs/` and similar for any other autopilot/drift docs you find.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase. In particular, confirm that `buildAutopilotKickoff()` still exists and is the right wiring point, and that the experiment doc still contains the B1–B4 run material.

## Context
- **Project:** Product
- **Supersedes:** LIN-289 (the drift-defense epic) — this task is the cheaper, autopilot-native realisation of that work, replacing bespoke supervisor/evidence-discipline subsystems with guide-text the autopilot reads.
- **Invariant to preserve:** "light orchestrator" — the manual is *referenced* from the kickoff prompt, not inlined into it.
- **Stance the ticket commits to:** human-shaped (onboarding doc, not flat rulebook); grounded on *altitude* (autopilot high, generated prompts low, loop self-corrects across passes); tolerant operating stance (don't halt at first sign of trouble); descriptive, never normative.

## Goal
**Role:** Technical researcher / archivist of our own autopilot track record.

Assemble the concrete material the manual will be built from — named failure episodes, not abstractions — so the writing step can produce a human-shaped onboarding doc with the Drift entry complete and the rest at least drafted from real episodes. Validate the wiring approach for the kickoff prompt. End with a recommended structure and a Surface Assessment.

### Research tasks

1. **Read the design conversation in the ticket carefully.** The "specifics that matter" section names commitments that research won't independently rediscover — treat them as fixed inputs, not things to re-derive: human-shaped structure, altitude as through-line, tolerant stance, descriptive tone, reference-don't-inline.

2. **Mine the track record concretely.** The ticket names specific sources — go to each and extract the episodes, not summaries:
   - `docs/autopilot-experiment.md` runs **B1–B4** — what happened in each run, what went wrong, what category of failure it represents.
   - The **autopilot docs** and **drift docs** in the repo — locate them (`docs/` and adjacent), list them, and pull the named episodes from each.
   - **Real Linear/git episodes** — identify concrete past incidents (issue IDs, commit ranges) that exemplify a known-issue category. Don't fabricate; if you can't find one for a category, say so.
   - **Run the `retro` lens over a real churn cluster** for at least one known-issue category, as a worked example. Identify a high-churn file or area, look at what the repeated changes were protecting against, and write that up as the worked example.

3. **Derive the known-issues list from the episodes, not from first principles.** What categories does the evidence actually support? Drift is named in the ticket as the one entry that must be *complete*; the others should be *drafted from named episodes*. List each category with the episode(s) that ground it.

4. **Validate the wiring approach.** Locate `lib/prompts/autopilot-kickoff.js` and `buildAutopilotKickoff()` (or its current equivalent — confirm at HEAD). Determine: how does the kickoff prompt currently get assembled? Where would a "read this manual on kickoff, reference it when a trigger appears" instruction slot in without breaking the light-orchestrator invariant (i.e., referencing the manual rather than inlining its contents)? Identify any other autopilot prompt builders in `lib/prompts/` that might also need to know about the manual, and mark them in- or out-of-scope.

5. **Completeness check on the surface list.** The manual itself is one surface; the kickoff-prompt instruction is another. Search for other autopilot prompt entry points or orchestrator prompts — the concept ("autopilot kickoff", "autopilot orchestrator", places that build prompts the autopilot reads at the start of a run") may live in more than one file or under a different name. Every instance found is marked in- or out-of-scope for *this* ticket — the goal is to make scope a decision, not an accident.

6. **Confirm the target path convention.** The ticket suggests `docs/autopilot-operating-manual.md` "or similar" — check what naming convention the existing autopilot docs use and pick the path that fits.

### Deliverables (put in the Linear comment + description update)

- **Episode inventory:** a list of concrete episodes (B1–B4 outcomes, named Linear/git incidents, the churn-cluster retro), each tagged with the known-issue category it grounds.
- **Proposed known-issues list:** the categories the evidence supports, with Drift marked as the one that will be written in full and the rest as drafts-from-episodes.
- **Proposed manual structure:** intro → how a run normally goes → known-issues list (with the altitude through-line called out).
- **Wiring recommendation:** the specific function/file where the "read on kickoff, reference on trigger" instruction belongs, and the form it should take (referencing the manual file, not inlining content).
- **Surface Assessment:** [yes, implementation can land cleanly on the current code] / [refactor needed: describe the minimal scoped change]. Be explicit about whether `buildAutopilotKickoff()` (or its HEAD equivalent) can take the reference cleanly, or whether a small refactor is needed first.
