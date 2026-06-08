# deepseek/deepseek-v3.2

latency=14524ms  cost=0.003627715  prompt_tok=5595  completion_tok=919  finish=stop

---

## Reasoning
**Assessment:**
- Preparation: ✗ Needed - The ticket explicitly describes a research method: "Seed from the design conversation → research our own track record concretely — the named failure episodes, not abstractions (`docs/autopilot-experiment.md` runs B1–B4, the autopilot + drift docs, real Linear/git episodes; run the `retro` lens over a real churn cluster for a worked example per known-issue)". This is evidence the knowledge the deliverable depends on (the concrete track record and named episodes) is not yet gathered.
- Blockers: ✓ None - No `blocked` or `bug` labels present.
- Ready: ✗ No - The substance needed to write the manual well (the concrete track record) must be assembled first. A clear plan for implementation cannot be created without this research.

**Signal Status:** N/A

→ **research** — use EXACTLY one action name, verbatim, from this list: blocked, bug, plan, code review, look into, triage, breakdown, research, scoping, design, spike, context, implement, review, defer.
**Next:** After gathering the concrete track record and named episodes, the next step will be to plan the creation of the manual and the prompt wiring.

## Prompt
# Research LIN-325: Write the autopilot operating manual

## Workflow
1. **Start**: Set LIN-325 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-325 in Linear
3. **Research Track Record**: As prescribed in the ticket's "Method" section, research the project's own concrete track record to gather substance for the manual. Examine:
   - `docs/autopilot-experiment.md` for runs B1–B4.
   - Existing autopilot and drift documentation (search for relevant files).
   - Real Linear/git episodes mentioned in the history (use `git log` and Linear search).
   - Run the `retro` lens over a real churn cluster for a worked example per known-issue.
4. **Summarize Findings**: Document the gathered concrete examples, failure episodes, and operational patterns in a comment on LIN-325. Focus on providing the "judgment layer" material the manual needs.
5. **Surface Assessment**: Explicitly state whether the implementation of writing `docs/autopilot-operating-manual.md` and modifying `lib/prompts/autopilot-kickoff.js` (`buildAutopilotKickoff()`) can land cleanly on the current code, or if a specific minimal refactor would make it land better.
6. **Update Linear**: Add a comment summarizing the research findings and the Surface Assessment. Do not change the task status yet.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-07T08:41:20.522Z" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
**Project:** Product
**Supersedes:** LIN-289

## Goal
**Role**: Technical Researcher

Gather the concrete project history, named failure episodes, and operational patterns that will form the substance of the autopilot operating manual. Your objective is to execute the research method described in the ticket to assemble the knowledge the manual depends on, concluding with a Surface Assessment of the implementation path.

**Research Sources**: The ticket instructs you to research from specific sources: `docs/autopilot-experiment.md` runs B1–B4, existing autopilot and drift documentation, real Linear/git episodes, and by running the `retro` lens over a real churn cluster. Determine the exact paths and identifiers for these sources from the codebase and project history. The goal is to produce a summary of concrete examples, not abstractions.
