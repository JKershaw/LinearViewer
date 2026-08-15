# Intra-Session Efficiency Review — 2026-08-14

**Scope.** The intra-session complement to the between-leg capacity-test run review. The [capacity-test run
review](capacity-test-run-review-2026-08-14.md) (merged `454490c8`; ledger **LIN-2087**)
measured the 2026-08-14 fleet-capacity-test day's *between-leg* structure — coordination vs.
work-product, redundant process, rework — from dispatch-queue `[usage]` snapshots, and found it
fairly lean. That review named its own blind spot: everything *inside* a single agent session is
invisible to queue-level `[usage]` deltas. This document is that missing half — an independent,
transcript-side measurement of where tokens go inside a leg, over the same day. Written for
**LIN-2112**; the research comment on that ticket carries the full working (validation table,
adversarial self-review, provenance) this document transcribes from.

**Method and data sources.**

- **Capture.** Every Claude transcript JSONL for 2026-08-14 was archived from the dispatcher
  machine to `~/harbour-transcript-archives/claude-transcripts-2026-08-14.tar.gz` — **161**
  files, 40,156,017 B gz / 170,783,478 B uncompressed, SHA-256
  `8b97b13f6fead86a9208a714c58ca1c0d3eae19c239c7482d12b7fc6f4eee044`, verified readable
  (`gzip -t` clean, 161 entries, full decompress OK). Selection is the union of the 2026-08-14
  local-day mtime window and files carrying an `2026-08-14T` entry timestamp — this union catches
  10 sessions run on the day but last written on the 15th, and 1 touched on the day with no
  08-14 entry. The reproducible measurement bundle (scripts, per-session aggregates, reports)
  sits beside the archive at `~/harbour-transcript-archives/lin-2112-measurement/`. **No
  transcripts, quotes, or credential material are attached to this ticket or this document** —
  aggregates only, per the ticket's data boundary.
- **Dispatch-item → session mapping.** The ticket proposed simple-dispatcher's
  `state/sessions.json` as the item→session-UUID map. **It does not work for this dataset**: the
  reaper retains only 9 records created on 2026-08-14 against 157 sessions that actually started
  that day (~6% coverage). What does work, fully offline: the transcript is self-identifying — the
  session UUID is the filename and the workspace-clone directory name, and the bootstrap prompt's
  first `# <ISSUE> · <kind>` line gives issue and leg kind directly. This classified 148/161
  transcripts; the remaining 13 (6 free-form operator dispatches with no `issueIdentifier`, 6
  sub-agent transcripts, 1 dead launch) were accounted for individually.
- **Usage accounting.** Per-turn `input`/`cache_read`/`cache_creation`/`output` fields on each
  assistant message, deduped on `message.id`, sidechain (`agent-*.jsonl`) turns included as
  genuine additional spend (checked directly — parent transcripts carry zero sidechain turns, so
  the agent files are the only record of that spend, not a double count of something already in
  the parent).
- **Pricing.** `lib/model-pricing.js` rates at HEAD (`ee7c460c`) — the same table the run review
  and the public `/kpis` terminal-marked-task cost card use, so these figures are commensurable
  with both. Confirmed at HEAD: `cacheWrite` is documented as the OpenRouter 5m ephemeral tier,
  and Claude Code's separately-reported 1h cache-creation tokens are folded into that same field
  — i.e. priced at the 5m rate — "a bounded UNDERSTATEMENT on 1h-cache-heavy sessions... Accepted
  deliberately." (See Finding 3 below for the measured size of that bound.)

---

## 1. The six metrics — what is and isn't computable

The ticket specified six signals to measure per leg-kind × model-tier. Each was validated against
what the JSONL transcript format can actually support before being trusted:

| # | Metric | Computability |
|---|---|---|
| 1 | Context composition per turn (input / cache-read / cache-write split; boilerplate vs. live content) | **Valid as-is** for the token split. "Boilerplate vs. live content" needed a documented proxy (turn-1 window as preamble; see Finding 2) |
| 2 | Re-read ratio (Read/Grep/Glob calls per unique file) | **Valid as-is** for `Read` (`file_path` is exact). Grep/Glob keyed on pattern+path is weaker — same pattern can mean different intent — so only `Read` is reported |
| 3 | Tool-call efficiency (calls per landed outcome; failed/retried calls; dead-end share) | **Partly computable.** Calls, `is_error`, and Bash exit codes are exact. "Calls per landed outcome" and "dead-end exploration share" have **no outcome label in the data** and are not computed — not invented, not silently omitted |
| 4 | Orchestrator consultation ratio (board/dispatch-state re-scanned vs. actually consulted, per turn) | **Not computable as specified.** Cache-read is one scalar per turn with no content breakdown, so "re-scanned vs. consulted" cannot be recovered mechanically from the JSONL. A documented proxy is used instead: tool-result bytes by category (see Finding 5) |
| 5 | Output discipline (narration/recap vs. code/action output tokens) | **Valid with a caveat.** `output_tokens` is exact; `thinking_tokens` splits thinking out. Prose-vs-action is measured in **characters** (text blocks vs. tool-call inputs) and apportioned, not billed directly |
| 6 | Turn-count distributions per leg kind | **Valid as-is** (deduped assistant messages) |

The blind spot behind metrics 1 and 4: the transcript format carries no per-turn breakdown of
*what* is in the cached prefix. Every "share of context" figure below is derived from turn
position and payload size, never from content attribution.

## 2. Baseline — per leg kind × model tier

161 transcripts, 12,364 turns. Window = `input + cache_read + cache_creation`. Preamble = the
turn-1 window. Re-read = `Read` calls per unique `file_path`.

| kind | tier | n | USD | $/sess | turns med | turns max | med window/turn | cache-read % | preamble tok | preamble share | re-read | tools med | tool-err | prose share | thinking % | dur med | dur max |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| observer/custom | opus-5 | 6 | 339.69 | 56.62 | 158 | 765 | 181,136 | 97.3% | 28,754 | 16.1% | 1.00 | 133.5 | 1.0% | 34.8% | 16.2% | 339.9m | 1077m |
| autopilot | opus-5 | 13 | 240.26 | 18.48 | 142 | 232 | 178,942 | 97.6% | 28,770 | 16.7% | 1.00 | 113 | 2.0% | 16.6% | 25.0% | 275.9m | 789m |
| implementation | sonnet-5 | 26 | 206.64 | 7.95 | 82 | 385 | 191,336 | 94.0% | 40,090 | 22.8% | **1.77** | 87.5 | 2.4% | 14.3% | 38.1% | 27.3m | 503m |
| research | opus-5 | 15 | 193.13 | 12.88 | 61 | 146 | 149,408 | 93.1% | 28,763 | 20.3% | 1.43 | 78 | 1.3% | 10.1% | 35.4% | 23.4m | 148m |
| review | opus-5 | 24 | 99.79 | 4.16 | 47 | 92 | 91,772 | 96.0% | 28,765 | 32.5% | 1.00 | 57 | 2.2% | 9.0% | 39.8% | 11.5m | 20m |
| close-out | opus-5 | 19 | 89.43 | 4.71 | 55 | 108 | 89,329 | 96.5% | 28,769 | 34.1% | 1.00 | 66 | 3.1% | 6.6% | 31.7% | 12.3m | 736m |
| plan | sonnet-5 | 24 | 84.56 | 3.52 | 53.5 | 115 | 134,575 | 93.1% | 40,089 | 31.7% | 1.06 | 55.5 | 2.1% | 12.0% | 44.0% | 14.2m | 37m |
| plan-review | opus-5 | 19 | 74.60 | 3.93 | 38 | 63 | 96,768 | 95.2% | 28,766 | 31.6% | 1.06 | 50 | 1.1% | 2.2% | 46.8% | 10.0m | 173m |
| bug | opus-5 | 2 | 31.63 | 15.81 | 99 | 127 | 141,918 | 93.8% | 28,768 | 21.8% | 1.47 | 102.5 | 0.5% | 7.8% | 44.2% | 52.0m | 86m |
| sub-agent | sonnet-5 | 6 | 10.62 | 1.77 | 32.5 | 59 | 217,690 | 97.4% | 137,987 | 63.3% | 1.07 | 38.5 | 1.9% | 4.4% | 22.0% | 10.1m | 15m |

Singletons omitted from the table (implementation/opus n=1 $15.56; design, blocked×2, scoping,
triage — $12.28 combined).

**Population totals:** 160 usage-bearing sessions (1 dead launch excluded, 13 lines, no assistant
turn), **$1,398.19 whole-session** API-rate / **$1,307.39 scoped to turns timestamped 2026-08-14**
at `lib/model-pricing.js` rates. Output 8.31M · cache-write 97.65M · cache-read 2,065.76M ·
uncached input 0.02M tokens. 12,203 tool calls, 242 errored results. **These two totals are not
interchangeable** — whole-session includes turns that ran past midnight UTC into the 15th;
day-scoped is the figure comparable to the run review's window.

## 3. Reconciliation with the run review — an independent corroboration

Day-scoped **$1,307.39** vs. the run review's **$1,070.58**: **+$236.81**. The run review
disclosed exactly one gap in its own method — unticketed coordination items dispatched before
14:00Z, unreachable past its list endpoint's 100-item page cap — and bounded it at **"$150–350 of
uncounted B2"**. The delta here sits mid-band inside that disclosed range.

This is a genuinely independent measurement path: per-turn transcript usage never touches the
cumulative-`[usage]`-counter dedupe problem that forced the run review's diff-based method
(its Appendix A). Two different substrates, two different methods, agreeing within a disclosed
gap.

It also settles two verdicts the run review's own §6 table flagged as **unsettleable from its
data**: with the pre-14:00Z window counted, bucket B1 (work-product)'s share of spend falls below
50%, so **P2 (work-product ≤ 50% of spend) reads PASS, not MARGINAL FAIL**. By the same token, B1
no longer clearly dominates B2 on this wider accounting, which bears on **P3** (coordination
25–40% and the dominant bucket) — its "dominant bucket" clause should be revisited rather than
scored PARTIAL on B1-dominates-B2 grounds alone.

**This rescoring is a recommendation for LIN-2087's own owner to adopt, not an edit made here** —
see §6 and the companion comment posted on LIN-2087 (§8).

Cross-checks on session identity, independent of the dollar reconciliation: the LIN-2112 ticket's
own framing of the run — a "176-minute plan-review" and a "144-minute research leg" — appears here
as plan-review max **172.8m** and research max **147.8m**; the run review's own "~272M cumulative
cache-read" deepest orchestrator appears as the observer session at **316.6M whole-session**
cache-read.

## 4. Findings

**F1 — The window is 95.5% cache-read, and that is the whole intra-session story.**
Cache-read 95.5% / cache-write 4.5% / uncached input **0.00%**. Median per-turn window **121,684
tokens**. Intra-session cost is not "what the agent asks for" — it is re-reading its own
accumulated context on every turn. Any saving that does not shrink the *carried* context, or the
*number of turns* carrying it, is rounding error.

**F2 — The ticket's CLAUDE.md premise is wrong as stated, and the correction matters.** The
ticket's framing was "CLAUDE.md alone is large and rides every turn of every session." Measured:
the turn-1 window clusters at exactly two values — **28.8k (all 103 opus-5 sessions)** and **40.1k
(50 of 51 sonnet-5 sessions)**. It tracks **model tier, not repo**. CLAUDE.md is not in the cached
preamble at all, because sessions launch at the workspace root, which carries no CLAUDE.md — the
repo files live one level down. It does enter most sessions as an on-demand mid-session read
(LinearViewer's in 56/161 transcripts, simple-dispatcher's in 83/161, **40/161 load neither**),
never in the first three lines. So it is a real carry cost (**~$69.80, 5.0% of the day**) that
begins at the turn it is read, not a per-session fixed tax. A prompt-diet decision aimed at "the
preamble" would have targeted the wrong 29–40k tokens.

**F3 — The shared pricing table understates this day by ~$255 (18%), and it is a 1h-cache
artifact.** **99.3%** of measured cache-write (96.97M of 97.65M tokens) is
`ephemeral_1h_input_tokens`. `lib/model-pricing.js` documents that `cacheWrite` is priced at the
5m tier and that 1h cache-creation is folded into that same field — a bounded understatement,
"accepted deliberately" on the premise that 1h writes were a minority case. Measured: at
Anthropic's 2×-base 1h rate, the day is **+$254.75 (+18.2%)** understated. The accepted trade was
sized against an assumption that turned out to be nearly the opposite of true — 1h writes are
essentially all of them. This affects every figure the shared table produces, including the public
`/kpis` and `/cost` surfaces. **Correcting this is out of scope here — tracked separately as
LIN-2113** (§7).

**F4 — Re-reading is a sonnet-implementation pattern, not a general one.** Repeat `Read` calls are
256 of 893 total (28.7%) overall, but the distribution is bimodal: implementation/sonnet-5
sessions median **1.77** repeat reads per unique file (worst sessions 3.22, 3.00, 1.86), while
review, close-out, autopilot and observer sessions sit at exactly **1.00** — they essentially never
re-read. Priced pro-rata this is only **~$15.31 (1.1%)** of the day — a behavioural signal about
implementation legs specifically, not a large savings pool.

**F5 — Tool use is overwhelmingly Bash, and a third of all calls are proxy polling.** Bash is
**80.6%** of 12,203 tool calls; Read 7.3%; Edit+Write 5.9%. **4,003 calls (32.8%) are curl against
the workspace proxy** (2,757 general + 1,246 board/dispatch-state), carrying **$55.58 (4.0%)** of
the day. Using tool-result bytes as the documented proxy for metric 4 (orchestrator consultation):
across the 13 autopilot sessions, board/dispatch-state results are **16.4%** of all tool-result
bytes (0.52 MB of 3.16 MB) — board/state re-scanning is a real but minority share of what fills an
orchestrator's context window; most of it is the session's own accumulated reasoning.

**F6 — Output is 12% of spend and 35% of it is thinking.** Output tokens total 8.31M =
**$168.31 (12.0%)** of the day; thinking tokens are **2.94M (35.4% of output)**. Non-thinking
output is **15.3% prose / 84.7% tool-call inputs** by character volume — output discipline is
already good; agents are writing actions, not essays. Prose share by kind is highest for
observer/custom (34.8%) and autopilot (16.6%) — the coordination tiers narrate more; plan-review is
lowest at 2.2%.

**F7 — The long tail is the largest single savings pool.** Sessions running more than 2× their own
kind's median turn count are **$436.13 (31.2% of the day)** across 9 sessions: observer/custom
$288.04 (2 sessions — 765 turns/$215.05 and 358 turns/$72.99), implementation $82.47 (3), research
$49.95 (2), plan $15.67 (2). Turn count, not per-turn size, is what separates a $4 leg from a
$215 one. This is given equal prominence to the preamble/CLAUDE.md findings above, not subordinated
to them — it is the largest single pool in the ranking below.

## 5. Candidate savings, ranked

Same ranking method as the run review: content of *T* tokens entering at turn *i* of an *N*-turn
session costs `T × cacheWrite + T × cacheRead × (N − i)`; the preamble uses *i*=0, mid-session
content the mean position *N*/2; bytes→tokens at 4 B/token.

| # | Candidate | $ / day | % | Confidence |
|---|---|--:|--:|---|
| 1 | Bound the long tail (turn caps / checkpointing on sessions running >2× their kind's median) | 436.13 | 31.2% | Measured spend; realisable fraction unknown |
| 2 | Preamble diet — 25% / 50% of the turn-1 window | 44.59 / 89.19 | 3.2 / 6.4% | High (mechanical) |
| 3 | CLAUDE.md carry (defer/scope the read; 40% of sessions already never load it) | 69.80 | 5.0% | Medium (insertion-point estimate) |
| 4 | Proxy-polling carry (4,003 curl calls) | 55.58 | 4.0% | Medium (bytes/4 token estimate) |
| 5 | Repo-read carry (excluding repeats) | 38.08 | 2.7% | Medium |
| 6 | Repeat-read elimination | 15.31 | 1.1% | Medium (pro-rata) |

**These rows do not sum.** Candidates 2–6 all shrink the same carried context window and overlap
both each other and candidate 1 — a session in the long tail (candidate 1) is also carrying a
preamble (candidate 2), CLAUDE.md (candidate 3), and so on, so summing double-counts the same
tokens under multiple candidates.

The honest headline: candidates 2–6 combined are **~$180 (13%)**, while the long tail alone is
**$436 (31%)** — nearly 2.5× larger — and the pricing-table gap (F3, $255/18%) is not a saving at
all, it is a number the existing table is already getting wrong. Turn-count discipline, not
prompt/preamble diet, is where the intra-session savings pool actually is.

## 6. What this means for LIN-2087's prediction ledger

The run review's §6 table scored two of its nine predictions against data it explicitly said could
not settle them:

- **P2** (work-product ≤ 50% of spend): scored **MARGINAL FAIL** on the measured 56.1%, with the
  review's own disclosed pre-14:00Z gap ($150–350 uncounted B2) noted as capable of pulling B1 down
  to ~42–49% if real.
- **P3** (coordination 25–40% and the dominant bucket): scored **PARTIAL** — in-range on the
  percentage, but B1 nominally dominating B2 on the measured (gap-excluded) data.

This review's independent, transcript-side accounting (§3) puts the day's total inside that
disclosed gap band, which resolves the ambiguity both verdicts were left with: counting the
morning window pulls B1's share below 50%. **This document does not rewrite LIN-2087's merged
verdict table** — that record stays as the historical snapshot it is, per its own Appendix B
disclosure. The recommendation — P2 rescored PASS, P3's "dominant bucket" clause revisited — is
carried to LIN-2087 as a comment (§8), for that ticket's own owner to adopt.

## 7. Risks and limits

1. **The candidate-savings carry model is an estimate, not a billing reconstruction.** Insertion
   position is approximated; bytes→tokens conversion is a flat 4 B/token. Directionally sound,
   ±30% on any single line.
2. **Categories 1 and 2–6 in §5 overlap** and must never be summed into a single headline figure.
3. **`preambleShare` is capped at 1** — for very long sessions, turn-1 window × turn count can
   exceed the measured total, so the median share in §2 is a floor-ish reading, not exact.
4. **Bucket comparability.** The leg kinds here are not the run review's B1–B4 buckets; its own
   Appendix B notes B1 is the flattered bucket in that scheme. Do not cross-read the two tables as
   if aligned category-for-category.
5. **The measurement bundle's analyzer script inlines a copy of the pricing table** rather than
   importing `lib/model-pricing.js` (a CommonJS script against an ESM module). This is a second
   source of truth that will drift from the real table over time. The script lives on the
   dispatcher machine, outside both repos' version control — disclosed here as a limitation, not
   filed as a ticket, since there is no in-repo drift risk to fix.
6. **Harness coverage is complete for the day but not by construction.** Only one `opencode`
   record exists in simple-dispatcher's whole retained history, and none on 2026-08-14 — nothing
   ran outside Claude transcripts that day, but a session on a different harness would be entirely
   invisible to this method.
7. **One transcript (13 lines, no assistant turn) is excluded** as a launch that died before its
   first turn.

## 8. Follow-ups

- **LIN-2113** (filed, related, not implemented here): corrects `lib/model-pricing.js` /
  simple-dispatcher's `transcript.js` `walkUsage` payload to price 1h ephemeral cache-write tokens
  at their own rate instead of the 5m rate (F3 above).
- **The measurement-bundle analyzer's inlined pricing-table copy** (risk 5): an on-machine script
  outside both repos' version control — no ticket, disclosed as a standing limitation of the
  bundle rather than a repo change.
- **A comment on LIN-2087** carrying this document's link, the candidate-savings ranking (§5, with
  its non-summing caveat preserved), and the P2/P3 rescoring recommendation (§6) — for LIN-2087's
  own owner to adopt.

## Provenance

- Archive: `~/harbour-transcript-archives/claude-transcripts-2026-08-14.tar.gz` (dispatcher
  machine), SHA-256 `8b97b13f6fead86a9208a714c58ca1c0d3eae19c239c7482d12b7fc6f4eee044`, 161/161
  files verified.
- Measurement bundle (scripts + per-session aggregates + reports):
  `~/harbour-transcript-archives/lin-2112-measurement/` (dispatcher machine, not repo-tracked).
- Full working notes, validation table, and adversarial self-review: the research comment on
  **LIN-2112** (2026-08-15T07:12:41Z).
- Between-leg baseline this joins to: [`capacity-test-run-review-2026-08-14.md`](capacity-test-run-review-2026-08-14.md)
  (merged `454490c8`), ledger **LIN-2087**.
