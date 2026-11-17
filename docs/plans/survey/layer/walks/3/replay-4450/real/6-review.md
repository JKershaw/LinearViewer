# What this stage really wrote

## Comment on LIN-4450 at 15:18:12

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

