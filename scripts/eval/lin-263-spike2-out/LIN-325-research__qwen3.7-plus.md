# LIN-325-research — qwen/qwen3.7-plus
expect={research}  got=research  hit=true  latency=40993ms  cost=$0.0057712  body=409w

---

## Reasoning
**Assessment:**
- Preparation: ✗ Needed - The ticket explicitly prescribes researching the track record, named failure episodes (`docs/autopilot-experiment.md` runs B1–B4), and real Linear/git episodes before writing the manual. This knowledge must be gathered first.
- Blockers: ✓ None - No external dependencies or blocking issues are indicated.
- Ready: ✗ No - The substance the work depends on (historical context and failure episodes) has not yet been gathered, so planning or implementation cannot proceed effectively.

**Signal Status:** N/A (Initial action)

→ **research**
**Next:** The agent will gather the required historical context and failure episodes, then update the ticket with findings and a recommended approach for writing the manual.

## Prompt
# Research LIN-325: Write the autopilot operating manual

## Workflow
1. **Start**: Set LIN-325 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-325 in Linear
3. **Research track record**: Read `docs/autopilot-experiment.md` (runs B1–B4), autopilot + drift docs, and real Linear/git episodes. Run the `retro` lens over a real churn cluster for a worked example per known-issue.
4. **Document findings**: Add exploration notes as a comment in Linear, and update the description with key findings and the recommended approach for writing the manual.
5. **Update Linear**: Add a comment summarizing the research findings and update the issue description with the synthesized approach.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references (`lib/prompts/autopilot-kickoff.js`, `buildAutopilotKickoff()`, `docs/autopilot-experiment.md`).
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-07T08:41:20.522Z" -- lib/prompts/autopilot-kickoff.js docs/autopilot-experiment.md` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
**Project:** Product
**Relations:** Supersedes LIN-289.
**Goal:** Write the autopilot operating manual and wire the Autopilot prompt to consult it.

## Goal
**Role**: Technical researcher

Identify key questions, read the relevant docs and prior art, check history, validate feasibility, and provide an actionable recommended approach for the plan that follows.

Gather the concrete track record as specified in the ticket:
- Read `docs/autopilot-experiment.md` (specifically runs B1–B4).
- Review the autopilot + drift docs.
- Examine real Linear/git episodes.
- Run the `retro` lens over a real churn cluster to generate a worked example per known-issue.

Synthesize these findings to inform the human-shaped manual (intro → how a run normally goes → known issues to watch for), ensuring the "altitude" through-line (autopilot is high, generated prompts do heavy lifting low, loop self-corrects) and tolerant operating stance are grounded in actual data.

**Surface Assessment**: [State explicitly whether the implementation can land cleanly on the current code, or whether a specific minimal refactor would make it land better. Format: "Surface Assessment: [yes, implementation can land cleanly] / [refactor needed: describe the minimal scoped change]". The answer must be explicit.]
