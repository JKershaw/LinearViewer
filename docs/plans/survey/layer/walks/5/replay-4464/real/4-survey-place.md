# What this stage really wrote

## Comment on LIN-4464 at 16:02:43

## Survey global: LIN-4464 @ e8e92d50a

Base `e8e92d50a` is #2426's (LIN-4456) own merge, after `5dcf5bcda`. Kit and prompt blobs are unchanged (`cbec2d848`, `ef1c2ca91`). `areas.json` is `1dc2ba701`.

**Where it lands.** In `docs/plans/survey/`: the kit, the method-as-run addendum and `area-read-reports/`. The kit is frozen, but it is written as a one-off. Its table, its headings (`@ 4b5001ddf`, "comment on LIN-4447"), its verdict (Δ Runs − Δ control) and its Known limits all name Runs. Only the snippet and the prompt take parameters. This is its second use.

**Done the obvious way**, the task copies `area-read-method-as-run.md` and swaps "Runs" for "LLM". That leaves a second copy of the method, beside a kit whose words don't fit this read. The reports also have to record what the kit gets wrong here:

- **Bytes are out of balance.** The snippet gives LLM 91 files, 14 sampled, **380,459 bytes**. The control has 206,545 (1.84×). N = 14 was picked to balance against Runs. Here `lib/prompt-template-defs.js` (120,531) and `lib/openrouter.js` (103,188) make up 59% of the sample, and the reader bundle is about 395 KB, nearly twice the size that forced the file-path delivery. N is frozen, so record the gap; don't fix it.
- **The Known limits flip.** All three planned files are sampled (ranks 1, 5, 8). The read is sensitive to the work, but it mostly measures two files. Copying kit limits 1–2 would state the opposite of what is true.
- **The control moved more than the ticket says.** Since `4b5001ddf`, #2424 changed `lib/render-proxy.js`, and #2423 (LIN-4446) changed `lib/render-swipe.js` and `lib/render-task-page.js`. The control note shrank from 6,404 to 5,825 bytes. All of it falls inside this baseline. Because the salt is unchanged, the control paths match LIN-4453's, so this read is a free midpoint for it. Note that; don't claim it.
- **Control files the work imports.** Six unsampled front-end files import `lib/openrouter.js`, which piece 1 changes: `render-settings-models`, `render-roadmap`, `components/model-change-lines`, `render-settings`, `render-landing`, `components/decision-panel`. Record their blobs, as the kit does for its four.
- **Open PRs.** #2426 has merged (it is the base). #2427 and the eleven other open PRs touch neither sample.
- **The prompt's K2 examples are about Runs** (close-out, PRs per task, dispatch model). They are frozen; note it.

Something would notice if this went wrong. A report posted as a comment that names a full PR URL joins the ticket's landing, because `landingPrUrls` skips only blind reads and survey reports (Runs Waiting, LIN-4453 leftover). Write `#2427`.

**Better, at this task's cost.** One short addendum that cites the kit by blob and lists only what differs: base, area, byte gap, flipped limits, the six-file import table, and the control's three moved files. Full recorded fields go in each report, as in #2422, named `<slug>-e8e92d50a.md`.

**Better still, not this task's.** A parameterised kit under a new name, with base, area, N and salt as inputs and a per-read limits section, so the third read needs no third addendum. And an area-read kind in the comment classifier (LIN-4458).
