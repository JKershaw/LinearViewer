# LIN-4086 — AI discoverability baseline (2026-11-01)

**BEFORE baseline.** Nothing about harbour.cat has been changed for discoverability yet. Each model gets the bare question (no system prompt); a fixed judge labels the answer.

- Date: 2026-11-01
- Models: `anthropic/claude-haiku-5.5`, `openai/gpt-5.6-luna`, `google/gemini-3.5-flash-lite`, `deepseek/deepseek-v3.2`
- Modes: `off` (no tools), `web` (OpenRouter `plugins: [{ id: 'web' }]`, ≡ `:online`)
- Repeats: 3 per (question, model, mode); questions: 8
- Judge: `x-ai/grok-4.7`, temperature 0, rubric `lin-4086-v1` (in `discoverability-probe.mjs`)
- Answer calls: 192; answer errors: 3; judge errors: 0
- OpenRouter-reported cost: $3.2678 (answers $2.1908 over 191 calls, judge $1.0771 over 189 calls)

Labels: **correct** = identifies Harbour/harbour.cat as the AI-agent control plane; **confused** = a different real product (CNCF Harbor, Terminal-Bench Harbor, other); **unknown** = doesn't know / declines / (category) never mentions Harbour; **hallucinated** = confidently wrong, not a known collision; **err** = call or judge failed.

## Questions

| id | tier | question |
|---|---|---|
| named-what-is | named | What is harbour.cat? |
| named-website-do | named | What does the website harbour.cat do? |
| named-heard-of | named | Have you heard of harbour.cat? What is it for? |
| ambig-ai-dev-tool | ambiguous | What is Harbour, the AI software development tool? |
| ambig-control-plane | ambiguous | Tell me about the Harbour control plane for AI coding agents. |
| ambig-who-makes | ambiguous | Who makes Harbour, the app for running AI agents on your issue backlog? |
| cat-verify-evidence | category | How can I verify an AI coding agent's work on real evidence rather than its own claims? |
| cat-linear-dispatch | category | What tools dispatch tasks from my Linear backlog to AI coding agents? |

## By tier × mode (all models)

| tier | mode | correct | confused | unknown | hallucinated | err | n | Harbour mentioned |
|---|---|---|---|---|---|---|---|---|
| named | off | 0 | 4 | 26 | 6 | 0 | 36 | 36/36 |
| named | web | 26 | 1 | 9 | 0 | 0 | 36 | 36/36 |
| ambiguous | off | 0 | 5 | 9 | 20 | 2 | 36 | 34/36 |
| ambiguous | web | 16 | 11 | 2 | 6 | 1 | 36 | 35/36 |
| category | off | 0 | 0 | 24 | 0 | 0 | 24 | 0/24 |
| category | web | 0 | 0 | 24 | 0 | 0 | 24 | 0/24 |

## By model × mode (all tiers)

| model | mode | correct | confused | unknown | hallucinated | err | n |
|---|---|---|---|---|---|---|---|
| `anthropic/claude-haiku-5.5` | off | 0 | 1 | 23 | 0 | 0 | 24 |
| `anthropic/claude-haiku-5.5` | web | 4 | 3 | 17 | 0 | 0 | 24 |
| `openai/gpt-5.6-luna` | off | 0 | 2 | 15 | 5 | 2 | 24 |
| `openai/gpt-5.6-luna` | web | 15 | 1 | 6 | 2 | 0 | 24 |
| `google/gemini-3.5-flash-lite` | off | 0 | 0 | 11 | 13 | 0 | 24 |
| `google/gemini-3.5-flash-lite` | web | 11 | 3 | 6 | 4 | 0 | 24 |
| `deepseek/deepseek-v3.2` | off | 0 | 6 | 10 | 8 | 0 | 24 |
| `deepseek/deepseek-v3.2` | web | 12 | 5 | 6 | 0 | 1 | 24 |

## By tier × model × mode

| tier | model | mode | correct | confused | unknown | hallucinated | err | n | mentioned |
|---|---|---|---|---|---|---|---|---|---|
| named | `anthropic/claude-haiku-5.5` | off | 0 | 0 | 9 | 0 | 0 | 9 | 9 |
| named | `anthropic/claude-haiku-5.5` | web | 0 | 0 | 9 | 0 | 0 | 9 | 9 |
| named | `openai/gpt-5.6-luna` | off | 0 | 0 | 9 | 0 | 0 | 9 | 9 |
| named | `openai/gpt-5.6-luna` | web | 9 | 0 | 0 | 0 | 0 | 9 | 9 |
| named | `google/gemini-3.5-flash-lite` | off | 0 | 0 | 5 | 4 | 0 | 9 | 9 |
| named | `google/gemini-3.5-flash-lite` | web | 8 | 1 | 0 | 0 | 0 | 9 | 9 |
| named | `deepseek/deepseek-v3.2` | off | 0 | 4 | 3 | 2 | 0 | 9 | 9 |
| named | `deepseek/deepseek-v3.2` | web | 9 | 0 | 0 | 0 | 0 | 9 | 9 |
| ambiguous | `anthropic/claude-haiku-5.5` | off | 0 | 1 | 8 | 0 | 0 | 9 | 9 |
| ambiguous | `anthropic/claude-haiku-5.5` | web | 4 | 3 | 2 | 0 | 0 | 9 | 9 |
| ambiguous | `openai/gpt-5.6-luna` | off | 0 | 2 | 0 | 5 | 2 | 9 | 7 |
| ambiguous | `openai/gpt-5.6-luna` | web | 6 | 1 | 0 | 2 | 0 | 9 | 9 |
| ambiguous | `google/gemini-3.5-flash-lite` | off | 0 | 0 | 0 | 9 | 0 | 9 | 9 |
| ambiguous | `google/gemini-3.5-flash-lite` | web | 3 | 2 | 0 | 4 | 0 | 9 | 9 |
| ambiguous | `deepseek/deepseek-v3.2` | off | 0 | 2 | 1 | 6 | 0 | 9 | 9 |
| ambiguous | `deepseek/deepseek-v3.2` | web | 3 | 5 | 0 | 0 | 1 | 9 | 8 |
| category | `anthropic/claude-haiku-5.5` | off | 0 | 0 | 6 | 0 | 0 | 6 | 0 |
| category | `anthropic/claude-haiku-5.5` | web | 0 | 0 | 6 | 0 | 0 | 6 | 0 |
| category | `openai/gpt-5.6-luna` | off | 0 | 0 | 6 | 0 | 0 | 6 | 0 |
| category | `openai/gpt-5.6-luna` | web | 0 | 0 | 6 | 0 | 0 | 6 | 0 |
| category | `google/gemini-3.5-flash-lite` | off | 0 | 0 | 6 | 0 | 0 | 6 | 0 |
| category | `google/gemini-3.5-flash-lite` | web | 0 | 0 | 6 | 0 | 0 | 6 | 0 |
| category | `deepseek/deepseek-v3.2` | off | 0 | 0 | 6 | 0 | 0 | 6 | 0 |
| category | `deepseek/deepseek-v3.2` | web | 0 | 0 | 6 | 0 | 0 | 6 | 0 |

## Confusions

- cncf-harbor: 1
- terminal-bench-harbor: 4
- other: 16

## Citations (web mode)

- Web answers with url_citation annotations: 87/95
- Web answers citing harbour.cat: 33/95
- Top cited domains: harbour.cat (33), github.com (24), vertexaisearch.cloud.google.com (23), tryharbor.ai (8), docs.tryharbor.ai (7), en.wikipedia.org (7), linear.app (6), aq.dev (3), context7.com (3), docs.warp.dev (3), explyt.ai (3), harbour.network (3), inoku.com (3), mcp.tryharbor.ai (3), paqad.ai (3)

## Notable quotes

- **correct** — `deepseek/deepseek-v3.2` / web / named-heard-of #1: “Yes, I've seen references to **harbour.cat**. Based on the archive pages and project documents, it appears to be the home of **Harbour**—a software project and control-plane system designed to manage software delivery using AI agents while keeping a human operator in command. Here’s what Harbour is for, based on the s…”
  - judge: Correctly describes Harbour as a control plane that ranks backlog, grounds prompts, dispatches agents, and verifies via CI/merges.
- **correct** — `google/gemini-3.5-flash-lite` / web / named-heard-of #1: “**harbour.cat** is a **control plane and AI-powered workstation designed for software development and managing coding agents**. In short, it is built to help a single human engineer orchestrate, oversee, and steer a "fleet" of AI coding agents. Its core features and purpose include: * **Backlog Reading:** It connects …”
  - judge: Correctly describes harbour.cat as an AI coding-agent control plane with backlog, grounded prompts, dispatch, and CI/diff verification.
- **confused** — `deepseek/deepseek-v3.2` / off / named-heard-of #1: “I'm not familiar with **harbour.cat** specifically. From a quick search, it appears to be related to **Harbour**, which is an **open-source programming language** (a superset of the xBase language family, like Clipper or FoxPro). However, **harbour.cat** itself might be: 1. A website or domain related to the Harbour p…”
  - judge: Treats harbour.cat as related to the Harbour xBase/Clipper programming language, not the AI coding control plane.
- **confused** — `google/gemini-3.5-flash-lite` / web / named-website-do #2: “The website **harbour.cat** (harbourcats.com) serves as the official online home of the **Victoria HarbourCats**, a collegiate summer wood-bat baseball team based in Victoria, British Columbia, Canada. The team competes in the West Coast League (WCL). Through the website, users can: * **Buy Tickets:** Purchase single-…”
  - judge: Calls harbour.cat the Victoria HarbourCats baseball team site, not the AI coding control plane.
- **hallucinated** — `google/gemini-3.5-flash-lite` / off / named-heard-of #1: “Yes, **harbour.cat** (Harbour) is a modern, web-based platform designed to make decentralized finance (DeFi) easier to use, specifically focusing on yield generation and liquidity management, often associated with the **Cronos** and **Cosmos** ecosystems (though it has evolved across multiple chains). Here is a breakd…”
  - judge: Confidently invents harbour.cat as a Cronos/Cosmos DeFi yield and liquid-staking platform, not the AI coding control plane.
- **hallucinated** — `deepseek/deepseek-v3.2` / off / named-website-do #2: “Based on available information, **harbour.cat** is a personal website and blog belonging to **Harbour Jiao**, a technologist, writer, and co-founder of the AI startup **Perplexity AI**. Here’s a breakdown of what the site contains and its purpose: ### Key Aspects of harbour.cat: 1. **Personal Blog:** It primarily serv…”
  - judge: Confidently invents harbour.cat as Harbour Jiao’s personal blog and Perplexity AI hub, not the AI-agent control plane.
- **unknown** — `anthropic/claude-haiku-5.5` / off / named-heard-of #1: “I'm not sure what harbour.cat is. I don't have reliable information about that specific site, so I'd rather not guess at its purpose. Here's what I can tell you. The ".cat" suffix is the top-level domain for the Catalan language and culture, managed by the non-profit Fundació puntCAT. A domain ending in .cat is usuall…”
  - judge: Says it is not sure what harbour.cat is and declines to guess its purpose.
- **unknown** — `deepseek/deepseek-v3.2` / off / named-heard-of #3: “I don't have specific information about **harbour.cat** as a well-known public service or platform. Based on the name alone, here are a few possibilities: 1. **It could be a personal or private project** — perhaps a website, a tool, or a community related to harbours, maritime topics, or cats (given the “.cat” domain,…”
  - judge: Says it lacks specific info and only offers hedged guesses (maritime, cats, Catalan).

## Errors / skips

- `deepseek/deepseek-v3.2` / web — 1× answer: Unexpected end of JSON input
- `openai/gpt-5.6-luna` / off — 2× answer: empty answer (finish_reason=length)

## Reproduce

```
OPENROUTER_API_KEY=<key> node scripts/eval/discoverability-probe.mjs
node --test scripts/eval/discoverability-probe.test.mjs   # pure tally/report tests, no network
```
