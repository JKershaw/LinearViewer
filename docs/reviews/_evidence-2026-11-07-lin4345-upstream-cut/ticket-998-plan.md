# LIN-998: Auto-populate Brief and Recap on section open

State: In Progress
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

### 2026-07-04T09:06:37.670Z — None

**Triage — filed & metadata set**

**Filing:** Was project-less; moved into **UX, Theme** (this is a section-open interaction/UX change, not a prompt-engine change). State **Backlog → Todo** (triaged & ready for research). Priority **High → Medium** — a convenience polish, not urgent (rationale below). Left unassigned.

**Request (confirmed via screenshot):** the Brief and Recap sections open to a manual `✦ generate` button ("No brief yet…"), while the **Context** section auto-populates on open. Make Brief/Recap auto-populate on open too.

**Staleness re-grounding (accurate at HEAD):** all three sections lazy-mount through the same `init()` path (`public/app.js:185-207`). `ContextSection.init()` (`public/context.js`) immediately calls `fetchContext()` and renders — the auto-populate reference behavior. `BriefSection.init()` / `RecapSection.init()` (`public/brief.js`, `public/recap.js`) call the status endpoint with no-refresh semantics and land on the `missing` placeholder + manual generate button. So the fix lives in `brief.js`/`recap.js` `init()` (trigger generation on open), not in the prompt engine.

**Key open question for the next stage (drives priority):** Context is a **network-free, deterministic** graph build (effectively free), whereas Brief/Recap generation is an **LLM call with real cost/latency**. Auto-generating on every section open would incur that cost on each expand. Scoping should decide: auto-generate only on *first* open of a *missing/stale* brief (not on every re-expand), avoid duplicate in-flight requests, and never overwrite/clobber a fresh existing brief. That cost tradeoff is why this is Medium, not High.

Ready for research/scoping.

### 2026-07-04T09:12:04.538Z — None

**Research — validated behavior & minimal change path (no refactor required)**

**Staleness re-grounding:** ticket created today (2026-07-04); `git log --since=<createdAt>` on `public/{brief,recap,context,app}.js` + `lib/render.js` shows **zero** commits since. The triage comment's HEAD analysis is still accurate. Re-read at HEAD confirms it.

**Attachment:** the screenshot is a Linear-auth-gated upload the proxy token can't fetch (returns a Linear GraphQL auth error, not an image). Its content — the `✦ generate` / "No brief yet…" placeholder — is already described in the triage note and corroborated directly by the code below, so no grounding claim rests on the unseen image.

---

### What each section does on open, today

All three lazy-mount through the same seam (`public/app.js:176-209` `loadLazySection`, and `public/swipe.js:675-700`), calling `<Section>.init(placeholder, {urlKey, identifier})`. The `content.dataset.loaded='true'` guard + `removeAttribute('data-*-placeholder')` mean **init runs exactly once per mount** — this is the existing in-flight/duplicate guard.

- **Context** (`public/context.js:320-335`): `init()` renders loading, then immediately `fetchContext()` (GET `/api/context/:id`) and renders. There is **no missing/generate state** — it always populates. Server side it's a network-free, deterministic graph build (effectively free), which is *why* it can auto-populate unconditionally.
- **Brief** (`public/brief.js:127-145`) and **Recap** (`public/recap.js:160-178`) are identical in shape: `init()` calls `fetchBriefStatus()`/`fetchRecapStatus()` — a **GET** that returns `{status: 'fresh'|'stale'|'missing'}`. `fresh` → render content; `stale` → placeholder + `↻ refresh`; `missing` → placeholder + `✦ generate`. **Generation only happens in `refresh()`** (the POST), which is wired to the button — never automatically.

### Why the GET/POST split is the whole answer (cost model)

Confirmed in `routes/workspace-api.js`:
- **GET** brief/recap (`:1684` / `:1458`) is a **cheap cache read**: fetch context, hash it, compare to the cached `inputHash` → return fresh/stale/missing. No LLM.
- **POST** (`:1744` / `:1518`) is the **LLM call** (Haiku/configured model), and it is gated: 503 if AI isn't configured, and **free-tier metered (`freeTierStore.tryUse`, 20/day per workspace)**.

This split is what makes auto-populate safe and cheap: **auto-generate only when the cheap GET returns `missing`.** Once generated it's cached, so the next open returns `fresh` and no POST fires. Fresh is never clobbered (we render it, never POST). This directly satisfies every constraint in the brief (don't blindly regenerate; don't overwrite fresh; respect missing-vs-present).

### Surface assessment — REFACTOR NOT REQUIRED

The requested behavior **reuses the existing section-open pattern exactly**. The change is confined to the `else`/`missing` branch of `init()` in `brief.js` and `recap.js`: instead of `renderMissing()`, call the existing `refresh()` (which already does generating→POST→fresh/error and re-wires the button). No new endpoints, no state store, no structural change to the lazy-mount flow. Because `init()` is the shared module both `app.js` (dashboard cards) and `swipe.js` (swipe deck) mount through, the fix lands on **both surfaces** for free.

Minimal diff sketch (per file):
```js
} else if (data.status === 'missing') {
  await refresh(container, opts.urlKey, opts.identifier); // auto-generate on first open
  return; // refresh() already wires the button; avoid the double wireRefresh below
}
```

### Recommended scope (V1)
- **Auto-generate on `missing` only.** Leave `stale` on the manual `↻ refresh` (auto-refreshing stale would re-spend an LLM call every time inputs drift — a re-open tax). This is the safest, cheapest first cut and answers open-question #1 (first-open-of-missing, not every re-open) and #2 (stale = `inputHash` mismatch, already computed server-side; no new state needed).
- **In-flight dedup:** already handled by the `dataset.loaded` mount guard; `renderGenerating()` shows no button, so no double-trigger. (Open-question #4 — reuse, don't add.)
- **UI while generating:** reuse the existing `renderGenerating()` spinner (open-question #3 — the pattern already exists).

### Risks / open questions to settle before/at implementation
1. **Free-tier / cost creep:** auto-generating on open now spends the 20/day free-tier budget passively as a user expands cards, where before it required an explicit click. Confirm this is acceptable, or gate auto-gen behind "AI configured & not free-tier" and keep the manual button otherwise. **This is the one genuine product decision** — everything else is mechanical.
2. **Error/503 on open:** if AI isn't configured, auto-gen turns a dismissible `✦ generate` button into an error banner on every open. `refresh()`'s catch already renders the error inline (no crash), but consider detecting the unconfigured case and falling back to the manual placeholder rather than erroring unprompted.
3. **Tests:** existing `tests/e2e/{brief,recap}.spec.js` are **API-level** (assert GET=missing / POST=fresh) and are unaffected. The new client behavior (init auto-POSTs on missing → lands generating→fresh with no click) needs its own coverage.

Ready for planning — recommend a plan step that (a) makes the product call on risk #1, then (b) implements the ~2-line-per-file change + a client behavior test.
