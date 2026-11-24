# Front end: server-rendered pages

Area notes for `front-end-pages` in the registry. Format and rules: README.md.

## Lessons

- A control a page renders per row (a select or input in each Settings row) needs its own accessible name: a `<label>`, `aria-label` or `aria-labelledby`. A placeholder or a visible word beside it is not enough. Settings › Models renders 86 unnamed controls, one set per job row (Design & Interface Review, 8 Nov 2026; `lib/render-settings.js`, `docs/reviews/design-interface-review-2026-11-08.md`).
- The task page carries money (LIN-4405). A guest sees none: the guest route strips the timeline with `withoutSpend`
  (`lib/task-timeline.js`, a copy, since the page result is cached), and `lib/render-task-timeline.js` never puts a cost
  in an attribute. Any new figure on the page goes through the same strip, and the three-response guest test
  (`tests/unit/task-timeline-page.test.js`) is the gate.
- The task page's desktop grid (`public/task-page.css`, ≥1024px) places every child by `grid-area`. A new section needs
  its own area in the template, or it renders at the top of the page (LIN-4405).
- A landing band (`lib/render-landing.js`) is named in more places than its renderer: its `data-testid`, its `.lx-*` classes in `public/landing.css`, the unit and e2e specs, the test-id list in `public/llms.txt`, `docs/architecture/source-map.md`, `docs/architecture/ui-pieces.md` and the `landing` baselines in `tests/screenshots/pages/`. When a band changes, grep its old name in comments too. LIN-4487's first pass left two comments naming the removed band (`tests/e2e/landing.spec.js`, `public/landing.css`).
- An open question record reaches a page through one reader, `openQuestionsFor` (`lib/open-questions.js`), and one card,
  `renderQuestionRecordCard` (`lib/question-record-card.js`); a new surface uses both and loads `public/question-records.js`
  as a module, never a second card or handler (LIN-4532). A question's `in` is its task RECORD id, not the ticket: a page
  keyed by identifier matches on the row's `ticket` (`ticketOfTask` in `lib/records-store.js`). LIN-4532's first pass
  filtered the task page on `taskId` against `LIN-n` and matched nothing.
- On Home a question card is a `.waiting-question` wrapper, the live merge's unit (`public/waiting-merge.js`, LIN-4549; the
  `.waiting-card` branches are gone). The merge keys a wrapper by its card's question id and takes out one the fragment no
  longer lists unless the one keep-a-card rule holds it (`public/question-records.js` holdsCard), so a refresh never takes out a
  card the person is answering. The card draws its own task line (`lib/question-record-card.js` questionTaskLine): a host passes
  its `taskHref` and any state words, never a second line of its own. Home passes none: its header says "Waiting on you"
  once (LIN-4552). A state word anywhere else comes from `STATE_WORDS` (`lib/task-state.js`), never spelled per page.
- Retiring a page widget, grep `public/` and `lib/` for every class and test id it drew before deleting a rule: another
  surface may borrow it, and a borrowed name then says the wrong thing. The prompt section drew the recap widget's
  `.recap-spinner` and `.recap-error`, and the task page's owner signal (`public/task-page.js`) was a marker named
  for the brief/recap widgets; LIN-4537 renamed them (`.spinner`, `.prompt-error`, `task-page-owner-marker`) and folded
  the Context section's identical `.context-spinner` into `.spinner`, so one rule draws every loading spinner.
