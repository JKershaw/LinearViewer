# LIN-325-research — anthropic/claude-opus-4.8
expect={research}  got=research  hit=true  latency=27756ms  cost=$0.09364  body=696w

---

## Reasoning
**Assessment:**
- Preparation: ✗ Needed - The ticket explicitly prescribes research as its method: "research our own track record concretely — the named failure episodes (`docs/autopilot-experiment.md` runs B1–B4, the autopilot + drift docs, real Linear/git episodes; run the `retro` lens over a real churn cluster for a worked example per known-issue)." The deliverable's substance lives in sources outside the ticket (past episodes, track record, design conversation) that must be assembled before the manual can be written well. The ticket itself signals the knowledge is not yet gathered.
- Blockers: ✓ None - No `blocked` label; supersedes LIN-289 but that is a relation, not an active dependency.
- Ready: ✗ No - Writing the manual well depends on grounding it in named, researched episodes that are not yet in hand.

**Signal Status:** Research signal unmet — the named failure episodes, the design conversation seed, and the worked retro example per known-issue have not yet been assembled into actionable findings.

→ **research**
**Next:** With the track-record episodes gathered and a recommended structure in hand, a plan (or direct implementation if it fits one session) can produce the human-shaped manual and wire the autopilot prompt to it.

## Prompt

# Research LIN-325: Write the autopilot operating manual

## Workflow
1. **Start**: Set LIN-325 status to "In Progress" in Linear (if not already).
2. **Fetch details**: Get full issue details for LIN-325 in Linear, including any comments and the design conversation referenced as the seed.
3. **Gather the substance** (see Goal below): read the named sources, run the `retro` lens over a real churn cluster, and assemble grounded findings per known-issue.
4. **Update Linear**: Add your exploration notes as a comment, and update the description with the key findings (the known-issue entries you can ground, with their named episodes) and a recommended structure for the manual. End with the Surface Assessment.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says:
1. List the files and symbols the ticket references: `lib/prompts/autopilot-kickoff.js` / `buildAutopilotKickoff()`, `docs/autopilot-experiment.md` (runs B1–B4), the autopilot + drift docs, and LIN-289 (superseded).
2. Check whether any have changed since the ticket was created: run `git log --since="2026-06-07" -- lib/prompts/autopilot-kickoff.js docs/autopilot-experiment.md` (and the paths of the autopilot/drift docs once located).
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
- **Project:** Product.
- This task supersedes LIN-289 (the drift-defense epic) — it is the autopilot-native, cheaper realisation: supervisor and evidence-discipline become guide-text read by an agent already positioned to flag. Check LIN-289 for the design intent that carries over.
- The light-orchestrator invariant must hold: the manual is *referenced*, not inlined into the prompt.

## Goal
**Role:** Technical researcher grounding a documentation deliverable in the project's own track record.

Assemble the concrete material the manual must rest on — the named failure episodes and a worked example per known-issue — so the writing-and-wiring step that follows can produce a human-shaped field guide grounded in real history, not invented from general knowledge.

Specifically:
1. **Seed from the design conversation.** Locate and read the design conversation referenced as the seed (check the ticket comments and LIN-289). Capture the intended shape and the through-line: *altitude* — the autopilot is high, the generated prompts do the heavy lifting low, the loop self-corrects across passes.
2. **Research the track record concretely.** Read `docs/autopilot-experiment.md` runs B1–B4 and the autopilot + drift docs (locate their actual paths in the repo). Pull the real Linear/git episodes they reference. The goal is named, concrete episodes — not paraphrased generalities.
3. **Run the `retro` lens over a real churn cluster** to produce a worked example for at least one known-issue entry. Identify an actual churn cluster from git history; do not fabricate one. The **Drift** entry must be groundable to completion; the rest should have enough material to at least draft from named episodes.
4. **Determine, from the codebase, how `buildAutopilotKickoff()` currently composes the kickoff prompt** so the later wiring step knows where a "consult the manual" reference attaches without violating the light-orchestrator invariant (reference, don't inline). Do not propose the wiring yet — just note the attachment point and confirm the invariant can be preserved.
5. Record which known-issue entries you can ground (with their episode names) and which remain thin, so the next step knows what is draft-quality vs. complete.

Capture the operating stance the manual must convey, as stated in the ticket — descriptive never normative; tolerant (don't halt at first sign of trouble); altitude as the visible through-line — but do not add normative rules of your own.

Stay within scope: this is documentation + a prompt instruction. No new sensor service, scheduler, or auto-remediation.

**Surface Assessment:** Conclude your Linear comment with an explicit statement — either "Surface Assessment: yes, implementation can land cleanly" (the manual is a new doc plus a referencing line in `buildAutopilotKickoff()`), or "Surface Assessment: refactor needed: [describe the minimal scoped change]" if reading the kickoff builder reveals that consulting an external manual requires a structural change to how the prompt is composed. State which, and describe any change concretely rather than as a general tidy-up.
