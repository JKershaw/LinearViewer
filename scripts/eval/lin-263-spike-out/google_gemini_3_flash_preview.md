# google/gemini-3-flash-preview

latency=5560ms  cost=0.005125  prompt_tok=5696  completion_tok=759  finish=stop

---

## Reasoning
**Assessment:**
- Preparation: [✗ Needed] - The task explicitly prescribes a research method: "Seed from the design conversation... research our own track record concretely — the named failure episodes... run the retro lens over a real churn cluster." This knowledge is not yet gathered.
- Blockers: [✓ None] - No active blockers identified.
- Ready: [✗ No] - Implementation depends on the substance gathered during the research phase.

**Signal Status:** Research signal not met; key questions regarding named failure episodes and track record are unanswered.

→ **research**
**Next:** Once the track record is synthesized and the approach is validated, the task will move to the planning phase.

## Prompt
# research LIN-325: Write the autopilot operating manual

## Workflow
1. **Start**: Set LIN-325 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-325 in Linear
3. **Research Track Record**:
    - Locate and read `docs/autopilot-experiment.md` specifically focusing on runs B1–B4.
    - Search the codebase and git history for "drift" documentation and real Linear/git episodes related to autopilot failure or churn.
    - Identify "named failure episodes" rather than abstract issues.
    - Apply a "retro lens" over a real churn cluster to extract a worked example for each known issue.
4. **Synthesize Findings**:
    - Draft the "Drift" entry for the manual based on these concrete episodes.
    - Outline the "human-shaped" structure: Intro → Normal Run Flow → Known Issues.
5. **Update Linear**: Add exploration notes as a comment. Update the issue description with the key findings from the track record and a recommended approach for the manual's content.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-07T08:41:20.522Z" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
This task is the realization of the superseded drift-defense epic (LIN-289). It shifts the strategy from coded subsystems to a "judgment layer" manual read by the agent.

## Goal
**Role**: technical researcher

Identify concrete failure episodes from the project's track record and synthesize them into actionable guidance for the autopilot operating manual.

**Research Requirements**:
- Focus on grounding the manual in "altitude" (high-level autopilot vs low-level generated prompts).
- Ensure the stance is "tolerant" and "descriptive, never normative."
- Identify the exact location and current content of the autopilot kickoff/orchestrator prompt (referenced as `lib/prompts/autopilot-kickoff.js` or `buildAutopilotKickoff()`) to understand how to wire the reference.

Surface Assessment: [yes, implementation can land cleanly] / [refactor needed: describe the minimal scoped change]
