# anthropic/claude-sonnet-4.6

latency=41727ms  cost=0.044268  prompt_tok=6041  completion_tok=1743  finish=stop

---

## Reasoning
**Assessment:**
- Preparation: ✗ Needed — The ticket explicitly prescribes research as its method: "Seed from the design conversation → research our own track record concretely — the named failure episodes, not abstractions (docs/autopilot-experiment.md runs B1–B4, the autopilot + drift docs, real Linear/git episodes; run the retro lens over a real churn cluster for a worked example per known-issue)." The substance of the manual depends on knowledge that must be assembled from the project's own history and named episodes — that material is not yet in hand.
- Blockers: ✓ None — No blocked label or unresolved dependencies noted.
- Ready: ✗ No — Cannot write a grounded, human-shaped manual without first assembling the named failure episodes, track record, and worked examples the ticket identifies as the foundation.

**Signal Status:** Research not yet done — no findings comment, no assembled track record, no worked examples documented.

→ **research** — use EXACTLY one action name, verbatim, from this list: blocked, bug, plan, code review, look into, triage, breakdown, research, scoping, design, spike, context, implement, review, defer.
**Next:** With the track record assembled and named episodes documented, a plan prompt can enumerate the manual's sections and wire the prompt instruction, then implementation can write and land both artifacts.

## Prompt

# Research LIN-325: Write the autopilot operating manual

## Workflow
1. **Start**: Set LIN-325 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-325 in Linear
3. Read and assemble the project's own track record from the sources named in the ticket
4. Run the `retro` lens over a real churn cluster to produce a worked example per known issue
5. Synthesize findings into an actionable recommended approach for the manual's structure and content
6. **Update Linear**: Add an exploration comment with findings and recommended approach; update the description with key findings if they materially change the plan

Always include the "Start" step to ensure work visibility.

---

## Re-ground the Ticket (staleness check)

Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:

1. List the files and symbols the ticket references: `docs/autopilot-experiment.md`, `lib/prompts/autopilot-kickoff.js` / `buildAutopilotKickoff()`, the autopilot and drift docs, and any `docs/autopilot-operating-manual.md` if it already exists.
2. Check whether any have changed since the ticket was created: run `git log --since="2026-06-07" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your notes or the ticket prose) and reconcile discrepancies before trusting the ticket's description of the codebase.

---

## Context

This task is the autopilot-native realisation of a superseded drift-defense epic (LIN-289). The manual is described as a **judgment layer** that ties together detection already present in per-prompt sensors and the proxy API — not a new coded subsystem. The ticket is explicit that the manual must be grounded in the project's own named failure episodes and track record, not in abstractions.

Key constraints from the ticket that must survive into the manual:
- Human-shaped: intro → how a run normally goes → known issues to watch for (onboarding doc, not a flat rulebook)
- Grounded on altitude: the autopilot is high; generated prompts do the heavy lifting low; the loop self-corrects across passes
- Tolerant operating stance: don't halt at the first sign of trouble
- Descriptive, never normative

---

## Goal

**Role**: Technical researcher / project historian

Assemble the concrete, named material the manual must be grounded in — the project's own failure episodes, run history, and churn patterns — so that the writing phase can produce a human-shaped, altitude-grounded manual rather than an abstract rulebook.

### Research steps

**1. Read the named source documents**

Read each of the following at HEAD (not from memory):
- `docs/autopilot-experiment.md` — focus on runs B1–B4: what happened in each, what went wrong, what self-corrected
- The autopilot docs (locate from the codebase — do not assume a path)
- The drift docs (locate from the codebase — do not assume a path)
- Any prior retrospective or post-mortem documents present in `docs/`

For each document, extract: named failure episodes, the conditions that triggered them, how they resolved (or didn't), and any operating principles already articulated.

**2. Pull real Linear and git episodes**

- Search Linear for issues that were closed as drift, churn, or autopilot-related failures — note the issue identifiers and a one-line description of what happened
- Run `git log --oneline --since="2026-01-01"` and identify any churn clusters (the same file touched repeatedly in a short window) — note the file paths and approximate dates
- For the most prominent churn cluster found, run the `retro` lens: reconstruct what the autopilot was doing, what signal it missed or misread, and what a tolerant-but-aware operating stance would have caught

**3. Identify the known issues to watch for**

From the above, enumerate the known failure modes that belong in the "known issues" section of the manual. For each:
- Name it (the ticket uses "Drift" as the first named entry — identify what others exist)
- Describe the conditions under which it appears
- Note what the existing sensors or proxy API already detect (so the manual can reference rather than duplicate)
- Draft a one-paragraph descriptive (not normative) entry

**4. Locate the prompt wiring point**

- Find `lib/prompts/autopilot-kickoff.js` (or the equivalent at HEAD) and read `buildAutopilotKickoff()`
- Identify exactly where in that function an instruction to read the manual on kickoff and reference the relevant section on trigger would be inserted — note the line range or surrounding context
- Confirm whether the manual path (`docs/autopilot-operating-manual.md` or similar) is already referenced anywhere in the codebase

**5. Synthesize**

Produce a research comment in Linear containing:
- The named failure episodes assembled, with enough detail to write the manual's "known issues" section
- The worked example from the churn cluster retro
- A proposed outline for the manual (intro → normal run → known issues, with section headings and one-sentence descriptions of each)
- The wiring point identified in `buildAutopilotKickoff()` and the minimal instruction needed there
- Any gaps or open questions that would block writing

---

## Surface Assessment

State explicitly at the end of your research comment:

**Surface Assessment:** [yes, implementation can land cleanly on the current code] / [refactor needed: describe the minimal scoped change]

Specifically: confirm whether `buildAutopilotKickoff()` can accept a "read the manual" instruction as a straightforward addition, or whether the function's current structure would require a preparatory change before the instruction lands cleanly. If a preparatory change is needed, describe it precisely — do not describe a general tidy-up.
