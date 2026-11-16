# What Harbour already has

*Written 16 Nov under `design-plan.md` §1b, after the mapping. The expectations were committed before any code was read (`design-expectations.md` §2, `fe1f7ae`). Code facts are on main at `6f6c5d2`, read by me from file headers and the lines cited [checked] unless marked. Marks are as on `situation.md`.*

*This is an inventory, not a plan to gather anything. John: "we don't want to pull too much together or we'll inherit likely too much we don't want, and it distracts from the clean planning. But, we will likely make use of existing functionality." (words §10). So each row says what exists and which choice it belongs to. The avenues are drawn clean first, and only then say what they would use.*

**Choice** marks whether a piece belongs to the choice being moved out of the heart of Harbour, the tracker's ticket as the carrier of everything (words §8), or is general:
- **ticket**: built around the ticket as carrier. Using it would likely bring the leak's routes with it.
- **general**: a mechanism that would serve any structure.
- **both**: a general mechanism, today fed by ticket text.

## The general structure itself

- **Many stores, not one structure.** Harbour has 35 stores (`lib/*-store.js`), each its own collection with its own shape [checked: count]. They share one pattern: a class with an injected `db.collection()`, MangoDB files in development, MongoDB in production (`lib/local-store.js`, header).
- **The local store is the WordPress pattern in miniature.** "One collection (`local-issues`) holds both projects and issues, discriminated by a `kind` field and partitioned by `scope`" (`lib/local-store.js`, header).
- **Versions exist twice:**
  - Task snapshots are "append-only historical archive of task state", written only when the content's hash changes (`lib/task-snapshot-store.js`, header). They version the ticket's text.
  - Model routing keeps "the log of every change" (`lib/model-routing-store.js`, header).
- **Links:** the local store's relations, and dispatch lineages (`lib/dispatch-lineage.js`).
- **Lighthouse:** files in git. CSV rows (`due.csv`, `runs.csv`), Markdown registers, with git as the version history (picture §9).

## The shapes, the candidates, and the needs that are not shapes

| ID | Item | What exists | What is missing | Choice | Lighthouse |
|---|---|---|---|---|---|
| E1 | `plan`, with versions | The plan is the ticket description's `## Implementation Plan` plus comments. Snapshots version the ticket text. The brief distils "a present-tense spec plus a short changelog of the load-bearing turns" by a model from ticket text (`lib/brief.js`, header), cached 7 days (`lib/brief-cache.js:35`) | The plan as its own record; a correction as its next version; a child linking to its piece | ticket (description, prune); both (snapshots, brief) | `brief.md` with dated amendments; `programme.md`; git |
| E2 | `finding` | No data store. Waiting entries live in `docs/areas/*.md`. The proxy refuses a leftover answer without a valid `Retires:` line (`lib/dispatch-leftover-answer.js`, header). The comment classifier names survey comments (`lib/run-trail.js:134-145`). The nearest hand-off with an end is a run proposal: "a run-scoped chat turn must propose, never act … Apply / Decline", with no expiry (`lib/run-proposals-store.js`, header) | A record with an addressee and an end, which code can wake and close | ticket (notes, the `Retires:` conveyor); general (the proposal pattern) | `proposals.md` (no ends); `for-driver.md`; review rows in `due.csv` (with ends) |
| E3 | `check` | No store. "record it as not run" is prose (picture §2). Close-out events store "the open-ledger-item counts at merge" (`lib/close-out-events-store.js`, header). Run proposals' Apply / Decline is the nearest to-do for a person | A check record addressed to John, with an end | ticket (the prose route) | Owner-verification items in a migration note |
| E4 | `question` / `decision` | Rulings:<br>• `DECISION:` lines in sessions' final messages, read by "the ONE predicate" (`lib/unanswered-decisions.js`, header), keyed by the asking loop (picture §3)<br>• a task-keyed store for decisions a scan finds (`lib/task-decisions-store.js`, header)<br>• shelving "with a reason and a re-surface timer" (`lib/shelved-rulings-store.js:3`)<br>• agents may "PROPOSE that a ruling be dismissed; it may never dismiss one" (`lib/dismissal-suggestions-store.js`, header)<br>• one standing read (`lib/ruling-standing.js`) and one settled guard (`lib/ruling-settled.js`)<br>Answers are posted as comments ("Ruling recorded via Harbour") | One record per question, keyed by task. A decider chosen by a setting: no such setting turned up [checked: grep, not exhaustive]. Policy deciders are code or prose: "the standing policy" (`lib/size-of-move.js`); "it's yours — answer it" (the autopilot manual) | general (the rulings machinery); ticket (answers as comments, loop keying) | `registers/decisions.md` (D-000n); proposals' "Keeper: agree" lines |
| E5 | `ask`, to another lane | Nothing sideways. `lib/dispatch-wake.js` is "the pure core of push-based inter-session communication", but up the chain only: a child's stopping point wakes its dispatching parent (header) | An ask addressed to a lane, and a wake for it | general (the wake); ticket (comments on a parent) | `for-driver.md`, a subagent asking the driver |
| E6 | `who is working` | Dispatch rows with kind, issue and dispatch time (`lib/dispatch-store.js`, schema in header, 4,571 lines); lineages (`lib/dispatch-lineage.js`, `lib/lineage-membership.js`); "a stage parked `[pending]` is live until its lineage ends" (`lib/run-live-wait.js:18-19`, picture §4) | Claims on files or areas, to show overlap; refusing a second claim | general | The claim (a row set to running) in `due.csv`; `runs.csv` |
| E7 | task | Four providers (Linear, Jira, GitHub, local) and the local store, which holds projects, issues, comments, labels and relations in one collection (`lib/local-store.js`, header). The sealed ask is a marked block in the description, with its own census test (`tests/unit/as-asked-marker-census.test.js`) | The person's words held apart from any agent's slice, as a field | ticket (the tracker as heart, which John has said the sync moves out, words §8); general (the local store) | `due.csv` rows; `tickets.json` in September |
| E8 | verdict | Read from comment prose by a frozen classifier, "THE ONE COMMENT CLASSIFIER" (`lib/run-trail.js:134-145`: review, close-out, blind read, surveys, plan review, audit), with a verdict-word regex (`:69`). Plan-review verdicts are parsed (`lib/recommendation-facts.js:302`). The close-out decision is pure (`lib/run-closeout-state.js`). The blind-read gate "reads only whether a read is on record, never what it said" (`lib/recommendation-blind-read.js`, header). The Periodical gate reads three fields (`lib/periodical-report-gate.js`) | A verdict stored as a record tied to the version it judged | ticket (a classifier over comment prose); general (the pure decision modules) | `notes/R-nnnn` reviews; the editor's visits |
| E9 | lesson | The notes' Lessons (`docs/areas/*.md`, format in `docs/areas/README.md`), guarded by `tests/unit/area-notes.test.js` and the pointer-bytes test. Rules in code comments | A link to the code it is about, so a change there flags it | ticket (the notes are the cure that leaked, picture §8) | `AGENTS.md`; corrections notices; investigation pages |
| E10 | setting | Feature defaults (`lib/feature-defaults.js`). "The one table that says where every setting lives", with a census test (`lib/settings-areas.js`, header). Model routing: "the one place a job's harness, model and effort live, per workspace, with the log of every change" (`lib/model-routing-store.js`, header) | Who-decides settings (D6). The size policy is code, not a setting | general | `AGENTS.md`, `runner.md`, the drive skill's model by kind |
| E11 | run record | Dispatch rows; cost reads (`lib/cost-read.js`, `lib/task-cost-read.js`); request usage; full traces of recommendation calls (`lib/prompt-trace-store.js`, header); "the one AI-generated, plain-language paragraph that says how a run went", no TTL (`lib/run-paragraph-store.js`, header) | Little. The headline model label is the cost-dominant one (trace 3, row 35) | general | `runs.csv`, `costs.csv` (overwritten in place) |
| E12 | measure | Census tests, for example `as-asked-marker-census`, `classic-loader-census`, `cost-read-census` [checked: names]; the prompt-size budget test; `seams.mjs` and `cochange.mjs` (trace 4) | A value kept with the commit it was taken at, so it is read and never retyped | general | `check.py` output; the comparison scripts |
| E13 | area | `docs/areas/areas.json`, read by `lib/prompts/area-registry-path.js:13`, the prompt templates and `lib/cost-read-calls.js` [checked: grep]. Note that `lib/settings-areas.js` uses "area" for settings pages, a different meaning | The area as an addressee, with something that wakes for it | general (the registry); ticket (the notes per area) | Investigation pages; `studies/LHnnn/` |
| E14 | waking | Up-chain push (`lib/dispatch-wake.js`); `lib/ci-wake-sweep.js`; scheduled jobs (`lib/scheduler.js`, `lib/periodicals.js`); an answered ruling resumes its loop (trace 3, row 21); a shelved ruling re-surfaces on a timer (`lib/shelved-rulings-store.js:12-13`) | A wake for "a record addressed to you is open"; sideways; for an area | general | The daily scheduled run claims what is due (`runner.md`) |
| E15 | read view | The brief, "the smallest artifact that lets an agent start and finish a task correctly without reading the raw history" (`lib/brief.js`, header), and the recap, "what is done, what is pending, and what has deviated" (`lib/recap.js`, header). Both are built from `formatIssueContext`, the ticket's text (`lib/brief.js:10`). Stage prompts are assembled by `generatePrompt` (`lib/prompt-templates.js:258`). The autopilot reads `GET /brief` and `GET /recap` (`lib/prompts/autopilot-kickoff.js:473-474`) | Built from records, not ticket text, and leaving closed records out | both | None computed. A run reads `AGENTS.md`, the checker's output and the brief (picture §9 #7) |
| E16 | need 5: the reader sees everything | The blind read's diff excludes `docs/areas/*.md`, `docs/plans`, `docs/reviews` and `docs/papers` (`lib/prompt-template-defs.js:1072`). Close-out's edits after approval are unread: "Make them yourself … resolve any conflict landing the PR needs" (`:833`) | A scope that includes the notes and post-approval changes | general (a list of paths) | Fresh-agent reviews; "not re-reviewed" fixes |
| E17 | duplicates | Nothing that matches a new finding to an existing one [checked: grep]. The dedupe in `lib/` is for identical snapshots (hash-gated) and for usage roll-ups. A `Retires:` line links one build to one entry | All of it | — | None |

## What this shows

[my reading]
- **The mechanisms are general, and their input is the ticket.**
  - Waking, the brief, the recap, the rulings machinery, the stores, dispatch and cost rows, settings and model routing would serve any structure.
  - What ties them to the ticket is what they read: ticket text (`formatIssueContext`), comment prose (the classifier), Markdown notes.
  - So "use existing functionality" mostly means feeding these mechanisms records instead of text, not carrying them over whole.
- **Three of the frame's shapes have no store at all:** `finding`, `check` and `ask`. These are the hand-offs, which shapes §2 named as the kind that wants an addressee and an end. The nearest existing pattern is the run proposal (Apply / Decline, no expiry).
- **Some cures already exist in small form:**
  - The brief already tries to be the current plan plus its changelog. It rebuilds that from ticket text by a model each time.
  - The rulings already have a defer with a re-surface timer. That is waking for John.
  - The local store already keeps several kinds in one collection.
- **Comment kinds are already declared shapes, read from prose.** `COMMENT_KINDS` declares, per kind, how its comment opens and what it means for the landing. It exists because the records are prose. On the frame the kinds would be the records, and the classifier would have nothing to classify.
- **Things to avoid inheriting** (John's caution):
  - the comment classifier
  - the `Retires:` conveyor and the notes
  - snapshots keyed to ticket text
  - answers posted as comments
  - rulings keyed by loop

  Each is there because information travels as ticket text.
- **For any project.** Lighthouse has an equivalent for most rows, as files in git. It has none for waking beyond its daily run, none for the read view, and none for duplicates. The same three gaps sit at the frame's edge in Harbour (mapping §8).

## Completeness

17 items, E1 to E17: the six shapes (E1–E6), the seven candidates (E7–E13) and the four needs that are not shapes (E14–E17). Each has every column filled [checked: by eye against mapping §6, §8 and §10].
