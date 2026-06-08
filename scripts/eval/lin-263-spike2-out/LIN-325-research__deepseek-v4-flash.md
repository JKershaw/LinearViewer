# LIN-325-research — deepseek/deepseek-v4-flash
expect={research}  got=research  hit=true  latency=22309ms  cost=$0.001174523  body=767w

---

## Reasoning
**Assessment:**
- Preparation: ✗ Needed - The ticket explicitly prescribes research as its method: "Seed from the design conversation → research our own track record concretely — the named failure episodes (docs/autopilot-experiment.md runs B1–B4, the autopilot + drift docs, real Linear/git episodes; run the retro lens over a real churn cluster for a worked example per known-issue)". The knowledge needed to write the manual (track record, named episodes, concrete examples) is not yet gathered. The ticket describes *how* to gather it, which confirms it is not yet in hand.
- Blockers: ✓ None - No blockers or bugs indicated.
- Ready: ✗ No - Research must be completed before planning or implementation.

**Signal Status:** N/A (no prior work to assess)

→ **research**
**Next:** After research completes, the findings (named episodes, worked examples, recommended approach) will be documented, enabling a plan phase to scope the manual structure and wire-up.
**DeferTo:** (omit)

## Prompt
# Research LIN-325: Write the autopilot operating manual

## Workflow
1. **Start**: Set LIN-325 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-325 in Linear
3. **Research**: Investigate the track record and prior art as described below
4. **Update Linear**: Add a comment summarizing key findings, named episodes, and a recommended approach for the manual. Update the issue description with the research results (or link to a doc if extensive).

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `docs/autopilot-experiment.md`, `lib/prompts/autopilot-kickoff.js`, `buildAutopilotKickoff()`, any drift docs, Linear/git episodes.
2. Check whether any have changed since the ticket was created (2026-06-07): run `git log --since="2026-06-07" -- docs/autopilot-experiment.md lib/prompts/autopilot-kickoff.js` and any other paths you identify.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
- **Issue:** LIN-325 — Write the autopilot operating manual
- **Project:** Product
- **Supersedes:** LIN-289 (drift-defense epic)
- **Key constraint:** The manual must be human-shaped (intro → how a run normally goes → known issues to watch for), grounded on altitude (autopilot is high, generated prompts do the heavy lifting low), tolerant operating stance (don't halt at first trouble), descriptive never normative.
- **Method prescribed by ticket:** Seed from design conversation → research track record concretely (named failure episodes from `docs/autopilot-experiment.md` runs B1–B4, autopilot + drift docs, real Linear/git episodes; run the `retro` lens over a real churn cluster for a worked example per known-issue) → write manual → wire prompt to it.
- **Out of scope:** No new sensor service, scheduler, or auto-remediation — documentation + a prompt instruction only.

## Goal
**Role**: Technical researcher / historian

Identify and document the concrete failure episodes, drift patterns, and churn clusters from the project's track record that will form the substance of the autopilot operating manual. Provide a recommended structure for the manual and a clear approach for wiring the Autopilot prompt to consult it (reference, not inline — keep the light-orchestrator invariant).

### Research Steps

1. **Read the design conversation** (if available in Linear comments or linked docs) to understand the intent behind the manual and any specific examples discussed.

2. **Read `docs/autopilot-experiment.md`** — focus on runs B1–B4. For each run, extract:
   - What happened (the failure or drift episode)
   - What the autopilot did (or failed to do)
   - What the known issue is (the pattern to watch for)
   - Any altitude-related observations (high-level vs low-level behavior)

3. **Read autopilot + drift docs** — locate any additional documentation about drift defense, the superseded LIN-289, or related design notes. Extract named episodes and patterns.

4. **Mine real Linear/git episodes** — search Linear for issues related to drift, autopilot, or the superseded LIN-289. Also search git history for relevant commits (e.g., `git log --all --grep="drift"`, `git log --all --grep="autopilot"`). Identify concrete episodes that illustrate known issues.

5. **Run the `retro` lens over a real churn cluster** — identify a cluster of related changes (e.g., a series of commits or issues that show repeated drift or correction). Produce a worked example per known-issue that the manual can reference.

6. **Examine the current Autopilot prompt** — read `lib/prompts/autopilot-kickoff.js` and the `buildAutopilotKickoff()` function. Understand how the prompt is constructed and where a reference to the manual could be inserted without inlining the manual content. Identify the mechanism for loading external text (e.g., reading a file, injecting a string).

7. **Synthesize findings** into a recommended approach:
   - List of named episodes (with brief descriptions) to include in the manual
   - Proposed structure for the manual (intro → normal run → known issues with worked examples)
   - How to wire the Autopilot prompt to consult the manual (file path, reference mechanism)
   - Any risks or open questions (e.g., manual size, loading cost, staleness)

### Surface Assessment
After completing the research, state explicitly whether the implementation (writing the manual and wiring the prompt) can land cleanly on the current code, or whether a specific minimal refactor would make it land better. Format: "Surface Assessment: [yes, implementation can land cleanly] / [refactor needed: describe the minimal scoped change]". The answer must be explicit — not implied — so the plan step can act on it. Describe what needs changing (not a general tidy-up), or state clearly that no preparation is needed.
