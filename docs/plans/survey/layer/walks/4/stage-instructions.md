# Stage instructions (walk 4 replays)

You are playing one stage of an AI software pipeline, in a replay. The real work already happened; what is being tested is how the stage's information is written, found and handed on. You are a fresh session with no memory of anything before. Your prompt gives: REPLAY (a folder), STEP (e.g. `3-scoping`), STAGE (your actor name), TASK (a record id), START (a time).

**Read only:**
1. Your brief, everything the system gave you: `REPLAY/steps/STEP/brief.txt`
2. What you really wrote in this session, from the history: `REPLAY/real/STEP.md`
3. How to use the store: `/home/user/LinearViewer/docs/plans/survey/layer/walks/4/model/BUILD-NOTES.md`, and `kinds.json` beside it.
Nothing else on disk. You may look things up in the store itself, as much as you like, through `layer.mjs` only (never open `store.json` directly; added after step 5 of LIN-4450 did).

**Your instruction (the only one):** write what you found as records, each addressed to whoever must act; end what you closed; link what you built on; put your own account in your run.

- Translate what you really wrote into records. Each finding, question or check gets `to` the reader who must act: an actor (see `actors.json`), a task or area id (your brief lists the task's areas), or `John`. You choose.
- Records your work closed: end them, with the reason. What another record now carries: end it `handed-on` with `--into` that record. Something you correct: revise it, or supersede it with `--into` the new one. Leave open what you did not close.
- Before writing something that may already exist, look it up (`find`, `get`, `show`) and revise or link to it rather than writing it again.
- A decision that answers a question links `answers` to it; if it settles the question, end the question `answered`. A verdict or decision rests `on` the exact version it relies on; use `about` for a subject.
- Your run: `add run` with `{"in":"TASK","stage":"STAGE","account":"<your summary, in your words>"}`; end it `done`.
- Store: `--store REPLAY/store.json`. Every write: `--by STAGE --at <time>`, starting at START, one second per write, in order. Every query: `--by STAGE`.
- If a write is refused, read why and correct it; if what you meant was right and the store won't take it, leave it out and note it.

**Then write** `REPLAY/steps/STEP/notes.md`, under 250 words:
- records written, revised, ended or handed on (ids, kind, to);
- what you looked up, and why;
- every refusal, verbatim, and what you did;
- **what your real output relied on that neither your brief nor a query gave you** (be specific);
- **what your brief carried that you didn't need**;
- anything you couldn't place.

Report back with the same, in under 120 words. Do not commit.
