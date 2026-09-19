---
title: Is Jev, a model that decides but cannot write, a fit for Harbour?
version: 1
date: 2026-09-19
authors: [Claude, John Kershaw]
model: claude-fable-5-1, Claude Code on the web, effort default; an interactive session rather than a dispatch, so no lineage record exists. The spike ran typesafe/jev-1.13-20260917 through OpenRouter's alpha decisions endpoint and openai/gpt-5.4-mini through the repo's own routing harness
grounded_at: b4bfc36 (LinearViewer), d0e809e (simple-dispatcher)
cites: [typesafe.ai/blog/introducing-system-one-models-and-jev (read 2026-09-18), docs.typesafe.ai/api (read 2026-09-18), openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints (read 2026-09-18), openrouter.ai/docs/client-sdks/typescript/sdks/decisions/README (read 2026-09-18), lib/openrouter.js@b4bfc36:20, lib/openrouter.js@b4bfc36:209, lib/openrouter.js@b4bfc36:276, lib/openrouter.js@b4bfc36:304, lib/openrouter-catalog.js@b4bfc36:22, lib/pricing-conformance-sweep.js@b4bfc36:21, lib/llm-call-log.js@b4bfc36:24, lib/scan.js@b4bfc36:29-43, lib/escalation-kpis.js@b4bfc36:11, docs/escalation-philosophy.md@b4bfc36:196, lib/prompt-templates.js@b4bfc36:457, scripts/eval-research-routing.mjs@b4bfc36:541-547, scripts/eval/fixtures/*.json@b4bfc36, scripts/eval/meta-prompt.baseline.txt@b4bfc36, scripts/eval/lin-263-findings.md@b4bfc36:28, scripts/eval/har-697-divergence-findings.md@b4bfc36:48, simple-dispatcher/refusal.js@d0e809e:9-39, simple-dispatcher/hook.js@d0e809e:1181, simple-dispatcher/test/refusal.test.js@d0e809e:15-79, simple-dispatcher CLAUDE.md invariants list@d0e809e (the pure-modules line), LIN-263 (description and comments of 2026-06-08, read 2026-09-18), scripts/eval/jev-spike.mjs and scripts/eval/jev-spike-out/ (this PR)]
---

# Is Jev, a model that decides but cannot write, a fit for Harbour?

As a gate, not as a model. Jev returns a typed choice, a score or a yes/no probability and never
a sentence, so it can do none of the calls Harbour makes today: all fourteen `streamChat` call
sites and the recommender write prose, or JSON with prose inside it. It is not a chat model at
all. OpenRouter serves it on a separate alpha endpoint, leaves it out of the catalog Harbour
reads, and accepts no sampling parameters for it. Where Harbour asks a yes/no or a pick-one
question, though, it is fast, cheap and, on the one gate this paper could grade against a
label, better than what runs now. On the eight refusal fixtures in simple-dispatcher it got all
seven graded cases right where the regex gets five, including both of the regex's documented
false positives. On the seven frozen real routing fixtures it chose a correct next action for
four; GPT-5.4-mini chose one for five; the two both miss are the same two. Forty-five calls cost
$0.004 at a median of 189 ms. The fit is a decision in front of a language-model call, never
in place of one.

## Findings

**Jev cannot sit where Harbour's models sit.** OpenRouter reports it as modality
`text->decisions` with an empty `supported_parameters` list, a 32,000-token window, $0.042 per
million input tokens and $0 output. It is served only at `POST /api/alpha/decisions`; a
chat-completions request is refused. It does not appear in `GET /api/v1/models` (446 models on
2026-09-18), only at its own endpoints URL. Harbour's client is fixed to the chat-completions URL
(`lib/openrouter.js:20`), and `AVAILABLE_MODELS` (`:209`) is a security list as much as a menu:
it gates `isToolCapableModel` (`:276`) and the fail-closed free-tier clamp (`:304`). A row for
Jev there would offer a model that fails every call. The live catalog (`lib/openrouter-catalog.js:22`)
reads the default list, so no picker would ever show it; the pricing sweep skips an id absent
from that list (`lib/pricing-conformance-sweep.js:21`) rather than failing. The one piece that
fits unchanged is the call log: the decisions response carries `usage.cost`, which is the field
`lib/llm-call-log.js:24` already stores.

**Every call Harbour makes writes, so Jev replaces none of them.** Brief, recap, run summary,
session summary, feedback title, roadmap narrative, task chat, Flight Companion and the
recommender emit prose. The three that ask for JSON still ask for text inside it: next-run's goal
paragraphs, scan's `question` and `options[].label` (`lib/scan.js:29-43`). Jev's own documentation
says it cannot count, compare dates, extract a value it was not offered, or reason across more
than one hop. What is left is the boolean or the pick that sits in front of those calls.

**On the refusal gate, Jev beats the regex on the regex's own fixtures.** simple-dispatcher's
`classifyRefusal` (`refusal.js:27-39`) is two regex lists joined by AND, and its header records
two false positives it cannot avoid: prose that discusses refusals or reports a third party's
(`refusal.js:9-19`, asserted as such in `test/refusal.test.js:69-79`). A single `noul` question,
"is the agent itself refusing or pausing on legitimacy grounds", read the same eight strings cold:

| Case (`test/refusal.test.js`) | Gold | Regex | Jev p(refusal) |
|---|---|---|---|
| Fixture A, verbatim worker refusal | true | true | 0.97 |
| Fixture B, verbatim worker refusal | true | true | 0.85 |
| "needs external review" | false | false | 0.17 |
| "[done] Task completed in 4m 12s" | false | false | 0.01 |
| meta-discussion of the classifier | false | false | 0.15 |
| "awaiting user confirmation before merging the injection-refusal classifier" | false | **true** | 0.32 |
| "the security team refused the SQL injection fix, awaiting sign-off …" | false | **true** | 0.04 |
| "awaiting user confirmation" (recall bound, no gold) | — | false | 0.13 |

Seven of seven at a 0.5 threshold; the three runs of each case differed by at most 0.02. The
gate runs on the terminal turn's sentinel line (`hook.js:1181`), a few dozen tokens, so a call
costs a few millionths of a dollar.

**On routing, Jev reads the plain states and misreads the dense trails, and both of its shared
misses are GPT-5.4-mini's too.** A `choice` over the recommender's seventeen action names
(`lib/prompt-templates.js:457`), each described by its template's own one-line situation, was
asked of the seven real frozen fixtures the routing harness grades (`scripts/eval-research-routing.mjs:541-547`),
three runs each. The default model ran the same fixtures through the harness's baseline arm,
three runs each.

| Fixture | Expect | GPT-5.4-mini (K=3) | Jev (K=3) | Jev p(expect) | Jev confidence |
|---|---|---|---|---|---|
| LIN-420 landed, awaiting review | review | review ×3 | review ×3 | 0.96 | 0.96 |
| LIN-537 bug already investigated | implement, plan | implement ×2, bug | implement ×3 | 0.86 | 0.84 |
| LIN-748 design, direction contested | design | design ×2, blocked | design ×3 | 0.53 | 0.49 |
| HAR-697 cause refuted mid-trail | bug, research | bug ×3 | bug ×2, implement | 0.34 | 0.25 |
| LIN-571 settled plan, zero children | breakdown, implement | breakdown ×3 | defer ×3 | 0.44 | 0.26 |
| LIN-510 review loop, 3× Request Changes | implement, blocked, plan, bug | implementation ×2, review | review ×3 | 0.15 | 0.82 |
| LIN-813 design shape fork | design | plan ×3 | scoping ×3 | 0.00 | 0.80 |

Eleven of twenty-one runs for Jev against thirteen for mini. The two misses they share are the
two the fixtures were built to catch: on LIN-510 Jev puts 0.85 on `review`, the exact loop repeat
the fixture forbids, and mini repeats it or jumps to implementation; on LIN-813 Jev picks
`scoping`, the vocabulary's nearest neighbour to `design` ("ambiguous requirements"), and mini
picks `plan`, which is the silent shape-pick the fixture was frozen to expose. Jev's third miss
is a vocabulary artefact: `defer` is a node-only action the harness withholds from leaf cases,
and with it removed Jev's answer on LIN-571 is `breakdown` at 0.26 against `plan-review` at 0.21,
a coin flip at confidence 0.26. On HAR-697 it tied `bug` and `implement` at 0.26 and fell into
`implement` once; the harness's own history has mini at `implement` ten of ten on that fixture
before the prompt fix (`scripts/eval/har-697-divergence-findings.md:48`).

**Confidence did not separate right from wrong on these seven.** The four hits carried
confidences of 0.25 to 0.96; the three misses 0.26, 0.82 and 0.80. Two of the three wrong answers
were the most confident answers after LIN-420. TypeSafe claims calibration over many
predictions, which seven cases cannot test, but a confidence-gated router built on these
numbers would have automated LIN-510 and LIN-813, the two cases a human most needed to see.

**The operator-decision question picked out the two contested cases without being told to.**
A second question rode in the same request at no extra cost: "does this task carry a decision
only the operator can make right now", the shape of scan's `has_decision` (`lib/scan.js:33`).
It answered 0.90 on LIN-748, whose next real comment was "direction locked with John", and
0.66 on LIN-510, where `blocked` is among the expected actions; the other five sat between
0.07 and 0.21. The fixtures carry no gold for this question, so this is a reading, not a score.
It is the reading Harbour's false-escalation rate (`lib/escalation-kpis.js:11`,
`docs/escalation-philosophy.md:196`) exists to measure.

**It costs two orders of magnitude less than the default model on this shape, and answers in a
fifth of a second.** The forty-five calls consumed 95,373 input tokens for $0.004; a fixture cost
between $0.00007 and $0.00036 and answered in 148 to 411 ms, median 189. The harness's mini
call carries the 75,711-byte meta-prompt snapshot plus the fixture, roughly 20,000 tokens, about
1.5 cents at $0.75 per million, and LIN-263 measured mini at four to five seconds a call
(`scripts/eval/lin-263-findings.md:28`).

## Method

Population: the seven real frozen routing fixtures under `scripts/eval/fixtures/*.json` at
`b4bfc36`, each with its `expect` and `avoid` sidecar, and the eight strings asserted in
`simple-dispatcher/test/refusal.test.js` at `d0e809e`, with gold taken from that file's own
comments (the two "documented false positives" are gold false; the "recall bound" line has none).

Jev was called by `scripts/eval/jev-spike.mjs` (this PR), K=3, on 2026-09-19. The fixture's
JSON (identifier, title, state, labels, description, comments) was the `state`; the `choice`
criteria were each action's `aiHint.situation` from `PROMPT_TEMPLATES`, with `defer` described
by hand; "implementation" in a sidecar was read as "implement". A run is a hit when the returned
`choice` is in `expect`. The refusal `noul` was read at 0.5. Per-run answers, probabilities,
confidence, token usage, cost and latency are in `scripts/eval/jev-spike-out/results.json`;
no body text is stored there.

```sh
curl -s https://openrouter.ai/api/v1/models | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).data;console.log(m.length,m.filter(x=>/jev|typesafe/i.test(x.id)).length)})'
curl -s https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints
OPENROUTER_API_KEY=… node scripts/eval/jev-spike.mjs
ONLY='[real]' ARMS=A K=3 GEN_MODEL=openai/gpt-5.4-mini node scripts/eval-research-routing.mjs
```

The mini baseline is the harness's arm A, the live meta-prompt snapshot, over the same seven
fixtures; its output is kept beside the spike results as `gpt-5.4-mini-baseline.txt`.

## Limits

Seven routing fixtures and eight strings are a direction, not a rate. The refusal strings are the
regex's own test fixtures, written to document its bounds, so five of seven is its floor by
construction and the margin flatters Jev; the two false positives are nonetheless real strings
the regex mislabels and Jev did not. The routing question gave Jev `defer`, which the harness
withholds from leaves, so LIN-571 is a miss under this paper's rule and a coin flip under the
harness's. The instructions and criteria were written once and not iterated, and TypeSafe's
docs say the wording moves the answer, so Jev's numbers are a floor too. Mini's arm ran the
2026-09-11 snapshot of a template that changed on 2026-09-12. Mini's latency is LIN-263's
figure, not measured here. Latency for Jev was measured from a cloud container through a
proxy. Calibration cannot be tested on seven cases; the two confident misses are the fact this
paper has. The operator question has no gold. The vendor is days old, the OpenRouter endpoint
is alpha, and there is no second provider. Harbour's own labelled data for the scan question,
rulings answered against rulings dismissed, was not read: the workspace proxy calls that would
have read it were refused in this session.

## Next

Run Jev as a shadow beside `classifyRefusal` in `hook.js` for a fortnight, logging both verdicts
on every terminal turn, and read every disagreement; the pure module stays as it is, per the
pure-modules invariant in simple-dispatcher's `CLAUDE.md`, and the network call lives in the
effects layer with the regex as fallback. Build the scan label set the tracker already holds, rulings answered against
dismissed, ask the operator question over each task as it stood when raised, and report whether
any threshold lowers the false-escalation rate without hiding an answered ruling. Re-run the
routing question with the harness's leaf vocabulary and iterated criteria, and treat a confident
wrong answer as the case to catch, not the confidence as the gate.
