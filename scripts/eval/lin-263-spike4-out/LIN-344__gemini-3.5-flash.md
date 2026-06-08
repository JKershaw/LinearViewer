# LIN-344 — google/gemini-3.5-flash

## BRIEF (sections=4/4 inOrder=true words=423 pass=true, 11229ms)

## Current
This is an active umbrella task to extend the periodicals registry by adding high-priority corrective periodicals one at a time, running and assessing each as it lands. 

The first periodical, **Test Coverage Gap** (LIN-351), is complete and merged. The current work is to implement the second periodical, **Secrets & Credential Scan** (LIN-352), which is currently in the backlog.

To complete LIN-352:
* **Registry Entry**: Add a third entry to `PERIODICALS` in `lib/periodicals.js` with `id: 'secrets-credential-scan'`, `mode: 'corrective'`, and a `generatePrompt` function.
* **Objective Reference**: Use built-in Git tooling (`git grep` and `git log -p`) to scan both the working tree and Git history against a curated set of high-confidence secret patterns derived from the repo's token formats at runtime. Do not introduce external dependencies like `gitleaks` or `trufflehog`.
* **Grounding Trap**: The prompt must explicitly instruct the agent to scan Git history, not just HEAD, to prevent the grounding trap of missing historical exposures.
* **Defeat Theater**: The generated task contract must forbid "report-cleaning theater" (such as silencing, allowlisting, or tree-only deletion). It must require rotating/revoking credentials and removing them from history, while treating "no real secrets found" as a valid clean win.
* **Tests**: Update registry-length assertions (which will increase to 3) and identity assertions in `tests/unit/periodicals.test.js`.

Once LIN-352 is merged and assessed, the next periodical candidate (e.g., Dependency Vulnerability Scan, Dead Code, Duplication, or Complexity Hotspot) will be selected and minted.

## Constraints
- Must add periodicals one at a time, running and assessing each before minting or starting the next.
- Must follow the validated task-generation pattern: the periodical must mint exactly one cold-runnable Linear task and then stop.
- Must not introduce external dependencies for objective references, adhering to the repository's "no frameworks / no build step / minimal deps" principle.
- Must explicitly name the periodical's specific grounding trap within its prompt instructions.
- Must design generated tasks to defeat "theater" (e.g., coverage theater or report-cleaning theater) by forbidding superficial metrics-lifting and prioritizing behavioral fixes.
- Must not implement advisory-mode periodicals (such as product/UX/business registers) as they are blocked until advisory mode is wired (LIN-341).

## Open questions
- _None._

## Changelog
- **LIN-351 completed** — Added the Test Coverage Gap periodical, validating the run→compare→tweak loop and revealing that prompts must explicitly name their own grounding traps (e.g., zero-coverage modules being invisible in coverage tables).
- **LIN-352 minted** — Selected Secrets & Credential Scan as the second periodical to address high-severity token exposure on a public repo, incorporating the history-scanning requirement to avoid the grounding trap.

## RECAP (done=0 pending=0 dev=0 pass=false, 7145ms)

```json
{
  "done": [],
  "pending": [],
  "deviations": []
}
```
