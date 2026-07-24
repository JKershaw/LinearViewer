# LIN-1412 — Chat interface: target contract + §2 proposal (design beat 1/5)

Branch: `lin-1412-chat-design`  •  Base HEAD: `b42a4c9bec9ed85c660faccd66fe7132ff595df8`  •  research ran at `2e61e8bb`

Research (comments `0cd0621e`, `3c4e74af`, `6cadc3f7`, `5649130a`) is complete. This beat fixes the
*shape* and makes it reviewable. No production code touched.

---

## 0. Re-grounding at HEAD

Six commits since `2e61e8bb`, all LIN-1495 (model pricing) and LIN-1511 (proxy pagination).

```
git diff --stat 2e61e8bb..b42a4c9b -- public/chat.css public/chat.js public/task-chat.js \
  public/task-chat.css lib/render-session.js public/session.js public/session.css \
  public/collective.js public/collective.css public/roadmap.js public/roadmap.css \
  lib/render-task-chat.js lib/render-collective.js public/style.css public/llms.txt
→ (empty)
```

All four surfaces and the shared layer are byte-identical to the audited state. The only
chat-adjacent file that moved is `lib/session-telemetry.js`, which feeds the Observation feed's
metrics projection — not S2's transcript. **The audit stands at HEAD**; every citation this
contract promotes was re-verified in this checkout, and three of them needed correcting (§4).

---

## 1. The target contract

### 1.0 Where the layer lives, and the one structural claim

`public/chat.js` becomes the shared chat **behaviour** layer, keeping its current markup-construction
functions as the low-level half. This is the `Surface Assessment: refactor required` verdict from
`5649130a`, and it is unchanged by this beat.

The contract below is stated as **ownership**, because that is the thing that was wrong: today the
shared layer's own header disclaims behaviour — *"It owns no fetch/transport/state… each page keeps
its own poll/stream/echo logic"* (`public/chat.js:9-12`) — and every rule the guide weights most
heavily is behaviour. The split this contract draws is:

> **The layer owns everything between the user's keystroke and the DOM. The surface owns everything
> between the DOM and the network.**

Surfaces keep: transport (SSE / poll / queued dispatch / reload), auth and session semantics, the
`data-feedback` hydration boundary (`public/session.js:117-120`), thread density via the
`--chat-thread-*` seam, speaker labels and status-pill states, empty-state copy, tool breadcrumbs
(`appendNote`), saved-chat/resume affordances, and page layout.

**Provisional API shape** — enough for beats 2–3 to build against, not yet a final signature:

```js
var chat = ChatUI.mount(threadEl, {
  composer:     composerEl,          // omit → read-only transcript, no composer rules apply
  submitKey:    'enter',             // 'enter' (default) | 'mod-enter'
  markdown:     true,                // default true for stacked bubbles, false for --row/log
  onSend:       function (text, turn) { /* surface owns transport; returns a promise */ },
  onStop:       null,                // present → Stop control exists; absent → it never renders
  atBottomPx:   120
});
chat.appendMessage(opts);            // today's signature, unchanged
chat.appendNote(text, opts);         // today's signature, unchanged
var s = chat.beginStream(opts);      // s.write(chunk) · s.done() · s.fail(err, {retry})
```

`mount()` is additive: a surface that never calls it keeps today's behaviour exactly, which is what
makes this landable in stages across three live surfaces.

---

### 1.1 §9 — Scroll policy *(the layer owns all of it)*

| Rule | Layer owns | Surface owns | Promote from |
|---|---|---|---|
| 9.1 Auto-scroll only when at/near bottom | **All.** The at-bottom test runs inside `reveal()` (`public/chat.js:25-29`), the single function every shared consumer calls on every append | nothing | **S3's rule, re-targeted** — `public/collective.js:249-252`. See correction C1: the rule is right, the *measured box* is wrong |
| 9.2 "Jump to latest ↓" + new-count | **All** — the control, its count, its visibility, its smooth-scroll click | placement slot only | **Nobody has it.** New |
| 9.3 Pin a streaming message only if at bottom when it started | **All** — latched once at `beginStream()`, not re-tested per token | nothing | **Delete, don't adapt:** `public/task-chat.js:315` and `public/roadmap.js:776` scroll unconditionally per token |
| 9.4 Preserve scroll across re-render | **N/A today** — no surface re-renders a live thread in place | — | See correction C2 |
| 9.5 Smooth for user-initiated, instant for programmatic | **All** | nothing | Confirmed safe: the only `scroll-behavior` in the repo is `auto !important` inside the reduced-motion block (`public/style.css:340`) — no global smooth scroll to fight |

**Why this is the load-bearing section.** `reveal()` has three call paths and no per-surface variant;
`chat.js:85` and `chat.js:111` call it on every `appendMessage`/`appendNote` unless the caller passes
`reveal: false`. Fixing S1's hijack means changing the function S2 and S3 call. There is no
per-surface fix that is not a fourth copy of scroll policy.

---

### 1.2 §6 — The composer *(layer owns semantics; surface owns transport)*

| Rule | Layer owns | Surface owns | Promote from |
|---|---|---|---|
| 6.1 Auto-growing textarea | **All** — grow to ~8 lines then scroll internally; shrink after send | nothing | **Nobody has it.** New. Requires `<input type="text">` → `<textarea>` on S1, S3 and S4 — two of the three are **server-rendered**, so cheaper than the research implied: `lib/render-task-chat.js:81` and `lib/render-collective.js:211` are one-line markup edits, and only S4's is client-built (`public/roadmap.js:707-708`). S2 is already a textarea with `rows="2"` (`lib/render-session.js:156`) |
| 6.2 Enter sends, Shift+Enter newline | **All**, via `submitKey` | choosing the value (recommendation: everyone on `'enter'`) | S1's guarded handler `public/task-chat.js:356-358`. Today the four disagree three ways — see §5 decision D3 |
| 6.3 Send disabled when empty / while responding | **All** — bound to the input's own `input` event, so the disabled state is *rendered*, not just enforced at click | nothing | S3's `if (!message) return` (`public/collective.js:430`) is the check; **the rendered state is new** |
| 6.4 Send becomes Stop during generation | **The control and its state machine** | supplying `onStop` at all | **Nobody has it.** New. **Absence is a valid configuration, not a violation**: S2 queues a dispatch (`public/session.js:45-50`) and S3's participants are remote sessions — neither has anything local to cancel, so they pass no `onStop` and the control never renders. S1/S4 stream over SSE and get an `AbortController` |
| 6.5 Clear input on send + return focus | **All** | nothing | S1's clear-before-fetch (`public/task-chat.js:275`) is the right *timing*. **The layer must drop S1's `setBusy()`** (`:249-254`), which disables the input for the whole response and is the actual reason focus never returns. Contract: **the composer is never disabled during generation** — only the send control changes |
| 6.6 Preserve draft on error | **All** | optional cross-navigation persistence | S2/S3 clear-only-on-success (`public/session.js:59`, `public/collective.js:443`). Reconciled with 6.5: **clear immediately into a retained buffer, restore on failure.** Neither surface has this today — S2/S3 keep the draft by *not* being optimistic, which 7.2 removes. Cross-navigation localStorage persistence has in-repo precedent at `public/feedback-widget.js:6-11` |
| 6.7 Visible focus state | **All** — inherit the global `:focus-visible` ring (`public/style.css:330-333`) | nothing | **Contract: no chat surface sets `outline: none`.** S2 (`public/session.css:442-445`) and S4 (`public/roadmap.css:868-871`) both do, contradicting the component layer's own rule (`lib/components/button.js:16-17`). A border-change may be added *alongside* the ring, never instead |
| 6.8 Touch targets | **All** — `min-height: 40px` on send/stop/message actions under `@media (pointer: coarse)` | nothing | **40px, not the guide's 44px** — Harbour's own ticketed floor (LIN-786). Scoped to a chat send class, **not** to `.action-btn` (`public/common-actions.css:11-20`, no `min-height`), which is shared with dispatch/proxy/settings/audit and must not be moved by this ticket |

---

### 1.3 §7 — States *(layer owns the state machine; surface owns the content)*

| Rule | Layer owns | Surface owns | Promote from |
|---|---|---|---|
| 7.1 Empty / first load | the slot and its hidden/shown logic | **the copy** | S1's three worked examples (`lib/render-task-chat.js:79`). S2's *echo* thread is correctly `hidden` when empty (`lib/render-session.js:154`, `public/chat.css:55`) — an echo thread has nothing to say until you send. S2's real empty state belongs to the run transcript; beat 2's mockup owns it |
| 7.2 Optimistic send | **All** | nothing | S1 (`public/task-chat.js:272`). **Paired with 7.5, which is what answers the objection in `5649130a` §2b.4**: optimism is safe when the layer can also mark the turn *failed*. S2 may then append optimistically and fail the turn if the queue POST rejects |
| 7.3 Thinking indicator within 100ms | **All** | nothing | S1's synchronous caret (`public/task-chat.js:277-278`, `public/chat.css:161-168`) for streaming surfaces. For non-streaming surfaces the indicator is a **pending state on the user's own turn**, not a caret — S2/S3 need this and the caret would be a lie there |
| 7.4 Streaming with caret | **All**, via `beginStream()` | feeding it chunks | S1's token loop (`public/task-chat.js:311-317`), with one change: `answerEl.textContent = answerText` per token cannot survive markdown. Contract: **buffer raw text, re-render on a throttle boundary (rAF), never per token, never re-animate settled text** (§8) |
| 7.5 Error + Retry | **All** — per-turn error state carrying a Retry that re-fires the surface's `onSend` | the error *string* | **Nobody has it.** New. Two notes: S4's truncation copy `[output truncated — hit token limit]` (`public/roadmap.js:779-782`) is the one genuinely good failure string in the four and should survive; and §7's "never a vague message" is violated **server-side** at `routes/task-chat.js:492` (`'Failed to generate a response'`), so a Retry control alone does not discharge this rule |
| 7.6 Rate-limited / disabled says why | **All** | nothing | **Nobody has it.** New — but the signal already exists: the free-tier limiter returns 429 with usage metadata (CLAUDE.md → Free Tier). No chat surface reads it |

---

### 1.4 §4 — Message and code-block rules

| Rule | Layer owns | Surface owns | Promote from |
|---|---|---|---|
| 4.1 Render markdown | **All** — the call | the `markdown:` boolean | S2's `window.renderMarkdown` = marked + DOMPurify (`public/session.js:133-135` → `public/common.js:262-268`). Default **on** for stacked bubbles, **off** for `.chat-thread--log`/`.chat-msg--row` (Collective's single-line IRC rows, `public/chat.css:124-139`), where block markdown would break the row |
| 4.2 Style the rendered markdown | **All** — new CSS in `chat.css` scoped under `.chat-msg__text` | nothing | **Nothing to promote.** `.markdown-content` matches no rule in the repo — re-verified at HEAD: `grep -rn "markdown-content" public/*.css` returns exactly one hit and it is the comment at `public/session.css:319`, which *claims* it "reuses the established `.markdown-content` sizing". There is no such established sizing. Headings/lists/tables render at browser defaults |
| 4.3 Code blocks: mono, distinct bg, h-scroll, language label | **All** | nothing | **Nothing to promote.** The only code styling in the repo is page-scoped to Swipe (`public/swipe.css:447-454`) and `.issue-description` (`public/style.css:1480`). Mono is `--font-structural` (JetBrains Mono, `public/style.css:47`) |
| 4.4 Copy button + message actions on hover | **All** | which actions to offer | **Nothing to promote** — copy-to-clipboard is hand-rolled per surface (`public/app.js:1133`, `public/collective.js:412`); the layer needs a shared helper, which is also the first thing a `lib/components` sibling would want |
| 4.5 Identity once per group | **All** — suppression is automatic and a **no-op** on strictly-alternating transcripts | nothing | New, but cheap. Live for S2 (every entry is `who: 'agent'`, `public/session.js:145`) and S3; structurally impossible to violate on S1/S4 (correction C3) |
| 4.6 Timestamps secondary | **All** — suppress within a group | passing `time` at all | Already muted and small (`public/chat.css:116-120`); only the *frequency* is wrong |
| 4.7 Line height 1.5–1.6 | already met (`public/chat.css:92`) | — | keep |
| 4.8 Full-width, no bubbles for rich output | already met — `.chat-msg` is label-above-body, not asymmetric bubbles (`public/chat.css:70-86`) | — | keep, no change |

---

## 2. §2 — Visual direction *(a proposal for John, not a decision)*

The guide leaves §2 deliberately blank and says its own numbers defer to whatever fills it
(§Purpose: *"a strong default, not a law — adapt to the existing stack and the visual direction
defined in §2"*). Harbour has a direction already. **I propose adopting it, with two named
exceptions.** John can reject any line of this.

### The proposed §2 answer

- **Personality:** *dense and technical — a terminal that reads like a document.* Low radius,
  restrained motion, information-first.
- **Palette (existing semantic tokens, no new values):** surface `--bg`; elevated `--card` /
  `--inset`; primary text `--text`; muted `--muted` and `--fg-vdim`; accent `--brand`; semantic
  `--red` / `--green` / `--amber`. Light is default, `.theme-dark` is the opt-in override, so a
  token-only chat layer themes for free (`public/chat.css:31-34`).
- **Type — the one place Harbour is *stricter* than the guide.** The guide asks for one body face
  plus one mono. Harbour splits by *content kind*, not by element (LIN-785/782):
  `--font-structural` = JetBrains Mono for machine facts, `--font-content` = Inter for human prose
  (`public/style.css:47-48`). Applied to chat: **message prose is sans; code blocks, IDs, paths,
  timestamps and the `--row`/log variant are mono.** This is a refinement of §2, not a conflict —
  but it exposes a live inconsistency: `chat.css` sets message text in sans (`:90`) while S2
  overrides it to mono (`public/session.css:321-323`). The two surfaces currently disagree about
  which side of the split a chat message falls on. **This proposal resolves it as sans.**
- **Radius:** the token scale 5/8/14/999 (`public/style.css:74-77`) — *not* the guide's 12–16px
  bubbles. A low radius is what the CLI direction means in practice.
- **Space:** `--space-1..5` = 4/8/16/24/32px. **The guide's 24px-between-turns / 8px-within maps
  exactly onto `--space-4` / `--space-2` with no new tokens** — the §3 rhythm rule is free.
- **Motion:** `--motion-fast: 120ms` / `--motion-base: 240ms` (`public/style.css:140-142`). The
  guide's 120ms micro-feedback matches exactly; its 150–200ms entrance does not, and I propose
  **using `--motion-base` (240ms) rather than minting a 180ms token** — §13.10's "no one-off values"
  outranks a 40ms deviation. Honest note: 240ms is at the slow edge of "subtle".

### What this overrules

**1. The 720px column — OVERRULED, and replaced rather than simply refused.**

`body { max-width: 120ch }` carries the comment `/* Optimal reading width */` (`public/style.css:298`)
and dates to the initial commit. It is the app's oldest deliberate layout decision. But the guide's
720px is about *prose reading fatigue*, and Harbour's 120ch is about *not wrapping paths, IDs, tables
and box-drawing*. Those are not the same constraint, so I propose serving both with a per-element
measure instead of one page-level number:

> The thread keeps the page's full 120ch (code blocks, tables and `--row` transcripts need it), and
> **`.chat-msg__text` prose is capped at ~80ch** — which lands at roughly 600–720px depending on face
> and size.

*Counter-argument, stated plainly:* 80ch is close enough to the guide's 720px that this may be the
guide winning while wearing Harbour's units. If John reads it that way, the honest version is
"we adopted 720px in `ch`" — and that is fine, it just should not be sold as a Harbour-wins outcome.

**2. The 15px body-size floor — KEPT for message prose, OVERRULED for chrome.**

§5 phrases it as the only absolute in a table of soft numbers ("**never** below 15px"). Today
`.chat-msg__text` is `0.85rem` ≈ 13.6px (`public/chat.css:91` against `body { font-size: 16px }`,
`public/style.css:293`) and `.sess-tx-msg` is `0.82rem` ≈ 13.1px (`public/session.css:323`).

> Proposal: **message prose goes to `0.9375rem` = 15px exactly.** Speaker pills, timestamps,
> `.chat-note` breadcrumbs and the `--row`/log line stay at `--font-size-sm` (0.85em).

The reasoning: the floor is aimed at the text you *read*; Harbour's density is about the chrome you
*scan*. That is the smallest honest overrule — accept the rule where it was aimed, decline it where
it wasn't. *Counter-argument:* 15px sans message text inside a 13–14px mono page may simply look
wrong, and there is no way to settle that from source. **Beat 2's mockup must render it both ways
against a long, real agent answer.** If it looks wrong, the fallback is to overrule the floor
outright at 14px and record that as a §2 decision — once, explicitly, not silently per surface.

**3. Touch targets 44px → 40px.** Harbour's floor is ticketed (LIN-786, "40px touch targets for
primary actions") and within 10% of a strong default. The real defect is unrelated to the guide:
chat send controls are `.action-btn` at roughly 24px (`public/common-actions.css:11-20`, no
`min-height` anywhere) and S4's is ~28px (`public/roadmap.css:877-878`) — **all four sit below
Harbour's own floor.**

### What it keeps

Line-height 1.5–1.6 (already met), the 4/8/16/24/32 space scale, the 24/8 speaker rhythm, one
consistent token set with no one-off values, and every behavioural rule in §6/§7/§9 — none of which
§2 touches. The guide's warning about AI-default clichés (cream + serif + terracotta; near-black +
acid accent) is moot: Harbour's direction predates the guide.

### The counter-argument to the whole proposal

Harbour's direction was set for **dense scanning surfaces** — trees, feeds, tables, status rows. A
chat transcript is the one surface in the product that is mostly **long-form prose with code**, i.e.
precisely the content type a CLI aesthetic is worst at. Adopting the house direction wholesale
imports a density decision that was never tested against a 400-word markdown answer.

The real alternative, which John may prefer: **treat chat as a reading surface** that borrows
Harbour's palette, tokens and dark-mode plumbing but takes the guide's proportions — 720px, 15–16px,
more air — as a documented, deliberate exception. That is a coherent position, not a cop-out.

What decides it is not argument, it is beat 2: **the same real agent answer rendered both ways.**
I recommend the proposal above; I do not think it is settled.

---

## 3. Measurement obligations attached to the contract

`5649130a` established that **nothing in CI tracks any rule in the guide on any surface**, and that
LIN-1298 discharged its ledger on attested screenshots and shipped half its written scope. So each
rule above carries the check that proves it, and the contract is not satisfiable by screenshot:

- **§9** → E2E scroll-position assertions (`scrollTop` after append at top / at bottom; jump-to-latest
  visible then clicked). **The only new technique** — `grep -rn "scrollTop" tests/e2e/` returns one
  action and no assertion today.
- **§6** → `boundingBox()` for auto-grow and the 40px floor; `keyboard.press` for the key convention;
  `page.route` failure injection for draft survival; `toBeFocused()` for focus return. Every one of
  these is already used somewhere in `tests/e2e/`.
- **§7** → `page.route` with a deliberate delay is the exact discriminator for optimistic send
  (turn present in the DOM *while the request is pending*); `route.abort()` for error + Retry;
  `emulateMedia({ reducedMotion })` for §8.
- **§4** → unit assertions on the rendered markdown/code-block markup; the five existing
  class-presence assertions (`tests/unit/render-task-chat.test.js:36-39`,
  `render-collective.test.js:44-47`, `render-session.test.js:77-83,282,337`) must keep passing.
- **§13.10 "no one-off values"** → a **CSS lint**, not an E2E check. With a caveat the research
  missed: `public/style.css:72-73` documents that "the bespoke 2/7/9px sanctioned radii stay as
  per-element literals — LIN-863", so Roadmap's `border-radius: 2px` (`public/roadmap.css:864,880`)
  is a **sanctioned literal, not a violation**. Any lint must allow 2/7/9px radii or it will fire on
  eight legitimate sites in `roadmap.css` alone.
- **Not measurement:** the visual specs write PNGs "without asserting anything" and are excluded from
  `npm test` (`playwright.visual.config.js:3-8`); a `/styleguide` entry proves the primitive renders,
  not that a surface behaves. Both are worth having. Neither is a gate.

Also load-bearing when the markup moves: `public/llms.txt` documents chat DOM at `:251` and
`:321-339` (verified accurate at HEAD — the `task-chat-msg-*` hooks still ride along,
`public/task-chat.js:85-90`), and `lib/render-styleguide.js` has zero chat references, which is where
the primitives should get an entry.

---

## 4. Corrections to the research

**C1 — S3's §9 check is the right rule measured against the wrong box.** `3c4e74af` named
`public/collective.js:249-252` best-in-class, and the *rule* is right. But it measures the
**window**: `window.innerHeight + window.scrollY >= document.body.scrollHeight - 120`. Collective's
transcript is its own scroller — `.collective-transcript` is a `.chat-thread.chat-thread--log`
(`lib/render-collective.js:208`) with `--chat-thread-max-height: 60vh`
(`public/collective.css:314-316`) and `overflow-y: auto` from `public/chat.css:49-50`. So a user
scrolled up *inside the thread* while the page happens to be at its bottom is judged "near bottom"
and yanked down by `scrollIntoView` (`:251`) — §9's cardinal sin, in the surface named as the model
for it. **Promote the rule; re-target the measurement to the thread element**
(`el.scrollHeight - el.scrollTop - el.clientHeight <= 120`), with a documented document-scroll
fallback for a thread that is not its own scroller.

**C2 — §9.4 "preserve scroll across re-render" is N/A today, not violated.** `3c4e74af` ruled S1
VIOLATES because switching tasks does `transcript.innerHTML = ''` (`public/task-chat.js:266`). That
wipe is *correct* — history is per-task and the comment at `:264` says so; a new conversation should
not inherit a scroll position. No surface re-renders a live thread in place, and S2's continuation
arrives via full page reload (`public/session.js:61-62`), which no client rule can survive. The rule
becomes live only if a surface gains in-place history loading. Beats 2–3 should not design for it.

**C3 — confirming `5649130a`'s own correction.** Identity-once-per-group is N/A for S1 and S4
(strictly alternating turns), live for S2 and S3. Re-verified: `public/task-chat.js:272,277` are the
only two `appendBubble` call sites in a send, and tool breadcrumbs go through `appendNote` →
`.chat-note` (`:137`), not `.chat-msg`. The contract handles this by making group suppression
automatic, so no surface needs to configure it.

*Minor:* `3c4e74af` cited S3's composer as `public/collective.js:426`, which is the `getElementById`
lookup; the `<input>` itself is server-rendered at `lib/render-collective.js:211`. The verdict is
unchanged, but it moves the 6.1 edit from a client script to a renderer.

---

## 5. What beat 1 does not decide

**D1 — Does S4 (Roadmap chat) converge onto the shared layer, or is it explicitly scoped out?**
Converging is a self-contained rewrite of `public/roadmap.js:690-812` + `public/roadmap.css:826-899`
with no other consumers. It is the surface violating the most rules. Scoping it out leaves a fifth
chat idiom in the product and must be a *named* decision. **Recommendation: converge** — but it is
the one place where "who pays" has a bystander, so it is John's call.

**D2 — Embedded panels on a shared spine, or §3's viewport-anchored full-page chat?** Three of four
surfaces are deliberately panels inside other pages. Full-page is what makes §3's bottom-anchored
input, 120px clearance and the mobile-keyboard rules meaningful; staying embedded puts them
permanently out of reach. This is the real design question and it is not resolvable from code.
**Beat 2's mockup will show both** rather than argue it.

**D3 — Does the send key converge on Enter across all four?** Today: Enter (S1, S4), unguarded Enter
(S3, `public/collective.js:476-478` — no `shiftKey` check at all), Cmd/Ctrl+Enter (S2,
`public/session.js:184-189`). The guide asks for the near-universal convention and the research named
cross-surface inconsistency as a real user cost. **Recommendation: all four on Enter-sends /
Shift+Enter-newline**, with `submitKey: 'mod-enter'` retained in the API as a documented escape hatch
that no surface uses at ship time. *Counter:* S2's box is a long-form reply where Enter-to-send fires
on every paragraph break — this changes existing muscle memory on the one first-class surface.

**D4 — The §2 questions above**: the 80ch measure, the 15px floor, and sans-vs-mono for message
prose.

Not in scope either way, and stated so it does not drift in: the dispatch feedback list
(`public/dispatch.js:890-906`) is a read-only log, not a chat surface — it belongs to LIN-1311's
class, which needs its own re-grounding (its premise is stale at HEAD).
