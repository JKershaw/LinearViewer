---
title: Can Harbour be rebuilt plank by plank, and which plank first?
kind: paper
version: 1
date: 2026-10-15
authors: [Claude, for John Kershaw]
model: "Frontier tier, claude-code, effort not recorded by the harness; one interactive cloud session with John Kershaw, not dispatched through Harbour (no dispatch id). Ticket titles read through a read-scoped Workspace API Proxy token. In-session subagents drew design mock-ups only; every figure here was computed in the main session by the committed scripts."
grounded_at: 38fc3b5c (LinearViewer, origin/main)
cites: [scripts/code-shape/seams.mjs@38fc3b5c, scripts/code-shape/areas.json@38fc3b5c, docs/reviews/seams-tangles-review-2026-10-13.md@38fc3b5c:35, docs/papers/harbour/the-second-copy.md@38fc3b5c:55-69, docs/papers/harbour/coherence-as-it-grows.md@38fc3b5c, docs/papers/harbour/test-surplus.md@38fc3b5c, lib/providers/interface.js@38fc3b5c:71-150, lib/providers/models.js@38fc3b5c, lib/providers/linear/index.js@38fc3b5c:30,72,1544-1548,1905-1909,1972-1976,1985-1989, lib/providers/jira/oauth.js@38fc3b5c:38, lib/providers/github/index.js@38fc3b5c:626, lib/providers/github-projects/index.js@38fc3b5c:541, lib/pr-state-store.js@38fc3b5c:19, lib/proxy-graphql-errors.js@38fc3b5c:168-171, routes/workspace-api.js@38fc3b5c:4022-4038, lib/proxy-ref-resolver.js@38fc3b5c:28-40, tests/unit/linear-provider-api.test.js@38fc3b5c:58-60, e3f942b7 (LIN-481), ab227381 (LIN-3466), dcfbf7fa (LIN-3325), 566b89be (LIN-3455), 39ca28a6 (LIN-675), 856d4ad6 (LIN-100), LIN-3449, LIN-3549, LIN-3550]
data: [theseus-events-codes.json, theseus-events.json, theseus-tangles-head.json, theseus-per-commit.json, theseus-weekly.json, theseus-providers.json, theseus-scripts/]
---

# Can Harbour be rebuilt plank by plank, and which plank first?

Yes for one block, the read and write half of Providers, once its spec is written down. That
takes a schema, a Linear fake and one conformance suite, none of which changes behaviour, plus
one internal change that makes write results agree. Its credentials are not ready. This paper
measured no other block in depth. The record also says the rebuild loop has to end in deletion,
or it will leave the code more tangled than it found it.

On `main`, from the first commit to `38fc3b5c`, the code's eleven areas (as `areas.json`
defines them) grew 24 two-way knots, or tangles, and lost 5. Every knot was tied by a change
that added an import across an area boundary, nearly always a single import, and mostly in
feature work. Every knot that came undone did so because something was taken away: a
feature, a function or an import direction. A consolidation puts its one place in some area,
and if that area is the wrong one it ties a knot. The coherence loop has already done this
once.

Providers has the clearest seam of any block. Its contract is written as code and reports what each
provider implements: 98 provider and method pairs, 89 of them exercised by unit tests. Seven
in eight of the tests' imports into the block go through its surface or its fake clients. It
cannot be rebuilt yet, for four reasons:

- **The shape it returns has never been written down.** In practice it is Linear's GraphQL
  wire format, and each of the other four providers rebuilds that shape on its own.
- **Linear, the default provider and the one the others copy, has no fake client.**
- **The providers disagree on what a write returns.** Three copies of one helper outside the
  block absorb the difference.
- **Credentials are decided outside the block.** Code outside it names a specific provider 53
  times, across 20 files.

The order that makes the rebuild viable is:

1. Write the shape down.
2. Give Linear a fake client.
3. Run one conformance suite across all five providers.
4. Make the writes agree and delete the helpers.
5. Pilot the rebuild on GitHub Projects, the adapter with the fewest methods, with a prediction
   written down first.

**The picture behind the question.** John's picture of where Harbour is going is a ship
rebuilt plank by plank while it sails. Clean-ups work the seams around a block until it can be
rebuilt from scratch behind them; then the next block. Beside the ship sits its ghost: the
same capabilities built clean in one go. Each swap should leave the real ship measurably
closer to the ghost. This paper asks whether the record supports that loop, and where it
should start. We have called the view Theseus.

## Findings

### The code knotted as it grew, and the knots stayed

**Tangles appeared with the fleet and almost never came undone.** A *tangle* is a two-way
pair: each of two areas imports the other. The table shows the code at five points. Before
June there were 2 births and 1 death. From June there were 22 births and 4 deaths, and all 4
deaths came in October. No tangle dissolved between 20 January and 6 October. Births by
month: June 7, July 5, August 3, September 1, October 6.

| Week of | Commit | Files measured | Cross-area imports | Tangles | Product code (10⁶ bytes) | Test code (10⁶ bytes) |
|---|---|--:|--:|--:|--:|--:|
| 5 Jan | `9497c67d` | 7 | 5 | 0 | 0.06 | 0.02 |
| 1 Jun | `28ff6a06` | 94 | 135 | 1 | 1.75 | 1.09 |
| 3 Aug | `a4f9638e` | 239 | 395 | 14 | 5.30 | 5.46 |
| 5 Oct | `6eaf259c` | 400 | 781 | 22 | 9.38 | 16.16 |
| 13 Oct | `38fc3b5c` | 429 | 897 | 19 | 9.66 | 16.87 |

Test code passed product code in the week to 3 August and is now 1.75 times its size. The
import graph reads none of it.

**Each tangle is born from one import.** In 23 of the 24 births, the thinner direction of the
new pair was a single import. The exception is LIN-2384, with two. Today 6 of the 19 tangles
still hang on a single import and 2 more on two. Moving one import each would cut the six.

| Tangle | The one import holding it |
|---|---|
| Auth ↔ Providers | `lib/providers/jira/oauth.js` → `lib/token-refresh.js` |
| LLM ↔ Providers | `lib/providers/linear/index.js` → `lib/openrouter.js` (two cap constants) |
| Providers ↔ Runs | `lib/pr-state-store.js` → `lib/run-evidence.js` |
| Agent API ↔ Pages | `lib/render-runner-setup.js` → `lib/proxy-scopes.js` |
| Other ↔ Platform | `lib/kpi-stats.js` → `lib/report-history-store.js` |
| Other ↔ Runs | `lib/periodicals.js` → `lib/periodical-report-gate.js` |

Three of the six tie Providers to an area above it. Two of those three are about credentials
or a constant in the wrong file.

### Features and consolidations tie knots; only taking something away unties them

**Of 24 births, 16 came from features, 6 from consolidations, 1 from a fix and 1 from routine
upkeep.** A consolidation here is a change whose purpose was to bring copies or call sites to
one place:

- LIN-175 twice: the canonical models.
- LIN-331: the provider registry migration.
- LIN-481: `htmlError` moved onto the page shell.
- LIN-1139: the dispatch item factory.
- LIN-3455: a coherence-loop batch.

LIN-3311 is a borderline call: it lifted a store as part of a feature phase and is coded as a
feature. The codes are in `theseus-events-codes.json`.

**All 5 dissolutions took something away.** Four removed a feature or a function. The fifth,
LIN-675, moved code so that an import direction disappeared.

| Dissolution | What was removed |
|---|---|
| LIN-100, 20 Jan | Labels |
| LIN-3325, 6 Oct | Share links (dissolved two tangles) |
| LIN-3466, 11 Oct | `htmlError` |
| LIN-675, 11 Oct | Every `lib/` → `routes/` import, by inverting the provider auth wiring and moving the starter seed out of `routes/workspace.js` |

None of the 29 events is a helper, a wrapper or a rule that untied a knot.

**One tangle shows the whole cycle.** On 14 June, LIN-481 moved `htmlError` onto the shared
page shell. That made `lib/errors.js` (Platform) import `lib/components/page.js` (Pages), and
tied Pages ↔ Platform. It stayed tied for four months. On 11 October, LIN-3466 deleted
`htmlError` in favour of one error page, and the knot went with it. `the-second-copy.md` argues
from fifty years of research that a migration finishes only when its last step deletes the
old path. This is the same result at the scale of whole areas.

**A consolidation that puts its one place in another area ties a knot.** On 6 October, removing
share links untied Other ↔ Platform. Five days later LIN-3455, a coherence-loop batch, gave
eleven files one shared timestamp helper in `lib/utils/time.js`. Two stores filed under Other
began importing Platform, and Platform already imported one of them through `lib/kpi-stats.js`.
The pair re-knotted, held by that one import.

The Seams & Tangles baseline records the same pull at larger scale. Citing LIN-3549's
prototype, it says the loop's batch 3 raised cross-area links from 255 to 310, because "one
place per decision" often put the place in another area. It records this as a cross-review
tension and leaves it there (`docs/reviews/seams-tangles-review-2026-10-13.md:35`).

**The first days of October show both hands at once.** From 1 to 5 October five tangles were
born, as many as in any seven days on record: the runner prompt (LIN-3098), the PR-state
lift (LIN-3311), the guest run (LIN-3312, two) and the first screen (LIN-2944). Two of them
were gone the next day, when LIN-3325 removed share links.

### Providers has the clearest seam

**Providers' contract is written in code and can be checked by running it.**
`lib/providers/interface.js:71` declares 33 surface methods. Each provider's
`getCapabilities()` reports which ones it overrides.

| Provider | Methods implemented | Pairs no unit test exercises |
|---|--:|---|
| Linear | 31 | `fetchProjectsList`, `fetchTeams`, `fetchOrganization`, `fetchViewer`, `fetchIssueComments`, `fetchFocusedChild`, `viewer`, `projects` |
| Local | 26 | none |
| GitHub | 18 | `fetchProjectsList` |
| Jira | 14 | none |
| GitHub Projects | 9 | none |

That is 98 pairs, 89 of them exercised. The 122 unit test files that touch the block ran in
one pass: 3,020 tests, all passing.

**Tests mostly reach the block through its seam.** Of 146 test imports into `lib/providers/`:

- 108 go to a provider's surface (an `index.js`, `interface.js` or `registry.js`);
- 19 go to a fake client;
- 19 go to internals: the canonical models (6), the state map (3), GitHub's app auth (3), Jira's
  OAuth and document-format modules (3), and the API clients (4).

GitHub, GitHub Projects and Jira take an injected `clientFactory`. Local is its own backend.

### But its spec is written once per provider, and it is Linear's

**What an issue looks like is nowhere in the code.** `lib/providers/models.js` holds the state
names, the source names and the priority mapping, but not the shape of an issue, a project or
a comment. In practice the shape is Linear's GraphQL wire format, and the other providers
rebuild it in their own normalisers. Linear's `.nodes[]` connection wrapper appears in key
paths recorded from every other provider: 69 from Local, 8 each from GitHub and Jira, and 4
from GitHub Projects.

Where four providers' results were recorded, they agreed on 17 of 83 key paths for
`fetchIssueContext` and 25 of 38 for `fetchProjects`. Some of that gap is thin test fixtures,
not providers that really disagree (see Limits).

**On writes the providers really disagree, and code outside the block absorbs it.** Linear's
`createIssue`, `updateIssue` and `createComment` return Linear's mutation payloads, an envelope
of `{ success, issue }` or `{ success, comment }` (`lib/providers/linear/index.js:1905-1909`,
`1972-1976`, `1985-1989`). GitHub, Jira and Local return the bare entity. Three copies of one
helper turn the bare form back into the envelope:

- `normalizeWritePayload` at `lib/proxy-graphql-errors.js:168-171`;
- `normalizeIssueWrite` at `routes/workspace-api.js:4027-4030`;
- `normalizeCommentWrite` at `routes/workspace-api.js:4035-4038`.

The comment above the last two says GitHub already returns the envelope, but every GitHub
`createIssue`, `updateIssue` and `createComment` result recorded in the run was bare. A gap in
the contract became a decision held in three places, and the note describing it has already
drifted from the code.

**Linear, the default provider and the shape the others copy, is the least ready to rebuild.**

- It has no fake client. Its tests stub `GraphQLClient.prototype.request` from `graphql-request`
  (`tests/unit/linear-provider-api.test.js:58-60`), which ties them to the library a rebuild
  might replace.
- Eight of its 31 pairs never run in a unit test.
- Only 3 of the 331 recorded results came through its provider class. The other providers gave
  15 to 119 each.

**Credentials are decided outside the block.** Code outside `lib/providers/` names a specific
provider 53 times in 20 files: comparisons against a provider's name, and uses of the
`SOURCE_*` constants. Apart from the reference resolver's source lists, most are in the files
that handle workspaces, credentials and tokens:

| File | References to a specific provider |
|---|--:|
| `lib/workspace.js` | 9 |
| `lib/proxy-ref-resolver.js` (source lists, not comparisons) | 9 |
| `server.js` (the provider auth branches) | 7 |
| `lib/connection-credential.js` | 5 |
| `lib/workspace-token-refresh.js` | 4 |
| `lib/workspace-token-resolver.js` | 2 |

The interface declares `refreshCredential`, but only GitHub and GitHub Projects implement it
(`lib/providers/github/index.js:626`, `lib/providers/github-projects/index.js:541`). Linear and
Jira refresh through branches in those files. Jira's OAuth module reaches back up into
`lib/token-refresh.js`, which is the import holding Auth ↔ Providers. The source list in
`lib/proxy-ref-resolver.js:28-40` says in its own comment that it has never included GitHub
Projects.

**Most of the block is comments: 291,373 of 473,675 bytes (62%).** They record why each choice
was made, with ticket numbers and rulings. A rebuild that drops them loses the reasons. A
rebuild that carries them into test names, a schema and the papers keeps them where they can
be checked.

## Method

**Population.** All 1,941 first-parent commits on `main` from `a82b8758` (4 January) to
`38fc3b5c` (13 October). Each commit's tree was read through `scripts/code-shape/seams.mjs`
with today's `areas.json`, so every commit is sorted into areas by the guide as it stands now.
`seams.mjs` parses the static imports of `.js` and `.mjs` files under `lib/`, `routes/` and
`public/`, plus `server.js`. Tests are out of scope.

**Tangle events.** A tangle is born at the first commit where a two-way area pair appears, and
dissolves at the first commit where it is gone. For each birth, the *thin direction* is the
side with fewer imports, and its imports are the edges recorded. Each event was coded by hand
from the commit subject, the ticket's title (read through the proxy) and the edge. The six
classes are defined in `theseus-events-codes.json`.

**Weekly shape.** The last first-parent commit on or before each Monday from 5 January. Product
code is `.js`, `.mjs`, `.css` and `.html` files outside `scripts/`, `docs/` and `prototypes/`
that the guide places in an area. Test code is `.js` and `.mjs` under `tests/`.

**Providers.**

- *Capabilities:* `getCapabilities()` on every registered provider.
- *Exercise:* the unit test files whose source mentions `lib/providers/`, `getProvider` or
  `providers/index`, run once under `NODE_V8_COVERAGE`. A pair counts as exercised when the
  method's function in that provider's `index.js` has a first-range count above zero.
- *Shapes:* a preload (`shape-recorder.mjs`) wraps every surface method on each registered
  provider's prototype. It records the key structure of each result; arrays are collapsed to
  the merged shape of their first five elements.
- *Test reach:* each `../../lib/providers/…` import in `tests/unit`, classed by path.
- *Outside checks:* comparisons against a provider-name literal, and any use of a `SOURCE_*`
  constant (imports and lists included), in non-comment lines of `lib/` (excluding
  `lib/providers/`), `routes/` and `server.js`. The dispatch `target === 'local'` names the
  Harbour OS workstation, not the local provider, and is excluded.

**To re-run** (from the repository root, after `npm install`):

```
python3 docs/papers/harbour/theseus-scripts/per-commit.py . 38fc3b5c /tmp/per-commit.jsonl
python3 docs/papers/harbour/theseus-scripts/events.py . /tmp/per-commit.jsonl docs/papers/harbour/theseus-events-codes.json docs/papers/harbour
python3 docs/papers/harbour/theseus-scripts/weekly.py . 38fc3b5c docs/papers/harbour/theseus-weekly.json
python3 docs/papers/harbour/theseus-scripts/providers.py "$PWD" /tmp/theseus-work docs/papers/harbour/theseus-providers.json
```

The per-commit pass runs one Node process per commit and is the slow step. The rest takes
about a minute each.

## Limits

- **The areas are drawn by hand and applied backwards in time.** Some tangles are artefacts of
  the guide:
  - `lib/kpi-stats.js` is a KPI reader that the guide files under Platform, and it holds
    Other ↔ Platform.
  - `lib/pr-state-store.js` is filed under Providers, which makes Providers ↔ Runs partly a
    question of where the line is drawn.
  - The baseline review notes that the heaviest pairs mix a route layer and a lib layer in one
    area.

  The history was not re-run with another guide. Births and deaths are added and removed
  imports, so another guide would move them between pairs, but the counts would change.
- **The import graph sees only static imports.** It cannot see:
  - browser code calling the server (`public/` has 28 `fetch(` calls; `grep -rEo "fetch\(" public --include=*.js`);
  - data shared through the database;
  - a decision copied into two places, since copies do not import each other.

  The knots it counts are a floor on coupling, not the whole of it. Decisions held in
  several places, the subject of `coherence-as-it-grows.md`, are the kind it cannot see.
- **First-parent history.** Each merged PR is measured as a whole, so a knot tied and untied
  inside one PR is invisible. The two births before June came from PR merges with no ticket.
- **One coder.** The event codes were made once, from subjects, titles and edges, and have not
  been coded a second time. LIN-3311 could fairly be a consolidation, which would make 15
  features and 7 consolidations.
- **Shape agreement understates how far the providers agree.** Results are recorded only where
  tests call a provider's class, and fixtures differ in richness. So a path recorded for one
  provider may be one the others would produce on fuller data. The write-envelope split was
  confirmed in the code, not only in the recordings.
- **Exercise may overstate Linear's coverage.** V8 names a class method and a module-level
  function the same way, and Linear's `index.js` defines module functions with the method
  names. A module function that ran would count its method as exercised. If anything, 89 is too
  high.
- **Outside checks are a rough count.** They include `SOURCE_*` names that are not
  comparisons (all 9 in `lib/proxy-ref-resolver.js`), and miss switch statements and maps keyed
  by provider name.
- **Comment share counts block comments and whole-line `//` comments.** A comment opener inside
  a string would be counted too, so 62% may be slightly high.
- **This paper is unchecked.** A paper is checked by a second document, and that check is owed.

## Next

1. **Swap the first plank and score it.** Do the work in this order:
   1. Write the issue, project, comment and team shapes as schemas in `lib/providers/models.js`.
   2. Give Linear a fake client behind a `clientFactory`.
   3. Run one conformance suite over all 98 pairs against those schemas.
   4. Make the write results agree and delete the three helpers.
   5. Cut Providers' three single-import knots.
   6. Rebuild GitHub Projects from scratch against the suite, then delete the old adapter.

   Before step 6, write down the predicted size, knots cut and sessions; afterwards, score the
   prediction. Credentials wait for a ruling on whether `refreshCredential` owns the refresh for
   every provider. This is a loop for the code tidy, not a paper; scoring its prediction is the
   first proposal below.
2. **Read Seams beside Drift when choosing each consolidation's one place.** Re-run
   `seams.mjs` before and after every coherence-loop batch. A batch that ties a knot moves its
   one place to the area that already owns the decision.
3. **Add browser calls, shared data and copies to the map.** Teach the seams measure the three
   kinds of coupling it cannot see. Browser calls can be matched to routes through one route
   manifest that the server and `public/` both use. Shared data is which areas write and read
   each collection. Copies come from the coherence register's decisions. Then re-run this
   history.
4. **Write the essay this paper is an exhibit for.** Published accounts of agentic development
   at scale mostly measure flow: how fast changes land. Harbour's periodicals and this paper
   measure convergence: whether each change leaves the code closer to its clean form. Which one
   should a solo operator on a fixed budget steer by?

`proposals.md` carries three lines from this paper: the plank-swap score, the blind spots, and
an essay on flow and convergence for which this paper is the exhibit.
