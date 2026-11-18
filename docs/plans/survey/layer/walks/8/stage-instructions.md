# Stage instructions (walk 8 replays: the revised page, 18 Nov)

You are recording one stage of a software pipeline into a small data store, in a replay. The stage's work already happened and its output is saved in a file; what is being tested is how that information is written, found and handed on in the store. Your prompt gives: REPLAY (a folder), STEP (e.g. `3-scoping`), STAGE (your actor name), TASK (a record id), START (a time).

**Read only:**
1. Your brief, everything the system gave you: `REPLAY/steps/STEP/brief.txt` (for STAGE `John` there is no brief; look up what you need).
2. The stage's saved output, the material to record: `REPLAY/real/STEP.md`
3. How to use the store: `/home/user/LinearViewer/docs/plans/survey/layer/walks/8/model/BUILD-NOTES.md`, and `kinds.json` and `actors.json` beside it.
Nothing else on disk. You may look things up in the store as much as you like, through `layer.mjs` only (never open `store.json` directly).

**Your instruction (the only one):** write what you found as records, each addressed to whoever must act; end what you closed; link what you built on; put your own words in your run.

- Turn the stage's output into records. Any record may carry `to`: whoever must act on it next, an actor (see `actors.json`), a task id, `John`, or `project` (whoever works in this project next; your brief gives the project's counts). Findings, checks and questions must have one. You choose who.
- A verdict rests `on` the exact version it judges. Its outcome is from its set (plan-review and review: approve, approve-with-notes, request-changes, needs-discussion; blind-read: better, same, worse). If it replaces an earlier verdict, end the earlier one `superseded` with `--into` yours.
- A decision may carry a `scope`: a task (it covers that task and every task under it) or `project` (it covers every task). A decision that answers a question links `answers` to it; if it settles the question, end the question `answered`. Use `about` for a subject.
- Records your work closed: end them, with the reason. What another record now carries: end it `handed-on` with `--into` that record. Something you correct: revise it, or supersede it with `--into` the new one. Leave open what you did not close. Records left addressed to a stage that has already run are yours to deal with if they fall to you.
- Before writing something that may already exist, look it up (`find`, `get`, `show`) and revise or link to it rather than writing it again.
- Your run: `add run` with `{"in":"TASK","stage":"STAGE","account":"<a copy of the stage's saved output file>"}`; end it `done`. (STAGE `John`: no run.)
- Store: prefix every call with `LAYER_STORE=REPLAY/store.json` (e.g. `LAYER_STORE=REPLAY/store.json node /home/user/LinearViewer/docs/plans/survey/layer/walks/8/model/layer.mjs find --to STAGE --state open --by STAGE`); there is no `--store` option. Every write: `--by STAGE --at <time>`, starting at START, one second per write, in order. Every query: `--by STAGE`.
- If a write is refused, read why and correct it; if what you meant was right and the store won't take it, leave it out and note it.

**Then write** `REPLAY/steps/STEP/notes.md`, under 250 words:
- records written, revised, ended or handed on (ids, kind, to);
- what you looked up, and why;
- every refusal, verbatim, and what you did;
- **what the stage's output relied on that neither the brief nor a query gave** (be specific);
- **what the brief carried that the stage didn't need**;
- anything you couldn't place.

Report back with the same, in under 120 words. Do not commit.
