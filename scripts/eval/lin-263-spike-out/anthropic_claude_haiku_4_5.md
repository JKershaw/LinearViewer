# anthropic/claude-haiku-4.5

latency=22327ms  cost=0.015386  prompt_tok=6041  completion_tok=1869  finish=stop

---

## Reasoning

**Assessment:**
- Preparation: ✗ Needed — The ticket explicitly prescribes research as its method: "Seed from the design conversation → **research our own track record concretely** — the named failure episodes, not abstractions (`docs/autopilot-experiment.md` runs B1–B4, the autopilot + drift docs, real Linear/git episodes; run the `retro` lens over a real churn cluster for a worked example per known-issue)." The substance the manual depends on — concrete track record, named failure episodes, worked examples from real runs — must be gathered before the manual can be written well. The ticket is telling you the knowledge is not yet in hand.
- Blockers: ✓ None — No `blocked` label present; no external dependencies blocking research.
- Ready: ✗ No — Research phase must complete first; implementation cannot proceed without the track record findings that ground the manual's content.

**Signal Status:** 
- Task is "In Progress" but research phase has not been documented in comments yet.
- The ticket describes *how* to research (check `docs/autopilot-experiment.md`, run retro lens, gather named episodes) but does not show that research has been completed.
- No findings, worked examples, or concrete failure episodes are documented in the description or comments.

→ **research** — Gather the track record, named failure episodes, and worked examples that ground the manual's content.

**Next:** Once research findings are documented, the plan phase will enumerate the manual's structure (intro, normal run flow, known issues with worked examples) and commit to a session-fit answer for writing and wiring.

## Prompt

```
# Research LIN-325: Write the autopilot operating manual

## Workflow
1. **Start**: Confirm LIN-325 status is "In Progress" in Linear
2. **Fetch details**: Get full issue details for LIN-325 in Linear
3. **Gather track record**: Locate and review the sources named in the ticket
4. **Extract concrete episodes**: Identify named failure episodes and worked examples
5. **Validate feasibility**: Confirm the manual can be grounded on the findings
6. **Document findings**: Add exploration notes as a comment in Linear
7. **Update description**: Summarize key findings and recommended approach in the description

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `docs/autopilot-experiment.md`, `docs/autopilot-operating-manual.md` (to be created), `lib/prompts/autopilot-kickoff.js`, `buildAutopilotKickoff()`, the autopilot + drift docs, and any Linear/git episodes mentioned in comments.
2. Check whether any have changed since the ticket was created (2026-06-07T08:41:20.522Z): run `git log --since="2026-06-07T08:41:20.522Z" -- docs/autopilot-experiment.md lib/prompts/autopilot-kickoff.js` and check for recent commits to the autopilot or drift documentation.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
**Project:** Product  
**Supersedes:** LIN-289 (drift-defense epic)  
**Related:** The manual is the judgment layer that ties together existing per-prompt sensors and proxy API detection; it is read by the autopilot on kickoff and referenced when a trigger appears.

## Goal
**Role**: Technical researcher

Gather the concrete track record, named failure episodes, and worked examples that will ground the autopilot operating manual. The manual must be human-shaped (onboarding doc, not a flat rulebook) and grounded on altitude; this research phase identifies the real episodes and patterns that will populate it.

## Research Steps

### 1. Locate and Review Source Documents
- Find `docs/autopilot-experiment.md` (or equivalent) and review runs B1–B4 and any documented autopilot + drift episodes.
- Identify what each run tested, what went wrong, and what was learned.
- Note the file paths and commit history — if the document has been updated since the ticket was created, re-read it at HEAD.

### 2. Extract Named Failure Episodes
From the track record, extract **concrete, named episodes** (not abstractions):
- What was the situation (input, state, trigger)?
- What did the autopilot do (or fail to do)?
- What was the outcome?
- What judgment or operating principle would have prevented or mitigated it?

Document at least one worked example per known issue the ticket expects the manual to address. The ticket mentions "Drift" as one entry; identify what the drift failure episodes were and what the manual should teach about them.

### 3. Check Real Linear and Git History
- Search Linear for issues tagged with "autopilot" or related to drift/supervision that occurred during or after the experiment runs.
- Use `git log` to find commits related to autopilot, drift, or supervision logic; read the commit messages and diffs to understand what problems were being fixed.
- Identify patterns: are there recurring failure modes, or do failures cluster around specific conditions (e.g., high churn, ambiguous prompts, state inconsistency)?

### 4. Run the Retro Lens
The ticket mentions "run the `retro` lens over a real churn cluster for a worked example per known-issue." Determine:
- What is the "retro lens" in this codebase? (Search for a tool, script, or analysis method by that name, or ask how retrospectives are typically conducted.)
- Identify a real churn cluster (a set of related commits or issues that cluster in time or topic).
- Apply the retro lens to extract one worked example that illustrates a known issue the manual should address.

### 5. Validate Feasibility and Identify Gaps
- Confirm that the track record contains enough concrete material to write a human-shaped manual (intro, normal run flow, known issues with worked examples).
- If material is sparse for any known issue, note what additional investigation would be needed.
- Identify whether the manual can be grounded on altitude (high-level autopilot decisions, low-level per-prompt sensors, self-correcting loop) based on the episodes you found.

## Deliverable

Add a comment to LIN-325 with:
1. **Track Record Summary**: List the sources reviewed (e.g., `docs/autopilot-experiment.md` runs B1–B4, Linear issues #X–#Y, git commits ABC–DEF).
2. **Named Episodes**: For each known issue (starting with Drift), document one concrete episode:
   - Situation (input, state, trigger)
   - What happened
   - Outcome
   - Operating principle the manual should teach
3. **Worked Example**: Provide one detailed worked example (from the retro lens or a real churn cluster) that shows how the manual's guidance would apply.
4. **Feasibility Assessment**: State whether the track record is sufficient to write the manual, or whether additional investigation is needed.

Update the issue description with:
- **Key Findings**: Summary of the track record and the episodes that will ground the manual.
- **Recommended Approach**: Confirm that the manual should be structured as intro → normal run flow → known issues (with worked examples), grounded on altitude, with a tolerant operating stance.

## Surface Assessment
**Implementation can land cleanly** — the manual is a new document (`docs/autopilot-operating-manual.md`) and a prompt instruction in `lib/prompts/autopilot-kickoff.js` to read and reference it. No refactor is needed; the surfaces are isolated. The research phase is the blocker; once findings are in hand, implementation is straightforward.
```
