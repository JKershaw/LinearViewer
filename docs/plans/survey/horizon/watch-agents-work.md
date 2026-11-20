**Title:** Watch agents work as it happens: each run's words and tool calls, live and readable in Harbour

## What this is for

John wants to watch an agent while it works. The session driving a run also needs to see what the run actually tried, not only what it says it did.

Today a run's words reach Harbour only when it stops at the end of a turn. Its tool calls don't reach Harbour at all. On 20 Nov a run went quiet and we couldn't tell whether it had tried `railway` or was stuck. It gets worse with nesting: when a run hands work to a background agent and waits, its feed freezes until the child is done, and that looks exactly like a stall (LIN-1905 saw 75 minutes of it).

## What we want

- Each run's text and tool calls reach Harbour close to when they happen.
- The run page shows them as a conversation people can read: the agent's words as messages, tool calls as quiet one-line steps between them. Tidy on a phone and in dark mode.
- Finished entries look finished. Only the newest entry of a live run shows as in progress.
- The page updates by itself while a run is live. No reload.
- A run waiting on a child agent says so, and what it waits on, instead of going silent. The child's own feed is one click away.
- One look for a run's transcript wherever it appears (the run page and Dispatch history today).
- A driving session can read the same record over the API and see, step by step, what was tried.
- **Requirement:** secrets are masked when feedback arrives, before it is stored. This lands before tool calls are switched on.

John's calls (keep today's behaviour until he rules):
1. Stream during a turn, or send only at the end of each turn (today)?
2. Do transcripts stay in the permanent feedback record, or move to a separate store with a size cap?

## Done when

- During a live run, a new message or tool call shows on the run page without a reload, as soon as John's call 1 allows.
- A tool call shows as one line: the tool and a short head of what it ran. Never its output.
- A test posts feedback containing a known secret pattern. The stored row, the API read and every page show it masked.
- A finished run's transcript shows no in-progress markers.
- A run parked on a child shows what it waits on and for how long, and stays visible on Live Console.
- A driving session reading `GET /api/proxy/dispatch/:id` can list the commands a run tried, in order.
- At 390px wide, the transcript doesn't overflow.

## Replaces

- **LIN-1114** (full transcripts). Kept: every run's text and tool calls reach Harbour, nested runs too. Dropped: "via telemetry" (a how). "Keep everything" becomes John's call 2.
- **LIN-3976** (run page brief). Kept: the page stays current without reload, and transcript times read like the rest of Harbour. Dropped: the rest of the redesign (heading, Stop, evidence styling, close-out, member view, task context). It is still true at main but isn't about watching.
- **LIN-1905** (frozen feed when nested). Kept: a waiting parent says what it waits on, the child is one click away, the lane doesn't drop off Live Console. Dropped: the waiting heartbeat as written, since the runner now sends "[working · verifying] … (task)" for background waits.
- **LIN-1311** (Observation transcript onto the chat look). Kept: one look for transcripts. Dropped: its target. The Observation Level-3 transcript no longer exists (stale since July). The surviving fork is `public/dispatch.js` `renderFeedbackEntries`.
- **LIN-2546** (in-progress pill never settles). Kept in full. Still true at `public/session.js:142`.

## Not in this ticket

- The rest of LIN-3976's run page redesign.
- Flight Companion's double-settled bubble (LIN-2546's side note, `public/flight-companion.js:688`).
- Tool output. Only the one-line summary.
- The feedback route's rate limit (John: flexible).

## Where to read

Runner (simple-dispatcher):
- `hook.js:256-317`: posts each turn's text at Stop (LIN-4165, on by default).
- `config.js:1325`: `SD_TOOL_ACTIVITY_RELAY`, off. `transcript.js:240-280`: the one-line tool format.
- `reapers.js:231-260`, `heartbeat.js:352`: the 30s heartbeat reads the transcript but posts only a summary.

Harbour (LinearViewer):
- `routes/dispatch.js:1613`: feedback intake. No masking.
- `lib/secret-scan.js`, `lib/mask-secrets-in-html.js`: used today only by `routes/task-share.js`.
- `lib/render-session.js`, `public/session.js:115-150`: the run page transcript.
- `public/dispatch.js:1054`: Dispatch history's separate transcript.
- `lib/live-console.js`: lanes drop after `laneStaleMs`.
- `lib/dispatch-feedback-kinds.js`: feedback kinds (`assistant-text`, `tool`).

Open: whether a PENDING-EXTERNAL wait (waiting on another session) gets the same "waiting" heartbeat as a background task. Not checked.
Open: LIN-3976's dropped asks are still live at main. Whether they retire with it or move to the UI lane (LIN-4008) is John's call.

Every change names what it retires. Questions: settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
