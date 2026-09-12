---
title: What is in the never-worked pile, and what do the worked chains look like?
version: 1
date: 2026-09-12
authors: [Claude]
model: claude-opus-5, claude-code; the dispatch lineage for LIN-2821 (kind `research`) stamps no model or effort
grounded_at: 9ded347c (LinearViewer), 135991f (simple-dispatcher)
cites: [docs/papers/harbour/tasks-generate-tasks.md@9ded347c, LIN-2821 (2026-09-12), LIN-1520, LIN-2013, LIN-1489, LIN-2130, LIN-2297, LIN-2317]
---

# What is in the never-worked pile, and what do the worked chains look like?

The pile is real work, well written, in the wrong place. Forty close-out and review filings
read by hand: 34 describe something still true at HEAD, 38 are stated well enough that a
reader with no access to the parent could act on them — and 23 of the 40 change what "done"
meant for the ticket that produced them. The pile's defect is not that it is vague or stale.
It is that more than half of it is the parent ticket's own unfinished scope, filed as a
neighbour and then not picked up. The worked chains, by contrast, mostly go somewhere: of 84
hops in the 30 deepest chains, 54 narrow toward a fix, 15 restate the same finding at a new
site, and 15 open something unrelated; 19 of the 30 chains narrow overall.

## Findings

**Almost nothing in the pile has expired.** 34 of 40 still true at HEAD, 5 unresolvable from
the repo, 1 no longer true. The five unresolvable ones all need something the tree does not
hold — a live deploy (LIN-1489, LIN-2415), a production wedge (LIN-1729), a future phase's
consumer (LIN-2130), a renamed surface (LIN-2760). The single discharged one, LIN-2013, was a
NUL byte in `routes/proxy.js` that made the file binary to `grep`; `resolutionKey` is gone at
HEAD and the file is clean. Age does not discharge these findings, because they are grounded
at a file and a line, and the file is still there. LIN-1520's census still pins five
`session.destroy(` sites against six in the tree, 53 days after it was filed.

**The pile is legible: 38 of 40 restate their finding in full.** These are not pointers. The
typical filing quotes the offending code, names the file and line, says what it verified at
which commit, and offers a fix sketch — several are longer than the tickets that produced them.
Only two cannot be acted on without opening the parent: LIN-1489 ("confirm the LIN-1478 fold on
a real lineage") and LIN-2130, whose scope is an extension against a consumer that a later
phase has not yet built. Whatever is wrong with this pile, it is not the writing.

**But 23 of 40 are the parent's own scope.** Classed against the fixed question — does this
change what "done" meant for the parent — 23 say yes and 17 say no. The yes side is the brief's
three shapes and little else: a class sibling (LIN-2347, instance C of a class its parent fixed
two instances of), an unhandled case (LIN-1911, exclusion 2 of the parent's approved plan), or
a claim that failed (LIN-1520's "exactly five", LIN-2753's two selectors still labelled "Pure"
after the parent gave them a `Date.now()`). The 17 on the no side are genuinely separate: a
different token store (LIN-1598), a deliberate carry-over the parent's own constraint forbade
touching (LIN-1618), a structural class with no live instance (LIN-1718, LIN-2098), a human's
own request (LIN-2198), a flaky test in another repo (LIN-2413).

**Cross-tabulated, the two axes barely interact.**

| | Stated on its own terms | Pointer back |
|---|---|---|
| **Changes what "done" meant** | 22 | 1 |
| **Does not** | 16 | 1 |

Being the parent's unfinished scope does not make a filing worse-written. Both the work that
should have stayed on the trunk and the work that was rightly its own ticket arrive in the same
form: a self-contained, carefully grounded, unowned page. Nothing in how these are written
distinguishes the 23 from the 17 — the distinction exists only in the reading.

**A worked chain usually narrows, and the deep ones do it by plan, not by discovery.** Of 84
hops, 54 narrow, 15 restate, 15 wander; 19 of the 30 chains narrow overall, 6 restate, 5 wander.
The narrowing is mostly structural: a plan carves a phase, the phase carves a session
(LIN-2241 → WS3 → Phase 3 → Session 1 is four hops of pure carving). The restating hops are
the class checks — LIN-2311 → LIN-2316 → LIN-2317 is one inverted priority scale found at three
successive prompt sites, each hop a new file and the same sentence. The wandering hops are
where a session tripped over something unrelated while doing the work: LIN-1409's autopilot run
found a cross-tenant leak (LIN-1414); LIN-1964's baseline capture found that `tolerate:true`
degrades authentication failures to silent skips (LIN-1984).

**Depth comes from two different machines, and only one of them is a chain of findings.** The
deepest chains are 7 hops (LIN-1600 → LIN-1984; LIN-2079 → LIN-2468) and the tail of the 30 is
2. Breadth peaks early and collapses: the widest hops sit at the root or one below it (10, 9, 7
worked children), and every chain ends at a leaf with none. Where the depth is carve-work the
chain is a plan being executed and each hop is smaller than the last; where it is finding-work —
LIN-2079's six hops from zombie dispatch items to a prompt clause to a false premise to a root
cause to a surviving collision class to a sibling in another repo — every hop is a genuinely
new defect and the chain is the system pulling one thread until it holds.

## Method

Population: all 2,764 workspace issues, paged whole. The window is `tasks-generate-tasks.md`'s:
the sixty days to 2026-09-12T11:01Z, taken as LIN-1325..LIN-2808 on that paper's finding that
identifier order and creation order agree. Never worked is a state type of `backlog` or
`unstarted`; generated is a parent link, else the first `LIN-nnnn` in the opening 400 characters.

The generating event is read from the opening 400 characters against an ordered rule set —
close-out, review, breakdown, parent-only, none. This rebuild puts 499 close-out and review
filings in the never-worked pile against the earlier paper's 485, and 587 worked generated
tickets against its 580; every number here is over the rebuilt populations.

The sample is 40 drawn from those 499 with Python's `random.Random(2821).sample` over the pile
in identifier order, read in full with the parent and, where cited, the filing comment. The
three questions were fixed from the brief before any ticket was opened. Still-true was checked
by reading the named file at `9ded347c` / `135991f`, not by trusting the ticket's prose.

Chains: edges from each worked generated ticket to its generating ticket where that ticket was
also worked, giving 61 roots with at least one worked child. The deepest path from each root was
taken, and the 30 longest kept. Each hop was read from the child's opening against three
readings — narrows (drives the same defect toward a fix, or carves a plan), restates (the same
finding at a new site), wanders (opens something unrelated).

```sh
B="$HARBOUR_LOCAL_BASE/api/proxy"   # sleep 1.1 between calls; the proxy caps at 60/min
curl -sG "$B/issues?limit=250" --data-urlencode "after=$CURSOR"  # descriptions come with the list
curl -s "$B/issues/$KEY"            # parent, comments, relations for the sample
```

## Limits

Forty is enough to see that the pile is mostly live and mostly legible; it is not enough to
split the 23/17 by generating event, and the difference between close-out filings and review
filings is invisible at this size. The still-true check is a read of the named file, so it
catches a fix that removed the code and misses one that made the code correct while leaving it
in place — the bias runs toward over-reporting still-true. Five filings could not be grounded
at all, and those five are exactly the ones whose subject is production, so the pile's live
share is understated by however many of them are discharged.

The scope judgement is one reader's, made from the filing's own account of its parent. A filing
that misdescribes why it was carved out will be classed as it describes itself. Both axes 2 and
3 were read after axis 1, so a filing found still-true may have been read more generously.

The chain graph inherits the parent-attribution rule, so a child that names no parent is
invisible and every chain is a floor on its true depth. Chains are also truncated at the window
edge on both sides: a chain whose root predates LIN-1325 starts mid-stream, and one still
running on 2026-09-12 is cut. The hop readings are the child's own framing of the hop, which is
written by the session that filed it and is therefore its best case.

## Next

The two axes do not interact, which means the trunk-or-ticket question cannot be answered by
reading the filings — only by reading the parent's close-out and asking what it claimed to have
finished. Take the 23 scope filings' parents and read the close-out comment that shipped each
one: does it say the ticket is done, or does it say the ticket is done except for what it just
filed next door? That is where the rule, if there is one, has to bite.
