# adf.js rebuild kit

Measures one candidate implementation of the Jira ADF ⇄ Markdown codec
(`lib/providers/jira/adf.js` in Harbour, three exports: `adfToMarkdown`,
`markdownToAdf`, `adfHasUnrenderableContent`) so that the old code and any
rebuilt version are scored **identically**. Every script takes the
implementation file as an argument; nothing here is specific to the old code.

Nothing in `kit/` touches the network, a Harbour/Linear API, or the repo
checkout. Test processes are started with a preloaded guard
(`lib/no-network.mjs`) that refuses any non-loopback socket and any connect to
the configured proxy port, and logs the attempt.

## Setup

```sh
# a scratch tree at the experiment commit (never the live checkout)
kit/setup-tree.sh /home/user/LinearViewer 2a07f3ea <scratch>/tree /home/user/LinearViewer/node_modules
# the kit's only dependency is acorn 8.12.1 (a LinearViewer devDependency):
ln -s /home/user/LinearViewer/node_modules kit/node_modules   # or: (cd kit && npm install)
```

Scripts default to `--tree ../tree` (sibling of `kit/`) and the slot
`lib/providers/jira/adf.js`. Node ≥ 22.

## Scripts

| script | measures | output |
|---|---|---|
| `shape.mjs <impl> [--out f]` | static shape facts (acorn) | JSON |
| `mutate.mjs <impl> [--tests f]… [--jobs N] [--timeout ms] [--out f]` | test-suite strength against planted faults at every applicable site | JSON |
| `mutate-report.mjs <mutants.json> [--vs <mutants2.json>] [--out f.md]` | Markdown summary; `--vs` compares two test sets on the same candidate | Markdown |
| `survivor-probe.mjs <mutants.json> [--private] [--out f]` | replays the corpus through each surviving mutant: does any input tell it apart from the original? | JSON |
| `build-corpus.mjs [--impl f] [--tests f]…` | builds the public replay corpus in `kit/corpus/` | JSON files |
| `outputs.mjs <impl> --out f.jsonl.gz [--private --private-out f]` | records one implementation's outputs on the corpus | gzipped JSONL |
| `diff.mjs <old> <new> [--private] [--out f] [--private-out f]` | behavioural differences old vs new, shrunk + grouped | JSON + console |
| `observe.mjs <impl> [--private] [--out f] [--private-out f]` | behavioural facts of ONE implementation (throws, round trips, gate) | JSON |
| `setup-tree.sh` | extracts a commit into a scratch tree | — |

### shape.mjs

Facts only, no composite score. Definitions (also embedded in the output's
`definitions` key):

- **code lines**: lines with ≥1 non-whitespace character outside a comment
  (code + trailing comment counts as code); **comment lines**: comment text and
  no code; **blank**.
- **functions**: every function declaration, function expression and arrow
  (callbacks and one-line arrows included); `byKind` splits them.
- **longest function**: by span (first to last line) and by code lines inside
  the span (nested functions included).
- **max nesting**: ESLint `max-depth` — +1 entering `if`/`switch`/`try`/
  `for`/`for-in`/`for-of`/`while`/`do`/`with`; `else if` adds no level; each
  function restarts at 0.
- **cyclomatic complexity**: ESLint `complexity` style — 1 per function, +1
  per `if` (incl. else-if), `?:`, `&&`, `||`, `??` (anywhere — each
  short-circuits), `for`, `for-in`, `for-of`, `while`, `do-while`, `catch`,
  `case` with a test, logical assignment, default value. Optional chaining is
  **not** counted (reported separately as `optionalChains`). Module-level code
  is its own unit (`<module>`, base 1); `total` sums all units.
  `totalConditionsOnly` is the classic McCabe variant that counts `&&`/`||`/`??`
  only inside the test of an `if`/`?:`/loop. `decisionPointsByKind` lets you
  recompute any other variant.
- **regex literals** (`new RegExp` reported separately), **top-level
  declarations** (functions, classes, each variable declarator; imports
  separate), **exported names**; `perFunction` has every unit's numbers.

### mutate.mjs

Generates **every** mutant of a fixed operator set (no sampling), plants each
into the tree's slot file in its own worker copy of the tree, and runs
`node --test <test files>` with a per-mutant timeout. Before the sweep the
unmutated candidate must pass the tests 3 times (the median is reported as
"one test-file run"); if it does not, the run aborts and lists the failures.

Operator set `adf-kit-ops/1` (mutants are splices over acorn node ranges, so
comments are never mutated; mutants whose text duplicates another are dropped):

| operator | rule |
|---|---|
| `negate-cond` | test of `if` / `?:` / `while` / `do-while` / `for`: `T` → `!(T)` |
| `eq-flip` | `===` ↔ `!==`, `==` ↔ `!=` |
| `boundary` | `<` ↔ `<=`, `>` ↔ `>=` |
| `logical-swap` | `&&` → `\|\|`, `\|\|` → `&&`, `??` → `&&` |
| `bool-flip` | `true` ↔ `false` |
| `string-empty` | non-empty string literal → `''`; non-empty untagged template literal → `''` (skips import/export sources, directives, object keys) |
| `string-fill` | `''` → `'__MUTANT__'` |
| `not-remove` | `!X` → `(X)` |
| `arith` | `+` ↔ `-`, `*` ↔ `/`, `%` → `*`; `+=` ↔ `-=`, `*=` ↔ `/=`; `++` ↔ `--` |
| `return-value` | `return <literal>` → `return undefined` (literal = string/number/boolean/regex/template/array/object literal; `null` → `undefined`, `undefined` → `null`); same for an arrow whose body is such a literal |
| `delete-call` | an expression statement that is a call → `;` |
| `index-swap` | `x[0]` ↔ `x[1]` |
| `regex-anchor` | regex literal: drop a leading `^`; separately drop a trailing unescaped `$` |
| `number-shift` | numeric literal `n` → `n+1` and `n-1` (except `x[0]`/`x[1]`) |

Status per mutant: **killed** (≥1 test failed; the failing test names are
recorded), **survived** (all passed), **timeout** (no result within
`max(10 s, 20 × baseline)`; process group killed), **invalid** — `syntax`
(acorn rejects the mutant; not run) or `import` (tests failed AND importing the
module alone throws). `killRate = killed / (killed + survived + timeout)`;
`score = (killed + timeout) / (same)`. Survivors carry line, column, operator,
original and mutated snippet, the source line, and the owning top-level
function/region (`<module:NAME>` for a top-level constant).

Several `--tests` may be given (comma-separated or repeated). To compare test
sets, run twice on the same candidate and use
`mutate-report.mjs run1.json --vs run2.json`.

### survivor-probe.mjs

For every survivor of a `mutate.mjs` run, regenerates the mutant (the
implementation's sha256 must still match), loads the original and that one
mutant in a memory-capped worker, and replays the whole corpus through the six
functions `diff.mjs` compares. A survivor is **distinguished** if any input
changes any output, or if the mutant hangs / exhausts memory on a batch the
original handles (5 s watchdog per 100-input batch; probing of a mutant stops
after 3 such batches). Distinguished survivors are test gaps the corpus can
witness (each carries its smallest public differing input); **undistinguished**
ones are probably equivalent mutants, or behaviour the corpus never reaches.
With `--private`, private inputs contribute counts only.

### Corpus (`build-corpus.mjs`, `kit/corpus/`)

- **tests-adf / tests-md** — every argument the three exports received while
  the test files ran (default: the codec test file AND
  `tests/unit/jira-provider.test.js`, which reaches the codec via
  `lib/providers/jira/index.js`). Recorded by a temporary wrapper module in a
  copy of the tree (`lib/recorder.mjs`), encoded at call time, deduplicated by
  canonical JSON; each item keeps which test file(s) produced it (`tag`) and
  which export(s) received it (`fns`). Inputs a test computes FROM an output
  (round-trip tests) were recorded against the implementation given by
  `--impl` (default: the tree's own slot, i.e. the old code).
- **gen-adf** — 3,000 seeded ADF documents (`lib/gen-adf.mjs`, seed
  20261015) over the ADF node/mark vocabulary in three profiles: `writer`
  (shapes `markdownToAdf` itself emits, adversarial text), `spec`
  (schema-valid documents across the whole vocabulary: panels, expands,
  tables, media, mentions, emoji, cards, dates, status, every mark), `wild`
  (unknown node types, empty/missing/null content, missing/wrong attrs, bad
  marks, nulls and primitives where nodes belong, deep nesting, non-doc
  roots); sizes small/medium/large.
- **gen-md** — 3,000 seeded Markdown strings (`lib/gen-md.mjs`, seed
  20261016): ATX/setext headings (incl. 7 `#`), emphasis (`*`/`_`/`**`/`__`/
  `***`, nested), strike, code spans, fenced code (``` / ~~~ / ````, with/
  without language, unclosed, blank lines inside), indented code, nested and
  ordered lists (odd starts, `1)`), task lists, blockquotes (nested, lazy),
  links / titles / refs / images / autolinks / bare URLs, GFM tables, HTML
  inline and blocks, entities, escapes, Windows paths, unicode, CRLF, tabs,
  trailing spaces, stray markers, and 10 non-string inputs.
- **real-md (private)** — `../private-corpus/real-markdown.json`, read in
  place and only with `--private`. It is never copied into `kit/`; scripts
  refuse to write `--private-out` under `kit/`, and the public `--out` file
  carries only counts for private items.

### diff.mjs

Loads both implementations as separate module instances inside worker threads
(4 by default) behind a per-call watchdog (5 s; a hang costs one `timeout`
result, not the run). For every corpus input it computes:

| key | input | function |
|---|---|---|
| `a2m` | ADF | `adfToMarkdown(x)` |
| `gate` | ADF | `adfHasUnrenderableContent(x)` |
| `rt_adf` | ADF | `markdownToAdf(adfToMarkdown(x))` |
| `m2a` | Markdown | `markdownToAdf(x)` |
| `rt_md` | Markdown | `adfToMarkdown(markdownToAdf(x))` |
| `gate_m2a` | Markdown | `adfHasUnrenderableContent(markdownToAdf(x))` |

Comparison: strings `===`; ADF `util.isDeepStrictEqual` — a difference that
disappears after `JSON.parse(JSON.stringify())` is reported separately as
`json-equal` (identical on the wire); booleans `===`; thrown errors by
constructor name + message; both timing out counts as identical. Every
differing (input, function) cell is then **shrunk** (greedy: drop array
chunks, hoist children, drop keys, shorten strings — never renaming a `type`)
to a small input that still differs in the same class, and grouped by the
shape signature of that minimal input (node types, mark types, attrs keys,
`level`/`order`/`language`/`href` values abstracted, text with letters/digits/
non-ASCII collapsed to `a`/`0`/`u` and punctuation/whitespace kept). Each
group reports a count, sources, ids, and its smallest example with both
outputs. `coarse` rolls groups up by function × features.

### observe.mjs

The same evaluation for ONE implementation, reported as facts: throws and
timeouts per function (grouped by error, each with a minimal example), gate
verdicts, ADF round-trip class (`equal`, `equal-mod-exceptions` = equal after
removing the four exceptions `adfHasUnrenderableContent`'s docstring
enumerates, `lossy`, `n/a` for non-object inputs or throws) split by the
gate's verdict, Markdown round-trip exactness, normal-form idempotence in both
directions, and the gate flagging the writer's own output. Categories are
shrunk and grouped as in diff. Run it on old and new and compare the files.

## Self-check (`selfcheck/`)

- `tiny-adf.js` + `tiny.test.js`: a tiny implementation with deliberately weak
  tests, including a top-level guard (negating it must be reported *invalid*)
  and a `while` loop (`i += 1` → `i += 0` must be reported *timeout*).
  `node mutate.mjs selfcheck/tiny-adf.js --tests $PWD/selfcheck/tiny.test.js`
- `make-broken.mjs <adf.js> <out>`: plants one behaviour change per export;
  `diff.mjs <adf.js> <out>` must find and group them, and `mutate.mjs <out>`
  must refuse to sweep (the unmutated candidate fails the tests).

## Limitations

- Mutation results are relative to this operator set. Equivalent mutants
  (no observable change) count as survivors; `mutate.mjs` does not filter
  them — `survivor-probe.mjs` separates the ones the corpus can tell apart,
  but "undistinguished" is evidence of equivalence, not proof. Different
  code shapes offer different numbers of sites, so compare kill rates and the
  survivors' substance, not raw counts.
- The slot holds one file. A candidate that imports sibling modules needs them
  present in the tree at the slot's directory.
- The recorded test corpus depends on the implementation it was recorded
  against wherever a test feeds an output back in (round-trip tests). The
  generators are deterministic per seed but only cover what their grammars
  produce; real Jira ADF (as opposed to generated ADF) is not in the corpus —
  only real Markdown is.
- Shrinking is greedy with a budget (default 600 evaluations per example;
  diff shrinks every differing cell up to 50,000, observe at most 300 per category per corpus source), so a
  "minimal" example is small, not provably minimal, and groups are a
  heuristic partition: one root cause can span several signatures, and one
  signature can hide two causes.
- `json-equal` treats `{a: undefined}` and `{}` as the same on the wire;
  everything else is strict.
- Timings depend on the machine and on parallel load (`--jobs`).

## Generic versions (LIN-3628)

`shape.mjs` here measures one file. For a whole commit, with a per-area rollup and the same
definitions, use `scripts/code-shape/shape.mjs` (its `shape-core.mjs` is a copy of
`lib/shape-core.mjs`). Its census, verbatim and perturbation-probe counterparts, and what they
cannot see, are in `scripts/code-shape/README.md`. The scripts here are unchanged.
