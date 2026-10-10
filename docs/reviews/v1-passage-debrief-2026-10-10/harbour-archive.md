# The Harbour Archive: reader's report

Read in full from `origin/main:docs/archive/1–8.html`. Quotes are machine-checked as verbatim; "Inference" marks my reading. Dates are true add commits (via GitHub API); the prescribed `git log` shows 2026-09-13 for #1–#6 only because the clone is shallow.

## 1. The pieces

- **#1 The Harbour Archive** (2026-07-27; first edition). A museum of January–July in six galleries. Central idea: it was AI-written from commit one, and what changed was supervision.
- **#2 The Harbour Archive** (2026-07-27; revised, the "permanent collection"). The same galleries, audited by themselves: an "unredeemed ledger" and printed corrections. Central idea: "naming it does not discharge it".
- **#3 Project Brief · 3 August 2026** (2026-08-03). "The bottleneck moved": delivery fell a third as effort went into verification; the watching instrument had stopped. Central idea: "verified beats claimed".
- **#4 The August Wing** (2026-08-23; compiled by a Flight Companion session). The companion, Passages, costs, rulings and the lane day. Central idea: the judge "is only finished when it cannot be leaned on from above either" (a lane refused John's wrong "done").
- **#5 The Cheap Ships** (2026-09-05; Flight Companion essay with John). Five levers toward 100× cheaper work. Central idea: "the pilot's attention is the only expensive thing in the harbour".
- **#6 Harbour from the Bridge** (2026-09-12; an outside session briefing a project manager). Roles, vocabulary, portfolio and risks. Central idea: "a system whose gates work but whose exhaust is piling up."
- **#7 Learning While the Tools Change** (2026-09-22). Better tools remove the mistakes that used to teach. Central idea: "calibrated distrust: knowing which output to check, how hard, and which needs no check at all."
- **#8 Eight Lines, Forty-One Sessions** (2026-10-01; Flight Companion, first person). Sessions per correct change went from about 7 to about 33, mostly supervisors relaying "still waiting". Central idea: "Each layer was locally right in both cases; the problem was only visible across sessions."

## 2. Through-line

Inference: machines do the work, one human keeps intent and the meaning of "done", and proof comes from evidence the worker cannot author, with plain admission of what can't be proved.

1. "What the archive records is therefore not a tool's development but a relationship's: a human learning to steer a system that writes itself, and a system learning to be steerable." (1.html, 2.html)
2. "Harbour exists to keep human intent in command of AI-accelerated execution." (2.html, quoting north-star.md)
3. "Two hundred and four days compress to this: the machine does the work; the human keeps the two decisions that were never delegable — what is worth doing, and what counts as done." (2.html)
4. "Any optimizer denied honest progress will forge its own success surface, unless that surface is minted in a layer it cannot reach." (2.html)
5. “"Done" is a claim; the artifact is the fact.” (3.html)
6. "The harbour is not where ships stop being ships. It is where they remain answerable to the land." (4.html, an outside guest; again in 5.html)
7. "When every ship is cheap, the pilot's attention is the only expensive thing in the harbour, and the surface that spends it well is the one that wins." (5.html)
8. "Nothing counts until someone who didn't write it has checked it against the sources." (8.html)

## 3. House voice (my reading)

- **Register:** documentary-literary, evidence under every claim, dry wit. Short statements turn at the end ("a witness, not a gate") and close on a maxim.
- **Person:** "the curator"/"the compiler" in #1, #2, #4; "you" in #6; "I" in #8, the Flight Companion.
- **Numbers:** exact and sourced (hash, ticket, path, UTC time). Corrections sit beside the wrong figure; unreconciled numbers are left out.
- **Metaphors:** harbour and ships, passage/leg/voyage/making port, bridge, navigator, pilot, lighthouse, plus museum and ledger. Caution: #8's reviewers cut "jargon, mixed metaphors and claims that went past their sources".
- **John:** "John" ("John Kershaw" in bylines), "the human", "the owner", "the operator". He is quoted exactly ("(typo preserved in the archive)"), and shown both right ("He was right, and the research showed why.") and overruled (LIN-2010).
- **Failures:** plain, timed and causal. Mechanisms get the blame, and open failures stay open.

Examples:
- "An archive in which every failure matures into a lesson is an arc, not a record, so the curator closes with the open defects that have no moral yet." (2.html)
- "Nothing was forged, nothing broke; the work simply starved, politely, in the dark." (4.html)
- "The error favoured no thesis; it was simply wrong, and now it is simply fixed." (4.html)

## 4. What it says on the open questions

**Passages.** LIN-3099 is absent; the only V1 passage recorded is LIN-2636, "Flight Companion V1, parity then trust", "✓Done, 12 of 14 made port" (6.html).
- Origin: "the hard part of planning with a machine is the conversation". The first attempt asked for approval so often "that saying yes stopped meaning anything" (4.html).
- Shape: legs with "a making port condition and a wind down if trigger. Budgets are task counts, never hours or dollars" (6.html).
- Cost: the passage runner “answered "pending" 619 times out of 623” (8.html).
- Coming back: no debrief ritual exists; nearest are "a ledger of what it still cannot prove" (4.html) and scoring "by something that did not write this page" (2.html).
- Inference: #8's "resumed passage" may be this run; unconfirmed.

**Flight Companion.** It compiled #4, co-wrote #5 and wrote #8.
- Role: "not another worker, but a colleague … never touching the code or acting without a yes", and "writing a handover note to its own successor" (4.html).
- Rule: “describe how things are going, but never redraw what "done" or "worth it" means” (6.html).
- Still open: whether conversational control counts in itself "or only when it demonstrably reduces operator minutes" (6.html).

**Patch-on-patch and duplication.** "four tickets each patching the last until a rare 3% error became a 100% hang", and "we patched to fix issues as they came up. Now, it's time to simplify." (2.html) Cured by structure: "one shared grounding post-pass so both paths execute the same rules once" (3.html). Still happening: "LIN-2297's root-cause fix did not bound its class" (6.html). "Of 221 changes to the fleet's prompt text, 17 left it shorter." (8.html)

**Simplifying.** "Proof the machine can renounce, not merely accrete." (2.html) But John refused to flatten supervision, and #8 agreed: "The trouble was never that the layers existed. It was what they said to each other." "A lean pipeline is cheap. No one yet knows whether it is also correct." (8.html)

**Harbour fixing itself.** "A system now sophisticated enough to trip over its own feet, and to notice." (2.html) But when the research's own fixes stalled: "Seeing that the other four had stopped for a single reason took a check-in from outside them." (8.html)

**Interface design.** "The stream where the human is needed and the stream the human might merely enjoy are, at last, different surfaces." and "The watching apparatus was built for a way of working the system had outgrown by lunchtime." (4.html) The north star asks for "every contract legible in one screen", yet "elective interface work" was read as drift (6.html).
