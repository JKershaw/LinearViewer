# Recent Headwinds Review — 2026-08-03

*Advisory, review-only. Periodical: **Recent Headwinds** (LIN-542). This report mints no code changes
and no follow-up fix-tasks — it hands a maintainer a severity-ranked read of what has been dragging
recent delivery toward the [north star](../north-star.md), and leaves the decision to them.*

> **Trend run — with a 25-day gap.** Prior run: `docs/reviews/recent-headwinds-review-2026-07-09.md`,
> built on `2026-07-02` → `2026-06-25` → `2026-06-18` baseline. **This periodical did not run between
> 2026-07-09 and today.** That gap is itself H1 below, because the interval it skipped is the interval
> in which delivery fell. Nothing is trusted from prior prose — every claim is re-grounded against live
> history at HEAD (`b6c5e046`, 2026-08-03).

> **Provenance.** Produced by an agent, adversarially checked by a second agent whose only instruction
> was to refute the headline. It succeeded: the first draft of this review claimed output had barely
> fallen and per-ticket cost had inflated ~77%. That claim was built on two series computed over
> **different repository sets** and on raw commit counts spanning a merge-policy change. It is withdrawn.
> The correction is recorded in full under "Withdrawn claim" so the error is not repeated.

## North star, in one line

Harbour exists to *complete verified backlog work at a cost and cadence a solo operator can sustain,
and prove every word* — with **cost per verified task** as the headline metric and "gates buy evidence,
never delay" as standing policy (north star v2, `619366bc`, 2026-07-31; this run is the first headwinds
review under v2). **Alignment is still not forward progress:** a reliability fix to a north-star-aligned
subsystem is *rework*, not forward delivery — the discipline installed by the 07-02 run, applied again.

## Signals consumed (deterministic first)

- **Throughput / delivery / composition:** version-control history at HEAD across **both** repositories,
  via `scripts/delivery-composition.mjs` (added by this run; network-free, no proxy calls). It reports
  four substrates side by side because they disagree, and the disagreement is the finding.
- **Effort composition:** `GET /api/proxy/issues/{id}/cost` over a 68-ticket / 500-session sample.
  Bounded to ~30 days by dispatch-history TTL — the June peak is **not** reachable by this substrate.
- **Ticket creation rate:** sequential-id interpolation against 47 sampled `createdAt` values. Ids are
  monotonic in time, so id issuance *is* creation rate; this is unbiased by sampling density.
- **Blocked / parked work:** proxy `GET /api/proxy/stack?view=digest` plus per-issue reads on the
  in-progress set, read live at run time.
- **Process chronology:** subject-anchored `git log` on the gate tickets (LIN-550, LIN-791, LIN-1600/1603).

**Which signal tracks which outcome (honesty gate).** The 07-09 run stated the rule this review exists
to enforce: *"Git merge cadence tracks throughput, not forward delivery — so a rising commit count is
never read as rising forward progress."* That run then headlined a record commit week. This run reports
**four** substrates so the reader can see where they part company, and treats `--first-parent` mainline
units (one per merged PR, invariant to squash-vs-merge) as the honest delivery substrate. **Raw commit
counts must not be compared across 2026-06/07 at all** — the merge mix moved from ~92% squash to ~25%,
and a squash PR contributes one commit where a merge PR contributes its whole branch.

**Re-grounding (staleness check).** `docs/north-star.md` last changed `619366bc` (07-31) and is consumed
verbatim. `docs/reviews/` has no entry after `2026-07-17`. `scripts/follow-on-ratio.mjs` — the
instrument LIN-1661 would run — is unchanged since it landed. Staleness check clean.

## Windows (relative to now, 2026-08-03)

Window **A** = the four full weeks 2026-06-08 → 2026-07-05. Window **B** = 2026-07-06 → 2026-08-02.
The current partial week is excluded. Reproduce with:

```
node scripts/delivery-composition.mjs --since 2026-05-25
```

| substrate | A | B | change |
|---|---|---|---|
| tickets reaching code / wk | 115.3 | 69.8 | **−39%** |
| mainline delivery units / wk | 135.5 | 85.3 | **−37%** |
| raw commits / wk | 209.0 | 172.3 | −18% *(not comparable — see honesty gate)* |
| production-code lines / wk | 26,243 | 12,186 | **−54%** |
| test / verification lines / wk | 17,270 | 17,261 | **−0%** |
| mainline units **per ticket** | 1.18 | 1.22 | **+4%** |
| tickets **created** / wk | ~193 | ~190 | ~flat |

**Window sensitivity, stated because it nearly produced a false finding.** At k=3 and k=5 weeks the
ticket and commit measures track each other; k=4 is the only window length at which the raw-commit
series diverges sharply from the ticket series. Any future run quoting a single window should report
its sensitivity, or it is quoting an artifact.

---

## Headwinds, severity-ranked

### H1 — The instrument stopped, and it stopped exactly when it was needed · **critical**

This periodical last ran 2026-07-09. It reported *"velocity hit a new all-time high (W27 = 237 commits,
above W26's prior-record 224); flow is clean"* and *"Everything else is healthy and improving"* — in the
week ticket throughput began its fall. Twelve lines above that headline, the same document had already
written down the trap: *"a rising commit count is never read as rising forward progress."* It named the
failure mode and then committed it.

As of today, **ten of fifteen periodicals read `never`**, and Recent Headwinds, Documentation Review,
Code Quality Review and Drift & Coherence Review are all 22–24 days overdue. The decline documented in
this report **appears nowhere in the project's own record**. This is the north star's own priority
ordering — *"silent failures and detection gaps outrank feature work"* — turned on the review layer
itself. Severity is critical not because delivery fell, but because nothing noticed for 25 days.

### H2 — The gate that plausibly caused it has never been tested · **critical**

Two process changes landed 48 hours apart, at the exact peak week:

| when | commit | change |
|---|---|---|
| 2026-06-26 | `a38edb22` | LIN-698 — plan-fidelity check added to the implementation template |
| **2026-06-28** | `1038ddc8` | **LIN-550 — close-out split from review; the "What CI Did Not Prove" ledger** |
| **2026-06-29** | `684cf20d` | **LIN-791 — orchestrator told to decompose every task into 3–6 labelled beats** |
| 2026-07-02 | `1c884e2b` | LIN-898 — ledger proportionality (the first cost-*reduction* move) |
| 2026-07-26 | `3b63a6bc` | LIN-1603 — the `plan-review` gate: a new dispatched session between plan and implementation |
| 2026-08-03 | `b6c5e046` | LIN-1859 — a 7th plan-review check, landing on the day this review runs |

LIN-791's effect is directly observable: the literal string `beat N` appears in **zero** commits before
2026-07-01, then 9, then 18 in a week.

LIN-1600 shipped responsibly. It recorded a baseline (follow-on ratio **0.2342**, window 06-26 → 07-26),
it scoped itself to gated risk classes, and its Out of Scope names the exact hazard: *"the step must not
tax the throughput it exists to protect."* It also filed **LIN-1661** to re-read the number one cycle
later. **LIN-1661 is still Todo.** The gate's own falsification test has not run, and the window it
would have covered is precisely the window delivery fell in.

This review takes no position on whether the gates are worth their cost — it cannot, and neither can
anything else until LIN-1661 runs. Reverts falling to near zero across the same period is suggestive,
not proof.

### H3 — Effort moved from production code into verification · **high**

Production-code output more than halved (−54%) while test and verification output held flat (−0%).
Test share of all code written crossed 50% in the week of 2026-07-06 and has not returned below it:

```
06-08  32%   06-15  34%   06-22  44%   06-29  43%
07-06  51%   07-13  59%   07-20  63%   07-27  66%
```

The same shift appears in an independent substrate. Across 68 tickets and 500 worker sessions,
**23% of agent sessions are `implementation`**; 54% are plan / review / close-out / plan-review /
triage; 12% are orchestration. Sessions per ticket rose 5.0 → 8.0 between the weeks of 07-06 and 07-27,
and the growth is entirely in the governance share (44% → 63%).

Read plainly: the fleet is as busy as it was, and it is spending its time proving rather than building.
Whether that is a headwind or the point is exactly what H2 blocks anyone from answering.

### H4 — An external shock consumed roughly a fortnight · **high, one-off**

On 2026-07-07 Claude Code's own prompt-injection defence began refusing Harbour's bootstrap-token
dispatch — the trust handshake the whole `cli`/`web` path depends on. The 07-09 review logged it as
*"Externally induced … last week's prompts no longer authenticate."* The response chain runs LIN-1155/
1156/1159 → LIN-1361 → LIN-1375 (the localhost credential broker) → LIN-1397/1429/1430/1431 →
LIN-1447/1448. Credential and broker work reached **24% of all commits** in the week of 07-13.

This is not a process headwind and should not be counted as one when H2 is finally answered — it is a
one-off external cost, and any comparison that leaves it in overstates the gates' effect.

### H5 — Tickets that consume sessions and never reach code · **high**

Four high-value tickets are parked at the plan-review bound today — LIN-1694, LIN-1731, LIN-1717,
LIN-1408 — each carrying a variant of the same line: *"No code has been changed at any point — the
ticket is still at plan stage."* LIN-1731 alone has consumed *"3 plan-review passes, a design pass, 3
implementations and 3 reviews, with each review costing 20–50 minutes of transcript forensics."*

The autopilot diagnosed the mechanism itself, unprompted, on LIN-1408:

> "the plan enumerates a class of call sites by hand-listing files; the reviewer verifies by running an
> independent behavior sweep and finds another member of the class the plan did not name. The revision
> adds the named ones, and the next sweep finds one more … Because neither side's enumeration is
> mechanically derived, the cycle can always yield one more finding, and the two-cycle bound is reached
> before the enumeration converges."

**Measurement consequence:** a ticket parked this way produces no commit, so it is invisible to every
delivery substrate in this report and to Harbour's own surfaces. Some part of the −39% is work that is
happening and cannot be seen. Nothing currently counts it.

### H6 — The headline metric is blocked on a definition, not on engineering · **high**

LIN-1625 (*derive cost-per-verified-task from existing capture*) is In Progress, unblocks 8, and has
been stale 7 days. The spend half is captured; the outcome half is not computable — ledger discharge
has no marker and no PR is ever read. Its own research pass states the fork and hands back:

> "Should the outcome side gate on capture that does not exist yet, or publish the strictest computable
> proxy now?"

A live 76-lineage probe already produced trial figures of **$17.83/task at rung 1 vs $22.80 at rung 5**.
An independent 13-ticket sample taken for this review gives a median of **$26.01** (mean $35.26, range
$8.97–$89.08, all fully priced). The number is within reach and waiting on one human ruling.

### H7 — Backlog conversion, not backlog capacity, is what changed · **medium**

Ticket creation is flat at ~190/wk while ~70/wk reach code, so the backlog grows ~120/wk at current
rates. Restated: the constraint is not how fast work is generated but what fraction of it converts.
This reframes the burn-down arithmetic on every surface that reports "weeks of work remaining" —
those figures answer "how long if creation stopped", which it will not.

### H8 — A fifth of completed work is unverifiable by the project's own standard · **medium**

743 of 1,112 completed tasks can be traced to a commit citing their identifier; 369 cannot. Some are
legitimately non-code (research, docs, decisions). The residue is unmeasured, and *the artifact is the
fact* is the project's own rule.

---

## Trend ledger

| name | 07-09 | 08-03 | movement |
|---|---|---|---|
| Periodical cadence | running weekly | **stopped 07-09** | new, critical |
| Delivery throughput | "all-time high" | −37% mainline | **inverted** |
| Output composition | not measured | 66% test | new |
| Gate falsification (LIN-1661) | filed | still Todo | unchanged |
| External injection break | active | resolved | closed |
| Autopilot wake/hold/close cluster | "did not stop" | still live (LIN-1731/1717/1594) | unchanged |
| Cost-per-verified-task | not started | blocked on a ruling | advanced, then blocked |

## Withdrawn claim

The first draft of this review stated that raw commits fell only 18% against a 49% ticket fall, and
concluded work per ticket had inflated ~77%. Three defects, each individually sufficient to void it:

1. **Mixed bases.** The ticket series covered LinearViewer only; the commit series covered both repos.
   A missing `cd` had made one git log a byte-identical copy of the other. Put on one basis, tickets
   fall 39% and mainline units 37% — they move together.
2. **Merge-policy contamination.** Raw commits per merged PR rose 1.54 → 2.02 as the squash share fell
   from ~92% to ~25%, inflating July's raw count by ~31% for no delivery reason.
3. **Window cherry-picking.** k=4 was the only window length at which the two series diverged.

On the merge-invariant substrate, per-ticket cost is **flat (+4%)**. Tickets did not get heavier. The
composition shift (H3) and the session evidence survived the attack unchanged, and are what this
report now rests on.

## What this review could not measure

- **Whether the gates are worth their cost.** Requires LIN-1661. This is the central open question.
- **Agent effort before ~4 July.** Session and cost telemetry expires at 30 days, so the June peak is
  unreachable by that substrate. The A-vs-B comparison exists for code, not for effort.
- **The cost of parked tickets (H5).** They produce no commit and no completed dispatch.
- **Whether anything is late.** 0 of 1,810 tasks carry a due date. Every reading here is flow health,
  never schedule health.

## Companion artifact

A visual reading of the same evidence — delivery composition, the 14-arc theme graph, and the full
method including the withdrawn claim — was published alongside this review:
<https://claude.ai/code/artifact/08db83c4-f7c5-46d1-b5ad-5cf704c6648a>
