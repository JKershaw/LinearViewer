---
title: Where did the developer population sit on the ladder in September 2024, September 2025 and March 2026?
version: 1
date: 2026-09-19
authors: [Claude, John Kershaw]
model: claude-opus-5, Claude Code CLI, effort default; dispatched as LIN-2929 research item 0df4b864, planning (comment of 2026-09-19T11:45 UTC), implementation item 2d54eaa7
grounded_at: b5a4f77f (LinearViewer)
cites: [docs/ladder.md@b5a4f77f:9, docs/ladder.md@b5a4f77f:13, docs/ladder.md@b5a4f77f:19-24, docs/ladder.md@b5a4f77f:30-34, docs/papers/standard.md@b5a4f77f:21, docs/papers/standard.md@b5a4f77f:23-31, docs/papers/standard.md@b5a4f77f:45-48, docs/papers/standard.md@b5a4f77f:50-51, docs/papers/harbour/developer-adoption-ladder.md@0a60c5bf, LIN-2929 (comments of 2026-09-19T11:38 UTC and 11:45 UTC), survey.stackoverflow.co/2023 (read 2026-09-19), survey.stackoverflow.co/2024/ai (read 2026-09-19), survey.stackoverflow.co/2024/methodology (read 2026-09-19), survey.stackoverflow.co/2025/ai (read 2026-09-19), survey.stackoverflow.co/2025/methodology (read 2026-09-19), jetbrains.com/lp/devecosystem-2023/ai/ (State of Developer Ecosystem 2023, AI section, read 2026-09-19), web.archive.org/web/20241211150022/https://www.jetbrains.com/lp/devecosystem-2024/ (captured 2024-12-11, read 2026-09-19), blog.jetbrains.com/research/2025/10/state-of-developer-ecosystem-2025 (read 2026-09-19), github.blog/news-insights/research/survey-reveals-ais-impact-on-the-developer-experience (read 2026-09-19), github.blog/news-insights/research/survey-ai-wave-grows (read 2026-09-19), cloud.google.com/blog/products/devops-sre/announcing-the-2023-state-of-devops-report (read 2026-09-19), dora.dev/research/2023/dora-report/2023-dora-accelerate-state-of-devops-report.pdf (full PDF, read 2026-09-19), dora.dev/research/2024/dora-report (read 2026-09-19), services.google.com/fh/files/misc/2025_state_of_ai_assisted_software_development.pdf (read 2026-09-19), papers.ssrn.com/sol3/papers.cfm?abstract_id=4945566 (Wayback capture 20240905195458, read 2026-09-19), slashdata.co/post/59-of-developers-use-ai-tools-25-2m-javascript-users (Wayback capture 20240605090316, read 2026-09-19), arxiv.org/abs/2406.17325 (read 2026-09-19), arxiv.org/html/2406.17325v1 (full text, read 2026-09-19), metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study (read 2026-09-19), uplevelteam.com/blog/ai-for-developer-productivity (Wayback capture 20241101161338, read 2026-09-19), anthropic.com/research/anthropic-economic-index-september-2025-report (read 2026-09-19), anthropic.com/research/anthropic-economic-index-january-2026-report (read 2026-09-19), anthropic.com/research/measuring-agent-autonomy (read 2026-09-19), resources.anthropic.com/hubfs/2026 Agentic Coding Trends Report.pdf (Wayback capture 20260122165013, read 2026-09-19), newsletter.pragmaticengineer.com/p/ai-tooling-2026 (Wayback capture 20260305231145, read 2026-09-19), github.blog/news-insights/product-news/github-copilot-chat-now-generally-available-for-organizations-and-individuals (read 2026-09-19), aider.chat/HISTORY.html (Wayback capture 20240418112813, read 2026-09-19), replit.com/blog/introducing-replit-agent (read 2026-09-19), github.blog/changelog/2025-05-19-github-copilot-coding-agent-in-public-preview (read 2026-09-19), github.blog/changelog/2025-09-25-copilot-coding-agent-is-now-generally-available (read 2026-09-19), github.com/anthropics/claude-code/releases/tag/v2.1.32 (published 2026-02-05T17:47:50Z, read 2026-09-19)]
---

# Where did the developer population sit on the ladder in September 2024, September 2025 and March 2026?

At each date the population sat lower, and the six-rung ladder (`docs/ladder.md@b5a4f77f:19-24`) thins fast above rung 2 at every one of them. Rung-1-and-above use ran from roughly 60–85% at 30 September 2024 depending on the instrument, to 84–90% at 30 September 2025, to 85%+ at 31 March 2026. Rung 4 — a bounded task handed to an agent — has exactly one population figure inside each of the last two cutoffs and none at the first: 31% (Stack Overflow, mid-2025) rising to 55% (The Pragmatic Engineer, early 2026), on two different instruments with n=49,009 and n=906, which is not a series. Rungs 3, 5 and 6 are unmeasured at all three dates; no dated survey with a denominator has ever asked whether a developer saves a reusable prompt, and none asks about unattended operation before 2025. The clearest finding is not a climb but a stall: the highest rung any generally available tool offered reached rung 4 on 25 September 2025 (GitHub's Copilot coding agent going GA) and **had not moved by 31 March 2026** — six months in which rung 5 stayed experimental and gated behind an environment variable, and rung 6 stayed absent. If the rungs move because the tools move, as `docs/ladder.md@b5a4f77f:11` reads them, here is a six-month window at the paper's own most recent cutoff where the tools did not.

## Findings

### 30 September 2024

**Same-instrument table** — one instrument per row, each cell is that source's own figure, not a combination.

| Rung | Estimate | Bounds | Source | Publication date | Fielding window |
|---|---|---|---|---|---|
| 1 and above | 61.8% currently use AI tools | n=65,437, 185 countries | Stack Overflow 2024 Developer Survey (`survey.stackoverflow.co/2024/ai`) | 24 Jul 2024 | 19 May – 20 Jun 2024 |
| 2 (assistant/copilot use) | 54.77% have used GitHub Copilot in the past year | n=22,078 (of 40,307 total respondents answering this section) | Stack Overflow 2023 Developer Survey | mid-Jun 2023 (Wayback root capture 20230523133126) | May 2023 |
| 3 | **Unmeasured** | — | No source published by this date asks a developer population whether it saves or reuses prompts, in any phrasing searched (reusable prompt templates, prompt libraries, custom instructions, `CLAUDE.md`-equivalents) | — | — |
| 4 | **Unmeasured** | — | No source published by this date measures bounded-task delegation to an agent with a denominator; rung-4-shaped tools existed only in preview (see Frontier below) | — | — |
| 5 | **Unmeasured** | — | No source; the rung-4 gap makes a rung-5 figure moot at this date | — | — |
| 6 | **Unmeasured** | — | No source | — | — |

**Cross-instrument table** — the same "uses AI" question asked by different instruments at this date, each with its own `n` and definition, shown side by side to bound how much a difference between instruments can mean.

| Source | n | Definition | Estimate | Publication date |
|---|---|---|---|---|
| SlashData Developer Nation, 26th edition | >10,000, 135 countries | "use AI tools to help them with their work" (also: "use chatbots for coding questions") | 59% (42% for the narrower chatbot question) | 3 Jun 2024 (Wayback capture 20240605090316) |
| Stack Overflow 2024 | 65,437 | "currently use AI tools" | 61.8% | 24 Jul 2024 |
| JetBrains 2023 | >26,000 | "familiar with generative AI tools in one way or another" | 84% | 20 Nov 2023 |
| GitHub/Wakefield, 2023 | 500 US enterprise developers | "already using AI coding tools both in and outside of work" | 92% | 13 Jun 2023 |
| GitHub/Wakefield, Aug 2024 | 2,000 enterprise developers (US/BR/DE/IN) | "used AI coding tools at work at some point" (ever-use ceiling) | >97% | 20 Aug 2024 |
| DORA, Accelerate State of DevOps 2023 | >36,000 | "incorporating at least some AI into the tasks" | not quantified — the full 95-page PDF gives only an ordinal "AI contribution" score (mean 3.3/10, median 2.4, IQR 0.3–6.3), no adoption percentage | 5 Oct 2023 |

The spread on one question, one date, is **42% to 97%** — more than double — driven by definition and population, not by time. Any difference smaller than that between two dates is not evidence of a climb on its own.

**The highest rung any generally available tool offered: rung 2.** GitHub Copilot Chat reached general availability 29 December 2023. `docs/ladder.md@b5a4f77f:19-24`'s own rung 2 is defined as "opens Claude Code and walks through the work by hand" — Claude Code did not exist yet (research preview 24 Feb 2025, GA 22 May 2025) — so the nearest analogue at this date is an IDE assistant plus chat, and the nearest CLI analogue is `aider`, open-source and self-serve, installable well before the cutoff (`aider.chat/HISTORY.html`, Wayback capture 20240418112813). Rung-4-shaped tools existed but none was generally available: Devin was in a waitlisted research preview from 12 March 2024 (GA not until December 2024); GitHub Copilot Workspace was a technical preview from 29 April 2024; Replit Agent reached only "early access" for paying subscribers on 16 September 2024, two weeks before the cutoff, and Replit's own language called it that, not GA. **Both readings belong in one cell, not averaged**: on a strict general-availability test the frontier is rung 2; on a looser "could a self-serve developer run a bounded task unsupervised" test, `aider` puts a rung-4 analogue within reach of a minority, but no vendor offered it on general terms.

**Frontier gate.** The sources that name a cause name trust, not budget: Stack Overflow's own favourability *fell* from 77% to 72% even as "using or planning to use" rose, and the strongest single piece of causal evidence at this date — three firm-run field experiments on 4,867 developers (SSRN 4945566) — found *less* experienced developers adopted more and gained more, the opposite of a budget-gated climb. Budget does not appear as a named gate in any source eligible at this date.

### 30 September 2025

**Same-instrument table.**

| Rung | Estimate | Bounds | Source | Publication date | Fielding window |
|---|---|---|---|---|---|
| 1 and above | 84% use or plan to use AI | n=49,009, 177 countries | Stack Overflow 2025 Developer Survey | 29 Jul 2025 | 29 May – 23 Jun 2025 |
| 2 (assistant/copilot use) | 26% regularly use GitHub Copilot for coding (69% tried, 49% regularly use ChatGPT) | n=23,262, weighted | JetBrains State of Developer Ecosystem 2024 — archived landing page (`web.archive.org/web/20241211150022/…`; the live `/lp/devecosystem-2024/ai/` subpage 404s) | 11 Dec 2024 | May–Jun 2024 |
| 3 | **Unmeasured** | — | Same exhausted search as cutoff A; still no denominator anywhere | — | — |
| 4 | 31% use AI agents at work (14.1% daily, 9% weekly, 7.8% monthly-or-less) | n=49,009 | Stack Overflow 2025 Developer Survey | 29 Jul 2025 | 29 May – 23 Jun 2025 |
| 5 | **Unmeasured** — no population percentage exists at this date | — | The autopilot/multi-agent questions the first paper uses (Stack Overflow's April 2026 pulse) are published eight months after this cutoff | — | — |
| 6 | **Unmeasured** | — | No source | — | — |

**Cross-instrument table.**

| Source | n | Definition | Estimate | Publication date |
|---|---|---|---|---|
| Stack Overflow 2025 | 49,009 | "use or plan to use AI tools" | 84% | 29 Jul 2025 |
| JetBrains 2024 | 23,262 | "have tried ChatGPT for coding and other development-related activities" | 69% (49% regularly use) | 11 Dec 2024 |
| DORA, State of AI-assisted Software Development 2025 | ~5,000 | "use AI at work" | 90% | 23 Sep 2025 — 7 days inside the cutoff |
| DORA, Accelerate State of DevOps 2024 | >39,000 | "rely on AI for at least one daily task" | >75% | 22 Oct 2024 |
| Atlassian State of Developer Experience 2025 | 3,500 developers and managers | "report saving time with AI" (>10 hrs/week) | 68%, against 38% reporting any time saving in 2024 | ~11 Jul 2025 |

**Excluded from this section on quality, not date:** GitHub Octoverse 2024 (98% more generative-AI projects, 150,000+ such repos) reports repository and pull-request volume — platform activity, not a developer's rung — and is dropped for the reason the first paper already gave it. Uplevel Data Labs' study (18 October 2024) narrowly misses this section's own cutoff sibling — it is eligible here for cutoff B and appears in the disconfirming section below, not this table, because it reports bug rates and cycle time, not adoption.

**The highest rung any generally available tool offered: rung 4, generally available five days before the cutoff.** Claude Code reached GA on 22 May 2025 — the first date `docs/ladder.md@b5a4f77f:19-24`'s rung 2 is available as literally written. GitHub's Copilot coding agent moved from public preview (19 May 2025) to **generally available to all paid Copilot subscribers on 25 September 2025**, five days inside this cutoff. OpenAI's Codex cloud agent was a research preview from 16 May 2025. Rung 5 (ratifying a passage of several tasks) has components — Claude Code subagents and hooks arrived mid-2025 — but no product offered passage-level ratification generally. Rung 6: nothing.

**Frontier gate.** DORA's own 2025 language: for an individual, friction "doesn't vanish so much as move: it shifts from manual grind to deciding and verifying." Trust fell as use rose on two instruments in this window: Stack Overflow's trust-in-accuracy figure and DORA's "little or no trust in AI-generated code" figure both worsen year over year (see the disconfirming section). Budget is not named as an individual-level gate by any source eligible here.

### 31 March 2026

**Same-instrument table.**

| Rung | Estimate | Bounds | Source | Publication date | Fielding window |
|---|---|---|---|---|---|
| 1 and above | 85% regularly use AI tools for coding and development | n=24,534, 194 countries | JetBrains State of Developer Ecosystem 2025 | Oct 2025 (Wayback capture 20251016105401) | Apr–Jun 2025 |
| 2 (assistant/agent/editor use) | 62% rely on at least one AI coding assistant, agent, or code editor | n=24,534 | JetBrains State of Developer Ecosystem 2025 | Oct 2025 | Apr–Jun 2025 |
| 3 | **Unmeasured** | — | Same exhausted search; still no denominator at any of the three dates | — | — |
| 4 | 55% regularly use AI agents | n=906, self-selected newsletter readers | The Pragmatic Engineer, "AI Tooling for Software Engineers in 2026" | 3 Mar 2026 (Wayback capture 20260305231145) | 27 Jan – 17 Feb 2026 |
| 5 | **Unmeasured as a population figure** | — | Anthropic's auto-approve-by-session-count series (~20% of sessions under 50 sessions, rising past 40% at 750+) is a *within-user* climb metric on Anthropic's own users, not a population estimate, and belongs in the frontier/gate reading below, not this cell | — | — |
| 6 | **Unmeasured** | Bounded only from outside: 0.8% of agentic API tool calls are irreversible actions, and the 99.9th-percentile autonomous stretch grew from under 25 minutes (Oct 2025) to over 45 minutes (Jan 2026) — a long tail in tens of minutes, not standing operation | Anthropic, "Measuring agent autonomy" | 18 Feb 2026 | late 2025 – early 2026 |

**Cross-instrument table.**

| Source | n | Definition | Estimate | Publication date |
|---|---|---|---|---|
| JetBrains 2025 | 24,534 | "regularly use AI tools for coding" | 85% | Oct 2025 |
| The Pragmatic Engineer 2026 | 906 | "regularly use AI agents" | 55% (staff+ 63.5%, engineers 49.7%, EMs 46.1%) | 3 Mar 2026 |
| Anthropic, Economic Index (Jan 2026) | first-party telemetry | share of directive (minimal-back-and-forth) conversations | 27% (Jan 2025) → 39% (Aug 2025) → 32% (Nov 2025) | 15 Jan 2026 |
| Anthropic, 2026 Agentic Coding Trends Report | vendor internal, no published instrument | AI present in engineers' work / tasks "fully delegable" | ~60% of work; 0–20% fully delegated | not dated in the document; Wayback first capture 22 Jan 2026 is the only publication evidence |

**Rung 4 has no same-instrument series across cutoffs B and C.** Stack Overflow's 31% (mid-2025, n=49,009) and The Pragmatic Engineer's 55% (early 2026, n=906) are different instruments, different populations, and an order of magnitude apart in sample size. Presented as 31% → 55% movement this would repeat exactly the fault a review of the first paper found (`docs/papers/harbour/developer-adoption-ladder.md@0a60c5bf`, citing the LIN-2925 review of 10:28 UTC 19 Sep) — the two figures sit in the cross-instrument table above, labelled, each with its own `n`, and are not read as a series anywhere in this paper.

**The highest rung any generally available tool offered: still rung 4 — unchanged from cutoff B.** GitHub Agent HQ, a cross-surface "mission control," was announced 28 October 2025 and was still "rolling out ... over the coming months" at this cutoff — announced, not generally available. **Claude Code Agent Teams shipped 5 February 2026** (Anthropic's own changelog, released alongside Claude Opus 4.6: `github.com/anthropics/claude-code/releases/tag/v2.1.32`, published 2026-02-05T17:47:50Z — a landable primary, dated source, superseding the trade-press fallback the plan anticipated needing), as a **research-preview, opt-in feature requiring `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`** — a rung-5-shaped capability no ordinary user gets by default. OpenAI shipped a Codex desktop app for managing multiple agents over longer periods in February 2026, similarly not a default. Rung 6: still nothing generally available; the same ceiling evidence as the table above applies.

**Frontier gate.** Anthropic's own autonomy report finds human-in-the-loop involvement *falling* as task difficulty rises (87% on simple tasks, 67% on complex) rather than budget gating anything below rung 6 — consistent with `docs/ladder.md@b5a4f77f:13`'s current reading that the gate below rung 6 is the cost of verifying, not budget. The directive-share reversal below is itself a caution against reading this cutoff's numbers as a straight line from the last one.

## The strongest disconfirming source

**The generally available frontier does not move between 30 September 2025 and 31 March 2026, and this paper's own tables show it.** Rung 4 (GitHub's Copilot coding agent) reached general availability on 25 September 2025. Six months later, at this paper's third cutoff, rung 5 was still an opt-in research preview behind an environment variable and rung 6 was still absent from every source searched. If — per `docs/ladder.md@b5a4f77f:11` — "the rungs move because the tools move," this is a half-year window in which, on the strict generally-available reading this paper's Method requires, they did not. This is the strongest disconfirming evidence *because it is cutoff-eligible at both dates it compares*, unlike everything below, which the paper's own cutoff rule would exclude from the per-date tables above.

**A disconfirming-section cutoff policy, stated once here and in Method:** the per-date tables above obey the publication cutoff strictly. This section does not, because it tests the paper's own cross-date reading rather than estimating a population at a date; every source below carries its own publication date, and none is presented as though it were available at an earlier cutoff.

**The directive-delegation reversal.** Anthropic's own telemetry shows the share of "directive" (minimal back-and-forth) conversations rising from 27% (January 2025) to a peak of 39% (August 2025), then **falling seven points to 32% by November 2025** — published 15 January 2026, so visible at this paper's third cutoff and invisible at its second. An analyst standing at 30 September 2025, with only the rising half of that series available, would have over-read the trend — precisely the failure this paper's Guard was written to catch.

**Trust falls as use rises, on two independent instruments.** Stack Overflow's trust-in-accuracy figure worsened from a combined 43.0% trusting (2.7% highly, 40.3% somewhat) in 2024 to 33% trusting (3.1% highly) against 46% distrusting in 2025. DORA's "little or no trust in AI-generated code" figure rose from 39% (2024 report) to — read the other way — 30% still reporting little or no trust even as adoption approached 90% (2025 report). Both move the wrong way for a ladder whose gate is supposed to accumulate with use.

**The 2024 RCTs carry the Microsoft-rollout sign two years earlier.** Three firm-run field experiments on 4,867 developers (SSRN 4945566, capture 5 September 2024) found *less* experienced developers adopted more and gained more from AI assistance — the same inverted-experience sign the first paper's strongest disconfirming source found in a 2026 rollout, present here in evidence that is itself eligible at this paper's earliest cutoff.

**Self-reported speed does not match measured speed.** METR's trial of 16 experienced open-source developers on 246 real tasks (10 July 2025) found developers forecast a 24% speedup, reported a 20% speedup afterward, and were measured **19% slower**. Uplevel Data Labs' study of roughly 800 developers (18 October 2024) found no significant change in cycle time or PR throughput with Copilot access, and **41% more bugs**. Both bound how much weight this paper's own self-reported adoption figures should carry.

**Two rival shapes, each available at every one of this paper's cutoffs.** Read in full for this paper (previously read at abstract only by the first paper): arXiv 2406.17325, a grounded-theory study of 26 practitioners and 395 survey respondents (25 June 2024), **explicitly tested and rejected a staged-adoption model** — it reports that a prior preliminary staged model (Russo 2023) had "3 of 7 hypotheses ... not supported upon further analysis," and develops instead a push-pull framework of two individual motives, four individual challenges, three organizational motives, three organizational challenges and three interleaved push-pull relationships, none of them sequential. It does not mention saved or reusable prompts as a behavior at all — its closest content, "discussion with peers" about prompting technique, is ephemeral, not the artifact-reuse rung 3 describes. Separately, DORA's 2025 report (23 September 2025) retired its own decade-old elite-to-low performance ladder in favour of seven co-existing team archetypes sized by cluster analysis (20/20/17/15/11/10/7%), framing AI as an amplifier of existing capability rather than a thing climbed. A research programme with a long history of ladder-shaped models looked at AI adoption at this paper's own second cutoff and chose not to use one.

**Cohort-skipping is plausible but not directly measured at these dates.** The Guard asks whether a cohort entering later skipped rungs rather than climbing them. No source eligible at any of this paper's three cutoffs tracks the same individuals across rungs over time — the closest is Anthropic's auto-approve-by-session-count series (18 February 2026), which is within-user but does not distinguish a climb from a skip. The paper states this rather than inferring an answer either way.

## Method

Desk research and drafting on 19 September 2026, grounded at `b5a4f77f`. Research (item 0df4b864) ran twenty-two live searches and fetches, established the eligible-source inventory below by publication date, and used the Wayback CDX API directly to prove three exclusions and two citations. Four checks it left open were resolved in this implementation session: the JetBrains 2024 archived landing page (`web.archive.org/web/20241211150022/…`) turned out to carry a clean per-developer figure — 69% tried and 49% regularly use ChatGPT for coding, Copilot tried by 40% and regularly used by 26% — stronger than the company-level-only figures anticipated, so no fallback was needed there; a primary, dated source for Claude Code Agent Teams was landed at `github.com/anthropics/claude-code/releases/tag/v2.1.32` (published 2026-02-05T17:47:50Z), so the trade-press fallback was not needed either; DORA 2023's full 95-page PDF was read and, as anticipated, yields only an ordinal "AI contribution" score (mean 3.3/10, median 2.4), not a population percentage, so that row stays qualitative per the plan's stated fallback; and arXiv 2406.17325 was read in full rather than at its abstract, which is what makes the disconfirming section's stage-model-rejection finding citable with its actual mechanism (the Russo 2023 hypothesis test) rather than paraphrased secondhand.

**Cutoff rule.** A source counts toward a date's per-date tables only if it was *published* on or before that date; its fielding or data-collection window is recorded separately and never substituted for publication date. Two exclusions turn on this rule by a matter of weeks: DORA's 2024 report (published 22 October 2024) misses the 30 September 2024 cutoff by three weeks, leaving the 2023 report — one qualitative sentence, no figure — as the only DORA source eligible at that date; JetBrains' State of Developer Ecosystem 2025 wave (fielded April–June 2025, published October 2025) misses the 30 September 2025 cutoff even though it was fielded four months before it, and its figures appear only in the 31 March 2026 section.

**Mapping rule.** Each source's own categories map onto the six rungs one way only, from source to rung, never the reverse. Where the same instrument recurs across sections — Stack Overflow's "use AI agents" question, JetBrains' broad "assistant, agent, or code editor" wording, Anthropic's auto-approve series — this paper reuses the first paper's placement of it exactly (`docs/papers/harbour/developer-adoption-ladder.md@0a60c5bf`, Findings), rather than re-deriving a mapping.

**Same-instrument / cross-instrument separation.** A review of the first paper (LIN-2925, comment of 10:28 UTC 19 September 2026) found a subtraction computed across two surveys with two different definitions, presented where a reader could mistake it for one series. This paper hardens that into a structural rule: the same-instrument table per date carries only single-source, single-instrument figures; the cross-instrument table carries multiple instruments' independent estimates of similar questions at the same date, each with its own `n` and definition, explicitly to bound — never combine — what a difference between them can mean.

**Six-part order, reused from a standing ruling.** `docs/papers/standard.md@b5a4f77f:23-31` fixes a five-part order (Answer, Findings, Method, Limits, Next). This paper carries six, with "The strongest disconfirming source" between Findings and Method, on ruling `lin2925-paper-order` (LIN-2925, comment of 10:11 UTC 19 September 2026), which this ticket adopts rather than re-raising. `docs/papers/standard.md@b5a4f77f:45-48` already widened the `harbour/` directory to cover papers about the people Harbour serves, so this paper needs no location deviation either.

**`docs/ladder.md` is v2, and this paper cites v2.** The ladder was revised the same day this ticket was filed, from the first paper's findings (`docs/ladder.md@b5a4f77f:19-24` for the rung table, `:9` and `:13` for the trust/verification-cost framing, `:30-34` for the population summary the first paper wrote). Every ladder citation in this paper uses these line numbers and this SHA, not the research comment's earlier `7f1da76f`/`:15-20` references, which described v1.

**Excluded, and why.** SEO aggregator round-ups were searched and dropped for the reason the first paper gives; one is recorded here because the failure was concrete rather than abstract — a search for early-2026 surveys returned a "KPMG AI Quarterly Pulse Survey, Q1 2026" citing 31.8%/14.1%/37.9%, which are Stack Overflow 2025's own figures re-badged onto a different publisher and a later date. Platform telemetry (GitHub Octoverse) is excluded as describing repository activity, not a developer's rung. Vendor maturity ladders are excluded as frameworks with no population behind them.

## Limits

**Every survey here is self-selected, and self-selection favours the AI-curious**, for the same reason the first paper gives: respondents are reached through each vendor's own channels, so a developer using no AI and reading no developer newsletter is the hardest person in every one of these populations to count. This applies identically at all three cutoffs.

**The cross-instrument spread bounds every cross-date reading.** At 30 September 2024 alone, "uses AI" runs from 42% to 97% depending on instrument and definition — more than double. A reader comparing this paper's rung-1 figures across dates should check that any apparent movement exceeds that spread before reading it as a climb rather than noise between instruments.

**Rung 4 has no eligible same-instrument series.** The only two population-level rung-4 figures in this paper's entire span — Stack Overflow's 31% (mid-2025) and The Pragmatic Engineer's 55% (early 2026) — are different instruments with an order-of-magnitude difference in sample size (49,009 vs 906). Whether the true population figure moved by 24 points, by more, or by less cannot be said from this evidence.

**The rung mapping is this paper's interpretation**, reused from the first paper where the instrument recurs and newly drawn where it does not (SlashData, Atlassian, the 2024 RCTs, The Pragmatic Engineer). A reader who draws rung 2's boundary differently — "relies on an assistant" is not the same act as "drives a session by hand, meandering" — should read every rung-2 estimate here as an upper bound, exactly as the first paper cautions for its own rung-4 estimate.

**Two sources carry residual uncertainty even after this session's checks.** The 2026 Agentic Coding Trends Report carries no date of its own; its publication evidence is a Wayback capture (22 January 2026), which is when it is first provable to have existed, not necessarily when it was written. The SSRN working paper (4945566) is cited at its 5 September 2024 Wayback capture rather than its live page, which now shows a later revision date — the capture, not the live document, is what proves pre-cutoff content.

**The paper's own three-date sample is not enough to distinguish a stall from a plateau that will move again.** The finding that the generally available frontier held at rung 4 for six months is real and cutoff-eligible, but three snapshots cannot say whether that is the shape going forward — that question belongs to LIN-2930, which this paper's evidence directly informs.

## Next

**Should `docs/ladder.md` be revised to a v3 from this paper's evidence, the way the first paper's findings became v2 the same day it landed?** The frontier stood still between this paper's second and third cutoffs while the current ladder text was drafted from the first paper's April 2026 snapshot; whether that changes the "the rungs move because the tools move" reading (`docs/ladder.md@b5a4f77f:11`) or whether the two papers together already say enough is a decision for whoever reads both, not this paper. (Claude, 2026-09-19)

**Where is rung 3, and can anyone measure it?** Already a line in this file (`docs/papers/proposals.md`, added by the first paper, 2026-09-19) — this paper found the same gap extends backward through all three of its own cutoffs rather than being a 2026 phrasing artefact, which strengthens rather than duplicates that line. No new line is added for it here.
