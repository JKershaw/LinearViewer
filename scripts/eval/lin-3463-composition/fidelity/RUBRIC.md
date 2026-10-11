# Brief fidelity rubric (LIN-3463), written before coding

Each pair is a ticket's source as a dispatched agent fetched it (`Fnn-source.json`: title, state, parent,
children, description, comments) and the brief the same agent fetched in the same session
(`Fnn-brief.md`, written by `lib/brief.js` from that source). The question: **what does an agent that
reads the brief first receive, compared with what the ticket says?** Code only from the two files.
Do not look up the ticket elsewhere.

## Step 1. List the source's load-bearing units

A unit is something that, if an agent missed or changed it, would change what the agent does. Give
each a short id (S1, S2, ...), a type, and a quote of at most 25 words.

| type | what it is |
|---|---|
| WHAT | a decision about the outcome or behaviour: what must be true when done, a settled behaviour choice, the problem to solve |
| DONE | an acceptance criterion or done-when line |
| HOW | a prescription of the means: a named fix, approach, file or function to change, ordered steps, an embedded plan |
| OPEN | something the source explicitly leaves open, undecided, or for the agent to judge |
| BOUND | a scope limit, permission or exclusion (e.g. "no code changes", "take the time it needs", "out of scope: X") |
| WHY | the motivation or evidence that explains the task, where it would change a judgement |

Keep to the units that matter; a long plan may be one HOW unit per step that matters. Cap about 25 units.

## Step 2. Code each unit's fate in the brief

- `kept`: present with the same meaning (paraphrase is fine)
- `strengthened`: present but firmer (a hypothesis, suggestion or option becomes a rule, a must, or a fact)
- `weakened`: present but softer or hedged (a must becomes optional; a decision becomes a question)
- `narrowed` / `broadened`: present but its scope changed
- `dropped`: absent

## Step 3. List the brief's additions

Each claim in the brief (Current, Constraints, Open questions, Changelog) that has no support in the
source. Give id (B1, ...), a quote of at most 25 words, and a type:

| type | what it is |
|---|---|
| add-how | prescribes a means the source does not |
| add-rule | a new constraint or rule |
| add-scope | widens or narrows the task |
| add-fact | a factual claim about the code or state not in the source |
| closes-open | states as decided something the source left open |
| opens-decided | presents as open something the source decided |
| invents-done | asserts something is done, or not, contrary to the source |

Do not list a faithful paraphrase or a fair inference that a careful reader of the source would also make.

## Step 4. Verdict

- `faithful`: an agent following the brief would do the same work as one following the source
- `minor`: differences that would not change the work
- `material`: an agent following the brief would plausibly do different work (scope, behaviour, means, or
  what it treats as settled), or would miss something that changes the work

Name the single most consequential difference in one sentence (or "none").

## Output

One JSON object per pair, in a JSON array:

```json
{"pair": "F01", "units": [{"id": "S1", "type": "WHAT", "quote": "...", "fate": "kept", "note": ""}],
 "additions": [{"id": "B1", "type": "add-rule", "quote": "...", "note": ""}],
 "verdict": "minor", "most_consequential": "...",
 "source_prescribes_how": "none|light|heavy", "coder_confidence": "high|medium|low"}
```

`source_prescribes_how`: none = no means named; light = names files or a likely fix but leaves the
approach open; heavy = an embedded plan, ordered steps, or a fix stated as decided.
