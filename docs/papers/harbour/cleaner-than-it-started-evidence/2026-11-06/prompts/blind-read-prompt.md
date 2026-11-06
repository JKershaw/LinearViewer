## The blind place-read prompt, for the paper's evidence folder (from the operator)

Answer to `lin4315-blind-prompt`: **supply**. Copy this comment verbatim into the evidence folder (for example `blind-read-prompt.md`). The blind reads were custom dispatches built from one template. Only the heading, the batch label and the change list varied. Each dispatch's own record (`GET /api/proxy/dispatch/{id}`) holds its exact prompt, model and effort; the ids are in `docs/plans/survey/log.md` beside each pass.

### The template (identical across every pass; `{LABEL}` and `{CHANGES}` vary)

```
Repositories: JKershaw/LinearViewer (Harbour) and JKershaw/simple-dispatcher. Clone or fetch both as you need them.

You are scoring merged changes for what each did to its codebase as a place: not whether the change did its job, but whether the code it left behind is in better or worse shape for the next change.

**This is read-only.** Don't change code, branches, pull requests, tickets or Linear state. Your only output is one comment on LIN-4150, starting with the heading `## Blind place scoring, {LABEL}`.

**What to read.** For each change: the commit itself (`git show`), and the code around it at its parent and at the commit. You may run tests or read any code, tests and how-to docs at those commits. **Don't read** Linear tickets, issue or pull-request descriptions or comments, or anything under `docs/plans/`, `docs/reviews/` or `docs/papers/`: form your view from the code. Judge each change on its own; you are not told why it was made or how it was chosen, and you shouldn't try to find out. Where a change spans both repositories, score the two commits together.

**For each change, look at:** did it give a decision one owner, or add a second copy of something the codebase already has? Did it leave anything new without an obvious home? Did it tangle parts of the code that were apart, or untangle them? Did something that should have learned about it (a list, a registry, a guard, a doc) not? What did it delete or make simpler? Then give a balance (**better**, **mixed**, **neutral** or **worse**) with a reason in one or two sentences that names the specifics.

**The changes:**
{CHANGES}

Answer as a table: number, commit(s), balance, reason. Then, under it, at most five lines on anything you noticed across the batch. Be willing to say neutral or worse.

```

### First and second passes (5 Nov): the batches and their change lists

**Batch A** (`## Blind place scoring, batch A`):
```
1. LinearViewer 9cc5ff9cb
2. LinearViewer 5334c81a7 + simple-dispatcher 765289d
3. LinearViewer 7797c306b
4. simple-dispatcher d8d186c
5. LinearViewer 941952711
6. simple-dispatcher 90bbf82
7. LinearViewer d7ceb3734 + simple-dispatcher 44ab30e
8. LinearViewer eb44eff97
9. LinearViewer 172f644a1
10. LinearViewer 42fcf5d1b
11. simple-dispatcher bf499a4
12. LinearViewer 9e397e6be
13. simple-dispatcher 3330526
14. LinearViewer c55f0fb33
```

**Batch B** (`## Blind place scoring, batch B`):
```
1. simple-dispatcher 86bde97
2. simple-dispatcher 54febbf
3. simple-dispatcher 796bc9d
4. LinearViewer 2ee4e6006
5. LinearViewer c70b004c0
6. LinearViewer 723052153
7. LinearViewer ee8ec42e2
8. simple-dispatcher 52d2c3d
9. LinearViewer 10b2c82fb
10. LinearViewer 950113b17
11. LinearViewer 2eb73ae07
12. LinearViewer 279dcb0a4
13. LinearViewer 13fe24a04
14. LinearViewer 0dc1620ea
```

**Batch C** (`## Blind place scoring, batch C`):
```
1. LinearViewer 0dc1620ea
2. simple-dispatcher 54febbf
3. simple-dispatcher bf499a4
4. LinearViewer 42fcf5d1b
5. LinearViewer 9e397e6be
6. LinearViewer 723052153
7. simple-dispatcher 90bbf82
8. LinearViewer d7ceb3734 + simple-dispatcher 44ab30e
9. LinearViewer 10b2c82fb
10. simple-dispatcher 52d2c3d
11. LinearViewer ee8ec42e2
12. LinearViewer 5334c81a7 + simple-dispatcher 765289d
13. simple-dispatcher 86bde97
14. LinearViewer c70b004c0
```

**Batch D** (`## Blind place scoring, batch D`):
```
1. LinearViewer 279dcb0a4
2. LinearViewer 2ee4e6006
3. LinearViewer c55f0fb33
4. simple-dispatcher 3330526
5. LinearViewer 950113b17
6. LinearViewer eb44eff97
7. LinearViewer 941952711
8. LinearViewer 13fe24a04
9. simple-dispatcher d8d186c
10. simple-dispatcher 796bc9d
11. LinearViewer 172f644a1
12. LinearViewer 7797c306b
13. LinearViewer 9cc5ff9cb
14. LinearViewer 2eb73ae07
```

**The blinding keys** (the shuffled order mapped back to tickets; the readers never saw these). `key.json` covers batches A–B, the first pass; `key2.json` covers batches C–D, the second pass, reshuffled with seed 1105:

`key.json`:
```json
[[["LIN-4198", "LV 9cc5ff9cb"], ["LIN-4202", "LV 5334c81a7 + SD 765289d"], ["LIN-4166", "LV 7797c306b"], ["LIN-4187", "SD d8d186c"], ["LIN-4241", "LV 941952711"], ["LIN-4221", "SD 90bbf82"], ["LIN-4203", "LV d7ceb3734 + SD 44ab30e"], ["LIN-4212", "LV eb44eff97"], ["LIN-4243", "LV 172f644a1"], ["LIN-4168", "LV 42fcf5d1b"], ["LIN-4218", "SD bf499a4"], ["LIN-4173", "LV 9e397e6be"], ["LIN-4222", "SD 3330526"], ["LIN-4226", "LV c55f0fb33"]], [["LIN-4224", "SD 86bde97"], ["LIN-4223", "SD 54febbf"], ["LIN-4239", "SD 796bc9d"], ["LIN-4201", "LV 2ee4e6006"], ["LIN-4048", "LV c70b004c0"], ["LIN-4179", "LV 723052153"], ["LIN-4242", "LV ee8ec42e2"], ["LIN-4220", "SD 52d2c3d"], ["LIN-4177", "LV 10b2c82fb"], ["LIN-4234", "LV 950113b17"], ["LIN-4143", "LV 2eb73ae07"], ["LIN-4240", "LV 279dcb0a4"], ["LIN-4151", "LV 13fe24a04"], ["LIN-4178", "LV 0dc1620ea"]]]
```

`key2.json`:
```json
[[["LIN-4178", "LV 0dc1620ea"], ["LIN-4223", "SD 54febbf"], ["LIN-4218", "SD bf499a4"], ["LIN-4168", "LV 42fcf5d1b"], ["LIN-4173", "LV 9e397e6be"], ["LIN-4179", "LV 723052153"], ["LIN-4221", "SD 90bbf82"], ["LIN-4203", "LV d7ceb3734 + SD 44ab30e"], ["LIN-4177", "LV 10b2c82fb"], ["LIN-4220", "SD 52d2c3d"], ["LIN-4242", "LV ee8ec42e2"], ["LIN-4202", "LV 5334c81a7 + SD 765289d"], ["LIN-4224", "SD 86bde97"], ["LIN-4048", "LV c70b004c0"]], [["LIN-4240", "LV 279dcb0a4"], ["LIN-4201", "LV 2ee4e6006"], ["LIN-4226", "LV c55f0fb33"], ["LIN-4222", "SD 3330526"], ["LIN-4234", "LV 950113b17"], ["LIN-4212", "LV eb44eff97"], ["LIN-4241", "LV 941952711"], ["LIN-4151", "LV 13fe24a04"], ["LIN-4187", "SD d8d186c"], ["LIN-4239", "SD 796bc9d"], ["LIN-4243", "LV 172f644a1"], ["LIN-4166", "LV 7797c306b"], ["LIN-4198", "LV 9cc5ff9cb"], ["LIN-4143", "LV 2eb73ae07"]]]
```

### Per-merge reads after 5 Nov 11:00 (labels E onward)

The same template. `{LABEL}` is `LIN-NNNN pass X`, and `{CHANGES}` is one of two forms:

- **One change alone:**
```
1. LinearViewer 473cc865e
```
- **An area read, a parent plus its tidy-after as one change:**
```
1. LinearViewer 6ff38cf5c and 473cc865e, scored together as one change (diff 6ff38cf5c^..473cc865e, restricted to the files those two commits touch)
```

Each pass's label and dispatch id are in `log.md` (and the `place-ledger.md` rows), and each dispatch's record holds the exact prompt it was sent. The passes run from E onward (E–Z, then AA–AP).

---
_Generated by [Claude Code](https://claude.ai/code)_
