# Ticket Jira seal: exact words in issue property harbour.asAsked, formatted block in the description

(as Harbour captured it at the start of this stage)

## Description

## As asked

Piece 1 of 3 of LIN-4445 (parent: "The loop works on Jira: Harbour can create Jira issues, and Jira can hold a task's sealed words"). This piece makes a Jira description hold the person's words byte-exact. It lands alone. Read the parent's scope, Design and full Implementation Plan in LIN-4445's description ("## Design (chosen approach)" and "## Implementation Plan" → "Session 1: the seal", items 1–6), plus the "Design: LIN-4445" and "Plan Review Verdict" comments on LIN-4445.

**Starting point:** the parent's approved plan is this piece's starting point. Follow it. Where the code shows it wrong, change course and say so in a comment on LIN-4445.

**Plan-review due:** no. Covered by LIN-4445's approving plan-review (comment 61e84035-1df2-459f-8def-5afdc7001e64, rev 1).
**Session fit:** fits one session.
**Grounding commit:** `4b5001ddf` (origin/main when the plan was written and reviewed; re-checked at breakdown on 2026-11-13, with no commits on the plan's paths since).

### Approach (shape B: the exact words live in Jira issue property `harbour.asAsked`, and the description shows them formatted)

1. **Pure region module** under `lib/providers/jira/`. It reads and writes the block. The description stays ordinary ADF: an h2 "As asked" heading, `markdownToAdf(words)`, and the end paragraph. Entity property `harbour.asAsked = { v: 1, words, rendered }`, where `rendered` **is a SHA-256 digest of the region's rendering** (review note 3). Store the digest, not the rendering itself.
   * It imports `AS_ASKED_HEADING`, `AS_ASKED_END`, `splitAsAsked` and `sealAsAsked` from `lib/as-asked.js` and never retypes their spellings (area lesson LIN-4362). `adf.js` stays import-free.
   * It finds the region by nodes: an h2 whose text is the heading's text, then a paragraph whose plain text is the end sentence, whatever its marks. It applies `splitAsAsked`'s position rule.
   * If the region's current rendering matches the digest, it serves the exact `words`. Otherwise it serves the current rendering behind the canonical markers, so a human edit in Jira becomes the words, as on Linear. With no heading or no end paragraph, there is no block. A property with no region is ignored.
   * Compare rendered content, never ADF hashes: Jira adds `localId` and similar attributes on ordinary saves.
2. **Every description read in** `lib/providers/jira/index.js` **goes through that one reader:** `_toCanonicalIssue` (\~484), the parent in `fetchIssueContext` (\~863), the context issue (\~873) and `issueDescription` (\~1049). **Every provider-side** `client.getIssue` **asks for** `properties=harbour.asAsked` (review note 2), including the confirmation re-reads in `updateIssue` (\~1267) and `updateIssueLabels` (\~1110). The bulk search path may stay display-only, with converted words.
3. `updateIssue` **writes the property in the same PUT** whenever the new description holds a block, with `words` taken from `splitAsAsked` of what it was handed. A description with no block writes no property.
4. `descriptionRoundTrip` **(\~1064) becomes a synchronous, pure write-then-read simulation** that includes the property. `providerHoldsAsAsked` then turns true for Jira with **no logic change to** `lib/as-asked-seal.js`. Only that file's stale "Jira is skipped" header is retired, along with the same claim in `lib/as-asked.js` and on the `descriptionRoundTrip` comment.
5. **Size guard:** one shared function computes the serialized property size, and `descriptionRoundTrip`, `updateIssue` and (in piece 2) `createIssue` all call it. Confirm Atlassian's documented entity-property limit (32,768 characters) and cite it. An oversized filing reads back non-kept, so the lane files unsealed with the existing log line and never reformats the person's text. An oversized sealed `updateIssue` returns 422 naming the size, and writes nothing.
6. `lib/providers/jira/client.js` and `fake-client.js` gain `properties` on get and update.

### Testing strategy (witnesses)

* Reader tests: kept; edited in Jira; edited below the line; end line deleted; end line re-marked (`_…_` or plain); `localId` added (still kept); stale property with no block (ignored).
* Byte equality of `words` after filing, after a later write of what was read, after a `description/below` write, and after a human edit below the line.
* Flip the Jira cases in `as-asked-create-seal`, `as-asked-dispatch-seal` and `as-asked-readers` from "skipped" to "sealed and kept". Include `* a` bullets, `*em*`, a fence with a blank line, and trailing spaces.
* A test pinning the codec's fixed point (`rt(rt(x)) === rt(x)`).
* A test that fails if `adfToMarkdown` is applied to a **description** field outside the reader. Comment bodies (\~924, \~1295) legitimately keep direct conversion (review note 6), so don't pin a raw grep count.
* Oversize: the body is filed unsealed with the log line, and an oversized `updateIssue` writes nothing.

### Done when

All of the above pass on `fake-client.js`. Jira's `descriptionRoundTrip` holds sealed words byte-exact, D1's rich-content guard is unchanged, and the PR names what it retires (the "Jira skipped/unsealed" seal claims in code headers). Note that once this lands, the first-dispatch seal begins sealing Jira-native tickets on live sites. That is expected: it is logged on failure, and dispatch continues.

*End of what was asked. Steps write below this line; nothing above it changes.*

## Size of the move

**Size:** a small tidy
**Why:** Jira holds the person's words byte-exact, plus one tidy done first: an empty fenced code block in the words no longer files a description that refuses every later write below the line, which the seal exists to allow.
**Cuts:** none
**Decided by:** the standing policy

## Comments

### Comment 2026-11-13T13:47:23.104Z

## Survey open-0: LIN-4450 @ 4b5001ddf

`origin/main` is still the grounding commit, so the plan's line numbers hold: `_toCanonicalIssue` is at 484, `fetchIssueContext` at 863/873, `issueDescription` at 1049, `descriptionRoundTrip` at 1064, and the `updateIssue` re-read at 1267. I ran the codec at this commit against the plan's own witness inputs (sealed, then `markdownToAdf` → `adfToMarkdown`). Three things I found:

**1. The node rule and the markdown rule disagree about what counts as an end line.** `hasMarkerLine` and `splitAsAsked` only match the end sentence with its `*…*` exactly. The planned ADF reader matches "a paragraph whose plain text is the end sentence, whatever its marks". Suppose a person's words contain that sentence in plain text, or as `_…_`. `sealForFiling` seals them, because to it that isn't a marker. Then the node reader closes the region early, the digest misses, and the tail of the words is served as if it were below the line. Nobody is told. The pure `descriptionRoundTrip` will only catch this if it runs the **same** node reader. A markdown-level `checkAsAsked` alone won't. Either make `hasMarkerLine` catch the plain-text form too, or have the node rule take the **last** matching paragraph before non-region content. Decide which up front.

**2. The codec's "the D1 gate never flags what the writer emits" claim is false.** The `adf.js` header says it, but an empty fence (words containing "```" then "```" on the next line) makes `markdownToAdf` emit an empty `codeBlock`. `adfHasUnrenderableContent` refuses that, and `rt(rt(x)) !== rt(x)` for it (I got `false` on both checks). Today that only affects that one ticket. Once Harbour writes the block itself, it becomes Harbour making a ticket whose description can never be written again: every later `description/below` hits 422 on D1. The planned fixed-point test will fail on this input unless the codec is fixed or the input is excluded. Pick one deliberately. The plan says "D1 unchanged", but D1 sees the whole document, the block included.

**3. "Done when" only proves things on `fake-client.js`, and the real risk is live Jira.** Shape B relies on a SHA-256 of `adfToMarkdown(region)` staying stable across Jira's ordinary saves. The plan names one change Jira makes (`localId`), and `adfToMarkdown` ignores attrs, so that one is handled. Nothing shows that Jira's editor leaves alone the content that can change the rendering: trailing spaces before a hardBreak (a planned witness), how adjacent text nodes are split, or empty paragraphs (LIN-2019 already drops these). If any of those shift when someone edits *below* the line, every sealed issue reads as "human-edited". The words then quietly turn into the rendering (`*em*` → `_em_`, `* a` → `- a`, `***x***` → `\***x**\*`, all observed here). That is the exact reformatting the seal exists to prevent. The fake client just merges `fields` and stores whatever it's given, so it can't show this.

Smaller points:
- The bulk search path stays display-only. That means one issue reads differently through search than through `getIssue`, so check that no cache or guard compares the two.
- Atlassian's property limit is in bytes or characters depending on which page you read. JSON escaping inflates `words`, so measure the serialized string.

**What I'd do first:** a 15-minute live probe on a real Jira site, before writing any code:
1. PUT a sealed description holding the witness inputs, with `properties: [{key:'harbour.asAsked', …}]` in the same body. This confirms the edit endpoint accepts `properties`.
2. GET it with `?properties=harbour.asAsked`.
3. Edit a line *below* the block in Jira's own editor and save.
4. GET again and diff `adfToMarkdown(region)`.

If the rendering holds, the plan stands as written and items 1 and 2 above are a few lines and two tests. If it doesn't hold, the digest has to be taken over a normalised rendering. That is a design change, and the ticket says it should be recorded on LIN-4445.


### Comment 2026-11-13T13:51:36.308Z

## Survey global: LIN-4450 @ 4b5001ddf

(= the grounding commit.)

**Where it lands.** `lib/providers/jira/index.js` is 1,478 lines, mostly history comments. `adf.js` is the codec: rebuilt clean-room, quiet since LIN-3570. `lib/as-asked*.js` was just tidied toward one owner (LIN-4360/61/62). The area is getting better. I probed the witness shapes (`* a`, `*em*`, `***x***`, `3.` lists, a fence with a blank line, `a\n\n\n\nb`, trailing spaces). `markdownToAdf`'s output never trips D1, and `adfToMarkdown∘markdownToAdf` reaches a fixed point on all of them. So D1 won't block Harbour-written blocks.

**What the obvious way does**
- **Two stores of the words.** Shape B accepts this: the ADF region plus the property, with a digest deciding between them. It stays safe only while the region module is the one place that knows about both.
- **A second ADF walker.** The reader needs a paragraph's plain text. `adf.js` already has `plainText` (~340), but it is private. Export it rather than retype it. Render the region with `adfToMarkdown({type:'doc',content})`, not a new renderer.
- **The reader accepts more than the writer refuses.** "Whatever its marks" means a plain paragraph of the end sentence in the words ends the region early, and `hasMarkerLine` doesn't refuse that. This is safe only if `descriptionRoundTrip` runs through *the same reader*: then the filing reads non-kept and goes in unsealed. Worth one witness.
- **Scatter.** There are 8 `getIssue` sites. Four never read a description: 703, 1018, 1076, and the pre-read at 1099. `fetchIssueFields` (818) feeds `_toCanonicalIssue` but isn't in the plan's list. Write one read-with-words helper beside the reader, not `properties` threaded through each call.
- **What has to learn, beyond the three headers named:**
  - `dispatch-factory.js:1008`
  - `docs/proxy-integration.md:2070`: agent-facing, says Jira files unsealed
  - `docs/architecture/source-map.md:216` and `:82` (the new module needs a mention)
  - `as-asked-guard.test.js`, whose Jira block (345, 351) will fail, so it notices. The docs won't.
- **A branch left without a witness.** `as-asked-create-seal.test.js:207-227` uses Jira's round trip as *the* provider that cannot hold the block. After the flip, `sealForFiling`'s `reason: 'provider'` branch has no subject in production or in tests. Witness it with a synthetic lossy round trip, or retire it on purpose. `as-asked.js`'s "When the unsealed branches could go" drops "Jira today", but stays permanent because of older tickets.

**Better, at a cost this task can carry:** export `plainText`, add one read helper, put the size function in the region module, retire every claim listed above, and keep the provider branch witnessed.

**Better still, not this task's**
- **Live Jira-native tickets.** The first-dispatch seal writes back through `updateIssue`. D1 refuses any ticket that holds a mention, emoji or panel (common), and logs it once per first dispatch. Tickets that pass get their ADF normalised, and their "words" become the escaped rendering. That is the codec's lossiness showing, which is deeper than this task.
- **The bulk search path** could ask for `properties` (`search/jql` accepts it), so the dashboard would show exact words.
- **Comment weight.** `index.js`'s header and source-map's jira paragraph carry more history than guidance.


### Comment 2026-11-13T14:13:35.898Z

## LIN-4450: summary

PR: https://github.com/JKershaw/LinearViewer/pull/2421 (branch `feat/lin-4450-jira-as-asked-seal`, commit a98d042c6). CI on the PR: unit tests, the proxy-clock unit variant, all four E2E shards and secret scan are green.

**Built:** a Jira description holds the `## As asked` words byte-exact. The exact words live in the issue property `harbour.asAsked = { v: 1, words, rendered }`, written in the same PUT as the description. `rendered` is a SHA-256 digest. The reader and writer are in `lib/providers/jira/as-asked-region.js`. All description reads go through it, and every provider-side `getIssue` asks for the property. `descriptionRoundTrip` runs the same reader, so Jira holds the seal with no change to `lib/as-asked-seal.js`.

**Also fixed:** an empty fenced code block broke later below-the-line writes (422 via D1). It now renders as the bare fence, and the gate accepts it.

**Verified:** full local unit suite (25,320 tests; the one census failure is fixed); new `tests/unit/jira-as-asked-region.test.js` covers the witnesses in the plan, including byte equality across filing, later writes, description/below writes and human edits, the size boundary, and the empty-fence regression. Departures from the plan are recorded on LIN-4445.

**Not verified:** no live check on John's Jira (LIN-4452). Whether the site keeps the rendered digest across an ordinary editor save below the block is open.

**Next:** LIN-4451 (session 2) is blocked on this PR merging. Merge is for review and the orchestrator.


### Comment 2026-11-13T15:11:36.148Z

### Leftovers

- `lib/providers/jira/adf.js` header said the codec is reached only by `index.js` through three exports; the region module reaches it too, through a fourth (`plainText`): tidied
- `lib/providers/jira/index.js`: `issueDescription`'s comment described the append/replace lane as ADF → markdown → `markdownToAdf`; it now goes through `readDescription` and `holdAsAsked`: tidied
- `lib/providers/jira/fake-client.js`: the seed-shape comment did not document the new `_properties` seed or the `properties` read and write: tidied
- `lib/as-asked.js`: "Who uses what" did not name the Jira region module as a user of `sealAsAsked`, `splitAsAsked` and the marker spellings: tidied
- `lib/providers/jira/index.js`: the bulk reads (`fetchProjects`, `fetchIssueContext`'s children) do not ask for `harbour.asAsked`, so a sealed block shows its converted rendering there while single-issue reads serve the exact words: noted, `docs/areas/providers.md` (new note, also holds four Lessons from this change)

Retires: `lib/should-mock-ai.js`: `isHermeticTestToken` is a third test-token check beside `isTestToken` and inline `isTestMode` (llm-and-prompts). The identical inline checks in `routes/proxy-compute.js`, `routes/task-chat.js`, `routes/workspace-api-steps.js` and `server.js` now call it, and behaviour is unchanged.

PR: https://github.com/JKershaw/LinearViewer/pull/2421, head `f9fa4a80ca19503bebbf5abd81dc83d3e86296b6`. CI is green on that head. The "Unit tests (proxy, clock +400d)" job was rerun once after GitHub's hosted runner lost communication with the server; no test failed.


### Comment 2026-11-13T15:18:12.503Z

## Review — LIN-4450

PR https://github.com/JKershaw/LinearViewer/pull/2421, reviewed at head `f9fa4a80ca19503bebbf5abd81dc83d3e86296b6` (base `4b5001ddf`). It merges cleanly onto origin/main `cfd152fa4`. Since the ticket was created, main has touched none of the PR's 22 files.

CI: green on `f9fa4a80c` (ci-success, unit, unit-proxy clock +400d, E2E 1–4/4, secret scan). I also re-ran these locally, all green: `jira-as-asked-region` 39/39, `as-asked-create-seal` 14, `as-asked-dispatch-seal` 29, `as-asked-guard` 28, `as-asked-readers` 22, `as-asked` 32, `as-asked-marker-census` 15, `jira-provider-adf-codec` 285.

### Scope against the plan
The diff stays within the plan's places: the region module, `index.js`, `client.js`, `fake-client.js`, `adf.js` (exporting `plainText`, plus the empty-fence tidy), the seal headers, and the docs Survey global named. It has two extras, both declared:
- The `isHermeticTestToken` consolidation, named on the `Retires:` line. That line names a real waiting entry, and the diff removes it from `docs/areas/llm-and-prompts.md`. I checked the swap is behaviour-identical (`NODE_ENV==='test' && token==='test-token'`) at every call site. The inline check in `routes/workspace-api-audit.js:35` is a different predicate (it also matches `provider==='local'`), so it is not a sibling.
- A new `docs/areas/providers.md`.

The departures are recorded on LIN-4445 (comment "Session 1 (LIN-4450): where the code moved the plan"), as the ask requires:
- the end line is chosen by digest rather than by position, which resolves Survey open-0 item 1;
- the size is measured in bytes;
- the round trip throws on a block it cannot hold;
- the empty-fence fix;
- every `getIssue` asks for the property.

### Regression check
I ran `git log -30` on `adf.js`, `index.js`, `as-asked-seal.js` and `fake-client.js`. The codec rebuilds (LIN-3556/3557/3561/3564/3565/3570) and the seal work (LIN-4352/4361/4362) are intact. The only change to an earlier decision is the empty `codeBlock`. It was refused by D1 because the old renderer printed `` ```\n\n``` ``, which the writer tore apart. The renderer now prints the bare fence, so the refusal's reason no longer applies. `adfHasUnrenderableContent` still refuses a `codeBlock` whose only run is empty text, one with marks, one containing a blank line, and one with an edge newline. Nothing is reverted or re-applied.

### Gap analysis (each item of `## As asked`, in order)
1. **Region module.** `lib/providers/jira/as-asked-region.js` imports `AS_ASKED_HEADING`, `AS_ASKED_END`, `sealAsAsked` and `splitAsAsked`. It derives the node texts by parsing those spellings, so nothing is retyped. `adf.js` still imports nothing.
   - It finds the region by nodes, and the end paragraph's marks don't matter.
   - If the digest matches, it serves the exact words. If not, it serves the rendering behind the canonical markers.
   - With no heading or no end line there is no block, and a stale property is ignored.
   - It compares renderings, never ADF. **Met.** The position rule became digest selection, a departure recorded as the ask allows.
2. **One reader for every description read.** Every description read goes through `readDescription`: `_toCanonicalIssue`, `fetchIssueContext` (the issue and its parent) and `issueDescription`. All 9 provider-side `getIssue` calls pass `AS_ASKED_READ`, including the re-reads in `updateIssue` and `updateIssueLabels`. Bulk reads stay display-only. **Met.**
3. **`updateIssue` writes the property.** The property goes in the same PUT, with words from `splitAsAsked`. A description with no block writes no property. **Met.**
4. **`descriptionRoundTrip`.** It is now pure and synchronous: `holdAsAsked` then `readDescription`, the same reader the reads use. `as-asked-seal.js` changed only in its header. The "Jira is skipped" claims are retired in `as-asked-seal.js`, `as-asked.js`, the `descriptionRoundTrip` comment, `dispatch-factory.js` and `docs/proxy-integration.md`. **Met.**
5. **Size guard.** `holdAsAsked` is the one place that computes size. `descriptionRoundTrip` and `updateIssue` both call it, and `createIssue` will in LIN-4451.
   - The limit is 32,768, measured as UTF-8 bytes of the serialized JSON (the stricter reading), with the source cited.
   - An oversized filing goes in unsealed and verbatim.
   - An oversized `updateIssue` returns 422 naming the byte count, and writes nothing (the test asserts the stored ADF is unchanged). **Met.**
6. **Client and fake.** `client.js` sends `properties` on GET and passes the PUT body through. The fake returns only the keys a read asks for. **Met.**

Testing strategy:
- The reader witnesses are all present.
- Byte equality is checked across filing, a re-write of what was read, a below-the-line write and a human edit below, for 10 witnesses (`* a`, `*em*`, `***x***`, a fence with a blank line, an empty fence, trailing spaces, `3.`, and the end sentence as plain and as `_…_` text).
- There is a fixed-point test.
- There is a guard that fails if a description is read through `adfToMarkdown`.
- The Jira seal tests in create-seal, dispatch-seal and guard flip from skipped to sealed. `as-asked-readers` had no Jira case at base, so there was nothing to flip there.
- The `reason:'provider'` branch keeps a synthetic lossy witness, which closes Survey global's point about an unwitnessed branch.
- One small gap: the oversize filing test asserts it was filed unsealed and verbatim, but not "with the log line". See the fix below.

Done when:
- All of the above pass on the fake: **met**.
- Jira's `descriptionRoundTrip` holds sealed words byte-exact: **met**.
- The PR names what it retires: **met**.
- "D1's rich-content guard is unchanged": **met in substance**. No rich-content rule changed (mention, emoji, panel, media, table and so on are untouched). The one change is the codec-shape rule for an *empty* fence. Survey open-0 item 2 showed that a Harbour-written block would otherwise leave a ticket that refuses every later below-the-line write. The fix is declared in "Size of the move" and on LIN-4445.

### Mutation checks (each reverted; working tree clean afterwards)
| Mutation | Result |
|---|---|
| M1 reader ignores the property | red (reader, byte-equality) |
| M2 writer returns `property: null` | red (region and dispatch-seal) |
| M3 `issueDescription` drops `AS_ASKED_READ` | red, including "every provider-side read asks" |
| M3b the `updateIssue` re-read drops it | red ("every read asks") |
| M4 size guard off | red (all 4 size tests) |
| M5 empty-fence render reverted | red (fixed point and codec round trip) |
| M6 reader takes only the first end | red (end-sentence witnesses) |
| M7 writer takes only the first end | red (same) |
| M8 `updateIssue` never sends the property | red |
| `_toCanonicalIssue` back to `adfToMarkdown` | red (the one-reader guard) |

Probe: I ran `holdAsAsked` then `readDescription` on 16 more shapes: a trailing list, a lazy continuation, a setext heading, `---`, an unclosed fence, HTML, a reference link, a table, a quote, indented code, the end sentence inside the words, unicode, and `## As asked` inside the words. All were held byte-exact, none tripped D1, and none brought a new 422 to a later write.

### Isolated, or one of a class?
The class is "a provider whose stored form cannot give back the markdown it was handed". Jira is its only member: GitHub and Local store markdown verbatim. Its remaining Jira instance is `createIssue`, which is LIN-4451's planned scope and will call the same `holdAsAsked`. That makes it inside the parent and outside this piece. The bulk search path is outside: it is display-only by the ask, it already has a home (the `docs/areas/providers.md` Waiting entry), and no guard compares bulk reads with single-issue reads. I checked the `readFact`/`askedText`/`checkAsAsked` callers: bulk reads go through `readDescription` without a property, so they still see a well-formed block. Otherwise this change is isolated.

### Fix for close-out
- `tests/unit/jira-as-asked-region.test.js`, test "an oversized body is not sealed…" (~line 262): capture `console.log` during the `sealForFiling` call. Assert exactly one line equal to `[as-asked] seal skipped: provider jira cannot hold the block (test)`. This pins the "with the log line" clause of the oversize witness.

### What CI Did Not Prove
- **Inside** (bounded class: the property semantics, item 6). Live Jira accepts `properties: [{key:'harbour.asAsked', value}]` on `PUT /rest/api/3/issue/{key}` and returns it as `properties['harbour.asAsked']` on `GET ?properties=harbour.asAsked`. The fake is built to that shape, but no test reaches Atlassian. **After the deploy:** the LIN-4452 live check on John's site, as one sealed `updateIssue`. The condition that separates right from wrong: the re-read's `properties['harbour.asAsked'].words` is byte-equal to the words written. An absent `properties` key means the PUT dropped it.
- **Inside** (the reader, item 1: "compare rendered content"). Live Jira's editor keeps the region's `adfToMarkdown` rendering, and so the digest, when someone edits and saves a line *below* the block. If it does not, every sealed issue silently serves converted words (`*em*`→`_em_`). The fake cannot normalise ADF (providers.md lesson, LIN-4450). **After the deploy:** the LIN-4452 live check, following plan-review note 1. File a lossy body (`* a`, `*em*`, trailing spaces, `3.`). Edit one line below the block in Jira's own editor and save. Re-read. Right means the words are byte-equal to what was filed and the digest-match branch was taken (`digest(region) === property.rendered`). Wrong means the words equal `adfToMarkdown(markdownToAdf(words))`.
- **Inside** (the consequence named in Done-when). Once this is live, the first dispatch of a Jira-native ticket writes the block through `updateIssue`. **After the deploy:** dispatch one never-dispatched Jira-native ticket on John's site. Right is either of two outcomes, with the dispatch row enqueued in both: the ticket shows the formatted block with no "seal skipped" line, or a ticket carrying mentions/emoji/panels logs the existing D1 refusal line.
- **Rollback (named).** Revert PR #2421's squash commit. Properties already written stay on issues but nothing reads them. A sealed description then reads through `adfToMarkdown` as `_End of…_`, which `splitAsAsked` does not recognise, so those tickets fall back to the existing unsealed readers. That is reversible in effect, with no data loss.

### Verdict
Approve — conditional on close-out discharging the ledger

Every sentence of `## As asked` is met. One departure is declared: the empty-fence D1 shape, which I judge consistent with "rich-content guard unchanged". Close-out makes the one named test fix. The three ledger items are post-deploy steps that LIN-4452 owns by the approved breakdown (no credential for John's site exists in a build session), and they are not merge conditions. Merging unblocks LIN-4451.


### Comment 2026-11-13T15:21:22.841Z

## Blind read
Verdict: better. It gives Jira's description read and write a single owner (`lib/providers/jira/as-asked-region.js`: `readDescription`/`holdAsAsked`, and `descriptionRoundTrip` now runs that same pair, so the seal decision and the write can't disagree). It also folds ten inline copies of the test-token predicate onto `isHermeticTestToken` (`routes/proxy-compute.js`, `server.js`, `routes/task-chat.js`, `routes/workspace-api-steps.js`). On the worse side, a Jira issue's `description` now depends on which read produced it: the batch path in `lib/providers/jira/index.js` serves the converted words and the single-issue reads serve the exact ones.

Read: https://github.com/JKershaw/LinearViewer/pull/2421 at `f9fa4a80c` against `4b5001ddf`.

### Inside the area, fix-sized
- `routes/workspace-api-audit.js` (web-routes): lines 35–36 still write `process.env.NODE_ENV === 'test' && (workspace.accessToken === 'test-token' || …)` inline. The sweep moved every sibling copy onto `isHermeticTestToken` and missed this one. Fix: `isHermeticTestToken(workspace.accessToken) || (process.env.NODE_ENV === 'test' && workspace.provider === 'local')`. It keeps its own predicate, as its comment asks.
- `routes/workspace-api-steps.js` (web-routes): `isTestToken` is now a one-line second name for `isHermeticTestToken(workspace.accessToken)`. Fix: have its callers (`workspace-api-issue-read.js`, `workspace-api-issue-write.js`, `workspace-api-prompts.js`) import the helper directly and drop the alias.
- `tests/unit/jira-as-asked-region.test.js` (other-features, for `lib/as-asked-seal.js`; and llm-and-prompts, for `lib/as-asked.js`): the test at line 291, "no longer claim that Jira is skipped", only checks that three phrases are missing from two comment headers. It says nothing about behaviour; `as-asked-create-seal.test.js` already checks that Jira holds the block. Fix: delete it.

### Inside the area, larger
- `lib/providers/jira/index.js` (providers): `client.searchIssues` never asks for `harbour.asAsked`. So the issues that `fetchProjects`/`fetchIssues` (line ~769) and `fetchIssueContext`'s `children` (line ~897) build through `_toCanonicalIssue` come back with the ADF rendering behind canonical markers. `fetchIssueFields`, `fetchIssueContext().issue` and `issueDescription` return the exact property words for the same issue. `jira-as-asked-region.test.js:166` pins this split. It is larger than a fix because closing it is a decision: either every dashboard batch asks `/search/jql` for properties (up to 32 KB per issue), or batch descriptions are documented as not carrying the exact words.

### Outside the area
None.



# Parent ticket LIN-4445: The loop works on Jira: Harbour can create Jira issues, and Jira can hold a task's sealed words

(description as it stands now; comments up to 2026-11-13T15:21:56.087Z)

## Description

## As asked

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** The first outside test will be a small team on Jira who already use agents and are looking to have agents build their product. John has used Harbour on Jira for a few weeks: "it's mostly fine except for the gaps that you've identified." The gaps:

* Harbour can't create a Jira issue, so on Jira the loop can't file a task with the person's words sealed, mint a Periodical, or file what a task's last step files;
* Jira can't yet hold the block that keeps the person's words exactly as asked.

**What we want.** On a Jira-backed workspace, the loop does what it does on Linear: a task can be filed with the person's words sealed, a Periodical can be minted, and a task's last step can file what it files. It's checked on John's own Jira, which is already in real use.

**Done when** on John's Jira a task filed through Harbour keeps the person's words sealed, a Periodical mints, and a task's last step can file.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

*End of what was asked. Steps write below this line; nothing above it changes.*

## Size of the move

**Size:** just the task
**Why:** Jira gains issue creation and a description that keeps the person's words byte-exact through later writes, which opens all three filing lanes; the Surveys' converter, rich-content and capability findings are nearby but none binds on this ask.
**Cuts:** none
**Decided by:** the standing policy

## Design (chosen approach)

The full analysis, with the shapes weighed, is in the "Design: LIN-4445" comment.

**Seal: exact words in a Jira issue property; the description shows them formatted.** The Jira description holds an ordinary block: an "As asked" level-2 heading, the words converted by `markdownToAdf`, and the italic end line. The people on the team see a normal ticket. The same create or edit request also writes an issue entity property, `harbour.asAsked = { v: 1, words, rendered }`, which holds the exact bytes and the block region as rendered at write time. On read, the provider finds the region by its nodes: the heading text, and a paragraph whose plain text is the end sentence. When the region still renders to `rendered`, the provider serves the exact `words`. When it doesn't, someone edited it in Jira, and the provider serves what it now renders, which is Linear parity. `descriptionRoundTrip` becomes write-then-read, property included, so `providerHoldsAsAsked` in `lib/as-asked-seal.js` turns true with no change to that module. It was chosen over a code-block carrier because the first-dispatch seal will also wrap Jira-native tickets. Under this shape those tickets gain only a heading and an end line, not a raw-Markdown code box. A normalised baseline was not chosen because it would need John's ruling, and this shape doesn't.

**Key implementation points**

* A small pure module beside the provider, `lib/providers/jira/`, splits and composes the region. It imports the block's spellings from `lib/as-asked.js` and never retypes them. `adf.js` stays import-free.
* All four description reads in `lib/providers/jira/index.js` go through that one composed reader: the canonical issue, the parent, the context, and `issueDescription`. They fetch with `?properties=harbour.asAsked`. `updateIssue` writes the property in the same PUT whenever the description holds a block.
* `createIssue`: `POST /rest/api/3/issue` with `fields` and `properties`, then a re-read that returns the canonical issue. `createFields()` gains `teamId`, which is the Jira project key. `apiWriteFields()` adds `projectId` (the epic: `parent` on team-managed projects, the Epic Link field on company-managed ones, through the existing resolver) and `parentId`. `stateId` is not declared.
* The issue type is chosen inside the provider through createmeta: prefer "Task", else the first standard non-subtask type, and use a subtask type when there is a parent. A required field with no default beyond the basics gets a 422 that names it. This is cached per site and project.
* `fake-client.js` gains create, createmeta and properties. Tests cover the provider, render and create-route pins, the Jira cases of the three `as-asked-*` tests, a byte-exact test across filing, a later write and a below-the-line edit, and a human-edit case.
* **Retires:** the deep-link create path on Jira (`getCreateTaskUrl` stays overridden only because `ui.write` derives from it), `inlineCreate: false`, the stale LIN-1557 "no native Jira team" comments, the "Jira skipped" seal claims, the README and `docs/proxy-integration.md` creation and sealing lines, `CONSEQUENCE_TEST`'s "cannot create tickets" branch, and the "Linear task" wording in `lib/periodicals.js`. The prompt-text changes are re-measured against the frozen budget and the Periodical tripwire.
* **Done when it's verified live on John's Jira:** file one task, mint one Periodical and make one last-step filing, re-read each and check the block is kept, then write below the line once and re-check.

**Leftovers for the last step:** the fenced-code-with-blank-line bug in `markdownToAdf` (a ticket, because it breaks displayed content); widening the D1 rich-content vocabulary and adding a "holds verbatim text" provider capability (Waiting entries in a new providers notes file).

## Implementation Plan

**What this is for.** John's first outside test is a small team on Jira. Harbour on Jira cannot create an issue, and a Jira description cannot hold the person's words byte-exact, so three things fail there: a task cannot be filed with the words sealed, a Periodical cannot be minted, and a task's last step cannot file what it files.

**What done looks like** (the ticket's Done-when, unchanged): on John's Jira a task filed through Harbour keeps the person's words sealed, a Periodical mints, and a task's last step can file. Each is re-read from Jira and `checkAsAsked` says `kept`.

**Cuts to** `## As asked`**:** none. Every clause is delivered, including "checked on John's own Jira". That check needs access to his site, which a builder may not have. A missing credential is a handoff to John, not a cut (see session 3).

**Drift:** none. The ask, the Size record and the Design comment (13:31) agree. I re-read the code at HEAD `4b5001ddf`. `git log --since=2026-11-13T12:08Z` is empty for the paths involved, so nothing has moved under the ticket.

### Facts this plan relies on (read at HEAD, not from the Surveys)

* `lib/providers/jira/index.js` has no `createIssue`, and `lib/providers/jira/client.js` has no create, createmeta or properties call. Its header and several other comments say creation is "deferred behind LIN-1557". LIN-2018 made teams Jira project keys, so that reason is stale.
* `lib/as-asked-seal.js` decides whether a provider can hold the block from the provider's own `descriptionRoundTrip`. The Jira one is `adfToMarkdown(markdownToAdf(m))` (`index.js:1064`), which fails on every body because the end line comes back as `_…_`. Making Jira's round trip honest turns sealing on without changing that module.
* Every filing lane seals first, then calls `provider.createIssue`: `routes/proxy-writes.js:445/470` (proxy create, which Periodical mints and last-step filings use), `routes/workspace-api-issue-write.js:792/801` (session), `routes/workspace-api-feedback.js:511/518` (feedback). First-dispatch sealing (`lib/dispatch-factory.js:1068`) goes through `issueDescription` and `updateIssue`. So one provider method opens all three asked behaviours.
* Description text leaves Jira at four places in `index.js`, all through `adfToMarkdown`: `_toCanonicalIssue` (484), the parent read in `fetchIssueContext` (863), the context issue (873) and `issueDescription` (1049). It enters Jira at one place, `updateIssue` (1184). `_toCanonicalIssue` is also the bulk path, because `fetchProjects` and `fetchIssueContext` children map every search result through it.
* `adfHasUnrenderableContent` (D1) guards `updateIssue` against the current stored ADF. It is untouched by this plan.
* The codec reaches a fixed point after one pass (the Design comment measured it; the builder re-checks it in a test). That is why a converted description stays stable through later writes. It is not why the words stay exact. The words stay exact because the property holds them.

### Direction

Shape B from the Design comment: **the exact words live in a Jira issue property** `harbour.asAsked = { v: 1, words, rendered }`**; the description shows them as an ordinary formatted block.** It was chosen because Jira-native tickets will be sealed on first dispatch, and under B they gain only a heading and an end line, as on Linear. Set aside, a line each:

* **Code-block carrier (A):** exact, but every ticket a human wrote in Jira becomes a grey raw-Markdown box.
* **Normalised baseline (C):** cheapest, but the stored words would no longer be what the person typed, and the brief says that needs John's ruling.
* **Lossless codec:** ADF marks take no custom attributes and Jira validates them, so it is whack-a-mole.

The cause is fixed here: creation is added at the provider, and the byte-exactness gap is closed in the store, not routed around in the checker. Nothing is left unsolved by routing around it. What stays open is parity, not a workaround: rich content (mentions, emoji, tables) still makes later description writes 422 through D1, and a Jira-native ticket holding one fails its first-dispatch seal, logged, with dispatch continuing. Both get their Waiting entry (session 3).

### Behaviours the builder delivers, each with its witness

**Session 1: the seal (lands alone).** Witnesses are unit tests against `fake-client.js`.

1. A pure region module beside the provider reads and writes the block. It imports `AS_ASKED_HEADING`, `AS_ASKED_END`, `splitAsAsked` and `sealAsAsked` from `lib/as-asked.js` and never retypes their spellings. `adf.js` stays import-free. The reader finds the region by nodes: an h2 whose text is the heading's text, then a paragraph whose plain text is the end sentence, regardless of marks. It applies the same position rule `splitAsAsked` applies.
   * If the region's current rendering equals the stored `rendered`, it serves the exact `words`.
   * If not, a human edited it in Jira, and it serves what the region renders now, behind canonical markers. The person's edit becomes the words, as on Linear.
   * Without the end paragraph, or without the heading, there is no block. This matches Linear's behaviour for a deleted end marker.
   * A property with no region is ignored.
   * Witness: reader tests for kept, edited-in-Jira, edited-below-the-line, end line deleted, an end line re-marked by the editor (`_…_` or plain), `localId` attributes added to the ADF, and a stale property with no block.
2. Comparison is on rendered content, never ADF hashes, because Jira adds attributes such as `localId` on ordinary saves. Witness: the `localId` case above stays `kept`.
3. Every description read in `index.js` goes through the one reader. Single-issue reads (`fetchIssueFields`, context issue, parent, `issueDescription`) fetch with `properties=harbour.asAsked`. The bulk path does not: it is display only, and it shows the block with canonical markers and the converted words. `client.getIssue` gains the `properties` option and the fake honours it.
   * Witness: a test fails if `adfToMarkdown` is applied to a description field anywhere in `index.js` outside the reader. The repeatable search is `grep -n adfToMarkdown lib/providers/jira/index.js`, where only comment bodies may remain.
4. `updateIssue` writes the property in the same PUT whenever the new description holds a block, with `words` taken from `splitAsAsked` of what it was handed. A description with no block writes no property. `client.updateIssue` and the fake accept `properties`.
   * Witness: byte equality of `words` after filing, after a later write of what was read, after a `description/below` write, and after a human edit below the line.
5. `descriptionRoundTrip` becomes write-then-read, property included: `read(markdownToAdf(m), propertyFor(m))`. `providerHoldsAsAsked` then turns true for Jira with no change to `lib/as-asked-seal.js`, apart from its stale header.
   * Witness: the Jira cases of `as-asked-create-seal`, `as-asked-dispatch-seal` and `as-asked-readers` flip from "skipped" to "sealed and kept". Include `* a` bullets, `*em*`, a fence with a blank line, and trailing spaces. These are the failures the Survey measured.
6. **Size guard.** Jira limits an entity property value to about 32 KB (the builder confirms the exact number from Atlassian's docs). `words` plus `rendered` can exceed it on a long description. When the serialized property would be too large, `descriptionRoundTrip` reports a non-kept read-back, so the lane files unsealed with the existing log line and the person's text is never reformatted. `updateIssue` refuses a block that is too large with a 422 that names the size, before any write.
   * Witness: an oversized body is filed unsealed with the log line; an oversized `updateIssue` writes nothing. This is the test that tries what the guard was there to stop.

**Session 2: creation.**

 7. Client `createIssue` (`POST /rest/api/3/issue`, `fields` and `properties`) and `getCreateMeta` calls. Provider `createIssue` creates, then re-reads and returns the canonical issue, as `updateIssue` does. The property comes from `splitAsAsked` of the description given, because every lane has already sealed it. `createFields()` becomes `title`, `description`, `teamId`; `teamId` is resolved as a Jira project key. `apiWriteFields()` adds `projectId` and `parentId`, but not `stateId`: a transition after create is a second, non-atomic write. `projectId` is an epic: `parent` on team-managed projects, the Epic Link field through `_resolveEpicLinkFieldId` on company-managed ones. `parentId` selects a subtask type.
    * Witness: provider tests against the fake for create, create with an epic, create with a parent, and create with a block (property present, re-read `kept`).
 8. Issue type is chosen inside the provider, with no new setting, from createmeta. Prefer "Task", else the first standard non-subtask at hierarchy level 0; use a subtask type when there is a parent. A required field with no default, beyond summary, project, issuetype, description, reporter and parent, returns 422 naming the field and creates nothing. The result is cached briefly per site and project; the key includes the site so one tenant never reads another's.
    * Witness: tests for Task preferred, no Task, subtask, a required custom field refused with its name, and the cache key including the site.
 9. All three lanes work on the Jira fake end to end. The test files are `task-create-route`, the proxy create tests and the feedback-lane test; the Periodical mint is a proxy create with a project key as team. `inlineCreate` turns true by itself through `supports('createIssue')`, so `render.js` shows the in-app form instead of the deep link. `getCreateTaskUrl` stays overridden, because `ui.write` derives from it (`lib/providers/interface.js`), and removing it would hide "+ Add task".
    * Witness: updated pins in `providers.test.js`, `jira-provider.test.js`, `render.test.js`, `render-task-create.test.js` and `task-create-route.test.js`.
10. **Retires** (every change names what it retires):
    * the deep-link create path on Jira
    * `inlineCreate: false`
    * the stale LIN-1557 comments in `index.js` (header, capability profile, `getCreateTaskUrl`, `ui`)
    * the "Jira is skipped today" claims in the headers of `lib/as-asked-seal.js` and `lib/as-asked.js`, and in the `descriptionRoundTrip` comment
    * README line 60 ("creating new issues isn't supported yet") and `docs/proxy-integration.md` ("Jira files unsealed", near line 2070)
    * `CONSEQUENCE_TEST`'s "where the provider cannot create tickets" branch in `lib/prompts/leftover-words.js`
    * the "Linear task" wording in `lib/periodicals.js` (251, 278), which becomes provider-neutral
    * Repeatable search: `grep -rn "LIN-1557\|cannot create tickets\|Jira.*unsealed\|isn't supported yet" lib routes docs README.md`. Any hit that remains is either retired or cited as still true.
11. The prompt-text changes (10's last two items) are re-measured against `tests/unit/prompt-size-budget.test.js` and the Periodical hash in `tests/unit/lin-4313-periodical-prompt-bytes.test.js`. This ticket is named as the reason beside any ceiling it raises. Area lesson `llm-and-prompts` (LIN-4393): rebase first, then re-measure.

**Session 3: live check and leftovers.** This needs John's Jira credentials.

12. On John's Jira: file one task through Harbour, mint one Periodical, perform one last-step filing. Re-read each from Jira and check `kept`. Write below the line once and re-check. Record the createmeta result and whether the site accepted `properties` in the create and edit bodies.
    * If the site rejects `properties` in the body, switch to a separate `PUT /issue/{key}/properties/harbour.asAsked` straight after, and report a failure through the existing `PartialWriteError` envelope. This is still shape B.
    * If createmeta shows a required custom field, that is a finding for a follow-up ticket, not a reason to guess a value.
    * If the session has no credential for his site, park it as a handoff to John (what to run, what to paste back), not as done.
13. File one ticket for the `markdownToAdf` bug where a fenced block containing a blank line splits into fragments. It breaks displayed content, so it is a ticket, not a Waiting entry. Create `docs/areas/providers.md` (the registry's `providers` slug has no note yet) with two Waiting entries, each citing `lib/providers/jira/adf.js` or the provider first: widening the D1 writer vocabulary (mentions, emoji, tables), and an explicit "holds verbatim text" provider capability in place of the Markdown comparison. One home each, per `CONSEQUENCE_TEST`.

### How I know the places are complete

* Description reads: the `grep adfToMarkdown` search above, pinned by a test, so a fifth read added later fails.
* Description writes: `updateIssue` is the only description writer, and `createIssue` becomes the second. The tests drive both.
* Creation lanes: the three call sites above were found by `grep -rn "createIssue(" routes lib`. The Jira fake exercises each of them.
* Docs and prompts: the retire search above. Where reading cannot tell, John's live site is the catch for createmeta and property behaviour.

### The likeliest ways this breaks

1. **John's site differs from the fake:** a required custom field, `properties` refused in the body, a different createmeta shape or pagination, or an oversized property. Mitigated by the 422 that names the field, the separate-PUT fallback and the size guard. Only session 3 can prove it.
2. **The reader misses the region after a Jira edit** (the editor re-marks or splits the end line, or a human changes the heading). The block then reads as absent and the guard stops protecting the words. This is the same as Linear's deleted-marker case, so it is parity. Witness: the human-edit reader tests in item 1.
3. **A stale property outlives its block** and a later seal or read serves old words. Mitigated by ignoring a property with no region, comparing `rendered`, and overwriting the property on every write that holds a block. Witness: item 1's stale-property test and item 4.

### Session fit and review

**needs multiple sessions.** Session 1 holds the region reader's edge cases and the property semantics across client, fake, four reads and the writer; it lands and is verified alone, and when it lands the first-dispatch seal begins sealing Jira-native tickets on John's site. Session 2 holds createmeta, three lanes, the UI flip, and retirements across six docs and prompt files with a prompt-budget re-measure. Session 3 needs a credential no build session has by default. Split at those seams. Each piece lands and verifies on its own, and sessions 2 and 3 are each blocked by the one before.

plan-review due: yes

Reason: more than one session, writes to a real Jira in use, and it changes the sealing contract on a path that rewrites human-authored tickets.

Area notes read: `docs/areas/README.md` and `docs/areas/llm-and-prompts.md`, which binds items 1, 10 and 11 (Lesson LIN-4362: the block's words have one owner; Lesson LIN-4393 and the frozen prompt size: re-measure). `docs/areas/other-features.md` Waiting (`lib/as-asked-seal.js` is homeless) is context only: only its header comment changes. `docs/areas/providers.md` does not exist yet; item 13 creates it.

## Comments

### Comment 2026-11-13T13:14:35.173Z

## Survey open-0: LIN-4445 @ 4b5001ddf

**Short version:** creating a Jira issue is the easy half. The hard half is the seal. "The person's words exactly as asked" means byte-equal Markdown, and Jira doesn't store Markdown. It stores ADF, and Harbour's own converter (`lib/providers/jira/adf.js`) doesn't give back what went in.

**What I found (at 4b5001ddf)**

- `createIssue` is missing from the Jira provider and its client. The comment at `lib/providers/jira/index.js:12` puts this behind LIN-1557 ("no native Jira team to hang a required teamId off"). That reason has gone stale: since LIN-2018, canonical teams *are* Jira project keys. So the create is mostly plumbing: `POST /rest/api/3/issue`, plus `createFields()`/`apiWriteFields()` with `teamId`. That turns on the proxy, session, feedback and periodical lanes through `sealForFiling`, which they already share. The real catch is that Jira also needs an **issue type**, and company-managed projects can make extra custom fields required. Discovering this through createmeta is the part that could fail on John's real Jira.
- The seal already checks Jira honestly and skips it: `descriptionRoundTrip` → `providerHoldsAsAsked` (`lib/as-asked-seal.js:57`). I ran it, and three separate things break a sealed block:
  1. The end line comes back as `*End…*` → `_End…_`. Every filing hits this, and it's the one the code mentions.
  2. **The person's own Markdown changes.** `* a` comes back as `- a`. This ticket's own body uses `*` bullets, so it would fail even with (1) fixed.
  3. **A fenced code block with a blank line inside gets broken apart**: ```` ```\ncode\n\nmore\n``` ```` comes back as two fragments and an escaped fence. That's a converter bug, and pasted logs or stack traces will trigger it.
- **Hazard after filing:** `updateIssue` refuses (422) to write a description whose ADF holds an @-mention, emoji, table, etc. (D1). On a Jira in real use, one teammate's @-mention in the description blocks every later step from writing "below this line". Stage two of the loop then stalls, even though the ticket was filed fine.
- The Periodical gate marker is an HTML comment (`lib/periodicals.js:41`). It survives the round trip, but as a visible text paragraph in Jira. Not blocking, just ugly.

**The deeper question.** Patching the end line alone won't fix this, because (2) and (3) show that any lossy conversion will keep finding new ways to break byte equality. There are two ways out:
(a) Make the round trip lossless for the block. Write the words inside the block in a form ADF keeps exactly, e.g. one code block or preserved text. Then compare on the read-back.
(b) Change "kept" for converting providers to mean "same as the normalised round trip". The words are normalised *once*, at filing time (the filed text is whatever the round trip gives back), and the check compares against that from then on.

(b) is closer to how Linear's escape-normalising already works. The catch is that the stored words would no longer be byte-for-byte what the person typed. Whether that still counts as "exactly as asked" is John's call, not an engineering question. I'd ask him before building.

**What I'd do first**
1. Put a ruling to John: on Jira, does "sealed" mean byte-exact or render-exact?
2. Meanwhile, fix the code-block blank-line bug in `markdownToAdf`. It's real whichever way he rules, and it also hits ordinary description edits.
3. Run createmeta (issue types and required fields) against John's Jira, read-only, before writing `createIssue`. His real config decides how big this is.
4. Then build `createIssue` and drop the stale LIN-1557 comments. That's what it retires: the deep-link-only `getCreateTaskUrl` create path and `inlineCreate: false` on Jira.


### Comment 2026-11-13T13:18:53.569Z

## Survey global: LIN-4445 @ 4b5001ddf

**Where it lands.**
- `lib/as-asked-seal.js`: new and in good shape. Whether a provider can hold the block is decided here, from the provider's declared `descriptionRoundTrip`. Every filing lane goes through `sealForFiling`, and Periodical mints and leftover filings both go through `POST /api/proxy/issues`. So one Jira `createIssue` opens all three asked behaviours, and fixing the round trip turns on sealing with no change in this file.
- `lib/providers/jira/adf.js`: rebuilt clean-room in October, with one grammar shared by the reader, the writer and the D1 gate. It is getting better. Its structural weak spot: blocks split on `\n\n`, so a fenced block with a blank line in it breaks into pieces.
- `lib/providers/jira/index.js` (1478 lines): works, but its comments are out of date. Four comments say creation is "deferred behind LIN-1557 — no native Jira team". LIN-2018 removed that reason. This part is getting worse.

**Done the obvious way** (client + provider `createIssue`, `teamId` = project key in `createFields()`, an issue type from createmeta kept in the provider and not as a new setting):
- Tests that would notice: the pins in `providers.test.js`, `jira-provider.test.js`, `render.test.js` and `task-create-route.test.js`, and the Jira sections of the three `as-asked-*` tests. `fake-client.js` also needs a create.
- Things nothing would notice: README lines 60 and 89, `docs/proxy-integration.md:2070` ("Jira files unsealed"), the stale comments, `CONSEQUENCE_TEST`'s "provider cannot create tickets" branch, and `lib/periodicals.js:251` ("mint one … **Linear** task").
- `inlineCreate` flips to true and `render.js` swaps the deep link for the in-app form. That retires `getCreateTaskUrl` as the create path, which is the retirement to name.

**The seal is the part aimed at a symptom.** `checkAsAsked` compares markdown bytes, but Jira stores ADF, so each read renders whatever the last writer saved. That includes Jira's own editor when a person edits there. Passing the check at filing isn't enough:
1. The conversion has to reach a fixed point (md→ADF→md→ADF stays stable), or later appends and `description/below` writes will shift the block.
2. Later writes must not 422 on ordinary rich content (D1).
3. A human edit in Jira must not break the block without anyone noticing. A broken block reads as no block, so the guard stops protecting the words.

Options: a lossless carrier inside ADF (e.g. a marked codeBlock that only Harbour unwraps, but readers in Jira see it as code), or an issue property holding the exact words (a second copy). A normalised baseline is the third option, and that is John's ruling.

**Better, within this task:** fix fenced code with blank lines, make the codec idempotent and pin that with a test, retire the stale comments and README lines together, and fix the "Linear task" wording.

**Better still, not this task's:** making "holds verbatim text" a real provider capability instead of a markdown comparison, and widening the D1 writer vocabulary (mentions, tables, emoji).


### Comment 2026-11-13T13:31:04.282Z

## Design: LIN-4445 @ 4b5001ddf

**Staleness check.** No commits since this ticket was created. `git log --since=2026-11-13T12:08Z` is empty for `lib/providers/`, `lib/as-asked*.js`, `routes/proxy-writes.js`, `lib/periodicals.js`, `lib/render.js`, `lib/prompts/leftover-words.js`, README and `docs/proxy-integration.md`. HEAD is still the commit both Surveys read. I re-ran their findings myself, and they hold.

### What causes the need

There are two causes, and they are different kinds of problem.

1. **Jira has no `createIssue`.** All three asked behaviours end in `provider.createIssue`: a task filed with the words sealed, a Periodical mint, and a last step's filing. They reach it through the proxy create (`routes/proxy-writes.js`), the session lane (`routes/workspace-api-issue-write.js`) or the feedback lane (`routes/workspace-api-feedback.js`). Each lane already calls `sealForFiling` first. So adding one provider method opens all three. That is plumbing plus choosing an issue type. It is not a design fork.
2. **The seal compares Markdown bytes, but Jira stores ADF, and our codec loses information by construction.** ADF has one emphasis mark and one bullet glyph, and it doesn't record which delimiter was typed. Measured at HEAD: *every* body fails `providerHoldsAsAsked`, even `Please make the button blue.`, because the end line comes back as `_…_`. On top of that, `* a` becomes `- a`, `*x*` becomes `_x_`, a fence with a blank line inside splits into pieces, and a numbered list restarting at `3.` comes back as `1.`.
   One measured fact helps: **the codec reaches a fixed point after one pass.** `rt(rt(x)) === rt(x)` held for every sample (bullets, emphasis, the broken fence, trailing spaces, HTML, tables, numbered lists). So whatever we store in converted form stays stable through later writes. It just isn't byte-equal to what was typed.

**A good outcome:** agents read the person's exact bytes through every later write. People on the Jira team see an ordinary Jira ticket. No new setting. `lib/as-asked-seal.js` doesn't change, because it already decides "can this provider hold the block" from the provider's own `descriptionRoundTrip` (LIN-4352). Jira only has to make that round trip honest and exact.

### A consequence that decides between the shapes

The first-dispatch seal (`lib/dispatch-factory.js`) calls the same `sealForFiling`. **Once Jira can hold the block, every Jira-native ticket gets sealed the first time it is dispatched.** The block wraps the description a human wrote in Jira, and the result is written back. On John's Jira, which is in real use, the team sees that happen to their own tickets. The asked parity ("the loop does what it does on Linear") includes it. But how the block *looks* in Jira matters, because people will see it on tickets they wrote.

### The viable shapes

**A. A code-block carrier inside ADF.** Between the heading and the end line, the words are written as a single ADF `codeBlock` holding the raw Markdown. Jira's editor never reformats code text, so the bytes survive. The provider's reader recognises the heading + codeBlock + end-paragraph triple and returns `sealAsAsked(codeText)`. The D1 gate exempts the carrier, which it would otherwise refuse as "a code block containing a blank line".
- *Cost:* small. It is all provider-side, with one exemption in the gate.
- *Risk / cost to live with:* the person's words show in Jira as a grey monospace box of raw Markdown. Worse, the first-dispatch seal turns every formatted ticket a human wrote in Jira into that box. That is a visible regression on a Jira in real use, aimed at the very team this is for.
- *Fit:* one source of truth, no second copy.

**B. The exact words in an issue entity property. The description shows them formatted. (Recommended.)** The description holds an ordinary block: a level-2 "As asked" heading, `markdownToAdf(words)`, and the italic end line. The team sees normal formatting. Beside it, in the same request, an issue property `harbour.asAsked = { v: 1, words, rendered }` stores the exact bytes and the block region as rendered at write time. Jira supports `properties` on both the create and edit bodies, and `?properties=` on the issue GET, so this costs no extra call and the write is atomic. On read, the provider finds the region by its nodes: a heading whose text is "As asked", and a paragraph whose plain text is the end sentence, whatever its marks. If the region still renders to `rendered`, it serves the exact `words`. If someone has edited the region in Jira, it serves what the region now renders, so the person's edit becomes the words, as on Linear. The block is still recognised because the reader writes the canonical marker lines.
- *Cost:* moderate. It touches the client (`properties` on create, edit and get), a small pure module for splitting and composing the region, and the four description reads in `lib/providers/jira/index.js`, all of which must use it.
- *Risk:* it keeps a second copy. Staleness is decided by comparing renders rather than ADF hashes, because Jira's editor adds attributes such as `localId` on save. A hash would go stale on every human save, while the render only changes when the words do. If someone deletes the end line in Jira, the block reads as absent. That is the same as Linear today, not a new gap.
- *Fit:* `descriptionRoundTrip` becomes write-then-read, including the property, so `providerHoldsAsAsked` turns true with no change in the seal module. The first-dispatch seal adds a heading and an end line and nothing else, exactly what a Linear ticket gains.
- *Prototype (scratchpad, against the real `adf.js` and `as-asked.js`):* for every sample, including `* a` bullets, `*em*`, the blank-line fence and trailing spaces, `checkAsAsked` gives `kept`. The words were byte-exact after filing, after a later write of what was read, and after an edit below the line. A human edit to the region's text came through as changed words.

**C. A normalised ("render-exact") baseline.** Seal `rt(words)` instead of `words`, and treat `_End…_` as the end line on Jira. Thanks to the fixed point, it stays stable afterwards.
- *Cost:* the cheapest.
- *Catch:* the stored words would no longer be what the person typed. The "Size of the move" record says "byte-exact", and the brief records that a normalised baseline is **not authorised**. This shape needs a ruling from John. A and B don't, so I don't recommend asking for one.

**Ruled out.**
- *A lossless codec* (remember delimiters): ADF marks accept no custom attributes, and Jira validates them. This is whack-a-mole, and both Surveys already reject it.
- *A plain-text "verbatim region"* (each line as an unmarked paragraph): it has A's display cost with weaker guarantees, because the editor can re-mark or autolink text where it can't touch code.

### Recommendation: B

B is the only shape that is exact for agents *and* leaves Jira looking like Jira for its people. The second point decides it, because the first-dispatch seal will touch tickets the team wrote themselves. A is a close second and cheaper. I'd take it if John would rather the ask read in Jira as a visibly frozen box.

**What would change my mind**
- John's site refuses `properties` inside create/edit bodies. That's unlikely: they are documented fields. If it happens: write the property with `PUT /issue/{key}/properties/harbour.asAsked` straight after, and report a failure through the existing Jira partial-write envelope. Still shape B.
- John wants the ask shown verbatim, as code, in Jira. Then A.
- John rules that render-exact is acceptable. Then C is cheaper. B doesn't need that ruling, though.

### Creating issues (whichever seal shape is chosen)

- `createFields()` → `['title', 'description', 'teamId']`. The team is the Jira project key (LIN-2018), resolved through `resolveTeamInput`.
- `apiWriteFields()` → also `projectId` and `parentId`. `projectId` is the canonical project, which is an epic: it maps to `parent` on team-managed projects, or to the Epic Link field on company-managed ones, through the existing `_resolveEpicLinkFieldId`. This matters for the feedback lane's `FEEDBACK_PROJECT_ID`. `parentId` maps to `parent` with a subtask type. `stateId` is **not** declared: Jira creates issues in the workflow's initial status, and a transition after create would be a second, non-atomic write.
- **Issue type, chosen inside the provider with no new setting:** `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes`. Prefer "Task", else the first non-subtask type at hierarchy level 0; use a subtask type when there is a `parentId`. Then read that type's fields. If it has any required field without a default beyond summary, project, issuetype, description, reporter and parent, refuse with **422, naming those fields**, instead of guessing. Cache this per site and project, briefly.
- `POST /rest/api/3/issue` with `fields` plus `properties` (B), then re-read and return the canonical issue, as `updateIssue` does.
- `fake-client.js` gains create, createmeta and per-issue properties.
- `ui.inlineCreate` turns true by itself (`supports('createIssue')`), so `lib/render.js` shows the in-app form instead of the deep link.

### What it retires (every change names what it retires)
- The deep-link create path on Jira. `getCreateTaskUrl` stays overridden only because `ui.write` derives from that override (`lib/providers/interface.js`). It is no longer how Jira creates. Removing the override would hide "+ Add task".
- `inlineCreate: false` on Jira.
- The four stale "createIssue deferred behind LIN-1557 — no native Jira team" comments in `lib/providers/jira/index.js`, which LIN-2018 made obsolete.
- The "Jira is skipped today" claims in the headers of `lib/as-asked-seal.js` and `lib/as-asked.js`, and on `descriptionRoundTrip`.
- README's creation and sealing lines, and `docs/proxy-integration.md`'s "Jira files unsealed".
- `CONSEQUENCE_TEST`'s "provider cannot create tickets" branch (`lib/prompts/leftover-words.js`).
- "mint one … **Linear** task" in `lib/periodicals.js`, which becomes provider-neutral.

### Area notes that bear on this
- **Providers:** no notes file exists (`docs/areas/providers.md`), so nothing is recorded there yet.
- `docs/areas/llm-and-prompts.md`, Lesson (LIN-4362): the block's words have one owner. The Jira region code imports `AS_ASKED_HEADING`, `AS_ASKED_END`, `splitAsAsked` and `sealAsAsked` and never retypes them. `adf.js` stays import-free (its header contract), so the region splice lives in the provider, not the codec.
- `docs/areas/llm-and-prompts.md`, Lesson (prompt size frozen; LIN-4393 re-measure): the `lib/periodicals.js` and `leftover-words.js` wording changes are prompt text. Re-measure the budget and the Periodical sha256 tripwire, with this ticket named as the reason.
- `docs/areas/other-features.md`, Waiting (`lib/as-asked-seal.js` is homeless, Seams & Tangles 8 Nov.): context only. Only that file's header comment changes, and it doesn't move.

### Coverage of `## As asked`: no cuts
- "a task can be filed with the person's words sealed": createIssue + B. The words are byte-exact.
- "a Periodical can be minted": a mint is a proxy create with a project key as team.
- "a task's last step can file what it files": the same proxy create.
- "checked on John's own Jira": a live verification step on his site. File one task, mint one Periodical and make one last-step filing, then re-read each and check the block is `kept`. Write below the line once and re-check.
- "Every change names what it retires": the list above.

Nothing is cut, and no ruling is needed: B delivers byte-exact, so the byte-versus-render question doesn't have to be asked.

### Risks I'm carrying into planning
- **John's createmeta is unknown.** I can't reach his site from here. The design covers it with a refusal that names the required fields. If his project demands a custom field, the live check will show which one, and filling it would be a follow-up.
- **D1 and rich content:** it isn't on the asked path, because all three behaviours are creates of bodies Harbour wrote, which are always renderable. But if a teammate later @-mentions someone in a Harbour-filed description, later description writes return 422, as every Jira description write does today. And a Jira-native ticket with a mention fails its first-dispatch seal, which is logged and lets the dispatch go on. This is a parity gap, not a cut.

### Leftovers for the last step (one home each, per `CONSEQUENCE_TEST`)
- `markdownToAdf` breaks a fenced block with a blank line inside. Under B the words stay exact, but the block *displays* broken in Jira, and step-written plans get mangled. It breaks content, so it should be **a ticket**.
- Widening the D1 writer vocabulary (mentions, emoji, tables): a Waiting entry in a new `docs/areas/providers.md`.
- "Holds verbatim text" as a real provider capability: a Waiting entry, same file.


### Comment 2026-11-13T13:40:55.240Z

### Plan Review Verdict

**Verdict:** Approve. The plan's premises check out at HEAD, it opens all three filing lanes with one provider method plus an honest round trip, and its safeguards hold. The notes below are corrections the builder can make without changing the plan's shape.

**Against what was asked:** "Done when on John's Jira a task filed through Harbour keeps the person's words sealed, a Periodical mints, and a task's last step can file." The plan delivers every clause with no narrowing. If the builder has no credential for John's site, session 3 is a handoff to John, not a cut.

**What I checked (at `4b5001ddf` = origin/main)**
- **Staleness:** `git log --since=2026-11-13T12:08Z` is empty for `lib/providers/`, `lib/as-asked*.js`, the three create routes, `lib/periodicals.js`, `lib/prompts/leftover-words.js`, `lib/render.js`, `lib/dispatch-factory.js`, README and `docs/proxy-integration.md`.
- **The seal module needs no change:** `providerHoldsAsAsked` (`lib/as-asked-seal.js:57`) is a synchronous `checkAsAsked(sealed, descriptionRoundTrip(sealed))`. A pure write-then-read round trip that includes the property turns sealing on without touching that module.
- **The guard compares live against new, not a stored copy:** the proxy guard (`routes/proxy-writes.js:336/534`) compares the live `issueDescription` with the new body. So serving exact `words` from the reader is all the guard needs.
- **Every lane ends in `provider.createIssue` after `sealForFiling`:** proxy create `proxy-writes.js:445/470`, session `workspace-api-issue-write.js:792`, feedback `workspace-api-feedback.js:511`. The first-dispatch seal goes through `readIssueRaw` → `issueDescription` → `updateIssue`.
- **The D1 premise holds:** I ran `adfHasUnrenderableContent(markdownToAdf(sealAsAsked(x)))` on 13 bodies: plain, `*` bullets, `*em*`, `***x***`, bold inside italic, a fence with a blank line, a list starting at `3.`, nested and multi-paragraph lists, a multi-paragraph quote, a table, an HTML comment, links and code. None trips D1. So a Harbour-filed body never blocks its own later below-the-line writes. The codec reached a fixed point after one pass on every sample.
- **Landing session 1 alone on a live site is safe:** a failed first-dispatch seal is caught and logged (`dispatch-factory.js:1066-1079`), and the dispatch continues. It only seals issues that have never been dispatched (`hasDispatchForIssue`). On a Jira-native ticket the words are already the converted text, so a `rendered` mismatch there costs nothing.

**Notes for the builder** (none block)

1. **Make the live check able to fail (session 3, item 12).** The "kept" check passes even if B's exact path never runs on real Jira. If Jira normalises the ADF it stores so that the region no longer renders to `rendered`, the reader serves the converted rendering instead of `words`. For a plain body like "Please make the button blue." that is identical, so `checkAsAsked` still says `kept`. On John's site:
   - file at least one body with lossy constructs: `* a` bullets, `*em*`, trailing spaces, and a list starting at `3.`;
   - assert byte equality of the read-back `words` against what was filed, because `checkAsAsked` normalises escapes;
   - record whether the reader took the `rendered`-match branch.

   This is the one place the Done-when's "keeps the person's words" is actually proved.
2. **Every single-issue read needs the property, not just the four listed.** The plan's rule is "single-issue reads fetch with `properties=harbour.asAsked`". Other `getIssue` results are also mapped through `_toCanonicalIssue`: `updateIssue`'s confirmation re-read (`index.js:1267`), `updateIssueLabels`' re-read (`index.js:1110`), and the new `createIssue` re-read. Without the property they return converted words in the write response. The simplest rule that covers all of them: every provider-side `client.getIssue` asks for the property. Optionally, `POST /search/jql` also takes `properties`, which would make the bulk path exact too.
3. **Store a digest of `rendered`, not the rendering itself.** `rendered` is only ever compared for equality, so a sha256 of it does the same job. Storing the full rendering roughly duplicates `words` and halves how much text fits. Atlassian documents the entity-property value limit as 32768 characters; confirm it, as the plan says. Put the size computation in one function that `descriptionRoundTrip`, `updateIssue` and `createIssue` all call, so the seal check and the 422 can never disagree.
4. **The Periodical report gate never fires on Jira** (a parity gap this task makes reachable). Linear's `issueWriteGuard` returns `description` and the last 20 comments (LIN-694, `linear/index.js:1745`). Jira's (`jira/index.js:1016`) returns neither. So `refusedByPeriodicalGate` (`proxy-writes.js:547`) never applies, and a minted Periodical task can be moved to Done on Jira without report evidence. Minting itself works, so the Done-when is met either way. My recommendation: in session 2, add `description` (through the composed reader) and recent comments to Jira's `issueWriteGuard`, using the same `getIssue`. If the builder judges it out of scope, file a ticket instead: it is a guard that silently doesn't run.
5. **`parentId` is not reachable through the lanes as planned.** Proxy create forwards `parentId` only when it is a UUID (`proxy-writes.js:451`, `present: isUuid`). A Jira id or key is silently skipped, and the child is filed top-level with a 201. The session lane doesn't forward `parentId` at all. The breakdown prompt (`prompt-template-defs.js:425`) tells agents to create subtasks with `parentId` and `stateId: "Todo"`. On Jira after this plan, `stateId` gets a loud 400, but the parent is silently lost. This isn't one of the three asked behaviours, so choose one:
   - make the proxy refuse (400) a non-UUID `parentId` instead of dropping it;
   - accept the provider's own id form when the provider declares `parentId`;
   - or leave `parentId` out of `apiWriteFields()` here and record it as a follow-up.

   Don't let item 8's subtask-type test stand as evidence that subtask filing works end to end. `docs/proxy-integration.md:2065` documents `parentId` as UUID-only.
6. **Item 3's grep witness:** `adfToMarkdown` legitimately remains at `index.js:924` and `:1295` for comment bodies. Pin the test on description fields specifically, as the plan says, not on a raw count of matches.

**Open questions from the brief, resolved:** the property byte limit is 32768 characters per Atlassian's entity-property docs (the builder confirms it, note 3). Whether John's site accepts `properties` in create and edit bodies, its createmeta, and its required fields stay with session 3's live check, with the separate-PUT fallback and the naming 422 already planned.

Next: `implementation`, starting with session 1.


### Comment 2026-11-13T13:44:23.509Z

## Breakdown: LIN-4445 @ 4b5001ddf

**Drift check:** none. HEAD = origin/main = `4b5001ddf`, and `git log --since=2026-11-13T12:08:08Z` is empty for `lib/providers/`, `lib/as-asked*.js`, the three create routes, `lib/periodicals.js`, `lib/render.js`, `lib/prompts/leftover-words.js`, `lib/dispatch-factory.js`, `lib/providers/interface.js`, README, `docs/proxy-integration.md`, `docs/areas/` and both prompt-budget tests. I spot-checked the plan's anchors at HEAD and they hold: `adfToMarkdown` description reads at 484/863/873/1049, `descriptionRoundTrip` at 1064, LIN-1557 comments at 13–46 and 1328–1356, no create or properties in `client.js`, proxy `parentId` gated by `isUuid` (~459), the `CONSEQUENCE_TEST` "cannot create tickets" branch, "Linear task" at `periodicals.js` 251/278, and no `docs/areas/providers.md`.

**Plan approved** (Plan Review Verdict, comment 61e84035, rev 1). Each subtask carries its slice of the plan, the grounding SHA, and the plan-review cover line.

| # | Subtask | Plan slice | Blocked by |
|---|---|---|---|
| 1 | **LIN-4450** Jira seal: exact words in `harbour.asAsked`, formatted block in the description | Session 1, items 1–6, plus review notes 2 (every `getIssue` fetches the property), 3 (digest stored in `rendered`, one shared size function, 32,768-character limit) and 6 (comment bodies keep direct conversion) | — |
| 2 | **LIN-4451** Jira `createIssue`: open the proxy, session and feedback lanes; retire the deep-link create path | Session 2, items 7–11, plus review notes 4 (Periodical report gate: add description and comments to Jira's `issueWriteGuard`, recommended, or file a ticket) and 5 (`parentId`: pick native-id support, a 400 refusal, or omit it with a follow-up; don't advertise subtasks until resolved) | LIN-4450 |
| 3 | **LIN-4452** Live check on John's Jira: sealed filing, Periodical mint, last-step filing, and leftovers | Session 3, items 12–13, plus review note 1 (lossy-Markdown body, byte equality, record the digest-match branch) | LIN-4451 |

**Session fit (from the plan):** the plan split at these seams. Session 1 holds the region reader's edge cases and the property semantics across client, fake, the four reads and the writer, and it lands and verifies alone. Session 2 holds createmeta, three lanes, the UI flip, and the retirements across docs and prompts with a budget re-measure. Session 3 needs a credential for John's site that no build session has by default. Each is blocked by the one before, in the plan's landing order. Each fits one session.

**Coverage of `## As asked`:** no cuts. "Filed with the person's words sealed": 1 and 2. "A Periodical can be minted" and "a task's last step can file": 2, via proxy create. "Checked on John's own Jira" and the Done-when: 3. "Every change names what it retires": the retire lists in 1 (seal headers) and 2 (deep link, `inlineCreate: false`, LIN-1557 comments, README and proxy-doc lines, the `CONSEQUENCE_TEST` branch, "Linear task" wording). If 3 has no credential, it ends as an explicit handoff to John, not as a cut. No ruling is needed.


### Comment 2026-11-13T14:08:01.332Z

## Session 1 (LIN-4450): where the code moved the plan

PR: https://github.com/JKershaw/LinearViewer/pull/2421. Built as planned (shape B, items 1–6), with these departures, each reasoned in the code:

1. **End-line choice is by digest, not by position.** The plan's "first end paragraph after the heading" fails when the words hold the end sentence as plain or `_…_` text: the reader closes early and the tail is served below the block. The reader now takes the end candidate whose region renders to the stored `rendered`; the writer takes the candidate whose interior renders to the words. Review note 1 resolved this way. `hasMarkerLine` and `splitAsAsked` are unchanged, so Linear is unaffected.
2. **Size limit in bytes.** The 32,768 limit is enforced on UTF-8 bytes of the serialized property (JSON escaping included). Atlassian's docs say bytes on some pages and characters on others; the stricter reading is used. Source: https://developer.atlassian.com/cloud/jira/platform/jira-entity-properties/
3. **Round trip throws on a block that cannot be held** (too large, or interior does not read back). `providerHoldsAsAsked` treats a throw as "cannot hold", so the seal is skipped with the existing log line. The plan's "non-kept read-back" is the same outcome by a different path.
4. **Empty fenced code block fixed in the codec** (in scope per the brief). It rendered as a blank line between fences, which the writer tore apart, so the description refused every later below-the-line write. It now renders as the bare fence, and the write gate accepts an empty fence.
5. **Every provider-side `getIssue` asks for the property**, including the epic and parent reads (review note 2). The fake returns only requested keys, as real Jira does.

**Not done, and the main open risk:** the live check (LIN-4452). No credential for John's Jira is available to this build, so nothing here shows that Jira keeps the rendered digest across an ordinary editor save below the block. If it does not, the reader serves the converted text and the exact-words promise fails silently; the live check has to be able to fail (review note 1, LIN-4445).

**Consequence once merged:** the first-dispatch seal begins sealing Jira-native tickets on live sites, as the plan expects. A failed seal is logged and dispatch continues.

Next: LIN-4451 (session 2) is blocked by this PR merging.



# Facts computed from the task records at this moment

(open items with who must act, judgements and decisions with whether they still rest on the current version, areas and their open counts, and an index of other open records)

## 3. Addressed to it
finding-97 finding [open] v1 by review to close-out in task-60
  says: Fix for close-out (the one condition of verdict-96): in tests/unit/jira-as-asked-region.test.js, test 'an oversized body is not sealed…' (~line 262), capture console.log during the sealForFiling call and assert exactly one line equal to `[as-asked] seal skipped: provider jira cannot hold the block (test)`. Today it asserts filed unsealed and verbatim but not 'with the log line', which plan-54 item 6's witness names.
  on → change-84@2
  about → plan-54, verdict-96
finding-105 finding [open] v1 by blind-read to close-out in task-60
  says: Fix-sized (blind read of change-84): routes/workspace-api-audit.js lines 35-36 still write `process.env.NODE_ENV === 'test' && (workspace.accessToken === 'test-token' || …)` inline. The sweep moved every sibling copy onto isHermeticTestToken and missed this one. Fix: `isHermeticTestToken(workspace.accessToken) || (process.env.NODE_ENV === 'test' && workspace.provider === 'local')`. It keeps its own predicate, as its comment asks.
  about → change-84
finding-106 finding [open] v1 by blind-read to close-out in task-60
  says: Fix-sized (blind read of change-84): in routes/workspace-api-steps.js, isTestToken is now a one-line second name for isHermeticTestToken(workspace.accessToken). Fix: have its callers (workspace-api-issue-read.js, workspace-api-issue-write.js, workspace-api-prompts.js) import the helper directly and drop the alias.
  about → change-84
finding-107 finding [open] v1 by blind-read to close-out in task-60
  says: Fix-sized (blind read of change-84): tests/unit/jira-as-asked-region.test.js, the test at line 291 "no longer claim that Jira is skipped", only checks that three phrases are missing from two comment headers (lib/as-asked-seal.js, lib/as-asked.js). It says nothing about behaviour; as-asked-create-seal.test.js already checks that Jira holds the block. Fix: delete it.
  about → change-84

## 4. What stands about this task
verdict-57 verdict [stands] v1 by plan-review in task-53
  of: plan-review
  outcome: approve
  reasoning: **Verdict:** Approve. The plan's premises check out at HEAD, it opens all three filing lanes with one provider method plus an honest round trip, and its safeguards hold. The notes below are corrections the builder can make without changing the plan's shape.

**Against what was asked:** "Done when on John's Jira a task filed through Harbour keeps the person's words sealed, a Periodical mints, and a task's last step can file." The plan delivers every clause with no narrowing. If the builder has no credential for John's site, session 3 is a handoff to John, not a cut.

(Notes for the builder, none block, folded into this piece: 2, 3, 6.)
  on → plan-54@2
decision-63 decision [stands] v1 by breakdown in task-60
  answer: Breakdown row: | 1 | **LIN-4450** Jira seal: exact words in `harbour.asAsked`, formatted block in the description | Session 1, items 1–6, plus review notes 2 (every `getIssue` fetches the property), 3 (digest stored in `rendered`, one shared size function, 32,768-character limit) and 6 (comment bodies keep direct conversion) | — |
Plan-review due: no. Covered by LIN-4445's approving plan-review (comment 61e84035-1df2-459f-8def-5afdc7001e64, rev 1). Session fit: fits one session. Blocked by: none. Grounding commit 4b5001ddf.
  why: Session 1 holds the region reader's edge cases and the property semantics across client, fake, the four reads and the writer, and it lands and verifies alone. (Breakdown comment 6ecab235, Session fit.)
  about → plan-54
  on → verdict-57@1
decision-81 decision [stands] v1 by scoping in task-60
  answer: Size of the move: a small tidy. Jira holds the person's words byte-exact, plus one tidy done first: an empty fenced code block in the words no longer files a description that refuses every later write below the line, which the seal exists to allow. Cuts: none. Decided by: the standing policy.
  why: The seal (plan-54 items 1-6 with review notes 2, 3, 6) fits one session as breakdown sized it; question-68 shows the empty fence makes markdownToAdf emit a codeBlock D1 refuses, so once Harbour writes the block, that ticket could never be written below the line again. Fixing the codec first (not excluding the input) keeps the seal's purpose intact. Recorded in the LIN-4450 description under ## Size of the move.
  scope: task-60
  answers → question-68
  on → plan-54@2, decision-63@1
  about → task-60
decision-85 decision [stands] v1 by implementation in task-60
  answer: The end line is chosen by digest, not by position. The reader takes the end candidate whose region renders to the stored `rendered`; the writer takes the candidate whose interior renders to the words. `hasMarkerLine` and `splitAsAsked` are unchanged, so Linear is unaffected.
  why: plan-54 item 1 first end paragraph after the heading fails when the words hold the end sentence as plain or `_…_` text: the reader closes early and the tail is served below the block. Neither option offered (widening hasMarkerLine, last matching paragraph) keeps such words sealed and whole; the digest already exists to choose. Recorded as departure 1 on LIN-4445.
  answers → question-67
  on → plan-54@2
  about → plan-54
decision-86 decision [stands] v1 by implementation in task-60
  answer: The entity-property limit is enforced as 32,768 UTF-8 bytes of the serialized property (JSON escaping included), in one shared size function used by the seal check and the 422.
  why: decision-63 carried it as a 32,768-character limit; Atlassian gives it in bytes on some pages and characters on others (https://developer.atlassian.com/cloud/jira/platform/jira-entity-properties/), so the stricter reading is used. Departure 2 on LIN-4445.
  on → decision-63@1, plan-54@2
  about → plan-54
decision-87 decision [stands] v1 by implementation in task-60
  answer: `descriptionRoundTrip` throws on a block Jira cannot hold (too large, or the interior does not read back); `providerHoldsAsAsked` treats a throw as cannot-hold, so the seal is skipped with the existing log line.
  why: Same outcome as plan-54 item 6 non-kept read-back, by a different path. Departure 3 on LIN-4445.
  on → plan-54@2
  about → plan-54
verdict-96 verdict [stands] v1 by review in task-60
  of: review
  outcome: approve-with-notes
  reasoning: Approve, conditional on close-out making the one named test fix and on LIN-4452 discharging the live-check ledger (post-deploy steps, not merge conditions). PR #2421 reviewed at head f9fa4a80c (base 4b5001ddf); merges cleanly onto main cfd152fa4, which touched none of its 22 files. CI green on that head; the region, seal, guard, readers, as-asked, marker-census and codec suites re-run locally, all green.

Scope: inside plan-54's places, plus two declared extras (the isHermeticTestToken consolidation, behaviour-identical at every call site and naming the Waiting entry it removes; a new docs/areas/providers.md). Departures recorded on LIN-4445: end line chosen by digest (decision-85), size in bytes (decision-86), round trip throws (decision-87), the empty-fence fix (decision-81), every getIssue asks for the property.

Regression: codec rebuilds (LIN-3556..3570) and seal work (LIN-4352/4361/4362) intact; the only earlier decision changed is the empty codeBlock, whose D1 refusal reason (old renderer printed a split fence) no longer applies. D1 still refuses an empty-text, marked, blank-line or edge-newline codeBlock.

Gap analysis: items 1-6 all met. Done-when: met; 'D1's rich-content guard is unchanged' met in substance (no rich-content rule changed; only the empty-fence codec-shape rule, declared under Size of the move).

Mutation checks M1-M8 plus _toCanonicalIssue back to adfToMarkdown: every one red, each reverted. Probe of 16 further shapes through holdAsAsked then readDescription: all byte-exact, none tripped D1 or brought a new 422.

Class: 'a provider whose stored form cannot give back the markdown it was handed' has one member, Jira; its remaining instance is createIssue (LIN-4451). Bulk search path is display-only and already homed (finding-91). Otherwise isolated.

Rollback: revert the squash commit. Written properties stay but nothing reads them; sealed descriptions read through adfToMarkdown as _End of…_, which splitAsAsked does not recognise, so those tickets fall back to the unsealed readers. No data loss.
  on → change-84@2, plan-54@2, decision-81@1, decision-85@1, decision-86@1, decision-87@1
  about → task-60
verdict-104 verdict [stands] v1 by blind-read in task-60
  of: blind-read
  outcome: better
  reasoning: It gives Jira description read and write a single owner (lib/providers/jira/as-asked-region.js: readDescription/holdAsAsked, and descriptionRoundTrip now runs that same pair, so the seal decision and the write cannot disagree). It also folds ten inline copies of the test-token predicate onto isHermeticTestToken (routes/proxy-compute.js, server.js, routes/task-chat.js, routes/workspace-api-steps.js). On the worse side, a Jira issue description now depends on which read produced it: the batch path in lib/providers/jira/index.js serves the converted words and the single-issue reads serve the exact ones (finding-91). Read: PR #2421 at f9fa4a80c against 4b5001ddf.
  on → change-84@2
  about → task-60

## 5. Its areas
area-1 Providers (Linear, GitHub, Jira, local): 3 open addressed to it
area-2 LLM & prompts: 25 open addressed to it
area-46 Other features: 5 open addressed to it

## 6. Open runs sharing its paths
(none)

## 7. Index of what else is known
lesson-5 lesson → -: Keep scoping and both Survey renders byte-identical unless a ticket is about them (replays compare them, LIN-4369).
lesson-6 lesson → -: The Surveys get no area notes pointer: survey-place reads no shape reports, which feed the notes. Scoping cites its pointer in its final message; both share `AREA_NOTES_WHERE` (LIN-4346).
lesson-8 lesson → -: The `## As asked` block's words have one owner, `lib/as-asked.js`: import its spellings, never retype the heading or end line (LIN-4362).
lesson-16 lesson → -: A blind reader's limits are instructions, not access: with the repository checked out it can still see commit subjects (`git worktree add` prints the head's) and area notes. Both slipped, harmlessly, in the LIN-4436 pilot. Code hands a blind stage SHAs and PR URLs, never a PR body or commit log.
lesson-47 lesson → -: This area is the `^lib/` catch-all: a file lands here when no earlier pattern names it. A new production file belongs in its owning area, given a pattern in the same change, checked in `tests/unit/area-map-placement.test.js`. A file here is often homeless, not owned.
finding-79 finding → area-1: Beyond LIN-4450: once the seal flips, the first-dispatch seal writes back to live Jira-native tickets through `updateIssue`. D1 refuses any ticket holding a mention, emoji or panel (common on real sites) and logs it once per first dispatch; tickets that pass get their ADF normalised, and their sealed 'words' become the escaped rendering (`*em*`→`_em_`-style). That is the codec's lossiness showing, deeper than this task; plan-56 item 13's Waiting entry (widening the D1 writer vocabulary) is the nearest home.
finding-80 finding → area-1: Comment weight: `lib/providers/jira/index.js` is 1,478 lines at 4b5001ddf, mostly history comments; its header and `docs/architecture/source-map.md`'s Jira paragraph carry more history than guidance. A trim is its own small task, not LIN-4450's.
change-84 change → -: https://github.com/JKershaw/LinearViewer/pull/2421
lesson-92 lesson → -: A Jira description has one reader and one writer: `readDescription` and `holdAsAsked` in `lib/providers/jira/as-asked-region.js`. They are the only code that knows the ADF region and the `harbour.asAsked` entity property, and every provider-side `getIssue` passes `AS_ASKED_READ`. Shape B keeps the words in two places, the region and the property, and that is safe only while one module knows both. A new description read that calls `adfToMarkdown` directly serves converted words and breaks the seal silently; `tests/unit/jira-as-asked-region.test.js` fails on it. (LIN-4450.)
lesson-93 lesson → -: Decide whether the words are kept by comparing renderings, never ADF. Jira stamps `localId` and similar attributes on ordinary saves, and `adfToMarkdown` ignores them; a hash of the ADF would read every human save as an edit. (LIN-4450.)
lesson-94 lesson → -: The region reader accepts an end line whatever its marks, which is looser than `splitAsAsked`. It stays safe because `descriptionRoundTrip` runs the same reader the reads do, so a block the reader would misplace is refused at filing. Keep the seal's check and the reads on one reader. (LIN-4450, Survey open-0.)
lesson-95 lesson → -: The Jira fake proves only the provider's own logic. It stores whatever it is handed and never normalises ADF, so it cannot show whether live Jira keeps a region's rendering. A claim about live behaviour needs a live check. (LIN-4450; the live check is LIN-4452.)
check-98 check → task-62: Live Jira accepts the entity property on the edit and returns it on read: `properties: [{key:'harbour.asAsked', value}]` on PUT /rest/api/3/issue/{key}, read back as `properties['harbour.asAsked']` on GET ?properties=harbour.asAsked. The fake is built to that shape (plan-54 item 6 semantics), but no test reaches Atlassian.
check-99 check → task-62: Live Jira's editor keeps the region's adfToMarkdown rendering, and so the digest, when someone edits and saves a line below the block. If it does not, every sealed issue silently serves converted words (`*em*`→`_em_`): the fake cannot normalise ADF (lesson-95), so CI cannot show this.
check-100 check → task-62: The consequence named in task-60's done-when: once live, the first dispatch of a Jira-native ticket writes the block through updateIssue, and dispatch must continue whether the seal lands or D1 refuses.
finding-101 finding → task-61: From the review of change-84: (1) createIssue is the one remaining Jira instance of 'a stored form that cannot give back the markdown it was handed'; it must write through holdAsAsked in lib/providers/jira/as-asked-region.js, the one place that computes the property and its size (decision-86), not a second writer or size check. (2) plan-55 item 10's retire list is partly done by change-84: the 'Jira is skipped' claims in the as-asked-seal.js and as-asked.js headers and the descriptionRoundTrip comment, lib/dispatch-factory.js, and the docs/proxy-integration.md 'Jira files unsealed' line are already retired; drop them, re-run the repeatable search. (3) LIN-4451 is blocked until change-84 merges; merging unblocks it.

