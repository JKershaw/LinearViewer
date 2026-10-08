---
title: Does "Every Fix Is Paid Where It Is Written" hold up?
kind: check
version: 2
date: 2026-09-30
authors: [Claude (version 1, the essay's own session, LIN-3144), Claude (version 2, independent, LIN-3146)]
model: "Version 1: frontier tier, Claude Code CLI; the session that wrote the essay (dispatch afe16c11, LIN-3144), so a self-check. Version 2, this document: frontier tier, Claude Code CLI; effort not recorded in the dispatch item. One bounded session (dispatch 65867df7, kind custom, LIN-3146), no plan, review or close-out legs, by the brief's design. Two in-session sub-agents read the outside sources; this session spot-checked the quotations it relies on. Not the essay's author, and not the steady-base paper's or its check's."
revision: "Version 2 replaces version 1 entirely. Version 1 was the author's self-check of the essay's version 1 and found every figure matched its source. Version 2 is independent and checks the figures, the argument and the sources. Its corrections of figures and readings are carried into the essay's version 2; its findings on the argument are for John and are here only."
grounded_at: 6574f602 (LinearViewer, origin/main)
cites:
  - "docs/papers/harbour/paid-where-written.md@4e566c2a (version 1, LIN-3144, PR #1626)"
  - "docs/papers/harbour/steady-base.md@6574f602 (version 2) and steady-base-check.md@6574f602 (LIN-3145)"
  - "scripts/steady-base-render.mjs and scripts/steady-base-rules-recompute.mjs, re-run at 6574f602"
  - "docs/papers/harbour/review-loops.md@6574f602:13-40,65-68"
  - "docs/papers/harbour/review-consumption.md@6574f602:13-25"
  - "docs/papers/harbour/what-the-reviews-checked.md@6574f602:13-25"
  - "docs/papers/harbour/fleet-complexity-read.md@6574f602:38,128-200,215-232,291-298"
  - "docs/papers/harbour/efficiency-levers.md@6574f602:48-49"
  - "docs/reviews/lane-run-review-2026-08-23.md@6574f602:558-561; a954dc0c (LIN-2274, 2026-08-24)"
  - "tests/unit/claude-md-line-budget.test.js@6574f602:28-53"
  - 'docs/architecture/prompt-system.md@6574f602:10, "no longer re-types these rules as prose and they cannot drift"'
  - "35dc0e14 (LIN-1270 commit message)"
  - "LIN-3143 closing comment (2026-09-29), LIN-3144 description, LIN-3146 description, read over the workspace proxy 2026-09-30"
  - "gh pr view 1625, 1626, 1627 (no reviews recorded)"
  - "Cunningham, OOPSLA '92, https://c2.com/doc/oopsla92.html; Cunningham, WardExplainsDebtMetaphor, https://c2.com/wiki/remodel/pages/WardExplainsDebtMetaphor"
  - "NAO, The Business Impact Target, HC 236, full report PDF, https://www.nao.org.uk/wp-content/uploads/2016/06/The-Business-Impact-Target-cutting-the-cost-of-regulation.pdf"
  - "Texas Sunset Advisory Commission, https://www.sunset.texas.gov/, /how-sunset-works, /how-sunset-works/impact-sunset-reviews, /about-us/frequently-asked-questions"
  - "(all outside sources read 2026-09-30; the missing-source entries below carry their own URLs)"
---

# Does "Every Fix Is Paid Where It Is Written" hold up?

Its centre holds. Its edges do not hold as written. The claim that Harbour's rules cost mainly
through the behaviour they require, not through their tokens, survives every re-read. Most of
the Harbour figures match their sources. Eight came from paper figures that the steady-base
check has since corrected. The biggest of those: the cheap-tier model writes five to seven
worker prompts in ten, not nine, and GitHub has enforced green CI before merge since June. The
three outside sources are read more strongly than they allow. The NAO found that a budget did
not see large costs, not that cost moved to escape it. Cunningham's debt is useful when repaid.
Texas sunset mostly continues what it reviews. The argument has three weaker joints than the
essay admits:
- **The asymmetry.** Harbour's own record shows code paid on every run too, and more than half
  the rules carry judgement no check can make.
- **Chesterton's fence.** The essay mentions it but does not answer it.
- **The retirement test.** It counts firing, and by the essay's own accounting firing can only
  retire the rules that cost least.

The essay's version 2 carries the corrections of figures and readings. The argument findings are
here, for John.

## Findings

### The figures

**Most figures hold, re-run or re-read at their source.**
- **Re-run at `6574f602`.** The meta-prompt, 103,568 bytes (about 26,000 tokens); the review
  and close-out renders; the inventory counts (213 census rules, 8 runtime, 131 pinned, 55
  convert, 111 keep, 2 risk-specific); `CLAUDE.md` at 153,845 before the split and 9,806 now;
  `docs/architecture/` from 147,422 to 168,768.
- **Re-read in the Harbour paper that measured them.** Loops at 30% plus 9% of priced cost, and
  11 of 94 plans approved first time. 48% of review sentences consumed, the ledger 97%, method
  narration 25%. LIN-3131's 43% of wall-clock and about 26% of tokens. LIN-3133's 41 queue items,
  an hour, and 10 to 20 minutes by hand. About seven credential bugs on LIN-3124 PR3. "27 of 27
  green". Seven genuine misses in thirteen.
- **Re-read at the paper's version 2 and its check.** 221 commits with 17 shrinking; 5 of 101
  citations left; #462's 19%, 38,643 and 72,812; 493 and 279 pins; the comment shares; 688 plan
  labels; 2.94 test lines per production line; 89 tickets with medians of 10 comments and 6,063
  words; 96 cited tickets with 42 runtime.
- **Quotations.** The budget test's message, LIN-435's sentence and LIN-1270's commit message
  match their sources word for word. John's framing is a fair paraphrase of the LIN-3144
  description ("about 2 hours of full concentration"; "thorough, consistent and runs
  constantly").

**Eleven figures change. Each is corrected in the essay's version 2.**

| Essay, version 1 | Corrected | Source |
|---|---|---|
| Close-out lineage added 71 KB | **44 KB**; a ninth ticket changed only string literals | steady-base v2; the provenance script had counted each merged branch twice |
| A cheap-tier model wrote 102 of 112 sampled prompts | **61** outright; the orchestrator wrote **40**, at least 18 of them wrapping a cheap-model brief; the guide shapes **five to seven in ten** | steady-base v2, from the dispatch rows |
| Halving the rule text saves "at most about 1%" | **at most about 1.5%**; rule-bearing text is 2.8% pooled once the proxy's instructions and `CLAUDE.md` reads are counted | steady-base v2 |
| Nothing at the gates is enforced by code; merge rules "written only as prose" | GitHub's ruleset has refused merges to `main` without green CI **since 10 June**. The proxy refuses Done on periodical tasks that lack evidence. Only the Approve and the ledger are prose-only | steady-base v2; ruleset 17491666 |
| 175 of 213 rules said more than once | Records support **132**; a blind recode found restatement for 40 of 45, so **about four in five** | steady-base v2 and check |
| "The one large deliberate cut", regrown in a week | **Two large cuts.** LIN-1850 halved the passage-planner prompt, and eight weeks later it is still **22%** below | steady-base v2 |
| The paper and its inventory "never independently checked" | Checked once. Enforcement labels agreed for **42 of 45** sampled rules, classes for **25 of 45** | steady-base-check |
| The 21 KB grown next door, offered as the budget moving cost | About **7.6 KB** of it came in changes that also edited `CLAUDE.md`. Much of the rest is one-line index entries | steady-base-check |
| NAO: "£0.9 billion saved inside it", "in that Parliament" | Both figures are **net**. £0.9 billion is a net reduction **claimed**; the period is May 2015 to **May 2016**, the Parliament's first year | NAO, key facts p.4, paragraphs 2.6 and 3.13 |
| Texas: "a state agency", 42 abolished, 54 consolidated | "Agencies **and programs**", an agency **under Sunset review**, across **603 reviews**. The FAQ says 53 consolidated, and the home page still says 591 reviews | sunset.texas.gov impact page and FAQ |
| Cunningham: "shipping code that is not quite right is like borrowing" | "Shipping **first time** code is like going into debt", repaid "promptly with a rewrite" | c2.com/doc/oopsla92.html |

**Seven readings went past their source, and are narrowed in the essay's version 2.**

1. *Loops.* "One more item in a list" reads trivial. The source says each send-back named a
   member missing from the plan's own enumeration. Its limits also say a gate that finds a real
   missing member each time "may be the cheapest part of the pipeline". The essay gave that
   caveat only in its reading list. It is now in the body.
2. *Rounds that change nothing.* LIN-3131's second extra round was sent back because a planted
   mutation survived: an authority check had no test. That is the mutation check the essay
   protects in section 6, working as intended.
3. *The cheaper fixes.* `what-the-reviews-checked.md` lists four cheaper fixes. The fourth, "one
   reader for the close-out", was dropped, and it is itself a review of another kind.
4. *The mutation check.* "The review's own mutation check" exposed "27 of 27 green". The lane
   review shows reviewers ran it "unprompted". LIN-2274 wrote it into the template afterwards,
   on 24 August. The catch came from judgement, and the rule followed it.
5. *LIN-1270.* It was not "a layer meant to keep grounding fresh". It was code that *skipped*
   re-grounding when grounding was already fresh, a cost saving. The one precedent for evidence-
   based retirement retired code, not a prose rule, and its firing was logged by construction.
6. *The NAO mechanism.* "A budget moves cost to whatever it does not count" is the essay's
   inference, not the NAO's finding. See the sources below.
7. *Section 7's merge.* The paper and the essay were not merged on "green CI alone" with
   "nothing in the system" noticing. GitHub required the green CI. What nothing noticed was the
   missing Approve. GitHub records no review on PR #1625 or #1626.

### The argument

**The asymmetry holds for tokens and for mechanical gates, and breaks in three places.**
"Paid once in code, paid every run in prose" is true of the thing the essay measures most
carefully: the direct token cost of rule text, and gates a parser can decide. It fails in three
places, each on Harbour's own record.

- **Code is also paid on every run.** In the paper's carry table, file reads are 17.9% of
  what a working session carries, against 1.6% for the whole dispatched prompt. An agent that
  changes code reads it, so code is paid by every agent that reads it, like prose. A code check
  also comes with upkeep. The 493 text-match assertions are code whose job is to hold prose in
  place. Each new production line arrives with nearly three test lines. And the LIN-1270 layer
  was code that never fired. It was threaded through four prompt surfaces, carried its own unit,
  end-to-end and doc coverage, and had to be retired on evidence, exactly as the essay proposes
  for prose. The essay concedes "code is not free", but its title and first paragraph say
  "paid once".
- **More than half the rules are judgement.** The paper classes 111 of 213 census rules "keep
  as prose: judgement no check can make", and 55 as convertible. The blind recode matched the
  classes only 25 times in 45. "Fix it in code first" can reach a quarter of the rules at most.
  For the rest, the choice is prose or nothing, and the essay never weighs that choice.
- **Prose demonstrably moves agents.** `efficiency-levers.md` reports an A/B in which one
  directive moved a breadth check from 0% to 43% on a cheap-tier model and from 19% to 69% on
  a frontier-tier one. That is prose paid every run and buying measured behaviour. "A prose
  rule only runs when an agent remembers it" understates what the record shows.

The asymmetry is strongest exactly where the essay applies it hardest: the merge and Done gate.
That gate is copied into six places and checkable at one door, and the proxy already refuses
Done on periodical tasks.

**The essay's cost accounting undercuts its own retirement test.** Section 3 argues the bill is
behaviour, not tokens. A rule that never fires causes no behaviour. So demoting rules that have
not fired in a hundred tickets saves only their tokens, which section 3 bounds at about 1.5% of
a worker's input. The rules that cost fire on nearly every ticket. In the paper's 89 Done
tickets:
- the inside/outside mark appears in 84;
- the ledger in 78;
- the mutation check in 75;
- the class check in 66.

A firing threshold never reaches them. The paper's step 3 has a second arm the essay leaves
out: "a rule that fires but never changes code goes to John as a keep-or-retire ruling". That
arm is where the cost is. It needs a measure of what a firing changed, which Harbour does not
yet have. The essay also demotes idle rules "into reference". Its own budget paragraph says
another document the agent is told to read does not count as removal.

**Chesterton's fence is mentioned, not answered.** The essay reaches it three times.
- Section 4 treats the risk of removal as an incentive the remover faces: "takes on the risk
  that the old incident comes back and gets almost nothing they can point to". That frames
  caution as a bias to overcome, not a judgement that may be right.
- Section 6 softens removal to demotion.
- Section 7 offers a test that would show harm after the fact.

None of these says how to tell an idle rule from one whose obedience is why the incident no
longer happens. Harbour's setting makes the fence stronger than usual:
- **Silent obedience leaves no signature.** The firing record counts signature phrases in
  comments. A rule obeyed without comment reads as "never fired". So would a rule whose incident
  class no longer arises because the rule is obeyed.
- **The rule is the fleet's only memory.** Section 1 says agents "read their instructions
  afresh on every run". A human team keeps a lesson after the written rule goes. A fleet does
  not. Section 5 credits the fleet with not forgetting "last month's incident", and the rules
  are what does that remembering.
- **The precedent does not test the fence.** LIN-1270 was a cost saving in code whose firing was
  logged by design. No incident depended on it.
- **The falsification test is slow.** It watches bugs found after merge, and
  `what-the-reviews-checked.md` found seven genuine misses. At that base rate, a returning rare
  incident would take months to show against noise.

This is a finding about the argument, not a proposal. The essay needs either an answer or a
narrower claim.

**The essay knows firing is not catching, then leans on it twice.** Section 7 says it plainly:
"a signature in a comment is not a bug prevented". But the argument sentence promises rules
"that must keep proving they catch something". Section 6 then operationalises that as a firing
count, and says a code check's "record of its firing is evidence that it earns its place". The
catches on record are a handful, each from a different paper, with no rate:
- seven credential bugs on one ticket;
- one vacuous suite;
- plan-review pass 4's double copy;
- two prevented regressions.

Firing counts use. Nothing in the essay or the paper counts catches.

**The loop and round costs are not all waste, and the essay has no way to split them.** The
send-backs found real omissions. One of the "rounds that change nothing" was the protected
mutation check finding an untested authority seam. The essay's two lists overlap: the costs it
would cut (section 3) and the rigour it would keep (section 6). Only the proposed firing and
catch record could separate them, and it does not exist yet.

**The ratchet is right in direction and slightly strong in wording.**
- **What bears it out.** The gates grow steadily, and removal is rare.
- **What pushes back.** Growth does not accelerate. The research template has barely moved since
  June, and the orchestrator's kickoff is slowing: 16.7 KB in July, about 6 KB a month since.
  LIN-1850's cut held, and so has the `CLAUDE.md` cap.
- **Verdict.** "Nothing in the system brings them back down" holds for the gates, not
  everywhere.

**The largest cost line is outside the essay's map.** The fleet read puts the orchestrator at
36–59% of every ticket's weighted tokens, driven by its growing context. That is neither rule
tokens nor gate loops. The essay does not claim otherwise. A reader could still take "the bill
is behaviour" as an account of the fleet's main cost, and it is not.

### The sources

**Cunningham supports the frame and cuts against the extension.** The OOPSLA '92 passage:

> Shipping first time code is like going into debt. A little debt speeds development so long
> as it is paid back promptly with a rewrite. … The danger occurs when the debt is not repaid.
> Every minute spent on not-quite-right code counts as interest on that debt.

For Cunningham the loan is deliberate and useful. In his 2009 explanation it is not about
writing code poorly: "I'm never in favor of writing code poorly". The essay borrows only the
unpaid case. That is legitimate, but it should say so, and version 2 does. The essay's best
line from Cunningham is one it does not use. It comes from the same 2009 explanation: a program
developed "by only adding features and never reorganizing it" ends where "the interest is
total -- you'll make zero progress". That is closer to the ratchet than the 1992 passage.

**The NAO found exclusion, not displacement.** The full report says both headline figures are
net and cover the Parliament's first year: "a net reduction in costs to business of £0.9
billion" inside scope, and decisions outside it "expected to increase the net cost to business
by £8.3 billion" (paragraph 2.6). The largest exclusions were ministers' decisions made for
reasons of their own. The National Living Wage (£4.1 billion) was excluded because it "was
offset by reductions in corporation tax and National Insurance" (paragraph 2.7). The Better
Regulation Executive's reason for leaving out EU-origin rules is that departments have no
discretion over them (paragraph 2.8). The NAO warns
the scope is "open to manipulation" (paragraph 16), a risk, not a finding. Nothing in it shows
cost moving out of scope to escape the count. It does support two nearby claims the essay could
make instead:
- **A budget stops seeing what it does not count.** The government "does not know how much cost
  businesses incur as a result of its existing regulations" (paragraph 6).
- **A budget draws effort into its own accounting.** One department said "80% of the resource
  dedicated to delivering against our budget and the Business Impact Target goes directly on
  managing better regulation accounting" (paragraph 3.21).

The second is closer to Harbour's pins than the essay's displacement reading. Version 2 of the
essay now says what the NAO shows, and labels the mechanism as the essay's.

**Texas borrows a default with a low abolition rate.** The quotation and 1977 hold. Texas was
the second state, after Colorado in 1976. The commission counts 42 agencies and programs
abolished and 54 consolidated, across 603 reviews. That is about 16%, and the 603 include repeat
reviews of the same agencies. By the commission's own account, a review usually ends with the
agency continuing "with improvements". The essay says it borrows the default, not the outcomes.
The base rate matters anyway. A sunset default in Texas mostly produces reformed survivors, not
removals. A firing record in Harbour might do the same, and that would not by itself show the
base was steady.

**Missing sources: two would most strengthen the essay, two would most challenge it.** Each
was read at a primary text, and the URLs are below. The essay cites none of them.

- **Strengthen: Tainter on the cost of complexity.** Tainter, "Social complexity and
  sustainability", *Ecological Complexity* 3 (2006), DOI 10.1016/j.ecocom.2005.07.004. Read in
  full from the USDA Forest Service copy
  (https://research.fs.usda.gov/download/treesearch/61158.pdf). It states the essay's mechanism
  in almost its words: complexity "grows perniciously, by small steps, each necessary, each a
  reasonable solution". It also states the budget remedy: "costs and benefits must be connected
  so explicitly that the tendency for complexity to grow can be constrained by its costs". It is
  about societies and institutions, so it is a mechanism, not an estimate.
- **Strengthen: the flight-deck checklist.** Degani and Wiener, *Human Factors of Flight-Deck
  Checklists: The Normal Checklist*, NASA CR-177549 (1990). Read in full at NTRS
  (https://ntrs.nasa.gov/citations/19910017830). It is the closest outside match to Harbour's
  close-out lineage. Items added to show "that a specific problem is settled" turn the checklist
  into a "dumping site", and "the importance attached to the procedure by the pilots is reduced".
  A long list carries the risk that pilots "conduct it poorly because of its length". The same
  report insists on keeping the critical "killer" items. That is the essay's deep-where-it-
  matters point, from a field with decades of incident data.
- **Challenge: Rasmussen on defence in depth.** Rasmussen, "Risk management in a dynamic
  society: a modelling problem", *Safety Science* 27 (1997), DOI
  10.1016/S0925-7535(97)00052-0. Read in full from DTU's repository
  (https://backend.orbit.dtu.dk/ws/files/158016663/SAFESCI.pdf). This is Chesterton's fence as a
  mechanism. With redundant defences, "a local violation of one of the defences has no immediate,
  visible effect", so "the defences are likely to degenerate systematically through time, when
  pressure toward cost-effectiveness is dominating". A steady base that removes rules which show
  no effect, under a cost argument, is the migration he describes. The essay needs an answer to
  him more than to Chesterton.
- **Challenge: Safety-II on measuring prevention.** Hollnagel, Leonhardt, Licu and Shorrock,
  *From Safety-I to Safety-II: A White Paper*, EUROCONTROL (2013). Read in full
  (https://skybrary.aero/sites/default/files/bookshelf/2437.pdf). "A perfect level of safety means
  that there are no adverse outcomes, hence nothing to measure." A rule that prevents perfectly
  leaves a firing record of zero. That is the essay's firing measure failing by construction.

Four more bear on the argument. Three of them were read only in part, and none is relied on
above.
- **Lehman's second law cuts both ways.** Lehman, "Programs, life cycles, and laws of software
  evolution", *Proc. IEEE* 68(9), 1980, DOI 10.1109/PROC.1980.11805, read in full from a scanned
  copy (https://users.ece.utexas.edu/~perry/education/SE-Intro/lehman.pdf). A program's
  complexity "increases unless work is done to maintain or reduce it". That supports the ratchet.
  It says it of code, which undercuts "paid once".
- **Chesterton himself allows removal.** *The Thing* (1929), "The Drift from Domesticity", read
  at https://catholiclibrary.org/library/view?docId=/Contemporary-EN/XCT.165.html&chunk.id=00000011.
  The reformer may clear the fence once he can "tell me that you do see the use of it". His test
  is whether a rule's purpose is still served. A firing count does not ask that. The paper's
  provenance tag, which records the ticket behind each rule, is the part of its design closest to
  asking it.
- **Surgical checklists: abstracts only.** Haynes and others, *NEJM* 360 (2009), DOI
  10.1056/NEJMsa0810119: after a 19-item checklist was introduced, deaths fell from 1.5% to
  0.8%. Urbach and others, *NEJM* 370 (2014), DOI 10.1056/NEJMsa1308261: the same checklist,
  mandated across Ontario, showed no significant change. Together they suggest that written
  procedure pays when it is short and owned, not when it is imposed, which fits both sides.
- **Two sources seen only at secondary hand.** Vaughan's *The Challenger Launch Decision*
  (1996) was read only as the publisher's page. On normalisation of deviance, a rule routinely
  waived, as the review gate is by briefs like the one behind this check, may be worse than no
  rule. Schulz, "Limits to bureaucratic growth", *ASQ* 43(4) (1998), DOI 10.2307/2393618, was
  read only as an index abstract. It says rule births slow as rules accumulate, which would
  temper an unbounded ratchet. Both need reading at source before anyone cites them.

## Method

**Figures.** Every sentence in the essay's version 1 that carries a number, a quotation or an
attribution was listed and read against the passage it cites, at `6574f602`. The steady-base
check came first, and every figure it corrects was traced into the essay. The cheap measures
were re-run independently at `6574f602`, and matched to the byte:

```sh
NODE_ENV=test node scripts/steady-base-render.mjs     # fixed rendered sizes, incl. the meta-prompt
node scripts/steady-base-rules-recompute.mjs          # inventory tables from steady-base-rules.json
git cat-file -s d4f749c1^1:CLAUDE.md; wc -c CLAUDE.md
git ls-tree -r -l d4f749c1 docs/architecture | awk '{s+=$4} END {print s}'   # and at 8f5fe4aa
git show -s 35dc0e14; git show -s a954dc0c
gh pr view 1625 --json reviews; gh pr view 1626 --json reviews
```

The tracker figures (LIN-3143's closing comment and the LIN-3144 description) were read over the
workspace proxy.

**Outside sources.** An in-session sub-agent fetched each primary text with `curl` and
extracted it without a summariser: the OOPSLA '92 page, the c2 wiki page, the NAO's 50-page
report and summary PDFs, and four Texas pages plus the commission's 2025 PDF. This session then
re-fetched the NAO report and re-extracted summary paragraph 8, paragraphs 2.6 and 6, and the
"open to manipulation" and "many times greater" sentences. It also re-fetched the Texas home
page and the Cunningham passage. All matched. A second sub-agent read the candidate missing
sources at their primary texts or publisher pages, with the URL it read for each. It says where
it saw only an abstract. This session re-fetched the Tainter, Rasmussen, Lehman, Safety-II and
Degani and Wiener texts, and found each quotation above in them.

**Argument.** Each of the brief's three questions was answered from the essay's own sources, so
that a finding rests on something the essay already cites. Where it leans on a source the essay
does not cite, that source is named.

## Limits

- **One reader, of the same tier and family as the author.** Being a different session makes
  this check independent. It does not remove the blind spots the two sessions share. A human
  reader, or a different model family, might weigh the argument differently.
- **Corrections inherited from the paper's check.** The eight corrected Harbour figures come from
  `steady-base-check.md`, which re-ran the paper's scripts. This check re-ran only the render,
  the inventory and the `CLAUDE.md` split. The paper's check has not been checked by a third
  reader.
- **The argument findings are judgements.** They are written for John to weigh, not as
  measurements. Two of them rest on the paper's classes and signature counts, which carry
  that paper's own limits: one reader's classes, and signatures that show use, not catches.
- **Outside sources read once.** Texas's own pages disagree with each other: 53 or 54
  consolidated, 591 or 603 reviews. This check uses the impact page and the 2025 report, and
  notes the home page.
- **A proxy outage** mid-session delayed the tracker reads. It did not change them.
- **Merged the same way as the essay.** This check, like the paper, the paper's check and the
  essay, was written in one session with no review leg. It merges on green CI with no recorded
  Approve, the situation the essay's section 7 describes. The brief asked for it.

## Next

One line goes to `proposals.md` with this check. **When Harbour removed a rule, did the incident
it was written for come back?** The paper lists eight removals, three deliberate cuts and one
retirement on firing evidence. For each, find the ticket that introduced the removed text and
the incident class it named. Then search the tracker for that class in the eight weeks either
side of the removal. That tests Chesterton's fence on Harbour's own record, and the essay's
section 4 and section 6 claims depend on it.
