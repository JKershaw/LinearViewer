# Area read: Front end: browser code @ 0cf05ce8f (after, LIN-4463)

The after-read of the work area, made with the frozen kit ([area-read.md](../area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and the frozen reader prompt ([area-read-reader-prompt.md](../area-read-reader-prompt.md), blob `ef1c2ca9173831f53ca32b60da1d805d27bf2159`). Adoption, sample and verdict are in [area-read-adoption-0cf05ce8f.md](../area-read-adoption-0cf05ce8f.md). The before-read is [front-end-browser-c205190fd.md](front-end-browser-c205190fd.md).

## Recorded fields

| Field | Value |
| --- | --- |
| Area | Front end: browser code (`front-end-browser`), the work area |
| Base commit | `0cf05ce8f` (LIN-4472 squash on `main`; the reads use git objects at this commit, so the note fixes this ticket makes are not in this read) |
| `docs/areas/areas.json` blob | `db8851b97ab0294c2b121006823b38b6159a8940` |
| Kit blob | `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` |
| Reader prompt blob | `ef1c2ca9173831f53ca32b60da1d805d27bf2159` |
| Note | `docs/areas/front-end-browser.md`, blob `00261bbc2076db89f6619dd34d75547ca68d151a`, 8,296 B |
| Universe | 44 files, 1,659,313 B |
| N | 14 (frozen) |
| Sample | 14 files, 358,690 B; two blobs changed from `c205190fd` (`public/cost-format-global.js`, `public/task-page.js`), see the adoption file, section 3 |
| Bundle | note plus sample, 367,378 B, built from git objects at `0cf05ce8f` |

## Passes

Two passes, each a fresh general-purpose agent. Each pass's output is verbatim.

### Pass A

```
Code
- K1: 4. File names and each file's header comment name its surface (chat, dispatch, live console, task page, session), so the file to open for a behaviour is usually evident. Cited: public/task-page.js, public/live-console.js
- K2: 3. Many rules point back to one authority, such as the server-rendered decision panel and the halt disclaimer read from the DOM, but the duration wording is spelled in `public/live-console.js` and `public/session.js`, and the decision-lifecycle kind filter is repeated in `public/dispatch.js` and `public/session.js`.
- K3: 4. Most functions, such as `createPoller`, `pollAction`, `chooseFoldAnchor` and `appendOptions`, can be understood from the code in front of them, though several call window globals defined in files not given.
- K4: 3. Names like `resolveCaption`, `isReadOnlyDisposition` and `createTimelineRefresher` carry their meaning, but one concept has several names, as `formatElapsed` in `public/session.js` and `fmtDuration` in `public/live-console.js` both express the same duration rule.
- Code mean: 3.5

Note
- M1: 4. Most lessons state the rule, the reason, and the test or file that enforces it, such as the `SHARED_MODULES` allow-list and the flat `public/` layout, though a few (the `{ module }` placement line, for one) state a fact rather than an action.
- M2: 4. Most waiting entries name the file, the blocker (a non-leaf import, a page not yet a module, a pending survey) and a ticket, though the `public/llms.txt` and `public/prompt-section.js` entries describe a problem without saying why it is unscheduled.
- Note mean: 4.0

Where I could not tell: the notes' cited files and tests (`lib/time-words.js`, `lib/vendor-assets.js`, `tests/unit/*`, `CLAUDE.md`, `README.md`, `docs/reviews/*`, `docs/papers/*`) are not in the bundle, so their claims are unchecked. Window globals such as `api`, `escapeHtml`, `relativeTime`, `taskPageHref`, `runPageHref`, `computeFitZoom`, `PromptSection`, `CloseOut`, `TaskChat` and `QuestionCards` are defined in files not given, so I could not confirm their signatures. `public/observation.js` and `public/common.js` are referenced but not provided, so the line-count and merge-rule claims are unverified.
```

Pass A: code raw mean 3.5; note mean 4.0.

### Pass B

```
Code
- K1: 4. File names and module headers say what each page script covers, so most behaviours can be traced to a file from the names alone (`public/task-page.js`, `public/proxy.js`), though a shared helper such as `public/chat.js` takes a closer read to place.
- K2: 3. Some rules have one home, such as the halt disclaimer read from one server node and the 404 meaning in `goneHandlerFor`, but the duration wording is spelled in three files and the read-only rule and status-pill markup are restated as client mirrors (`public/session.js`, `public/live-console.js`).
- K3: 3. Most functions read on their own, but many call `window.*` globals and depend on server-rendered `data-testid` hooks defined elsewhere, and `init` in `public/task-page.js` mixes several concerns.
- K4: 3. Names and comments usually say what and why (`createTimelineRefresher`, `isReadOnlyDisposition`), but one concept is spelled two ways (favourite/favorite in `public/dispatch.js`, and `formatElapsed`/`fmtDuration`) and the comments lean heavily on ticket numbers (`public/session.js`).
- Code mean: 3.3

Note
- M1: 4. Most lessons say what to do and why, such as keeping `public/` flat, reading a bridge global only from a handler, and testing a converted page with `importWorld`, though several are dense with ticket references and a few state a fact without a clear action.
- M2: 3. Most waiting entries name the file and the blocker (the `SHARED_MODULES` leaf rule, the classic-script dependency), but the `public/llms.txt` and `public/prompt-section.js` entries say what is wrong without saying why the fix is not scheduled.
- Note mean: 3.5

Where I could not tell: the note cites files that are not in the bundle (`public/common.js`, `public/close-out.js`, `public/observation.js`, `lib/time-words.js`, `lib/vendor-assets.js`, and the tests), so I could not check its counts (1,985 of 4,679 comment lines) or its claims about shared modules. `window.api`, `window.renderMarkdown` and `window.computeTimelineZoom` are defined outside the bundle, so I could not check how they behave.
```

Pass B: code raw mean 3.25 (reported 3.3); note mean 3.5.

## Area summary

| | Code | Note |
| --- | --: | --: |
| Pass A | 3.5 | 4.0 |
| Pass B | 3.25 (reported 3.3) | 3.5 |
| **Area** | **3.375** | **3.75** |

- **Noise guard:** the passes' code means differ by 0.25, under 1.0, so the read is decided.
- **Control:** the control at the same commit is in [auth-accounts-and-workspaces-0cf05ce8f.md](auth-accounts-and-workspaces-0cf05ce8f.md).

## Contamination check

| Pass | Tool calls | Tools used | Inside own inputs? |
| --- | --: | --- | --- |
| A | 14 | Read 14 | yes |
| B | 16 | Read 16 | yes |
