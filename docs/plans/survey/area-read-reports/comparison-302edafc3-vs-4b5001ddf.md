# Area read: comparison, `302edafc3` against `4b5001ddf` (LIN-4462, for LIN-4447)

**The result first: no detectable difference.** The kit's rules give D = +0.25, inside the ±0.5 band, so they produce "no detectable difference at this threshold". That is not evidence that LIN-4447's pieces failed. The sample did not reach the work: 3 of the 14 sampled Runs files changed, against 35 of 121 in the area, and none of the six new homes is sampled. The whole of D is two single-point changes, one per area, each by one reader.

This file sets the after-read beside the baseline using the frozen kit ([area-read.md](../area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and its verdict criteria exactly as written. The method is [area-read-method-as-run.md](../area-read-method-as-run.md) section 8. It is an addendum, not an edit. The kit, the reader prompt (blob `ef1c2ca9173831f53ca32b60da1d805d27bf2159`), the method file and both baseline reports are unchanged.

| | Before (`4b5001ddf`) | After (`302edafc3`) |
| --- | --- | --- |
| Runs & dispatch | [runs-and-dispatch-4b5001ddf.md](runs-and-dispatch-4b5001ddf.md) | [runs-and-dispatch-302edafc3.md](runs-and-dispatch-302edafc3.md) |
| Front end: server-rendered pages (control) | [front-end-pages-4b5001ddf.md](front-end-pages-4b5001ddf.md) | [front-end-pages-302edafc3.md](front-end-pages-302edafc3.md) |

## 1. Scores

Per pass: K1 to K4, then the pass's one-decimal code mean, then M1 and M2 with the note mean. Combined is the mean of the two passes' one-decimal means (method section 7). The raw mean of the criteria is in brackets.

| Area | Read | Pass | K1 | K2 | K3 | K4 | Code | M1 | M2 | Note |
| --- | --- | --- | --: | --: | --: | --: | --: | --: | --: | --: |
| Runs | before | A | 4 | 3 | 3 | 3 | 3.3 | 4 | 3 | 3.5 |
| Runs | before | B | 4 | 2 | 3 | 3 | 3.0 | 3 | 3 | 3.0 |
| Runs | after | A | 4 | 3 | 3 | 3 | 3.3 | 3 | 4 | 3.5 |
| Runs | after | B | 4 | 3 | 3 | 3 | 3.3 | 3 | 4 | 3.5 |
| Control | before | A | 4 | 3 | 3 | 3 | 3.3 | 4 | 2 | 3.0 |
| Control | before | B | 4 | 3 | 4 | 3 | 3.5 | 4 | 2 | 3.0 |
| Control | after | A | 4 | 3 | 3 | 3 | 3.3 | 4 | 3 | 3.5 |
| Control | after | B | 4 | 3 | 3 | 3 | 3.3 | 4 | 3 | 3.5 |

| Area | Code before | Code after | Δ code | Note before | Note after | Δ note |
| --- | --: | --: | --: | --: | --: | --: |
| Runs & dispatch | 3.15 (3.125) | 3.30 (3.25) | **+0.15** (+0.125) | 3.25 | 3.50 | +0.25 |
| Control | 3.40 (3.375) | 3.30 (3.25) | **−0.10** (−0.125) | 3.00 | 3.50 | +0.50 |

**Per-criterion Δ** (the mean of the two passes, after minus before):

| Area | K1 | K2 | K3 | K4 | M1 | M2 |
| --- | --: | --: | --: | --: | --: | --: |
| Runs & dispatch | 0.0 | **+0.5** | 0.0 | 0.0 | −0.5 | +1.0 |
| Control | 0.0 | 0.0 | **−0.5** | 0.0 | 0.0 | +1.0 |

On the code side, each area moved on exactly one criterion, in one pass, by one point. In Runs, pass B's K2 went from 2 to 3. In the control, pass B's K3 went from 4 to 3. Every other code criterion in every pass is the same before and after.

## 2. The kit's verdict

- **Noise guard (verdict 1):** passed in all four reads. Before: Runs |3.3 − 3.0| = 0.3, control |3.3 − 3.5| = 0.2. After: 0.0 and 0.0. Every read is decided, and no repeat is called for.
- **D (verdict 2)** = Δ(Runs) − Δ(control) = (+0.15) − (−0.10) = **+0.25**. From the raw criteria it is (+0.125) − (−0.125), the same +0.25.
- −0.5 < +0.25 < +0.5, so the kit's verdict is **no detectable difference at this threshold.**
- **Note movement (verdict 3), reported on its own and not counted in D:** Runs note +0.25 (3.25 → 3.50) and control note +0.50 (3.00 → 3.50). Both notes rose. The rise comes from M2 in both areas (+1.0 each). Runs' M1 fell by 0.5. This is note movement, not code improvement. The Runs note grew from 11,540 to 18,045 bytes (Lessons 4,268 → 6,019 by the guard's count, Waiting 20 → 21). The control note grew from 6,404 to 7,115 bytes (Lessons 1,023 → 1,023, Waiting 14 → 14).
- **Control moved (verdict 4): flagged.** 4 of 14 sampled control blobs changed (`lib/render-swipe.js`, `lib/render-session.js`, `lib/render-task-page.js` and `lib/render-proxy.js`), and one unsampled tracked file changed (`lib/render-task-timeline.js`). Two of those changes come from LIN-4447's own pieces: LIN-4460 (`lib/render-task-page.js`) and LIN-4457 (`lib/render-proxy.js`). The flag does not change the verdict. It means the control is not untouched, and D's bias from that is unknown.

**Did Runs & dispatch improve by more than the control?** By the kit's rule, the answer is not shown. D is +0.25: Runs' code score rose by 0.15 and the control's fell by 0.10. The kit counts only a difference of 0.5 or more, and this one is half that. This is "no detectable difference", not a pass and not a fail.

## 3. How big reader drift is next to the threshold

The same control sample was read once more, between these two reads: at `e8e92d50a` for LIN-4464 ([front-end-pages-e8e92d50a.md](front-end-pages-e8e92d50a.md)), with the same kit, prompt, N and manifest. Between `4b5001ddf` and `e8e92d50a`, three sampled control files had moved, each by tens of bytes (`lib/render-proxy.js` gained two `aria-label`s, plus small changes to `lib/render-swipe.js` and `lib/render-task-page.js`). LIN-4460 had not yet landed.

| Control read | Pass A K1–K4 | Pass B K1–K4 | Code | Note |
| --- | --- | --- | --: | --: |
| `4b5001ddf` (LIN-4453) | 4 3 3 3 | 4 3 4 3 | 3.40 | 3.00 |
| `e8e92d50a` (LIN-4464) | 4 3 3 3 | 4 3 3 3 | 3.30 | 3.50 |
| `302edafc3` (this read) | 4 3 3 3 | 4 3 3 3 | 3.30 | 3.50 |

- On almost unchanged code, the control's code score moved by −0.10 between the first two reads, from one reader's K3 dropping 4 → 3. That is the whole of the control's Δ in this comparison. It was already there at `e8e92d50a`, before LIN-4460 touched `lib/render-task-page.js`. From `e8e92d50a` to `302edafc3` the control scored identically, although four sampled files moved in that span.
- A one-point change in one criterion of one pass moves an area's code score by 0.125 raw (0.10 to 0.15 by the one-decimal convention). D = +0.25 is two such changes, one per area. The ±0.5 threshold is four. The reference shows a one-point change on nearly identical code, so D sits inside the size of change this instrument shows from reader variance alone. A second free reference agrees: LIN-4463's control (`auth-accounts-and-workspaces`), read twice over byte-identical code, scored the same both times ([area-read-adoption-0cf05ce8f.md](../area-read-adoption-0cf05ce8f.md), section 5). Readers can agree exactly, and can also move one point when little has changed.
- Note scores move more than code scores. The control note went 3.00 → 3.50 → 3.50 while it changed from 6,404 B to 5,825 B to 7,115 B. So the +1.0 rise in M2 in both areas cannot be told apart from reader drift either.

## 4. The sample's blind spot, as numbers

| | Runs & dispatch | Control |
| --- | --: | --: |
| Area files before → after (code scope, first match) | 115 → 121 | 92 → 94 |
| Area files that differ (changed + new) | 35 of 121 (29 + 6) | 16 of 94 (14 + 2) |
| Sampled files that differ | 3 of 14 | 4 of 14 |
| Sampled files byte-identical to baseline | 11 of 14 | 10 of 14 |
| New files in the sample | 0 of 6 | 0 of 2 |
| Planned Runs files in the sample (kit, Known limits 1) | 1 of 13 (`lib/cost-read.js`) | n/a |

The six new Runs files are `lib/run-trail.js`, `lib/run-live-wait.js`, `lib/cost-read-calls.js`, `lib/dispatch-feedback-kinds.js`, `lib/item-stage-stamp.js` and `lib/usage-snapshot-intake.js`. None ranks in the first 14 by the kit's key. The survey comment on LIN-4462 gave 34 changed Runs files; the count here, 35, compares blobs at the two commits. Proportionally the control's sample moved more than the Runs sample (4 of 14 against 3 of 14), although the control's changes are small (−54 to +140 bytes per file).

## 5. What the readers' words show (quoted, not scored)

- **K2, Runs.** Both baseline readers cited "decision-stamp kinds" inlined in `lib/wall-clock-summary.js` as a restated rule. That inline copy is gone at `302edafc3`: LIN-4455 replaced it with an import from `lib/dispatch-feedback-kinds.js`. Neither after-reader cites it. Both after-readers instead cite the figure rule computed in three places in `lib/cost-read.js`, and the `VERIFY_BASH` / `CI_TEST_SIGNATURE` pair that "visibly differ". Pass B's baseline K2 of 2 also leaned on the note's record of "a close-out precedence split between box and guard", which the note no longer records. Pass B's K2 rose from 2 to 3. As pre-registered, K2's frozen examples are the rules the pieces consolidated, so this rise is partly the rubric asking about the fixed rules.
- **The new homes are seen only through the note.** Both Runs readers list `lib/run-trail.js`, `lib/run-closeout-state.js`, `lib/cost-read-calls.js` and `lib/dispatch-feedback-kinds.js` under "Where I could not tell", because those files are not in the sample.
- **Runs note.** Both after-readers gave M1 3, calling the Lessons "compressed past easy action" and "packed with ticket numbers and shorthand". They quoted two Lessons this work added: "When a person acts, Harbour follows" and "stands the gate aside". Both gave M2 4, finding that "nearly every entry" says why it waits.

## 6. Limits

1. **The control is not untouched** (verdict 4). Part of its Δ comes from LIN-4460 and LIN-4457. Section 3 shows that the control's −0.10 was already present before LIN-4460 landed, but that does not remove the bias in general.
2. **Model.** All four after-readers ran on `claude-opus-5-5`. The baseline readers "inherited the operator's model", which was not recorded.
3. **Reader conditions.** The after-readers used Bash on their own inputs file and ran outside the repository's working directory. The baseline readers used Read only. Tools were unrestricted at both reads (method section 3).
4. **Two passes per area.** That is the kit's Known limits 4, and section 3 shows its size.
5. **Most of LIN-4447's move lies outside Runs** (Known limits 2). This read does not claim that duplicate rules outside Runs are gone, or that they remain.

Retires: nothing. This is a measurement, and it settles no Waiting entry.
