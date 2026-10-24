Scope: where each shared UI decision Settings stands on lives (its one owner), how to count its sites, and what the Settings untangle series (LIN-3886) will delete or keep. Written at base `a32c14a3` (LIN-3887, "Own"); read by LIN-3888 (Free the seam), LIN-3889 (Consolidate) and LIN-3890 (Rebuild).

# UI pieces: who owns each shared decision

This is a note, not code. Nothing under `public/`, `lib/`, `routes/` or `server.js` changed to write it, and `scripts/code-shape/areas.json` still files all of `public/` under one area, so the ownership of CSS lives **here**, not in the area map.

Method: Theseus (`docs/theseus-method-long.md`, sections 5 and 13). This move only **owns**: it decides and writes down. Consolidate (LIN-3889) deletes the losing copies. Rebuild (LIN-3890) designs the Settings pieces in `/styleguide` first, then rebuilds Sources, Health and Account on them.

## The rule

A decision belongs to the area that would have to change if its rule changed. It has three homes:

1. **Tokens** go in `:root` in `public/style.css` (themes override them in `.theme-dark`).
2. **Each shared component's style** goes in one place, with its markup in `lib/components/`. Extend or rebuild what is there instead of adding a third system.
3. **Page CSS keeps only page layout.**

Earlier convergence already gave sections, page headers and fields a canonical home (LIN-461, LIN-462, LIN-463; comments at `style.css:3060-3133`). Build on that. Today the Settings shell (`lib/render-settings-shell.js`) imports nothing from `lib/components/`: its row, group, note and ask builders are local to it.

**Counting.** A *site* is one place that writes the decision's rule itself. A use of the authority (a `var(--space-2)`, a class name in markup) is not a site. Each row below states its own counting rule, the sites at base by `file:line`, the copies Consolidate deletes, any deliberate variant, and each difference between copies with a provisional class: **fix** (a bug or drift), **variant** (deliberate, named), **harmless**, or **unclear**.

## Measures at the series base

Rules are written in the header of `tests/measures/css-measures.mjs`. Rerun on any commit (reads committed git objects, exits 0 whatever the numbers are, not part of `npm test`):

```
node tests/measures/css-measures.mjs . a32c14a3                 # the five measures
node tests/measures/css-measures.mjs . a32c14a3 --dup-blocks    # rule bodies repeated across files
node tests/measures/css-measures.mjs . a32c14a3 --sites         # every literal spacing declaration, file:line
node --test tests/measures/css-measures.test.mjs                # the script's own tests
```

| Measure | Rule | At `a32c14a3` |
| -- | -- | -- |
| CSS lines | `wc -l` over `public/*.css`, top level only | **19,888** lines in 34 files (4,399 in `style.css`) |
| Spacing, literal | strip comments; `padding*`, `margin*`, `gap`, `row-gap`, `column-gap` declarations whose value, with `var(...)` removed, still holds a non-zero length in px, rem, em, %, vh, vw or ch | **904** of 1,767 declarations (843 if `ch`-only values are left out) |
| Spacing, token | the value contains `var(--space-` | **676** (58 declarations are both) |
| Distinct font sizes | distinct trimmed `font-size` values, comments stripped | **74** distinct in **810** declarations; 3 `--font-size-*` tokens |
| Button-like classes | distinct class names in `public/*.css` selectors containing `btn` or `button` | **37** |
| Breakpoints | distinct px values of `min-width`/`max-width` in `@media` preludes | **13** (400, 480, 560, 600, 640, 641, 720, 760, 900, 960, 1024, 1040, 1280) |

The parent ticket (LIN-3886) said "about 860" literal and "33" button classes, from a rule it never wrote down; the written rules give 904 and 37. From now on the series uses these rules. **The Rebuild PR reports against this base.**

Per-width breakpoint counts (`@media` preludes, all files): 640 is used 19 times in 14 files, 400 seven times, 480/600/641 six times each, 720 four, 760 and 900 twice, and 560, 960, 1024, 1040, 1280 once each.

## How the set of decisions is bounded

The class is "a rule written in 2 or more places that Settings shares". Two reproducible bounds:

1. `css-measures.mjs --dup-blocks` at `a32c14a3` finds **35** rule bodies of 4 or more declarations repeated byte-identically in 2 or more files. The plan predicted about 36; the actual count is 35, and nothing was trimmed to match. Mapping:
   - **In the decision set (6 bodies):** #5 `.settings-link` (`audit.css:82`, `settings.css:105`) → *Link*; #6 `.settings-subtitle` / `.page-header__subtitle` (`settings.css:184`, `style.css:3114`) → *Note*; #10 the key/value row (`dispatch.css:19`, `proxy.css:104`, `settings.css:45`, `style.css:3133`) → *Key/value row*; #19 the back link (`session.css:22`, `task-create.css:20`, `task-edit.css:29`) → *Back link*; #23 the text control (`audit.css:101` `.model-select`, `common-actions.css:64` `.token-label-input`, `settings.css:126` `.model-select`) → *Text control*; #26 the group title (`audit.css:27` `.settings-header`, `style.css:3087` `.section .section-header`) → *Group title*.
   - **Settings shares nothing with them (29 bodies), so out of scope:** #1 next-run/prompt dispatch button, #2 and #3 markdown code and blockquote (`style.css`, `task-edit.css`), #4 collective/task-chat warning, #7 task create/edit select, #8 task status, #9 flight-companion/passage-planner actions, #11 and #12 session headers, #13 KPI empty chart, #14 and #15 context lanes, #16 task create/edit actions, #17 and #18 popover/transcript heads, #20 experimental banners, #21 and #24 task form label/cancel, #22 session summary, #25 session/task section headers, #27 collective/task-chat input, #28 observation/ship-biscuit date lines, #29 KPI toggle, #30 sessions refresh, #31 and #32 session/task hint and h1, #33 prompt boxes, #34 task create/edit submit, #35 session/task headers. None of those files is loaded by a Settings page.
2. The `.settings-*` class list in `settings.css` (53 distinct class names) against the decisions below. Every class lands in a row: frame (`shell`, `pane`, `back`, `area-title`, `main`), nav (`nav*`, `state*`, `dot`, `chevron`), group (`group*`, `rows`), row (`row*`, `form`, `inline-form`), ask (`ask*`, `newkey-*`, `action-*`, `undo`), note (`note`, `flash*`, `subtitle`), link (`link`), and the legacy Models-body names (`section`, `header`, `label`, `value`, `segmented`, `theme-choice`), which belong to LIN-3855 and stay.

**Additions the sweep confirmed** beyond the ticket's starting table: *Link*, *Back link*, *Text control*. **Candidates dropped, with the reason:** the focus ring and the radius. Neither is written as a repeated body at base (`--radius-sm/md/full` are tokens; each control states its own `:focus`, and those differ, listed under *Text control*), so they are not a decision with two writers yet.

## The decisions

### 1. Spacing scale

- **Decides:** the spacing steps for padding, margin and gap.
- **Authority:** `--space-1` … `--space-5`, `style.css:66-70` (0.25, 0.5, 1, 1.5, 2 rem). Home 1 (tokens).
- **Reason:** a token layer exists and 676 declarations already use it; the other 904 are the drift.
- **Counting rule:** a site is a spacing declaration (rule above) that writes a literal length. A `var(--space-N)` is a use.
- **Sites at base:** 904 across `public/*.css`; list with `--sites`. In the files Settings shares pieces with: `settings.css` 7 (lines 48, 49, 433, 629, 663, 701, 830), `audit.css` 5 (32, 38, 39, 328, 360), `common-actions.css` 6 (14, 94, 95, 131, 185, 282), `proxy.css` 16 (16, 32, 33, 48, 107, 108, 119, 136, 162, 163, 258, 271, 340, 383, 393, 399), `dispatch.css` 22, `style.css` 163.
- **Consolidate deletes:** literals that equal a token step (0.25/0.5/1/1.5/2rem) become the token. The rest are not deleted by this series.
- **Differences:** the scale has no 0.75rem, 0.4rem, 0.7rem or 0.8rem step, yet the row rules use them (`.settings-row` padding `0.7rem 0.8rem`, `settings.css:696`; the key/value row `gap: 0.75rem; padding: 0.4rem 0`). Class: **unclear** (Rebuild decides whether to add steps or move rows onto existing ones; not decided here).
- **Variant:** none named.

### 2. Type sizes

- **Decides:** the font sizes.
- **Authority:** `--font-size-sm/base/lg`, `style.css:97-99` (0.85em, 1em, 1.25em). Home 1. Body is `16px` (`style.css:292`), `13px` at `max-width: 400px` (`style.css:1981-1985`).
- **Reason:** same as spacing: the tokens exist, usage lags.
- **Counting rule:** a site is a `font-size` declaration (rule above). A `var(--font-size-*)` is a use.
- **Sites at base:** 810 declarations, 74 distinct values. The most: `style.css` 128, `observation.css` 71, `swipe.css` 61, `roadmap.css` 44, `session.css` 44. Settings-shared files: `settings.css` 31 (9 distinct), `dispatch.css` 25 (7), `audit.css` 22 (7), `proxy.css` 21 (4), `common-actions.css` 11 (5).
- **Consolidate deletes:** nothing by count; a literal that equals a token (0.85em, 1em, 1.25em) becomes the token.
- **Differences:** `em` and `rem` values mix (`0.85em` on `.settings-state`, `0.85rem` on `.toggle-btn`, `settings.css:647`, `:429`). Class: **unclear**. Group and area titles use `1.2em` (`settings.css:25`, `:599`), `0.8em` and `0.75em` (below).
- **Variant:** none named.

### 3. State colours and their meaning

- **Decides:** which colour says ok / running / bad / idle, in light and dark.
- **Authority:** the status palette in `:root` (`style.css:20`; `--green` :27, `--red` :31, `--brand` :118, `--amber` :128, `--red-dim` :130, each with a `-dim` text companion), overridden by `.theme-dark` (`style.css:215`).
- **Counting rule:** a site is a raw colour literal (hex or `rgb[a]()`) in a rule instead of a token.
- **Sites at base:** `settings.css` 4 (443, 509, 524, 839; two are fallbacks `var(--red, #c0392b)`, one is `var(--bg, #fff)`), `proxy.css` 1, `common-actions.css` 1 (162), `dispatch.css` 0, `audit.css` 0, `style.css` 101 (mostly the token definitions themselves).
- **Variant (named, deliberate):** the landing's own dark copy under `prefers-color-scheme` (`style.css:2335`, `body.is-landing`). Its comment says this is deliberate; `/styleguide` follows the same media-query palette, which is why the judge emulates both the cookie and the media query.
- **Consolidate deletes:** the hex fallbacks in `settings.css` (509, 524, 839) once the token is guaranteed.
- **Differences:** Settings' sidebar states have only two tones, `ok` and `bad` (`lib/settings-areas.js` `ok`/`bad`; `render-settings-shell.js:132`; `settings.css:647-662`), so **Paused shows red** next to Stopped. Class: **unclear**.
- **Open question 1** (below): whether paused gets its own tone.

### 4. Breakpoints

- **Decides:** the widths where layouts change.
- **Authority:** a **written list**, because custom properties do not work in `@media`: this note's list is the authority. Settings' two widths are 760px (`settings.css:853`, the area list/page switch) and 640px (`settings.css:542`, the row wrap).
- **Counting rule:** a site is an `@media` prelude with a `min-width` or `max-width` in px. One prelude with two widths counts under each.
- **Sites at base:** 13 distinct widths, per-width counts above (`--` per file in the script's JSON). `640` is in 14 files; `760` only in `settings.css` and `landing.css`.
- **Consolidate deletes:** nothing yet. A pinning test (the list as data) belongs to Consolidate, not here, because adding one under `tests/unit` would put new code into the suite.
- **Differences:** 640 and 641 sit side by side (`641` is the complement of `max-width: 640px` in 5 files). Class: **harmless**. 760 versus 640 inside Settings: **unclear** (two thresholds for one shell; Rebuild decides).
- **Variant:** none named.

### 5a. Key/value row

- **Decides:** the label-plus-value line (flex, `gap: 0.75rem`, `padding: 0.4rem 0`, content face, `0.9em`).
- **Authority:** `.field` (`style.css:3133`) with `.field-label` / `.field-value` (`lib/components/field.js`). The LIN-461/462/463 convergence comments at `style.css:3060-3133` name fields as canonical.
- **Reason:** it is the component home; the other three say in their own comments that they are the same rule.
- **Counting rule:** a site is a rule whose body is that byte-identical declaration block (`--dup-blocks` body #10).
- **Sites at base (4):** `style.css:3133` `.field` (the authority), `dispatch.css:19` `.dispatch-section .line`, `proxy.css:104` `.proxy-section .line`, `settings.css:45` `.settings-section .line`.
- **Consolidate deletes:** the three `.X-section .line` blocks.
- **Same-name collision, not a copy:** the dashboard tree's own `.line` (`style.css:1222`, and the phone override at `:1931`) is a different rule (`align-items: baseline`, `padding: 4px 0`). It is scoped to the tree in intent and **harmless**, except that new Settings rows also carry the class `line` (`render-settings-shell.js:37`, `render-settings-workspace.js:20`, `render-settings-you.js:144`), so the bare `.line` at `style.css:1222` also matches them. Class: **unclear**; Rebuild must drop the `line` class from Settings rows or scope the tree rule.
- **Differences:** the three `.X-section .line` copies wrap at 640px and `.field` does not (`dispatch.css:486`, `proxy.css:424`, `settings.css:543`, each `flex-wrap: wrap`). Class: **fix** (provisional): a field row that cannot wrap overflows on a phone; give `.field` the wrap. Not changed here.
- **Variant:** `.dispatch-prompt-line { align-items: flex-start }` (`dispatch.css:28`), kept as a named variant.

### 5b. Interactive row

- **Decides:** the tappable row inside a group: switch, drill, action, ask.
- **Authority:** `.settings-row` (`settings.css:696`) and its builders `switchRow` (`render-settings-shell.js:34`), `drillRow` (:51), `actionRow` (:70), with `group` (:93), all in `lib/render-settings-shell.js`.
- **Reason:** LIN-3846 built it for exactly this and every Settings area uses it.
- **Counting rule:** a site is a row builder or a hand-written `<... class="settings-row ...">` in `lib/`.
- **Sites at base:** the three builders; hand-written rows at `render-settings.js:866` (`settings-row settings-row-drill`) and `render-settings-workspace.js:20` (`staticRow`), `render-settings-you.js:144-147` (a switch written out by hand).
- **Consolidate deletes:** the hand-written copies at `render-settings-you.js:144-147` and `render-settings.js:866`, replaced by the builders.
- **Differences:** `.settings-row` has its own spacing (`0.7rem 0.8rem`) and size (`0.95em`) that match neither the scale nor `.field`. Class: **variant** (a row in a card is not a bare field), recorded here as the named variant "row in a card".
- **Variant:** `settings-row-static` (a read-only row), `settings-row-drill`, `settings-row-action`, `settings-row-switch`.

### 6. Button

- **Decides:** how a button looks.
- **Authority:** the `.btn` family: `.btn`, `.btn--primary`, `.btn--ghost` (`style.css:3323-3363`), markup in `lib/components/button.js`.
- **Reasons:** `.action-btn` (`common-actions.css:11-53`) has no fill or border without a variant (`.save`, `.connect`, `.disconnect`/`.logout`), and three page sheets restyle it (`dispatch.css:478`, `flight-companion.css:369`, `proxy.css:354`; `audit.css`, `session.css` and `settings.css` only mention it in comments). `lib/components/` is the home the earlier convergence gave components. This is a doc-level choice that can be reversed, so it is stated with its reason and not escalated.
- **Cost, recorded:** `.btn` has **one production caller**, `lib/render-styleguide.js:25`. `action-btn` appears in **24 JS files** under `lib/` and `public/`.
- **Counting rule:** a site is a rule that gives a button its own box (background, border, padding, radius). Restyling a button from a page sheet counts.
- **Sites at base:** 37 button-like class names (list via the script's `buttonClasses.names`). The `.btn` family 3 (+ `btn__icon`), `action-btn` 1, `toggle-btn` 1 (Switch), `token-copy-btn`, `icon-btn*`, plus per-feature ones (`fc-start-btn`, `ship-mode-btn`, `roadmap-generate-btn`, ...).
- **Consolidate deletes:** the page-sheet restyles of `.action-btn` (`dispatch.css:478`, `flight-companion.css:369`) once callers move; `.action-btn`'s variants map onto named `.btn` variants first.
- **Variants to map:** `action-btn.save` (green), `.connect` (blue), `.disconnect`/`.logout`/`.token-revoke` (red), and Settings' `settings-action-teal` / `settings-action-red` tones.
- **Differences:** `.btn` is a bordered 32px control, `.action-btn` a chromeless tinted label. Class: **unclear**; this is a design decision for Rebuild's `/styleguide` step.

### 7. Switch

- **Decides:** an on/off control.
- **Authority:** `.toggle-btn` (`settings.css:429-456`) with `switchRow` (`render-settings-shell.js:34`). `.feature-toggle` (`settings.css:417`) and `.feature-toggle-label` (:421) are the row wrapper, so they stay under *Interactive row*.
- **Counting rule:** a site is markup that writes `class="toggle-btn"`.
- **Sites at base (2):** `render-settings-shell.js:37-42` (the builder) and `render-settings-you.js:144-147` (a hand-written copy with an extra `settings-json-toggle` class). The sweep found no other switch in `lib/` or `public/`.
- **Consolidate deletes:** the hand-written copy.
- **Differences:** `.toggle-btn` carries its own hover (`rgba(0,0,0,0.03)`, `settings.css:443`, which does not rebind in dark). Class: **fix** (provisional).
- **Variant:** none named.

### 8. Asking in place (confirming a change)

- **Decides:** how a change is confirmed. **Decided by John on 24 October: confirmation happens in place.** See "Decisions made".
- **Authority:** `askInPlace` (`render-settings-shell.js:106`) and `.settings-ask*` (`settings.css:741-766`). The confirm is a bare `.action-btn`.
- **Counting rule:** a site is a `askInPlace(...)` call, or a hand-written ask form.
- **Sites at base:** the builder, and calls at `render-settings-workspace.js:57` (halt), `:67` (periodic reviews), `render-settings-shell.js` `changeRow` undo (`render-settings-workspace.js:181`).
- **Consolidate deletes:** nothing here. `docs/ui-divergences.md` needs updating to match; **Consolidate makes that edit** (this PR does not touch it).
- **Differences:** the confirm is a bare `.action-btn` and so inherits Button's open question. Class: **unclear**.

### 9. Note

- **Decides:** secondary text under or beside a row or group.
- **Authority:** `groupNote` (`render-settings-shell.js:84`) with `.settings-note` (`settings.css:791`) for notes under a group.
- **Counting rule:** a site is a rule styling small secondary text: `.settings-row-note`, `.settings-note`, `.settings-group-subtitle`, `.settings-subtitle`, `.page-header__subtitle`.
- **Sites at base:** `.settings-row-note` (`settings.css:716`, 0.85em, block), `.settings-note` (`settings.css:791`, 0.85em, margin-top), `.settings-group-subtitle` (`settings.css:33`, 0.9em), `.settings-subtitle` (`settings.css:184`, byte-identical to `.page-header__subtitle`, `style.css:3114`; `--dup-blocks` #6), `.page-header__subtitle`.
- **Consolidate deletes:** `.settings-subtitle` (a copy of the page-header subtitle; emitted at `render-settings.js:319, 468, 587, 831, 862`).
- **Differences:** `0.85em` for notes against `0.9em` for subtitles is two sizes for one idea. Class: **unclear**.

### 10. Group title

- **Decides:** the heading over a group of rows.
- **Authority:** `.settings-group-title` (`settings.css:675`, 0.8em, uppercase, letter-spacing 0.05em) via `group()` (`render-settings-shell.js:93`) for Settings; `.section .section-header` (`style.css:3087`) for sections elsewhere.
- **Reason:** these are two real heading styles for two shapes (a card of rows versus a boxed section); both keep an owner.
- **Counting rule:** a site is a rule styling a heading over a group.
- **Sites at base:** `.settings-group-title` (`settings.css:675`), `.settings-nav-title` (`settings.css:610`, 0.75em, 0.06em), `.settings-group-header` (`settings.css:25`, 1.2em, legacy Models body), `.settings-header` (`audit.css:27`, byte-identical to `.section .section-header`; `--dup-blocks` #26), `.section .section-header` (`style.css:3087`).
- **Consolidate deletes:** `audit.css:27` `.settings-header` (a byte copy). `.settings-header` is also kept as a test hook in `settings.css` comments (`settings.css:9-13`); LIN-3888 frees that.
- **Variant (named):** the sidebar title `.settings-nav-title` (0.75em/0.06em) against `.settings-group-title` (0.8em/0.05em): two near-equal sizes. Class: **unclear** (a probable drift; Rebuild picks one).

### 11. Key row

- **Decides:** one issued key in a list.
- **Authority:** `keyRow` (`lib/render-settings-workspace.js:95`), built on `drillRow`.
- **Reason, and why this is not an open question:** the ticket named the token list shared by Proxy and Dispatch (`common-actions.css:92-152`) as a second claimant. At base **nothing emits it**: `.token-list`, `.proxy-token-list`, `.token-item`, `.token-info`, `.token-label-text`, `.token-meta` and `.token-revoke` appear in no file under `lib/`, `public/*.js`, `routes/` or `server.js` (`git grep` returns only CSS, tests and docs). Only `.token-ownerless` (`proxy.js:270`) is live, plus the mint form and modal (`token-form`, `token-modal`, `token-copy-btn`, `token-display`, `token-usage-hint`, `token-label-input`). So Settings' `keyRow` is the only live key row.
- **If this reading is wrong** (a runtime emitter built by string concatenation that the grep cannot see), `keyRow` still stands and the list becomes **open question 2**.
- **Counting rule:** a site is a rule or builder that renders one key.
- **Sites at base:** `render-settings-workspace.js:95` (live); `common-actions.css:92-152` (no emitter); tests naming the dead classes: `tests/e2e/dispatch-page.spec.js`, `tests/e2e/proxy.spec.js`, `tests/e2e/settings.spec.js`, `tests/unit/lin-2370-browser-copy-prompt-provider-identity.test.js`, `tests/unit/lin-3131-runner-settings-render.test.js`, `tests/unit/run-controls-render.test.js` (LIN-3888 must check whether they assert presence or absence).
- **Consolidate deletes:** the seven dead token-list rules, once LIN-3888 has moved the tests that name them.

### 12. Area page frame

- **Decides:** the layout around one Settings area.
- **Authority:** `renderSettingsShell` (`render-settings-shell.js:151`), `.settings-shell` and `.settings-pane` (`settings.css:576-590`), `.settings-back` (`settings.css:592`), and the page header (`lib/components/page-header.js`).
- **Counting rule:** a site is a page frame (grid plus pane plus back) written for a page.
- **Sites at base:** the shell above; `settings.css:853` is its only breakpoint.
- **Consolidate deletes:** nothing.
- **Differences:** the pane's `max-width: 600px` (`settings.css:583`) and `.settings-main { max-width: 1000px }` (:848) are two page widths. Class: **unclear** (`.settings-main` is emitted once, at `render-settings.js:996`, by the legacy Models page; LIN-3855 owns it).

### 13. Link

- **Decides:** an inline text link.
- **Authority:** `.settings-link` as written at `settings.css:105`, until Consolidate moves it to a shared home (it is not Settings-specific).
- **Counting rule:** a site is a rule whose body is that link block (`--dup-blocks` #5).
- **Sites at base (2):** `audit.css:82`, `settings.css:105` (byte-identical). Emitted at `render-settings.js:249`.
- **Consolidate deletes:** `audit.css:82`.

### 14. Back link

- **Decides:** the "‹ back" breadcrumb above a page title.
- **Authority:** none yet. **Provisional:** `.sess-back` (`session.css:22`) as the shared body, because three pages already write it byte-identically; `.settings-back` is a different rule.
- **Counting rule:** a site is a rule styling a page's back link.
- **Sites at base (4):** `session.css:22` `.sess-back`, `task-create.css:20` `.task-create-back`, `task-edit.css:29` `.task-edit-back` (byte-identical; `--dup-blocks` #19), `settings.css:592` `.settings-back` (differs: `color: var(--brand-dim)`, `display: none` until 760px, `settings.css:866`).
- **Consolidate deletes:** two of the three identical copies once a shared home is chosen.
- **Differences:** `.settings-back` is brand-coloured and phone-only. Class: **variant** (Settings shows it only when the list is hidden).

### 15. Text control

- **Decides:** a text input or select.
- **Authority:** `.model-select` / `.model-input` (`settings.css:126, 147`) for Settings forms, until Consolidate picks a shared home.
- **Counting rule:** a site is a rule styling a text control with the same body (`--dup-blocks` #23).
- **Sites at base (3):** `audit.css:101` `.model-select`, `common-actions.css:64` `.token-label-input`, `settings.css:126` `.model-select` (byte-identical bodies; a fourth style is `.settings-ask-reason`, `settings.css:760`).
- **Consolidate deletes:** `audit.css:101`.
- **Differences:** `:focus` differs. `.model-select:focus` removes the outline and recolours the border `var(--blue)` (`settings.css:137`); `.token-label-input:focus` uses `:focus-visible` (`common-actions.css:75-81`). Class: **fix** (provisional: removing the outline is an accessibility regression).

### 16. Dispatch's halt controls (decided: keep both)

**Decided by John on 24 October: "Keep both".** Dispatch keeps its own Pause, Stop and Resume; Settings › Running keeps its own. Where both render the controls, they share **one implementation, not copies**.

Today the two surfaces share no implementation, only the halt store and the change-log hook. Surfaces that render or write Pause / Stop / Resume at base:

| Surface | Markup | Client | Route |
| -- | -- | -- | -- |
| Dispatch | `lib/render-dispatch.js:120-123` (server markup, `.halt-form .action-btn`, `dispatch.css:478`) | `public/dispatch.js:835-910` (fetch) | `routes/dispatch.js:776` (GET), `:795` (POST), `:823` (DELETE) at `/workspace/:urlKey/api/dispatch/halt` |
| Settings › Running | `lib/render-settings-workspace.js:57-65` (`askInPlace` forms, owner-only, with a reason) | none (form post) | `routes/settings.js:412` (`POST /settings/running/halt`) |
| Proxy API (writer, no UI) | none | none | `routes/proxy-halt.js:120` (POST), `:155` (DELETE) at `/api/proxy/dispatch/halt` |

"Keep both, one implementation" is therefore a requirement on Consolidate: choose the shared layer (the markup, the route handler, or both) and move both surfaces onto it. The Proxy API is a third writer and is listed so it is not forgotten.

## Page CSS: what it keeps

Layout only. For the pages Settings shares pieces with:

- **Proxy (`proxy.css`):** keeps its section layout, curl examples and event log. Outside layout today: `.proxy-section .line` (key/value row, `proxy.css:104`, **loser**), `.proxy-events-pager .action-btn:disabled` (`proxy.css:354`, a button state belonging to Button).
- **Dispatch (`dispatch.css`):** keeps queue layout, presets and the guide. Outside layout today: `.dispatch-section .line` (`dispatch.css:19`, **loser**), `.halt-form .action-btn { margin-right }` (`dispatch.css:478`, a spacing rule on a button; moves with the halt implementation), the `.line` wrap at 640px (`dispatch.css:486`, **loser**).
- **Audit (`audit.css`):** keeps the dashboard layout. Outside layout today: `.settings-header` (`audit.css:27`, **loser**, a byte copy of `.section .section-header`), `.settings-link` (`audit.css:82`, **loser**) and `.model-select` (`audit.css:101`, **loser**).

## Decisions made

1. **Confirming a change: confirmation in place.** John, asked on 24 October whether LIN-511's native `confirm()` or Settings' ask in place should win: "On the page is best, I think." Authority: `askInPlace` with its confirm and Cancel, as built today. It **supersedes LIN-511's native `confirm()` rule** (`docs/ui-divergences.md`). That doc needs updating to match; Consolidate makes the edit and this PR does not touch it. `tests/unit/render-settings-shell.test.js:88-94` asserts the new Settings code has no `confirm(`; that stays true.

   **Native `confirm()` sites still in the code (follow-up; outside what LIN-3886 migrates unless a site is on a page these tickets already touch).** `docs/ui-divergences.md` lists four sites; the code has the seven below, verified at base:
   - `public/common.js:2737`, the `form[data-confirm]` submit guard (comment at 2734), used by `lib/components/navbar.js:466` to remove a workspace;
   - `public/custom-prompts.js:195`;
   - `public/observation.js:3041` (bulk agree);
   - `public/scan.js:389` and `:424` (retire, unretire);
   - `public/session.js:36` (`window.confirm`);
   - `public/settings.js:212`, deleting a preset (Settings › Models body, left alone until LIN-3855).

2. **Dispatch's halt controls: keep both** (inventory in decision 16).

## Open questions for John

Each keeps today's behaviour until answered.

1. **Does a paused workspace get its own state colour?** Today Settings has two tones, `bad` and `ok`, so Paused shows red like Stopped (`lib/settings-areas.js`, `render-settings-shell.js:132`, `settings.css:647-662`). Options: (a) keep two tones; (b) add an amber tone using the existing `--amber` / `--amber-dim`. **Recommendation: (b).** Pausing is a deliberate owner action, not a failure, and the palette already carries the meaning (`--amber` is "running", `style.css:128`). Rebuild would add the tone.
2. **Key row** (only if the reading in decision 11 is wrong). Today there is one live key row, so none is open. If a second live emitter turns up, the options are `keyRow` or the token list; the recommendation is `keyRow`, which is built on the Settings row and already carries the owner-only revoke and the expiry.

## For the tickets that follow

- **LIN-3888 (Free the seam):** the tests that pin Settings' CSS are those naming `.settings-*`, `.settings-header`, `.token-*` (decision 11) and `.line`. The judge (`tests/judge/`) shows nothing moved while they are rewritten onto data attributes.
- **LIN-3889 (Consolidate):** each row's "Consolidate deletes" line is its work list; the judge must stay at zero for every deletion that should not change a pixel, and must list a difference where one is intended.
- **LIN-3890 (Rebuild):** report against the measures at the series base above. Open questions 1 and the `unclear` classes are Rebuild's design input.

## The judge

`node tests/judge/visual-replay.mjs --base <rev> --head <rev> [--self-check] [--control]` replays 18 pages and states (15 pages, 3 opened states; Running with no runner is the Running page itself) in light and dark at 1280×900 and 390×844 on two exports of two commits, at zero tolerance. It lives in `tests/judge/`, is not part of `npm test`, and commits no reference images. Its page list, masks (each with its reason) and "not covered" list are in `tests/judge/pages.mjs`.
