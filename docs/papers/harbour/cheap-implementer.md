---
title: Can a cheap model implement Harbour tickets to Opus's review standard, and what does it cost?
version: 1
date: 2026-09-12
authors: [Claude, John Kershaw]
model: the conning session wrote this by hand over the read-write proxy; the implementations it dispatched ran z-ai/glm-5.3 on opencode (no effort field), the gating reviews claude-opus-5 on claude-code at effort medium, as the dispatch lineages under sessionId LIN-2828-bakeoff report
grounded_at: 5b3e5990 (LinearViewer), 135991f (simple-dispatcher)
cites: [LIN-2828 (comments 2026-09-12), LIN-2831 (results table, 2026-09-12), LIN-2830 (comments 401bfecc and d6eb6469, 2026-09-12), PR #1470 (2026-09-12), PR #1471 (2026-09-12), PR #1472 (2026-09-12), PR #1473 (2026-09-12), simple-dispatcher PR #233 (2026-09-12), simple-dispatcher/opencode-runner.js@135991f:383-387, simple-dispatcher/config.js@135991f:1093, simple-dispatcher/admission.js@135991f:33-37, docs/reviews/model-effort-routing-proposal-2026-09-11.md]
---

# Can a cheap model implement Harbour tickets to Opus's review standard, and what does it cost?

On the evidence of one Saturday evening: yes for small logic tickets, at about a fifth of
the API-equivalent price of the Opus review that judges it. Five tickets were implemented by
`z-ai/glm-5.3` through opencode between 19:05 and 20:50Z on 12 September 2026. Four passed
Opus review first time and the fifth passed after one fix round. The one send-back was a
layout defect, not a logic one. Each implementation cost two to three and a half dollars on
the OpenRouter meter, against Harbour's own relay reading of two to five cents, which is
wrong by two orders of magnitude. The run stopped when every opencode launch after 20:50Z
died with zero tokens returned, on two different models, for a reason Harbour cannot see.

## Findings

**The plumbing needed nothing from anyone.** Each of the five was dispatched over the proxy
with `harness: opencode` and `model` set on the item and the verb pinned to implementation.
The runner claimed each within four seconds, the session opened a PR, CI ran green, and a
summary comment landed on the ticket, five times out of five. No preset, no host change, no
human touch between dispatch and verdict.

**Four of five first-pass; the miss was visual.** LIN-2572 (a CLAUDE.md count, PR #1471),
LIN-2628 (a test-only pin, PR #1472), LIN-1220 (a spring-clean in the dispatcher repo, PR
#233) and LIN-2760 (a select-all filter, PR #1473) were approved conditional on close-out
discharging a ledger, the standard shape. LIN-2830 (PR #1470) was sent back once: the new
per-row grid on the effort readout declared 792 pixels of fixed columns inside a 263-pixel
card, and the site clips horizontal overflow, so the columns the page exists to show were
invisible. Opus called the logic correct and re-ran the mutation checks itself. The fix round,
on the same model, landed a geometry test that asserts rendered widths at three viewports,
observed red on the unfixed CSS, and was approved. Every code-level claim in every PR held.

**Two to three and a half dollars a ticket, and the relay cannot see it.** The OpenRouter
activity page read $3.45 after the first thirty-minute session and $5.61 an hour later with
two more sessions in, both readings provisional because the key is shared. Harbour's `[usage]`
row for the same sessions read $0.027, $0.016, $0.033, $0.048 and $0.048. The opencode runner
posts the usage of the one message it awaited, which is the final step of an agentic run,
not the sum (`opencode-runner.js:383-387`). Every per-lineage cost figure Harbour publishes for
an opencode run is therefore the last turn only. Filed as LIN-2835.

**Review is the expense, and it does not scale with the ticket.** Harbour prices each Opus
review from its relayed tokens at $2.40 to $4.79 API-equivalent, taking five to nine minutes.
The one-line doc change cost $2.54 to review; the 414-line readout change cost $4.79. So a
cheap implementer saves most on large tickets, and a bake-off run on small tickets, chosen
small for safety, overstates the review share of the total. The routing proposal's median of
$4.67 per Opus review stands.

**A cheap reviewer agreed with Opus three times out of three.** Each PR was also given the
identical review prompt Opus received, run on GLM through opencode with a header that named
it a shadow, pinned its comment title, forbade any state change, push or merge, and told it
to form its verdict before reading the Opus comment. On LIN-2572, LIN-2628 and the LIN-2830
fix commit it returned the same verdict and, on LIN-2572, the same one-item ledger, in two to
eight minutes. It has not yet been tested on a PR where Opus found a blocking defect cold.

**The model behaved well on a ticket that was not code.** LIN-2415, dispatched by mistake,
forbids code changes and asks for an operator to paste a document into a field. GLM confirmed
the prerequisite PR was deployed, found the real cause of the missing stamp (the stored text
is the document minus its trailing newline, 2477 bytes against 2478), wrote a runbook on the
ticket, and parked BLOCKED for the human. Four minutes, no invented PR.

**Then every launch died.** From 20:50Z, three sessions in a row, on GLM and on DeepSeek
V4.1 Flash, returned a `[usage]` row of zeros and `opencode exited with code 1`, one after
ten minutes, one after fourteen seconds, one after thirteen. Two shadow sessions started in
the same minute were still marked running forty minutes later. Every session that started
before 20:50 finished; none that started after did. Harbour sees only the exit code. A key
refused by OpenRouter, credits or a limit, would look exactly like this; so would an opencode
fault on the host. The dispatcher's log for those launches decides it.

## Method

Twelve small tickets whose descriptions already were the plan (no Todo ticket in the
workspace carried a reviewed plan) were ratified on LIN-2828, six for GLM, four for DeepSeek
Flash, two for Gemini as control. Each was dispatched from a conning session over the
read-write proxy with `POST /api/proxy/recommend-and-dispatch`, `kind: implementation` as a
verb override, `harness: opencode`, the model id, `target: cli`, `appendProxyContext: true`
and `sessionId: LIN-2828-bakeoff`. On `[done]`, an Opus review was dispatched the same way
with `kind: review` and no harness or model, so the workspace defaults (claude-code, opus,
medium) applied. The review's stored prompt was then read back from
`GET /dispatch/{id}/prompt`, the auto-appended access block cut, a shadow header prepended,
and the result dispatched as `kind: custom` on GLM so it never enters the pipeline's verdict
walk. At most two implementations ran at once. Verdicts were read from the `DONE:` line of
each review's feedback and the review comment on the ticket. Durations are Harbour's
`/cost` lineage durations. Costs are the OpenRouter activity page as John read it, with
Harbour's relayed figure beside it. The results table is LIN-2831's description; the voyage
log is LIN-2828's comments.

## Limits

Five results. The tickets were chosen small and low-risk, one touched a visual surface, and
the person choosing them was the one running the bake-off. The OpenRouter readings are
cumulative on a shared key and were read by eye at two moments, so the per-ticket split is an
estimate; the first reading may include other usage. The shadow reviewer is the same model as
the implementer, which is the weakest possible test of a second opinion, and no shadow has
yet seen a PR with a cold blocking defect. The DeepSeek and Gemini arms did not run. Which
upstream host and quantisation served GLM is visible only on the OpenRouter activity page and
was not recorded. The launch failures are undiagnosed, so the failure rate of the harness
itself is unknown: five successes then three failures could be a provider outage or a
concurrency limit at four sessions, and the method cannot tell which.

## Next

- Finish the twelve, with the Flash and Gemini arms, once the launch fault is named.
- Give the shadow reviewer a PR where Opus found a blocking defect it has not seen, and
  report whether it finds the same one. Three agreements on clean PRs prove little.
- Price a ticket against its size: the review's cost was nearly flat across a one-line and a
  414-line change, so find the ticket size at which a cheap implementer's saving is largest.
- Read the dispatcher log for the three dead launches and say what a zero-token exit means.
