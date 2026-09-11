---
id: archive-proposal
version: 1
status: draft
supersedes: null
title: A papers archive for Harbour
date: 2026-09-11
authors:
  - Claude
  - John Kershaw
abstract: >
  Harbour already produces a corpus of evidence-grounded reports but has no archive: no
  stable identity for a document, no citation that survives a rename, no catalogue, and
  three competing conventions for saying which edition of a document is current. This
  paper proposes that the archive begin as a contract carried by each paper (the front
  matter this paper carries), one rule (every catalogue, graph and metric is derived from
  the files at HEAD, never stored beside them), and one committed next step (a referee
  paper). Everything else is named and deferred.
concepts:
  - papers-archive
  - verified-beats-claimed
  - authority-topology
  - derived-from-head
grounded_at:
  LinearViewer: 5b9664c
  simple-dispatcher: 135991f
cites:
  - path: docs/north-star.md
    at: 5b9664c
    for: the normative claims this proposal scores itself against
  - path: docs/charter/charter.md
    at: 5b9664c
    for: the binding requirement that reports declare their blind spots
  - path: docs/the-folded-loop.md
    at: 5b9664c
    for: the authority-topology framing and the archive's law that it applies to guests
  - path: docs/drift-at-every-altitude.md
    at: 5b9664c
    for: the fix shape this proposal is an instance of
  - path: docs/escalation-philosophy.md
    at: 5b9664c
    for: human attention as the scarce resource
  - path: docs/reviews/recent-headwinds-review-2026-08-29.md
    at: 5b9664c
    for: measured failures of the instrument layer
  - path: lib/periodicals.js
    at: 5b9664c
    for: the location-agnostic template contract
  - path: lib/periodical-report-gate.js
    at: 5b9664c
    for: the code-level gate that a report must be checkable, not narrated
  - path: docs/roadmaps/README.md
    at: 5b9664c
    for: the regenerate-and-freeze supersession convention
  - issue: LIN-2254
    at: 2026-09-11
    for: the north-star reading repair, read live over the workspace proxy
  - issue: LIN-2385
    at: 2026-09-11
    for: the periodicals ledger repair, read live over the workspace proxy
  - issue: LIN-2198
    at: 2026-09-11
    for: the filed need for long-term storage of trajectory data
  - issue: LIN-2199
    at: 2026-09-11
    for: the filed spike on a training and evaluation corpus
  - issue: LIN-1967
    at: 2026-09-11
    for: the ticket that placed the report convention in CLAUDE.md
  - issue: LIN-1950
    at: 2026-09-11
    for: an unwritten document of the kind this archive would hold
referee: null
---

# A papers archive for Harbour

*A proposal. Version 1, draft, unrefereed. Read the limitations before the argument.*

## 1. Provenance and method

This paper was written by an AI author with no prior history in the repository, in
conversation with the maintainer, on 2026-09-11. Everything it claims about the corpus was
measured at `LinearViewer` `5b9664c` and `simple-dispatcher` `135991f` by the queries recorded
below, so a referee can re-run them rather than argue member by member.

Two figures stated in the conversation that produced this paper were wrong. The conversation
said the reviews directory held 46 reports of which 35 cited a prior edition. The queries say
42 and 19. The first was a miscount; the second counted a report's mention of its own path as a
citation. The corrected figures are the ones used here. This paper records the correction
because the house convention is to correct in place with provenance, and because the error is
itself evidence for section 3: a citation model that is "a path string somewhere in the prose"
cannot even be counted reliably.

The queries, all run from the `LinearViewer` root at `5b9664c`:

```sh
# reports in the corpus
ls docs/reviews/*.md | wc -l                                              # 42

# reports citing a DIFFERENT report by path
for f in docs/reviews/*.md; do b=$(basename $f);
  grep -o "docs/reviews/[a-z0-9_-]*\.md" "$f" | grep -qv "$b" && echo $b; done | wc -l   # 19

# reports no other report mentions by filename
for f in docs/reviews/*.md; do b=$(basename $f);
  grep -l "$b" docs/reviews/*.md | grep -qv "$f" || echo $b; done | wc -l               # 13

# reports carrying a grounding sha in the house form
grep -lE "@ \`[0-9a-f]{7,}\`|HEAD.*\`[0-9a-f]{7,}\`" docs/reviews/*.md | wc -l        # 30

# reports carrying an in-place correction or adversarial second read
grep -liE "correction notice|adversarial second-read|second read" docs/reviews/*.md | wc -l   # 8

# reports declaring what they could not measure
grep -liE "did not measure|cannot see|can't see|could not measure|blind spot" docs/reviews/*.md | wc -l   # 9
```

What was read in full: the two `CLAUDE.md` files, the README of each repository, the north star,
the charter, the folded-loop essay, the drift synthesis, the escalation philosophy, the
2026-08-29 headwinds review, the 2026-08-29 documentation review, the 2026-09-11 model and
effort routing proposal, the periodicals registry header, and the report gate. What was not
read: the code beyond the files named, and the remaining 40 reviews beyond their front lines
and the queries above.

The live workspace was also read, over Harbour's own proxy, on 2026-09-11: 20 read calls, no
writes, every one audit-logged. What was read there: the served north star and its reading,
the periodicals ledger, seven text searches of the tracker for a prior archive, catalogue,
citation or corpus proposal, the cost of two 29 August periodical runs, and six tickets
(LIN-2254, LIN-2385, LIN-2198, LIN-2199, LIN-1967, LIN-1950). Tracker search is text-only and
relevance-capped at 50 results, so every "no ticket proposes" claim below is bounded by those
seven queries.

## 2. The claim: the corpus exists

Harbour has spent three months building the habits of a scientific literature without building
the literature's container.

The reviews directory holds 42 reports. 30 of them state the commit they were grounded at, in a
form regular enough to grep. 19 cite an earlier report by path, and the periodical scaffold
requires a trend-aware run to read its own prior editions first (`lib/periodicals.js`, header
comment). 8 carry a correction posted in place with its provenance, or the adversarial second
read that produced it. 9 carry an explicit section on what they could not measure, which the
charter makes binding for any report the project publishes (`docs/charter/charter.md:112`, "a
report that claims no blind spots is itself a violation").

The house has also learned, the expensive way, that a report which lives only in prose is not a
report. Three periodical batches in a row reached Done with their report surviving only as a
tracker comment, and the fix was a code-level gate that refuses the transition unless a
checkable reference exists (`lib/periodical-report-gate.js:6-14`). That gate is the archive's
founding principle already enforced in code: the artifact is the fact, the narration is not
(`docs/north-star.md:7`).

The need for long-term storage is already on the tracker, in a different shape. LIN-2198
records that Harbour's event streams accumulate a high-quality corpus of agentic work that
expires on 30-day TTLs, a week of trajectory history lost for every week that passes, and
LIN-2199 proposes a spike on exporting it. Both are Backlog. They ask for the data half of
long-term memory; this paper asks for the document half. No ticket found by the seven searches
in section 1 proposes a papers archive, a citation model or a catalogue.

So the question is not whether Harbour should have a scientific archive. It has one. The
question is what it lacks.

## 3. What it lacks

Three things, each measurable at HEAD.

**Identity and citation.** A report has no identifier other than its path. A citation is a path
string in prose. A rename, a move, or a revision breaks every inbound citation silently, and no
query can distinguish "this report was never cited" from "this report was cited under a name it
no longer has". 13 of the 42 reports have no inbound mention by filename. This paper cannot say
whether that is 13 orphans or a lossy query, and that inability is the finding. Nothing can
cite "the current edition of the headwinds review" as opposed to a dated file.

**A catalogue.** There is no index. `docs/README.md`, `docs/reviews/README.md` and
`docs/reviews/index.md` do not exist at `5b9664c`. Discovery is `ls`. The periodicals engine
cannot produce an index either, by design: the registry is deliberately location-agnostic and
the report convention is discovered by the executing agent at run time
(`lib/periodical-report-gate.js:16-24`, `CLAUDE.md:243`). The convention is therefore a sentence
in `CLAUDE.md`, placed there by LIN-1967 so that agents could discover it, which is exactly the
kind of prose-only contract the gate was built because prose cannot hold.

**Supersession.** Three conventions for "which edition is current" coexist in the same docs
tree. The north star bumps its version inside one file (`docs/north-star.md:1`, "v2"). The
autopilot operating manual has a sibling file with a `-v2` suffix beside the original. The
roadmaps regenerate a fresh lineage and freeze the old one as a historical record
(`docs/roadmaps/README.md`, "Lineage"). Each is defensible. Together they mean a reader must
already know a document's history to know whether they are reading its current form, and an
agent grounding on the wrong one has no signal that it did.

## 4. The proposal

Four parts, of which only the first two are commitments. The rest are named so that later
papers can be wrong about them without this one being wrong.

### 4.1 The paper contract

A paper is any document in the archive that carries the front matter this paper carries. The
fields, typed and minimal:

| Field | Type | Rule |
|---|---|---|
| `id` | slug | Minted once, never changed. A file may move; the id does not. |
| `version` | integer | Bumped in place on revision. Git history holds every prior version; `id@N` resolves to the commit where `version` was N. |
| `status` | enum | `draft`, `refereed`, `superseded`, `retracted`. Only a referee paper moves a paper out of `draft`. |
| `supersedes` | id or null | Set on the new paper. The old paper's status becomes `superseded` in the same change. |
| `title`, `date`, `authors`, `abstract` | text | Authors are named, human and AI alike, so the charter's attribution rule holds for papers as it does for decisions. |
| `concepts` | list of slugs | What the paper defines, extends, or contradicts. The seed of a concept index, deliberately no more than that here. |
| `grounded_at` | map of repo to sha | What the paper's claims were measured against. |
| `cites` | list of records | Each a path or id, the sha it was read at, and what it was cited for. A citation is a record, not a string in prose. |
| `referee` | id or null | The referee paper that examined this one, if any. |

One file per paper, named by its id. Revision bumps `version` in the same file. A different
paper that replaces it sets `supersedes`. Prose is otherwise free. A referee note is itself a
paper, citing the paper it examined, so the archive needs no comment system.

Choosing one file per paper with in-place version bumps is a decision, not the only option. The
sibling-file convention keeps every version visible without tooling; the in-place convention
keeps one canonical path per id and makes git the version store. This paper takes the second
because the first reproduces the supersession ambiguity of section 3 inside the archive itself.

### 4.2 The one rule

Every catalogue, citation graph, popularity figure, freshness figure and search index is
derived from the files at HEAD, on demand, and is never the record. A cache is permitted. A
parallel store that agents or humans write to is not.

The reason is measured, not aesthetic. The house's own instrument layer is where its failures
concentrate. On 2026-08-29 the served north-star reading was stale and empty while the document
at HEAD was current, and the periodicals ledger reported `due` for reviews whose reports had
merged and `recent` for a dispatch that produced nothing
(`docs/reviews/recent-headwinds-review-2026-08-29.md`, H1 and H2). Both failures have the same
shape: a stored record beside the artifact, drifting from it. An archive whose metrics come from
a second record would fail the same way, and would be believed longer because it looks like a
database.

Both failures have since been repaired, and the repairs argue for the rule as much as the
failures did. LIN-2254 merged on 2026-08-30 and, read live on 2026-09-11, the served reading is
fresh at nine days old, carries v2, and now publishes a `docVersion` block that hashes the
document at HEAD and reports drift against the stamped version. LIN-2385 merged the same day,
and the ledger now registers the seven reviews that landed on 2026-08-29. The north-star fix is
a small instance of section 4.2 already in production: the artifact at HEAD became the
reference, and the stored record is checked against it rather than trusted. These are dated
reads of a live system, not sha-pinned claims; a referee re-running them will see later values.

### 4.3 What counts as a paper

Any document that keeps the contract, from any author. The periodicals are the first and most
regular author, and the report gate already makes their output checkable. Incident write-ups,
collective session records, essays, proposals like this one, and papers about existing
documents all qualify. The distinction that matters is not who wrote it or what it is about but
whether its claims cite evidence, its limits are stated, and its references are records.

A concrete example of what the archive would hold is already on the tracker as a gap. LIN-1950,
Todo, asks for an operating manual for the supervisory role, because that judgement today
"exists only inside whichever session happens to be doing the supervising" and is gone when the
session ends. That is the archive's purpose stated as a ticket: durable knowledge that outlives
the session that learned it, with its perishable parts marked as such.

### 4.4 The verbs, named and deferred

The archive wants four prompt kinds. Each, when it lands, is a template change and owes both
prompt paths and a change-log row like any other.

- `write-paper` takes a question or an existing document and produces a versioned paper.
- `revise-paper` produces version N+1 against new evidence, with a diff of claims.
- `referee` re-runs a paper's cited queries and endorses, corrects in place, or retracts.
- `survey` reads the catalogue and the graph, finds gaps, and mints a bounded set of
  `write-paper` tasks, in the periodicals' own capped shape.

Only `referee` is committed by this paper, as its own next step (section 8). The other three
are deferred until a referee has examined a paper and the contract has survived contact with
the existing corpus.

### 4.5 Where it lives

Open. Two candidates. A directory inside Harbour keeps papers beside the code they cite and
reuses the report gate unchanged. A separate repository with its own small CLI keeps the
contract and tooling legible in one screen (`docs/north-star.md:19`) and lets a dispatched
session read the archive deterministically without a proxy hop, with Harbour consuming it the
way it consumes any git-backed source. This paper is written into Harbour's docs tree as a
draft so that the location can be decided by a later paper. Its id does not change when it
moves. That is what the id is for.

## 5. Why git and not a store

Every property the archive needs to be trustworthy is one git already has. A version is a
commit. Provenance is the author line and the sha. A retraction is a commit that says so. A
paper's `grounded_at` sha is something git can check out, which is what makes "re-run the
query" possible at all. A second record beside the files would need to reproduce all of this
and would be the drifting instrument of section 4.2. The archive's first tool is therefore a
validator that refuses a dangling citation, not a database.

## 6. Risks

**The folded loop.** An archive that agents both write and read, with no referee, turns a
wrong paper into grounding for the next one. That is the authority-topology failure the
folded-loop essay describes, with extra steps (`docs/the-folded-loop.md`, "The thesis"). The
`status` field and the referee verb exist for this reason, and an agent that grounds on a
`draft` paper should say so in its own provenance. The archive's law applies to its own
papers: this one is minted on the same surfaces the swarm mints on.

**Attention.** One human reads this corpus (`docs/escalation-philosophy.md:29`). A swarm can
write papers faster than that human reads them, and a referee verb will endorse papers no
human has seen. Citation in-degree from agents is therefore a different and weaker number than
human attention, and the catalogue should keep them apart. The mechanism is deferred; the
distinction is not.

**Volume.** The `survey` verb, if unbounded, is a paper mill. It inherits the periodicals'
hard cap on minted follow-ups or it does not land.

**Instrument fragility.** Section 4.2 is the whole mitigation, and it is a rule rather than a
mechanism. A later paper should show a catalogue built under it and report what it got wrong.

## 7. What this paper does not decide

- Whether the concept index is a node type of its own or stays a tag list on papers.
- The CLI's command surface, and whether one exists before the Harbour surface does.
- The proxy read surface Harbour would expose over a catalogue.
- Whether the 42 existing reviews migrate into the contract, and if so whether by revision
  or by a paper about each.
- How id collisions are handled under parallel authors. The current position is that a merge
  conflict on the same id is the correct failure and needs no mechanism.
- How human attention is recorded so that it can be separated from agent citation.

## 8. Referee request

This paper asks to be refereed before any tooling is built on it. The referee paper should:

1. Re-run the six queries in section 1 at `5b9664c` and report whether they reproduce.
2. Convert three existing documents to the contract of section 4.1 and report what the schema
   cannot express: `docs/reviews/recent-headwinds-review-2026-08-29.md` (a trend-framed review
   with a correction and a supersession ledger), `docs/reviews/documentation-review-2026-08-29.md`
   (a review with a correction appendix and a minted follow-up), and `docs/the-folded-loop.md`
   (an essay, not a review, which tests that the contract fits a non-periodical kind).
3. Endorse, correct in place, or retract, and set this paper's `referee` field and `status`
   accordingly.

The referee run has a budget to be scored against. Read live on 2026-09-11, two 29 August
periodical runs cost the following in API-equivalent dollars over their whole lineage
(research, plan, implementation, review and close-out where present):

| Run | Ticket | Total | Sessions |
|---|---|---:|---:|
| Recent Headwinds review | LIN-2364 | $34.40 | 6 |
| Documentation review | LIN-2379 | $20.51 | 4 |

A referee paper is a smaller shape than a periodical review, so it should land inside that band.
One that costs materially more than the review it examines is itself a finding.

A proposal that names its own reviewer is harder to accept quietly than one that does not.

## 9. Limitations

The schema in section 4.1 is untested against the corpus it proposes to hold. The six counts
depend on their queries as written, and a review that cites another by title rather than by
path is invisible to them. The corpus figures were measured by an author with no history in the
repository, in one sitting, reading a minority of the files it counted. The authors have a
stake: the paper proposes its own genre and its own next step, and a referee should weigh that.
No outside user, no cost figure, and no defect-escape record exists to score this proposal
against, so its argument rests on the house's own documents, which the house wrote. The
live-workspace observations in sections 2, 4.2 and 8 are dated reads of a moving system, not
sha-pinned claims, and the tracker search behind "no prior proposal exists" is text-only and
capped at 50 results per query, so a proposal filed under other words would be invisible to it.
Score it against something not written here.

## References

- `docs/north-star.md` at `5b9664c`. Lines 7, 11, 19.
- `docs/charter/charter.md` at `5b9664c`. Section 3, line 112.
- `docs/the-folded-loop.md` at `5b9664c`.
- `docs/drift-at-every-altitude.md` at `5b9664c`. "The recurring fix shape".
- `docs/escalation-philosophy.md` at `5b9664c`. Line 29.
- `docs/reviews/recent-headwinds-review-2026-08-29.md` at `5b9664c`. H1, H2.
- `docs/reviews/documentation-review-2026-08-29.md` at `5b9664c`. H1 and its correction.
- `docs/roadmaps/README.md` at `5b9664c`. "Lineage: cheap models, reliably".
- `lib/periodicals.js` at `5b9664c`. Header comment.
- `lib/periodical-report-gate.js` at `5b9664c`. Lines 6 to 14 and 16 to 24.
- `CLAUDE.md` at `5b9664c`. Line 243.
- LIN-2254, LIN-2385, LIN-2198, LIN-2199, LIN-1967, LIN-1950. Read over the workspace proxy
  on 2026-09-11.
- `GET /api/proxy/north-star`, `GET /api/proxy/periodicals`, `GET /api/proxy/search`,
  `GET /api/proxy/issues/{id}/cost`. Read on 2026-09-11.
