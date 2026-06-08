# LIN-325 — anthropic/claude-haiku-4.5

## BRIEF (sections=4/4 inOrder=true words=826 pass=true, 27734ms)

## Current

Write the **autopilot operating manual** — a field guide the autopilot reads on kickoff and references when a situation calls for it — and wire the Autopilot prompt to consult it.

Deliverables:
1. Manual document (`docs/autopilot-operating-manual.md`): human-shaped structure (intro establishing altitude stance → normal run happy path → known issues to watch for), with **Drift entry written first** and the remaining six known-issue entries at least drafted from named episodes. Altitude is the visible through-line across all three sections.
2. API endpoint to serve the manual (`GET /api/proxy/autopilot/manual`, mirroring the existing `GET /api/proxy/foreman/playbook` pattern).
3. Wiring in `buildAutopilotKickoff()` (`lib/prompts/autopilot-kickoff.js`): add manual to the Setup verb list ('read the operating manual on kickoff'), expand the 'You've run this loop before…' paragraph to note the manual, and map triggers to sections (e.g. `done` → completion-evidence; looping/widening `kind` → drift; infra error → halt).
4. Both-paths discipline: any kickoff change lands in both `lib/prompts/autopilot-kickoff.js` **and** `docs/autopilot-kickoff.md`.

Known-issue entries to cover (grounded in named episodes, each framed as an altitude question — near-edge wobble = keep going vs far-edge problem = act):
1. **Drift** (write first, sets format) — HAR-527 boot-hang spiral; in-project echo: `/recommend` 504 misdiagnosis cluster. Signal: `kind` trajectory looping/widening. Call: one locally-correct step → keep going; sequence repeating/widening → reorient (name the routed-around root) → escalate at substrate/architecture altitude.
2. **Completion-evidence** (`[done]` != done) — Run B4: worker posted terminal `[done]` while rebase-push + comment still pending; PR SHA unchanged, no comment. Call: `[done]` = 'go verify'; confirm a change in the external artifact.
3. **Orientation / routing at the right altitude** — LIN-296 (Canceled): same work, wrong altitude depending on unit. Call: orient at the altitude of the unit you'll dispatch, not its parent.
4. **Halt-vs-improvise on failure** — Run B2: `/recommend` 504'd, orchestrator hand-authored a prompt to keep going (invariant violation) → corrected into halt-on-infra-error rule. Call: infra error in your own verbs → halt + surface, never substitute a prompt.
5. **Human edge / escalation** — Run B4: flagged to human rather than re-dispatching; human supplied merge pre-auth + out-of-band observation. Gap: worker-failure escalation (`[failed]`/stall → `help`) never exercised.
6. **Run-level stop conditions** — B3: arc stopped at verified plan when `/recommend` 504'd 3×. Finish lines: scoped run → verified-complete; open-ended walk → runs until it needs you. Gap: no genuinely unattended run.
7. **Reversibility guardrails** — Run B4: moved merge gate off worker (resolve+verify+push-then-stop). Call: scale tolerance to reversibility (loose on prototype branch, tight near merge/Done); watch the far edge, not the near one.

Research pass complete; full notes in `docs/autopilot-operating-manual-research.md` on branch `claude/lin-325-autopilot-manual-Lv2OM`. Staleness check re-grounded at HEAD: `buildAutopilotKickoff()` confirmed as wiring point, `docs/autopilot-experiment.md` contains B1–B4, named episodes are accurate.

## Constraints

- Write it human-shaped: intro → how a run normally goes → known issues to watch for. Happy-path section is load-bearing; you cannot recognise trouble without first describing normal.
- Ground everything on altitude. Autopilot is high (dispatch, watch, decide keep-going/reorient/restart/escalate); generated prompts do heavy lifting low; loop self-corrects across passes. Most autopilot failures are altitude violations.
- Tolerant operating stance: don't halt at the first sign of trouble; watch the far edge not the near one (react too late and unwind cost compounds). Scale tolerance to reversibility (loose on prototype branch, tight near merge/Done/anything downstream consumes). Light touch, surface-don't-resolve.
- Descriptive, never normative. Document how we actually operate and fail; never redefine "done." Non-autonomy firewall holds.
- Reference, don't inline. Keep the light-orchestrator invariant — manual is served by API endpoint, not embedded in the prompt.
- No new sensor service, scheduler, or auto-remediation. This is documentation + a prompt instruction only.
- Both-paths discipline: any kickoff change lands in both `lib/prompts/autopilot-kickoff.js` **and** `docs/autopilot-kickoff.md`.

## Open questions

- **Worker-failure escalation has no episode.** B2–B4 only exercised infra-error halt + evidence-contradiction flag, never a clean task-level `[failed]`/stall driving the `help` branch. Unknown whether the manual's escalation entry will be complete or flagged as unproven.
- **No genuinely unattended run exists.** B1–B4 were all supervised; B4 needed a human observation to terminate. Unknown whether run-level stop conditions entry can be grounded in a real unattended scenario or must remain calibrated to supervised runs only.
- **The autopilot-native drift sensor has never fired in-loop.** Drift is grounded historically (HAR-527) + the misdiagnosis cluster, but B1–B4 all converged. The `kind`-trajectory looping/sprawling read is unproven live — unknown whether the Drift entry will reflect a caught-in-action episode or remain historical.

## Changelog

- **Research pass completed; substance sourced from named episodes.** Staleness check re-grounded at HEAD. Episode→known-issue map, section structure, wiring approach, and surface assessment appended to description. Three gaps flagged (worker-failure escalation, unattended run, live drift sensor) rather than papered over — mattered because they define the completeness boundary of the manual.
- **Wiring approach confirmed as additive, not refactoring.** Kickoff already has natural extension points (Setup verb list, 'You've run this loop before…' paragraph, watch/halt/cross-check/decide steps). Manual-serving endpoint mirrors existing `GET /api/proxy/foreman/playbook` pattern — ~10 additive lines, no refactor required.

## RECAP (done=3 pending=3 dev=3 pass=true, 7779ms)

```json
{
  "done": [
    {
      "item": "Research pass completed; episode→known-issue map sourced",
      "evidence": "Research notes committed to docs/autopilot-operating-manual-research.md; staleness check re-grounded at HEAD; episode inventory sourced from autopilot-experiment.md (B1–B4), HAR-527 drift docs, LIN-296, LIN-319/320/321/318 cluster"
    },
    {
      "item": "Retro-lens worked example calibrated on /recommend 504 cluster",
      "evidence": "Ran retro over in-project echo of HAR-527 shape; identified OpenRouter generation leg as root cause; verdict: repeated identical failure = drift signal; entry shape confirmed (what it looks like → episode → keep-going/reorient/restart/escalate)"
    },
    {
      "item": "Manual structure and wiring approach designed",
      "evidence": "Recommended structure: §0 intro (altitude stance), §1 happy path (load-bearing), §2 known issues (Drift first); wiring via GET /api/proxy/autopilot/manual endpoint + kickoff instruction; ~10 additive lines, no refactor required"
    }
  ],
  "pending": [
    {
      "item": "Write docs/autopilot-operating-manual.md with Drift entry complete, rest drafted",
      "predicted": "Draft all seven known-issue entries (Drift, completion-evidence, orientation, halt-vs-improvise, human-edge, stop-conditions, reversibility) grounded in named episodes; ensure altitude is visible through-line"
    },
    {
      "item": "Wire manual to buildAutopilotKickoff() prompt",
      "predicted": "Add manual to Setup verb list; map triggers → sections in kickoff; add manual-serving endpoint; update both lib/prompts/autopilot-kickoff.js and docs/autopilot-kickoff.md"
    },
    {
      "item": "Verify dispatched run consults manual on trigger",
      "predicted": "Test that a run can be shown consulting the right manual section when a trigger (drift, completion-evidence, infra error, etc.) appears"
    }
  ],
  "deviations": [
    {
      "item": "Worker-failure escalation has no episode to ground it",
      "type": "gap",
      "evidence": "B2–B4 only exercised infra-error halt + evidence-contradiction flag; never a clean task-level [failed]/stall driving the help branch"
    },
    {
      "item": "No genuinely unattended run exists yet",
      "type": "gap",
      "evidence": "B1–B4 were all supervised; B4 needed human observation to terminate; run-level stop conditions untested in practice"
    },
    {
      "item": "Autopilot-native drift sensor (kind-trajectory) has never fired in-loop",
      "type": "gap",
      "evidence": "Drift grounded historically (HAR-527) + misdiagnosis cluster, but B1–B4 all converged; looping/sprawling kind-trajectory read unproven live"
    }
  ]
}
```
