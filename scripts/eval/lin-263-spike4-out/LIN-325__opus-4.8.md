# LIN-325 — anthropic/claude-opus-4.8

## BRIEF (sections=4/4 inOrder=true words=988 pass=true, 29392ms)

## Current

Write `docs/autopilot-operating-manual.md` — a human-shaped field guide the autopilot reads on kickoff and references when a trigger appears — and wire the Autopilot kickoff prompt to consult it. This is the autopilot-native, cheaper realisation of the superseded drift-defense epic LIN-289: the supervisor and evidence-discipline become guide-text read by an agent already positioned to flag, not bespoke coded subsystems. The detection already exists in per-prompt sensors and the proxy API; the manual is the judgment layer tying them together.

Research is done; design intent is held, not relitigated. Remaining work is plan → write the manual → wire the prompt.

**Manual structure** (altitude is the through-line across all three sections, not its own section):
- **§0 What Autopilot is (intro/onboarding)** — altitude stance (you're high: dispatch/watch/decide; prompts do the heavy lifting low; the loop self-corrects across passes) + tolerant stance + descriptive-not-normative firewall.
- **§1 How a normal run goes (happy path — load-bearing)** — orient → trigger → watch → cross-check → decide → repeat, each beat tagged with its altitude. You can't recognise trouble without describing normal first.
- **§2 Known issues** — seven entries, **Drift first** (deepest, sets the format), each in the shape **what it looks like → named episode → keep-going / reorient / restart / escalate**, framed as an altitude question:
  1. **Drift** — HAR-527 boot-hang spiral (retry → 100% hang; fix lived one altitude up); in-project echo: the `/recommend` 504 misdiagnosis cluster. Sensor: `kind` trajectory (converging vs looping vs widening). Call: one locally-correct step → keep going; sequence repeating/widening → reorient (name the routed-around root) → escalate at substrate/architecture altitude.
  2. **Completion-evidence (`[done]` != done)** — Run B4: worker posted terminal `[done]` while rebase-push + comment still pending; work landed ~6 min later. Secondary: Stage-A Run 4. Call: `[done]` = "go verify"; confirm a change in the external artifact.
  3. **Orientation / routing at right altitude** — LIN-296 (Canceled): recommendation returned "implement subtask X" on the epic, "plan" on the subtask — same work, wrong altitude. Call: orient at the altitude of the unit you'll dispatch.
  4. **Halt-vs-improvise on failure** — Run B2: `/recommend` 504'd, orchestrator hand-authored a prompt to continue (invariant violation) → corrected into the halt-on-infra-error rule. Call: infra error in your own verbs → halt + surface, never substitute a prompt (distinct from a clean task-level `[failed]`).
  5. **Human edge / escalation** — Run B4: flagged to human rather than re-dispatching into a half-applied rebase. **Gap: worker-failure escalation (`[failed]`/stall → `help`) never exercised.**
  6. **Run-level stop conditions** — B3: arc stopped at verified plan after `/recommend` 504'd 3×. Scoped run → verified-complete; open-ended walk → runs until it needs you. **Gap: no genuinely unattended run.**
  7. **Reversibility guardrails** — Run B4: merge gate off the worker (resolve+verify+push-then-stop). Scale tolerance to reversibility; watch the far edge, not the near one.

**Wiring** (light-orchestrator invariant — reference, don't inline): Autopilot is API-only, so a `docs/` path isn't reachable. Mirror the existing plain-text proxy endpoints (`GET /api/proxy/foreman/playbook` serving `buildForemanPlaybook()` at `routes/proxy.js:3050`, and `GET /api/proxy/autopilot/kickoff`) with a new `GET /api/proxy/autopilot/manual` + a one-line entry in the instructions catalog (~10 additive lines, no refactor). Then in `buildAutopilotKickoff()`: add "read the operating manual on kickoff" to the Setup verb list; note in the "You've run this loop before…" paragraph that the manual expands it; map triggers → sections (`done` → completion-evidence; `[stalled?]`/`last tool: Bash` → watch+completion; infra error → halt; looping/widening `kind` → drift; review-raising-direction → human-edge).

**Done when:** the manual exists and is human-shaped, Drift entry complete and the rest at least drafted from named episodes; altitude is the visible through-line; the prompt reads and references it (a dispatched run can be shown consulting the right part on its trigger).

## Constraints

- Descriptive, never normative: documents how we actually operate and fail; never redefines "done." The non-autonomy firewall holds.
- Reference the manual, don't inline it — preserve the light-orchestrator invariant.
- Manual must be reachable by an API-only session, so it must be served via a proxy endpoint, not a `docs/` path.
- Both-paths discipline: any kickoff change lands in both `lib/prompts/autopilot-kickoff.js` AND `docs/autopilot-kickoff.md`.
- Tolerant operating stance, not LIN-289's "interrupt early": watch the far edge not the near one; scale tolerance to reversibility (loose on a prototype branch, tight near merge/Done/anything downstream consumes); light touch, surface-don't-resolve.
- Ground every known-issue on a named episode, not abstraction.
- Cite HAR-527 by name only — it is a historical episode from another project, not in this Linear workspace, so it has no Linear ID.
- Out of scope: no new sensor service, scheduler, or auto-remediation; no "does the manual change behaviour?" measurement (separate ticket).

## Open questions

- Worker-failure escalation (clean `[failed]`/stall → `help`) has no episode — the entry's escalate calibration is unproven.
- No genuinely unattended run exists (B1–B4 all supervised; B4 needed a human observation to terminate) — run-level stop conditions are grounded only on supervised arcs.
- The autopilot-native `kind`-trajectory drift sensor has never fired in-loop (B1–B4 all converged) — the looping/sprawling read is grounded historically but unproven live.

## Changelog

- **Reframed from LIN-289's coded drift-defense epic to a documentation + prompt-instruction approach** — the supervisor/evidence-discipline become guide-text, not subsystems; don't rebuild bespoke detection that already exists in per-prompt sensors and the proxy API.
- **Adopted a tolerant far-edge stance, breaking from LIN-289's "interrupt early" bar** — the AI can keep going where a human would stop; halting at the first wobble is itself a failure mode.
- **Research pass grounded all seven known-issues on named episodes (HAR-527, B2/B3/B4, LIN-296) and ran the retro lens over the `/recommend` 504 cluster** — gives the keep-going/reorient/restart/escalate calibration; the worked example shows "a repeated identical failure with a repeated identical explanation is itself the drift signal."
- **Wiring resolved to a new `GET /api/proxy/autopilot/manual` endpoint mirroring the foreman playbook pattern** — a `docs/` path is unreachable by an API-only autopilot session; this is the only genuinely-new piece, additive and refactor-free.

## RECAP (done=7 pending=5 dev=5 pass=true, 15193ms)

```json
{
  "done": [
    {
      "item": "Research pass: re-grounded at HEAD, confirmed wiring point and source episodes",
      "evidence": "'buildAutopilotKickoff() exists and is the right wiring point'; docs/autopilot-experiment.md still contains B1–B4"
    },
    {
      "item": "Episode→known-issue map built for all seven known issues, Drift first",
      "evidence": "Map appended to description: HAR-527 drift, B4 [done]!=done, LIN-296 routing, B2 halt-on-infra, etc."
    },
    {
      "item": "Retro-lens worked example run over the /recommend 504 reliability cluster",
      "evidence": "'Ran it over the /recommend 504 reliability cluster'; found OpenRouter generation leg as real cause, fixed via LIN-320"
    },
    {
      "item": "Recommended manual structure defined (§0/§1/§2 with altitude through-line)",
      "evidence": "'Confirms the human-shaped spine; altitude is the through-line across all three sections'"
    },
    {
      "item": "Wiring approach decided (mirror foreman/playbook proxy endpoint)",
      "evidence": "'Mirror them with a manual-serving endpoint (e.g. GET /api/proxy/autopilot/manual) + catalog line'"
    },
    {
      "item": "Surface Assessment: implementation can land cleanly with one additive seam",
      "evidence": "'Surface Assessment: [yes, implementation can land cleanly] — with one small additive seam, not a refactor'"
    },
    {
      "item": "Research notes committed to docs/autopilot-operating-manual-research.md",
      "evidence": "'Notes committed to docs/autopilot-operating-manual-research.md on branch claude/lin-325-autopilot-manual-Lv2OM'"
    }
  ],
  "pending": [
    {
      "item": "Write docs/autopilot-operating-manual.md (human-shaped, Drift complete, rest drafted)",
      "predicted": "Author §0/§1/§2 from the episode→known-issue map, Drift entry first"
    },
    {
      "item": "Add manual-serving proxy endpoint mirroring foreman/playbook",
      "predicted": "Add GET /api/proxy/autopilot/manual serving manual text + catalog line"
    },
    {
      "item": "Wire buildAutopilotKickoff() to read and reference the manual",
      "predicted": "Add manual to Setup verb list, note expansion in 'run this loop before' paragraph, map triggers→sections"
    },
    {
      "item": "Mirror kickoff changes in docs/autopilot-kickoff.md (both-paths discipline)",
      "predicted": "Apply same instruction edits to the docs copy"
    },
    {
      "item": "Demonstrate a dispatched run consulting the right manual part on its trigger",
      "predicted": "Run autopilot and show it referencing the relevant section"
    }
  ],
  "deviations": [
    {
      "item": "Worker-failure escalation ([failed]/stall → help) has no grounding episode",
      "type": "finding",
      "evidence": "'B2–B4 only exercised the infra-error halt + evidence-contradiction flag, never a clean task-level [failed]/stall driving the help branch'"
    },
    {
      "item": "No genuinely unattended autopilot run exists",
      "type": "finding",
      "evidence": "'B1–B4 were all supervised; B4 needed a human observation to terminate'"
    },
    {
      "item": "Autopilot-native drift sensor (kind-trajectory) has never fired in-loop",
      "type": "finding",
      "evidence": "'B1–B4 all converged, so the kind-trajectory looping/sprawling read has no episode of catching live drift yet'"
    },
    {
      "item": "Manual not reachable via docs/ path — autopilot is API-only",
      "type": "blocker",
      "evidence": "'Autopilot is API-only, so a docs/ path isn't reachable' — requires a manual-serving proxy endpoint"
    },
    {
      "item": "HAR-527 is a historical episode from another project, not in this Linear workspace",
      "type": "finding",
      "evidence": "'HAR-527 is not in this Linear workspace... cite by name, no Linear ID'"
    }
  ]
}
```
