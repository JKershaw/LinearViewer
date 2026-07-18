# An Escalation Philosophy for Harbour

*A thinking document. Last updated July 2026.*

> **What this is.** A governing rubric for the moment an AI agent — or a
> sub-agent deep in a chain of command — hits a blocker it cannot resolve, and
> that blocker has to bubble up and arrive at the top as a question for a human.
> It borrows deliberately from EEMUA 191, the process industry's guide to alarm
> system design, because that document solved our exact problem forty years
> early: **how to protect one limited human's attention from a system that can
> generate far more signals than the human can act on.**
>
> This is a *philosophy document* in EEMUA's sense — the agreed rules for what
> may become an escalation, how it is prioritised, and who owns it — not an
> implementation ticket. It is meant to be the thing new escalation surfaces are
> audited against.

## Why an alarm guide applies to an agent swarm

EEMUA 191 ("Alarm Systems — A Guide to Design, Management and Procurement") was
written for oil refineries and control rooms. Its subject looks like flashing
panels and klaxons, but its *actual* subject is the human operator: a single
person with finite attention, sitting above a plant that can trip thousands of
signals a minute. The entire discipline exists to make sure the handful of
signals that genuinely need that person get through — and get acted on — while
the rest never reach them.

An escalation dashboard at the top of an agent chain-of-command has the
identical job. The human at the top is the scarce, protected resource. Every
layer of agents below can produce blockers, questions, and "I'm not sure"
moments faster than the human can absorb them. The dashboard's purpose is not to
*show everything* — it is to **decide what deserves the human at all**, and to
present those few things so they can be acted on without spelunking.

The mapping is close enough to be load-bearing:

| EEMUA 191 concept | Harbour equivalent |
|---|---|
| Operator (scarce attention to protect) | The human at the top of the chain |
| Alarm (a signal requiring a response) | An escalation (`[blocked]` / waiting-on-user) |
| Information / status (no response required) | The Observation feed, Loop records, telemetry |
| Alarm flood | Many sub-agents blocking on one root cause at once |
| Nuisance alarm (chattering / standing / fleeting) | A flapping, stale, or self-resolving blocker |
| Alarm philosophy document | This document |
| Rationalisation / audit | Escalation-rate and false-escalation KPIs |

There is one place the analogy inverts, and it is in our favour — covered last,
because it changes where the work should live.

## Principle 0: an escalation is defined by *requiring a human response*

EEMUA's foundational rule is that **an alarm is a signal that requires the
operator to do something.** If a condition needs no response, it is by
definition not an alarm; putting it in the alarm stream is a fault, not a
feature. A large fraction of real-world alarm-system failures trace back to
violating this single rule — the stream fills with things that are merely
*visible* until the operator stops reading it.

This is the acceptance test for the top of the chain:

> **Does this genuinely require the human, right now — or is it just something
> the human might like to see?**

Applied honestly, most of what agents emit fails the test. An agent working
slowly, a sub-agent retrying, a task legitimately in progress, a run that
finished successfully — these are **observation**, not escalation. Only a true
"I cannot proceed without a decision that only a human can make" is an
escalation.

The load-bearing consequence: **the escalation stream and the information stream
must be different surfaces.** In Harbour, `[blocked]` / waiting-on-user is the
alarm stream; the rest of the Observation feed is information. The moment a
successful-run notification or a progress ping shares a channel with a genuine
"I need you to decide", the genuine one is diluted. Keep them apart.

## The mechanisms worth stealing

### 1. Prioritise by consequence × time-to-act — and keep the top tier rare

EEMUA derives priority from two axes: the *severity of the consequence* if the
condition is not addressed, and *how little time* there is to act. Its benchmark
priority distribution is deliberately skewed — roughly **80% low / 15% medium /
5% high**. If everything is "high", the word means nothing and the operator
re-triages by hand, which is the work the priority was supposed to save.

Agent escalations have an extra dimension a refinery does not: a blocked agent
is frequently *idle while it waits*, burning cost and wall-clock. So the
"time-to-act" axis carries a real economic cost — a paused expensive session is
more urgent than one where sibling work continues in parallel. Priority is thus:

```
priority ≈ consequence_of_wrong_or_absent_decision
         × urgency( how_bad_is_the_pause + how_little_time_remains )
```

Hold the line on the distribution. A dashboard where most cards are top-priority
has no priority at all.

### 2. Rate-limit the human, and design explicitly for the flood

EEMUA's headline numbers, for a single operator: a sustainable long-run rate is
about **one alarm per ten minutes**; in the ten minutes after a major upset,
**no more than ~10 alarms** before the operator is overwhelmed and starts
ignoring the stream entirely. The absolute figures will not be ours, but the
*shape* is the lesson:

- Define a **target escalation rate** a human can actually sustain, and treat
  sustained exceedance as a system fault to be engineered away — not as the
  human's problem to power through.
- **Design the flood case as a first-class scenario.** The dangerous moment is
  not steady state; it is when one failure makes twenty sub-agents block at
  once. That is precisely when a naive dashboard fails its human by drowning
  them. Correlation (below) is the primary defence.

### 3. De-duplicate and correlate to root cause

The classic alarm-flood pathology is one root fault tripping fifty consequential
alarms. EEMUA's answer is cause-and-effect suppression: surface the *originating*
alarm, suppress the downstream ones.

Agent trees produce correlated blockers constantly — a shared dependency is
down, a spec is ambiguous, a credential expired — and every branch that touches
it blocks. The human should receive **one** escalation naming the root cause,
with the blocked branches attached, not one question per branch:

> *"The staging API has been returning 503 for 6 minutes. 5 sub-agents are
> blocked on it (LIN-xxx, LIN-yyy, …). Retry, switch to the mock, or hold?"*

This is the **highest-leverage** mechanism in the whole document, because in an
agent tree correlated blockers are the common case, not the exception. If you
build one thing from this philosophy, build the correlation-and-suppression
layer.

### 4. Kill nuisance escalations — they destroy trust fastest

EEMUA names three nuisance patterns; each has a direct agent analogue, and each
is corrosive out of proportion to its individual severity, because **every
nuisance escalation trains the human to distrust the entire panel.** One agent
that cries wolf poisons the human's response to every other agent's genuine
call.

- **Chattering** (rapidly on/off) → an agent flapping between blocked and
  retrying. **Debounce**: require the blocker to persist for a set interval
  before it is allowed to escalate.
- **Standing / stale** (active for hours; everyone has learned to ignore it) →
  an escalation sitting unanswered until it becomes wallpaper. Track age
  explicitly and make it visible; a stale escalation is a defect in the system,
  not furniture.
- **Fleeting** (self-clears before anyone can act) → an agent that unblocks
  itself. Hold a short confirmation window so self-resolving blockers never
  reach the human at all.

### 5. Every escalation must be self-sufficient: diagnostic, advisory, focusing

EEMUA requires each alarm to be understandable on its own and to *guide the
response* — not "PRESSURE HIGH" but enough to know what is happening and what to
do about it. A raw "agent stuck" that forces the human to open a transcript and
reconstruct the situation is a badly-formed alarm.

A well-formed escalation carries, pre-digested:

- **What** is blocked (which task / branch / session).
- **Why** — the specific obstacle, not a generic failure.
- **The decision the human must make** — stated as a decision, not a symptom.
- **The options**, with the agent's recommendation and its reasoning.
- **The cost of each path, including doing nothing** — what continues, what
  halts, what it costs to wait.

Harbour already has the raw material for this in the Observation drill-down
(recap, telemetry, produced-artifacts, per-run tree). The escalation's job is to
*pre-digest* that material into a decision, so the human decides rather than
investigates.

### 6. Shelving and mode-based suppression are legitimate — design them in

EEMUA sanctions two forms of deliberate silence, and it is important they are
*designed*, not improvised by a human muting things ad hoc:

- **Shelving** — temporarily removing an alarm the operator has consciously
  chosen to defer. The agent equivalent is a **snooze/defer with a reason and a
  re-surface timer**, so a deferred escalation cannot be silently lost.
- **Mode-based suppression** — not alarming on low flow when the unit is
  deliberately shut down. The agent equivalent is suppressing escalations that
  are *expected for the run mode*: a research/spike run that is *supposed* to
  stop and ask should not alarm with the same weight as a production fix that
  has unexpectedly stalled.

### 7. Govern with a written philosophy; audit continuously

EEMUA's largest structural recommendation is the **alarm philosophy document**
(this one) plus ongoing **rationalisation** — periodically auditing every alarm
against the philosophy — and a small set of KPIs. The metrics that matter here:

- **Escalation rate per human** (against the sustainable target).
- **Time-to-response** — how long escalations wait.
- **False-escalation rate** — escalations the human resolved with "why was I
  asked this?" This is the single most important tuning signal; it is the
  direct measure of Principle 0 being violated.
- **Unanswered age** — the standing/stale count.

These metrics are how the chain-of-command's autonomy gets tuned over time: a
high false-escalation rate means push more resolution down the chain; a high
unanswered age means the human is over-subscribed and the rate target is wrong.

## The place the analogy inverts — and why it helps

In a refinery the sensors are dumb. All the rationalisation, de-duplication, and
prioritisation must happen centrally, in the alarm system, because a pressure
transmitter cannot decide whether its own reading matters.

**Our sensors are intelligent agents.** That single difference relocates most of
EEMUA's central machinery to the *edge*. Each agent, and each layer of the chain
of command, can:

- decide whether a blocker genuinely needs a human at all;
- attempt local resolution first;
- enrich the blocker with the context a good escalation needs; and
- merge sibling blockers before anything bubbles upward.

So the top-level dashboard is not the firehose-filter of a dumb-sensor system.
It is the **last** line of a rationalisation process that every layer
participates in. The question EEMUA asks once, centrally, we ask at every hop:

> *"Can I resolve this myself? If not, does it genuinely require the **human** —
> or just the layer above me?"*

An escalation that reaches the top should therefore mean something strong: every
layer below already answered "no, I can't, and yes, this really needs the
person." That is a much higher bar than a refinery's, and it is achievable
precisely because the sensors can think.

## How this maps onto Harbour today

Harbour already has the embryo of this system, which is why the philosophy is
worth writing down now rather than after a redesign:

- **The alarm stream exists.** The `[blocked]` terminal-adjacent marker
  (`lib/dispatch-terminal.js`) is explicitly the "a human is in the loop" state,
  distinct from `[done]`/`[failed]`/`[aborted]`/`[skipped]`. That is the
  escalation channel.
- **The presentation surface exists.** The Observation feed
  (`lib/render-observation.js`, `public/observation.js`) already separates active
  work from a completed archive, and a **waiting-on-user card carries a
  `reply →` CTA** to the per-session page — an escalation with an action
  attached, which is exactly what Principle 5 asks for.
- **The response path exists.** The per-session reply box (`public/session.js`,
  LIN-1004) and the follow-up dispatch mechanism (`followUpTo`) let a human's
  decision flow back down to resume the blocked session.

What this philosophy adds is the discipline *around* those pieces: the
require-a-response acceptance test at the boundary, priority that stays skewed,
a debounce/confirm window against nuisance flapping, the root-cause correlation
layer for the flood case, and the KPIs to audit it all. None of that requires a
new surface. It requires agreeing what is allowed to reach the human — and
holding that line.

## A one-paragraph summary for the busy reader

Treat the human at the top of the chain as a control-room operator whose
attention is the scarce resource. Let nothing reach them that does not *require*
their response. Prioritise the few things that do by consequence and by the cost
of waiting, keep the top tier rare, and design explicitly for the flood — the
moment one failure blocks many agents — by collapsing correlated blockers into a
single root-cause escalation. Suppress the nuisances (flapping, stale,
self-resolving) that would otherwise train the human to ignore the panel. Make
every escalation a pre-digested decision, not a symptom to investigate. And
because our sensors are intelligent, push all of that rationalisation down the
chain so that an escalation arriving at the top already means every layer below
tried and could not.
