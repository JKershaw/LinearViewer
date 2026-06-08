# LIN-325-research — google/gemini-3.5-flash
expect={research}  got=research  hit=true  latency=18458ms  cost=$0.045333  body=513w

---

## Reasoning
**Assessment:**
- Preparation: ✗ Needed - The ticket explicitly prescribes research as its method ("research our own track record concretely", "run the `retro` lens over a real churn cluster") before writing the manual and wiring the prompt.
- Blockers: ✓ None
- Ready: ✗ No - The substance of the manual depends on knowledge that must be gathered from the codebase history and existing documentation first.

→ **research**
**Next:** Create an implementation plan based on the research findings and drafted manual.

## Prompt
# Research LIN-325: Write the autopilot operating manual

## Workflow
1. **Start**: Set LIN-325 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-325 in Linear
3. **Research and Analyze**:
   - Locate and read `docs/autopilot-experiment.md` (specifically runs B1–B4).
   - Search the codebase to locate "the autopilot + drift docs" and read them.
   - Research the git history and Linear episodes to identify named failure episodes and a real churn cluster. Run a retrospective lens over these to extract worked examples for known issues.
   - Analyze `lib/prompts/autopilot-kickoff.js` and the `buildAutopilotKickoff()` function to understand how the kickoff prompt is constructed and how it can reference (not inline) the manual.
4. **Document Findings**:
   - Outline the structure of the manual (intro → how a run normally goes → known issues to watch for).
   - Draft the Drift entry completely based on the research of the superseded LIN-289 / drift-defense concepts.
   - Draft the remaining sections of the manual using the named episodes and churn cluster examples.
   - Formulate the exact referencing instruction to be added to `buildAutopilotKickoff()`.
5. **Update Linear**: Add a comment with your research findings, the drafted manual structure, and the Surface Assessment. Update the issue description with key findings and the recommended approach.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references (e.g., `lib/prompts/autopilot-kickoff.js`, `buildAutopilotKickoff()`, `docs/autopilot-experiment.md`).
2. Check whether any have changed since the ticket was created (Created: 2026-06-07T08:41:20.522Z): run `git log --since="2026-06-07T08:41:20.522Z" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
- **Project**: Product
- **Task**: LIN-325 - Write the autopilot operating manual
- **Relations**: Supersedes LIN-289 (drift-defense epic). The supervisor and evidence-discipline from LIN-289 become guide-text read by an agent already positioned to flag.

## Goal
**Role**: technical researcher

Research the autopilot's track record, failure episodes, and existing documentation to design the autopilot operating manual and plan its integration into the kickoff prompt.

### Guidance
- **Altitude**: Ensure the manual is grounded on altitude (the autopilot is high; generated prompts do the heavy lifting low; the loop self-corrects across passes).
- **Operating Stance**: The manual must reflect a tolerant operating stance (do not halt at the first sign of trouble) and be descriptive, never normative.
- **Light-Orchestrator Invariant**: Plan the wiring of the prompt to reference, not inline, the manual.
- **Out of Scope**: Do not design or plan any new sensor service, scheduler, or auto-remediation.

### Surface Assessment
At the end of your research, explicitly state whether the implementation can land cleanly on the current code, or whether a specific minimal refactor would make it land better.
Format:
"Surface Assessment: [yes, implementation can land cleanly] / [refactor needed: describe the minimal scoped change]"
