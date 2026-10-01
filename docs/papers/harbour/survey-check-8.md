---
title: Do the starting-context and step-overlap papers hold up?
kind: paper
version: 1
date: 2026-10-01
authors: [Claude (LIN-3184)]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 3a6a1e76, kind custom, LIN-3184); effort not recorded in the dispatch item. One bounded session, with no research, plan, review or close-out legs, by the brief's design. Four in-session subagents of the same tier blind-coded the fresh sample: reader A in two sessions of six digests in order, reader B in two in reverse, neither shown the paper, its codes or the other's work. This session re-ran the scripts, drew the sample, wrote the re-measures and the check, and made both papers' version 2. It wrote neither paper."
grounded_at: "9a73a179 (LinearViewer, origin/main when the check began; the anchor's line numbers are at this commit); 3366748 (simple-dispatcher, origin/main); local Claude Code transcripts on the runner machine read 1 Oct 2026 about 08:34Z; step-overlap's proxy snapshot (data/survey-overlap/proxy.json, fetched by its author 1 Oct 06:52–07:24Z), reused, not re-fetched"
cites:
  - "docs/papers/harbour/starting-context.md@9a73a179 (version 1, LIN-3178, PR #1669) and its scripts survey-context-extract.mjs, -analyse.mjs, -finder.mjs, each re-run"
  - "docs/papers/harbour/step-overlap.md@9a73a179 (version 1, LIN-3179, PR #1670), step-overlap-codes.json and its scripts survey-doubling-runner.mjs, survey-overlap-transcripts.mjs, -select.mjs, -digests.mjs, -codes.mjs, -analyse.mjs, each re-run"
  - "docs/papers/harbour/paid-where-written-check.md@9a73a179:120-121 and scripts/steady-base-carry.mjs@9a73a179:43-48 (file reads 17.9% of what a leg carries)"
  - "docs/papers/harbour/steady-base.md@9a73a179:195-237 (ticket reads 1.6%, 24–29 Sep)"
  - "docs/papers/harbour/where-the-effort-goes.md@9a73a179:82-92 (version 2: the bootstrap 3.5% of weighted tokens, 5.6% with cold-resume handshakes; 13%, 9% and 8% of close-out, review and plan-review)"
  - "docs/reviews/context-efficiency-ceiling-review-2026-08-15.md@9a73a179:30-45,164-195 (LIN-2115: one 93-token pointer, +33 turns and 2.2× the cost without it, on one task)"
  - "docs/papers/harbour/held-or-fresh.md@9a73a179:15-30,97-130,297-313 (a fresh supervisor's orientation and bootstrap; the handoff sensitivity; its options)"
  - "docs/papers/harbour/why-legs-repeat-codes.json@9a73a179 and survey-check-6-codes.json@9a73a179 (the 30 plan-review finds are from repeat rounds, round 2 or later)"
  - "docs/steady-base.md@9a73a179 (lines 3, 52, 79, 101-110, 152, 159, 169, 171, 199)"
  - "LIN-3184's description and brief, read over the workspace proxy 2026-10-01"
  - "scripts/survey-check-8-context.mjs and survey-check-8-overlap.mjs (this check); survey-overlap-digests.mjs's --offset (the fresh sample)"
---

# Do the starting-context and step-overlap papers hold up?

Their answers hold, and so do most of the figures in their findings. Their Options sizes hold less
well. Every committed script re-runs. starting-context's analysis reproduces from fresh transcripts
within 0.1 points: orientation is 5.8–25.7% of weighted tokens against the paper's 25.8%, because
two Runner sessions were still writing. step-overlap's reproduces exactly from its author's proxy
snapshot. Its digests and codes are byte-identical, and only a live orchestrator's window moved.
A fresh blind sample of 12 more census tickets (488 units, two readers, κ 0.78–0.88) confirms the
plan's shape: a fifth to a quarter restates the research, and most of the plan is new. Most
research is used. It does not confirm "cited one time in nine". The fresh sample cites one time in
four, and the 25 tickets pooled cite about one time in six.

What does not hold:

- **Two of starting-context's option sizes are too high, and one is too low.**
  - Option D, a beat's file list carried into the next beat, would reach about 1.4% of tokens, not
    4–5%. 85% of a supervisor's later-beat re-reads are of the ticket, which has new comments by
    then, and a file list cannot replace those.
  - Option C would save 0.1–2%, not "about 1–2%".
  - Option A, stopping the bootstrap, is worth up to about 5%, not 3.0%. The bootstrap's reads
    stay in the window for every later turn, and that costs up to 2.4% more.
- **step-overlap's "none of plan review's 30 real finds was in the research" is about repeat
  rounds only.** The 30 finds were drawn from second and later plan-review rounds and selected as
  new against the earlier rounds. First-round finds were not sampled.
- **step-overlap's ticket-read share is 1.3%, not 1.6%.** It is 1.6% only with briefs, and 2.0–2.4%
  at the measured 2.6 bytes a token.
- **step-overlap's Option A ceiling includes research sessions that the option would not skip.**
  Plan and plan review alone are 3.9% of raw tokens (4.3% weighted), not 4.5%.
- **Three comparisons with the earlier papers do not compare like with like.**
  - steady-base's 17.9% "file reads" includes 6.8 points of command output piped through `head`
    or `tail`.
  - where-the-effort-goes's 5.6% is a different quantity from starting-context's 5.8% lower bound.
  - step-overlap's "output tokens are under 1% of all tokens" is true of raw tokens. At list prices
    output is up to 14% of the weighted units.

Both papers are corrected as version 2. The corrections change no answer.

## Findings

**starting-context's census re-runs, and its re-finding range survives four alternative readings.**
On the paper's own rules, re-finding is 4.9–12.1% of weighted tokens. Without the bootstrap's
units, which the paper charges at the first beat's repeat rate, it is 4.4–10.2%. Weighting a
span's units by its calls instead of its read tokens, it is 4.5–12.0%. Counting only repo files
as repeats, the broad end falls to 6.2%. So half of the broad figure is the ticket and the proxy's
instructions catalogue. Of repeated file reads, 84.6% were of files nobody had changed. Dating a
change to main by the merge that landed it, instead of by the commit's own time, gives 85.7%; with
either date, 83.5%. The unchanged repeats carry 3.5% of the window under all three rules.

**The 82–85% re-read rate for the later roles holds as a count of reads. For files alone it is
two-thirds to seven-tenths.** For close-out and code review, 40–42% of the repeated orientation
reads are the ticket, and 17–22% are the proxy's instructions. A ticket re-read is nearly always a
repeat by key (92–97%), but by then the ticket has new comments. Counting distinct repo files
(session-file pairs), the share already read by an earlier session on the ticket is:

| Role | Orientation reads that repeat (paper) | Distinct things, repeating | Distinct repo files, repeating | Ticket's share of the repeats |
|---|--:|--:|--:|--:|
| close-out | 85% | 80% | 69% | 40% |
| code review | 82% | 78% | 67% | 42% |
| plan-review | 82% | 75% | 71% | 17% |
| plan | 68% | 60% | 53% | 26% |
| implementation | 62% | 61% | 55% | 30% |
| research | 18% | 13% | 4% | 55% |

The paper's own measure of unchanged repo files (49.5% of pairs repeat, 85% of them unchanged)
already makes the file-only point, and the table agrees with it. The headline line should say what
the 82–85% counts.

**The bootstrap costs more than its own turns.** Its reads, mostly two CLAUDE.md files and two
READMEs, stay in the window for every later turn. Priced as cache reads at the frontier tier's
weight, that carry is up to 2.4% of the fleet's weighted tokens, on top of the 3.0% the bootstrap's
own turns take. The snapshot keeps no tier per session, so 2.4% is a ceiling. The by-role
bootstrap figures agree with `where-the-effort-goes.md` v2 to the point: 13.9%, 8.9% and 8.0% of
close-out, code review and plan-review here, against 13%, 9% and 8% there.

**The finder's "plan-named paths" are the paths in the prompt and the whole ticket, and the claim
is better for first rounds.** The finder's input is the dispatched prompt plus the first read of the
ticket. So on a later implementation round it also sees the earlier implementer's report and the
code review. 100 of the 286 implementation sessions are later rounds. Split:

| Implementation sessions | Sessions | Named (median) | Recall of edited files | Precision against files used |
|---|--:|--:|--:|--:|
| First round on the ticket | 186 | 6 | 53% | 61% |
| Later rounds | 100 | 3 | 39% | 41% |
| All (paper: 284, 49%, 55%) | 286 | 5 | 50% | 56% |

Option C, the plan's named paths at the top of a first implementation prompt, is the case the first
row measures. Its recall and precision are a little better than the paper's pooled figure. All four
methods together name a median 98 files at 5.6% precision. That reproduces too.

**Later-beat re-reads in supervisors are ticket re-reads, so a file list reaches little of them.**
The paper's 42% of later-beat reads already made in an earlier beat reproduces: 43% in supervisors,
40% elsewhere. In supervisors, 85% of those repeats are the ticket and 8% repo files. Elsewhere,
64% are repo files. Applying the paper's own sizing rule (re-orientation units × the share that
would be saved), a file list reaches 0.3% of the fleet's tokens in supervisors and 1.1% elsewhere.
That is about 1.4% in all, against the paper's "about 4–5%".

**step-overlap's coded shares survive a second sample of the same size, except the citation rate.**
The fresh sample is the census's other tickets, every third from the second (12 tickets), cut by the
paper's own digest script and coded against its rubric unchanged. Shares are per ticket, averaged
over both readers and then over tickets, as in the paper. 95% intervals are from a ticket-level
bootstrap.

| Share | Paper (13 tickets) | Fresh (12) | Pooled (25) |
|---|--:|--:|--:|
| Plan restates the research | 25% (16–37) | 21% (14–29) | 23% (17–30) |
| Plan re-verifies it | 7% (4–10) | 5% (2–8) | 6% (4–8) |
| Plan extends it, or new | 65% (54–75) | 74% (67–80) | 69% (62–76) |
| Plan review checks a claim | 32% (22–42) | 40% (33–48) | 36% (29–42) |
| Plan review re-verifies | 35% (26–45) | 27% (23–33) | 31% (26–37) |
| Plan review new | 21% (15–27) | 27% (18–35) | 24% (19–29) |
| Implementer restates or re-verifies the plan | 41% (31–52) | 41% (29–52) | 41% (33–49) |
| Research used later | 75% (65–84) | 78% (71–85) | 76% (70–82) |
| Research cited | 8% (4–13) | 18% (11–27) | 13% (8–19) |
| Cited, of research used | 1 in 9 | 1 in 4 | 1 in 6 |
| κ (P, V, I, R) | 0.81, 0.88, 0.67, 0.73 | 0.85, 0.88, 0.79, 0.78 | 0.83, 0.88, 0.73, 0.76 |

So is 13 enough? For the plan's shape and for research being used, yes: the second sample lands
inside the first's intervals. It is not enough to tell a quarter from a third of plan review, or to
fix a citation rate. The two samples' intervals for citation barely touch. All four fresh readers
flagged the same rubric gap: P and I units have no PROCESS code, so status and next-action lines
were coded NEW. That inflates "extends or new" a little, in the paper's sample too, since the rubric
is the same. One reader noted that a unit can count as "cited" only because close-out later edited
the description, which is shown as it stands now. That inflates citation in both samples by an
unknown amount.

**The value comparison is scoped to repeat plan-review rounds.** The 30 plan-review finds come from
`why-legs-repeat-codes.json` and `survey-check-6-codes.json`. Both coded repeat legs only (round 2
or later), and a find counted only if it was new against earlier rounds. That none was in the
research is still a finding, and the research had been read and answered by then. But "none of plan
review's real finds" overstates it, and Option C's risk rests on it. The 44 code-review faults
reproduce as stated: 3 named before, 15 with no prior text.

**Planned children's planning is 3.9–4.3% of tokens without their research.** The paper's 4.5% is
raw tokens and includes the children's research sessions. In weighted units it is 5.2%. Option A
would skip only the plan and plan review: 3.9% of raw tokens, 4.3% weighted. The family counts
reproduce (32 of 65 implemented children planned, 23 plan-reviewed, 18 researched). In 40 of the
42 children that planned, the parent's plan or breakdown session came first.

**Writing is cheap in weighted units too, but not "under 1%" of them.** Output is 0.4% of raw tokens.
At list-price weights (output 5, cache read 0.1), it is up to 14% of weighted units. The words
posted, about 4% of output, are then about 0.5% of weighted units. The conclusion stands; the unit
it was stated in hid the price.

### Reconciling the two papers, and the papers they cite

**File re-reads at 4.9–12.1% and ticket reads at 1.6% measure different things, and both hold.**
The first is weighted units: the whole cost of the turns a session spends before its first productive
call, times the share of that span's reads that repeat. A turn carries the whole window, so this
prices the turns, not the bytes. The second is the bytes of ticket text, carried to the end of the
session, as a share of the summed window at 4 bytes a token. On like terms, carried bytes over the
window:

| Block | starting-context (2.6 bytes a token) | step-overlap (4 bytes a token) | step-overlap at 2.6 |
|---|--:|--:|--:|
| Ticket reads, all sessions | tickets and comments 2.4%, other proxy reads 0.7% | 1.3%, briefs 0.3% | 2.0%, briefs 0.4% |
| File reads | repo files 9.3% of the window (all roles) | 11.1% (census later sessions) | 17% |
| Re-reads of files an earlier session read | unchanged repeats 3.5% | 5.1% (4.2% across steps) | 7.8% |

The papers agree once the bytes-a-token ratio is fixed. Re-reading files carries two to four times
what reading tickets carries, and orientation costs more than either because every turn re-reads
the window. Neither paper knows the right ratio for ticket prose. starting-context measured 2.6 on
the whole window (median of 39,781 turns), and its Limits say prose is nearer 4. So ticket-read
carry is 1.3–2.4% depending on the ratio.

**`paid-where-written-check.md`'s 17.9% is not "low by a third".** `steady-base-carry.mjs` counts
any command containing `cat`, `sed -n`, `head` or `tail` as a file read
(`scripts/steady-base-carry.mjs:47`). Re-run on its window, it reproduces (327 legs, 17.9%).
Classing only the Read tool and a plain `cat`/`sed`/`head`/`tail` of a path as file reads gives
11.1%. The other 6.8% is piped command output (`git log | head`, `curl … | head -c`, test runs piped
to `tail`). At 2.6 bytes a token, 11.1% is about 17%, against starting-context's own file categories
at 14–18%. So the two agree only after both corrections. starting-context's Limits line, which says
the 17.9% "is low by a similar factor", is wrong in what it implies.

**`where-the-effort-goes.md` v2's 3.5–5.6% is not starting-context's lower bound.** Its 3.5% is the
bootstrap, which matches the 3.0% here and agrees role by role. Its 5.6% adds the handshake turn of
each cold resume on a per-ticket sample. starting-context's 5.8% adds instead the turns spent on
prompt, ticket and repo state before the first file read. The two sizes agree, but they measure
different things.

**The pointer probe is cited correctly by both papers.** LIN-2115 removed one 93-token
file-and-function pointer from an otherwise identical handoff, and the task took 33 more turns and
2.2× the cost, with the same verifier result. That is one task. Dropping CLAUDE.md changed no
verifier result and cut cost 23%. Both papers say it is the only direct test, and that their
censuses give base rates, not effects. That is right.

### Options: sizes, and where they overlap

| Option | Size as written | Supported? | Overlaps |
|---|---|---|---|
| starting-context A: stop the bootstrap for the roles that run it | Up to 3.0% | Low. Up to about 5% with the carried reads (above) | `held-or-fresh.md`'s fresh steps pay a 60–80k bootstrap; its cheap case already drops it. Every relay estimate there improves if A lands |
| starting-context B: hand later sessions the earlier sessions' file list | Bounded by 4.9–12.1% | As a bound, yes; files alone 4.9–6.2% (above) | The same option as step-overlap D, sized twice; do not add them. A file list is the small handoff `held-or-fresh.md`'s lean relay needs (every 10k tokens of handoff costs about 2.3 points) |
| starting-context C: the plan's resolved paths at the top of the implementation prompt | About 1–2% | 0.1–2% (a third to a half of 0.2–4.1%); first rounds' recall 53% at 61% precision | Inside B and step-overlap D for implementation |
| starting-context D: carry a beat's file list into the next beat | About 4–5% | No: about 1.4% (above) | `held-or-fresh.md` options A–B, which remove or replace the later beats themselves |
| starting-context E: tools for deterministic research questions | Perhaps 1–2% | A ceiling: search and history calls are 41% of research legs' calls and 32% of their result tokens, on 5.3% of tokens | None in these papers |
| step-overlap A: a child of an approved plan does not plan again | Up to 4.5%, perhaps 1–3% | Up to 3.9% raw, 4.3% weighted (above); 1–3% plausible | The steady-base map's row 7 (sizing the process); the breakdown line already exists in the prompt |
| step-overlap B: the plan cites the research instead of restating it | Under 1% | Yes | None |
| step-overlap C: plan review re-runs bounds instead of re-deriving | At most about 3% | 3% of four-step tickets' tokens; about 2% of the fleet's (31% pooled × plan review's 6.1%). Its risk sentence rests on repeat-round finds only | None |
| step-overlap D: each step leaves a file map | 1–3% of later steps' tokens | Yes, as a fraction of 5.1% (7.8% at 2.6 bytes a token) | starting-context B |
| step-overlap E: write less for tokens' sake | Small | Yes, 1.3–2.4% carried and about 0.5% to write | None |

No option is added here.

### The lines of `docs/steady-base.md` that change

The lines are at `9a73a179`. The anchor cites neither paper yet, so most changes are additions. This
check did not edit the anchor.

| Line | Now | Should read |
|---|---|---|
| 3 | "…`survey-check-6.md` checked `why-legs-repeat.md`…" (the intro's list of checks) | …and `survey-check-8.md` checked `starting-context.md` and `step-overlap.md`, each now at version 2 |
| 52 | "Rule-bearing text is only about 3% of the context a session carries." | About 3% at 4 bytes a token, about 4–5% at the 2.6 that starting-context measured. The cost is in what the rules make agents do. The conclusion stands |
| 79 | "…**36% in no candidate row**…" | Unchanged figure. Add that planned children's own plan and plan-review sessions are 3.9–4.3% of tokens (`step-overlap` v2), and orientation before the first productive call 6–26% (`starting-context` v2): parts of the remainder now sized |
| after 99 | (no point on starting context or step overlap) | A new point: orientation is 6–26% of weighted tokens, re-finding 4.9–12.1% (files alone up to 6.2%), the bootstrap 3.0% plus up to 2.4% carried. Steps paraphrase rather than copy; plan review re-verifies a quarter to a third; research is used three times in four and cited one time in four to nine. Ticket reads are 1.3–2.4% of carried context |
| 101–110 | "What this implies" has no line on orientation | A line: the reading a session does before it acts is a lever of a few percent, bounded by re-finding, and the pointer probe (one task) is the only evidence that pointers cut turns |
| 152 | Row 11: "text is ~3% of carried context (`steady-base`)" | ~3–5% of carried context, by bytes-a-token ratio (`steady-base`, `starting-context` v2) |
| after 153 | (no rows from these papers) | Candidate rows from the papers' own Options, sized as above: stop the bootstrap (up to ~5%); a file list for later sessions (bounded by 4.9–12.1%, the same row as step-overlap's file map); a child of an approved plan does not plan again (up to 3.9–4.3%) |
| 159 | "**Unexplained:** 32–36% … planning, review and close-out legs, stepper beats…" | Add: planned children's own planning is 3.9–4.3% of tokens (`step-overlap` v2) |
| 169 | "First-round legs and stepper beats inside sessions are the bulk." | Add: 29% of a stepper's tokens are re-orientation at the start of a beat, and what a supervisor's later beat re-reads is mostly the ticket (`starting-context` v2, `survey-check-8`) |
| 171 | "`survey-check-6.md` checked the last, `why-legs-repeat.md`." | …`survey-check-8.md` checked the last, `starting-context.md` and `step-overlap.md` (if the anchor cites them) |
| after 199 | (no rows) | Rows for `starting-context` (v2), `step-overlap` (v2) and `survey-check-8`: the independent check of the two papers above, and every figure it changed |

Unchanged and confirmed: point 4's "implementation is about a quarter of the tokens" (22.6% here),
and point 18's repeat-leg figures, which these papers do not re-measure.

## Method

Fresh checkout of both repos at origin/main, and the transcripts on this machine. The extractors
were re-run fresh. step-overlap's proxy snapshot was copied from its author's workspace rather
than re-fetched, to stay inside the wave's request budget. Its select step then chose the same 151
tickets.

```sh
node scripts/survey-context-extract.mjs && node scripts/survey-context-analyse.mjs
node scripts/survey-context-analyse.mjs --since 2026-09-19 --out data/survey-context/analysis-late.json
node scripts/survey-context-finder.mjs
# step-overlap: the author's data/survey-overlap/proxy.json and codes/ copied in
node scripts/survey-doubling-runner.mjs && node scripts/survey-overlap-transcripts.mjs
node scripts/survey-overlap-select.mjs && node scripts/survey-overlap-digests.mjs && node scripts/survey-overlap-codes.mjs
node scripts/survey-overlap-analyse.mjs
# the fresh sample: every 3rd census ticket from the second, coded blind into data/survey-overlap/fresh-codes/
node scripts/survey-overlap-digests.mjs --offset 1 --out data/survey-overlap/fresh-digests
# the re-measures
node scripts/survey-check-8-context.mjs && node scripts/survey-check-8-overlap.mjs
node scripts/steady-base-carry.mjs   # 17.9%; the split of its file reads used a copy with one extra class
```

The fresh sample's codes are in `survey-check-8-codes.json`, beside the paper's. The paper's
13 tickets are the census's every third from the first; these 12 are every third from the second.
Readers A and B were split across two sessions each, with A in order and B in reverse, as the
paper's were. The rubric was used unchanged.

## Limits

- **The fresh readers share the authors' tier,** as the paper's did. Agreement measures
  consistency, not correctness, and a shared tier may share a bias. The citation rate moved the
  most between samples.
- **The bootstrap's carried cost assumes frontier weight.** The snapshot keeps no tier per
  session, so the 2.4% is a ceiling.
- **The file-list reach for Option D uses the paper's own sizing rule,** which assumes a span's
  units follow its reads. It is the same rule the paper used for 4–5%, so the comparison is fair,
  but neither figure is a measured saving.
- **The split of steady-base's file reads is by regular expression.** A compound command that
  reads a file and pipes it counts as piped output, which biases the direct share down a little.
- **The proxy snapshot is the author's.** A ticket edited since 07:24Z is read as it was then,
  which is what the paper measured.
- **Close-out's orientation is slightly understated in starting-context.** In 25 of 242
  close-outs, the first productive call is a write to a scratch path through a shell variable
  (`$S/…`), which the extractor keys as a repo file. That ends orientation early.

## Next

- **Does a session handed the earlier sessions' file list read less, and stay as correct?** Both
  papers size the same option and neither can test it. Run it on first-round implementations,
  where the named paths are best (53% recall at 61% precision): for a week, put the resolved paths
  at the top of every second ticket's prompt. Compare tokens to the first edit, tokens per correct
  change and review findings. (Into `proposals.md`.)
- **Code first-round plan-review finds against the research.** The 30 coded finds are all from
  repeat rounds. A sample of first-round finds would test whether plan review's first pass also
  finds what research did not.
