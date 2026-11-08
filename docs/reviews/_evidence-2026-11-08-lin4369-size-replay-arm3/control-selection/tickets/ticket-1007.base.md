# LIN-1007: Add task chat link to the main project page

State: Todo
Labels: none

## Description

## As asked

Add a link to chat with a task to the main project page.

---

* **Page:** `https://projects.jkershaw.com/workspace/linearviewer/task-chat`
* **Browser:** `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36`

*End of what was asked. Steps write below this line; nothing above it changes.*

**Origin — raw feedback (triage first):** this ticket was filed directly from the in-app feedback widget, so it is an unfiltered user report, not a triaged or scoped task. Its natural next step is **triage**: work out what is actually being asked, confirm the real priority, and scope it before any research or implementation.

## Comments (oldest first)

### 2026-07-04T12:30:51.262Z (posted with the ticket)

**Triage (coordinator pass)**

Raw in-app feedback report, filed from `/workspace/linearviewer/task-chat` on mobile Chrome. Corrected metadata so the next stage can proceed cleanly:

- **Project:** _none_ → **UX, Theme.** The request is a navigation/UI affordance (surface a "chat with this task" link on the main project page), which is squarely UX.
- **Priority:** High → **Medium.** This is an unscoped nicety, not urgent; High was the widget default, not a considered ranking.
- **Labels:** added **Improvement** (enhances existing navigation, not net-new capability) and **scoping** (real open questions remain — see below).
- **State:** Backlog → **Todo** (triaged and accepted; ready for scoping).

**Scope tension the next stage must resolve (do not implement yet):**
task-chat is currently an **experimental** view (`taskChat` flag, default off), and per the View Tiers policy experimental features are deliberately surfaced **only** via a Settings link — *not* from first-class pages like the main project page. There is currently **no** task-chat link in `render.js`/footer/navbar, so the request is genuine, but it sits against that policy. Scoping should decide between: (a) a **per-task** "chat" affordance on issue rows, gated on the `taskChat` flag (respects tiers); or (b) **promoting** task-chat out of experimental first. Also open: exact placement/label, and whether it applies to all tasks or only some states.

No implementation done — this is a triage/organization pass only.
