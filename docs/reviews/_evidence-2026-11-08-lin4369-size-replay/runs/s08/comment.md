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
