# Assessment-scaffold spike — findings

**Question.** Does the meta-prompt's 3-bullet Reasoning scaffold (`Preparation /
Blockers / Ready`) bias routing toward the implement-funnel and under-serve the
types it has no slot for — `review` (Step 0), `defer`/`breakdown` (Step 4),
`triage` (vague fallback)? And does broadening the scaffold fix it?

**Harness.** `scripts/eval/assessment-scaffold-spike.mjs` — builds the prompt from
the LIVE template per case and swaps ONLY the Assessment block per arm, so any
delta is attributable to the scaffold. Grades the `→ **action**` line
deterministically. Model `openai/gpt-5.4-mini` (prod default), temp 0. Leaf scope
(`defer` is node-shaped and not exercised — same boundary as
`eval-research-routing.mjs`).

Two runs: an exploratory 4-arm pass (K=3, 10 cases) and a confirmation pass of the
two finalists (K=5, 12 cases — a second `triage` and `breakdown` case added).

## Verdict: do NOT broaden the scaffold

The original hypothesis is **largely disconfirmed**, and no scaffold variant is a
reliable win. Recommendation: leave the Assessment block as-is.

### 1. `review` is not crowded out

`review` routed correctly **10/10 on baseline** (both the terminal-Done leaf and the
landed-but-In-Progress leaf), tied by every variant. Step 0 (rendered when the state
is terminal) and the Step-3 landed-branch already cover this at the leaf. There is no
review deficit for a broadened scaffold to fix.

### 2. Broadening with more bullets is actively worse

Exploratory pass (K=3) overall accuracy: baseline **87%**, `disposition` 93%,
`broadened` **83%**, `completion-first` **80%**. Adding `Completion` + `Shape`
bullets (`broadened`) or a leading `Completion` bullet (`completion-first`) *lowered*
accuracy — they pulled vague and breakdown cases toward `plan`. More structure ≠
better routing; it dilutes the funnel's focus.

### 3. The `disposition` one-liner is within noise, and trades wins for losses

Confirmation pass (K=5, the two finalists):

```
metric                    baseline          disposition
overall accuracy          45/60 (75%)       46/60 (77%)
  review                  10/10 (100%)      10/10 (100%)
  triage                   7/10 (70%)        6/10 (60%)
  guard-research            4/5 (80%)         4/5 (80%)
  guard-common            24/35 (69%)       26/35 (74%)
research over-fire         7/45 (16%)        9/45 (20%)
```

+2pts overall is inside the run-to-run noise. Per-case, `disposition` **trades**:
- **Wins:** multi-surface plan (baseline 0/5 → 3/5), breakdown SYN-12 (2/5 → 5/5).
- **Losses:** bug SYN-11 (baseline 5/5 → **2/5**, leaked to research), breakdown
  SYN-24 (2/5 → **1/5**, leaked to research), and research over-fire **rose** 16%→20%.

The disposition line's explicit `needs-prep (→ research/triage)` option actively
*increases* research selection — it makes the over-fire problem worse, not better.

## The real signal: `research` over-firing, and temp-0 nondeterminism

The dominant, **generalizable** failure mode is not a missing scaffold slot — it is
the prod model over-routing to `research`:
- The multi-surface pagination task (a clear `plan`) went to `research` **5/5 on
  baseline**.
- Both `breakdown` cases leaked to `research`/`plan` repeatedly on both arms.
- `gpt-5.4-mini` is markedly **nondeterministic even at temp 0** on these routing
  edges (e.g. the bug case swinging 5/5 → 2/5 between arms that share an identical
  Step-2 block) — so K=3 single-case buckets are directional only, and any future
  routing change needs K≥5 and ≥2 cases per bucket to clear the noise.

`breakdown` *is* genuinely under-served (no funnel slot, leaks to research/plan), but
the `disposition` fix doesn't hold across cases — a more direct lever would be the
breakdown signal / research over-fire guard wording itself, not the self-assessment
format.

## Next, if pursued

1. Re-target the spike at **research over-fire** (the multi-surface-plan and
   breakdown leaks) — tighten the Step-1 over-fire guard / the breakdown signal, A/B
   the same way.
2. Consider whether the prod default (`gpt-5.4-mini`) is the right model for the
   routing leg given its temp-0 variance here, or whether routing wants a higher K /
   majority vote.

No live-template change was made. Both paths (`lib/prompts/meta-prompt-template.js`
and the handwritten `lib/prompt-templates.js`) are untouched.
