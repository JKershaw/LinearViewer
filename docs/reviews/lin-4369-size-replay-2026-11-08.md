# Scoping writes the size record, replayed (8 November 2026)

LIN-4369 is piece 3 of LIN-4346. Scoping's output becomes the `## Size of the move` record, and
the ticket says: "Before anything routes tickets to it automatically, it has to be shown on past
tickets that the written size carries no how, and that a small, clear ticket stays small under
'err larger'." "If the replay fails: stop, report on LIN-4346, and do not begin piece 4."

This is evidence for review, not a CI result. The pre-registration
(`_evidence-2026-11-08-lin4369-size-replay/preregistration.md`), the briefs, the rendered prompts
and the ticket inputs were committed and pushed in `70e9ec9e`, before any run started.

## Result: the replay fails

| Criterion (fixed in the pre-registration) | Result | Judged by |
| -- | -- | -- |
| 1. The control stays small: all 3 LIN-998 records are "just the task", no extra | **fail, 0 of 3** (all three "consolidate the decision this task touches") | fresh reader |
| 2. Every record passes the piece-2 guard | **fail, 5 of 12 pass** | code (`checkSizeRecord`) |
| 3. No record tells the builder how (LIN-4178, 4252, 4253) | **fail, 2 of 9 clean** | fresh reader |
| 4. Every size that cuts the ask raises a `DECISION:` | **pass, 6 of 6** read literally; 3 more unflagged cuts on substance | fresh reader |

By the pre-registered rule, the result is recorded as it is and reported on LIN-4346, and piece 4
(LIN-4370) does not begin. No prompt text was changed after the runs. A revised prompt would be a
new arm with its own pre-registration.

## Per run

| Run | Ticket | Size | Decided by | Guard (first write) | `DECISION:` | Reader, crit. 3 |
| -- | -- | -- | -- | -- | -- | -- |
| r08 | LIN-998 | consolidate | policy | pass | yes (free-tier cut) | n/a (control) |
| r09 | LIN-998 | consolidate | policy | pass | yes (free-tier, AI-off cuts) | n/a |
| r10 | LIN-998 | consolidate | policy | **refused**, numbered steps | yes (free-tier, AI-off cuts) | n/a |
| r03 | LIN-4178 | consolidate | policy | **refused**, code span `` `/kpis` `` | no (no cut named) | pass (borderline) |
| r04 | LIN-4178 | consolidate | policy | pass | no (no cut named) | pass |
| r05 | LIN-4178 | consolidate | policy | **refused**, numbered steps | yes (three cuts) | **fail**: fixture numbers, population rules |
| r02 | LIN-4252 | a small tidy | policy | **refused**, code span `` `replaceWith` `` | no | **fail**: lists the selector forms; dictates header text |
| r07 | LIN-4252 | just the task | policy | pass | no | **fail**: dictates header text and implementation rules |
| r12 | LIN-4252 | a small tidy | policy | **refused**, numbered steps | no | **fail**: lists the query forms; invariants ready to become docstrings |
| r01 | LIN-4253 | just the task | policy | **refused**, code span (a commit sha) | no | **fail**: lists kinds and entry paths; a definition ready for code |
| r06 | LIN-4253 | consolidate | policy | **refused**, code span (a commit sha) | yes (two cuts) | **fail**: lists kinds and entry paths |
| r11 | LIN-4253 | consolidate | policy | pass | yes (one cut) | **fail**: a per-path, per-kind list |

Every record read back through `readSizeRecord` with a size and a decided-by (`guard-results.tsv`).
No record chose "wrong work" or a size smaller than the ask, and no record put a policy-decided
cut past the guard.

## What went wrong, as the outputs show it

- **The control sized up every time, on the Surveys' findings.** Both LIN-998 Surveys called the
  ticket a cost decision and named generate-or-serve logic that lives in four places. All three
  scoping runs read that as something this task binds on, chose "consolidate" under err-larger,
  and named an extra: one shared serve-or-generate rule that merges duplicate requests. They then
  read the free tier as a cut and blocked on a ruling. For comparison, the real LIN-998 was built
  as just the task (PR #786), met the ask in full, and John chose the fullest option at close-out.
  "'Just the task' is as easy to recommend as any" did not hold against Surveys that find
  something deeper on almost every ticket.
- **The records became plans.** Most records carry "what done means" and "settled for the
  builder" sections. The how leaks in there: lists of kinds and entry paths to cover, invariants
  worded like docstrings, what a file's header should say, expected fixture figures. Scoping's
  lead still says "settle what it should deliver and what done means". This piece removed the
  In/Out/Success block but left the lead unchanged, because the lead's first sentence is in the
  routing prompt, which piece 4 owns. With the record as scoping's only output, the stage wrote
  its whole scope into it.
- **The guard caught what the prompt did not.** Seven first writes carried backticks (a commit
  sha, `` `/kpis` ``, `` `replaceWith` ``) or numbered lists, although the prompt says "no file,
  code, name to sweep or step". Live, each would get a 422 naming the line and could rewrite it.
  No run here could, so how a run rewrites after a refusal is not measured. The guard missed the
  how that the reader found: none of it was a path or a code span.
- **Runs disagree on what a cut is.** r01, r03 and r04 make changes that r06, r11 and r05 call
  cuts and raise as rulings. Whether a narrowing is named, and so reaches a person, still depends
  on the run, as in LIN-4345's replay.

## The fresh reader's verdict

A subagent started after every run had finished, given the pre-registration, the tickets, the
Survey comments and the runs' outputs, and nothing about how the template was written. Its
verdict is reproduced unedited in `_evidence-2026-11-08-lin4369-size-replay/reader-verdict.md`.
Its summary:

> The replay **fails**: the pre-registration needs all four criteria to hold, and criteria 1 and
> 3 do not.

Outside the criteria, it also notes: the policy pushes sizes up across the board (7 of 12
"consolidate"); runs on the same ticket disagree on the size and on the extra; scoping decides
things the ask left to the builder (LIN-4178's note 1); two records state facts about the replay
host ("a local MongoDB server is installed"); and one decided-by line carries extra words after
the value.

## Limits

- **n = 3 per ticket, one arm.** This measures whether the pre-registered bar is met, not the size
  of an effect. There is no comparison arm, because the old scoping text writes no size record.
- **Offline, so stricter than live on criterion 2.** No run met a 422 and retried.
- **The fresh reader is a subagent of the session that built the change.** It had none of the
  build's context, only the files listed above. It is not an independent person.
- **All runs were Claude Code subagents on Opus 5.5**, the model the session ran on, not
  necessarily the model a live scoping dispatch would use.
- **The Surveys were run once per ticket.** Different Survey comments could move the sizes.

## Setup and commands

- **Snapshots:** `curl "$HARBOUR_LOCAL_BASE/api/proxy/issues/LIN-<n>/snapshots"` for LIN-4178,
  4252, 4253, 998 and 4176 (the parent of LIN-4178).
- **Bases:** each ticket's base is `main` when it was filed (`git rev-list -1 --first-parent
  --before=<filed> origin/main`): `10b2c82fb`, `29f14bf6e`, `29f14bf6e`, `973a8ec77`. One clone per
  base holding history only up to it (`git init -b main base; git -C base fetch --no-tags
  file://<repo> <sha>; git -C base update-ref refs/heads/main <sha>`), then `git clone --local
  base runs/<id>/code` per run.
- **Tickets as filed.** The first snapshot's description is sealed into an `## As asked` block,
  with LIN-998's origin marker moved below the end line, as LIN-4345's `build_tickets.py` does it.
  The comments filed with the ticket are kept (LIN-4178: 23:02:00; LIN-998: 09:06:37), and the
  output goes to `tickets/issue-<n>.json`. Each scoping run's `ticket.md` is that description,
  those comments, and the ticket's two Survey comments from this replay (`tickets/ticket-<n>.md`).
- **Rendering**, LIN-4345's `render.mjs` path, with the parent, the policy and the pinned base:

  ```js
  // node render.mjs <worktree> <issue.json> <kind> <out>
  process.env.NODE_ENV = 'test';
  import { readFileSync, writeFileSync } from 'node:fs';
  const [wt, issuePath, kind, out] = process.argv.slice(2);
  const { generatePrompt } = await import(`${wt}/lib/prompt-templates.js`);
  const t = JSON.parse(readFileSync(issuePath, 'utf8'));
  const issue = { id: 'replay', identifier: t.identifier, title: t.title, description: t.description,
    state: { name: 'Todo', type: 'unstarted' }, labels: [], comments: [] };
  const parent = t.identifier === 'LIN-4178' ? { identifier: 'LIN-4176', title: 'Costs rebuild 1: one cost read that every surface asks' } : null;
  const sizePolicy = { value: 'err-larger', setBy: { via: 'page' }, setAt: '2026-11-07T22:18:14.300Z' };
  const context = { parent, siblings: [], project: { name: 'Harbour' }, children: [], comments: [], sizePolicy };
  let prompt = generatePrompt(kind, issue, context).prompt;
  if (kind.startsWith('survey-')) prompt = prompt.replaceAll('{BASE}', t.base);
  writeFileSync(out, prompt);
  ```

- **Runs.** 8 Survey runs (`s01`–`s08`), then 12 scoping runs (`r01`–`r12`), each a fresh
  subagent given its brief verbatim with only its directory (and, for a Survey, its base) filled
  in, in shuffled order (`run-map.tsv`). Every clone was clean afterwards.
- **Guard check** (criterion 2), in `guard-results.tsv`:

  ```js
  // node guard.mjs <repo> <issue.json> <description.md>
  import { readFileSync } from 'node:fs';
  const [repo, issuePath, recPath] = process.argv.slice(2);
  const { checkSizeRecord, readSizeRecord } = await import(`${repo}/lib/size-of-move.js`);
  const live = JSON.parse(readFileSync(issuePath, 'utf8')).description;
  const next = `${live}\n\n${readFileSync(recPath, 'utf8').trim()}`;
  const r = readSizeRecord(next);
  console.log(JSON.stringify({ guard: checkSizeRecord(live, next), size: r?.size ?? null, decidedBy: r?.decidedBy ?? null }));
  ```

No runnable script is committed under `docs/reviews`; the two above are recorded here only.
