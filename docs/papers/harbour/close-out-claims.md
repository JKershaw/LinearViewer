---
title: When a close-out files its own unfinished scope next door, does it say so?
version: 1
date: 2026-09-12
authors: [Claude]
model: claude-opus-5, claude-code; the dispatch lineage for LIN-2824 (kind `research`) stamps no model or effort
grounded_at: 43c3ca30 (LinearViewer)
cites: [docs/papers/harbour/never-worked-pile.md@43c3ca30, LIN-1425 (2026-07-23), LIN-1596 (2026-07-26), LIN-1699 (2026-07-30), LIN-1829 (2026-08-03), LIN-1904 (2026-08-07), LIN-1984 (2026-08-09), LIN-2081 (2026-08-14), LIN-2241 (2026-09-10), LIN-2452 (2026-09-02), LIN-2716 (2026-09-11), LIN-2720 (2026-09-11), LIN-2754 (2026-09-11)]
---

# When a close-out files its own unfinished scope next door, does it say so?

It says so every time, and it changes nothing. All 23 parents are Done at HEAD while the
filing sits unworked, and not one close-out went quiet about it: the filing is named in the
same comment that declares the ticket finished. What differs is what the naming means. Five
close-outs name the filing as the parent's own scope, left undone — one of them refused to
set Done over it. The other eighteen name it as a separate matter now owned elsewhere. The
operative verb across both groups is *routed*: the review ledger carries an item, the
close-out files a ticket for it, and filing it is what discharges the item. Naming the
filing is not an admission that the ticket is unfinished. It is the mechanism by which the
ticket is finished.

## Findings

**No close-out claimed done outright.** All 23 name the thing they filed — 22 by ticket
identifier in the close-out comment itself, the last (LIN-2241 → LIN-2760) by naming the
matter as "an open product decision for John, not a defect" and leaving it unticketed for a
day. The previous paper's worry, that the writer does not see the filing at all, is not what
happens. The writer sees it, writes it up, links it, and closes.

**Eighteen name it as a separate matter, and seven of those give no reason.** The eleven that
argue the separation argue it well: "pre-existing (present at `3e52a623`), untouched by this
change" (LIN-1984), "recorded explicitly as out of scope" (LIN-1666), "it was scoped out
deliberately and stays that way" (LIN-2444), "Not fixed inline: LIN-2434's contract demanded
byte-for-byte parity ... the pair must move together" (LIN-2434), and a follow-up table whose
column header is literally *Why it is separate* (LIN-1577). The other seven say only
`Routed → LIN-nnnn` in a ledger row — LIN-1984's F11, LIN-2254's F4, LIN-2735's F4/F5,
LIN-2720's rows 11 and 12, LIN-2716's rows 1–4, LIN-2754's L8. In those the ledger's own
heading does the arguing: *ledger discharged*.

**Five say "done except for what I just filed", and they say it precisely.** LIN-1699's
close-out merged item 2 of its own three proposed items and filed LIN-1729 as carrying
"forward **items 1 and 3 of this ticket**". LIN-1829 recorded that "plan step 5d's
`DOCUMENTED_KEYS` drift guard ... did **not** ship" and routed it to LIN-1833. LIN-1425
closed with a live constraint on what it had just shipped: "**The flag must not be enabled
for opencode workspaces until LIN-1536 lands**". LIN-1596 routed its visual baseline to
LIN-1614 as "Confirmed still outstanding". These are close-outs that know the ticket is not
all the way done and close it anyway, with the residue written down.

**The exception proves what the rule costs.** LIN-2452's close-out did not set Done: it
posted `CLOSE-OUT: Done-withheld — #202 ledger item 5 ... names filed follow-up tickets as
its discharge; five drafts are ready but this leg is forbidden to file them.` Five minutes
later a runner ruling filed all five, LIN-2462 among them. The ticket is Done today and
LIN-2462 has never been worked. The gate held exactly until the ticket existed.

**Cross-tabulated, the claim does not move the state.**

| Close-out claim | Parent Done at HEAD | Parent not Done |
|---|---|---|
| Done, filing named as deferred scope | 5 | 0 |
| Done, filing named as a separate matter | 18 | 0 |
| Done outright, filing unnamed | 0 | 0 |

Twenty-three of 23 parents are Done while the filing is unworked (20 Backlog, 3 Todo).
Whether the close-out called the filing its own scope or someone else's made no difference to
whether the ticket closed.

**The close-out is the filer, and it files minutes before it closes.** Twenty of the 23 were
created in the window between the close-out session starting its pass and posting its comment
— a median of five minutes before, the longest seventeen. One (LIN-1962) was filed a day
earlier by a plan-review revision pass and only listed at close-out; two (LIN-2462, LIN-2760)
by later passes, a runner ruling and a rulings-triage session. No filing in the sample came
from a review that then watched the parent close without it.

**Five were in the parent's own plan or acceptance list; five more were written into it as
exclusions.** LIN-1699's items 1 and 3, LIN-1829's plan step 5d, LIN-1425's opencode half,
LIN-2241's own cost rule and LIN-2716's two acceptance tests were all in the scope statement
and all were filed instead of finished. Five others were named in the parent's scope
statement precisely to keep them out — LIN-1904's "Exclusion 2", LIN-1596's "Out of scope —
split out", LIN-1666's plan-revision "recorded explicitly as out of scope", LIN-2444's
deliberate scope-out. The remaining eight appear nowhere in the parent's plan: they were
found by a review of the parent's own diff, after the scope statement was written.

**Read from the parent's side, three of the 23 scope calls change, and all three move the
same way.** LIN-1911 is exclusion 2 of an approved plan whose close-out ledger required only
that the excluded classes be filed; LIN-2108's parent argues its "four stated rules are met
as specified" and the review's own disposition was "fold into the next touch of this file";
LIN-2760's close-out calls the behaviour "not a defect". Under the fixed question — does this
change what "done" meant for the parent — the parent-side reading says no to those three and
leaves 20 standing. The re-check ran in one direction only, so 23 is a ceiling, not an
estimate.

## Method

Population: the previous paper's 499-filing never-worked close-out/review pile, rebuilt from
its Method — all 2,767 workspace issues paged whole, window LIN-1325..LIN-2808, never worked
= state type `backlog` or `unstarted`, generated = parent link else the first `LIN-nnnn` in
the opening 400 characters, generating event read from the opening characters against an
ordered rule set (close-out → breakdown → review → parent-only). That paper does not publish
the rule set verbatim; the variant used here is the one that reproduces its pile size exactly
(499) and recovers 8 of the 15 sample tickets it names by identifier. The sample is
`random.Random(2821).sample(pile, 40)` over the pile in identifier order, as before.

Each of the 40 filings was read in full and classed against the previous paper's fixed
question — does this change what "done" meant for the parent — giving 23 yes and 17 no, the
same split it found. For each of the 23 the parent was opened and its close-out comment read
against four questions fixed from the brief before any parent was read: what the close-out
claimed; the parent's state type at HEAD; whether the parent's scope statement, plan or
acceptance list included the filed thing; and who filed it. Where the filing's parent link is
an epic (LIN-751) the ticket whose close-out filed it was read instead.

Coding rules, fixed before reading. *Deferred scope*: the close-out's own words tie the
filing to this ticket's scope, plan or claim ("carries forward items of this ticket", "did
not ship", "still outstanding", "must not be enabled until X lands"). *Separate matter*: the
close-out places it elsewhere ("pre-existing", "untouched", "out of scope", "why it is
separate") **or** routes it with no characterisation at all — a bare `Routed → LIN-nnnn` in a
ledger declared discharged is read as a separate matter, and the seven cases resting on that
reading are counted above. *Done outright*: the filing is not named anywhere in the close-out.
Who-filed was decided by comparing the filing's `createdAt` to the close-out comment's
timestamp, not by the filing's own prose.

```sh
B="$HARBOUR_LOCAL_BASE/api/proxy"   # sleep 1.1 between calls; the proxy caps at 60/min
curl -sG "$B/issues?limit=250" --data-urlencode "after=$CURSOR"
curl -s "$B/issues/$KEY"            # filing, parent, parent's comments
```

## Limits

The pile rebuild is not byte-identical to the one it follows: the rule set is reconstructed,
not published, so 32 of the 40 sampled filings are this draw's own. The scope split landing
on 23/17 again is a coincidence worth naming as one — it is not evidence that the two samples
overlap more than the eight tickets that demonstrably do.

The claim classes are read from prose written by the session that is closing the ticket, and
that prose is its own best case. A close-out that believed it was deferring its own scope but
wrote `Routed` is counted here as calling the matter separate; seven of the eighteen turn on
exactly that, so the split between the two claims is the softest number in this paper. The
bias runs toward under-counting "deferred scope".

Every parent in the sample is Done, so the cross-tabulation has one populated column and can
say nothing about close-outs that held a ticket open — LIN-2452 is the only case of that, and
it closed within the hour once the tickets existed. A sample drawn from never-worked filings
cannot see the filings that were worked, so nothing here says how often routing ends in the
work being done.

The parent-side re-check was run only on the 23, so it can lower that count and never raise
it; the 17 classed as separate from the filing alone were not re-read from the parent.

## Next

The close-outs say so, and the tickets close anyway, which puts the question on the ledger
rather than on the writer: what does an item routed out of a review ledger cost, and does
routing ever end in the work? Take the routed items from a month of close-out ledgers, follow
each to its filed ticket, and report how many were worked, how long they waited, and whether
the ones that were worked differ in how their close-out named them.
