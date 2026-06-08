# LIN-325-research — anthropic/claude-sonnet-4.6
expect={research}  got=research  hit=true  latency=39671ms  cost=$0.040707  body=766w

---

## Reasoning
**Assessment:**
- Preparation: ✗ Needed — The ticket explicitly prescribes research as its method: "Seed from the design conversation → research our own track record concretely — the named failure episodes (docs/autopilot-experiment.md runs B1–B4, the autopilot + drift docs, real Linear/git episodes; run the retro lens over a real churn cluster for a worked example per known-issue)." The substance of the manual — the named episodes, the track record, the worked examples — must be assembled from existing docs and history before the manual can be written well. Clear intent does not mean the material is in hand.
- Blockers: ✓ None — No blocked label or unresolved dependencies noted.
- Ready: ✗ No — Research must precede writing; the deliverable's substance lives in sources outside the ticket.

**Signal Status:** Research not yet done — no comment or description update indicating named episodes have been gathered, retro lens applied, or track record assembled.

→ **research** — gather the named source material before writing begins.
**Next:** Once the track record is assembled and key episodes documented, a plan prompt will enumerate the manual's sections and the wiring change, then commit to a session-fit answer.

---

## Prompt

# Research LIN-325: Write the autopilot operating manual

## Workflow
1. **Start**: Set LIN-325 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-325 in Linear
3. Read and assemble the named source material (see Goal below)
4. Apply the `retro` lens to a real churn cluster for a worked example per known issue
5. **Update Linear**: Add an exploration comment summarising findings — named episodes, patterns, and a recommended structure for the manual; update the description with key findings and recommended approach

Always include the "Start" step to ensure work visibility.

---

## Re-ground the Ticket (staleness check)

Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:

1. List the files and symbols the ticket references: `docs/autopilot-experiment.md`, `lib/prompts/autopilot-kickoff.js`, `buildAutopilotKickoff()`, and any autopilot/drift docs named in the description.
2. Check whether any have changed since the ticket was created: run `git log --since="2026-06-07" -- docs/autopilot-experiment.md lib/prompts/autopilot-kickoff.js` (and any other referenced paths you identify).
3. If any have changed, re-read that source at HEAD — not your notes or the ticket prose — and reconcile discrepancies before trusting the ticket's description of the codebase.

---

## Context

This task is the autopilot-native realisation of the superseded drift-defense epic LIN-289. The deliverable is a field guide (the "autopilot operating manual") that the autopilot reads on kickoff and references situationally. The wiring target is `buildAutopilotKickoff()` in `lib/prompts/autopilot-kickoff.js` — the manual is referenced, not inlined, to preserve the light-orchestrator invariant.

The manual's shape is prescribed: intro → how a run normally goes → known issues to watch for. Its stance is tolerant (don't halt at first trouble), descriptive (never normative), and grounded on altitude (the autopilot is high; generated prompts do the heavy lifting low; the loop self-corrects across passes).

The ticket names specific source material to draw from. This research step is about assembling that material concretely before any writing begins.

---

## Goal

**Role**: Technical researcher / retrospective analyst

Assemble the concrete source material the manual will be written from: the named failure episodes, the track record, and at least one worked example per known issue produced by applying the `retro` lens to a real churn cluster.

### Research steps

**1. Read the named primary sources**

- Read `docs/autopilot-experiment.md` in full. Extract what actually happened in runs B1–B4: what went wrong, what self-corrected, what required intervention, and what the altitude dynamics looked like in each run.
- Locate and read the autopilot docs and drift docs referenced in the ticket (search the repo for files matching "autopilot", "drift", "experiment" if paths are not explicit). Extract the same categories of information.
- Search git history and Linear for real episodes — commits, comments, or issue threads — that illustrate the known failure modes. Do not summarise from memory; pull the actual records.

**2. Apply the `retro` lens to a real churn cluster**

- Identify a real churn cluster in the git history (a set of files or a time window with high commit density on the same surfaces).
- Run the `retro` lens over it (use whatever `retro` tooling exists in this codebase — locate it before assuming its interface).
- Produce a worked example for each known issue category you can ground in that cluster. A worked example names the episode, describes what happened at altitude vs. at ground level, and states what the autopilot could have flagged.

**3. Identify the known-issue categories**

From the source material, enumerate the distinct failure/drift patterns that recur. For each:
- Name it (this becomes a section heading in the manual's "known issues" chapter)
- State whether you have a concrete named episode to ground it
- Note whether the `retro` lens produced a worked example

**4. Assess the wiring surface**

- Read `lib/prompts/autopilot-kickoff.js` and `buildAutopilotKickoff()` at HEAD.
- Determine how the function currently constructs its prompt, where a reference to an external manual file would be inserted, and what format that reference takes (path, inline load, symbolic reference, etc.).
- Note whether any other callers of `buildAutopilotKickoff()` exist that would be affected by the change.

---

## Surface Assessment

State explicitly at the end of your findings comment:

**Surface Assessment: [yes, implementation can land cleanly] / [refactor needed: describe the minimal scoped change]**

Base this on what you find in `buildAutopilotKickoff()` and the surrounding prompt infrastructure — specifically whether the function's current structure accommodates a reference-not-inline pattern cleanly, or whether a minimal preparatory change is needed first.
