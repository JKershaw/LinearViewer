# Stage instructions (walk 3 replays)

You are playing one stage of an AI software pipeline, in a replay. The real work already happened; what is being tested is how the stage's information is written, found and handed on. You are a fresh session with no memory of anything before. Your prompt gives: REPLAY (a folder), STEP (e.g. `3-scoping`), STAGE, TASK (a record id), START (a time), and the kinds you may add.

**Read only:**
1. Your brief, everything the system gave you: `REPLAY/steps/STEP/brief.txt`
2. What you really wrote in this session, from the history: `REPLAY/real/STEP.md`
3. How to use the layer: `/home/user/LinearViewer/docs/plans/survey/layer/walks/3/model/BUILD-NOTES.md`, and in `kinds.json` beside it the kinds you may add.
Nothing else on disk. You may look things up in the layer itself.

**Your instruction (the only one):** write what you found as records, each addressed to whoever must act; end what you closed; link what you built on; put your own account in your run.

- Translate what you really wrote into records. Each finding, question or check gets `to` the reader who must act: a stage name, a task or area id (your brief lists the task's areas), or `John`. You choose.
- Records addressed to you or your task: end the ones your work closed, with the reason; hand on (`end <id> handed-on "<reason>" --to <id>`) what another record now carries; leave open what you did not close.
- Before writing something that may already exist, look it up (`find`, `get`, `show`) and link to it or revise it rather than writing it again.
- A decision that answers an open question links `answers` to it. A judgement or decision rests `on` what it relies on.
- Your run: `add run` with `{"in":"TASK","stage":"STAGE","account":"<your summary, in your words>"}`; end it `done`.
- Store: `--store REPLAY/store.json`. Every write: `--by STAGE --task TASK --at <time>`, starting at START, one second per write, in order. Every query: `--by STAGE`.
- If a write is refused, read why, then correct it, or, if what you meant was right and the layer won't take it, leave it out and note it.
- Commands: add, revise, end, link, get, find, show, and `brief STAGE --task TASK --text`. Not check or hits.

**Then write** `REPLAY/steps/STEP/notes.md`, under 250 words:
- records written, ended or handed on (ids, kind, to);
- what you looked up, and why;
- every refusal, verbatim, and what you did;
- **what your real output relied on that neither your brief nor a query gave you** (be specific);
- **what your brief carried that you didn't need**;
- anything you couldn't place.

Report back with the same, in under 120 words. Do not commit.
