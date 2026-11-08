# LIN-998: Auto-populate Brief and Recap on section open

State: Todo
Labels: none

## Description

## As asked

Currently we open these sections and then click to generate the output. The Context section auto populates - can we make Brief and Recap populated on section open too.

---

* **Page:** `https://projects.jkershaw.com/workspace/linearviewer/`
* **Browser:** `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36`

![](https://uploads.linear.app/a8c4b5e3-5392-42fb-884e-086f691fa0b8/c8e954d3-1fee-47e8-8dc0-2000bea73cb2/2579554a-82d0-4c7b-9f61-8076569dcf3d)

*End of what was asked. Steps write below this line; nothing above it changes.*

**Origin — raw feedback (triage first):** this ticket was filed directly from the in-app feedback widget, so it is an unfiltered user report, not a triaged or scoped task. Its natural next step is **triage**: work out what is actually being asked, confirm the real priority, and scope it before any research or implementation.

## Comments (oldest first)

### 2026-07-04T09:06:37.670Z (posted with the ticket)

**Triage — filed & metadata set**

**Filing:** Was project-less; moved into **UX, Theme** (this is a section-open interaction/UX change, not a prompt-engine change). State **Backlog → Todo** (triaged & ready for research). Priority **High → Medium** — a convenience polish, not urgent (rationale below). Left unassigned.

**Request (confirmed via screenshot):** the Brief and Recap sections open to a manual `✦ generate` button ("No brief yet…"), while the **Context** section auto-populates on open. Make Brief/Recap auto-populate on open too.

**Staleness re-grounding (accurate at HEAD):** all three sections lazy-mount through the same `init()` path (`public/app.js:185-207`). `ContextSection.init()` (`public/context.js`) immediately calls `fetchContext()` and renders — the auto-populate reference behavior. `BriefSection.init()` / `RecapSection.init()` (`public/brief.js`, `public/recap.js`) call the status endpoint with no-refresh semantics and land on the `missing` placeholder + manual generate button. So the fix lives in `brief.js`/`recap.js` `init()` (trigger generation on open), not in the prompt engine.

**Key open question for the next stage (drives priority):** Context is a **network-free, deterministic** graph build (effectively free), whereas Brief/Recap generation is an **LLM call with real cost/latency**. Auto-generating on every section open would incur that cost on each expand. Scoping should decide: auto-generate only on *first* open of a *missing/stale* brief (not on every re-expand), avoid duplicate in-flight requests, and never overwrite/clobber a fresh existing brief. That cost tradeoff is why this is Medium, not High.

Ready for research/scoping.

### (Survey, survey-task, posted before work began)

## Survey open-0: LIN-998 @ 973a8ec77

**Context doesn't load earlier than Brief or Recap. It's just cheaper.** All three sections fetch only when their toggle is opened: `loadLazySection` in `public/app.js` for the tree view, and the accordion handler in `public/swipe.js` (~675) for Swipe. What differs is the fetch:

- **Context** (`lib/context-graph.js`) is a deterministic graph with no model call. It's free and returns instantly.
- **Brief and Recap** send a GET (`routes/workspace-api.js` ~1458 and ~1684) that only checks the cache and returns `fresh`, `stale` or `missing`. On `missing` or `stale` the client shows a generate button. Only the POST calls the model.

The code change is small: in each module's `init()` (`public/brief.js`, `public/recap.js`), call `refresh()` when the GET comes back `missing` or `stale`. The hard part is the policy.

**Why it's harder than it looks**

1. **Cost and quota.** Every model call is a click today. With this change, opening a section spends money. Users without an OpenRouter key draw on the free tier (`lib/free-tier-store.js`: 20 a day per workspace, 50 an hour globally), which is shared with prompt generation. Generating on `stale` makes it worse: any new comment changes `inputHash`, so every later open regenerates.
2. **Failures look different.** The POST returns 503 when AI isn't configured and 429 when the free tier runs out. On open, these would show as error states where a harmless "generate" button sits now. `lib/render.js` (~886) also renders these sections without checking `featureFlags.aiRecommendations`, so auto-generation would ignore workspaces with AI turned off.
3. **Latency and duplicates.** Generation runs long enough that the route needs `armKeepalive` to avoid Heroku's H12 timeout. Nothing on the server stops duplicates, so two tabs mean two paid calls.
4. **Both views change together.** The tree view and Swipe share `BriefSection` and `RecapSection`, so a module change also changes Swipe. Decide that on purpose. Expect e2e updates in `tests/e2e/swipe.spec.js` (~483), and possibly in `brief.spec.js` and `recap.spec.js`.

**There's a precedent.** The agent-facing proxy routes (`routes/proxy.js` ~3395 and ~3700) already generate on GET when the cache is missing or stale. `?noRefresh=1` opts out, and the free-tier charge comes only after the cache check, so a cache hit is never billed.

**What I'd do first.** Settle three questions in triage before writing code:

- Auto-generate on `missing` only, or on `stale` too?
- Do free-tier users get it at all? I'd say only with a paid or session key, falling back to the button otherwise.
- Should opening one section also start the other?

Then add an `autoGenerate` option to both modules' `init()`, turn 503 and 429 into the manual state, and pass the option from `app.js` (and from `swipe.js` if Swipe should change too).

**The deeper problem.** The user really wants the content waiting when they open the section. Generating in the background when a task changes, or when it's dispatched, would remove the wait and the duplicates, at a higher cost. Weigh that in triage too.

### (Survey, survey-place, posted before work began)

## Survey global: LIN-998 @ 973a8ec77

**Where it lands.** In two shared client modules, `public/brief.js` and `public/recap.js`. Both the tree view (`public/app.js` `loadLazySection`, LIN-522) and swipe (`public/swipe.js` `handleAccordionClick`) mount them. Behind them sit the GET/POST pairs in `routes/workspace-api.js` (~L1450–1830). The client side is converging: the tree view reuses the swipe modules and the helpers moved to `common.js` (LIN-421/422). What's left is duplication. `brief.js` and `recap.js` are near-mirrors. The brief/recap generate-and-cache logic exists four times: workspace-api GET/POST plus the proxy GET/POST in `routes/proxy.js` (5.1k lines).

**The ticket treats Brief and Recap as the same kind of section as Context. They aren't.** Context auto-populates because it's deterministic and free: no LLM, no cache (LIN-572). The Brief and Recap GETs only check the cache. Their POSTs make paid OpenRouter calls and use up the free tier (`freeTierStore.tryUse`, 20 a day per workspace). The "missing → ✦ generate" step is deliberate and matches Observation's written cost contract (LIN-595, `public/observation.js`: "LLM generation happens only on an explicit button"). The agent-facing proxy GET does the opposite and regenerates on a miss or stale cache. Triage should treat this as a cost decision first, not just a UI tweak.

**Done the obvious way.** `init()` in both modules calls `refresh()` when the status is `missing` (maybe `stale` too). That's two parallel edits, and it fixes both surfaces. Effects:
- Opens are always a click; nothing reopens on reload. But every open of a missing or stale section now spends. Stale is common, because any comment or state change alters `hashContext`.
- When AI isn't configured or the free tier is exhausted, the friendly "No brief yet" placeholder becomes a 503/429 error.
- The same issue can be mounted twice (In Progress plus the tree, LIN-732), and POSTs have no in-flight dedupe.
- `renderMissing()` becomes mostly dead. `public/llms.txt` ("lazy AI brief/recap") goes stale quietly. The e2e specs (`tree-sections.spec.js`, `swipe.spec.js` ~L496) match loose state regexes and would most likely still pass. Nothing would notice the change in cost stance.

**Better, at a cost this task can carry.** Add an explicit `autoGenerate` option to both `init()`s, chosen by the caller and off by default. Auto-generate on `missing` only, and only with a paid key. Keep the button for `stale` and for free-tier users. Fall back to the missing placeholder on 503/429. Write the rule down as one line beside the LIN-595 contract in CLAUDE.md, update `llms.txt`, and add one e2e test that opening a missing section reaches `fresh` with the local AI mock.

**Better still, not this task's.**
1. Merge `brief.js`/`recap.js` into one cached-AI-section factory.
2. Pull the eight brief/recap handlers (workspace plus proxy) into one generate-or-serve seam with per-(workspace, issue) in-flight coalescing. That would also settle the human-vs-agent "regenerate on miss" split in one place.
