# LIN-325 — openai/gpt-5.4-mini

## BRIEF (sections=4/4 inOrder=true words=599 pass=true, 5839ms)

## Current
Write the autopilot operating manual as a human-shaped guide at `docs/autopilot-operating-manual.md` (or equivalent) and wire the autopilot kickoff flow so a run reads it on kickoff and references the relevant section when a trigger appears. The manual should describe how autopilot actually operates and fails, not redefine policy; it should be structured as intro, normal run, then known issues. The kickoff prompt must stay light: reference the manual rather than inlining its content.

The manual still needs to be created/drafted from the research findings, with the Drift entry written first and the other known-issue entries at least drafted from named episodes. The prompt wiring still needs to be added so dispatched runs can consult the manual on startup and map triggers to the right section. If the API-only session cannot reach the docs file directly, expose the manual through a proxy endpoint analogous to the existing kickoff/playbook endpoints and reference that from the prompt.

## Constraints
- Must be descriptive, not normative: document how autopilot actually behaves and fails; do not redefine “done.”
- Must keep the light-orchestrator invariant: reference the manual, do not inline its contents into the kickoff prompt.
- Must be human-shaped: intro/onboarding → normal run → known issues.
- Must ground the manual in altitude: autopilot stays high-level, generated prompts do the low-level work, and failures should be framed as altitude violations.
- Must be tolerant: do not halt at the first sign of trouble; scale response to reversibility and watch the far edge, not the near one.
- Must not add a new sensor service, scheduler, or auto-remediation; this ticket is docs plus prompt wiring.
- Must wire `buildAutopilotKickoff()` / `lib/prompts/autopilot-kickoff.js` and the generated docs path together; both-paths discipline applies to kickoff changes.
- Must cover known issues using named episodes, with Drift first.
- Must include the completion-evidence rule that `[done]` means “go verify external artifact change,” not “assume complete.”
- Must preserve the halt-on-infra-error rule: if autopilot’s own verbs hit infra error, halt and surface it; do not substitute a prompt workaround.
- Must orient/rout at the altitude of the unit being dispatched, not its parent.
- Must scale tolerance to reversibility: looser on prototype branches, tighter near merge/Done/downstream consumers.
- Must use named historical episodes such as HAR-527, B4, B2, and LIN-296 as calibration points.

## Open questions
- Whether the manual is already fully written in the repo is not confirmed here; the source only says research notes exist and the task is marked done, but the actual manual file content is not shown.
- Whether the manual-serving proxy endpoint was added is unknown from the provided source.
- Worker-failure escalation (`[failed]`/stall → `help`) has no exercised episode, so its calibration remains unproven.
- No genuinely unattended run has been observed, so behavior without human supervision remains unverified.
- The autopilot-native drift sensor (`kind` trajectory looping/sprawling) has not fired in-loop, so live calibration for drift detection is still missing.

## Changelog
- **Research pass grounded the manual in concrete episodes** — replaced abstract drift-defense framing with named failures and calibration cases, preventing a generic rulebook.
- **Reframed the task around a human-shaped, altitude-grounded outline** — established the required structure and kept the manual descriptive rather than normative.
- **Confirmed `buildAutopilotKickoff()` as the wiring point** — prevented wasting time on the wrong integration surface.
- **Specified proxy exposure for API-only access** — avoided trying to reference a docs file that the autopilot session cannot read directly.
- **Flagged unresolved calibration gaps** — worker-failure escalation, unattended runs, and in-loop drift sensing remain unproven and should not be invented as solved.

## RECAP (done=5 pending=5 dev=4 pass=true, 3544ms)

```json
{
  "done": [
    {
      "item": "Research notes committed for LIN-325",
      "evidence": "Comment says notes were committed to `docs/autopilot-operating-manual-research.md` on branch `claude/lin-325-autopilot-manual-Lv2OM`."
    },
    {
      "item": "Staleness re-check at HEAD completed",
      "evidence": "Comment says nothing relevant changed and confirmed `buildAutopilotKickoff()` is the right wiring point."
    },
    {
      "item": "Source inventory assembled",
      "evidence": "Comment lists source docs: `autopilot-experiment.md`, `recommender-structural-drift.md`, LIN-296, and churn cluster notes."
    },
    {
      "item": "Retro-lens worked example run",
      "evidence": "Comment says the `/recommend` 504 reliability cluster was analyzed and the real cause found in the OpenRouter generation leg."
    },
    {
      "item": "Known gaps were identified",
      "evidence": "Comment explicitly flags three gaps: no worker-failure escalation episode, no unattended run, and drift sensor never fired in-loop."
    }
  ],
  "pending": [
    {
      "item": "Write the human-shaped operating manual",
      "predicted": "Draft intro, normal run, and known-issues sections in `docs/autopilot-operating-manual.md` or similar."
    },
    {
      "item": "Ground known issues in named episodes",
      "predicted": "Add entries for drift first, completion-evidence, routing, halt-vs-improvise, escalation, stop conditions, and reversibility."
    },
    {
      "item": "Wire Autopilot kickoff to read the manual",
      "predicted": "Update `lib/prompts/autopilot-kickoff.js` and `docs/autopilot-kickoff.md` with a read-the-manual instruction."
    },
    {
      "item": "Expose the manual to API-only Autopilot",
      "predicted": "Add a proxy/manual endpoint mirroring the kickoff/playbook pattern so the prompt can consult it."
    },
    {
      "item": "Verify trigger-to-section references",
      "predicted": "Show a dispatched run consulting the relevant manual section when a trigger appears."
    }
  ],
  "deviations": [
    {
      "item": "Manual serving endpoint may be needed",
      "type": "scope-change",
      "evidence": "Research notes say Autopilot is API-only, so docs path isn't reachable and a manual-serving proxy endpoint is needed."
    },
    {
      "item": "Worker-failure escalation lacks an episode",
      "type": "finding",
      "evidence": "Comment says B2–B4 never exercised a clean task-level `[failed]`/stall driving the `help` branch."
    },
    {
      "item": "No unattended run exists yet",
      "type": "finding",
      "evidence": "Comment says B1–B4 were all supervised and B4 needed a human observation to terminate."
    },
    {
      "item": "Live drift sensor behavior unproven",
      "type": "finding",
      "evidence": "Comment says the `kind`-trajectory looping/sprawling read has never fired in-loop."
    }
  ]
}
```
