---
title: Does the steady-base paper hold up?
kind: check
version: 1
date: 2026-09-30
authors: [Claude]
model: "Frontier tier, claude-code; effort not recorded in the dispatch item. One bounded session (dispatch d220ff01, kind custom, LIN-3145), no plan, review or close-out legs, by the brief's design. In-session sub-agents did the blind coding and three adversarial searches; this session read and re-ran what they reported before using it. Not the paper's author: the paper came from dispatch 7d0975b0."
grounded_at: 8f5fe4aa (LinearViewer, where the paper measured); origin/main 4e566c2a differs from it only in docs/papers and scripts/steady-base-*
cites:
  - "docs/papers/harbour/steady-base.md@feb2f323 (version 1, LIN-3143, PR #1625)"
  - "docs/papers/harbour/steady-base-rules.json@feb2f323"
  - "scripts/steady-base-*.mjs@feb2f323, each re-run at 8f5fe4aa"
  - "docs/papers/harbour/review-loops.md@8f5fe4aa:34-40"
  - "docs/papers/harbour/paid-where-written-check.md@4e566c2a (the 38% versus 30%+9% note)"
  - "gh api repos/JKershaw/LinearViewer/rulesets/17491666 (read 2026-09-30): ruleset main-protection, created 2026-06-10"
  - "routes/proxy-writes.js@8f5fe4aa:294-317, lib/periodical-report-gate.js@8f5fe4aa:161-197 (LIN-694, LIN-2323)"
  - "lib/prompts/autopilot-kickoff.js@8f5fe4aa:101-117 (stepper beats sent by plain POST /dispatch)"
  - "routes/proxy-dispatch.js@8f5fe4aa:1010,1298 (how server-written dispatches are named)"
  - "../simple-dispatcher@3b1e734 hook.js, reapers.js:3410-3419"
  - "Dispatch rows and tickets over the workspace proxy, read 2026-09-30"
  - "The LIN-3143 session's transcript and scratchpad on this machine (for its tracker cache and where two figures came from)"
---

# Does the steady-base paper hold up?

On its headline, yes; on four of its load-bearing claims, no. Harbour's prompts do only grow:
every size in the growth tables re-runs exactly, and the longest pause we found in any series is
four weeks. But the gates are not speeding up. That reading rests on month-end cut-offs, and
mid-month cut-offs show no acceleration. "No gate rule is enforced in code" is false as written. A
GitHub ruleset has refused every merge to LinearViewer's `main` without green CI since 10 June,
and the proxy refuses Done on periodical tasks that lack evidence. What is true is narrower: nothing
checks the review Approve or the ledger. The cheap-tier model writing "nine worker prompts in
ten" is wrong too: it wrote 61 of 112. The orchestrator wrote 40 of the other model-written
prompts as stepper beats, and at least 18 of those wrap a brief the cheap model wrote. The
close-out lineage added 44 KB of prompt text, not 71 KB, because the script counted merged
branches twice. The rule inventory's
enforcement labels survive a blind recode, 42 of 45. Its classes do not: 25 of 45, with the
recode retiring more than twice as many rules. Version 2 of the paper corrects the figures. The
judgement disagreements stay here.

## Findings

**Most figures reproduce exactly.** Every command in the paper's Method was re-run at `8f5fe4aa`.

| Paper's figure | Re-run | Verdict |
|---|---|---|
| Fixed rendered sizes: all 8 kinds × 6 month ends; 80,240 and 13,010; meta-prompt 103,568 (5.7× May) | identical, cell for cell | confirmed |
| 221 prompt-text commits; +690,429 / −204,851 bytes; 17 shrank it; 5 of 101 citations left | identical | confirmed |
| #462: 39,155 → 31,668 bytes; 38,643 seven days later; 72,812 three weeks later | identical | confirmed |
| Provenance of 96 cited tickets: 42 runtime, 29 prompt-only, 24 unattributed, 1 other | identical | confirmed |
| 493 text-match assertions (279 at end of June) | identical | confirmed |
| `CLAUDE.md` 153,845 → 9,174 → 9,806 bytes; `docs/architecture` 147,422 → 168,768 | identical | confirmed |
| Code residue: production and test lines, ratios, comment share, ticket and plan-label comments, 0 → 26 pin-named files, net-new ratios 1.04/1.73/2.10/2.94 | identical | confirmed |
| Inventory tables: 213 census rules, 78,046 bytes, 8/131/74, 175 restated, classes 111/55/45/2 | identical | confirmed (but see the inventory findings) |
| Tracker: 89 Done tickets, median 10 comments and 6,063 words, 715-word descriptions, 497/317/584/521 by month, the kinds table, the signature table | identical on the LIN-3143 session's own cache | confirmed |
| The same tracker figures from a fresh fetch of the same sample (30 September) | Kinds, sizes and the path split identical. The paper's cache had silently missed 10 of the 190 census tickets; with them, 93 Done tickets, not 89. The Done medians are unchanged (715, 10, 6,063), each signature count rises by 0 to 4, and each month's description median moves by at most 21 words | confirmed; the dropped tickets bias nothing that matters |
| 102 of 112 prompts model-written | identical | confirmed; attribution wrong, see below |
| Carried context: 330 legs, prompt 1.6% pooled, 1.9% median | 327 legs, every share within 0.2 points | confirmed (three transcripts have been rewritten since, so the window selects fewer) |
| 1,371-word lineage paragraph citing 16 tickets | identical | confirmed |

**Six figures are wrong.** Version 2 corrects each one.

| Paper's figure | Correct figure | Why |
|---|---|---|
| Close-out lineage added 71 KB: LIN-550 25,342 B, LIN-810 2,120, LIN-811 1,540, LIN-3006 8,948, LIN-3033 15,592 | **44,330 B**: 12,671, 1,060, 770, 4,412, 7,793 | `steady-base-provenance.mjs` summed each branch commit and the merge that landed it, so the same diff counted twice. Fixed to count each landing commit once. |
| Review comments: median 671 words in July, 1,630 in August, 1,378 in September (193 comments) | **772, 1,796, 1,394** (50, 44, 209 comments) | The paper's session ran the report on a cache that was still filling; its transcript shows n=38 for July and n=193 for September. The same script on the finished cache gives these. |
| Worker templates "between 57 and 65 KB from February to the end of May, reached 83 KB on 1 June" | **69.2 KB at the end of May; 83.0 KB on 7 June**, after 11 PRs over 4–7 June | `steady-base-growth.mjs` labels each ISO week by its Monday, and the Monday was read as the date. On 1 June nothing had changed since 29 May. |
| "Review plus close-out gained 6.6, 8.3, 10.5 KB": the gates "are still accelerating" | Month ends as stated; **mid-month to mid-month +9,462, +10,411, +5,239 B** | The acceleration is an artefact of month-end cut-offs. Most of September's gain came in one week (LIN-3006, 3033, 3056: +7,360 B from 14 to 29 September). |
| The meta-prompt path "writes nine worker prompts in ten" | **61 of 112** by the cheap-tier engine; **40** by the orchestrator as stepper beats; 1 by another caller; 10 handwritten, one of them inside a beat | See the path finding. |
| "Two removals were deliberate"; "the one large deliberate cut was regrown in 7 days" | **Three.** LIN-1850 cut the passage-planner prompt from 19,204 to 9,405 bytes, and eight weeks later it is 14,961 | The churn script lists LIN-1850 as the largest net cut (−9,665), but the paper did not discuss it. It is the one large cut that has not grown back. |

**"No gate rule is enforced in code" is false. The narrow claim under it holds.** The paper
searched `lib/` and `routes/`. We also searched the GitHub settings, the workflows, the hooks,
`scripts/` and simple-dispatcher. Two mechanisms refuse a merge or a Done at runtime:

- **GitHub's `main-protection` ruleset** (id 17491666, active since 10 June 2026, no bypass
  actors, "current user can bypass: never"). It refuses any change to `main` except through a PR
  whose `CI success` check passed. That check is the aggregate job in `.github/workflows/test.yml`,
  and every first-parent commit since 11 June is a PR merge. So the CI half of close-out's merge
  gate is enforced for LinearViewer: rules 79 and 97 in the inventory ("merge only after … CI …
  on the exact commit"). It requires no approvals, so the Approve half is not enforced. It is
  also not strict, so the check runs on the PR head, not on the merged result. The private
  simple-dispatcher repo has no such protection: every ruleset call returns 403.
- **The periodical report gate** (`lib/periodical-report-gate.js`, called at
  `routes/proxy-writes.js:294-317`, LIN-694 and LIN-2323). It answers 409 to a proxy move to Done on
  a marked periodical task, unless a comment cites a commit, PR or blob link and one comment
  records an adversarial second read. Its header calls it "the code-level backstop … enforced in
  code rather than trusted from prompt text". It covers periodical tasks only, and only the proxy.

The paper's precise sentence survives. Nothing reads a review verdict or a `What CI Did Not
Prove` ledger to refuse a merge, a Done or a close-out dispatch. `lib/follow-on-ratio.js` only
measures. The ruleset matters for the proposal, though. Step 2's "required status check on the
merge" already exists as infrastructure. And step 2's Done refusal at the proxy has a working
precedent in the same route.

**Most model-written prompts come from the engine, but a third come from the orchestrator.** The
path heuristic itself is sound. Scores split into two groups: 102 prompts at 0.21 or below and 10
at 0.50 or above, with nothing between. The split is exactly 102 to 10 for any cut-off from 0.25
to 0.4 on 60-character lines. It is also 102 to 10 at 0.3 for 40- and 100-character lines. It
breaks only below 0.2. But "model-written" was read as "written by the cheap-tier model from the
meta-prompt", and the dispatch rows say otherwise. Server-written dispatches are named after their
action (`routes/proxy-dispatch.js:1298`), and a raw `POST /dispatch` keeps its caller's name. On
the same 112 rows:

| Who wrote it | Prompts | Of which pass the handwritten test |
|---|--:|--:|
| Server, from a recommendation (the engine, or the template) | 68 | 7 |
| Orchestrator, as a stepper beat (`beat 1/4: …`) | 41 | 1 |
| Raw dispatch with no name (triage) | 2 | 2 |
| Another caller | 1 | 0 |

Stepper beats are written by the frontier-tier orchestrator and sent with a plain `POST /dispatch`
(`autopilot-kickoff.js:101`). One of the 41 wraps the handwritten template. At least 18 of the
other 40 quote "the full engine-generated brief", so some meta-prompt text reaches those workers
inside the wrapper. The cheap-tier path therefore
wrote between 61 and 79 of 112, five to seven prompts in ten, not nine. The rest were shaped by
the kickoff and its handbook (67.9 KB), not by the meta-prompt. This weakens the paper's reason
to rank the meta-prompt first, but does not reverse it. The meta-prompt is still the largest single
text behind a worker's prompt, and it grew 5.7×.

**The carry weighting is sound, and it omits some rule text.** A block's carry is its size times
the turns left. That is the right weight for input-token volume, and the script applies it
correctly. The paper names two omissions: dollars, and behaviour. It misses two more.
- **Rule text arriving other than as the dispatched prompt.** 248 of the 327 legs fetched the proxy
  `/instructions` catalogue, which states the merge gate. That adds 0.57% pooled. `CLAUDE.md` reads
  add 0.65%. With both, rule-bearing text is 2.8% pooled and 3.4% for the median leg, against the
  paper's 1.6% and 1.9%. `CLAUDE.md` is also loaded into the system context, which the script
  counts as "the rest".
- **Token conversion.** Bytes are converted at four per token against a denominator of real
  tokens. JSON-escaped prompt text runs denser than that, so the shares are if anything low.

None of this changes the conclusion: the rules' direct token tax on a worker is a few percent,
and "cutting the digested rule text in half would save at most about 1%" becomes "at most about
1.5%".

**The close-out lineage holds, and holds more strongly than the paper says.** We searched every
commit and PR mentioning the ten tickets, in both repos, including closed PRs. No code for these
tickets landed under another id. The follow-ups (LIN-804, 812, 898, 1206, 1409, 1455, 1602,
1603, 2917, 3022) are their own tickets. LIN-1365's two "runtime" files changed only string
literals, so nine of ten changed no runtime behaviour. LIN-550's `lib/workflow-config.js` change is
a constant nothing reads. The registration that does something is the new template entry, which the
script counts as prompt text. Test files per ticket were 1 to 4, as stated. We also re-ran all 96
cited tickets with loose matching, taking any commit that names the ticket anywhere in its
message. That moves 5 prompt-only and 7 unattributed tickets onto the runtime side. All 12 moves
come from other tickets' commits that mention the ticket in passing. So 42/29/24 is the right
split, and the 24 unattributed stay unknown.

**The growth is real, and some of it is code.** No text moved into the prompt files from
elsewhere: of 286,771 bytes of new long lines since May, 160 existed anywhere in the repo at the
end of May. The renderer adds no false steps: every "–" in the rendered table is a template that
did not exist yet. Three points qualify the story.
- **Source bytes count code and comments.** Of the worker templates' 137 KB of source growth since
  May, 60% is string text, 11% code and 29% JS comments. The source series overstates prompt-text
  growth by about 1.7×. The rendered table, which the paper leads with, is unaffected.
- **Growth arrives in bursts, with one pause.** From July to September the worker templates gained
  a mean of 4.85 KB a week but a median of 3.07 KB, and three weeks supplied 60% of it. Counting
  weeks under 1 KB of change, the operating manual paused for four weeks, 24 August to 14
  September. Every other group paused for two weeks at most. "None has levelled off" is right
  for the series the paper leads with, and nearly right for the rest.
- **Two growth-script series include file moves.** "Proxy instructions" jumps from 0 to 79 KB on
  3 September, when LIN-2245 moved the catalogue out of `routes/proxy.js`. `prompt-system.md` was
  born at 20 KB in the `CLAUDE.md` split. The paper draws no conclusion from either series. Anyone
  reusing the script should not read those jumps as growth.

**The code-residue series holds.** It is not inflated by misfiled lines:
- **Comments inside prompt strings.** The comment regex matches 72 lines that sit inside string
  literals, out of 62,647. A lexer gives the same 43.3%.
- **Prompt files.** Leaving them out gives 43.8%.
- **Generated or vendored files.** There are none in either the production or the test set.
- **Plan labels.** A 40-line sample of the 688 held no false plan labels.

The pin count is the weak cell. Of the 26 "pin-named" files, one matches only because "pin"
appears inside "bookkeeping", one is a helper, and about six "witness" files are behavioural tests.
About 17 read or census source. The paper calls the match crude, and its trend holds.

**`CLAUDE.md` did move next door, word for word.** All 470 lines longer than 30 characters in the
pre-split `CLAUDE.md` appear verbatim in `docs/architecture/` or the new `CLAUDE.md`. Whether the
later 21 KB is growth displaced by the cap is less clear:
- **Consistent with displacement.** Three auth PRs (LIN-1892 twice, LIN-3131) edited `CLAUDE.md`
  and added 124 lines to `docs/architecture/` in the same change, 7.6 KB of the 21.
- **Not displacement.** Most of the other 17 commits add one-line entries to `source-map.md` (+8.2
  KB), which would exist without the cap.

"Moved next door" is right for the split and partly supported for what followed.

**The 38% is right, and 30% plus 9% is rounding.** `review-loops.md`'s table gives first pass 62%,
gates 30% and re-passes 9%, which sum to 101%. With each share rounded, 100 − 62 puts the
remainder in (37.5, 38.5]. 30 + 9 puts it in [38, 40). Both hold only between 38.0% and 38.5%, so
the paper's 38% is the better figure. The paper does need one word: that table's cost column
covers priced sessions only, so "38% of dollars" should be "38% of priced cost", over the thirty
days to 12 September.

**The inventory's enforcement labels survive a blind recode. Its classes do not.** 45 census
rules were drawn with seed 3145 and coded against a codebook written before any label was read.
The coders never opened the inventory.

| Field | Agree | κ | Main disagreement |
|---|--:|--:|---|
| Enforcement | 42 of 45 | 0.84 | One rule the runner does in code (simple-dispatcher reaps DONE sessions, `reapers.js:3410`). The paper cites that code on a sibling rule but labels this one text-pinned. |
| Restated elsewhere | 38 of 45 | 0.38 | The recode found five restatements the paper missed, in the meta-prompt, the handbook, a shared formatter or the proxy text. The paper claims two that name only the rule's own source or a human-facing mirror doc. |
| Class | 25 of 45 | 0.38 | The recode retires 25, the paper 11. Eleven of the fourteen are rules the paper keeps as prose. Six more that the paper keeps, the recode converts to code. |

Most of the class gap has one cause. The autopilot kickoff inlines the operating manual, and
many kickoff rules are repeated in it, often word for word. The paper defines "retire" as
restating another rule in the same or a sibling prompt. By that definition, a kickoff rule the
inlined handbook repeats is a retirement candidate. The paper's own records list 26 such rules
and class 4 of them as retire. This is a disagreement of judgement about whether a duplicate the
orchestrator reads twice should go. It is not a factual error, so it stays here and does not
change the paper. It does make the paper's 45 retirements a low estimate.

The restatement count has a bookkeeping problem that cuts the other way:
- **What the records support.** Of the 175 census rules recorded as restated, 21 name only their
  own source and 22 more name only `docs/autopilot-kickoff.md`, a keep-in-sync document for people
  that no agent is handed. Under the paper's definition, its records support 132 of 213.
- **What the recode found.** It found restatement in 40 of 45, so "four rules in five" is probably
  right. The records behind it are not.

The "2 of 213 scoped to a risk tier" finding survived: no coder put any of the 45 there.

**The proposal's premises, step by step.** This judges only whether each step follows from the
evidence as checked. It proposes nothing.

1. **Freeze at today's size.** Follows. The ratchet is real at every cut-off. The claim that the
   meta-prompt drives nine in ten needs narrowing to five to seven in ten, and the orchestrator's
   beats answer to the kickoff budget, which the step already includes. The "20.7 KB last month"
   figure is right. "Speeding up" is not a premise the step needs.
2. **Fix it in code first.** Follows, on a partly wrong premise. The Approve and ledger gate is
   prose, as stated. The merge's CI half is already enforced on LinearViewer, not on
   simple-dispatcher, and a proxy Done refusal already runs for periodical tasks. Both make the
   step more feasible than the paper says, and neither makes it unnecessary.
3. **Provenance and firing record.** Follows. LIN-1270 is still the only retirement we found that
   rests on a rule never firing. LIN-1850 was a rewrite to a validated draft, not a retirement on
   firing evidence.
4. **Collapse amendment chains.** Follows. The ledger eval covers the handwritten path, which
   wrote 1 of 24 review prompts. It covers neither the engine path nor the orchestrator's beats.
5. **Risk tiers.** Follows as stated. Only its ordering after step 3 is judgement.
6. **Retire the census pins.** The premise is borrowed from the fleet read and not re-tested
   here. The pin-file count behind it is about 17, not 26.

## Method

All measures ran at `8f5fe4aa`. `lib/`, `routes/`, `tests/`, `CLAUDE.md` and `docs/architecture`
are byte-identical at current `origin/main` (`4e566c2a`), so a separate run there would add
nothing.

```sh
# the paper's own commands, re-run unchanged (render-history and the mid-month renders use throwaway worktrees)
NODE_ENV=test node scripts/steady-base-render.mjs
node scripts/steady-base-render-history.mjs 8f5fe4aa
node scripts/steady-base-growth.mjs 8f5fe4aa
node scripts/steady-base-churn.mjs 8f5fe4aa
node scripts/steady-base-provenance.mjs 8f5fe4aa             # fixed in this PR to count each landing commit once
node scripts/steady-base-provenance.mjs 8f5fe4aa --tickets LIN-550,LIN-810,LIN-811,LIN-823,LIN-1365,LIN-1579,LIN-2825,LIN-3006,LIN-3033,LIN-3056
node scripts/steady-base-code.mjs 8f5fe4aa
node scripts/steady-base-carry.mjs --since 2026-09-24 --until 2026-09-29T20:00:00Z
node scripts/steady-base-tracker.mjs report <the LIN-3143 session's tracker-cache.json>
node scripts/steady-base-tracker.mjs fetch fresh.json && node scripts/steady-base-tracker.mjs report fresh.json
node scripts/steady-base-rules-recompute.mjs
# the check's own measures
node scripts/steady-base-check.mjs promptnames names.json      # ~4 min over the local proxy, one call per 3 s
node scripts/steady-base-check.mjs paths <tracker-cache.json> names.json
node scripts/steady-base-check.mjs carry-rules
node scripts/steady-base-check.mjs claude-md
node scripts/steady-base-check.mjs cuts
node scripts/steady-base-check.mjs inventory
node scripts/steady-base-check.mjs sample                      # the 45 rules the coders were given
node scripts/steady-base-check.mjs agreement                   # against steady-base-check-codes.json
node scripts/steady-base-check.mjs loose-provenance            # the cited tickets under any-mention attribution
node scripts/steady-base-check.mjs midmonth                    # review + close-out rendered on the 15th (throwaway worktrees)
node scripts/steady-base-check.mjs weekly                      # weekly spread and near-flat runs, from steady-base-growth.mjs
node scripts/steady-base-check.mjs source-split                # string / code / comment bytes of the worker templates
node scripts/steady-base-check.mjs moved-text                  # new prompt lines that already existed elsewhere
node scripts/steady-base-check.mjs comments                    # comment regex inside strings; share without prompt files
node scripts/steady-base-check.mjs plan-labels                 # the 40-line plan-label sample, for reading
node scripts/steady-base-check.mjs pins                        # the 26 pin-named files, for reading
gh api repos/JKershaw/LinearViewer/rulesets/17491666
git grep -n "checkPeriodicalReportGate" 8f5fe4aa -- routes lib
```

**Blind coding.** The sample was 45 of the 213 census rules, drawn by
`random.Random(3145).sample` over the census in file order. It covers 17 kickoff, 13 review, 9
close-out, 4 plan-review and 2 implementation rules. Three sub-agents coded 15 each. Each had only
the file, line, byte count and signature, and the codebook in `steady-base-check-codes.json`. They
were told not to open `steady-base-rules.json`, `steady-base.md` or the LIN-3143 scratchpad, and
none of them did. The codebook was written before any label was seen. Agreement is raw proportion
and Cohen's κ per field.

**Adversarial searches.**
- **Gate enforcement:** `lib/`, `routes/`, `server.js`, `scripts/`, the workflows,
  `.claude/settings.json`, git hooks, both repos' GitHub rulesets and branch protection, and
  simple-dispatcher's hook, reaper, admission and refusal code.
- **Lineage:** every commit and PR (`gh pr list --state all`) mentioning each of the ten tickets,
  in both repos.
- **Growth:** weekly and mid-month series, a string, code and comment split by a lexer, a search
  for moved text, and renders with feature flags on.
- **Code residue:** a lexer comment count, the series without prompt files, a 40-line plan-label
  sample and a reading of all 26 pin-file names.

**The tracker cache.** The paper's report was re-run on the LIN-3143 session's own cache, 386
tickets and 180 prompts, fetched 29 September. A fresh fetch of the same sample ran in this
session with the same script (a local copy paced at one call per 2 s, since the proxy's limit is shared), and the report was run on both.

## Limits

- **Coded by one reader, in three parts.** The three coders shared a codebook and a model, so
  their agreement with the paper measures two readings, not a consensus. The codebook ordered the
  classes: retire before convert-to-code. That order pushes toward retire, which is where most
  disagreements fall.
- **Where the prompt came from was inferred from its name.** A server-written dispatch is named
  after its action. A caller who named a raw dispatch "review" would be miscounted as server,
  which would understate the orchestrator's share. The 18 beats that "quote the engine brief" were
  found by a phrase match, so the true count could be higher.
- **The carry window moves.** Transcripts are selected by modification time, and three have been
  rewritten since the paper ran. The shares moved by 0.2 points at most.
- **The tracker sample is the paper's.** The fresh fetch reads the same tickets a day later, when
  comments and states have changed. It tests the cache, not the sampling.
- **Unchecked by a third reader.** This check found errors in the paper's scripts. Its own scripts
  and codes have not been checked by anyone else.
- **Enforcement of a rule's outcome is not enforcement of the rule.** The ruleset enforces "CI
  green before merge". It does not enforce "re-read CI on the exact commit". We counted it as
  enforcing the gate's CI half, which is a judgement.

## Next

The essay check (LIN-3146) should carry four corrections into "Every Fix Is Paid Where It Is
Written":
- the meta-prompt path writes five to seven prompts in ten, not nine;
- the close-out lineage added 44 KB, not 71;
- CI-before-merge is enforced by GitHub on LinearViewer;
- the gates grow steadily, not faster.

The paper's own Next, a hand-built firing record for the review and close-out rules, still stands.
It should count firings in the orchestrator's beats as well as in the engine's prompts, since a
third of the workers sampled read one.
