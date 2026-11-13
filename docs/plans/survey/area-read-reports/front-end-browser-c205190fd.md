# Area read: Front end: browser code @ c205190fd (before, LIN-4463)

The before-read of the work area, made with the frozen kit ([area-read.md](../area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and the frozen reader prompt ([area-read-reader-prompt.md](../area-read-reader-prompt.md), blob `ef1c2ca9173831f53ca32b60da1d805d27bf2159`). Adoption, sample and verdict are in [area-read-adoption-0cf05ce8f.md](../area-read-adoption-0cf05ce8f.md). The after-read is [front-end-browser-0cf05ce8f.md](front-end-browser-0cf05ce8f.md).

## Recorded fields

| Field | Value |
| --- | --- |
| Area | Front end: browser code (`front-end-browser`), the work area |
| Base commit | `c205190fd` (pre-work base of LIN-4463) |
| `docs/areas/areas.json` blob | `d13fca20e50c37e859e82fbc820177acefd4e48d` |
| Kit blob | `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` |
| Reader prompt blob | `ef1c2ca9173831f53ca32b60da1d805d27bf2159` |
| Note | `docs/areas/front-end-browser.md`, blob `293d19fe1c3860b2f71856d2f7acec51de90bcba`, 6,245 B |
| Universe | 44 files, 1,662,262 B |
| N | 14 (frozen) |
| Sample | 14 files, 361,532 B; paths and blobs in the adoption file, section 3 |
| Bundle | note plus sample, 368,169 B, built from git objects at `c205190fd` |

## Passes

Two passes, each a fresh general-purpose agent. Each pass's output is verbatim.

### Pass A

```
Code
- K1: 4. File names and each file's header comment name its surface (chat, dispatch, live console, task page, session), so the file to open for a behaviour is usually evident. Cited: public/task-page.js, public/live-console.js
- K2: 3. Several rules have one clear home (the disposition allow-list, the halt disclaimer read from one node), but formatElapsed and the clock ticker are restated in two files. Cited: public/session.js, public/task-page.js
- K3: 3. A typical function reads clearly from its docblock and body, but many depend on window globals whose behaviour is defined in files not given, so exact behaviour needs a second file. Cited: public/dispatch.js, public/live-console.js
- K4: 3. Names such as isReadOnlyDisposition, createPoller and pollAction say what they do and comments give reasons, but task, issue and ticket, and run, session and loop, are used interchangeably, and many comments rely on ticket numbers a reader cannot follow from the file. Cited: public/session.js, public/chat.js
- Code mean: 3.3

Note
- M1: 4. Most lessons say what to do and why (coalesce polls to one fetch per window, keep shared modules leaves, test module order with readyState), though the CSS lesson states its rule with only test names as the reason.
- M2: 4. Most waiting entries name the file, the blocker and why it is deferred (for example, a module-capable test loader is needed first), but the llms.txt and prompt-section.js entries are open defects rather than deferred items and give no reason for not scheduling them.
- Note mean: 4.0

Where I could not tell: the definitions of the shared globals these files call (window.api, window.taskPageHref, window.runPageHref, window.computeFitZoom, window.renderQueueRow, window.ProxyToggle, and the BriefSection, CloseOut, PromptSection and QuestionCards modules, which live in files not given); what the LIN-numbered tickets and review-ledger labels say; the reviews and papers the note cites; and whether the note's waiting items are still open.
```

Pass A: code raw mean 3.25 (reported 3.3); note mean 4.0.

### Pass B

```
Code
- K1: 4. Most files are named for their surface (`public/dispatch.js`, `public/task-page.js`, `public/live-console.js`) and each header lists what it owns, so the file to open is usually clear from the name.
- K2: 2. Several rules are restated rather than homed: `formatElapsed` is the same function in `public/session.js` and `public/task-page.js`, and the poll rule is written separately in the live console, collective, dispatch and PR-state polls.
- K3: 3. Typical functions are short and their comments give the reason, but many depend on window globals defined in files not shown, and a few run to hundreds of lines, such as `paint` in `public/ship-journey.js`.
- K4: 3. Names mostly say what a thing does (`pollAction`, `resolveCaption`, `createTimelineRefresher`), but one concept goes by several names (`urlKey`, `workspaceUrlKey`, `ws`; run, session, loop) and `sess-run--expanded` is reused as the open marker for task stages in `public/task-page.js`.
- Code mean: 3.0

Note
- M1: 4. Most lessons name the action and the reason, such as the poll discipline and the `{ module }` ordering entry, though several rest on ticket numbers and review documents the reader cannot open.
- M2: 3. Each entry names its file and what is waiting, but several give no reason for not scheduling, including the `public/brief.js` duplicate, the `public/prompt-section.js` unconfigured-server case and the `public/llms.txt` entry.
- Note mean: 3.5

Where I could not tell: the note's format rules (README.md) and the tickets and review documents it cites (LIN-4446, LIN-4358, the review files); `public/common.js`, `public/close-out.js`, the `lib/` modules and the window globals such as `taskPageHref` and `computeTimelineZoom`, so I could not check the mirrored copies or the calls against their source; whether the close-out code in `public/session.js` runs alongside `window.CloseOut` from `public/close-out.js`; and `public/observation.js`, so I could not check the note's comment count.
```

Pass B: code raw mean 3.0; note mean 3.5.

## Area summary

| | Code | Note |
| --- | --: | --: |
| Pass A | 3.25 (reported 3.3) | 4.0 |
| Pass B | 3.00 | 3.5 |
| **Area** | **3.125** | **3.75** |

- **Noise guard:** the passes' code means differ by 0.25, under 1.0, so the read is decided.
- **Control:** this read is the browser's before-read. Its control is `auth-accounts-and-workspaces` at the same commit, in [auth-accounts-and-workspaces-c205190fd.md](auth-accounts-and-workspaces-c205190fd.md).

## Contamination check

| Pass | Tool calls | Tools used | Inside own inputs? |
| --- | --: | --- | --- |
| A | 12 | Read 10, Bash 2 (`wc -l` on own inputs file) | yes; the Bash calls are the deviation recorded in the adoption file, section 2 item 7 |
| B | 12 | Read 12 | yes |
