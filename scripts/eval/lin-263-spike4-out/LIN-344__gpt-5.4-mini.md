# LIN-344 — openai/gpt-5.4-mini

## BRIEF (sections=4/4 inOrder=true words=447 pass=true, 4700ms)

## Current
This umbrella task is to add additional high-priority periodicals to the registry one at a time, only after each new periodical has been implemented, run, and assessed. The next child to work on is **LIN-352: Secrets & Credential Scan periodical (corrective) — first pass + verify/compare**. Implement it as a new, additive registry entry in `lib/periodicals.js` using the existing corrective periodical pattern, then verify the generated task against the research-backed ideal and adjust if needed. Do not pre-mint or work on further periodicals under this umbrella until the current child lands and is evaluated.

## Constraints
- Add periodicals one at a time; do not pre-mint the next candidate until the current one has landed and been assessed.
- Use the validated LIN-342/343 pattern: generate one cold-runnable Linear task, run it, compare output to the ideal, then tweak the prompt.
- Keep the first pass flat unless a later validated change justifies parent+children; do not bake in multi-child structure up front.
- This work must be purely additive to the periodicals registry; avoid dispatch/tree/render/feature-flag refactors.
- `buildPeriodicalNodes()` already maps the full registry, so new entries should rely on existing multi-entry support.
- Registry entries use the `generatePrompt` key, not `generate`.
- Advisory periodicals are out of scope until advisory mode is wired in LIN-341.
- For corrective periodicals, ground the generated task in an objective reference, not human judgment.
- For secrets work, scan git-tracked content and history, not just the working tree.
- Do not use report-cleaning theater: the task must require removing/rotating real secrets, not hiding findings via allowlisting or tree-only cleanup.
- `node --test --experimental-test-coverage` is the objective reference for the coverage periodical; no new dependency is needed there.

## Open questions
- Whether any remaining periodical candidates should be chosen in a different order after Secrets & Credential Scan lands is still open.
- For the secrets periodical, the exact high-confidence pattern set derived from repo-specific token formats is not fully enumerated here.
- It is not yet confirmed whether the next child after LIN-352 should be Dependency Vulnerability Scan, Dead Code Sweep, Duplication, or Complexity Hotspot.

## Changelog
- **LIN-343 pattern adopted for periodicals** — established the must-follow run→compare→tweak loop and the one-task cold-runnable generation shape.
- **Test Coverage Gap was researched and then minted as LIN-351** — confirmed the coverage-periodical approach and prevented duplicating that child here.
- **Secrets & Credential Scan became the next child (LIN-352)** — moved the umbrella from coverage work to the next corrective candidate without changing the additive registry approach.
- **One-at-a-time discipline reaffirmed after LIN-352** — ensures no further periodicals are pre-minted and the umbrella stays open until the current child is assessed.

## RECAP (done=4 pending=2 dev=2 pass=true, 2303ms)

```json
{
  "done": [
    {
      "item": "LIN-351 Test Coverage Gap child minted",
      "evidence": "Comment says \"Minted child [LIN-351] — Add Test Coverage Gap periodical...\""
    },
    {
      "item": "Test Coverage Gap framing and prompt guidance captured",
      "evidence": "Exploration notes specify node --test coverage, critical paths, and no coverage-theater."
    },
    {
      "item": "Secrets & Credential Scan child minted",
      "evidence": "Comment says \"Next child minted — LIN-352 (Secrets & Credential Scan, corrective)\""
    },
    {
      "item": "Runner-up kept for later, not pre-minted earlier",
      "evidence": "Comment says not pre-minting it now; one-at-a-time discipline is the point."
    }
  ],
  "pending": [
    {
      "item": "Assess LIN-352 after it lands",
      "predicted": "Run and compare the generated task against the research-backed ideal."
    },
    {
      "item": "Choose the next periodical after LIN-352",
      "predicted": "Re-ground at HEAD and mint the next child one at a time."
    }
  ],
  "deviations": [
    {
      "item": "Secrets scan surfaced secret-history trap",
      "type": "finding",
      "evidence": "LIN-352 framing notes working-tree-only scans miss secrets in git history."
    },
    {
      "item": "Coverage task exposed zero-coverage visibility issue",
      "type": "finding",
      "evidence": "LIN-351 outcome noted zero-coverage modules are invisible in the coverage table."
    }
  ]
}
```
