# Stage instructions (walk 7 replays: stages writing through round 6)

You are playing one stage of an AI software pipeline, in a replay. The real work already happened; what is being tested is how the stage's information is written, found and handed on. You are a fresh session with no memory of anything before. Your prompt gives: REPLAY (a folder), STEP (e.g. `3-scoping`), STAGE (your actor name), TASK (a record id), START (a time).

**Read only:**
1. Your brief, everything the system gave you: `REPLAY/steps/STEP/brief.txt` (for STAGE `John` there is no brief; look up what you need).
2. What you really wrote in this session, from the history: `REPLAY/real/STEP.md`
3. How to use the store: `/home/user/LinearViewer/docs/plans/survey/layer/walks/7/model/BUILD-NOTES.md`, and `kinds.json` and `actors.json` beside it.
Nothing else on disk. You may look things up in the store as much as you like, through `layer.mjs` only (never open `store.json` directly).

**Your instruction (the only one):** write what you found as records, each addressed to whoever must act; end what you closed; link what you built on; put your own words in your run.

- Translate what you really wrote into records. Any record may carry `to`: whoever must act on it next, an actor (see `actors.json`), a task or area id (your brief lists the task's areas), or `John`. Findings, checks and questions must have one. You choose who.
- A verdict rests `on` the exact version it judges. Its outcome is from its set (plan-review and review: approve, approve-with-notes, request-changes, needs-discussion; blind-read: better, same, worse). If it replaces an earlier verdict, end the earlier one `superseded` with `--into` yours.
- A decision may carry a `scope`: a task (it covers that task and every task under it) or an area (it covers every task whose paths overlap the area). A decision that answers a question links `answers` to it; if it settles the question, end the question `answered`. Use `about` for a subject.
- Records your work closed: end them, with the reason. What another record now carries: end it `handed-on` with `--into` that record. Something you correct: revise it, or supersede it with `--into` the new one. Leave open what you did not close. Records left addressed to a stage that has already run are yours to deal with if they fall to you.
- Before writing something that may already exist, look it up (`find`, `get`, `show`) and revise or link to it rather than writing it again.
- Your run: `add run` with `{"in":"TASK","stage":"STAGE","account":"<what you really wrote, in full, verbatim>"}`; end it `done`. (STAGE `John`: no run.)
- Store: prefix every call with `LAYER_STORE=REPLAY/store.json` (e.g. `LAYER_STORE=REPLAY/store.json node /home/user/LinearViewer/docs/plans/survey/layer/walks/7/model/layer.mjs find --to STAGE --state open --by STAGE`); there is no `--store` option. Every write: `--by STAGE --at <time>`, starting at START, one second per write, in order. Every query: `--by STAGE`.
- If a write is refused, read why and correct it; if what you meant was right and the store won't take it, leave it out and note it.

**Then write** `REPLAY/steps/STEP/notes.md`, under 250 words:
- records written, revised, ended or handed on (ids, kind, to);
- what you looked up, and why;
- every refusal, verbatim, and what you did;
- **what your real output relied on that neither your brief nor a query gave you** (be specific);
- **what your brief carried that you didn't need**;
- anything you couldn't place.

Report back with the same, in under 120 words. Do not commit.
