---
title: Clear the Bar, Not the Frontier
kind: essay
argument: Harbour should stop buying the strongest model for every step and buy, for each kind of task, the cheapest model that clears the bar its own record has measured; the first gains are inside the Claude subscription it already pays for, the cheap open-weight models and bundled credit are the next layer, free models are a test bench rather than a workforce, and the bar itself should be kept by a query over every run rather than by hand.
version: 1
date: 2026-10-23
authors: [Claude, for John Kershaw]
model: frontier tier, a Claude Code cloud session, written the same day as its companion paper and from the same reads; not independently checked; not yet typeset
sources:
  - "docs/papers/harbour/cheaper-capacity.md (version 1, 2026-10-23, the companion paper; unchecked)"
  - "docs/papers/harbour/capability-ledger.md@cada192 (edition 3) and capability-ledger-method.md@cada192"
  - "docs/papers/harbour/cheap-implementer.md@cada192 (version 6)"
  - "docs/papers/harbour/model-choice.md@cada192 (version 2)"
  - "docs/steady-base.md@cada192:33"
  - "docs/papers/harbour/why-legs-repeat.md@cada192 (version 2)"
  - "https://www.vals.ai/benchmarks/terminal-bench-4 (updated 2026-10-22) and https://www.vals.ai/benchmarks/vibe-code (updated 2026-10-20)"
  - "https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers (read 2026-10-23)"
  - "https://code.claude.com/docs/en/legal-and-compliance (read 2026-10-23)"
  - "https://openrouter.ai/docs/api-reference/limits and https://openrouter.ai/api/v1/models (read 2026-10-23)"
  - "https://learn.chatgpt.com/docs/pricing (read 2026-10-23)"
  - "Simon, H. A. (1956). Rational choice and the structure of the environment. Psychological Review 63(2), 129–138. https://doi.org/10.1037/h0042769"
---

# Clear the Bar, Not the Frontier

*What Harbour pays for when it pays for the best model, and how to stop*

Prepared for John Kershaw | October 2026

Every step of Harbour's pipeline runs on a model chosen for being strong, not for being
enough. That made sense when only the frontier could do the work. It makes less sense now.
The models have moved past the bar Harbour's own record has measured, and the bar has not
moved with them. The useful question for each kind of task is no longer "what is the best
model?" but "what is the cheapest model that clears this task's bar?" Answering it has
three layers.

- **Inside the Claude subscription Harbour already pays for.** It carries about twice the
  work if the judging and the building each step down a tier.
- **Beyond the subscription.** Bundled API credit and cheap open-weight models.
- **Free models.** They are a place to measure, not yet a place to work.

Under all three lies the same idea. The bar is a fact about each task and each model, and
every run Harbour does already half-measures it.

## 1 What the fleet buys

Since early October all but two of Harbour's agent sessions have run on Claude, through
Claude Code on John's subscription. Opus 5.5, the strongest model in the family, does every
review, plan-review, research pass and supervising session. Sonnet 5.5, one tier down,
plans, builds and closes out. Over the 271 tickets finished between 8 and 23 October, that
came to $2,709 at list prices. Two thirds of it was Opus, and two thirds of it was judging
and supervising rather than building [[1]](#1-the-companion-paper).

That is not a bill John pays. The subscription is a fixed price with a weekly window of use.
Measured the one time Harbour measured it, the window is worth about $3,300 a week at list
prices, for about $46 a week. While the window has room, the marginal session is free. But
the fleet fills the window, and so the real question is not how to pay less. It is how to fit
more correct work into the same window, and where to put the work that does not fit.

## 2 The bar Harbour already knows

Harbour has a better measure of what is enough than any public benchmark: its own record. In
September it ran a bake-off [[2]](#2-the-capability-ledger-and-the-bake-off), giving small,
well-described tickets to cheap models through opencode and judging every result with an
Opus review.

- **What the cheap models did.** Two DeepSeek Flash models and GLM-5.3 implemented them to
  the reviewer's standard, within one round, for pennies. Flash implemented an hour-long
  ticket across a provider and its documentation, carried a ticket with no plan at all, wrote
  research a plan-review took seriously, and closed out reviewed work once a person had read
  the ledger.
- **Where they failed.** It was rarely at writing a well-described change. Their plans went
  round plan-review twice. On code that changes how the harness itself behaves, Flash was green and wrong:
  every test passed, and the code did not match the rows it was meant to handle. Two models
  produced nothing at all.
- **The judge.** Opus 5 did every step, and its reviews were the instrument everything else
  was measured with.

So the bar comes in two kinds. Building a well-described change is a bar that a model at
Flash's level clears. Planning across a class of cases, and judging whether a change is
right, are bars only the strong models have cleared in Harbour. Since September Harbour has
put Sonnet on the first kind and Opus on the second, which is a sensible reading of the
record. The record, though, was taken with September's models.

## 3 The bar moved

Public benchmarks are not Harbour's bar, but one of them still sorts models usefully.
Terminal-Bench 4.0, run independently by Vals AI under one harness, scores long tasks in a
terminal [[3]](#3-the-benchmarks).

- Opus 5, Harbour's validated judge until September, scores 53.5.
- Sonnet 5.5 scores 64.1, a point behind Opus 5.5.
- The models Harbour saw build to standard score between 10.6 (Sonnet 5) and 38.9 (GLM-5.3).
- Haiku 5.5, the smallest current Claude model, scores 36.4 and costs a seventeenth of
  Sonnet 5.5.

A benchmark that puts Sonnet 5 at the bottom of the builders, when Harbour found it the
builder with the longest clean record, is a rough instrument. Read with that in mind, it still says two
things clearly. The step from Opus to Sonnet for judging is now a step to a model that
scores better than the judge Harbour validated. And the step from Sonnet to Haiku for
building is a step to a model that scores near the top of the band where Harbour's builders
sit.

There is an old name for choosing this way. In 1956 Herbert Simon described decision-makers
who do not search for the best option but take the first one that clears an aspiration
level, and argued that this is what a mind with bounded time and information should do
[[4]](#4-simon-on-satisficing). He called it satisficing. The mechanism carries over; the
psychology does not. What matters is that a satisficer needs the aspiration level written
down. An optimiser needs only a ranking. Harbour has the ranking, from the benchmarks, and
half of the aspiration level, from its own ledger.

## 4 Inside the window first

Re-price October's sessions as if judging had run on Sonnet 5.5 and building on Haiku 5.5,
and the same work fits in 36–44% of the window. That is roughly two and a quarter to two and
three quarters times the capacity [[1]](#1-the-companion-paper). The range is Haiku's two
prices: it charges five times as much for prompts over 100,000 tokens, which an agent's later
turns often are.

Two cautions keep this from being a plan.

- **It assumes the window draws in proportion to list price.** Anthropic does not say how
  the window draws.
- **It prices the change and not its quality.** A judge that sends one more plan back, or a
  builder that needs one more review round, spends the saving. Repeated legs are already
  8–9% of what Harbour dispatches [[5]](#5-why-legs-repeat).

What makes it the first thing to try is the cost of trying. It needs no new vendor, no new
harness and no new credential. A change of model on a dispatch, on a few dozen tickets that
say so, will show whether the bar holds.

## 5 Beyond the window

Some work will not fit even a re-tiered window. Two routes take it.

**The first is already paid for.** Since 7 October, the Max 20x plan has included $200 a
month of Claude API credit [[6]](#6-anthropics-own-pages). It cannot be spent in Claude
Code. It can be spent through an API key, which is the sanctioned way for a third-party
harness such as opencode to reach Claude. At list price it buys somewhere between 760 and
3,800 Haiku sessions a month. That is between a quarter of the fleet's daily rate and more
than all of it. Credit not spent expires each month, and no Harbour lane spends it today.

**The second is the cheap open-weight models.** DeepSeek's October build of the Flash model
Harbour already knows scores well above the September build on both benchmarks, and costs
five cents a session. The build the ledger saw land an hour-long ticket costs under two
cents. Every lesson the bake-off taught still applies on this route:

- review stays on a strong model;
- research comes before the code;
- harness code is checked against real rows, not against its own tests;
- a worker never reads outside its own clone.

None of these is a fault of the model. Each is a piece of how Harbour runs cheap workers, and
each was learned once already.

## 6 Why free is not yet capacity

It is tempting to imagine a free lane quietly working through the 1,274 open tickets. The
free models do not support that yet [[7]](#7-openrouters-catalog-and-limits).

- **Scores:** of OpenRouter's twenty free variants, the only two with an independent
  Terminal-Bench score both score under one percent. The two that look strongest have only their
  vendors' word, and one of them stops being free on 31 October.
- **Uptime:** three were down for most of the day they were read.
- **Volume:** an account that has bought ten dollars of credit gets a thousand free requests
  a day. An agent session makes something like sixty to a hundred and fifty requests, so
  that is seven to seventeen sessions a day, against a fleet that runs about a hundred.

What a free lane is good for is the thing Harbour most needs to scale: measurement. A free
model given a handful of triage tickets costs nothing to try. If it clears the bar, the
ledger says so. If it does not, nothing was spent learning that.

## 7 Subscriptions: one bet, several traps

Only one subscription looks worth a trial. ChatGPT Plus, at twenty dollars a month, buys 15
to 160 messages every five hours on GPT-6.1 Sol, which scores above the judge
Harbour validated [[8]](#8-openais-pricing-page). Opencode is reported to be one of the
partners allowed to sign in with it. OpenAI does not publish the weekly cap, so only a month
of use can say what it carries.

The others are traps or poor value.

- **Poor value:** GitHub's Copilot plans give credit at API prices, about twice what they
  cost, which is less than the Claude credit John already has. Z.ai's GLM plan buys a great
  many tokens, but fewer per dollar than DeepSeek by the token.
- **Traps:** Google's consumer plans, Alibaba's coding plan and Chutes' subscriptions each
  forbid, or have reportedly punished, exactly the unattended use Harbour would put them to.

The same care applies to the subscription Harbour already uses. Anthropic allows a person
to sign in to the unmodified Claude Code program with their own subscription. It also says
the advertised limits "assume ordinary, individual usage" [[6]](#6-anthropics-own-pages). A
fleet that lives in one window has no promise that the window will stay its size. Moving
building work onto credit and open weights is a saving, and it is also a hedge.

## 8 Keeping the bar by experience

The capability ledger was a good idea written by hand. Each model gets an entry saying what
it has been seen to do, judged by a fixed reviewer and rewritten after every run, and an
unknown pairing goes to the strongest model [[2]](#2-the-capability-ledger-and-the-bake-off).
Its weakness is that someone has to write it, so it was last written on 14 September and
still describes models the fleet no longer uses.

Most of what it needs is already recorded. For every session, Harbour's cost endpoint
returns:

- the model;
- the kind of task;
- the effort setting;
- the cost and the time;
- the ticket it belongs to.

Four pieces are missing:

- the reviewer's verdict as a field rather than a sentence;
- the number of requests a session made, so that a rate limit can be turned into work;
- price rows for the new cheap models;
- the opencode cost relay switched on.

With them, the ledger becomes a query: for each kind of task and each model, how often the
work passed review first time, and at what cost. The bar stops being a judgement made once
and becomes a number every run updates. That is what "benchmarking by experience" means in
practice. It is the step that lets Harbour keep choosing the cheapest model that is enough,
as the models keep moving.

## 9 What the evidence does not show

- **No step-down has been tried on a Harbour ticket.** Neither Sonnet 5.5 judging nor Haiku
  5.5 building has been run.
- **The capacity multiple is a ceiling on the price side only.** It rests on an assumption
  about the window that Anthropic does not confirm.
- **No public benchmark measures planning or judging,** the two bars the cheap models failed
  in Harbour.
- **The plan tier is inferred.** That the fleet's plan is Max 20x comes from the archive's
  "about £45 a week", not from the account.
- **Every price and offer here is one day's reading.**

The essay's claim is the direction, not the size. The size is what the next fifty tickets
are for.

## Annotated reading list

### 1 The companion paper

Harbour. *Which models and plans could carry more of Harbour's work for the same money, and
is a free lane feasible?* `docs/papers/harbour/cheaper-capacity.md`, version 1, 23 October
2026.

Every figure in sections 1, 4, 5 and 6 comes from it: October's cost by stage and model, the
window's value, the reference session, the re-tiering multiples, and the free list. It is
unchecked, and its Limits apply here in full.

### 2 The capability ledger and the bake-off

Harbour. *What has each model been seen to do on Harbour's tasks?*
`docs/papers/harbour/capability-ledger.md`, edition 3, 14 September 2026. *How should Harbour
learn which model can do which task?* `capability-ledger-method.md`. *Can a cheap model
implement Harbour tickets to Opus's review standard, and what does it cost?*
`cheap-implementer.md`, version 6.

These support section 2's account of what the cheap models did and failed at, and section
8's description of the ledger. They do not support any claim about the 5.5 models, which
none of them tried. They rest on a handful of tickets per shape, so they are first
sightings, not rates.

### 3 The benchmarks

Vals AI. *Terminal-Bench 4.0*, updated 22 October 2026,
https://www.vals.ai/benchmarks/terminal-bench-4. *Vibe Code Bench v1.1*, updated 20 October
2026, https://www.vals.ai/benchmarks/vibe-code.

These are independent runs under one harness per benchmark, so scores on one board compare.
They support the ordering in section 3. They do not measure planning or review, and they
rank Sonnet 5 below models Harbour found weaker builders, so they are a ranking, not
Harbour's bar.

### 4 Simon on satisficing

Simon, H. A. (1956). Rational choice and the structure of the environment. *Psychological
Review* 63(2), 129–138. https://doi.org/10.1037/h0042769

This is from another field and another century. It is a model of how an organism with
limited time and information chooses: by an aspiration level rather than by maximising. It
supplies the mechanism in section 3, that choosing "enough" needs the aspiration level
written down. It says nothing about language models or prices, and it is used as a way to
think, not as evidence.

### 5 Why legs repeat

Harbour. *Why do Harbour's planning, review and close-out legs repeat, and what do the
repeats buy?* `docs/papers/harbour/why-legs-repeat.md`, version 2.

This supports the figure that repeated legs are 8–9% of dispatches, which bounds how much a
weaker judge's extra rounds could cost. It measured September's models, not a step-down.

### 6 Anthropic's own pages

Anthropic. *API credits for Max and Team plans*,
https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers, read 23
October 2026. *Legal and compliance* (Claude Code),
https://code.claude.com/docs/en/legal-and-compliance, read 23 October 2026.

The first supports the $200 monthly credit, what it covers and that it expires. The second
supports the permission to use the unmodified program with one's own subscription and the
"ordinary, individual usage" sentence. Neither says how the weekly window draws across
models.

### 7 OpenRouter's catalog and limits

OpenRouter. Model catalog, https://openrouter.ai/api/v1/models, and *Limits*,
https://openrouter.ai/docs/api-reference/limits, both read 23 October 2026.

These support the free list, its uptimes and the 1,000-a-day limit. The conversion to
sessions rests on a requests-per-session range Harbour does not record.

### 8 OpenAI's pricing page

OpenAI. *Codex pricing*, https://learn.chatgpt.com/docs/pricing, read 23 October 2026.

This supports the 15–160 messages per five hours on Plus. It states no weekly cap. The claim
that opencode may sign in with a ChatGPT plan comes from third-party reporting the companion
paper cites, not from OpenAI.

## Next

- Run the two step-downs inside the window on tickets that say so, and read them against
  Opus-judged and Sonnet-built controls. This is the test of section 4.
- Make the capability ledger a query: a verdict field and a request count on every worker
  session.
- Ask, as a question for John and not a study: is the fleet's plan Max 20x, and should its
  API credit be claimed for an opencode lane?
