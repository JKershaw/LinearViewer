**Title:** Watch agents work as it happens: each run's words, live and readable in Harbour

## What this is for

John wants to watch an agent while it works. The session driving a run also needs to see what the run actually tried, not only what it says it did.

Today a run's words reach Harbour only when it stops at the end of a turn. On 20 Nov a run went quiet and we couldn't tell whether it had tried `railway` or was stuck. It gets worse with nesting: when a run hands work to a background agent and waits, its feed freezes until the child is done, and that looks exactly like a stall (LIN-1905 saw 75 minutes of it).

## What we want

- Each run's words reach Harbour while it works, not only at the end of a turn. The point is to know what it's up to, so the agent's text is enough: no tool calls.
- The run page shows them as a conversation people can read. Tidy on a phone and in dark mode.
- Finished entries look finished. Only the newest entry of a live run shows as in progress.
- The page updates by itself while a run is live. No reload.
- A run waiting on a child agent says so, and what it waits on, instead of going silent. The child's own feed is one click away.
- One look for a run's transcript wherever it appears (the run page and Dispatch history today).
- A driving session can read the same record over the API and see, step by step, what was tried.
- **Requirement:** secrets are masked when feedback arrives, before it is stored. An agent's words can quote a token too.

**Settled by John (20 Nov):** stream during a turn; text only, no tool calls; transcripts stay in the permanent feedback record.

## Done when

- During a live run, the agent's new words show on the run page within a heartbeat or so, without a reload.
- A test posts feedback containing a known secret pattern. The stored row, the API read and every page show it masked.
- A finished run's transcript shows no in-progress markers.
- A run parked on a child shows what it waits on and for how long, and stays visible on Live Console.
- A driving session reading `GET /api/proxy/dispatch/:id` can follow what a run said it was doing, in order, while it runs.
- At 390px wide, the transcript doesn't overflow.

## Replaces

- **LIN-1114** (full transcripts). Kept: every run's words reach Harbour, nested runs too, kept permanently. Dropped: tool calls and "via telemetry" (a how).
- **LIN-3976** (run page brief). Kept here: the page stays current without reload, and transcript times read like the rest of Harbour. The rest of its redesign (heading, Stop, evidence styling, close-out, member view, task context) moves to the UI work under LIN-4008, after the UI-layer tidy.
- **LIN-1905** (frozen feed when nested). Kept: a waiting parent says what it waits on, the child is one click away, the lane doesn't drop off Live Console. Dropped: the waiting heartbeat as written, since the runner now sends "[working · verifying] … (task)" for background waits.
- **LIN-1311** (Observation transcript onto the chat look). Kept: one look for transcripts. Dropped: its target. The Observation Level-3 transcript no longer exists (stale since July). The surviving fork is `public/dispatch.js` `renderFeedbackEntries`.
- **LIN-2546** (in-progress pill never settles). Kept in full. Still true at `public/session.js:142`.

## Not in this ticket

- The rest of LIN-3976's run page redesign (moved to the UI work, LIN-4008).
- Tool calls (John: the words are enough). The tool relay stays off.
- Flight Companion's double-settled bubble (LIN-2546's side note, `public/flight-companion.js:688`).
- The feedback route's rate limit (John: flexible).

## Where to read

Runner (simple-dispatcher):
- `hook.js:256-317`: posts each turn's text at Stop (LIN-4165, on by default).
- `config.js:1325`: `SD_TOOL_ACTIVITY_RELAY` (tool calls), which stays off.
- `reapers.js:231-260`, `heartbeat.js:352`: the 30s heartbeat reads the transcript but posts only a summary.

Harbour (LinearViewer):
- `routes/dispatch.js:1613`: feedback intake. No masking.
- `lib/secret-scan.js`, `lib/mask-secrets-in-html.js`: used today only by `routes/task-share.js`.
- `lib/render-session.js`, `public/session.js:115-150`: the run page transcript.
- `public/dispatch.js:1054`: Dispatch history's separate transcript.
- `lib/live-console.js`: lanes drop after `laneStaleMs`.
- `lib/dispatch-feedback-kinds.js`: feedback kinds (`assistant-text`, `tool`).

Open: whether a PENDING-EXTERNAL wait (waiting on another session) gets the same "waiting" heartbeat as a background task. Not checked.

Every change names what it retires. Questions: settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
