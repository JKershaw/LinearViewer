# LIN-3177 codebook: consequential decisions and wrong turns

Fixed before any digest was read. Readers code one ticket digest at a time (`data/survey-judgement/digests/LIN-n.md`) and write one JSON
file per ticket. Code from the digest only; do not open other files or call any API.

## 1. What counts as a consequential decision

A **consequential decision** is a choice made at an identifiable moment, by a session or a person, that changed **what shipped** (code,
tests, docs, scope) or **how it shipped** (the sequence of steps, extra or fewer rounds, who did the work, whether or when it merged),
compared with the step simply carrying on by default. One decision per choice: a verdict with seven findings is one decision.

| Type | Meaning |
|---|---|
| `SB` send-back | A gate verdict asking for changes: plan-review Request Changes, review Request Changes or blocking findings, a close-out hold. |
| `CE` caught error | A fault found outside a formal verdict: a supervisor rejecting or correcting a worker's report, an implementer finding the plan wrong, a worker finding a bug on main, a supervisor noticing a wrong route. |
| `SC` scope change | Scope cut, deferred, split, carved into another ticket, or added. |
| `ES` escalation | A question or decision sent up to John or the operator. |
| `RU` ruling | John's or a coordinator's decision answering an escalation, a loop or an open question. |
| `RS` rescue | Recovery from a failure: re-dispatch after a failed or stuck session, fixing red CI, resolving a merge conflict, re-delivering a lost wake by hand, taking over a worker's job. |
| `RP` re-plan | The plan revised for a reason other than a send-back (a spike's result, new information). |
| `RT` routing | A next step that departs from the default path: skipping or adding a leg, a different kind, overriding the engine's recommendation, stopping a loop. |
| `MG` ship call | Holding or proceeding with merge or Done where the record left it open (not the routine merge after green CI and an Approve). |

**Not consequential:** an Approve with no blocking findings; dispatching the next phase the engine recommended; re-arms, gate replies,
status moves, progress notes; non-blocking notes nobody acted on; writing the code the plan asked for. An implementer who departs from
the plan is coded as the departure (`CE`, `SC` or `RP`).

## 2. What to record for each decision

- `cycle`: the digest's cycle id (`S3.1`), or `comment MM-DDTHH:MM` for a decision visible only in a comment.
- `type`: one of the codes above.
- `role`: `Runner`, `leg`, `stepper`, `autopilot` (the ticket's own supervisor, or a parent's), `wake`, `research`, `plan`,
  `plan-review`, `implementation`, `review`, `close-out`, `other-worker`, `John` (or the operator), `engine` (the recommend call),
  `code` (runner or Harbour code acting by itself, no model).
- `tier`: `frontier`, `mid`, `cheap`, `human` or `code`, as the digest shows it.
- `basis`: what it rested on, one or more of `ci`, `diff`, `tests-run`, `code-at-head`, `plan-text`, `ticket-text`, `prior-verdict`,
  `worker-report`, `tracker-state`, `runtime-state`, `human-message`, `running-app`.
- `effect`: `what-shipped`, `scope`, `sequence`, `timing-only` or `none-in-the-end`.
- `class`, one of:
  - **`a` rule.** A stated rule over observable state would have made the same call. The inputs are fields a program can read (CI
    status, a verdict keyword, a PR's mergeable state, a session's liveness, a count, a date, a list match) and the action follows
    mechanically from them.
  - **`b` cheaper.** It needed reading text or code, but a cheaper or shorter step would have done it: one bounded check (a grep, a
    test run, a diff-against-plan checklist), a mid- or cheap-tier model, or a short fresh session holding only the artefact. No
    weighing of competing considerations across the ticket's context.
  - **`c` context.** It needed reasoning over the ticket's context: weighing a plan against the code and its callers, a design
    trade-off, finding out by investigation whether a report is true, choosing scope, framing a decision for John.
  - When torn between two classes, choose the higher (`c` over `b` over `a`).
- `confidence`: `high`, `medium` or `low`.
- `evidence`: at most 40 words, quoting or closely paraphrasing the digest.

## 3. Wrong turns

Record every event where something went wrong on the ticket:

- `type`: `red-ci` (a CI run failed on the ticket's PR), `conflict` (merge conflict or a branch that had to be rebased), `stuck`
  (a silent or stalled session, a failsafe or silence re-fire), `bad-report` (a worker report a later step found false or incomplete),
  `lost-wake` (a wake that never arrived, a supervisor that had to poll or re-deliver), `failed-session` (a crash, a launch failure,
  a `[failed]` outcome), `other`.
- `cycle`: where it surfaced.
- `cause`: `flake`, `real-fault`, `infra` (an outage, auth, a runner bug), or `unknown`.
- `reacted`: the roles that took an action because of it, in order (include `code` when the runner or Harbour handled it unaided).
- `modelLayers`: how many distinct model layers acted on it.
- `multiLayerNeeded`: `yes` if the first layer to see it could not, or did not, resolve it and a higher layer had to act; else `no`.
- `freshSession`: could a fresh session holding only the record at that moment (ticket and comments, the PR and its CI log, the
  dispatch rows) have made the same call? `yes`, `no` or `unclear`.
- `classOfReaction`: `a`, `b` or `c` as above, for the reaction that resolved it.
- `evidence`: at most 40 words.

## 4. Output

One file per ticket, `<out>/LIN-n.json`:

```json
{ "ticket": "LIN-n", "decisions": [ { "cycle": "S3.1", "type": "SB", "role": "plan-review", "tier": "frontier",
  "basis": ["plan-text", "code-at-head"], "effect": "what-shipped", "class": "c", "confidence": "high", "evidence": "…" } ],
  "wrongTurns": [ { "cycle": "S5.2", "type": "red-ci", "cause": "flake", "reacted": ["implementation"], "modelLayers": 1,
  "multiLayerNeeded": "no", "freshSession": "yes", "classOfReaction": "a", "evidence": "…" } ],
  "notes": "one or two sentences on anything the digest could not show" }
```
