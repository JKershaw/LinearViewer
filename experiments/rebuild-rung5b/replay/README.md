# Render-cluster replay

This tool compares two versions of Harbour's page-renderer cluster. It renders
the same inputs through both and reports every difference an outsider could
see in the output. The cluster is four modules and all of their exports:

| module | exports |
|---|---|
| `lib/render.js` | `renderPage`, `renderDetailsContent`, `renderDisplayLabels`, `formatRelativeTime`, `priorityOptionsHtml`, `PRIORITY_OPTION_LABELS`, plus the five `render-pages.js` re-exports |
| `lib/render-session.js` | `renderSessionPage`, `renderPrLine` |
| `lib/render-swipe.js` | `renderSwipePage`, `orderIssuesForSwipe`, `flattenTrees`, `sortIssuesForSwipe`, `applyBlockingOrder`, `clusterByParent`, `computeOffPageBlockers`, `buildWhy`, `buildFilterGroups`, `isBoostableBug`, `computeGraphFeatures` |
| `lib/render-settings.js` | `renderSettingsPage`, `OPENROUTER_CONSENT_BLAST_RADIUS_COPY`, `AI_OPERATION_LABELS` |

It never writes to `/home/user/LinearViewer`, never makes network calls and
never calls a model. It extends `../../rung2/replay`, which does the same job
for one module (`render-roadmap.js`).

```sh
node replay.mjs --old pinned/origin-main --new <dir|files> [--n 3000] [--seed 1] [--out report.json] [--coverage]
     [--only render,session,swipe,settings] [--old-lib DIR] [--new-lib DIR] [--prefer-side]
     [--descriptions file.json] [--now ISO] [--recapture] [--no-capture] [--dump <inputId>]
     [--inventory] [--max-examples 3] [--quiet] [--work DIR]
node selfcheck.mjs [--n 3000] [--jobs 3]    # identity on two seeds, 11 mutants, coverage
node capture.mjs                             # redo the unit-test capture on its own
node pin.mjs [commit] [name]                 # (re)make pinned/<name>/ from git
node build-contract-notes.mjs <report-with---inventory> > contract-inventory.json
```

Exit codes: `0` means every input gave the same output, `1` means at least one
difference (or a removed export), `2` means the tool itself failed. If you
don't pass `--out`, the report goes to `work/report.json`.

## Sides and loading

`--old` and `--new` each take a directory (holding the four files, directly or
under `lib/`) or a comma-separated list of the four files.
`pinned/origin-main/` is `git show f4749b91:lib/<file>` with every relative
import rewritten to an absolute `file:///home/user/LinearViewer/lib/...` URL.
The rewrite keeps every line in place, so coverage line numbers equal the
original file's (`MANIFEST.json` records this).

Each side is copied to `work/copies/<old|new>-<hash>/`. That directory gets
`"type":"module"` and a `node_modules` symlink to the repo's. A relative
import is resolved against the side root as if the root were `lib/`:

1. A cluster module resolves to this side's copy.
2. A file that exists in the side but not in `--old-lib`/`--new-lib` resolves
   to the side's copy. This is a new helper the rebuild added. It is copied
   and rewritten recursively, and gets its own coverage entry.
3. A file in both resolves to the lib copy, so both sides share one instance,
   for example of the provider registry. Pass `--prefer-side` to use the
   side's copy instead.
4. Anything else is an error that names the specifier.

`meta.<side>.resolutions` lists every side-resolved import.

## Hermetic setup

- `TZ=UTC` is set, because `formatDate` and the footer use local time.
- `NODE_ENV=production` is set.
- `GITHUB_*`, `JIRA_*`, `ATLASSIAN_*`, `EMAIL_*`, `RESEND_*`, `OPENROUTER_*`,
  `LINEAR_*`, `DEPLOY_*`, `RAILWAY_*`, `FREE_TIER_*` and `HARBOUR_*` are
  cleared.
- An input may carry an `env` overlay that applies to both sides for that one
  render. Examples are `EMAIL_TRANSPORT=capture` + `NODE_ENV=test`, a Resend
  config, and GitHub app vars. These reach the Settings email row and the
  navbar CTAs.
- `process.env` is wrapped in a recording Proxy. The report lists the env
  vars each side read at import and during rendering (`envReadsDuringRender`,
  with `onlyOld`/`onlyNew`).
- The clock is frozen with a `Date` subclass at `--now` (default
  2026-10-14T12:00Z). `Math.random` is reseeded per call, and every network
  API throws and is counted.
- The import probe records new globals, active handles, process listeners,
  network attempts and env reads. All are empty for f4749b91 apart from
  Node's own `WATCH_REPORT_DEPENDENCIES`, which is filtered out.
- Shared dependencies are imported once from main's `lib/`, with
  `providers/index.js` first so the canonical registration order holds.

## Inputs

Each tier is counted in `totals.byTier` and each export in `totals.byExport`.

- **test** (601 calls): the real arguments the unit tests pass. The capture
  takes every `tests/unit` file whose static import closure reaches a cluster
  module. That is 284 files, 49 of which produce calls, and includes tests
  that reach the cluster through `routes/`, `server.js` or `lib/`.
  - Each file runs in a child process under `lib/capture-preload.mjs`. A
    resolve hook swaps each cluster module for a generated recording shim, the
    clock is frozen, and the network is loopback-only.
  - The files run from a scratch tree: `tests/` is copied and everything else
    is symlinked. That way nothing a test writes lands in the repo.
  - Arguments are snapshotted before the call. Provider instances become
    `{__provider}` and functions become their source. Calls are deduplicated
    and capped at 80 per export per file.
  - The capture is cached in `work/captured-<now>.v8`. `--recapture` redoes
    it, which takes about 1 min with 4 jobs.
  - All 284 files exit 0. Two ran with the clock unfrozen (listed in
    `meta.capture`).
- **sample** (119): the repo's own data run through the real pipelines.
  - `content/landing.md` goes through the landing pipeline (`renderPage` and
    `renderSwipePage` with `isLanding`, and every landing issue's details).
  - `lib/sample-data` `testMockData` goes through `fetchAndPrepareProjects`'s
    exact tree pipeline: No Project, Periodicals, in-progress and
    recent-activity forests, partition and collapsed. It is rendered with
    default flags, all flags, periodicals on and off with proxy on and off,
    and a top-task mark.
- **edge** (133): hand-written boundaries.
  - `formatRelativeTime` at ±1 ms around each threshold.
  - Descriptions of exactly 3 vs 4 lines and 300 vs 301 chars, and every
    `---` prompt-block shape.
  - Project content at 150/151 chars and the word-boundary cut.
  - The add-task link for every provider kind.
  - The top-task mark when an issue appears twice.
  - The swipe promotion threshold, blocking and parent cycles, and the
    seed-only and seed-demoted decks.
  - Run pages: not-found, lineage of 2 with replies, bare-blocked card,
    mid-turn decision, priced total, standalone, goal-only.
  - Settings: every `openRouterSource`, the three email env setups, all flags
    on and all off, provider bindings plus notice, PAT.
- **gen** (19,000 at `--n 3000`): 3,000 seeded inputs each for `renderPage`,
  `renderDetailsContent`, `renderSwipePage`, the swipe pure pipeline,
  `renderSessionPage` and `renderSettingsPage`, plus 1,000 small render.js
  calls. Each case has its own seed from `(seed, export, index)`, so
  `gen:render.renderPage:1234` is the same at any `--n`.
  - The issue worlds (`lib/gen-world.mjs`) are provider-shaped: every state
    type, priorities 0–4, labels including prompt labels, sources
    linear/github/jira/local, nesting, blocking relations, attachments and
    comments with images, and times around every boundary. They run through
    main's real `lib/tree.js`. Ids are globally unique, because a parent cycle
    hangs `tree.js`.
  - Descriptions come from a Markdown generator (`lib/gen-common.mjs`). It
    covers headings, nested ordered and unordered task lists, code fences with
    `<script>`, quotes, tables, raw HTML, images, links with `&"`, CRLF, and
    leading blanks. Escaping hazards and unicode (RTL, zero-width, emoji) go
    into every string family.
  - Feature flags are random over all `FEATURE_KEYS`. Workspaces cover every
    provider kind.
  - Session, loop, decision and evidence shapes follow
    `run-view`/`render-run-steps` and include the captured run-evidence
    models. Settings inputs cover every option, with catalog, pricing and
    preset hazards.
- **const**: the three value exports, deep-compared once.

## Comparison

Every call also compares the arguments after the call, because input mutation
is observable: `server.js` reuses the trees. For data exports it also compares
whether the return value aliases an argument and which input elements it
reuses. Each differing input gets exactly one kind:

| kind | meaning |
|---|---|
| `whitespace-only:runs` | DOM-equal and equal once whitespace runs are collapsed |
| `whitespace-only:presence` | DOM-equal, but a whitespace run appeared or vanished at a tag boundary. This can show between inline elements |
| `serialization-only` | DOM-equal, but entity spelling, attribute order/quoting, class-token order, or JSON key order (data-* JSON or the embedded `window.X` payload) differs |
| `structural:element` / `:attribute` / `:text` | the normalised DOM differs |
| `data` | the return value of a non-HTML export differs, order-aware (Map/Set/array order count) |
| `input-mutation` | the return is equal but the post-call arguments differ |
| `throw` | either side threw, and not identically |

The normalised DOM comes from a built-in tolerant parser (`lib/html.mjs`; no
npm is available offline). It handles:

- void, raw-text and RCDATA elements
- entity decoding
- duplicate attributes (first wins, and the duplicate is recorded)
- stray end tags
- implicit `li`/`option`/`p` closes

It then drops whitespace-only text, collapses text, sorts attributes and class
tokens, canonicalises JSON attribute values and embedded `window.X = …`
payloads, and keeps comments.

The structural signature is the first DOM difference, given as an element path
(`tag#id.class[testid=…]`) plus what changed: `attr-changed @href`,
`child-added <…>`, `#text`, or `#embedded(__SWIPE_DATA__) $.issues[].why`.
Children are aligned with an LCS on tag, id, testid and data-id, so one
inserted row is reported as one difference.

**DOM-CONTRACT** is the top severity, flagged on top of the kind. The page is
projected onto contract tokens, and any change in that projection is a
contract difference. The tokens are:

- every `data-*` attribute with its value (including `data-testid`, and
  `data-id`/`status`/`section`/`parent` from llms.txt)
- every `id`
- every class token named by a consumer: `public/*.js` (not minified),
  `public/*.css`, `public/llms.txt`, `tests/{unit,e2e,fixtures}`,
  `tests/helpers.js`
- keyed nesting such as `div.node > div.line[data-id]…`

Contract differences are grouped separately in `contractGroups`, which lists
lost and gained tokens. They are counted in `totals.contractDiffering` and in
`byKind['DOM-CONTRACT']`. `contract-inventory.json` lists the renderer-owned
tokens with their consumers: 78 data-* attributes, 99 testids, 3 ids and 244
classes, 424 in all.

The report contains:

- `groups`: by export, kind and signature, ordered by severity, with a count,
  tiers, example ids and one detailed example (excerpts and the first DOM
  diffs)
- `coarseGroups`
- `differing[]`: every differing id
- `throws`
- `surface`: export added, removed, or changed in type or arity
- `meta.importSideEffects`
- `envReadsDuringRender`
- `coverage` when `--coverage` is passed: V8 precise line and block coverage
  for every file of each side, split into tests only, plus fixtures, and all

## Real-text display hook

`--descriptions file.json` takes an array of Markdown strings and replaces the
normal input set. Each string is rendered through every path where
`lib/render.js` shows a description:

- `renderDetailsContent` signed-in: escaped first three lines, or the
  truncated view plus base64 `data-raw-desc` that the client renders with
  marked/DOMPurify
- `renderDetailsContent` on landing: the `---` prompt-block split
- `renderPage`: the string as project content (150-char cut) and as an issue's
  description (`data-search-text`)

`report.descriptions[]` gives each string's index, whether it was equal, its
kind and its contract signature.

f4749b91 has no server-side Markdown renderer. A rebuild that adds one shows
up here.

The hook was tested with `samples/synthetic-descriptions.json`, which holds
98 synthetic strings made by `samples/make-synthetic-descriptions.mjs`.
- old vs old: 294 renders, 0 differences.
- Against a mutant with the 300-char threshold set to 299: 2 differences,
  `structural:element` plus DOM-CONTRACT. Those are exactly the two
  300-char strings.

No private corpus was read.

## Self-check results

The run used n=3000 and 19,856 inputs per run: 601 test, 119 sample, 133
edge, 19,000 gen and 3 const. All 13 checks pass and 11 of 11 mutants are
caught (`work/selfcheck/selfcheck.json`).

| check | differing | kind(s) |
|---|---|---|
| old vs old, seed 1 | 0 | — |
| old vs old, seed 2 | 0 | — |
| testid only: `issue-line` → `issue-row` | 2,784 | structural:attribute, **all 2,784 DOM-CONTRACT** |
| whitespace only: In Progress header re-indented | 1,949 | **whitespace-only:runs only**, 0 contract |
| whitespace presence: newline dropped between closing tags | 1,126 | whitespace-only:presence only, 0 contract |
| attribute order swap on `li.sess-run` | 2,378 | serialization-only only |
| `__SWIPE_DATA__` key order swap | 3,021 | serialization-only only |
| `escapeHtml` dropped on run-page title | 693 | structural:element (1 also breaks the contract) |
| `data-status` → `data-state` | 2,784 | DOM-CONTRACT |
| swipe promotion threshold 2 → 3 | 219 | data 64, structural 155 |
| `flattenTrees` mutates its input | 3,336 | input-mutation |
| settings copy `○ off` → `○ disabled` | 3,088 | structural:text |
| `formatRelativeTime` `< 7` → `<= 7` | 13 | structural:text (edge 1, gen 12) |

**Coverage of the f4749b91 copies (seed 1, all tiers):**

| file | lines | blocks | existing unit tests alone |
|---|---|---|---|
| `render.js` | 579/579 (100%) | 313/328 | 94.3% |
| `render-session.js` | 435/435 (100%) | 266/278 | 99.77% |
| `render-swipe.js` | 420/420 (100%) | 244/254 | 93.57% |
| `render-settings.js` | 878/879 (99.89%) | 269/281 | 95.68% |

The one uncovered line in `render-settings.js` is L1054, the `blockedBy`
reason. No registered provider declares `blockedBy`.

A full replay at n=3000 takes about 3 min with `--coverage` on a loaded 4-core
box. The self-check runs 13 replays, 4 in parallel, in about 10 min.

## Limits

- Only the first DOM difference of each input is the signature. Up to 8 more
  are in `example.diffs`, and `diffCount` gives the total (capped at 60).
- Class names in signatures can split one root cause into several groups.
  Check `coarseGroups` and `contractGroups`.
- Navbar/footer and other shared components come from main's `lib/` for both
  sides, so they differ only if a rebuild passes them different arguments.
- `settings` L1054 (the `addProvider.blockedBy` branch) can't be reached with
  the real registry, because no provider declares `blockedBy`.
- Inputs with parent cycles or `null` loops aren't generated. Main's
  `lib/tree.js` and `lib/run-view.js` hang or throw on them before the
  renderer runs.
- Captured functions (fake providers in tests) are recompiled from source. A
  closure over outer variables throws identically on both sides.
- Run time: roughly 3 min for the full n=3000 run with coverage on a shared
  4-core box. Without coverage it is faster.
