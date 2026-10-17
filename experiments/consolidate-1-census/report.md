# Experiment #1: census of scattered decisions (specks), as a candidate improvement to the Drift & Coherence Review

Saved by the main session from the census sub-agent's returned report (17 Oct). Tools and outputs are in this folder: census.mjs, census-HEAD.json, census-2a07f3ea.json, census-pre-ts.json, census-pre-fence.json, validate.mjs, recall-*.json, diff.mjs, diff-2a07f3ea-HEAD.json, probe-residue.mjs, top25.md.

## Summary
1. census.mjs: git objects + acorn, no network, ~3 s per commit. Seven generic detectors (clones: renamed-identifier hash, fuzzy, browser-port vocabulary, tiny helpers in ≥3 files; string sets + if/switch chains; records assembled the same way; repeated named constants; markdown heading / [marker] contracts). Constants resolved before comparing, so a rename can't hide a set.
2. Recall: 9/9 of the non-zero known decisions mechanically, at both commits. By hand 8 are the same decision; sessionClass partial (sees the copied terminal sets, not the one-line isTerminalLoop). The regex signatures also count 8 comment-only files.
3. fenceParse and tsParse are real consolidations, not renames. fenceParse → lib/loose-json.js, LIN-3114 (#1824, 4fc3243c): 7 copies at its parent, 0 at HEAD, 8 importers. tsParse → toEpochMs in lib/utils/time.js, LIN-3454/3455/3473 (#1826 3bcf6e2e, #1827 566b89be, #1840): 19 copies at the parent (regex said 18), 0 at HEAD, 37 files use toEpochMs.
4. Totals: baseline 2a07f3ea 318 groups / 1,069 sites; HEAD d349e78c 310 / 1,026 (14 gone, 10 new). Before the two consolidations 324–325 / 1,112–1,116. Rebuilds removed copies and also created some (a fifth MONTHS, UNENDED_STATES/LIVE_STATES in task-page-loader, #1905).
5. Drift & Coherence 2026-10-12 rows: every multi-site row still holds at HEAD. "Waiting on a person" copies survived two rebuilds (#1901, #1905). Seams moves F-A, F-B, F-C not done.
6. Improvement verdict: adopt as an instrument the review runs and reads, not as its ledger (commit beside scripts/code-shape/seams.mjs, same contract). One method sentence in the review prompt: run it at HEAD and at the previous edition's commit; ledger, mark as adoption/coincidence, or dismiss every group with ≥3 files or ≥2 areas. Needs the prompt's "no new tooling" clause changed and bytes repaid under the prompt-size freeze. (Harbour-specific wiring is for later, per John.)
7. Adds: 8 real decisions no review row names (top: free-tier 429 body ×13; a second "is this issue closed" set that omits duplicate). Fills the review's stated public/ blind spot: 15 mirrored file pairs, incl. two 12-function browser ports.
8. Can't see: cross-repo meaning, behaviour/ordering bugs, single-literal checks (=== 'blocked'), template-literal shapes, dependency direction — most of the review's High/Medium rows. ~1 in 4 of the top 25 borderline or noise.
9. Target 1 (review-named, LIN-3339): which wake marker means "waiting on a person". Set copies render-run-steps.js:159, routes/dashboard.js:338; inline checks run-view, task-page-loader, unanswered-decisions, observer-sweep, recent-runs → one predicate beside WAITING_WAKE_MARKERS in digest-feedback.js. Channel question out (needs a ruling). 8 files, 3 areas, 146 commits/90 days.
10. Target 2 (review-named): decision-stamp classifier → dependency-free leaf; delete copies in run-view, session-telemetry, wall-clock-summary; public/dispatch.js and public/session.js are forced browser copies → one window.* helper in public/common.js (41 window.* assignments exist) or embeddedData. 6 files, 2 areas, 76 commits.
11. Target 3 (census-only): one free-tier refusal body, freeTierRefusalBody(check) from lib/chat-request.js at 11 prompt-gate sites in 8 route files + 2 run-gate sites in dispatch-factory.js. 10 files, 3 areas, 335 commits.

## Method
- Scope server.js, lib/, routes/, public/ (.js/.mjs; no .min.js, vendor/): 432 files at HEAD, all parse. Areas from areas.json first-match, as seams.mjs. Churn = distinct commits touching the group's files in the prior 90 days; rank files × churn.

| # | Detector | Compares | Threshold |
|---|---|---|---|
| 1a | Clone, exact structure | identifiers renamed by first use, literals → type, AST hash | ≥5 statements, ≥40 nodes |
| 1b | Clone, fuzzy | structural 5-gram shingles, MinHash+LSH, exact check | Jaccard ≥0.7, ≤60 statements, vocabulary ≥0.3 |
| 1c | Clone, browser port | weighted overlap of property names, calls, strings | ≥8 names, ≥0.6, sizes within 2× |
| 1d | Clone, tiny rule | 1–4 statement functions | ≥3 files |
| 2a | String set | arrays/Sets; literal objects only when used as maps | order ignored; merge ≥0.66 |
| 3 | Discrimination | switch / if-chains / boolean / ternary chains over ≥2 strings | grouped with 2a by set |
| 2b | Record assembled the same way | ≥3 derived key=source pairs; or ≥3 identical literal pairs | overlap ≥0.7 |
| 2c | Named constant | same UPPER_CASE name, same literal, ≥2 files | |
| 4 | Text contract | ## headings, [marker] tokens in literals | ≥2 files |

Noise filters at HEAD: 5,386 trivial functions; 20 IIFE wrappers skipped (contents read); 30 single-file clone groups; 325 single-file sets; 9 empty/punctuation sets; 709 literal objects neither maps nor repeated; records need ≥3 derived pairs. Top 25 by hand: 19 real, 4 borderline, 1 mixed, 1 noise; tiny pass ~1/3 store scaffolding.

## Recall (9 non-zero known decisions)
terminalStates G0023 5/5 (+ authority providers/models.js); fmtDuration 4/5 (render-legal correctly excluded; finds formatSpan the regex misses); stampClassifier G0021 6 code copies (regex's other 2: a writer and a comment); sessionClass partial (G0024, G0009); shipLayout G0242 4/4 (+12 groups ship-layout↔ship.js); segmentRank G0130 2/2; ledgerHeading G0015 6/6; pageShell G0003 13/15; storeClear 18/19 across G0043/G0018/G0029.

## Totals over time

| Commit | Files | Groups | Sites | Cross-area groups |
|---|---|---|---|---|
| 6665eae5 (before fenceParse fix) | 413 | 325 | 1,116 | 214 |
| 38c5f34b (before tsParse fix) | 415 | 324 | 1,112 | 212 |
| 2a07f3ea (baseline, before both rebuild rounds) | 429 | 318 | 1,069 | 207 |
| d349e78c (HEAD) | 432 | 310 | 1,026 | 202 |

Per detector at HEAD (groups/sites): clone 139/428, record 36/139, set 36/108, set+discrimination 15/65, discrimination 22/60, constant 37/91, contract 25/135.

## Top 25 (HEAD), ranked by files × churn
See top25.md for the full table. Highlights: G0001 free-tier 429 body (10 files, churn 353); G0003 pageShell (known); G0004 loopback hosts {'127.0.0.1','localhost'} (4 files, 7 sites); G0008 UUID_REGEX (6 files; +UUID_RE ×3); G0009 loop terminal markers (5 files); G0010 [blocked] marker (7 files); G0011 SSE preamble; G0012 {'canceled','completed'} "finished" omitting duplicate (4 files) vs G0023 with duplicate (6 files); G0013 error envelope; G0014 credential copy; G0015 ledgerHeading; G0021 stamp classifier; G0024 sessionClass sets. Mirror pairs: 15, incl. swim-lanes↔swim.js and ship-layout↔ship.js (12 groups each).

## What the census adds / can't see
Adds: free-tier refusal body (13 sites); two answers to "is this issue closed"; loopback-host rule (7); validation constants restated (UUID ×9, control-char regex, max lengths ×3–4); loop-terminal marker set; browser ports; store scaffolding copies (~20 stores); copies born inside rebuilds.
Can't see: cross-repo meaning, behaviour and ordering divergences, wrong-answer bugs, single-literal checks, template-literal shapes, differently spelled predicates, capability contracts, dependency direction.

## Proposed improvement (generic)
1. Commit the census beside seams.mjs (e.g. scripts/code-shape/specks.mjs), same contract: repo + commit in, git objects only, shared area guide, JSON facts out. Keep known-decisions.sh as the old command.
2. The review runs it at HEAD and at its previous edition's commit, reports group/site totals beside places-per-decision, and rules on every group with ≥3 files or ≥2 areas.
3. Track groups and sites as a Periodicals measure; check every rebuild for new groups.
4. Next detector: repeated single comparisons (E.prop === 'lit' grouped by property and literal across ≥3 files) — would catch the six inline 'blocked' checks.

## Not picked
terminalStates (4 of 6 files forced browser copies; "duplicate vs finished" needs a ruling); credential row (not one safe decision; LIN-2150, LIN-2188); ship/swim ports (largest copies, low churn, a design decision).
