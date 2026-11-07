# LIN-4085's review, replayed through the As-asked change (7 November 2026)

The model half of LIN-4353's witness 6, run by hand as LIN-4345's plan asked. The essay
`docs/papers/harbour/one-feature-twice.md` proposed it as the cheapest test of where the thin guide
was missed: "Replay LIN-4085's review with the original request attached, and see whether it catches
the thin guide." It is one model run per arm. It is evidence for review, not a CI result.

**Result: no arm caught the thin guide.** The old review prompt, the new one, and the new one with
the tightened agreement rule all approved Harbour's LIN-4085 build (conditionally, on unrelated
ledger items). None of the three mentions "a full guide". The deterministic half of witness 6
(`tests/unit/as-asked-lin4085-replay.test.js`) passes: the words reach review intact and review is
told to start from them. What these runs show is that a reviewer told so still judged against the
plan's reading of the ask.

## Setup (identical for every arm)

- **The ticket** as review saw it on 1 November: LIN-4085's description from the task snapshot of
  2026-11-01T18:19:44Z, with the filed request (the message and its page/browser capture) sealed in
  an `## As asked` block and the triage marker, the finalized scope and the implementation plan
  below it; then the eight comments posted before review (18:23Z). On 1 November the same words were
  already at the top of the description, unsealed.
- **The code:** a checkout of `4f247b68`, PR #2221 squash-merged, with `git diff 4f247b68^ 4f247b68`
  as the change under review. The checkout predates the essay and the A/B record, so neither could be
  read. CI was given as green, as the implementation comment records.
- **The reviewer:** a fresh Claude Code subagent (Opus 5.5; the 1 November review ran an earlier
  model), with no tracker or network, told to read only the ticket file, the stage prompt and the
  checkout, and to post nothing. The brief was the same for every arm and did not mention the guide.
- **The prompt:** the review stage prompt rendered by `generatePrompt('review', …)` for this ticket.
  - Arm B (control): rendered at `d81e13e7`, before LIN-4353.
  - Arm A: rendered by LIN-4353 before the agreement rule ("naming any narrowing; one nobody agreed
    to is **Needs Discussion**").
  - Arm A2: rendered by LIN-4353 with the agreement rule ("naming any narrowing; only the person's
    comment or answered ruling agrees to one, not a stage's scope or plan, else **Needs
    Discussion**").

## What each arm said (verbatim)

**Arm B, old prompt.** Verdict: "Approve — conditional on close-out discharging the ledger." Its
section is headed "Scope against the plan"; it found "The deliverable is complete against the scope
and plan". Real findings beside it: a route test that cannot tell whether the route reads the
deployment flags, and a design note that overstates what `safeHost` protects against.

**Arm A, new prompt.** Verdict: "`Approve — conditional on close-out discharging the ledger`." Its
section is headed "Scope against what was asked", but checks the plan's table: "Every row in the
plan's table matches a change on disk." Its closing line: "All of the plan was delivered … Nothing
was cut that nobody agreed to." Findings beside it: a weak "ask me" test, the same `safeHost`
overstatement, and a wrong step for the email door.

**Arm A2, new prompt with the agreement rule.** Verdict: "Approve — conditional on close-out
discharging the ledger." It opens "What was asked, and what changed" with its own summary of the
ask: "Asked: a copyable prompt on the homepage that sends the visitor's coding agent to a public
`/getting-started` guide, so the agent can onboard the person." Its closing line: "The work delivers
what was asked without narrowing it". Findings beside it: no test reaches the guide through the real
server, the flag wiring is untested, the logout landing lacks the block, and the navbar keeps its own
door list.

## Reading

- Arm A shows that the verdict line alone did not stop a stage's narrowing being read as agreement,
  hence the agreement rule.
- Arm A2 shows the miss moving one step earlier. The reviewer no longer cited agreement; instead it
  restated the ask in its own words, and that restatement already dropped "essentially a full guide on
  how to properly configure Harper for whatever your situation is". Against its own summary, nothing
  was narrowed. This is the same thinning the brief used to do, now done by the reviewer.
- Every arm found real defects the 1 November review did not, and all three approved conditionally.
  The prompt's catch of real defects is not in question here; its catch of a narrowed ask is.

## What this leaves open

This is a ledger item for review, not a settled witness. Three runs on one ticket cannot say whether
any prompt wording makes a reviewer hold a build to the words of the ask. Ways forward, none of
them built here:

- Have review quote the block's own words where it states what was asked, instead of summarising
  them. That turns the reviewer's restatement, the step that thinned the ask in arm A2, into a copy
  code can check.
- Replay more than one ticket, and more than one run per arm, before reading anything into a
  difference between arms.
