# What this stage really wrote

## Comment on LIN-4464 at 16:25:27 (the leftover dispatch, a follow-up in the implementation session)

### Leftovers
- Tidied: `docs/plans/survey/area-read-adoption-e8e92d50a.md` quoted the kit's Lessons figures (1,012 and 4,257 B) beside the LLM and control notes, so 4,257 B read as an LLM figure. It is the Runs note's, at `4b5001ddf`. The line now says which pair the figures belong to (`444b58246`).
- Summary comment, for John: the area-read method is now spelled across three files: the frozen kit `docs/plans/survey/area-read.md`, `docs/plans/survey/area-read-method-as-run.md` and `docs/plans/survey/area-read-adoption-e8e92d50a.md`. A third read would need a third addendum. These are unmapped `docs/plans/` files with no code file to cite, so no area note can hold this. A kit that takes base, area, N and salt as inputs would fix it, as the Survey global on this ticket said; it is outside this task.

No lesson added to either note. `docs/areas/llm-and-prompts.md` is the baseline's measured note (blob `b6b4c726d`) and `docs/areas/front-end-pages.md` is the control's, so an edit to either would move the note blob the reports pin.

Retires: none, no waiting entry. The PR touches only unmapped `docs/plans/survey/` files. The ask says this piece retires no Waiting entry. Settling an LLM & prompts entry would land piece 1–6 work before the baseline merges, and settling a front-end-pages entry would move the control.

PR: https://github.com/JKershaw/LinearViewer/pull/2430, head `444b58246f37ce4796b181e9b0e21843fce29eee`. CI green on that head: `CI success` plus all seven jobs.
