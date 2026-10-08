---
title: Does "coherence as it grows" (version 2) hold up?
kind: check
version: 1
date: 2026-10-08
authors: [Claude, for John Kershaw]
model: "claude-fable-5-1, Claude Code on the web, one interactive session, independent of the paper's author session; no subagents. Read-only: no network, no proxy, no credentials. Inputs beyond the repository were the author session's scratch files (the 265 defect rows' ticket text, the 705 send-back comments, prs.json, ticket-outcomes.json, exposure.json), treated as inputs, not as truth."
grounded_at: d61903f39f757ec84f989f541f0552dd86c8b26f (LinearViewer, origin/main); paper at 2ff5d1d4 on claude/elegant-einstein-mkvb89
cites: [docs/papers/harbour/coherence-as-it-grows.md@2ff5d1d4 (version 2), coherence-as-it-grows-escape-codes.json@a10a34c0, coherence-as-it-grows-sendback-codes.json@a10a34c0, coherence-as-it-grows-second-reading.json@a10a34c0, coherence-as-it-grows-codes.json@9261a894, coherence-as-it-grows-m3-readings.json@a10a34c0, coherence-as-it-grows-round2-preregistration.md@b79243a3, coherence-as-it-grows-scripts/decision-exposure.py@b79243a3 (re-run), coherence-as-it-grows-scripts/known-decisions.sh@9261a894 (re-run), coherence-as-it-grows-scripts/coherence-census.mjs@9261a894 (mirrored, re-run), coherence-as-it-grows-sources/check.md@a10a34c0, 17ee59dd (version 1 of the paper), measuring-throughput.md@d61903f3:19-20, why-throughput-halved.md@d61903f3:19-23, what-doubled-the-dispatches.md@d61903f3:18, reliability-baseline.md@d61903f3:14-62, steady-base-menu.md@d61903f3:64, lib/transcript-spend.js@d61903f3:38-42, server.js@d61903f3:738-759, "git log b79243a3 (author and commit date 2026-10-08 08:58:47 UTC) against scratch result mtimes"]
---

# Does "coherence as it grows" (version 2) hold up?

The counts hold; several sentences around them do not. Every number I could recompute reproduces: the 86 of 190 escapes with its sub-classes and months, the 143 of 397 send-backs with its splits, the κ 0.85 second reading, the finding-2 table, the 70 of 1,686 mirrored adds, the prompt co-change within one commit, and every cell of the exposure table from a fresh run of `decision-exposure.py`. A blind re-reading of 40 escape rows agrees with the file on class for 35 (κ 0.75); if my reading held across the file the 45% would be 44%. The 45% and 36% stand. What needs correcting: the pooled "twice the hours" gap is an artefact of 219 tickets that changed no production code; the "80 rows set aside" is the paper's own flag, not what reliability-baseline set aside (at least 67 of 103); the pre-registration was committed after four of the six measures had been run; three version-1 sentences survive that version 2 contradicts; the answer says every hand count had a second reader when only the admission lines did; and two series described as flat are not. Replacement text is under finding 7.

## Findings

### 1. Escape codes: the class holds under a blind re-read, within two points

Forty escaped rows drawn with `random.Random(20261008)`, 20 coded C-class and 20 N-class in the file, read from the Bug and introducing tickets' full text against the codebook, my class written down before comparing. **Class agreement 35 of 40 (κ 0.75); exact code 30 of 40.** I confirm 17 of the file's 20 C rows and would move 2 of its 20 N rows to C. Across the file: 86 × 17/20 + 104 × 2/20 = 83.5, so **44% not 45%**.

| Row | Ticket | File | Mine | Why |
|---|---|---|---|---|
| 14 | LIN-274 | C5 | N2 | The proxy query never had an `orderBy`; other paths sort, but nothing drifted |
| 80 | LIN-1323 | C5 | N1 | The second "mechanism" is the agent's own poll loop, not a code copy; the fault is branch precedence in `hook.js` |
| 112 | LIN-1740 | N2 | C1 | LIN-1739's seam fixed claim routing and left follow-up and abort, which the ticket names as the same class |
| 162 | LIN-2367 | N2 | C1 | LIN-2291's fix was incomplete at the same `.find`; no second site, so I concede N2 |
| 197 | LIN-2597 | C2 | N2 | Filed as missing patterns; the only drift claim is the implementer's "can no longer drift" |

Sub-counts reproduce exactly: 42/27/12/3/2 and 61/24/10/6/3; 56 of 80; 30 of 110; 13 of 61; June 7/26, July 13/43, August 26/42, September 36/61; 13 of version 1's 15 (LIN-2367 and LIN-3048 are not C); slice shares 31% and 60%. Two sentences do not match the file: the answer's "29 of 108 (27%)" is 30 of 110, and the use-found September share is 7 of 22 = 32%, not 30% (August 2 of 7).

### 2. Decision-level exposure: the table reproduces; the pooled hours gap does not survive

The re-run gives 224 of 1,385 exposed (16.2%), version 1's flag 520 with 78 missed, medians 234/44 lines and 4/1 files, 206 of 1,174 tickets, and every band cell of the paper's table. Three problems:

**The pooled "not exposed" column holds 219 tickets with zero production lines**, unexposable by construction: 90 of its 171 lineage tickets, median 1.1 hours. Without them the unexposed median is **7.4 hours against 7.1 exposed**; "twice the hours" is the zero-line tickets, not exposure. Send-backs (0.61 vs 0.23) and review legs (0.77 vs 0.17) survive.

**The four twins the second reader rejected stay in the script** (the connection-record mirror, the tracker/runner namespace, the binding-credential mirror, the sweep-interval constant), although the pre-registration says a rejected twin "is removed from M2 and M3 unless a third reading restores it". 13 of the 224 exposed PRs are exposed only through them; without them 211 (15.2%). The paper does not say the rule was waived.

**Partner sites, six checked at d61903f3.** Five exist and hold the anchor's decision: `db-indexes` and the paged-list sorts; `run-view` and `routes/dashboard.js:281`; `proxy-dispatch` and `routes/dispatch.js:742`; `lib/render.js` and `workspace-api.js:3418`; `transcript-spend` and `wall-clock-summary:58`, whose regexes already differ, as the second reader said. The sixth, `server.js:738-759`, is one constant feeding two parameters, not two values, and should leave the table. The script reports 1,996 of 3,385 site relocations moved more than 15 lines and 12 failed; relocation is by line text, so a caveat, not an error.

### 3. Send-backs: every count reproduces; the size-band sentence does not

From the codes file: 143 of 397 (36%); 95/29/17/16/7; 79 lead; June 1/5, July 7/32, August 49/137, September 64/176, October 22/47; plan review 96/210, code review 47/187; 101 of 220 tickets; first Request Changes 19 June, first plan-review verdict 27 July. Joined to `ticket-outcomes.json`, the coherence share by band is **46% under 50 lines (21 of 46), 36% at 50–299 (46 of 129), 36% at 300+ (55 of 152)**, 23% on zero-line tickets (10 of 43), 27 verdicts unjoined; "the same at every size (35–36%)" is not what this join gives. Twenty S-class verdicts, same seed, read against the comment bodies: **15 name the second site or the existing thing plainly; five are marginal** (LIN-2641's two secondary S-codes, LIN-2025 "hard call", LIN-3124 "thin quote", LIN-3107 "exported hooks"). **22 rows carry a truncation note** (20 verdicts): three verdicts are O0 for it, matching the Limits; three S-verdicts are marked quote-from-reply (LIN-2437 twice, LIN-3124); LIN-1110's verdict was itself inferred past the cap.

### 4. The archive numbers match; the set-aside count is the paper's own

95 → 47 (`measuring-throughput.md:19-20`), 84% → 72% and 4,290 → 2,880 (`why-throughput-halved.md:19-23`), 7.6 → 20.0 (`what-doubled-the-dispatches.md:18`), 5.4 → 13.7 and 5.7 (`reliability-baseline.md:16-20,48-51,62`); the quoted sentence is `steady-base-menu.md:64` word for word. **The 80 is not what reliability-baseline set aside.** It set aside "at least 67 of the 103 August–September escapes": 33 residue-labelled, at least 21 unlabelled, 11 follow-ups. The paper's 80 is its own `foundLater` flag (July 6, August 35, September 39). Of its 74 August–September found-later rows, 53 (72%) are coherence faults; of the 66 escaped rows with a residue or follow-up label, 42 (64%).

### 5. The second reading reproduces exactly

113 of 126 agree, κ 0.85; twins 25 live, 4 partly, 4 not; reasons boundary 10, convenience 10, rule 7, semantics 3, compat 2, unclear 1; 17 of 33 on a rule or boundary.

### 6. The git figures reproduce

`known-decisions.sh` at the six shas gives the finding-2 table to the cell. First-parent commits since June touching `lib/prompt-template-defs.js`: 64, 54 also touching the meta-prompt (June 18/20, July 8/11, August 12/13, September 11/13, October 5/7), against the paper's 63 and 53; 84% holds. Observation: 25 of 51 against 25 of 50. `coherence-census.mjs mirrored` (17 seconds): 70 of 1,686, months matching. LIN-3300's sizes: 106,011; 131,754 → 109,927; 8,115.

### 7. Reading: what the text claims beyond the counts

- **Pre-registration timing.** The Method says it was "committed as b79243a3 before the first result". The commit is 08:58:47 UTC. The exposure results (08:55:46), the M3 readings (08:57:04), the second reading (08:44) and the literature check (08:45) predate it; the escape codes (09:15–09:48) and send-back codes (09:51) follow. The text may have been drafted earlier; the claim as made is false for four of six measures.
- **"Every hand count read blind by a second reader"** (answer) is true only of the 126 admission lines; the escape and send-back codes were read once each, as the Limits say.
- **Three version-1 sentences contradict version 2.** Line 165: "as this paper's exposure measure is" (version 2's unit is the site, not the file). Line 171: "finding 4 holds the tier fixed and still finds no rise" (it does neither). Line 214: the Method's "Exposure and cost" paragraph still describes the file-level flag and "the sibling-site reading from its `reason` text, by one reader".
- **"36 to 42 production lines a month from January to September"** are the endpoints only; the monthly medians (added plus deleted) run 36, 84, 41, 73, 60, 54, 71, 61, 42. No measure makes it flat.
- **"Three times as often"** is 2.8× pooled, 2.7× without zero-line tickets; "five times the size" is 5.3×. Both fair. Nothing estimated is labelled measured; the hours gap is the one measured figure read wrongly.

**Corrections and replacement text.**

1. Answer: "29 of 108 (27%)" → "30 of 110 (27%)". "every hand count read blind by a second reader" → "the admission lines read blind by a second reader, and the escape and send-back codes read blind, once, by readers who had not seen version 1".
2. Findings 3 and 4: "June 27%, July 27%, September 30%" → "June 27%, July 27%, August 29%, September 32%".
3. Finding 4 and answer: "set aside 80 rows found by later reviews and sweeps, and 70% of those are coherence faults" → "set aside at least 67 of the 103 August–September escapes; this paper's own reading marks 74 of the 103 as found later, and 53 of those (72%) are coherence faults".
4. Finding 3 table and prose: "Median working hours … 7.1 | 3.0" → "7.1 | 7.4 (62 / 81, tickets that changed production code)"; "pooled, exposed tickets take twice the hours; within a band they take no more" → "exposed tickets take no more hours, pooled or within a band, once the 219 tickets that changed no production code are set aside".
5. Finding 3: "the share is the same at every size of change (35–36%)" → "46% on tickets under 50 production lines, 36% at 50–299 and 36% at 300 or more".
6. Finding 4: "the size of the median merged change (36 to 42 production lines a month from January to September)" → "the median merged change, 36 production lines in January and 42 in September, with the months between at 41–84".
7. Method: "committed as b79243a3 before the first result" → "committed as b79243a3 at 08:58 UTC, after the exposure, sibling-edit, second-reading and literature results had been produced (08:44–08:57) and before the escape and send-back coding".
8. Method, add: "The four twins the second reader rejected were kept in M2 and M3, against the pre-registration; 13 of the 224 exposed PRs are exposed only through them." Drop the `OBSERVER_SWEEP_INTERVAL_MS` row from the script's table.
9. Line 165: "as this paper's exposure measure is" → "as version 1's exposure measure was". Line 171: delete "which is why finding 4 holds the tier fixed and still finds no rise". Line 214: label the paragraph version 1's method or delete its escape sentence.

## Method

Read `standard.md`, `paid-where-written-check.md`, the paper, both codebooks, the pre-registration and version 1 (`git show 17ee59dd:…`). Recomputed every count in findings 1–5 from the committed JSON with `python3 -I`. Re-ran `known-decisions.sh`, `coherence-census.mjs mirrored origin/main --json`, and `decision-exposure.py --prs data/prs.json --tickets data/ticket-outcomes.json --exposure data/exposure.json --readings …m3-readings.json --out <scratch>`, comparing its `tables.md` to the paper; recomputed the pooled cost cells without band 0 from `ticket-outcomes.json` joined to `perPr`. Co-change: `git log --first-parent --since=2026-06-01 --name-only d61903f3`. Partners: `git grep -n -E <pattern> d61903f3 -- <path>`. Samples: `random.Random(20261008)`, text dumped with classes withheld, coded, then compared (`scratchpad/check/my-codes.json`). Timing: scratch mtimes against `git show -s --format='%ai %ci' b79243a3`.

## Limits

- **One reader, same model family as the author**: the re-read measures noise within one family, not the classes' validity; my five disagreements are arguable, and I concede one.
- **The send-back sample was judged from the quote and 1,600 characters of context**, not whole comments.
- **The exposure re-run used the author's scratch inputs**, not regenerated ones; the script is checked, its inputs are not.
- **Timing rests on scratch mtimes**, which record when results were written, not when the pre-registration was drafted.
- **Finding 4's archive figures were read at their source sentence**, not re-derived from those papers' data.

## Next

One line to `proposals.md`: re-code fifty escapes and fifty send-backs with the slices swapped and report κ; this check's 40 rows (κ 0.75) are the first point.
