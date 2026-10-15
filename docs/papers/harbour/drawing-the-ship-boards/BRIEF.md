# Harbour Map — shared design brief

## What Harbour is
Harbour (harbour.cat) is one developer's control plane for AI-built software: it reads a backlog (Linear, GitHub, Jira, local), turns the next task into a grounded prompt, dispatches it to a fleet of AI agent sessions, and verifies the result on evidence (CI, merges, a review ledger). One human (John) steers a fleet sized for one engineer, on a ~$200/month subscription. A conversational supervisor, the "Flight Companion", drives fleets through chat.

Harbour's voice is nautical and evidence-minded (passages, legs, the helm, rulings, the Archive). Its typographic rule: **mono (JetBrains Mono) for machine facts** (IDs, counts, paths), **a humane face for human structure** (headings, prose, controls). Status marks: ✓ done, ◐ in progress, ○ todo. Light theme is the default.

## The problem this design solves
Harbour is about *tasks*, not *code*. It holds a first-class model of the work but none of the code's *decisions*. The Flight Companion learned to fly a fleet, and the fleet kicked out tickets galore. Failures now live **between** tasks: a sibling filed instead of fixed, a decision re-decided inline, a spec written five times. What's missing is **the map**: code areas, their decisions, warnings, research, and recommendations — rich and non-linear — so that one engineer can see the project whole and choose what the fleet does next. It pairs with the chat that drives the fleet. It is a NEW concept: do not default to a traditional SaaS dashboard (cards + sidebar + line charts).

## Information hierarchy to think through (yours to challenge)
1. **The heading** — is the project on course? A handful of north-star readings.
2. **The areas** — 11 code areas, each with condition, decisions held in several places, warnings, readiness to rewrite.
3. **The threads** — non-linear connections: one finding traced across code → ticket → review → ruling → paper → money. The best findings come from following one thread across layers.
4. **The sources** — every claim links down to its evidence (ticket id, file:line, report, commit). Summaries never replace sources; every statement is dated and grounded at a commit, and shows as stale when the code has moved on.
5. **The recommended actions** — few, ranked, each one a decision for the human; "go" moves batched into one informed approval, never a stream of clicks (people stop reading approvals).

## Real data to use (as of 14 Oct 2026 — do not invent other numbers; use [placeholders] for anything missing)

**North-star readings**
- Correct, complete changes: baseline ~47/week (since mid-July; 95/week in June).
- Sessions per ticket (median / 90th pct): late Sep 8 / 16 → 11–13 Oct 5 / 8. Review rounds per ticket 1.46 → 1.00. Median hours per ticket 2.2 → 0.8.
- Cost per verified task: **unreadable** — the pricing table has no rows for the two models now doing nearly all the work (Opus 5.5, Sonnet 5.5). Last known: $19.63 (August).
- Places per decision: **23** decisions still held in more than one place (1 High: runner contract; 1 Medium-High: credentials; 3 Medium; 10 Low-Medium; 8 Low). 3 of them born or grew this week.
- Rulings waiting on John: **0** open. 275 in history; ~1 in 10 was a repeat of the same question.
- Open ticket pile: 1,229 (939 Backlog, 273 Todo, 17 In Progress); 316 are review residue.
- Fleet: window cap 50 sessions; a 20-session day used ~27% of the weekly token quota; weekly budget resets Thu 15 Oct.

**The 11 code areas** (files; readiness to rebuild behind a seam; what blocks it)
- Front end: browser code — 36 — Low/unmeasurable — `public/common.js` global hub (46 window.* assignments)
- Front end: server-rendered pages — 68 — Medium — ordering logic living in a renderer (`render-swipe`)
- Agent API (proxy) — 30 — Medium — `RefResolutionError` pulled up by Providers; 59 dead imports in `routes/proxy.js`
- Runs & dispatch — 89 — Low–medium — largest area, 78 entry files; `chat-tools` back edge
- LLM & prompts — 64 — Medium — two layers in one name; `chat-tools` ↔ Runs (10 of 17 edges from one file)
- Auth, accounts & workspaces — 52 — Medium — auth↔pages 12/15
- Providers (Linear, GitHub, Jira, local) — 35 — **Highest** — only 3 upward edges; but its spec is written 5 times (one test file per provider, no shared conformance suite)
- Platform & plumbing — 24 — High — KPI readers mislabelled into it
- Web routes — 21 — Medium — routes used as libraries (`routes/dashboard.js` exports)
- Other features — 9 — High (small)
- Wiring (`server.js`) — 1 — n/a — loads `routes/test.js` in production
- Whole graph: 429 files, 19 two-way area pairs, one knot of 9 of 11 areas; 0 file-level import cycles.

**Threads found today (real, follow-able)**
- LIN-3504 (task page shows a stale question) → done right in the new ticket style → but re-decided a neighbouring "is it still waiting?" decision inline at `lib/task-page-loader.js:148` → reviewer filed the sibling as LIN-3513 instead of fixing → that decision ("waiting on a person": 3 copies, 5 inline checks) is parked behind a ruling from John.
- Rulings are stored per session, not per decision → one question reached John 3 times (LIN-3502 window cap) → the false-escalation KPI.
- Pricing gap: `lib/model-pricing.js` lacks Opus 5.5 / Sonnet 5.5 → `/cost` returns null → north-star headline unreadable → the hourly pricing sweep only checks rows that exist, so it reports clean. Ticket LIN-3094 covers Opus 5.5, not Sonnet 5.5.
- Coherence vs seams: the coherence loop's batch 3 raised cross-area links 255 → 310, because "one place per decision" put the place in another area. Each gauge's rules hand the tension to the other; nobody owns it.
- Front door: `scripts/env-check.sh` can never fail (LIN-2386, Backlog); "Log in with Linear" 503s on unconfigured self-host (LIN-3108); README and `llms.txt` still describe "a collapsible tree".
- Gate on inviting anyone: LIN-3404 (High) — GitHub install callback trusts installation_id without checking access.

**Loops running**
- Coherence loop (LIN-3449): 3 batches, 26 decisions brought to one place, product code −363 lines, 13 of 13 latest reaching one owner, 0 regressed. Batch 4 (tests) waiting for Thursday's budget.
- Periodicals (16): Drift & Coherence, Seams & Tangles (new 13 Oct), Onboarding & Cold-Start, Code Quality, Stability, Recent Headwinds, Design & Interface, etc.

**Recommended actions candidates (real)**
1. Price Opus 5.5 & Sonnet 5.5 (unblocks the headline number).
2. Spike LIN-3404 against a test installation (gates inviting anyone).
3. Extract one provider conformance suite before rewriting Providers.
4. Rule on "does a blocked agent start the waiting clock?" (unparks a decision).
5. Read the Seams gauge with Drift when choosing each consolidation's one place.

## Format rules (the canvas runs these files — follow exactly)
Write ONE self-contained file `project/<Name>.dc.html`. Skeleton:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Short screen name</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&amp;display=swap" rel="stylesheet">
<style>
body{margin:0}
a{color:#...}a:hover{color:#...}
</style>
</helmet>
<div style="...root...">
  ... markup ...
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1440,"height":1100}}'>
class Component extends DCLogic {
  renderVals() { return { ... }; }
}
</script>
</body>
</html>
```

Rules that fail silently if broken:
- Keep `<script src="./support.js"></script>` exactly. Close every non-void element; quote every attribute.
- `{{hole}}` is a dotted lookup into `renderVals()` ONLY — never an expression (`{{a+b}}`, `{{!x}}` fail). Compute in renderVals.
- Repeats: `<sc-for list="{{items}}" as="item" hint-placeholder-count="3"> … {{item.x}} … </sc-for>`. Branches: `<sc-if value="{{cond}}" hint-placeholder-val="{{true}}">…</sc-if>`.
- Events: `onClick="{{pick}}"` where `pick` is a function from renderVals; per-item handlers attached to each item in renderVals (`items: xs.map(x => ({...x, pick: () => this.setState({sel: x.id})}))`). State via `this.state` / `this.setState`.
- All UI is markup, never script-built (no innerHTML/appendChild/window.X). Classic JS, `class Component extends DCLogic`, no imports.
- Inline `style="…"` for element styling; `<helmet><style>` only for page basics and a/a:hover colors. Layout with flex/grid + gap.
- Root: fluid page (this is a PAGE): `width:100%; max-width:1440px; box-sizing:border-box`, no `vh`, px/rem heights. Should degrade sensibly at phone width (wrap).
- No network except one Google Fonts `css2` link in helmet. No images/data URIs; draw with markup/inline SVG (decorative SVG `aria-hidden="true"`, meaningful SVG `role="img" aria-label`). Icons: inline stroke SVG, never emoji. No iframe.
- Accessibility: real `<button>` / `<a href>` for anything clickable; text contrast ≥4.5:1; colours told apart also differ in lightness; prefer blue/orange over red/green.
- Fonts: JetBrains Mono for machine facts + ONE humane face of your choice from Google Fonts (not Inter/Roboto/Arial). No gradient washes, no left-border accent cards, no emoji.
- `data-props` declares only a few real levers (e.g. a density or view toggle), never copy.
- No lorem ipsum, no invented numbers: use the data above or a [placeholder].
- Do NOT render, screenshot, open, or verify the file. Write it once, carefully. Do not publish anything.
