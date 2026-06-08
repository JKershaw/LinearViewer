# LIN-344 — anthropic/claude-haiku-4.5

## BRIEF (sections=4/4 inOrder=true words=481 pass=true, 10535ms)

## Current

Umbrella task for extending the periodicals registry beyond Documentation Review, per the LIN-315 plan. Add high-priority periodicals one at a time, running and assessing each as it lands before picking the next.

**Work completed:**
- LIN-351 (Test Coverage Gap periodical) shipped and author-accepted; landed as the 2nd registry entry.
- LIN-352 (Secrets & Credential Scan periodical) minted and ready to execute as the 3rd entry.

**Work remaining:**
- Execute LIN-352 (Secrets & Credential Scan): write `generateSecretsCredentialScanPrompt()`, add registry entry, run the periodical, compare generated task against the research-backed ideal (scan git history + working tree, curated high-confidence patterns, no report-cleaning theater), tweak prompt based on gaps, then assess for landing.
- After LIN-352 lands and is assessed, re-ground at HEAD and pick the next periodical from the deferred candidates (Dependency Vulnerability Scan, Dead Code, Duplication, Complexity). Advisory product/UX/business register remains blocked on advisory mode (LIN-341).

## Constraints

- Add periodicals one at a time; do not pre-mint multiple children.
- Each new periodical must follow the LIN-342/343 pattern: task-generation prompt that mints one cold-runnable Linear task, then stops; run it; compare against research-backed ideal; tweak prompt; assess before landing.
- Corrective periodicals only until advisory mode is wired (LIN-341). Corrective = diff against an objective reference (e.g., native coverage report, git secret patterns); advisory = diff against intent/goals and requires human-in-loop review.
- Periodicals must not introduce new dependencies; use built-in tooling (Node.js native test coverage, `git grep`, etc.).
- Defeat theater: Test Coverage Gap must forbid assertion-free/over-mocked tests and target meaningful coverage of critical paths (error handling, auth/token boundaries, quota/money logic, data integrity). Secrets & Credential Scan must forbid report-cleaning theater (allowlisting/silencing instead of removing tracked secrets and rotating credentials).
- Registry entries use the `generatePrompt` key, not `generate`.
- Registry is already `.map()`-ed in `buildPeriodicalNodes()`; dispatch is issueless `kind:'periodical'`; additions are purely additive to `lib/periodicals.js` with no render/tree/dispatch refactor required.
- Test assertions in `tests/unit/periodicals.test.js` (length and identity checks) must be updated for each new entry; e2e specs scoped to Documentation Review node will not break.

## Open questions

- After LIN-352 lands, which periodical should be picked next? Re-ground at HEAD and decide between Dependency Vulnerability Scan, Dead Code, Duplication, Complexity, or defer all pending advisory mode (LIN-341).
- Has LIN-341 (advisory mode wiring) progressed? If so, does it unblock the advisory product/UX/business register earlier than expected?

## Changelog

- **LIN-351 shipped (Test Coverage Gap periodical)** — validated the corrective pattern on a second entry; surfaced grounding trap (zero-coverage modules invisible in coverage table); lesson folded into LIN-352 framing.
- **LIN-352 minted (Secrets & Credential Scan periodical)** — runner-up from exploration notes, high severity on public repo with heavy token surface; named its grounding trap (history-only secrets) and objective reference (git grep + curated patterns, no new deps).
- **One-at-a-time discipline reaffirmed** — no further periodicals pre-minted; next pick deferred until LIN-352 lands and is assessed.

## RECAP (done=4 pending=2 dev=2 pass=true, 7098ms)

```json
{
  "done": [
    {
      "item": "Research & recommend next periodical",
      "evidence": "Exploration notes completed; Test Coverage Gap Review chosen as highest-leverage corrective periodical grounded in project history (LIN-345 bug, LIN-258 concern, agent-written code safety net)"
    },
    {
      "item": "Mint child task LIN-351 (Test Coverage Gap periodical)",
      "evidence": "LIN-351 created with full framing, cold-runnable carry-over notes, and Surface Assessment; re-grounded at HEAD b86c40c"
    },
    {
      "item": "LIN-351 shipped & author-accepted",
      "evidence": "PR #363 merged, CI green (1249/1249 unit + 4 E2E shards), surfaced grounding trap lesson (zero-coverage modules invisible in coverage table)"
    },
    {
      "item": "Mint child task LIN-352 (Secrets & Credential Scan periodical)",
      "evidence": "LIN-352 created following LIN-351 shape; runner-up confirmed at HEAD fed9c6a; objective reference named (git grep/log over tracked surface + history); defeat-theater mode forbidden"
    }
  ],
  "pending": [
    {
      "item": "LIN-352 implementation & verify/compare loop",
      "predicted": "Implement Secrets & Credential Scan periodical in lib/periodicals.js, run it, compare generated task against research-backed ideal (history scanning, no report-cleaning theater, valid clean-win), tweak prompt"
    },
    {
      "item": "Assess LIN-352 outcome & choose 3rd periodical",
      "predicted": "After LIN-352 lands and is author-accepted, re-ground at HEAD and select next candidate (Dependency Vulnerability Scan / Dead Code / Duplication / Complexity; advisory register still blocked on LIN-341)"
    }
  ],
  "deviations": [
    {
      "item": "Periodical-specific grounding trap surfaced in LIN-351",
      "type": "finding",
      "evidence": "Zero-coverage modules are invisible in native coverage table; lesson transferred to LIN-352 framing (working-tree-only scan misses git-history secrets)"
    },
    {
      "item": "Registry now multi-entry; test assertions require update",
      "type": "scope-change",
      "evidence": "PERIODICALS length assertion in tests/unit/periodicals.test.js changed from === 1 to === 2 after LIN-351; LIN-352 will require === 3; expected touches documented in Surface Assessment"
    }
  ]
}
```
