# Outward validation run — one complete ticket lifecycle on a non-Harbour repo

**Date:** 2026-08-28
**Ticket:** LIN-2326
**Harbour under test:** local instance booted from `origin/main` at `a361265ed2944b8aee341e037b1a623119cb8a78`
**Target repo:** [JKershaw/mangodb](https://github.com/JKershaw/mangodb) (GitHub Issues provider)
**Target ticket:** [issue #52](https://github.com/JKershaw/mangodb/issues/52) — `readDocuments()` loads the whole collection into one string
**Outcome:** lifecycle completed. [PR #54](https://github.com/JKershaw/mangodb/pull/54) merged as `3d47a35`, issue closed, fix validated against a real 560MB collection.

---

## What this run was for

Harbour's main product is currently Harbour. LIN-2326 asked whether that is the best dogfooding story available or a closed loop — and observed that from inside, the two are indistinguishable. The test: point the whole loop at a codebase Harbour has never seen, drive one real ticket end to end, and write down every point of friction.

This is the friction log. It is deliberately an *exam*, so the failures below are the product, not an embarrassment.

## Verdict, up front

**The workbench claim survives, with one large qualification.**

What worked was the *machinery*: the dispatch queue, the consumer contract, the recommendation engine, the grounding reads, the audit log, the write path for comments and state. None of that needed a Linear workspace, and none of it needed changing. A real external ticket went from unread to merged-and-validated through Harbour's own surfaces in a single session.

What did not work was the *provider seam in the agent-facing lane*. Five of the thirteen proxy reads an agent would naturally make return 500 on GitHub, including `GET /issues/{id}` — the single call Harbour's own preamble tells every worker to make first. And every prompt Harbour generated for this GitHub ticket instructed the worker to go and update **Linear**.

So: not a closed loop in its architecture, which is the genuinely good news — the abstraction is real and the machinery is portable. But a closed loop in its *testing*, in a specific and measurable way: the non-Linear paths through the agent lane have evidently never been exercised end to end, because the first and most fundamental one is broken in a way no Harbour-internal run could ever reveal.

Eight findings filed: **LIN-2350** … **LIN-2357**.

---

## 1. Where prompts assumed Harbour's own conventions

The ticket asked for every place a prompt assumed Harbour's conventions. Measured, not predicted — the prompts below were pulled off the real queue.

### "Linear" leaked into every generated prompt — LIN-2353

`GET /api/proxy/recommend/52` on the GitHub workspace produced a `research` prompt containing:

```
1. **Start**: Set #52 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for #52 in Linear
7. **Update Linear**: add a comment with the findings ...
Project: use the project currently assigned in Linear.
```

The `plan` prompt actually dispatched and pulled off the queue carried five such mentions, including the auto-appended preamble line:

> You have a workspace API proxy for this workspace (source-neutral; currently backed by Linear).

**Cause.** `applyPromptCapabilities` (`lib/prompt-formatters.js:1043`) does exactly the right thing when given a provider — it rewrites `\bLinear\b` to the provider's `displayName`, gates tracker-write steps, strips subtask sections. But it falls back to `DEFAULT_PROMPT_UI = {…, displayName:'Linear'}` (`:935`) when nothing is threaded in, and the dispatch lane threads nothing: `grep -an providerUi routes/proxy.js` returns zero hits, and `:4205`, `:4551`, `:6568` all pass four arguments to the five-parameter `generatePrompt(…, providerUi = null)`. The in-app lane (`routes/workspace-api.js`) threads it correctly, so the two lanes have diverged.

**The compounding failure.** Step 2 of that prompt sends the worker to `GET /issues/52`, which returns 500 on GitHub (§2). Linear-shaped instructions pointing at a Linear-only endpoint: a worker following its instructions exactly would fail on its second step.

### What did *not* leak

Worth recording, because it bounds the problem:

- **Zero `LIN-` identifiers.** The identifier rendered correctly as `#52` throughout — prompts, dispatch records, brief, recap, stack.
- **Zero subtask sections, zero estimate references, zero cycle references.**
- No CLAUDE.md idioms or house test patterns were imposed on the target repo.

So issue **data** is provider-aware; the **capability layer** is not. That is a narrower and more fixable defect than "prompts are Linear-shaped".

### The reference document tells the agent the wrong backend — LIN-2354

`GET /api/proxy/instructions` — the document every worker is pointed at — opens with "this workspace is **currently backed by Linear**". It also describes priority as "**Linear's NATIVE scale**" and explains that "**Linear stores markdown punctuation backslash-escaped**" as the contract for description splices.

In fairness: other parts of the same document *are* provider-aware and accurate — the `POST /issues` and `PATCH /issues/{id}` sections explicitly enumerate which fields a GitHub workspace drops or refuses, and that enumeration was correct. The machinery for provider-conditional docs exists; the header and the scale/escaping notes just don't use it.

### The target repo's own conventions Harbour could not see

mangodb's `CLAUDE.md` says *"Mark **Linear** tasks as 'Done' only after PR is merged to main"*, and its commit convention embeds `MAN-NN` identifiers (`fix: … (MAN-42) (#51)`) that appear nowhere on the GitHub issue. The external repo's lifecycle is split across two trackers, and a GitHub-bound Harbour workspace can see only one of them. An agent driving from GitHub alone **cannot produce a conforming commit message**. This run used the GitHub-native `(#52)` form instead; the merge commit reads `fix: … (#52) (#54)`, which is close to but not the same as house style.

This is not a Harbour defect. It is the shape of the outward problem: the second tracker is invisible, and nothing in the loop knows to ask.

---

## 2. Capability gates: what fired, and what it returned

The ticket predicted `provider.supports()` **422s**. The run measured **500s**. That distinction is the single most operationally important finding here, because anything keying on 422 to mean "capability absent" will miss these entirely.

Full read sweep against the GitHub workspace:

| Endpoint | Status | Note |
|---|---|---|
| `GET /brief/52` | 200 | correct, identifier `#52` |
| `GET /recap/52` | 200 | correct |
| `GET /search?q=…` | 200 | correct |
| `GET /labels` | 200 | real GitHub labels |
| `GET /teams` | 200 | `{"teams":[]}` — by design |
| `GET /stack?view=digest` | 200 | correct |
| `GET /instructions` | 200 | served, but see LIN-2354 |
| `GET /recommend/52` | 200 | works; `repo: null` |
| **`GET /me`** | **500** | `provider.viewer is not a function` |
| **`GET /issues/52`** | **500** | `provider.issueDetail is not a function` |
| **`GET /relations/52`** | **500** | ungated headroom read |
| **`GET /cycles`** | **500** | ungated headroom read |
| **`GET /projects`** | **500** | ungated headroom read |
| `GET /issue/52`, `GET /states` | 404 | routes don't exist (flat forms; nested is canonical) |

### `/me` and `/issues/{id}` are structurally Linear-only — LIN-2350

`routes/proxy.js:2532` calls `provider.viewer(token)`; `:2706` calls `provider.issueDetail(token, issueId)`. **Neither method exists on `ProviderInterface`** — no declaration, no `NotImplementedError` stub. They are implemented only by `linear` (`lib/providers/linear/index.js:2178,2181`) and `local`. `github`, `github-projects` and `jira` define neither.

Because they are off-interface, `provider.supports()` cannot see them and `denyIfUnsupported` cannot gate them. That is *why* this is a 500 and not a 422 — there is no capability to refuse, only a method that isn't there.

`GET /issues/{id}` is the most fundamental agent read there is, and `lib/proxy-preamble.js` instructs every dispatched worker to call it first. On a non-Linear workspace, the first instruction a worker receives points at an endpoint that cannot work.

### Headroom reads are routed ungated — LIN-2355

`relations`, `cycles`, `projects` (and the rest of the `readsHeadroom` family, `lib/providers/interface.js:86`) are routed with no `denyIfUnsupported`/`denyIfMissingRead` (`routes/proxy.js:2756/2783/…`), and `graphqlErrorStatus` (`:1413`) has no `NOT_IMPLEMENTED` branch — so `NotImplementedError` becomes a 500, contradicting the interface's own contract note at `interface.js:19-27`. Live, not theoretical: `proxy-preamble.js:142` tells every worker to call `/relations/<id>`.

### Every failure named the wrong provider — LIN-2351

All five 500s returned `"detail":"Linear API request failed"`. None of those calls touched Linear. This is misdirection, not cosmetics: it points every debugging instinct at credentials, token expiry, or Linear's status page. Harbour already treats this class of error as load-bearing — LIN-1448 spent a distinct `token_ownerless` reason precisely because a collapsed reason cost ~100 minutes on 2026-07-25.

### Issue creation is unreachable on GitHub — LIN-2352

`POST /api/proxy/issues` refuses without a resolvable `teamId` (`routes/proxy.js:3250`), but `GitHubProvider.fetchTeams()` returns `[]` **by design**, with the in-tree comment `// LIN-1972: no teamId (no teams)`. No reference resolves:

```
{"title":…}                        -> 400 {"error":"Valid teamId is required"}
{"teamId":"JKershaw/mangodb", …}   -> 422 {"error":"No team matches reference …"}
{"teamId":"mangodb", …}            -> 422
{"teamId":"JKershaw", …}           -> 422
```

Meanwhile `GitHubProvider.createIssue(scope, input)` (`:744`) needs no team at all. **The capability is implemented; the route is not reachable.**

This directly defeats LIN-2326's own "file, don't fix" boundary: an agent driving an external repo through Harbour cannot file a discovered gap in the workspace it is working in. The follow-up ([mangodb#55](https://github.com/JKershaw/mangodb/issues/55)) had to be filed with the `gh` CLI, out of band.

It also **corrects this ticket's own research pass**, which recorded GitHub Issues as supporting the whole loop because `createIssue` is implemented. Only running it showed the difference.

### `ui.*` degradations: not measurable as specified

LIN-2326 asked for "every `ui.*` degradation". Those reach a prompt only through `applyPromptCapabilities`, which the dispatch lane never feeds a real `providerUi` — so the degradations **do not appear as prompt differences at all**. There is nothing to observe on that axis until LIN-2353 is fixed. This measurement needs replacing, not refining.

### What the write path did well

Genuinely uneventful, and worth saying so:

- `POST /issues/52/comments` → **201**, comment verified on GitHub's side at `2026-08-28T21:08:00Z`.
- `PATCH /issues/52 {"stateId":"done"}` → **200**, canonical state mapped correctly to GitHub's `Closed`.
- The documented field-drop behaviour for GitHub was accurate.

One correction to my own first attempt: `PATCH {"state":"Done"}` returned `400 No valid fields to update`. That was **my** error — the field is `stateId`, and the docs say so plainly. The 400 was accurate and helpful.

---

## 3. Every step that required the operator

| # | Step | Who | Notes |
|---|---|---|---|
| 1 | **Target repo + ticket selection** | **Operator** | Hard block. The run stopped dead and waited for a decision cycle. |
| 2 | Credential discovery | Agent | See below — the stated location was wrong. |
| 3 | Workspace binding to the repo | Agent | Programmatic seeding; bypassed the OAuth plane (disclosed, §5). |
| 4 | Repo present on the dispatch host | — | Already cloned; `admission.js:32-48` would otherwise have rejected pre-flight. |
| 5 | `repo=` project binding | **Not done** | Never established; `recommend` returned `repo: null` throughout. |

**Step 1 was the only true hard block, and it was absolute.** No amount of agent effort substitutes for it: `GET /teams` returned exactly one team (`LinearViewer`/`LIN`), no external workspace was connected, and the ticket explicitly reserved the choice. The run parked with a single-question hand-back and resumed the moment the ruling landed. That is the loop working correctly, but it is a genuine serialization point — the outward run cannot self-start.

**Step 2 is a friction datum in its own right.** The ruling stated the test account's credentials were "available as environment variables on this machine". They were not: no GitHub PAT env var exists. The usable credential was in the **`gh` CLI keyring** (`gh auth status` → JKershaw, scopes `gist, read:org, repo, workflow`). Discovering that cost a search of the shell profiles, the repo dotfiles, and `gh auth status`. A stated precondition that doesn't match reality is exactly the kind of thing an outward run exists to catch — and it is worth noting the credential was the operator's *real* account, not a segregated test account, so every write in this run is attributed to the repo owner.

**Step 5 never bit, but only by luck.** `repo=` is parsed from a project description (`lib/prompt-formatters.js:194`) — a GitHub **milestone**. It was never set, so `repo` was `null` in every recommendation. It didn't matter *here* because I performed the implementation directly rather than handing it to a dispatched worker session, and I already knew where the code was. A real dispatched worker would have received a prompt with no repo binding and no way to know which checkout to work in. **This is an uncovered leg, not a passed test** (§5).

---

## 4. Which instruments could see the run

The ticket asked for every instrument that could not see the run. The honest answer is more interesting than "none of them could".

| Instrument | Saw the run? | Detail |
|---|---|---|
| **Proxy audit log** (`proxy-events`) | **Yes, fully** | 22 events with correct paths and statuses, including all five 500s. Provider-agnostic and accurate. |
| **Prompt traces** (`prompt-traces`) | **Yes — and recorded the defect** | 3 traces, every one `providerUi: null`. |
| **Dispatch history** | Yes | The dispatch, its `taken` transition, and its feedback all recorded. |
| **Dispatch consumer contract** | Yes | `poll` → `take` → `feedback` all correct; atomic claim verified (re-poll empty). |
| `/kpis` per-provider split | No | Carries no per-workspace or per-provider dimension by design (`kpi-stats.js:12`). Unattributable rather than blind. |
| `links.js` artifact classification | Not exercised | No dispatcher run consumed this session, so nothing classified. |

### The sharpest instrument finding — LIN-2357

`prompt-traces` **did** record this run, and every trace carries `providerUi: null` — which is *precisely* the defect in LIN-2353. The instrument built to record provider capability context captured the bug faithfully, three times, and **nothing reads it**. A null `providerUi` is indistinguishable downstream from "not applicable".

The instrument is not blind. It is unread. That is a different problem with a different remedy: not "wire the instrument in" but "read what it already writes".

**This corrects the research pass for this ticket**, which predicted `promptTraceStore` was wired only into `routes/workspace-api.js` and therefore blind to the dispatch lane. The prediction was wrong, and pessimistic in the wrong direction — only running the loop showed it.

### A tooling instrument that failed silently — LIN-2356

`routes/proxy.js` contains exactly one **raw NUL byte** (line 1069, col 27), written as a literal byte instead of the `\x00` escape inside a composite map key. Node parses it fine, so there is no runtime defect — but `file` reports `data`, and **plain `grep` treats the whole 407KB file as binary and silently returns nothing**. Every agent that greps the most agent-relevant file in the repo gets no results and no explanation unless it happens to pass `-a`. This ticket's own research pass hit it and worked around it without recording why.

---

## 5. What this run did **not** cover

Per LIN-2325's principle — an instrument that doesn't say what it saw isn't reporting.

1. **The OAuth onboarding plane.** The workspace was bound programmatically (durable session seed + `linkProvider`-shaped binding), not through "Continue with GitHub". Disclosed and accepted up front by the operator: *"we lose some parts of the test, but gain the meat."* Note the residual risk this leaves unmeasured — after LIN-2304, only 3 of 10 non-Linear account-conflict 409 branches are recoverable (LIN-2347), and none of those branches were exercised.

2. **Production-instance deployment.** This was a local instance at `a361265e` — same code, different deployment. Nothing here speaks to production config, TLS, session storage, or scale.

3. **A real dispatched worker session.** This is the leg most likely to be over-read, so stating it plainly: I exercised the **consumer contract** (`poll` → `take` → `feedback`) against the real queue, and it worked. But no separate Claude Code worker session ever consumed the prompt and did the work — **I performed the implementation, review and close-out directly**. So the run measures the *prompt Harbour produced* (§1) but not what a cold worker would have *done* with it. Specifically untested: whether a worker with no prior knowledge could have located the repo given `repo: null`, and whether it would have halted or improvised when step 2 of its own instructions returned a 500.

4. **The adversarial second-read was self-administered.** LIN-2326 requires it, and it was performed — re-derived from the diff rather than from authoring notes, and [recorded on the PR](https://github.com/JKershaw/mangodb/pull/54#issuecomment-5457759195) with a four-item ledger. But it was performed by the same session that wrote the code, not an independent one. Related: LIN-2326 carries no `<!-- harbour-periodical-gate -->` marker, so neither the report-persistence gate nor LIN-2323's adversarial-read gate fires on its Done transition — the second read here was convention, not enforcement.

5. **Jira and GitHub Projects.** Untouched. The provider-lane findings above are measured on GitHub; the research predicted they bite Jira and GH-Projects harder (no `createComment` at all on GH-Projects), but this run did not verify that.

---

## 6. The work itself

Recorded so the lifecycle claim is checkable rather than asserted.

**Issue #52** — `readDocuments()` read the whole collection file with `readFile(path,'utf-8')` and `JSON.parse`. Past V8's `MAX_STRING_LENGTH` (536,870,888 bytes) the *read itself* throws `RangeError: Invalid string length`, so a collection past the ceiling became permanently unreadable — and unshrinkable, since `deleteMany` must read before it writes.

**The fix** ([PR #54](https://github.com/JKershaw/mangodb/pull/54), merged `3d47a35`) — a new `src/stream-json.ts`: a chunked, quote/escape/depth-aware scanner yielding one top-level value at a time, so only one document is ever a string. `readDocuments()` uses it; `db.stats()` — which had the same pattern inside a `try/catch {}` that swallowed the error and **silently reported 0 documents** — counts through it. `loadIndexes()` left alone, per the issue.

**Validation against a real 560,033,382-byte collection:**

| | `main` (`bfcf4d3`) | merged (`3d47a35`) |
|---|---|---|
| `find({}).toArray()` | `RangeError: Invalid string length` | 560 documents |
| `db.stats().objects` | `0` (silently wrong) | `560` |
| `deleteMany` to shrink | impossible | 560 → 260 docs, 560MB → 260MB |

**Tests** — 18 new unit cases, each run at a 1-byte chunk size as well as the default so every state transition is forced across a chunk boundary; plus dual-target integration cases extending the file the write-side fix created. Suite: **1729 passing, 0 failing**. **CI green on the merge commit across all five jobs**, including *Test MongoDB Mode* — the repo's dual-target requirement.

**Residual boundary**, filed not fixed: a *single document* over ~536MB is still unreadable, since the scanner accumulates one whole value ([mangodb#55](https://github.com/JKershaw/mangodb/issues/55)). Not a regression, and far outside MongoDB's own 16MB per-document limit.

---

## 7. Findings filed

| Ticket | Finding |
|---|---|
| **LIN-2350** | `/me` and `/issues/{id}` call Linear-only methods absent from `ProviderInterface` → 500 on every non-Linear provider |
| **LIN-2351** | Every proxy provider error reports "Linear API request failed", whatever the provider |
| **LIN-2352** | `POST /issues` mandates `teamId`; GitHub declares no teams → issue creation unreachable |
| **LIN-2353** | Dispatch lane threads no `providerUi` → prompts tell GitHub workers to update "Linear" |
| **LIN-2354** | `/instructions` and the preamble assert "currently backed by Linear" to every workspace |
| **LIN-2355** | Ungated headroom reads return 500 instead of the documented 422 |
| **LIN-2356** | Raw NUL byte in `routes/proxy.js` makes plain `grep` treat it as binary |
| **LIN-2357** | `promptTraceStore` records `providerUi: null` and nothing surfaces it |

Suggested order if these are picked up: **LIN-2350** and **LIN-2353** are the two that make the agent lane actually usable on a non-Linear workspace; **LIN-2352** is the one that unblocks file-don't-fix; **LIN-2356** is a one-character change that pays back on every future session.

---

## 8. What I would tell the next run

- **The abstraction is real.** Nothing in the dispatch machinery, the queue, the consumer contract, or the recommendation engine needed to know it was talking to GitHub. That is the load-bearing good news, and it is worth more than the eight findings cost.
- **The gap is concentrated in one seam** — the agent-facing proxy's provider threading — not spread through the system. That is a tractable shape.
- **Two of the findings would have changed this run's own observability** (LIN-2353, LIN-2357), so this log is measured with the pre-fix instrument, by construction.
- **The ticket's own framing held up.** It asked not to presume the answer, and the answer came out genuinely mixed: architecture portable, agent lane not exercised. Neither "best dogfooding story" nor "closed loop" is quite right — the accurate statement is that the *machinery* is outward-ready and the *agent lane* has never been outward-tested until today.
- **The cheapest next experiment** is not another full run: it is fixing LIN-2350 and LIN-2353 and re-running this exact ticket, which would cost far less the second time and would test the leg this run explicitly did not cover — a real dispatched worker, cold, on a repo it has never seen.
