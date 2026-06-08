# LIN-344 — anthropic/claude-opus-4.8

## BRIEF (sections=4/4 inOrder=true words=621 pass=true, 21273ms)

## Current

Umbrella task for extending the periodicals registry in `lib/periodicals.js` beyond Documentation Review, adding high-priority periodicals **one at a time** — each minted as its own child task, run, and assessed before the next is picked up.

Each child follows the validated LIN-342/343 generation pattern: a *task-generation* prompt that grounds against the repo at HEAD, mints **one** cold-runnable Linear task targeting the highest-value gaps, then stops → run → compare against the research-backed ideal → tweak `generatePrompt()`. Additions are purely additive: a new `generate…Prompt()` function + one `PERIODICALS` entry (key is `generatePrompt`, not `generate`). `buildPeriodicalNodes()` already `.map()`s the whole registry, so render/dispatch/tree/flag need no changes; only the registry-length/identity assertions in `tests/unit/periodicals.test.js` need updating per entry.

**Children so far:**
- LIN-351 — Test Coverage Gap periodical (corrective): **Done** (PR #363 merged, CI green, author-accepted).
- LIN-352 — Secrets & Credential Scan periodical (corrective): **Backlog**, currently the active next child. Framing complete; not yet implemented.

**Work remaining:** Implement and assess LIN-352. Then choose the *next* candidate fresh — re-grounded at the then-current HEAD. Remaining corrective candidates: Dependency Vulnerability Scan, Dead Code, Duplication, Complexity (all deferred / advisory-leaning). The advisory product/UX/business register stays out until advisory mode is wired.

This umbrella stays **In Progress**.

## Constraints

- One periodical at a time: do not pre-mint future children; choose and re-ground the next candidate only after the current one lands and is assessed.
- No new dependencies / no frameworks / no build step — objective references must use built-in tooling (e.g. `node --test --experimental-test-coverage`, `git grep`/`git log -p`); no gitleaks/trufflehog/etc.
- Each child must be *corrective*: diff against an objective reference. Advisory periodicals (diff against intent/goals, human-in-loop) require advisory mode, which is unwired (deferred in LIN-341) — do not build an advisory periodical until then.
- Periodicals mint tasks only; the periodical never does the work itself (never writes the tests, never removes the secrets) — a normal pipeline agent picks the minted task off the stack and executes via branch→PR.
- Each generated task's contract must defeat its own theater failure mode: coverage-theater (assertion-free/over-mocked tests) for Test Coverage; report-cleaning theater (allowlist/silence/tree-only-delete instead of remove-from-tracked + rotate/revoke) for Secrets. "Nothing found / already covered" is a valid clean win.
- Prompts stay general — no hard-coded surfaces; mirror the Documentation Review discipline. Each prompt must name its own grounding trap explicitly (e.g. zero-coverage modules are invisible in the coverage table; tree-only scans miss secrets in git history).
- Re-ground against actual HEAD before minting/editing; ticket prose about code state may be stale.

## Open questions

- LIN-352's Surface Assessment line numbers for `tests/unit/periodicals.test.js` (length `=== 2` ~line 13; id/title/mode block ~17-32) were captured at HEAD `fed9c6a` and must be re-confirmed before editing.

## Changelog

- **John: "the history and state of this project offer key clues"** — directed candidate selection toward documented project pain (testing blind spots, agent-built code) rather than abstract coverage; grounds why Test Coverage Gap was chosen first.
- **Selected Test Coverage Gap as the first new periodical; runner-up Secrets & Credential Scan as second** — encodes the agreed ordering; don't re-litigate or reorder without fresh grounding.
- **Deferred parent/child periodical shape** — Test Coverage was flagged as the natural first parent+children case, but the decision is to ship a flat one-task pass first and treat parent/child as a later enhancement; don't build it into a first pass.
- **LIN-351 shipped clean and surfaced a grounding-trap lesson** — established the transferable rule that each prompt must name its own grounding trap; folded into LIN-352 (git-history scanning) and all future children.
- **Excluded candidates: advisory register (blocked, LIN-341), Dependency Vuln Scan (tiny dep surface, rarely actionable), Dead Code/Duplication/Complexity (advisory-leaning, weak objective ref)** — avoid re-proposing these as the immediate next pick.

## RECAP (done=5 pending=3 dev=4 pass=true, 12216ms)

```json
{
  "done": [
    {
      "item": "Selected Test Coverage Gap as the next periodical, with grounded research and candidate scoring",
      "evidence": "Exploration notes conclude 'CHOSEN' for Test Coverage Gap; runner-up Secrets & Credential Scan"
    },
    {
      "item": "Minted child LIN-351 (Test Coverage Gap periodical) per the suggested framing",
      "evidence": "'Minted child LIN-351 ... per the exploration notes and Surface Assessment above'"
    },
    {
      "item": "Shipped Test Coverage Gap periodical (LIN-351) clean and author-accepted",
      "evidence": "'LIN-351 shipped clean (PR #363 merged, CI green — 1249/1249 unit + 4 E2E shards); author-accepted'; subtask state Done"
    },
    {
      "item": "Minted child LIN-352 (Secrets & Credential Scan periodical) as the second child",
      "evidence": "'LIN-352 ... is now the second child under this umbrella'"
    },
    {
      "item": "Folded LIN-351's grounding-trap lesson into LIN-352 framing",
      "evidence": "'name the periodical's own grounding trap explicitly in the prompt — folded into LIN-352's framing'"
    }
  ],
  "pending": [
    {
      "item": "Implement and verify Secrets & Credential Scan periodical (LIN-352)",
      "predicted": "Add 3rd PERIODICALS entry, write prompt, run→compare→tweak; LIN-352 still in Backlog"
    },
    {
      "item": "Choose and mint the next periodical after Secrets & Credential Scan lands",
      "predicted": "Re-ground at HEAD, then pick among Dependency Vuln Scan / Dead Code / Duplication / Complexity"
    },
    {
      "item": "Advisory product/UX/business register periodical",
      "predicted": "Wait for advisory mode to be wired (LIN-341) before adding"
    }
  ],
  "deviations": [
    {
      "item": "Registry key is generatePrompt, not generate",
      "type": "finding",
      "evidence": "'registry entries use the generatePrompt key, not generate'"
    },
    {
      "item": "Coverage grounding trap: zero-coverage modules invisible in the coverage table",
      "type": "finding",
      "evidence": "LIN-351 surfaced 'zero-coverage modules are invisible in the coverage table'"
    },
    {
      "item": "Advisory product/UX/business register blocked by unwired advisory mode",
      "type": "blocker",
      "evidence": "'Blocked — advisory mode unwired (LIN-341)'"
    },
    {
      "item": "Secrets scan must cover git history, not just working tree",
      "type": "finding",
      "evidence": "'working-tree-only scan misses secrets that live in git history' — prompt directs scanning history"
    }
  ]
}
```
