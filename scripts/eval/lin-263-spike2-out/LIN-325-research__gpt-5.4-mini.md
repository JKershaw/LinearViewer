# LIN-325-research — openai/gpt-5.4-mini
expect={research}  got=research  hit=true  latency=5390ms  cost=$0.0076455  body=390w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Needed - The ticket explicitly says to seed from the design conversation, research the track record, named failure episodes, and real Linear/git episodes before writing the manual and wiring the prompt.
- Blockers: ✓ None - No blocking dependency is named in the task context.
- Ready: ✗ No - The substance for the manual depends on gathered history and prior episodes that are not yet in hand.

**Signal Status:** Research-not-yet-done; implementation readiness not met.

→ **research** — use EXACTLY one action name, verbatim, from this list: blocked, bug, plan, code review, look into, triage, breakdown, research, scoping, design, spike, context, implement, review, defer. This name is parsed into a machine-readable kind downstream, so do not rename, pluralize, or invent a value outside the list.
**Next:** Gather the named prior episodes and source material, then return with an actionable recommendation for how the manual should be drafted and wired.
**DeferTo:**  

## Prompt
# Research LIN-325: Write the autopilot operating manual

## Workflow
1. **Start**: Set LIN-325 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-325 in Linear
3. Research the named source material for this task:
   - the design conversation
   - `docs/autopilot-experiment.md` runs B1–B4
   - the autopilot + drift docs
   - real Linear/git episodes
   - a worked example per known issue using the `retro` lens over a real churn cluster
4. Synthesize what the manual needs to say in human-shaped form: intro → how a run normally goes → known issues to watch for
5. Ground the manual on the altitude described in the ticket: the autopilot is high, the generated prompts do the heavy lifting low, and the loop self-corrects across passes
6. Keep the operating stance tolerant and descriptive, never normative
7. After research, add exploration notes as a comment in Linear and update the issue description with the key findings and recommended approach
8. **Update Linear**: Add a comment with findings, then update the description with the research-backed direction

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-07T08:41:20.522Z" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
Project: Product
Issue: LIN-325 - Write the autopilot operating manual
Supersedes LIN-289.
The task is documentation + a prompt instruction only; no new sensor service, scheduler, or auto-remediation.

## Goal
**Role**: technical researcher

Identify the source material that the manual must be grounded in, validate the concrete episodes and prior art the ticket calls for, and produce research-backed findings that can support the subsequent writing/wiring step.

Surface Assessment: refactor needed: if the current autopilot kickoff prompt in `lib/prompts/autopilot-kickoff.js` does not already reference an external manual, identify the minimal prompt change needed to make it consult the manual without inlining its contents.
