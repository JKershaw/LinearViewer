# Improvement cycles: the operator's runbook

This is for an agent asked to run a cycle of improvements on Harbour as the operator. You need this page, the repository and the standing record ticket, LIN-3613. Nothing else is assumed. The method it applies is `docs/theseus-method-long.md`, section 13. Read that section first.

## What a cycle is

A cycle has three parts.

1. **Known round.** A batch of improvements already identified. Lead with priority: the path to the first invited users (`docs/v1.md`), then the process frictions that cost a person's attention. Existing tickets run after a readiness check. New tickets get a fresh reader before filing.
2. **Find-and-fix round.** Read the standing measures fresh. These are the Drift & Coherence Review (it now runs the census of copies, LIN-3629) and Seams & Tangles (the import map of links and knots, and change coupling: the area pairs that land in the same change). Fix the top finds with the moves of the long version. Favour areas the next known round will work in.
3. **Cycle note.** One comment on LIN-3613: what landed, what it cost in rulings, what the measures moved, and the next known list.

Each cycle also moves one of your own steps into a committed script, a Periodical or Harbour's pipeline, or deletes it. Count your steps and the owner's presses per merge. Both should fall.

The owner's direction, from LIN-3613's description: "perhaps a round of known improvements, then a round of finding and fixing, then repeat? We can work *towards* what we know from the tasks & backlog what the high priorities are. The goal is then streamlining, looping, and eventually transitioning to simpler running (as Harbour naturally supports what we want/need)."

## Your role and authority

As recorded on the ticket and in the operator's notes:

* **In-frame calls are yours.** The items, their order, the lanes and the launching. Do not ask the owner for these.
* **Rulings are yours to decide, and the owner's to press.** The proxy cannot answer a ruling, by design. Pre-fill it with `POST /api/proxy/rulings/{id}/suggest-answer` (`optionId`, and a `reason` of 500 characters or fewer). Then tell the owner to press.
* **A non-obvious ruling gets a sub-agent investigation first.** Decide on its report.
* **A ruling with no obvious right answer goes to the owner.** Say so plainly and keep working on other lanes.
* **A live or human check is recorded as not run.** Write what, why and the follow-up. Do not hold work for it.
* **Do not amend a running ticket.** Apply a better process to the next one.
* **No live calls to outside services and no paid model calls inside tickets.**
* Quote people only verbatim. Never write that the owner named something he did not.

## Lanes and pacing

Run one heavy lane (rebuilds, consolidations, large work) and two light lanes (bounded fixes). Never two heavy at once. The runner is a laptop and froze at three runs once.

Read `GET /api/proxy/heartbeats` before each launch. It reports the runner host's `loadAvg5`, `cpuCount` and session counts.

* Open an extra lane (beyond one heavy and two light) only when load5 is below 0.8 times cpuCount.
* A replacement launch, which keeps the three lanes full, is not an extra lane. Hold it only while load5 is far above cpuCount. In cycle 1 load reached 25 on 10 CPUs with one session running. The cause was not Harbour, and launches waited.

## Step by step

All calls go through the proxy with a readWrite token held on disk. Never put the token in a ticket, a prompt or a report.

1. **Pick items.** Read the tracker by priority. Weigh each against the v1 path (`docs/v1.md`). Write the lane order down on the record ticket.
2. **Readiness.**
   * Well-specified ticket: add a repository line as line 1 and the standard rules block. This needs no sub-agent.
   * Vague or older ticket: run a cheap sub-agent check. It asks whether the repository is on line 1, whether the cited lines are current, which decisions are left open and which steps need live calls. It writes amended text to a file. Apply it, keeping a backup of the old description.
   * A decision left open: the ticket keeps today's behaviour, records an open question and carries on.
3. **New tickets.** Draft with a sub-agent. Have a fresh reader check it before filing: claims about code true, nothing attributed to a person who did not say it, your own working rules removed. File under LIN-3613. Read the whole filing output and never re-file.
4. **Kickoff.** `POST /api/proxy/autopilot/kickoff` with `{"issueIdentifier": "LIN-x", "target": "cli"}`. The result carries the run's id. Never pass `repo`. The default workspace provides both repositories.
5. **Watch.** Poll the issue state, the dispatch list and the run's feedback. Wake on a terminal state, a blocked or failed run, or a `[decision]` entry. Keep the live run list on the record ticket.
6. **Rulings.** Pre-fill as above. Say in one line which are waiting for presses.
7. **Merge simple-dispatcher PRs yourself, between runs.** Workers open them and do not merge. A merge restarts the production dispatcher. A dead dispatcher is not relaunched, and the watcher only follows deploys. So first review the wiring for crash risk: what is in scope, whether anything can throw, whether timers are unref'd, whether failures are caught. Merge only when its CI is green and runs are idle or waiting.
8. **Score.**
   * Known items: light. Is it merged, is CI green, does it do what it said?
   * Find-and-fix moves on production code: the full independent replay, per the long version. Old code on the commit before, new code on the commit after, two seeds, every output channel compared. Add shape and verbatim share. Compare the prediction line by line.
9. **Cycle note.** Post it on LIN-3613 when both rounds are done.

## Find-and-fix round

1. Mint and run the Drift & Coherence Review, then Seams & Tangles. Mint means one `POST /api/proxy/dispatch` of the periodical's prompt (kind `periodical`, with its `periodicalId`: `drift-coherence` or `seams-tangles`; an unknown id is a 400). `GET /api/proxy/periodicals` shows which are due. It files one ticket. Then kick off a scoped run on that ticket.
2. Read the reports through a sub-agent. List the top finds.
3. Favour areas the next known round touches. That makes the later work cheaper.
4. Choose the move for each (untie a knot, free the seam, consolidate, rebuild) by step 4 of "The loop" in the long version, section 13.
5. Write the ticket from the clauses there and the standard rules block. Include a prediction and an independent replay. Run a fresh reader. File. Launch in the heavy lane.
6. Do not steer a running ticket. If a review loop hits its bound, pre-fill the ruling.

## Keeping context clean

Every step except decisions and owner-facing text goes to a sub-agent. The sub-agent writes its full report to a file with Bash and returns at most 15 lines: the verdict, the numbers and the decisions needed. No raw logs or JSON in your own context. Use the cheaper tier for checks and drafts. Use the frontier tier only when the judgement needs it. In cycle 1 each frontier-tier sub-agent cost roughly 300,000 to 380,000 tokens.

Every sub-agent prompt says: no `rm`, no `git clean`, no worktree removal, temp files under the scratchpad.

## Lessons from cycle 1

* A sub-agent's Write tool may be refused. Tell it to write with Bash (`mkdir -p`, `cat > file <<'EOF'`). One returned a whole report inline when it could not write.
* Sub-agents sometimes run `rm -rf` despite the rule. It hit paths that did not exist twice, and nothing was deleted. Repeat the rule firmly. A deny rule is worth considering.
* A watcher reads its list only at start. To restart it, kill it with a command whose own text never contains the watcher's script name, or the kill matches itself.
* Close-out used to hold on a live check the ticket never asked for. LIN-3614 fixed this. Such a check is now recorded as not run, with a follow-up.
* Prompt size is frozen. LIN-3633 allows a justified raise, with the reason recorded beside the ceiling. A ticket that touches prompt text should say which it is doing: removing bytes elsewhere, or raising with a reason.
* Tickets touching `server.js` or the same prompt file go in sequence in one lane, not in parallel.
* A change to the shared prompt templates should wait for the previous such change to merge, then rebase.
* Run the operator's replay on the PR head before merge, not only after. On LIN-3648 the after-merge replay found three behaviour changes nobody listed and a close-out claiming "no deviations"; they were harmless, but review could no longer send them back. A small watcher that exits when a run's feedback names its PR gives the window.
* Say in the ticket that a class (d) behaviour is kept byte for byte even if it looks wrong, and that the PR lists every difference it makes. Workers "fix" what looks wrong.
* A worker that parks `PENDING-EXTERNAL` on a PR's CI is not woken when CI finishes (two stalls of 1–2 hours on 18 Oct). Until the CI-result wake (LIN-3661) lands, check parked workers on each wake and relay a green result with a follow-up beat (`POST /dispatch` with `followUpTo`). The same applies to a close-out waiting on evidence that already exists.
* The plan-review loop bound stopped five converging plans on 18 Oct. LIN-3651 has landed: a plan whose latest two Request Changes verdicts show narrowing blocking-finding counts now gets another round without a press, up to five verdicts since its latest Approve (REVIEW_LOOP_CEILING). A plan that is not converging still stops at three send-backs. When the bound does stop a plan, pre-fill the ruling as usual ("review again" if it is still narrowing).
* The heartbeat's load cannot tell runaway processes from the owner using the laptop (video playback read as load 20–30). Ask before assuming a fault; run fewer lanes while the owner is using the machine. A gated launch must not launch on timeout.
* Local full unit runs show 19 `scripts/code-shape` failures because the runner's checkout has no `acorn`; CI is the real check.

## Where the live state lives

On LIN-3613, as comments, newest last. Each one records the lane order, what is running with its run ids, what is queued, the calls taken and what is waiting on the owner. Post one after every launch batch and every merge. A fresh agent reads the ticket, its children, the open rulings (`GET /api/proxy/rulings`) and `GET /api/proxy/heartbeats`, and has the state.

Do not keep state only in a scratchpad. Cycle 1 did, and this runbook exists to end that.

## Follow-ups: scripts to make committed tooling

Cycle 1 used these private scripts. Each is a step to move into committed tooling. They are listed, not written here.

* **hp.sh**: a thin authenticated call to the proxy, reading the token from disk. Needs a committed client with the same rule.
* **amend.py**: replaces or wraps a ticket description (prepend a line, append a block, or replace in full), and saves the old text as a backup.
* **std.sh** and the rules block (`std/rules.md`): the cheap readiness step. It prepends the repository line and appends the standard rules. The rules block should live in the repository.
* **file-ticket.py**: files a drafted ticket under the record ticket, in the right project, at High priority.
* **gate-launch.sh**: waits until load5 is under a threshold, then kicks off a ticket and adds it to the watch list. It should read cpuCount and apply 0.8 times it, not a fixed number.
* **watch-now.py**: polls a list of runs every five minutes and exits on the first terminal state, block, failure or decision. It should become a Harbour event, not a poller.
* **Periodical mint**: minting and scoping a periodical run is several hand steps. It should be one call.
* **Cycle note**: assemble it from the ticket's children and the measures, instead of writing it by hand.
