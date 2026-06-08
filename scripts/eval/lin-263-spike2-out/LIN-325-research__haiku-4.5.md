# LIN-325-research — anthropic/claude-haiku-4.5
expect={research}  got=research  hit=true  latency=22553ms  cost=$0.016084  body=1024w

---

## Reasoning

**Assessment:**
- Preparation: ✗ Needed — The ticket explicitly prescribes research as its method: "Seed from the design conversation → research our own track record concretely — the named failure episodes (`docs/autopilot-experiment.md` runs B1–B4, the autopilot + drift docs, real Linear/git episodes; run the `retro` lens over a real churn cluster for a worked example per known-issue) → write it → wire the prompt to it." The substance the manual depends on (track record, named episodes, concrete failure patterns) must be gathered before the deliverable can be written well. The ticket is telling you the knowledge is not yet in hand.
- Blockers: ✓ None — No blocked label; no external dependencies blocking research.
- Ready: ✗ No — Research must precede implementation.

**Signal Status:** Task is in progress but the research phase (gathering track record, named episodes, worked examples) has not been completed. The ticket describes the research method but does not contain its findings.

→ **research** — Gather the track record, named failure episodes, and concrete patterns that will ground the manual before writing it.

**Next:** Once research findings are documented, the plan phase will scope the manual structure and wire the prompt integration.

## Prompt

```
# Research LIN-325: Write the autopilot operating manual

## Workflow
1. **Start**: Confirm LIN-325 status is "In Progress" in Linear
2. **Fetch details**: Get full issue details for LIN-325 in Linear
3. **Gather track record**: Read and extract concrete failure patterns from named sources
4. **Validate feasibility**: Confirm the manual can be wired into the autopilot prompt without violating the light-orchestrator invariant
5. **Document findings**: Add exploration notes as comment in Linear; update description with key findings and recommended structure
6. **Update Linear**: Add comment summarizing research findings and recommended approach

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `lib/prompts/autopilot-kickoff.js`, `buildAutopilotKickoff()`, `docs/autopilot-experiment.md`, the autopilot + drift docs, and the light-orchestrator invariant.
2. Check whether any have changed since the ticket was created (2026-06-07T08:41:20.522Z): run `git log --since="2026-06-07" -- lib/prompts/autopilot-kickoff.js docs/autopilot-experiment.md` and check for changes to the autopilot prompt structure or experiment documentation.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
**Project:** Product  
**Parent:** Supersedes LIN-289 (drift-defense epic)  
**Related:** The manual is the autopilot-native realization of supervisor + evidence-discipline; it will be consulted by the autopilot on kickoff and referenced when situations call for it.

## Goal
**Role**: Technical researcher

Gather the concrete track record, named failure episodes, and worked examples that will ground the autopilot operating manual. The manual must be human-shaped (intro → how a run normally goes → known issues to watch for) and grounded on altitude; your research will surface the real patterns and episodes that make it credible and actionable.

## Research Scope

### 1. Locate and Read Named Sources
- **`docs/autopilot-experiment.md`**: Read runs B1–B4 in full. Extract:
  - What each run attempted
  - How it failed or succeeded
  - What the failure revealed about autopilot behavior or assumptions
  - Any patterns across runs (e.g., repeated failure modes, recovery patterns)
  
- **Autopilot + drift documentation**: Locate and read all docs covering autopilot behavior and drift handling. Extract:
  - How the autopilot currently detects and responds to drift
  - What "tolerant operating stance" means in practice (the ticket says "don't halt at the first sign of trouble" — find evidence of this in the docs or code)
  - Any known limitations or edge cases already documented
  
- **Real Linear/git episodes**: Search the codebase and Linear history for:
  - Issues tagged with `autopilot` or `drift` (especially closed issues with resolution notes)
  - Commits mentioning autopilot failures, recovery, or behavior changes (use `git log --grep="autopilot\|drift"` or similar)
  - Any post-mortems, retros, or incident notes in comments or docs
  - Extract the failure mode, what triggered it, and how it was resolved

### 2. Run the `retro` Lens on a Real Churn Cluster
- Identify a high-churn file or module in the autopilot codebase (3+ commits in recent history touching the same file)
- Run `git log --oneline -n 20 -- <high-churn-file>` to see recent changes
- For each commit, read the message and diff to understand what was being protected against or fixed
- Extract one worked example: a concrete scenario where the autopilot encountered a known issue, what the issue was, and how the fix or workaround addressed it
- This example will ground the "known issues to watch for" section of the manual

### 3. Validate the Light-Orchestrator Invariant
- Read `lib/prompts/autopilot-kickoff.js` and `buildAutopilotKickoff()` to understand:
  - How the autopilot prompt is currently structured
  - What "reference, don't inline" means in this context (the manual should be read by the prompt, not embedded in it)
  - How the prompt can safely consult an external manual without breaking the invariant
- Confirm that wiring the manual as a reference (not inlining it) is feasible and does not require changes to the prompt structure

### 4. Identify Key Patterns and Known Issues
From all sources above, extract and group:
- **Normal flow**: What does a typical successful autopilot run look like? (e.g., kickoff → detect state → generate prompt → execute → loop)
- **Known issues**: What are the recurring failure modes? (e.g., drift detection lag, false positives, recovery loops, state inconsistency)
- **Tolerant stance examples**: Where does the autopilot currently *not* halt at the first sign of trouble? What does it do instead?
- **Altitude principle**: How does the autopilot stay high-level while generated prompts do heavy lifting low? What does self-correction across passes look like?

## Deliverable

Add a comment to LIN-325 with:
1. **Track Record Summary**: 2–3 sentences on what the experiment runs (B1–B4) revealed
2. **Named Episodes**: List 3–5 concrete failure modes or recovery patterns found in Linear/git history, with ticket or commit references
3. **Worked Example**: One detailed scenario from the churn cluster analysis (failure mode → root cause → resolution)
4. **Known Issues Identified**: Bullet list of 4–6 issues the manual should warn about (e.g., "drift detection lag on high-churn files", "false positives in state reconciliation")
5. **Altitude & Tolerant Stance**: 2–3 sentences on how these patterns reflect the altitude principle and tolerant operating stance
6. **Wiring Feasibility**: Confirm that the manual can be referenced (not inlined) in `buildAutopilotKickoff()` without violating the light-orchestrator invariant

Then update the issue description with:
- **Key Findings** section: Summarize the track record, named episodes, and worked example
- **Recommended Manual Structure**: Outline the sections the manual should contain (intro, normal flow, known issues, altitude principle, tolerant stance) with 1–2 sentences per section
- **Recommended Approach**: Confirm that the manual will be a separate document (file path TBD) referenced by the autopilot prompt, not inlined

## Surface Assessment

**Implementation can land cleanly on the current code.** The manual is documentation + a prompt instruction (no new sensor service, scheduler, or auto-remediation). Once research findings are in hand, the plan phase will scope the manual structure and the wiring step (updating `buildAutopilotKickoff()` to reference the manual). No refactor is needed before writing the manual itself.
```
