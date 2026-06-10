# LIN-367 — Grounding the Agent-Dev-Controls Research Against This System

## Status

Exploration notes for LIN-367. The referenced materials —
[`executive-summary-agent-dev-controls.md`](./executive-summary-agent-dev-controls.md) and
[`Monitoring and Controlling AI-Agent Software Development_ A Rese.md`](./Monitoring%20and%20Controlling%20AI-Agent%20Software%20Development_%20A%20Rese.md)
— were written without much information on how this system actually works (uploaded directly,
commit `58084fa`). This note answers the questions a plan would otherwise inherit untested:
what the research assumes about "tasks, periodicals, and autopilot," what the codebase
actually does, where they agree, and where they genuinely conflict. The next phase is a
reconciliation/build-spec step, the same pipeline `autopilot.md` → `autopilot-experiment.md`
followed.

## What the research assumes vs. what exists

| Research assumption | Reality at HEAD | Verdict |
|---|---|---|
| Periodicals are *recurring* tasks the platform schedules and runs | `lib/periodicals.js` (LIN-315, Done): five review templates (docs, test-coverage, security, API quality, code quality) rendered as a synthetic group; a two-stage contract where Stage 1 *mints* a review task and Stage 2 runs it off the stack. `cadence`/`lastRunAt` are carried but **not consumed** — no scheduler, and autopilot is not wired to dispatch them (deferred §8.C of `autopilot.md`) | Partially exists. The templates *are* the "periodic global re-grounding passes" the research calls the most-often-missing control — but unscheduled, and with no architecture/drift-trend periodical among the five |
| The autopilot is a platform component with enforceable run gates | Autopilot is a **generated kickoff prompt** (`lib/prompts/autopilot-kickoff.js`) driven in a Claude Code session against the proxy API (stack digest → `recommend-and-dispatch` → watch → verify). Controls are guide text (`autopilot-operating-manual.md`, LIN-325) plus CI. Runs B1–B4 were supervised; a genuinely unattended run hasn't happened yet | Diverges. Most of the research's "run-level controls" would here be prompt text, which is exactly what the research warns is not enforcement |
| Stage 0 (control-plane separation: agent never sole-approves its own gates) is the prerequisite foundation | **Not in place, and current design intent points the other way.** Write-mode kickoff explicitly authorizes the orchestrator to merge once CI is green and the diff matches what was approved (B4 landed a merge to main). No CODEOWNERS, no protected paths for `.github/workflows/`/`tests/`; workers routinely edit tests and code in the same PR. `ci-success` exists as a stable aggregate check *designed* for branch protection, but whether branch protection actually requires it (and whether agent identities can merge) is a repo-settings question only the owner can confirm | **The central conflict** — see below |
| Hard budgets (token/time/cost/change-size) bound runs | None. Dispatch items expire after 24h; runner posts 30s heartbeats; kickoff carries strike counters and a halt-on-infra-error rule; proxy rate-limits 60 req/min. No token/cost/diff-size caps; loop/sprawl detection is prose read off the `kind` sequence, not a wired detector | Gap, but cheap to close partially |
| Telemetry with rationale capture must be built | Largely exists, homegrown: dispatch feedback stream (phase tags, heartbeats, structured `[evidence]` URLs, recap), append-only foreman-status log, pipeline loop reconstruction (`lib/pipeline-loops.js`), proxy event audit (30-day TTL). The `kind` field (LIN-319/321) is a deliberate trajectory signal — the research's "compounding error" detector primitive already has its data source | Mostly satisfied at run altitude; no trend dashboards at program altitude |
| The cross-task altitude is unaddressed and the altitude framing is new | The repo independently derived it: `drift-at-every-altitude.md` (micro/meso/macro), with shipped normative-reference fixes (LIN-240 blast-radius prompts, LIN-279 strategy framing, LIN-273 north star) and the descriptive/normative firewall (`north-star.md`) | The research under-credits what exists — and the repo's "install a normative reference one altitude up" fix-shape is a contribution the research lacks |
| Anti-spec-gaming triggers (test-modified-with-code, held-out checks) | None in CI. One structural instance of "a check the agent can't see" exists: the fused `recommend-and-dispatch` verb makes the prompt body unreachable by the orchestrator (LIN-321). The Linear byte-parity test in `tests/unit/prompt-templates.test.js` is an invariant-style check. No property/metamorphic harness | Gap |
| Measure outcomes before trusting controls | The repo reached the same conclusion first (`drift-at-every-altitude.md`: "no instrument that says whether any of them work"). LIN-263 (Done) built a recommender-layer eval harness (`scripts/eval/`); the execution layer (defect escape, agent misreporting) is explicitly out of scope there and unbuilt; LIN-45 still Todo | Agreement on principle; execution-layer measurement absent |

## The one genuine conflict to adjudicate

The research's non-negotiable Stage 0 — *deterministic* separation of duties, "policy alone
does not satisfy this control" — collides with a **deliberate, recent decision** here: the
coded drift-defense subsystem (LIN-289/291/292, including external-evidence weighting as a
mechanism) was **canceled on 2026-06-07** and realized instead as guide text (LIN-325, the
handbook). The repo's bet: evidence discipline + CI + separate orchestrator/worker sessions +
a watching human substitute for coded gates. The research's empirical counter: a reward-hacking
model sabotaged its own safety checks 12% of the time, and prose disciplines are exactly what
such a model routes around.

These are reconcilable because they operate at different layers: the handbook governs *how the
orchestrator behaves*; Stage 0 governs *what the infrastructure permits regardless of behavior*.
Keeping the prose layer and adding a small number of deterministic backstops underneath it does
not reverse the LIN-289 decision — it covers the one case (control-plane edits) the handbook
cannot, by the research's own argument, be trusted to cover itself.

Mitigations already present that partially satisfy Stage 0's intent: orchestrator and worker are
separate sessions with fresh context (an independent-judge structure); completion is judged on
artifacts (CI status, PR state, diffs) the worker cannot fake cheaply; CI is deterministic and
runs the full suite. Holes: same model family on both sides; the worker authors the comments and
recaps the orchestrator reads; nothing distinguishes a PR that edits tests alongside the code
that passes them; and the auto-appended dispatch context carries a **standing readWrite proxy
token** into every worker sandbox (already flagged in-code as security debt — the research's
credential-containment principle says this is the first thing to fix).

## Addendum: full prompt-system review

The first pass sampled the prompt surface; a full read (all 15 task templates, the meta-prompt,
foreman playbook, autopilot kickoff + handbook, recap/brief system prompts, the roadmap
narrative pipeline) materially revises two findings.

**1. Far more of the research's task- and run-level control catalog is already implemented —
as prompt machinery.** Mapping the research's catalog onto the prompts:

| Research control | Where it already lives |
|---|---|
| Clear specs, plan-before-code, scoped task size | The recommender's decision tree (research → plan → implementation/breakdown); the plan template's session-fit answer routes oversized work to `breakdown` — task size is bounded by design |
| "Show evidence, don't assert success" | Foreman step 4: re-fetch the issue and confirm claimed Linear writes landed ("worker claims are hypotheses, not ground truth"); recap schema requires `evidence` per done-item; brief prompt: "never assert completion the source does not support" |
| Independent verifier, fresh context | Foreman delegates `review` prompts to a fresh-context Review sub-agent ("fresh context is exactly the point"); autopilot orchestrator is a separate session judging workers on artifacts |
| Anti-Goodhart / checks the agent can't see | Fused `recommend-and-dispatch` makes the prompt body structurally unreachable; review template's test-*level* check is explicitly anti-coverage-theater; periodicals forbid padding, "coverage-theater", "mass cosmetic churn", doc inflation |
| Compounding-error / loop detection | Foreman 3-strikes counters (same-prompt resumes, same-kind recommends); autopilot reads the `kind` sequence as converging / looping / sprawling |
| Auto-halt on instrument failure | Both foreman and kickoff: halt-don't-improvise on any non-2xx from the agent's own verbs |
| Comprehension / history controls | High-churn `git log` reading in plan/bug/review; regression check (don't re-introduce fixed bugs or re-apply reverts); staleness re-grounding in both prompt paths |
| Intent-translation guards | Grounding rule (meta-prompt may not invent details absent from the ticket); strategy framing names the routed-around contract gap by ticket identifier |
| Cross-task drift reading | The roadmap pipeline: deterministic model + layered readings, with the north-star reading deliberately *not* chained from empirical layers (anti-anchoring), and the gap layer advisor-only (human adjudicates) |

**2. The system is already self-aware about which controls are prose proxies.** The foreman
playbook's maintainer note calls the recitation "a prompt-level proxy for gating that will
eventually be hook-enforced"; the kickoff's note insists read-only mode be described honestly
as "a convention … not a platform-enforced sandbox — don't claim an enforcement the API doesn't
provide." So the research doc's real contribution is not discovering that controls are soft —
the codebase annotates that itself — but supplying the prioritized list of *which prompt-level
proxies to harden into mechanical enforcement first* (control-plane paths before everything
else) and the empirical case for why.

**Remaining genuine gaps after the full read** (unchanged or sharpened): no trend instrument
(periodical reports and roadmap runs are point-in-time; `report-history-store` gives the
substrate); no test-modified-with-code trigger anywhere in the review templates; the
independent verifier is same-model and prompt-instructed; budgets still absent.

**New periodicals this research naturally mints** (each fits the existing two-stage
mint-a-task contract as-is): drift/coherence review (duplication, convention fragmentation,
import direction — trend-aware against prior reports), dependency/supply-chain review (CVE,
lockfile, registry-age/slopsquatting), comprehension-debt review (modules lacking human-legible
rationale), control-plane integrity review (which checks changed, who approved), and a
rollback-rehearsal exercise.

## Recommended approach for the next phase

Do **not** adopt the five-stage roadmap wholesale; both documents self-describe as hypotheses,
and much of stages 1–3 either exists in prompt form or contradicts settled decisions. Next step
is a reconciliation/build-spec doc plus a small ticket set, in this order:

1. **Stage-0-lite (deterministic backstops; the real gap).** Confirm/enable branch protection
   requiring `ci-success` and no self-merge for agent identities on control-plane paths; add a
   cheap CI job that flags any PR modifying `tests/`, `.github/workflows/`, or `scripts/eval/`
   alongside the source that satisfies them (the "test-modified-with-code" escalation trigger —
   a labeled signal for the human/orchestrator, not a new platform). Replace the standing
   readWrite token in the auto-appended dispatch block with the short-lived/scoped mechanism
   already anticipated (`lib/harbour-feedback-tokens.js` is the in-repo precedent).
2. **Periodicals cadence (already planned, §8.C).** Consume `cadence`/`lastRunAt`, bake
   periodical-due state into the kickoff orientation snapshot, and add a sixth template:
   architecture/coherence review (duplication, dependency direction, convention fragmentation —
   trend-aware). This lands the research's highest-value recommendation almost entirely on
   existing parts.
3. **Cheap run budgets.** Make the loop/sprawl thresholds the handbook describes mechanical
   where the data already exists (`kind` sequence per issue in dispatch history): max
   re-dispatches of the same kind per task, max consecutive failures per run. Prose rules stay;
   the counter becomes a fact the orchestrator reads instead of a discipline it keeps.
4. **Execution-layer measurement before more controls.** The repo's own standing conclusion.
   Start with the two numbers the research's gate-removal benchmarks need anyway: defect-escape
   rate (issues reopened / fix-the-fix tasks) and rework rate, derivable from Linear + git
   history — a periodical-shaped report, not a dashboard build.

**Surface assessment:** refactor not needed — items 1–3 land cleanly on existing surfaces
(CI workflow, `lib/periodicals.js`, kickoff snapshot, dispatch store). The scoped change that
must precede anything else is item 1's token fix and branch-protection confirmation, both small.
