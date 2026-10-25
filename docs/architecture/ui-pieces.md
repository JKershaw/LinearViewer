Scope: where each shared UI decision Settings stands on lives (its one owner), how to count its sites, and what the Settings untangle series (LIN-3886) will delete or keep. Written at base `a32c14a3` (LIN-3887, "Own"); read by LIN-3888 (Free the seam), LIN-3889 (Consolidate) and LIN-3890 (Rebuild).

# UI pieces: who owns each shared decision

This is a note, not code. Nothing under `public/`, `lib/`, `routes/` or `server.js` changed to write it, and `scripts/code-shape/areas.json` still files all of `public/` under one area, so the ownership of CSS lives **here**, not in the area map.

Method: Theseus (`docs/theseus-method-long.md`, sections 5 and 13). This move only **owns**: it decides and writes down. Consolidate (LIN-3889) deletes the losing copies. Rebuild (LIN-3890) designs the Settings pieces in `/styleguide` first, then rebuilds Sources, Health and Account on them.

## The rule

A decision belongs to the area that would have to change if its rule changed. It has three homes:

1. **Tokens** go in `:root` in `public/style.css` (themes override them in `.theme-dark`).
2. **Each shared component's style** goes in one place, with its markup in `lib/components/`. Extend or rebuild what is there instead of adding a third system.
3. **Page CSS keeps only page layout.**

Earlier convergence already gave sections, page headers and fields a canonical home (LIN-461, LIN-462, LIN-463; comments at `style.css:3060-3133`). Build on that. Today the Settings pieces live in `lib/components/settings-*.js` (moved there by LIN-3890; at base they were `lib/render-settings-shell.js` and its neighbours). Those files import only shared helpers from outside `lib/components/` (`utils/html.js`, `render.js`, `settings-areas.js`, `model-routing-harnesses.js`) and each other. None imports `section.js`, `field.js`, `page-header.js` or `button.js`, so their row, group, note and ask builders are local to Settings.

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
- **Variant:** two phone roots, one per layout, each at its own breakpoint and both `1rem`, so neither compounds (LIN-3958). `.settings-shell` sets `font-size: 1rem` at `max-width: 760px` (`settings.css`), so rows read 15.2px at 390. `.plain-page` sets `font-size: 1rem` at `max-width: 400px` (`style.css`, the Plain block), so the Plain page holds 16px where the small-phone body would drop to 13px. A `rem` root does not compound. The `/styleguide` Plain sample used to be both `.plain-page` and `.settings-shell`; since LIN-3956 it is `.plain-page` alone. The Plain type step (LIN-3958, decision 17) uses the same tokens: title `1.5rem`, heading `--font-size-lg`, prose `1em`.

### 3. State colours and their meaning

- **Decides:** which colour says ok / running / bad / idle, in light and dark.
- **Authority:** the status palette in `:root` (`style.css:20`; `--green` :27, `--red` :31, `--brand` :118, `--amber` :128, `--red-dim` :130, each with a `-dim` text companion), overridden by `.theme-dark` (`style.css:215`).
- **Counting rule:** a site is a raw colour literal (hex or `rgb[a]()`) in a rule instead of a token.
- **Sites at base:** `settings.css` 4 (443, 509, 524, 839; two are fallbacks `var(--red, #c0392b)`, one is `var(--bg, #fff)`), `proxy.css` 1, `common-actions.css` 1 (162), `dispatch.css` 0, `audit.css` 0, `style.css` 101 (mostly the token definitions themselves).
- **Variant (named, deliberate):** the landing's own dark copy under `prefers-color-scheme` (`style.css:2335`, `body.is-landing`). Its comment says this is deliberate; `/styleguide` follows the same media-query palette, which is why the judge emulates both the cookie and the media query.
- **Consolidate deletes:** the hex fallbacks in `settings.css` (509, 524, 839) once the token is guaranteed.
- **Differences:** Settings' sidebar states have only two tones, `ok` and `bad` (`lib/settings-areas.js` `ok`/`bad`; at base the sidebar was in `lib/render-settings-shell.js:132`; `settings.css:647-662` at base), so **Paused shows red** next to Stopped. Class: **unclear** at base (resolved at head, see open question 1).
- **Open question 1** (below): whether paused gets its own tone. Resolved at head: amber shipped in LIN-3890.

### 4. Breakpoints

- **Decides:** the widths where layouts change.
- **Authority:** a **written list**, because custom properties do not work in `@media`: this note's list is the authority. Settings' two widths are 760px (`settings.css:682`, the area list/page switch) and 640px (the `.field` row wrap at `style.css:3216`; Settings' own 640px rule is the Models phone sheet at `settings.css:834`).
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
- **Consolidate deletes:** the three `.X-section .line` blocks (done, LIN-3889). The 640px wrap moves to `.field`.
- **Same-name collision, not a copy:** the dashboard tree's own `.line` (`style.css:1222`, and the phone override at `:1931`) is a different rule (`align-items: baseline`, `padding: 4px 0`). It is scoped to the tree in intent and **harmless**, except that new Settings rows also carry the class `line` (at base: `lib/render-settings-shell.js:37`, `render-settings-workspace.js:20` and `:188`, `render-settings-you.js:60`, `:80`, `:95`, `:107`, `:115` and `:144`), so the bare `.line` at `style.css:1222` also matches them. Class: **unclear**; Rebuild must drop the `line` class from Settings rows or scope the tree rule.
- **Differences:** the three `.X-section .line` copies wrap at 640px and `.field` does not (`dispatch.css:486`, `proxy.css:424`, `settings.css:543`, each `flex-wrap: wrap`). Class: **fix** (provisional): a field row that cannot wrap overflows on a phone; give `.field` the wrap. Done (LIN-3889): the wrap moved to `.field`, the only place pixels move.
- **Variant:** none. (Corrected by LIN-3889: `.dispatch-prompt-line { align-items: flex-start }` never applied, because the copy's 0,2,0 selector set `align-items` first. It is deleted with the copy, at 0 px.)

### 5b. Interactive row

- **Decides:** the tappable row inside a group: switch, drill, action, ask.
- **Authority:** `.settings-row` (`settings.css:512`) and its builders `switchRow` (`lib/components/settings-row.js:34`), `staticRow` (`settings-row.js:57`), `drillRow` (`settings-row.js:69`) and `actionRow` (`settings-row.js:88`), with `group` (`lib/components/settings-group.js:28`).
- **Reason:** LIN-3846 built it for exactly this and every Settings area uses it.
- **Counting rule:** a site is a row builder or a hand-written `<... class="settings-row ...">` in `lib/`.
- **Sites at base:** the three builders; hand-written rows at `render-settings.js:866` (`settings-row settings-row-drill`), `render-settings-workspace.js:20` (`staticRow`, module-local), `render-settings-workspace.js:177` and `:188` (the change-log rows inside `changeRow`; `:188` is the static one), `render-settings-you.js:60`, `:80`, `:95`, `:107`, `:115` (static rows written out by hand), `render-settings-you.js:110` (an action row written out by hand: `settings-row settings-row-action settings-action-teal`, a copy of `actionRow`) and `render-settings-you.js:144-147` (a switch written out by hand).
- **Consolidate deletes:** the hand-written copies at `render-settings-you.js:144-147`, `render-settings-you.js:110` (replaced by `actionRow`) and `render-settings.js:866`, replaced by the builders. (Partly, LIN-3889: the Theme, Email, Runs and change-log rows keep their own markup minus `line`; see the status table.) The five static rows in `render-settings-you.js` (`:60`, `:80`, `:95`, `:107`, `:115`) and the one at `render-settings-workspace.js:188` are hand-written copies of `staticRow` (`render-settings-workspace.js:20`). **`staticRow` became a shared builder** in `lib/components/settings-row.js:57`, beside `switchRow`, `drillRow` and `actionRow`, and those six are replaced by it (done by LIN-3890): it is the same markup six times over, and a second private copy is how the count got short. The change-log row at `:177` stays a `changeRow` concern.
- **Differences:** `.settings-row` has its own spacing (`0.7rem 0.8rem`) and size (`0.95em`) that match neither the scale nor `.field`. Class: **variant** (a row in a card is not a bare field), recorded here as the named variant "row in a card".
- **Variant:** `settings-row-static` (a read-only row), `settings-row-drill`, `settings-row-action`, `settings-row-switch`.

### 6. Button

- **Decides:** how a button looks.
- **Authority:** the `.btn` family: `.btn`, `.btn--primary`, `.btn--ghost` (`style.css:3393-3433`), markup in `lib/components/button.js`.
- **Reasons:** At base, `.action-btn` (`common-actions.css:11-53`; `style.css:3442` at head) had no fill or border without a variant (`.save`, `.connect`, `.disconnect`/`.logout`), and three page sheets restyle it (`dispatch.css:478`, `flight-companion.css:369`, `proxy.css:354`; `audit.css`, `session.css` and `settings.css` only mention it in comments). `lib/components/` is the home the earlier convergence gave components. This is a doc-level choice that can be reversed, so it is stated with its reason and not escalated.
- **Cost, recorded:** `.btn` has **one production caller**, `lib/render-styleguide.js:25`. `action-btn` appears in **24 JS files** under `lib/` and `public/`.
- **Counting rule:** a site is a rule that gives a button its own box (background, border, padding, radius). Restyling a button from a page sheet counts.
- **Sites at base:** 37 button-like class names (list via the script's `buttonClasses.names`). The `.btn` family 3 (+ `btn__icon`), `action-btn` 1, `toggle-btn` 1 (Switch), `token-copy-btn`, `icon-btn*`, plus per-feature ones (`fc-start-btn`, `ship-mode-btn`, `roadmap-generate-btn`, ...).
- **Consolidate deletes (LIN-3889, strategy A):** the `.action-btn` block in common-actions.css, which is now one selector list per look in style.css, shared with the named tones `.btn--quiet` + `.btn--green/blue/red`. The `.halt-form .action-btn` restyle (`dispatch.css`) and the proxy pager's disabled rule are folded into the shared rules. `flight-companion.css:369` is layout (`flex: 0 0 auto`), not a button box, and stays.
- **Not done (open question 3):** 15 files under `lib/` and `public/` still emit the `action-btn` alias. `render-settings.js` no longer does. They render the same body, so the look is one.
- **Variants to map:** `action-btn.save` (green), `.connect` (blue), `.disconnect`/`.logout`/`.token-revoke` (red), and Settings' `settings-action-teal` / `settings-action-red` tones.
- **Differences:** `.btn` is a bordered 32px control, `.action-btn` a chromeless tinted label. Class: **unclear**; this is a design decision for Rebuild's `/styleguide` step.

### 7. Switch

- **Decides:** an on/off control.
- **Authority:** `.settings-switch` (`settings.css:249`, renamed from `.toggle-btn` by LIN-3889) with `switchRow` (`lib/components/settings-row.js:34`). The row wrapper, `.feature-toggle` and `.feature-toggle-label` (`settings.css:417` and `:421` at base), is gone at head and stays under *Interactive row*.
- **Counting rule:** a site is markup that writes `class="toggle-btn"`.
- **Sites at base (2):** `render-settings-shell.js:37-42` (the builder, `switchRow`; at head `lib/components/settings-row.js:34`) and `render-settings-you.js:144-147` (a hand-written copy with an extra `settings-json-toggle` class). The sweep found no other switch in `lib/` or `public/`.
- **Consolidate deletes:** the hand-written copy.
- **Differences:** `.toggle-btn` carries its own hover (`rgba(0,0,0,0.03)`, `settings.css:443`, which does not rebind in dark). Class: **fix** (provisional).
- **Variant:** none named.

### 8. Asking in place (confirming a change)

- **Decides:** how a change is confirmed. **Decided by John on 24 October: confirmation happens in place.** See "Decisions made".
- **Authority:** `askInPlace` (`lib/components/settings-ask.js:46`) and `.settings-ask*` (`settings.css:557` on). The confirm is `btn btn--primary` (decision 6).
- **Counting rule:** a site is a `askInPlace(...)` call, or a hand-written ask form.
- **Sites at base:** the builder, and calls at `render-settings-workspace.js:57` (halt), `:67` (periodic reviews), `:146` (agents can change models), `:178` (the change-log undo, inside `changeRow`) and `render-settings.js:703` (remove source). One hand-written confirm-in-place: the key revoke, `render-settings-workspace.js:100` (a red `.action-btn` and "cannot be undone" text inside the opened key row, no Cancel, wired by `public/settings.js:313`).
- **Consolidate deletes:** nothing here. `docs/ui-divergences.md` needs updating to match; **Consolidate makes that edit** (this PR does not touch it).
- **Differences:** the confirm is a bare `.action-btn` and so inherits Button's open question. Class: **unclear**.
- **Difference, key revoke:** `render-settings-workspace.js:100` confirms in place without `askInPlace`: the opened key row is the confirmation, there is no Cancel (collapsing the row is the way out) and no `.settings-ask*` markup. It is the same kind of thing as the decision John made, so it sits under the decided "confirmation in place" authority. Class: **unclear**: Consolidate decides whether it moves onto `askInPlace` or stays a named variant.

### 9. Note

- **Decides:** secondary text under or beside a row or group.
- **Authority:** `groupNote` (`lib/components/settings-group.js:10`) with `.settings-note` (`settings.css:620`) for notes under a group.
- **Counting rule:** a site is a rule styling small secondary text: `.settings-row-note`, `.settings-note`, `.settings-group-subtitle`, `.settings-subtitle`, `.page-header__subtitle`.
- **Sites at base:** `.settings-row-note` (`settings.css:716`, 0.85em, block), `.settings-note` (`settings.css:791`, 0.85em, margin-top), `.settings-group-subtitle` (`settings.css:33`, 0.9em), `.settings-subtitle` (`settings.css:184`, byte-identical to `.page-header__subtitle`, `style.css:3114`; `--dup-blocks` #6), `.page-header__subtitle`.
- **Consolidate deletes:** `.settings-subtitle` (a copy of the page-header subtitle; emitted at `render-settings.js:319, 468, 587, 831, 862`). Done (LIN-3889): the emitters use `.page-header__subtitle`.
- **Differences:** `0.85em` for notes against `0.9em` for subtitles is two sizes for one idea. Class: **unclear**.

### 10. Group title

- **Decides:** the heading over a group of rows.
- **Authority:** `.settings-group-title` (`settings.css:485`, 0.8em, uppercase, letter-spacing 0.05em) via `group()` (`lib/components/settings-group.js:28`) for Settings; `.section .section-header` (`style.css:3087`) for sections elsewhere.
- **Reason:** these are two real heading styles for two shapes (a card of rows versus a boxed section); both keep an owner.
- **Counting rule:** a site is a rule styling a heading over a group.
- **Sites at base:** `.settings-group-title` (`settings.css:675`), `.settings-nav-title` (`settings.css:610`, 0.75em, 0.06em), `.settings-group-header` (`settings.css:25`, 1.2em, legacy Models body), `.settings-header` (`audit.css:27`, byte-identical to `.section .section-header`; `--dup-blocks` #26), `.section .section-header` (`style.css:3087`).
- **Consolidate deletes:** `audit.css:27` `.settings-header` (a byte copy). `.settings-header` is also kept as a test hook in `settings.css` comments (`settings.css:9-13`); LIN-3888 frees that.
- **Variant (named):** the sidebar title `.settings-nav-title` (0.75em/0.06em) against `.settings-group-title` (0.8em/0.05em): two near-equal sizes. Class: **unclear** (a probable drift; Rebuild picks one).

### 11. Key row

- **Decides:** one issued key in a list.
- **Authority:** `keyRow` (`lib/components/settings-key-row.js`), built on `drillRow` and `askInPlace`.
- **Reason, and why this is not an open question:** the ticket named the token list shared by Proxy and Dispatch (`common-actions.css:92-152`) as a second claimant. At base **nothing emits it**: `.token-list`, `.proxy-token-list`, `.token-item`, `.token-info`, `.token-label-text`, `.token-meta` and `.token-revoke` appear in no file under `lib/`, `public/*.js`, `routes/` or `server.js` (`git grep` returns only CSS, tests and docs). Only `.token-ownerless` (`proxy.js:270`) is live, plus the mint form and modal (`token-form`, `token-modal`, `token-copy-btn`, `token-display`, `token-usage-hint`, `token-label-input`). So Settings' `keyRow` is the only live key row.
- **If this reading is wrong** (a runtime emitter built by string concatenation that the grep cannot see), `keyRow` still stands and the list becomes **open question 2**.
- **Counting rule:** a site is a rule or builder that renders one key.
- **Sites at base:** `render-settings-workspace.js:95` (live); `common-actions.css:92-152` (no emitter); tests naming the dead classes: `tests/e2e/dispatch-page.spec.js`, `tests/e2e/proxy.spec.js`, `tests/e2e/settings.spec.js`, `tests/unit/lin-2370-browser-copy-prompt-provider-identity.test.js`, `tests/unit/lin-3131-runner-settings-render.test.js`, `tests/unit/run-controls-render.test.js` (LIN-3888 must check whether they assert presence or absence).
- **Consolidate deletes:** the seven dead token-list rules in `common-actions.css` (done, LIN-3889), and the dead `.token-list` rules in `dispatch.css` and `.proxy-token-list` in `proxy.css` (done, LIN-3889: no renderer emits them).

### 12. Area page frame

- **Decides:** the layout around one Settings area.
- **Authority:** `renderSettingsShell` (`lib/components/settings-frame.js:41`), `.settings-shell` and `.settings-pane` (`settings.css:370-385`), `.settings-back` (`settings.css:391`), and the page header (`lib/components/page-header.js`).
- **Counting rule:** a site is a page frame (grid plus pane plus back) written for a page.
- **Sites at base:** the shell above; `settings.css:853` is its only breakpoint.
- **Consolidate deletes:** nothing.
- **Differences:** the pane's `max-width: 600px` (`settings.css:583`) and `.settings-main { max-width: 1000px }` (:848) are two page widths. Class: **unclear** (`.settings-main` is emitted once, at `render-settings.js:996`, by the legacy Models page; LIN-3855 owns it).

### 13. Link

- **Decides:** an inline text link.
- **Authority:** `.settings-link` in `style.css:3157`, moved there by LIN-3889 (it was `settings.css:105` at base, and is not Settings-specific).
- **Counting rule:** a site is a rule whose body is that link block (`--dup-blocks` #5).
- **Sites at base (2):** `audit.css:82`, `settings.css:105` (byte-identical). Emitted at `render-settings.js:249`.
- **Consolidate deletes:** `audit.css:82`. Done (LIN-3889): one rule, `.settings-link`, in style.css.

### 14. Back link

- **Decides:** the "‹ back" breadcrumb above a page title.
- **Authority:** one selector list, `.sess-back, .task-create-back, .task-edit-back` in `style.css` (LIN-3889). `.settings-back` (`settings.css`) is a different rule and stays a named variant.
- **Counting rule:** a site is a rule styling a page's back link.
- **Sites at base (4):** `session.css:22` `.sess-back`, `task-create.css:20` `.task-create-back`, `task-edit.css:29` `.task-edit-back` (byte-identical; `--dup-blocks` #19), `settings.css:592` `.settings-back` (differs: `color: var(--brand-dim)`, `display: none` until 760px, `settings.css:866`).
- **Consolidate deletes:** the three identical page copies (done, LIN-3889: `session.css`, `task-create.css`, `task-edit.css`). The task page's back link reuses `.sess-back`. The judge seeds the task create and edit pages and the not-found session page (which renders the same link); the populated session page is not covered (its run data is not seeded).
- **Differences:** `.settings-back` is brand-coloured and phone-only. Class: **variant** (Settings shows it only when the list is hidden).

### 15. Text control

- **Decides:** a text input or select.
- **Authority:** `.model-select` and `.token-label-input` (`style.css:3187`, one body since LIN-3889).
- **Counting rule:** a site is a rule styling a text control with the same body (`--dup-blocks` #23).
- **Sites at base (3):** `audit.css:101` `.model-select`, `common-actions.css:64` `.token-label-input`, `settings.css:126` `.model-select` (byte-identical bodies; a fourth style is `.settings-ask-reason`, `settings.css:760`).
- **Consolidate deletes:** `audit.css:101`. Done (LIN-3889): one body for `.model-select` and `.token-label-input` in style.css.
- **Differences:** `:focus` differs. `.model-select:focus` removes the outline and recolours the border `var(--blue)` (`settings.css:137`); `.token-label-input:focus` uses `:focus-visible` (`common-actions.css:75-81`). Class: **fix** (provisional: removing the outline is an accessibility regression).

### 16. Dispatch's halt controls (decided: keep both)

**Status (LIN-3889): one implementation.** `lib/components/halt-controls.js` renders both surfaces. Its `buttons` presentation is Dispatch's form, and its `ask` presentation is Settings › Running's asks, with the matching control hidden. The owner gate stays at each call site (LIN-3849). `routes/` is byte-unchanged: both routes keep their own gated write, and the LIN-3383 census still pins them.

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

1. **Confirming a change: confirmation in place.** John, asked on 24 October whether LIN-511's native `confirm()` or Settings' ask in place should win: "On the page is best, I think." Authority: `askInPlace` with its confirm and Cancel, as built today. It **supersedes LIN-511's native `confirm()` rule** (`docs/ui-divergences.md`). That doc needs updating to match; Consolidate makes the edit and this PR does not touch it. `tests/unit/settings-components.test.js` (renamed by LIN-3890 from `render-settings-shell.test.js`) asserts the new Settings code has no `confirm(`; that stays true.

   **Native `confirm()` sites still in the code (follow-up; outside what LIN-3886 migrates unless a site is on a page these tickets already touch).** `docs/ui-divergences.md` lists four sites; the code has the seven below, verified at base:
   - `public/common.js:2737`, the `form[data-confirm]` submit guard (comment at 2734), used by `lib/components/navbar.js:466` to remove a workspace;
   - `public/custom-prompts.js:195`;
   - `public/observation.js:3041` (bulk agree);
   - `public/scan.js:389` and `:424` (retire, unretire);
   - `public/session.js:36` (`window.confirm`);

2. **Dispatch's halt controls: keep both** (inventory in decision 16).

### 17. Plain page

- **Decides:** the layout of a page made of a title, sections, rows, notes, a form and an empty state, with no layout of its own (the LIN-3892 sweep's "Plain" treatment).
- **Authority:** `renderPlainPage`, `renderPlainSections`, `renderPlainDocument` (the document entry, which owns the `settings.css` link) and `plainFormHtml` in `lib/components/plain-page.js`, with `.plain-title`, `.plain-page .section` and `.plain-page.plain-column` rules in `public/style.css`. The pieces it composes keep their own authority: `page-header.js`, `section.js`, `field.js`, `settings-row.js` and `settings-group.js` (`rowsList`, the rows list, and `group()`, its Settings title), `button.js` (the form's submit) and `empty-state.js`. Home 1 for the rules, home 2 for the component.
- **Reason:** the Plain pages would otherwise each invent a sheet. One helper over the shared builders keeps each later Plain page's own sheet near nothing (LIN-3892). LIN-3950 proves it on Legal, the brand shape, and on /styleguide, which shows every section kind in both themes.
- **Counting rule:** a site is a page `<main>` that sets its own title, section and prose rules instead of calling `renderPlainPage` (or `renderPlainSections` inside its own frame).
- **Sites at base:** the `.legal-content` rules (five, `style.css:3679-3706` at head before LIN-3950 removed them), their emitters (`lib/render-legal.js` twice, `lib/render-styleguide.js` once). At head: none. `git grep legal-content -- lib public routes server.js` returns nothing but comments.
- **Consolidate deletes:** the `.legal-content` rules and `legalSection` (done, LIN-3950). The `.sg-intro` `margin-left` undo in `styleguide.css` (done, LIN-3950).
- **Differences (intended, named in the PR):** Legal's section headings take the canonical `.section-header` at the Plain step, so blue goes and the heading is 20px at weight 600 in `--fg` over 16px prose (LIN-3950 had them at 16px, weight 500, with the shared rule; the shared rule is unchanged, and the step is scoped to `.plain-page` and to the direct-child section headings, so the nested "Section component" specimens on `/styleguide` keep the canonical heading). The prose drops its 3ch indent. LIN-3958 adds the rest of the Plain look, all scoped to `.plain-page`: unclassed prose (paragraphs, the items of unclassed lists, the terms of unclassed definition lists) is the sans face in `--fg-dim`, so one Plain page reads in one voice (literal names stay mono as `code`); classed prose keeps its own look, so a builder sample on `/styleguide` is not restyled, and the styleguide's own prose classes take the sans face in `styleguide.css`; unclassed paragraphs, lists and definition lists take a 40em measure, not 70ch (Inter's `0` is about 0.6em, so 70ch is about 42em); unclassed lists take a `--space-4` (1.5rem) gutter so the bullet stays inside a phone's edge; and the phone root is `1rem` at 400px (decision 2). Class: **variant** (the Plain look, the reviewed convergence shift).
- **Phone title (LIN-3958, recorded, not changed):** at 390px the Plain title (`.plain-title`, 24px) is larger than the "Harbour" brand h1 (19.2px, measured on `/privacy`). At 1280px the h1 is 32px and the title 24px, so the title sits below the h1 on desktop. The title was already larger than the h1 on a phone at base (19.5px). The h1 is outside `.plain-page` and its shape and size are not in scope (LIN-3958), so it is left alone; the gap is a known difference, not a regression to fix here.
- **Variant:** two header shapes. Brand (`brand: true`): the "Harbour" brand h1 links home, the title is one `<h2 class="plain-title">` and sections are h3. Workspace (the default): the page-header h1 is the title, its lede the subtitle, and sections are h2.
- **Rows, forms and the column (LIN-3956, resolved):** a page with a `rows` section gets `public/settings.css` from `renderPlainDocument`, after `style.css`, so no caller adds it. `.plain-page` is the phone root, and a Plain page takes no `.settings-shell` wrapper. `rows` is a Plain section over `rowsList` (extracted from `group()`, Settings output byte-identical), so its heading takes the page's tag and never `group()`'s h2. `form` is `plainFormHtml`: the canonical text control (`token-label-input`, decision 15), `aria-label` set to the label, and placeholder and maxlength passed through. `.plain-page.plain-column` caps the `<main>` at the 40em measure and centres it (open question 6). `/styleguide` builds its own `<main>`, so it never gets the column.
- **Differences (LIN-3956, intended, named in the PR):** `/privacy` and `/terms` are centred at desktop 1280 (the column moved). At phone width the column is already narrower than 40em, so it does not move there.

## Consolidate (LIN-3889): status at head

Measured at `55149a37` (the last commit that changed CSS). Each decision's authority, its losing copies, and its sites at base and head by the note's own counting rule: the base sites the note lists by `file:line`, and the rule bodies or render sites that still write the decision.

| Decision | Authority at head | Copies deleted | Status | Sites base → head |
| -- | -- | -- | -- | -- |
| 1 Spacing | `--space-N` | token-equal literals in the sheets this PR edits | scoped; off-scale values stay (Rebuild) | literal 904 → 890 (measure) |
| 2 Type | `--font-size-*` | token-equal `1em` and `0.85em` in the same sheets | scoped; `0.9em` vs `0.85em` open | declarations 810 → 798 (measure) |
| 3 State colours | `:root` tokens | the three `var(--red, #c0392b)` / `var(--bg, #fff)` fallbacks in settings.css | done at Consolidate, when Paused was still red; amber at head (open question 1, resolved by Rebuild) | 4 → 1 (the `:443` hover `rgba`, decision 7) |
| 4 Breakpoints | the written list (13) | none; the test pins the list | done | 13 → 13 |
| 5a Key/value row | `.field` (+ its 640px wrap) | `.dispatch-section .line`, `.proxy-section .line`, `.settings-section .line` and their wraps; six dead flip declarations | done. Flip sweep: `.dispatch-prompt-line`, `.dispatch-prompt-actions`, `.ai-override-row`, `.dispatch-default-row`, `.dispatch-preset-name-line`, `.provider-binding/-add/-add-blocked` (`gap: var(--space-sm)`, a token defined nowhere) | 4 → 1 |
| 5b Interactive row | `switchRow`, `drillRow`, `actionRow`, `staticRow` (shell) | hand-written static rows, `-you.js:110` action, `render-settings.js:866` drill, the JSON switch | partly: the Theme, Email and Runs rows and the change row keep their own markup minus `line` | about 11 hand-written → 4 |
| 6 Button | `.action-btn` and `.btn--quiet` plus tones (`.btn--green/blue/red`), one rule body per look in style.css; `.btn.btn--red` / `.btn--teal` for the bordered confirm | the `.action-btn` block in common-actions.css; `.halt-form .action-btn`; the proxy pager's disabled rule | partly: callers moved to the canonical names in render-dispatch, render-proxy, render-settings-you, render-settings-workspace and the halt component. 17 files and render-settings.js stay on the alias, with the same body (open question) | button-like classes 37 → 41 (measure: the canonical tone names are new, so the gate sees +4); rule bodies naming `.action-btn` or `.btn--*` 10 → 13, the same bodies, one per look |
| 7 Switch | `.settings-switch` | `.toggle-btn`, `.feature-toggle`, `.feature-toggle-label`, `.settings-json-toggle`; the hover `rgba` is `var(--bg-alt)` | done | 2 → 1 |
| 8 Ask in place | `askInPlace`; confirm `btn btn--red` / `btn--teal` | the bare `.action-btn` confirm | done. Key revoke is a named variant with the same bordered confirm | confirm styles 2 → 1 |
| 9 Note | `.page-header__subtitle` | `.settings-subtitle` | done | 5 → 4 |
| 10 Group title | `.settings-group-title` (Settings), `.section .section-header` (elsewhere) | `audit.css` `.settings-header` (no emitter on Audit) | done | 5 → 4 |
| 11 Key row | `keyRow` | the seven dead token-list rules in common-actions.css; `.token-list` and `.token-meta` in dispatch.css; `.proxy-token-list` in proxy.css | done | 7 dead → 0 |
| 13 Link | `.settings-link` (style.css) | `audit.css` copy and the `settings.css` copy | done | 2 → 1 |
| 14 Back link | `.sess-back, .task-create-back, .task-edit-back` (style.css); `.settings-back` is a named variant | the three page copies (session, task create, task edit) | done | 4 → 2 |
| 15 Text control | `.model-select`, `.token-label-input` (style.css) | `audit.css` `.model-select`, the `settings.css` body, the `common-actions.css` body | done. `.model-select:focus` no longer removes the ring for keyboard focus (`:focus-visible`) | 3 → 2 |
| 16 Halt controls | `lib/components/halt-controls.js` | the second Dispatch and Running markup | done; `routes/` is byte-unchanged | 2 render sites → 1 |

**Count rule at head** (`node tests/measures/css-measures.mjs . <rev>`; the base is `22f6942d`, and `--dup-blocks` as the script defines it):

| Measure | Base `22f6942d` | Head `55149a37` |
| -- | -- | -- |
| CSS lines | 19,888 | 19,750 |
| Spacing, literal | 904 | 890 |
| Spacing, token | 676 | 665 |
| Distinct font sizes (declarations) | 74 (810) | 74 (798) |
| Button-like classes | 37 | 41 |
| Breakpoints | 13 | 13 |
| Byte-identical bodies (`--dup-blocks`) | 35 | 29 |
| Area pairs (`seams.mjs`) | 10 | 10 |

Button-like classes rose by four because the canonical tone names (`btn--quiet`, `btn--green`, `btn--blue`, plus the existing `btn--red`/`btn--teal`) are new class names, and the aliases remain. The Rebuild gate will see that rise, and the reason is the alias tail, not a second look. The spacing token count fell (676 to 665) although 9 literals became tokens: the copies deleted held more token uses than that, so the net is down. The plan's 680 to 700 prediction was wrong on that point; the literal count is inside its range.

## Rebuild (LIN-3890): status at head

The Rebuild PR builds every non-Models Settings area from the shared pieces (`lib/components/settings-*.js`, `halt-controls.js`), styles stay in `public/settings.css`, and the old tree/node/field builders are gone from those areas (`tests/unit/lin-3890-no-old-builders.test.js`). Decisions 8 (ask in place), 6 (button) and 9 (note) have new authorities; the rest of the table above stands.

| Decision | Authority at head | Status |
| -- | -- | -- |
| 5b Interactive row | `switchRow`, `drillRow` (with `flagHtml`, `attrs`), `actionRow`, `staticRow` in `lib/components/settings-row.js` | done for every non-Models area, including the Theme and Email rows (hand-written before this PR) |
| 6 Button | `btn btn--primary` (confirm, make active, Undo), `btn btn--red` (stop, remove, revoke), `btn--quiet` (Cancel, test, add) | done for Settings, Models included (LIN-3855). `action-btn` stays for the other pages' emitters |
| 8 Ask in place | `askInPlace` in `lib/components/settings-ask.js`: Confirm, Cancel, `form` transport (POST only) and `script` transport (DELETE, one generic handler in `public/settings.js`) | done. The dispatch halt buttons stay out; Models' preset delete is a `script` ask (LIN-3855) |
| 9 Note | `groupNote` / `.settings-note` | done; notes fit one line in the 600px pane at 1280px (the consent blast-radius copy is shared with `/auth/openrouter` and stays as it was) |
| 10 Group title | `group()` in `lib/components/settings-group.js` | done |
| 11 Key row | `keyRow` in `lib/components/settings-key-row.js` (name first, then kind, relative expiry and last use; the flag on the row; Revoke is an ask with `transport: 'script'`) | done |
| 12 Area frame | `renderSettingsShell` in `lib/components/settings-frame.js` (the page header inside the frame, hidden on a phone area view; one purpose line; the phone index paints no selection, the desktop index keeps the first area current) | done |
| status line | `statusLine` in `lib/components/settings-group.js` (`settings-flash` and `settings-flash-error` kept) | new at head |
| sidebar state | `SIDEBAR_TONES` in `lib/settings-areas.js` (`ok`, `warn`, `bad`) | done (amber for paused and stopped) |

Measures at head (`e1eafd82`, review round 2), from `node tests/measures/css-measures.mjs . <rev>` (the series base is `a32c14a3`; the PR rebased onto `2c836676` on 25 October):

| Measure | Series base `a32c14a3` | This PR's base `2c836676` | Head | Gate |
| -- | -- | -- | -- | -- |
| CSS lines | 19,888 | 19,329 | 19,373 | ≤ 19,888 |
| Spacing, literal | 904 | 882 | 882 | ≤ 904 |
| Spacing, token | 676 | 640 | 645 | (no gate) |
| Distinct font sizes (declarations) | 74 (810) | 74 (777) | 74 (780) | ≤ 74 |
| Button-like classes | 37 | 41 | 36 | ≤ 37 |
| Breakpoints | 13 | 13 | 13 | ≤ 13 |
| Area pairs (`seams.mjs`) | 10 | 9 | 9 | (reported) |

The CSS line count rose by 44 from base, all in `settings.css`: the phone label and summary rules, the page-header and phone-selection rules, the Cancel colour, and their comments (under the 19,888 gate).

The button count went 41 → 36 by retiring the five classes nothing emits: `btn--teal` (the ask's confirm is `btn--primary`), `provider-add-btn`, `provider-remove-btn`, `roadmap-generate-btn` and `ai-btn`. `tests/unit/lin-3890-dead-button-classes.test.js` checks each name against every production emitter, so a deletion cannot take a live element's look with it. The series base's `action-btn` tail is not renamed (decision 6, open question 3).

The verbatim share of the Settings renderers, `scripts/code-shape/verbatim.mjs` from `2c836676` to head over `lib/render-settings*.js`, `lib/components/settings-*.js` and `halt-controls.js`, is 69% of the new lines (68.9%). That figure counts Models' untouched body (`render-settings.js`, about 380 lines that do not change), so it is not a copy measure for the rebuilt areas. The matched runs are mostly the shell's builders, moved intact into `lib/components/` (a move, which the ticket asks for, not a copy), and Models' body, which this PR does not change. The question it prompts, answered: a different split was not skipped. The rebuilt areas call the shared pieces, and the old builders are deleted rather than kept beside them.

Outcome 11 (one model-routing move is one change-log entry) is a follow-up: LIN-3925, filed next to LIN-3855. Cause: each job is its own proxy request, and no batch id reaches the store.

## Plain (LIN-3950): status at head

The first Plain move. The helper is `lib/components/plain-page.js`; decision 17 is its authority.

| Piece | Authority at head | Status |
| -- | -- | -- |
| Brand shape (`brand: true`) | `renderPlainPage`, the Harbour brand h1 and `.plain-title` | done: `/privacy` and `/terms` (`lib/render-legal.js`) |
| Workspace shape | `renderPlainPage`, the page-header h1 with its lede | shipped; no page yet (the next Plain moves) |
| `html` section | `renderSection` | done: Legal |
| `fields` section | `renderField` | shipped; sampled on `/styleguide` only |
| `rows` section | `renderSection` over `rowsList` (`settings-group.js`), the rows Settings uses | shipped; Account home (LIN-3956), which links `settings.css` through the document entry, and `/styleguide`, which links it by hand. Settings `group()` shares the rows list |
| `form` section | `plainFormHtml`: `renderField` with a text input (`token-label-input`, `aria-label`, placeholder, maxlength), and a primary `renderButton` | shipped; Account home (LIN-3956) and the workspace-not-found CTA (`LOCAL_WORKSPACE_FORM`), and `/styleguide` |
| `empty` section | `renderEmptyState` | shipped; sampled on `/styleguide` only |
| Document entry | `renderPlainDocument`: settings.css when there are rows, `after` markup (a footer) | done: Legal and Account home (LIN-3956) |
| Account home | `renderPlainDocument`, brand shape, `rows` and `form` | done: `/account` (LIN-3956) |
| Column | `.plain-page.plain-column`, 40em, centred | done (LIN-3956, open question 6): Legal and Account home; `/styleguide` opts out |

The judge's list gained `privacy` and `terms` (`tests/judge/pages.mjs`, `renderers: ['lib/render-legal.js']`). The Legal copy is unchanged: `tests/unit/legal-copy-lin3950.test.js` compares every heading and section body with a snapshot taken before the move.

## Models (LIN-3855): status at head

The Models body is `lib/render-settings-models.js`: one staged form for every job and group (`lib/model-routing-edit.js` turns the posted fields into one logged change with one reason and one version check), the routing presets, and the change log with Undo. Its pieces are built once and listed here:

- **Decision panel** (`lib/components/decision-panel.js`, LIN-3962; see the next section): the harness, model and effort of one job or group. The field names are `c__<scope>__<surface>__<key>__<field>`. `public/decision-panel.js` toggles the suggestions and effort for the harness in force; the server judges every save.
- **Spend bar** (`lib/components/settings-spend-bar.js`): a native `<progress>`, no inline style.
- **Phone sheet:** the open job row is a full-screen `details` at phone width (the Models block of `public/settings.css`). A focus trap and an Escape handler run on it (`public/settings-models.js`): Escape closes the sheet and returns focus to its summary.
- **Shared list:** the harness list is one copy in `lib/model-routing-harnesses.js`. `renderPage` embeds it as `window.__HARNESS_MODELS__` on every page that loads `/common.js`.

## Decision panel and model display name (LIN-3962): one authority each

Two rows, one authority each. A new panel or name rule goes into these, not beside them.

- **Decision panel** (`lib/components/decision-panel.js`): the one choice of harness, model and effort, server-rendered for both Settings › Models (each job and group row, and the No job row) and Home's run panel (`GET /workspace/:urlKey/api/dispatch/decision-panel`, owner-only, read when Change opens). The order is always the numbers first, then harness, model (suggestions, then the search list), then effort. Effort is `DISPATCH_EFFORT_LEVELS` with "follow" first, and a stored value outside it is shown and kept. The page supplies its own field names and attributes, and nothing else; Models posts the staged fields and Home keeps its draft. The client is `public/decision-panel.js`, a classic script that toggles the markup and never builds it. Its styles are `.decision-panel*` in `public/style.css`. Its numbers come only through `agentSpendByJob` and `typicalByModel` in `lib/model-routing-spend.js`, read from `lib/model-routing-history.js` (one 30-day window, one cap, shared by both pages).
- **Model display name** (`getModelDisplayName`, `lib/openrouter.js`): curated name, then the live catalog's name, then a bare Claude Code alias's name (the model it runs, "Claude Sonnet 5.5"), then a Claude id absent from the curated list in the same form ('claude-sonnet-5-5' → "Claude Sonnet 5.5"; a dated build suffix is dropped), then the provider-stripped slug. The older rules in `modelNamer` and the sidebar summary are LIN-3952's to convert.
- **Words for a routing value** (`routingWords`, `lib/components/decision-panel.js`, LIN-3987): the one place a harness, model and effort in force are said in words. Harness is its name ("Claude Code", "opencode through OpenRouter"); a blank model says whose default applies ("Claude Code's own model", "opencode's default model"); effort is "Claude Code's own effort", or "not used" where the harness takes none. Every page reads it: the decision-panel and preview routes return `words`, Models' follow labels use it, the styleguide's hints use it, and Home's heading, summary and "Runs on" line take their names from it. A page never prints a raw harness id, a bare alias or "none".
- **Claude Code alias rates** (`DISPATCH_CLAUDE_ALIAS_MODELS`, `lib/model-routing-harnesses.js`, LIN-3987): an alias is priced as the model it runs, in the form Claude Code reports ('claude-sonnet-5-5'), through `resolveWorkerModelId` and `getModelRate`. A rate the job's own runs reported for the family wins where it resolves; otherwise the mapping. The mapping is one table beside `DISPATCH_CLAUDE_MODEL_SUGGESTIONS`, with no second price table. `tests/unit/model-routing-harnesses.test.js` fails an alias with no mapping and a mapping with no rate row.

Where Home and Models differ on purpose: Home's blank field reads "From Models" (the option stays short: a 390px select clips a longer one), and the line under it reads "Right now: <words>" (for example "Right now: Claude Code's own model"); Models' blank reads "Follow <Group> (<words>)", where `<words>` is what the group resolves to today, the server default included. Home has no OpenRouter-only auto-switch (the harness does not follow a model pick there); Models' model field is a search input, where it was a select. Swipe has no run panel and its Dispatch ▾ exec controls are not this panel; its card's Go keeps its own look.

**LIN-3987 decisions (each with its reason):**

- **The panel's type and width.** `.decision-panel` sets the content face, so its reasons are sans on Home and on `/styleguide` (they were mono there, because nothing set a face). Prices, costs and figures keep the structural face. The panel is 32rem wide at most; a phone is narrower, so it fills the sheet, and no breakpoint was added.
- **Suggestions are buttons on the shared `.btn` class.** The chosen suggestion is `aria-pressed="true"`, kept in step with the model field by `public/decision-panel.js` (on a pick, a typed model, and a keyboard press). A chosen choice in either panel (a suggestion, a preset, a Runs on target) takes one selected rule, `.btn[aria-pressed="true"]` scoped to `.decision-panel` and `.opened-task-change-panel`. It is drawn with the brand border and a tint, not bold and underline, which read as a link.
- **A suggestion's row is a name and rate line, then its reason.** A rate the job's own runs decided is marked "Ran as this model" on its row. A mapped rate is said once, in the note above the list, so four identical lines do not take the phone's height. The typical cost shows where the job ran on that model.
- **Notes, once each.** Claude Code's note says the rates are per 1M tokens for comparison, where an alias's rate comes from, and that a Claude Code subscription may cover the cost (the ticket's default until John answers). A second note names any suggestion with no known rate, instead of "price unknown" on each row.
- **A hidden field says why.** With opencode in force the Effort row is hidden and one line says "Effort does not apply: opencode through OpenRouter takes none." On Home, "Claude Code on the web" is not offered with opencode; a line says so. A draft that already chose web falls back to the runner when the harness changes, so a choice the harness cannot run is never kept.
- **The mapping's generation.** Each alias maps to the newest generation of its family that `MODEL_PRICING` has a row for: haiku 5.5, sonnet 5.5, opus 5.5, fable 5.1. An alias tracks the newest model the CLI offers. The two Sonnets and two Opuses in `DISPATCH_MODEL_SUGGESTIONS` are opencode's list, not the aliases' targets. Open for John: a different generation is a one-line change to the mapping.
- **Phone fit.** At 390×844 with Claude Code in force and priced runs that report no model, "Use for this run" sits inside the sheet's first screen (the approximated Home sheet measures about 752px). The name and its rate share one line; the costs line is the small size.

Open questions (today's behaviour kept, written into the PR): (1) rate plus note, or the job's own cost only, for Claude Code (the ticket's default is the rate and the note); (2) the wording of the hidden-field line (decision in the note above); (3) the generation each alias maps to (decision above). The Models placeholder on a phone (`Follow Make (Claude Sonnet 5.5)`) can clip in its narrow input; that is a Models-page layout question, not this panel's, and is recorded here rather than fixed.

## Open questions for John

Each keeps today's behaviour until answered.

1. **Does a paused workspace get its own state colour?** **Resolved at head (LIN-3890):** `SIDEBAR_TONES` is `ok`, `warn`, `bad` (`lib/settings-areas.js:34`), and Paused and Stopped show amber, so option (b) shipped. At base, Settings had two tones and Paused showed red like Stopped (`settings.css:647-662` at base). Options were: (a) keep two tones; (b) add an amber tone using the existing `--amber` / `--amber-dim`. **Recommendation was (b).** Pausing is a deliberate owner action, not a failure, and the palette already carries the meaning (`--amber` is "running", `style.css:128`). Rebuild would add the tone.
2. **Key row** (only if the reading in decision 11 is wrong). Today there is one live key row, so none is open. If a second live emitter turns up, the options are `keyRow` or the token list; the recommendation is `keyRow`, which is built on the Settings row and already carries the owner-only revoke and the expiry.
3. **Does the `action-btn` alias tail get renamed?** Fifteen files under `lib/` and `public/` still emit `action-btn`, which renders the same body as `.btn--quiet` with a tone. Today's behaviour: keep the alias and its emitters (LIN-3890 did not rename them). Decision 6 records the reason; the rename is a later sweep's call.
4. **Does key revoke need a no-script path?** Revoke is an ask with `transport: 'script'` (`lib/components/settings-key-row.js`, `lib/components/settings-ask.js`), so it runs only with JavaScript. Options: (a) keep it script-only; (b) add a form-post fallback. Today's behaviour: script-only, unchanged.
5. **Should a Plain page with rows get its settings.css link and phone root from the helper?** Today the `rows` kind is styled only where `settings.css` is linked and inside `.settings-shell` (decision 17). Options: (a) leave it to each page, as now; (b) have `renderPlainPage` add the link and the root when it uses `rows`. Today's behaviour: (a). The next Plain move, which has the first page that uses rows, decides. **Resolved at head (LIN-3956): option (b), in the document entry.** `renderPlainDocument` adds `/settings.css` exactly when a rows section is present, after `style.css`, so a caller cannot forget it. The phone root is `.plain-page` itself, not `.settings-shell`: that is a two-column grid and would wrap the page wrongly. Spiked: rows inside `.plain-page` with settings.css linked render at 15.2px at 1280 and 390, the same as Settings; without the link they are unstyled.
6. **Should the Plain title keep Legal's centred look?** Today it does (`.plain-title`, `text-align: center`). The alternative is the canonical section treatment. Today's behaviour: centred, unchanged by LIN-3950. **Resolved at head (LIN-3956): the column is centred.** The `<main>` is capped at the 40em measure with `margin-inline: auto` (`.plain-page.plain-column`), so the column sits under the centred header and the rows card does not stretch to about 1088px at 1280. Legal takes the same column, so privacy and terms differ at desktop 1280, which the PR names. The brand h1 is unchanged, and `/styleguide` opts out by construction. The 401–640px band was not browser-checked (the judge's widths are 1280 and 390); it is recorded as not run.

## For the tickets that follow

- **LIN-3888 (Free the seam):** the tests that pin Settings' CSS are those naming `.settings-*`, `.settings-header`, `.token-*` (decision 11) and `.line`. The judge (`tests/judge/`) shows nothing moved while they are rewritten onto data attributes.
- **LIN-3889 (Consolidate):** each row's "Consolidate deletes" line is its work list; the judge must stay at zero for every deletion that should not change a pixel, and must list a difference where one is intended.
- **LIN-3892 (sweep, next Plain moves):** the `rows` and `form` kinds now run on a real page (Account home, LIN-3956), and open questions 5 and 6 are closed. Templates, Custom prompts and Task edit/create still need their own rows or forms, and the repo picker's radio rows inside a form fit neither kind yet.
- **LIN-3890 (Rebuild):** report against the measures at the series base above. Open question 1 (resolved by Rebuild) and the `unclear` classes were Rebuild's design input.

## The judge

`node tests/judge/visual-replay.mjs --base <rev> --head <rev> [--self-check] [--control]` replays the 29 entries of `PAGES` at head (116 shots: 29 × 2 themes × 2 viewports, 1280×900 and 390×844; counted by importing `PAGES`, because `grep -c "{ id:"` gives 17 and the eight Settings areas come from `AREAS.map`; the count was 27 and 108 before LIN-3956 added `account-home` and `workspace-not-found`, and 25 and 100 before LIN-3950 added `privacy` and `terms`) on two exports of two commits, at zero tolerance. It lives in `tests/judge/`, is not part of `npm test`, and commits no reference images. Its page list, masks (each with its reason) and "not covered" list are in `tests/judge/pages.mjs`.

Three things to expect when reading the judge's output:

- **Retakes.** A differing pair is retaken up to 3 times at zero tolerance, and the count is printed. Two identical exports sometimes paint a sub-pixel apart; the source was not found. Seen so far (dated; counted when the list had 72 shots): 1 of 72 in the author's run and 2 of 72 in the reviewer's, none in the base-against-base self-check. A run whose retake count rises above that should be read as suspect.
- **Shared-stylesheet coverage guard.** The guard finds the renderers that link a sheet with `git grep -F <name>.css` over `lib/`, which matches mentions as well as links (`style.css` returns 47 files at head, including comment mentions in `lib/components/*`; `common-actions.css` 22). The first Consolidate change to either sheet therefore prints NOT ZERO-CLAIMABLE until the judge's page list grows to cover them. That is the ticket's page-list rule failing safe, not a fault in the change.
- **Failed server start.** When a server fails to start, the driver keeps its work directory and prints its path, so the `server.log` the error cites still exists. The directory is removed on success.
