# LIN-3169 — Jev progress-estimation: findings (2026-09-30)

**GO.** Asked *"how many more agent work sessions will this task need?"* over its full context plus
a one-sentence workspace norm, Jev yields a 10-band curve that beats every no-model baseline on
held-out tasks, at ~$0.0004 and ~220 ms per call. Method and reproduction:
[`../jev-progress-README.md`](../jev-progress-README.md). All figures: [`summary.json`](summary.json).

Columns: RPS over the 10 bands (↓), mean absolute error and bias of the curve mean (points),
within-task ordering, and how often the truth band falls inside the curve's 80% interval.

## Held-out test (110 tasks, 568 snapshots, finalists locked on dev, scored once)

| Config | RPS | MAE | Bias | Order | Cov80 | $/call |
|---|---|---|---|---|---|---|
| **`rawnf:rem2`, T=1.25 — full context + flags + norms** | **0.064** | **8.7** | +0.9 | 0.98 | 0.88 | 0.00039 |
| `tmnfl2c:rem2`, T=1.5 — metadata + last 2 comments | 0.069 | 9.4 | +2.2 | 0.97 | 0.91 | 0.00011 |
| `tmnf:rem2`, T=1.5, averaged with the lookup | 0.069 | 9.7 | +0.6 | 0.97 | 0.95 | 0.00003 |
| `tmnf:rem2`, T=1.5 — metadata only | 0.077 | 9.9 | −0.6 | 0.98 | 0.84 | 0.00003 |
| Lookup P(k/N \| last kind, k), no model | 0.074 | 10.1 | +1.8 | 0.91 | 0.91 | — |
| First attempt: `rawsess:stage` (comments, "what % done?") | 0.216 | 22.7 | +17.9 | 0.75 | 0.49 | 0.00039 |
| Uniform / constant 50% | 0.157 / 0.229 | 20.7 / 21.2 | | 0.50 | | — |

Paired bootstrap over tasks (4,000 resamples), ΔRPS: winner − lookup **−0.0097 [−0.0149, −0.0045]**;
winner − last-2-comments −0.0048 [−0.0085, −0.0013]; last-2-comments − lookup −0.0050 [−0.0091, −0.0005];
metadata-only − lookup +0.0032 [−0.0025, +0.0106] (not better alone). Winner: median error 7.4 pts,
93% within ±20, 2% off by more than 25; latency median 224 ms. Dev → test: 0.061 → 0.064.

## How we got there (dev)

**Round 1a** — 15 views × {stage choice, neutral score}, k ≈ 25/50/75% (273 snapshots). Asking
"what % is done", *less was more*: every view with comment text read "PR open" as ~85% and ran
+10 to +23 pts optimistic; title alone put everything near 0%. The lookup won outright.

| Config | RPS | MAE | Bias | Order | Cov80 |
|---|---|---|---|---|---|
| lookup (last kind, k) | 0.060 | 8.8 | +1.9 | 0.94 | 0.96 |
| `tm:score` (title, labels, session sequence) | 0.111 | 12.4 | −1.9 | 0.91 | 0.84 |
| `tmh:score` (+ latest-comment headline) | 0.166 | 18.2 | +9.7 | 0.77 | 0.68 |
| `rawsess:stage` (full comments + sessions) | 0.217 | 22.8 | +18.9 | 0.82 | 0.40 |
| `t:score` (title only) | 0.385 | 36.3 | −35.2 | 0.48 | 0.41 |

The fixed 25/50/75% points flatter the lookup, so everything after uses **every** session boundary
(dev 477 snapshots); the lookup still held (0.076; `k` alone 0.085).

**Rounds 1b–5** (every boundary) — the question framing mattered more than the data:

| Round | Config | RPS | MAE | Bias | Order | Cov80 | What it showed |
|---|---|---|---|---|---|---|---|
| 1b | `tm:stage` / `tm:score` | 0.126 / 0.112 | 14.2 / 12.9 | −2.0 / −1.5 | 0.86 / 0.89 | 0.74 / 0.82 | % questions plateau |
| 1b | `tm:rem` | 0.088 | 11.7 | +5.2 | 0.97 | 0.84 | "how many more sessions?" ≫ "what %?" |
| 2 | `tmnf:rem2` (+ flags + norms sentence) | 0.080 | 9.6 | −0.8 | 0.97 | 0.74 | norms remove the optimism; curves too narrow |
| 3 | + temperature widening, lookup ensembles | 0.069 | 9.2 | +0.4 | 0.97 | 0.95 | calibration fixed; plateau for metadata-only |
| 4 | `tmnfl2c:rem2` (last 2 comments) | 0.066 | 8.8 | +2.0 | 0.97 | 0.84 | under `rem`, comment text now **helps** |
| 4 | **`rawnf:rem2`** (full context) | **0.061** | **8.0** | +0.7 | 0.98 | 0.88 | best; adding the lookup now hurts (0.062) |
| 5 | `mdnf` / `rawnfs` / `tlfull` : `rem2` | 0.062 / 0.063 / 0.065 | 8.2 / 8.1 / 8.6 | | | | markdown, dated sessions, timeline: no gain |
| 5 | `rawnfk:rem2` (+ per-kind norms) | 0.072 | 8.3 | +0.1 | 0.98 | 0.72 | overconfident |
| | lookup (last kind, k ≤ 8) | 0.073 | 10.0 | +0.7 | 0.92 | 0.94 | |

Temperature on the winner: T=1 → 0.0611 (cov80 0.88), **T=1.25 → 0.0611 (0.91)**, T=1.5 → 0.0618 (0.95).

## Norms: sensitivity and drift

The norms sentence is a **scale knob**, not a source of ordering (dev, full context):

| Norms | RPS | MAE | Bias | Order |
|---|---|---|---|---|
| correct (median 5) | 0.061 | 8.0 | +0.7 | 0.98 |
| none | 0.064 | 8.8 | +3.0 | 0.96 |
| too lean (median 3) | 0.073 | 9.8 | +6.4 | 0.97 |
| too heavy (median 9) | 0.084 | 9.5 | −6.4 | 0.98 |

Real drift inside September (after the first implementation: 2 → 3–4 more sessions; after the first
review: 1 → 2). Weeks 2–4, 690 snapshots, norms computed per week by `computeNorms`:

| Norms | RPS | MAE | Bias | w2 / w3 / w4 bias |
|---|---|---|---|---|
| oracle (own week) | 0.061 | 8.3 | +0.7 | −1.6 / +1.5 / +1.7 |
| **rolling (previous week)** | **0.063** | 8.7 | +1.8 | +2.8 / +0.8 / +1.7 |
| frozen (week 1) | 0.066 | 9.2 | +4.3 | +2.9 / +4.7 / +4.9 |
| lookup, rolling | 0.077 | 10.2 | +3.4 | |

Rolling norms recover ~60% of the frozen→oracle gap overall and match the oracle by week 4; the
T=1.25 widening held (cov80 0.86–0.91) without refitting. Recompute norms from recent closed tasks.

## Limits

Truth is the share of *sessions*; one workspace, one month (telemetry starts ~late Aug 2026), tasks
with 3–12 sessions; the description scrub is heuristic; underestimates tasks stuck in repeated
implementation rounds (e.g. LIN-3109 shown 45%, true 75%), though those curves come out wide. The
endpoint is alpha, the vendor new, with no second provider. ~35k calls, $4.72 in total.
