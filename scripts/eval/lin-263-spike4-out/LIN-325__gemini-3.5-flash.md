# LIN-325 — google/gemini-3.5-flash

## BRIEF (sections=4/4 inOrder=true words=385 pass=true, 14164ms)

## Current
Write the autopilot operating manual (`docs/autopilot-operating-manual.md`) and wire the Autopilot kickoff prompt to consult it. 

The manual must be human-shaped and structured as follows:
* **§0 What Autopilot is**: Establish the high-altitude stance (dispatch, watch, and decide, while low-level prompts execute), the tolerant operating stance, and the descriptive-not-normative firewall.
* **§1 Happy Path**: Detail the normal run flow (orient → trigger → watch → cross-check → decide → repeat), tagging each beat with its operating altitude.
* **§2 Known Issues**: Grounded in named historical episodes using a "what it looks like → named episode → keep-going/reorient/restart/escalate" format. Cover:
  1. *Drift*: HAR-527 boot-hang spiral and the `/recommend` 504 misdiagnosis cluster.
  2. *Completion-evidence*: Run B4 false-positive `[done]` and Stage-A Run 4.
  3. *Orientation/routing*: LIN-296 wrong-altitude routing.
  4. *Halt-vs-improvise*: Run B2 `/recommend` 504 infra-error.
  5. *Human edge/escalation*: Run B4 human-intervention disposition.
  6. *Run-level stop conditions*: B3 halt rule.
  7. *Reversibility guardrails*: Run B4 merge gate and B2 Git reversibility.

Wiring requirements:
* Expose the manual as plain text via a new endpoint `GET /api/proxy/autopilot/manual` (mirroring `GET /api/proxy/foreman/playbook` in `routes/proxy.js`).
* Update `buildAutopilotKickoff()` to instruct the agent to read the manual on kickoff and map triggers (e.g., drift, completion, infra errors) to specific manual sections.

## Constraints
- Must reference the manual's endpoint rather than inlining its content in the prompt to preserve the light-orchestrator invariant.
- Must maintain both-paths discipline: any kickoff prompt change must land in both `lib/prompts/autopilot-kickoff.js` and `docs/autopilot-kickoff.md`.
- Must remain descriptive, never normative (do not redefine "done"; respect the non-autonomy firewall).
- Must halt and surface on infrastructure errors in own verbs; never substitute or hand-author a prompt to bypass them.
- Must scale tolerance to reversibility (loose on prototype branches, tight near merge/Done).
- Must not build new sensor services, schedulers, or auto-remediation mechanisms.

## Open questions
- How should worker-failure escalation (`[failed]`/stall → `help`) be calibrated given it has no historical episode to ground it?
- How will unattended runs terminate safely given that all historical runs (B1–B4) were supervised and B4 required human observation to stop?
- How should the unproven `kind`-trajectory drift sensor be calibrated since it has never fired live in-loop?

## Changelog
- **Research pass completed** — Sourced concrete historical episodes (B1–B4, HAR-527, LIN-296) to ground the 7 known issues and established the API-serving wiring approach.

## RECAP (done=0 pending=0 dev=0 pass=false, 8033ms)

```json
{
  "done": [],
  "pending": [],
  "deviations": []
}
```
